import numpy as np
import torch
from torch.utils.data import DataLoader
from tqdm import tqdm

from ..config import EMBED_BATCH_SIZE, EMBED_MODEL_ID, PCA_COMPONENTS, get_device
from ..model import ImageDataset
from .clustering import clustering
from .embedding import embedding_model, reduce_embeddings


def view_grouper(dataset: ImageDataset) -> ImageDataset:
    device = get_device()
    dataloader = DataLoader(
        dataset, batch_size=EMBED_BATCH_SIZE, shuffle=False, num_workers=0
    )

    model = embedding_model(model_id=EMBED_MODEL_ID)
    model.to(device)
    model.eval()

    all_embeddings = []

    for tensor in tqdm(dataloader, desc="Извлечение признаков"):
        tensor = tensor.to(device)

        with torch.no_grad():
            outputs = model(pixel_values=tensor)

        tokens = outputs.last_hidden_state[:, 0, :]
        embeddings = tokens.cpu().numpy()

        all_embeddings.append(embeddings)

    reduced_embeddings = reduce_embeddings(np.vstack(all_embeddings), PCA_COMPONENTS)
    labels = clustering(reduced_embeddings)

    dataset.set_labels(labels)

    return dataset
