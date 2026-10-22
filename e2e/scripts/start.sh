#!/bin/bash
#
# Starts the stack of the QA environment (scripts/qa-environment/: the console image, OpenLDAP
# with the Twake schemas and the seed data, Dex) under the compose project
# `twake-directory-manager-e2e`, then writes the addresses Playwright needs to
# .generated/stack.json.
#
#   ../scripts/qa-environment/build.sh   # once, and whenever the console changes
#   ./scripts/start.sh
#
# The QA environment (project twake-directory-manager-qa, ports 18600/18601) can run beside it.
# The browser reaches Dex by its container IP (Chromium --host-resolver-rules,
# playwright.config.ts), the harness reaches OpenLDAP the same way. Linux only.
#
set -euo pipefail

E2E_DIR="$(cd "$(dirname "$0")/.." && pwd)"
QA_DIR="$(cd "$E2E_DIR/../scripts/qa-environment" && pwd)"
GENERATED="$E2E_DIR/.generated"

export QA_PROJECT="${E2E_PROJECT:-twake-directory-manager-e2e}"
export QA_APP_PORT="${E2E_APP_PORT:-18700}"
export QA_SSO_PORT="${E2E_SSO_PORT:-18701}"

"$QA_DIR/start.sh" >/dev/null

ip() {
  docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' \
    "$(docker compose -p "$QA_PROJECT" -f "$QA_DIR/docker-compose.yaml" ps -q "$1")"
}

mkdir -p "$GENERATED"
cat >"$GENERATED/stack.json" <<JSON
{
  "project": "$QA_PROJECT",
  "appPort": $QA_APP_PORT,
  "ssoPort": $QA_SSO_PORT,
  "directory": "$(ip directory)",
  "sso": "$(ip sso)",
  "ldap": "$(ip ldap)"
}
JSON

cat <<INFO

==> The e2e stack is up ($GENERATED/stack.json)

  npx playwright test

Stop it with: ./scripts/stop.sh
INFO
