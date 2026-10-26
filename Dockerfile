# Twake Directory Manager: ldap-rest with the plugins the console needs, and
# the console itself served next to its API.
#
#   docker build -t twake-directory-manager .
#   docker build --build-arg LDAP_REST_IMAGE=ldap-rest:local -t … .
#
# The console is tested against the ldap-rest named here, and needs at least
# one that serves the enterprise plugins (enterpriseRules, accountLifecycle,
# authzScope) and the scope answer of 0.25.0.
ARG LDAP_REST_IMAGE=ghcr.io/linagora/ldap-rest:1.1.0

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
# The page loads the ESM bundle and the stylesheet; the UMD bundles are for
# the npm package, and the source maps for nobody in production.
RUN npm run build && rm -f dist/*.map dist/twake-directory-manager.js dist/twake-directory-manager.min.js

FROM ${LDAP_REST_IMAGE}

# Inside ldap-rest's own static directory rather than in place of it, so the
# schemas that directory serves stay reachable for other clients.
COPY --from=build /build/dist /app/node_modules/ldap-rest/static/console
COPY --chmod=0755 docker/entrypoint.sh /usr/local/bin/twake-directory-manager
# Next to ldap-rest's node_modules, so that it finds `ldap-rest/plugin`.
COPY docker/consoleRoot.mjs docker/consoleSettings.mjs /app/plugins/

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
#
# /app/plugins/consoleRoot.mjs sends the bare host to the console, which
# otherwise answers "Cannot GET /". /app/plugins/consoleSettings.mjs passes
# DM_CONSOLE_HIDDEN_ATTRIBUTES on to the console.
#
# DM_STATIC_CSP is the Content-Security-Policy ldap-rest's static plugin sends
# with the console's page: scripts, styles and requests from the page's own
# origin only, no inline script or style, images from the origin or inlined
# (`data:`, the logos). A value written into the page cannot run under it, nor
# can the page be framed by another origin. A deployment that serves the page
# from one origin and the API from another widens `connect-src` here.
#
# Hidden by default, because nothing in the stack acts on them: the "other
# mailboxes", which no plugin reads, and the delivery mode, which no plugin
# applies — and its nomenclature with it.
ENV DM_CONSOLE_PLUGINS=core/static,/app/plugins/consoleRoot.mjs,/app/plugins/consoleSettings.mjs,core/configApi,core/ldap/groups,core/ldap/organizations,core/ldap/enterpriseRules,core/ldap/accountLifecycle,core/ldap/passwordPolicy,core/auth/authzScope \
 DM_AUTH_PLUGINS=core/auth/openidconnect,core/auth/authzLinid1 \
 DM_EXTRA_PLUGINS= \
 DM_CONSOLE_HIDDEN_ATTRIBUTES=twakeOtherMailbox,twakeDeliveryMode \
 DM_ALLOW_ANONYMOUS=false \
 DM_STATIC_CSP="default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; font-src 'self'; frame-ancestors 'self'; base-uri 'self'; form-action 'self'; object-src 'none'" \
 DM_LDAP_FLAT_SCHEMA=/app/node_modules/ldap-rest/static/schemas/twake/users.json,/app/node_modules/ldap-rest/static/schemas/twake/positions.json,/app/node_modules/ldap-rest/static/schemas/twake/nomenclature/twakeTitle.json,/app/node_modules/ldap-rest/static/schemas/twake/nomenclature/twakeAccountStatus.json,/app/node_modules/ldap-rest/static/schemas/twake/nomenclature/twakeListType.json,/app/node_modules/ldap-rest/static/schemas/twake/nomenclature/twakeMailboxType.json,/app/node_modules/ldap-rest/static/schemas/twake/nomenclature/twakeDomain.json \
 DM_GROUP_SCHEMA=/app/node_modules/ldap-rest/static/schemas/twake/groups.json \
 DM_ORGANIZATION_SCHEMA=/app/node_modules/ldap-rest/static/schemas/twake/organizations.json

# The quota the Twake Mail plugin (twake/james, through DM_EXTRA_PLUGINS)
# pushes: the size the console sets, mailQuotaSize. ldap-rest defaults to it
# since 0.17.0; set here all the same, so an image built on an older
# ldap-rest (LDAP_REST_IMAGE) does not fall back to mailQuota, which the
# Twake schemas do not define.
ENV DM_QUOTA_ATTRIBUTE=mailQuotaSize

EXPOSE 8081
ENTRYPOINT ["twake-directory-manager"]
CMD ["npx", "ldap-rest"]
