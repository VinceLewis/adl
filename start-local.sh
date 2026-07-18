#!/usr/bin/env bash
set -euo pipefail

HOST="${HOST:-127.0.0.1}"
GIGGLE_DEMO_PATH="/?demo=giggle-band"
printed_giggle_url=0

echo "Starting ADL local dev server on ${HOST}..."
echo "The Giggle ADL app URL will print after Vite reports the local server URL."

npm run dev -- --host "${HOST}" "$@" 2>&1 | while IFS= read -r line; do
  printf '%s\n' "${line}"

  if [[ "${printed_giggle_url}" -eq 0 && "${line}" =~ Local:[[:space:]]+(https?://[^[:space:]]+) ]]; then
    local_url="${BASH_REMATCH[1]%/}"
    printf '\nGiggle ADL app: %s%s\n\n' "${local_url}" "${GIGGLE_DEMO_PATH}"
    printed_giggle_url=1
  fi
done
