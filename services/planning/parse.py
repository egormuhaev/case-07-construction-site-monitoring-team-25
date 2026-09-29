"""Разобрать календарный план MS Project (.mpp) через MPXJ и записать работы в work.

  python3 scripts/parse_calendar_plan.py
  python3 scripts/parse_calendar_plan.py --dry-run
  python3 scripts/parse_calendar_plan.py --input dataset/documents/Calendar-plan.mpp
"""

from __future__ import annotations

import sys
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Protocol, cast

import jpype
import mpxj

RELATION_SHORT = {
    "FINISH_START": "FS",
    "START_START": "SS",
    "FINISH_FINISH": "FF",
    "START_FINISH": "SF",
    "FS": "FS",
    "SS": "SS",
    "FF": "FF",
    "SF": "SF",
}
UNIT_SHORT = {
    "MINUTES": "m",
    "HOURS": "h",
    "DAYS": "d",
    "WEEKS": "w",
    "MONTHS": "mo",
    "ELAPSED_MINUTES": "em",
    "ELAPSED_HOURS": "eh",
    "ELAPSED_DAYS": "ed",
    "ELAPSED_WEEKS": "ew",
    "ELAPSED_MONTHS": "emo",
    "PERCENT": "%",
}

# описание типов возвращаемых значений mpxj


@dataclass
class Work:
    unique_id: int
    task_id: int | None
    parent_unique_id: int | None
    position: int
    outline_level: int
    wbs: str | None
    name: str
    path: str
    is_summary: bool
    is_milestone: bool
    start_at: datetime | None
    finish_at: datetime | None
    duration_hours: float | None
    percent_complete: float | None
    work_hours: float | None
    predecessors: str | None
    resources: str | None
    guid: str | None

    def as_row(self, source_file: str) -> tuple[object, ...]:
        return (
            source_file,
            self.unique_id,
            self.task_id,
            self.parent_unique_id,
            self.position,
            self.outline_level,
            self.wbs,
            self.name,
            self.path,
            self.is_summary,
            self.is_milestone,
            self.start_at,
            self.finish_at,
            self.duration_hours,
            self.percent_complete,
            self.work_hours,
            self.predecessors,
            self.resources,
            self.guid,
        )


class JavaDateTime(Protocol):
    def getYear(self) -> int: ...
    def getMonthValue(self) -> int: ...
    def getDayOfMonth(self) -> int: ...
    def getHour(self) -> int: ...
    def getMinute(self) -> int: ...
    def getSecond(self) -> int: ...


class JavaDuration(Protocol):
    def getDuration(self) -> float: ...
    def getUnits(self) -> object: ...
    def convertUnits(self, units: object,
                     defaults: object) -> JavaDuration: ...


class JavaTask(Protocol):
    def getUniqueID(self) -> int: ...
    def getID(self) -> int | None: ...
    def getName(self) -> str | None: ...
    def getParentTask(self) -> JavaTask | None: ...
    def getOutlineLevel(self) -> int | None: ...
    def getWBS(self) -> str | None: ...
    def getSummary(self) -> bool | None: ...
    def getMilestone(self) -> bool | None: ...
    def getStart(self) -> JavaDateTime | None: ...
    def getFinish(self) -> JavaDateTime | None: ...
    def getDuration(self) -> JavaDuration | None: ...
    def getPercentageComplete(self) -> float | None: ...
    def getWork(self) -> JavaDuration | None: ...
    def getGUID(self) -> object | None: ...
    def getPredecessors(self) -> Sequence[JavaRelation] | None: ...
    def getResourceAssignments(self) -> Sequence[JavaAssignment] | None: ...


class JavaRelation(Protocol):
    def getTargetTask(self) -> JavaTask | None: ...
    def getType(self) -> object: ...
    def getLag(self) -> JavaDuration | None: ...


class JavaResource(Protocol):
    def getName(self) -> str | None: ...


class JavaAssignment(Protocol):
    def getResource(self) -> JavaResource | None: ...


class JavaProject(Protocol):
    def getProjectProperties(self) -> object: ...
    def getTasks(self) -> Sequence[JavaTask | None]: ...


def log(message: str) -> None:
    print(message, file=sys.stderr)


def ensure_jvm() -> None:
    if jpype.isJVMStarted():
        return
    jpype.startJVM(
        "-Dlog4j2.loggerContextFactory=org.apache.logging.log4j.simple.SimpleLoggerContextFactory"
    )


def hours_unit() -> object:
    ensure_jvm()
    return cast(object, jpype.JClass("org.mpxj.TimeUnit").HOURS)


def as_text(value: object | None) -> str | None:
    """Парсит текст"""
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def as_datetime(value: datetime | JavaDateTime | None) -> datetime | None:
    """Парсит время"""
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.replace(tzinfo=None)
    return datetime(
        value.getYear(),
        value.getMonthValue(),
        value.getDayOfMonth(),
        value.getHour(),
        value.getMinute(),
        value.getSecond(),
    )


def as_hours(duration: JavaDuration | None, defaults: object) -> float | None:
    """Превращает продолжительность в часы"""
    if duration is None:
        return None
    converted = duration.convertUnits(hours_unit(), defaults)
    return converted.getDuration()


def format_lag(lag: JavaDuration | None) -> str:
    """Парсит задержки внутри увязки"""
    if lag is None or lag.getDuration() == 0:
        return ""
    amount = lag.getDuration()
    unit_name = str(lag.getUnits())
    unit = UNIT_SHORT.get(unit_name, unit_name)
    sign = "+" if amount > 0 else ""
    return f"{sign}{amount:g}{unit}"


def format_predecessors(task: JavaTask) -> str | None:
    """Парсит увязки"""
    parts: list[str] = []
    for relation in task.getPredecessors() or []:
        target = relation.getTargetTask()
        if target is None:
            continue
        type_name = str(relation.getType())
        kind = RELATION_SHORT.get(type_name, type_name)
        parts.append(
            f"{target.getUniqueID()}{kind}{format_lag(relation.getLag())}")
    return ", ".join(parts) or None


def format_resources(task: JavaTask) -> str | None:
    """Парсит ресурсы задачи"""
    names: list[str] = []
    for assignment in task.getResourceAssignments() or []:
        resource = assignment.getResource()
        if resource is None or not resource.getName():
            continue
        name = resource.getName()
        if name:
            names.append(name)
    return ", ".join(names) or None


def task_path(task: JavaTask) -> str:
    """Парсит путь к задаче от начала проекта"""
    names: list[str] = []
    current: JavaTask | None = task
    seen: set[int] = set()
    while current is not None:
        unique_id = current.getUniqueID()
        if unique_id in seen:
            break
        seen.add(unique_id)
        name = as_text(current.getName())
        if name:
            names.append(name)
        current = current.getParentTask()
    names.reverse()
    return " / ".join(names)


def parse_task(task: JavaTask, position: int, defaults: object) -> Work | None:
    """Парсит задачу из проекта"""
    name = as_text(task.getName())
    if not name:
        return None
    parent = task.getParentTask()
    percent = task.getPercentageComplete()
    return Work(
        unique_id=task.getUniqueID(),
        task_id=task.getID(),
        parent_unique_id=parent.getUniqueID() if parent is not None else None,
        position=position,
        outline_level=task.getOutlineLevel() or 0,
        wbs=as_text(task.getWBS()),
        name=name,
        path=task_path(task),
        is_summary=bool(task.getSummary()),
        is_milestone=bool(task.getMilestone()),
        start_at=as_datetime(task.getStart()),
        finish_at=as_datetime(task.getFinish()),
        duration_hours=as_hours(task.getDuration(), defaults),
        percent_complete=None if percent is None else float(percent),
        work_hours=as_hours(task.getWork(), defaults),
        predecessors=format_predecessors(task),
        resources=format_resources(task),
        guid=as_text(task.getGUID()),
    )


def parse_project(path: Path) -> list[Work]:
    """Парсит .mpp файл через библиотеку mpxj"""
    ensure_jvm()
    reader = jpype.JClass("org.mpxj.reader.UniversalProjectReader")()
    project = cast(JavaProject, reader.read(str(path)))
    defaults = project.getProjectProperties()
    works: list[Work] = []
    for task in project.getTasks():
        if task is None or task.getID() == 0:
            continue
        parsed = parse_task(task, len(works), defaults)
        if parsed is not None:
            works.append(parsed)
    return works


def print_works(works: list[Work]) -> None:
    """Вывод в терминал работ"""
    for work in works:
        if work.is_summary:
            kind = "суммарная"
        elif work.is_milestone:
            kind = "веха"
        else:
            kind = "работа"
        start = work.start_at.isoformat(sep=" ") if work.start_at else ""
        finish = work.finish_at.isoformat(sep=" ") if work.finish_at else ""
        hours = f"{work.duration_hours:g} ч" if work.duration_hours is not None else ""
        print(f"{work.wbs or '-':<8} {kind:<10} {work.name}")
        print(f"         {start} — {finish}  {hours}".rstrip())
