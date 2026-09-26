from dataclasses import dataclass, field


@dataclass
class DetectionEvidence:
    model_id: str
    raw_class_id: int
    x1: float
    y1: float
    x2: float
    y2: float
    conf: float


@dataclass
class DetectedObject:
    model_id: str
    x1: float
    y1: float
    x2: float
    y2: float
    group: str
    conf: float
    needs_refinement: bool = False
    evidence: list[DetectionEvidence] = field(default_factory=list)
