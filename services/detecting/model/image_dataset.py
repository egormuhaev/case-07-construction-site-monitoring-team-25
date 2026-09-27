from dataclasses import dataclass, field

import torch
from PIL import Image as PILImage
from torch.utils.data import Dataset
from torchvision import transforms

from ..config import TARGET_SIZE
from .image import Image

transform_pipeline = transforms.Compose(
    [
        transforms.Resize([TARGET_SIZE, TARGET_SIZE]),
        transforms.ToTensor(),
        transforms.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225]),
    ]
)


@dataclass
class ImageDataset:
    images: list[Image] = field(default_factory=list)

    def set_labels(self, labels: list[int]):
        if len(labels) != len(self.images):
            raise ValueError(
                f"число меток ({len(labels)}) не совпадает с числом изображений ({len(self.images)})"
            )

        for index, label in enumerate(labels):
            self.images[index].camera = label

    def __len__(self) -> int:
        return len(self.images)

    def __getitem__(self, index: int) -> Image:
        return self.images[index]


@dataclass
class DataloaderAdapter(Dataset[torch.Tensor]):
    dataset: ImageDataset

    def __len__(self) -> int:
        return len(self.dataset)

    def __getitem__(self, index: int) -> torch.Tensor:
        image = self.dataset.images[index]
        with PILImage.open(image.filepath) as img:
            tensor = transform_pipeline(img.convert("RGB"))
        if not isinstance(tensor, torch.Tensor):
            raise TypeError(f"ожидался Tensor, получили {type(tensor)}")
        return tensor