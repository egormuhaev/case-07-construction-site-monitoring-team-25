from __future__ import annotations

import statistics
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import date, timedelta, timezone
from typing import Any, Callable, Iterable
from zoneinfo import ZoneInfo

import psycopg
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

from analysis.api.schemas import DayPayload, PeriodPayload
from analysis.settings import Settings

UNKNOWN_CODE = "UNKNOWN_EQUIPMENT"
PERSON_CODE = "PERSON"
StageCallback = Callable[[str, dict[str, Any]], None]


@dataclass
class PresenceStats:
    frame_count: int = 0
    object_count: int = 0
    cameras: set[str] = field(default_factory=set)
    hours: set[int] = field(default_factory=set)
    confidences: list[float] = field(default_factory=list)
    needs_refinement: int = 0

    @property
    def present(self) -> bool:
        return self.object_count > 0

    @property
    def camera_count(self) -> int:
        return len(self.cameras)

    @property
    def hour_span(self) -> int:
        return len(self.hours)

    @property
    def max_confidence(self) -> float | None:
        return max(self.confidences) if self.confidences else None

    @property
    def median_confidence(self) -> float | None:
        return float(statistics.median(self.confidences)) if self.confidences else None

    @property
    def needs_refinement_ratio(self) -> float | None:
        if self.object_count <= 0:
            return None
        return self.needs_refinement / self.object_count


@dataclass
class ExpectedWork:
    work_id: str
    name: str
    wbs: str | None
    source: str
    rerank_score: float | None
    volume: float | None = None
    unit: str | None = None
    classifier_name: str | None = None
    duration_days: float | None = None
    stage_name: str | None = None
    stage_wbs: str | None = None
    stage_unique_id: int | None = None

    @property
    def expected_daily(self) -> float | None:
        if self.volume is None or self.duration_days is None:
            return None
        if self.duration_days <= 0:
            return None
        return float(self.volume) / float(self.duration_days)


def expected_work_to_dict(work: ExpectedWork) -> dict[str, Any]:
    return {
        "workId": work.work_id,
        "name": work.name,
        "wbs": work.wbs,
        "source": work.source,
        "rerankScore": work.rerank_score,
        "volume": work.volume,
        "unit": work.unit,
        "classifierName": work.classifier_name,
        "durationDays": work.duration_days,
        "expectedDaily": work.expected_daily,
        "stageName": work.stage_name,
        "stageWbs": work.stage_wbs,
        "stageUniqueId": work.stage_unique_id,
    }


def load_work_stages(conn: Any, plan_id: str) -> dict[int, dict[str, Any]]:
    """unique_id leaf → nearest summary ancestor (name, wbs, unique_id)."""
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT unique_id, parent_unique_id, name, wbs, is_summary
            FROM work
            WHERE plan_id = %s
            """,
            (plan_id,),
        )
        rows = cur.fetchall()

    by_uid: dict[int, dict[str, Any]] = {}
    for row in rows:
        uid = int(row["unique_id"])
        parent = row["parent_unique_id"]
        by_uid[uid] = {
            "parent_unique_id": int(parent) if parent is not None else None,
            "name": str(row["name"]),
            "wbs": row["wbs"],
            "is_summary": bool(row["is_summary"]),
        }

    cache: dict[int, dict[str, Any] | None] = {}

    def resolve(uid: int) -> dict[str, Any] | None:
        if uid in cache:
            return cache[uid]
        node = by_uid.get(uid)
        if not node:
            cache[uid] = None
            return None
        parent_uid = node["parent_unique_id"]
        visited: set[int] = set()
        while parent_uid is not None and parent_uid not in visited:
            visited.add(parent_uid)
            parent = by_uid.get(parent_uid)
            if not parent:
                break
            if parent["is_summary"]:
                stage = {
                    "stage_name": parent["name"],
                    "stage_wbs": parent["wbs"],
                    "stage_unique_id": parent_uid,
                }
                cache[uid] = stage
                return stage
            parent_uid = parent["parent_unique_id"]
        cache[uid] = None
        return None

    result: dict[int, dict[str, Any]] = {}
    for uid in by_uid:
        stage = resolve(uid)
        if stage:
            result[uid] = stage
    return result


def collect_active_stages(works: Iterable[ExpectedWork]) -> list[dict[str, Any]]:
    stages: dict[int, dict[str, Any]] = {}
    for work in works:
        if work.stage_unique_id is None:
            continue
        stages.setdefault(
            work.stage_unique_id,
            {
                "stageUniqueId": work.stage_unique_id,
                "stageName": work.stage_name,
                "stageWbs": work.stage_wbs,
            },
        )
    return sorted(
        stages.values(),
        key=lambda row: (str(row.get("stageWbs") or ""), str(row.get("stageName") or "")),
    )


@dataclass
class ClassExpectation:
    class_code: str
    works: list[ExpectedWork] = field(default_factory=list)

    @property
    def unique_works(self) -> list[ExpectedWork]:
        seen: dict[str, ExpectedWork] = {}
        for work in self.works:
            seen.setdefault(work.work_id, work)
        return list(seen.values())

    @property
    def expected_confidence(self) -> float:
        works = self.unique_works
        if not works:
            return 0.0
        scores: list[float] = []
        for work in works:
            if work.source == "MANUAL":
                scores.append(1.0)
            elif work.rerank_score is not None:
                scores.append(max(0.0, min(1.0, float(work.rerank_score))))
            else:
                scores.append(0.5)
        return min(scores)

    @property
    def expected_daily_volume(self) -> float | None:
        total = 0.0
        has = False
        unit: str | None = None
        for work in self.works:
            daily = work.expected_daily
            if daily is None:
                continue
            has = True
            total += daily
            if unit is None and work.unit:
                unit = work.unit
        if not has:
            return None
        return total

    @property
    def expected_daily_unit(self) -> str | None:
        for work in self.works:
            if work.expected_daily is not None and work.unit:
                return work.unit
        return None


def load_class_titles(conn: Any) -> dict[str, str]:
    with conn.cursor() as cur:
        cur.execute("SELECT code, title FROM detection_class")
        return {str(row["code"]): str(row["title"]) for row in cur.fetchall()}


def class_label(titles: dict[str, str], code: str) -> str:
    title = titles.get(code)
    return title if title else code


def human_equipment_phrase(label: str) -> str:
    lower = label.lower()
    if "персонал" in lower or label == PERSON_CODE:
        return "персонал"
    return label


def parse_shift_time(value: Any) -> tuple[int, int] | None:
    if value is None:
        return None
    raw = str(value).strip()
    if not raw:
        return None
    parts = raw.split(":")
    if len(parts) < 2:
        return None
    try:
        return int(parts[0]), int(parts[1])
    except ValueError:
        return None


def load_project_shift(conn: Any, project_id: str) -> dict[str, Any]:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT shift_start, shift_end, timezone
            FROM project
            WHERE id = %s
            """,
            (project_id,),
        )
        row = cur.fetchone() or {}
    start = parse_shift_time(row.get("shift_start"))
    end = parse_shift_time(row.get("shift_end"))
    configured = start is not None and end is not None
    return {
        "configured": configured,
        "start": start,
        "end": end,
        "shiftStart": f"{start[0]:02d}:{start[1]:02d}" if start else None,
        "shiftEnd": f"{end[0]:02d}:{end[1]:02d}" if end else None,
    }


def in_shift(local_dt: Any, shift: dict[str, Any]) -> bool:
    if not shift.get("configured"):
        return True
    start = shift["start"]
    end = shift["end"]
    minutes = local_dt.hour * 60 + local_dt.minute
    start_m = start[0] * 60 + start[1]
    end_m = end[0] * 60 + end[1]
    if start_m <= end_m:
        return start_m <= minutes < end_m
    return minutes >= start_m or minutes < end_m


def to_local(value: Any, tz: ZoneInfo) -> Any:
    if value.tzinfo:
        return value.astimezone(tz)
    return value.replace(tzinfo=timezone.utc).astimezone(tz)


def connect(settings: Settings) -> Any:
    return psycopg.connect(
        host=settings.postgres_host,
        port=settings.postgres_port,
        dbname=settings.postgres_db,
        user=settings.postgres_user,
        password=settings.postgres_password,
        row_factory=dict_row,
    )


def run_analysis(
    payload: DayPayload | PeriodPayload,
    settings: Settings,
    on_stage: StageCallback | None = None,
) -> dict[str, Any]:
    def emit(stage: str, snapshot: dict[str, Any]) -> None:
        if on_stage is not None:
            on_stage(stage, snapshot)

    with connect(settings) as conn:
        if isinstance(payload, DayPayload):
            result = run_day_analysis(conn, payload, settings, emit)
        else:
            result = run_period_analysis(conn, payload, settings, emit)
        conn.commit()
        return result


def run_day_analysis(
    conn: Any,
    payload: DayPayload,
    settings: Settings,
    emit: StageCallback,
) -> dict[str, Any]:
    day = date.fromisoformat(payload.day)
    tz = ZoneInfo(payload.timezone)
    shift = load_project_shift(conn, payload.projectId)

    observability = compute_observability(
        conn, payload.dayId, payload.detectionRunId, settings, tz, shift
    )
    emit("observability", observability)

    presence = compute_presence(conn, payload.detectionRunId, tz, shift)
    emit(
        "presence",
        {
            "classes": {
                code: {
                    "frame_count": stats.frame_count,
                    "object_count": stats.object_count,
                    "camera_count": stats.camera_count,
                    "hour_span": stats.hour_span,
                    "max_confidence": stats.max_confidence,
                    "median_confidence": stats.median_confidence,
                    "needs_refinement_ratio": stats.needs_refinement_ratio,
                }
                for code, stats in presence.items()
            }
        },
    )

    expectation = compute_expectation(conn, payload.planId, day)
    emit(
        "expectation",
        {
            "has_plan": expectation["has_plan"],
            "active_work_count": expectation["active_work_count"],
            "works_without_dates": expectation["works_without_dates"],
            "works_without_match": expectation["works_without_match"],
            "works_without_machine": expectation["works_without_machine"],
            "works_without_detection_link": expectation["works_without_detection_link"],
            "expected_classes": sorted(expectation["by_class"].keys()),
        },
    )

    classes = reconcile_day(
        presence=presence,
        expectation=expectation,
        observability=observability["level"],
    )
    emit("reconcile", {"rows": len(classes), "verdicts": count_by(classes, "verdict")})

    findings = build_day_findings(
        conn=conn,
        payload=payload,
        day=day,
        observability=observability,
        expectation=expectation,
        classes=classes,
        settings=settings,
        class_titles=load_class_titles(conn),
    )
    emit("findings", {"count": len(findings), "types": count_by(findings, "type")})

    completeness = build_completeness(conn, payload.planId, day, shift)
    summary = {
        "mode": "DAY",
        "day": payload.day,
        "observability": observability["level"],
        "imageCount": observability["image_count"],
        "cameraCount": observability["camera_count"],
        "hourSpan": observability["hour_span"],
        "shiftConfigured": shift["configured"],
        "shiftStart": shift["shiftStart"],
        "shiftEnd": shift["shiftEnd"],
        "hasPlan": expectation["has_plan"],
        "activeWorkCount": expectation["active_work_count"],
        "worksWithoutDates": expectation["works_without_dates"],
        "worksWithoutMatch": expectation["works_without_match"],
        "worksWithoutMachine": expectation["works_without_machine"],
        "worksWithoutDetectionLink": expectation["works_without_detection_link"],
        "expectedClassCount": sum(1 for row in classes if row["expected"]),
        "presentClassCount": sum(1 for row in classes if row["present"]),
        "unknownEquipmentCount": presence.get(UNKNOWN_CODE, PresenceStats()).object_count,
        "verdicts": count_by(classes, "verdict"),
        "findingCount": len(findings),
        "outsideProjectRange": is_outside_project_range(conn, payload.projectId, day),
        "completeness": completeness,
        "activeStages": expectation.get("active_stages") or [],
        "unmappedWorks": expectation.get("unmapped_works") or [],
    }

    persist_day_result(
        conn=conn,
        run_id=payload.analysisRunId,
        project_id=payload.projectId,
        day=day,
        observability=observability["level"],
        summary=summary,
        classes=classes,
        findings=findings,
    )
    emit("persist", {"analysisRunId": payload.analysisRunId, "classRows": len(classes)})

    return {
        "analysisRunId": payload.analysisRunId,
        "mode": "DAY",
        "day": payload.day,
        "observability": observability["level"],
        "summary": summary,
        "findingCount": len(findings),
    }


def run_period_analysis(
    conn: Any,
    payload: PeriodPayload,
    settings: Settings,
    emit: StageCallback,
) -> dict[str, Any]:
    date_from = date.fromisoformat(payload.dateFrom)
    date_to = date.fromisoformat(payload.dateTo)
    if (date_to - date_from).days > 365:
        raise ValueError("период не может быть длиннее 366 дней")

    day_runs = load_completed_day_runs(conn, payload.projectId, date_from, date_to)
    emit("observability", {"completedDayRuns": len(day_runs)})

    analyzed_days = {row["day"] for row in day_runs}
    calendar_days = list(iter_days(date_from, date_to))
    days_not_analyzed = [d.isoformat() for d in calendar_days if d not in analyzed_days]
    blind_days = [row["day"].isoformat() for row in day_runs if row["observability"] == "BLIND"]
    observable_runs = [row for row in day_runs if row["observability"] != "BLIND"]

    presence_summary: dict[str, dict[str, Any]] = {}
    class_rows = load_day_class_rows(
        conn, [row["id"] for row in day_runs if row["observability"] != "BLIND"]
    )
    emit("presence", {"classRows": len(class_rows)})

    by_class: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in class_rows:
        by_class[row["class_code"]].append(row)

    findings: list[dict[str, Any]] = []
    plan_ids = sorted({str(row["plan_id"]) for row in day_runs if row.get("plan_id")})
    titles = load_class_titles(conn)

    for class_code, rows in sorted(by_class.items()):
        if class_code in {UNKNOWN_CODE}:
            continue
        expected_days = [r for r in rows if r["expected"]]
        gap_days = [r for r in expected_days if r["verdict"] == "GAP"]
        confirmed_days = [r for r in expected_days if r["verdict"] == "CONFIRMED"]
        unexpected_days = [r for r in rows if r["verdict"] == "UNEXPECTED"]
        presence_summary[class_code] = {
            "expectedDays": len(expected_days),
            "gapDays": len(gap_days),
            "confirmedDays": len(confirmed_days),
            "unexpectedDays": len(unexpected_days),
            "classTitle": class_label(titles, class_code),
        }
        if len(gap_days) >= settings.gap_days_threshold and (
            class_code != PERSON_CODE or settings.person_gap_enabled
        ):
            label = human_equipment_phrase(class_label(titles, class_code))
            daily_vol, daily_unit = extract_expected_daily(expected_days)
            details: dict[str, Any] = {
                "gapDays": [r["day"].isoformat() for r in gap_days],
                "expectedDays": len(expected_days),
                "confirmedDays": len(confirmed_days),
                "classTitle": class_label(titles, class_code),
            }
            if daily_vol is not None:
                planned = daily_vol * len(expected_days)
                unit_part = f" {daily_unit}" if daily_unit else ""
                details["expectedDailyVolume"] = daily_vol
                details["expectedDailyUnit"] = daily_unit
                details["plannedVolumeWindow"] = planned
                findings.append(
                    {
                        "class_code": class_code,
                        "day": None,
                        "date_from": date_from,
                        "date_to": date_to,
                        "type": "CUMULATIVE_LAG",
                        "severity": "HIGH",
                        "deviation": len(gap_days) / max(len(expected_days), 1),
                        "confidence": 0.7,
                        "title": (
                            f"{label}: ждали {len(expected_days)} дн., не нашли {len(gap_days)}; "
                            f"плановый объём за окно ~ {format_volume(planned)}{unit_part}"
                        ),
                        "details": details,
                    }
                )
            else:
                findings.append(
                    {
                        "class_code": class_code,
                        "day": None,
                        "date_from": date_from,
                        "date_to": date_to,
                        "type": "PERSISTENT_GAP",
                        "severity": "HIGH" if len(gap_days) >= settings.gap_days_threshold + 1 else "MEDIUM",
                        "deviation": len(gap_days) / max(len(expected_days), 1),
                        "confidence": 0.7,
                        "title": (
                            f"{label}: за период их ждали {len(expected_days)} дн., "
                            f"а не нашли на кадрах {len(gap_days)} дн."
                        ),
                        "details": details,
                    }
                )

    if not day_runs:
        findings.append(
            {
                "class_code": None,
                "day": None,
                "date_from": date_from,
                "date_to": date_to,
                "type": "INSUFFICIENT_DATA",
                "severity": "LOW",
                "deviation": 0.0,
                "confidence": 1.0,
                "title": "За выбранный период ещё нет готовых дневных отчётов",
                "details": {"daysNotAnalyzed": days_not_analyzed},
            }
        )
    elif days_not_analyzed:
        findings.append(
            {
                "class_code": None,
                "day": None,
                "date_from": date_from,
                "date_to": date_to,
                "type": "INSUFFICIENT_DATA",
                "severity": "LOW",
                "deviation": len(days_not_analyzed) / max(len(calendar_days), 1),
                "confidence": 1.0,
                "title": "Часть дней периода ещё не разобрана — сводка неполная",
                "details": {"daysNotAnalyzed": days_not_analyzed},
            }
        )

    emit("expectation", {"planIds": plan_ids})
    emit("reconcile", {"classes": len(presence_summary)})
    emit("findings", {"count": len(findings), "types": count_by(findings, "type")})

    shift = load_project_shift(conn, payload.projectId)
    completeness: dict[str, Any]
    if plan_ids:
        completeness = build_completeness(conn, plan_ids[0], None, shift)
        if len(plan_ids) > 1:
            completeness["planIds"] = plan_ids
    else:
        completeness = build_completeness(conn, None, None, shift)

    summary = {
        "mode": "PERIOD",
        "dateFrom": payload.dateFrom,
        "dateTo": payload.dateTo,
        "dayCount": len(calendar_days),
        "analyzedDayCount": len(day_runs),
        "observableDayCount": len(observable_runs),
        "blindDayCount": len(blind_days),
        "daysNotAnalyzed": days_not_analyzed,
        "blindDays": blind_days,
        "planIds": plan_ids,
        "classes": presence_summary,
        "findingCount": len(findings),
        "emptyPeriod": len(day_runs) == 0,
        "shiftConfigured": shift["configured"],
        "shiftStart": shift["shiftStart"],
        "shiftEnd": shift["shiftEnd"],
        "completeness": completeness,
    }

    persist_period_result(
        conn=conn,
        run_id=payload.analysisRunId,
        project_id=payload.projectId,
        summary=summary,
        findings=findings,
    )
    emit("persist", {"analysisRunId": payload.analysisRunId})

    return {
        "analysisRunId": payload.analysisRunId,
        "mode": "PERIOD",
        "dateFrom": payload.dateFrom,
        "dateTo": payload.dateTo,
        "summary": summary,
        "findingCount": len(findings),
    }


def compute_observability(
    conn: Any,
    day_id: str,
    detection_run_id: str,
    settings: Settings,
    tz: ZoneInfo,
    shift: dict[str, Any] | None = None,
) -> dict[str, Any]:
    shift = shift or {"configured": False}
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT camera_external_id, captured_at
            FROM project_image
            WHERE day_id = %s
            """,
            (day_id,),
        )
        images = cur.fetchall()
        cur.execute(
            """
            SELECT status FROM detection_run WHERE id = %s
            """,
            (detection_run_id,),
        )
        run = cur.fetchone()

    cameras: set[str] = set()
    hours: set[int] = set()
    image_count = 0
    for row in images:
        captured = row["captured_at"]
        if captured is None:
            continue
        local = to_local(captured, tz)
        if not in_shift(local, shift):
            continue
        image_count += 1
        if row["camera_external_id"]:
            cameras.add(str(row["camera_external_id"]))
        hours.add(local.hour)

    camera_count = len(cameras)
    hour_span = len(hours)
    run_ok = bool(run and run["status"] == "COMPLETED")

    if image_count < settings.min_frames_partial or not run_ok:
        level = "BLIND"
    elif (
        image_count >= settings.min_frames_good
        and (
            camera_count >= settings.min_cameras_good
            or camera_count == 0
            and image_count >= settings.min_frames_good
        )
        and hour_span >= settings.min_hour_span_good
    ):
        level = "GOOD"
    else:
        level = "PARTIAL"

    if camera_count == 1 and image_count >= settings.min_frames_good and hour_span >= settings.min_hour_span_good:
        level = "PARTIAL"

    return {
        "level": level,
        "image_count": image_count,
        "camera_count": camera_count,
        "hour_span": hour_span,
        "detection_run_status": run["status"] if run else None,
        "shift_configured": bool(shift.get("configured")),
    }


def compute_presence(
    conn: Any,
    detection_run_id: str,
    tz: ZoneInfo,
    shift: dict[str, Any] | None = None,
) -> dict[str, PresenceStats]:
    shift = shift or {"configured": False}
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT o.class_code,
                   o.detection_confidence,
                   o.classification_confidence,
                   o.needs_refinement,
                   f.camera_id,
                   f.captured_at,
                   f.id AS frame_id
            FROM detection_object o
            JOIN detection_frame f ON f.id = o.frame_id
            WHERE f.run_id = %s
            """,
            (detection_run_id,),
        )
        rows = cur.fetchall()

    by_class: dict[str, PresenceStats] = defaultdict(PresenceStats)
    frames_by_class: dict[str, set[str]] = defaultdict(set)
    for row in rows:
        captured = row["captured_at"]
        if captured is not None:
            local = to_local(captured, tz)
            if not in_shift(local, shift):
                continue
        elif shift.get("configured"):
            continue
        code = str(row["class_code"])
        stats = by_class[code]
        stats.object_count += 1
        if row["needs_refinement"]:
            stats.needs_refinement += 1
        conf = row["classification_confidence"]
        if conf is None:
            conf = row["detection_confidence"]
        if conf is not None:
            stats.confidences.append(float(conf))
        if row["camera_id"]:
            stats.cameras.add(str(row["camera_id"]))
        frames_by_class[code].add(str(row["frame_id"]))
        if captured is not None:
            local = to_local(captured, tz)
            stats.hours.add(local.hour)

    for code, frames in frames_by_class.items():
        by_class[code].frame_count = len(frames)
    return dict(by_class)


def compute_expectation(
    conn: Any,
    plan_id: str | None,
    day: date,
) -> dict[str, Any]:
    if not plan_id:
        return {
            "has_plan": False,
            "active_work_count": 0,
            "works_without_dates": 0,
            "works_without_match": 0,
            "works_without_machine": 0,
            "works_without_detection_link": 0,
            "by_class": {},
            "active_stages": [],
            "unmapped_works": [],
        }

    stages_by_uid = load_work_stages(conn, plan_id)

    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT COUNT(*) AS cnt
            FROM work
            WHERE plan_id = %s
              AND NOT is_summary
              AND NOT is_milestone
              AND start_at IS NOT NULL
              AND finish_at IS NOT NULL
              AND start_at::date <= %s
              AND finish_at::date >= %s
            """,
            (plan_id, day, day),
        )
        active_work_count = int((cur.fetchone() or {"cnt": 0})["cnt"])

        cur.execute(
            """
            SELECT COUNT(*) AS cnt
            FROM work
            WHERE plan_id = %s
              AND NOT is_summary
              AND NOT is_milestone
              AND (start_at IS NULL OR finish_at IS NULL)
            """,
            (plan_id,),
        )
        works_without_dates = int((cur.fetchone() or {"cnt": 0})["cnt"])

        cur.execute(
            """
            SELECT COUNT(*) AS cnt
            FROM work w
            WHERE w.plan_id = %s
              AND NOT w.is_summary
              AND NOT w.is_milestone
              AND w.start_at IS NOT NULL
              AND w.finish_at IS NOT NULL
              AND w.start_at::date <= %s
              AND w.finish_at::date >= %s
              AND NOT EXISTS (
                  SELECT 1 FROM work_classifier_match m WHERE m.work_id = w.id
              )
            """,
            (plan_id, day, day),
        )
        works_without_match = int((cur.fetchone() or {"cnt": 0})["cnt"])

        cur.execute(
            """
            SELECT COUNT(*) AS cnt
            FROM work w
            JOIN work_classifier_match m ON m.work_id = w.id
            JOIN work_classifier c ON c.id = m.classifier_id
            WHERE w.plan_id = %s
              AND NOT w.is_summary
              AND NOT w.is_milestone
              AND w.start_at::date <= %s
              AND w.finish_at::date >= %s
              AND c.machine_id IS NULL
            """,
            (plan_id, day, day),
        )
        works_without_machine = int((cur.fetchone() or {"cnt": 0})["cnt"])

        cur.execute(
            """
            SELECT COUNT(*) AS cnt
            FROM work w
            JOIN work_classifier_match m ON m.work_id = w.id
            JOIN work_classifier c ON c.id = m.classifier_id
            WHERE w.plan_id = %s
              AND NOT w.is_summary
              AND NOT w.is_milestone
              AND w.start_at::date <= %s
              AND w.finish_at::date >= %s
              AND c.machine_id IS NOT NULL
              AND NOT EXISTS (
                  SELECT 1
                  FROM detection_class_machine dcm
                  WHERE dcm.machine_id = c.machine_id
              )
            """,
            (plan_id, day, day),
        )
        works_without_detection_link = int((cur.fetchone() or {"cnt": 0})["cnt"])

        cur.execute(
            """
            SELECT dcm.class_code,
                   w.id AS work_id,
                   w.unique_id,
                   w.name,
                   w.wbs,
                   m.source,
                   m.rerank_score,
                   m.volume,
                   m.duration_days,
                   c.unit,
                   c.work_name AS classifier_name
            FROM work w
            JOIN work_classifier_match m ON m.work_id = w.id
            JOIN work_classifier c ON c.id = m.classifier_id
            JOIN detection_class_machine dcm ON dcm.machine_id = c.machine_id
            WHERE w.plan_id = %s
              AND NOT w.is_summary
              AND NOT w.is_milestone
              AND w.start_at IS NOT NULL
              AND w.finish_at IS NOT NULL
              AND w.start_at::date <= %s
              AND w.finish_at::date >= %s
              AND dcm.class_code <> %s
            """,
            (plan_id, day, day, UNKNOWN_CODE),
        )
        rows = cur.fetchall()

        # Active leaf works that did not produce a usable detection class.
        cur.execute(
            """
            SELECT w.id AS work_id,
                   w.unique_id,
                   w.name,
                   w.wbs,
                   CASE
                     WHEN NOT EXISTS (
                         SELECT 1 FROM work_classifier_match m WHERE m.work_id = w.id
                     ) THEN 'NO_MATCH'
                     WHEN EXISTS (
                         SELECT 1
                         FROM work_classifier_match m
                         JOIN work_classifier c ON c.id = m.classifier_id
                         WHERE m.work_id = w.id AND c.machine_id IS NULL
                     ) AND NOT EXISTS (
                         SELECT 1
                         FROM work_classifier_match m
                         JOIN work_classifier c ON c.id = m.classifier_id
                         WHERE m.work_id = w.id AND c.machine_id IS NOT NULL
                     ) THEN 'NO_MACHINE'
                     WHEN EXISTS (
                         SELECT 1
                         FROM work_classifier_match m
                         JOIN work_classifier c ON c.id = m.classifier_id
                         JOIN detection_class_machine dcm ON dcm.machine_id = c.machine_id
                         WHERE m.work_id = w.id AND dcm.class_code = %s
                     ) AND NOT EXISTS (
                         SELECT 1
                         FROM work_classifier_match m
                         JOIN work_classifier c ON c.id = m.classifier_id
                         JOIN detection_class_machine dcm ON dcm.machine_id = c.machine_id
                         WHERE m.work_id = w.id AND dcm.class_code <> %s
                     ) THEN 'UNKNOWN_CLASS'
                     WHEN EXISTS (
                         SELECT 1
                         FROM work_classifier_match m
                         JOIN work_classifier c ON c.id = m.classifier_id
                         WHERE m.work_id = w.id AND c.machine_id IS NOT NULL
                     ) AND NOT EXISTS (
                         SELECT 1
                         FROM work_classifier_match m
                         JOIN work_classifier c ON c.id = m.classifier_id
                         JOIN detection_class_machine dcm ON dcm.machine_id = c.machine_id
                         WHERE m.work_id = w.id
                     ) THEN 'NO_DETECTION_LINK'
                     ELSE NULL
                   END AS reason
            FROM work w
            WHERE w.plan_id = %s
              AND NOT w.is_summary
              AND NOT w.is_milestone
              AND w.start_at IS NOT NULL
              AND w.finish_at IS NOT NULL
              AND w.start_at::date <= %s
              AND w.finish_at::date >= %s
              AND NOT EXISTS (
                  SELECT 1
                  FROM work_classifier_match m
                  JOIN work_classifier c ON c.id = m.classifier_id
                  JOIN detection_class_machine dcm ON dcm.machine_id = c.machine_id
                  WHERE m.work_id = w.id
                    AND dcm.class_code <> %s
              )
            ORDER BY w.wbs NULLS LAST, w.name
            """,
            (UNKNOWN_CODE, UNKNOWN_CODE, plan_id, day, day, UNKNOWN_CODE),
        )
        unmapped_rows = cur.fetchall()

    by_class: dict[str, ClassExpectation] = {}
    mapped_works: list[ExpectedWork] = []
    for row in rows:
        code = str(row["class_code"])
        bucket = by_class.setdefault(code, ClassExpectation(class_code=code))
        stage = stages_by_uid.get(int(row["unique_id"])) or {}
        work = ExpectedWork(
            work_id=str(row["work_id"]),
            name=str(row["name"]),
            wbs=row["wbs"],
            source=str(row["source"]),
            rerank_score=float(row["rerank_score"]) if row["rerank_score"] is not None else None,
            volume=float(row["volume"]) if row["volume"] is not None else None,
            unit=str(row["unit"]) if row["unit"] is not None else None,
            classifier_name=str(row["classifier_name"]) if row["classifier_name"] is not None else None,
            duration_days=float(row["duration_days"]) if row["duration_days"] is not None else None,
            stage_name=stage.get("stage_name"),
            stage_wbs=stage.get("stage_wbs"),
            stage_unique_id=stage.get("stage_unique_id"),
        )
        bucket.works.append(work)
        mapped_works.append(work)

    unmapped_works: list[dict[str, Any]] = []
    for row in unmapped_rows:
        reason = row["reason"]
        if not reason:
            continue
        stage = stages_by_uid.get(int(row["unique_id"])) or {}
        unmapped_works.append(
            {
                "workId": str(row["work_id"]),
                "name": str(row["name"]),
                "wbs": row["wbs"],
                "stageName": stage.get("stage_name"),
                "stageWbs": stage.get("stage_wbs"),
                "stageUniqueId": stage.get("stage_unique_id"),
                "reason": reason,
            }
        )

    # Stages from both mapped and unmapped active works.
    stage_seed: list[ExpectedWork] = list(mapped_works)
    for item in unmapped_works:
        if item.get("stageUniqueId") is None:
            continue
        stage_seed.append(
            ExpectedWork(
                work_id=item["workId"],
                name=item["name"],
                wbs=item.get("wbs"),
                source="AUTO",
                rerank_score=None,
                stage_name=item.get("stageName"),
                stage_wbs=item.get("stageWbs"),
                stage_unique_id=item.get("stageUniqueId"),
            )
        )

    return {
        "has_plan": True,
        "active_work_count": active_work_count,
        "works_without_dates": works_without_dates,
        "works_without_match": works_without_match,
        "works_without_machine": works_without_machine,
        "works_without_detection_link": works_without_detection_link,
        "by_class": by_class,
        "active_stages": collect_active_stages(stage_seed),
        "unmapped_works": unmapped_works,
    }


def reconcile_day(
    presence: dict[str, PresenceStats],
    expectation: dict[str, Any],
    observability: str,
) -> list[dict[str, Any]]:
    by_class: dict[str, ClassExpectation] = expectation["by_class"]
    codes = set(presence.keys()) | set(by_class.keys())
    codes.discard(UNKNOWN_CODE)

    # Always include known detection classes that were expected or present.
    rows: list[dict[str, Any]] = []
    for code in sorted(codes):
        stats = presence.get(code, PresenceStats())
        expected_info = by_class.get(code)
        expected = expected_info is not None
        present = stats.present
        expected_works = [
            expected_work_to_dict(work)
            for work in (expected_info.works if expected_info else [])
        ]
        expected_confidence = expected_info.expected_confidence if expected_info else None
        expected_work_count = (
            len(expected_info.unique_works) if expected_info else 0
        )
        expected_daily_volume = (
            expected_info.expected_daily_volume if expected_info else None
        )
        expected_daily_unit = (
            expected_info.expected_daily_unit if expected_info else None
        )

        if observability in {"PARTIAL", "BLIND"} and expected and not present:
            verdict = "INSUFFICIENT_DATA"
        elif expected and present:
            verdict = "CONFIRMED"
        elif expected and not present:
            verdict = "GAP"
        elif not expected and present:
            verdict = "UNEXPECTED" if expectation["has_plan"] else "NOT_EXPECTED"
        else:
            verdict = "NOT_EXPECTED"

        rows.append(
            {
                "class_code": code,
                "expected": expected,
                "expected_work_count": expected_work_count,
                "expected_confidence": expected_confidence,
                "expected_works": expected_works,
                "expected_daily_volume": expected_daily_volume,
                "expected_daily_unit": expected_daily_unit,
                "present": present,
                "frame_count": stats.frame_count,
                "object_count": stats.object_count,
                "camera_count": stats.camera_count,
                "hour_span": stats.hour_span,
                "max_confidence": stats.max_confidence,
                "median_confidence": stats.median_confidence,
                "needs_refinement_ratio": stats.needs_refinement_ratio,
                "verdict": verdict,
            }
        )
    return rows


def build_day_findings(
    conn: Any,
    payload: DayPayload,
    day: date,
    observability: dict[str, Any],
    expectation: dict[str, Any],
    classes: list[dict[str, Any]],
    settings: Settings,
    class_titles: dict[str, str] | None = None,
) -> list[dict[str, Any]]:
    findings: list[dict[str, Any]] = []
    level = observability["level"]
    titles = class_titles or {}

    if level == "BLIND":
        findings.append(
            {
                "class_code": None,
                "day": day,
                "date_from": None,
                "date_to": None,
                "type": "NO_OBSERVATION",
                "severity": "MEDIUM",
                "deviation": 1.0,
                "confidence": 1.0,
                "title": "За день почти нет кадров с площадки — оценить работы нельзя",
                "details": {
                    "imageCount": observability["image_count"],
                    "cameraCount": observability["camera_count"],
                    "detectionRunStatus": observability["detection_run_status"],
                },
            }
        )
        return findings

    if not expectation["has_plan"]:
        findings.append(
            {
                "class_code": None,
                "day": day,
                "date_from": None,
                "date_to": None,
                "type": "NO_EXPECTATION_SOURCE",
                "severity": "MEDIUM",
                "deviation": 0.0,
                "confidence": 1.0,
                "title": "Нет активного календарного плана — неясно, какая техника должна была работать",
                "details": {},
            }
        )

    if level == "PARTIAL":
        findings.append(
            {
                "class_code": None,
                "day": day,
                "date_from": None,
                "date_to": None,
                "type": "INSUFFICIENT_DATA",
                "severity": "LOW",
                "deviation": 0.0,
                "confidence": 0.6,
                "title": "Камеры покрыли день не полностью — выводы менее надёжны",
                "details": {
                    "imageCount": observability["image_count"],
                    "cameraCount": observability["camera_count"],
                    "hourSpan": observability["hour_span"],
                },
            }
        )

    for row in classes:
        code = row["class_code"]
        label = human_equipment_phrase(class_label(titles, code))
        detection_conf = row["median_confidence"] or row["max_confidence"] or 0.5
        match_conf = row["expected_confidence"] if row["expected_confidence"] is not None else 0.5
        confidence = min(1.0, 0.5 * detection_conf + 0.5 * match_conf)
        if row["needs_refinement_ratio"] and row["needs_refinement_ratio"] > 0.5:
            confidence *= 0.7

        if row["verdict"] == "GAP" and level == "GOOD":
            if code == PERSON_CODE and not settings.person_gap_enabled:
                continue
            daily_vol = row.get("expected_daily_volume")
            daily_unit = row.get("expected_daily_unit")
            gap_severity = "HIGH" if daily_vol is not None or confidence >= 0.7 else "MEDIUM"
            details = {
                "expectedWorks": row["expected_works"],
                "expectedWorkCount": row["expected_work_count"],
                "classTitle": class_label(titles, code),
            }
            if daily_vol is not None:
                details["expectedDailyVolume"] = daily_vol
                details["expectedDailyUnit"] = daily_unit
            findings.append(
                {
                    "class_code": code,
                    "day": day,
                    "date_from": None,
                    "date_to": None,
                    "type": "NO_ACTIVITY",
                    "severity": gap_severity,
                    "deviation": 1.0,
                    "confidence": confidence,
                    "title": f"По плану должны были работать: {label}. На кадрах их нет",
                    "details": details,
                }
            )
            if is_late_start(conn, payload.projectId, code, day, settings):
                findings.append(
                    {
                        "class_code": code,
                        "day": day,
                        "date_from": None,
                        "date_to": None,
                        "type": "LATE_START",
                        "severity": "HIGH",
                        "deviation": 1.0,
                        "confidence": confidence,
                        "title": f"{label}: работы по плану уже идут несколько дней, а техника на кадрах так и не появилась",
                        "details": {
                            "thresholdDays": settings.gap_days_threshold,
                            "expectedWorks": row["expected_works"],
                            "classTitle": class_label(titles, code),
                        },
                    }
                )
            if is_repeated_gap(conn, payload.projectId, code, day, settings):
                findings.append(
                    {
                        "class_code": code,
                        "day": day,
                        "date_from": None,
                        "date_to": None,
                        "type": "REPEATED_GAP",
                        "severity": "HIGH",
                        "deviation": 1.0,
                        "confidence": confidence,
                        "title": f"{label}: несколько дней подряд по плану ждали, а на площадке не видно",
                        "details": {
                            "thresholdDays": settings.gap_days_threshold,
                            "classTitle": class_label(titles, code),
                        },
                    }
                )

        if row["verdict"] == "UNEXPECTED" and expectation["has_plan"]:
            findings.append(
                {
                    "class_code": code,
                    "day": day,
                    "date_from": None,
                    "date_to": None,
                    "type": "UNEXPECTED_GROUP",
                    "severity": "MEDIUM",
                    "deviation": 1.0,
                    "confidence": max(0.4, detection_conf),
                    "title": f"На кадрах есть {label}, хотя по плану на этот день они не ожидались",
                    "details": {
                        "objectCount": row["object_count"],
                        "frameCount": row["frame_count"],
                        "cameraCount": row["camera_count"],
                        "classTitle": class_label(titles, code),
                    },
                }
            )

        if (
            row["verdict"] == "CONFIRMED"
            and level == "GOOD"
            and row.get("expected_daily_volume") is not None
            and (
                int(row.get("hour_span") or 0) <= settings.weak_presence_max_hours
                or int(row.get("object_count") or 0) <= settings.weak_presence_max_objects
            )
        ):
            if code == PERSON_CODE and not settings.person_gap_enabled:
                continue
            daily_vol = row["expected_daily_volume"]
            daily_unit = row.get("expected_daily_unit")
            unit_part = f" {daily_unit}" if daily_unit else ""
            findings.append(
                {
                    "class_code": code,
                    "day": day,
                    "date_from": None,
                    "date_to": None,
                    "type": "LOW_INTENSITY",
                    "severity": "MEDIUM",
                    "deviation": 0.5,
                    "confidence": confidence,
                    "title": (
                        f"{label}: на кадрах есть, но слабо "
                        f"(часов: {row.get('hour_span')}, объектов: {row.get('object_count')}); "
                        f"по плану на день ~ {format_volume(daily_vol)}{unit_part}"
                    ),
                    "details": {
                        "expectedWorks": row["expected_works"],
                        "expectedWorkCount": row["expected_work_count"],
                        "expectedDailyVolume": daily_vol,
                        "expectedDailyUnit": daily_unit,
                        "hourSpan": row.get("hour_span"),
                        "objectCount": row.get("object_count"),
                        "classTitle": class_label(titles, code),
                    },
                }
            )

    return findings


def format_volume(value: float | None) -> str:
    if value is None:
        return "—"
    if abs(value - round(value)) < 1e-6:
        return str(round(value))
    return f"{value:.2f}".rstrip("0").rstrip(".")


def extract_expected_daily(rows: list[dict[str, Any]]) -> tuple[float | None, str | None]:
    """Достаёт суточный объём из expected_works сохранённых дневных строк."""
    total = 0.0
    has = False
    unit: str | None = None
    for row in rows:
        works = row.get("expected_works") or []
        if isinstance(works, str):
            continue
        day_total = 0.0
        day_has = False
        for work in works:
            if not isinstance(work, dict):
                continue
            daily = work.get("expectedDaily")
            if daily is None:
                continue
            try:
                day_total += float(daily)
            except (TypeError, ValueError):
                continue
            day_has = True
            if unit is None:
                unit = work.get("unit") or work.get("expectedDailyUnit")
        if day_has:
            has = True
            total = max(total, day_total)
            if unit is None and row.get("expected_daily_unit"):
                unit = row.get("expected_daily_unit")
    if not has:
        return None, None
    return total, unit


def build_completeness(
    conn: Any,
    plan_id: str | None,
    day: date | None,
    shift: dict[str, Any],
) -> dict[str, Any]:
    """Сводка полноты ввода: объём, срок, смена, даты."""
    result: dict[str, Any] = {
        "activeWorkCount": 0,
        "withVolume": 0,
        "withDuration": 0,
        "withBoth": 0,
        "shiftConfigured": bool(shift.get("configured")),
        "shiftStart": shift.get("shiftStart"),
        "shiftEnd": shift.get("shiftEnd"),
        "withoutVolume": [],
        "withoutDuration": [],
        "withoutDates": [],
        "partialVolumeOrDuration": [],
    }
    if not plan_id:
        return result

    with conn.cursor() as cur:
        if day is not None:
            cur.execute(
                """
                SELECT w.id, w.name, w.start_at, w.finish_at,
                       BOOL_OR(m.volume IS NOT NULL) AS has_volume,
                       BOOL_OR(m.duration_days IS NOT NULL) AS has_duration
                FROM work w
                LEFT JOIN work_classifier_match m ON m.work_id = w.id
                WHERE w.plan_id = %s
                  AND NOT w.is_summary
                  AND NOT w.is_milestone
                  AND w.start_at IS NOT NULL
                  AND w.finish_at IS NOT NULL
                  AND w.start_at::date <= %s
                  AND w.finish_at::date >= %s
                GROUP BY w.id, w.name, w.start_at, w.finish_at
                ORDER BY w.name
                """,
                (plan_id, day, day),
            )
        else:
            cur.execute(
                """
                SELECT w.id, w.name, w.start_at, w.finish_at,
                       BOOL_OR(m.volume IS NOT NULL) AS has_volume,
                       BOOL_OR(m.duration_days IS NOT NULL) AS has_duration
                FROM work w
                LEFT JOIN work_classifier_match m ON m.work_id = w.id
                WHERE w.plan_id = %s
                  AND NOT w.is_summary
                  AND NOT w.is_milestone
                GROUP BY w.id, w.name, w.start_at, w.finish_at
                ORDER BY w.name
                """,
                (plan_id,),
            )
        works = cur.fetchall()

        cur.execute(
            """
            SELECT w.name
            FROM work w
            WHERE w.plan_id = %s
              AND NOT w.is_summary
              AND NOT w.is_milestone
              AND (w.start_at IS NULL OR w.finish_at IS NULL)
            ORDER BY w.name
            LIMIT 12
            """,
            (plan_id,),
        )
        without_dates = [str(row["name"]) for row in cur.fetchall()]

    without_volume: list[str] = []
    without_duration: list[str] = []
    partial: list[str] = []
    with_volume = with_duration = with_both = 0
    for row in works:
        name = str(row["name"])
        has_v = bool(row["has_volume"])
        has_d = bool(row["has_duration"])
        if has_v:
            with_volume += 1
        else:
            without_volume.append(name)
        if has_d:
            with_duration += 1
        else:
            without_duration.append(name)
        if has_v and has_d:
            with_both += 1
        elif has_v or has_d:
            partial.append(name)

    result.update(
        {
            "activeWorkCount": len(works),
            "withVolume": with_volume,
            "withDuration": with_duration,
            "withBoth": with_both,
            "withoutVolume": without_volume[:12],
            "withoutDuration": without_duration[:12],
            "withoutDates": without_dates,
            "partialVolumeOrDuration": partial[:12],
        }
    )
    return result


def is_late_start(
    conn: Any,
    project_id: str,
    class_code: str,
    day: date,
    settings: Settings,
) -> bool:
    """True if class was expected and GAP on enough prior observable days since first expectation."""
    history = load_class_history(conn, project_id, class_code, day, settings.gap_days_threshold + 2)
    observable = [row for row in history if row["observability"] == "GOOD"]
    if len(observable) < settings.gap_days_threshold:
        return False
    recent = observable[-settings.gap_days_threshold :]
    return all(row["verdict"] == "GAP" and row["expected"] for row in recent)


def is_repeated_gap(
    conn: Any,
    project_id: str,
    class_code: str,
    day: date,
    settings: Settings,
) -> bool:
    history = load_class_history(conn, project_id, class_code, day, settings.gap_days_threshold + 1)
    observable = [row for row in history if row["observability"] in {"GOOD", "PARTIAL"}]
    if len(observable) < settings.gap_days_threshold:
        return False
    recent = observable[-settings.gap_days_threshold :]
    return all(row["verdict"] == "GAP" for row in recent)


def load_class_history(
    conn: Any,
    project_id: str,
    class_code: str,
    before_day: date,
    limit: int,
) -> list[dict[str, Any]]:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT DISTINCT ON (adc.day)
                   adc.day,
                   adc.verdict,
                   adc.expected,
                   ar.observability
            FROM analysis_day_class adc
            JOIN analysis_run ar ON ar.id = adc.run_id
            WHERE adc.project_id = %s
              AND adc.class_code = %s
              AND adc.day < %s
              AND ar.mode = 'DAY'
              AND ar.status = 'COMPLETED'
            ORDER BY adc.day DESC, ar.finished_at DESC NULLS LAST
            LIMIT %s
            """,
            (project_id, class_code, before_day, limit),
        )
        rows = list(reversed(cur.fetchall()))
    return rows


def persist_day_result(
    conn: Any,
    run_id: str,
    project_id: str,
    day: date,
    observability: str,
    summary: dict[str, Any],
    classes: list[dict[str, Any]],
    findings: list[dict[str, Any]],
) -> None:
    with conn.cursor() as cur:
        cur.execute(
            """
            UPDATE analysis_run
            SET observability = %s,
                summary = %s
            WHERE id = %s
            """,
            (observability, Jsonb(summary), run_id),
        )
        cur.execute("DELETE FROM analysis_day_class WHERE run_id = %s", (run_id,))
        cur.execute("DELETE FROM analysis_finding WHERE run_id = %s", (run_id,))
        for row in classes:
            cur.execute(
                """
                INSERT INTO analysis_day_class (
                    run_id, project_id, day, class_code,
                    expected, expected_work_count, expected_confidence, expected_works,
                    present, frame_count, object_count, camera_count, hour_span,
                    max_confidence, median_confidence, needs_refinement_ratio, verdict
                ) VALUES (
                    %s, %s, %s, %s,
                    %s, %s, %s, %s,
                    %s, %s, %s, %s, %s,
                    %s, %s, %s, %s
                )
                """,
                (
                    run_id,
                    project_id,
                    day,
                    row["class_code"],
                    row["expected"],
                    row["expected_work_count"],
                    row["expected_confidence"],
                    Jsonb(row["expected_works"]),
                    row["present"],
                    row["frame_count"],
                    row["object_count"],
                    row["camera_count"],
                    row["hour_span"],
                    row["max_confidence"],
                    row["median_confidence"],
                    row["needs_refinement_ratio"],
                    row["verdict"],
                ),
            )
        for finding in findings:
            cur.execute(
                """
                INSERT INTO analysis_finding (
                    run_id, project_id, class_code, day, date_from, date_to,
                    type, severity, deviation, confidence, status, title, details
                ) VALUES (
                    %s, %s, %s, %s, %s, %s,
                    %s, %s, %s, %s, 'POTENTIAL', %s, %s
                )
                """,
                (
                    run_id,
                    project_id,
                    finding["class_code"],
                    finding["day"],
                    finding["date_from"],
                    finding["date_to"],
                    finding["type"],
                    finding["severity"],
                    finding["deviation"],
                    finding["confidence"],
                    finding["title"],
                    Jsonb(finding["details"]),
                ),
            )


def persist_period_result(
    conn: Any,
    run_id: str,
    project_id: str,
    summary: dict[str, Any],
    findings: list[dict[str, Any]],
) -> None:
    with conn.cursor() as cur:
        cur.execute(
            """
            UPDATE analysis_run
            SET observability = NULL,
                summary = %s
            WHERE id = %s
            """,
            (Jsonb(summary), run_id),
        )
        cur.execute("DELETE FROM analysis_finding WHERE run_id = %s", (run_id,))
        for finding in findings:
            cur.execute(
                """
                INSERT INTO analysis_finding (
                    run_id, project_id, class_code, day, date_from, date_to,
                    type, severity, deviation, confidence, status, title, details
                ) VALUES (
                    %s, %s, %s, %s, %s, %s,
                    %s, %s, %s, %s, 'POTENTIAL', %s, %s
                )
                """,
                (
                    run_id,
                    project_id,
                    finding["class_code"],
                    finding["day"],
                    finding["date_from"],
                    finding["date_to"],
                    finding["type"],
                    finding["severity"],
                    finding["deviation"],
                    finding["confidence"],
                    finding["title"],
                    Jsonb(finding["details"]),
                ),
            )


def load_completed_day_runs(
    conn: Any,
    project_id: str,
    date_from: date,
    date_to: date,
) -> list[dict[str, Any]]:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT DISTINCT ON (day)
                   id, day, plan_id, observability, summary, finished_at
            FROM analysis_run
            WHERE project_id = %s
              AND mode = 'DAY'
              AND status = 'COMPLETED'
              AND day BETWEEN %s AND %s
            ORDER BY day ASC, finished_at DESC NULLS LAST
            """,
            (project_id, date_from, date_to),
        )
        return list(cur.fetchall())


def load_day_class_rows(conn: Any, run_ids: list[str]) -> list[dict[str, Any]]:
    if not run_ids:
        return []
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT *
            FROM analysis_day_class
            WHERE run_id = ANY(%s)
            """,
            (run_ids,),
        )
        return list(cur.fetchall())


def is_outside_project_range(conn: Any, project_id: str, day: date) -> bool:
    with conn.cursor() as cur:
        cur.execute(
            "SELECT start_date, end_date FROM project WHERE id = %s",
            (project_id,),
        )
        row = cur.fetchone()
    if not row:
        return False
    start = row["start_date"]
    end = row["end_date"]
    if start and day < start:
        return True
    if end and day > end:
        return True
    return False


def iter_days(start: date, end: date) -> Iterable[date]:
    current = start
    while current <= end:
        yield current
        current += timedelta(days=1)


def count_by(rows: list[dict[str, Any]], key: str) -> dict[str, int]:
    result: dict[str, int] = defaultdict(int)
    for row in rows:
        result[str(row.get(key))] += 1
    return dict(result)
