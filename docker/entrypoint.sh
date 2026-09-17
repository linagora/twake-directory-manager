#!/bin/sh
# Compose DM_PLUGINS from its three parts, then run the command.
#
# The console is an administration interface: it creates accounts, resets
# passwords and deletes organizations. Started without an authentication
# plugin, ldap-rest lets every request through, so an image run with its
# defaults overridden carelessly would publish all of that to whoever reaches
# the port. It refuses to start that way unless told to.
set -e

if [ -n "$DM_PLUGINS_OVERRIDE" ]; then
  DM_PLUGINS="$DM_PLUGINS_OVERRIDE"
else
  if [ -z "$DM_AUTH_PLUGINS" ] && [ "$DM_ALLOW_ANONYMOUS" != "true" ]; then
    echo "twake-directory-manager: DM_AUTH_PLUGINS is empty, so every request" >&2
    echo "would be served unauthenticated. Set an authentication plugin, or" >&2
    echo "DM_ALLOW_ANONYMOUS=true for a test instance." >&2
    exit 1
  fi
  DM_PLUGINS=$(printf '%s,%s,%s' "$DM_AUTH_PLUGINS" "$DM_CONSOLE_PLUGINS" "$DM_EXTRA_PLUGINS" |
    tr ',' '\n' | sed '/^$/d' | paste -sd, -)
fi
export DM_PLUGINS

exec "$@"
