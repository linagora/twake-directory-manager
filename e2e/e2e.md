# Backlog of the e2e suite

One line per case of the QA test plan
(`automation/twake-qa/twake-directory-manager/TEST_PLAN.md`, audit of 2026-10-18), with its
identifier. A ticked line has a spec whose title starts with the identifier
(`npx playwright test -g USER-05`); the spec file is given after it. A case the plan changes is
updated here and in its spec.

Where the plan changes a seeded entry (bob handed over, dave's state, backend-guild's members,
erin made local administrator, users created in Engineering…), the spec does the same on entries
of its own, or as the administrator of a branch of its own (`tenant`) for what the plan does as
sophie.martin or eric.dubois: the seed stays as it is for the cases that read it (README,
Conventions).

## Sign-in and session

- [x] AUTH-01 (P1) Sign in through Dex lands on the overview — `auth.spec.ts`
- [x] AUTH-02 (P2) Sign out ends the session at the provider — `auth.spec.ts`
- [x] AUTH-03 (P3) Deep link to an entry — `auth.spec.ts`
- [x] AUTH-04 (P2) Non-administrator account signs in and may do nothing — `auth.spec.ts` (alice, grace, erin)
- [x] AUTH-05 (P3) Disabled account — `auth.spec.ts`

## Layout, navigation and language

- [x] NAV-01 (P2) Sidebar, highlighted entry and Reference data section — `navigation.spec.ts` (Password policies listed for admin, a global administrator of the stack)
- [x] NAV-02 (P2) Overview cards — `navigation.spec.ts` (step 3 follows d698457: a local administrator's Organizations card offers New organization, created under their branch; the plan still reads "Creation not allowed here")
- [x] NAV-03 (P1) Switch the whole interface to French and back — `navigation.spec.ts`
- [x] NAV-04 (P3) French on secondary screens — `navigation.spec.ts`
- [x] NAV-05 (P3) Narrow screen and dark mode — `navigation.spec.ts` (dark mode: background and contrast of the headings; focus visibility not judged)
- [x] NAV-06 (P3) Mongolian interface — `navigation.spec.ts`
- [x] NAV-07 (P3) The bare host opens the console — `navigation.spec.ts`
- [x] NAV-08 (P2) Side panel is a modal dialog: focus, Tab, Escape — `navigation.spec.ts`
- [x] NAV-09 (P3) Side panel opens at its top and closes when the page changes — `navigation.spec.ts`
- [x] NAV-10 (P3) An unknown address says there is no page there, with a link to the Overview — `navigation.spec.ts` (`#/passwordPolicies`, `#/accountStates`; `#/` and the bare console still open the Overview)

## Scope banner and authorization

- [x] SCOPE-01 (P1) Local administrator sees only their branch — `scope.spec.ts`
- [x] SCOPE-02 (P2) Local administrator of Engineering — `scope.spec.ts`
- [x] SCOPE-03 (P2) Actions offered follow the scope; the server refuses out-of-scope writes — `scope.spec.ts`
- [x] SCOPE-04 (P3) Scope API agrees with the banner — `scope.spec.ts`
- [x] SCOPE-05 (P2) Server holds a local administrator to their branch — `scope.spec.ts` (control on a tenant's group, not sales-team)
- [x] SCOPE-06 (P1) Server refuses a local administrator any write on an account outside their branch: edit, state, password, move, delete, creation, and pushing an own account out — `scope.spec.ts` (#100; 404 accepted for a move of an entry the caller cannot see)

## Lists, search and bulk actions

- [x] LIST-01 (P1) Users list: three-character search and List without searching — `list.spec.ts` ("1–10 of 10" only on a stack of its own: the total is checked against the counter)
- [x] LIST-02 (P2) Search scoped to one field — `list.spec.ts`
- [x] LIST-03 (P2) Groups list and search — `list.spec.ts`
- [x] LIST-04 (P3) Paging and remembered page size — `list.spec.ts`
- [x] LIST-05 (P3) Sorting and path shortening — `list.spec.ts`
- [x] LIST-06 (P2) Export selection as CSV — `list.spec.ts`
- [x] LIST-07 (P2) Delete selection — `list.spec.ts` (also as a local administrator, an entry in transit in the selection: refused, named in the red toast, kept)
- [x] LIST-08 (P2) Reference data lists — `list.spec.ts` (Mail domains offers New domain to admin since the stack sets `DM_AUTHZ_GLOBAL_WRITE_BRANCHES`; the domains other tests add, `*.test`, ignored)
- [x] LIST-09 (P3) Header checkbox reflects the selection and clears the page — `list.spec.ts`
- [x] LIST-10 (P2) Back from a card returns to the list as it was left — `list.spec.ts`
- [x] LIST-11 (P3) A count of one reads in the singular — `list.spec.ts`
- [x] LIST-12 (P2) A keyboard user opens an entry from a list: Tab reaches a link in each row, Enter opens the card — `list.spec.ts` (#135; not in the plan)

## User accounts

- [x] USER-01 (P1) Account card — `users.spec.ts`
- [x] USER-02 (P1) Create an account through the form — `users.spec.ts`
- [x] USER-03 (P2) Form validation before sending — `users.spec.ts`
- [x] USER-04 (P2) Server rules: unique address and allowed domain — `users.spec.ts`
- [x] USER-05 (P1) Edit an account — `users.spec.ts` (also the address: an address or alias another account holds and a foreign domain refused on edit, a new one saved and searched, the identifier kept)
- [x] USER-06 (P1) Department field searches the tree — `users.spec.ts`
- [x] USER-07 (P2) Account-pointer fields are search boxes (Delegates) — `users.spec.ts`
- [x] USER-08 (P1) Change an account's state — `users.spec.ts` (also as a local administrator, on an account of their branch)
- [x] USER-09 (P1) Reset password: generated and typed — `users.spec.ts` (typed, also as a local administrator)
- [x] USER-10 (P2) Delete an account — `users.spec.ts` (also as a local administrator; the account leaves the groups it owns and belongs to; its organizations' Local administrators and Managers and its accounts' Delegates, #101)
- [x] USER-11 (P2) Move an account between two organizations of one's scope — `users.spec.ts`
- [x] USER-12 (P2) Local administrator creates an account in their branch only — `users.spec.ts`
- [x] USER-13 (P3) An entry's DN with a Copy button — `users.spec.ts`
- [x] USER-14 (P3) A date reads as a date in the interface language — `users.spec.ts` (also from Pacific/Honolulu)
- [x] USER-15 (P2) The creation form writes the full name, completes the domain after "@" and folds the optional fields, opening them on a refused value — `users.spec.ts` (#105; v0.8.0 to v0.10.0, after the plan's audit; the domains offered are those the department and the organizations above it link)

## Groups

- [x] GROUP-01 (P2) Group card and members — `groups.spec.ts`
- [x] GROUP-02 (P2) Create a group — `groups.spec.ts`
- [x] GROUP-03 (P2) Add and remove members — `groups.spec.ts`
- [x] GROUP-04 (P2) Edit and delete a group — `groups.spec.ts`
- [x] GROUP-05 (P3) Local administrator's groups — `groups.spec.ts`
- [x] GROUP-06 (P2) Owners: chosen by search, saved, named on the card — `groups.spec.ts`
- [x] GROUP-07 (P2) Unknown member: refused by name, external address — `groups.spec.ts` (follows `features.externalUsersInGroups` of `/api/v1/config`)
- [x] GROUP-08 (P3) Shared mailbox's member search — `groups.spec.ts` (follows `features.james`)

## Organizations

- [x] ORG-01 (P1) Browse the tree and open a card — `organizations.spec.ts`
- [x] ORG-02 (P1) Tree filter types forwards — `organizations.spec.ts`
- [x] ORG-03 (P2) Create a sub-organization — `organizations.spec.ts`
- [x] ORG-04 (P2) Edit an organization: managers, local administrators, mail domains — `organizations.spec.ts` (Mail domains is a typed search since v0.8.0, no longer a select; the new administrator's banner is checked at once, without the 5 min cache wait)
- [x] ORG-05 (P2) Delete an organization — `organizations.spec.ts`
- [x] ORG-06 (P2) Local administrator and organizations — `organizations.spec.ts`
- [x] ORG-07 (P3) Department path link from an entry opens the tree — `organizations.spec.ts`
- [x] ORG-08 (P2) Tree keeps its state after a write, and a typed address opens it down — `organizations.spec.ts`
- [x] ORG-09 (P3) Organization card counts the attached entries it does not list — `organizations.spec.ts` (accounts written to the directory rather than imported; the singular with 51)

## Transit: hand over and claim

- [x] TRANSIT-01 (P1) Hand an account over to transit — `transit.spec.ts`
- [x] TRANSIT-02 (P1) Claim an entry into one's own organization — `transit.spec.ts`
- [x] TRANSIT-03 (P3) Admin sees full actions on an entry in transit — `transit.spec.ts`
- [x] TRANSIT-04 (P2) Hand over and claim a group — `transit.spec.ts`
- [x] TRANSIT-05 (P3) Account with no rights to claim into — `transit.spec.ts`

## CSV import

- [x] IMPORT-01 (P2) Import panel and empty template — `import.spec.ts`
- [x] IMPORT-02 (P2) Column matching — `import.spec.ts`
- [x] IMPORT-03 (P1) Check and import valid rows — `import.spec.ts`
- [x] IMPORT-04 (P2) Rows with errors and refused rows — `import.spec.ts` (a repeated address reads "is already on line N", the plan's "repeats line N" predates it)
- [x] IMPORT-05 (P2) Import respects the scope — `import.spec.ts`
- [x] IMPORT-06 (P3) Stop an import — `import.spec.ts` (150 rows)

## Global reference data: password policies and mail domains

Not in the plan (audit of 2026-10-18), which predates them (#106). The stack configures them as a
deployment should: `DM_PPOLICY_BASE` and `DM_PPOLICY_DEFAULT_DN` (the seed's
`cn=default,ou=policies`, also slapd's `olcPPolicyDefault`), `DM_AUTHZ_GLOBAL_BRANCHES` on the
policies and `DM_AUTHZ_GLOBAL_WRITE_BRANCHES` on the mail domains: admin manages them, the local
administrators do not.

- [x] POLICY-01 (P2) Only the global administrators see the password policies; the default one cannot be deleted — `policies.spec.ts` (the policies API answers 403 to a local administrator, whose page load no longer asks for them: the scope says it, #138)
- [x] POLICY-02 (P1) Create, edit and delete a policy: durations sent in seconds, an emptied field removes its attribute, and only the settings the directory defines are offered (no Maximum length on OpenLDAP 2.4, #118) — `policies.spec.ts`
- [x] POLICY-03 (P2) A policy accounts use is not deleted — `policies.spec.ts` (that it holds their passwords cannot be checked: ldap-rest binds as the rootdn, which ppolicy exempts)
- [x] DOMAIN-01 (P2) A global administrator adds a mail domain, offered after "@" at once, and deletes it — `domains.spec.ts` (named `*.test`, which LIST-08 and USER-15 ignore)
- [x] DOMAIN-02 (P2) A local administrator reads the mail domains and changes none — `domains.spec.ts`

## Messages and error handling

- [x] MSG-01 (P2) Server refusal shown as a red toast with the reason — `messages.spec.ts`
- [x] MSG-02 (P3) Session ended elsewhere — `messages.spec.ts`
