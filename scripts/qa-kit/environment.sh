#!/usr/bin/env bash
# Browser environment lifecycle for qa-kit-run.sh.
set -euo pipefail

ROOT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)
STATE_SUFFIX=.qa-kit-environment.json

usage() {
  printf '%s\n' "usage: environment.sh {env:up|env:down} {ui|journey} <absolute-descriptor-path> | env:reset" >&2
  exit 64
}

require_browser_descriptor() {
  local requested_capability=$1 descriptor=$2
  if [[ "$requested_capability" != "ui" && "$requested_capability" != "journey" ]]; then usage; fi
  if [[ "$descriptor" != /* ]]; then
    printf '%s\n' "qa-kit env descriptor must be an absolute path" >&2
    exit 64
  fi
  if [[ ! -d "$(dirname -- "$descriptor")" ]]; then
    printf '%s\n' "qa-kit env descriptor directory does not exist: $(dirname -- "$descriptor")" >&2
    exit 64
  fi
}

write_descriptor() {
  local descriptor=$1 port=$2 host=$3 temporary
  temporary=$(mktemp "${descriptor}.tmp.XXXXXX")
  printf '%s\n' "{\"schemaVersion\":1,\"checks\":[{\"name\":\"vite-production-preview\",\"url\":\"http://${host}:${port}/\",\"statuses\":[200]}],\"timeoutMs\":60000,\"intervalMs\":250}" >"$temporary"
  mv -f -- "$temporary" "$descriptor"
}

up() {
  local requested_capability=$1 descriptor=$2 port host server_pid state_file
  local -a build_environment
  require_browser_descriptor "$requested_capability" "$descriptor"
  case "$requested_capability" in
    ui) port=4173; host=127.0.0.1; build_environment=() ;;
    journey)
      # The established journey fixture is on localhost:8788. VITE_ variables
      # are compile-time values, so this belongs on the production build.
      port=5273; host=localhost; build_environment=(VITE_ADL_AUTHORITY_URL=http://localhost:8788)
      ;;
  esac
  cd "$ROOT_DIR"
  if [[ ${#build_environment[@]} -eq 0 ]]; then npm run build; else env "${build_environment[@]}" npm run build; fi
  state_file="${descriptor}${STATE_SUFFIX}"
  rm -f -- "$state_file"
  # A new session lets cleanup terminate this exact preview process group.
  setsid npx vite preview --host "$host" --port "$port" --strictPort >"${descriptor}.server.log" 2>&1 &
  server_pid=$!
  node -e 'const fs=require("fs"); fs.writeFileSync(process.argv[1], JSON.stringify({pid:Number(process.argv[2]),root:process.argv[3],capability:process.argv[4]}));' "$state_file" "$server_pid" "$ROOT_DIR" "$requested_capability"
  write_descriptor "$descriptor" "$port" "$host"
  printf 'Started Vite production preview for %s (pid %s) at http://%s:%s/; qa-kit will health-check the descriptor.\n' "$requested_capability" "$server_pid" "$host" "$port"
}

down() {
  local requested_capability=$1 descriptor=$2 state_file pid recorded_root process_root
  require_browser_descriptor "$requested_capability" "$descriptor"
  state_file="${descriptor}${STATE_SUFFIX}"
  if [[ ! -f "$state_file" ]]; then printf 'No qa-kit preview process state exists for %s.\n' "$descriptor"; exit 0; fi
  pid=$(node -e 'const v=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")); if(!Number.isInteger(v.pid)||v.pid<2)process.exit(1); process.stdout.write(String(v.pid));' "$state_file") || { printf '%s\n' "Invalid qa-kit preview process state: $state_file" >&2; exit 1; }
  recorded_root=$(node -e 'const v=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")); if(typeof v.root!=="string")process.exit(1); process.stdout.write(v.root);' "$state_file") || { printf '%s\n' "Invalid qa-kit preview process state: $state_file" >&2; exit 1; }
  if [[ "$recorded_root" != "$ROOT_DIR" ]]; then printf '%s\n' "Refusing to stop preview process owned by another directory: $recorded_root" >&2; exit 1; fi
  if kill -0 "$pid" 2>/dev/null; then
    process_root=$(readlink "/proc/${pid}/cwd" 2>/dev/null || true)
    if [[ "$process_root" != "$ROOT_DIR" ]]; then printf '%s\n' "Refusing to stop pid $pid: its working directory is not this ADL worktree." >&2; exit 1; fi
    kill -- "-$pid" 2>/dev/null || kill "$pid"
    for _ in {1..20}; do if ! kill -0 "$pid" 2>/dev/null; then break; fi; sleep 0.1; done
    if kill -0 "$pid" 2>/dev/null; then kill -KILL -- "-$pid" 2>/dev/null || kill -KILL "$pid"; fi
  fi
  rm -f -- "$state_file"
  printf 'Stopped qa-kit Vite production preview for %s.\n' "$requested_capability"
}

reset() {
  # Intentionally narrower than a database reset: browser runs have isolated
  # contexts, and this only clears qa-kit-owned Playwright artefacts/state.
  rm -rf -- "$ROOT_DIR/test-results/qa-kit"
  printf '%s\n' '{"reset":["qa-kit Playwright output and persistent login storage under test-results/qa-kit"],"survives":["ADL source and dependencies","Vite dist output","PostgreSQL databases and roles","external authority deployments","browser profiles outside qa-kit storage"]}'
}

if [[ $# -eq 1 && "$1" == "env:reset" ]]; then reset; exit 0; fi
if [[ $# -ne 3 ]]; then usage; fi
case "$1" in env:up) up "$2" "$3" ;; env:down) down "$2" "$3" ;; *) usage ;; esac
