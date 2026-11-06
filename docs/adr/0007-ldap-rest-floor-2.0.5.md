# 0007 — The ldap-rest floor is 2.0.5

**Status**: accepted · **Date**: 2026-11-06

## Context

ADRs [0004](0004-ldap-rest-compatibility.md) declared a supported range for
ldap-rest and set its floor at 1.1.0, the first version to serve the page's
`Content-Security-Policy`. The console now relies on answers only recent
servers give, and only 2.0.5 is tested: it is the version the `Dockerfile`
builds on and the one the contract fixtures were recorded from. Keeping
1.1.0 as the other end of the range costs a second e2e run for a server
nobody runs.

## Decision

`ldapRest.min` becomes 2.0.5, the same as `ldapRest.tested`: the supported
range is that one version, and it moves with `ldapRest.tested` at release
time. The rest of ADR 0004 stands: every fallback for an older server is
tagged `compat(ldap-rest<X.Y.Z)` where it stands and refused by
`scripts/check-compat.mjs` under `npm run lint` once the floor passes it;
the answers of the tested server are recorded and replayed by
`test/api/contract.test.ts`; the e2e suite runs against the supported
version.

## Consequences

Servers below 2.0.5 are neither tested nor supported, and a deployment on one
must upgrade. The e2e matrix is one job again; the floor moves with the
tested version rather than trailing it. The version remarks left in `src/`
for 0.12.0, 0.13.0, 0.20.1 and 0.25.0 stay history: none has a branch behind
it, and none is tagged as a fallback.
