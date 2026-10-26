import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { expect } from 'chai';
import nock from 'nock';

import { ConsoleApiClient } from '../src/api/ConsoleApiClient';
import { Rights } from '../src/rights';
import type { EntityDescriptor, Entry, Scope } from '../src/types';

/**
 * The rights of each QA persona, read from the scope the real server
 * described: `test/fixtures/scopes/<uid>.json` and `test/fixtures/config.json`
 * are what ldap-rest answered in the QA stack, recorded by
 * `e2e/tests/record-scopes.spec.ts` (`RECORD_SCOPES=1`). The expectations are
 * the admin guide's (docs/admin-guide/scope.rst): a global administrator on
 * the root, local administrators on Sales (Sophie) and Engineering (Eric),
 * accounts administering nothing (Alice, Grace), and a Transit branch every
 * administrator hands entries over through.
 */
const FIXTURES = join(__dirname, 'fixtures');
const read = <T>(file: string): T =>
  JSON.parse(readFileSync(join(FIXTURES, file), 'utf8')) as T;

const ROOT = 'ou=organization,dc=example,dc=com';
const SALES = `ou=Sales,${ROOT}`;
const FRANCE = `ou=France,${SALES}`;
const ENGINEERING = `ou=Engineering,${ROOT}`;
const BACKEND = `ou=Backend,${ENGINEERING}`;
const TRANSIT = `ou=Transit,${ROOT}`;

describe('Rights, from the scopes the QA server describes', () => {
  const baseUrl = 'http://rights.test';
  let entities: EntityDescriptor[];
  let users: EntityDescriptor;
  let organizations: EntityDescriptor;
  let domains: EntityDescriptor;
  let positions: EntityDescriptor;

  before(async () => {
    nock(baseUrl).get('/api/v1/config').reply(200, read('config.json'));
    entities = await new ConsoleApiClient(baseUrl).discover();
    const named = (key: string): EntityDescriptor => {
      const found = entities.find(entity => entity.key === key);
      if (!found) throw new Error(`no entity ${key} in config.json`);
      return found;
    };
    users = named('users');
    organizations = named('organizations');
    domains = named('domains');
    positions = named('positions');
  });
  after(() => nock.cleanAll());

  /** The persona's rights; the policies as asking for them would answer. */
  const of = (uid: string, policiesReadable = false): Rights =>
    new Rights(read<Scope>(`scopes/${uid}.json`), null, policiesReadable);
  /** An account attached to an organization. */
  const person = (uid: string, organization: string): Entry => ({
    dn: `uid=${uid},ou=users,dc=example,dc=com`,
    [users.organizationLink as string]: organization,
  });

  it('should give the global administrator the whole tree, the transit branch included', () => {
    const admin = of('admin', true);
    expect(admin.restricted).to.equal(true);
    expect(admin.administersNothing()).to.equal(false);
    expect(admin.canWrite()).to.equal(true);
    expect(admin.canDelete()).to.equal(true);
    expect(admin.canCreate(users)).to.equal(true);
    expect(admin.canCreate(organizations)).to.equal(true);
    // Allowed at the root: no parent to pick.
    expect(admin.creationParents(organizations)).to.deep.equal([]);
    expect(admin.organizationRights(SALES)).to.deep.equal({
      write: true,
      delete: true,
    });
    expect(admin.organizationRights(BACKEND)).to.deep.equal({
      write: true,
      delete: true,
    });
    // Written from above: the transit branch is theirs to change.
    expect(admin.organizationRights(TRANSIT)).to.deep.equal({
      write: true,
      delete: true,
    });
    // The top of the tree is nobody's to change from the console.
    expect(admin.organizationRights(ROOT)).to.deep.equal({
      write: false,
      delete: false,
    });
    expect(admin.createsUnder(SALES)).to.equal(true);
    // Written from above, the transit branch could be grown; the card's
    // `createsHere` is what keeps a creation out of it (entries are handed
    // over into it, not created there).
    expect(admin.createsUnder(TRANSIT)).to.equal(true);
    expect(admin.writes(users, person('x', FRANCE))).to.equal(true);
    expect(admin.writes(users, person('x', TRANSIT))).to.equal(true);
    expect(admin.transitOf(users, person('x', TRANSIT))).to.deep.equal({
      inTransit: true,
      claim: true,
      handOver: false,
      rights: { write: true, delete: true },
    });
    expect(admin.transitOf(users, person('x', FRANCE)).handOver).to.equal(true);
    expect(admin.claimRoots().map(root => root.dn)).to.deep.equal([ROOT]);
    expect(admin.transit).to.equal(TRANSIT);
    expect(admin.user).to.equal('uid=admin,ou=users,dc=example,dc=com');
    // Appointed on the root, they link any mail domain.
    expect(admin.inheritsDomains(organizations)).to.equal(false);
    // Mail domains are a global write branch; the other reference data is
    // read only, for everyone.
    expect(admin.changesReference(domains)).to.equal(true);
    expect(admin.readsReferenceOnly(domains)).to.equal(false);
    expect(admin.changesReference(positions)).to.equal(false);
    expect(admin.readsReferenceOnly(positions)).to.equal(true);
    expect(admin.policiesTold).to.equal(true);
    expect(admin.readsWhole(BACKEND)).to.equal(true);
    expect(admin.administersExactly(ROOT)).to.equal(true);
    expect(admin.administersExactly(SALES)).to.equal(false);
    expect(admin.summary.kind).to.equal('branches');
  });

  for (const [uid, own, child, other] of [
    ['sophie.martin', SALES, FRANCE, ENGINEERING],
    ['eric.dubois', ENGINEERING, BACKEND, SALES],
  ] as const) {
    it(`should keep ${uid} to their organization, judged by its parent`, () => {
      const local = of(uid);
      expect(local.administersNothing()).to.equal(false);
      expect(local.canWrite()).to.equal(true);
      expect(local.canDelete()).to.equal(true);
      expect(local.canCreate(users)).to.equal(true);
      // Not at the root, but under their own organization.
      expect(local.canCreate(organizations)).to.equal(true);
      expect(local.creationParents(organizations).map(p => p.dn)).to.deep.equal(
        [own]
      );
      expect(local.createsUnder(child)).to.equal(true);
      expect(local.createsUnder(other)).to.equal(false);
      expect(local.createsUnder(TRANSIT)).to.equal(false);
      // Their organization is judged by its parent, which is not theirs;
      // what it holds is theirs to change and delete.
      expect(local.organizationRights(own)).to.deep.equal({
        write: false,
        delete: false,
      });
      expect(local.organizationRights(child)).to.deep.equal({
        write: true,
        delete: true,
      });
      expect(local.organizationRights(other)).to.deep.equal({
        write: false,
        delete: false,
      });
      expect(local.organizationRights(TRANSIT)).to.deep.equal({
        write: false,
        delete: false,
      });
      expect(local.administersExactly(own)).to.equal(true);
      expect(local.administersExactly(child)).to.equal(false);
      expect(local.writes(users, person('x', child))).to.equal(true);
      expect(local.writes(users, person('x', other))).to.equal(false);
      // An entry in transit can be claimed, and changed by nobody local.
      expect(local.transitOf(users, person('x', TRANSIT))).to.deep.equal({
        inTransit: true,
        claim: true,
        handOver: false,
        rights: { write: false, delete: false },
      });
      expect(local.writes(users, person('x', TRANSIT))).to.equal(false);
      // Their own entries can be handed over, not another's.
      expect(local.transitOf(users, person('x', child)).handOver).to.equal(
        true
      );
      expect(local.transitOf(users, person('x', other)).handOver).to.equal(
        false
      );
      expect(local.claimRoots().map(root => root.dn)).to.deep.equal([own]);
      // Domains come from above; reference data is read only; no policies.
      expect(local.inheritsDomains(organizations)).to.equal(true);
      expect(local.changesReference(domains)).to.equal(false);
      expect(local.readsReferenceOnly(domains)).to.equal(true);
      expect(local.policiesTold).to.equal(false);
      expect(local.readsWhole(child)).to.equal(true);
      expect(local.readsWhole(TRANSIT)).to.equal(true);
      expect(local.readsWhole(other)).to.equal(false);
    });
  }

  for (const uid of ['alice', 'grace']) {
    it(`should offer ${uid}, who administers nothing, nothing`, () => {
      const none = of(uid);
      expect(none.administersNothing()).to.equal(true);
      expect(none.canWrite()).to.equal(false);
      expect(none.canDelete()).to.equal(false);
      expect(none.canCreate(users)).to.equal(false);
      expect(none.canCreate(organizations)).to.equal(false);
      expect(none.organizationRights(SALES)).to.deep.equal({
        write: false,
        delete: false,
      });
      expect(none.writes(users, person('x', FRANCE))).to.equal(false);
      expect(none.transitOf(users, person('x', TRANSIT)).claim).to.equal(false);
      expect(none.claimRoots()).to.deep.equal([]);
      expect(none.changesReference(domains)).to.equal(false);
      expect(none.summary.kind).to.equal('nothing');
    });
  }

  it('should offer a claim on what waits in transit to whoever writes a branch', () => {
    const waiting = { dn: 'uid=x,ou=users,dc=example,dc=com', label: 'x' };
    expect(of('sophie.martin').claimable(waiting, users)).to.equal(true);
    expect(of('admin').claimable(waiting, users)).to.equal(true);
    expect(of('alice').claimable(waiting, users)).to.equal(false);
    // Only for an entity attached to the tree.
    expect(of('sophie.martin').claimable(waiting, positions)).to.equal(false);
  });

  it('should restrict nothing when the server describes no scope, or cannot describe it', () => {
    const base = read<Scope>('scopes/alice.json');
    const unrestricted = new Rights(
      { ...base, unrestricted: true },
      null,
      true
    );
    expect(unrestricted.restricted).to.equal(false);
    expect(unrestricted.canWrite()).to.equal(true);
    expect(unrestricted.administersNothing()).to.equal(false);
    expect(unrestricted.summary.kind).to.equal('unrestricted');
    // Named by a server that restricts nothing, the transit branch is none.
    expect(unrestricted.transit).to.equal(undefined);
    const undescribed = new Rights({ ...base, described: false }, null, false);
    expect(undescribed.restricted).to.equal(false);
    expect(undescribed.canCreate(users)).to.equal(true);
    expect(undescribed.policiesTold).to.equal(undefined);
    expect(undescribed.summary.kind).to.equal('undescribed');
  });

  it('should restrict nothing without a scope, and withhold every write when it could not be read', () => {
    const unrestricted = new Rights(null, null, true);
    expect(unrestricted.restricted).to.equal(false);
    expect(unrestricted.canWrite()).to.equal(true);
    expect(unrestricted.canCreate(users)).to.equal(true);
    expect(unrestricted.organizationRights(SALES)).to.deep.equal({
      write: true,
      delete: true,
    });
    expect(unrestricted.transit).to.equal(undefined);
    expect(unrestricted.readsWhole(SALES)).to.equal(true);
    expect(unrestricted.summary.kind).to.equal('unrestricted');

    const failed = new Rights(null, 'Gateway Timeout', false);
    expect(failed.canWrite()).to.equal(false);
    expect(failed.canCreate(users)).to.equal(false);
    expect(failed.canDelete()).to.equal(false);
    expect(failed.readsReferenceOnly(domains)).to.equal(false);
    expect(failed.writesWithin(SALES)).to.equal(false);
    expect(failed.readsWhole(SALES)).to.equal(false);
    expect(failed.summary).to.deep.equal({
      kind: 'error',
      error: 'Gateway Timeout',
    });
  });
});
