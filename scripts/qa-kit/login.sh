#!/usr/bin/env bash
# Validate a real, already-created persistent passkey session. A project runner
# cannot honestly automate a physical passkey ceremony against a deployment it
# does not own, so this never swaps in the in-process test authority or bypass
# identity mode.
set -euo pipefail

ROOT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)
cd "$ROOT_DIR"

if [[ -z "${QA_KIT_LOGIN_URL:-}" || -z "${QA_KIT_LOGIN_STORAGE_STATE:-}" ]]; then
  printf '%s\n' "Persistent login needs an already-signed-in HTTPS ADL deployment." >&2
  printf '%s\n' "Set QA_KIT_LOGIN_URL and QA_KIT_LOGIN_STORAGE_STATE (an absolute Playwright storage-state file captured after a real passkey ceremony)." >&2
  exit 1
fi
if [[ "$QA_KIT_LOGIN_URL" != https://* ]]; then printf '%s\n' "QA_KIT_LOGIN_URL must use HTTPS; ADL persistent sessions are Secure cookies." >&2; exit 64; fi
if [[ "$QA_KIT_LOGIN_STORAGE_STATE" != /* || ! -r "$QA_KIT_LOGIN_STORAGE_STATE" ]]; then printf '%s\n' "QA_KIT_LOGIN_STORAGE_STATE must be a readable absolute path." >&2; exit 64; fi

# The spec opens a fresh context with the supplied cookie state and requires the
# deployed app to restore identity. It validates persistence; it does not claim
# to mint an account, issue a session, or start an authority deployment.
exec npx playwright test --config playwright.qa-kit.config.ts --project=login
