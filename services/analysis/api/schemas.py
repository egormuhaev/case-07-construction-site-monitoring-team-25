from typing import Any, Literal

from pydantic import BaseModel, Field, model_validator

JobStatus = Literal["ACCEPTED", "PROCESSING", "COMPLETED", "FAILED"]
AnalysisMode = Literal["DAY", "PERIOD"]


class DayPayload(BaseModel):
    mode: Literal["DAY"] = "DAY"
    analysisRunId: str
    projectId: str
    dayId: str
    day: str
    timezone: str = "Europe/Moscow"
    planId: str | None = None
    detectionRunId: str


class PeriodPayload(BaseModel):
    mode: Literal["PERIOD"] = "PERIOD"
    analysisRunId: str
    projectId: str
    dateFrom: str
    dateTo: str
    timezone: str = "Europe/Moscow"

    @model_validator(mode="after")
    def validate_range(self) -> "PeriodPayload":
        if self.dateFrom > self.dateTo:
            raise ValueError("dateFrom не может быть больше dateTo")
        return self


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
    completed_stages: list[str] | None = Field(default=None)


def parse_payload(raw: dict[str, Any]) -> DayPayload | PeriodPayload:
    mode = str(raw.get("mode") or "").upper()
    if mode == "DAY":
        return DayPayload.model_validate(raw)
    if mode == "PERIOD":
        return PeriodPayload.model_validate(raw)
    raise ValueError("payload.mode должен быть DAY или PERIOD")
