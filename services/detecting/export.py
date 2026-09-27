from datetime import datetime
from pathlib import Path

from PIL import Image as PILImage

from .model import DetectedObject, Image, ImageDataset

SCHEMA_VERSION = "1.0"


def dataset_to_dict(dataset: ImageDataset, data_dir: Path | None = None) -> dict:
    return {
        "schema_version": SCHEMA_VERSION,
        "frames": [_frame_dict(image, data_dir) for image in dataset.images],
    }


def _frame_dict(image: Image, data_dir: Path | None) -> dict:
    stem = Path(image.filepath).stem
    width, height = _image_size(image.filepath)
    return {
        "frame_id": stem,
        "image_path": _relative_path(image.filepath, data_dir),
        "captured_at": datetime.combine(image.captured_date, image.captured_time).isoformat(),
        "camera_id": None if image.camera is None else str(image.camera),
        "image_size": {"width": width, "height": height},
        "objects": [
            _object_dict(stem, index, obj) for index, obj in enumerate(image.objects)
        ],
    }


def _object_dict(stem: str, index: int, obj: DetectedObject) -> dict:
    classification = None
    if obj.classification_source is not None and obj.classification_confidence is not None:
        classification = {
            "source": obj.classification_source,
            "confidence": round(obj.classification_confidence, 4),
        }
    return {
        "object_id": f"{stem}:{index}",
        "class": obj.group,
        "bbox": {
            "x1": round(obj.x1, 4),
            "y1": round(obj.y1, 4),
            "x2": round(obj.x2, 4),
            "y2": round(obj.y2, 4),
        },
        "detection_confidence": round(obj.conf, 4),
        "classification": classification,
        "needs_refinement": obj.needs_refinement,
    }


def _image_size(filepath: str) -> tuple[int, int]:
    with PILImage.open(filepath) as src:
        return src.size


def _relative_path(filepath: str, data_dir: Path | None) -> str:
    if data_dir is None:
        return filepath
    path = Path(filepath)
    try:
        return str(path.resolve().relative_to(data_dir.resolve()))
    except ValueError:
        return filepath
