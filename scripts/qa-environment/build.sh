#!/bin/bash
#
# Builds the console image start.sh runs, from the working tree, with the release Dockerfile
# (ldap-rest + the console), and the OpenLDAP image of openldap/ from the upstream release
# (#399); pulls Dex. QA_OPENLDAP_VERSION picks another OpenLDAP release than the Dockerfile's;
# QA_LDAP_IMAGE=osixia/openldap:1.5.0 pulls the 2.4 image of the compatibility check (#118)
# instead of building one.
#
#   scripts/qa-environment/build.sh    # once, and whenever the code under test changes
#   QA_OPENLDAP_VERSION=2.7.2 scripts/qa-environment/build.sh   # on OpenLDAP 2.7
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

if [ "${QA_LDAP_IMAGE:-}" = twake-directory-manager-qa-ldap ]; then
  # Built already, as CI does with a cache: nothing to pull
  images=()
elif [ -n "${QA_LDAP_IMAGE:-}" ]; then
  images=("$QA_LDAP_IMAGE")
else
  images=()
  ldap_args=()
  if [ -n "${QA_OPENLDAP_VERSION:-}" ]; then
    ldap_args+=(--build-arg "OPENLDAP_VERSION=$QA_OPENLDAP_VERSION")
  fi
  docker build "${ldap_args[@]}" -t twake-directory-manager-qa-ldap "$SCRIPT_DIR/openldap"
fi

# Pinned tags: a local copy is as good when the registry does not answer
for image in "${images[@]}" ghcr.io/dexidp/dex:v2.41.1; do
  docker pull -q "$image" || docker image inspect "$image" >/dev/null
done
