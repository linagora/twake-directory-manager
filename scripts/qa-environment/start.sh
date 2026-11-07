#!/bin/bash
#
# Starts a long lived console + OpenLDAP + Dex stack for manual or agent driven exploratory QA.
# OpenLDAP gets the Twake schemas (ldap/*-schema.ldif), the ppolicy overlay (pwdReset, the
# password policies), the memberof overlay (an account's mailing lists) and the seed data of
# ldap/seed.ldif; Dex authenticates against it.
#
#   scripts/qa-environment/build.sh    # once, and whenever the code under test changes
#   scripts/qa-environment/start.sh
#
# The stack runs OpenLDAP 2.6 (bitnamilegacy/openldap:2.6.10). The 2.4 compatibility check of
# #118 runs the same stack on osixia/openldap:1.5.0:
#
#   QA_LDAP_IMAGE=osixia/openldap:1.5.0 scripts/qa-environment/build.sh
#   QA_LDAP_IMAGE=osixia/openldap:1.5.0 scripts/qa-environment/start.sh
#
# Accounts (password "secret"): admin administers the whole directory, sophie.martin the Sales
# organization, eric.dubois Engineering; alice, bob, carol, dave, erin, frank (disabled) and
# grace (in transit) administer nothing.
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
GENERATED_DIR="$SCRIPT_DIR/.generated"

QA_PROJECT="${QA_PROJECT:-twake-directory-manager-qa}"
export QA_APP_PORT="${QA_APP_PORT:-18600}"
export QA_SSO_PORT="${QA_SSO_PORT:-18601}"

APP_URL="http://localhost:$QA_APP_PORT"

compose() {
  docker compose -p "$QA_PROJECT" -f "$SCRIPT_DIR/docker-compose.yaml" "$@"
}

ldap_exec() {
  compose exec -T ldap "$@"
}

if ! docker image inspect twake-directory-manager-qa >/dev/null 2>&1; then
  echo "The twake-directory-manager-qa image is missing, build it first: scripts/qa-environment/build.sh" >&2
  exit 1
fi

echo "==> Starting OpenLDAP as compose project '$QA_PROJECT'"
compose up -d ldap

# The two images share the protocol only: what one ships tells which one runs.
# A 2.6 image (Bitnami) listens on 1389 and keeps its cn=config socket under
# its own prefix; the 2.4 image (osixia) listens on 389, its socket at the
# default path, and holds the main database at {1}mdb where the 2.6 image
# holds it at {2}mdb.
if compose exec -T ldap test -x /opt/bitnami/scripts/openldap/run.sh; then
  ldap_flavour=bitnami
  export QA_LDAP_PORT="${QA_LDAP_PORT:-1389}"
  ldapi='ldapi://%2Fopt%2Fbitnami%2Fopenldap%2Fvar%2Frun%2Fldapi'
  slapd_db='{2}mdb'
else
  ldap_flavour=osixia
  export QA_LDAP_PORT="${QA_LDAP_PORT:-389}"
  ldapi='ldapi:///'
  slapd_db='{1}mdb'
fi

echo "==> Generating the configuration in $GENERATED_DIR"
mkdir -p "$GENERATED_DIR"
cat > "$GENERATED_DIR/dex.yaml" <<DEX
issuer: http://sso:$QA_SSO_PORT
storage:
  type: memory
web:
  http: 0.0.0.0:$QA_SSO_PORT
oauth2:
  skipApprovalScreen: true
  responseTypes: [code]
staticClients:
  - id: twake-directory-manager
    name: Twake Directory Manager
    secret: qa-client-secret-qa-client-secret
    redirectURIs:
      - $APP_URL/callback
enablePasswordDB: false
connectors:
  - type: ldap
    id: ldap
    name: LDAP
    config:
      host: ldap:$QA_LDAP_PORT
      insecureNoSSL: true
      bindDN: cn=admin,dc=example,dc=com
      bindPW: admin
      usernamePrompt: Username
      userSearch:
        baseDN: ou=users,dc=example,dc=com
        filter: (objectClass=twakeAccount)
        username: uid
        idAttr: uid
        emailAttr: mail
        nameAttr: displayName
        preferredUsernameAttr: uid
DEX

echo "==> Waiting for OpenLDAP"
for _ in $(seq 1 60); do
  if ldap_exec ldapwhoami -Q -Y EXTERNAL -H "$ldapi" >/dev/null 2>&1 &&
    ldap_exec ldapsearch -x -H "ldap://localhost:$QA_LDAP_PORT" -D cn=admin,dc=example,dc=com -w admin \
      -b "" -s base dn >/dev/null 2>&1; then
    ready=true
    break
  fi
  sleep 2
done
if [ "${ready:-false}" != "true" ]; then
  echo "OpenLDAP did not start within 2 minutes, see: docker compose -p $QA_PROJECT logs ldap" >&2
  exit 1
fi

echo "==> Provisioning"
# Read whole before grepping: grep -q leaves early, and pipefail takes the writer's broken pipe
# for a failure
schemas="$(ldap_exec ldapsearch -Q -Y EXTERNAL -H "$ldapi" -b cn=schema,cn=config -LLL '(cn=*}twake)' dn)"
if grep -q twake <<<"$schemas"; then
  echo "    schemas already loaded"
else
  # The Twake schema names mailForwardingAddress, which postfix-book defines
  # and the osixia image loads at bootstrap; a 2.6 image may not ship it.
  # Read whole before grepping: grep -q leaves early, and pipefail takes the
  # writer's broken pipe for a failure
  types="$(ldap_exec ldapsearch -Q -Y EXTERNAL -H "$ldapi" -b cn=subschema -s base -LLL attributeTypes)"
  if ! grep -q mailForwardingAddress <<<"$types"; then
    ldap_exec ldapadd -Q -Y EXTERNAL -H "$ldapi" -f /qa-ldap/postfix-book-schema.ldif >/dev/null
  fi
  ldap_exec ldapadd -Q -Y EXTERNAL -H "$ldapi" -f /qa-ldap/mail-schema.ldif >/dev/null
  ldap_exec ldapadd -Q -Y EXTERNAL -H "$ldapi" -f /qa-ldap/twake-schema.ldif >/dev/null
  if [ "$ldap_flavour" = bitnami ]; then
    # The ppolicy module and overlay come from LDAP_CONFIGURE_PPOLICY; the
    # policy the console names is the seed's default one.
    ldap_exec ldapmodify -Q -Y EXTERNAL -H "$ldapi" >/dev/null <<LDIF
dn: olcOverlay={0}ppolicy,olcDatabase=$slapd_db,cn=config
changetype: modify
add: olcPPolicyDefault
olcPPolicyDefault: cn=default,ou=policies,dc=example,dc=com
LDIF
    # memberOf, which an account's card lists its mailing lists from. The 2.6
    # image loads neither the module nor an overlay for groupOfNames.
    ldap_exec ldapmodify -Q -Y EXTERNAL -H "$ldapi" >/dev/null <<LDIF
dn: cn=module,cn=config
changetype: add
cn: module
objectClass: olcModuleList
olcModulePath: /opt/bitnami/openldap/lib/openldap
olcModuleLoad: memberof.so

dn: olcOverlay={1}memberof,olcDatabase=$slapd_db,cn=config
changetype: add
objectClass: olcOverlayConfig
objectClass: olcMemberOfConfig
olcOverlay: {1}memberof
olcMemberOfGroupOC: groupOfNames
olcMemberOfMemberAD: member
olcMemberOfMemberOfAD: memberOf
LDIF
  else
    # pwdReset, which the console sets to force a new password at next login, is an operational
    # attribute the ppolicy overlay registers. Its default policy is the seed's, which the console
    # names too (DM_PPOLICY_DEFAULT_DN of docker-compose.yaml)
    ldap_exec ldapmodify -Q -Y EXTERNAL -H "$ldapi" >/dev/null <<LDIF
dn: cn=module{0},cn=config
changetype: modify
add: olcModuleLoad
olcModuleLoad: ppolicy

dn: olcOverlay=ppolicy,olcDatabase=$slapd_db,cn=config
changetype: add
objectClass: olcOverlayConfig
objectClass: olcPPolicyConfig
olcOverlay: ppolicy
olcPPolicyDefault: cn=default,ou=policies,dc=example,dc=com
LDIF
    # memberOf, which an account's card lists its mailing lists from, is kept by the memberof
    # overlay. The image loads it (and refint) for groupOfUniqueNames, the Twake groups are
    # groupOfNames. It only computes memberOf for memberships written after it, hence before the
    # seed data.
    ldap_exec ldapmodify -Q -Y EXTERNAL -H "$ldapi" >/dev/null <<LDIF
dn: olcOverlay={0}memberof,olcDatabase=$slapd_db,cn=config
changetype: modify
replace: olcMemberOfGroupOC
olcMemberOfGroupOC: groupOfNames
-
replace: olcMemberOfMemberAD
olcMemberOfMemberAD: member
-
replace: olcMemberOfMemberOfAD
olcMemberOfMemberOfAD: memberOf
LDIF
  fi
fi
if ldap_exec ldapsearch -x -H "ldap://localhost:$QA_LDAP_PORT" -D cn=admin,dc=example,dc=com -w admin \
  -b uid=admin,ou=users,dc=example,dc=com -s base dn >/dev/null 2>&1; then
  echo "    already provisioned"
else
  # A 2.6 image whose default tree is skipped holds no naming context yet; the
  # seed only fills what hangs under it.
  if ! ldap_exec ldapsearch -x -H "ldap://localhost:$QA_LDAP_PORT" -D cn=admin,dc=example,dc=com -w admin \
    -b dc=example,dc=com -s base dn >/dev/null 2>&1; then
    ldap_exec ldapadd -x -H "ldap://localhost:$QA_LDAP_PORT" -D cn=admin,dc=example,dc=com -w admin \
      -f /qa-ldap/base.ldif >/dev/null
  fi
  ldap_exec ldapadd -x -H "ldap://localhost:$QA_LDAP_PORT" -D cn=admin,dc=example,dc=com -w admin \
    -f /qa-ldap/seed.ldif >/dev/null
fi

echo "==> Starting Dex and the console"
compose up -d

echo "==> Waiting for the console"
for _ in $(seq 1 60); do
  if [ "$(curl -s -o /dev/null -w '%{http_code}' "$APP_URL/api/v1/config")" != "000" ]; then
    up=true
    break
  fi
  sleep 2
done
if [ "${up:-false}" != "true" ]; then
  echo "The console did not answer within 2 minutes, see: docker compose -p $QA_PROJECT logs directory" >&2
  exit 1
fi

cat <<INFO

==> The QA environment is up

  OpenLDAP: $ldap_flavour, port $QA_LDAP_PORT
  Console: $APP_URL/static/console/  (sign in through Dex, password "secret")
           admin (whole directory), sophie.martin (Sales), eric.dubois (Engineering)
  Dex:     http://sso:$QA_SSO_PORT  (from a browser on the host: add "127.0.0.1 sso" to /etc/hosts)

From a container (e.g. Playwright), join the network '${QA_PROJECT}_default' and use:
  --host-resolver-rules="MAP localhost:$QA_APP_PORT directory:8081"

Stop it with: scripts/qa-environment/stop.sh
INFO
