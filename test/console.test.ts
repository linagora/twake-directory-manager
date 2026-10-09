/**
 * Tests for the directory console.
 *
 * The components write into `container.innerHTML` and then look their controls
 * up on the container, so a stub element exercises the whole markup path
 * without a DOM implementation — the same approach the other browser suites
 * take.
 */
import { expect } from 'chai';
import nock from 'nock';

import { ConsoleApiClient, isLarge } from '../src/api/ConsoleApiClient';
import { signInAgain } from '../src/session';
import {
  ToastController,
  claimRoots,
  createdEntryId,
  listLoader,
  readFailure,
  scopeRestricts,
  splitEntities,
  transitState,
} from '../src/DirectoryConsole';
import {
  attributeLabel,
  displayValue,
  pointerLabel,
  rdnValue,
  resolveText,
} from '../src/format';
import { EntityDetail } from '../src/components/EntityDetail';
import { EntityForm, pointerFallback } from '../src/components/EntityForm';
import { EntityImport } from '../src/components/EntityImport';
import {
  EntityList,
  LIST_LIMIT,
  csvCell,
  listFailure,
} from '../src/components/EntityList';
import { OrganizationTree } from '../src/components/OrganizationTree';
import { Translator } from '../src/i18n';
import { formatByteSize } from '../src/format';
import type {
  EntityDescriptor,
  EntitySchema,
  Entry,
  EntryList,
  Scope,
} from '../src/types';

const baseUrl = 'http://localhost:8099';

/** Minimal stand-in for the element a component renders into. */
function stubContainer(): HTMLElement & { innerHTML: string } {
  return {
    innerHTML: '',
    querySelector: () => null,
    querySelectorAll: () => [] as unknown as NodeListOf<Element>,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  } as unknown as HTMLElement & { innerHTML: string };
}

/**
 * A container that keeps what a component writes into it apart, the way a
 * browser does: writing its `innerHTML` replaces the whole subtree (a new
 * filter input, a new list), while writing the list's own replaces only the
 * list. `builds` counts how many times the shell was written, which is how
 * many times the filter input was replaced.
 */
interface TreeContainer {
  innerHTML: string;
  builds: number;
  filter: { value: string; fire(): void };
  list: { innerHTML: string };
}

function treeContainer(): HTMLElement & TreeContainer {
  const fresh = (): Pick<TreeContainer, 'filter' | 'list'> => {
    let listener: (() => void) | undefined;
    return {
      filter: Object.assign(
        {
          value: '',
          fire: () => listener?.(),
        },
        {
          addEventListener: (_type: string, callback: () => void) => {
            listener = callback;
          },
        }
      ),
      list: {
        innerHTML: '',
        querySelectorAll: () => [],
      } as TreeContainer['list'],
    };
  };
  let shell = '';
  const container = {
    builds: 0,
    ...fresh(),
    get innerHTML(): string {
      return shell.replace(
        '<div data-tree-list></div>',
        `<div data-tree-list>${container.list.innerHTML}</div>`
      );
    },
    set innerHTML(html: string) {
      shell = html;
      container.builds++;
      Object.assign(container, fresh());
    },
    querySelector(selector: string): unknown {
      if (!shell) return null;
      if (selector === '[data-tree-list]') return container.list;
      if (selector === '[data-filter]') return container.filter;
      return null;
    },
  };
  return container as unknown as HTMLElement & TreeContainer;
}

const usersSchema: EntitySchema = {
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

const users: EntityDescriptor = {
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

const groups: EntityDescriptor = {
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

const mailboxTypes: EntityDescriptor = {
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
const staff: Entry = {
  dn: 'cn=staff,ou=groups,dc=example,dc=com',
  cn: 'staff',
  description: 'Staff',
  member: [
    'uid=alice,ou=users,dc=example,dc=com',
    'uid=bob,ou=users,dc=example,dc=com',
  ],
};

describe('Directory console', () => {
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

  describe('OrganizationTree filter', () => {
    const top = 'ou=organization,dc=example,dc=com';
    const sales = `ou=Sales,${top}`;

    it('should keep the filter input across keystrokes', async () => {
      const container = treeContainer();
      await new OrganizationTree({
        translator: new Translator('en'),
        root: async () => ({ dn: top, name: 'organization' }),
        children: async () => [
          { dn: sales, name: 'Sales' },
          { dn: 'ou=Lin,ou=organization,dc=example,dc=com', name: 'Lin' },
        ],
        onSelect: () => undefined,
      }).render(container);
      const input = container.filter;
      const builds = container.builds;
      expect(container.innerHTML).to.include('>Sales</button>');

      // The browser edits the value and its caret; a redraw that replaced the
      // input would drop both, and the next letter would land before them.
      for (const typed of ['l', 'li', 'lin']) {
        input.value = typed;
        input.fire();
        expect(container.filter).to.equal(input);
        expect(container.filter.value).to.equal(typed);
      }
      expect(container.builds).to.equal(builds);
      // The list was filtered all the same.
      expect(container.innerHTML)
        .to.include('>Lin</button>')
        .and.not.include('>Sales</button>');
    });
  });

  describe('Translator', () => {
    it('should fall back to English for an unknown language', () => {
      expect(new Translator('xx').language).to.equal('en');
    });

    it('should read a region tag as its language', () => {
      expect(new Translator('fr-CA').language).to.equal('fr');
    });

    it('should substitute placeholders', () => {
      const t = new Translator('en');
      expect(t.t('list.count', { from: 1, to: 10, total: 42 })).to.equal(
        '1–10 of 42'
      );
    });

    it('should show an untranslated key rather than nothing', () => {
      expect(new Translator('en').t('no.such.key')).to.equal('no.such.key');
    });

    it('should translate every key of every catalogue', () => {
      const english = new Translator('en');
      const french = new Translator('fr');
      // A key present in one catalogue and missing from the other is exactly
      // the mixed-language interface this replaces.
      expect(french.t('list.perPage')).to.not.equal('list.perPage');
      expect(english.t('list.perPage')).to.not.equal('list.perPage');
    });
  });

  describe('localized text', () => {
    it('should take a plain string as the text itself', () => {
      expect(resolveText('Department', 'fr')).to.equal('Department');
    });

    it('should pick the language, then its base tag, then English', () => {
      const label = { en: 'Department', fr: 'Organisation' };
      expect(resolveText(label, 'fr')).to.equal('Organisation');
      expect(resolveText(label, 'fr-CA')).to.equal('Organisation');
      expect(resolveText(label, 'de')).to.equal('Department');
    });

    it('should show something rather than nothing for a partial schema', () => {
      // A schema translated into one language the reader does not speak is
      // still more useful than a blank label.
      expect(resolveText({ nl: 'Afdeling' }, 'fr')).to.equal('Afdeling');
    });

    it('should treat an absent or empty text as absent', () => {
      expect(resolveText(undefined, 'en')).to.be.undefined;
      expect(resolveText('', 'en')).to.be.undefined;
      expect(resolveText({}, 'en')).to.be.undefined;
    });

    it('should name an attribute in the reader’s language', () => {
      const attr = usersSchema.attributes.cn;
      expect(attributeLabel('cn', attr, 'fr')).to.equal('Nom');
      expect(attributeLabel('cn', attr, 'en')).to.equal('Name');
    });

    it('should make an unlabelled attribute readable rather than raw', () => {
      expect(
        attributeLabel('twakeDepartmentPath', { type: 'string' }, 'fr')
      ).to.equal('Twake Department Path');
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

  describe('the toast', () => {
    /** A toast element and a clock the test advances by hand. */
    const setup = () => {
      const element = {
        textContent: '',
        hidden: true,
        onclick: null as unknown,
        classList: { toggle: () => undefined },
      } as unknown as HTMLElement;
      return { element, toasts: new ToastController(() => element, 20) };
    };
    const wait = (ms: number) => new Promise(r => setTimeout(r, ms));

    it('should hide an ordinary message after a while', async () => {
      const { element, toasts } = setup();
      toasts.show('Saved');
      expect(element.hidden).to.be.false;
      await wait(40);
      expect(element.hidden).to.be.true;
    });

    it('should keep a sticky message shown after an earlier one', async () => {
      // An earlier message's timer went on running and hid the generated
      // password, which is shown once and cannot be fetched again.
      const { element, toasts } = setup();
      toasts.show('Status changed');
      toasts.show('Generated password: s3cret', false, true);
      await wait(40);
      expect(element.hidden).to.be.false;
      expect(element.textContent).to.equal('Generated password: s3cret');
    });

    it('should give a new message its whole delay', async () => {
      const { element, toasts } = setup();
      toasts.show('First');
      await wait(12);
      toasts.show('Second');
      await wait(12);
      expect(element.hidden, 'hidden by the first timer').to.be.false;
      await wait(20);
      expect(element.hidden).to.be.true;
    });
  });

  describe('reading a failed read', () => {
    it('should say the entry is gone only when it is', () => {
      const translator = new Translator('en');
      const gone = Object.assign(new Error('Not found'), { status: 404 });
      expect(readFailure(gone, translator)).to.deep.equal({
        gone: true,
        message: 'This entry no longer exists',
      });
    });

    it('should show what a refusal said, not that the entry is gone', () => {
      // Telling the operator an entry no longer exists when they were in fact
      // refused sends them looking for the wrong problem. The organization
      // card said it for every failure; the entry card never did.
      const translator = new Translator('en');
      const refused = Object.assign(new Error('Out of your scope'), {
        status: 403,
      });
      expect(readFailure(refused, translator)).to.deep.equal({
        gone: false,
        message: 'Out of your scope',
      });
    });
  });

  describe('signInAgain', () => {
    const g = globalThis as Record<string, unknown>;
    let originals: Record<string, unknown>;
    let reloads: number;
    let stored: Record<string, string>;

    beforeEach(() => {
      originals = { window: g.window, sessionStorage: g.sessionStorage };
      reloads = 0;
      stored = {};
      g.window = { location: { reload: () => reloads++ } };
      g.sessionStorage = {
        getItem: (k: string) => stored[k] ?? null,
        setItem: (k: string, v: string) => (stored[k] = v),
      };
    });

    afterEach(() => {
      g.window = originals.window;
      g.sessionStorage = originals.sessionStorage;
    });

    it('should reload once a minute at most', () => {
      expect(signInAgain(1_000_000)).to.equal(true);
      // The page answered 401 again right after: no sign-in behind it
      expect(signInAgain(1_030_000)).to.equal(false);
      expect(signInAgain(1_061_000)).to.equal(true);
      expect(reloads).to.equal(2);
    });

    it('should not reload without storage to stop a loop', () => {
      g.sessionStorage = {
        getItem: () => {
          throw new Error('denied');
        },
      };
      expect(signInAgain()).to.equal(false);
      expect(reloads).to.equal(0);
    });
  });

  describe('ConsoleApiClient', () => {
    it('should turn the server configuration into entities', async () => {
      nock(baseUrl)
        .get('/api/v1/config')
        .reply(200, {
          apiPrefix: '/api',
          ldapBase: 'dc=example,dc=com',
          features: {
            ldapFlatGeneric: {
              flatResources: [
                {
                  name: 'twakeUser',
                  singularName: 'user',
                  pluralName: 'users',
                  mainAttribute: 'uid',
                  base: 'ou=users,dc=example,dc=com',
                  schema: usersSchema,
                },
              ],
            },
            ldapGroups: {
              enabled: true,
              base: 'ou=groups,dc=example,dc=com',
              mainAttribute: 'cn',
              schema: { attributes: { cn: { type: 'string' } } },
            },
            ldapOrganizations: {
              enabled: true,
              topOrganization: 'ou=organization,dc=example,dc=com',
              pathSeparator: ' / ',
              schema: {
                attributes: {
                  ou: { type: 'string', role: 'identifier' },
                  twakeDepartmentPath: {
                    type: 'string',
                    role: 'organizationPath',
                  },
                },
              },
            },
          },
        });

      const client = new ConsoleApiClient(baseUrl);
      const entities = await client.discover();

      expect(entities.map(entity => entity.key)).to.deep.equal([
        'users',
        'groups',
        'organizations',
      ]);
      const user = entities[0];
      // The console never learns an attribute name: it asks for the role.
      expect(user.organizationLink).to.equal('twakeDepartmentLink');
      expect(user.accountStatus).to.equal('twakeAccountStatus');
      expect(user.password).to.equal('userPassword');
      expect(client.organizationPathSeparator).to.equal(' / ');
      expect(client.organizationRoot).to.equal(
        'ou=organization,dc=example,dc=com'
      );
    });

    describe('searching the organization tree', () => {
      const orgTop = 'ou=organization,dc=example,dc=com';
      const discover = async (search?: string): Promise<ConsoleApiClient> => {
        nock(baseUrl)
          .get('/api/v1/config')
          .reply(200, {
            apiPrefix: '/api',
            ldapBase: 'dc=example,dc=com',
            features: {
              ldapOrganizations: {
                enabled: true,
                topOrganization: orgTop,
                endpoints: search ? { search } : {},
                schema: {
                  attributes: {
                    ou: { type: 'string', role: 'identifier' },
                    twakeDepartmentPath: {
                      type: 'string',
                      role: 'organizationPath',
                    },
                  },
                },
              },
            },
          });
        const client = new ConsoleApiClient(baseUrl);
        await client.discover();
        return client;
      };

      it('should search the tree when the server advertises it, and only then', async () => {
        const searching = await discover(
          '/api/v1/ldap/organizations/:dn/search'
        );
        // The branch of the department pointer is above the top, and no
        // entity owns it; listing it never failed.
        expect(searching.pointerSearch('dc=example,dc=com', [])).to.be.a(
          'function'
        );
        expect(searching.pointerSearch(orgTop, [], true)).to.be.a('function');

        const older = await discover();
        expect(older.pointerSearch('dc=example,dc=com', [])).to.equal(
          undefined
        );
      });

      it('should drop the sentinel row and label by path', async () => {
        const client = await discover('/api/v1/ldap/organizations/:dn/search');
        nock(baseUrl)
          .get(
            `/api/v1/ldap/organizations/${encodeURIComponent(orgTop)}/search`
          )
          .query({ q: 'lin' })
          .reply(200, [
            {
              dn: `ou=b,${orgTop}`,
              ou: 'b',
              objectClass: ['organizationalUnit'],
              twakeDepartmentPath: 'Government / Beta',
            },
            {
              dn: `ou=a,${orgTop}`,
              ou: 'a',
              objectClass: ['organizationalUnit'],
              twakeDepartmentPath: 'Government / Alpha',
            },
            // No path: the name.
            { dn: `ou=c,${orgTop}`, ou: 'Gamma', objectClass: ['top'] },
            {
              dn: `more-organizations-${orgTop}`,
              objectClass: ['moreIndicator'],
              _isMoreIndicator: 'true',
              _displayedCount: 3,
            },
          ]);
        expect(await client.organizationSearch('lin')).to.deep.equal([
          { dn: `ou=c,${orgTop}`, label: 'Gamma' },
          { dn: `ou=a,${orgTop}`, label: 'Government / Alpha' },
          { dn: `ou=b,${orgTop}`, label: 'Government / Beta' },
        ]);
      });
    });

    it('should take an entity’s own names from its schema metadata', async () => {
      nock(baseUrl)
        .get('/api/v1/config')
        .reply(200, {
          apiPrefix: '/api',
          ldapBase: 'dc=example,dc=com',
          features: {
            ldapGroups: {
              enabled: true,
              base: 'ou=groups,dc=example,dc=com',
              mainAttribute: 'cn',
              schema: {
                entity: {
                  label: { en: 'Groups', fr: 'Groupes' },
                  singularLabel: { en: 'group', fr: 'groupe' },
                },
                attributes: { cn: { type: 'string' } },
              },
            },
          },
        });
      const [groups] = await new ConsoleApiClient(baseUrl).discover();
      expect(resolveText(groups.label, 'fr')).to.equal('Groupes');
      expect(resolveText(groups.singularLabel, 'fr')).to.equal('groupe');
    });

    it('should offer to sign out only when the server says how', async () => {
      nock(baseUrl)
        .get('/api/v1/config')
        .reply(200, {
          apiPrefix: '/api',
          ldapBase: 'dc=example,dc=com',
          features: {
            openidconnect: { enabled: true, endpoints: { logout: '/logout' } },
          },
        });
      const oidc = new ConsoleApiClient(baseUrl);
      await oidc.discover();
      // The server's route, not the API's: no prefix.
      expect(oidc.logoutUrl).to.equal(`${baseUrl}/logout`);

      // A server naming the plugin without a logout route: nothing to link
      // to. (An ldap-rest older than the logout support names no
      // `openidconnect` at all, which the last case covers.)
      nock(baseUrl)
        .get('/api/v1/config')
        .reply(200, {
          apiPrefix: '/api',
          ldapBase: '',
          features: { openidconnect: { enabled: true } },
        });
      const older = new ConsoleApiClient(baseUrl);
      await older.discover();
      expect(older.logoutUrl).to.equal(undefined);

      nock(baseUrl)
        .get('/api/v1/config')
        .reply(200, { apiPrefix: '/api', ldapBase: '', features: {} });
      const other = new ConsoleApiClient(baseUrl);
      await other.discover();
      expect(other.logoutUrl).to.equal(undefined);
    });

    it('should say the session ended on its own origin only', async () => {
      const g = globalThis as Record<string, unknown>;
      const original = g.window;
      g.window = { location: { origin: baseUrl } };
      const other = 'http://api.example.test';
      try {
        nock(baseUrl).get('/api/v1/authz/scope').reply(401, {
          error: 'Unauthorized',
        });
        nock(other).get('/api/v1/authz/scope').reply(401, {
          error: 'Unauthorized',
        });
        let ended = 0;
        const own = new ConsoleApiClient();
        const across = new ConsoleApiClient(other);
        own.onSessionEnded = () => ended++;
        across.onSessionEnded = () => ended++;
        // The failure still reaches the caller, in case nothing reloads
        let error: unknown;
        await own.scope().catch(err => (error = err));
        expect(error).to.have.property('status', 401);
        expect(ended).to.equal(1);
        await across.scope().catch(() => undefined);
        expect(ended, 'a session at another host').to.equal(1);
      } finally {
        g.window = original;
      }
    });

    it('should ignore an entity whose schema the server did not serve', async () => {
      nock(baseUrl)
        .get('/api/v1/config')
        .reply(200, {
          apiPrefix: '/api',
          ldapBase: 'dc=example,dc=com',
          features: { ldapGroups: { enabled: true, base: 'ou=groups' } },
        });
      expect(await new ConsoleApiClient(baseUrl).discover()).to.deep.equal([]);
    });

    it('should report the server’s own refusal, not a generic failure', async () => {
      nock(baseUrl)
        .post('/api/v1/ldap/users')
        .reply(409, { error: 'This email address is already used' });

      const client = new ConsoleApiClient(baseUrl);
      try {
        await client.create(users, { mail: 'taken@example.com' });
        expect.fail('the creation should have been refused');
      } catch (err) {
        expect((err as Error).message).to.equal(
          'This email address is already used'
        );
        expect((err as Error & { status: number }).status).to.equal(409);
      }
    });

    it('should search on the chosen attribute', async () => {
      nock(baseUrl)
        .get('/api/v1/ldap/users')
        .query({ match: 'smith', attribute: 'cn' })
        .reply(200, { jsmith: { dn: 'uid=jsmith', uid: 'jsmith' } });

      const result = await new ConsoleApiClient(baseUrl).list(
        users,
        'smith',
        'cn'
      );
      expect(result).to.have.property('jsmith');
    });

    it('should send only what changed, and what was cleared', async () => {
      let body: unknown;
      nock(baseUrl)
        .put('/api/v1/ldap/users/jsmith', received => {
          body = received;
          return true;
        })
        .reply(200, { success: true });

      await new ConsoleApiClient(baseUrl).update(
        users,
        'jsmith',
        { cn: 'John Smith' },
        ['telephoneNumber']
      );
      expect(body).to.deep.equal({
        replace: { cn: 'John Smith' },
        delete: ['telephoneNumber'],
      });
    });

    it('should not issue an empty update', async () => {
      // No interceptor: a request here would fail the test.
      await new ConsoleApiClient(baseUrl).update(users, 'jsmith', {}, []);
    });

    it('should ask an organization for its child organizations only', async () => {
      // `subnodes` answers with the child OUs *and* the entries linked to the
      // node — up to fifty accounts, plus a `moreIndicator` row counting the
      // rest. Unfiltered, all of that was drawn as organizations: a member
      // clicked in the tree answered "no longer exists", and the department
      // select of every form offered user DNs as candidate organizations.
      const dn = 'ou=Sales,ou=organization,dc=example,dc=com';
      nock(baseUrl)
        .get(`/api/v1/ldap/organizations/${encodeURIComponent(dn)}/subnodes`)
        .query({ objectClass: 'organizationalUnit' })
        .reply(200, [
          {
            dn: `ou=EU,${dn}`,
            ou: ['EU'],
            twakeDepartmentPath: ['Sales / EU'],
          },
        ]);

      const children = await new ConsoleApiClient(baseUrl).organizationChildren(
        dn
      );
      expect(children.map(node => node.name)).to.deep.equal(['EU']);
    });

    it('should not draw the truncation row as a branch of the tree', async () => {
      // A branch the directory will not list in one answer ends with that
      // row too, now that ldap-rest answers a refusal with what it can get
      // rather than with an empty list. Mapped like an entry it drew a node
      // whose DN answers nothing, right where the missing organizations are.
      const dn = 'ou=Sales,ou=organization,dc=example,dc=com';
      nock(baseUrl)
        .get(`/api/v1/ldap/organizations/${encodeURIComponent(dn)}/subnodes`)
        .query({ objectClass: 'organizationalUnit' })
        .reply(200, [
          {
            dn: `ou=EU,${dn}`,
            ou: ['EU'],
            twakeDepartmentPath: ['Sales / EU'],
          },
          {
            dn: `more-organizations-${dn}`,
            cn: ['... more organizations than the directory will list'],
            objectClass: ['moreIndicator'],
            _isMoreIndicator: 'true',
            _displayedCount: '50',
          },
        ]);

      const children = await new ConsoleApiClient(baseUrl).organizationChildren(
        dn
      );
      expect(children.map(node => node.name)).to.deep.equal(['EU']);
    });

    it('should not offer the truncation row as a member', async () => {
      // Past `ldap_organization_max_subnodes` the endpoint appends a row that
      // is not an entry: its DN is `more-` plus the organization's own, and
      // nothing answers there. Listed among the members it read as a colleague
      // named after the department, and opening it went nowhere.
      const dn = 'ou=Sales,ou=organization,dc=example,dc=com';
      nock(baseUrl)
        .get(`/api/v1/ldap/organizations/${encodeURIComponent(dn)}/subnodes`)
        .reply(200, [
          {
            dn: `ou=EU,${dn}`,
            ou: ['EU'],
            objectClass: ['organizationalUnit'],
          },
          {
            dn: `uid=jsmith,ou=users,dc=example,dc=com`,
            objectClass: ['inetOrgPerson'],
          },
          {
            dn: `more-${dn}`,
            objectClass: ['moreIndicator'],
            _isMoreIndicator: 'true',
            _totalCount: '312',
          },
        ]);

      const members = await new ConsoleApiClient(baseUrl).organizationMembers(
        dn
      );
      expect(members.map(member => member.label)).to.deep.equal(['jsmith']);
    });

    it('should read the configuration at the prefix it was given', async () => {
      // Every other call uses the prefix the configuration advertises. The
      // call that reads the configuration has nothing to read it from, so a
      // server behind `--api-prefix /ldap` has to be told once.
      nock(baseUrl).get('/ldap/v1/config').reply(200, {
        apiPrefix: '/ldap',
        ldapBase: 'dc=example,dc=com',
        features: {},
      });
      expect(
        await new ConsoleApiClient(baseUrl, '/ldap').discover()
      ).to.deep.equal([]);
    });

    it('should not turn a membership edit into a request the server refuses', async () => {
      // `modifyGroup` answers `Use dedicated API to replace members` to
      // `replace.member`, and the same to `delete: ['member']`: every
      // membership edit made from the form came back as a 500. The form edits
      // the list, as it should; what the server takes is who joined and who
      // left, through the endpoints it keeps for them.
      let modified: unknown;
      let joined: unknown;
      // The interceptors are the assertion: the DELETE names the member that
      // left, and a request nobody declared reaches nothing and fails.
      const scope = nock(baseUrl)
        .put('/api/v1/ldap/groups/staff', received => {
          modified = received;
          return true;
        })
        .reply(200, { success: true })
        .post('/api/v1/ldap/groups/staff/members', received => {
          joined = received;
          return true;
        })
        .reply(200, { success: true })
        .delete(
          '/api/v1/ldap/groups/staff/members/' +
            encodeURIComponent('uid=bob,ou=users,dc=example,dc=com')
        )
        .reply(200, { success: true });

      await new ConsoleApiClient(baseUrl).update(
        groups,
        'staff',
        {
          description: 'All staff',
          member: [
            'uid=alice,ou=users,dc=example,dc=com',
            'uid=carol,ou=users,dc=example,dc=com',
          ],
        },
        [],
        staff
      );

      expect(modified).to.deep.equal({ replace: { description: 'All staff' } });
      expect(joined).to.deep.equal({
        member: ['uid=carol,ou=users,dc=example,dc=com'],
      });
      expect(scope.isDone()).to.be.true;
    });

    it('should empty a membership through the endpoint that takes it', async () => {
      // Clearing the field is `delete: ['member']`, refused just the same.
      // Nothing else was edited, so there is no modify request left to make:
      // an interceptor is declared for the two departures only, and a PUT
      // here would fail the test.
      const scope = nock(baseUrl)
        .delete(
          '/api/v1/ldap/groups/staff/members/' +
            encodeURIComponent('uid=alice,ou=users,dc=example,dc=com')
        )
        .reply(200, { success: true })
        .delete(
          '/api/v1/ldap/groups/staff/members/' +
            encodeURIComponent('uid=bob,ou=users,dc=example,dc=com')
        )
        .reply(200, { success: true });

      await new ConsoleApiClient(baseUrl).update(
        groups,
        'staff',
        {},
        ['member'],
        staff
      );
      expect(scope.isDone()).to.be.true;
    });

    it('should leave an entity that is not a group alone', async () => {
      // The dedicated endpoints are the group plugin's; an attribute named
      // `member` on a flat entity is an attribute like any other.
      let body: unknown;
      nock(baseUrl)
        .put('/api/v1/ldap/users/jsmith', received => {
          body = received;
          return true;
        })
        .reply(200, { success: true });
      await new ConsoleApiClient(baseUrl).update(users, 'jsmith', {
        mailAlternateAddress: ['j@example.com'],
      });
      expect(body).to.deep.equal({
        replace: { mailAlternateAddress: ['j@example.com'] },
      });
    });

    it('should read the escaped RDN of an organization as its name', async () => {
      // A DN escapes the comma inside a value: splitting on the first one cut
      // `ou=Sales\, EU` down to `Sales\`.
      const dn = 'ou=organization,dc=example,dc=com';
      nock(baseUrl)
        .get(`/api/v1/ldap/organizations/${encodeURIComponent(dn)}/subnodes`)
        .query({ objectClass: 'organizationalUnit' })
        .reply(200, [{ dn: `ou=Sales\\, EU,${dn}` }]);

      const children = await new ConsoleApiClient(baseUrl).organizationChildren(
        dn
      );
      expect(children.map(node => node.name)).to.deep.equal(['Sales, EU']);
    });

    it('should label a raw branch by the value of its RDN', async () => {
      const branch = 'ou=positions,ou=nomenclature,dc=example,dc=com';
      nock(baseUrl)
        .get(`/api/v1/ldap/raw/children/${encodeURIComponent(branch)}`)
        .reply(200, {
          children: [
            {
              dn: `cn=Smith\\, John,${branch}`,
              rdn: 'cn=Smith\\, John',
            },
          ],
        });

      const options = await new ConsoleApiClient(baseUrl).pointerOptions(
        branch,
        []
      );
      expect(options.map(option => option.label)).to.deep.equal([
        'Smith, John',
      ]);
    });

    it('should take a collection the schema marks large for a large one', () => {
      // A directory without an organization tree: nothing to tell the
      // accounts by, but the mark.
      const accounts: EntityDescriptor = {
        ...users,
        organizationLink: undefined,
        schema: { ...usersSchema, entity: { large: true } },
      };
      expect(isLarge(users)).to.equal(true);
      expect(isLarge(mailboxTypes)).to.equal(false);
      expect(isLarge(accounts)).to.equal(true);
      expect(isLarge({ ...accounts, schema: usersSchema })).to.equal(false);
      // The mark wins over the organization link, both ways.
      expect(
        isLarge({
          ...users,
          schema: { ...usersSchema, entity: { large: false } },
        })
      ).to.equal(false);

      expect(
        new ConsoleApiClient(baseUrl).pointerSearch(accounts.base, [accounts])
      ).to.be.a('function');
    });

    it('should search a branch too large to list, and name what it finds', async () => {
      // Accounts are attached to the organization tree: a pointer to them is
      // searched, never listed whole.
      expect(
        new ConsoleApiClient(baseUrl).pointerSearch(
          mailboxTypes.base as string,
          [mailboxTypes]
        )
      ).to.equal(undefined);
      // Unless listing it failed: any branch an entity owns can be searched.
      expect(
        new ConsoleApiClient(baseUrl).pointerSearch(
          mailboxTypes.base as string,
          [mailboxTypes],
          true
        )
      ).to.be.a('function');
      // Not a branch no entity owns, which has no search to offer.
      expect(
        new ConsoleApiClient(baseUrl).pointerSearch(
          'ou=elsewhere,dc=example,dc=com',
          [mailboxTypes],
          true
        )
      ).to.equal(undefined);
      const search = new ConsoleApiClient(baseUrl).pointerSearch(
        'OU=users,dc=example,dc=com',
        [users]
      );
      expect(search).to.be.a('function');

      nock(baseUrl)
        .get('/api/v1/ldap/users')
        .query(query => query.match === 'jane' && Boolean(query.attribute))
        .reply(200, {
          'jane.doe': {
            dn: 'uid=jane.doe,ou=users,dc=example,dc=com',
            cn: 'Jane Doe',
          },
          jdoe: { dn: 'uid=jdoe,ou=users,dc=example,dc=com' },
        });
      const found = await (search as (q: string) => Promise<unknown>)('jane');
      expect(found).to.deep.equal([
        {
          dn: 'uid=jane.doe,ou=users,dc=example,dc=com',
          label: 'Jane Doe (jane.doe)',
        },
        // No display name: the identifier alone.
        { dn: 'uid=jdoe,ou=users,dc=example,dc=com', label: 'jdoe' },
      ]);
    });

    it('should name a nomenclature value the way its schema does', async () => {
      nock(baseUrl)
        .get('/api/v1/ldap/mailboxTypes')
        .reply(200, {
          teamMailbox: {
            dn: `cn=teamMailbox,${mailboxTypes.base}`,
            cn: 'teamMailbox',
          },
          custom: { dn: `cn=custom,${mailboxTypes.base}`, cn: 'custom' },
        });

      const options = await new ConsoleApiClient(baseUrl).pointerOptions(
        mailboxTypes.base as string,
        [mailboxTypes],
        'fr'
      );
      // A value the directory added itself keeps the name it is stored as.
      expect(options.map(option => option.label)).to.deep.equal([
        'Boîte partagée',
        'custom',
      ]);
    });

    it('should give a failure its status whatever the body it came with', async () => {
      // Not every answer comes from the API: Express's own 404 page and a
      // proxy's 502 are HTML, and reading the body as JSON first threw a
      // `SyntaxError` carrying no status at all. `scope()` then read a server
      // without `auth/authzScope` as a refusal and hid every write button.
      nock(baseUrl)
        .get('/api/v1/authz/scope')
        .reply(404, '<!DOCTYPE html><title>Error</title>', {
          'Content-Type': 'text/html',
        });
      expect(await new ConsoleApiClient(baseUrl).scope()).to.equal(null);

      nock(baseUrl)
        .get('/api/v1/ldap/users')
        .reply(502, '<html><body>Bad gateway</body></html>', {
          'Content-Type': 'text/html',
        });
      try {
        await new ConsoleApiClient(baseUrl).list(users);
        expect.fail('the failure should have been raised');
      } catch (err) {
        expect((err as Error & { status: number }).status).to.equal(502);
        expect((err as Error).message).to.contain('502');
      }
    });

    it('should tell an absent organization tree from one it could not read', async () => {
      // A 404 is a server with no top organization: there is no tree to draw.
      nock(baseUrl)
        .get('/api/v1/ldap/organizations/top')
        .reply(404, { error: 'Not found' });
      expect(await new ConsoleApiClient(baseUrl).organizationTop()).to.equal(
        null
      );

      // Anything else is a failure, and reading it as "no tree" left the tree
      // on its loading message and every department select empty.
      nock(baseUrl)
        .get('/api/v1/ldap/organizations/top')
        .reply(403, { error: 'Out of your scope' });
      try {
        await new ConsoleApiClient(baseUrl).organizationTop();
        expect.fail('the refusal should have been raised');
      } catch (err) {
        expect((err as Error).message).to.equal('Out of your scope');
        expect((err as Error & { status: number }).status).to.equal(403);
      }
    });

    it('should tell a scope the server does not serve from one it refused', async () => {
      // No `auth/authzScope` is a 404 and means the server restricts nothing.
      nock(baseUrl)
        .get('/api/v1/authz/scope')
        .reply(404, { error: 'Not found' });
      expect(await new ConsoleApiClient(baseUrl).scope()).to.equal(null);

      // Anything else is a failure, and reading it as "unrestricted" would
      // show every button to a caller who was just refused.
      nock(baseUrl)
        .get('/api/v1/authz/scope')
        .reply(401, { error: 'No authenticated user' });
      try {
        await new ConsoleApiClient(baseUrl).scope();
        expect.fail('the refusal should have been raised');
      } catch (err) {
        expect((err as Error).message).to.equal('No authenticated user');
      }
    });

    it('should ask a list for a bounded number of entries, searched or not', async () => {
      // "List everything" on the accounts of a large directory ran an
      // unbounded search the directory refused, and so did a search as loose
      // as "demo": the list showed "Internal Server Error" and nothing else.
      const load = listLoader(new ConsoleApiClient(baseUrl), users);

      nock(baseUrl)
        .get('/api/v1/ldap/users')
        .query({ limit: String(LIST_LIMIT) })
        .reply(200, { jsmith: { dn: 'uid=jsmith', uid: 'jsmith' } });
      const all = await load('', 'uid,cn');
      expect(all.entries).to.have.property('jsmith');

      nock(baseUrl)
        .get('/api/v1/ldap/users')
        .query({ match: 'demo', attribute: 'uid,cn', limit: '1000' })
        .reply(200, { demo1: { dn: 'uid=demo1', uid: 'demo1' } });
      const found = await load('demo', 'uid,cn');
      expect(found.entries).to.have.property('demo1');

      // Too short to be a search: the branch, still bounded.
      nock(baseUrl)
        .get('/api/v1/ldap/users')
        .query({ limit: '1000' })
        .reply(200, {});
      expect((await load('de', 'uid,cn')).entries).to.deep.equal({});
      expect(nock.isDone()).to.equal(true);
    });

    it('should say a list is truncated only when the server says so', async () => {
      const client = new ConsoleApiClient(baseUrl);
      nock(baseUrl)
        .get('/api/v1/ldap/users')
        .query({ limit: '2' })
        .reply(
          200,
          { a: { dn: 'uid=a', uid: 'a' }, b: { dn: 'uid=b', uid: 'b' } },
          { 'X-Result-Truncated': 'true' }
        );
      const cut = await client.listBounded(users, undefined, undefined, 2);
      expect(cut.truncated).to.equal(true);
      expect(Object.keys(cut.entries)).to.deep.equal(['a', 'b']);

      // A server predating `limit` ignores it and sends no header: what it
      // answered is the whole branch.
      nock(baseUrl)
        .get('/api/v1/ldap/users')
        .query({ limit: '2' })
        .reply(200, { a: { dn: 'uid=a', uid: 'a' } });
      expect(
        (await client.listBounded(users, undefined, undefined, 2)).truncated
      ).to.equal(false);
    });

    it('should ask a group list for the attributes its schema declares', async () => {
      // ldap-rest answers a group list with `cn` and `member` alone otherwise:
      // the email column stayed empty.
      const client = new ConsoleApiClient(baseUrl);
      const withSecret: EntityDescriptor = {
        ...groups,
        schema: {
          attributes: {
            ...groups.schema.attributes,
            mail: { type: 'string', role: 'primaryEmail' },
            secret: { type: 'string', neverReturn: true },
          },
        },
      };
      nock(baseUrl)
        .get('/api/v1/ldap/groups')
        .query({ limit: '1000', attributes: 'cn,description,member,mail' })
        .reply(200, {
          staff: { dn: staff.dn, cn: 'staff', mail: 'staff@example.com' },
        });
      const { entries } = await client.listBounded(
        withSecret,
        undefined,
        undefined,
        1000
      );
      expect(entries.staff.mail).to.equal('staff@example.com');

      // A flat list answers every attribute already: nothing to ask for.
      nock(baseUrl)
        .get('/api/v1/ldap/users')
        .query({ limit: '1000' })
        .reply(200, {});
      await client.listBounded(users, undefined, undefined, 1000);
      expect(nock.isDone()).to.equal(true);
    });

    it('should keep answering the plain map from `list()`, bounded or not', async () => {
      // `list()` is exported, and embedders read what it answers as the map
      // it always was: the flag comes from `listBounded()` instead.
      const client = new ConsoleApiClient(baseUrl);
      nock(baseUrl)
        .get('/api/v1/ldap/users')
        .reply(200, { a: { dn: 'uid=a', uid: 'a' } });
      expect(await client.list(users)).to.deep.equal({
        a: { dn: 'uid=a', uid: 'a' },
      });
      nock(baseUrl)
        .get('/api/v1/ldap/users')
        .query({ limit: '1' })
        .reply(
          200,
          { a: { dn: 'uid=a', uid: 'a' } },
          { 'X-Result-Truncated': 'true' }
        );
      expect(await client.list(users, undefined, undefined, 1)).to.deep.equal({
        a: { dn: 'uid=a', uid: 'a' },
      });
    });

    it('should bound a pointer search, and explain the searches too broad', async () => {
      const search = new ConsoleApiClient(baseUrl).pointerSearch(
        'ou=users,dc=example,dc=com',
        [users]
      ) as (q: string) => Promise<unknown>;
      const translator = new Translator('en');
      const failure = async (): Promise<string> => {
        try {
          await search('demo');
        } catch (err) {
          return listFailure(err, translator);
        }
        throw new Error('the search should have failed');
      };

      nock(baseUrl)
        .get('/api/v1/ldap/users')
        .query(query => query.match === 'demo' && query.limit === '20')
        .reply(200, { demo1: { dn: 'uid=demo1,ou=users,dc=example,dc=com' } });
      expect(await search('demo')).to.have.length(1);

      nock(baseUrl)
        .get('/api/v1/ldap/users')
        .query(true)
        .reply(422, { error: 'Size limit exceeded' });
      expect(await failure()).to.equal(
        'Too many entries to show them all: narrow the search.'
      );

      nock(baseUrl).get('/api/v1/ldap/users').query(true).reply(500, {
        error: 'Internal Server Error',
        message: 'An error occurred',
      });
      expect(await failure()).to.equal(
        'The list could not be loaded. If the directory holds many entries, narrow the search.'
      );
    });

    it('should hedge a failure a broad search may explain, keeping any cause', () => {
      const translator = new Translator('en');
      const failed = (status: number, message: string): string =>
        listFailure(Object.assign(new Error(message), { status }), translator);
      const hedged = translator.t('list.failed');
      // A proxy giving up on a slow unbounded search says nothing useful.
      expect(failed(502, '502 Bad Gateway')).to.equal(hedged);
      expect(failed(504, '504 Gateway Timeout')).to.equal(hedged);
      expect(failed(500, '500 Internal Server Error')).to.equal(hedged);
      expect(failed(500, '500 ')).to.equal(hedged);
      // A 500 that names its cause keeps it, so it can still be diagnosed.
      expect(failed(500, 'Invalid DN syntax')).to.equal(
        `${hedged} (Invalid DN syntax)`
      );
      expect(failed(403, 'Out of your scope')).to.equal('Out of your scope');
    });
  });

  describe('EntityList', () => {
    it('should build its columns from the roles, identifier first', () => {
      expect(EntityList.chooseColumns(users)).to.deep.equal([
        'uid',
        'cn',
        'mail',
        'twakeDepartmentPath',
        'twakeAccountStatus',
      ]);
    });

    it('should still build a table for a schema with no roles', () => {
      const bare: EntityDescriptor = {
        ...users,
        schema: {
          attributes: {
            cn: { type: 'string' },
            description: { type: 'string' },
            objectClass: { type: 'array' },
          },
        },
        mainAttribute: 'cn',
      };
      expect(EntityList.chooseColumns(bare)).to.deep.equal([
        'cn',
        'description',
      ]);
    });

    it('should keep the root and the leaf of a deep path', () => {
      // The separators the shortened form adds are literal; the ones inside a
      // short path come through the shared HTML escaper, which encodes `/`.
      expect(EntityList.shortenPath('A / B / C / D')).to.equal('A / … / D');
      expect(EntityList.shortenPath('A / B')).to.equal('A &#x2F; B');
      expect(EntityList.shortenPath('A')).to.equal('A');
    });

    it('should not cut a path up with a scanner that squares its length', () => {
      // `path.split(/\s*\/\s*/)` walks back over the run of blanks before
      // every position it tries, so a path holding one long run costs the
      // square of its length — and a path is whatever the directory holds.
      // The shortened form is the same either way; the time it takes is not:
      // this input took over seven seconds before, and no measurable time
      // now.
      const path = `A / B${' '.repeat(100000)}x / C`;
      const started = Date.now();
      expect(EntityList.shortenPath(path)).to.equal('A / … / C');
      expect(Date.now() - started).to.be.below(1000);
    });

    it('should escape a path it shortens', () => {
      expect(EntityList.shortenPath('<A> / B / <D>')).to.equal(
        '&lt;A&gt; / … / &lt;D&gt;'
      );
    });

    it('should search every field the schema marks, not just the identifier', async () => {
      // Looking for a person by surname meant knowing which attribute holds
      // it and switching a selector to it first — schema knowledge asked of
      // someone searching precisely because they lack it.
      const asked: string[] = [];
      const list = new EntityList({
        entity: {
          ...users,
          schema: {
            attributes: {
              uid: { type: 'string', role: 'identifier', searchable: true },
              sn: { type: 'string', searchable: true },
              userPassword: { type: 'string', neverReturn: true },
              twakeSecret: { type: 'string' },
            },
          },
        },
        translator: new Translator('en'),
        load: (_search: string, attribute: string) => {
          asked.push(attribute);
          return Promise.resolve({});
        },
        listable: true,
        onOpen: () => undefined,
        onDelete: () => Promise.resolve(),
        canDelete: false,
      });
      await list.render(stubContainer());
      // Marked attributes only: an unmarked one is not offered, because the
      // marker says which the directory indexed.
      expect(asked).to.deep.equal(['uid,sn']);
    });

    it('should guess when the schema marks nothing', async () => {
      const asked: string[] = [];
      const list = new EntityList({
        entity: {
          ...users,
          schema: {
            attributes: {
              objectClass: { type: 'array' },
              uid: { type: 'string' },
              userPassword: { type: 'string', neverReturn: true },
              manager: { type: 'pointer' },
            },
          },
        },
        translator: new Translator('en'),
        load: (_search: string, attribute: string) => {
          asked.push(attribute);
          return Promise.resolve({});
        },
        listable: true,
        onOpen: () => undefined,
        onDelete: () => Promise.resolve(),
        canDelete: false,
      });
      await list.render(stubContainer());
      // Everything returnable, single-valued and not a DN.
      expect(asked).to.deep.equal(['uid']);
    });

    it('should show the answer to the last search, not the last answer', async () => {
      // Typing is debounced, not serialised: two loads are in flight whenever
      // the operator keeps typing, and the slow one used to overwrite the
      // fast one — the box saying "smith" over a table of "smi" results.
      const pending: ((value: Record<string, Entry>) => void)[] = [];
      const list = new EntityList({
        entity: users,
        translator: new Translator('en'),
        load: () =>
          new Promise<Record<string, Entry>>(resolve => pending.push(resolve)),
        listable: true,
        onOpen: () => undefined,
        onDelete: () => Promise.resolve(),
        canDelete: false,
      });
      const container = stubContainer();

      const first = list.render(container);
      const second = list.refresh();
      expect(pending).to.have.length(2);

      // The newer search answers first, the older one after it.
      pending[1]({ smith: { dn: 'uid=smith', uid: 'smith' } });
      pending[0]({ smi: { dn: 'uid=smi', uid: 'smi' } });
      await Promise.all([first, second]);

      expect(container.innerHTML).to.contain('smith');
      expect(container.innerHTML).to.not.contain('>smi<');
    });

    it('should show a value the directory answered in another case than the schema’s', async () => {
      // LDAP attribute names are case-insensitive (RFC 4512): a directory that
      // answers `MAIL` where the schema says `mail` still holds the value, and
      // reading the entry by the schema's exact spelling missed it — the cell
      // showed empty for a value that was there.
      const list = new EntityList({
        entity: users,
        translator: new Translator('en'),
        load: () =>
          Promise.resolve({
            jsmith: {
              dn: 'uid=jsmith,ou=users,dc=example,dc=com',
              UID: 'jsmith',
              CN: 'John Smith',
              MAIL: 'jsmith@example.com',
            },
          }),
        listable: true,
        onOpen: () => undefined,
        onDelete: () => Promise.resolve(),
        canDelete: false,
      });
      const container = stubContainer();
      await list.render(container);
      expect(container.innerHTML).to.contain('jsmith@example.com');
    });

    it('should carry a value the directory answered in another case, into the export', async () => {
      const list = new EntityList({
        entity: users,
        translator: new Translator('en'),
        load: () =>
          Promise.resolve({
            jsmith: {
              dn: 'uid=jsmith,ou=users,dc=example,dc=com',
              UID: 'jsmith',
              CN: 'John Smith',
              MAIL: 'jsmith@example.com',
            },
          }),
        listable: true,
        onOpen: () => undefined,
        onDelete: () => Promise.resolve(),
        canDelete: false,
      });
      await list.render(stubContainer());
      (list as unknown as { selected: Set<string> }).selected = new Set([
        'jsmith',
      ]);

      // `exportSelection` reaches for `document` and `URL` the way a browser
      // provides them; only `document` is missing under Node, so it alone is
      // stubbed here, and the real `Blob`/`URL.createObjectURL` are left in
      // place to carry the CSV text out for inspection.
      const originalDocument = (globalThis as Record<string, unknown>).document;
      const originalCreateObjectURL = URL.createObjectURL;
      const originalRevokeObjectURL = URL.revokeObjectURL;
      let captured: Blob | undefined;
      (globalThis as Record<string, unknown>).document = {
        createElement: () => ({
          click: () => undefined,
          href: '',
          download: '',
        }),
      };
      URL.createObjectURL = (blob: Blob): string => {
        captured = blob;
        return 'blob:stub';
      };
      URL.revokeObjectURL = () => undefined;
      try {
        (list as unknown as { exportSelection(): void }).exportSelection();
      } finally {
        (globalThis as Record<string, unknown>).document = originalDocument;
        URL.createObjectURL = originalCreateObjectURL;
        URL.revokeObjectURL = originalRevokeObjectURL;
      }
      const csv = await captured?.text();
      expect(csv).to.contain('jsmith@example.com');
    });

    /** A list of accounts drawn from what `listLoader` answers. */
    async function drawnList(language: string): Promise<string> {
      const list = new EntityList({
        entity: users,
        translator: new Translator(language),
        load: listLoader(new ConsoleApiClient(baseUrl), users),
        listable: true,
        onOpen: () => undefined,
        onDelete: () => Promise.resolve(),
        canDelete: false,
      });
      const container = stubContainer();
      await list.render(container);
      return container.innerHTML;
    }

    it('should say when the server left entries out, and only then', async () => {
      nock(baseUrl)
        .get('/api/v1/ldap/users')
        .query(true)
        .reply(
          200,
          { jsmith: { dn: 'uid=jsmith', uid: 'jsmith' } },
          { 'X-Result-Truncated': 'true' }
        );
      const cut = await drawnList('fr');
      expect(cut).to.contain(
        'Seules 1 entrées sont affichées ; il y en a d’autres. Utilisez la recherche pour les trouver.'
      );
      expect(cut).to.contain('jsmith');

      nock(baseUrl)
        .get('/api/v1/ldap/users')
        .query(true)
        .reply(200, { jsmith: { dn: 'uid=jsmith', uid: 'jsmith' } });
      const whole = await drawnList('en');
      expect(whole).to.contain('jsmith');
      expect(whole).to.not.contain('dc-list-notice');
      expect(whole).to.not.contain('Only ');
    });

    it('should count what was received, in the reader’s way of writing numbers', async () => {
      // The server cuts where it likes — it may cap lower than asked — so the
      // notice counts the rows it sent, not the rows the console asked for.
      const many: Record<string, Entry> = {};
      for (let i = 0; i < 1200; i++)
        many[`u${i}`] = { dn: `uid=u${i}`, uid: `u${i}` };
      nock(baseUrl)
        .get('/api/v1/ldap/users')
        .query(true)
        .reply(200, many, { 'X-Result-Truncated': 'true' });
      expect(await drawnList('en')).to.contain(
        'Only 1,200 entries are shown; there are more.'
      );
      nock(baseUrl)
        .get('/api/v1/ldap/users')
        .query(true)
        .reply(200, many, { 'X-Result-Truncated': 'true' });
      expect(await drawnList('fr')).to.contain(
        `Seules ${(1200).toLocaleString('fr')} entrées sont affichées`
      );
    });

    it('should drop the notice once an answer is complete, or fails', async () => {
      const answers: (EntryList | Error)[] = [];
      const list = new EntityList({
        entity: users,
        translator: new Translator('en'),
        load: () => {
          const answer = answers.shift() as EntryList | Error;
          return answer instanceof Error
            ? Promise.reject(answer)
            : Promise.resolve(answer);
        },
        listable: true,
        onOpen: () => undefined,
        onDelete: () => Promise.resolve(),
        canDelete: false,
      });
      const container = stubContainer();
      const cut: EntryList = {
        entries: { a: { dn: 'uid=a', uid: 'a' } },
        truncated: true,
      };

      answers.push(cut, { entries: cut.entries, truncated: false });
      await list.render(container);
      expect(container.innerHTML).to.contain('dc-list-notice');
      await list.refresh();
      expect(container.innerHTML).to.contain('>a<');
      expect(container.innerHTML).to.not.contain('dc-list-notice');

      answers.push(cut, Object.assign(new Error('Nope'), { status: 403 }));
      await list.refresh();
      expect(container.innerHTML).to.contain('dc-list-notice');
      await list.refresh();
      expect(container.innerHTML).to.contain('Nope');
      expect(container.innerHTML).to.not.contain('dc-list-notice');
    });

    it('should still take a plain map from a loader, as complete', async () => {
      // `EntityList` is exported: a loader written before `EntryList` answers
      // the map alone, and that says nothing was left out.
      const list = new EntityList({
        entity: users,
        translator: new Translator('en'),
        load: () =>
          Promise.resolve({ truncated: { dn: 'uid=truncated', uid: 'x' } }),
        listable: true,
        onOpen: () => undefined,
        onDelete: () => Promise.resolve(),
        canDelete: false,
      });
      const container = stubContainer();
      await list.render(container);
      // Even an entry named after the flag is read as an entry.
      expect(container.innerHTML).to.contain('data-id="truncated"');
      expect(container.innerHTML).to.not.contain('dc-list-notice');
    });

    it('should explain a search too broad for the directory, not repeat the server', async () => {
      // A server that knows the refusal answers 422.
      nock(baseUrl)
        .get('/api/v1/ldap/users')
        .query(true)
        .reply(422, { error: 'Size limit exceeded, use limit or match' });
      const refused = await drawnList('fr');
      expect(refused).to.contain(
        'Trop d’entrées pour les afficher toutes : affinez la recherche.'
      );
      expect(refused).to.not.contain('Size limit exceeded');

      // ldap-rest 0.12.0 ignores `limit` and reports it as any failure.
      nock(baseUrl).get('/api/v1/ldap/users').query(true).reply(500, {
        error: 'Internal Server Error',
        message: 'An error occurred',
      });
      const failed = await drawnList('en');
      expect(failed).to.contain(
        'The list could not be loaded. If the directory holds many entries, narrow the search.'
      );
      expect(failed).to.not.contain('Internal Server Error');

      // Any other refusal says what the server said.
      nock(baseUrl)
        .get('/api/v1/ldap/users')
        .query(true)
        .reply(403, { error: 'Out of your scope' });
      expect(await drawnList('en')).to.contain('Out of your scope');
    });

    it('should not let an exported cell become a formula', () => {
      // A directory holds what was written into it, and a spreadsheet reads a
      // cell opening on one of these as a formula. Quoting does not help: the
      // quotes are stripped on import and the formula still runs.
      expect(csvCell('=HYPERLINK("http://evil.example")')).to.equal(
        '"\'=HYPERLINK(""http://evil.example"")"'
      );
      expect(csvCell('@SUM(A1)')).to.equal("'@SUM(A1)");
      expect(csvCell('-1+1')).to.equal("'-1+1");
      // Ordinary values are left alone, quoted only when they need it.
      expect(csvCell('John Smith')).to.equal('John Smith');
      expect(csvCell('Smith, John')).to.equal('"Smith, John"');
    });
  });

  describe('importing pointers into a large branch', () => {
    const accounts: EntityDescriptor = {
      ...users,
      schema: {
        attributes: {
          uid: { type: 'string', role: 'identifier', required: true },
          manager: { type: 'pointer', branch: [users.base as string] },
          delegates: {
            type: 'array',
            items: { type: 'pointer', branch: [users.base as string] },
          },
        },
      },
    };
    const dn = (uid: string): string => `uid=${uid},${users.base}`;
    const account = (uid: string): Entry => ({ dn: dn(uid), uid });

    /**
     * Run the import's check on a file, the way the button does, and hand
     * back the rows it prepared and the error it showed.
     */
    async function check(
      rows: string[][]
    ): Promise<{ errors: string[][]; values: unknown[]; error: string }> {
      const client = new ConsoleApiClient(baseUrl);
      const importer = new EntityImport({
        entity: accounts,
        translator: new Translator('en'),
        pointerOptions: branch => client.pointerOptions(branch, [accounts]),
        pointerLookup: branch => client.pointerLookup(branch, [accounts]),
        create: () => Promise.resolve(),
        onDone: () => undefined,
        onClose: () => undefined,
      });
      importer.render(stubContainer());
      const state = importer as unknown as {
        table: unknown;
        mapping: string[];
        rows: { errors: string[]; values: unknown }[];
        error: string;
        check(): Promise<void>;
      };
      state.table = {
        headers: ['uid', 'manager', 'delegates'],
        rows,
        delimiter: ',',
      };
      state.mapping = ['uid', 'manager', 'delegates'];
      await state.check();
      return {
        errors: state.rows.map(row => row.errors),
        values: state.rows.map(row => row.values),
        error: state.error,
      };
    }

    it('should resolve from the whole branch when it can be listed', async () => {
      // One listing for both columns, and no request per value.
      nock(baseUrl)
        .get('/api/v1/ldap/users')
        .reply(200, { alice: account('alice'), bob: account('bob') });
      const { errors, values } = await check([['new1', 'alice', 'bob|Alice']]);
      expect(errors).to.deep.equal([[]]);
      expect(values[0]).to.deep.include({
        manager: dn('alice'),
        delegates: [dn('bob'), dn('alice')],
      });
      expect(nock.isDone()).to.equal(true);
    });

    for (const status of [500, 422]) {
      it(`should look each value up when the branch answers ${status}`, async () => {
        nock(baseUrl)
          .get('/api/v1/ldap/users')
          .reply(status, { error: 'Internal Server Error' });
        // Every interceptor answers once: a value looked up twice fails.
        nock(baseUrl)
          .get(`/api/v1/ldap/users/${encodeURIComponent(dn('alice'))}`)
          .reply(200, account('alice'));
        nock(baseUrl).get('/api/v1/ldap/users/bob').reply(200, account('bob'));
        // Spaces around the separators, as a DN typed by hand has them: read
        // by the DN rebuilt on the base, as the full list would match it.
        nock(baseUrl)
          .get(`/api/v1/ldap/users/${encodeURIComponent(dn('carol'))}`)
          .reply(200, account('carol'));
        for (const missing of ['ann', 'zoé', 'dup', 'jo', 'x', 'ka'])
          nock(baseUrl)
            .get(`/api/v1/ldap/users/${encodeURIComponent(missing)}`)
            .reply(404, { error: 'user not found' });
        const search = (match: string) =>
          nock(baseUrl)
            .get('/api/v1/ldap/users')
            .query({ match, attribute: 'uid', limit: '50' });
        // Names containing "ann", none of them "ann" itself.
        search('ann').reply(200, {
          anna: account('anna'),
          joanne: account('joanne'),
        });
        // What the search answered is compared the way the full list
        // compares names: without accents. OpenLDAP's substring match does
        // not fold accents, so this answer stands for the resolver's exact
        // comparison, not for what a directory would send.
        search('zoé').reply(200, { zoe: account('zoe') });
        // Two answers the exact comparison reads as the same name are refused,
        // not guessed. A directory ignores a uid's trailing space and would
        // not hold both: again the comparison is tested, not the directory.
        search('dup').reply(200, {
          dup: { dn: 'uid=dup,ou=users,dc=example,dc=com', uid: 'dup' },
          'Dup ': { dn: 'uid=Dup\\20,ou=users,dc=example,dc=com', uid: 'Dup ' },
        });
        // Cut before the end with no exact match: the name may be further.
        search('jo').reply(
          200,
          { john: account('john') },
          {
            'X-Result-Truncated': 'true',
          }
        );
        // Refused as too broad by ldap-rest 0.12.0: says as little.
        search('x').reply(500, { error: 'Internal Server Error' });
        // Exactly as long as asked, and no header — which a cross-origin page
        // may not see: read as cut all the same.
        const many: Record<string, Entry> = {};
        for (let i = 0; i < 50; i++) many[`ka${i}`] = account(`ka${i}`);
        search('ka').reply(200, many);

        const { errors, values, error } = await check([
          ['new1', dn('alice'), 'bob|zoé'],
          ['new2', 'bob', 'ann|uid=carol, ou=users, dc=example, dc=com|ka'],
          ['new3', 'dup', 'jo|x'],
          ['new4', 'uid=eve,ou=other,dc=example,dc=com', ''],
        ]);
        expect(error).to.equal('');
        expect(values[0]).to.deep.include({
          manager: dn('alice'),
          delegates: [dn('bob'), dn('zoe')],
        });
        expect(values[1]).to.deep.include({ delegates: [dn('carol')] });
        const undecided = (value: string): string =>
          `Delegates: “${value}” is no identifier, and too many entries contain it to rule out another spelling: check it, or use a DN`;
        expect(errors[0]).to.deep.equal([]);
        expect(errors[1]).to.deep.equal([
          'Delegates: “ann” not found',
          undecided('ka'),
        ]);
        expect(errors[2]).to.deep.equal([
          'Manager: “dup” matches several entries',
          undecided('jo'),
          undecided('x'),
        ]);
        // A DN outside the branch is no entry of it, and costs no request.
        expect(errors[3]).to.deep.equal([
          'Manager: “uid=eve,ou=other,dc=example,dc=com” not found',
        ]);
        expect(nock.isDone()).to.equal(true);
      });
    }

    it('should explain a branch it could neither list nor look up', async () => {
      nock(baseUrl)
        .get('/api/v1/ldap/users')
        .reply(500, { error: 'Internal Server Error' });
      nock(baseUrl)
        .get('/api/v1/ldap/users/bob')
        .reply(502, '<html>Bad gateway</html>', {
          'Content-Type': 'text/html',
        });
      const { error } = await check([['new1', 'bob', '']]);
      expect(error).to.equal(
        'The list could not be loaded. If the directory holds many entries, narrow the search.'
      );
    });

    it('should not look values up when the branch was refused for another reason', async () => {
      nock(baseUrl)
        .get('/api/v1/ldap/users')
        .reply(403, { error: 'Out of your scope' });
      const { error } = await check([['new1', 'bob', '']]);
      expect(error).to.equal('Out of your scope');
      expect(nock.isDone()).to.equal(true);
    });
  });

  describe('pointerLabel', () => {
    const dn = (value: string): string =>
      `cn=${value},ou=twakeMailboxType, ou=nomenclature,DC=example,dc=com`;

    it('should name the value a pointer lands on', () => {
      // The DN is spelled as a directory may answer it: spaces after a comma,
      // upper-case attribute names, the value in another case.
      expect(
        pointerLabel([users, mailboxTypes], dn('TEAMMAILBOX'), 'en')
      ).to.equal('Shared mailbox');
      expect(
        displayValue({ type: 'pointer' }, dn('teamMailbox'), value =>
          pointerLabel([mailboxTypes], value, 'fr')
        )
      ).to.equal('Boîte partagée');
    });

    it('should fall back to the stored value when no schema names it', () => {
      expect(pointerLabel([mailboxTypes], dn('custom'), 'en')).to.equal(
        undefined
      );
      expect(
        displayValue({ type: 'pointer' }, dn('custom'), value =>
          pointerLabel([mailboxTypes], value, 'en')
        )
      ).to.equal('custom');
      // An entry of an entity without a map, or of no entity at all.
      expect(
        pointerLabel([users], 'uid=alice,ou=users,dc=example,dc=com', 'en')
      ).to.equal(undefined);
      expect(pointerLabel([mailboxTypes], 'not a dn', 'en')).to.equal(
        undefined
      );
    });
  });

  describe('formatByteSize', () => {
    it('should say a size the way it was set', () => {
      // `normalize: byteSize` stores what `parseByteSize` computed, so a quota
      // set as `4GB` reads back as ten digits nobody counts at a glance.
      expect(formatByteSize('2000000000')).to.equal('2 GB');
      expect(formatByteSize('1500000')).to.equal('1.5 MB');
      expect(formatByteSize('999')).to.equal('999 B');
      expect(formatByteSize('0')).to.equal('0 B');
    });

    it('should say it only when the short form is the same number', () => {
      // The form hands what it shows back to the server, which reads it with
      // `parseByteSize`: a rounded size would write a different quota than the
      // one displayed. A value no unit states exactly stays as it is.
      expect(formatByteSize('2000000001')).to.equal('2000000001');
      expect(formatByteSize('1099511627776')).to.equal('1099511627776');
      expect(formatByteSize('not a number')).to.equal('not a number');
    });

    it('should round-trip every value it chooses to format', () => {
      // What ldap-rest's `parseByteSize` (plugins/ldap/enterpriseRules) reads
      // each of these as: decimal units, 1 kB = 1000 bytes. The console no
      // longer lives beside it, so the server's answers are written down here;
      // a change on either side that breaks the round trip fails this table.
      const server: Record<string, number> = {
        '2 GB': 2000000000,
        '2.048 KB': 2048,
        '1.5 MB': 1500000,
        '512 GB': 512000000000,
      };
      for (const raw of ['2000000000', '2048', '1500000', '512000000000']) {
        const shown = formatByteSize(raw);
        expect(server, shown).to.have.property(shown);
        expect(String(server[shown]), shown).to.equal(raw);
      }
    });
  });

  describe('EntityForm', () => {
    const build = (entry?: Record<string, string | string[]>): EntityForm =>
      new EntityForm({
        entity: users,
        entry,
        translator: new Translator('en'),
        pointerOptions: () => Promise.resolve([]),
        onSubmit: () => Promise.resolve(),
        onCancel: () => undefined,
      });

    it('should offer a search, not a select, for a pointer into a large branch', async () => {
      const delegates = {
        ...users,
        schema: {
          ...users.schema,
          attributes: {
            ...users.schema.attributes,
            twakeDelegatedUsers: {
              type: 'array' as const,
              items: {
                type: 'pointer',
                branch: ['ou=users,dc=example,dc=com'],
              },
            },
          },
        },
      };
      let asked = '';
      const container = stubContainer();
      await new EntityForm({
        entity: delegates,
        entry: {
          uid: 'bob',
          twakeDelegatedUsers: ['uid=alice,ou=users,dc=example,dc=com'],
        },
        translator: new Translator('en'),
        pointerOptions: () => Promise.resolve([]),
        pointerSearch: branch => {
          asked = branch;
          return () => Promise.resolve([]);
        },
        onSubmit: () => Promise.resolve(),
        onCancel: () => undefined,
      }).render(container);
      expect(asked).to.equal('ou=users,dc=example,dc=com');
      expect(container.innerHTML).to.include(
        'data-picker="twakeDelegatedUsers"'
      );
      expect(container.innerHTML).to.include('Type 3 characters to search');
      // The value held is shown by its RDN, not as a DN.
      expect(container.innerHTML).to.include('>alice</span>');
    });

    /** A select just real enough for `fillPointers`, which only rewrites markup. */
    const stubSelect = (
      branch: string,
      value: string,
      required = false
    ): HTMLSelectElement & { dataset: { pointer: string } } => {
      const select = {
        dataset: required
          ? { pointer: branch, required: 'true' }
          : { pointer: branch },
        value,
        innerHTML: '',
        disabled: true,
        removeAttribute: (_name: string): void => undefined,
        insertAdjacentHTML: (_position: string, html: string): void => {
          select.innerHTML += html;
        },
      };
      return select as unknown as HTMLSelectElement & {
        dataset: { pointer: string };
      };
    };

    /** Render a form whose one pointer control is that select. */
    const renderWith = async (
      select: HTMLSelectElement,
      entry: Record<string, string | string[]>,
      pointerOptions: () => Promise<{ dn: string; label: string }[]>,
      entity: EntityDescriptor = users
    ): Promise<HTMLElement & { innerHTML: string }> => {
      const container = stubContainer();
      (
        container as unknown as { querySelectorAll: () => unknown[] }
      ).querySelectorAll = (): unknown[] => [select];
      await new EntityForm({
        entity,
        entry,
        translator: new Translator('en'),
        pointerOptions,
        onSubmit: () => Promise.resolve(),
        onCancel: () => undefined,
      }).render(container);
      return container;
    };

    const held = 'ou=Demo,dc=example,dc=com';

    it('should keep a pointer inert until its candidates are known', async () => {
      const select = stubSelect('dc=example,dc=com', held);
      const container = await renderWith(
        select,
        { uid: 'bob', twakeDepartmentLink: [held] },
        () => Promise.resolve([])
      );
      // A click meant to open the list would otherwise take the empty choice
      // and clear the organization the entry holds.
      expect(container.innerHTML).to.include('data-required="true"');
      expect(container.innerHTML).to.include('disabled aria-busy="true"');
      expect(container.innerHTML).to.include('<option value="" disabled>');
    });

    it('should not offer the empty choice on a required field', async () => {
      const select = stubSelect('dc=example,dc=com', held, true);
      await renderWith(
        select,
        { uid: 'bob', twakeDepartmentLink: [held] },
        () => Promise.resolve([{ dn: held, label: 'Demo' }])
      );
      // The form refuses to save without it: a choice that cannot be taken is
      // not offered.
      expect(select.disabled).to.equal(false);
      expect(select.innerHTML).to.include('<option value="" disabled>');
      expect(select.innerHTML).to.include('>Demo</option>');
      expect(select.value).to.equal(held);
    });

    it('should offer the empty choice on an optional field', async () => {
      const optional: EntityDescriptor = {
        ...users,
        schema: {
          ...users.schema,
          attributes: {
            ...users.schema.attributes,
            title: { type: 'pointer' as const, branch: ['dc=example,dc=com'] },
          },
        },
      };
      const select = stubSelect('dc=example,dc=com', held);
      await renderWith(
        select,
        { uid: 'bob', title: [held] },
        () => Promise.resolve([{ dn: held, label: 'Demo' }]),
        optional
      );
      expect(select.disabled).to.equal(false);
      // The empty choice is there and carries no `disabled`: taking it is a
      // real choice, and how the value an entry holds is cleared.
      expect(select.innerHTML).to.include('<option value="">');
      expect(select.innerHTML).to.include('>Demo</option>');
      expect(select.value).to.equal(held);
    });

    it('should keep the value of a branch that answered nothing', async () => {
      const select = stubSelect('dc=example,dc=com', held);
      await renderWith(
        select,
        { uid: 'bob', twakeDepartmentLink: [held] },
        () =>
          Promise.reject(Object.assign(new Error('Forbidden'), { status: 403 }))
      );
      // Nothing to choose: the empty choice cannot be taken, and the value the
      // directory holds stays selected rather than being silently dropped.
      // An unreadable branch has nothing more to say: the stub has no
      // `closest`, and looking for the field to write a message in would throw.
      expect(select.disabled).to.equal(false);
      expect(select.innerHTML).to.include('<option value="" disabled>');
      expect(select.innerHTML).to.include(`${held}" selected`);
      expect(select.value).to.equal(held);
    });

    /** An element recording its listeners, for wiring a stub cannot run. */
    const recorder = (
      children: Record<string, unknown> = {},
      dataset: Record<string, string> = {}
    ): {
      innerHTML: string;
      value: string;
      hidden: boolean;
      dataset: Record<string, string>;
      addEventListener(type: string, handler: (event: unknown) => void): void;
      setAttribute(): void;
      removeAttribute(): void;
      querySelector(selector: string): unknown;
      fire(type: string, event?: unknown): void;
    } => {
      const handlers: Record<string, ((event: unknown) => void)[]> = {};
      return {
        innerHTML: '',
        value: '',
        hidden: true,
        dataset,
        addEventListener: (type, handler) => {
          (handlers[type] ||= []).push(handler);
        },
        setAttribute: () => undefined,
        removeAttribute: () => undefined,
        querySelector: selector => children[selector] ?? null,
        fire: (type, event = {}) => {
          for (const handler of handlers[type] || []) handler(event);
        },
      };
    };

    it('should add a second choice to a multi-valued pointer, not replace the first', async () => {
      // The picker read "multiple" from the field element, which never
      // carried it: choosing a second delegate dropped the first.
      const alice = 'uid=alice,ou=users,dc=example,dc=com';
      const jane = 'uid=jane,ou=users,dc=example,dc=com';
      const input = recorder();
      const results = recorder();
      const tokens = recorder();
      const field = recorder({
        '[data-picker-input]': input,
        '.dc-picker-results': results,
        '.dc-token-list': tokens,
      });
      const container = stubContainer();
      (
        container as unknown as { querySelector(s: string): unknown }
      ).querySelector = selector =>
        selector === '[data-field="twakeDelegatedUsers"]' ? field : null;
      const form = new EntityForm({
        entity: {
          ...users,
          schema: {
            attributes: {
              uid: users.schema.attributes.uid,
              twakeDelegatedUsers: {
                type: 'array',
                items: { type: 'pointer', branch: [users.base as string] },
              },
            },
          },
        },
        entry: { uid: 'bob', twakeDelegatedUsers: [alice] },
        translator: new Translator('en'),
        pointerOptions: () => Promise.resolve([]),
        pointerSearch: () => () =>
          Promise.resolve([{ dn: jane, label: 'Jane' }]),
        onSubmit: () => Promise.resolve(),
        onCancel: () => undefined,
      });
      await form.render(container);

      input.value = 'jane';
      input.fire('input');
      // Past the debounce, and the search it then issues.
      await new Promise(resolve => setTimeout(resolve, 300));
      input.fire('keydown', { key: 'Enter', preventDefault: () => undefined });
      expect(
        (form as unknown as { values: Record<string, string[]> }).values
          .twakeDelegatedUsers
      ).to.deep.equal([alice, jane]);
    });

    describe('a pointer branch that could not be listed', () => {
      const translator = new Translator('en');
      const failure = (status: number, message: string): Error =>
        Object.assign(new Error(message), { status });
      const search = (): Promise<{ dn: string; label: string }[]> =>
        Promise.resolve([]);

      it('should say nothing of a branch the caller may not read', () => {
        let asked = false;
        const fallback = pointerFallback(
          failure(403, 'Forbidden'),
          translator,
          () => {
            asked = true;
            return search;
          }
        );
        expect(fallback).to.deep.equal({});
        expect(asked).to.equal(false);
      });

      it('should explain a branch too broad to list, and offer its search', () => {
        const failed = pointerFallback(
          failure(500, 'Internal Server Error'),
          translator,
          () => search
        );
        expect(failed.message).to.equal(
          'The list could not be loaded. If the directory holds many entries, narrow the search.'
        );
        expect(failed.search).to.equal(search);
        const refused = pointerFallback(
          failure(422, 'Size limit exceeded'),
          translator,
          () => undefined
        );
        expect(refused).to.deep.equal({
          message: 'Too many entries to show them all: narrow the search.',
          search: undefined,
        });
      });

      it('should repeat any other failure, with no search', () => {
        let asked = false;
        expect(
          pointerFallback(failure(404, 'Not found'), translator, () => {
            asked = true;
            return search;
          })
        ).to.deep.equal({ message: 'Not found' });
        expect(asked).to.equal(false);
      });

      /** A select inside its field, both just real enough for the form. */
      const inField = (
        name: string,
        branch: string,
        value: string
      ): {
        select: HTMLSelectElement;
        field: { innerHTML: string };
        note: { textContent: string; hidden: boolean; id: string };
        describedBy: () => string | undefined;
      } => {
        const select = stubSelect(branch, value) as unknown as Record<
          string,
          unknown
        >;
        let describedBy: string | undefined;
        select.setAttribute = (attribute: string, text: string): void => {
          if (attribute === 'aria-describedby') describedBy = text;
        };
        const note = {
          textContent: '',
          hidden: true,
          id: `dc-note-${name}`,
        };
        const field = {
          innerHTML: '',
          dataset: { field: name },
          querySelector: (selector: string): unknown =>
            selector === '[data-pointer-note]'
              ? note
              : selector.includes('[data-pointer]')
                ? select
                : null,
        };
        select.closest = (): unknown => field;
        return {
          select: select as unknown as HTMLSelectElement,
          field,
          note,
          describedBy: () => describedBy,
        };
      };

      it('should keep the select and say why it offers nothing', async () => {
        const { select, field, note, describedBy } = inField(
          'twakeDepartmentLink',
          'dc=example,dc=com',
          held
        );
        await renderWith(
          select,
          { uid: 'bob', twakeDepartmentLink: [held] },
          () => Promise.reject(failure(500, 'Internal Server Error'))
        );
        expect(select.disabled).to.equal(false);
        expect(select.innerHTML).to.include(`${held}" selected`);
        expect(field.innerHTML).to.equal('');
        expect(note.hidden).to.equal(false);
        // Filled a moment after it is shown, for a screen reader to say it.
        await new Promise(resolve => setTimeout(resolve, 150));
        expect(note.textContent).to.equal(
          'The list could not be loaded. If the directory holds many entries, narrow the search.'
        );
        expect(describedBy()).to.equal('dc-note-twakeDepartmentLink');
      });

      it('should trade the select for a search when the branch has one', async () => {
        const { select, field, note } = inField(
          'twakeDepartmentLink',
          'dc=example,dc=com',
          held
        );
        const container = stubContainer();
        (
          container as unknown as { querySelectorAll: () => unknown[] }
        ).querySelectorAll = (): unknown[] => [select];
        const asked: [string, boolean | undefined][] = [];
        await new EntityForm({
          entity: users,
          entry: { uid: 'bob', twakeDepartmentLink: [held] },
          translator,
          pointerOptions: () => Promise.reject(failure(422, 'Too broad')),
          pointerSearch: (branch, failed) => {
            asked.push([branch, failed]);
            return failed ? search : undefined;
          },
          onSubmit: () => Promise.resolve(),
          onCancel: () => undefined,
        }).render(container);
        // Asked once as usual, then once more after the failure.
        expect(asked).to.deep.include(['dc=example,dc=com', true]);
        expect(field.innerHTML).to.include('data-picker="twakeDepartmentLink"');
        // The value held is still there, as a token of the search.
        expect(field.innerHTML).to.include('>Demo</span>');
        await new Promise(resolve => setTimeout(resolve, 150));
        expect(note.textContent).to.equal(
          'Too many entries to show them all: narrow the search.'
        );
        // The select was not filled: it is gone.
        expect(select.disabled).to.equal(true);
      });

      it('should remove one value per click once a token list became a search', async () => {
        // The token list listens on the field itself, which the swap keeps:
        // left alone, it removed a value on the same click as the search did.
        const alice = 'uid=alice,ou=users,dc=example,dc=com';
        const bob = 'uid=bob,ou=users,dc=example,dc=com';
        const tokens = recorder();
        const note = { textContent: '', hidden: true, id: 'note' };
        const field = recorder(
          {
            '[data-picker-input]': recorder(),
            '.dc-picker-results': recorder(),
            '.dc-token-list': tokens,
            '[data-pointer-note]': note,
          },
          { field: 'twakeDelegatedUsers' }
        );
        const select = stubSelect(users.base as string, '') as unknown as {
          closest(): unknown;
        };
        select.closest = (): unknown => field;
        const container = stubContainer() as unknown as {
          querySelector(selector: string): unknown;
          querySelectorAll(): unknown[];
        };
        container.querySelector = selector =>
          selector === '[data-field="twakeDelegatedUsers"]' ? field : null;
        container.querySelectorAll = (): unknown[] => [select];
        const form = new EntityForm({
          entity: {
            ...users,
            schema: {
              attributes: {
                uid: users.schema.attributes.uid,
                twakeDelegatedUsers: {
                  type: 'array',
                  items: { type: 'pointer', branch: [users.base as string] },
                },
              },
            },
          },
          entry: { uid: 'bob', twakeDelegatedUsers: [alice, bob] },
          translator,
          pointerOptions: () => Promise.reject(failure(500, 'Internal')),
          pointerSearch: (_branch, failed) => (failed ? search : undefined),
          onSubmit: () => Promise.resolve(),
          onCancel: () => undefined,
        });
        await form.render(container as unknown as HTMLElement);
        expect(field.innerHTML).to.include('data-picker="twakeDelegatedUsers"');

        // One click on the first token's button, bubbling from the token
        // list up to the field.
        const click = {
          target: { closest: () => ({ dataset: { remove: '0' } }) },
        };
        tokens.fire('click', click);
        field.fire('click', click);
        expect(
          (form as unknown as { values: Record<string, string[]> }).values
            .twakeDelegatedUsers
        ).to.deep.equal([bob]);
      });

      it('should build the form when the caller’s search throws', async () => {
        // Read as "no search": thrown from the constructor or from render,
        // it left the form half-built.
        const container = stubContainer();
        await new EntityForm({
          entity: users,
          entry: { uid: 'bob' },
          translator,
          pointerOptions: () => Promise.resolve([]),
          pointerSearch: () => {
            throw new Error('Not this branch');
          },
          onSubmit: () => Promise.resolve(),
          onCancel: () => undefined,
        }).render(container);
        expect(container.innerHTML).to.include(
          'data-pointer="dc=example,dc=com"'
        );
      });
    });

    it('should offer neither computed nor read-only attributes', async () => {
      const container = stubContainer();
      await build().render(container);
      expect(container.innerHTML).to.not.include('data-field="uid"');
      expect(container.innerHTML).to.not.include(
        'data-field="twakeDepartmentPath"'
      );
      expect(container.innerHTML).to.not.include('data-field="memberOf"');
      expect(container.innerHTML).to.include('data-field="mail"');
    });

    it('should show the hint under the field, not only on failure', async () => {
      const container = stubContainer();
      await build().render(container);
      expect(container.innerHTML).to.include('Expected pattern 999 9999');
      expect(container.innerHTML).to.include('Expected an email address');
    });

    it('should mark required fields and say what the mark means', async () => {
      const container = stubContainer();
      await build().render(container);
      expect(container.innerHTML).to.include('dc-required');
      expect(container.innerHTML).to.include(
        'Fields marked with * are required'
      );
    });

    it('should ask for a token list on a multi-valued attribute', async () => {
      const container = stubContainer();
      await build().render(container);
      expect(container.innerHTML).to.include(
        'data-tokens="mailAlternateAddress"'
      );
      expect(container.innerHTML).to.include('Press Enter to add a value');
    });

    it('should not offer the identifier for editing once it exists', async () => {
      const container = stubContainer();
      await build({ uid: 'jsmith', cn: 'John' }).render(container);
      expect(container.innerHTML).to.not.include('data-field="uid"');
    });

    it('should prefill a field from a value the directory answered in another case', async () => {
      // The schema spells the attribute `cn`; a directory that answered `CN`
      // instead used to leave the field blank on an entry that has a name.
      const container = stubContainer();
      await build({ uid: 'jsmith', CN: 'John Smith' }).render(container);
      expect(container.innerHTML).to.include('value="John Smith"');
    });

    it('should stay a modal while the form is short', () => {
      // Six editable fields: a dialog still fits on screen.
      expect(build().wantsPanel).to.be.false;
    });

    it('should become a panel when the form gets long', () => {
      const attributes: EntitySchema['attributes'] = {};
      for (let i = 0; i < 20; i++) attributes[`a${i}`] = { type: 'string' };
      const long: EntityDescriptor = { ...users, schema: { attributes } };
      expect(
        new EntityForm({
          entity: long,
          translator: new Translator('en'),
          pointerOptions: () => Promise.resolve([]),
          onSubmit: () => Promise.resolve(),
          onCancel: () => undefined,
        }).wantsPanel
      ).to.be.true;
    });

    it('should convert between the directory’s date and the browser’s', () => {
      expect(EntityForm.toDateInput('20240930220000Z')).to.equal('2024-09-30');
      expect(EntityForm.toDateInput('2024-09-30T22:00:00Z')).to.equal(
        '2024-09-30'
      );
      expect(EntityForm.toDateInput('nonsense')).to.equal('');
      expect(EntityForm.toDirectoryDate('2024-09-30')).to.equal(
        '20240930000000Z'
      );
      expect(EntityForm.toDirectoryDate('')).to.equal('');
    });
  });

  describe('EntityDetail', () => {
    const render = (entry: Record<string, string | string[]>): string => {
      const container = stubContainer();
      new EntityDetail({
        entity: users,
        entry,
        translator: new Translator('en'),
        canWrite: true,
        canDelete: true,
        onEdit: () => undefined,
        onDelete: () => undefined,
        onStatus: () => undefined,
        onResetPassword: () => undefined,
      }).render(container);
      return container.innerHTML;
    };

    it('should name attributes in the reader’s language', () => {
      const container = stubContainer();
      new EntityDetail({
        entity: users,
        entry: { uid: 'jsmith' },
        translator: new Translator('fr'),
        canWrite: true,
        canDelete: true,
        onEdit: () => undefined,
        onDelete: () => undefined,
        onStatus: () => undefined,
        onResetPassword: () => undefined,
      }).render(container);
      expect(container.innerHTML).to.include('Nom');
    });

    it('should translate the states it knows and keep the ones it does not', () => {
      const entity: EntityDescriptor = {
        ...users,
        schema: {
          attributes: {
            ...usersSchema.attributes,
            twakeAccountStatus: {
              type: 'pointer',
              role: 'accountStatus',
              states: { disabled: 'cn=disabled', seconded: 'cn=seconded' },
            },
          },
        },
      };
      const container = stubContainer();
      new EntityDetail({
        entity,
        entry: { uid: 'jsmith' },
        translator: new Translator('fr'),
        canWrite: true,
        canDelete: true,
        onEdit: () => undefined,
        onDelete: () => undefined,
        onStatus: () => undefined,
        onResetPassword: () => undefined,
      }).render(container);
      expect(container.innerHTML).to.include('>Désactivé<');
      // A state the deployment invented keeps the name the deployment gave it.
      expect(container.innerHTML).to.include('>seconded<');
    });

    it('should show every attribute, empty ones included', () => {
      const html = render({ uid: 'jsmith', cn: 'John Smith' });
      // The defect this replaces: a card showing two fields, the rest only
      // reachable by opening the edit dialog.
      expect(html).to.include('Name');
      expect(html).to.include('Telephone Number');
      expect(html).to.include('Twake Department Link');
    });

    it('should never show a write-only attribute', () => {
      expect(render({ uid: 'jsmith' })).to.not.include('userPassword');
    });

    it('should show a value the directory answered in another case than the schema’s', () => {
      // LDAP attribute names are case-insensitive (RFC 4512); a directory
      // that answers `MAIL` where the schema says `mail` still has the value,
      // and the card used to show it empty. The title, read from the schema's
      // `mainAttribute` (`uid`), is affected the same way.
      const html = render({ UID: 'jsmith', MAIL: 'jsmith@example.com' });
      expect(html).to.include('<h2>jsmith</h2>');
      expect(html).to.include('jsmith@example.com');
    });

    it('should offer the states the schema declares, and no others', () => {
      const html = render({ uid: 'jsmith' });
      expect(html).to.include('value="enabled"');
      expect(html).to.include('value="disabled"');
      expect(html).to.not.include('value="retired"');
    });

    it('should hide every action from a reader', () => {
      const container = stubContainer();
      new EntityDetail({
        entity: users,
        entry: { uid: 'jsmith' },
        translator: new Translator('en'),
        canWrite: false,
        canDelete: false,
        onEdit: () => undefined,
        onDelete: () => undefined,
        onStatus: () => undefined,
        onResetPassword: () => undefined,
      }).render(container);
      expect(container.innerHTML).to.not.include('data-edit');
      expect(container.innerHTML).to.not.include('data-delete');
      expect(container.innerHTML).to.not.include('data-status');
      expect(container.innerHTML).to.not.include('data-password');
    });

    it('should escape what the directory holds', () => {
      const html = render({ uid: '<script>alert(1)</script>' });
      expect(html).to.not.include('<script>alert(1)</script>');
      expect(html).to.include('&lt;script&gt;');
    });
  });
});
