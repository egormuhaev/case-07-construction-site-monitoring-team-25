from sklearn.decomposition import PCA
from transformers import AutoModel

from ..config import DINOV2_WEIGHTS_DIR


def load_model(model_id: str):
    model = AutoModel.from_pretrained(model_id)
    DINOV2_WEIGHTS_DIR.mkdir(parents=True, exist_ok=True)
    model.save_pretrained(DINOV2_WEIGHTS_DIR)
    return model


def embedding_model(model_id: str):
    if not DINOV2_WEIGHTS_DIR.exists():
        return load_model(model_id)
    return AutoModel.from_pretrained(DINOV2_WEIGHTS_DIR, local_files_only=True)


def reduce_embeddings(embeddings, n_components: int = 8):
    pca = PCA(n_components=n_components, random_state=42)
    reduced_embeddings = pca.fit_transform(embeddings)

    print(f"Форма {reduced_embeddings.shape}")
    print(f"Сохранение информации: {pca.explained_variance_ratio_.sum() * 100}")

    return reduced_embeddings
