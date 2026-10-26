# 0003 — Rights are derived from the scope, and the server decides

**Status**: accepted · **Date**: 2026-10-26, recording the choice of the console's first commit (2026-09-02)

## Context

ldap-rest's authorization plugin (`authzLinid1`, `authzScope`) decides what
an administrator may read, write, delete or create, per branch, with a
transit branch for hand-overs between organizations and global branches for
reference data. `GET /v1/authz/scope` describes that scope as branches with
`read`/`write`/`delete`, entities with `create`, the transit branch and a few
flags. It does not say, for a given entry, what the caller may do with it.

Offering every action and letting the server refuse was never the design: a
console full of buttons that answer "forbidden" is not usable. #167
(2026-10-24) is what a case the rules missed looks like.

## Decision

The console computes what to offer from the scope, mirroring the server's
rules as closely as the scope allows: an organization is judged by its
parent, an entry in transit by the transit branch, reference data through
the global branches. The server remains the authority: every write is sent
and may be refused, and a refusal is shown in the server's words. When the
scope cannot be read, the console is read-only and says so; when the server
cannot describe the scope, each action is left to it.

## Consequences

The interface shows only what can be done, which is what administrators
need. The cost is duplicated logic in another repository: each change to a
server rule can turn into a button offered and refused, or missing, and
several such fixes have shipped (`cfadf69`, `d363322`, `98d2256`). The way
out is in two steps (#222): gather the predicates into one `rights` module
pinned by a table-driven test over the real scopes of the QA personas, then
ask ldap-rest for per-entry effective rights in its answers and have the
module relay them. What would revisit it: ldap-rest serving those rights,
after which the client-side rules become a fallback for older servers.
