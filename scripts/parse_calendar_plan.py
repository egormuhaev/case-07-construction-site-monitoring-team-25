#!/usr/bin/env python3
"""Разобрать календарный план MS Project (.mpp). Запись в БД — через сервис planning.

  python3 scripts/parse_calendar_plan.py --dry-run
  python3 scripts/parse_calendar_plan.py --input dataset/documents/Calendar-plan.mpp
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "services"))

from planning.parse import parse_project, print_works  # noqa: E402

DEFAULT_INPUT = ROOT / "dataset" / "documents" / "Calendar_plan.mpp"


def main() -> int:
    parser = argparse.ArgumentParser(description="Разобрать календарный план MS Project")
    parser.add_argument("--input", type=Path, default=DEFAULT_INPUT)
    parser.add_argument(
        "--dry-run",
        action="store_true",
        default=True,
        help="Только разобрать файл. Запись в БД делает services/planning",
    )
    args = parser.parse_args()
    if not args.input.is_file():
        print(f"Нет файла: {args.input}", file=sys.stderr)
        return 1
    works = parse_project(args.input)
    print(f"{args.input}: задач {len(works)}", file=sys.stderr)
    print_works(works)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
