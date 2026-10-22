#!/bin/bash
# usage: mut.sh name
set -u
cd /e/rmit-hkt-2026/challenges/main-1/impl
name=$1; d=runs/mutants/$name
rm -rf "$d"; mkdir -p "$d"
cp -r core/src core/tests core/package.json core/tsconfig.json core/vitest.config.ts "$d/"
WD=$(cygpath -w "$PWD/$d/node_modules"); TG=$(cygpath -w "$PWD/core/node_modules")
MSYS2_ARG_CONV_EXCL="*" cmd /c mklink /J "$WD" "$TG" > "$d/_mklink.txt" 2>&1
case $name in
 M1-threshold) sed -i 's/Math\.floor/Math.ceil/' "$d/src/threshold.ts";;
 M2-gateway-sig) python - "$d/src/gateway.ts" <<'PY'
import sys,re
p=sys.argv[1];s=open(p).read()
old='    if (given.length !== expected.length || !timingSafeEqual(given, expected)) {\n      throw new NotAuthorizedError("invalid lease signature");\n    }\n'
assert old in s
s=s.replace(old,'    void given; void expected; void timingSafeEqual; // MUTANT: signature verification skipped\n')
open(p,'w').write(s)
PY
 ;;
 M3-lease-self-approve) python - "$d/src/lease.ts" <<'PY'
import sys
p=sys.argv[1];s=open(p).read()
old='  assertNotRequester(req, approver, "approve");\n'
assert s.count(old)==1
s=s.replace(old,'  // MUTANT: requester check removed from approve\n')
open(p,'w').write(s)
PY
 ;;
 control) ;;
esac
diff -ru core/src "$d/src" > "$d/mutation.diff"
( cd "$d" && node node_modules/vitest/vitest.mjs run --reporter=json --outputFile=results.json > vitest-output.txt 2>&1; echo "exit=$?" > exit-code.txt )
cat "$d/exit-code.txt"
