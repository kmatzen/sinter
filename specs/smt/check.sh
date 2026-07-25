#!/usr/bin/env bash
# Discharge the SMT lemmas.  Needs `pip install z3-solver`.
set -uo pipefail
cd "$(dirname "$0")"
if ! python3 -c 'import z3' 2>/dev/null; then
  echo "z3 not installed — run: pip3 install z3-solver" >&2
  exit 2
fi
exec python3 lemmas.py
