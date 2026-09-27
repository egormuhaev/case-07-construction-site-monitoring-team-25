from abc import ABC, abstractmethod
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from ..model import Image, ImageDataset
from ..model.detected_object import DetectedObject, DetectionEvidence
from ..model.equipment_group import GROUP_BY_CODE, PERSON_CODE, UNKNOWN_EQUIPMENT_CODE


@dataclass(frozen=True)
class ClassMapping:
    group: str
    needs_refinement: bool = False


def group_mapping(code: str, *, needs_refinement: bool | None = None) -> ClassMapping:
    if code != PERSON_CODE and code not in GROUP_BY_CODE:
        raise KeyError(f"Неизвестная визуальная группа: {code}")
    if needs_refinement is None:
        needs_refinement = code == UNKNOWN_EQUIPMENT_CODE
    return ClassMapping(code, needs_refinement=needs_refinement)


class Detector(ABC):
    model_id: str
    weights_file: str | None = None

    def __init__(self) -> None:
        self.model: Any = None

    @abstractmethod
    def load_model(self) -> None:
        raise NotImplementedError

    @abstractmethod
    def detect(self, dataset: ImageDataset) -> None:
        raise NotImplementedError

    @abstractmethod
    def map_class(self, raw_class_id: int) -> ClassMapping | None:
        raise NotImplementedError

    def weights_path(self) -> Path:
        from ..load_model import load_model

        return load_model(self.model_id, self.weights_file)

    def append_detection(
        self,
        image: Image,
        x1: float,
        y1: float,
        x2: float,
        y2: float,
        mapping: ClassMapping,
        conf: float,
        raw_class_id: int,
    ) -> None:
        image.objects.append(
            DetectedObject(
                model_id=self.model_id,
                x1=x1,
                y1=y1,
                x2=x2,
                y2=y2,
                group=mapping.group,
                conf=conf,
                needs_refinement=mapping.needs_refinement,
                evidence=[
                    DetectionEvidence(
                        model_id=self.model_id,
                        raw_class_id=raw_class_id,
                        x1=x1,
                        y1=y1,
                        x2=x2,
                        y2=y2,
                        conf=conf,
                    )
                ],
            )
        )
