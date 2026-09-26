from collections import Counter

import numpy as np
import torch
from torch.utils.data import DataLoader
from tqdm import tqdm

from ..config import EMBED_BATCH_SIZE, EMBED_MODEL_ID, PCA_COMPONENTS, get_device
from ..log import get_logger, stage
from ..model import ImageDataset, DataloaderAdapter
from .clustering import clustering
from .embedding import embedding_model, reduce_embeddings

logger = get_logger("view_grouper")


def view_grouper(dataset: ImageDataset) -> ImageDataset:
    device = get_device()
    logger.info("ракурсы: %d кадров, устройство %s", len(dataset.images), device)

    dataloader = DataLoader(
        DataloaderAdapter(dataset), 
        batch_size=EMBED_BATCH_SIZE, 
        shuffle=False, 
        num_workers=0
    )

    with stage("эмбеддинги ракурсов", logger):
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

    with stage("кластеризация ракурсов", logger):
        labels = clustering(reduced_embeddings)
        dataset.set_labels(labels.tolist())

    cameras = Counter(image.camera for image in dataset.images)
    logger.info(
        "камер %d: %s",
        len(cameras),
        ", ".join(f"{camera}={count}" for camera, count in sorted(cameras.items())),
    )

    return dataset
