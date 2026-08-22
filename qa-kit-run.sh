#!/usr/bin/env bash
# ADL's project-side qa-kit contract.
set -euo pipefail

ROOT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
cd "$ROOT_DIR"

usage() {
  printf '%s\n' "usage: ./qa-kit-run.sh {unit|integration|journey|ui|typecheck|lint|env:up|env:reset|env:down|login}" >&2
  exit 64
}

require_no_arguments() {
  if [[ $# -ne 0 ]]; then usage; fi
}

if [[ $# -eq 0 ]]; then usage; fi
capability=$1
shift

case "$capability" in
  unit)
    require_no_arguments "$@"
    if [[ -n "${QA_KIT_TEST_PATTERN+x}" ]]; then
      if [[ -z "$QA_KIT_TEST_PATTERN" ]]; then usage; fi
      exec npx vitest run --testNamePattern "$QA_KIT_TEST_PATTERN"
    fi
    npm test
    exec npm run test:gherkin
    ;;
  integration) require_no_arguments "$@"; exec npm run test:integration ;;
  journey)
    require_no_arguments "$@"
    # env:up has built and started the production artefact qa-kit health-checked.
    exec npx playwright test --config playwright.qa-kit.config.ts --project=journey
    ;;
  ui)
    require_no_arguments "$@"
    # The Gherkin root is generated into build output before every run, so a
    # stale generated spec can never stand in for a committed Scenario.
    npx bddgen --config playwright.qa-kit.config.ts
    exec npx playwright test --config playwright.qa-kit.config.ts --project=desktop --project=ui-acceptance
    ;;
  typecheck) require_no_arguments "$@"; exec npm run typecheck ;;
  lint) require_no_arguments "$@"; exec npm run format:check ;;
  env:up|env:down)
    if [[ $# -ne 2 ]]; then usage; fi
    exec "$ROOT_DIR/scripts/qa-kit/environment.sh" "$capability" "$1" "$2"
    ;;
  env:reset) require_no_arguments "$@"; exec "$ROOT_DIR/scripts/qa-kit/environment.sh" env:reset ;;
  login) require_no_arguments "$@"; exec "$ROOT_DIR/scripts/qa-kit/login.sh" ;;
  *) usage ;;
esac
