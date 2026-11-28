#!/bin/sh
#
# First start: a bare cn=config, the root reaching it over ldapi through SASL
# EXTERNAL, and an empty mdb database for dc=example,dc=com, whose admin is
# cn=admin with the password "admin" (LDAP_ROOT and LDAP_ADMIN_PASSWORD
# override them). Everything else, schemas past the core ones, overlays and
# data, is start.sh's. Then slapd, in the foreground, on 389 and ldapi.
set -eu

CONFIG=/etc/openldap/slapd.d
DATA=/var/openldap-data
ROOT="${LDAP_ROOT:-dc=example,dc=com}"
SCHEMA=/etc/openldap/schema
MODULES=/opt/openldap/libexec/openldap

if [ ! -e "$CONFIG/cn=config.ldif" ]; then
  mkdir -p "$CONFIG" "$DATA" /var/run/openldap
  hash="$(slappasswd -s "${LDAP_ADMIN_PASSWORD:-admin}")"
  {
    cat <<LDIF
dn: cn=config
objectClass: olcGlobal
cn: config
olcArgsFile: /var/run/openldap/slapd.args
olcPidFile: /var/run/openldap/slapd.pid

dn: cn=module{0},cn=config
objectClass: olcModuleList
cn: module{0}
olcModulePath: $MODULES

dn: cn=schema,cn=config
objectClass: olcSchemaConfig
cn: schema

LDIF
    for schema in core cosine inetorgperson nis; do
      cat "$SCHEMA/$schema.ldif"
      echo
    done
    cat <<LDIF
dn: olcDatabase={0}config,cn=config
objectClass: olcDatabaseConfig
olcDatabase: {0}config
olcAccess: {0}to * by dn.exact=gidNumber=0+uidNumber=0,cn=peercred,cn=external,cn=auth manage by * none

dn: olcDatabase={1}mdb,cn=config
objectClass: olcDatabaseConfig
objectClass: olcMdbConfig
olcDatabase: {1}mdb
olcSuffix: $ROOT
olcRootDN: cn=admin,$ROOT
olcRootPW: $hash
olcDbDirectory: $DATA
olcDbMaxSize: 1073741824
olcDbIndex: objectClass eq
olcDbIndex: uid,mail,cn eq,sub
olcAccess: {0}to * by dn.exact=gidNumber=0+uidNumber=0,cn=peercred,cn=external,cn=auth manage by * break
olcAccess: {1}to attrs=userPassword by self write by anonymous auth by * none
olcAccess: {2}to * by * read
LDIF
  } | slapadd -n 0 -F "$CONFIG"
fi

mkdir -p /var/run/openldap
exec /opt/openldap/libexec/slapd -F "$CONFIG" -h "ldap:/// ldapi:///" -d "${LDAP_DEBUG:-0}"
