from typing import Any, Literal

from pydantic import BaseModel

JobStatus = Literal["ACCEPTED", "PROCESSING", "COMPLETED", "FAILED"]


class PlanPayload(BaseModel):
    planId: str
    projectId: str
    path: str


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
