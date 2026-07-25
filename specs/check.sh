#!/usr/bin/env bash
# Run the TLA+ specs through TLC. Usage: ./check.sh [SpecName ...]
set -uo pipefail
cd "$(dirname "$0")"

JAR=tla2tools.jar
if [ ! -f "$JAR" ]; then
  echo "Downloading $JAR..."
  curl -fsSL -o "$JAR" \
    https://github.com/tlaplus/tlaplus/releases/latest/download/tla2tools.jar
fi

# WorkerBridge models the current, known-broken design: its counterexamples
# are the point, so a TLC failure there is the expected outcome.
declare -a SPECS
if [ $# -gt 0 ]; then SPECS=("$@"); else SPECS=(WorkerBridge WorkerBridgeFixed); fi

status=0
for spec in "${SPECS[@]}"; do
  echo "=== $spec ==="
  java -XX:+UseParallelGC -cp "$JAR" tlc2.TLC -nowarning \
       -config "$spec.cfg" "$spec.tla"
  rc=$?
  case "$spec" in
    WorkerBridge)
      if [ $rc -eq 0 ]; then
        echo "!! $spec was expected to produce a counterexample but passed."
        status=1
      else
        echo "(counterexample expected -- see README.md)"
      fi
      ;;
    *)
      [ $rc -ne 0 ] && status=1
      ;;
  esac
done
exit $status
