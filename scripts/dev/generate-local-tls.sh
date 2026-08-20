#!/usr/bin/env bash
#
# Generates a local development certificate authority and a leaf certificate for
# `localhost`, into `.dev-tls/` (gitignored — the key material must never be
# committed, and every developer generates their own).
#
# This exists because the authority refuses non-HTTPS origins in EVERY
# environment (`src/server/authority-config.ts`, `isHttpsOrigin`) and the
# session cookie is `__Host-` Secure. Local development therefore has to be real
# HTTPS; relaxing the server check for development would mean the code you run
# locally is not the code you deploy. See
# `docs/development/local-https-development.md`.
#
# `mkcert` does the same job in one command and additionally installs the CA
# into every trust store for you. If you have it (and the root access it needs),
# prefer it:
#
#   mkcert -install
#   mkcert -cert-file .dev-tls/localhost.pem -key-file .dev-tls/localhost-key.pem localhost 127.0.0.1 ::1
#
# This script needs only `openssl` and no root at all. Trusting the CA it
# produces is the one manual step, and it is documented in the guide above.
#
# Usage: scripts/dev/generate-local-tls.sh [--force]
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
out_dir="${ADL_DEV_TLS_DIR:-${repo_root}/.dev-tls}"

ca_key="${out_dir}/dev-ca-key.pem"
ca_cert="${out_dir}/dev-ca.pem"
leaf_key="${out_dir}/localhost-key.pem"
leaf_cert="${out_dir}/localhost.pem"

force=0
if [[ "${1:-}" == "--force" ]]; then force=1; fi

if [[ "${force}" -eq 0 && -f "${leaf_cert}" && -f "${leaf_key}" && -f "${ca_cert}" ]]; then
  echo "Local development certificates already exist in ${out_dir}."
  echo "Re-run with --force to replace them (you will have to trust the new CA again)."
  exit 0
fi

mkdir -p "${out_dir}"
chmod 700 "${out_dir}"

# The CA. Ten years, because re-trusting it is the manual step and nobody should
# have to repeat it often. It signs nothing but the leaf below.
openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -noenc \
  -keyout "${ca_key}" -out "${ca_cert}" -days 3650 -sha256 \
  -subj "/CN=ADL local development CA/O=ADL local development" \
  -addext "basicConstraints=critical,CA:TRUE,pathlen:0" \
  -addext "keyUsage=critical,keyCertSign,cRLSign" 2>/dev/null

# The leaf. 397 days keeps it inside the maximum lifetime browsers accept for a
# server certificate, so a browser cannot reject it for age alone.
csr="$(mktemp)"
ext="$(mktemp)"
trap 'rm -f "${csr}" "${ext}"' EXIT

cat > "${ext}" <<'EXT'
basicConstraints=critical,CA:FALSE
keyUsage=critical,digitalSignature
extendedKeyUsage=serverAuth
subjectAltName=DNS:localhost,IP:127.0.0.1,IP:0:0:0:0:0:0:0:1
EXT

openssl req -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -noenc \
  -keyout "${leaf_key}" -out "${csr}" -sha256 -subj "/CN=localhost" 2>/dev/null

openssl x509 -req -in "${csr}" -CA "${ca_cert}" -CAkey "${ca_key}" -CAcreateserial \
  -out "${leaf_cert}" -days 397 -sha256 -extfile "${ext}" 2>/dev/null

chmod 600 "${ca_key}" "${leaf_key}"
chmod 644 "${ca_cert}" "${leaf_cert}"

echo "Wrote:"
echo "  ${ca_cert}       (trust this one — see docs/development/local-https-development.md)"
echo "  ${ca_key}"
echo "  ${leaf_cert}     (served by the TLS proxy and by Vite)"
echo "  ${leaf_key}"
echo
openssl x509 -in "${leaf_cert}" -noout -subject -issuer -dates -ext subjectAltName
