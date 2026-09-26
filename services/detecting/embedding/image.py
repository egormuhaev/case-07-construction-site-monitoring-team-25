from sklearn.decomposition import PCA
from transformers import AutoModel

from ..config import EMBED_MODEL_ID
from ..load_model import load_model


def embedding_model(model_id: str = EMBED_MODEL_ID):
    model_path = load_model(model_id)
    return AutoModel.from_pretrained(model_path)


def reduce_embeddings(embeddings, n_components: int = 8):
    pca = PCA(n_components=n_components, random_state=42)
    reduced_embeddings = pca.fit_transform(embeddings)

    print(f"Форма {reduced_embeddings.shape}")
    print(f"Сохранение информации: {pca.explained_variance_ratio_.sum() * 100}")

    return reduced_embeddings
