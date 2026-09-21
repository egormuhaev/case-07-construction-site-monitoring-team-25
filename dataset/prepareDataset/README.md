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
