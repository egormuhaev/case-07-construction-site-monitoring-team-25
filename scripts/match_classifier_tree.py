#!/usr/bin/env python3
"""Сопоставить работы плана с классификатором обходом дерева.

На каждом уровне модель оставляет две ветки. Вниз идём по всем.
Если листьев больше трёх, сначала остаются три кандидата.
Затем модель выбирает одну норму или оставляет пустой результат.

  python scripts/match_classifier_tree.py
  python scripts/match_classifier_tree.py --limit 2

Токен: POLZA_AI_TOKEN. Модель по умолчанию — openai/gpt-4.1-nano.
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
from collections import defaultdict
from collections.abc import Iterator
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass, field
from pathlib import Path

import psycopg

ROOT = Path(__file__).resolve().parent.parent

API_URL = "https://polza.ai/api/v1/chat/completions"
DEFAULT_MODEL = "openai/gpt-4.1-nano"
BATCH_SIZE = 20
FINAL_BATCH_SIZE = 5
WORKERS = 4
TOP_K = 2
NARROW_TO = 3
REQUEST_TIMEOUT = 300
REQUEST_ATTEMPTS = 4
LEVELS = (
    ("sphere", "сфере"),
    ("section", "секции"),
    ("table_name", "таблице"),
    ("work_name", "норме"),
)
PATH_LABELS = ("сфера", "секция", "таблица", "норма")
SYSTEM_PROMPT = """Ты — эксперт-сметчик.
Выбирай только ID из переданного списка. Не выдумывай ID и не предлагай варианты вне списка.
Отвечай строго JSON без пояснений вокруг."""


@dataclass
class Item:
    key: str
    name: str
    work_ids: list[object]
    paths: list[tuple[str, ...]] = field(default_factory=lambda: [()])
    choice: tuple[str, ...] | None = None
    reason: str = ""


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


def load_works(limit: int | None) -> list[Item]:
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
        with conn.cursor() as cur:
            cur.execute(query, params)
            rows = cur.fetchall()
    ids_by_name: dict[str, list[object]] = {}
    order: list[str] = []
    for work_id, name in rows:
        text = " ".join(str(name or "").split())
        if text not in ids_by_name:
            order.append(text)
            ids_by_name[text] = []
        ids_by_name[text].append(work_id)
    return [
        Item(key=str(index), name=name, work_ids=ids_by_name[name])
        for index, name in enumerate(order, start=1)
    ]


def load_tree() -> dict:
    tree: dict = {}
    with connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id, sphere, section, table_name, work_name
                FROM work_classifier
                """
            )
            for classifier_id, sphere, section, table_name, work_name in cur.fetchall():
                node = tree.setdefault(sphere, {})
                node = node.setdefault(section or "", {})
                node = node.setdefault(table_name, {})
                node.setdefault(work_name, classifier_id)
    return tree


def children(tree: dict, path: tuple[str, ...]) -> list[str]:
    node: object = tree
    for part in path:
        if not isinstance(node, dict) or part not in node:
            return []
        node = node[part]
    if not isinstance(node, dict):
        return []
    return sorted(node.keys())


def classifier_id(tree: dict, path: tuple[str, ...]) -> object:
    node: object = tree
    for part in path:
        node = node[part]
    return node


def batches(items: list[Item], size: int) -> Iterator[list[Item]]:
    for start in range(0, len(items), size):
        yield items[start:start + size]


def option_label(value: str) -> str:
    return value or "(без секции)"


def path_text(path: tuple[str, ...]) -> str:
    return " / ".join(
        f"{PATH_LABELS[index]}: {option_label(part)}"
        for index, part in enumerate(path)
    )


def message_content(message: object) -> str:
    content = message.get("content") if isinstance(message, dict) else None
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return "".join(
            part.get("text", "")
            for part in content
            if isinstance(part, dict)
        )
    return ""


def parse_object(content: str) -> dict:
    text = content.strip()
    fenced = re.fullmatch(r"```(?:json)?\s*(.*?)\s*```", text, re.DOTALL)
    if fenced:
        text = fenced.group(1).strip()
    start = text.find("{")
    end = text.rfind("}")
    if start == -1 or end < start:
        raise ValueError("в ответе нет JSON")
    payload = json.loads(text[start:end + 1])
    if not isinstance(payload, dict):
        raise ValueError("в ответе нет объекта JSON")
    return payload


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


def choice_ids_from_rows(rows: list) -> list[str]:
    ids: list[str] = []
    for row in rows:
        if isinstance(row, dict):
            ids.append(str(row.get("id", "")).strip())
        elif row is not None:
            ids.append(str(row).strip())
    return [item_id for item_id in ids if item_id]


def work_selections(payload: dict, work_count: int) -> dict[str, list[str]]:
    rows = payload.get("items")
    if isinstance(rows, list):
        by_work: dict[str, list[str]] = {}
        nested = False
        for row in rows:
            if not isinstance(row, dict):
                continue
            has_selected = isinstance(row.get("selected"), list) or isinstance(
                row.get("selected_sections"), list
            )
            if not has_selected:
                continue
            nested = True
            item_id = str(row.get("id", "")).strip()
            if item_id:
                by_work[item_id] = raw_ids(row)
        if nested and work_count == 1 and "1" not in by_work:
            merged = [item_id for ids in by_work.values() for item_id in ids]
            return {"1": merged or list(by_work.keys())}
        if nested:
            return by_work
        if work_count == 1:
            return {"1": choice_ids_from_rows(rows)}
    top = payload.get("selected")
    if top is None:
        top = payload.get("selected_sections")
    if work_count == 1 and isinstance(top, list):
        return {"1": raw_ids({"selected": top})}
    if not isinstance(rows, list):
        raise ValueError("в ответе нет списка items")
    return {}


def raw_ids(entry: dict) -> list[str]:
    raw = entry.get("selected")
    if raw is None:
        raw = entry.get("selected_sections")
    ids: list[str] = []
    if isinstance(raw, list):
        for part in raw:
            if isinstance(part, dict):
                ids.append(str(part.get("id", "")).strip())
            elif part is not None:
                ids.append(str(part).strip())
        return [item_id for item_id in ids if item_id]
    choice = entry.get("choice")
    if choice is None:
        return []
    return [str(choice).strip()]


def take_options(raw: list[str], options: list, limit: int) -> list:
    picked: list = []
    for value in raw:
        text = value.strip().rstrip(".")
        text = re.sub(r"^id\s*:\s*", "", text, flags=re.IGNORECASE)
        if not text.isdigit():
            continue
        index = int(text)
        if not 1 <= index <= len(options):
            continue
        option = options[index - 1]
        if option not in picked:
            picked.append(option)
        if len(picked) == limit:
            break
    return picked


def ask(
    items: list[Item],
    options: list[str],
    path: tuple[str, ...],
    label: str,
    token: str,
    model: str,
) -> dict[str, list[str]]:
    option_lines = [
        f"{index}. ID: {index} | {option_label(option)}"
        for index, option in enumerate(options, start=1)
    ]
    work_lines = [
        f"{index}. ID: {index} | {item.name}"
        for index, item in enumerate(items, start=1)
    ]
    parent = ""
    if path:
        parent = "УЖЕ ВЫБРАННЫЙ ПУТЬ:\n" + path_text(path) + "\n\n"
    prompt = (
        "Ты — эксперт-сметчик. Твоя задача — определить, "
        f"в какой {label} классификатора может находиться каждая работа.\n\n"
        + parent
        + "ДОСТУПНЫЕ ВАРИАНТЫ:\n"
        + "\n".join(option_lines)
        + "\n\nРАБОТЫ:\n"
        + "\n".join(work_lines)
        + "\n\nИНСТРУКЦИЯ:\n"
        "Для каждой работы выбери ровно 2 разных варианта, в которых с наибольшей "
        "вероятностью может находиться эта работа. Один вариант недостаточен.\n"
        "Верни ответ СТРОГО в формате JSON: "
        "{\"items\": [{\"id\": \"<ID работы>\", \"selected\": "
        "[{\"id\": \"<ID варианта>\", \"reason\": \"<краткая причина>\"}]}]}\n"
        "Не выдумывай ID, которых нет в списке."
    )
    content = chat(token, model, prompt, max_tokens=max(512, len(items) * 120))
    try:
        payload = parse_object(content)
    except (json.JSONDecodeError, ValueError) as exc:
        raise ValueError(str(exc)) from exc
    by_id = work_selections(payload, len(items))
    selected: dict[str, list[str]] = {}
    missing: list[str] = []
    for index, item in enumerate(items, start=1):
        if str(index) not in by_id:
            missing.append(str(index))
            continue
        selected[item.key] = take_options(by_id[str(index)], options, TOP_K)
    if missing:
        raise ValueError(f"нет id: {', '.join(missing[:8])}")
    return selected


def choose_group(
    items: list[Item],
    options: list[str],
    path: tuple[str, ...],
    label: str,
    token: str,
    model: str,
    strict: bool = True,
) -> dict[str, list[str]]:
    try:
        selected = ask(items, options, path, label, token, model)
    except ValueError as exc:
        if len(items) == 1:
            raise RuntimeError(
                f"Не удалось выбрать {label} для «{items[0].name}»: {exc}"
            ) from exc
        middle = len(items) // 2
        log(f"Группа из {len(items)} не обработана ({exc}), делю пополам")
        left = choose_group(items[:middle], options, path, label, token, model, strict)
        right = choose_group(items[middle:], options, path, label, token, model, strict)
        return {**left, **right}
    needed = min(TOP_K, len(options))
    short = [item for item in items if len(selected[item.key]) < needed]
    if short and strict and needed > 1:
        log(f"для {len(short)} работ меньше {needed} веток, повторяю запрос")
        extra = choose_group(short, options, path, label, token, model, strict=False)
        for item in short:
            if len(extra[item.key]) > len(selected[item.key]):
                selected[item.key] = extra[item.key]
    empty = [item for item in items if not selected[item.key]]
    if not empty:
        return selected
    if len(items) == 1:
        raise RuntimeError(
            f"Не удалось выбрать {label} для «{items[0].name}»: нет ID из списка"
        )
    middle = len(empty) // 2 or 1
    log(f"У {len(empty)} работ нет варианта из списка, делю пополам")
    left = choose_group(empty[:middle], options, path, label, token, model, strict=False)
    right = choose_group(empty[middle:], options, path, label, token, model, strict=False)
    selected.update(left)
    selected.update(right)
    return selected


def choose_level(
    items: list[Item],
    tree: dict,
    label: str,
    token: str,
    model: str,
    batch_size: int,
    workers: int,
) -> None:
    groups: dict[tuple[str, ...], list[Item]] = defaultdict(list)
    for item in items:
        for path in item.paths:
            groups[path].append(item)
    tasks: list[tuple[tuple[str, ...], list[Item], list[str]]] = []
    collected: dict[str, list[tuple[str, ...]]] = defaultdict(list)
    for path, group in groups.items():
        options = children(tree, path)
        if not options:
            raise RuntimeError(f"Нет вариантов для пути {path_text(path) or 'корень'}")
        if len(options) == 1:
            for item in group:
                collected[item.key].append((*path, options[0]))
            log(f"{label}: {len(group)} работ, единственный вариант")
            continue
        for chunk in batches(group, batch_size):
            tasks.append((path, chunk, options))

    def run(
        path: tuple[str, ...],
        chunk: list[Item],
        options: list[str],
    ) -> list[tuple[str, tuple[str, ...]]]:
        log(f"{label}: {len(chunk)} работ, {len(options)} вариантов")
        selected = choose_group(chunk, options, path, label, token, model)
        extended: list[tuple[str, tuple[str, ...]]] = []
        for item in chunk:
            for option in selected[item.key]:
                extended.append((item.key, (*path, option)))
        return extended

    if tasks:
        with ThreadPoolExecutor(max_workers=workers) as executor:
            futures = [
                executor.submit(run, path, chunk, options)
                for path, chunk, options in tasks
            ]
            for future in as_completed(futures):
                for item_key, extended_path in future.result():
                    collected[item_key].append(extended_path)

    for item in items:
        unique: list[tuple[str, ...]] = []
        for path in collected[item.key]:
            if path not in unique:
                unique.append(path)
        if not unique:
            raise RuntimeError(f"Не осталось веток для «{item.name}»")
        item.paths = unique
    log(f"после уровня «{label}»: {sum(len(item.paths) for item in items)} веток")


def is_null_choice(value: object) -> bool:
    if value is None:
        return True
    return str(value).strip().lower() in {"", "null", "none", "нет"}


def ask_final(
    items: list[Item],
    token: str,
    model: str,
) -> dict[str, tuple[tuple[str, ...] | None, str]]:
    blocks: list[str] = []
    for index, item in enumerate(items, start=1):
        candidate_lines = [
            f"{number}. ID: {number} | {path_text(path)}"
            for number, path in enumerate(item.paths, start=1)
        ]
        blocks.append(
            f"{index}. РАБОТА ID: {index} | {item.name}\n"
            "КАНДИДАТЫ:\n"
            + "\n".join(candidate_lines)
        )
    prompt = (
        "Ты — эксперт-сметчик. Для каждой работы найдены несколько возможных норм.\n"
        "Сравни кандидатов между собой и выбери одну самую точную.\n"
        "Если вид работ или объект не совпадают с названием из плана, верни null. "
        "Похожие отдельные слова не делают норму подходящей.\n\n"
        + "\n\n".join(blocks)
        + "\n\nИНСТРУКЦИЯ:\n"
        "Верни ответ СТРОГО в формате JSON: "
        "{\"items\": [{\"id\": \"<ID работы>\", \"choice\": \"<ID кандидата или null>\", "
        "\"reason\": \"<краткая причина>\"}]}\n"
        "Не выдумывай ID, которых нет в списке."
    )
    content = chat(token, model, prompt, max_tokens=max(256, len(items) * 80))
    try:
        payload = parse_object(content)
    except (json.JSONDecodeError, ValueError) as exc:
        raise ValueError(str(exc)) from exc
    rows = payload.get("items")
    if not isinstance(rows, list):
        if len(items) == 1 and "choice" in payload:
            rows = [payload]
        else:
            raise ValueError("в ответе нет списка items")
    by_id: dict[str, dict] = {}
    for row in rows:
        if isinstance(row, dict):
            item_id = str(row.get("id", "")).strip()
            if item_id and item_id not in by_id:
                by_id[item_id] = row
    if len(items) == 1 and "1" not in by_id and "choice" in payload:
        by_id["1"] = payload
    selected: dict[str, tuple[tuple[str, ...] | None, str]] = {}
    missing: list[str] = []
    for index, item in enumerate(items, start=1):
        row = by_id.get(str(index))
        if row is None:
            missing.append(str(index))
            continue
        reason = str(row.get("reason") or "").strip()
        if is_null_choice(row.get("choice")):
            selected[item.key] = (None, reason)
            continue
        picked = take_options([str(row.get("choice")).strip()], item.paths, 1)
        if not picked:
            missing.append(str(index))
            continue
        selected[item.key] = (picked[0], reason)
    if missing:
        raise ValueError(f"нет id: {', '.join(missing[:8])}")
    return selected


def choose_final_group(
    items: list[Item],
    token: str,
    model: str,
) -> dict[str, tuple[tuple[str, ...] | None, str]]:
    try:
        return ask_final(items, token, model)
    except ValueError as exc:
        if len(items) == 1:
            raise RuntimeError(
                f"Не удалось сравнить нормы для «{items[0].name}»: {exc}"
            ) from exc
        middle = len(items) // 2
        log(f"Сравнение из {len(items)} не обработано ({exc}), делю пополам")
        left = choose_final_group(items[:middle], token, model)
        right = choose_final_group(items[middle:], token, model)
        return {**left, **right}


def ask_narrow(
    items: list[Item],
    token: str,
    model: str,
) -> dict[str, list[tuple[str, ...]]]:
    blocks: list[str] = []
    for index, item in enumerate(items, start=1):
        candidate_lines = [
            f"{number}. ID: {number} | {path_text(path)}"
            for number, path in enumerate(item.paths, start=1)
        ]
        blocks.append(
            f"{index}. РАБОТА ID: {index} | {item.name}\n"
            "КАНДИДАТЫ:\n"
            + "\n".join(candidate_lines)
        )
    prompt = (
        "Ты — эксперт-сметчик. Для каждой работы найдено много возможных норм.\n"
        f"Оставь ровно {NARROW_TO} наиболее вероятных кандидата, окончательный выбор ещё впереди.\n\n"
        + "\n\n".join(blocks)
        + "\n\nИНСТРУКЦИЯ:\n"
        "Верни ответ СТРОГО в формате JSON: "
        "{\"items\": [{\"id\": \"<ID работы>\", \"selected\": "
        "[{\"id\": \"<ID кандидата>\", \"reason\": \"<краткая причина>\"}]}]}\n"
        "Не выдумывай ID, которых нет в списке."
    )
    content = chat(token, model, prompt, max_tokens=max(512, len(items) * 160))
    try:
        payload = parse_object(content)
    except (json.JSONDecodeError, ValueError) as exc:
        raise ValueError(str(exc)) from exc
    by_id = work_selections(payload, len(items))
    selected: dict[str, list[tuple[str, ...]]] = {}
    missing: list[str] = []
    for index, item in enumerate(items, start=1):
        if str(index) not in by_id:
            missing.append(str(index))
            continue
        selected[item.key] = take_options(by_id[str(index)], item.paths, NARROW_TO)
    if missing:
        raise ValueError(f"нет id: {', '.join(missing[:8])}")
    return selected


def choose_narrow_group(
    items: list[Item],
    token: str,
    model: str,
    strict: bool = True,
) -> dict[str, list[tuple[str, ...]]]:
    try:
        selected = ask_narrow(items, token, model)
    except ValueError as exc:
        if len(items) == 1:
            raise RuntimeError(
                f"Не удалось сократить нормы для «{items[0].name}»: {exc}"
            ) from exc
        middle = len(items) // 2
        log(f"Сокращение из {len(items)} не обработано ({exc}), делю пополам")
        left = choose_narrow_group(items[:middle], token, model, strict)
        right = choose_narrow_group(items[middle:], token, model, strict)
        return {**left, **right}
    short = [item for item in items if len(selected[item.key]) < min(NARROW_TO, len(item.paths))]
    if short and strict:
        log(f"для {len(short)} работ меньше {NARROW_TO} кандидатов, повторяю")
        extra = choose_narrow_group(short, token, model, strict=False)
        for item in short:
            if len(extra[item.key]) > len(selected[item.key]):
                selected[item.key] = extra[item.key]
    empty = [item for item in items if not selected[item.key]]
    if not empty:
        return selected
    if len(items) == 1:
        raise RuntimeError(
            f"Не удалось сократить нормы для «{items[0].name}»: нет ID из списка"
        )
    middle = len(empty) // 2 or 1
    left = choose_narrow_group(empty[:middle], token, model, strict=False)
    right = choose_narrow_group(empty[middle:], token, model, strict=False)
    selected.update(left)
    selected.update(right)
    return selected


def narrow_leaves(
    items: list[Item],
    token: str,
    model: str,
    workers: int,
) -> None:
    wide = [item for item in items if len(item.paths) > NARROW_TO]
    if not wide:
        return
    chunks = list(batches(wide, FINAL_BATCH_SIZE))

    def run(chunk: list[Item]) -> dict[str, list[tuple[str, ...]]]:
        leaves = sum(len(item.paths) for item in chunk)
        log(f"сокращение норм: {len(chunk)} работ, {leaves} кандидатов")
        return choose_narrow_group(chunk, token, model)

    chosen: dict[str, list[tuple[str, ...]]] = {}
    with ThreadPoolExecutor(max_workers=workers) as executor:
        futures = [executor.submit(run, chunk) for chunk in chunks]
        for future in as_completed(futures):
            chosen.update(future.result())
    for item in wide:
        if chosen[item.key]:
            item.paths = chosen[item.key]


def finalize(
    items: list[Item],
    token: str,
    model: str,
    workers: int,
) -> None:
    narrow_leaves(items, token, model, workers)
    pending: list[Item] = []
    for item in items:
        if not item.paths:
            item.choice = None
            continue
        pending.append(item)
    if not pending:
        return
    chunks = list(batches(pending, FINAL_BATCH_SIZE))

    def run(chunk: list[Item]) -> dict[str, tuple[tuple[str, ...] | None, str]]:
        leaves = sum(len(item.paths) for item in chunk)
        log(f"сравнение норм: {len(chunk)} работ, {leaves} кандидатов")
        return choose_final_group(chunk, token, model)

    chosen: dict[str, tuple[tuple[str, ...] | None, str]] = {}
    with ThreadPoolExecutor(max_workers=workers) as executor:
        futures = [executor.submit(run, chunk) for chunk in chunks]
        for future in as_completed(futures):
            chosen.update(future.result())
    for item in pending:
        item.choice, item.reason = chosen[item.key]


def match_tree(
    items: list[Item],
    tree: dict,
    token: str,
    model: str,
    batch_size: int,
    workers: int,
) -> None:
    for _field_name, label in LEVELS:
        choose_level(items, tree, label, token, model, batch_size, workers)
    finalize(items, token, model, workers)


def save_matches(items: list[Item], tree: dict) -> list[tuple]:
    rows: list[tuple] = []
    for item in items:
        if item.choice is None:
            chosen_id = None
            sphere = section = table_name = work_name = None
        else:
            sphere, section, table_name, work_name = item.choice
            section = section or None
            chosen_id = classifier_id(tree, item.choice)
        for work_id in item.work_ids:
            rows.append(
                (
                    work_id,
                    chosen_id,
                    sphere,
                    section,
                    table_name,
                    work_name,
                )
            )
    with connect() as conn:
        with conn.cursor() as cur:
            cur.execute("TRUNCATE work_classifier_tree")
            cur.executemany(
                """
                INSERT INTO work_classifier_tree (
                    work_id, classifier_id, sphere, section, table_name, work_name
                )
                VALUES (%s, %s, %s, %s, %s, %s)
                """,
                rows,
            )
    return rows


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Сопоставить работы плана с классификатором по дереву"
    )
    parser.add_argument(
        "--model",
        default=os.environ.get("POLZA_AI_MODEL", DEFAULT_MODEL),
        help="ID модели polza.ai. Иначе POLZA_AI_MODEL или openai/gpt-4.1-nano",
    )
    parser.add_argument(
        "--limit",
        type=int,
        help="Сколько работ плана обработать. Без флага обрабатываются все",
    )
    parser.add_argument(
        "--batch-size",
        type=int,
        default=BATCH_SIZE,
        help="Сколько работ отправлять в одном запросе",
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
    if args.limit is not None and args.limit < 1:
        log("--limit должен быть больше 0")
        return 1
    if args.batch_size < 1:
        log("--batch-size должен быть больше 0")
        return 1
    if args.workers < 1:
        log("--workers должен быть больше 0")
        return 1

    items = load_works(args.limit)
    if not items:
        log("В work нет записей")
        return 0
    tree = load_tree()
    log(f"К сопоставлению: {sum(len(item.work_ids) for item in items)} работ")
    try:
        match_tree(items, tree, token, args.model, args.batch_size, args.workers)
    except RuntimeError as exc:
        log(str(exc))
        return 1

    rows = save_matches(items, tree)
    if args.limit is not None:
        reasons = {work_id: item.reason for item in items for work_id in item.work_ids}
        names = {work_id: item.name for item in items for work_id in item.work_ids}
        for work_id, _classifier_id, sphere, section, table_name, work_name in rows:
            if sphere is None:
                print(f"{names[work_id]}  ->  нет подходящей нормы")
            else:
                path = " / ".join(
                    part for part in (sphere, section, table_name, work_name) if part
                )
                print(f"{names[work_id]}  ->  {path}")
            if reasons[work_id]:
                print(f"  {reasons[work_id]}")
    missed = sum(1 for row in rows if row[1] is None)
    print(f"В work_classifier_tree записано: {len(rows)}, без нормы: {missed}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
