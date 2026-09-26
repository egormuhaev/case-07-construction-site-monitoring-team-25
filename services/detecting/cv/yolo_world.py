from typing import Any

from ..config import CLIP_MODEL_ID
from ..embedding.text import encode_texts


def set_classes(model: Any, classes: list[str]) -> None:
    embeddings = encode_texts(classes, CLIP_MODEL_ID)
    embeddings = embeddings.to(next(model.model.parameters()).device)
    model.model.txt_feats = embeddings.unsqueeze(0)
    model.model.model[-1].nc = len(classes)
    model.model.names = classes
    if getattr(model, "predictor", None):
        model.predictor.model.names = classes
