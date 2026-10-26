# Twake Directory Manager — end to end tests

A real browser driving the console image (ldap-rest + the console, built from the working tree
with the release `Dockerfile`) against a real OpenLDAP holding the Twake schemas and the seed
data, behind a real OpenID Connect provider (Dex). No mock, no stub. TypeScript +
[Playwright](https://playwright.dev/), in a standalone npm package: `e2e/` has its own
`package.json` and lockfile, out of the console's npm build. CI runs it: the `e2e` job of
`.github/workflows/test.yml` (every push to main and pull request, and every tag through
`release.yml`, which publishes nothing unless it passes) builds the image, starts the stack, runs the suite with 2
workers and keeps the HTML report, the traces and the stack's logs as the `e2e-report` artifact.

The scenarios come from the QA test plan
(`automation/twake-qa/twake-directory-manager/TEST_PLAN.md`); [`e2e.md`](e2e.md) lists them, one
line per case, ticked once automated.

---

## Running it

Node 24, Docker with compose v2, Linux (the harness and the browser reach the containers by
their IP).

```bash
../scripts/qa-environment/build.sh     # once, and whenever the console changes: the image
cd e2e
npm ci
npx playwright install chromium        # once

./scripts/start.sh                     # the stack, ~20 s
npx playwright test                    # whole suite, ~1 min with 4 workers
./scripts/stop.sh                      # removes containers, network and volumes
```

Run a subset:

```bash
npx playwright test tests/users.spec.ts
npx playwright test -g USER-05          # one case of the test plan
npx playwright test --ui                # watch mode, time travel
npx playwright show-report              # last HTML report
npx playwright show-trace test-results/artifacts/<test>/trace.zip
```

`E2E_HEADLESS=false` shows the browser, `E2E_SLOWMO=300` slows it down, `E2E_TRACE=on` records a
trace for every test (only failures otherwise), `E2E_WORKERS=<n>` sets the parallelism (4, 2 on
CI), `E2E_RETRIES=<n>` the retries of a failed test (1, see Flakiness). A failing test keeps a
trace, a video and a screenshot under `test-results/artifacts/`; reports go to
`playwright-report/` (HTML) and `test-results/junit.xml`. The `globalSetup` refuses to start
when the stack does not answer, with the command to run.

### The stack

`scripts/start.sh` runs the QA environment's own `scripts/qa-environment/start.sh` (OpenLDAP
with the Twake schemas, the ppolicy and memberof overlays and `ldap/seed.ldif`; Dex over it; the
console) as compose project **`twake-directory-manager-e2e`**, on ports 18700 (console) and
18701 (Dex), so that it runs beside a QA environment (`twake-directory-manager-qa`,
18600/18601). `E2E_PROJECT`, `E2E_APP_PORT` and `E2E_SSO_PORT` change them.
The console is configured as a deployment should be: admin, who administers the top
organization, is the only one to read and change the password policies (`DM_AUTHZ_GLOBAL_BRANCHES`
on the seed's `ou=policies`, whose `cn=default` is slapd's default policy) and to add and delete
mail domains (`DM_AUTHZ_GLOBAL_WRITE_BRANCHES`).

It writes the IP of each container to `.generated/stack.json`, and:

- the browser opens the console on `http://localhost:18700` (published on 127.0.0.1, the
  `DM_BASE_URL` of the stack), and resolves `sso`, Dex's issuer host, to its container with
  Chromium's `--host-resolver-rules` (`support/env.ts`): no `/etc/hosts` entry needed;
- the harness writes and reads OpenLDAP directly (`ldap://<ip>:389`, `cn=admin`), to create the
  entries a test works on and to check what the console wrote.

**Sessions.** The console's server signs the browser in through Dex (authorization code) and
keeps the session in a cookie: a reload stays signed in. Every test starts with a fresh browser
context, hence a Dex sign-in (`LoginPage.loginAs`), which comes back to the console's path, not to
its `#/…` address: `loginAs(account, 'users/alice')` opens the address afterwards.

---

## Writing a test

```ts
import { LoginPage } from '../pages';
import { ADMIN } from '../support/accounts';
import { expect, test } from '../support/fixtures';

test('USER-05 edit an account', async ({ page, directory }) => {
  const user = await directory.createUser();
  const app = await new LoginPage(page).loginAs(ADMIN, `users/${user.uid}`);

  await app.entry().action('Edit').click();
  const form = app.form();
  await form.fill('Mobile', '+49 170 0000000');
  await form.submit();

  await app.expectToast('Saved');
  await expect(app.entry().detail('Mobile')).toHaveText('+49 170 0000000');
  expect(await directory.values(user.dn, 'mobile')).toEqual([
    '+49 170 0000000',
  ]);
});
```

### Conventions

- **The test plan ID starts the title**: `test('USER-05 …')`, several tests when a case has
  several parts. Tick the line of `e2e.md`. A behaviour not in the plan gets a case there first.
- **Import `test` and `expect` from `support/fixtures`**, never from `@playwright/test`. Every
  page fails its test on an uncaught exception.
- **The seed is read-only.** The accounts, groups and organizations of
  `scripts/qa-environment/ldap/seed.ldif` (`support/accounts.ts`: `ADMIN`, `SOPHIE`, `ERIC`,
  `ALICE`…) are shared by every test, in parallel and in any order: a test may read them, sign in
  with them, never change them. A test that edits, moves, hands over, deletes or imports works on
  entries of its own:
  - `directory.createUser()`, `createUsers(n)` (sharing a last name, so that a search finds
    exactly them), `createGroup()`, `createOrganization()`, `createPosition()`, written straight
    into OpenLDAP and removed after the test;
  - `tenant`: an organization under the root with its own local administrator, for what the plan
    does as sophie.martin or eric.dubois (a local administrator's lists, tree, creations, claims);
  - what the console creates (form, import) is registered with `directory.trackUser(uid)`,
    `trackGroup(cn)` or `track(dn)` to be removed the same way.

  Names carry a unique part made of consonants only (`uniquePart()`), so that they never match
  the searches the plan runs on the seed (`ali`, `Moreau`, `E002`, `eng`…). An organization name
  is unique in the whole directory (the server refuses a second "France"): `createOrganization({
name: 'France' })` gives `France <unique>`. Nothing is created in Sales nor Engineering, whose
  lists the scope cases read whole.

- **Entries in transit show in every administrator's lists** (documented): a case expecting a
  local administrator's whole list ignores them (`ListPage.idsOutsideTransit()`); other tests put
  entries there.
- **Assert through the UI, and through the directory when the screen could lie**
  (`directory.values(dn, attribute)`, `exists(dn)`), and through the server's API when the case is
  about it (`support/api.ts`: `callApi(page, method, path, body)`, with the page's session and an
  8 s timeout).
- **Locate through page objects** (`pages/`), never in a spec. The console has no `data-testid`:
  the page objects use roles and accessible names, in English, the default language, and its
  `data-*` hooks where a name changes with the language. The toast has no role
  (toasts-not-announced-to-screen-readers): it is found by `[data-toast]`.
- **Wording**: what the plan quotes is asserted as quoted; the console's other strings in French
  or Mongolian come from its own catalogue, `t('fr', 'state.enabled')` (`support/i18n.ts`, which
  reads `src/i18n.ts`).
- **Confirmations** (deletions, hand-overs) are the console's own alert dialog, not the
  browser's: `new ConfirmDialog(page)` after the click, then `confirm()` or `cancel()`. The
  console uses no native dialog; a test never answers one with `page.on('dialog')`.
- **Web-first assertions** (`await expect(locator).toBeVisible()`), which retry, and `expect.poll`
  for directory state. No `waitForTimeout`; `ListPage.search` waits for the server's answer to the
  search it typed (the list is debounced), `page.clock` stands in for waiting out a delay.
- **A known open bug** (a file of the QA campaign's `critical_issues/`) does not make the suite
  red: `knownIssue('<slug>')` at the start of the test marks it as expected to fail, with an
  annotation. The day the bug is fixed the test passes, Playwright reports it, and the call goes.
- TypeScript strict, explicit return types, named exports (Playwright's config and
  `globalSetup` default exports are the only exceptions), `unknown` + guards for JSON; formatted
  by the repository's Prettier (`npm run format:check` at the root covers `e2e/`).

### Fixtures

| Fixture                             | What                                                                                                                                                                                                                                                                                               |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `directory`                         | Entries of the test in OpenLDAP (`createUser`, `createUsers`, `createGroup`, `createOrganization`, `createPosition`, `createPolicy`, `createDomain`, `addValues`), checks (`values`, `read`, `exists`, `usersStartingWith`), and `track*` for what the console creates; all removed after the test |
| `tenant`                            | `{ org, admin }`: an organization of its own under the root and its local administrator (password `secret`)                                                                                                                                                                                        |
| `loginInNewContext(account, hash?)` | Signs another account in, in a browser context of its own; returns its `ConsolePage`                                                                                                                                                                                                               |

### Flakiness

On a Docker host, Chromium aborts the requests in flight with `net::ERR_NETWORK_CHANGED` whenever
a network interface appears or goes, that is whenever a container of any stack of the host joins
or leaves a network. `LoginPage.loginAs`, `ConsolePage.open` and `ConsolePage.reload` start such a
full page load again; a request of the console itself cannot be replayed, hence one retry by
default (`E2E_RETRIES`). Playwright lists a test that passed on its retry as flaky: look at its
trace before blaming the console.
