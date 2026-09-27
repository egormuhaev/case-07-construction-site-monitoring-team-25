#!/usr/bin/env python3
"""Нормализовать названия работ календарного плана через LLM polza.ai.

Название сжимается в короткую фразу: отглагольное существительное и объект
с определениями, которые отличают работу. Результат перезаписывает work_normalized.

  python scripts/normalize_work.py
  python scripts/normalize_work.py --limit 20

Токен: POLZA_AI_TOKEN. Модель по умолчанию — openai/gpt-4.1-nano.
Её можно сменить флагом --model или переменной POLZA_AI_MODEL.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
from collections.abc import Iterator
from pathlib import Path

import psycopg

ROOT = Path(__file__).resolve().parent.parent

API_URL = "https://polza.ai/api/v1/chat/completions"
DEFAULT_MODEL = "openai/gpt-4.1-nano"
BATCH_SIZE = 200
REQUEST_TIMEOUT = 300
REQUEST_ATTEMPTS = 4
SYSTEM_PROMPT = """Ты приводишь название строительной работы к одной короткой фразе.
Сохрани суть: что делают и с чем. Оставь слова, которые отличают эту работу от похожих.
Пиши так:
- действие — отглагольное существительное: монтаж, устройство, прокладка, разработка, окраска, укладка
- дальше объект с нужными определениями
- если в названии две разные работы через «и», оставь обе части
Убери только размеры, диаметры, марки, давление, количество, коды, единицы измерения и номера этажей.
Не сжимай фразу до общих слов, если во входе было точнее. Не выдумывай того, чего нет.
Примеры:
Прокладка кабельных трасс в гофрированных трубах -> прокладка кабельных трасс
Устройство стяжки пола из цементно-песчаного раствора толщиной 50 мм -> устройство стяжки пола из цементно-песчаного раствора
Ограждение строительной площадки и устройство временных дорог -> ограждение строительной площадки и устройство временных дорог
Верни JSON {\"items\": [{\"id\": \"<id из входа>\", \"name\": \"<фраза>\"}]}.
Число элементов и id должны совпасть со входом."""


def log(message: str) -> None:
    print(message, file=sys.stderr)


def load_env(path: Path) -> None:
    if not path.is_file():
        return
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip("\"'")
        if key:
            os.environ.setdefault(key, value)


def connect() -> psycopg.Connection:
    return psycopg.connect(
        host=os.environ.get("POSTGRES_HOST", "localhost"),
        port=os.environ.get("POSTGRES_PORT", "5432"),
        user=os.environ.get("POSTGRES_USER", "admin"),
        password=os.environ.get("POSTGRES_PASSWORD", "admin_password"),
        dbname=os.environ.get("POSTGRES_DB", "monitoring_db"),
    )


def load_works(limit: int | None) -> list[dict]:
    query = """
        SELECT id, name
        FROM work
        ORDER BY position
    """
    params: tuple[object, ...] = ()
    if limit is not None:
        query += " LIMIT %s"
        params = (limit,)
    with connect() as conn:
        with conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
            cur.execute(query, params)
            return [
                {"id": row["id"], "name": " ".join(
                    str(row["name"] or "").split())}
                for row in cur.fetchall()
            ]


def batches(rows: list[dict], size: int) -> Iterator[list[dict]]:
    for start in range(0, len(rows), size):
        yield rows[start:start + size]


def message_content(message: object) -> str:
    content = message.get("content") if isinstance(message, dict) else None
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts = [
            part.get("text", "")
            for part in content
            if isinstance(part, dict)
        ]
        return "".join(parts)
    return ""


def parse_items(content: str) -> dict[str, str]:
    text = content.strip()
    fenced = re.fullmatch(r"```(?:json)?\s*(.*?)\s*```", text, re.DOTALL)
    if fenced:
        text = fenced.group(1).strip()
    start = text.find("{")
    end = text.rfind("}")
    if start == -1 or end < start:
        raise ValueError("в ответе нет JSON")
    payload = json.loads(text[start:end + 1])
    items = payload.get("items")
    if not isinstance(items, list):
        raise ValueError("в ответе нет списка items")
    names: dict[str, str] = {}
    for item in items:
        if not isinstance(item, dict):
            continue
        item_id = str(item.get("id", "")).strip()
        name = " ".join(str(item.get("name") or "").split())
        if item_id and item_id not in names:
            names[item_id] = name
    return names


def chat(token: str, model: str, prompt: str, max_tokens: int) -> str:
    payload = {
        "model": model,
        "temperature": 0,
        "max_tokens": max_tokens,
        "response_format": {"type": "json_object"},
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": prompt},
        ],
    }
    data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    request = urllib.request.Request(
        API_URL,
        data=data,
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    delay = 2.0
    last_error = "polza.ai не ответил"
    for attempt in range(REQUEST_ATTEMPTS):
        try:
            with urllib.request.urlopen(request, timeout=REQUEST_TIMEOUT) as response:
                body = json.loads(response.read().decode("utf-8"))
            choices = body.get("choices") or []
            if not choices:
                raise ValueError("пустой ответ модели")
            return message_content(choices[0].get("message"))
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode("utf-8", errors="replace")[:500]
            last_error = f"polza.ai ответил {exc.code}: {detail}"
            if exc.code not in {429, 500, 502, 503, 504} or attempt + 1 == REQUEST_ATTEMPTS:
                raise RuntimeError(last_error) from exc
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError, ValueError) as exc:
            last_error = f"polza.ai: {exc}"
            if attempt + 1 == REQUEST_ATTEMPTS:
                raise RuntimeError(last_error) from exc
        log(f"{last_error}. Повтор через {delay:.0f} с")
        time.sleep(delay)
        delay *= 2
    raise RuntimeError(last_error)


def request_batch(rows: list[dict], token: str, model: str) -> list[tuple[object, str]]:
    lines = [
        f"{index}\t{row['name']}"
        for index, row in enumerate(rows, start=1)
    ]
    prompt = (
        "Нормализуй каждое название. id — номер строки.\n"
        + "\n".join(lines)
    )
    content = chat(token, model, prompt, max_tokens=max(256, len(rows) * 48))
    try:
        names = parse_items(content)
    except (json.JSONDecodeError, ValueError) as exc:
        raise ValueError(str(exc)) from exc
    missing = [str(index) for index in range(
        1, len(rows) + 1) if str(index) not in names]
    if missing:
        raise ValueError(f"нет id: {', '.join(missing[:8])}")
    return [
        (row["id"], names[str(index)])
        for index, row in enumerate(rows, start=1)
    ]


def normalize_batch(rows: list[dict], token: str, model: str) -> list[tuple[object, str]]:
    try:
        return request_batch(rows, token, model)
    except ValueError as exc:
        if len(rows) == 1:
            raise RuntimeError(
                f"Не удалось нормализовать запись {rows[0]['id']}: {exc}") from exc
        middle = len(rows) // 2
        log(f"Пакет из {len(rows)} не разобран ({exc}), делю пополам")
        left = normalize_batch(rows[:middle], token, model)
        right = normalize_batch(rows[middle:], token, model)
        return left + right


def normalize_works(rows: list[dict], token: str, model: str, batch_size: int) -> list[tuple[object, str]]:
    normalized: list[tuple[object, str]] = []
    chunks = list(batches(rows, batch_size))
    for number, chunk in enumerate(chunks, start=1):
        log(f"Пакет {number}/{len(chunks)}: {len(chunk)} записей")
        normalized.extend(normalize_batch(chunk, token, model))
    return normalized


def save_names(rows: list[tuple[object, str]]) -> None:
    with connect() as conn:
        with conn.cursor() as cur:
            cur.execute("TRUNCATE work_normalized")
            cur.executemany(
                """
                INSERT INTO work_normalized (work_id, normalized_name)
                VALUES (%s, %s)
                """,
                rows,
            )


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Нормализовать названия работ плана через polza.ai"
    )
    parser.add_argument(
        "--model",
        default=os.environ.get("POLZA_AI_MODEL", DEFAULT_MODEL),
        help="ID модели polza.ai. Иначе POLZA_AI_MODEL или openai/gpt-4.1-nano",
    )
    parser.add_argument(
        "--limit",
        type=int,
        help="Сколько работ обработать. Без флага обрабатываются все",
    )
    parser.add_argument(
        "--batch-size",
        type=int,
        default=BATCH_SIZE,
        help="Сколько названий отправлять в одном запросе",
    )
    return parser.parse_args()


def main() -> int:
    load_env(ROOT / ".env")
    args = parse_args()
    token = os.environ.get("POLZA_AI_TOKEN")
    if not token:
        log("Нет POLZA_AI_TOKEN")
        return 1
    if not args.model:
        log("Укажите модель: --model или POLZA_AI_MODEL")
        return 1
    if args.limit is not None and args.limit < 1:
        log("--limit должен быть больше 0")
        return 1
    if args.batch_size < 1:
        log("--batch-size должен быть больше 0")
        return 1

    works = load_works(args.limit)
    if not works:
        log("В work нет записей")
        return 0

    log(f"К нормализации: {len(works)}")
    try:
        normalized = normalize_works(works, token, args.model, args.batch_size)
    except RuntimeError as exc:
        log(str(exc))
        return 1

    save_names(normalized)
    if args.limit is not None:
        names = {row["id"]: row["name"] for row in works}
        for work_id, normalized_name in normalized:
            print(f"{names[work_id]}  ->  {normalized_name}")
    print(f"В work_normalized записано: {len(normalized)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
