from datetime import date, time
from typing import Any, Literal

from pydantic import BaseModel, Field

JobStatus = Literal["ACCEPTED", "PROCESSING", "COMPLETED", "FAILED"]


class FrameInput(BaseModel):
    path: str
    captured_date: date
    captured_time: time


class DetectPayload(BaseModel):
    frames: list[FrameInput] = Field(min_length=1)


class SubmitJobRequest(BaseModel):
    requestId: str
    workflowId: str
    step: str
    payload: dict[str, Any]


class JobResponse(BaseModel):
    jobId: str
    status: JobStatus
    result: dict[str, Any] | None = None
    error: str | None = None
    completed_stages: list[str] | None = None
