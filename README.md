# Twake Directory Manager

The administration console of an enterprise directory: organizations, users,
groups and positions, with what an administrator does in _Active Directory
Users and Computers_ and the _Exchange Admin Center_ — create and move
accounts, disable them, reset a password, manage a group's members — on
OpenLDAP, behind a single sign-on, for the Twake Workplace.

It runs on [ldap-rest](https://github.com/linagora/ldap-rest) and is built
entirely from what that server advertises: the entities, their schemas and
what the signed-in administrator may do. No entity, attribute or label is
written in the console, so a directory laid out differently gets its own
interface from its own schemas.

## Running it

The image is ldap-rest with the console and the plugins it needs:

```sh
docker run -p 8081:8081 \
  -e DM_LDAP_URL=ldap://ldap.example.org \
  -e DM_LDAP_DN='cn=admin,dc=example,dc=org' \
  -e DM_LDAP_PWD=secret \
  -e DM_LDAP_BASE='dc=example,dc=org' \
  -e DM_LDAP_TOP_ORGANIZATION='ou=organization,dc=example,dc=org' \
  -e DM_LDAP_GROUP_BASE='ou=groups,dc=example,dc=org' \
  -e DM_OIDC_SERVER=https://auth.example.org \
  -e DM_OIDC_CLIENT_ID=twake-directory-manager \
  -e DM_OIDC_CLIENT_SECRET=secret \
  -e DM_BASE_URL=https://directory.example.org \
  ghcr.io/linagora/twake-directory-manager
```

The console is then at `https://directory.example.org/static/console/`, behind
the HTTPS reverse proxy that serves that name, and the API
it uses under `/api`. Every other ldap-rest setting is an environment
variable too — see the
[ldap-rest configuration](https://github.com/linagora/ldap-rest/tree/master/docs/usage).

### Plugins

`DM_PLUGINS` is composed when the container starts, from three parts:

| Variable             | Default                                                                                                                                  | What it is                                                                  |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `DM_AUTH_PLUGINS`    | `core/auth/openidconnect,core/auth/authzLinid1`                                                                                          | Who the caller is, and which branches they administer                       |
| `DM_CONSOLE_PLUGINS` | `core/static`, `core/configApi`, `core/ldap/{flatGeneric,groups,organizations,enterpriseRules,accountLifecycle}`, `core/auth/authzScope` | What the console reads and writes                                           |
| `DM_EXTRA_PLUGINS`   | _(empty)_                                                                                                                                | Anything else: `core/twake/james`, `core/ldap/trash`, `core/auth/crowdsec`… |

`DM_PLUGINS_OVERRIDE` replaces the whole list, for a deployment that knows
exactly what it wants.

**The container refuses to start with `DM_AUTH_PLUGINS` empty.** ldap-rest
without an authentication plugin serves every request, and this interface
creates accounts, resets passwords and deletes organizations. Set
`DM_ALLOW_ANONYMOUS=true` for a test instance that nobody else can reach.

### Authentication

The default is OpenID Connect, with any provider — LemonLDAP::NG is one. The
container does not start until the four variables above are set. At the
provider, declare a confidential client:

- redirect URI `https://directory.example.org/callback`;
- scopes `openid profile email`;
- `sub` holding the account's `uid`, which is LemonLDAP::NG's default.
  `authzLinid1` finds the account by it.

`authzLinid1` then grants each administrator the branches whose
`twakeLocalAdminLink` names them, and their sub-branches: an account named on
no organization signs in and may do nothing. An administrator of the whole
directory is named on the top organization itself.

LemonLDAP::NG's own handler is the alternative when the provider is
LemonLDAP::NG and its configuration is reachable from the container:

```sh
  -e DM_AUTH_PLUGINS=core/auth/llng,core/auth/authzLinid1 \
  -v /etc/lemonldap-ng/lemonldap-ng.ini:/etc/lemonldap-ng/lemonldap-ng.ini:ro \
```

with this server's name in the file's `[node-handler] nodeVhosts`.

### Schemas

The Twake schemas that ship with ldap-rest are loaded by default:

| Variable                 | Default                                                                 |
| ------------------------ | ----------------------------------------------------------------------- |
| `DM_LDAP_FLAT_SCHEMA`    | `twake/users.json`, `twake/positions.json`, `twake/nomenclature/*.json` |
| `DM_GROUP_SCHEMA`        | `twake/groups.json`                                                     |
| `DM_ORGANIZATION_SCHEMA` | `twake/organizations.json`                                              |

under `/app/node_modules/ldap-rest/static/schemas/`.

The nomenclatures — titles, account states, delivery modes, list and mailbox
types, mail domains — are loaded as entities of their own. They have to be: a
select in a form is filled by listing the entity whose base its `branch`
names, and a nomenclature nobody loaded leaves its select empty. A deployment
replacing `DM_LDAP_FLAT_SCHEMA` keeps them in its list.

A deployment with its own
schemas mounts them and points these variables at them: the mail domains, the
national formats and the payroll-number rules of a directory belong there,
never in the code.

### ldap-rest version

The image is built on `ghcr.io/linagora/ldap-rest`, whose version is a build
argument:

```sh
docker build --build-arg LDAP_REST_IMAGE=ghcr.io/linagora/ldap-rest:0.8.0 \
  -t twake-directory-manager .
```

The console needs the enterprise plugins, which ldap-rest ships from 0.8.0.

## Documentation

- [Using the console](docs/usage.md): what the server has to expose, what
  each schema marker changes in the interface, the behaviour worth knowing,
  and how a deployment restyles it.

## Development

```sh
npm ci
npm test           # unit tests, no server needed
npm run build      # bundles and page in dist/
npm run lint
npm run format:check
```

To try a change against a directory, serve `dist/` from a local ldap-rest:

```sh
npx ldap-rest --plugin core/static --static-path ./dist --static-name console \
  --plugin core/configApi --plugin core/ldap/flatGeneric …
# http://localhost:8081/console/
```

## License

[AGPL-3.0](LICENSE) — © LINAGORA
