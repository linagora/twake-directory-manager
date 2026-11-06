# 0006 — No CODEOWNERS nor required review: a second reader is asked for, not enforced

**Status**: accepted · **Date**: 2026-11-06

## Context

The code quality audit of 2026-10-26 (#224) suggested a `.github/CODEOWNERS`
on the core paths, with a required code-owner review on `main`, so that
knowledge of the console does not stay with one person. It also noted the
cost: a blocking review slows a project that releases daily, and nearly all
of the console's history comes from one maintainer.

A required review is a branch-protection setting on GitHub, not a file in the
repository: adding `CODEOWNERS` would route review requests, but only a
maintainer can make the review blocking. Nothing in the tree can enforce it.

## Decision

The repository has no `.github/CODEOWNERS`, and `main` requires no approving
review. The expectation is written down instead, in `CONTRIBUTING.md`: a
second reader is asked for on `src/DirectoryConsole.ts`, `src/api/`, the
rights predicates, `docker/`, `helm/` and `.github/`, and a pull request that
changes a recorded decision adds an ADR. The release process keeps its gate
elsewhere — the unit suite, the contract test and the e2e suite, on both ends
of the ldap-rest range.

## Consequences

A change can reach `main` unreviewed, and the concentration of knowledge the
audit named remains a risk. In exchange, the daily release path is not
blocked by an approval that one person would give anyway. The decision is
revisited, with a new record superseding this one, when the project gains
maintainers or when an unreviewed change causes a release problem; adding
`CODEOWNERS` then is a file, and making its review binding is a branch
protection setting a repository administrator applies.
