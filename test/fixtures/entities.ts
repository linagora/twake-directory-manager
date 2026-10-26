/**
 * Entities and entries as the tests describe them: a users schema with the
 * roles the console reads, the users, groups and mailbox-type entities built
 * on it, and a group as the directory holds it.
 */
import type { EntityDescriptor, EntitySchema, Entry } from '../../src/types';

export const usersSchema: EntitySchema = {
  attributes: {
    objectClass: { type: 'array', fixed: true, default: ['top'] },
    uid: {
      type: 'string',
      role: 'identifier',
      required: true,
      generated: true,
      generatedFrom: { attribute: 'mail', extract: '^([^@]+)@' },
    },
    cn: {
      type: 'string',
      role: 'displayName',
      required: true,
      label: { en: 'Name', fr: 'Nom' },
    },
    mail: {
      type: 'string',
      role: 'primaryEmail',
      required: true,
      test: '^[^@\\s]+@[^@\\s]+$',
      hint: 'Expected an email address',
    },
    mailAlternateAddress: {
      type: 'array',
      role: 'emailAliases',
      items: { type: 'string' },
    },
    telephoneNumber: {
      type: 'string',
      test: '^\\d{3} \\d{4}$',
      hint: 'Expected pattern 999 9999',
    },
    userPassword: { type: 'string', role: 'password', neverReturn: true },
    memberOf: { type: 'array', readOnly: true, items: { type: 'string' } },
    twakeDepartmentLink: {
      type: 'pointer',
      role: 'organizationLink',
      required: true,
      branch: ['dc=example,dc=com'],
    },
    twakeDepartmentPath: {
      type: 'string',
      role: 'organizationPath',
      generated: true,
    },
    twakeAccountStatus: {
      type: 'pointer',
      role: 'accountStatus',
      generated: true,
      states: { enabled: 'cn=active', disabled: 'cn=disabled' },
    },
  },
};

export const users: EntityDescriptor = {
  key: 'users',
  pluralName: 'users',
  singularName: 'user',
  mainAttribute: 'uid',
  base: 'ou=users,dc=example,dc=com',
  schema: usersSchema,
  endpoint: '/api/v1/ldap/users',
  kind: 'flat',
  organizationLink: 'twakeDepartmentLink',
  organizationPath: 'twakeDepartmentPath',
  accountStatus: 'twakeAccountStatus',
  password: 'userPassword',
};

export const groups: EntityDescriptor = {
  key: 'groups',
  pluralName: 'groups',
  singularName: 'group',
  mainAttribute: 'cn',
  base: 'ou=groups,dc=example,dc=com',
  schema: {
    attributes: {
      cn: { type: 'string', role: 'identifier', required: true },
      description: { type: 'string' },
      member: { type: 'array', role: 'members', items: { type: 'string' } },
    },
  },
  endpoint: '/api/v1/ldap/groups',
  kind: 'group',
};

/** Groups as the Twake schema has them: attached to the organization tree. */

/** Groups as the Twake schema has them: attached to the organization tree. */
export const twakeGroups: EntityDescriptor = {
  ...groups,
  schema: {
    attributes: {
      ...groups.schema.attributes,
      twakeDepartmentLink: {
        type: 'pointer',
        role: 'organizationLink',
        branch: ['ou=organization,dc=example,dc=com'],
      },
    },
  },
  organizationLink: 'twakeDepartmentLink',
};

export const mailboxTypes: EntityDescriptor = {
  key: 'mailboxTypes',
  pluralName: 'mailboxTypes',
  singularName: 'mailboxType',
  mainAttribute: 'cn',
  base: 'ou=twakeMailboxType,ou=nomenclature,dc=example,dc=com',
  schema: {
    entity: {
      valueLabels: {
        group: { en: 'Group', fr: 'Groupe' },
        teamMailbox: { en: 'Shared mailbox', fr: 'Boîte partagée' },
      },
    },
    attributes: { cn: { type: 'string', role: 'identifier' } },
  },
  endpoint: '/api/v1/ldap/mailboxTypes',
  kind: 'flat',
};

/** A group as the directory holds it, before the form edits it. */

/** A group as the directory holds it, before the form edits it. */
export const staff: Entry = {
  dn: 'cn=staff,ou=groups,dc=example,dc=com',
  cn: 'staff',
  description: 'Staff',
  member: [
    'uid=alice,ou=users,dc=example,dc=com',
    'uid=bob,ou=users,dc=example,dc=com',
  ],
};
