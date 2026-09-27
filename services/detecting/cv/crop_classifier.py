import torch
from PIL import Image as PILImage
from sentence_transformers import SentenceTransformer

from ..config import CLIP_MODEL_ID, get_device
from ..load_model import load_model
from ..model import ImageDataset
from ..model.detected_object import DetectedObject
from ..model.equipment_group import GROUPS, UNKNOWN_EQUIPMENT_CODE
from .crop_utils import crop

SCORE_THRESHOLD = 0.22
MARGIN_THRESHOLD = 0.02


class CropGroupClassifier:
    def __init__(
        self,
        score_threshold: float = SCORE_THRESHOLD,
        margin_threshold: float = MARGIN_THRESHOLD,
    ) -> None:
        self.score_threshold = score_threshold
        self.margin_threshold = margin_threshold
        self.model: SentenceTransformer | None = None
        self.group_codes: list[str] = []
        self.group_embeddings: torch.Tensor | None = None

    def load_model(self) -> None:
        device = get_device()
        model_device = "cpu" if device.type == "mps" else str(device)
        self.model = SentenceTransformer(str(load_model(CLIP_MODEL_ID)), device=model_device)

        codes: list[str] = []
        embeddings: list[torch.Tensor] = []
        for group in GROUPS:
            if group.code == UNKNOWN_EQUIPMENT_CODE:
                continue
            texts = list(group.prompts) if group.prompts else [group.description]
            text_embeddings = self.model.encode(
                texts,
                normalize_embeddings=True,
                convert_to_tensor=True,
            )
            if not isinstance(text_embeddings, torch.Tensor):
                raise TypeError(f"ожидался Tensor, получили {type(text_embeddings)}")
            pooled = text_embeddings.mean(dim=0)
            embeddings.append(torch.nn.functional.normalize(pooled, dim=0))
            codes.append(group.code)

        self.group_codes = codes
        self.group_embeddings = torch.stack(embeddings)

    def classify(self, dataset: ImageDataset) -> None:
        if self.model is None or self.group_embeddings is None:
            self.load_model()
        model = self.model
        group_embeddings = self.group_embeddings
        assert model is not None
        assert group_embeddings is not None

        for image in dataset.images:
            targets = [obj for obj in image.objects if obj.group == UNKNOWN_EQUIPMENT_CODE]
            if not targets:
                continue
            with PILImage.open(image.filepath) as src:
                frame = src.convert("RGB")
            crops: list[PILImage.Image] = []
            objects: list[DetectedObject] = []
            for obj in targets:
                cropped = crop(frame, obj)
                if cropped is None:
                    continue
                crops.append(cropped)
                objects.append(obj)
            if not crops:
                continue

            image_embeddings = model.encode(
                crops,
                normalize_embeddings=True,
                convert_to_tensor=True,
            )
            if not isinstance(image_embeddings, torch.Tensor):
                raise TypeError(f"ожидался Tensor, получили {type(image_embeddings)}")
            scores = image_embeddings @ group_embeddings.to(image_embeddings.device).T
            for obj, row in zip(objects, scores):
                picked = _pick_group(
                    row,
                    self.group_codes,
                    self.score_threshold,
                    self.margin_threshold,
                )
                if picked is None:
                    continue
                obj.group = picked
                obj.needs_refinement = False


def _pick_group(
    scores: torch.Tensor,
    codes: list[str],
    score_threshold: float,
    margin_threshold: float,
) -> str | None:
    if scores.numel() == 0 or not codes:
        return None
    k = min(2, scores.numel())
    values, indices = torch.topk(scores, k=k)
    if float(values[0]) < score_threshold:
        return None
    if k > 1 and float(values[0] - values[1]) < margin_threshold:
        return None
    return codes[int(indices[0])]
