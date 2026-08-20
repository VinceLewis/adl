#!/usr/bin/env bash
#
# Bring up the whole local development stack in one terminal, over real TLS:
#
#   https://localhost:5173  Vite dev server (ADL_DEV_HTTPS=true)
#     -> https://localhost:8443  scripts/dev/tls-proxy.mjs
#       -> http://127.0.0.1:8787  the authority, unchanged plain node:http
#         -> PostgreSQL in a container, migrations applied out of band
#
# Any process already holding one of those ports is killed first, so this is
# safe to re-run. See docs/development/local-https-development.md for the
# one-time steps this does NOT do: generating the CA (`npm run dev:tls`) and
# trusting it in your browser, which touches a trust store and is yours to run.
#
#   ./start-dev.sh          bring everything up, follow the logs
#   ./start-dev.sh --seed   ... and mint the first admin, band and invitation
#   ./start-dev.sh --down   stop everything this script starts
#
# Env file: .env.authority.local (see the guide). ADL_DEV_PG_PORT is taken from
# its ADL_DATABASE_URL, so the database only has to be configured in one place.
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")"

env_file="${ADL_ENV_FILE:-.env.authority.local}"
log_dir=".dev-logs"
vite_port="${ADL_DEV_VITE_PORT:-5173}"
proxy_port="${ADL_DEV_PROXY_PORT:-8443}"

note() { printf '\033[1;34m==>\033[0m %s\n' "$1"; }
fail() { printf '\033[1;31mERROR:\033[0m %s\n' "$1" >&2; exit 1; }

# Kill whatever holds a TCP port, whoever started it. Without this a stale
# server from an earlier session keeps answering and you debug the wrong tree —
# Playwright's `reuseExistingServer` makes that failure mode entirely silent.
kill_port() {
  local port="$1" pids
  pids="$(ss -lptnH "sport = :${port}" 2>/dev/null | grep -o 'pid=[0-9]*' | cut -d= -f2 | sort -u || true)"
  [[ -z "${pids}" ]] && return 0
  for pid in ${pids}; do
    note "killing pid ${pid} on port ${port} ($(readlink "/proc/${pid}/cwd" 2>/dev/null || echo '?'))"
    kill "${pid}" 2>/dev/null || true
  done
  for _ in $(seq 20); do
    ss -lptnH "sport = :${port}" 2>/dev/null | grep -q . || return 0
    sleep 0.25
  done
  for pid in ${pids}; do kill -9 "${pid}" 2>/dev/null || true; done
  sleep 0.5
}

stop_all() {
  kill_port "${vite_port}"
  kill_port "${proxy_port}"
  kill_port "${authority_port:-8787}"
}

if [[ "${1:-}" == "--down" ]]; then
  # Read the env file if present, only to learn the authority's port.
  [[ -f "${env_file}" ]] && { set -a; . "./${env_file}"; set +a; }
  authority_port="${ADL_PORT:-8787}"
  stop_all
  note "stopped. The database container is left running — 'scripts/dev/postgres.sh down' removes it."
  exit 0
fi

[[ -f "${env_file}" ]] || fail "${env_file} not found. See docs/development/local-https-development.md."
[[ -f .dev-tls/localhost.pem ]] || fail "No certificate. Run 'npm run dev:tls' first, then trust the CA (see the guide)."

set -a; . "./${env_file}"; set +a
authority_port="${ADL_PORT:-8787}"
: "${ADL_DATABASE_URL:?ADL_DATABASE_URL is not set in ${env_file}}"

# The container's published port is whatever ADL_DATABASE_URL says, so the two
# can never drift apart — postgres.sh refuses to start a container whose
# published port differs from the one asked for.
pg_port="$(sed -E 's|.*:([0-9]+)/[^/]*$|\1|' <<<"${ADL_DATABASE_URL}")"
[[ "${pg_port}" =~ ^[0-9]+$ ]] || fail "Could not read a port from ADL_DATABASE_URL."

mkdir -p "${log_dir}"
stop_all

note "PostgreSQL on 127.0.0.1:${pg_port}"
ADL_DEV_PG_PORT="${pg_port}" scripts/dev/postgres.sh up >"${log_dir}/postgres.log" 2>&1 \
  || { tail -20 "${log_dir}/postgres.log"; fail "database did not start — see ${log_dir}/postgres.log"; }

# Built once here rather than by each npm script, so the authority and the
# seeder cannot race each other compiling into dist-server/.
note "building the authority"
npm run build:authority >"${log_dir}/build.log" 2>&1 \
  || { tail -20 "${log_dir}/build.log"; fail "build failed — see ${log_dir}/build.log"; }

wait_for() {
  local label="$1" probe="$2"
  for _ in $(seq 60); do
    eval "${probe}" >/dev/null 2>&1 && { note "${label} ready"; return 0; }
    sleep 0.5
  done
  return 1
}

note "authority on http://127.0.0.1:${authority_port}"
node dist-server/src/server/authority-main.js >"${log_dir}/authority.log" 2>&1 &
wait_for "authority" "curl -sf http://127.0.0.1:${authority_port}/readyz" \
  || { tail -30 "${log_dir}/authority.log"; fail "authority did not become ready — see ${log_dir}/authority.log"; }

note "TLS proxy on https://localhost:${proxy_port}"
ADL_DEV_PROXY_PORT="${proxy_port}" node scripts/dev/tls-proxy.mjs >"${log_dir}/proxy.log" 2>&1 &
wait_for "proxy" "curl -sf --cacert .dev-tls/dev-ca.pem https://localhost:${proxy_port}/readyz" \
  || { tail -30 "${log_dir}/proxy.log"; fail "proxy did not answer — see ${log_dir}/proxy.log"; }

if [[ "${1:-}" == "--seed" ]]; then
  note "seeding the first admin, band and invitation"
  node scripts/dev/seed-local-admin.mjs 2>&1 | tee "${log_dir}/seed.log"
fi

note "Vite on https://localhost:${vite_port}"
ADL_DEV_HTTPS=true VITE_ADL_AUTHORITY_URL="https://localhost:${proxy_port}" \
  npx vite --port "${vite_port}" >"${log_dir}/vite.log" 2>&1 &
wait_for "vite" "curl -sf --cacert .dev-tls/dev-ca.pem https://localhost:${vite_port}/" \
  || { tail -30 "${log_dir}/vite.log"; fail "vite did not start — see ${log_dir}/vite.log"; }

cat <<EOF

  https://localhost:${vite_port}/?demo=giggle-band

  HTTPS, not HTTP — the authority only allows https origins, and plain http
  against a TLS listener answers ERR_EMPTY_RESPONSE.

  Logs: ${log_dir}/{postgres,authority,proxy,vite}.log
  Stop: ./start-dev.sh --down

EOF

trap 'note "shutting down"; stop_all; exit 0' INT TERM
tail -f "${log_dir}/authority.log" "${log_dir}/proxy.log" "${log_dir}/vite.log"
