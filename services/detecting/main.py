import os
from datetime import datetime, time
from pathlib import Path

from detecting.build_report import BuildReport
from detecting.config import DATASET_DAY, DAY_END, DAY_START, TEST_DATASET_DIR
from detecting.log import configure_logging, dataset_summary, get_logger, stage
from detecting.cv import (
    CropClassifier,
    CropGroupClassifier,
    CropWorldClassifier,
    DetectingPipeline,
    DetectionResolver,
    HazardDetector,
    MachineDetector,
)
from detecting.model import Image, ImageDataset
from detecting.view_grouper import view_grouper

CLASSIFIER = "clip"
logger = get_logger("main")


def get_images() -> list[Image]:
    if not TEST_DATASET_DIR.is_dir():
        raise FileNotFoundError(f"Нет каталога с изображениями: {TEST_DATASET_DIR}")

    files = [
        TEST_DATASET_DIR / name
        for name in os.listdir(TEST_DATASET_DIR)
        if name != ".DS_Store"
    ]
    return _assign_day_times(files)


def _assign_day_times(files: list[Path]) -> list[Image]:
    grouped: dict[str, list[Path]] = {}
    for path in files:
        grouped.setdefault(_camera_prefix(path.name), []).append(path)

    images: list[Image] = []
    for prefix in sorted(grouped):
        camera_files = sorted(grouped[prefix], key=lambda path: path.name)
        times = _spread_times(len(camera_files))
        for path, captured_time in zip(camera_files, times):
            images.append(
                Image(
                    filepath=str(path),
                    captured_date=DATASET_DAY,
                    captured_time=captured_time,
                )
            )
    return images


def _camera_prefix(filename: str) -> str:
    digits = "".join(char for char in filename if char.isdigit())
    return digits[:4] if len(digits) >= 4 else filename


def _spread_times(count: int) -> list[time]:
    start = datetime.combine(DATASET_DAY, DAY_START)
    end = datetime.combine(DATASET_DAY, DAY_END)
    if count == 1:
        return [start.time()]
    step = (end - start) / (count - 1)
    return [(start + step * index).time() for index in range(count)]


def main() -> None:
    configure_logging()
    logger.info("старт, каталог %s", TEST_DATASET_DIR)
    with stage("загрузка изображений", logger):
        dataset = ImageDataset(images=get_images())
    logger.info("загружено %d кадров", len(dataset.images))
    with stage("группировка ракурсов", logger):
        view_grouper(dataset)
    DetectingPipeline(
        [
            HazardDetector(),
            MachineDetector(),
        ],
        resolver=DetectionResolver(),
        classifier=CropWorldClassifier(),
    ).run(dataset)
    with stage("отчёт", logger):
        report = BuildReport(dataset).build()
    logger.info("отчёт: %s", report)
    logger.info("готово: %s", dataset_summary(dataset))


if __name__ == "__main__":
    main()
