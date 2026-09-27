#!/usr/bin/env python3
"""Снять согласованный дамп классификаторов из текущей БД.

Пишет gzip CSV (COPY) в dataset/dumps/:
  machine_classifier.csv.gz
  work_classifier.csv.gz
  work_classifier_normalized.csv.gz
  work_classifier_vector.csv.gz

UUID и FK сохраняются — seed грузит эти файлы напрямую без rematch.

  python scripts/export_classifier_dumps.py
  make dump-classifiers
"""

from __future__ import annotations

import gzip
import os
import sys
import time
from pathlib import Path

import psycopg
from psycopg import sql

ROOT = Path(__file__).resolve().parent.parent
DUMPS_DIR = ROOT / "dataset" / "dumps"
CONNECT_ATTEMPTS = 20

TABLES: tuple[tuple[str, tuple[str, ...]], ...] = (
    (
        "machine_classifier",
        ("id", "classifier_id", "section", "group_name", "code", "name"),
    ),
    (
        "work_classifier",
        (
            "id",
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
        ),
    ),
    (
        "work_classifier_normalized",
        ("id", "work_classifier_id", "work_normalized_name"),
    ),
    (
        "work_classifier_vector",
        ("id", "classifier_id", "vector", "embedding_name"),
    ),
)


def log(message: str) -> None:
    print(message, file=sys.stderr)


def db_kwargs() -> dict[str, str]:
    return {
        "host": os.environ.get("POSTGRES_HOST", "localhost"),
        "port": os.environ.get("POSTGRES_PORT", "5432"),
        "user": os.environ.get("POSTGRES_USER", "admin"),
        "password": os.environ.get("POSTGRES_PASSWORD", "admin_password"),
        "dbname": os.environ.get("POSTGRES_DB", "monitoring_db"),
    }


def connect() -> psycopg.Connection:
    last_error: Exception | None = None
    cfg = db_kwargs()
    for attempt in range(1, CONNECT_ATTEMPTS + 1):
        try:
            return psycopg.connect(connect_timeout=3, **cfg)
        except psycopg.OperationalError as exc:
            last_error = exc
            log(f"Postgres недоступен ({attempt}/{CONNECT_ATTEMPTS}), жду...")
            time.sleep(1)
    raise SystemExit(f"Не удалось подключиться к Postgres: {last_error}")


def copy_to_gzip(cur: psycopg.Cursor, table: str, columns: tuple[str, ...], path: Path) -> int:
    query = sql.SQL("COPY {} ({}) TO STDOUT WITH (FORMAT csv, HEADER true)").format(
        sql.Identifier(table),
        sql.SQL(", ").join(sql.Identifier(name) for name in columns),
    )
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    rows = 0
    with gzip.open(tmp, "wt", encoding="utf-8", compresslevel=6) as handle:
        with cur.copy(query) as copy:
            while data := copy.read():
                text = bytes(data).decode("utf-8")
                handle.write(text)
                # HEADER + data rows: count newlines after first write batch is messy;
                # count via SQL below instead.
    tmp.replace(path)
    cur.execute(sql.SQL("SELECT COUNT(*) FROM {}").format(sql.Identifier(table)))
    row = cur.fetchone()
    rows = int(row[0]) if row else 0
    return rows


def main() -> int:
    cfg = db_kwargs()
    log(f"Экспорт из {cfg['host']}:{cfg['port']}/{cfg['dbname']} → {DUMPS_DIR}")
    with connect() as conn:
        with conn.cursor() as cur:
            for table, columns in TABLES:
                path = DUMPS_DIR / f"{table}.csv.gz"
                log(f"  {table} → {path.name}...")
                count = copy_to_gzip(cur, table, columns, path)
                size_mb = path.stat().st_size / (1024 * 1024)
                log(f"    {count} строк, {size_mb:.1f} MiB")
    log("Готово. Seed подхватит эти файлы автоматически.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
