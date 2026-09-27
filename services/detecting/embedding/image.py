from sklearn.decomposition import PCA
from transformers import AutoModel

from ..config import EMBED_MODEL_ID
from ..load_model import load_model
from ..log import get_logger

logger = get_logger("embedding")


def embedding_model(model_id: str = EMBED_MODEL_ID):
    model_path = load_model(model_id)
    return AutoModel.from_pretrained(model_path)


def reduce_embeddings(embeddings, n_components: int = 8):
    pca = PCA(n_components=n_components, random_state=42)
    reduced_embeddings = pca.fit_transform(embeddings)

    logger.info(
        "PCA: форма %s, сохранено %.1f%% дисперсии",
        reduced_embeddings.shape,
        pca.explained_variance_ratio_.sum() * 100,
    )

    return reduced_embeddings
