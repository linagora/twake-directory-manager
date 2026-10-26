# Architecture decision records

One file per decision that shapes the code, numbered, never rewritten: a
decision that changes gets a new record that supersedes the old one. Each
says the context, the decision, what it costs and what it rules out, in a
page or less. The template is [0000-template.md](0000-template.md).

| #    | Decision                                                                                             | Status   |
| ---- | ---------------------------------------------------------------------------------------------------- | -------- |
| 0001 | [The console is built from the server's description](0001-built-from-the-server.md)                  | accepted |
| 0002 | [Vanilla TypeScript and tagged templates, no UI framework](0002-vanilla-typescript-and-templates.md) | accepted |
| 0003 | [Rights are derived from the scope, and the server decides](0003-rights-derived-from-the-scope.md)   | accepted |
| 0004 | [ldap-rest compatibility: a declared range, tested at both ends](0004-ldap-rest-compatibility.md)    | accepted |
| 0005 | [The end-to-end suite gates every release](0005-e2e-suite-as-release-gate.md)                        | accepted |
