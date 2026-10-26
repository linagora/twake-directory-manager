# 0005 — The end-to-end suite gates every release

**Status**: accepted · **Date**: 2026-10-26, recording the suite added on 2026-10-22

## Context

The unit suite runs against hand-made DOM stubs and mocked API answers: it
checks the markup the code writes and the requests it sends, not what a
browser does with them, nor what a real ldap-rest answers. The console's
behaviour depends on both, and on OpenID Connect redirects, and it releases
almost daily.

## Decision

`e2e/` is a Playwright suite, a package of its own, run against the image
built from the tree, behind a real OpenLDAP and Dex (`scripts/qa-environment/`),
with page objects, a shared read-only seed and the entries each test creates
and removes through its fixtures. It runs on every pull
request and every tag (`test.yml`, called by `release.yml`): nothing is
published unless it passes. Scenarios are numbered and tracked in
`e2e/e2e.md`; a known defect is marked `knownIssue('<slug>')`, after its file
in the QA campaign, until fixed. In
CI a test that passes only on retry fails the run.

## Consequences

A release cannot ship a page that does not render, a flow that does not
complete, or a regression in what a persona may do. The cost is time (about
four minutes per run), a Docker host for the stack, and the QA images to
keep current. What would revisit it: nothing foreseeable; the suite is where
accessibility (#226) and security (#223) checks go next.
