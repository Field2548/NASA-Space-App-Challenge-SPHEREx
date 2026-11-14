#!/bin/sh
ROOT=$(cd "$(dirname "$0")/.." && pwd)
PY="$ROOT/.venv/bin/python"; [ -x "$PY" ] || PY=python3; exec "$PY" "$ROOT/scripts/credits-check.py" "$@"
