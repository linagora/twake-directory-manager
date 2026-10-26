# 0001 — The console is built from the server's description

**Status**: accepted · **Date**: 2026-10-26, recording a choice made in September 2026

## Context

The console administers an LDAP directory through ldap-rest. Deployments
differ in their schemas: Twake's users, groups and organizations are one
set; a customer adds attributes, renames entities, hides what nothing acts
on. ldap-rest already describes all of it: `GET /v1/config` returns the
entities, their JSON schemas with roles (`identifier`, `displayName`,
`password`…), their endpoints and the server's features, and the schemas
carry labels per language.

## Decision

The console ships no entity name, attribute name or label. Lists, cards,
forms, CSV import and export are built from the schemas at run time; labels
come from the schemas, in the interface language, with English as the
fallback; what the console needs to know about an attribute (which one is
the name, the password, the organization link) is read from its role, not
from its name. The exceptions are the console's own words (`src/i18n.ts`)
and a few deployment settings passed through the same config API
(`features.console`, from `docker/consoleSettings.mjs`).

## Consequences

A deployment with other schemas gets its own interface without a change
here, and a change to a schema shows in the console at the next load. The
cost is indirection: a behaviour is attached to a role or a schema marker,
never to `uid` or `mail`, and a test needs a schema fixture. What would
revisit it: a deployment needing behaviour no role can express; so far each
such case became a schema marker (`entity.large`, `states`, `neverReturn`…)
served by ldap-rest.
