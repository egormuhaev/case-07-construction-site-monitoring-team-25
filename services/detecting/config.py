from pathlib import Path

import torch

SERVICE_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = SERVICE_DIR.parent.parent

DATASET_DIR = PROJECT_ROOT / "dataset"
WEIGHTS_DIR = PROJECT_ROOT / "weights"
TEST_DATASET_DIR = DATASET_DIR / "test-dataset"
DINOV2_WEIGHTS_DIR = WEIGHTS_DIR / "dinov2_small"

EMBED_MODEL_ID = "facebook/dinov2-small"
TARGET_SIZE = 224
EMBED_BATCH_SIZE = 16
PCA_COMPONENTS = 32


def get_device() -> torch.device:
    if torch.backends.mps.is_available():
        return torch.device("mps")
    if torch.cuda.is_available():
        return torch.device("cuda")
    return torch.device("cpu")
