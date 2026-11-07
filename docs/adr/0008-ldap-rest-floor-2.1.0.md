# 0008 — The ldap-rest floor is 2.1.0

**Status**: accepted · **Date**: 2026-11-07

## Context

ldap-rest 2.1.0 closes several security advisories that affect the
authentication and authorization plugins the console loads, and it makes
OpenID Connect require a session key of its own
(`DM_OIDC_SESSION_SECRET`), separate from the client secret. It also holds
the organization tree to the caller's branches. The console tests against
one version at a time, as ADR [0007](0007-ldap-rest-floor-2.0.5.md) decided,
and the version under test moves with the server.

## Decision

`ldapRest.min` and `ldapRest.tested` become 2.1.0. The `Dockerfile` builds
on `ghcr.io/linagora/ldap-rest:2.1.0`, the e2e stack and the Helm chart pass
a session key, and the contract fixtures are recorded from that version.

## Consequences

Servers below 2.1.0 are neither tested nor supported. A deployment loading
`core/auth/openidconnect` must set `DM_OIDC_SESSION_SECRET` to a key of its
own, at least 32 characters, or ldap-rest refuses to start. Sessions opened
before the upgrade are refused and every user signs in again.
