#!/usr/bin/env bash
# Run the backend check suite from the repo root. Prints PASS / FAIL / SKIP per check
# and exits non-zero if any check failed. A check that can't run is SKIP, never PASS.
# Pass --build to also run `pnpm build` (required after wiring UI screens to the backend).
set -u

want_build=0
[ "${1:-}" = "--build" ] && want_build=1

results=()
failed=0

record() { results+=("$1|$2|$3"); [ "$2" = "FAIL" ] && failed=1; }

run_check() {
  local name="$1"; shift
  echo "==> $name: $*"
  if "$@"; then record "$name" PASS ""; else record "$name" FAIL "exit $?"; fi
}

has_script() { node -e "process.exit(require('./package.json').scripts?.['$1'] ? 0 : 1)" 2>/dev/null; }

if [ ! -f package.json ]; then
  record "typecheck" SKIP "no package.json (run slice S0 first)"
  record "lint" SKIP "no package.json"
  record "vitest" SKIP "no package.json"
else
  if ! command -v pnpm >/dev/null 2>&1; then
    record "typecheck" SKIP "pnpm not installed"; record "lint" SKIP "pnpm not installed"; record "vitest" SKIP "pnpm not installed"
  else
    if has_script typecheck; then run_check typecheck pnpm -s typecheck; else run_check typecheck pnpm -s exec tsc --noEmit; fi
    if has_script lint; then run_check lint pnpm -s lint; else record lint SKIP "no lint script"; fi
    if has_script test; then run_check vitest pnpm -s test; else run_check vitest pnpm -s exec vitest run; fi
    if [ $want_build -eq 1 ]; then
      if has_script build; then run_check build pnpm -s build; else record build SKIP "no build script"; fi
    fi
  fi
fi

if [ ! -d supabase ]; then
  record "pgTAP" SKIP "no supabase/ directory"
elif ! command -v supabase >/dev/null 2>&1 && ! [ -x node_modules/.bin/supabase ]; then
  record "pgTAP" SKIP "Supabase CLI not installed"
else
  sb="supabase"; command -v supabase >/dev/null 2>&1 || sb="node_modules/.bin/supabase"
  if ! "$sb" status >/dev/null 2>&1; then
    record "pgTAP" SKIP "local Supabase stack not running (supabase start; needs Docker)"
  elif [ -z "$(ls supabase/tests/*.sql 2>/dev/null)" ]; then
    record "pgTAP" SKIP "no tests in supabase/tests/"
  else
    run_check pgTAP "$sb" test db
  fi
fi

echo
echo "check | result | note"
for r in "${results[@]}"; do echo "${r//|/ | }"; done
exit $failed
