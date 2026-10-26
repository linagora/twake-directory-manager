# Security

## Reporting a vulnerability

Write to the maintainers through
[GitHub's private vulnerability reporting](https://github.com/linagora/twake-directory-manager/security/advisories/new)
rather than an issue. Say what you found, how to reproduce it and the version.
A fix to the console is released as a patch version; one that belongs to
ldap-rest, which the image is built on, is passed on to
[linagora/ldap-rest](https://github.com/linagora/ldap-rest).

## What CI checks

- `npm audit --audit-level=high` on the console's and the e2e suite's
  dependency trees, in the `audit` job of every pull request and release.
- A [Trivy](https://trivy.dev/) scan of the image built from the tree, in the
  `e2e` job: a `CRITICAL` vulnerability that has a fix fails the build, so
  nothing is published with one. The console itself has no runtime
  dependency; what the scan finds is ldap-rest's and its base image's.
- [Renovate](https://docs.renovatebot.com/) opens grouped update pull requests
  weekly (`renovate.json`): the npm toolchains, the GitHub Actions (pinned by
  digest), the ldap-rest image the Dockerfile builds on, the QA images and
  the Helm version.

## Triage

A fixable `CRITICAL` in the image is fixed within seven days: by taking the
ldap-rest release that carries the fix (a new `LDAP_REST_IMAGE` in the
Dockerfile and a release of the console), or by asking for one on ldap-rest.
A finding the console cannot act on, or that does not apply to how the image
runs, is accepted in `.trivyignore`, one line per CVE, with a comment that
says why and until when (`# until 2026-12-31: …`); an entry past its date is
removed, and the scan decides again.
