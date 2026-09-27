from pathlib import Path

from huggingface_hub import snapshot_download

from .config import WEIGHTS_DIR
from .log import get_logger

logger = get_logger("weights")

# Любой из этих суффиксов означает, что веса реально на диске
# (config/tokenizer без них — оборванная закачка).
_WEIGHT_SUFFIXES = (
    ".safetensors",
    ".bin",
    ".pt",
    ".pth",
    ".ckpt",
    ".onnx",
    ".msgpack",
)


def load_model(model_id: str, filename: str | None = None) -> Path:
    model_dir = WEIGHTS_DIR / model_id.replace("/", "-").lower().strip()
    target = model_dir / filename if filename else model_dir

    if filename and target.is_file():
        logger.info("веса уже есть: %s", target)
        return target
    if filename is None and _is_downloaded(model_dir):
        logger.info("веса уже есть: %s", model_dir)
        return model_dir

    model_dir.mkdir(parents=True, exist_ok=True)
    logger.info("скачивание модели %s → %s", model_id, target)
    snapshot_download(
        repo_id=model_id,
        local_dir=str(model_dir),
        allow_patterns=[filename] if filename else None,
    )

    if filename and not target.is_file():
        raise FileNotFoundError(f"В репозитории {model_id} нет файла {filename}")
    if filename is None and not _is_downloaded(model_dir):
        raise FileNotFoundError(f"Не удалось скачать модель {model_id} в {model_dir}")

    logger.info("модель %s загружена: %s", model_id, target)
    return target


def _is_downloaded(model_dir: Path) -> bool:
    if not model_dir.is_dir():
        return False
    return any(
        path.is_file() and path.suffix.lower() in _WEIGHT_SUFFIXES
        for path in model_dir.rglob("*")
        if ".cache" not in path.parts
    )
