#!/usr/bin/env python3
"""Загрузить классификаторы, дампы векторов и связку с классами детекции.

Миграции накатывает core-api при старте. Этот скрипт только сидит данные.

Предпочтительный путь — согласованный дамп из текущей БД:

  make dump-classifiers   # → dataset/dumps/*.csv.gz
  make seed               # грузит дампы напрямую (UUID/FK сохраняются)

Если дампов нет — заливает машины/работы из Excel/JSON (без векторов).

  python scripts/seed.py
  python scripts/seed.py --reload
  python scripts/seed.py --reload-dumps
"""

from __future__ import annotations

import argparse
import gzip
import hashlib
import os
import sys
import time
import uuid
from collections.abc import Iterator
from dataclasses import dataclass
from pathlib import Path

import ijson
import psycopg
from openpyxl import load_workbook
from psycopg import sql

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "services"))

from detecting.model.equipment_group import GROUPS, PERSON_CODE  # noqa: E402

MACHINES_PATH = ROOT / "dataset" / "documents" / "Классификатор Версия №43.xlsx"
CLASSIFIER_PATH = ROOT / "dataset" / "classifier" / "classifier.json"
DUMPS_DIR = ROOT / "dataset" / "dumps"
CONNECT_ATTEMPTS = 20

MACHINE_COLUMNS = (
    "id",
    "classifier_id",
    "section",
    "group_name",
    "code",
    "name",
)
WORK_COLUMNS = (
    "sphere",
    "document",
    "collection",
    "department",
    "section",
    "subsection",
    "table_code",
    "table_name",
    "work_code",
    "work_name",
    "unit",
    "workers_hours",
    "machinists_hours",
    "commissioning_hours",
    "labor_hours",
    "machines_hours",
    "machine_id",
    "machine_hours",
)
WORK_DUMP_COLUMNS = ("id", *WORK_COLUMNS)
NORMALIZED_COLUMNS = ("id", "work_classifier_id", "work_normalized_name")
VECTOR_COLUMNS = ("id", "classifier_id", "vector", "embedding_name")

DUMP_FILES: tuple[tuple[str, str, tuple[str, ...]], ...] = (
    ("machine_classifier", "machine_classifier.csv.gz", MACHINE_COLUMNS),
    ("work_classifier", "work_classifier.csv.gz", WORK_DUMP_COLUMNS),
    ("work_classifier_normalized", "work_classifier_normalized.csv.gz", NORMALIZED_COLUMNS),
    ("work_classifier_vector", "work_classifier_vector.csv.gz", VECTOR_COLUMNS),
)


@dataclass(frozen=True)
class DbConfig:
    host: str
    port: str
    user: str
    password: str
    dbname: str

    @classmethod
    def from_env(cls) -> DbConfig:
        return cls(
            host=os.environ.get("POSTGRES_HOST", "localhost"),
            port=os.environ.get("POSTGRES_PORT", "5432"),
            user=os.environ.get("POSTGRES_USER", "admin"),
            password=os.environ.get("POSTGRES_PASSWORD", "admin_password"),
            dbname=os.environ.get("POSTGRES_DB", "monitoring_db"),
        )


def log(message: str) -> None:
    print(message, file=sys.stderr)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Загрузить классификаторы и связки детекции")
    parser.add_argument(
        "--reload",
        action="store_true",
        help="Перезалить классификаторы, даже если таблицы не пустые",
    )
    parser.add_argument(
        "--reload-dumps",
        action="store_true",
        help="Перезалить только work_classifier_normalized/vector из dataset/dumps",
    )
    return parser.parse_args()


def require_file(path: Path, hint: str | None = None) -> None:
    if path.exists():
        return
    message = f"Нет файла: {path}"
    if hint:
        message += f"\n{hint}"
    raise SystemExit(message)


def empty_to_none(value: object) -> str | None:
    if value is None:
        return None
    stripped = str(value).strip()
    return stripped or None


def as_float(value: object) -> float | None:
    if value is None or value == "":
        return None
    try:
        return float(str(value))
    except (TypeError, ValueError):
        return None


def extract_name(label: str) -> str:
    _, sep, name = label.partition(": ")
    return name.strip() if sep else label.strip()


def copy_sql(table: str, columns: tuple[str, ...], *, header: bool = False) -> sql.Composed:
    base = sql.SQL("COPY {} ({}) FROM STDIN").format(
        sql.Identifier(table),
        sql.SQL(", ").join(sql.Identifier(name) for name in columns),
    )
    if header:
        return base + sql.SQL(" WITH (FORMAT csv, HEADER true)")
    return base


def connect(config: DbConfig) -> psycopg.Connection:
    last_error: Exception | None = None
    for attempt in range(1, CONNECT_ATTEMPTS + 1):
        try:
            return psycopg.connect(
                host=config.host,
                port=config.port,
                user=config.user,
                password=config.password,
                dbname=config.dbname,
                connect_timeout=3,
            )
        except psycopg.OperationalError as exc:
            last_error = exc
            log(f"Postgres недоступен ({attempt}/{CONNECT_ATTEMPTS}), жду...")
            time.sleep(1)
    raise SystemExit(f"Не удалось подключиться к Postgres: {last_error}")


def count_rows(cur: psycopg.Cursor, table: str) -> int:
    cur.execute(sql.SQL("SELECT COUNT(*) FROM {}").format(sql.Identifier(table)))
    row = cur.fetchone()
    return int(row[0]) if row else 0


def table_exists(cur: psycopg.Cursor, name: str) -> bool:
    cur.execute("SELECT to_regclass(%s)", (f"public.{name}",))
    row = cur.fetchone()
    return row is not None and row[0] is not None


def copy_rows(
    cur: psycopg.Cursor,
    table: str,
    columns: tuple[str, ...],
    rows: Iterator[tuple[object, ...]] | list[tuple[object, ...]],
) -> None:
    with cur.copy(copy_sql(table, columns)) as copy:
        for row in rows:
            copy.write_row(row)


def dumps_ready() -> bool:
    return all((DUMPS_DIR / filename).is_file() for _, filename, _ in DUMP_FILES)


def copy_from_gzip(cur: psycopg.Cursor, table: str, columns: tuple[str, ...], path: Path) -> None:
    log(f"  COPY {table} ← {path.name}")
    with gzip.open(path, "rt", encoding="utf-8") as handle:
        with cur.copy(copy_sql(table, columns, header=True)) as copy:
            while chunk := handle.read(1024 * 1024):
                copy.write(chunk.encode("utf-8"))


def load_classifier_dumps(cur: psycopg.Cursor, *, only_embeddings: bool = False) -> None:
    """Прямая заливка согласованных дампов (без rematch)."""
    missing = [name for _, name, _ in DUMP_FILES if not (DUMPS_DIR / name).is_file()]
    if missing:
        raise SystemExit(
            "Нет дампов в dataset/dumps:\n  "
            + "\n  ".join(missing)
            + "\nСнимите с текущей БД: make dump-classifiers"
        )
    if only_embeddings:
        targets = tuple(
            item
            for item in DUMP_FILES
            if item[0] in {"work_classifier_normalized", "work_classifier_vector"}
        )
    else:
        targets = DUMP_FILES
    log(f"Загрузка дампов из {DUMPS_DIR}...")
    for table, filename, columns in targets:
        if count_rows(cur, table) > 0:
            log(f"  {table} уже заполнена, пропуск")
            continue
        copy_from_gzip(cur, table, columns, DUMPS_DIR / filename)
        log(f"  {table}: {count_rows(cur, table)}")


def load_machines(path: Path) -> tuple[list[tuple[object, ...]], dict[str, uuid.UUID]]:
    workbook = load_workbook(path, data_only=True)
    try:
        sheet = workbook["Машины и механизмы"]
        active_section: str | None = None
        active_group: str | None = None
        names_in_section: set[str] = set()
        seen_codes: set[str] = set()
        rows: list[tuple[object, ...]] = []
        code_to_id: dict[str, uuid.UUID] = {}
        skipped_duplicate_codes = 0

        for row in sheet.rows:
            values = [cell.value for cell in row]
            row_content = " ".join(str(value) for value in values if value is not None).strip()
            if not row_content:
                continue
            if "Раздел " in row_content:
                active_section = row_content
                active_group = None
                names_in_section = set()
                continue
            if "Группа " in row_content:
                active_group = row_content
                continue
            if active_section is None or active_group is None:
                continue
            name = empty_to_none(values[1] if len(values) > 1 else None)
            if name is None or name in names_in_section:
                continue
            names_in_section.add(name)
            code = empty_to_none(values[0] if values else None)
            if code is None:
                continue
            if code in seen_codes:
                skipped_duplicate_codes += 1
                continue
            seen_codes.add(code)
            machine_id = uuid.uuid4()
            rows.append(
                (
                    machine_id,
                    hashlib.md5((active_section + active_group).encode()).hexdigest(),
                    extract_name(active_section),
                    extract_name(active_group),
                    code,
                    name,
                )
            )
            code_to_id[code] = machine_id
    finally:
        workbook.close()
    if skipped_duplicate_codes:
        log(f"Пропущено повторов кода машины: {skipped_duplicate_codes}")
    return rows, code_to_id


def iter_works(
    path: Path,
    code_to_id: dict[str, uuid.UUID],
    unknown_codes: set[str],
) -> Iterator[tuple[object, ...]]:
    with path.open("rb") as fh:
        for collection in ijson.items(fh, "domains.item.collections.item", use_float=True):
            sphere = collection.get("domain_name") or ""
            document = collection.get("document_code") or ""
            collection_name = collection.get("name") or ""
            for table in collection.get("tables") or []:
                table_code = table.get("class_id") or ""
                table_name = table.get("name") or ""
                table_unit = table.get("unit") or ""
                department = empty_to_none(table.get("department"))
                section = empty_to_none(table.get("section"))
                subsection = empty_to_none(table.get("subsection"))
                for work in table.get("works") or []:
                    base = (
                        sphere,
                        document,
                        collection_name,
                        department,
                        section,
                        subsection,
                        table_code,
                        table_name,
                        work.get("class_id") or "",
                        work.get("full_name") or work.get("name") or "",
                        work.get("unit") or table_unit or "",
                        as_float(work.get("workers_hours")),
                        as_float(work.get("machinists_hours")),
                        as_float(work.get("commissioning_hours")),
                        as_float(work.get("labor_hours")),
                        as_float(work.get("machines_hours")),
                    )
                    machines = work.get("machines") or []
                    if not machines:
                        yield (*base, None, None)
                        continue
                    for machine in machines:
                        code = empty_to_none(machine.get("code"))
                        machine_id = code_to_id.get(code) if code else None
                        if code and machine_id is None:
                            unknown_codes.add(code)
                        yield (*base, machine_id, as_float(machine.get("hours")))


def seed_classifiers_from_sources(cur: psycopg.Cursor) -> set[str]:
    require_file(MACHINES_PATH)
    require_file(
        CLASSIFIER_PATH,
        "Соберите его командой:\n  python scripts/parse_gesn_classifier.py",
    )
    log("Чтение классификатора машин...")
    machines, code_to_id = load_machines(MACHINES_PATH)
    log(f"Машин к загрузке: {len(machines)}")
    copy_rows(cur, "machine_classifier", MACHINE_COLUMNS, machines)
    unknown_codes: set[str] = set()
    copy_rows(cur, "work_classifier", WORK_COLUMNS, iter_works(CLASSIFIER_PATH, code_to_id, unknown_codes))
    log("Классификатор работ загружен (без normalized/vector — нужен make dump-classifiers)")
    return unknown_codes


def seed_detection_classes(cur: psycopg.Cursor) -> None:
    rows = [
        (PERSON_CODE, "Человек", "PERSON", []),
    ]
    for group in GROUPS:
        if group.code == "UNKNOWN_EQUIPMENT":
            kind = "UNKNOWN"
        else:
            kind = "EQUIPMENT"
        rows.append((group.code, group.description, kind, list(group.normative_groups)))
    desired = {code for code, _, _, _ in rows}
    for code, title, kind, groups in rows:
        cur.execute(
            """
            INSERT INTO detection_class (code, title, kind, normative_groups)
            VALUES (%s, %s, %s, %s)
            ON CONFLICT (code) DO UPDATE SET
                title = EXCLUDED.title,
                kind = EXCLUDED.kind,
                normative_groups = EXCLUDED.normative_groups
            """,
            (code, title, kind, groups),
        )
    cur.execute("SELECT code FROM detection_class")
    stale = [row[0] for row in cur.fetchall() if row[0] not in desired]
    for code in stale:
        cur.execute(
            """
            DELETE FROM detection_class_machine WHERE class_code = %s
            """,
            (code,),
        )
        cur.execute(
            """
            DELETE FROM detection_class dc
            WHERE dc.code = %s
              AND NOT EXISTS (
                SELECT 1 FROM detection_object o WHERE o.class_code = dc.code
              )
            """,
            (code,),
        )



def link_machines(cur: psycopg.Cursor) -> None:
    cur.execute("DELETE FROM detection_class_machine WHERE source = 'NORMATIVE'")
    cur.execute("SELECT code, normative_groups FROM detection_class")
    classes = [(row[0], list(row[1] or [])) for row in cur.fetchall()]
    empty_groups: list[str] = []
    linked_ids: set[str] = set()
    for code, groups in classes:
        for prefix in groups:
            like = f"{prefix}%"
            cur.execute(
                """
                INSERT INTO detection_class_machine (class_code, machine_id, source)
                SELECT %s, id, 'NORMATIVE'
                FROM machine_classifier
                WHERE code LIKE %s
                ON CONFLICT DO NOTHING
                """,
                (code, like),
            )
            cur.execute(
                "SELECT id FROM machine_classifier WHERE code LIKE %s",
                (like,),
            )
            found = [str(row[0]) for row in cur.fetchall()]
            linked_ids.update(found)
            if not found:
                empty_groups.append(f"{code}:{prefix}")
    cur.execute("SELECT COUNT(*) FROM machine_classifier")
    total = int(cur.fetchone()[0])
    cur.execute("SELECT COUNT(DISTINCT machine_id) FROM detection_class_machine")
    linked = int(cur.fetchone()[0])
    print(f"machine_classifier всего: {total}")
    print(f"machine_classifier со связкой: {linked}")
    print(f"machine_classifier без класса: {total - linked}")
    if empty_groups:
        print("normative_groups без машин: " + ", ".join(empty_groups))
    else:
        print("normative_groups без машин: нет")


def main() -> int:
    args = parse_args()
    config = DbConfig.from_env()
    log(f"Подключение к {config.host}:{config.port}/{config.dbname}...")
    with connect(config) as conn:
        with conn.cursor() as cur:
            if not table_exists(cur, "machine_classifier") or not table_exists(cur, "detection_class"):
                raise SystemExit(
                    "Схема ещё не накатана. Поднимите core-api (`make up`) и повторите make seed."
                )
            unknown_codes: set[str] | None = None
            use_dumps = dumps_ready()
            if args.reload:
                cur.execute(
                    "TRUNCATE detection_class_machine, work_classifier_vector, "
                    "work_classifier_normalized, work_classifier, machine_classifier CASCADE"
                )
            elif args.reload_dumps:
                cur.execute(
                    "TRUNCATE work_classifier_vector, work_classifier_normalized CASCADE"
                )

            if use_dumps:
                if args.reload_dumps and not args.reload:
                    load_classifier_dumps(cur, only_embeddings=True)
                elif count_rows(cur, "machine_classifier") == 0:
                    load_classifier_dumps(cur)
                else:
                    log("Классификаторы уже загружены, пропуск")
                    if count_rows(cur, "work_classifier_vector") == 0:
                        load_classifier_dumps(cur, only_embeddings=True)
            else:
                log(
                    f"Дампы в {DUMPS_DIR} не найдены — заливка из Excel/JSON. "
                    "Для векторов: make dump-classifiers (на заполненной БД) и make seed -- --reload-dumps"
                )
                if count_rows(cur, "machine_classifier") == 0:
                    unknown_codes = seed_classifiers_from_sources(cur)
                else:
                    log("Классификаторы уже загружены, пропуск")

            conn.commit()
            seed_detection_classes(cur)
            link_machines(cur)
            print(f"machine_classifier: {count_rows(cur, 'machine_classifier')}")
            print(f"work_classifier: {count_rows(cur, 'work_classifier')}")
            print(f"work_classifier_normalized: {count_rows(cur, 'work_classifier_normalized')}")
            print(f"work_classifier_vector: {count_rows(cur, 'work_classifier_vector')}")
            print(f"detection_class: {count_rows(cur, 'detection_class')}")
            print(f"detection_class_machine: {count_rows(cur, 'detection_class_machine')}")
            if unknown_codes:
                print(f"Неизвестных кодов машин в работах: {len(unknown_codes)}")
            if count_rows(cur, "work_classifier_vector") > 0:
                cur.execute("ANALYZE work_classifier_vector")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
