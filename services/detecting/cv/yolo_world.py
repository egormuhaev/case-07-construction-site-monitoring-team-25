import hashlib
import json
from typing import Any

import torch

from ..config import CACHE_DIR, CLIP_MODEL_ID
from ..embedding.text import encode_texts
from ..log import get_logger

CACHE_FILE = CACHE_DIR / "yolo-world-txt-feats.pt"
logger = get_logger("yolo_world")


def set_classes(model: Any, classes: list[str]) -> None:
    checksum = _checksum(classes)
    embeddings = _load_cached(checksum)
    if embeddings is None:
        logger.info("кэш txt-эмбеддингов промах, считаем CLIP")
        embeddings = encode_texts(classes, CLIP_MODEL_ID).cpu()
        _save_cached(checksum, embeddings)
    else:
        logger.info("кэш txt-эмбеддингов попадание")
    embeddings = embeddings.to(next(model.model.parameters()).device)
    model.model.txt_feats = embeddings.unsqueeze(0)
    model.model.model[-1].nc = len(classes)
    model.model.names = classes
    if getattr(model, "predictor", None):
        model.predictor.model.names = classes


def _checksum(classes: list[str]) -> str:
    payload = json.dumps(
        {"model": CLIP_MODEL_ID, "classes": classes},
        ensure_ascii=False,
        separators=(",", ":"),
    )
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def _load_cached(checksum: str) -> torch.Tensor | None:
    if not CACHE_FILE.is_file():
        return None
    try:
        cached = torch.load(CACHE_FILE, map_location="cpu", weights_only=False)
    except Exception:
        logger.warning("не удалось прочитать кэш %s", CACHE_FILE)
        return None
    if not isinstance(cached, dict) or cached.get("checksum") != checksum:
        return None
    embeddings = cached.get("embeddings")
    if not isinstance(embeddings, torch.Tensor):
        return None
    return embeddings


def _save_cached(checksum: str, embeddings: torch.Tensor) -> None:
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    torch.save({"checksum": checksum, "embeddings": embeddings.cpu()}, CACHE_FILE)
    logger.info("кэш txt-эмбеддингов записан: %s", CACHE_FILE)
