#!/usr/bin/env python3
"""Поднять Postgres, применить миграции и загрузить классификаторы.

  python scripts/init_db.py
  python scripts/init_db.py --skip-up
  python scripts/init_db.py --reload
  python scripts/init_db.py --reset
"""

from __future__ import annotations

import argparse
import hashlib
import os
import re
import shutil
import subprocess
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
MIGRATIONS_DIR = ROOT / "deploy" / "db" / "migrations"
MACHINES_PATH = ROOT / "dataset" / "documents" / "Классификатор Версия №43.xlsx"
CLASSIFIER_PATH = ROOT / "dataset" / "classifier" / "classifier.json"
MIGRATION_NAME_RE = re.compile(r"^(\d{3,})_.*\.sql$")
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
APP_TABLES = (
    "detected_class_machine",
    "detected_classes",
    "work_classifier",
    "machine_classifier",
    "schema_migrations",
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
    parser = argparse.ArgumentParser(
        description="Инициализировать Postgres, применить миграции и загрузить классификаторы"
    )
    parser.add_argument(
        "--skip-up",
        action="store_true",
        help="Не запускать docker compose, если база уже поднята",
    )
    parser.add_argument(
        "--reload",
        action="store_true",
        help="Перезалить классификаторы, схему не трогать",
    )
    parser.add_argument(
        "--reset",
        action="store_true",
        help="Удалить таблицы, заново применить миграции и залить данные",
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


def copy_sql(table: str, columns: tuple[str, ...]) -> sql.Composed:
    return sql.SQL("COPY {} ({}) FROM STDIN").format(
        sql.Identifier(table),
        sql.SQL(", ").join(sql.Identifier(name) for name in columns),
    )


def compose_up() -> None:
    if shutil.which("docker") is None:
        raise SystemExit("Не найден docker. Установите Docker и повторите запуск.")
    log("Запуск docker compose...")
    result = subprocess.run(
        ["docker", "compose", "up", "-d", "--wait", "--wait-timeout", "120"],
        cwd=ROOT,
    )
    if result.returncode != 0:
        raise SystemExit("Не удалось запустить docker compose. Проверьте, что Docker запущен.")


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


def table_exists(cur: psycopg.Cursor, name: str) -> bool:
    cur.execute("SELECT to_regclass(%s)", (f"public.{name}",))
    row = cur.fetchone()
    return row is not None and row[0] is not None


def count_rows(cur: psycopg.Cursor, table: str) -> int:
    cur.execute(sql.SQL("SELECT COUNT(*) FROM {}").format(sql.Identifier(table)))
    row = cur.fetchone()
    return int(row[0]) if row else 0


def classifiers_empty(cur: psycopg.Cursor) -> bool:
    return count_rows(cur, "machine_classifier") == 0 and count_rows(cur, "work_classifier") == 0


def drop_app_tables(cur: psycopg.Cursor) -> None:
    log("Сброс таблиц...")
    cur.execute(
        sql.SQL("DROP TABLE IF EXISTS {} CASCADE").format(
            sql.SQL(", ").join(sql.Identifier(name) for name in APP_TABLES)
        )
    )


def truncate_classifiers(cur: psycopg.Cursor) -> None:
    log("Перезагрузка классификаторов...")
    cur.execute("TRUNCATE work_classifier, machine_classifier CASCADE")


def list_migrations() -> list[tuple[str, Path]]:
    if not MIGRATIONS_DIR.is_dir():
        raise SystemExit(f"Нет каталога миграций: {MIGRATIONS_DIR}")
    migrations = [
        (path.stem, path)
        for path in sorted(MIGRATIONS_DIR.iterdir())
        if path.is_file() and MIGRATION_NAME_RE.match(path.name)
    ]
    if not migrations:
        raise SystemExit(f"В {MIGRATIONS_DIR} нет файлов вида 001_имя.sql")
    return migrations


def applied_versions(cur: psycopg.Cursor) -> set[str]:
    cur.execute("SELECT version FROM schema_migrations")
    return {row[0] for row in cur.fetchall()}


def stamp_legacy_schema(cur: psycopg.Cursor, first_version: str) -> None:
    if not table_exists(cur, "machine_classifier"):
        return
    if first_version in applied_versions(cur):
        return
    cur.execute("INSERT INTO schema_migrations (version) VALUES (%s)", (first_version,))
    log(f"Существующая схема помечена как {first_version}, файл не выполнялся")


def apply_migrations(cur: psycopg.Cursor) -> None:
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS schema_migrations (
            version TEXT PRIMARY KEY,
            applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
        """
    )
    migrations = list_migrations()
    stamp_legacy_schema(cur, migrations[0][0])
    applied = applied_versions(cur)
    pending = 0
    for version, path in migrations:
        if version in applied:
            continue
        log(f"Миграция {path.name}...")
        cur.execute(path.read_text(encoding="utf-8"))
        cur.execute("INSERT INTO schema_migrations (version) VALUES (%s)", (version,))
        pending += 1
    if pending == 0:
        log("Новых миграций нет")


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
                log(f"Пропущен повтор кода машины: {code}")
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
        log(f"Пропущено повторов кода машины между разделами: {skipped_duplicate_codes}")
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


def copy_rows(
    cur: psycopg.Cursor,
    table: str,
    columns: tuple[str, ...],
    rows: Iterator[tuple[object, ...]] | list[tuple[object, ...]],
) -> None:
    with cur.copy(copy_sql(table, columns)) as copy:
        for row in rows:
            copy.write_row(row)


def seed_classifiers(cur: psycopg.Cursor) -> set[str]:
    require_file(MACHINES_PATH)
    require_file(
        CLASSIFIER_PATH,
        "Соберите его командой:\n  python scripts/parse_gesn_classifier.py",
    )

    log("Чтение классификатора машин...")
    machines, code_to_id = load_machines(MACHINES_PATH)
    log(f"Машин к загрузке: {len(machines)}")
    copy_rows(cur, "machine_classifier", MACHINE_COLUMNS, machines)
    log("Классификатор машин загружен")

    unknown_codes: set[str] = set()
    copy_rows(
        cur,
        "work_classifier",
        WORK_COLUMNS,
        iter_works(CLASSIFIER_PATH, code_to_id, unknown_codes),
    )
    log("Классификатор работ загружен")
    return unknown_codes


def print_counts(cur: psycopg.Cursor, unknown_codes: set[str] | None) -> None:
    print(f"machine_classifier: {count_rows(cur, 'machine_classifier')}")
    print(f"work_classifier: {count_rows(cur, 'work_classifier')}")
    if unknown_codes is not None:
        print(f"Неизвестных кодов машин: {len(unknown_codes)}")


def main() -> int:
    args = parse_args()
    if not args.skip_up:
        compose_up()

    config = DbConfig.from_env()
    log(f"Подключение к {config.host}:{config.port}/{config.dbname}...")
    with connect(config) as conn:
        with conn.cursor() as cur:
            if args.reset:
                drop_app_tables(cur)
            apply_migrations(cur)

            unknown_codes: set[str] | None = None
            if args.reload and not classifiers_empty(cur):
                truncate_classifiers(cur)
            if classifiers_empty(cur):
                unknown_codes = seed_classifiers(cur)
            else:
                log("Классификаторы уже загружены, пропуск")
            print_counts(cur, unknown_codes)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
