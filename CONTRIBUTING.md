# Contributing

The code is described in [ARCHITECTURE.md](ARCHITECTURE.md), the decisions
in [docs/adr/](docs/adr/). This page is the how-to.

## Running things

```sh
npm ci
npm test               # unit tests (mocha), no server needed
npm run test:coverage  # the same with coverage, thresholds in .c8rc.json
npm run typecheck
npm run lint           # ESLint, type-aware on src/
npm run format:check   # Prettier (format:fix to write)
npm run build          # dist/: bundles, stylesheet, page
```

End-to-end tests need Docker: see [e2e/README.md](e2e/README.md)
(`scripts/qa-environment/build.sh`, then in `e2e/`: `./scripts/start.sh` and
`npm test`). The same stack is how to see the console in a browser while
changing it: build, start, open the address `start.sh` prints, rebuild after a
change; or serve `dist/` from any ldap-rest with its static plugin, as the
README's Development section shows. CI runs all of it on every pull request
(`.github/workflows/test.yml`).

## Rules the tools enforce

- No `innerHTML`, `outerHTML` or `insertAdjacentHTML`: markup is an
  ``html`…` `` template rendered with `render` (`src/shared/html.ts`). A value
  that must not be escaped is a `SafeHtml` from another template, or
  `trusted(...)` for a constant of the console's own, never for a value.
- No `void promise`: work nobody waits for goes through `background(task,
context, report)` (`src/shared/background.ts`), which reports a failure.
- A module stays under 1,200 lines (2,500 for a test file), comments aside;
  the files over it today are listed in `eslint.config.mjs` with the size
  they had, which may only shrink. A new page or action goes in a file of
  its own.
- Coverage thresholds (`.c8rc.json`) only go up; lower one in the PR that
  needs it and say why.

## Adding things

**A page.** Today a page is a `render…` method of `DirectoryConsole` and a
case in `readRoute` and `renderMain`; it takes a generation ticket and checks
`this.current(generation)` after each `await`. Once #220 lands, a page is a
file in `src/views/`. Markup through `html`, writes through `render`, actions
through `background`.

**A reusable widget.** A class in `src/components/` taking an options object
(translator, callbacks, what it shows, an optional `report`) and rendering
into the element it is given; it never reads the scope or the route.

**A behaviour tied to an attribute.** Through a schema role or marker served
by ldap-rest (`role`, `entity.large`, `states`…), not through an attribute
name; the few names the code knows (`cn`, `ou`, `mail`) are LDAP's own
conventions, listed in [ARCHITECTURE.md](ARCHITECTURE.md)
([ADR 0001](docs/adr/0001-built-from-the-server.md)).

**A translation key.** In all three catalogues of `src/i18n.ts` (`en`, `fr`,
`mn`). A sentence with a count is written in the forms its language tells
apart (`key.one`, `key.other`), and as the plain key where the noun does not
change after a number; `test/i18n.test.ts` fails when a catalogue lacks a key
the others have.

**A compatibility fallback for an older ldap-rest.** Tag it where it stands,
`compat(ldap-rest<X.Y.Z)`, X.Y.Z being the first version that needs it no
more: `npm run lint` (`scripts/check-compat.mjs`) refuses the tag once the
floor `package.json` declares (`ldapRest.min`) passes it, so that the
fallback goes with the servers it served
([ADR 0004](docs/adr/0004-ldap-rest-compatibility.md)). Moving the tested
version is the `Dockerfile`'s image and `ldapRest.tested` in `package.json`
(Renovate bumps both together), then a recording of the fixtures against the
new stack (below); moving the floor is `ldapRest.min`, the README's and the
`Dockerfile`'s sentence on why, and a line in the changelog.

**A new answer of the server to rely on.** Add a `save(...)` of it to
`e2e/tests/record-scopes.spec.ts` and a replay to `test/api/contract.test.ts`,
then record: `RECORD_SCOPES=1 npx playwright test record-scopes` in `e2e/`
against the running QA stack writes `test/fixtures/`, which that test and
`test/rights.test.ts` read. The recorder writes which version answered, and
the contract test holds the fixtures to `ldapRest.tested`.

**A decision.** When something in [docs/adr/](docs/adr/) changes, add a
record that supersedes the old one; do not edit the old one.

## Accessibility

`e2e/tests/a11y.spec.ts` scans the views and panels `e2e/e2e.md` lists with
axe-core against WCAG 2.2 AA, in English and in French, as the global
administrator and as a local one, and fails on a violation. A new view or
panel gets a scan there. A rule axe reports wrongly on a custom widget is
excluded with a comment saying why, and reviewed. What axe could not decide
(a contrast over an overlap or a background image) is annotated on the test
in the report, not failed. What axe cannot see — focus kept on a redraw,
announcements, keyboard paths, the page's `lang` after a language change — is
the subject of the open accessibility issues (#207 to #219) and of the shared
primitives #226 asks for.

## Pull requests

One concern per PR, with tests where behaviour changes, and a description
that says what changes and why in words a reader without the diff can
follow. `CHANGELOG.md` is written at release time, not in feature PRs. A PR
that changes a recorded decision adds an ADR. Nothing enforces a review yet
(#224 leaves CODEOWNERS and required reviews to the maintainers); ask for a
second reader on `src/DirectoryConsole.ts`, `src/api/`, the rights
predicates, `docker/`, `helm/` and `.github/`.

## Cutting a release

Releases go straight to `main`, tagged, no release branch:

1. `npm version X.Y.Z --no-git-tag-version`: bumps `package.json`, writes the
   version into `helm/twake-directory-manager/Chart.yaml` and stages both
   with the lockfile.
2. Add a `## vX.Y.Z (YYYY-MM-DD)` section to `CHANGELOG.md`, user-facing,
   with the ldap-rest version the image is built on; `release.yml` publishes
   it as the release notes.
3. Commit (`vX.Y.Z`), push `main`, tag `vX.Y.Z`, push the tag.

`release.yml` then runs every gate of `test.yml`, refuses a tag whose version
differs from `package.json`, `Chart.yaml` or the changelog section, builds
the amd64 and arm64 images for GHCR and Docker Hub, pushes the chart as an
OCI artifact and creates the GitHub release. Do not tag a prerelease
(`vX.Y.Z-rc.1`) yet: the manifest job would move the `latest`, `X` and `X.Y`
image tags to it.
