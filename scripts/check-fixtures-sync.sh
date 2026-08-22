#!/usr/bin/env bash
# The frontend keeps its own copy of the content fixtures so the renderer can
# be built with no backend running. Nothing in the tooling forces the two
# copies to agree, so a one-sided edit silently ships a frontend that renders
# content the API never serves -- the kind of thing you discover on stage.
#
# Run from the repo root:  bash scripts/check-fixtures-sync.sh
# Resync after editing the source of truth:  npm --prefix frontend run sync:fixtures
set -euo pipefail

SRC="fixtures"
DST="frontend/src/fixtures"
status=0

for f in "$SRC"/*.json; do
  name=$(basename "$f")
  copy="$DST/$name"
  if [ ! -f "$copy" ]; then
    echo "MISSING  $copy (present in $SRC)"
    status=1
  elif ! diff -q "$f" "$copy" >/dev/null; then
    echo "DIVERGED $name"
    diff -u "$f" "$copy" | sed 's/^/    /' | head -20
    status=1
  fi
done

# A copy with no source is just as wrong: it cannot come from the pipeline.
for f in "$DST"/*.json; do
  name=$(basename "$f")
  [ -f "$SRC/$name" ] || { echo "ORPHAN   $f (no $SRC/$name)"; status=1; }
done

if [ "$status" -eq 0 ]; then
  echo "Fixtures in sync ($(ls -1 "$SRC"/*.json | wc -l | tr -d ' ') files)."
else
  echo
  echo "Fix with: npm --prefix frontend run sync:fixtures   (copies $SRC -> $DST)"
fi
exit "$status"
