from typing import Protocol

from ..log import dataset_summary, get_logger, object_count, stage, unknown_count
from ..model import ImageDataset
from .detector import Detector
from .resolver import DetectionResolver

logger = get_logger("cv")


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
        logger.info(
            "пайплайн: кадры=%d детекторы=%s resolver=%s classifier=%s",
            len(dataset.images),
            [type(detector).__name__ for detector in self.detectors],
            type(self.resolver).__name__ if self.resolver is not None else "нет",
            type(self.classifier).__name__ if self.classifier is not None else "нет",
        )
        for detector in self.detectors:
            self._run_detector(detector, dataset)
        self._run_resolver(dataset)
        self._run_classifier(dataset)
        logger.info("пайплайн завершён: %s", dataset_summary(dataset))

    def _run_detector(self, detector: Detector, dataset: ImageDataset) -> None:
        name = type(detector).__name__
        with stage(f"детектор {name}: загрузка модели", logger):
            detector.load_model()
        before = object_count(dataset)
        with stage(f"детектор {name}: инференс", logger):
            detector.detect(dataset)
        added = object_count(dataset) - before
        logger.info("после %s: +%d объектов, %s", name, added, dataset_summary(dataset))

    def _run_resolver(self, dataset: ImageDataset) -> None:
        if self.resolver is None:
            logger.info("resolver пропущен")
            return
        before = object_count(dataset)
        with stage("resolver", logger):
            self.resolver.resolve(dataset)
        after = object_count(dataset)
        logger.info(
            "после resolver: %d → %d объектов, %s",
            before,
            after,
            dataset_summary(dataset),
        )

    def _run_classifier(self, dataset: ImageDataset) -> None:
        if self.classifier is None:
            logger.info("классификатор пропущен")
            return
        name = type(self.classifier).__name__
        with stage(f"классификатор {name}: загрузка модели", logger):
            self.classifier.load_model()
        unknown_before = unknown_count(dataset)
        with stage(f"классификатор {name}: crop", logger):
            self.classifier.classify(dataset)
        unknown_after = unknown_count(dataset)
        logger.info(
            "после %s: unknown %d → %d, %s",
            name,
            unknown_before,
            unknown_after,
            dataset_summary(dataset),
        )
