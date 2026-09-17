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

- A Docker image: ldap-rest with the console and the plugins it needs. It
  refuses to start without an authentication plugin. See the
  [README](README.md#running-it)
