Целевой CV стек: Ultralytics

## Datasets

https://www.kaggle.com/datasets/xyzyxzzxy/construction-equipment

## Complected Models

https://huggingface.co/architchitte/Construction-Hazard-Detection

Архитектура: Yolo v5
Задачи: Детекция строительной техники
https://huggingface.co/uisikdag/yolo-v5-construction-machine-detection


Архитектура YOLO
Классы Building Equipment Worker
https://github.com/ciber-lab/pictor-yolo?ysclid=mu1g7ki1qa494927651


## building-facade-segmentation-instance Computer Vision Model:
https://universe.roboflow.com/building-facade/building-facade-segmentation-instance


## Скрипт: video_to_dated_frames

Пример запуска:

python3 video_to_dated_frames.py video.mp4 output_frames \
 --start-date 2025-01-01 \
 --frames-per-day 8

Результат:

output_frames/
2025-01-01/
frame_001.jpg
...
2025-01-02/
...
manifest.csv

Если нужно брать кадр каждые пять секунд:

python3 video_to_dated_frames.py video.mp4 output_frames \
 --start-date 2025-01-01 \
 --frames-per-day 8 \
 --sample-every-seconds 5
