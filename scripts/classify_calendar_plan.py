"""Сопоставить работы календарного плана с классификатором по векторам.

Для каждой записи work_vector ищет ближайший вектор в work_classifier_vector
и записывает пару в work_work_classifier: название и данные нормы,
даты и поля работы из календарного плана.

  python scripts/classify-calendar-plan.py
"""

from __future__ import annotations

import os

import numpy as np
import psycopg

CLASSIFIER_COLUMNS = (
    "classifier_work_name",
    "classifier_sphere",
    "classifier_document",
    "classifier_collection",
    "classifier_department",
    "classifier_section",
    "classifier_subsection",
    "classifier_table_code",
    "classifier_table_name",
    "classifier_work_code",
    "classifier_unit",
    "classifier_workers_hours",
    "classifier_machinists_hours",
    "classifier_commissioning_hours",
    "classifier_labor_hours",
    "classifier_machines_hours",
    "classifier_machine_id",
    "classifier_machine_hours",
)
PLAN_COLUMNS = (
    "plan_source_file",
    "plan_unique_id",
    "plan_task_id",
    "plan_parent_unique_id",
    "plan_position",
    "plan_outline_level",
    "plan_wbs",
    "plan_name",
    "plan_path",
    "plan_is_summary",
    "plan_is_milestone",
    "plan_start_at",
    "plan_finish_at",
    "plan_duration_hours",
    "plan_percent_complete",
    "plan_work_hours",
    "plan_predecessors",
    "plan_resources",
    "plan_guid",
)
INSERT_COLUMNS = (
    "work_id",
    "classifier_id",
    "score",
    *CLASSIFIER_COLUMNS,
    *PLAN_COLUMNS,
)
# Память матрицы близости: число работ × размер блока × 4 байта.
CLASSIFIER_BLOCK = 4096


def connect() -> psycopg.Connection:
    return psycopg.connect(
        host=os.environ.get("POSTGRES_HOST", "localhost"),
        port=os.environ.get("POSTGRES_PORT", "5432"),
        user=os.environ.get("POSTGRES_USER", "admin"),
        password=os.environ.get("POSTGRES_PASSWORD", "admin_password"),
        dbname=os.environ.get("POSTGRES_DB", "monitoring_db"),
    )


def parse_vector(value: str) -> np.ndarray:
    return np.fromstring(value.strip()[1:-1], sep=",", dtype=np.float32)


def vectors_matrix(rows: list[dict]) -> np.ndarray:
    parsed = [parse_vector(row["vector"]) for row in rows]
    return np.ascontiguousarray(np.stack(parsed), dtype=np.float32)


def nearest(work_vectors: np.ndarray, classifier_vectors: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Индекс и скалярное произведение ближайшего вектора классификатора.

    Векторы уже нормированы при записи, поэтому произведение — косинусная близость.
    """
    count = work_vectors.shape[0]
    best_index = np.empty(count, dtype=np.int64)
    best_score = np.full(count, -np.inf, dtype=np.float32)
    for start in range(0, classifier_vectors.shape[0], CLASSIFIER_BLOCK):
        block = classifier_vectors[start:start + CLASSIFIER_BLOCK]
        scores = work_vectors @ block.T
        local_index = scores.argmax(axis=1)
        local_score = scores[np.arange(count), local_index]
        better = local_score > best_score
        best_score[better] = local_score[better]
        best_index[better] = start + local_index[better]
    return best_index, best_score


def load_rows(conn: psycopg.Connection) -> tuple[list[dict], list[dict]]:
    with conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
        cur.execute(
            """
            SELECT
                wv.work_id,
                wv.vector::text AS vector,
                w.source_file AS plan_source_file,
                w.unique_id AS plan_unique_id,
                w.task_id AS plan_task_id,
                w.parent_unique_id AS plan_parent_unique_id,
                w.position AS plan_position,
                w.outline_level AS plan_outline_level,
                w.wbs AS plan_wbs,
                w.name AS plan_name,
                w.path AS plan_path,
                w.is_summary AS plan_is_summary,
                w.is_milestone AS plan_is_milestone,
                w.start_at AS plan_start_at,
                w.finish_at AS plan_finish_at,
                w.duration_hours AS plan_duration_hours,
                w.percent_complete AS plan_percent_complete,
                w.work_hours AS plan_work_hours,
                w.predecessors AS plan_predecessors,
                w.resources AS plan_resources,
                w.guid AS plan_guid
            FROM work_vector wv
            JOIN work w ON w.id = wv.work_id
            ORDER BY w.position
            """
        )
        works = cur.fetchall()

        cur.execute(
            """
            SELECT
                cv.classifier_id,
                cv.vector::text AS vector,
                c.work_name AS classifier_work_name,
                c.sphere AS classifier_sphere,
                c.document AS classifier_document,
                c.collection AS classifier_collection,
                c.department AS classifier_department,
                c.section AS classifier_section,
                c.subsection AS classifier_subsection,
                c.table_code AS classifier_table_code,
                c.table_name AS classifier_table_name,
                c.work_code AS classifier_work_code,
                c.unit AS classifier_unit,
                c.workers_hours AS classifier_workers_hours,
                c.machinists_hours AS classifier_machinists_hours,
                c.commissioning_hours AS classifier_commissioning_hours,
                c.labor_hours AS classifier_labor_hours,
                c.machines_hours AS classifier_machines_hours,
                c.machine_id AS classifier_machine_id,
                c.machine_hours AS classifier_machine_hours
            FROM work_classifier_vector cv
            JOIN work_classifier c ON c.id = cv.classifier_id
            """
        )
        classifiers = cur.fetchall()
    return works, classifiers


def match_rows(works: list[dict], classifiers: list[dict]) -> list[tuple]:
    indexes, scores = nearest(vectors_matrix(works), vectors_matrix(classifiers))
    rows: list[tuple] = []
    for work, index, score in zip(works, indexes, scores):
        classifier = classifiers[int(index)]
        rows.append(
            (
                work["work_id"],
                classifier["classifier_id"],
                float(score),
                *(classifier[column] for column in CLASSIFIER_COLUMNS),
                *(work[column] for column in PLAN_COLUMNS),
            )
        )
    return rows


def save_matches(conn: psycopg.Connection, rows: list[tuple]) -> None:
    columns = ", ".join(INSERT_COLUMNS)
    placeholders = ", ".join(["%s"] * len(INSERT_COLUMNS))
    with conn.cursor() as cur:
        cur.execute("TRUNCATE work_work_classifier")
        cur.executemany(
            f"INSERT INTO work_work_classifier ({columns}) VALUES ({placeholders})",
            rows,
        )


with connect() as conn:
    works, classifiers = load_rows(conn)

if not works:
    print("В work_vector нет записей")
    raise SystemExit(0)
if not classifiers:
    print("В work_classifier_vector нет записей")
    raise SystemExit(0)

matches = match_rows(works, classifiers)

with connect() as conn:
    save_matches(conn, matches)

for work, row in zip(works, matches):
    print(f"{row[2]:.3f}  {work['plan_name']}  ->  {row[3]}")

print(f"В work_work_classifier записано: {len(matches)}")
