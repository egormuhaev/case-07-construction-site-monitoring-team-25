#!/usr/bin/env python3

from __future__ import annotations

import argparse
import csv
import json
import math
import shutil
import subprocess
import sys
from datetime import date, timedelta
from pathlib import Path


def parse_date(value: str) -> date:
    try:
        return date.fromisoformat(value)
    except ValueError as exc:
        raise argparse.ArgumentTypeError(
            f"Invalid date {value!r}; expected YYYY-MM-DD"
        ) from exc


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description=(
            "Sample a video and group every N images into consecutive "
            "YYYY-MM-DD folders."
        )
    )
    parser.add_argument("video", type=Path, help="input video file")
    parser.add_argument("output", type=Path, help="output directory")
    parser.add_argument(
        "--start-date", required=True, type=parse_date, help="first date, YYYY-MM-DD"
    )
    parser.add_argument(
        "--frames-per-day",
        type=int,
        default=8,
        help="number of sampled images in each date folder (default: 8)",
    )
    parser.add_argument(
        "--sample-every-seconds",
        type=float,
        default=1.0,
        help="take one image every N seconds of video (default: 1.0)",
    )
    parser.add_argument(
        "--width",
        type=int,
        default=1280,
        help="output width; aspect ratio is preserved (default: 1280)",
    )
    parser.add_argument(
        "--jpeg-quality",
        type=int,
        default=2,
        choices=range(2, 32),
        metavar="2..31",
        help="ffmpeg JPEG quality: 2 is best, 31 is worst (default: 2)",
    )
    parser.add_argument(
        "--overwrite",
        action="store_true",
        help="replace frame files that already exist",
    )
    return parser


def require_program(name: str) -> None:
    if shutil.which(name) is None:
        raise RuntimeError(
            f"{name} was not found. Install ffmpeg and make sure {name} is in PATH."
        )


def get_duration(video: Path) -> float:
    command = [
        "ffprobe",
        "-v",
        "error",
        "-show_entries",
        "format=duration",
        "-of",
        "json",
        str(video),
    ]
    result = subprocess.run(command, check=True, capture_output=True, text=True)
    duration = float(json.loads(result.stdout)["format"]["duration"])
    if duration <= 0:
        raise RuntimeError("The video has no positive duration.")
    return duration


def extract_frame(
    video: Path,
    timestamp: float,
    destination: Path,
    width: int,
    quality: int,
    overwrite: bool,
) -> None:
    command = [
        "ffmpeg",
        "-hide_banner",
        "-loglevel",
        "error",
        "-ss",
        f"{timestamp:.6f}",
        "-i",
        str(video),
        "-frames:v",
        "1",
        "-vf",
        f"scale={width}:-2",
        "-q:v",
        str(quality),
        "-y" if overwrite else "-n",
        str(destination),
    ]
    result = subprocess.run(command)
    if result.returncode != 0:
        if destination.exists() and not overwrite:
            return
        raise RuntimeError(
            f"ffmpeg failed at {timestamp:.3f} seconds for {destination}"
        )


def main() -> int:
    args = build_parser().parse_args()

    try:
        require_program("ffmpeg")
        require_program("ffprobe")
        if not args.video.is_file():
            raise FileNotFoundError(f"Video not found: {args.video}")
        if args.frames_per_day < 1:
            raise ValueError("--frames-per-day must be at least 1")
        if args.sample_every_seconds <= 0:
            raise ValueError("--sample-every-seconds must be greater than 0")
        if args.width < 2:
            raise ValueError("--width must be at least 2")

        duration = get_duration(args.video)
        total_frames = math.ceil(duration / args.sample_every_seconds)
        day_count = math.ceil(total_frames / args.frames_per_day)
        args.output.mkdir(parents=True, exist_ok=True)

        manifest_path = args.output / "manifest.csv"
        rows: list[dict[str, str]] = []

        for global_index in range(total_frames):
            day_index, frame_index = divmod(global_index, args.frames_per_day)
            current_date = args.start_date + timedelta(days=day_index)
            day_dir = args.output / current_date.isoformat()
            day_dir.mkdir(parents=True, exist_ok=True)

            timestamp = min(global_index * args.sample_every_seconds, duration - 0.001)
            filename = f"frame_{frame_index + 1:03d}.jpg"
            destination = day_dir / filename

            print(
                f"[{global_index + 1:>{len(str(total_frames))}}/{total_frames}] "
                f"{current_date.isoformat()} @ {timestamp:.2f}s"
            )
            extract_frame(
                args.video,
                timestamp,
                destination,
                args.width,
                args.jpeg_quality,
                args.overwrite,
            )
            rows.append(
                {
                    "date": current_date.isoformat(),
                    "frame_in_day": str(frame_index + 1),
                    "video_timestamp_seconds": f"{timestamp:.6f}",
                    "video_progress": f"{timestamp / duration:.8f}",
                    "relative_path": destination.relative_to(args.output).as_posix(),
                }
            )

        with manifest_path.open("w", encoding="utf-8", newline="") as file:
            writer = csv.DictWriter(
                file,
                fieldnames=[
                    "date",
                    "frame_in_day",
                    "video_timestamp_seconds",
                    "video_progress",
                    "relative_path",
                ],
            )
            writer.writeheader()
            writer.writerows(rows)

        print(f"Done: {total_frames} frames in {day_count} date folders")
        print(f"Manifest: {manifest_path}")
        return 0
    except (FileNotFoundError, ValueError, RuntimeError, subprocess.CalledProcessError) as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
