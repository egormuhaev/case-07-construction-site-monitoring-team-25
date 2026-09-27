from __future__ import annotations

import logging
import sys
import time
from collections import Counter
from collections.abc import Generator
from contextlib import contextmanager

from .model import ImageDataset
from .model.equipment_group import UNKNOWN_EQUIPMENT_CODE

LOGGER_NAME = "detecting"


def get_logger(name: str | None = None) -> logging.Logger:
    if name:
        return logging.getLogger(f"{LOGGER_NAME}.{name}")
    return logging.getLogger(LOGGER_NAME)


def configure_logging(level: int = logging.INFO) -> None:
    logger = logging.getLogger(LOGGER_NAME)
    logger.setLevel(level)
    if not logger.handlers:
        handler = logging.StreamHandler(sys.stdout)
        handler.setFormatter(
            logging.Formatter(
                "%(asctime)s %(levelname)s [%(name)s] %(message)s",
                datefmt="%H:%M:%S",
            )
        )
        logger.addHandler(handler)
    logger.propagate = False
    logging.getLogger("ultralytics").setLevel(logging.WARNING)
    logging.getLogger("transformers").setLevel(logging.WARNING)


@contextmanager
def stage(title: str, logger: logging.Logger | None = None) -> Generator[None, None, None]:
    log = logger or get_logger()
    log.info("%s — старт", title)
    started = time.perf_counter()
    try:
        yield
    except Exception:
        elapsed = time.perf_counter() - started
        log.exception("%s — ошибка (%.1fs)", title, elapsed)
        raise
    elapsed = time.perf_counter() - started
    log.info("%s — готово (%.1fs)", title, elapsed)


def object_count(dataset: ImageDataset) -> int:
    return sum(len(image.objects) for image in dataset.images)


def unknown_count(dataset: ImageDataset) -> int:
    return sum(
        1
        for image in dataset.images
        for obj in image.objects
        if obj.group == UNKNOWN_EQUIPMENT_CODE
    )


def dataset_summary(dataset: ImageDataset) -> str:
    objects = [obj for image in dataset.images for obj in image.objects]
    if not objects:
        return f"{len(dataset.images)} кадров, 0 объектов"
    counts = Counter(obj.group for obj in objects)
    parts = ", ".join(f"{code} {count}" for code, count in counts.most_common())
    refinement = sum(1 for obj in objects if obj.needs_refinement)
    extra = f", needs_refinement {refinement}" if refinement else ""
    return f"{len(dataset.images)} кадров, {len(objects)} объектов ({parts}){extra}"
