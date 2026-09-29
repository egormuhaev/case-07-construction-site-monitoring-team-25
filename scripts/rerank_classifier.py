#!/usr/bin/env python3
"""Сопоставление работ с классификатором. Реализация — services/planning.

  python scripts/rerank_classifier.py --plan-id UUID --path projects/.../plan.mpp
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
    parser = argparse.ArgumentParser(description="Сопоставить работы плана с классификатором ГЭСН")
    parser.add_argument("--plan-id", required=True)
    parser.add_argument("--project-id", default="")
    parser.add_argument("--path", required=True)
    args = parser.parse_args()
    settings = get_settings()
    print(
        run_plan_import(
            {"planId": args.plan_id, "projectId": args.project_id, "path": args.path},
            settings,
            settings.data_dir,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
