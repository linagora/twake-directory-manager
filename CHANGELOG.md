# Changelog

## Unreleased

Built on ldap-rest 0.25.0.

### Bug Fixes

- On OpenLDAP 2.4, a password policy no longer offers _Maximum length_,
  _Account unused for_ or the delays after a failure, now that ldap-rest
  lists the settings the directory defines (#118, linagora/ldap-rest#366)
- The keyboard opens an entry from the Users, Groups and reference lists: the
  first column of each row is a link, which also opens in a new tab (#135)
- A generated password stays in the Reset password panel, with a _Copy_
  button, until it is closed on purpose; closing it uncopied asks first. In a
  toast, the click that began selecting it dismissed it for good (#124)
- _Change state…_ opens a panel showing the current state and what each other
  one is for, and writes nothing until the button naming the choice is
  pressed: an arrow key on the former select changed the state at once. The
  states read _Active_ and _To delete_ everywhere in English, and the message
  names the account: _Ada Lovelace is now Disabled_ (#125)
- The New user form shows the identifier the address will give, fills the
  common name from the full name, and Enter takes the domain the address
  completion offers; the creation message names the entry (#130)
- An address already used, a mail domain the organization may not use and a
  change outside the branches one administers are said in the interface's
  language, under the field at fault when the form shows it, the toast
  reading _Not saved: see the highlighted field_; the import's result and its
  refused rows file say them the same way. Any other refusal reads _The
  server refused:_ before the server's own words (#126,
  linagora/ldap-rest#372)
- A local administrator's page load no longer asks for the password
  policies only to be refused (403): the scope says who manages them, and
  only an ldap-rest before 0.25.0 is still asked (#138, linagora/ldap-rest#367)
- An address naming no page, such as a mistyped or outdated link, says
  _There is no page at this address._ with a link back to the Overview,
  instead of showing the Overview as if it had worked (#137)
- The Organizations _Filter_ searches the whole tree, not only the branches
  opened, and lists what it finds by path (_Sales / France_); choosing one
  opens the tree down to it and shows its card. Selecting an organization
  also opens its branch, its card offers _New organization here_ beside
  _Edit_, and the selected row keeps its "+" in view (#132)
- The Overview speaks in names: _Signed in as Ada Admin (admin@example.com)_
  rather than a DN, and the _Language_ select offers _English_, _Français_
  and _Монгол_. An account administering nothing finds one message on it,
  _There is nothing for you to manage here_, with a _Sign out_ button,
  instead of three cards leading nowhere; its sidebar offers only the
  Overview, and its banner's dot is grey, not green (#134)
- Deleting an entry, a selection, an organization or a password policy, and
  handing an entry over, are confirmed in a dialog of the console, in its
  language, instead of the browser's. It names an account by its full name,
  email and organization, lists the groups it leaves and offers to set the
  state to _Disabled_ instead; _Cancel_ has the focus, and the button names the
  action: _Delete Jane_, _Delete group_, _Hand over_. The Reset password and
  Claim panels' buttons read _Reset password_ and _Claim into Sales_ rather
  than _Confirm_ (#131)
- An account's card is headed by the full name, with the identifier and the
  address under it, as is the browser tab. Its details are grouped under
  headings, a value said twice is said once, the empty fields wait under
  _Show empty fields (N)_ and the DN under _Technical details_; a mailbox
  size no unit says exactly reads _1.07 GB_, the bytes in its tooltip. _Edit_
  comes first, and _Hand over_ and _Delete_ moved to a _More_ menu (#133)
- A CSV import's result lists each entry it created, by full name and
  identifier, linked to its card; once the result is closed, the list shows
  them as _Just imported (2)_ until _Back to search_, rather than asking for
  a search to find each one (#136)
- An organization's card lists its _People_ (full name, email, position,
  status) and its _Groups_ (name, email, group type) in two tables, each
  counted and each row opening the entry's card, instead of a row of
  identifiers. _New user here_ and _New group here_ open the creation form
  with the department already set, where the administrator may create, and
  the new entry joins the table (#128)
- An account's groups are managed from its card. The section reads _Groups_
  rather than _Mailing lists_, and says each group's type: _sales-team ·
  Shared mailbox_. _Add to a group…_ opens a panel searching the groups the
  administrator may write, by name, type and address; the groups chosen are
  joined at once, a refused one staying in the panel with why. A × on each
  group the administrator may write takes the account out of it in one click
  (#129)

## v0.10.2 (2026-10-23)

Built on ldap-rest 0.24.0.

### Bug Fixes

- Deleting an account takes it out of the organizations it managed or
  administered, the mailboxes delegated to it and the groups it owned: an
  account created again at the same address inherited the old one's rights.
  Links left by accounts deleted before: see ldap-rest's
  [upgrade note](https://github.com/linagora/ldap-rest/blob/master/docs/usage/upgrading.md#links-to-deleted-accounts)
  (#101, linagora/ldap-rest#365)
- The import's rules call the department an _organisation_ in French and
  _байгууллага_ in Mongolian, as its field and the template's column do (#119)
- An empty required field says _Required_ under it, no longer the form's
  legend _Fields marked with * are required_ once per field (#120)
- A password policy offers only the settings the directory knows: OpenLDAP
  2.4 refused _Maximum length_, _Account unused for_ and the delays after a
  failure. Takes effect with an ldap-rest that lists them
  (linagora/ldap-rest#366, not in 0.24.0) (#118)

## v0.10.1 (2026-10-22)

Built on ldap-rest 0.23.0.

### Bug Fixes

- French creates and imports in plain French: _Créer un utilisateur_,
  _Importer des utilisateurs_ (#85)
- Changing the language keeps an open form and what was typed into it (#79)
- Deleting a reference entry still in use says so in words, naming the field
  using it (#81)
- A reference entry's edit panel and deletion name it as its card does (#109)
- An organization filter matching nothing says so (#108)
- A member picked from the suggestions reads by its identifier (#107)
- A refused mailbox size is explained with examples (#84)
- _Export selection_ writes its CSV with a BOM and CRLF, as the import's
  template (#77)
- Accessibility: refused fields are marked invalid and focused (#78), the
  organization tree's buttons are named (#80), toasts are announced (#82),
  a value's × is named after it (#83)

## v0.10.0 (2026-10-22)

Built on ldap-rest 0.23.0.

### Features

- The full name is written from the first and last names as they are typed,
  until it is written otherwise; `DM_CONSOLE_FULL_NAME_FORMAT` sets their
  order, `{surname} {givenName}` where the family name comes first. The
  fields are found by their schema roles, `givenName` and `surname` (#98)
- A field the schema gives a `help` explains itself in a tooltip next to its
  label: the Employee ID does with the Twake schema (#98)
- Email aliases are folded with the optional fields: an account rarely
  starts with any (#98)
- The Department comes right after the Employee ID
  (linagora/ldap-rest#364)

## v0.9.0 (2026-10-22)

Built on ldap-rest 0.22.1.

### Features

- A long form creating an entry, an account's for one, folds the fields the
  schema does not require under _Optional fields_, below the required ones,
  what is pushed to Twake Mail and the password; it opens on a refused
  value. The address fields, the position or the common name no longer
  stretch the form past the screen (#96)

### Bug Fixes

- After an upgrade, browsers load the new console without a forced reload:
  the page names its script and stylesheet with a digest of their content;
  they kept running the former bundle (#95)

## v0.8.1 (2026-10-21)

Built on ldap-rest 0.22.1.

### Bug Fixes

- The administrators of `DM_AUTHZ_GLOBAL_ORGANIZATION` below the top
  organization are offered every mail domain for an organization, as the
  server lets them link any (linagora/ldap-rest#363); they were offered
  none (#93)

## v0.8.0 (2026-10-21)

Built on ldap-rest 0.22.0.

### Features

- Mail domains added and deleted from their page by the administrators the
  server lets write them, `DM_AUTHZ_GLOBAL_WRITE_BRANCHES` with
  `authzLinid1`; ldap-rest creates and removes them in Twake Mail (see the
  README, linagora/ldap-rest#361)
- An organization's mail domains are picked by typing part of their name;
  below the top organization, only the domains an organization above links
  are offered, the only ones the server accepts
- Typing "@" in an address or an alias offers the mail domains allowed for
  the entry's department, or every domain when none restricts them

## v0.7.3 (2026-10-20)

Built on ldap-rest 0.21.3.

## v0.7.2 (2026-10-20)

Built on ldap-rest 0.21.2.

### Features

- Team mailboxes in a tab of their own, kept out of the lists Twake Mail
  expands, with ldap-rest's `twake/teamMailboxes.json` (see the README,
  linagora/ldap-rest#358)

### Bug Fixes

- A card no longer shows a value every entry of its entity holds, such as a
  team mailbox's fixed type (#89)

## v0.7.1 (2026-10-20)

Built on ldap-rest 0.21.1.

### Bug Fixes

- The password policies page is shown to whoever the server lets read them:
  with `authzLinid1` it was shown to nobody. With `DM_AUTHZ_GLOBAL_BRANCHES`,
  only the administrators of the top organization, or of
  `DM_AUTHZ_GLOBAL_ORGANIZATION`, see it (see the README). It moves to
  Reference data (#88, linagora/ldap-rest#356)

## v0.7.0 (2026-10-20)

Built on ldap-rest 0.21.0.

### Breaking Changes

- The image loads `core/ldap/passwordPolicy`: with several password
  policies, set `DM_PPOLICY_DEFAULT_DN` (see the README) —
  [ldap-rest notes](https://github.com/linagora/ldap-rest/blob/master/docs/usage/upgrading.md#several-password-policies)

### Features

- Global administrators edit the password policies: expiry, quality, the
  check module's configuration, lockout (#87)
- An administrator of a branch below the tree root creates organizations in
  it, choosing the parent when they write several branches; the tree offers
  "+" only where they may create (#86)

## v0.6.3 (2026-10-14)

Built on ldap-rest 0.20.1.

### Bug Fixes

- An account's mailing lists show without the `memberof` overlay (#70,
  linagora/ldap-rest#328)
- Refusing to delete a non-empty organization names it, translated (#73)
- The reset password dialog says an empty field generates one (#74)
- French format errors space their colon (#72)
- The current sidebar entry carries `aria-current` (#69)
- Admin guide: Delivery mode and Other mailboxes are hidden by default (#71)

## v0.6.2 (2026-10-13)

Built on ldap-rest 0.20.0.

## v0.6.1 (2026-10-13)

Built on ldap-rest 0.19.1.

### Features

- A shared mailbox's member search offers only the accounts of its mail
  domain, and no external member, once ldap-rest keeps team mailboxes to
  their domain (#66, linagora/ldap-rest#327)

### Bug Fixes

- A local administrator could change the members of any group, link a
  sub-organization to any mail domain, and read or unlock any account's
  password state; ldap-rest 0.19.1 holds them to their branch
  (linagora/ldap-rest#325)

## v0.6.0 (2026-10-12)

Built on ldap-rest 0.19.0.

### Breaking Changes

- With `core/twake/james`, mail forwards are no longer mirrored to Twake
  Mail; `DM_JAMES_SYNC_FORWARDS=true` restores it (#62) —
  [ldap-rest notes](https://github.com/linagora/ldap-rest/blob/master/docs/usage/upgrading.md#forwards-are-no-longer-copied-to-twake-mail)

### Features

- A mailing list's external member is added by its address (#59)
- Twake schemas' labels, hints and form sections in Mongolian

### Bug Fixes

- _Other mailboxes_ and _Delivery mode_ are hidden;
  `DM_CONSOLE_HIDDEN_ATTRIBUTES` chooses what is hidden (#62, #63)
- A pointer offers only the entries its schema describes (#58)
- Cards and lists name a mail domain by its name, not its RDN (#57)

## v0.5.0 (2026-10-12)

Built on ldap-rest 0.18.0.

### Breaking Changes

- With `core/twake/james`, mailing lists are no longer copied to James
  address groups: Twake Mail reads them from LDAP. Delete the address groups
  already created —
  [ldap-rest notes](https://github.com/linagora/ldap-rest/blob/master/docs/usage/upgrading.md#mailing-lists-are-no-longer-copied-to-james)

### Features

- Field hints and form sections in the interface language (#24)
- Reference data shows readable names under Name and Description columns
  (#33)
- An account's card lists its mailing lists, given the directory's
  `memberof` overlay (#35)
- A mail domain is offered by its name, `example.org`, not its identifier

### Bug Fixes

- A group with an owner can be saved again (#23)
- Adding a member that does not exist says so (#42)
- The side panel opens at its top, and closes when the page changes under it
  (Back, a typed address) (#44, #45)
- The list's header checkbox shows a selected page and can clear it (#34)
- Dates read as dates in the interface's language, not `20310115000000Z` (#41)
- An organization, a state and the transit branch are named, not shown by
  their DN or key, in the delete confirmation, the state toast and the scope
  banner (#36, #37, #46)
- A multi-valued pointer's values are named, not shown as DNs (#27)
- The department search stays within the administrator's scope (#22)
- CSV import maps an "Email address" column to Email (#25)
- The language selector stays reachable on narrow screens (#26)
- Multi-valued fields are labelled for screen readers (#29)
- A count of one reads in the singular: "Import 1 entry", "1 row read",
  "Importer 1 entrée" (#49)
- An organization's card says how many attached entries it does not list,
  past the server's limit of 50 (#43)
- A group's owners are named and lead to their entries, not shown as DNs
  (#48)
- The form and the CSV import check a mailbox size and a deletion date
  before sending, and a refusal from the server names fields by their
  labels (#28)
- The organization tree stays open after a save, a creation or a deletion,
  with the organization still shown, and opens down to the organization an
  address or a Department path link names (#31, #38)
- Back from a card returns to the list as it was left: same search, field
  and page (#40)
- The side panel takes the keyboard focus, keeps Tab inside, closes on
  Escape and is announced as a dialog (#32)
- An account administering no branch is told there is nothing to manage
  rather than shown red permission errors; a refused read is said plainly
  (#30)

## v0.4.10 (2026-10-12)

### Features

- Mongolian locale
- A group's members and owners are found by email address as you type; a
  full DN is still accepted (#50)
- An entry's page shows its DN, with a copy button (#50)

### Bug Fixes

- The bare host (`/`) redirects to the console instead of answering
  "Cannot GET /" (#51)

### Known issues

- A group that has an owner cannot be saved: ldap-rest 0.17.1 only accepts
  an owner directly under the directory base

## v0.4.9 (2026-10-10)

Built on ldap-rest 0.17.1.

### Bug Fixes

- A mail change now renames the Twake Mail account (mailboxes, quota,
  aliases) even when Twake Mail's directory replica lags behind
- Deleting a user keeps their Twake Mail data
- Opening a unit that no longer exists answers "not found" instead of a
  server error

## v0.4.8 (2026-10-10)

### Bug Fixes

- Built on ldap-rest 0.17.0, whose Twake user schema no longer has the
  "Mail quota" field: it wrote `mailQuota`, an attribute the Twake directory
  schema does not define, so the directory refused every save that filled
  it, with the other changes of the same save. The mailbox quota is
  "Mailbox size". A change the directory refuses for its content now
  answers 400 with the directory's reason instead of 500

## v0.4.7 (2026-10-09)

Built on ldap-rest 0.16.2.

### Bug Fixes

- The filter of the organization tree no longer types backwards ("lin" came
  out as "nil"): every keystroke redrew the tree and replaced the input, whose
  new copy had its caret at the start. Only the list is redrawn now
- The department field of a form searches the organization tree as the
  operator types, instead of offering a select of the first 200 organizations
  found, which left most of a thousand domains out. It needs the organization
  `search` endpoint of ldap-rest 0.16.2; a server without it keeps the
  select. The department of an account being edited is shown by its path

## v0.4.6 (2026-10-07)

Built on ldap-rest 0.16.1.

### Bug Fixes

- The quota set in the console reaches Twake Mail: the image sets
  `DM_QUOTA_ATTRIBUTE=mailQuotaSize`. ldap-rest defaults it to `mailQuota`,
  which the Twake schemas keep as a message count, so the `twake/james` plugin
  never saw the size. A deployment that set `DM_QUOTA_ATTRIBUTE` itself keeps
  its value
- Built on ldap-rest 0.16.1, whose `twake/james` plugin names the user's
  default identity in Twake Mail after the display name, rather than the
  server-set one: Twake Mail answered that by adding a second identity, named
  "givenName sn", for every account. A change of `displayName` alone now
  reaches Twake Mail too

## v0.4.5 (2026-10-06)

Built on ldap-rest 0.15.0.

### Features

- Helm chart: `secrets.extraEnv` passes ldap-rest settings that are
  credentials, such as `DM_JAMES_WEBADMIN_TOKEN` and
  `DM_CALENDAR_WEBADMIN_TOKEN`, through the Secret rather than the ConfigMap
  `extraEnv` lands in

## v0.4.4 (2026-10-06)

Built on ldap-rest 0.15.0.

### Bug Fixes

- The groups list shows their email address, and exports it: the console asks
  ldap-rest for the attributes of the group schema, where it answered the name
  and the members only

## v0.4.3 (2026-10-06)

Built on ldap-rest 0.15.0.

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
