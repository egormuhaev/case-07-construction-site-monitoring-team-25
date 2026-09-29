from __future__ import annotations

import threading
from pathlib import Path

from planning.pipeline import run_plan_import
from planning.settings import Settings

from .schemas import PlanPayload
from .store import JobStore


class ModelRegistry:
    def __init__(self) -> None:
        self.lock = threading.Lock()


def run_job(job_id: str, store: JobStore, settings: Settings, registry: ModelRegistry) -> None:
    if not store.try_lock(job_id):
        return
    try:
        record = store.get_job(job_id)
        if record is None or record.get("status") in {"COMPLETED", "FAILED"}:
            return
        store.set_status(job_id, "PROCESSING")
        payload = PlanPayload.model_validate(record["payload"])

        def on_stage(stage: str, snapshot: dict) -> None:
            store.save_stage(job_id, stage, snapshot)

        with registry.lock:
            result = run_plan_import(
                payload.model_dump(),
                settings,
                settings.data_dir,
                on_stage=on_stage,
            )
        store.save_result(job_id, result)
    except Exception as error:
        store.set_status(job_id, "FAILED", str(error))
    finally:
        store.unlock(job_id)


def resolve_data_path(data_dir: Path, relative: str) -> Path:
    base = data_dir.resolve()
    candidate = (base / relative).resolve()
    if not candidate.is_relative_to(base):
        raise ValueError(f"путь вне DATA_DIR: {relative}")
    if not candidate.is_file():
        raise FileNotFoundError(f"нет файла: {relative}")
    return candidate
