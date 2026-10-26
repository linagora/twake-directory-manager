import { expect } from 'chai';
import nock from 'nock';
import {
  claimRoots,
  readFailure,
  scopeRestricts,
  splitEntities,
  transitState,
  writesEntry,
} from '../../src/DirectoryConsole';
import { ConsoleApiClient } from '../../src/api/ConsoleApiClient';
import { EntityDetail } from '../../src/components/EntityDetail';
import { OrganizationTree } from '../../src/components/OrganizationTree';
import { createdEntryId, rdnValue } from '../../src/format';
import { Translator } from '../../src/i18n';
import type { EntityDescriptor, Entry, Scope } from '../../src/types';
import {
  baseUrl,
  stubContainer,
  treeContainer,
  consoleIn,
} from '../support/stubs';
import { users, groups, mailboxTypes } from '../fixtures/entities';

describe('DirectoryConsole helpers', () => {
  afterEach(() => nock.cleanAll());

  describe('splitEntities', () => {
    const flat = (
      key: string,
      organizationLink?: string
    ): EntityDescriptor => ({
      key,
      pluralName: key,
      singularName: key,
      mainAttribute: 'cn',
      base: `ou=${key},dc=example,dc=com`,
      schema: { attributes: {} },
      endpoint: `/api/v1/ldap/${key}`,
      kind: 'flat',
      organizationLink,
    });
    const tree: EntityDescriptor = {
      ...flat('organizations'),
      kind: 'organization',
    };

    it('should put forward the tree and what is attached to it', () => {
      const positions = flat('positions');
      const titles = flat('titles');
      const linkedGroups = {
        ...groups,
        organizationLink: 'twakeDepartmentLink',
      };
      const { primary, reference } = splitEntities([
        users,
        positions,
        titles,
        linkedGroups,
        tree,
      ]);
      expect(primary.map(entity => entity.key)).to.deep.equal([
        'users',
        'groups',
        'organizations',
      ]);
      expect(reference.map(entity => entity.key)).to.deep.equal([
        'positions',
        'titles',
      ]);
    });

    it('should hide nothing in a directory with no organization tree', () => {
      // Nothing is attached to a tree that does not exist: tucking every
      // collection away would leave an empty navigation.
      const all = [flat('people'), flat('roles')];
      const { primary, reference } = splitEntities(all);
      expect(primary).to.deep.equal(all);
      expect(reference).to.deep.equal([]);
    });
  });

  describe('scopeRestricts', () => {
    const scope = (over: Partial<Scope>): Scope => ({
      user: 'alice',
      unrestricted: false,
      described: true,
      branches: [],
      entities: [],
      ...over,
    });

    it('should restrict by a described scope, even an empty one', () => {
      expect(scopeRestricts(scope({}))).to.be.true;
    });

    it('should leave to the server a scope it could not describe', () => {
      // What ldap-rest 0.9.0 answers when only authzPerRoute or authzDynamic
      // judges the caller: empty for want of a model, not of rights.
      expect(scopeRestricts(scope({ described: false }))).to.be.false;
    });

    it('should restrict by a scope from a server predating `described`', () => {
      const legacy = scope({});
      delete legacy.described;
      expect(scopeRestricts(legacy)).to.be.true;
    });

    it('should not restrict without a scope, or with an unrestricted one', () => {
      expect(scopeRestricts(null)).to.be.false;
      expect(scopeRestricts(scope({ unrestricted: true }))).to.be.false;
    });
  });

  describe('transit', () => {
    const top = 'ou=organization,dc=example,dc=com';
    const transit = `ou=Transit,${top}`;
    const sales = `ou=Sales,${top}`;
    const scope = (over: Partial<Scope> = {}): Scope => ({
      user: 'alice',
      unrestricted: false,
      described: true,
      branches: [{ dn: sales, name: 'Sales', read: true, write: true }],
      entities: [],
      transit,
      ...over,
    });
    const account = (link?: string): Entry => ({
      dn: 'uid=bob,ou=users,dc=example,dc=com',
      uid: 'bob',
      ...(link ? { twakeDepartmentLink: link } : {}),
    });
    const linkedGroups: EntityDescriptor = {
      ...groups,
      organizationLink: 'twakeDepartmentLink',
    };

    it('should offer to claim an entry attached to the transit branch', () => {
      // Spelled differently from the scope: the server compares DNs, not text.
      const state = transitState(
        scope(),
        users,
        account('ou=transit, ou=Organization,dc=example,dc=com')
      );
      expect(state).to.include({
        inTransit: true,
        claim: true,
        handOver: false,
      });
    });

    it('should offer to claim an account attached to nothing', () => {
      expect(transitState(scope(), users, account())).to.include({
        inTransit: true,
        claim: true,
      });
    });

    it('should not offer to claim a group attached to nothing', () => {
      // POST /groups/:cn/move refuses such a group.
      const group = { dn: 'cn=staff,ou=groups,dc=example,dc=com', cn: 'staff' };
      expect(transitState(scope(), linkedGroups, group)).to.include({
        inTransit: true,
        claim: false,
      });
      expect(
        transitState(scope(), linkedGroups, {
          ...group,
          twakeDepartmentLink: transit,
        }).claim
      ).to.be.true;
    });

    it('should not offer to claim to a caller who writes nowhere', () => {
      const reader = scope({ branches: [{ dn: sales, read: true }] });
      expect(transitState(reader, users, account(transit)).claim).to.be.false;
    });

    it('should offer to hand over what the caller writes, sub-organizations included', () => {
      expect(transitState(scope(), users, account(`ou=EU,${sales}`)).handOver)
        .to.be.true;
      expect(
        transitState(scope(), users, account(`ou=Legal,${top}`))
      ).to.deep.equal({ inTransit: false, claim: false, handOver: false });
    });

    it('should not offer the other changes to an entry in transit before it is claimed', () => {
      // The server judges them on the transit branch, or on the parent of an
      // entry attached to nothing.
      expect(
        transitState(scope(), users, account(transit)).rights
      ).to.deep.equal({ write: false, delete: false });
      const keeper = scope({
        branches: [{ dn: top, read: true, write: true, delete: false }],
      });
      expect(
        transitState(keeper, users, account(transit)).rights
      ).to.deep.equal({
        write: true,
        delete: false,
      });
      const usersAdmin = scope({
        branches: [
          { dn: 'ou=users,dc=example,dc=com', write: true, delete: true },
        ],
      });
      expect(transitState(usersAdmin, users, account()).rights).to.deep.equal({
        write: true,
        delete: true,
      });
    });

    it('should judge whether the caller writes an entry by its organization, else by its parent', () => {
      // sales-team is Sophie's, engineering is not: only the first is offered
      // on an account's card, and has a × there.
      const group = (link?: string): Entry => ({
        dn: 'cn=team,ou=groups,dc=example,dc=com',
        cn: 'team',
        ...(link ? { twakeDepartmentLink: link } : {}),
      });
      expect(writesEntry(scope(), linkedGroups, group(`ou=EU,${sales}`))).to.be
        .true;
      expect(writesEntry(scope(), linkedGroups, group(`ou=Engineering,${top}`)))
        .to.be.false;
      expect(writesEntry(scope(), linkedGroups, group())).to.be.false;
      const groupsAdmin = scope({
        branches: [{ dn: 'ou=groups,dc=example,dc=com', write: true }],
      });
      expect(writesEntry(groupsAdmin, groups, group(sales))).to.be.true;
      const reader = scope({ branches: [{ dn: sales, read: true }] });
      expect(writesEntry(reader, linkedGroups, group(sales))).to.be.false;
      expect(writesEntry(scope({ unrestricted: true }), users, account())).to.be
        .true;
    });

    it('should judge an entry in transit as transitState does', () => {
      // A group attached to the transit branch is nobody's until claimed.
      const inTransit: Entry = {
        dn: 'cn=team,ou=groups,dc=example,dc=com',
        twakeDepartmentLink: transit,
      };
      expect(writesEntry(scope(), linkedGroups, inTransit)).to.be.false;
      const keeper = scope({ branches: [{ dn: top, write: true }] });
      expect(writesEntry(keeper, linkedGroups, inTransit)).to.be.true;
    });

    it('should take the organization or the parent when the server names no transit branch', () => {
      // ldap-rest then may judge by the parent, `ou=groups` for every group:
      // either is enough not to hide what the server allows.
      const noTransit = (branch: string): Scope =>
        scope({ transit: null, branches: [{ dn: branch, write: true }] });
      const team: Entry = {
        dn: 'cn=team,ou=groups,dc=example,dc=com',
        twakeDepartmentLink: sales,
      };
      expect(writesEntry(noTransit(sales), linkedGroups, team)).to.be.true;
      expect(
        writesEntry(
          noTransit('ou=groups,dc=example,dc=com'),
          linkedGroups,
          team
        )
      ).to.be.true;
      expect(
        writesEntry(noTransit(`ou=Engineering,${top}`), linkedGroups, team)
      ).to.be.false;
      // With one, the organization alone decides.
      expect(
        writesEntry(
          scope({
            branches: [{ dn: 'ou=groups,dc=example,dc=com', write: true }],
          }),
          linkedGroups,
          team
        )
      ).to.be.false;
    });

    it('should say nothing of transit when the server names no transit branch', () => {
      // `transit: null` is also what a server not judging by attachment
      // answers, where nobody may claim an entry attached to nothing.
      const none = { inTransit: false, claim: false, handOver: false };
      expect(
        transitState(scope({ transit: null }), users, account())
      ).to.deep.equal(none);
      const legacy = scope();
      delete legacy.transit;
      expect(transitState(legacy, users, account())).to.deep.equal(none);
      expect(
        transitState(scope({ unrestricted: true }), users, account())
      ).to.deep.equal(none);
      expect(
        transitState(scope(), mailboxTypes, { cn: 'group' })
      ).to.deep.equal(none);
    });

    it('should claim only into the branches the caller writes', () => {
      const roots = claimRoots(
        scope({
          branches: [
            { dn: sales, name: 'Sales', path: 'Sales', write: true },
            { dn: `ou=Legal,${top}`, read: true },
          ],
        })
      );
      expect(roots).to.deep.equal([
        { dn: sales, name: 'Sales', path: 'Sales' },
      ]);
    });

    it('should walk only the subtrees it is given, each once', async () => {
      const eu = `ou=EU,${sales}`;
      const asked: string[] = [];
      nock(baseUrl)
        .persist()
        .get(/\/api\/v1\/ldap\/organizations\/[^/]+\/subnodes/)
        .query({ objectClass: 'organizationalUnit' })
        .reply(uri => {
          const dn = decodeURIComponent(uri.split('/')[5]);
          asked.push(dn);
          return [
            200,
            dn === sales
              ? [{ dn: eu, ou: ['EU'], twakeDepartmentPath: ['Sales / EU'] }]
              : [],
          ];
        });

      const options = await new ConsoleApiClient(baseUrl).organizationOptions([
        { dn: sales, name: 'Sales', path: 'Sales' },
        // Nested in the first: already walked from there.
        { dn: eu, name: 'EU', path: 'Sales / EU' },
      ]);
      expect(options).to.deep.equal([
        { dn: sales, label: 'Sales' },
        { dn: eu, label: 'Sales / EU' },
      ]);
      expect(asked).to.deep.equal([sales, eu]);
    });

    it('should call a walk partial when a branch was cut or could not be read, not when refused', async () => {
      const walk = async (answer: (dn: string) => [number, unknown]) => {
        nock.cleanAll();
        nock(baseUrl)
          .persist()
          .get(/\/api\/v1\/ldap\/organizations\/[^/]+\/subnodes/)
          .query({ objectClass: 'organizationalUnit' })
          .reply(uri => answer(decodeURIComponent(uri.split('/')[5])));
        const found = await new ConsoleApiClient(baseUrl).organizationWalk([
          { dn: sales, name: 'Sales', path: 'Sales' },
        ]);
        nock.cleanAll();
        return found;
      };
      const eu = `ou=EU,${sales}`;
      const whole = (dn: string): [number, unknown] => [
        200,
        dn === sales ? [{ dn: eu, ou: ['EU'] }] : [],
      ];
      expect((await walk(whole)).partial).to.equal(false);
      // The server cut the answer: its indicator row is no organization.
      const cut = await walk(dn => [
        200,
        dn === sales
          ? [
              { dn: eu, ou: ['EU'] },
              {
                dn: `more-${sales}`,
                objectClass: ['moreIndicator'],
                _isMoreIndicator: 'true',
              },
            ]
          : [],
      ]);
      expect(cut.organizations.map(option => option.dn)).to.deep.equal([
        sales,
        eu,
      ]);
      expect(cut.partial).to.equal(true);
      // A failure is unknown, not empty; a refusal is a branch not offered.
      expect(
        (await walk(dn => (dn === eu ? [502, 'Bad Gateway'] : whole(dn))))
          .partial
      ).to.equal(true);
      expect(
        (
          await walk(dn =>
            dn === eu ? [403, { error: 'Forbidden' }] : whole(dn)
          )
        ).partial
      ).to.equal(false);
    });

    it('should offer a new organization under one only when it may be created', () => {
      const render = (onCreateChild?: () => void): string => {
        const container = stubContainer();
        new EntityDetail({
          entity: linkedGroups,
          entry: account(sales),
          translator: new Translator('en'),
          canWrite: true,
          canDelete: false,
          onEdit: () => undefined,
          onDelete: () => undefined,
          onStatus: () => undefined,
          onResetPassword: () => undefined,
          onCreateChild,
        }).render(container);
        return container.innerHTML;
      };
      expect(render(() => undefined)).to.match(
        /data-edit>Edit<\/button>\s*<button type="button" class="dc-button" data-create-child>New organization here</
      );
      expect(render()).not.to.include('data-create-child');
    });

    it('should mark an entry in transit and offer its moves', () => {
      const render = (options: {
        inTransit?: boolean;
        onClaim?: () => void;
        onHandOver?: () => void;
      }): string => {
        const container = stubContainer();
        new EntityDetail({
          entity: users,
          entry: account(transit),
          translator: new Translator('en'),
          canWrite: false,
          canDelete: false,
          onEdit: () => undefined,
          onDelete: () => undefined,
          onStatus: () => undefined,
          onResetPassword: () => undefined,
          ...options,
        }).render(container);
        return container.innerHTML;
      };
      const claimable = render({ inTransit: true, onClaim: () => undefined });
      expect(claimable).to.include('In transit').and.include('data-claim');
      expect(claimable).not.to.include('data-hand-over');
      const held = render({ onHandOver: () => undefined });
      expect(held).to.include('data-hand-over');
      expect(held).not.to.include('In transit').and.not.include('data-claim');
    });

    it('should mark the transit branch where it stands in the tree', async () => {
      const container = treeContainer();
      await new OrganizationTree({
        translator: new Translator('en'),
        root: async () => ({ dn: top, name: 'organization' }),
        children: async () => [
          { dn: sales, name: 'Sales' },
          {
            dn: 'ou=TRANSIT,ou=organization,dc=example,dc=com',
            name: 'Transit',
          },
        ],
        transit,
        onSelect: () => undefined,
      }).render(container);
      expect(container.innerHTML.match(/dc-tag-transit/g)).to.have.length(1);
      expect(container.innerHTML).to.match(
        /data-select="ou=TRANSIT[^"]*"[^>]*>Transit<\/button>\s*<span class="dc-tag dc-tag-transit">/
      );
    });
  });

  describe('reading a DN', () => {
    it('should read the value of the first RDN, escapes undone', () => {
      expect(rdnValue('uid=jsmith,ou=users,dc=example,dc=com')).to.equal(
        'jsmith'
      );
      // The comma inside a value is escaped, so the first comma of the DN is
      // not always the end of the first RDN: splitting on it navigated to
      // `Smith\` and the console answered "This entry no longer exists".
      expect(
        rdnValue('cn=Smith\\, John,ou=positions,dc=example,dc=com')
      ).to.equal('Smith, John');
      expect(rdnValue('not a dn')).to.equal('not a dn');
    });
  });

  describe('opening a created entry', () => {
    it('should read the identifier the flat endpoint answered', () => {
      expect(
        createdEntryId(users, { uid: 'jdoe' }, { mail: 'jdoe@example.com' })
      ).to.equal('jdoe');
    });

    it('should read it whatever case the directory answered in', () => {
      // `created.uid` threw on `UID`, and the console reported an error for
      // an entry it had just created.
      expect(createdEntryId(users, { UID: ['jdoe'] }, {})).to.equal('jdoe');
    });

    it('should fall back to what the form sent when the answer holds no entry', () => {
      // The groups endpoint answers `{success: true}`: the console used to
      // open `#/groups/` and never show the group just created.
      expect(
        createdEntryId(groups, { success: true }, { cn: 'staff' })
      ).to.equal('staff');
      expect(createdEntryId(groups, null, { cn: ['staff'] })).to.equal('staff');
    });

    it('should answer nothing rather than a bogus identifier', () => {
      expect(createdEntryId(groups, { success: true }, {})).to.equal('');
    });
  });

  describe('reading a failed read', () => {
    it('should say the entry is gone only when it is', () => {
      const translator = new Translator('en');
      const gone = Object.assign(new Error('Not found'), { status: 404 });
      expect(readFailure(gone, translator)).to.deep.equal({
        gone: true,
        refused: false,
        message: 'This entry no longer exists',
      });
    });

    it('should say a refusal is one, not that the entry is gone', () => {
      // Telling the operator an entry no longer exists when they were in fact
      // refused sends them looking for the wrong problem. The organization
      // card said it for every failure; the entry card never did. Nor is
      // the server's wording for an API client the one to show.
      const translator = new Translator('en');
      const refused = Object.assign(
        new Error('Token does not have permission on this branch'),
        { status: 403 }
      );
      expect(readFailure(refused, translator)).to.deep.equal({
        gone: false,
        refused: true,
        message: 'You may not see this entry',
      });
    });

    it('should show what any other failure said', () => {
      const translator = new Translator('en');
      const failed = Object.assign(new Error('Bad Gateway'), { status: 502 });
      expect(readFailure(failed, translator)).to.deep.equal({
        gone: false,
        refused: false,
        message: 'Bad Gateway',
      });
    });
  });

  describe('the domains an organization may be linked to', () => {
    const top = 'ou=organization,dc=example,dc=com';
    const organizations: EntityDescriptor = {
      key: 'organizations',
      pluralName: 'organizations',
      singularName: 'organization',
      mainAttribute: 'ou',
      base: top,
      schema: { attributes: { ou: { type: 'string', role: 'identifier' } } },
      endpoint: '/api/v1/ldap/organizations',
      kind: 'organization',
    };
    const writing = (dn: string): Scope => ({
      user: 'jdoe',
      unrestricted: false,
      branches: [{ dn, read: true, write: true }],
      entities: [],
    });
    const narrowed = (scope: Scope | null): boolean => {
      const app = consoleIn({});
      Object.assign(app as unknown as object, { scope });
      return (
        app as unknown as {
          rights: { inheritsDomains(entity: EntityDescriptor): boolean };
        }
      ).rights.inheritsDomains(organizations);
    };

    it('should be those linked above, unless the caller writes the top', () => {
      // ldap-rest refuses any other link to an administrator below the top.
      expect(narrowed(writing(`ou=Sales,${top}`))).to.equal(true);
      expect(narrowed(writing(top))).to.equal(false);
      expect(narrowed(writing('dc=example,dc=com'))).to.equal(false);
      // A scope that restricts nothing leaves it to the server.
      expect(narrowed(null)).to.equal(false);
      expect(narrowed({ ...writing(top), unrestricted: true })).to.equal(false);
    });

    it('should follow the server when it says who links any domain', () => {
      // A global administrator under a bare top writes no branch covering
      // it, and was offered no domain at all.
      const global = writing(`ou=Government of Mongolia,${top}`);
      expect(narrowed({ ...global, linksAnyDomain: true })).to.equal(false);
      expect(narrowed({ ...writing(top), linksAnyDomain: false })).to.equal(
        true
      );
      // Absent, from an older server: read from the branches, as before.
      expect(narrowed(global)).to.equal(true);
      expect(narrowed(writing(top))).to.equal(false);
    });
  });
});
