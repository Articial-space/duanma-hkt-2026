#!/bin/bash
# Remove node_modules junctions (cmd rmdir: removes the link only, never the target) and the copied
# src/tests/config from each phase-2 mutant dir; keep mutation.diff, results.json, outputs.
set -u
cd /e/rmit-hkt-2026/challenges/main-1/impl
for d in runs/phase2/mutants/*/; do
  d=${d%/}; n=$(basename "$d")
  [ "$n" = app ] && continue
  if [ -e "$d/node_modules" ]; then
    W=$(cygpath -w "$PWD/$d/node_modules")
    MSYS2_ARG_CONV_EXCL="*" cmd /c rmdir "$W"; echo "$n rmdir exit=$?"
  fi
  if [ -e "$d/node_modules" ]; then echo "$n: node_modules still present, not deleting copies"; continue; fi
  rm -rf "$d/src" "$d/tests" "$d/package.json" "$d/tsconfig.json" "$d/vitest.config.ts"
done
rm -rf runs/phase2/mutants/app
echo "core/node_modules entries: $(ls core/node_modules | wc -l); vitest.mjs: $(ls core/node_modules/vitest/vitest.mjs)"
