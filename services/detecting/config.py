import os
from datetime import date, time
from pathlib import Path

import torch

SERVICE_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = SERVICE_DIR.parent.parent

DATASET_DIR = PROJECT_ROOT / "dataset"
WEIGHTS_DIR = Path(os.environ.get("DETECTING_WEIGHTS_DIR", str(SERVICE_DIR / "weights")))
CACHE_DIR = Path(os.environ.get("DETECTING_CACHE_DIR", str(SERVICE_DIR / ".cache")))
TEST_DATASET_DIR = DATASET_DIR / "test-dataset"
REPORT_DIR = Path(os.environ.get("DETECTING_REPORT_DIR", str(DATASET_DIR / "reports")))

EMBED_MODEL_ID = "facebook/dinov2-small"
CLIP_MODEL_ID = "sentence-transformers/clip-ViT-B-32"
CV_MODEL_1 = "architchitte/Construction-Hazard-Detection"
CV_MODEL_2 = "uisikdag/yolo-v5-construction-machine-detection"
CV_MODEL_3 = "Bingsu/yolo-world-mirror"
TARGET_SIZE = 224
EMBED_BATCH_SIZE = 16
PCA_COMPONENTS = 32
DATASET_DAY = date(2025, 1, 1)
DAY_START = time(8, 0)
DAY_END = time(18, 0)


def get_device() -> torch.device:
    if torch.backends.mps.is_available():
        return torch.device("mps")
    if torch.cuda.is_available():
        return torch.device("cuda")
    return torch.device("cpu")
