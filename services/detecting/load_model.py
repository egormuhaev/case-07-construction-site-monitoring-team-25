from pathlib import Path

from huggingface_hub import snapshot_download

from .config import WEIGHTS_DIR


def load_model(model_id: str, filename: str | None = None) -> Path:
    model_dir = WEIGHTS_DIR / model_id.replace("/", "-").lower().strip()
    target = model_dir / filename if filename else model_dir

    if filename and target.is_file():
        return target
    if filename is None and _is_downloaded(model_dir):
        return model_dir

    model_dir.mkdir(parents=True, exist_ok=True)
    snapshot_download(
        repo_id=model_id,
        local_dir=str(model_dir),
        allow_patterns=[filename] if filename else None,
    )

    if filename and not target.is_file():
        raise FileNotFoundError(f"В репозитории {model_id} нет файла {filename}")
    if filename is None and not _is_downloaded(model_dir):
        raise FileNotFoundError(f"Не удалось скачать модель {model_id} в {model_dir}")

    print(f"Модель {model_id} загружена по пути: {target}")
    return target


def _is_downloaded(model_dir: Path) -> bool:
    return model_dir.is_dir() and any(path.is_file() for path in model_dir.rglob("*"))
