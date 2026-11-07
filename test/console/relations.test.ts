import { expect } from 'chai';
import { relationHref } from '../../src/console/relations';
import type { EntityDescriptor } from '../../src/types';
import { mailboxTypes, users } from '../fixtures/entities';

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
  const entities = [users, accountStatuses, organizations];

  it('should lead to an account’s card', () => {
    expect(
      relationHref(entities, 'uid=alice,ou=users,dc=example,dc=com')
    ).to.equal('#/users/alice');
  });

  it('should leave a nomenclature value to the entry it describes', () => {
    // A card's state is a pointer into the account states, not a way there.
    expect(
      relationHref(
        entities,
        'cn=disabled,ou=twakeAccountStatus,ou=nomenclature,dc=example,dc=com'
      )
    ).to.equal(undefined);
  });

  it('should name an organization by its whole DN', () => {
    // The organizations page reveals a DN, not the first RDN alone.
    const dn = 'ou=Sales,ou=organization,dc=example,dc=com';
    expect(relationHref(entities, dn)).to.equal(
      `#/organizations/${encodeURIComponent(dn)}`
    );
  });

  it('should answer nothing for a DN no entity holds', () => {
    expect(
      relationHref(entities, 'cn=Smith,ou=elsewhere,dc=example,dc=com')
    ).to.equal(undefined);
  });
});
