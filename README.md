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

`DM_LDAP_BASE` is required: ldap-rest refuses to start without it, and every
search — the one finding who signed in included — runs under it.

The console is then at `https://directory.example.org/static/console/` (the
bare `https://directory.example.org/` redirects there), behind
the HTTPS reverse proxy that serves that name, and the API
it uses under `/api`. Every other ldap-rest setting is an environment
variable too — see the
[ldap-rest configuration](https://github.com/linagora/ldap-rest/tree/master/docs/usage).

### Plugins

`DM_PLUGINS` is composed when the container starts, from three parts:

| Variable             | Default                                                                                                                                                                                                   | What it is                                                                  |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `DM_AUTH_PLUGINS`    | `core/auth/openidconnect,core/auth/authzLinid1`                                                                                                                                                           | Who the caller is, and which branches they administer                       |
| `DM_CONSOLE_PLUGINS` | `core/static`, `/app/plugins/{consoleRoot,consoleSettings}.mjs`, `core/configApi`, `core/ldap/{flatGeneric,groups,organizations,enterpriseRules,accountLifecycle,passwordPolicy}`, `core/auth/authzScope` | What the console reads and writes                                           |
| `DM_EXTRA_PLUGINS`   | _(empty)_                                                                                                                                                                                                 | Anything else: `core/twake/james`, `core/ldap/trash`, `core/auth/crowdsec`… |

`DM_PLUGINS_OVERRIDE` replaces the whole list, for a deployment that knows
exactly what it wants.

`/app/plugins/consoleRoot.mjs` sends the bare host to the console; a list
that leaves it out leaves `/` unanswered. `/app/plugins/consoleSettings.mjs`
passes `DM_CONSOLE_HIDDEN_ATTRIBUTES` on to the console; without it, nothing
is hidden.

**The container refuses to start with `DM_AUTH_PLUGINS` empty.** ldap-rest
refuses to start with an authorization plugin but no authentication plugin,
and with neither it serves every request; this interface creates accounts,
resets passwords and deletes organizations. Set
`DM_ALLOW_ANONYMOUS=true` for a test instance that nobody else can reach.

### Password policies

The console edits the OpenLDAP password policies kept under
`DM_PPOLICY_BASE` (the top of the directory by default). With several
policies, set `DM_PPOLICY_DEFAULT_DN` to the one slapd applies by default
(`olcPPolicyDefault`): ldap-rest cannot read it, and without it no policy is
the default one. See ldap-rest's
[password policy plugin](https://github.com/linagora/ldap-rest/blob/master/docs/usage/plugins/ldap/password-policy.md).

Who manages them is the server's rule, and the console shows the page to
whoever it lets read them. With `authzLinid1`, set `DM_AUTHZ_GLOBAL_BRANCHES`
to `DM_PPOLICY_BASE`: only the administrators of the top organization, or of
`DM_AUTHZ_GLOBAL_ORGANIZATION`, then read and change them. Without it, every
administrator reads them and nobody changes them
([global branches](https://github.com/linagora/ldap-rest/blob/master/docs/usage/plugins/auth/authz-linid1.md#global-branches)).

### Mail domains

The mail domains are reference data, outside the organization tree: with
`authzLinid1`, every administrator reads them and nobody adds or deletes
one. Set `DM_AUTHZ_GLOBAL_WRITE_BRANCHES` to their branch
(`ou=domains,ou=nomenclature` under `DM_LDAP_BASE`): the administrators of
the top organization, or of `DM_AUTHZ_GLOBAL_ORGANIZATION`, then add and
delete them, and every other administrator still reads them to link an
organization or complete an address. Unlike `DM_AUTHZ_GLOBAL_BRANCHES`, it
hides nothing. ldap-rest's James plugin creates each new domain in Twake
Mail and removes a deleted one, and refuses to delete a domain an
organization links or an address uses. ldap-rest's API only handles entries
right under the branch: a domain nested deeper (`dc=example,dc=org,ou=domains,…`)
shows on the page but can be neither changed nor deleted. See ldap-rest's
[global branches](https://github.com/linagora/ldap-rest/blob/master/docs/usage/plugins/auth/authz-linid1.md#global-branches)
and [mail domains](https://github.com/linagora/ldap-rest/blob/master/docs/usage/plugins/integrations/james-mail.md#mail-domains).

### Team mailboxes

Twake Mail expands every group of its mailing list branch: a team mailbox
created among the lists would deliver twice. ldap-rest's
`twake/teamMailboxes.json` schema keeps them in a branch of their own,
`ou=teammailboxes` under `DM_LDAP_BASE`, with a sidebar entry of their own:
create that branch, append the schema to `DM_LDAP_FLAT_SCHEMA`, and set
`DM_JAMES_MAILING_LIST_BRANCHES` to the lists branch so that ldap-rest
refuses a team mailbox there. Leave `cn=teamMailbox` out of the mailbox type
nomenclature: the groups form then does not offer it. See ldap-rest's
[team mailboxes](https://github.com/linagora/ldap-rest/blob/master/docs/usage/plugins/integrations/james-mailboxes.md#team-mailboxes-in-a-branch-of-their-own).

### Authentication

The default is OpenID Connect, with any provider — LemonLDAP::NG is one. The
container does not start until the four variables above are set. At the
provider, declare a confidential client:

- redirect URI `https://directory.example.org/callback`;
- scopes `openid profile email`;
- no post-logout redirect URI: signing out ends on the provider's own page;
- `sub` holding the account's `uid`, which is LemonLDAP::NG's default.
  `authzLinid1` finds the account by it, and refuses every request with a
  `403` when that `uid` names several entries under `DM_LDAP_BASE` — a
  homonym left in the trash counts. Keep uids unique, with OpenLDAP's
  `unique` overlay.

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

The nomenclatures — titles, account states, list and mailbox types, mail
domains — are loaded as entities of their own. They have to be: a
select in a form is filled by listing the entity whose base its `branch`
names, and a nomenclature nobody loaded leaves its select empty. A deployment
replacing `DM_LDAP_FLAT_SCHEMA` keeps them in its list. The delivery modes
(`twake/nomenclature/twakeDeliveryMode.json`) are not loaded: see below.

An account's card lists its groups from `memberOf` when the directory
maintains it — OpenLDAP's `memberof` overlay, set for `groupOfNames` and
`member`. Otherwise it searches the groups whose `member` holds the
account's DN (this needs ldap-rest 0.20.1).

### Hidden attributes and forwards

Some attributes of the Twake user schema have no effect in a Twake
deployment, and an administrator finding them under _Mailbox settings_ would
fill them in expecting one. The console does not show them:

| Variable                       | Default                               | What it is                                                           |
| ------------------------------ | ------------------------------------- | -------------------------------------------------------------------- |
| `DM_CONSOLE_HIDDEN_ATTRIBUTES` | `twakeOtherMailbox,twakeDeliveryMode` | Attributes left out of the forms, the cards, the lists and CSV files |
| `DM_JAMES_SYNC_FORWARDS`       | `false`                               | `true` to mirror `mailForwardingAddress` to Twake Mail forwards      |

- `twakeOtherMailbox` (_Other mailboxes_) is read by no plugin, and by
  nothing in Twake Mail.
- `twakeDeliveryMode` is applied by no plugin; new accounts keep receiving
  its default, `normal`.
- **Forwards are a user setting in Twake Mail**, with "keep a copy in my
  mailbox", and ldap-rest leaves them to it since 0.19.0.
  `DM_JAMES_SYNC_FORWARDS=true` (ldap-rest's `--james-sync-forwards`) is for a
  deployment where the directory owns forwards: with `core/twake/james`,
  `DM_FORWARD_ATTRIBUTE` (`mailForwardingAddress`) is then mirrored to them, and
  **the directory overwrites what users set in Twake Mail**, change after
  change, without being told of what they set there.

Hidden attributes stay in the directory as they are: the console neither
shows nor sends them. An empty `DM_CONSOLE_HIDDEN_ATTRIBUTES` shows them all
again.

A deployment with its own
schemas mounts them and points these variables at them: the mail domains, the
national formats and the payroll-number rules of a directory belong there,
never in the code.

### Full names

A form writes the full name (role `displayName`) from the given name and the
surname (roles `givenName` and `surname`) as they are typed, until the
administrator writes it otherwise. Which comes first depends on the country:

| Variable                      | Default                 | What it is                                                     |
| ----------------------------- | ----------------------- | -------------------------------------------------------------- |
| `DM_CONSOLE_FULL_NAME_FORMAT` | `{givenName} {surname}` | The full name, `{givenName}` and `{surname}` standing for them |

`{surname} {givenName}` puts the family name first, as in Mongolia, China or
Japan.

### ldap-rest version

The image is built on `ghcr.io/linagora/ldap-rest`, at the version the
`Dockerfile` names, and the console is tested against that version only. The
base image is a build argument:

```sh
docker build --build-arg LDAP_REST_IMAGE=ghcr.io/linagora/ldap-rest:<version> \
  -t twake-directory-manager .
```

An older ldap-rest serves the console as far as its API matches, but is not
tested: one older than 0.25.0 lacks parts of the scope answer the console
reads, and offers less; one that still reports a search too broad as a `500`
(before 0.13.0) has large lists and pointer selects fail with a plain
error, and no search offered in their place.

### Kubernetes

A Helm chart is published with each release, under the same version as the
image (`--version` names the release to install):

```sh
helm install directory-manager \
  oci://ghcr.io/linagora/charts/twake-directory-manager --version 0.12.0 \
  --set ldap.url=ldap://ldap.example.org \
  --set ldap.bindDn='cn=admin,dc=example,dc=org' \
  --set ldap.base='dc=example,dc=org' \
  --set oidc.server=https://auth.example.org \
  --set ingress.enabled=true \
  --set ingress.hostname=directory.example.org \
  --set secrets.ldapPassword=secret \
  --set secrets.oidcClientSecret=secret
```

`secrets.existingSecret` names a Secret holding `DM_LDAP_PWD` and
`DM_OIDC_CLIENT_SECRET` instead — and `DM_LDAP_DN`, when `ldap.bindDn` is left
empty — and `extraEnv` passes any other ldap-rest setting. Those that are
credentials go under `secrets.extraEnv` instead, which lands in the Secret
rather than a ConfigMap: the WebAdmin tokens of the `core/twake/james` and
`core/twake/calendar` plugins, for instance,

```sh
  --set extraEnv.DM_EXTRA_PLUGINS='core/twake/james\,core/twake/calendar' \
  --set extraEnv.DM_JAMES_WEBADMIN_URL=http://tmail-admin.tmail:8000 \
  --set secrets.extraEnv.DM_JAMES_WEBADMIN_TOKEN=secret \
  --set extraEnv.DM_CALENDAR_WEBADMIN_URL=http://calendar-webadmin:8080 \
  --set secrets.extraEnv.DM_CALENDAR_WEBADMIN_TOKEN=secret
```

A directory's own schemas are mounted with `extraVolumes` and
`extraVolumeMounts`, and named in `extraEnv`. `fullnameOverride` names the
objects instead of the release, for a chart that embeds this one. See
[values.yaml](helm/twake-directory-manager/values.yaml).

Have the provider issue refresh tokens to the client: without them a session
ends with its access token, and the console's next action goes back through
the provider, losing what a form held. See ldap-rest's
[session lifetime](https://github.com/linagora/ldap-rest/blob/master/docs/usage/plugins/auth/oidc.md#session-lifetime).

`bcl.enabled=true` turns on Back-Channel Logout: a logout at the provider, or
in another application, ends the console's session too. Declare
`https://directory.example.org/backchannel-logout` as the client's
back-channel logout URI. The ended sessions are recorded under
`bcl.backend`: `ldap` (the default, in the branch `bcl.ldap.base`, which must
exist), `file` (on a volume, one replica only), `postgres` or `valkey`. See
ldap-rest's
[Back-Channel Logout](https://github.com/linagora/ldap-rest/blob/master/docs/usage/plugins/auth/back-channel-logout.md)
and [storage](https://github.com/linagora/ldap-rest/blob/master/docs/usage/plugins/utilities/storage.md).

## Documentation

- [Administrator's guide](docs/admin-guide/): getting started with the
  console, for global and local administrators. Sphinx sources:
  `make -C docs/admin-guide html`, or `make -C docs/admin-guide pdf` for the
  PDF (Docker only). The _Administrator's guide_ workflow builds the PDF on
  demand.
- [Using the console](docs/usage.md): what the server has to expose, what
  each schema marker changes in the interface, the behaviour worth knowing,
  and how a deployment restyles it.

## Development

```sh
npm ci
npm test               # unit tests, no server needed
npm run test:coverage  # the same, with coverage (thresholds in .c8rc.json)
npm run build          # bundles and page in dist/
npm run lint
npm run format:check
```

A release is a tag `vX.Y.Z` on `main`. The commit under it bumps
`package.json` with `npm version X.Y.Z --no-git-tag-version`, which also
writes the version into the Helm chart, and adds a `## vX.Y.Z (date)` section
to `CHANGELOG.md`: the release workflow refuses a tag that disagrees with any
of the three, and takes the release notes from that section. A prerelease
(`vX.Y.Z-rc.1`) follows the same rule, under its own version.

To try a change against a directory, serve `dist/` from a local ldap-rest:

```sh
npx ldap-rest --plugin core/static --static-path ./dist --static-name console \
  --plugin core/configApi --plugin core/ldap/flatGeneric …
# http://localhost:8081/console/
```

End to end tests (Playwright, against the stack of `scripts/qa-environment/`):
[`e2e/README.md`](e2e/README.md).

How the code is put together: [ARCHITECTURE.md](ARCHITECTURE.md); how to
change it, and how a release is cut: [CONTRIBUTING.md](CONTRIBUTING.md); the
decisions behind it: [docs/adr/](docs/adr/).

## License

[AGPL-3.0](LICENSE) — © LINAGORA
