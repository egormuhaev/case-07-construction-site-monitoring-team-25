from __future__ import annotations

import json
import logging
import os
import re
import time
import urllib.error
import urllib.request
from collections.abc import Iterator

from planning.settings import Settings

logger = logging.getLogger("planning.normalize")

SYSTEM_PROMPT = """Ты приводишь название строительной работы к одной короткой фразе.
Сохрани суть: что делают и с чем. Оставь слова, которые отличают эту работу от похожих.
Пиши так:
- действие — отглагольное существительное: монтаж, устройство, прокладка, разработка, окраска, укладка
- дальше объект с нужными определениями
- если в названии две разные работы через «и», оставь обе части
Убери только размеры, диаметры, марки, давление, количество, коды, единицы измерения и номера этажей.
Не сжимай фразу до общих слов, если во входе было точнее. Не выдумывай того, чего нет.
Верни JSON {"items": [{"id": "<id из входа>", "name": "<фраза>"}]}.
Число элементов и id должны совпасть со входом."""


def normalize_names(names: list[str], settings: Settings) -> list[str]:
    if not settings.normalize_enabled:
        return list(names)
    token = settings.llm_token or os.environ.get("POLZA_AI_TOKEN")
    if not token:
        logger.warning("PLANNING_NORMALIZE_ENABLED, но нет PLANNING_LLM_TOKEN — оставляем сырые названия")
        return list(names)
    rows = [{"id": str(index), "name": name} for index, name in enumerate(names, start=1)]
    mapping = {item_id: name for item_id, name in _normalize_works(rows, token, settings)}
    return [mapping.get(str(index), names[index - 1]) for index in range(1, len(names) + 1)]


def _batches(rows: list[dict], size: int) -> Iterator[list[dict]]:
    for start in range(0, len(rows), size):
        yield rows[start : start + size]


def _message_content(message: object) -> str:
    content = message.get("content") if isinstance(message, dict) else None
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts = [part.get("text", "") for part in content if isinstance(part, dict)]
        return "".join(parts)
    return ""


def _parse_items(content: str) -> dict[str, str]:
    text = content.strip()
    fenced = re.fullmatch(r"```(?:json)?\s*(.*?)\s*```", text, re.DOTALL)
    if fenced:
        text = fenced.group(1).strip()
    start = text.find("{")
    end = text.rfind("}")
    if start == -1 or end < start:
        raise ValueError("в ответе нет JSON")
    payload = json.loads(text[start : end + 1])
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


def _chat(settings: Settings, token: str, prompt: str, max_tokens: int) -> str:
    payload = {
        "model": settings.llm_model,
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
        settings.llm_url,
        data=data,
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
        method="POST",
    )
    delay = 2.0
    last_error = "llm не ответил"
    for attempt in range(4):
        try:
            with urllib.request.urlopen(request, timeout=300) as response:
                body = json.loads(response.read().decode("utf-8"))
            choices = body.get("choices") or []
            if not choices:
                raise ValueError("пустой ответ модели")
            return _message_content(choices[0].get("message"))
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode("utf-8", errors="replace")[:500]
            last_error = f"llm ответил {exc.code}: {detail}"
            if exc.code not in {429, 500, 502, 503, 504} or attempt == 3:
                raise RuntimeError(last_error) from exc
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError, ValueError) as exc:
            last_error = f"llm: {exc}"
            if attempt == 3:
                raise RuntimeError(last_error) from exc
        logger.warning("%s. повтор через %.0f с", last_error, delay)
        time.sleep(delay)
        delay *= 2
    raise RuntimeError(last_error)


def _request_batch(rows: list[dict], token: str, settings: Settings) -> list[tuple[str, str]]:
    lines = [f"{index}\t{row['name']}" for index, row in enumerate(rows, start=1)]
    prompt = "Нормализуй каждое название. id — номер строки.\n" + "\n".join(lines)
    content = _chat(settings, token, prompt, max_tokens=max(256, len(rows) * 48))
    names = _parse_items(content)
    missing = [str(index) for index in range(1, len(rows) + 1) if str(index) not in names]
    if missing:
        raise ValueError(f"нет id: {', '.join(missing[:8])}")
    return [(row["id"], names[str(index)]) for index, row in enumerate(rows, start=1)]


def _normalize_batch(rows: list[dict], token: str, settings: Settings) -> list[tuple[str, str]]:
    try:
        return _request_batch(rows, token, settings)
    except ValueError as exc:
        if len(rows) == 1:
            raise RuntimeError(f"не удалось нормализовать: {exc}") from exc
        middle = len(rows) // 2
        return _normalize_batch(rows[:middle], token, settings) + _normalize_batch(
            rows[middle:], token, settings
        )


def _normalize_works(rows: list[dict], token: str, settings: Settings) -> list[tuple[str, str]]:
    result: list[tuple[str, str]] = []
    chunks = list(_batches(rows, 80))
    for number, chunk in enumerate(chunks, start=1):
        logger.info("нормализация: пакет %d/%d", number, len(chunks))
        result.extend(_normalize_batch(chunk, token, settings))
    return result
