from __future__ import annotations

import json
from typing import Any, cast
from uuid import uuid4

import redis

from .schemas import JobStatus

ACTIVE_STATUSES = {"ACCEPTED", "PROCESSING"}


class JobStore:
    def __init__(self, client: redis.Redis, ttl_seconds: int) -> None:
        self.client: Any = client
        self.ttl_seconds = ttl_seconds

    def ping(self) -> None:
        self.client.ping()

    def create_job(
        self,
        request_id: str,
        workflow_id: str,
        step: str,
        payload: dict[str, Any],
    ) -> tuple[str, bool]:
        job_id = str(uuid4())
        mapped = self.client.set(
            self._request_key(request_id),
            job_id,
            nx=True,
            ex=self.ttl_seconds,
        )
        if not mapped:
            existing = self.get_existing_job_id(request_id)
            return existing or job_id, False
        record = {
            "jobId": job_id,
            "requestId": request_id,
            "workflowId": workflow_id,
            "step": step,
            "status": "ACCEPTED",
            "payload": payload,
            "completed_stages": [],
            "error": None,
        }
        self._set_json(self._job_key(job_id), record)
        self.client.sadd(self._active_key(), job_id)
        self.client.expire(self._active_key(), self.ttl_seconds)
        return job_id, True

    def get_job(self, job_id: str) -> dict[str, Any] | None:
        return self._get_json(self._job_key(job_id))

    def get_existing_job_id(self, request_id: str) -> str | None:
        value = self.client.get(self._request_key(request_id))
        if value is None:
            return None
        return str(value)

    def set_status(self, job_id: str, status: JobStatus, error: str | None = None) -> None:
        record = self.get_job(job_id)
        if record is None:
            return
        record["status"] = status
        record["error"] = error
        self._set_json(self._job_key(job_id), record)
        if status not in ACTIVE_STATUSES:
            self.client.srem(self._active_key(), job_id)

    def save_stage(self, job_id: str, stage: str, snapshot: dict[str, Any]) -> None:
        self._set_json(self._stage_key(job_id, stage), snapshot)
        record = self.get_job(job_id)
        if record is None:
            return
        stages = list(record.get("completed_stages") or [])
        if stage not in stages:
            stages.append(stage)
        record["completed_stages"] = stages
        self._set_json(self._job_key(job_id), record)

    def get_stage(self, job_id: str, stage: str) -> dict[str, Any] | None:
        return self._get_json(self._stage_key(job_id, stage))

    def save_result(self, job_id: str, result: dict[str, Any]) -> None:
        self._set_json(self._result_key(job_id), result)
        record = self.get_job(job_id)
        if record is None:
            return
        record["status"] = "COMPLETED"
        record["error"] = None
        self._set_json(self._job_key(job_id), record)
        self.client.srem(self._active_key(), job_id)

    def get_result(self, job_id: str) -> dict[str, Any] | None:
        return self._get_json(self._result_key(job_id))

    def list_active_job_ids(self) -> list[str]:
        values = self.client.smembers(self._active_key())
        return [str(value) for value in values]

    def try_lock(self, job_id: str, ttl_seconds: int = 3600) -> bool:
        return bool(self.client.set(self._lock_key(job_id), "1", nx=True, ex=ttl_seconds))

    def unlock(self, job_id: str) -> None:
        self.client.delete(self._lock_key(job_id))

    def _set_json(self, key: str, value: dict[str, Any]) -> None:
        self.client.set(key, json.dumps(value, ensure_ascii=False), ex=self.ttl_seconds)

    def _get_json(self, key: str) -> dict[str, Any] | None:
        raw = self.client.get(key)
        if raw is None:
            return None
        parsed = json.loads(cast(str, raw))
        if not isinstance(parsed, dict):
            return None
        return parsed

    def _job_key(self, job_id: str) -> str:
        return f"detecting:job:{job_id}"

    def _stage_key(self, job_id: str, stage: str) -> str:
        return f"detecting:job:{job_id}:stage:{stage}"

    def _result_key(self, job_id: str) -> str:
        return f"detecting:job:{job_id}:result"

    def _request_key(self, request_id: str) -> str:
        return f"detecting:request:{request_id}"

    def _active_key(self) -> str:
        return "detecting:jobs:active"

    def _lock_key(self, job_id: str) -> str:
        return f"detecting:job:{job_id}:lock"
