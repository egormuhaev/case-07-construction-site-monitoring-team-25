#!/usr/bin/env python3
"""Нормализовать названия работ классификатора через LLM polza.ai.

Колонки сферы, раздела, секции, подсекции, таблицы и нормы сжимаются
в одну фразу без повторов, размеров и примеров.
Результат перезаписывает work_classifier_normalized.

  python scripts/normalize_classifier.py
  python scripts/normalize_classifier.py --limit 20

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
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

import psycopg

ROOT = Path(__file__).resolve().parent.parent

API_URL = "https://polza.ai/api/v1/chat/completions"
DEFAULT_MODEL = "openai/gpt-4.1-nano"
BATCH_SIZE = 500
WORKERS = 8
REQUEST_TIMEOUT = 300
REQUEST_ATTEMPTS = 4
NAME_COLUMNS = (
    ("table_name", "таблица"),
    ("work_name", "норма"),
    ("subsection", "подсекция"),
    ("section", "секция"),
    ("department", "раздел"),
    ("sphere", "сфера"),
)
STOP_WORDS = {
    "и", "в", "во", "на", "для", "по", "с", "со", "из", "от", "или",
    "а", "к", "ко", "о", "об", "при", "до", "не", "более", "менее",
}
WORD_RE = re.compile(r"[0-9a-zа-яё-]+", re.IGNORECASE)
MEASURE_RE = re.compile(
    r"(?:,\s*)?(?:грузоподъемность|диаметр\w*|глубин\w*|ширин\w*|толщин\w*|"
    r"масс\w*|давлени\w*|площад\w*|вместимост\w*|мощност\w*|высот\w*)"
    r"\s*:?\s*(?:до|более|свыше|не более|не менее)?\s*"
    r"\d+(?:[.,]\d+)?(?:\s*[-–]\s*\d+(?:[.,]\d+)?)?"
    r"(?:\s*(?:мм|см|м2|м3|м|т|кг|квт|мпа|%))?",
    re.IGNORECASE,
)
SYSTEM_PROMPT = """Ты собираешь одно название строительной работы из кусков классификатора.
Куски идут от частного к общему: таблица, норма, подсекция, секция, раздел, сфера.
Собери фразу, похожую на название работы календарного плана.
Правила:
- действие — отглагольное существительное: монтаж, устройство, прокладка, разработка, окраска, укладка
- дальше объект и только те уточнения, без которых работу нельзя отличить от соседней: материал, тип конструкции, способ, место
- не повторяй слово, которое уже есть в фразе
- не добавляй сферу, раздел и секцию, если действие и объект уже есть в таблице или норме
- убери размеры, диаметры, марки, массу, давление, количество, «до N», «более N», коды и единицы измерения
- убери примеры, перечисления в скобках и пояснения после двоеточия, если это иллюстрация, а не сам объект
- если в названии две разные работы через «и», оставь обе части
Не выдумывай того, чего нет во входе.
Пример:
таблица: Разработка грунта внутри здания. норма: Разработка и обратная засыпка грунта вручную внутри здания в котлованах глубиной до 3 м. секция: Земляные работы
-> разработка и обратная засыпка грунта вручную внутри здания в котловане
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
        port=os.environ.get("POSTGRES_PORT", "12432"),
        user=os.environ.get("POSTGRES_USER", "admin"),
        password=os.environ.get("POSTGRES_PASSWORD", "admin_password"),
        dbname=os.environ.get("POSTGRES_DB", "monitoring_db"),
    )


def clean_text(value: object) -> str:
    text = " ".join(str(value or "").split())
    text = MEASURE_RE.sub("", text)
    text = text.replace(":", " ")
    return " ".join(text.strip(" ,;").split())


def words(text: str) -> set[str]:
    return {
        word.lower().replace("ё", "е")
        for word in WORD_RE.findall(text)
        if len(word) > 2 and word.lower().replace("ё", "е") not in STOP_WORDS
    }


def combined_name(row: dict) -> str:
    parts: list[str] = []
    covered: set[str] = set()
    for column, label in NAME_COLUMNS:
        text = clean_text(row.get(column))
        fresh = words(text) - covered
        if not text or not fresh:
            continue
        parts.append(f"{label}: {text}")
        covered.update(words(text))
    return ". ".join(parts)


def load_works(limit: int | None) -> list[dict]:
    query = """
        SELECT id, sphere, department, section, subsection, table_name, work_name
        FROM work_classifier
        ORDER BY id
    """
    params: tuple[object, ...] = ()
    if limit is not None:
        query += " LIMIT %s"
        params = (limit,)
    with connect() as conn:
        with conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
            cur.execute(query, params)
            return [
                {"id": row["id"], "name": combined_name(row)}
                for row in cur.fetchall()
            ]


def unique_names(works: list[dict]) -> list[dict]:
    names = dict.fromkeys(row["name"] for row in works)
    return [{"id": name, "name": name} for name in names]


def expand_names(
    works: list[dict], normalized_by_name: dict[str, str]
) -> list[tuple[object, str]]:
    return [(row["id"], normalized_by_name[row["name"]]) for row in works]


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
            if exc.code == 400 and "context length" in detail.lower():
                raise ValueError(last_error) from exc
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
        log(f"Пакет из {len(rows)} не обработан ({exc}), делю пополам")
        left = normalize_batch(rows[:middle], token, model)
        right = normalize_batch(rows[middle:], token, model)
        return left + right


def normalize_chunk(
    number: int,
    total: int,
    rows: list[dict],
    token: str,
    model: str,
) -> list[tuple[object, str]]:
    log(f"Пакет {number}/{total}: {len(rows)} названий")
    normalized = normalize_batch(rows, token, model)
    log(f"Пакет {number}/{total} готов")
    return normalized


def normalize_works(
    rows: list[dict],
    token: str,
    model: str,
    batch_size: int,
    workers: int,
) -> list[tuple[object, str]]:
    chunks = list(batches(rows, batch_size))
    total = len(chunks)
    normalized: list[tuple[object, str]] = []
    with ThreadPoolExecutor(max_workers=workers) as executor:
        futures = [
            executor.submit(normalize_chunk, number, total, chunk, token, model)
            for number, chunk in enumerate(chunks, start=1)
        ]
        for future in as_completed(futures):
            normalized.extend(future.result())
    return normalized


def save_names(rows: list[tuple[object, str]]) -> None:
    with connect() as conn:
        with conn.cursor() as cur:
            cur.execute("TRUNCATE work_classifier_normalized")
            cur.executemany(
                """
                INSERT INTO work_classifier_normalized (work_classifier_id, work_normalized_name)
                VALUES (%s, %s)
                """,
                rows,
            )


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Нормализовать названия классификатора через polza.ai"
    )
    parser.add_argument(
        "--model",
        default=os.environ.get("POLZA_AI_MODEL", DEFAULT_MODEL),
        help="ID модели polza.ai. Иначе POLZA_AI_MODEL или openai/gpt-4.1-nano",
    )
    parser.add_argument(
        "--limit",
        type=int,
        help="Сколько записей классификатора обработать. Без флага обрабатываются все",
    )
    parser.add_argument(
        "--batch-size",
        type=int,
        default=BATCH_SIZE,
        help="Сколько уникальных названий отправлять в одном запросе",
    )
    parser.add_argument(
        "--workers",
        type=int,
        default=WORKERS,
        help="Сколько запросов отправлять одновременно",
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
    if args.workers < 1:
        log("--workers должен быть больше 0")
        return 1

    works = load_works(args.limit)
    if not works:
        log("В work_classifier нет записей")
        return 0

    names = unique_names(works)
    log(f"К нормализации: {len(works)} записей, уникальных названий: {len(names)}")
    try:
        normalized_names = normalize_works(
            names, token, args.model, args.batch_size, args.workers
        )
    except RuntimeError as exc:
        log(str(exc))
        return 1

    by_name = dict(normalized_names)
    normalized = expand_names(works, by_name)
    save_names(normalized)
    if args.limit is not None:
        names = {row["id"]: row["name"] for row in works}
        for work_id, normalized_name in normalized:
            print(f"{names[work_id]}  ->  {normalized_name}")
    print(f"В work_classifier_normalized записано: {len(normalized)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
