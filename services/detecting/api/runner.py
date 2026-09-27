from __future__ import annotations

import threading
from pathlib import Path

from detecting.build_report import BuildReport
from detecting.cv import (
    CropWorldClassifier,
    DetectingPipeline,
    DetectionResolver,
    HazardDetector,
    MachineDetector,
)
from detecting.export import dataset_to_dict
from detecting.log import get_logger, stage
from detecting.model import Image, ImageDataset
from detecting.settings import Settings
from detecting.state import dataset_to_state, state_to_dataset
from detecting.view_grouper import view_grouper

from .schemas import DetectPayload
from .store import JobStore

logger = get_logger("api.runner")


class ModelRegistry:
    def __init__(self) -> None:
        self.lock = threading.Lock()
        self.hazard = HazardDetector()
        self.machine = MachineDetector()
        self.classifier = CropWorldClassifier()
        self.resolver = DetectionResolver()

    def pipeline(self) -> DetectingPipeline:
        return DetectingPipeline(
            [self.hazard, self.machine],
            resolver=self.resolver,
            classifier=self.classifier,
        )


def run_job(job_id: str, store: JobStore, settings: Settings, registry: ModelRegistry) -> None:
    if not store.try_lock(job_id):
        logger.info("джоба %s уже выполняется", job_id)
        return
    try:
        _run_locked(job_id, store, settings, registry)
    finally:
        store.unlock(job_id)


def _run_locked(
    job_id: str,
    store: JobStore,
    settings: Settings,
    registry: ModelRegistry,
) -> None:
    record = store.get_job(job_id)
    if record is None:
        return
    if record.get("status") in {"COMPLETED", "FAILED"}:
        return

    store.set_status(job_id, "PROCESSING")
    try:
        payload = DetectPayload.model_validate(record["payload"])
        dataset, skip = _restore_or_build(job_id, payload, store, settings.data_dir)
        completed = set(skip)

        def on_stage(stage_name: str, current: ImageDataset) -> None:
            store.save_stage(job_id, stage_name, dataset_to_state(current))
            logger.info("чекпоинт %s для %s", stage_name, job_id)

        if "viewpoints" not in completed:
            if _payload_has_cameras(payload):
                logger.info("камера задана во payload, стадия viewpoints пропущена")
            else:
                with stage("группировка ракурсов", logger):
                    view_grouper(dataset)
            on_stage("viewpoints", dataset)

        with registry.lock:
            registry.pipeline().run(
                dataset,
                skip_stages=completed,
                on_stage_complete=on_stage,
            )

        result = dataset_to_dict(dataset, settings.data_dir)
        store.save_result(job_id, result)
        if settings.save_reports:
            BuildReport(dataset, output_dir=settings.report_dir / job_id).build()
        logger.info("джоба %s завершена, кадров %d", job_id, len(result.get("frames", [])))
    except Exception as error:
        message = str(error)
        logger.exception("джоба %s упала: %s", job_id, message)
        store.set_status(job_id, "FAILED", message)


def _restore_or_build(
    job_id: str,
    payload: DetectPayload,
    store: JobStore,
    data_dir: Path,
) -> tuple[ImageDataset, list[str]]:
    record = store.get_job(job_id)
    completed = list((record or {}).get("completed_stages") or [])
    if completed:
        snapshot = store.get_stage(job_id, completed[-1])
        if snapshot is not None:
            logger.info("восстановление %s со стадии %s", job_id, completed[-1])
            return state_to_dataset(snapshot), completed
    return _dataset_from_payload(payload, data_dir), []


def _dataset_from_payload(payload: DetectPayload, data_dir: Path) -> ImageDataset:
    images: list[Image] = []
    for frame in payload.frames:
        path = resolve_data_path(data_dir, frame.path)
        images.append(
            Image(
                filepath=str(path),
                captured_date=frame.captured_date,
                captured_time=frame.captured_time,
                camera=frame.camera,
            )
        )
    return ImageDataset(images=images)


def _payload_has_cameras(payload: DetectPayload) -> bool:
    return bool(payload.frames) and all(bool(frame.camera) for frame in payload.frames)


def resolve_data_path(data_dir: Path, relative: str) -> Path:
    base = data_dir.resolve()
    candidate = (base / relative).resolve()
    if not candidate.is_relative_to(base):
        raise ValueError(f"путь вне DATA_DIR: {relative}")
    if not candidate.is_file():
        raise FileNotFoundError(f"нет файла: {relative}")
    return candidate
