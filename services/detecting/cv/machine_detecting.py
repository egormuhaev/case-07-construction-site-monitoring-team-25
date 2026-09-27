import importlib
import sys
import warnings
from pathlib import Path
from types import ModuleType
from typing import Any

from ..config import CV_MODEL_2, get_device
from ..model import ImageDataset
from .detector import ClassMapping, Detector, group_mapping

WEIGHTS_FILE = "best.pt"
CONF = 0.25
IOU = 0.45
IMGSZ = 640

RAW_TO_GROUP = {
    0: group_mapping("EARTHMOVING"),
    1: group_mapping("TRUCK_TRANSPORT"),
    2: group_mapping("EARTHMOVING"),
    3: group_mapping("EARTHMOVING"),
    4: group_mapping("EARTHMOVING"),
    5: group_mapping("CRANE_LIFTING"),
    7: group_mapping("ROAD_CONSTRUCTION"),
    9: group_mapping("PERSON"),
}


def _enable_yolov5() -> None:
    warnings.filterwarnings(
        "ignore",
        message=r"`torch\.cuda\.amp\.autocast\(args\.\.\.\)` is deprecated",
        category=FutureWarning,
        module=r"yolov5(\.|$)",
    )
    try:
        importlib.import_module("pkg_resources")
    except ModuleNotFoundError:
        from packaging.version import parse as parse_version

        pkg_resources = ModuleType("pkg_resources")
        setattr(pkg_resources, "parse_version", parse_version)
        sys.modules["pkg_resources"] = pkg_resources

    if "huggingface_hub.utils._errors" not in sys.modules:
        from huggingface_hub.errors import RepositoryNotFoundError

        errors = ModuleType("huggingface_hub.utils._errors")
        setattr(errors, "RepositoryNotFoundError", RepositoryNotFoundError)
        sys.modules["huggingface_hub.utils._errors"] = errors

    import torch
    import torch.serialization as torch_serialization

    if not getattr(torch.load, "_yolov5_weights_only_patch", False):

        def _torch_load(*args, _orig=torch_serialization.load, **kwargs):
            kwargs.setdefault("weights_only", False)
            return _orig(*args, **kwargs)

        _torch_load._yolov5_weights_only_patch = True
        torch.load = _torch_load

    import yolov5

    yolov5_root = str(Path(yolov5.__file__).resolve().parent)
    if yolov5_root not in sys.path:
        sys.path.insert(0, yolov5_root)


_enable_yolov5()
import yolov5


class MachineDetector(Detector):
    model_id = CV_MODEL_2
    weights_file = WEIGHTS_FILE

    def load_model(self) -> None:
        if self.model is not None:
            return
        device = "cpu" if get_device().type == "mps" else str(get_device())
        model: Any = yolov5.load(str(self.weights_path()), device=device)
        model.conf = CONF
        model.iou = IOU
        self.model = model

    def detect(self, dataset: ImageDataset) -> None:
        if self.model is None:
            self.load_model()
        model = self.model
        assert model is not None

        for image in dataset.images:
            results = model(image.filepath, size=IMGSZ)
            predictions = results.pred[0]
            if predictions is None or len(predictions) == 0:
                continue

            for x1, y1, x2, y2, conf, class_id in predictions.tolist():
                raw_class_id = int(class_id)
                mapped = self.map_class(raw_class_id)
                if mapped is None:
                    continue
                self.append_detection(
                    image,
                    float(x1),
                    float(y1),
                    float(x2),
                    float(y2),
                    mapped,
                    float(conf),
                    raw_class_id,
                )

    def map_class(self, raw_class_id: int) -> ClassMapping | None:
        return RAW_TO_GROUP.get(raw_class_id)
