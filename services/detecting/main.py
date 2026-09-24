import os

from detecting.config import TEST_DATASET_DIR
from detecting.model import Image, ImageDataset
from detecting.view_grouper import view_grouper


def get_images() -> list[Image]:
    if not TEST_DATASET_DIR.is_dir():
        raise FileNotFoundError(f"Нет каталога с изображениями: {TEST_DATASET_DIR}")

    images: list[Image] = []
    for file in os.listdir(TEST_DATASET_DIR):
        if file == ".DS_Store":
            continue
        images.append(Image(filepath=str(TEST_DATASET_DIR / file)))
    return images


def main() -> None:
    dataset = ImageDataset(images=get_images())
    result = view_grouper(dataset)
    print(result)


if __name__ == "__main__":
    main()
