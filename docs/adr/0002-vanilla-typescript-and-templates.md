# 0002 — Vanilla TypeScript and tagged templates, no UI framework

**Status**: accepted · **Date**: 2026-10-26, recording a choice made in September 2026; the markup rule is of the same day

## Context

The console started as ldap-rest's browser library, a small page over an
API, with no build step beyond TypeScript. It grew into a full
administration interface. A framework (Lit, Preact, Vue) would bring
components, reactive rendering and templating with escaping built in, at the
price of a runtime dependency to keep current, a build the embedders have to
follow, and a rewrite of what exists.

## Decision

The console stays dependency-free at run time: TypeScript, the DOM, and
markup written as template strings. Since 2026-10-26 those templates are
`html`…`` tagged templates (`src/shared/html.ts`): every interpolation is
escaped unless it is a `SafeHtml` produced by another template or marked
`trusted` as a constant of the console's own; `render` and `append` are the
only writes to the page, and ESLint refuses `innerHTML` elsewhere. The image
serves the page with a strict Content-Security-Policy, so that a value
written into the directory has nowhere to run even if an escape were missed.

## Consequences

No framework to upgrade, no runtime to ship, bundles embedders can load from
any page. The cost is what a framework would have given: rendering is
imperative (a view redraws itself), state is kept by hand (generation
tickets, panel ownership), and the controller grew into one large class
(#220 splits it behind a `ConsoleContext`). The `html` boundary keeps the
framework option open view by view: a view that returns `SafeHtml` could be
reimplemented without touching its neighbours. What would revisit it: the
split in #220 proving too costly to finish by hand.
