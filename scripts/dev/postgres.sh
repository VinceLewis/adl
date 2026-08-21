#!/usr/bin/env bash
#
# A local PostgreSQL for the development authority. Developer tooling only.
#
# It reproduces the deployment's role split rather than running everything as a
# superuser: `roles.sql` creates `adl_migrator` (owns schema changes) and
# `adl_authority` (DML only, and what the server process connects as),
# `grants.sql` and then the ordered migrations in `src/server/migrations/` are
# applied as `adl_migrator`, and the server never applies a migration itself.
# That is exactly the procedure in
# `docs/operations/authority-production-runbook.md` — every step, in the same
# role — so a missing grant shows up on a laptop instead of in production.
#
# The passwords here are the literal string `adl`. That is fine for a container
# bound to 127.0.0.1 that holds nothing but demo data, and it is why this script
# is development-only.
#
#   scripts/dev/postgres.sh up       start the container, create roles, migrate
#   scripts/dev/postgres.sh migrate  (re-)apply migrations and refresh grants
#   scripts/dev/postgres.sh url      print the ADL_DATABASE_URL to use
#   scripts/dev/postgres.sh psql     open a superuser shell on it
#   scripts/dev/postgres.sh down     remove the container and its data
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
container="${ADL_DEV_PG_CONTAINER:-adl-dev-postgres}"
port="${ADL_DEV_PG_PORT:-5432}"
password="${ADL_DEV_PG_PASSWORD:-adl}"
database="${ADL_DEV_PG_DATABASE:-adl}"
image="postgres:16-alpine"

superuser_url="postgresql://postgres:${password}@127.0.0.1:${port}/${database}"
migrator_url="postgresql://adl_migrator:${password}@127.0.0.1:${port}/${database}"
authority_url="postgresql://adl_authority:${password}@127.0.0.1:${port}/${database}"

# Ordered, and this order is the contract. Keep in step with
# tests/integration/pg-harness.ts's MIGRATION_FILES.
migrations=(
  0001_authority_projection.sql
  0002_security_operations.sql
  0003_reporting_administration.sql
  0004_authority_transaction_integrity.sql
  0005_authority_audit_scope_and_retention.sql
  0006_passkey_identity.sql
  0007_model_fingerprint.sql
  0008_membership_projection.sql
  0009_retention_scheduling.sql
)

wait_ready() {
  for _ in $(seq 1 120); do
    if psql "${superuser_url}" -Atqc 'select 1' >/dev/null 2>&1; then return 0; fi
    sleep 0.5
  done
  echo "PostgreSQL on 127.0.0.1:${port} did not become ready." >&2
  exit 1
}

apply_migrations() {
  # roles.sql is idempotent; the password lines in it are commented out on
  # purpose (a deployment sets them from its secret manager), so set them here.
  psql "${superuser_url}" -v ON_ERROR_STOP=1 -v authority_db="${database}" \
    -f "${repo_root}/src/server/migrations/roles.sql" >/dev/null
  psql "${superuser_url}" -v ON_ERROR_STOP=1 -q \
    -c "alter role adl_migrator password '${password}'" \
    -c "alter role adl_authority password '${password}'" >/dev/null

  # grants.sql, as adl_migrator — the deployment's own step, not a local
  # improvisation. It sets the default privileges that give adl_authority DML
  # over every table adl_migrator goes on to create, and grants DML over any
  # that already exist. Idempotent, and deliberately re-run on every `migrate`.
  psql "${migrator_url}" -v ON_ERROR_STOP=1 -q \
    -f "${repo_root}/src/server/migrations/grants.sql" >/dev/null

  for file in "${migrations[@]}"; do
    echo "  applying ${file}"
    psql "${migrator_url}" -v ON_ERROR_STOP=1 -q -f "${repo_root}/src/server/migrations/${file}"
  done
}

case "${1:-up}" in
  up)
    if [[ -n "$(docker ps -aq -f "name=^${container}$")" ]]; then
      # A container's published port is fixed when it is created, so `docker
      # start` cannot move an existing one to a different ADL_DEV_PG_PORT. Left
      # unchecked that reports "Started existing container" and then times out
      # waiting on a port nothing was ever bound to, which reads like a broken
      # database rather than a stale container. Refuse instead of recreating:
      # the container may hold a seeded admin, band and invitation, and losing
      # those to a changed environment variable is not this script's call.
      bound="$(docker inspect "${container}" \
        --format '{{range $p, $c := .HostConfig.PortBindings}}{{range $c}}{{.HostPort}}{{end}}{{end}}' 2>/dev/null || true)"
      if [[ -n "${bound}" && "${bound}" != "${port}" ]]; then
        echo "Container ${container} already exists and publishes 127.0.0.1:${bound}, not ${port}." >&2
        echo "A published port cannot be changed after creation. To move it (this DESTROYS its data):" >&2
        echo "  scripts/dev/postgres.sh down && ADL_DEV_PG_PORT=${port} scripts/dev/postgres.sh up" >&2
        echo "To keep the existing container instead, use ADL_DEV_PG_PORT=${bound}." >&2
        exit 1
      fi
      docker start "${container}" >/dev/null
      echo "Started existing container ${container} on 127.0.0.1:${port}."
    else
      docker run -d --name "${container}" \
        -e "POSTGRES_PASSWORD=${password}" \
        -e "POSTGRES_USER=postgres" \
        -e "POSTGRES_DB=${database}" \
        -p "127.0.0.1:${port}:5432" \
        "${image}" >/dev/null
      echo "Started ${container} (${image}) on 127.0.0.1:${port}."
    fi
    wait_ready
    apply_migrations
    echo
    echo "ADL_DATABASE_URL=${authority_url}"
    ;;
  migrate)
    wait_ready
    apply_migrations
    ;;
  url)
    echo "${authority_url}"
    ;;
  psql)
    exec psql "${superuser_url}"
    ;;
  down)
    docker rm -f "${container}" >/dev/null 2>&1 || true
    echo "Removed ${container}."
    ;;
  *)
    echo "Usage: scripts/dev/postgres.sh [up|migrate|url|psql|down]" >&2
    exit 2
    ;;
esac
