import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { expect } from 'chai';
import nock from 'nock';

import { ConsoleApiClient } from '../../src/api/ConsoleApiClient';
import { explainRefusal } from '../../src/format';
import { Translator } from '../../src/i18n';
import { scopeRestricts } from '../../src/rights';
import type { EntityDescriptor, Refusal, Scope } from '../../src/types';

/**
 * What the console reads from ldap-rest, checked against what the tested
 * version answered: `test/fixtures/` holds its configuration, the scopes of
 * the QA personas, a bounded list with the header saying it was cut, an entry
 * and the refusals the console explains, recorded by
 * `e2e/tests/record-scopes.spec.ts` (`RECORD_SCOPES=1`) from the QA stack. A
 * change in the server's answers shows here in seconds, before the e2e suite
 * or a customer finds it. The supported range is `ldapRest` in package.json.
 */
const FIXTURES = join(__dirname, '..', 'fixtures');
const read = <T>(file: string): T =>
  JSON.parse(readFileSync(join(FIXTURES, file), 'utf8')) as T;

interface Recorded {
  status: number;
  headers: Record<string, string>;
  body: unknown;
}

describe('the contract with the ldap-rest tested', () => {
  const baseUrl = 'http://contract.test';
  const translator = new Translator('en');
  let api: ConsoleApiClient;
  let entities: EntityDescriptor[];
  let users: EntityDescriptor;

  before(async () => {
    nock(baseUrl).get('/api/v1/config').reply(200, read('config.json'));
    api = new ConsoleApiClient(baseUrl);
    entities = await api.discover();
    users = entities.find(entity => entity.key === 'users') as EntityDescriptor;
  });
  afterEach(() => nock.cleanAll());

  it('should find in the configuration what the console is built from', () => {
    expect(entities.map(entity => entity.key)).to.include.members([
      'users',
      'groups',
      'organizations',
      'positions',
      'domains',
    ]);
    expect(users.mainAttribute).to.equal('uid');
    expect(users.organizationLink).to.equal('twakeDepartmentLink');
    expect(users.organizationPath).to.equal('twakeDepartmentPath');
    expect(users.accountStatus).to.equal('twakeAccountStatus');
    expect(users.password).to.equal('userPassword');
    expect(users.kind).to.equal('flat');
    const organizations = entities.find(
      entity => entity.key === 'organizations'
    );
    expect(organizations?.kind).to.equal('organization');
    expect(api.servesPasswordPolicies).to.equal(true);
    expect(api.logoutUrl).to.be.a('string');
  });

  it('should read a scope as the server describes it', async () => {
    nock(baseUrl)
      .get('/api/v1/authz/scope')
      .reply(200, read('scopes/admin.json'));
    const scope = (await api.scope()) as Scope;
    expect(scopeRestricts(scope)).to.equal(true);
    expect(scope.branches).to.have.length(1);
    expect(scope.transit).to.equal(
      'ou=Transit,ou=organization,dc=example,dc=com'
    );
    expect(scope.passwordPolicies).to.equal(true);
    expect(scope.linksAnyDomain).to.equal(true);
    expect(scope.entities.map(entity => entity.name)).to.include.members([
      'users',
      'groups',
      'organizations',
    ]);
  });

  it('should read a bounded list and the header saying it was cut', async () => {
    const recorded = read<Recorded>('contract/users-list-limited.json');
    nock(baseUrl)
      .get('/api/v1/ldap/users')
      .query(true)
      .reply(recorded.status, recorded.body as object, recorded.headers);
    const list = await api.listBounded(users, undefined, undefined, 2);
    expect(list.truncated).to.equal(true);
    expect(Object.keys(list.entries)).to.have.length(2);
    for (const entry of Object.values(list.entries))
      expect(entry.dn).to.match(/^uid=.*,ou=users,dc=example,dc=com$/);
  });

  it('should read an entry', async () => {
    const recorded = read<Recorded>('contract/users-alice.json');
    nock(baseUrl)
      .get('/api/v1/ldap/users/alice')
      .reply(recorded.status, recorded.body as object);
    const alice = await api.get(users, 'alice');
    expect(alice.dn).to.equal('uid=alice,ou=users,dc=example,dc=com');
    expect(alice.uid).to.equal('alice');
    expect(alice.twakeDepartmentLink).to.be.a('string');
  });

  for (const [file, code, status] of [
    ['refusal-duplicate', 'unique', 409],
    ['refusal-mailDomain', 'mailDomain', 409],
    ['refusal-forbidden', 'forbidden', 403],
  ] as const) {
    it(`should carry the ${code} refusal with its code, and explain it`, async () => {
      const recorded = read<Recorded>(`contract/${file}.json`);
      expect(recorded.status).to.equal(status);
      nock(baseUrl)
        .post('/api/v1/ldap/users')
        .reply(recorded.status, recorded.body as object);
      const thrown = await api.create(users, { mail: 'x@example.com' }).then(
        () => undefined,
        (err: unknown) => err as Error & { status: number; refusal?: Refusal }
      );
      expect(thrown).to.be.instanceOf(Error);
      expect(thrown?.status).to.equal(status);
      expect(thrown?.refusal?.code).to.equal(code);
      const explained = explainRefusal(thrown, users.schema, translator, 'x');
      expect(explained.message).to.be.a('string').and.not.equal('');
      // Said in the console's words, not in the server's for an API client.
      expect(explained.message).to.not.contain(
        'Token does not have permission'
      );
      if (code !== 'forbidden') {
        expect(thrown?.refusal?.attribute).to.equal('mail');
        expect(explained.attribute).to.equal('mail');
      }
      // The address taken is named; a refused domain is named with the
      // domains that would have been accepted.
      if (code === 'unique')
        expect(explained.message).to.contain(thrown?.refusal?.value as string);
      if (code === 'mailDomain') {
        expect(thrown?.refusal?.domains).to.deep.equal(['example.com']);
        expect(explained.message).to.contain('unmanaged.invalid');
        expect(explained.message).to.contain('example.com');
      }
    });
  }
});
