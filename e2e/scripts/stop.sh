#!/bin/bash
#
# Stops the e2e stack started by start.sh and drops its data.
#
set -euo pipefail

E2E_DIR="$(cd "$(dirname "$0")/.." && pwd)"

QA_PROJECT="${E2E_PROJECT:-twake-directory-manager-e2e}" \
  "$E2E_DIR/../scripts/qa-environment/stop.sh"
rm -f "$E2E_DIR/.generated/stack.json"
