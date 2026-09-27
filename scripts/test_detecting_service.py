#!/usr/bin/env python3
from __future__ import annotations

import os
import re
import shutil
import sys
import time as time_module
from datetime import date, datetime, time, timedelta
from pathlib import Path
from uuid import uuid4

import httpx

REPO = Path(__file__).resolve().parent.parent
SOURCE_DATASET = REPO / "dataset" / "test-dataset"
SHARED_DIR = REPO / "orchestrator" / "shared"
TARGET_DATASET = SHARED_DIR / "test-dataset"
BASE_URL = os.environ.get("DETECTING_URL", "http://127.0.0.1:8000").rstrip("/")
POLL_SECONDS = float(os.environ.get("DETECTING_TEST_POLL_SECONDS", "2"))
TIMEOUT_SECONDS = float(os.environ.get("DETECTING_TEST_TIMEOUT_SECONDS", "3600"))
NAME_RE = re.compile(
    r"(?P<hour>\d{2})_(?P<minute>\d{2})_(?P<second>\d{2})_\d+-(?P<day>\d{4}-\d{2}-\d{2})"
)


def main() -> int:
    if not SOURCE_DATASET.is_dir():
        print(f"нет датасета: {SOURCE_DATASET}", file=sys.stderr)
        return 1
    _prepare_shared_dataset()
    frames = _frames_payload()
    if not frames:
        print("в датасете нет кадров", file=sys.stderr)
        return 1

    request_id = os.environ.get("DETECTING_TEST_REQUEST_ID", str(uuid4()))
    body = {
        "requestId": request_id,
        "workflowId": "test-detecting",
        "step": "detect",
        "payload": {"frames": frames},
    }
    with httpx.Client(timeout=30.0) as client:
        submitted = client.post(
            f"{BASE_URL}/jobs",
            json=body,
            headers={"x-request-id": request_id, "content-type": "application/json"},
        )
        if submitted.status_code == 429:
            print(submitted.text, file=sys.stderr)
            return 1
        if submitted.status_code >= 400:
            print(submitted.text, file=sys.stderr)
            return 1
        data = submitted.json()
        job_id = data.get("jobId")
        if not job_id:
            print(f"нет jobId: {data}", file=sys.stderr)
            return 1
        print(f"джоба {job_id}, статус {data.get('status')}")
        result = _poll(client, job_id)
    if result is None:
        return 1
    return 0 if _validate(result) else 1


def _prepare_shared_dataset() -> None:
    SHARED_DIR.mkdir(parents=True, exist_ok=True)
    if TARGET_DATASET.is_symlink():
        TARGET_DATASET.unlink()
    if TARGET_DATASET.is_dir():
        return
    shutil.copytree(SOURCE_DATASET, TARGET_DATASET)
    print(f"скопирован датасет в {TARGET_DATASET}")


def _frames_payload() -> list[dict[str, str]]:
    files = sorted(
        path
        for path in TARGET_DATASET.iterdir()
        if path.is_file() and path.name != ".DS_Store"
    )
    fallback_times = _spread_times(len(files))
    frames: list[dict[str, str]] = []
    for path, fallback in zip(files, fallback_times):
        captured_date, captured_time = _parse_stamp(path.name, fallback)
        frames.append(
            {
                "path": str(Path("test-dataset") / path.name),
                "captured_date": captured_date.isoformat(),
                "captured_time": captured_time.isoformat(),
            }
        )
    return frames


def _parse_stamp(name: str, fallback: time) -> tuple[date, time]:
    match = NAME_RE.search(name)
    if match is None:
        return date(2025, 1, 1), fallback
    captured_date = date.fromisoformat(match.group("day"))
    captured_time = time(
        int(match.group("hour")),
        int(match.group("minute")),
        int(match.group("second")),
    )
    return captured_date, captured_time


def _spread_times(count: int) -> list[time]:
    start = datetime(2025, 1, 1, 8, 0)
    end = datetime(2025, 1, 1, 18, 0)
    if count <= 1:
        return [start.time()]
    step = (end - start) / (count - 1)
    return [(start + step * index).time() for index in range(count)]


def _poll(client: httpx.Client, job_id: str) -> dict | None:
    deadline = datetime.now() + timedelta(seconds=TIMEOUT_SECONDS)
    while datetime.now() < deadline:
        response = client.get(f"{BASE_URL}/jobs/{job_id}")
        if response.status_code >= 400:
            print(response.text, file=sys.stderr)
            return None
        data = response.json()
        status = data.get("status")
        stages = data.get("completed_stages") or []
        print(f"статус {status}, стадии {stages}")
        if status == "COMPLETED":
            result = data.get("result")
            if not isinstance(result, dict):
                fetched = client.get(f"{BASE_URL}/jobs/{job_id}/result")
                if fetched.status_code >= 400:
                    print(fetched.text, file=sys.stderr)
                    return None
                result = fetched.json()
            return result
        if status == "FAILED":
            print(data.get("error") or "джоба упала", file=sys.stderr)
            return None
        time_module.sleep(POLL_SECONDS)
    print("таймаут ожидания джобы", file=sys.stderr)
    return None


def _validate(result: dict) -> bool:
    frames = result.get("frames")
    if not isinstance(frames, list):
        print("в результате нет frames", file=sys.stderr)
        return False
    for frame in frames:
        if "image_path" not in frame or "objects" not in frame:
            print(f"кадр без image_path/objects: {frame}", file=sys.stderr)
            return False
        for obj in frame["objects"]:
            if "class" not in obj or "bbox" not in obj:
                print(f"объект без class/bbox: {obj}", file=sys.stderr)
                return False
            if "detection_confidence" not in obj:
                print(f"нет detection_confidence: {obj}", file=sys.stderr)
                return False
            if "classification" not in obj:
                print(f"нет classification: {obj}", file=sys.stderr)
                return False
    print(f"ок: кадров {len(frames)}")
    return True


if __name__ == "__main__":
    raise SystemExit(main())
