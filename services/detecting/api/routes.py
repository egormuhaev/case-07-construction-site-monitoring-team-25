from asyncio import QueueFull

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
from pydantic import ValidationError

from detecting.log import get_logger

from .queue import JobQueue
from .runner import resolve_data_path
from .schemas import DetectPayload, JobResponse, SubmitJobRequest
from .store import JobStore

logger = get_logger("api.routes")
router = APIRouter()


def error_response(status_code: int, message: str) -> JSONResponse:
    return JSONResponse(status_code=status_code, content={"error": message})


def _store(request: Request) -> JobStore:
    return request.app.state.store


def _queue(request: Request) -> JobQueue:
    return request.app.state.queue


def _job_response(store: JobStore, job_id: str) -> JobResponse | None:
    record = store.get_job(job_id)
    if record is None:
        return None
    status = record.get("status", "FAILED")
    result = store.get_result(job_id) if status == "COMPLETED" else None
    return JobResponse(
        jobId=job_id,
        status=status,
        result=result,
        error=record.get("error"),
        completed_stages=record.get("completed_stages") or [],
    )


@router.get("/health")
def health(request: Request) -> JSONResponse:
    try:
        _store(request).ping()
    except Exception as error:
        return error_response(503, f"redis: {error}")
    return JSONResponse(status_code=200, content={"status": "ok"})


@router.post("/jobs")
def submit_job(body: SubmitJobRequest, request: Request) -> JSONResponse:
    store = _store(request)
    queue = _queue(request)
    try:
        payload = DetectPayload.model_validate(body.payload)
        for frame in payload.frames:
            resolve_data_path(request.app.state.settings.data_dir, frame.path)
    except ValidationError as error:
        return error_response(400, str(error))
    except (FileNotFoundError, ValueError) as error:
        return error_response(400, str(error))

    existing_id = store.get_existing_job_id(body.requestId)
    if existing_id:
        response = _job_response(store, existing_id)
        if response is None:
            return error_response(500, "идемпотентная джоба не найдена")
        logger.info("повторный requestId %s -> %s", body.requestId, existing_id)
        return JSONResponse(status_code=200, content=response.model_dump())

    if queue.is_full():
        return error_response(429, "очередь детекции переполнена")

    job_id, created = store.create_job(
        body.requestId,
        body.workflowId,
        body.step,
        payload.model_dump(mode="json"),
    )
    if not created:
        response = _job_response(store, job_id)
        if response is None:
            return error_response(500, "идемпотентная джоба не найдена")
        return JSONResponse(status_code=200, content=response.model_dump())

    try:
        queue.submit(job_id)
    except QueueFull:
        return error_response(429, "очередь детекции переполнена")

    response = _job_response(store, job_id)
    assert response is not None
    return JSONResponse(status_code=200, content=response.model_dump())


@router.get("/jobs/{job_id}")
def get_job(job_id: str, request: Request) -> JSONResponse:
    response = _job_response(_store(request), job_id)
    if response is None:
        return error_response(404, f"джоба {job_id} не найдена")
    return JSONResponse(status_code=200, content=response.model_dump())


@router.get("/jobs/{job_id}/result")
def get_job_result(job_id: str, request: Request) -> JSONResponse:
    store = _store(request)
    if store.get_job(job_id) is None:
        return error_response(404, f"джоба {job_id} не найдена")
    result = store.get_result(job_id)
    if result is None:
        return error_response(404, f"результат джобы {job_id} ещё не готов")
    return JSONResponse(status_code=200, content=result)
