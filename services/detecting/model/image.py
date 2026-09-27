from dataclasses import dataclass, field
from datetime import date, time

from .detected_object import DetectedObject


@dataclass
class Image:
    filepath: str
    captured_date: date
    captured_time: time
    camera: int | None = None
    objects: list[DetectedObject] = field(init=False, default_factory=list)
