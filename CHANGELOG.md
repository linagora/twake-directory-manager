# Changelog

## Unreleased

### Features

- A schema can mark a collection large, `"entity": { "large": true }`: it is
  searched before it is listed, and a pointer into it is a search box. A
  directory without an organization tree — where nothing else tells the
  accounts apart — lists them whole otherwise,
  [doc](docs/usage.md#behaviour-worth-knowing)

## v0.4.2 (2026-10-06)

Built on ldap-rest 0.15.0.

### Features

- Helm chart: `extraVolumes` and `extraVolumeMounts` mount a directory's own
  schemas; `secrets.existingSecret` may hold the bind DN as well, with
  `ldap.bindDn` left empty; `fullnameOverride` names the objects when the
  chart is embedded in another

## v0.4.1 (2026-10-06)

Built on ldap-rest 0.15.0, which reads array, number and DN options from the
environment differently: a deployment passing `DM_AUTH_HMAC`, `DM_AUTH_TOTP` or
a DN option through `extraEnv` should check the
[ldap-rest notes](https://github.com/linagora/ldap-rest/blob/master/docs/usage/upgrading.md#to-0150).
The image's own settings are unaffected.

### Security

- Behind `--trusted-proxy`, an IPv4-mapped IPv6 address no longer passes for a
  trusted subnet; a TOTP entry whose digits are not a number no longer lets
  `Bearer NaN` authenticate (ldap-rest 0.15.0)

## v0.4.0 (2026-10-01)

Built on ldap-rest 0.14.0. 0.3.1 was never published: its changes are part of
this release.

### Breaking Changes

- A session ends when its access token expires, unless the identity provider
  issues refresh tokens to the console: the next action then reloads the page
  through the provider, which signs back in without asking while its own
  session lasts, but anything typed in a form and not yet saved is lost. Have
  the provider issue refresh tokens to the client (LemonLDAP::NG: _Issue
  refresh tokens_ in the relying party's options) —
  [ldap-rest notes](https://github.com/linagora/ldap-rest/blob/master/docs/usage/upgrading.md#an-openid-connect-session-ends-with-its-access-token)

### Bug Fixes

- An action taken once the session has ended goes back through the identity
  provider and signs in again; the server left the console's request
  unanswered, and the console waited
- A list or a search matching more entries than the directory answers in one
  search — the accounts of a large directory listed without searching, or a
  search as loose as `demo` — no longer ends in "Internal Server Error": the
  console asks for 1,000 entries at most and says when there are more, and
  explains a refusal instead of showing the server's generic error. The button
  reads "List without searching". The groups list is not bounded yet:
  ldap-rest does not take `limit` there
- Choosing a second entry in a multi-valued pointer field, such as delegated
  users, adds it instead of replacing the ones already chosen
- Importing a file with a column pointing into a large branch — managers,
  among many accounts — no longer stops on the server's error: the values the
  file holds are looked up one by one (#11)
- A pointer field whose choices could not be loaded says why instead of
  offering an empty choice, and becomes a search box when its branch is too
  large to list (#12); a search in a pointer field that matches too many
  entries is explained the same way

### For embedders

- `ConsoleApiClient.listBounded()` returns the entries with a `truncated`
  flag, and `EntityList`'s `load` may return that `EntryList`; `list()` and a
  `load` returning a plain map work as before

## v0.3.0 (2026-09-28)

Built on ldap-rest 0.12.0.

### Features

- A sign-out button in the header, behind OpenID Connect: it ends the session
  at the provider too. It needs an ldap-rest that advertises its logout route
  ([linagora/ldap-rest#224](https://github.com/linagora/ldap-rest/pull/224));
  an older one shows no button
- Back-Channel Logout, in the Helm chart (`bcl.enabled`): a logout at the
  provider or in another application ends the console's session, and the
  console signs in again on its next request. The records live in the
  directory, a file volume, PostgreSQL or Valkey (`bcl.backend`)

## v0.2.3 (2026-09-27)

Built on ldap-rest 0.11.2.

### Bug Fixes

- An organization field no longer clears the value the entry holds when it is
  clicked before its list of candidates is loaded: the field is inert until
  they are there, and a branch that answered nothing keeps the value instead
  of offering an empty choice

## v0.2.2 (2026-09-27)

Built on ldap-rest 0.11.2.

### Bug Fixes

- Attaching an account another tool created as a bare `inetOrgPerson` no longer
  fails with a server error: ldap-rest gives the entry the object class its
  organization link needs

## v0.2.1 (2026-09-27)

Built on ldap-rest 0.11.1.

### Features

- Handing entries over between organizations through ldap-rest's transit
  branch — [doc](docs/usage.md#handing-an-entry-over-the-transit-branch)

## v0.2.0 (2026-09-26)

Built on ldap-rest 0.11.0 —
[its upgrade notes](https://github.com/linagora/ldap-rest/blob/master/docs/usage/upgrading.md#to-0110).

### Security

- A signed-in account no longer reads every group and its members: groups are
  shown to the administrators of the organizations they are attached to

### Bug Fixes

- An administrator lists and changes the accounts of their organizations
  without `DM_AUTHZ_FILTER_ATTACHED_ENTRIES`, which the image never set

## v0.1.0 (2026-09-26)

The console leaves ldap-rest, where it was developed as
`browser/directory-console`, and becomes a product of its own.

### Features

- An administration interface for an enterprise directory — entity lists with
  search, paging and bulk actions, an organization tree that stays on screen,
  forms explaining each pattern under its field, the lifecycle actions and the
  caller's own scope. Built from ldap-rest's `GET /v1/config` and
  `GET /v1/authz/scope` alone, so a deployment naming its things differently
  gets its own interface, its own language included. See
  [Using the console](docs/usage.md)

- In the look of the Twake applications, light and dark, restyled through CSS
  custom properties

- Creating accounts in bulk from a CSV file: columns matched to fields by
  their names and labels, every row checked and every reference looked up
  before anything is written, then each entry created through the same
  endpoint as the form, with a downloadable report of what was refused. See
  [Importing entries](docs/usage.md#importing-entries-from-a-csv-file)

- A nomenclature value shown by the name its schema gives it, and the
  options of a select sorted by name

- Reference data — positions, titles, account states — gathered in a section
  of its own, below the organization tree and what is attached to it

- A Docker image: ldap-rest with the console and the plugins it needs,
  authenticating through OpenID Connect. It refuses to start without an
  authentication plugin. See the
  [README](README.md#running-it)

- A Helm chart, published as
  `oci://ghcr.io/linagora/charts/twake-directory-manager`. See the
  [README](README.md#kubernetes)
