# 0004 — ldap-rest compatibility: a declared range, tested at both ends

**Status**: accepted · **Date**: 2026-10-26

## Context

The console depends entirely on ldap-rest's API, which moves fast: within
two months its answers gained the scope's `described` flag (0.9.0), the
transit branch (0.11.1), a `422` for a search too broad (0.13.0), the
`X-Result-Truncated` header, the password policies in the scope (0.25.0).
The console added a fallback for each, and comments naming seven versions,
but no file says which versions it supports. CI tests the one version the
`Dockerfile` names (1.1.0 today).

## Decision

`package.json` declares the range: `ldapRest.min`, the oldest server the
console runs on, and `ldapRest.tested`, the one the `Dockerfile` builds on
and CI tests against (#225). The floor is 1.1.0, the first ldap-rest to
serve the page's Content-Security-Policy (`--static-csp`), which the image
relies on; it moves when the console comes to rely on a newer answer, in a
minor release, said in the changelog. Every fallback for an older server is
tagged `compat(ldap-rest<X.Y.Z)` where it stands, and refused by
`scripts/check-compat.mjs` under `npm run lint` once the floor passes it,
until it is removed; this applies to fallbacks from now on, none being tagged
at the time of writing.
The answers of the tested server are recorded (`test/fixtures/`) and
replayed by `test/api/contract.test.ts`; the e2e suite runs against both
ends of the range, a release against the tested one.

## Consequences

Compatibility becomes a stated promise rather than an accumulation of
fallbacks, and dead branches cannot linger. The cost is an e2e matrix of two
versions on pull requests once the ends differ, the discipline of tagging
each fallback, and recording the fixtures again when the tested version
moves. What
is already decided: 0.12.x's `500` for a search too broad is no longer read
as such (#232); the image defaults to 1.1.0; servers below the floor are
neither tested nor supported (before 0.25.0 they lacked part
of the scope and offered less).
