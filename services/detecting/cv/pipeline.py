from typing import Protocol

from ..model import ImageDataset
from .detector import Detector
from .resolver import DetectionResolver


class CropClassifier(Protocol):
    def load_model(self) -> None: ...

    def classify(self, dataset: ImageDataset) -> None: ...


class DetectingPipeline:
    def __init__(
        self,
        detectors: list[Detector],
        resolver: DetectionResolver | None = None,
        classifier: CropClassifier | None = None,
    ) -> None:
        self.detectors = detectors
        self.resolver = resolver
        self.classifier = classifier

    def run(self, dataset: ImageDataset) -> None:
        for detector in self.detectors:
            detector.load_model()
            detector.detect(dataset)
        if self.resolver is not None:
            self.resolver.resolve(dataset)
        if self.classifier is not None:
            self.classifier.load_model()
            self.classifier.classify(dataset)
