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
(`scripts/qa-environment/build.sh`, then `npm test` in `e2e/`). CI runs all
of it on every pull request (`.github/workflows/test.yml`).

## Rules the tools enforce

- No `innerHTML`, `outerHTML` or `insertAdjacentHTML`: markup is an
  `html`…`` template rendered with `render` (`src/shared/html.ts`). A value
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
by ldap-rest (`role`, `entity.large`, `states`…), never through an attribute
name: the console ships none ([ADR 0001](docs/adr/0001-built-from-the-server.md)).

**A translation key.** In all three catalogues of `src/i18n.ts` (`en`, `fr`,
`mn`); a sentence with a count has `key.one` and `key.other` in English and
French and the plain key in Mongolian. The test "should translate every key
of every catalogue" fails otherwise.

**A compatibility fallback for an older ldap-rest.** Tag it in a comment
with the version it serves (`compat(ldap-rest<X.Y.Z)`), see
[ADR 0004](docs/adr/0004-ldap-rest-compatibility.md) and #225.

**A decision.** When something in [docs/adr/](docs/adr/) changes, add a
record that supersedes the old one; do not edit the old one.

## Pull requests

One concern per PR, with tests where behaviour changes, and a description
that says what changes and why in words a reader without the diff can
follow. `CHANGELOG.md` is written at release time, not in feature PRs. A PR
that changes a recorded decision adds an ADR. Reviews: a second reader for
anything in `src/DirectoryConsole.ts`, `src/api/`, the rights predicates,
`docker/`, `helm/` or `.github/`.

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
OCI artifact and creates the GitHub release. A prerelease (`vX.Y.Z-rc.1`)
follows the same rule under its own version.
