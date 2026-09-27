from datetime import date, time
from typing import Any

from .model import Image, ImageDataset
from .model.detected_object import DetectedObject, DetectionEvidence


def _as_optional_int(value: Any) -> int | None:
    if value is None:
        return None
    return int(value)


def dataset_to_state(dataset: ImageDataset) -> dict:
    return {"images": [_image_state(image) for image in dataset.images]}


def state_to_dataset(state: dict) -> ImageDataset:
    images: list[Image] = []
    for item in state.get("images", []):
        image = Image(
            filepath=item["filepath"],
            captured_date=date.fromisoformat(item["captured_date"]),
            captured_time=time.fromisoformat(item["captured_time"]),
            camera=item.get("camera"),
        )
        image.objects = [_object_from_state(obj) for obj in item.get("objects", [])]
        images.append(image)
    return ImageDataset(images=images)


def _image_state(image: Image) -> dict:
    return {
        "filepath": image.filepath,
        "captured_date": image.captured_date.isoformat(),
        "captured_time": image.captured_time.isoformat(),
        "camera": _as_optional_int(image.camera),
        "objects": [_object_state(obj) for obj in image.objects],
    }


def _object_state(obj: DetectedObject) -> dict:
    return {
        "model_id": obj.model_id,
        "x1": obj.x1,
        "y1": obj.y1,
        "x2": obj.x2,
        "y2": obj.y2,
        "group": obj.group,
        "conf": obj.conf,
        "needs_refinement": obj.needs_refinement,
        "classification_source": obj.classification_source,
        "classification_confidence": obj.classification_confidence,
        "evidence": [
            {
                "model_id": item.model_id,
                "raw_class_id": item.raw_class_id,
                "x1": item.x1,
                "y1": item.y1,
                "x2": item.x2,
                "y2": item.y2,
                "conf": item.conf,
            }
            for item in obj.evidence
        ],
    }


def _object_from_state(item: dict) -> DetectedObject:
    return DetectedObject(
        model_id=item["model_id"],
        x1=item["x1"],
        y1=item["y1"],
        x2=item["x2"],
        y2=item["y2"],
        group=item["group"],
        conf=item["conf"],
        needs_refinement=item.get("needs_refinement", False),
        classification_source=item.get("classification_source"),
        classification_confidence=item.get("classification_confidence"),
        evidence=[
            DetectionEvidence(
                model_id=row["model_id"],
                raw_class_id=row["raw_class_id"],
                x1=row["x1"],
                y1=row["y1"],
                x2=row["x2"],
                y2=row["y2"],
                conf=row["conf"],
            )
            for row in item.get("evidence", [])
        ],
    )
