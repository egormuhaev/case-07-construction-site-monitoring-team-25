import torch
from PIL import Image as PILImage
from ultralytics import YOLO
from ultralytics.engine.results import Results

from ..config import CV_MODEL_3, get_device
from ..load_model import load_model
from ..model import ImageDataset
from ..model.detected_object import DetectedObject
from ..model.equipment_group import GROUPS, UNKNOWN_EQUIPMENT_CODE
from .crop_utils import crop
from .yolo_world import set_classes

WEIGHTS_FILE = "yolov8x-worldv2.pt"
CONF = 0.25
IOU = 0.45
IMGSZ = 640


class CropWorldClassifier:
    def __init__(self, conf: float = CONF) -> None:
        self.conf = conf
        self.model: YOLO | None = None
        self.group_codes: list[str] = []

    def load_model(self) -> None:
        self.model = YOLO(str(load_model(CV_MODEL_3, WEIGHTS_FILE)))
        groups = [group for group in GROUPS if group.code != UNKNOWN_EQUIPMENT_CODE]
        self.group_codes = [group.code for group in groups]
        prompts = [
            group.prompts[0] if group.prompts else group.description for group in groups
        ]
        set_classes(self.model, prompts)

    def classify(self, dataset: ImageDataset) -> None:
        if self.model is None:
            self.load_model()
        model = self.model
        assert model is not None
        device = get_device()

        for image in dataset.images:
            targets = [obj for obj in image.objects if obj.group == UNKNOWN_EQUIPMENT_CODE]
            if not targets:
                continue
            with PILImage.open(image.filepath) as src:
                frame = src.convert("RGB")
            for obj in targets:
                self._classify_crop(model, frame, obj, device)

    def _classify_crop(
        self,
        model: YOLO,
        frame: PILImage.Image,
        obj: DetectedObject,
        device: torch.device,
    ) -> None:
        cropped = crop(frame, obj)
        if cropped is None:
            return
        result = next(
            iter(
                model.predict(
                    cropped,
                    conf=self.conf,
                    iou=IOU,
                    imgsz=IMGSZ,
                    device=device,
                    verbose=False,
                )
            )
        )
        if not isinstance(result, Results):
            return
        boxes = result.boxes
        if boxes is None or len(boxes) == 0:
            return

        best_conf = -1.0
        best_class_id: int | None = None
        for class_id, conf in zip(boxes.cls.tolist(), boxes.conf.tolist()):
            score = float(conf)
            if score < self.conf or score <= best_conf:
                continue
            best_conf = score
            best_class_id = int(class_id)

        if best_class_id is None or not (0 <= best_class_id < len(self.group_codes)):
            return
        obj.group = self.group_codes[best_class_id]
        obj.needs_refinement = False
