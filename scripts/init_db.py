#!/usr/bin/env python3
"""Совместимая обёртка. Миграции накатывает core-api, данные грузит scripts/seed.py.

  python scripts/init_db.py
  python scripts/init_db.py --reload
"""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

SEED = Path(__file__).with_name("seed.py")


def main() -> int:
    args = [arg for arg in sys.argv[1:] if arg not in {"--skip-up", "--reset"}]
    if "--reset" in sys.argv[1:]:
        print(
            "Сброс схемы: make reset && make up && make seed",
            file=sys.stderr,
        )
    return subprocess.call([sys.executable, str(SEED), *args])


if __name__ == "__main__":
    raise SystemExit(main())
