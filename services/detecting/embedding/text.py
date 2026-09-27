import torch
from sentence_transformers import SentenceTransformer

from ..load_model import load_model


def encode_texts(texts: list[str], model_id: str) -> torch.Tensor:
    model_path = load_model(model_id)
    model = SentenceTransformer(str(model_path))
    embeddings = model.encode(texts, normalize_embeddings=True, convert_to_tensor=True)
    if not isinstance(embeddings, torch.Tensor):
        raise TypeError(f"ожидался Tensor, получили {type(embeddings)}")
    return embeddings
