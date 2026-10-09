#!/bin/bash
#
# Builds the console image start.sh runs, from the working tree, with the release Dockerfile
# (ldap-rest + the console), and pulls the OpenLDAP and Dex images.
#
#   scripts/qa-environment/build.sh    # once, and whenever the code under test changes
#   LDAP_REST_IMAGE=ldap-rest:local scripts/qa-environment/build.sh   # on another ldap-rest
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"

build_args=()
if [ -n "${LDAP_REST_IMAGE:-}" ]; then
  build_args+=(--build-arg "LDAP_REST_IMAGE=$LDAP_REST_IMAGE")
fi

docker build "${build_args[@]}" -t twake-directory-manager-qa -f "$REPO_DIR/Dockerfile" "$REPO_DIR"

# Pinned tags: a local copy is as good when the registry does not answer
for image in osixia/openldap:1.5.0 ghcr.io/dexidp/dex:v2.41.1; do
  docker pull -q "$image" || docker image inspect "$image" >/dev/null
done
