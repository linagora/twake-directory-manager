# Changelog

## Unreleased

The console leaves ldap-rest, where it was developed as
`browser/directory-console`, and becomes a product of its own.

### Features

- An administration interface for an enterprise directory — entity lists with
  search, paging and bulk actions, an organization tree that stays on screen,
  forms explaining each pattern under its field, the lifecycle actions and the
  caller's own scope. Built from ldap-rest's `GET /v1/config` and
  `GET /v1/authz/scope` alone, so a deployment naming its things differently
  gets its own interface, its own language included. See
  [Using the console](docs/usage.md)

- In the look of the Twake applications, light and dark, restyled through CSS
  custom properties

- Creating accounts in bulk from a CSV file: columns matched to fields by
  their names and labels, every row checked and every reference looked up
  before anything is written, then each entry created through the same
  endpoint as the form, with a downloadable report of what was refused. See
  [Importing entries](docs/usage.md#importing-entries-from-a-csv-file)

- A nomenclature value shown by the name its schema gives it, and the
  options of a select sorted by name

- Reference data — positions, titles, account states — gathered in a section
  of its own, below the organization tree and what is attached to it

- A Docker image: ldap-rest with the console and the plugins it needs,
  authenticating through OpenID Connect. It refuses to start without an
  authentication plugin. See the
  [README](README.md#running-it)
