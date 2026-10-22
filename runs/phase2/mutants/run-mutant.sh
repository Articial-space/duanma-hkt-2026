#!/bin/bash
# Phase-2 mutant runner (same method as runs/mutants/run-mutant.sh from phase 1).
# usage: run-mutant.sh <name>   names: control M4-service-lease-status M4b-service-fail-open
#                                      M5-service-approver-check M6-policystore-expiry M7-summarize-leak
# Copies core src+tests+config into runs/phase2/mutants/<name>/, junctions node_modules to core/node_modules,
# applies ONE edit to the copy's src, runs vitest (json reporter). Junction and copies are removed by cleanup.sh.
# tests/mode.test.ts imports ../../app/app/lib/mode.js, so a read-only copy of app/app/lib/mode.ts
# (no imports) is placed at runs/phase2/mutants/app/app/lib/mode.ts before the runs.
set -u
cd /e/rmit-hkt-2026/challenges/main-1/impl
name=$1; d=runs/phase2/mutants/$name
if [ -e "$d/node_modules" ]; then echo "refusing: $d/node_modules exists (junction?) - remove with cmd /c rmdir first"; exit 3; fi
rm -rf "$d"; mkdir -p "$d"
cp -r core/src core/tests core/package.json core/tsconfig.json core/vitest.config.ts "$d/"
WD=$(cygpath -w "$PWD/$d/node_modules"); TG=$(cygpath -w "$PWD/core/node_modules")
# NB: with MSYS2_ARG_CONV_EXCL=* the switch must be /c (//c is passed through verbatim and cmd goes interactive).
MSYS2_ARG_CONV_EXCL="*" cmd /c mklink /J "$WD" "$TG" > "$d/_mklink.txt" 2>&1

edit() { # edit <file> <old> <new> : exact single replacement, line endings preserved
python - "$1" "$2" "$3" <<'PY'
import sys
p, old, new = sys.argv[1], sys.argv[2], sys.argv[3]
s = open(p, encoding="utf-8", newline="").read()
assert s.count(old) == 1, ("expected exactly one match", p, s.count(old))
open(p, "w", encoding="utf-8", newline="").write(s.replace(old, new))
PY
}

case $name in
 control) ;;
 M4-service-lease-status)
  # runSummariser no longer consults lease status: signs the latest lease whatever its status and decrypts
  # with whatever token results (undefined if the gateway refuses to sign).
  edit "$d/src/service.ts" \
'    const token = await currentToken(recordId, now);
    if (!token) return blocked();
' \
'    // MUTANT M4: lease status ignored; always sign + decrypt
    const latest = latestLease(recordId);
    const token = latest ? await gateway.signLease(copyLease(latest), now).catch(() => undefined) : undefined;
' ;;
 M4b-service-fail-open)
  # runSummariser never blocks: missing token is ignored and gateway refusals skip the row.
  edit "$d/src/service.ts" \
'    if (!token) return blocked();

    const lines: string[] = [];
    for (const row of rows) {
      if (row.recordId !== recordId) continue;
      try {
        lines.push(await gateway.decryptRecord(recordId, row.ciphertext, { id: agentId }, now, token));
      } catch (err) {
        if (err instanceof NotAuthorizedError) return blocked();
' \
'    void blocked; // MUTANT M4b: fail-open, lease refusal never blocks

    const lines: string[] = [];
    for (const row of rows) {
      if (row.recordId !== recordId) continue;
      try {
        lines.push(await gateway.decryptRecord(recordId, row.ciphertext, { id: agentId }, now, token));
      } catch (err) {
        if (err instanceof NotAuthorizedError) continue;
' ;;
 M5-service-approver-check)
  edit "$d/src/service.ts" \
'    const i = findLease(input.leaseId);
    assertApprover(input.approverId);
    const now = clock();
    const before = leases[i];' \
'    const i = findLease(input.leaseId);
    // MUTANT M5: approver-list check removed from approve
    const now = clock();
    const before = leases[i];' ;;
 M6-policystore-expiry)
  edit "$d/src/policyStore.ts" \
'      if (found.expiresAt !== null && query.now >= found.expiresAt) return null;
' \
'      // MUTANT M6: expiresAt ignored
' ;;
 M7-summarize-leak)
  edit "$d/src/summarize.ts" \
'  return `SUMMARY: ${code} — ${comments.length} comments; themes: ${themes}`.slice(0, MAX_SUMMARY);' \
'  const first = (lines.find((l) => l.startsWith("Comment:")) ?? "").slice("Comment:".length).trim(); // MUTANT M7
  return `SUMMARY: ${code} — ${comments.length} comments; themes: ${themes}; e.g. ${first}`.slice(0, MAX_SUMMARY);' ;;
 *) echo "unknown mutant $name"; exit 2;;
esac
echo "edit exit=$?" > "$d/edit-exit.txt"
diff -ru --strip-trailing-cr core/src "$d/src" > "$d/mutation.diff"
( cd "$d" && node node_modules/vitest/vitest.mjs run --reporter=json --outputFile=results.json > vitest-output.txt 2>&1; echo "exit=$?" > exit-code.txt )
echo "$name $(cat "$d/exit-code.txt")"
