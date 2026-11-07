import { expect } from 'chai';
import { relationHref } from '../../src/console/relations';
import type { EntityDescriptor } from '../../src/types';
import { groups, mailboxTypes, users } from '../fixtures/entities';

describe('relationHref', () => {
  const accountStatuses: EntityDescriptor = {
    ...mailboxTypes,
    key: 'accountStatuses',
    pluralName: 'accountStatuses',
    singularName: 'accountStatus',
    base: 'ou=twakeAccountStatus,ou=nomenclature,dc=example,dc=com',
  };
  const organizations: EntityDescriptor = {
    key: 'organizations',
    pluralName: 'organizations',
    singularName: 'organization',
    mainAttribute: 'ou',
    base: 'ou=organization,dc=example,dc=com',
    schema: { attributes: { ou: { type: 'string', role: 'identifier' } } },
    endpoint: '/api/v1/ldap/organizations',
    kind: 'organization',
  };
  // `groups` has no organizationLink: it is reference data beside the tree,
  // yet a group's members and owners must keep leading to it.
  const entities = [users, groups, accountStatuses, organizations];

  it('should lead to an account’s card', () => {
    expect(
      relationHref(entities, 'uid=alice,ou=users,dc=example,dc=com')
    ).to.equal('#/users/alice');
  });

  it('should keep a role-based row linked without organizationLink', () => {
    expect(
      relationHref(entities, 'cn=staff,ou=groups,dc=example,dc=com')
    ).to.equal('#/groups/staff');
  });

  it('should leave a nomenclature value out of a role-less pointer', () => {
    // A card's state is a pointer into the account states, not a way there.
    const dn =
      'cn=disabled,ou=twakeAccountStatus,ou=nomenclature,dc=example,dc=com';
    expect(relationHref(entities, dn)).to.equal('#/accountStatuses/disabled');
    expect(relationHref(entities, dn, true)).to.equal(undefined);
  });

  it('should leave a group without organizationLink out of a role-less pointer', () => {
    expect(
      relationHref(entities, 'cn=staff,ou=groups,dc=example,dc=com', true)
    ).to.equal(undefined);
  });

  it('should name an organization by its whole DN', () => {
    // The organizations page reveals a DN, not the first RDN alone.
    const dn = 'ou=Sales,ou=organization,dc=example,dc=com';
    expect(relationHref(entities, dn)).to.equal(
      `#/organizations/${encodeURIComponent(dn)}`
    );
    // The tree is what an administrator works in every day.
    expect(relationHref(entities, dn, true)).to.equal(
      `#/organizations/${encodeURIComponent(dn)}`
    );
  });

  it('should answer nothing for a DN no entity holds', () => {
    expect(
      relationHref(entities, 'cn=Smith,ou=elsewhere,dc=example,dc=com')
    ).to.equal(undefined);
  });
});
