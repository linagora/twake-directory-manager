# Twake Directory Manager: ldap-rest with the plugins the console needs, and
# the console itself served next to its API.
#
#   docker build -t twake-directory-manager .
#   docker build --build-arg LDAP_REST_IMAGE=ldap-rest:local -t … .
#
# The console needs an ldap-rest recent enough to serve the enterprise
# plugins (enterpriseRules, accountLifecycle, authzScope).
ARG LDAP_REST_IMAGE=ghcr.io/linagora/ldap-rest:0.9.0

# The console builds to JavaScript and CSS, which are the same whatever the
# target architecture, so this stage runs natively. Left to follow the target
# it would run the whole npm build emulated for the arm64 image.
FROM --platform=$BUILDPLATFORM node:24-alpine AS build

WORKDIR /build
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY rollup.config.mjs tsconfig.json ./
COPY src ./src
COPY public ./public
RUN npm run build && rm -f dist/*.map

FROM ${LDAP_REST_IMAGE}

# Inside ldap-rest's own static directory rather than in place of it, so the
# schemas that directory serves stay reachable for other clients.
COPY --from=build /build/dist /app/node_modules/ldap-rest/static/console
COPY --chmod=0755 docker/entrypoint.sh /usr/local/bin/twake-directory-manager

# Authentication defaults to OpenID Connect, which a browser console can use
# with any provider — LemonLDAP::NG included — and which refuses to start
# until DM_OIDC_SERVER, DM_OIDC_CLIENT_ID, DM_OIDC_CLIENT_SECRET and
# DM_BASE_URL are set.
#
# The nomenclatures are flat entities like the users: a pointer field is filled
# by listing the entity whose base it names, so a nomenclature that is not
# loaded leaves its select empty.
#
# `core/ldap/flatGeneric` is not in the list: each schema of
# DM_LDAP_FLAT_SCHEMA already creates its own instance, and naming the plugin
# as well asked for a nameless one on top, which ldap-rest dropped with a
# warning at every start.
ENV DM_CONSOLE_PLUGINS=core/static,core/configApi,core/ldap/groups,core/ldap/organizations,core/ldap/enterpriseRules,core/ldap/accountLifecycle,core/auth/authzScope \
 DM_AUTH_PLUGINS=core/auth/openidconnect,core/auth/authzLinid1 \
 DM_EXTRA_PLUGINS= \
 DM_ALLOW_ANONYMOUS=false \
 DM_LDAP_FLAT_SCHEMA=/app/node_modules/ldap-rest/static/schemas/twake/users.json,/app/node_modules/ldap-rest/static/schemas/twake/positions.json,/app/node_modules/ldap-rest/static/schemas/twake/nomenclature/twakeTitle.json,/app/node_modules/ldap-rest/static/schemas/twake/nomenclature/twakeAccountStatus.json,/app/node_modules/ldap-rest/static/schemas/twake/nomenclature/twakeDeliveryMode.json,/app/node_modules/ldap-rest/static/schemas/twake/nomenclature/twakeListType.json,/app/node_modules/ldap-rest/static/schemas/twake/nomenclature/twakeMailboxType.json,/app/node_modules/ldap-rest/static/schemas/twake/nomenclature/twakeDomain.json \
 DM_GROUP_SCHEMA=/app/node_modules/ldap-rest/static/schemas/twake/groups.json \
 DM_ORGANIZATION_SCHEMA=/app/node_modules/ldap-rest/static/schemas/twake/organizations.json

EXPOSE 8081
ENTRYPOINT ["twake-directory-manager"]
CMD ["npx", "ldap-rest"]
