#!/usr/bin/env python3
"""Нормализация названий работ. Реализация — services/planning при PLANNING_NORMALIZE_ENABLED.

  python scripts/normalize_work.py --plan-id UUID --path projects/.../plan.mpp
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "services"))

from planning.pipeline import run_plan_import  # noqa: E402
from planning.settings import get_settings  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Нормализовать и сопоставить календарный план (planning pipeline)"
    )
    parser.add_argument("--plan-id", required=True)
    parser.add_argument("--project-id", default="")
    parser.add_argument("--path", required=True, help="Путь к .mpp относительно DATA_DIR")
    args = parser.parse_args()
    settings = get_settings()
    result = run_plan_import(
        {"planId": args.plan_id, "projectId": args.project_id, "path": args.path},
        settings,
        settings.data_dir,
    )
    print(result)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
