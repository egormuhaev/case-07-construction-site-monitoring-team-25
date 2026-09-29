from __future__ import annotations

from analysis.pipeline import run_analysis
from analysis.settings import Settings

from .schemas import parse_payload
from .store import JobStore


def run_job(job_id: str, store: JobStore, settings: Settings) -> None:
    if not store.try_lock(job_id):
        return
    try:
        record = store.get_job(job_id)
        if record is None or record.get("status") in {"COMPLETED", "FAILED"}:
            return
        store.set_status(job_id, "PROCESSING")
        payload = parse_payload(record["payload"])

        def on_stage(stage: str, snapshot: dict) -> None:
            store.save_stage(job_id, stage, snapshot)

        result = run_analysis(payload, settings, on_stage=on_stage)
        store.save_result(job_id, result)
    except Exception as error:
        store.set_status(job_id, "FAILED", str(error))
    finally:
        store.unlock(job_id)
