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

  it('should link every collection when none is reference data', () => {
    // A directory with no tree has nothing to tell apart: splitEntities puts
    // every collection forward, so a role-less pointer may lead to any of
    // them.
    const positions: EntityDescriptor = {
      key: 'positions',
      pluralName: 'positions',
      singularName: 'position',
      mainAttribute: 'cn',
      base: 'ou=positions,dc=example,dc=com',
      schema: { attributes: { cn: { type: 'string', role: 'identifier' } } },
      endpoint: '/api/v1/ldap/positions',
      kind: 'flat',
    };
    const titles: EntityDescriptor = {
      ...positions,
      key: 'titles',
      pluralName: 'titles',
      singularName: 'title',
      base: 'ou=twakeTitle,ou=nomenclature,dc=example,dc=com',
      endpoint: '/api/v1/ldap/titles',
    };
    expect(
      relationHref(
        [positions, titles],
        'cn=Sales Representative,ou=positions,dc=example,dc=com',
        true
      )
    ).to.equal('#/positions/Sales%20Representative');
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

  it('should leave an organization the caller cannot read without an address', () => {
    const dn = 'ou=Engineering,ou=organization,dc=example,dc=com';
    expect(relationHref(entities, dn, false, () => false)).to.equal(undefined);
    expect(relationHref(entities, dn, false, () => true)).to.equal(
      `#/organizations/${encodeURIComponent(dn)}`
    );
    // Only organizations ask: an account keeps its card.
    expect(
      relationHref(
        entities,
        'uid=alice,ou=users,dc=example,dc=com',
        false,
        () => false
      )
    ).to.equal('#/users/alice');
  });

  it('should lead to the root organization, whose DN is the base (#376)', () => {
    const root = 'ou=organization,dc=example,dc=com';
    expect(relationHref(entities, root)).to.equal(
      `#/organizations/${encodeURIComponent(root)}`
    );
    // Case and spaces around commas do not matter, as elsewhere.
    const spaced = 'OU=Organization, dc=example , dc=com';
    expect(relationHref(entities, spaced)).to.equal(
      `#/organizations/${encodeURIComponent(spaced)}`
    );
    // The readability check still decides.
    expect(relationHref(entities, root, false, () => false)).to.equal(
      undefined
    );
    expect(relationHref(entities, root, false, () => true)).to.equal(
      `#/organizations/${encodeURIComponent(root)}`
    );
  });

  it('should not lead to an entry for the base of a flat entity (#376)', () => {
    expect(relationHref(entities, 'ou=users,dc=example,dc=com')).to.equal(
      undefined
    );
    expect(
      relationHref(
        entities,
        'ou=twakeAccountStatus,ou=nomenclature,dc=example,dc=com'
      )
    ).to.equal(undefined);
  });

  it('should answer nothing for a DN no entity holds', () => {
    expect(
      relationHref(entities, 'cn=Smith,ou=elsewhere,dc=example,dc=com')
    ).to.equal(undefined);
  });
});
