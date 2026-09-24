from dataclasses import dataclass


@dataclass
class Image:
    filepath: str
    camera: int | None = None
