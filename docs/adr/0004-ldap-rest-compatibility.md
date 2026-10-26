# 0004 — ldap-rest compatibility: tested against one version, tolerant of older ones

**Status**: proposed · **Date**: 2026-10-26

## Context

The console depends entirely on ldap-rest's API, which moves fast: within
two months its answers gained the scope's `described` flag (0.9.0), the
transit branch (0.11.1), a `422` for a search too broad (0.13.0), the
`X-Result-Truncated` header, the password policies in the scope (0.25.0).
The console added a fallback for each, and comments naming eight versions,
but no file says which versions it supports. CI tests the one version the
`Dockerfile` names (1.1.0 today).

## Decision (proposed, to be settled by #225)

The console is tested against the ldap-rest version the `Dockerfile` names
and declares a floor in `package.json` (`ldapRest.min`). It supports the
current minor and the previous major's last minor for at least six months.
Every compatibility branch is tagged `compat(ldap-rest<X.Y.Z)` and removed,
by a lint script, when the floor passes it. Raising the floor happens in a
minor release and is said in the changelog.

## Consequences

Compatibility becomes a stated promise rather than an accumulation of
fallbacks, and dead branches cannot linger. The cost is an e2e matrix of two
versions on pull requests, and the discipline of tagging each fallback. What
is already decided: 0.12.x's `500` for a search too broad is no longer read
as such (#232); the image defaults to 1.1.0; servers before 0.25.0 lack part
of the scope and offer less.
