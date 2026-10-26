# Architecture

How the console is put together, for whoever changes it. The user-facing
documentation is [docs/usage.md](docs/usage.md) and the
[admin guide](docs/admin-guide/); how to contribute is in
[CONTRIBUTING.md](CONTRIBUTING.md); the decisions behind what follows are in
[docs/adr/](docs/adr/).

## What it is

A browser application, written in TypeScript with no runtime dependency,
bundled by Rollup into one ESM file (plus UMD builds for the npm package) and
one stylesheet, and served by [ldap-rest](https://github.com/linagora/ldap-rest)
next to the API it reads. It holds no state of its own: everything on screen
comes from ldap-rest at run time, and every change goes back through its REST
API to the directory. Authentication is ldap-rest's (OpenID Connect in the
image); the console only follows the redirects and signs in again on a `401`.

The one design choice everything else follows from: **the console ships no entity name, attribute name or label it can read from the server.**
`GET /v1/config` describes the entities, their schemas and their endpoints;
`GET /v1/authz/scope` says what the signed-in administrator may do; the
console builds its lists, cards and forms from that. A deployment with other
schemas gets its own interface without a change here
([ADR 0001](docs/adr/0001-built-from-the-server.md)). The exceptions are the
two entities ldap-rest describes only by their plugins, groups and
organizations, which `ConsoleApiClient` builds itself with `cn` and `ou` as
defaults, the `mail` fallback for an external member's name, and the LDAP
convention that `cn` is a name, which the form and the card know.

## Module map

Imports point downwards: `components/` never imports `DirectoryConsole`, and
the one cycle (`api/ConsoleApiClient.ts` and `importer.ts`) is type-only.

```
src/index.ts                public exports: DirectoryConsole, four components
                            (EntityList, EntityDetail, EntityForm, OrganizationTree),
                            ConsoleApiClient, Translator, Rights and the scope helpers,
                            html/SafeHtml, types
└── DirectoryConsole.ts     the controller: boot, routing, shell and sidebar,
    │                       the views not moved yet (overview, lists) and
    │                       the CSV import the list starts
    ├── views/
    │   ├── policies.ts         the password policies page and its panel (#220's first view)
    │   ├── organizations.ts    the tree and the card of the organization selected, its
    │   │                       people and groups; kept by the console, for the tree it holds
    │   └── entry.ts            an entry's card: its details, its relations, what it offers
    ├── actions/
    │   ├── passwords.ts        Reset password, the first password of an account created
    │   │                       without one, the generated password shown once
    │   ├── state.ts            an account's state from its card, and Change state… on a selection
    │   ├── transit.ts          Claim… into one of the caller's organizations, and Hand over,
    │   │                       the groups the caller writes offered to leave
    │   ├── deletion.ts         Delete, asked first: an entry, an organization, a selection
    │   ├── forms.ts            New… and Edit: an entry's form, an organization's with its
    │   │                       parent, a refusal said under the field at fault
    │   └── groups.ts           Add to a group… and Add members…, the ×s of a card's
    │                           relations, Add to a group… on a selection
    ├── components/
    │   ├── EntityList.ts       search, list, selection, CSV export
    │   ├── EntityDetail.ts     an entry's card, its relations and actions
    │   ├── EntityForm.ts       the create/edit form built from a schema
        │   ├── EntityImport.ts     the CSV import
    │   ├── OrganizationTree.ts the tree, its search and lazy loading
    │   ├── AttachedTables.ts   the people and groups of an organization
    │   ├── GroupPicker.ts      "Add to a group…" and "Add members…"
    │   └── PasswordPolicies.ts the policies table and form
    ├── api/ConsoleApiClient.ts fetch, discovery, every endpoint, the error
    │                           model, compatibility with older ldap-rest answers
        ├── importer.ts, csv.ts     reading a CSV file and resolving its values
    ├── format.ts               labels, values, sizes, dates, refusals in words
    ├── i18n.ts                 Translator and the en/fr/mn catalogues
    ├── session.ts              signing in again after a 401
        ├── rights.ts               Rights: what the scope lets the caller do, the one reader of Scope
    ├── shared/html.ts          html`…`, SafeHtml, render: the only way to the page
    ├── shared/background.ts    background(): work nobody waits for, reported
    ├── shared/dom.ts           escapeHtml and small DOM helpers
    ├── console/shell.ts        the sidebar's markup (the frame moves here, #220)
    ├── console/settings.ts     what the browser remembers: language, reference section, contrast
    ├── console/panel.ts        the overlay (panel, toast region, announcer), what Tab reaches in the panel,
    │                           PanelService: opening, closing, guards, what waits for the panel
    ├── console/dialog.ts       DialogService: the confirm question, its markup and its alert role
    ├── console/route.ts        what the hash names: routeOf
    ├── console/deps.ts         ConsoleDeps: what a test gives the console in place of what it builds
    ├── console/context.ts      ConsoleContext: what a view or an action is given of the console
    ├── console/bulk.ts         what the list's bulk actions share: the accounts written, the panel held
    ├── console/relations.ts    an entry's members or groups, a group's type, a related entry's address
    ├── ui/table.ts             dataTable: the one way to draw a table (#226)
    ├── ui/search.ts            searchBox: a named search box, with the select of its scope
    ├── ui/announce.ts          the hidden live region: said to a screen reader, not shown
    ├── ui/field.ts             what a form field shares: its help, a button the keyboard reaches
    ├── ui/toast.ts             the toast: shown for a moment, and said as it shows
    ├── assets.ts               inlined logos
    └── types.ts                wire types (ConfigResponse, Scope…) and domain types
src/styles.css              one stylesheet, `dc-` prefix, no framework
public/                     index.html, boot.js, page.css, logo.svg
docker/                     entrypoint.sh and two ldap-rest plugins (root redirect,
                            console settings passed through the config API)
helm/                       the chart
e2e/                        the Playwright suite, a package of its own
scripts/qa-environment/     OpenLDAP + Dex + the image, for e2e and by hand
```

`DirectoryConsole.ts` is far too large (over 1,700 lines) and takes in every
feature; splitting it into views and actions behind a small shell is
[#220](https://github.com/linagora/twake-directory-manager/issues/220), under
way. A view is a class of `src/views/` given a `ConsoleContext`
(`src/console/context.ts`) — the client, the words, the rights, the panel and
the dialog services, the toast and the reporter, the page's ticket, the
entities — built once in `init()`, whose changing parts (the translator, the
rights, the entities once discovered) are functions asked each time, never
copies. The password policies are the first (`PoliciesView`), made anew each
time as they hold nothing; the organizations the second (`OrganizationsView`),
kept by the console from one drawing to the next for the tree it holds, which
a page drawn again finds open where the reader left it; an entry's card the
third (`EntryView`), made anew as it reads its entry again. An action is a
class of `src/actions/` given the same context, for what a card, a list or a
form starts and that opens a panel or writes — the password resets
(`PasswordActions`), the state changes (`StateActions`), Claim… and Hand over
(`TransitActions`), the deletions (`DeletionActions`), the forms
(`FormActions`), and the memberships of groups (`GroupActions`), which the
card and the list's selection both start; the CSV import moves with the list.
An action holds nothing between two calls, and `init()` makes one of each.
What it needs of a page — the address, the organization tree, an entry's
groups, the banner's count of what waits in transit, the label of a New button
— it asks of the context, which the console answers until that page moves, and
then asks the view (the tree is `OrganizationsView`'s), or a module of
`src/console/` for what no page holds (an entry's groups, read by
`console/relations.ts` for the card and Hand over alike); what it needs of
another action (a change of state from a deletion, the first password of an
account just created) it asks of the context too, and so does a view of an
action it starts (the organization's form and its deletion, everything an
entry's card offers), or of a page still in the console (the list of users
opened on a department's path).
The console keeps a one-line method for each view, each action and the
panel and dialog services while the other callers move, deleted at the last
step, or as soon as no caller is left. ESLint keeps the direction: a view
imports no other view and no action, an action neither a view nor another
action, and `components/` imports neither `views/` nor `actions/`.
Until a feature's turn comes, a new page is a view, a new action an action, a
new reusable widget a component.

## Boot

`new DirectoryConsole(options).init()`, from `public/boot.js` or an embedding
page ([docs/usage.md](docs/usage.md)):

1. The container (`options.containerId`) shows _Loading…_.
2. `api.discover()` reads `GET {apiPrefix}/v1/config`: the entities
   (`EntityDescriptor`: key, names, main attribute, base, schema, endpoint,
   kind), the features ldap-rest advertises, the console's own settings
   (`features.console`, from `docker/consoleSettings.mjs`). A failure here
   is the end of it: the page says so.
3. `api.scope()` reads `GET /v1/authz/scope`. A failure is **not** the end:
   the console stays up, says the scope is unavailable, and offers no write
   (`canCreate`, `canWrite`, `canDelete` say no while `scopeError` is set).
   A server without the plugin answers `404`: the scope is then `null`,
   restricts nothing, and every action is offered and left to the server.
4. Whether the password policies can be read, and who is signed in.
5. The route is read from the hash; the listeners go up (`hashchange`,
   `keydown` for the panel, `beforeunload` for a dirty form,
   `unhandledrejection` and `error` for the error boundary).
6. The shell is drawn (sidebar, scope banner, main area, panel, toast
   region), what waits in transit is counted, and `renderMain()` draws the
   page the route asks for.

## Routing

The address is a hash: `#/` (overview), `#/<entity>` (list),
`#/<entity>/<id>` (card), `#/organizations/<dn>`, `#/password-policies`.
`go(path)` writes the hash and lets `hashchange` drive the render
(`followHash` → `routeOf` → `renderMain`); `record(path, replace)` writes
the address without a render, for a node the tree already shows.
`routeOf` decodes defensively: a hash is typed and mailed around.

## Invariants and their mechanisms

- **A late answer never draws over a newer page.** `renderMain()` takes a
  ticket (`viewGeneration++`); every `await` in a view is followed by
  `if (!this.current(generation)) return`. Reads with their own ordering
  (transit count) carry their own counter (`transitReads`).
- **The panel belongs to the page it opened on.** `PanelService`
  (`src/console/panel.ts`) holds it: `open(title, build, modal, wide)` fills
  one body for every form; `close(force)` empties it (a password must not
  linger in a hidden node). `setGuard` lets a form refuse to close (the
  discard question, `guardDiscard`), `setDirty` answers `beforeunload`
  (`isDirty`), `afterClose`/`whenFree` queue what waits for the panel to
  close (a generated password shown after a save), `whenClosed` tells an
  action that owns the panel (bulk actions) that it was taken away;
  nothing else reads that state. `DialogService.confirm` asks its question
  in the panel, taking an open form aside with `hold()` and giving it back
  with `restore()`. A navigation closes the panel (`closeOnNavigation`): a
  form left open over another page would save into an entry no longer on
  screen.
- **Nothing is offered that the server would refuse, and the server is the
  authority.** `src/rights.ts` is where the `Scope` is read:
  the pure helpers (`scopeRestricts`, `transitState`, `writesEntry`,
  `claimRoots`, `organizationParents`) and a `Rights` class the console
  asks in domain terms (`canCreate(entity)`, `organizationRights(dn)`,
  `transitOf(entity, entry)`, `summary` for the banner…), mirroring
  ldap-rest's rules: an organization is judged by its parent, an entry in
  transit by the transit branch, reference data through the global branches.
  `DirectoryConsole` builds `Rights` from the scope it holds each time a view
  asks (`this.rights`); ESLint refuses a member read of `scope` (`x.scope.y`,
  `x.scope!.y`) in `src/` outside `rights.ts` and the API client that fetches
  it (destructuring or a local of type `Scope` would slip past; none exists).
  `test/rights.test.ts` pins the rules of each QA persona on the scopes the
  real server described (`test/fixtures/scopes/`, recorded by
  `e2e/tests/record-scopes.spec.ts`). The server still decides; a refusal is
  shown in its words (`refusal`, `explainRefusal`). Asking the server for
  per-entry rights is the next step of
  [#222](https://github.com/linagora/twake-directory-manager/issues/222)
  ([ADR 0003](docs/adr/0003-rights-derived-from-the-scope.md)).
- **No failure is silent.** Work nobody waits for (a redraw after a save,
  the transit count, a bulk loop) goes through `background(task, context,
report)`; `DirectoryConsole.report` shows _Something went wrong: …_, logs
  to the browser console and calls `options.onError`. ESLint refuses a bare
  `void promise`.
- **Markup is safe by construction.** Every piece of HTML is an ``html`…` ``
  template (`src/shared/html.ts`), which escapes every interpolation that is
  not already a `SafeHtml`; `render` and `append` are the only writes to the
  page, and ESLint refuses `innerHTML` elsewhere. The image serves the page
  with a strict `Content-Security-Policy` (`DM_STATIC_CSP` in the
  `Dockerfile`): no inline script or style, so nothing written into the
  directory can run ([ADR 0002](docs/adr/0002-vanilla-typescript-and-templates.md)).
- **One error model at the API boundary.** `ConsoleApiClient.request`
  throws, for any failed status, an `Error` carrying `status` and,
  when the server gave one, a structured `Refusal` (`code`, `attribute`,
  `value`, `domains`); a body that is not JSON never hides the status.
  `readFailure` and `explainRefusal` turn it into words for the reader; a `401` goes to `signInAgain`, guarded against a reload
  loop.
- **The supported ldap-rest range is declared.** `package.json` says it
  (`ldapRest.min` to `ldapRest.tested`, both 1.1.0 today); `npm run lint`
  runs `scripts/check-compat.mjs`, which holds the `Dockerfile` to the tested
  version and refuses a `compat(ldap-rest<X.Y.Z)` fallback once the floor
  passes it, until it is removed (a rule for fallbacks added from now on: none
  is tagged today, the version remarks left in `src/` being history with no
  branch behind them); `test/api/contract.test.ts` replays the answers
  recorded from the tested server (`test/fixtures/`: the configuration, the
  scopes, a list, an entry, the refusals, and which version answered); the
  e2e suite runs against both ends of the range
  ([ADR 0004](docs/adr/0004-ldap-rest-compatibility.md)).

## Components

Each component takes an options object (translator, callbacks, what it
shows) and renders into an element it is given; it keeps its own state
(selection, open nodes, typed values) and reports through callbacks
(`onOpen`, `onSubmit`, `onDelete`…). None reads the scope or the route: the
console decides what to offer and passes it as booleans (`canWrite`,
`canDelete`) or absent callbacks. All but `AttachedTables`, which starts no
background work, take an optional `report` for theirs.

## Internationalisation

`Translator` holds three catalogues (`en`, `fr`, `mn`) in `src/i18n.ts`,
with placeholders `{name}`. A sentence with a count is written in the forms
its language tells apart, chosen by `Intl.PluralRules` (`key.one` and
`key.other` where English or French need both, the plain key where a noun
does not change after a number); `test/i18n.test.ts` checks that every
catalogue holds every key, plural categories and a language's own
refinements aside. Entity and attribute names are **not** translated here: they come from the schemas'
`label`, per language, with English as the fallback.

## Build, tests, delivery

- `npm run build`: Rollup writes `dist/` (ESM, UMD, minified UMD, the
  stylesheet minified by lightningcss, the page with content digests on the
  files it loads).
- `npm test`: mocha over `test/`, which mirrors `src/`: `test/api/`,
  `test/components/`, one file per module, and `test/console/` for the
  console's own behaviours (helpers, organizations, the panel and the toast,
  the shell and the overview, entries and their groups), `test/views/` and
  `test/actions/` for the views and actions moved out of it. A DOM
  (happy-dom, `test/support/dom.ts`) is registered before any test, and
  nothing reaches the network: the API is `nock`, with no connection allowed
  otherwise. A console test mounts one into the page with `mountConsole`
  (`test/support/mount.ts`): the API answered from the fixtures recorded
  against the ldap-rest tested, the real client given to the console through
  its `deps` (`ConsoleDeps.api`), every call it receives recorded; the test
  acts through the DOM (`test/support/act.ts`: a click, a key, a value
  typed) and reads it, and `unmount()` takes the console off
  the page after. The older tests still build hand-made stubs and reach
  private members, which keep working until each group moves
  ([#221](https://github.com/linagora/twake-directory-manager/issues/221));
  `npm run test:coverage` adds c8 with thresholds.
- `e2e/`: Playwright against the image built from the tree, behind OpenLDAP
  and Dex (`scripts/qa-environment/`); it gates pull requests and releases
  ([ADR 0005](docs/adr/0005-e2e-suite-as-release-gate.md)).
- `.github/workflows/test.yml` is every gate (lint, format, typecheck, unit
  tests on three Node versions, build, audit, e2e with an image scan,
  Helm); `release.yml` calls it, checks that the tag, `package.json`,
  `Chart.yaml` and `CHANGELOG.md` agree, then publishes the images, the
  chart and the GitHub release. The release flow is in
  [CONTRIBUTING.md](CONTRIBUTING.md).
