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

import {
  ConsoleApiClient,
  attachedEntry,
  isDomainBranch,
  isLarge,
} from '../src/api/ConsoleApiClient';
import { signInAgain } from '../src/session';
import {
  DirectoryConsole,
  ToastController,
  claimRoots,
  createdEntryId,
  listLoader,
  readFailure,
  scopeRestricts,
  splitEntities,
  transitState,
  writesEntry,
} from '../src/DirectoryConsole';
import {
  attributeLabel,
  displayValue,
  escapeDnValue,
  isDnShaped,
  pointerLabel,
  rdnValue,
  resolveText,
} from '../src/format';
import {
  AttachedTables,
  attachedClass,
} from '../src/components/AttachedTables';
import { EntityDetail } from '../src/components/EntityDetail';
import { EntityForm, pointerFallback } from '../src/components/EntityForm';
import { EntityImport } from '../src/components/EntityImport';
import { GroupPicker } from '../src/components/GroupPicker';
import {
  EntityList,
  LIST_LIMIT,
  csvCell,
  listFailure,
  type ListView,
} from '../src/components/EntityList';
import { OrganizationTree } from '../src/components/OrganizationTree';
import { availableLanguages, languageName, Translator } from '../src/i18n';
import {
  accountState,
  beforeToday,
  explainRefusal,
  formatByteSize,
  nameAttributes,
  parseByteSize,
  readableByteSize,
  stateMarkup,
} from '../src/format';
import type { Confirmation } from '../src/DirectoryConsole';
import type {
  EntityDescriptor,
  EntitySchema,
  Entry,
  EntryList,
  ExternalMembers,
  SchemaAttribute,
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

/**
 * A console drawn into a container that answers each selector with the
 * element given for it: enough for an action that writes into the shell.
 */
function consoleIn(
  elements: Record<string, unknown>,
  language = 'en'
): DirectoryConsole {
  const app = new DirectoryConsole({
    containerId: 'console',
    apiBaseUrl: baseUrl,
    language,
  });
  (app as unknown as { container: unknown }).container = {
    querySelector: (selector: string) => elements[selector] ?? null,
    querySelectorAll: () => [],
  };
  return app;
}

/** A toast element, which records the last message it was given. */
function toastElement(): { textContent: string } {
  return {
    textContent: '',
    hidden: true,
    onclick: null,
    classList: { toggle: () => undefined },
  } as unknown as { textContent: string };
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

/** Groups as the Twake schema has them: attached to the organization tree. */
const twakeGroups: EntityDescriptor = {
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

    it('should name its buttons after their organization, and expose the selected one', async () => {
      const container = treeContainer();
      const tree = new OrganizationTree({
        translator: new Translator('en'),
        root: async () => ({ dn: top, name: 'organization' }),
        children: async () => [{ dn: sales, name: 'Sales' }],
        onSelect: () => undefined,
        onCreateChild: () => undefined,
      });
      await tree.render(container);
      tree.select(sales);
      const html = container.list.innerHTML.replace(/\s+/g, ' ');
      expect(html)
        .to.include('aria-expanded="true" aria-label="Collapse organization"')
        .and.include('aria-expanded="false" aria-label="Expand Sales"')
        .and.include('aria-label="New organization under Sales"');
      expect(html).to.match(
        /data-select="ou=Sales,[^"]*" aria-current="true" title="[^"]*">Sales</
      );
      expect(html).to.not.match(
        /data-select="ou=organization,[^"]*" aria-current/
      );
    });

    it('should say when the filter hides every opened organization', async () => {
      const container = treeContainer();
      await new OrganizationTree({
        translator: new Translator('en'),
        root: async () => ({ dn: top, name: 'organization' }),
        children: async () => [{ dn: sales, name: 'Sales' }],
        onSelect: () => undefined,
      }).render(container);
      container.filter.value = 'zzz';
      container.filter.fire();
      expect(container.list.innerHTML)
        .to.include('No organization matches “zzz”')
        .and.not.include('dc-tree-list');
      // Cleared, the tree is back.
      container.filter.value = '';
      container.filter.fire();
      expect(container.list.innerHTML).to.include('>Sales</button>');
    });
  });

  describe('OrganizationTree, searching the whole tree', () => {
    const top = 'ou=organization,dc=example,dc=com';
    const sales = `ou=Sales,${top}`;
    const france = `ou=France,${sales}`;
    const settle = (): Promise<void> =>
      new Promise(resolve => setImmediate(resolve));
    const options = (asked: string[], selected: string[] = []) => ({
      translator: new Translator('en'),
      root: async () => ({ dn: top, name: 'organization' }),
      children: async (dn: string) => {
        asked.push(dn);
        if (dn === top) return [{ dn: sales, name: 'Sales' }];
        if (dn === sales) return [{ dn: france, name: 'France' }];
        return [];
      },
      onSelect: (node: { dn: string }) => {
        selected.push(node.dn);
      },
      everywhere: async () => ({
        organizations: [
          { dn: top, label: 'organization' },
          { dn: sales, label: 'Sales' },
          { dn: france, label: 'Sales / France' },
        ],
        partial: false,
      }),
    });
    type Hidden = {
      choose(dn: string, label: string): Promise<void>;
      pick(dn: string): Promise<void>;
    };

    it('should find an organization under a branch never opened', async () => {
      const asked: string[] = [];
      const selected: string[] = [];
      const container = treeContainer();
      const tree = new OrganizationTree(options(asked, selected));
      await tree.render(container);
      container.filter.value = 'Fra';
      container.filter.fire();
      await settle();
      expect(container.list.innerHTML)
        .to.include(`data-found="${france}"`)
        .and.include('>Sales &#x2F; France</button>')
        .and.not.include('data-select');
      expect(asked).to.deep.equal([top]);

      // Chosen, it is shown in the tree, opened down to it, and selected.
      await (tree as unknown as Hidden).choose(france, 'Sales / France');
      expect(container.filter.value).to.equal('');
      expect(selected).to.deep.equal([france]);
      expect(container.list.innerHTML).to.match(
        /dc-selected[^]*?data-select="ou=France,ou=Sales,/
      );
    });

    it('should say when no organization of the whole tree matches', async () => {
      const container = treeContainer();
      await new OrganizationTree(options([])).render(container);
      container.filter.value = 'zzz';
      container.filter.fire();
      await settle();
      expect(container.list.innerHTML)
        .to.include('No organization matches “zzz”')
        .and.not.include('among the opened branches');
    });

    it('should read the whole tree once, and again once a branch changed', async () => {
      let reads = 0;
      const container = treeContainer();
      const tree = new OrganizationTree({
        ...options([]),
        everywhere: async () => {
          reads++;
          return {
            organizations: [{ dn: sales, label: 'Sales' }],
            partial: false,
          };
        },
      });
      await tree.render(container);
      for (const typed of ['Sa', 'Sal', 'S', 'Sa']) {
        container.filter.value = typed;
        container.filter.fire();
        await settle();
      }
      expect(reads).to.equal(1);
      await tree.refresh();
      await settle();
      expect(reads).to.equal(2);
    });

    it('should filter the opened branches when the whole tree cannot be read', async () => {
      const container = treeContainer();
      await new OrganizationTree({
        ...options([]),
        everywhere: async () => {
          throw new Error('refused');
        },
      }).render(container);
      container.filter.value = 'Sal';
      container.filter.fire();
      await settle();
      expect(container.list.innerHTML).to.include('>Sales</button>');
    });

    it('should open a node when it is selected', async () => {
      const asked: string[] = [];
      const selected: string[] = [];
      const container = treeContainer();
      const tree = new OrganizationTree(options(asked, selected));
      await tree.render(container);
      await (tree as unknown as Hidden).pick(sales);
      expect(selected).to.deep.equal([sales]);
      expect(asked).to.deep.equal([top, sales]);
      expect(container.list.innerHTML)
        .to.include('aria-label="Collapse Sales"')
        .and.include('>France</button>');
      // Selected again, it stays open.
      await (tree as unknown as Hidden).pick(sales);
      expect(container.list.innerHTML).to.include('>France</button>');
    });

    it('should not say a selected leaf is expanded', async () => {
      const container = treeContainer();
      const tree = new OrganizationTree(options([]));
      await tree.render(container);
      await (tree as unknown as Hidden).pick(sales);
      await (tree as unknown as Hidden).pick(france);
      const html = container.list.innerHTML.replace(/\s+/g, ' ');
      expect(html).to.match(
        /data-toggle="ou=France,[^"]*" disabled aria-label="France has no sub-organization"/
      );
      expect(html).to.include(
        'aria-expanded="true" aria-label="Collapse Sales"'
      );
    });

    it('should leave a branch whose children could not be read to be opened again', async () => {
      let refuse = true;
      const asked: string[] = [];
      const container = treeContainer();
      const tree = new OrganizationTree({
        ...options(asked),
        children: async (dn: string) => {
          asked.push(dn);
          if (dn === top) return [{ dn: sales, name: 'Sales' }];
          if (refuse) throw new Error('Service Unavailable');
          return [{ dn: france, name: 'France' }];
        },
      });
      await tree.render(container);
      await (tree as unknown as Hidden).pick(sales);
      // Not taken for a leaf: closed, and still offered to open.
      expect(container.list.innerHTML.replace(/\s+/g, ' ')).to.include(
        'aria-expanded="false" aria-label="Expand Sales"'
      );
      refuse = false;
      await (tree as unknown as Hidden).pick(sales);
      expect(asked).to.deep.equal([top, sales, sales]);
      expect(container.list.innerHTML).to.include('>France</button>');
    });

    it('should merge the opened branches into a walk cut short, and hedge its "no match"', async () => {
      const container = treeContainer();
      const tree = new OrganizationTree({
        ...options([]),
        // The walk stopped before France, which an opened branch holds.
        everywhere: async () => ({
          organizations: [{ dn: top, label: 'organization' }],
          partial: true,
        }),
      });
      await tree.render(container);
      await (tree as unknown as Hidden).pick(sales);
      container.filter.value = 'Fra';
      container.filter.fire();
      await settle();
      expect(container.list.innerHTML).to.include(`data-found="${france}"`);
      container.filter.value = 'zzz';
      container.filter.fire();
      await settle();
      expect(container.list.innerHTML).to.include(
        'No organization matches “zzz” among the opened branches'
      );
    });

    it('should not deny a match an opened branch holds when the walk could not read that branch', async () => {
      const client = new ConsoleApiClient(baseUrl);
      // The walk fails on Sales, which the tree read when it was opened.
      Object.assign(client, {
        organizationTop: async () => ({ dn: top, name: 'organization' }),
        subnodes: async (dn: string) => {
          if (dn === top) return [{ dn: sales, ou: 'Sales' }];
          throw Object.assign(new Error('Service Unavailable'), {
            status: 503,
          });
        },
      });
      const container = treeContainer();
      const tree = new OrganizationTree({
        ...options([]),
        everywhere: () => client.organizationWalk(),
      });
      await tree.render(container);
      await (tree as unknown as Hidden).pick(sales);
      container.filter.value = 'Fra';
      container.filter.fire();
      await settle();
      expect(container.list.innerHTML).to.include(`data-found="${france}"`);
      container.filter.value = 'zzz';
      container.filter.fire();
      await settle();
      expect(container.list.innerHTML).to.include(
        'No organization matches “zzz” among the opened branches'
      );
    });

    it('should read the whole tree again in the next view after a failure, hedging meanwhile', async () => {
      let reads = 0;
      const container = treeContainer();
      const everywhere = async () => {
        reads++;
        if (reads === 1) throw new Error('refused');
        return {
          organizations: [{ dn: france, label: 'Sales / France' }],
          partial: false,
        };
      };
      const first = new OrganizationTree({ ...options([]), everywhere });
      await first.render(container);
      container.filter.value = 'zzz';
      container.filter.fire();
      await settle();
      expect(container.list.innerHTML).to.include(
        'No organization matches “zzz” among the opened branches'
      );
      const again = treeContainer();
      const second = new OrganizationTree(
        { ...options([]), everywhere },
        first
      );
      await second.render(again);
      await settle();
      again.filter.value = 'Fra';
      again.filter.fire();
      await settle();
      expect(reads).to.equal(2);
      expect(again.list.innerHTML).to.include(`data-found="${france}"`);
    });

    it('should ask the server once the typing pauses, keeping only the answer to the last text', async () => {
      const pause = (): Promise<void> =>
        new Promise(resolve => setTimeout(resolve, 300));
      const searched: [string, string][] = [];
      const answers = new Map<
        string,
        (found: {
          organizations: { dn: string; label: string }[];
          truncated: boolean;
        }) => void
      >();
      let walks = 0;
      const container = treeContainer();
      await new OrganizationTree({
        ...options([]),
        everywhere: async () => {
          walks++;
          return { organizations: [], partial: false };
        },
        search: (query: string, root: string) => {
          searched.push([query, root]);
          return new Promise(resolve => answers.set(query, resolve));
        },
      }).render(container);
      // Typed in one go: one request.
      for (const typed of ['Sa', 'Sal']) {
        container.filter.value = typed;
        container.filter.fire();
      }
      await pause();
      expect(searched).to.deep.equal([['Sal', top]]);
      expect(container.list.innerHTML).to.include('Loading');
      // Typed on while it is under way: its answer, late, is dropped.
      container.filter.value = 'Fra';
      container.filter.fire();
      await pause();
      answers.get('Fra')?.({
        organizations: [{ dn: france, label: 'Sales / France' }],
        truncated: false,
      });
      await settle();
      answers.get('Sal')?.({
        organizations: [{ dn: sales, label: 'Sales' }],
        truncated: false,
      });
      await settle();
      expect(container.list.innerHTML)
        .to.include(`data-found="${france}"`)
        .and.not.include(`data-found="${sales}"`)
        // A whole answer is not said to be cut.
        .and.not.include('dc-tree-cut');
      expect(walks).to.equal(0);

      // Its "no match" is the whole tree's; a failure leaves the opened
      // branches, hedged.
      container.filter.value = 'zzz';
      container.filter.fire();
      await pause();
      answers.get('zzz')?.({ organizations: [], truncated: false });
      await settle();
      expect(container.list.innerHTML)
        .to.include('No organization matches “zzz”')
        .and.not.include('among the opened branches');
      container.filter.value = 'yyy';
      container.filter.fire();
      await pause();
      expect(searched.map(([query]) => query)).to.deep.equal([
        'Sal',
        'Fra',
        'zzz',
        'yyy',
      ]);
    });

    it('should say when the server kept only the first matches', async () => {
      const container = treeContainer();
      await new OrganizationTree({
        ...options([]),
        search: async () => ({
          organizations: [
            { dn: france, label: 'Sales / France' },
            { dn: sales, label: 'Sales' },
          ],
          truncated: true,
        }),
      }).render(container);
      container.filter.value = 'Sa';
      container.filter.fire();
      await new Promise(resolve => setTimeout(resolve, 300));
      await settle();
      expect(container.list.innerHTML)
        .to.include(`data-found="${france}"`)
        .and.include(`data-found="${sales}"`)
        .and.include(
          '<p class="dc-tree-cut">First 2 matches — type more to narrow</p>'
        )
        .and.not.include('No organization matches');
    });

    it('should show the opened branches, hedged, when the server search fails', async () => {
      const container = treeContainer();
      await new OrganizationTree({
        ...options([]),
        search: async () => {
          throw new Error('Service Unavailable');
        },
      }).render(container);
      container.filter.value = 'Sal';
      container.filter.fire();
      await new Promise(resolve => setTimeout(resolve, 300));
      await settle();
      expect(container.list.innerHTML).to.include('>Sales</button>');
      container.filter.value = 'zzz';
      container.filter.fire();
      await new Promise(resolve => setTimeout(resolve, 300));
      await settle();
      expect(container.list.innerHTML).to.include(
        'No organization matches “zzz” among the opened branches'
      );
    });
  });

  describe('the organization tree, between views', () => {
    const top = 'ou=organization,dc=example,dc=com';
    const sales = `ou=Sales,${top}`;
    const engineering = `ou=Engineering,${top}`;
    const backend = `ou=Backend,${engineering}`;
    const lyon = `ou=Lyon,${engineering}`;
    const organizations: EntityDescriptor = {
      key: 'organizations',
      pluralName: 'organizations',
      singularName: 'organization',
      mainAttribute: 'ou',
      base: top,
      schema: {
        attributes: {
          ou: { type: 'string', role: 'identifier' },
          description: { type: 'string' },
        },
      },
      endpoint: '/api/v1/ldap/organizations',
      kind: 'organization',
    };
    /** The DN of the node drawn as selected, if any. */
    const selected = (html: string): string | undefined =>
      /dc-selected[^]*?data-select="([^"]*)"/.exec(html)?.[1];
    /** Whether a node is drawn open. */
    const open = (html: string, dn: string): boolean =>
      html
        .replace(/\s+/g, ' ')
        .includes(`data-toggle="${dn}" aria-expanded="true"`);

    /**
     * A console on the organization view, its server a few organizations
     * deep, its address a stub that records what was pushed into it.
     */
    const setup = () => {
      const children: Record<string, { dn: string; name: string }[]> = {
        [top]: [
          { dn: sales, name: 'Sales' },
          { dn: engineering, name: 'Engineering' },
        ],
        [sales]: [],
        [engineering]: [{ dn: backend, name: 'Backend' }],
        [backend]: [],
        [lyon]: [],
      };
      const asked: string[] = [];
      const read: string[] = [];
      const trees: (HTMLElement & TreeContainer)[] = [];
      const main = {
        set innerHTML(_html: string) {
          trees.push(treeContainer());
        },
        querySelector: (selector: string) =>
          selector === '[data-tree]' ? trees[trees.length - 1] : null,
      };
      const app = consoleIn({
        '[data-main]': main,
        '[data-org-detail]': stubContainer(),
        '[data-toast]': toastElement(),
      });
      Object.assign(app as unknown as { entities: EntityDescriptor[] }, {
        entities: [organizations],
        confirmAction: async () => true,
      });
      Object.assign((app as unknown as { api: object }).api, {
        organizationTop: async () => ({ dn: top, name: 'organization' }),
        organizationChildren: async (dn: string) => {
          asked.push(dn);
          return children[dn].map(child => ({ ...child }));
        },
        organization: async (dn: string) => {
          read.push(dn);
          return { dn, ou: rdnValue(dn) };
        },
        organizationMembers: async () => ({ entries: [], truncated: false }),
        updateOrganization: async () => undefined,
        createOrganization: async () => {
          children[engineering].push({ dn: lyon, name: 'Lyon' });
        },
        deleteOrganization: async () => undefined,
      });
      const location = { hash: '#/organizations' };
      const pushed: string[] = [];
      const replaced: string[] = [];
      const g = globalThis as Record<string, unknown>;
      const original = g.window;
      g.window = {
        location,
        history: {
          pushState: (_state: unknown, _title: string, hash: string) => {
            pushed.push(hash);
            location.hash = hash;
          },
          replaceState: (_state: unknown, _title: string, hash: string) => {
            replaced.push(hash);
            location.hash = hash;
          },
        },
      };
      return {
        app: app as unknown as {
          tree: {
            options: { onSelect(node: { dn: string; name: string }): void };
            toggle(dn: string): Promise<void>;
          };
          route: { id?: string };
          followHash(): Promise<void>;
          submitOrganization(
            entity: EntityDescriptor,
            values: Record<string, string | string[]>,
            cleared: string[],
            entry?: Entry,
            parentDn?: string
          ): Promise<void>;
          confirmDeleteOrganization(
            entity: EntityDescriptor,
            entry: Entry,
            dn: string
          ): Promise<void>;
        },
        location,
        asked,
        read,
        pushed,
        replaced,
        tree: (): string => trees[trees.length - 1].innerHTML,
        restore: () => {
          g.window = original;
        },
      };
    };

    it('should open the tree down to the organization an address names', async () => {
      // The Department path link of an account's card leads here: the card
      // showed, but the tree stayed folded and nothing in it was selected.
      const { app, location, asked, read, tree, restore } = setup();
      try {
        location.hash = `#/organizations/${encodeURIComponent(backend)}`;
        await app.followHash();
      } finally {
        restore();
      }
      expect(asked).to.deep.equal([top, engineering]);
      expect(open(tree(), engineering)).to.be.true;
      expect(selected(tree())).to.equal(backend);
      expect(read).to.deep.equal([backend]);
    });

    it('should name a node picked in the tree in the address, without drawing the view again', async () => {
      const { app, pushed, read, tree, restore } = setup();
      try {
        await app.followHash();
        const before = tree();
        app.tree.options.onSelect({ dn: sales, name: 'Sales' });
        expect(pushed).to.deep.equal([
          `#/organizations/${encodeURIComponent(sales)}`,
        ]);
        expect(app.route.id).to.equal(sales);
        // The same tree, not one drawn anew: only the card is read.
        expect(tree()).to.equal(before);
        expect(read).to.deep.equal([sales]);
      } finally {
        restore();
      }
    });

    it('should keep the tree open and the organization on screen after a save', async () => {
      const { app, asked, read, tree, restore } = setup();
      try {
        await app.followHash();
        await app.tree.toggle(engineering);
        app.tree.options.onSelect({ dn: backend, name: 'Backend' });
        asked.length = 0;
        read.length = 0;
        await app.submitOrganization(
          organizations,
          { description: 'Servers' },
          [],
          { dn: backend, ou: 'Backend' }
        );
      } finally {
        restore();
      }
      // Its parent is read again for a changed name, and nothing else.
      expect(asked).to.deep.equal([engineering]);
      expect(open(tree(), engineering)).to.be.true;
      expect(selected(tree())).to.equal(backend);
      expect(read).to.deep.equal([backend]);
    });

    it('should show and select an organization just created where it was created', async () => {
      const { app, pushed, read, tree, restore } = setup();
      try {
        await app.followHash();
        await app.tree.toggle(engineering);
        await app.submitOrganization(
          organizations,
          { ou: 'Lyon' },
          [],
          undefined,
          engineering
        );
      } finally {
        restore();
      }
      expect(pushed).to.deep.equal([
        `#/organizations/${encodeURIComponent(lyon)}`,
      ]);
      expect(open(tree(), engineering)).to.be.true;
      expect(tree()).to.include('>Lyon</button>');
      expect(selected(tree())).to.equal(lyon);
      expect(read).to.deep.equal([lyon]);
    });

    it('should select the parent of an organization just deleted', async () => {
      const { app, location, replaced, read, tree, restore } = setup();
      try {
        location.hash = `#/organizations/${encodeURIComponent(backend)}`;
        await app.followHash();
        read.length = 0;
        await app.confirmDeleteOrganization(
          organizations,
          { dn: backend, ou: 'Backend' },
          backend
        );
      } finally {
        restore();
      }
      expect(replaced).to.deep.equal([
        `#/organizations/${encodeURIComponent(engineering)}`,
      ]);
      expect(selected(tree())).to.equal(engineering);
      expect(read).to.deep.equal([engineering]);
    });

    /** The nodes drawn with a "+". */
    const adds = (html: string): string[] =>
      [...html.matchAll(/data-add="([^"]*)"/g)].map(match => match[1]);

    it('should offer a "+" only where a restricted administrator writes', async () => {
      // The tree is drawn from the root, and its "+" there ended in a 403 for
      // an administrator of a branch below it.
      const { app, tree, restore } = setup();
      (app as unknown as { scope: Scope }).scope = {
        user: 'alice',
        unrestricted: false,
        described: true,
        branches: [
          { dn: top, name: 'organization', read: true },
          {
            dn: 'ou=engineering, OU=Organization,dc=example,dc=com',
            name: 'Engineering',
            read: true,
            write: true,
          },
        ],
        entities: [{ name: 'organizations', base: top, create: false }],
      };
      try {
        await app.followHash();
        expect(adds(tree())).to.deep.equal([engineering]);
        await app.tree.toggle(engineering);
        expect(adds(tree())).to.deep.equal([engineering, backend]);
      } finally {
        restore();
      }
    });

    it('should offer a "+" on every node when the scope restricts nothing', async () => {
      const { app, tree, restore } = setup();
      (app as unknown as { scope: Scope }).scope = {
        user: 'admin',
        unrestricted: true,
        branches: [],
        entities: [],
      };
      try {
        await app.followHash();
        expect(adds(tree())).to.deep.equal([top, sales, engineering]);
      } finally {
        restore();
      }
    });

    it('should offer a "+" on every node to a branch written above the root', async () => {
      // An administrator of the whole directory writes no organization as
      // such: the "+" disappeared from the tree altogether.
      const { app, tree, restore } = setup();
      (app as unknown as { scope: Scope }).scope = {
        user: 'admin',
        unrestricted: false,
        described: true,
        branches: [{ dn: 'dc=example,dc=com', read: true, write: true }],
        entities: [{ name: 'organizations', base: top, create: true }],
      };
      try {
        await app.followHash();
        expect(adds(tree())).to.deep.equal([top, sales, engineering]);
      } finally {
        restore();
      }
    });
  });

  describe('creating an organization from the overview', () => {
    const top = 'ou=organization,dc=example,dc=com';
    const government = `ou=Government of Mongolia,${top}`;
    const ministry = `ou=Ministry of Health,${top}`;
    const transit = `ou=Transit,${top}`;
    const organizations: EntityDescriptor = {
      key: 'organizations',
      pluralName: 'organizations',
      singularName: 'organization',
      mainAttribute: 'ou',
      base: top,
      schema: {
        attributes: {
          ou: { type: 'string', role: 'identifier' },
          description: { type: 'string' },
        },
      },
      endpoint: '/api/v1/ldap/organizations',
      kind: 'organization',
    };
    const scope = (over: Partial<Scope>): Scope => ({
      user: 'alice',
      unrestricted: false,
      described: true,
      branches: [],
      entities: [{ name: 'organizations', base: top, create: false }],
      transit,
      ...over,
    });
    const writes = (dn: string, path?: string): Scope['branches'][number] => ({
      dn,
      name: rdnValue(dn),
      path,
      read: true,
      write: true,
    });

    /**
     * A console on the overview, its panel just real enough to hold the
     * organization form, and its server recording the creations.
     */
    const setup = (granted: Scope) => {
      const main = { innerHTML: '', querySelectorAll: () => [] };
      let submit: ((event: unknown) => void) | undefined;
      const form = {
        addEventListener: (
          type: string,
          callback: (event: unknown) => void
        ) => {
          if (type === 'submit') submit = callback;
        },
      };
      const holder = {
        innerHTML: '',
        querySelector: (selector: string) =>
          selector === 'form' ? form : null,
        querySelectorAll: () => [],
      };
      const picker = { value: '' };
      const body = {
        innerHTML: '',
        querySelector: (selector: string) =>
          selector === '#dc-organization-parent'
            ? picker
            : selector === '[data-organization-form]'
              ? holder
              : selector === 'form'
                ? form
                : null,
        querySelectorAll: () => [],
      };
      const app = consoleIn({
        '[data-main]': main,
        '[data-panel]': {
          hidden: true,
          classList: { toggle: () => undefined },
        },
        '[data-panel-title]': { textContent: '' },
        '[data-panel-body]': body,
        '[data-toast]': toastElement(),
      });
      Object.assign(app, {
        entities: [organizations],
        scope: granted,
        renderMain: async () => undefined,
      });
      const created: (string | undefined)[] = [];
      Object.assign((app as unknown as { api: object }).api, {
        createOrganization: async (_values: unknown, parentDn?: string) => {
          created.push(parentDn);
        },
      });
      const views = app as unknown as {
        renderDashboard(main: unknown): void;
        openForm(entity: EntityDescriptor): Promise<void>;
      };
      return {
        dashboard: (): string => {
          views.renderDashboard(main);
          return main.innerHTML;
        },
        open: () => views.openForm(organizations),
        submit: async (): Promise<void> => {
          submit?.({ preventDefault: () => undefined });
          await new Promise(resolve => setImmediate(resolve));
        },
        body,
        picker,
        created,
      };
    };

    it('should create under the one branch a restricted administrator writes', async () => {
      // A global administrator appointed below the root read "Creation not
      // allowed here", though the server takes the organization under their
      // branch.
      const { dashboard, open, submit, body, created } = setup(
        scope({ branches: [writes(government), writes(transit)] })
      );
      expect(dashboard())
        .to.include('data-new="organizations"')
        .and.not.include('Creation not allowed here');
      await open();
      expect(body.innerHTML).to.not.include('dc-organization-parent');
      await submit();
      expect(created).to.deep.equal([government]);
    });

    it('should let an administrator of several branches pick the parent', async () => {
      const { dashboard, open, submit, body, picker, created } = setup(
        scope({
          branches: [
            writes(ministry, 'Ministry of Health'),
            writes(government, 'Government of Mongolia'),
            writes(transit),
          ],
        })
      );
      expect(dashboard()).to.include('data-new="organizations"');
      await open();
      // Sorted by name, the transit branch left out.
      const options = [...body.innerHTML.matchAll(/<option value="([^"]*)"/g)];
      expect(options.map(match => match[1])).to.deep.equal([
        government,
        ministry,
      ]);
      expect(body.innerHTML).to.include('Parent organization');
      picker.value = ministry;
      await submit();
      expect(created).to.deep.equal([ministry]);
    });

    it('should name the parent, not the new organization, when creating under it is refused', async () => {
      const toasts: string[] = [];
      const app = consoleIn({});
      Object.assign(app, {
        entities: [organizations],
        scope: scope({
          branches: [
            writes(ministry, 'Ministry of Health'),
            writes(government, 'Government of Mongolia'),
          ],
        }),
        toast: (message: string) => toasts.push(message),
      });
      Object.assign((app as unknown as { api: object }).api, {
        createOrganization: () =>
          Promise.reject(
            Object.assign(
              new Error('Token does not have permission on this branch'),
              { status: 403, refusal: { code: 'forbidden' } }
            )
          ),
      });
      await (
        app as unknown as {
          submitOrganization(
            entity: EntityDescriptor,
            values: Record<string, string>,
            cleared: string[],
            entry?: Entry,
            parentDn?: string
          ): Promise<void>;
        }
      ).submitOrganization(
        organizations,
        { ou: 'QA Lab' },
        [],
        undefined,
        ministry
      );
      expect(toasts).to.deep.equal([
        'You do not administer Ministry of Health: this change is not yours to make.',
      ]);
    });

    it('should create at the root, without a picker, where the scope allows it', async () => {
      const { dashboard, open, submit, body, created } = setup(
        scope({
          branches: [writes(top), writes(government)],
          entities: [{ name: 'organizations', base: top, create: true }],
        })
      );
      expect(dashboard()).to.include('data-new="organizations"');
      await open();
      expect(body.innerHTML).to.not.include('dc-organization-parent');
      await submit();
      expect(created).to.deep.equal([undefined]);
    });

    it('should still refuse a creation to an administrator writing no organization', () => {
      const { dashboard } = setup(
        scope({
          branches: [
            { dn: government, name: 'Government of Mongolia', read: true },
            writes(transit),
            writes('ou=users,dc=example,dc=com'),
          ],
        })
      );
      expect(dashboard())
        .to.include('Creation not allowed here')
        .and.not.include('data-new="organizations"');
    });
  });

  describe('pointers named by the entry they land on', () => {
    const top = 'ou=organization,dc=example,dc=com';
    const domainsBase = 'ou=domains,ou=nomenclature,dc=example,dc=com';
    const sales = `dc=sales,dc=example,dc=org,${domainsBase}`;
    const acme = `ou=Acme,${top}`;
    const organizations: EntityDescriptor = {
      key: 'organizations',
      pluralName: 'organizations',
      singularName: 'organization',
      mainAttribute: 'ou',
      base: top,
      schema: {
        attributes: {
          ou: { type: 'string', role: 'identifier' },
          twakeDomainLink: {
            type: 'array',
            items: { type: 'pointer', branch: [domainsBase] },
            label: { en: 'Mail domains' },
          },
        },
      },
      endpoint: '/api/v1/ldap/organizations',
      kind: 'organization',
    };
    const domains: EntityDescriptor = {
      key: 'domains',
      pluralName: 'domains',
      singularName: 'domain',
      mainAttribute: 'dc',
      base: domainsBase,
      schema: {
        attributes: {
          dc: { type: 'string', role: 'identifier' },
          associatedDomain: {
            type: 'string',
            role: ['domainName', 'displayName'],
          },
        },
      },
      endpoint: '/api/v1/ldap/domains',
      kind: 'flat',
    };

    /** An organization card, its domains branch answering `options`. */
    const card = async (
      options: () => Promise<{ dn: string; label: string }[]>
    ): Promise<string> => {
      const holder = stubContainer();
      const app = consoleIn({ '[data-org-detail]': holder });
      Object.assign(app as unknown as { entities: EntityDescriptor[] }, {
        entities: [organizations, domains],
      });
      Object.assign((app as unknown as { api: object }).api, {
        organization: async (dn: string) => ({
          dn,
          ou: 'Acme',
          twakeDomainLink: [sales],
        }),
        organizationMembers: async () => ({ entries: [], truncated: false }),
        pointerOptions: options,
      });
      await (
        app as unknown as {
          showOrganization(node: { dn: string; name: string }): Promise<void>;
        }
      ).showOrganization({ dn: acme, name: 'Acme' });
      return holder.innerHTML;
    };

    it('should name a mail domain on a card the way the select does', async () => {
      // The card read `sales`, the RDN, where the form's select offered
      // `sales.example.org` (#57).
      const html = await card(async () => [
        { dn: sales, label: 'sales.example.org' },
      ]);
      expect(html).to.include(`title="${sales}">sales.example.org<`);
    });

    it('should fall back on the RDN when the branch cannot be read', async () => {
      const html = await card(() => Promise.reject(new Error('Forbidden')));
      expect(html).to.include(`title="${sales}">sales<`);
    });

    it('should not leave the tab named after the organization shown before one that fails to load', async () => {
      const original = (globalThis as Record<string, unknown>).document;
      const page = { title: 'Sales — Twake Directory Manager' };
      (globalThis as Record<string, unknown>).document = page;
      try {
        const app = consoleIn({ '[data-org-detail]': stubContainer() });
        Object.assign(app as unknown as { entities: EntityDescriptor[] }, {
          entities: [organizations],
          pageTitle: 'Twake Directory Manager',
        });
        Object.assign((app as unknown as { api: object }).api, {
          organization: () => Promise.reject(new Error('Service Unavailable')),
        });
        await (
          app as unknown as {
            showOrganization(node: { dn: string; name: string }): Promise<void>;
          }
        ).showOrganization({ dn: acme, name: 'Acme' });
        expect(page.title).to.equal('Twake Directory Manager');
      } finally {
        (globalThis as Record<string, unknown>).document = original;
      }
    });

    it('should say an address that names no DN names no organization', async () => {
      // `#/organizations/zzz` read the server's "zzz is not a valid DN", in
      // English and red, where any other unknown entry is simply not there.
      const shown = async (
        dn: string,
        language = 'en'
      ): Promise<{ html: string; asked: string[] }> => {
        const holder = stubContainer();
        const asked: string[] = [];
        const app = consoleIn({ '[data-org-detail]': holder }, language);
        Object.assign(app as unknown as { entities: EntityDescriptor[] }, {
          entities: [organizations],
        });
        Object.assign((app as unknown as { api: object }).api, {
          organization: (asking: string) => {
            asked.push(asking);
            return Promise.reject(
              Object.assign(new Error(`${asking} is not a valid DN`), {
                status: 400,
              })
            );
          },
        });
        await (
          app as unknown as {
            showOrganization(node: { dn: string; name: string }): Promise<void>;
          }
        ).showOrganization({ dn, name: dn });
        return { html: holder.innerHTML, asked };
      };
      expect(await shown('zzz')).to.deep.equal({
        html: '<p class="dc-empty">This entry no longer exists</p>',
        asked: [],
      });
      expect((await shown('ou=', 'fr')).html).to.equal(
        '<p class="dc-empty">Cette entrée n’existe plus</p>'
      );
      // A DN refused all the same is a failure to say as one: a proxy may
      // answer 400 to a real DN, which is no reason to call it gone.
      expect(await shown(acme)).to.deep.equal({
        html: `<p class="dc-empty dc-error-block">${acme} is not a valid DN</p>`,
        asked: [acme],
      });
    });
  });

  describe('the people and the groups of an organization', () => {
    const top = 'ou=organization,dc=example,dc=com';
    const sales = `ou=Sales,${top}`;
    const france = `ou=France,${sales}`;
    const transit = `ou=Transit,${top}`;
    const positions = 'ou=positions,dc=example,dc=com';
    const mailboxBase = mailboxTypes.base;
    const organizations: EntityDescriptor = {
      key: 'organizations',
      pluralName: 'organizations',
      singularName: 'organization',
      mainAttribute: 'ou',
      base: top,
      schema: {
        attributes: {
          ou: { type: 'string', role: 'identifier' },
          twakeDepartmentPath: { type: 'string', role: 'organizationPath' },
        },
      },
      endpoint: '/api/v1/ldap/organizations',
      kind: 'organization',
      organizationPath: 'twakeDepartmentPath',
    };
    const people: EntityDescriptor = {
      ...users,
      schema: {
        attributes: {
          ...usersSchema.attributes,
          cn: { type: 'string' },
          displayName: {
            type: 'string',
            role: 'displayName',
            label: { en: 'Full name' },
          },
          mail: { type: 'string', role: 'primaryEmail', label: 'Email' },
          title: {
            type: 'pointer',
            role: 'position',
            branch: [positions],
            label: { en: 'Position' },
          },
          twakeAccountStatus: {
            ...usersSchema.attributes.twakeAccountStatus,
            label: { en: 'Status' },
          },
        },
      },
    };
    const teams: EntityDescriptor = {
      ...twakeGroups,
      schema: {
        attributes: {
          ...twakeGroups.schema.attributes,
          cn: { type: 'string', role: 'identifier', label: { en: 'Name' } },
          mail: { type: 'string', role: 'primaryEmail', label: 'Email' },
          twakeMailboxType: {
            type: 'pointer',
            role: 'mailboxType',
            branch: [mailboxBase],
            label: { en: 'Group type' },
          },
        },
      },
    };
    const entities = [organizations, people, teams, mailboxTypes];
    const sophie: Entry = {
      dn: 'uid=sophie.martin,ou=users,dc=example,dc=com',
      objectClass: ['inetOrgPerson'],
      uid: 'sophie.martin',
      displayName: 'Sophie Martin',
      mail: 'sophie.martin@example.com',
      title: `cn=Sales Manager,${positions}`,
      twakeAccountStatus: 'cn=active,ou=twakeAccountStatus,dc=example,dc=com',
    };
    const salesTeam: Entry = {
      dn: 'cn=sales-team,ou=groups,dc=example,dc=com',
      objectClass: ['groupOfNames'],
      cn: 'sales-team',
      mail: 'sales@example.com',
      twakeMailboxType: `cn=teamMailbox,${mailboxBase}`,
    };

    it('should read what the card shows of each entry by its role', async () => {
      // The card had only each entry's RDN to show: "sophie.martin" and
      // "sales-team", in the same chips, with no name, address or kind.
      nock(baseUrl)
        .get(`/api/v1/ldap/organizations/${encodeURIComponent(sales)}/subnodes`)
        .reply(200, [
          { dn: france, ou: ['France'], objectClass: ['organizationalUnit'] },
          sophie,
          salesTeam,
          { dn: 'cn=printer,ou=devices,dc=example,dc=com', cn: 'printer' },
        ]);

      const members = await new ConsoleApiClient(baseUrl).organizationMembers(
        sales,
        entities
      );
      expect(members.entries).to.deep.equal([
        {
          dn: sophie.dn,
          label: 'sophie.martin',
          entity: 'users',
          values: {
            displayName: 'Sophie Martin',
            primaryEmail: 'sophie.martin@example.com',
            position: `cn=Sales Manager,${positions}`,
            accountStatus: 'cn=active,ou=twakeAccountStatus,dc=example,dc=com',
          },
        },
        {
          dn: salesTeam.dn,
          label: 'sales-team',
          entity: 'groups',
          values: {
            primaryEmail: 'sales@example.com',
            mailboxType: `cn=teamMailbox,${mailboxBase}`,
          },
        },
        // No entity holds it: named, and listed with nothing more.
        { dn: 'cn=printer,ou=devices,dc=example,dc=com', label: 'printer' },
      ]);
    });

    /** The tables of an organization holding these entries. */
    const tables = (
      entries: Entry[],
      more: { truncated?: boolean; more?: number } = {},
      onCreate?: Record<string, () => void>,
      language = 'en'
    ): string =>
      new AttachedTables({
        entities,
        members: {
          entries: entries.map(entry => attachedEntry(entry, entities)),
          truncated: false,
          ...more,
        },
        translator: new Translator(language),
        name: 'Sales',
        pointerLabel: (dn: string) =>
          dn.startsWith('cn=active,')
            ? 'Active'
            : pointerLabel(entities, dn, language),
        onCreate,
        onOpen: () => undefined,
      }).markup();

    it('should show a person’s state as the lists do', () => {
      // The People and transit tables read "Disabled" like "Active" (#172).
      const frank: Entry = {
        ...sophie,
        dn: 'uid=frank,ou=users,dc=example,dc=com',
        uid: 'frank',
        displayName: 'Frank',
        twakeAccountStatus: 'cn=disabled',
      };
      const html = tables([sophie, frank]);
      expect(html).to.match(
        /<span class="dc-state dc-state-disabled">[^<]+<\/span><\/td>/
      );
      expect(html.match(/class="dc-state /g)).to.have.length(1);
    });

    it('should list the people and the groups apart, each row leading to its card', () => {
      const html = tables([sophie, salesTeam]);
      const people = html.slice(0, html.indexOf('data-attached="groups"'));
      const groupsTable = html.slice(html.indexOf('data-attached="groups"'));

      expect(people).to.include('People (1)');
      for (const text of [
        'Full name',
        'Email',
        'Position',
        'Status',
        'Sophie Martin',
        'sophie.martin@example.com',
        'Sales Manager',
        'Active',
      ])
        expect(people).to.include(`>${text}<`);
      expect(people).to.include('href="#&#x2F;users&#x2F;sophie.martin"');
      expect(people).to.not.include('sales-team');

      expect(groupsTable).to.include('Groups (1)');
      for (const text of [
        'Name',
        'Email',
        'Group type',
        'sales-team',
        'sales@example.com',
        'Shared mailbox',
      ])
        expect(groupsTable).to.include(`>${text}<`);
      expect(groupsTable).to.include('href="#&#x2F;groups&#x2F;sales-team"');
      // Neither search nor selection: a card is no list.
      expect(html).to.not.include('type="checkbox"');
    });

    it('should say who is not there, and what the server left out', () => {
      const empty = tables([]);
      expect(empty).to.include('People (0)');
      expect(empty).to.include('No one is attached to Sales.');
      expect(tables([], {}, undefined, 'fr')).to.include(
        'Personne n’est rattaché à Sales.'
      );

      // Under the table it concerns, and the count says it is not all.
      const cut = tables([sophie, salesTeam], { truncated: true, more: 48 });
      const notice = cut.indexOf('And 48 more entries, not listed here');
      expect(notice).to.be.greaterThan(-1);
      expect(cut.indexOf('data-attached="groups"')).to.be.greaterThan(notice);
      expect(cut).to.include('People (1+)');
      expect(cut).to.include('Groups (1)');
      // Groups alone listed: the notice goes under them.
      const groupsOnly = tables([salesTeam], { truncated: true });
      expect(groupsOnly.indexOf('And more entries')).to.be.greaterThan(
        groupsOnly.indexOf('data-attached="groups"')
      );
    });

    it('should carry New user here and New group here when offered', () => {
      const offered = tables([sophie], {}, { people: () => undefined });
      expect(offered).to.include('>New user here<');
      expect(offered).to.not.include('New group here');
      expect(tables([sophie])).to.not.match(/New (user|group) here/);
    });

    /** The card of an organization, drawn for a caller of this scope. */
    const card = async (
      dn: string,
      scope: Scope | null,
      members: (
        dn: string,
        entities: EntityDescriptor[],
        objectClass?: string
      ) => Promise<unknown> = async () => ({ entries: [], truncated: false }),
      known: EntityDescriptor[] = entities
    ): Promise<string> => {
      const holder = stubContainer();
      const app = consoleIn({ '[data-org-detail]': holder });
      Object.assign(app as unknown as object, { entities: known, scope });
      Object.assign((app as unknown as { api: object }).api, {
        organization: async () => ({ dn, ou: rdnValue(dn) }),
        organizationMembers: members,
        pointerOptions: async () => [],
      });
      await (
        app as unknown as {
          showOrganization(node: { dn: string; name: string }): Promise<void>;
        }
      ).showOrganization({ dn, name: rdnValue(dn) });
      return holder.innerHTML;
    };
    const localAdmin = (branch: string): Scope => ({
      user: 'uid=sophie.martin,ou=users,dc=example,dc=com',
      unrestricted: false,
      described: true,
      branches: [
        { dn: branch, read: true, write: true, delete: true },
        { dn: transit, read: true, write: true },
      ],
      entities: [
        { name: 'users', base: users.base, create: true },
        { name: 'groups', base: groups.base, create: true },
      ],
      transit,
    });

    it('should offer New user here where the caller creates, as the Overview does', async () => {
      expect(await card(france, localAdmin(sales))).to.include('New user here');
      expect(await card(france, null)).to.include('New group here');
      // Not on another administrator's organization, nor in transit.
      expect(await card(sales, localAdmin(france))).to.not.include(
        'New user here'
      );
      expect(await card(transit, localAdmin(sales))).to.not.include(
        'New user here'
      );
      // Nor where the scope lets the caller create no account.
      const noAccounts = localAdmin(sales);
      noAccounts.entities = [];
      expect(await card(france, noAccounts)).to.not.match(
        /New (user|group) here/
      );
      // The global administrator writes above the transit branch: still no
      // account is created there.
      const global: Scope = {
        ...localAdmin(top),
        branches: [{ dn: top, read: true, write: true, delete: true }],
      };
      expect(await card(france, global)).to.include('New user here');
      expect(await card(transit, global)).to.not.match(/New (user|group) here/);
    });

    it('should not say no one is attached where the scope hides the entries, nor when they could not be read', async () => {
      // The server lists a local administrator only the entries of their own
      // branches: on another organization, "No one" was not true.
      expect(await card(france, localAdmin(sales))).to.include(
        'No one is attached to France.'
      );
      const engineering = `ou=Engineering,${top}`;
      const elsewhere = await card(engineering, localAdmin(sales));
      expect(elsewhere).to.include(
        'None you manage is attached to Engineering.'
      );
      expect(elsewhere).to.not.include('No one');
      // What waits in transit is every administrator's to read.
      expect(await card(transit, localAdmin(sales))).to.include(
        'No one is attached to Transit.'
      );

      const failed = await card(france, localAdmin(sales), async () => {
        throw Object.assign(new Error('Directory unreachable'), {
          status: 500,
        });
      });
      expect(failed).to.include('dc-error-block');
      expect(failed).to.include('Directory unreachable');
      expect(failed).to.not.include('No one');
    });

    it('should ask the accounts and the groups apart, each table saying what it leaves out', async () => {
      // Asked at once, they shared one cap of fifty and one count, which did
      // not say of which kind: "Groups (0)" could hide groups.
      const withClass = (
        entity: EntityDescriptor,
        classes: string[]
      ): EntityDescriptor => ({
        ...entity,
        schema: {
          ...entity.schema,
          attributes: {
            ...entity.schema.attributes,
            objectClass: {
              type: 'array',
              fixed: true,
              default: ['top', ...classes],
            },
          },
        },
      });
      const classed = [
        organizations,
        withClass(people, ['twakeAccount', 'twakeWhitePages']),
        withClass(teams, ['groupOfNames', 'twakeStaticGroup']),
        mailboxTypes,
      ];
      expect(attachedClass(classed, 'people')).to.equal('twakeAccount');
      expect(attachedClass(classed, 'groups')).to.equal('groupOfNames');
      expect(attachedClass(entities, 'groups')).to.equal(undefined);

      const asked: (string | undefined)[] = [];
      const html = await card(
        france,
        localAdmin(sales),
        async (_dn, known, objectClass) => {
          asked.push(objectClass);
          return objectClass === 'groupOfNames'
            ? {
                entries: [attachedEntry(salesTeam, known)],
                truncated: true,
                more: 3,
              }
            : { entries: [attachedEntry(sophie, known)], truncated: false };
        },
        classed
      );
      expect(asked).to.deep.equal(['twakeAccount', 'groupOfNames']);
      expect(html).to.include('People (1)');
      expect(html).to.include('Groups (1+)');
      const notice = html.indexOf('And 3 more entries');
      expect(notice).to.be.greaterThan(html.indexOf('data-attached="groups"'));
    });

    it('should open the New user form with the department already set', () => {
      const form = new EntityForm({
        entity: users,
        preset: {
          twakeDepartmentLink: france,
          twakeDepartmentPath: 'Sales / France',
        },
        translator: new Translator('en'),
        pointerOptions: () => Promise.resolve([]),
        pointerSearch: () => async () => [],
        onSubmit: () => Promise.resolve(),
        onCancel: () => undefined,
      }) as unknown as {
        values: Record<string, string[]>;
        picked: Map<string, string>;
      };
      expect(form.values.twakeDepartmentLink).to.deep.equal([france]);
      expect(form.picked.get(france)).to.equal('Sales / France');
    });

    describe('what waits in transit', () => {
      const bob: Entry = {
        ...sophie,
        dn: 'uid=bob,ou=users,dc=example,dc=com',
        uid: 'bob',
        displayName: 'Bob Schneider',
        mail: 'bob@example.com',
      };
      const grace: Entry = {
        ...sophie,
        dn: 'uid=grace,ou=users,dc=example,dc=com',
        uid: 'grace',
        displayName: 'Grace Kim',
        mail: 'grace@example.com',
      };
      type Waiting = {
        scope: Scope | null;
        readTransit(): Promise<unknown>;
        showTransitWaiting(main: unknown, generation: number): Promise<void>;
        organizationRights(dn: string): { write: boolean; delete: boolean };
        claim(entity: EntityDescriptor, id: string): Promise<void>;
      };
      /** A console of this scope, the transit branch holding these entries */
      const setup = (scope: Scope | null, waiting: Entry[]) => {
        const link = { textContent: 'Transit' };
        const holder = stubContainer();
        const app = consoleIn({ '[data-transit-link]': link });
        Object.assign(app as unknown as object, { entities, scope });
        Object.assign((app as unknown as { api: object }).api, {
          organizationMembers: async (dn: string) => {
            expect(dn).to.equal(transit);
            return {
              entries: waiting.map(entry => attachedEntry(entry, entities)),
              truncated: false,
            };
          },
          pointerOptions: async () => [],
        });
        const main = {
          querySelector: (selector: string) =>
            selector === '[data-transit-waiting]' ? holder : null,
        };
        return { app: app as unknown as Waiting, link, holder, main };
      };
      const eric = (): Scope => ({
        ...localAdmin(`ou=Engineering,${top}`),
        branches: [
          {
            dn: `ou=Engineering,${top}`,
            read: true,
            write: true,
            delete: true,
          },
        ],
      });

      it('should count what waits on the banner, and list it on the Overview', async () => {
        const { app, link, holder, main } = setup(eric(), [bob, grace]);
        await app.showTransitWaiting(main, 0);
        expect(link.textContent).to.equal('Transit (2)');
        expect(holder.innerHTML).to.include('Waiting in transit (2)');
        expect(holder.innerHTML).to.include(
          'Handed over between administrators: claim those that belong to you.'
        );
        expect(holder.innerHTML).to.include('>Bob Schneider<');
        expect(holder.innerHTML).to.include('>Grace Kim<');
        expect(holder.innerHTML.match(/>Claim…</g)).to.have.length(2);
        // Each button named after its row for a screen reader, and the
        // column holding them named too.
        expect(holder.innerHTML).to.include('aria-label="Claim Bob Schneider"');
        expect(holder.innerHTML).to.include('aria-label="Claim Grace Kim"');
        expect(holder.innerHTML).to.include(
          '<th><span class="dc-visually-hidden">Actions</span></th>'
        );
        // No group waits: no Groups table saying so.
        expect(holder.innerHTML).to.not.include('data-attached="groups"');
      });

      it('should not let an older answer count over a newer one', async () => {
        // Read again after every hand-over and claim: the answers may come
        // back in any order.
        const { app, link } = setup(eric(), []);
        const answers: ((value: unknown) => void)[] = [];
        Object.assign((app as unknown as { api: object }).api, {
          organizationMembers: () =>
            new Promise(resolve => answers.push(resolve)),
        });
        const first = app.readTransit();
        const second = app.readTransit();
        answers[1]({
          entries: [attachedEntry(grace, entities)],
          truncated: false,
        });
        await second;
        answers[0]({
          entries: [bob, grace].map(entry => attachedEntry(entry, entities)),
          truncated: false,
        });
        await first;
        expect(link.textContent).to.equal('Transit (1)');
      });

      it('should say nothing when nothing waits', async () => {
        const { app, link, holder, main } = setup(eric(), []);
        await app.showTransitWaiting(main, 0);
        expect(link.textContent).to.equal('Transit');
        expect(holder.innerHTML).to.equal('');

        // Nor to a scope without a transit branch, which is not asked.
        const none = setup({ ...eric(), transit: null }, [bob]);
        await none.app.showTransitWaiting(none.main, 0);
        expect(none.holder.innerHTML).to.equal('');
      });

      it('should offer Edit and Delete on the transit branch to its writer above only', () => {
        // Every administrator writes the transit branch to hand entries
        // over: Edit was offered on it, and Save refused at the end.
        const local = setup(eric(), []).app;
        expect(local.organizationRights(transit)).to.deep.equal({
          write: false,
          delete: false,
        });
        expect(local.organizationRights(`ou=Engineering,${top}`)).to.deep.equal(
          { write: true, delete: true }
        );
        const admin = setup(
          {
            ...eric(),
            branches: [{ dn: top, read: true, write: true, delete: true }],
          },
          []
        ).app;
        expect(admin.organizationRights(transit)).to.deep.equal({
          write: true,
          delete: true,
        });
      });
    });
  });

  describe('OrganizationTree, revealing a node', () => {
    const top = 'ou=organization,dc=example,dc=com';
    const engineering = `ou=Engineering,${top}`;
    const backend = `ou=Backend,${engineering}`;
    const options = (asked: string[]) => ({
      translator: new Translator('en'),
      root: async () => ({ dn: top, name: 'organization' }),
      children: async (dn: string) => {
        asked.push(dn);
        if (dn === top) return [{ dn: engineering, name: 'Engineering' }];
        if (dn === engineering) return [{ dn: backend, name: 'Backend' }];
        return [];
      },
      onSelect: () => undefined,
    });

    it('should find a node however its DN is spelled', async () => {
      const asked: string[] = [];
      const container = treeContainer();
      const tree = new OrganizationTree(options(asked));
      await tree.render(container);
      expect(
        await tree.reveal(
          'OU=backend, ou=Engineering,ou=organization,dc=example,dc=com'
        )
      ).to.be.true;
      expect(container.innerHTML).to.match(
        /dc-selected[^]*?data-select="ou=Backend,ou=Engineering,/
      );
    });

    it('should select nothing for a node it does not hold', async () => {
      const tree = new OrganizationTree(options([]));
      await tree.render(treeContainer());
      expect(await tree.reveal('ou=Elsewhere,dc=example,dc=org')).to.be.false;
      expect(await tree.reveal(`ou=Gone,${engineering}`)).to.be.false;
    });

    it('should read a branch again when it no longer leads to the node', async () => {
      // Created since the branch was read, by another administrator.
      const asked: string[] = [];
      let late = false;
      const tree = new OrganizationTree({
        ...options(asked),
        children: async (dn: string) => {
          asked.push(dn);
          if (dn === top)
            return late
              ? [
                  { dn: engineering, name: 'Engineering' },
                  { dn: `ou=Legal,${top}`, name: 'Legal' },
                ]
              : [{ dn: engineering, name: 'Engineering' }];
          return [];
        },
      });
      const container = treeContainer();
      await tree.render(container);
      late = true;
      expect(await tree.reveal(`ou=Legal,${top}`)).to.be.true;
      expect(asked).to.deep.equal([top, top]);
      expect(container.innerHTML).to.include('>Legal</button>');
    });

    it('should carry the open branches over to the tree drawn in its place', async () => {
      const asked: string[] = [];
      const first = new OrganizationTree(options(asked));
      await first.render(treeContainer());
      await first.reveal(backend);
      const container = treeContainer();
      await new OrganizationTree(options(asked), first).render(container);
      // Nothing read again, and Backend still drawn under an open Engineering.
      expect(asked).to.deep.equal([top, engineering]);
      expect(container.innerHTML).to.include('>Backend</button>');
    });
  });

  describe('Translator', () => {
    it('should fall back to English for an unknown language', () => {
      expect(new Translator('xx').language).to.equal('en');
    });

    it('should read a region tag as its language', () => {
      expect(new Translator('fr-CA').language).to.equal('fr');
      expect(new Translator('mn-MN').language).to.equal('mn');
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

    it('should agree with a count of one', () => {
      // A count of one read "Import 1 entries", and "1 sélectionné(s)" where
      // French had no other way to say it.
      const en = new Translator('en');
      expect(en.t('import.run', { count: 1 })).to.equal('Import 1 entry');
      expect(en.t('import.run', { count: 2 })).to.equal('Import 2 entries');
      expect(en.t('import.run', { count: 0 })).to.equal('Import 0 entries');
      const fr = new Translator('fr');
      expect(fr.t('import.read', { count: 1, file: 'a.csv' })).to.equal(
        '1 ligne lue dans a.csv'
      );
      expect(fr.t('list.selected', { count: 1 })).to.equal('1 sélectionné');
      expect(fr.t('list.selected', { count: 3 })).to.equal('3 sélectionnés');
      // French counts nothing in the singular, where English does not.
      expect(fr.t('import.run', { count: 0 })).to.equal('Importer 0 entrée');
    });

    it('should write once what a language does not inflect', () => {
      // Mongolian leaves a noun as it is after a number: its catalogue holds
      // the plain key, and every count reads it.
      const mn = new Translator('mn');
      expect(mn.t('import.run', { count: 1 })).to.equal('1 бичлэг импортлох');
      expect(mn.t('import.run', { count: 5 })).to.equal('5 бичлэг импортлох');
      // A language-wide category the catalogue has no form for falls back
      // on the general one: French calls a million `many`.
      expect(new Translator('fr').t('import.run', { count: 1e6 })).to.equal(
        `Importer ${(1e6).toLocaleString('fr')} entrées`
      );
    });

    it('should draw no more once its panel is closed', () => {
      // Its panel closed while it ran, an import filled the hidden panel
      // again row after row, or wrote over the form opened next.
      const importer = new EntityImport({
        entity: users,
        translator: new Translator('en'),
        pointerOptions: () => Promise.resolve([]),
        create: () => Promise.resolve(),
        onDone: () => undefined,
        onClose: () => undefined,
      });
      const view = { isConnected: true };
      const root = {
        innerHTML: '',
        querySelector: (selector: string) =>
          selector === '.dc-import' ? view : null,
        querySelectorAll: () => [],
      };
      importer.render(root as unknown as HTMLElement);
      expect(root.innerHTML).to.contain('class="dc-import"');
      view.isConnected = false;
      root.innerHTML = '';
      (importer as unknown as { paint(): void }).paint();
      expect(root.innerHTML).to.equal('');
    });

    it('should say the import counts of one in the singular', () => {
      const importer = new EntityImport({
        entity: users,
        translator: new Translator('fr'),
        pointerOptions: () => Promise.resolve([]),
        create: () => Promise.resolve(),
        onDone: () => undefined,
        onClose: () => undefined,
      });
      const state = importer as unknown as {
        rows: {
          line: number;
          cells: string[];
          values: object;
          errors: string[];
        }[];
        reviewMarkup(): string;
      };
      state.rows = [
        { line: 2, cells: [], values: {}, errors: [] },
        { line: 3, cells: [], values: {}, errors: ['Nom est obligatoire'] },
      ];
      expect(state.reviewMarkup())
        .to.contain('prête à importer<')
        .and.contain('en erreur, non importée<')
        .and.contain('Importer 1 entrée<');
    });

    it('should name a field the server refused on import by its label', async () => {
      const importer = new EntityImport({
        entity: users,
        translator: new Translator('fr'),
        pointerOptions: () => Promise.resolve([]),
        create: () =>
          Promise.reject(new Error('Attribute "cn" must not be empty')),
        onDone: () => undefined,
        onClose: () => undefined,
      });
      const state = importer as unknown as {
        rows: {
          line: number;
          cells: string[];
          values: object;
          errors: string[];
        }[];
        failures: { message: string }[];
        run(): Promise<void>;
      };
      state.rows = [{ line: 2, cells: [], values: {}, errors: [] }];
      await state.run();
      expect(state.failures.map(failure => failure.message)).to.deep.equal([
        'Attribute "Nom" must not be empty',
      ]);
    });

    it('should say a refused row in the interface language, as a form does', async () => {
      const refusals = [
        Object.assign(new Error('user: "alice@example.com" is already used'), {
          status: 409,
          refusal: {
            code: 'unique',
            attribute: 'mail',
            value: 'alice@example.com',
          },
        }),
        Object.assign(new Error('Token does not have permission'), {
          status: 403,
          refusal: { code: 'forbidden' },
        }),
        Object.assign(new Error('Attribute "cn" must not be empty'), {
          status: 400,
        }),
        Object.assign(new Error('Token does not have permission'), {
          status: 403,
          refusal: { code: 'forbidden' },
        }),
        Object.assign(new Error('Token does not have permission'), {
          status: 403,
          refusal: { code: 'forbidden' },
        }),
      ];
      const importer = new EntityImport({
        entity: users,
        translator: new Translator('fr'),
        pointerOptions: () => Promise.resolve([]),
        create: () => Promise.reject(refusals.shift()),
        onDone: () => undefined,
        onClose: () => undefined,
      });
      const state = importer as unknown as {
        rows: {
          line: number;
          cells: string[];
          values: object;
          errors: string[];
        }[];
        failures: { message: string }[];
        mapping: string[];
        run(): Promise<void>;
      };
      const sales = 'ou=Sales,ou=organization,dc=example,dc=com';
      state.mapping = ['cn', 'twakeDepartmentLink'];
      state.rows = [
        { line: 2, cells: [], values: {}, errors: [] },
        { line: 3, cells: [], values: { cn: 'Eva Ernst' }, errors: [] },
        { line: 4, cells: [], values: {}, errors: [] },
        // A new entry is judged on the organization it goes to: that one is
        // named, as the file names it, else by its RDN.
        {
          line: 5,
          cells: ['Fay Fox', 'Acme / Sales'],
          values: { cn: 'Fay Fox', twakeDepartmentLink: sales },
          errors: [],
        },
        {
          line: 6,
          cells: ['Gil Gray'],
          values: { cn: 'Gil Gray', twakeDepartmentLink: sales },
          errors: [],
        },
      ];
      await state.run();
      expect(state.failures.map(failure => failure.message)).to.deep.equal([
        'Mail « alice@example.com » : déjà utilisé par une autre entrée.',
        'Vous n’administrez pas Eva Ernst : cette modification ne vous revient pas.',
        'Le serveur a refusé : Attribute "Nom" must not be empty',
        'Vous n’administrez pas Acme / Sales : cette modification ne vous revient pas.',
        'Vous n’administrez pas Sales : cette modification ne vous revient pas.',
      ]);
    });

    it('should name and link each entry an import created', async () => {
      const done: string[][] = [];
      const answers: (Entry | undefined)[] = [
        // What ldap-rest answers a creation: the DN and the identifier,
        // here made by the server from the address
        { dn: 'uid=amartin,ou=users,dc=example,dc=com', uid: 'amartin' },
        // An answer naming nothing: the row's identifier names it
        undefined,
      ];
      const importer = new EntityImport({
        entity: users,
        translator: new Translator('en'),
        pointerOptions: () => Promise.resolve([]),
        create: values =>
          Promise.resolve(createdEntryId(users, answers.shift(), values)),
        onDone: created => done.push(created),
        onClose: () => undefined,
      });
      const state = importer as unknown as {
        rows: {
          line: number;
          cells: string[];
          values: object;
          errors: string[];
        }[];
        run(): Promise<void>;
        doneMarkup(): string;
      };
      state.rows = [
        {
          line: 2,
          cells: [],
          values: { mail: 'alice@example.com', cn: 'Alice Martin' },
          errors: [],
        },
        { line: 3, cells: [], values: { uid: 'bob' }, errors: [] },
      ];
      await state.run();
      const markup = state.doneMarkup();
      expect(markup)
        .to.contain('href="#&#x2F;users&#x2F;amartin">Alice Martin</a>')
        .and.contain('(amartin)')
        // Named by its identifier alone, not twice
        .and.contain('href="#&#x2F;users&#x2F;bob">bob</a></td>');
      expect(done).to.deep.equal([['amartin', 'bob']]);
    });

    it('should create and import in natural French, the article agreeing', () => {
      const app = consoleIn({}, 'fr') as unknown as {
        createLabel(entity: EntityDescriptor): string;
      };
      const organizations = {
        ...groups,
        key: 'organizations',
        singularLabel: { en: 'organization', fr: 'organisation' },
      };
      expect(app.createLabel(users)).to.equal('Créer un utilisateur');
      expect(app.createLabel(organizations)).to.equal('Créer une organisation');
      // An entity the catalogue does not know keeps the schema's name.
      expect(
        app.createLabel({ ...groups, key: 'rooms', singularName: 'salle' })
      ).to.equal('Créer : salle');
      expect(
        (consoleIn({}) as unknown as typeof app).createLabel(organizations)
      ).to.equal('New organization');
      expect(
        new Translator('fr').t('import.title', {
          entities: 'Utilisateurs',
          lowerEntities: 'utilisateurs',
        })
      ).to.equal('Importer des utilisateurs');
    });

    it('should name what was created in its toast', () => {
      // "Created" alone did not say what.
      type Toasting = {
        createdToast(
          entity: EntityDescriptor,
          values: Record<string, string | string[]>,
          id: string
        ): string;
      };
      const en = consoleIn({}) as unknown as Toasting;
      const fr = consoleIn({}, 'fr') as unknown as Toasting;
      // By its full name (the fixture's cn holds that role)
      expect(en.createdToast(users, { cn: 'Ux Audit' }, 'ux-audit-1')).to.equal(
        'Ux Audit created'
      );
      // Said without a gender in French, a group or an organization being
      // named by the same sentence.
      expect(fr.createdToast(users, { cn: 'Ux Audit' }, 'ux-audit-1')).to.equal(
        'Ux Audit est maintenant dans l’annuaire'
      );
      // Else by its identifier
      expect(en.createdToast(groups, {}, 'sales-team')).to.equal(
        'sales-team created'
      );
      expect(en.createdToast(groups, {}, '')).to.equal('Created');
    });

    it('should name the department in the import rules as its field does', () => {
      // The Twake schema labels the field "Organisation" / "Байгууллага",
      // the template's column with it: the rules must not say "département".
      expect(new Translator('fr').t('import.noteReference')).to.equal(
        'Une organisation, un poste ou une civilité s’écrit comme il apparaît dans le formulaire : son nom, ou le chemin complet d’une organisation.'
      );
      expect(new Translator('mn').t('import.noteReference')).to.match(
        /^Байгууллага, .* байгууллагын бүтэн замаар\.$/
      );
    });

    it('should translate every key of every catalogue', () => {
      // A key present in one catalogue and missing from the other is exactly
      // the mixed-language interface this replaces.
      expect(availableLanguages).to.include.members(['en', 'fr', 'mn']);
      for (const language of availableLanguages) {
        expect(new Translator(language).t('list.perPage')).to.not.equal(
          'list.perPage'
        );
      }
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

    it('should be said by a screen reader, a refusal at once', () => {
      const live: string[] = [];
      const region = {
        setAttribute: (name: string, value: string) => {
          if (name === 'aria-live') live.push(value);
        },
      };
      const element = {
        textContent: '',
        hidden: true,
        onclick: null as unknown,
        classList: { toggle: () => undefined },
        closest: (selector: string) =>
          selector === '[data-toast-region]' ? region : null,
      } as unknown as HTMLElement;
      const toasts = new ToastController(() => element, 20);
      toasts.show('Refused', true);
      toasts.show('Saved');
      expect(live).to.deep.equal(['assertive', 'polite']);
      // The region the toast is announced from is drawn with the shell.
      const app = consoleIn({});
      (app as unknown as { drawShell(): void }).drawShell();
      expect(
        (app as unknown as { container: { innerHTML: string } }).container
          .innerHTML
      ).to.match(
        /<div data-toast-region role="status" aria-live="polite" aria-atomic="true">\s*<div class="dc-toast" data-toast hidden><\/div>/
      );
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

  describe('a generated password', () => {
    /** An element the panel's code queries, records and fires. */
    const control = (props: Record<string, unknown> = {}) => {
      const listeners: Record<string, ((event: unknown) => void)[]> = {};
      return {
        hidden: false,
        textContent: '',
        value: '',
        checked: true,
        disabled: false,
        focused: 0,
        selected: 0,
        isConnected: true,
        ...props,
        addEventListener(
          type: string,
          listener: (event: unknown) => void
        ): void {
          (listeners[type] ||= []).push(listener);
        },
        fire(type: string): void {
          const event = { preventDefault: () => undefined };
          for (const listener of listeners[type] || []) listener(event);
        },
        focus(): void {
          this.focused++;
        },
        select(): void {
          this.selected++;
        },
      };
    };
    const tick = () => new Promise(resolve => setTimeout(resolve, 0));

    /**
     * Reset alice's password, typed or generated, through the panel.
     *
     * @param typed the password typed, or none to have one generated
     * @param meanwhile what happens before the server answers
     * @param refusal what the server answers instead of a password
     */
    const reset = async (
      typed: string,
      meanwhile?: (sent: {
        app: {
          closePanel(force?: boolean): void;
          openPanel(title: string, build: (body: unknown) => void): void;
          panelGuard: (() => boolean) | null;
        };
        els: Record<string, ReturnType<typeof control>>;
        panel: { hidden: boolean };
      }) => void,
      refusal?: Error
    ) => {
      const els = {
        form: control(),
        send: control(),
        cancel: control(),
        password: control({ value: typed }),
        force: control({ checked: true }),
        field: control(),
        copy: control(),
        leave: control({ hidden: true }),
        done: control(),
        doneButton: control(),
        back: control(),
        close: control(),
      };
      const selectors: Record<string, unknown> = {
        form: els.form,
        'button[type="submit"]': els.send,
        '[data-cancel]': els.cancel,
        '#dc-new-password': els.password,
        '#dc-force-change': els.force,
        '#dc-generated-password': els.field,
        '[data-copy-password]': els.copy,
        '[data-leave]': els.leave,
        '[data-done-actions]': els.done,
        '[data-done]': els.doneButton,
        '[data-leave-back]': els.back,
        '[data-leave-close]': els.close,
      };
      const body = {
        innerHTML: '',
        scrollTop: 0,
        querySelector: (selector: string) => selectors[selector] ?? null,
        querySelectorAll: () => [],
      };
      const panel = { hidden: true, classList: { toggle: () => undefined } };
      const title = { textContent: '' };
      const toast = toastElement();
      const app = consoleIn({
        '[data-panel]': panel,
        '[data-panel-title]': title,
        '[data-panel-body]': body,
        '[data-toast]': toast,
      }) as unknown as {
        api: unknown;
        resetPassword(entity: unknown, id: string): Promise<void>;
        closePanel(force?: boolean): void;
        openPanel(title: string, build: (body: unknown) => void): void;
        panelGuard: (() => boolean) | null;
      };
      let calls = 0;
      app.api = {
        resetPassword: () => {
          calls++;
          if (refusal) return Promise.reject(refusal);
          return Promise.resolve(
            typed
              ? { generated: false }
              : { generated: true, password: 's3cret!<x>' }
          );
        },
      };
      await app.resetPassword({ key: 'users' }, 'alice');
      els.form.fire('submit');
      meanwhile?.({ app, els, panel });
      await tick();
      return { app, els, body, panel, title, toast, calls: () => calls };
    };

    it('should stay in the panel, never in a toast', async () => {
      // In a toast, the click that began selecting it dismissed it for good.
      const { els, body, panel, title, toast } = await reset('');
      expect(panel.hidden).to.be.false;
      expect(toast.textContent).to.equal('');
      expect(title.textContent).to.equal('New password — alice');
      expect(body.innerHTML).to.match(
        /<input id="dc-generated-password"[^>]*readonly value="s3cret!&lt;x&gt;"/
      );
      expect(body.innerHTML).to.contain('data-copy-password>Copy</button>');
      expect(body.innerHTML).to.contain(
        'Give this password to alice. It will not be shown again. They will have to change it when they next sign in.'
      );
      // Focus on the field, which a screen reader reads with its help
      expect(els.field.focused).to.equal(1);
      els.field.fire('focus');
      expect(els.field.selected).to.equal(1);
    });

    it('should ask once before it is closed uncopied', async () => {
      const { app, els, panel } = await reset('');
      // Done, × and Escape all close the panel through closePanel
      els.doneButton.fire('click');
      expect(panel.hidden).to.be.false;
      expect(els.leave.hidden).to.be.false;
      expect(els.done.hidden).to.be.true;
      expect(els.close.focused).to.equal(1);
      // Back keeps it, and asks again next time
      els.back.fire('click');
      expect(els.leave.hidden).to.be.true;
      app.closePanel();
      expect(panel.hidden).to.be.false;
      // Asked: the second attempt closes
      app.closePanel();
      expect(panel.hidden).to.be.true;
    });

    it('should close at once once copied', async () => {
      const g = globalThis as Record<string, unknown>;
      const original = Object.getOwnPropertyDescriptor(g, 'navigator');
      const written: string[] = [];
      Object.defineProperty(g, 'navigator', {
        configurable: true,
        value: {
          clipboard: {
            writeText: (text: string) => {
              written.push(text);
              return Promise.resolve();
            },
          },
        },
      });
      try {
        const { app, els, panel } = await reset('');
        els.copy.fire('click');
        await tick();
        expect(written).to.deep.equal(['s3cret!<x>']);
        expect(els.copy.textContent).to.equal('Copied');
        app.closePanel();
        expect(panel.hidden).to.be.true;
      } finally {
        if (original) Object.defineProperty(g, 'navigator', original);
        else delete g.navigator;
      }
    });

    it('should still close on a typed password, with a toast', async () => {
      const { panel, toast } = await reset('N3w-Passw0rd!');
      expect(panel.hidden).to.be.true;
      expect(toast.textContent).to.equal('Password changed');
    });

    it('should leave no password in the page once closed', async () => {
      // Hidden, the panel kept the field and its value, for any script or
      // open developer tools to read on the next page.
      const generated = await reset('');
      generated.app.closePanel();
      generated.app.closePanel();
      expect(generated.panel.hidden).to.be.true;
      expect(generated.body.innerHTML).to.equal('');
      const typed = await reset('N3w-Passw0rd!');
      expect(typed.panel.hidden).to.be.true;
      expect(typed.body.innerHTML).to.equal('');
    });

    it('should be sent once, and stay while the server answers', async () => {
      // Closed in the meantime, it had the password shown over whatever
      // opened next; sent twice, the one shown might not be the one kept.
      let guard: (() => boolean) | null = null;
      const { panel, body, calls } = await reset('', ({ app, els, panel }) => {
        expect(els.send.disabled).to.be.true;
        app.closePanel();
        expect(panel.hidden).to.be.false;
        els.form.fire('submit');
        guard = app.panelGuard;
      });
      expect(calls()).to.equal(1);
      expect(panel.hidden).to.be.false;
      expect(body.innerHTML).to.contain('id="dc-generated-password"');
      // Given back by a confirmation answered after the server, the guard
      // no longer holds the panel.
      expect((guard as unknown as () => boolean)()).to.be.true;
    });

    it('should close on Cancel even while the server answers', async () => {
      // A server that never answers would otherwise hold the panel for good.
      const { panel, title } = await reset('', ({ els, panel }) => {
        els.cancel.fire('click');
        expect(panel.hidden).to.be.true;
        els.form.isConnected = false;
      });
      // The password generated all the same gets a panel of its own.
      expect(panel.hidden).to.be.false;
      expect(title.textContent).to.equal('New password — alice');
    });

    it('should wait for the panel opened meanwhile to close', async () => {
      // Replaced, that panel lost what it held: another password perhaps.
      const { app, panel, title, body } = await reset('', ({ app, els }) => {
        els.cancel.fire('click');
        els.form.isConnected = false;
        app.openPanel('Edit bob', inner => {
          (inner as { innerHTML: string }).innerHTML = 'bob’s form';
        });
      });
      expect(title.textContent).to.equal('Edit bob');
      expect(body.innerHTML).to.equal('bob’s form');
      app.closePanel();
      expect(panel.hidden).to.be.false;
      expect(title.textContent).to.equal('New password — alice');
      expect(body.innerHTML).to.contain('id="dc-generated-password"');
    });

    it('should be sent again after the server refused it', async () => {
      const { app, els, panel, toast, calls } = await reset(
        'N3w-Passw0rd!',
        undefined,
        new Error('Password fails quality checking policy')
      );
      expect(toast.textContent).to.equal(
        'Password fails quality checking policy'
      );
      expect(els.send.disabled).to.be.false;
      expect(panel.hidden).to.be.false;
      els.form.fire('submit');
      await tick();
      expect(calls()).to.equal(2);
      app.closePanel();
      expect(panel.hidden).to.be.true;
    });

    it('should show a password generated after its panel was shut by force', async () => {
      // The only copy there is: in a panel of its own, not a hidden one.
      const { panel, body, title } = await reset('', ({ app, els, panel }) => {
        app.closePanel(true);
        expect(panel.hidden).to.be.true;
        els.form.isConnected = false;
      });
      expect(panel.hidden).to.be.false;
      expect(title.textContent).to.equal('New password — alice');
      expect(body.innerHTML).to.match(
        /<input id="dc-generated-password"[^>]*readonly value="s3cret!&lt;x&gt;"/
      );
    });
  });

  describe('the side panel', () => {
    /** A console whose panel is made of elements just real enough for it. */
    const setup = () => {
      const panel = {
        hidden: true,
        classList: { toggle: () => undefined },
      };
      // As in a browser, an element with no box keeps its offset whatever
      // is written to it: the panel's body has none while the panel is hidden.
      let offset = 0;
      const body = {
        innerHTML: '',
        querySelectorAll: () => [],
        get scrollTop(): number {
          return offset;
        },
        set scrollTop(value: number) {
          if (!panel.hidden) offset = value;
        },
      };
      const app = consoleIn({
        '[data-panel]': panel,
        '[data-panel-title]': { textContent: '' },
        '[data-panel-body]': body,
      });
      return {
        app: app as unknown as {
          openPanel(title: string, build: (body: unknown) => void): void;
          closePanel(): void;
          followHash(): Promise<void>;
        },
        panel,
        body,
      };
    };

    it('should open every form at its top', () => {
      const { app, panel, body } = setup();
      app.openPanel('Edit — bob', () => undefined);
      body.scrollTop = 739;
      app.closePanel();
      app.openPanel('New group', () => undefined);
      expect(panel.hidden).to.be.false;
      expect(body.scrollTop).to.equal(0);
    });

    it('should close the panel when the page changes under it', async () => {
      const { app, panel } = setup();
      app.openPanel('Edit — alice', () => undefined);
      const g = globalThis as Record<string, unknown>;
      const original = g.window;
      g.window = { location: { hash: '#/organizations' } };
      try {
        await app.followHash();
      } finally {
        g.window = original;
      }
      expect(panel.hidden).to.be.true;
    });

    describe('and the keyboard', () => {
      const g = globalThis as Record<string, unknown>;
      let original: unknown;
      /** Which element has the focus, as `document.activeElement` says. */
      const page = { activeElement: null as unknown };
      beforeEach(() => {
        original = g.document;
        page.activeElement = null;
        g.document = page;
      });
      afterEach(() => {
        g.document = original;
      });

      const element = (name: string) => {
        const made = {
          name,
          isConnected: true,
          closest: () => null,
          focus: () => {
            page.activeElement = made;
          },
        };
        return made;
      };
      const press = (key: string, shiftKey = false, used = false) => ({
        key,
        shiftKey,
        defaultPrevented: used,
        preventDefault() {
          this.defaultPrevented = true;
        },
      });

      /** A panel whose header holds Close, and whose body a field and Save. */
      const keyboardSetup = () => {
        const edit = element('Edit');
        const close = element('Close');
        const field = element('Name');
        const save = element('Save');
        const panel = { hidden: true, classList: { toggle: () => undefined } };
        const dialog = {
          ...element('dialog'),
          querySelectorAll: () => [close, field, save],
        };
        const app = consoleIn({
          '[data-panel]': panel,
          '[data-panel-dialog]': dialog,
          '[data-panel-title]': { textContent: '' },
          '[data-panel-body]': {
            innerHTML: '',
            scrollTop: 0,
            querySelectorAll: () => [field, save],
          },
        }) as unknown as {
          openPanel(title: string, build: (body: unknown) => void): void;
          closePanel(): void;
          panelKey(event: unknown): void;
        };
        return { app, panel, edit, close, field, save };
      };

      it('should be announced as a dialog named by its title', () => {
        const app = consoleIn({});
        (app as unknown as { drawShell(): void }).drawShell();
        const html = (app as unknown as { container: { innerHTML: string } })
          .container.innerHTML;
        expect(html).to.match(
          /<div class="dc-panel-inner" data-panel-dialog role="dialog"\s+aria-modal="true" aria-labelledby="dc-panel-title"/
        );
        expect(html).to.contain('<h2 id="dc-panel-title" data-panel-title>');
      });

      it('should take the focus to its first field, and give it back on close', () => {
        // The focus stayed on Edit, and Tab went on through the page behind.
        const { app, edit, field } = keyboardSetup();
        edit.focus();
        app.openPanel('Edit — alice', () => undefined);
        expect(page.activeElement).to.equal(field);
        app.closePanel();
        expect(page.activeElement).to.equal(edit);
      });

      it('should keep Tab and Shift+Tab inside it', () => {
        const { app, close, field, save } = keyboardSetup();
        app.openPanel('Edit — alice', () => undefined);

        save.focus();
        const forward = press('Tab');
        app.panelKey(forward);
        expect(forward.defaultPrevented).to.be.true;
        expect(page.activeElement).to.equal(close);

        const backward = press('Tab', true);
        app.panelKey(backward);
        expect(backward.defaultPrevented).to.be.true;
        expect(page.activeElement).to.equal(save);

        // Between two of its controls, Tab is the browser's to move.
        field.focus();
        const within = press('Tab');
        app.panelKey(within);
        expect(within.defaultPrevented).to.be.false;

        // From outside it, back in.
        page.activeElement = null;
        app.panelKey(press('Tab'));
        expect(page.activeElement).to.equal(close);
      });

      it('should close on Escape, but not on one a control in it used', () => {
        const { app, panel, edit } = keyboardSetup();
        edit.focus();
        app.openPanel('Edit — alice', () => undefined);
        // A picker closing its list of suggestions prevents the default.
        app.panelKey(press('Escape', false, true));
        expect(panel.hidden).to.be.false;
        app.panelKey(press('Escape'));
        expect(panel.hidden).to.be.true;
        expect(page.activeElement).to.equal(edit);
      });

      it('should leave the keys alone while it is closed', () => {
        const { app, edit } = keyboardSetup();
        edit.focus();
        const tab = press('Tab');
        app.panelKey(tab);
        app.panelKey(press('Escape'));
        expect(tab.defaultPrevented).to.be.false;
        expect(page.activeElement).to.equal(edit);
      });
    });
  });

  describe('the shell and its actions', () => {
    describe('the change of state', () => {
      /**
       * A console on an account's card, its panel body holding the radios the
       * panel draws, and nothing written before its button is pressed.
       */
      const setup = (
        language = 'en',
        stored: string | undefined = 'cn=active',
        entity: EntityDescriptor = users
      ) => {
        const toast = toastElement();
        const states =
          entity.schema.attributes.twakeAccountStatus?.states ?? {};
        const radios = Object.keys(states).map(value => {
          const radio = {
            value,
            checked: false,
            listener: undefined as (() => void) | undefined,
            addEventListener: (_type: string, callback: () => void) => {
              radio.listener = callback;
            },
          };
          return radio;
        });
        const submit = { disabled: true, textContent: '' };
        let send: ((event: unknown) => void) | undefined;
        const form = {
          addEventListener: (
            _type: string,
            callback: (event: unknown) => void
          ) => {
            send = callback;
          },
        };
        const body = {
          innerHTML: '',
          querySelector: (selector: string) =>
            selector === 'button[type="submit"]'
              ? submit
              : selector === 'form'
                ? form
                : selector === 'input[name="dc-state"]:checked'
                  ? (radios.find(radio => radio.checked) ?? null)
                  : null,
          querySelectorAll: (selector: string) =>
            selector === 'input[name="dc-state"]'
              ? radios.filter(radio =>
                  body.innerHTML.includes(`value="${radio.value}"`)
                )
              : [],
        };
        const panel = { hidden: true, classList: { toggle: () => undefined } };
        const app = consoleIn(
          {
            '[data-panel]': panel,
            '[data-panel-title]': { textContent: '' },
            '[data-panel-body]': body,
            '[data-toast]': toast,
          },
          language
        );
        Object.assign(app, {
          entities: [entity],
          renderMain: async () => undefined,
        });
        const open = (): Promise<void> =>
          (
            app as unknown as {
              changeState(
                entity: EntityDescriptor,
                id: string,
                entry: Entry
              ): Promise<void>;
            }
          ).changeState(entity, 'frank', {
            uid: 'frank',
            cn: 'Frank Martin',
            ...(stored === undefined ? {} : { twakeAccountStatus: stored }),
          });
        const pick = (value: string): void => {
          for (const radio of radios) radio.checked = radio.value === value;
          radios.find(radio => radio.value === value)?.listener?.();
        };
        const press = (): void => send?.({ preventDefault: () => undefined });
        return { app, toast, body, submit, panel, open, pick, press };
      };

      it('should show the current state and offer the others, explained', async () => {
        const { body, open } = setup();
        await open();
        expect(body.innerHTML).to.include('Current state: Active');
        expect(body.innerHTML).to.include('value="disabled"');
        expect(body.innerHTML).to.not.include('value="enabled"');
        expect(body.innerHTML).to.include(
          'Suspended, during a long absence for instance.'
        );
      });

      it('should translate the states it knows and keep the ones it does not', async () => {
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
        const { body, submit, open, pick } = setup('fr', undefined, entity);
        await open();
        expect(body.innerHTML).to.include('>Désactivé</label>');
        expect(body.innerHTML).to.include(
          'Suspendu, pendant une longue absence par exemple.'
        );
        // A state the deployment invented keeps the name the deployment gave
        // it, with no explanation the catalogue would have to invent, and a
        // button that says what it does in general terms.
        expect(body.innerHTML).to.include('>seconded</label>');
        expect(body.innerHTML).to.not.include('dc-state-seconded-help');
        pick('seconded');
        expect(submit.textContent).to.equal('Changer l’état');
        pick('disabled');
        expect(submit.textContent).to.equal('Désactiver');
      });

      it('should write nothing until the button naming the choice is pressed', async () => {
        const { toast, submit, open, pick, press } = setup();
        // Any request now would fail the test: nock lets none through.
        await open();
        expect(submit.disabled).to.equal(true);
        expect(submit.textContent).to.equal('');
        pick('disabled');
        expect(submit.disabled).to.equal(false);
        expect(submit.textContent).to.equal('Disable');
        expect(toast.textContent).to.equal('');

        const written = nock(baseUrl)
          .post('/api/v1/ldap/users/frank/status', { state: 'disabled' })
          .reply(200, {});
        press();
        await new Promise(resolve => setTimeout(resolve, 20));
        expect(written.isDone()).to.equal(true);
        expect(toast.textContent).to.equal('Frank Martin is now Disabled');
      });

      it('should name the account and the state in the interface language', async () => {
        const { toast, open, pick, press } = setup('fr', 'cn=disabled');
        await open();
        pick('enabled');
        nock(baseUrl)
          .post('/api/v1/ldap/users/frank/status', { state: 'enabled' })
          .reply(200, {});
        press();
        await new Promise(resolve => setTimeout(resolve, 20));
        expect(toast.textContent).to.equal('Frank Martin est désormais Actif');
      });
    });

    it('should name the states the same way in the panel, the card and the reference list', () => {
      // English said "Enabled" and "To be deleted" in the select, "Active"
      // and "To delete" on the card and in the Account states list.
      const en = new Translator('en');
      expect(en.t('state.enabled')).to.equal('Active');
      expect(en.t('state.toDelete')).to.equal('To delete');
    });

    it('should ask before deleting an organization by its name, not its DN', async () => {
      const organizations: EntityDescriptor = {
        key: 'organizations',
        pluralName: 'organizations',
        singularName: 'organization',
        mainAttribute: 'ou',
        base: 'ou=organization,dc=example,dc=com',
        schema: {
          attributes: {
            ou: { type: 'string', role: 'identifier' },
            twakeDepartmentPath: { type: 'string', role: 'organizationPath' },
          },
        },
        endpoint: '/api/v1/ldap/organizations',
        kind: 'organization',
        organizationPath: 'twakeDepartmentPath',
      };
      const dn = 'ou=QA Lab,ou=Engineering,ou=organization,dc=example,dc=com';
      const asked: Confirmation[] = [];
      const app = consoleIn({}) as unknown as {
        confirmAction(question: Confirmation): Promise<boolean>;
        confirmDeleteOrganization(
          entity: EntityDescriptor,
          entry: Entry,
          dn: string
        ): Promise<void>;
      };
      // Declined: nothing is deleted, and no request is made.
      app.confirmAction = async question => {
        asked.push(question);
        return false;
      };
      await app.confirmDeleteOrganization(
        organizations,
        { dn, ou: 'QA Lab', twakeDepartmentPath: 'Engineering / QA Lab' },
        dn
      );
      // An organization with no path is named by its own name.
      await app.confirmDeleteOrganization(organizations, { dn }, dn);
      expect(asked).to.deep.equal([
        {
          title: 'Delete Engineering / QA Lab?',
          lines: ['This cannot be undone.'],
          action: 'Delete organization',
        },
        {
          title: 'Delete QA Lab?',
          lines: ['This cannot be undone.'],
          action: 'Delete organization',
        },
      ]);
    });

    it('should name a nomenclature entry as its card does, to edit or delete it', async () => {
      const app = consoleIn({}, 'fr') as unknown as {
        openPanel(title: string): void;
        openForm(entity: EntityDescriptor, entry?: Entry): Promise<void>;
        confirmAction(question: Confirmation): Promise<boolean>;
        confirmDelete(entity: EntityDescriptor, id: string): Promise<void>;
      };
      const titles: string[] = [];
      app.openPanel = (title: string): void => {
        titles.push(title);
      };
      await app.openForm(mailboxTypes, {
        dn: 'cn=teamMailbox,ou=twakeMailboxType,ou=nomenclature,dc=example,dc=com',
        cn: 'teamMailbox',
      });
      expect(titles).to.deep.equal(['Modifier — Boîte partagée']);

      const asked: string[] = [];
      app.confirmAction = async question => {
        asked.push(`${question.title} ${question.action}`);
        return false;
      };
      await app.confirmDelete(mailboxTypes, 'teamMailbox');
      // A value the schema does not name keeps its own.
      await app.confirmDelete(mailboxTypes, 'archive');
      expect(asked).to.deep.equal([
        'Supprimer Boîte partagée ? Supprimer Boîte partagée',
        'Supprimer archive ? Supprimer archive',
      ]);
    });

    it('should name the person, the consequences and the way out before deleting an account', async () => {
      const staff: EntityDescriptor = {
        ...users,
        schema: {
          attributes: {
            ...usersSchema.attributes,
            givenName: { type: 'string', role: 'givenName' },
            memberOf: {
              type: 'array',
              role: 'groupMemberships',
              items: { type: 'string' },
            },
          },
        },
      };
      const entry: Entry = {
        dn: 'uid=jmartin,ou=users,dc=example,dc=com',
        uid: 'jmartin',
        cn: 'Jeanne Martin',
        givenName: 'Jeanne',
        mail: 'jmartin@example.com',
        twakeDepartmentPath: 'Sales / France',
        twakeAccountStatus: 'cn=active',
        memberOf: [
          'cn=all-staff,ou=groups,dc=example,dc=com',
          'cn=sales-team,ou=groups,dc=example,dc=com',
        ],
      };
      const asked: Confirmation[] = [];
      const app = consoleIn({}) as unknown as {
        confirmAction(question: Confirmation): Promise<boolean>;
        changeState(
          entity: EntityDescriptor,
          id: string,
          entry: Entry,
          preselect?: string
        ): Promise<void>;
        confirmDelete(
          entity: EntityDescriptor,
          id: string,
          entry?: Entry,
          canChangeState?: boolean
        ): Promise<void>;
      };
      app.confirmAction = async question => {
        asked.push(question);
        return false;
      };
      const changed: unknown[][] = [];
      app.changeState = async (...args) => {
        changed.push(args);
      };

      await app.confirmDelete(staff, 'jmartin', entry, true);
      const [question] = asked;
      expect(question.title).to.equal('Delete Jeanne Martin?');
      expect(question.lines).to.deep.equal([
        'Jeanne Martin · jmartin@example.com · Sales / France',
        'This cannot be undone. Jeanne Martin will be removed from: all-staff, sales-team.',
      ]);
      expect(question.action).to.equal('Delete Jeanne');
      expect(question.reversible).to.equal(undefined);
      expect(question.alternative?.label).to.equal(
        'To stop access without deleting, set the state to Disabled instead.'
      );
      // The way out opens the state change, Disabled picked, and deletes nothing.
      question.alternative?.run();
      expect(changed).to.deep.equal([[staff, 'jmartin', entry, 'disabled']]);

      // Not offered to whom may not change it, nor to an account already disabled.
      await app.confirmDelete(staff, 'jmartin', entry, false);
      await app.confirmDelete(
        staff,
        'jmartin',
        { ...entry, twakeAccountStatus: 'cn=disabled', memberOf: [] },
        true
      );
      expect(asked[1].alternative).to.equal(undefined);
      expect(asked[2].alternative).to.equal(undefined);
      expect(asked[2].lines[1]).to.equal('This cannot be undone.');
    });

    it('should say when an account’s groups could not be listed, and still delete it', async () => {
      // Without `memberOf`, they are searched among the groups: a refusal
      // read as none said nothing about groups (#157).
      const staff: EntityDescriptor = {
        ...users,
        schema: {
          attributes: {
            ...usersSchema.attributes,
            memberOf: {
              type: 'array',
              role: 'groupMemberships',
              items: { type: 'string' },
            },
          },
        },
      };
      const entry: Entry = {
        dn: 'uid=jmartin,ou=users,dc=example,dc=com',
        uid: 'jmartin',
        cn: 'Jeanne Martin',
        memberOf: [],
      };
      const setup = (
        found: () => Promise<string[]>,
        language = 'en'
      ): {
        asked: Confirmation[];
        strict: unknown[];
        removed: string[];
        confirmDelete(
          entity: EntityDescriptor,
          id: string,
          entry?: Entry
        ): Promise<void>;
      } => {
        const asked: Confirmation[] = [];
        const strict: unknown[] = [];
        const removed: string[] = [];
        const app = consoleIn({}, language) as unknown as {
          api: object;
          confirmAction(question: Confirmation): Promise<boolean>;
          toast(message: string): void;
          go(key: string): void;
          confirmDelete(
            entity: EntityDescriptor,
            id: string,
            entry?: Entry
          ): Promise<void>;
        };
        Object.assign(app.api, {
          memberships: async (_dn: string, _e: unknown, s?: boolean) => {
            strict.push(s);
            return found();
          },
          remove: async (_entity: EntityDescriptor, id: string) => {
            removed.push(id);
          },
        });
        app.confirmAction = async question => {
          asked.push(question);
          return true;
        };
        app.toast = (): void => undefined;
        app.go = (): void => undefined;
        return {
          asked,
          strict,
          removed,
          confirmDelete: app.confirmDelete.bind(app),
        };
      };

      for (const status of [403, 500]) {
        const refused = setup(async () => {
          throw Object.assign(new Error('Refused'), { status });
        });
        await refused.confirmDelete(staff, 'jmartin', entry);
        expect(refused.strict).to.deep.equal([true]);
        expect(refused.asked[0].lines[1]).to.equal(
          'This cannot be undone. The groups Jeanne Martin belongs to could not be listed.'
        );
        expect(refused.asked[0].action).to.equal('Delete Jeanne Martin');
        expect(refused.removed).to.deep.equal(['jmartin']);
      }
      const fr = setup(async () => {
        throw new Error('No filter can hold it');
      }, 'fr');
      await fr.confirmDelete(staff, 'jmartin', entry);
      expect(fr.asked[0].lines[1]).to.include(
        'Les groupes de Jeanne Martin n’ont pas pu être listés.'
      );

      // None found is none: nothing said about groups
      const none = setup(async () => []);
      await none.confirmDelete(staff, 'jmartin', entry);
      expect(none.asked[0].lines[1]).to.equal('This cannot be undone.');
      expect(none.removed).to.deep.equal(['jmartin']);
    });

    it('should say a deleted group leaves its members, and name a selection', async () => {
      const asked: Confirmation[] = [];
      const app = consoleIn({}, 'fr') as unknown as {
        confirmAction(question: Confirmation): Promise<boolean>;
        confirmDelete(
          entity: EntityDescriptor,
          id: string,
          entry?: Entry
        ): Promise<void>;
        deleteMany(entity: EntityDescriptor, ids: string[]): Promise<boolean>;
      };
      app.confirmAction = async question => {
        asked.push(question);
        return false;
      };
      await app.confirmDelete(groups, 'sales-team', {
        dn: 'cn=sales-team,ou=groups,dc=example,dc=com',
        cn: 'sales-team',
        member: ['uid=a', 'uid=b', 'uid=c'],
      });
      // Cancelled, nothing went: the list is not read again.
      expect(
        await app.deleteMany(users, ['a', 'b', 'c', 'd', 'e', 'f', 'g'])
      ).to.equal(false);
      await app.deleteMany(users, ['a']);
      expect(asked).to.deep.equal([
        {
          title: 'Supprimer sales-team ?',
          lines: [
            'Ses 3 membres restent dans l’annuaire ; seul le groupe disparaît.',
            'Cette action est irréversible.',
          ],
          action: 'Supprimer le groupe',
        },
        {
          title: 'Supprimer 7 entrées ?',
          lines: ['Cette action est irréversible.'],
          items: ['a', 'b', 'c', 'd', 'e', 'et 2 de plus'],
          action: 'Supprimer 7 entrées',
        },
        {
          title: 'Supprimer 1 entrée ?',
          lines: ['Cette action est irréversible.'],
          items: ['a'],
          action: 'Supprimer 1 entrée',
        },
      ]);
    });

    it('should name the person and the organization they leave before handing them over', async () => {
      const asked: Confirmation[] = [];
      const app = consoleIn({}) as unknown as {
        scope: Scope;
        confirmAction(question: Confirmation): Promise<boolean>;
        handOver(
          entity: EntityDescriptor,
          id: string,
          entry: Entry
        ): Promise<void>;
      };
      app.scope = {
        transit: 'ou=transit,dc=example,dc=com',
      } as unknown as Scope;
      app.confirmAction = async question => {
        asked.push(question);
        return false;
      };
      await app.handOver(users, 'bob', {
        dn: 'uid=bob,ou=users,dc=example,dc=com',
        uid: 'bob',
        cn: 'Bob Durand',
        twakeDepartmentPath: 'Sales',
      });
      expect(asked).to.deep.equal([
        {
          title: 'Hand Bob Durand over?',
          lines: [
            'Bob Durand leaves Sales for Transit.',
            'Every administrator will see this entry and may claim it; you will no longer manage it.',
          ],
          action: 'Hand over',
          reversible: true,
        },
      ]);
    });

    it('should say where a handed-over entry comes from', async () => {
      // In transit the entry no longer names its organization: the toast is
      // the last place that says where it came from.
      const toast = toastElement();
      const moved: string[] = [];
      const app = consoleIn({ '[data-toast]': toast }) as unknown as {
        scope: Scope;
        api: object;
        confirmAction(): Promise<boolean>;
        renderMain(): Promise<void>;
        readTransit(): Promise<null>;
        handOver(
          entity: EntityDescriptor,
          id: string,
          entry: Entry
        ): Promise<void>;
      };
      app.scope = {
        transit: 'ou=transit,dc=example,dc=com',
      } as unknown as Scope;
      app.confirmAction = async () => true;
      app.renderMain = async () => undefined;
      app.readTransit = async () => null;
      Object.assign(app.api, {
        move: async (_entity: EntityDescriptor, id: string) => {
          moved.push(id);
        },
      });
      await app.handOver(users, 'bob', {
        dn: 'uid=bob,ou=users,dc=example,dc=com',
        uid: 'bob',
        twakeDepartmentPath: 'Sales / Germany',
      });
      expect(moved).to.deep.equal(['bob']);
      expect(toast.textContent).to.equal('bob (Sales / Germany) is in transit');

      await app.handOver(users, 'bob', {
        dn: 'uid=bob,ou=users,dc=example,dc=com',
        uid: 'bob',
      });
      expect(toast.textContent).to.equal('bob is in transit');
    });

    it('should explain a refused deletion of an entry still pointed at', async () => {
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
      const staff: EntityDescriptor = {
        ...users,
        schema: {
          attributes: {
            ...usersSchema.attributes,
            title: {
              type: 'pointer',
              branch: ['ou=positions,dc=example,dc=com'],
              label: { en: 'Position', fr: 'Poste' },
            },
          },
        },
      };
      const toast = toastElement();
      const app = consoleIn({ '[data-toast]': toast }, 'fr') as unknown as {
        entities: EntityDescriptor[];
        confirmDelete(entity: EntityDescriptor, id: string): Promise<void>;
        deleteMany(entity: EntityDescriptor, ids: string[]): Promise<boolean>;
      };
      app.entities = [staff, positions];
      Object.assign(app, { confirmAction: async () => true });
      const refusal = {
        error:
          'Cannot delete cn=Sales Manager,ou=positions,dc=example,dc=com: still referenced by another entry (title)',
      };
      nock(baseUrl)
        .delete('/api/v1/ldap/positions/Sales%20Manager')
        .reply(409, refusal);
      await app.confirmDelete(positions, 'Sales Manager');
      expect(toast.textContent).to.equal(
        'Sales Manager est encore utilisé par des entrées (Poste) : modifiez-les d’abord'
      );

      nock(baseUrl)
        .delete('/api/v1/ldap/positions/Sales%20Manager')
        .reply(409, refusal);
      nock(baseUrl).delete('/api/v1/ldap/positions/Intern').reply(403, {
        error: 'Token does not have permission on this branch',
        code: 'forbidden',
      });
      nock(baseUrl)
        .delete('/api/v1/ldap/positions/Trainee')
        .reply(400, { error: 'Not allowed' });
      nock(baseUrl).delete('/api/v1/ldap/positions/Clerk').reply(200, {});
      // Each refusal in the console's words, the entry named once.
      expect(
        await app.deleteMany(positions, [
          'Sales Manager',
          'Intern',
          'Trainee',
          'Clerk',
        ])
      ).to.equal(true);
      expect(toast.textContent).to.equal(
        'Sales Manager est encore utilisé par des entrées (Poste) : modifiez-les d’abord · ' +
          'Vous n’administrez pas Intern : cette modification ne vous revient pas. · ' +
          'Trainee : Le serveur a refusé : Not allowed'
      );
    });

    it('should explain a refused deletion of a non-empty organization', async () => {
      const toast = toastElement();
      const app = consoleIn({ '[data-toast]': toast }, 'fr');
      const dn = 'ou=QA Lab,ou=organization,dc=example,dc=com';
      const organizations = { key: 'organizations' } as EntityDescriptor;
      const call = app as unknown as {
        confirmDeleteOrganization(
          entity: EntityDescriptor,
          entry: Entry,
          dn: string
        ): Promise<void>;
      };
      Object.assign(app, { confirmAction: async () => true });
      nock(baseUrl)
        .delete(`/api/v1/ldap/organizations/${encodeURIComponent(dn)}`)
        .reply(409, { error: `Entry ${dn} is not empty` });
      await call.confirmDeleteOrganization(organizations, { dn }, dn);
      expect(toast.textContent).to.equal(
        'QA Lab n’est pas vide : déplacez ou supprimez d’abord ses entrées'
      );
    });

    it('should keep an open panel, and what was typed, across a change of language', () => {
      const typed = { hidden: false, value: 'E9901' };
      let drawn = false;
      const replaced: unknown[] = [];
      const fresh = {
        hidden: true,
        replaceWith: (element: unknown) => replaced.push(element),
      };
      const app = new DirectoryConsole({
        containerId: 'console',
        apiBaseUrl: baseUrl,
        language: 'en',
      }) as unknown as {
        container: unknown;
        translator: Translator;
        renderMain(): Promise<void>;
        changeLanguage(code: string): void;
      };
      app.container = {
        set innerHTML(_html: string) {
          drawn = true;
        },
        querySelector: (selector: string) =>
          selector === '[data-panel]' ? (drawn ? fresh : typed) : null,
        querySelectorAll: () => [],
      };
      app.renderMain = () => Promise.resolve();
      app.changeLanguage('fr');
      expect(app.translator.language).to.equal('fr');
      expect(replaced).to.deep.equal([typed]);

      // A closed one is drawn afresh, in the new language.
      typed.hidden = true;
      drawn = false;
      app.changeLanguage('en');
      expect(replaced).to.have.length(1);
    });

    it('should name the transit branch in the scope banner, tooltip included', () => {
      const app = consoleIn({}) as unknown as {
        scope: Scope;
        scopeMarkup(): string;
      };
      app.scope = {
        user: 'sophie.martin',
        unrestricted: false,
        branches: [
          {
            dn: 'ou=Sales,ou=organization,dc=example,dc=com',
            name: 'Sales',
            path: 'Sales',
            read: true,
            write: true,
          },
        ],
        entities: [],
        transit: 'ou=Transit,ou=organization,dc=example,dc=com',
      };
      const markup = app.scopeMarkup();
      expect(markup).to.contain('title="Transit">Transit</a>');
      expect(markup).to.not.contain('title="ou=Transit');
      // "Transit Transit (1)" said it twice: the label goes (#171), and
      // stays before a branch named otherwise.
      expect(markup).to.not.contain(
        '<span class="dc-scope-label">Transit</span>'
      );
      app.scope.transit = 'ou=Mobility,ou=organization,dc=example,dc=com';
      expect(app.scopeMarkup())
        .to.contain('<span class="dc-scope-label">Transit</span>')
        .and.contain('title="Mobility">Mobility</a>');
    });
  });

  describe('the list, between visits', () => {
    /**
     * The controls of one drawing of a list. Each repaint binds them again,
     * so only the listener bound last is live, as in a browser.
     */
    const controls = () => {
      const control = (dataset: Record<string, string> = {}) => {
        let handler: ((event: unknown) => void) | undefined;
        const made = {
          value: '',
          dataset,
          fire: () => handler?.({ target: made }),
          addEventListener: (
            _type: string,
            callback: (event: unknown) => void
          ) => {
            handler = callback;
          },
        };
        return made;
      };
      const search = control();
      const field = control();
      const next = control({ page: '1' });
      const holder = stubContainer();
      Object.assign(holder, {
        querySelector: (selector: string) =>
          selector === '[data-search]'
            ? search
            : selector === '[data-search-attribute]'
              ? field
              : null,
        querySelectorAll: (selector: string) =>
          selector === '[data-page]' ? [next] : [],
      });
      return { holder, search, field, next };
    };

    it('should come back to the search, the field and the page it was left on', async () => {
      // Back from a card drew the list anew: an empty box, "Every field",
      // the prompt to type, and no rows.
      const app = consoleIn({});
      const loads: [string | undefined, string | undefined][] = [];
      const entries: Record<string, Entry> = {};
      for (let i = 10; i < 40; i++)
        entries[`alice${i}`] = {
          dn: `uid=alice${i},ou=users,dc=example,dc=com`,
          uid: `alice${i}`,
        };
      Object.assign((app as unknown as { api: object }).api, {
        listBounded: async (
          _entity: EntityDescriptor,
          search?: string,
          attribute?: string
        ) => {
          loads.push([search, attribute]);
          return { entries, truncated: false };
        },
      });
      const visit = async () => {
        const list = controls();
        const main = {
          innerHTML: '',
          querySelector: (selector: string) =>
            selector === '[data-list]' ? list.holder : null,
        };
        await (
          app as unknown as {
            renderList(main: unknown, entity: EntityDescriptor): Promise<void>;
          }
        ).renderList(main, users);
        return list;
      };

      const first = await visit();
      first.field.value = 'mail';
      first.field.fire();
      first.search.value = 'alice';
      first.search.fire();
      await new Promise(resolve => setTimeout(resolve, 300));
      first.next.fire();
      expect(first.holder.innerHTML).to.contain('26–30 of 30');
      expect(loads).to.deep.equal([['alice', 'mail']]);

      const back = await visit();
      expect(loads).to.deep.equal([
        ['alice', 'mail'],
        ['alice', 'mail'],
      ]);
      expect(back.holder.innerHTML)
        .to.contain('value="alice"')
        .and.match(/<option value="mail" selected>/)
        .and.contain('26–30 of 30');
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

  describe('an address naming no page', () => {
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

    /**
     * A console on the page this hash names, its views recording which one
     * was drawn and its navigation which entry was highlighted.
     */
    const visit = async (hash: string, language = 'en') => {
      const main = { innerHTML: '', querySelectorAll: () => [] };
      const nav = ['', 'users', 'organizations', 'mailboxTypes'].map(key => {
        const item = {
          dataset: { nav: key },
          active: false,
          classList: {
            contains: () => false,
            toggle: (_name: string, on: boolean) => {
              item.active = on;
            },
          },
          setAttribute: () => undefined,
          removeAttribute: () => undefined,
        };
        return item;
      });
      const app = new DirectoryConsole({
        containerId: 'console',
        apiBaseUrl: baseUrl,
        language,
      });
      const drawn: string[] = [];
      Object.assign(app as unknown as object, {
        container: {
          querySelector: (selector: string) =>
            selector === '[data-main]' ? main : null,
          querySelectorAll: (selector: string) =>
            selector === '[data-nav]' ? nav : [],
        },
        entities: [users, organizations, mailboxTypes],
        policiesReadable: true,
        renderList: async (_main: unknown, entity: EntityDescriptor) => {
          drawn.push(`list ${entity.key}`);
        },
        renderDetail: async (
          _main: unknown,
          entity: EntityDescriptor,
          id: string
        ) => {
          drawn.push(`detail ${entity.key} ${id}`);
        },
        renderOrganizations: async () => {
          drawn.push('organizations');
        },
        renderPolicies: async () => {
          drawn.push('policies');
        },
      });
      const g = globalThis as Record<string, unknown>;
      const original = g.window;
      g.window = { location: { hash } };
      try {
        await (app as unknown as { followHash(): Promise<void> }).followHash();
      } finally {
        g.window = original;
      }
      return {
        main,
        drawn,
        highlighted: nav
          .filter(item => item.active)
          .map(item => item.dataset.nav),
      };
    };

    it('should say there is no page, with a way to the overview', async () => {
      // A mistyped or outdated link drew the overview, as if it had worked.
      for (const [language, text, link] of [
        ['en', 'There is no page at this address.', 'Go to the Overview'],
        ['fr', 'Il n’y a pas de page à cette adresse.', 'Aller à l’accueil'],
        ['mn', 'Энэ хаягт хуудас алга.', 'Нүүр хуудас руу очих'],
      ]) {
        for (const hash of ['#/passwordPolicies', '#/accountStates/active']) {
          const { main, drawn, highlighted } = await visit(hash, language);
          expect(main.innerHTML)
            .to.include(text)
            .and.include(`href="#/">${link}</a>`)
            .and.not.include('dc-dashboard');
          expect(drawn).to.deep.equal([]);
          expect(highlighted).to.deep.equal([]);
        }
      }
    });

    it('should still open the overview and every page that exists', async () => {
      for (const hash of ['', '#', '#/']) {
        const { main, highlighted } = await visit(hash);
        expect(main.innerHTML).to.include('dc-dashboard');
        expect(highlighted).to.deep.equal(['']);
      }
      const pages: [string, string][] = [
        ['#/users', 'list users'],
        ['#/users/alice', 'detail users alice'],
        ['#/mailboxTypes', 'list mailboxTypes'],
        ['#/organizations', 'organizations'],
        ['#/organizations/ou=Sales', 'organizations'],
        ['#/password-policies', 'policies'],
      ];
      for (const [hash, page] of pages) {
        const { main, drawn } = await visit(hash);
        expect(drawn, hash).to.deep.equal([page]);
        expect(main.innerHTML, hash).to.not.include('There is no page');
      }
    });
  });

  describe('an account administering nothing', () => {
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
    const notice =
      'You administer no branch: there is nothing here for you to manage.';

    /** A console with this scope, which records what it asks the server. */
    const setup = (scope: Scope) => {
      const asked: string[] = [];
      const holder = stubContainer();
      const main = {
        innerHTML: '',
        querySelector: (selector: string): unknown =>
          ({
            '[data-list]': holder,
            '[data-detail]': stubContainer(),
            '[data-tree]': treeContainer(),
          })[selector] ?? null,
      };
      const app = consoleIn({ '[data-main]': main });
      Object.assign(app as unknown as object, {
        scope,
        entities: [users, organizations],
      });
      Object.assign((app as unknown as { api: object }).api, {
        listBounded: async () => {
          asked.push('list');
          return { entries: {}, truncated: false };
        },
        get: async () => {
          asked.push('get');
          return { dn: 'uid=bob,ou=users,dc=example,dc=com', uid: 'bob' };
        },
        organizationTop: async () => {
          asked.push('top');
          return null;
        },
      });
      const views = app as unknown as {
        renderList(main: unknown, entity: EntityDescriptor): Promise<void>;
        renderDetail(
          main: unknown,
          entity: EntityDescriptor,
          id: string,
          generation: number
        ): Promise<void>;
        renderOrganizations(main: unknown, generation: number): Promise<void>;
      };
      return { views, main, holder, asked };
    };
    const nobody: Scope = {
      user: 'alice',
      unrestricted: false,
      described: true,
      branches: [],
      entities: [],
    };

    it('should say there is nothing to manage, and ask nothing the server would refuse', async () => {
      // Each page answered in red with the server's "Token does not have
      // permission on this branch".
      const { views, main, holder, asked } = setup(nobody);
      await views.renderList(main, users);
      expect(holder.innerHTML).to.contain(notice).and.not.contain('error');
      await views.renderDetail(main, users, 'bob', 0);
      expect(main.innerHTML).to.contain(notice);
      await views.renderOrganizations(main, 0);
      expect(main.innerHTML).to.contain(notice);
      expect(asked).to.deep.equal([]);
    });

    it('should still read for an unrestricted or undescribed scope, which names no branch either', async () => {
      for (const scope of [
        { ...nobody, unrestricted: true },
        { ...nobody, described: false },
      ]) {
        const { views, main, holder, asked } = setup(scope);
        await views.renderList(main, users);
        expect(holder.innerHTML).to.not.contain(notice);
        await views.renderDetail(main, users, 'bob', 0);
        await views.renderOrganizations(main, 0);
        expect(asked).to.include.members(['get', 'top']);
      }
    });
  });

  describe('the overview, in names', () => {
    const admin = 'uid=admin,ou=users,dc=example,dc=com';
    const alice = 'uid=alice,ou=users,dc=example,dc=com';
    const global: Scope = {
      user: admin,
      unrestricted: false,
      described: true,
      branches: [
        { dn: 'dc=example,dc=com', read: true, write: true, delete: true },
      ],
      entities: [{ name: 'users', base: users.base, create: true }],
    };
    const nobody: Scope = { ...global, user: alice, branches: [] };

    /**
     * A console for this scope, the account read as `read` answers, and its
     * server offering to sign out.
     */
    const setup = (
      scope: Scope,
      read: () => Promise<Entry> = async () => ({
        dn: admin,
        uid: 'admin',
        cn: 'Ada Admin',
        mail: 'admin@example.com',
      }),
      language = 'en'
    ) => {
      const main = { innerHTML: '', querySelectorAll: () => [] };
      const app = consoleIn({ '[data-main]': main }, language);
      const asked: string[] = [];
      Object.assign(app as unknown as object, {
        scope,
        entities: [users, groups, mailboxTypes],
      });
      Object.assign((app as unknown as { api: object }).api, {
        logoutPath: '/logout',
        get: async (entity: EntityDescriptor, id: string) => {
          asked.push(`${entity.key} ${id}`);
          return read();
        },
      });
      const inner = app as unknown as {
        account: unknown;
        container: { innerHTML: string };
        readAccount(): Promise<unknown>;
        renderDashboard(main: unknown): void;
        drawShell(): void;
        scopeMarkup(): string;
      };
      const overview = async (): Promise<string> => {
        inner.account = await inner.readAccount();
        inner.renderDashboard(main);
        return main.innerHTML;
      };
      const shell = (): string => {
        inner.drawShell();
        return inner.container.innerHTML;
      };
      return { app: inner, asked, overview, shell };
    };

    it('should greet the account by its name and address, read as its card is', async () => {
      // "Signed in as uid=admin,ou=users,dc=example,dc=com"
      const { asked, overview } = setup(global);
      const html = await overview();
      expect(html)
        .to.include('Signed in as Ada Admin (admin@example.com)')
        .and.include('What you can manage')
        .and.include('data-open="users"')
        .and.not.include(admin);
      expect(asked).to.deep.equal(['users admin']);

      const fr = setup(global, undefined, 'fr');
      expect(await fr.overview()).to.include(
        'Connecté en tant que Ada Admin (admin@example.com)'
      );
    });

    it('should fall back to the identifier when the account cannot be read', async () => {
      // A department head's own account, attached to the organization above
      // the one they administer: authz-linid1 hides it from them (#157).
      const local: Scope = {
        ...global,
        branches: [
          {
            dn: 'ou=sales,ou=organization,dc=example,dc=com',
            read: true,
            write: true,
            delete: true,
          },
        ],
      };
      const { asked, overview } = setup(local, async () => {
        throw Object.assign(new Error('Not found'), { status: 404 });
      });
      expect(await overview())
        .to.include('Signed in as admin<')
        .and.not.include(admin);
      // Its link decides, which the scope does not give: it is still asked
      expect(asked).to.deep.equal(['users admin']);
      // Nor is a DN no entity holds greeted whole
      const outside = setup({ ...global, user: 'cn=root,dc=example,dc=com' });
      expect(await outside.overview())
        .to.include('Signed in as root<')
        .and.not.include('cn=root');
      expect(outside.asked).to.deep.equal([]);
      // A user the scope names otherwise than by a DN is shown as it comes
      const plain = setup({ ...global, user: 'admin@example.com' });
      expect(await plain.overview()).to.include(
        'Signed in as admin@example.com<'
      );
      // An account with no address is still named
      const nameless = setup(global, async () => ({ dn: admin, cn: 'Ada' }));
      expect(await nameless.overview()).to.include('Signed in as Ada<');
    });

    it('should tell an account administering nothing once, and where to turn', async () => {
      // Three cards, each opening on "nothing to manage", and a green dot
      const { app, asked, overview, shell } = setup(nobody);
      const html = await overview();
      expect(html)
        .to.include('There is nothing for you to manage here')
        .and.include(
          'Your account (alice) does not administer any part of the directory.'
        )
        .and.match(
          /<a class="dc-button dc-button-primary" href="[^"]+logout">Sign out<\/a>/
        )
        .and.include('Signed in as alice')
        .and.not.include('What you can manage')
        .and.not.include('dc-card')
        .and.not.include('data-open');
      // The server refuses such an account every read: none is asked
      expect(asked).to.deep.equal([]);
      expect(app.scopeMarkup()).to.include('dc-scope-empty dc-scope-none');
      expect(shell())
        .to.include('data-nav=""')
        .and.not.include('data-nav="users"')
        .and.not.include('data-nav-toggle');

      const local = setup({
        ...nobody,
        branches: [
          { dn: 'ou=Sales,dc=example,dc=com', read: true, write: true },
        ],
      });
      expect(local.app.scopeMarkup()).to.not.include('dc-scope-none');
      expect(local.shell())
        .to.include('data-nav="users"')
        .and.include('data-nav="mailboxTypes"');
      expect(await local.overview())
        .to.include('What you can manage')
        .and.not.include('There is nothing for you to manage here');
    });

    it('should name each language in itself', () => {
      const { shell } = setup(global, undefined, 'fr');
      const options = [
        ...shell().matchAll(
          /<option value="(\w+)" lang="(\w+)"[^>]*>([^<]*)</g
        ),
      ].map(([, value, lang, text]) => [value, lang, text]);
      expect(options).to.deep.equal([
        ['en', 'en', 'English'],
        ['fr', 'fr', 'Français'],
        ['mn', 'mn', 'Монгол'],
      ]);
      for (const code of availableLanguages)
        expect(languageName(code), code).to.not.equal(code);
    });
  });

  describe('an account’s groups', () => {
    const john = 'uid=john.doe,ou=users,dc=example,dc=com';
    const accounts: EntityDescriptor = {
      ...users,
      schema: {
        attributes: {
          ...usersSchema.attributes,
          memberOf: {
            type: 'array',
            readOnly: true,
            items: { type: 'string' },
            role: 'groupMemberships',
            label: { en: 'Mailing lists' },
          },
        },
      },
    };
    /** The search the card makes for John's groups. */
    const search = () =>
      nock(baseUrl)
        .get('/api/v1/ldap/groups')
        .query({ match: `(member=${john})`, attributes: 'cn' });

    /** A console about to draw John's card, read as `entry`. */
    const setup = (entry: Entry) => {
      const detail = stubContainer();
      const main = {
        innerHTML: '',
        querySelector: (selector: string): unknown =>
          selector === '[data-detail]' ? detail : null,
      };
      const app = consoleIn({ '[data-main]': main });
      Object.assign(app as unknown as object, {
        entities: [accounts, twakeGroups],
      });
      Object.assign((app as unknown as { api: object }).api, {
        get: async () => entry,
      });
      const render = (generation = 0): Promise<void> =>
        (
          app as unknown as {
            renderDetail(
              main: unknown,
              entity: EntityDescriptor,
              id: string,
              generation: number
            ): Promise<void>;
          }
        ).renderDetail(main, accounts, 'john.doe', generation);
      return { app, detail, render };
    };

    it('should search the groups when the directory keeps no memberOf', async () => {
      // Without the memberof overlay the section was always empty (#70).
      for (const memberOf of [undefined, []]) {
        const asked = search().reply(200, {
          staff: { dn: staff.dn, cn: 'staff' },
        });
        const { detail, render } = setup({
          dn: john,
          uid: 'john.doe',
          memberOf,
        });
        await render();
        expect(asked.isDone()).to.equal(true);
        expect(detail.innerHTML).to.include('<h3>Groups</h3>');
        expect(detail.innerHTML).to.include(
          `data-relation="${staff.dn}">staff<`
        );
      }
    });

    it('should read memberOf when the directory keeps it, and search nothing', async () => {
      const asked = search().reply(200, {});
      const { detail, render } = setup({
        dn: john,
        uid: 'john.doe',
        memberOf: [staff.dn as string],
      });
      await render();
      expect(asked.isDone()).to.equal(false);
      expect(detail.innerHTML).to.include(`data-relation="${staff.dn}">staff<`);
    });

    it('should show the card, with no group, when the search is refused', async () => {
      // ldap-rest before 0.20.1 refuses a dot in the filter.
      search().reply(400, { error: 'Invalid match query' });
      const { detail, render } = setup({ dn: john, uid: 'john.doe' });
      await render();
      expect(detail.innerHTML).to.include('<h3>Groups</h3>');
      expect(detail.innerHTML).to.include('No related entry');
    });

    it('should not draw a card the reader left while its groups were searched', async () => {
      let answer: (dns: string[]) => void = () => undefined;
      const { app, detail, render } = setup({ dn: john, uid: 'john.doe' });
      Object.assign((app as unknown as { api: object }).api, {
        memberships: () =>
          new Promise<string[]>(resolve => {
            answer = resolve;
          }),
      });
      const drawn = render();
      await new Promise(resolve => setTimeout(resolve, 0));
      (app as unknown as { viewGeneration: number }).viewGeneration++;
      answer([staff.dn as string]);
      await drawn;
      expect(detail.innerHTML).to.equal('');
    });

    describe('the panel Add to a group… opens', () => {
      /** An element enough for the picker: attributes, listeners, children. */
      const element = () => {
        const listeners: Record<string, ((event: unknown) => void)[]> = {};
        const attributes: Record<string, string> = {};
        return {
          innerHTML: '',
          hidden: false,
          value: '',
          disabled: false,
          textContent: '',
          children: {} as Record<string, unknown>,
          setAttribute(name: string, value: string) {
            attributes[name] = value;
          },
          getAttribute: (name: string) => attributes[name] ?? null,
          removeAttribute(name: string) {
            delete attributes[name];
          },
          addEventListener(type: string, listener: (event: unknown) => void) {
            (listeners[type] ??= []).push(listener);
          },
          fire(type: string, event: Record<string, unknown> = {}) {
            let prevented = false;
            for (const listener of listeners[type] ?? [])
              listener({
                ...event,
                preventDefault: () => {
                  prevented = true;
                },
              });
            return prevented;
          },
          focus: () => undefined,
          querySelector(selector: string): unknown {
            return this.children[selector] ?? null;
          },
        };
      };
      const groups = [
        {
          dn: 'cn=sales-team,ou=groups',
          name: 'sales-team',
          label: 'sales-team',
        },
        { dn: 'cn=sales-fr,ou=groups', name: 'sales-fr', label: 'sales-fr' },
      ];
      const open = () => {
        const parts = {
          form: element(),
          '#dc-group-search': element(),
          '#dc-group-results': element(),
          '[data-chosen]': element(),
          '[data-error]': element(),
          '[data-add]': element(),
          '[data-cancel]': element(),
        };
        const scrolled: string[] = [];
        // What the list shows of the active option, once drawn.
        parts['#dc-group-results'].querySelector = (selector: string) => ({
          scrollIntoView: () => scrolled.push(selector),
        });
        const container = element();
        container.children = parts;
        new GroupPicker({
          translator: new Translator('en'),
          search: async query =>
            groups.filter(group => group.name.startsWith(query)),
          onAdd: async () => ({ left: [] }),
          onCancel: () => undefined,
        }).render(container as unknown as HTMLElement);
        const input = parts['#dc-group-search'];
        const type = async (text: string): Promise<void> => {
          input.value = text;
          input.fire('input');
        };
        const answered = (): Promise<void> =>
          new Promise(resolve => setTimeout(resolve, 300));
        return {
          input,
          results: parts['#dc-group-results'],
          parts,
          type,
          answered,
          scrolled,
        };
      };

      it('should offer no suggestion of the text typed before while searching the new one', async () => {
        const { input, results, parts, type, answered } = open();
        await type('sales-t');
        await answered();
        expect(results.innerHTML).to.include('sales-team');
        expect(input.getAttribute('aria-activedescendant')).to.equal(
          'dc-group-option-0'
        );
        // Typed on: sales-team is no longer what the box names.
        await type('sales-f');
        expect(results.innerHTML)
          .to.include('Searching…')
          .and.not.include('sales-team');
        expect(input.getAttribute('aria-activedescendant')).to.equal(null);
        expect(input.fire('keydown', { key: 'Enter' })).to.equal(true);
        expect(parts['[data-chosen]'].innerHTML).to.equal('');
        await answered();
        input.fire('keydown', { key: 'Enter' });
        expect(parts['[data-chosen]'].innerHTML)
          .to.include('sales-fr')
          .and.not.include('sales-team');
      });

      it('should walk the suggestions with the arrows, round, and bring the active one into view', async () => {
        const { input, results, type, answered, scrolled } = open();
        await type('sales');
        await answered();
        const active = (): string | null =>
          input.getAttribute('aria-activedescendant');
        expect(active()).to.equal('dc-group-option-0');
        input.fire('keydown', { key: 'ArrowDown' });
        expect(active()).to.equal('dc-group-option-1');
        expect(results.innerHTML).to.match(
          /id="dc-group-option-1"[^>]*aria-selected="true"/
        );
        input.fire('keydown', { key: 'ArrowDown' });
        expect(active()).to.equal('dc-group-option-0');
        input.fire('keydown', { key: 'ArrowUp' });
        expect(active()).to.equal('dc-group-option-1');
        expect(scrolled[scrolled.length - 1]).to.equal('#dc-group-option-1');
      });
    });

    describe('managed from the card', () => {
      const top = 'ou=organization,dc=example,dc=com';
      const sales = `ou=Sales,${top}`;
      const engineering = `ou=Engineering,${top}`;
      const typedGroups: EntityDescriptor = {
        ...twakeGroups,
        schema: {
          attributes: {
            ...twakeGroups.schema.attributes,
            mail: { type: 'string', role: 'primaryEmail' },
            twakeMailboxType: {
              type: 'pointer',
              role: 'mailboxType',
              branch: [mailboxTypes.base as string],
            },
          },
        },
      };
      const group = (cn: string, link: string, type = 'group'): Entry => ({
        dn: `cn=${cn},ou=groups,dc=example,dc=com`,
        cn,
        mail: `${cn}@example.com`,
        twakeMailboxType: `cn=${type},${mailboxTypes.base}`,
        twakeDepartmentLink: link,
      });
      const salesTeam = group('sales-team', sales, 'teamMailbox');
      const engineers = group('engineering', engineering);
      /** Sophie, local administrator of Sales. */
      const sophie: Scope = {
        user: 'uid=sophie.martin,ou=users,dc=example,dc=com',
        unrestricted: false,
        described: true,
        branches: [{ dn: sales, read: true, write: true, delete: true }],
        entities: [],
      };
      const card = (scope: Scope | null, link = sales) => {
        const { app, detail, render } = setup({
          dn: john,
          uid: 'john.doe',
          twakeDepartmentLink: link,
          memberOf: [salesTeam.dn as string, engineers.dn as string],
        });
        Object.assign(app as unknown as object, {
          scope,
          entities: [accounts, typedGroups, mailboxTypes],
        });
        const account = (
          app as unknown as {
            api: { get(entity: EntityDescriptor, id: string): unknown };
          }
        ).api;
        const read = account.get;
        account.get = async (entity: EntityDescriptor, id: string) =>
          entity === typedGroups
            ? [salesTeam, engineers].find(item => item.cn === id)
            : read(entity, id);
        return { app, detail, render };
      };

      it('should say each group’s type, and offer Add to a group… and a × on each', async () => {
        const { detail, render } = card(null);
        await render();
        expect(detail.innerHTML)
          .to.include('<h3>Groups</h3>')
          .and.include('data-add-groups>Add to a group…</button>')
          .and.include(
            // A link: a middle click opens it in a new tab.
            `<a href="#&#x2F;${typedGroups.key}&#x2F;sales-team" class="dc-link" data-relation="${salesTeam.dn}">sales-team</a><span class="dc-relation-note">· Shared mailbox</span>`
          )
          .and.include('aria-label="Remove from sales-team"')
          .and.include('aria-label="Remove from engineering"');
        // memberOf is the section, not a field of Details as well.
        expect(detail.innerHTML).to.not.include('<dt>Mailing lists</dt>');
      });

      it('should offer a × only on the groups a local administrator writes', async () => {
        const { detail, render } = card(sophie);
        await render();
        expect(detail.innerHTML)
          .to.include('data-add-groups')
          .and.include('aria-label="Remove from sales-team"')
          .and.not.include('aria-label="Remove from engineering"');
        // Still listed, with its type: only the × goes.
        expect(detail.innerHTML).to.include(
          `data-relation="${engineers.dn}">engineering</a><span class="dc-relation-note">· Group</span></li>`
        );
      });

      it('should not offer Add to a group… on an account the caller does not write', async () => {
        const { detail, render } = card(sophie, engineering);
        await render();
        expect(detail.innerHTML).to.not.include('data-add-groups');
      });

      it('should offer only the groups the caller writes and the account is not in', async () => {
        const { app } = card(sophie);
        const other = group('sales-fr', `ou=France,${sales}`);
        nock(baseUrl)
          .get('/api/v1/ldap/groups')
          .query(true)
          .reply(200, {
            // More groups Sophie may not write than are offered, answered
            // first: left out before the answer is cut, not after.
            ...Object.fromEntries(
              Array.from({ length: 25 }, (_, index) => [
                `eng-${index}`,
                group(`eng-${index}`, engineering),
              ])
            ),
            'sales-team': salesTeam,
            'sales-fr': other,
            engineering: engineers,
          });
        let picker: { options: { search(query: string): Promise<unknown> } } =
          undefined as never;
        Object.assign(app as unknown as object, {
          openPanel: (_title: string, build: (body: unknown) => void) => {
            const body = stubContainer();
            build(body);
          },
        });
        const original = GroupPicker.prototype.render;
        GroupPicker.prototype.render = function (this: GroupPicker) {
          picker = this as unknown as typeof picker;
        };
        try {
          (
            app as unknown as {
              addToGroups(entry: Entry, name: string, held: string[]): void;
            }
          ).addToGroups({ dn: john }, 'John Doe', [salesTeam.dn as string]);
        } finally {
          GroupPicker.prototype.render = original;
        }
        expect(await picker.options.search('sal')).to.deep.equal([
          {
            dn: other.dn,
            name: 'sales-fr',
            label: 'sales-fr — Group — sales-fr@example.com',
          },
        ]);
      });

      it('should add the account to each group chosen, and keep a refused one with why', async () => {
        const toast = toastElement();
        const { app } = card(sophie);
        Object.assign(app as unknown as object, {
          container: {
            querySelector: (selector: string) =>
              selector === '[data-toast]' ? toast : null,
            querySelectorAll: () => [],
          },
          renderMain: async () => undefined,
        });
        let picker: {
          options: {
            search(query: string): Promise<unknown>;
            onAdd(
              groups: { dn: string; name: string; label: string }[]
            ): Promise<{ left: unknown[]; error?: string }>;
          };
        } = undefined as never;
        const original = GroupPicker.prototype.render;
        GroupPicker.prototype.render = function (this: GroupPicker) {
          picker = this as unknown as typeof picker;
        };
        Object.assign(app as unknown as object, {
          openPanel: (_title: string, build: (body: unknown) => void) =>
            build(stubContainer()),
        });
        const fr = group('sales-fr', `ou=France,${sales}`);
        const de = group('sales-de', `ou=Germany,${sales}`);
        const uk = group('sales-uk', `ou=UK,${sales}`);
        try {
          (
            app as unknown as {
              addToGroups(entry: Entry, name: string, held: string[]): void;
            }
          ).addToGroups({ dn: john }, 'John Doe', []);
        } finally {
          GroupPicker.prototype.render = original;
        }
        nock(baseUrl)
          .get('/api/v1/ldap/groups')
          .query(true)
          .reply(200, { 'sales-fr': fr, 'sales-de': de, 'sales-uk': uk });
        const offered = (await picker.options.search('sales')) as {
          dn: string;
          name: string;
          label: string;
        }[];
        const added = nock(baseUrl)
          .post('/api/v1/ldap/groups/sales-fr/members', { member: [john] })
          .reply(200, {});
        for (const refused of ['sales-de', 'sales-uk'])
          nock(baseUrl)
            .post(`/api/v1/ldap/groups/${refused}/members`)
            .reply(403, {
              error: 'Token does not have permission on this branch',
              code: 'forbidden',
            });
        const result = await picker.options.onAdd(offered);
        expect(added.isDone()).to.equal(true);
        expect(toast.textContent).to.equal('John Doe added to sales-fr');
        expect(result.left).to.deep.equal([offered[1], offered[2]]);
        // Each refusal said with its group, when there are several.
        expect(result.error).to.equal(
          'sales-de: You do not administer sales-de: this change is not yours to make. ' +
            'sales-uk: You do not administer sales-uk: this change is not yours to make.'
        );

        // A group joined is not offered again: the server would refuse it.
        nock(baseUrl)
          .get('/api/v1/ldap/groups')
          .query(true)
          .reply(200, { 'sales-fr': fr, 'sales-de': de, 'sales-uk': uk });
        expect(
          ((await picker.options.search('sales')) as { name: string }[]).map(
            found => found.name
          )
        ).to.deep.equal(['sales-de', 'sales-uk']);
      });

      it('should take the account out of a group in one click, and say so', async () => {
        const toast = toastElement();
        const app = consoleIn({ '[data-toast]': toast }) as unknown as {
          entities: EntityDescriptor[];
          renderMain(): Promise<void>;
          leaveGroup(entry: Entry, name: string, dn: string): Promise<void>;
        };
        app.entities = [accounts, typedGroups];
        app.renderMain = async () => undefined;
        const removed = nock(baseUrl)
          .delete(
            `/api/v1/ldap/groups/sales-team/members/${encodeURIComponent(john)}`
          )
          .reply(200, {});
        await app.leaveGroup({ dn: john }, 'John Doe', salesTeam.dn as string);
        expect(removed.isDone()).to.equal(true);
        expect(toast.textContent).to.equal('John Doe removed from sales-team');
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
          inheritsDomains(entity: EntityDescriptor): boolean;
        }
      ).inheritsDomains(organizations);
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

    it('should learn where groups take members outside the directory', async () => {
      nock(baseUrl)
        .get('/api/v1/config')
        .reply(200, {
          apiPrefix: '/api',
          features: {
            externalUsersInGroups: {
              enabled: true,
              branch: 'ou=external,dc=example,dc=com',
              rdnAttribute: 'mail',
              managedDomains: ['Example.com'],
            },
          },
        });
      const client = new ConsoleApiClient(baseUrl);
      expect(client.externalMembers).to.equal(undefined);
      await client.discover();
      expect(client.externalMembers).to.deep.equal({
        branch: 'ou=external,dc=example,dc=com',
        rdnAttribute: 'mail',
        managedDomains: ['example.com'],
      });

      // An ldap-rest that predates it publishes nothing.
      nock(baseUrl)
        .get('/api/v1/config')
        .reply(200, { apiPrefix: '/api', features: {} });
      await client.discover();
      expect(client.externalMembers).to.equal(undefined);
    });

    it('should learn whether team mailboxes keep their members to their domain', async () => {
      const client = new ConsoleApiClient(baseUrl);
      const learn = async (features: object): Promise<boolean> => {
        nock(baseUrl)
          .get('/api/v1/config')
          .reply(200, { apiPrefix: '/api', features });
        await client.discover();
        return client.teamMailboxesKeepDomain;
      };
      expect(client.teamMailboxesKeepDomain).to.equal(false);
      expect(await learn({ james: { teamMailboxAnyDomain: false } })).to.equal(
        true
      );
      expect(await learn({ james: { teamMailboxAnyDomain: true } })).to.equal(
        false
      );
      // An ldap-rest that predates the rule, or no Twake Mail: nothing kept.
      expect(await learn({})).to.equal(false);
    });

    it('should learn how the deployment writes a full name', async () => {
      const learn = async (console?: object): Promise<string | undefined> => {
        const client = new ConsoleApiClient(baseUrl);
        nock(baseUrl)
          .get('/api/v1/config')
          .reply(200, { apiPrefix: '/api', features: { console } });
        await client.discover();
        return client.fullNameFormat;
      };
      expect(await learn({ fullNameFormat: '{surname} {givenName}' })).to.equal(
        '{surname} {givenName}'
      );
      // Unset, empty or an image that predates it: the console's default.
      expect(await learn({ fullNameFormat: '' })).to.equal(undefined);
      expect(await learn({ hiddenAttributes: [] })).to.equal(undefined);
    });

    it('should leave out the attributes the deployment hides', async () => {
      // Under "Mailbox settings" with no effect in a Twake deployment, they
      // were filled in by administrators expecting one (#62, #63).
      nock(baseUrl)
        .get('/api/v1/config')
        .reply(200, {
          apiPrefix: '/api',
          features: {
            console: { hiddenAttributes: ['twakeOtherMailbox', 'MAIL'] },
            ldapFlatGeneric: {
              flatResources: [
                {
                  name: 'twakeUser',
                  singularName: 'user',
                  pluralName: 'users',
                  mainAttribute: 'uid',
                  base: 'ou=users,dc=example,dc=com',
                  schema: {
                    attributes: {
                      ...usersSchema.attributes,
                      twakeOtherMailbox: { type: 'array' },
                    },
                  },
                },
              ],
            },
          },
        });
      const [user] = await new ConsoleApiClient(baseUrl).discover();
      expect(user.schema.attributes).to.not.have.property('twakeOtherMailbox');
      // Named whatever the case, as LDAP names attributes.
      expect(user.schema.attributes).to.not.have.property('mail');
      expect(user.schema.attributes).to.have.property('uid');
      // The server's own schema is left as it came.
      expect(usersSchema.attributes).to.have.property('mail');
    });

    describe('the groups an account belongs to', () => {
      const john = 'uid=john.doe,ou=users,dc=example,dc=com';

      it('should search the groups holding the DN as a member', async () => {
        // Without the memberof overlay, `memberOf` is empty and the card
        // listed no mailing list (#70). The Twake groups are large, being
        // attached to the organization tree: the exact search is bounded
        // by itself, and asked all the same.
        expect(isLarge(twakeGroups)).to.equal(true);
        nock(baseUrl)
          .get('/api/v1/ldap/groups')
          .query({ match: `(member=${john})`, attributes: 'cn' })
          .reply(200, {
            staff: { dn: staff.dn, cn: 'staff' },
          });
        const found = await new ConsoleApiClient(baseUrl).memberships(john, [
          users,
          twakeGroups,
        ]);
        expect(found).to.deep.equal([staff.dn]);
      });

      it('should find no group where ldap-rest refuses the filter', async () => {
        // ldap-rest before 0.20.1 refused a dot in it.
        nock(baseUrl)
          .get('/api/v1/ldap/groups')
          .query(true)
          .reply(400, { error: 'Invalid match query' });
        const found = await new ConsoleApiClient(baseUrl).memberships(john, [
          twakeGroups,
        ]);
        expect(found).to.deep.equal([]);
      });

      it('should ask nothing for a DN no filter can hold', async () => {
        const groupList = nock(baseUrl)
          .get('/api/v1/ldap/groups')
          .query(true)
          .reply(200, { staff });
        const client = new ConsoleApiClient(baseUrl);
        // An escaped comma, and a `+` joining a second attribute to the RDN,
        // which ldap-rest refuses in a filter.
        for (const dn of [
          'cn=Smith\\, John,ou=users,dc=example,dc=com',
          'cn=John+uid=jdoe,ou=users,dc=example,dc=com',
        ])
          expect(await client.memberships(dn, [twakeGroups])).to.deep.equal([]);
        expect(groupList.isDone()).to.equal(false);
      });

      it('should fail, when asked to, where the groups cannot be searched', async () => {
        // The deletion dialog tells groups it could not list from none (#157).
        const client = new ConsoleApiClient(baseUrl);
        const refusedDn = 'cn=Smith\\, John,ou=users,dc=example,dc=com';
        const failure = async (search: Promise<unknown>): Promise<unknown> =>
          search.then(
            () => undefined,
            (err: unknown) => err
          );
        expect(
          await failure(client.memberships(refusedDn, [twakeGroups], true))
        ).to.be.instanceOf(Error);
        for (const status of [403, 500]) {
          nock(baseUrl)
            .get('/api/v1/ldap/groups')
            .query(true)
            .reply(status, { error: 'No' });
          const err = await failure(
            client.memberships(john, [users, twakeGroups], true)
          );
          expect(err).to.have.property('status', status);
        }
        // Found none is not a failure
        nock(baseUrl).get('/api/v1/ldap/groups').query(true).reply(200, {});
        expect(
          await client.memberships(john, [twakeGroups], true)
        ).to.deep.equal([]);
      });

      it('should search a DN holding an apostrophe', async () => {
        const dn = "uid=o'brien,ou=users,dc=example,dc=com";
        nock(baseUrl)
          .get('/api/v1/ldap/groups')
          .query({ match: `(member=${dn})`, attributes: 'cn' })
          .reply(200, { staff: { dn: staff.dn, cn: 'staff' } });
        const found = await new ConsoleApiClient(baseUrl).memberships(dn, [
          twakeGroups,
        ]);
        expect(found).to.deep.equal([staff.dn]);
      });
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
        expect(await client.organizationSearchRead('lin')).to.deep.equal({
          organizations: [
            { dn: `ou=c,${orgTop}`, label: 'Gamma' },
            { dn: `ou=a,${orgTop}`, label: 'Government / Alpha' },
            { dn: `ou=b,${orgTop}`, label: 'Government / Beta' },
          ],
          // The sentinel says the server kept only these.
          truncated: true,
        });
      });

      it('should say a search is cut only when it was', async () => {
        const client = await discover('/api/v1/ldap/organizations/:dn/search');
        const matches = ['a', 'b', 'c'].map(ou => ({
          dn: `ou=${ou},${orgTop}`,
          ou,
          objectClass: ['organizationalUnit'],
        }));
        nock(baseUrl)
          .get(
            `/api/v1/ldap/organizations/${encodeURIComponent(orgTop)}/search`
          )
          .query(true)
          .times(3)
          .reply(200, matches);
        // Whole.
        expect(
          (await client.organizationSearchRead('x', orgTop, Infinity)).truncated
        ).to.equal(false);
        // Cut here, to the suggestions' length.
        const cut = await client.organizationSearchRead('x', orgTop, 2);
        expect(cut.organizations.map(option => option.label)).to.deep.equal([
          'a',
          'b',
        ]);
        expect(cut.truncated).to.equal(true);
        // The form's suggestions keep their plain list.
        expect(await client.organizationSearch('x', orgTop, 3)).to.have.length(
          3
        );
      });

      it('should search from the caller’s own top, not the directory’s', async () => {
        const client = await discover('/api/v1/ldap/organizations/:dn/search');
        const sales = `ou=Sales,${orgTop}`;
        // A local administrator of Sales: the server narrows the top to it.
        nock(baseUrl)
          .get('/api/v1/ldap/organizations/top')
          .once()
          .reply(200, { dn: sales, ou: 'Sales' });
        const searched: string[] = [];
        nock(baseUrl)
          .get(/\/api\/v1\/ldap\/organizations\/[^/]+\/search/)
          .query(true)
          .times(2)
          .reply(function (uri) {
            searched.push(decodeURIComponent(uri.split('/')[5]));
            return [200, [{ dn: `ou=France,${sales}`, ou: 'France' }]];
          });
        const search = client.pointerSearch('dc=example,dc=com', []);
        expect(await search?.('Fra')).to.deep.equal([
          { dn: `ou=France,${sales}`, label: 'France' },
        ]);
        // The top is asked once for the field, not at every keystroke.
        await search?.('Fran');
        expect(searched).to.deep.equal([sales, sales]);
        expect(nock.isDone()).to.be.true;
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

    it('should hand on what ldap-rest says of a refusal besides its sentence', async () => {
      nock(baseUrl).post('/api/v1/ldap/users').reply(409, {
        error:
          'user: "alice@example.com" is already used (mail must be unique)',
        code: 'unique',
        attribute: 'mail',
        value: 'alice@example.com',
      });
      nock(baseUrl)
        .post('/api/v1/ldap/users')
        .reply(409, { error: 'Conflict' });

      const client = new ConsoleApiClient(baseUrl);
      const refusal = (err: unknown) => (err as { refusal?: unknown }).refusal;
      const first = await client
        .create(users, { mail: 'alice@example.com' })
        .catch((err: unknown) => err);
      expect(refusal(first)).to.deep.equal({
        code: 'unique',
        attribute: 'mail',
        value: 'alice@example.com',
      });
      // An older server, or another refusal: nothing besides the sentence.
      const second = await client
        .create(users, { mail: 'alice@example.com' })
        .catch((err: unknown) => err);
      expect((second as Error).message).to.equal('Conflict');
      expect(refusal(second)).to.equal(undefined);
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
      expect(members.entries.map(member => member.label)).to.deep.equal([
        'jsmith',
      ]);
    });

    it('should keep the count of the attached entries the server left out', async () => {
      // The card listed the fifty names the server sent and stopped there,
      // reading as a department of fifty: the count went with the row.
      const dn = 'ou=Sales,ou=organization,dc=example,dc=com';
      const subnodes = (rows: object[]) =>
        nock(baseUrl)
          .get(`/api/v1/ldap/organizations/${encodeURIComponent(dn)}/subnodes`)
          .reply(200, [
            {
              dn: 'uid=jsmith,ou=users,dc=example,dc=com',
              objectClass: ['inetOrgPerson'],
            },
            ...rows,
          ]);
      const client = new ConsoleApiClient(baseUrl);

      subnodes([
        {
          dn: `more-${dn}`,
          objectClass: ['moreIndicator'],
          _isMoreIndicator: 'true',
          _totalCount: '98',
          _displayedCount: '50',
        },
      ]);
      expect(await client.organizationMembers(dn)).to.deep.include({
        truncated: true,
        more: 48,
      });

      // A directory refusing to list them all lets nothing count the rest.
      subnodes([
        {
          dn: `more-${dn}`,
          objectClass: ['moreIndicator'],
          _isMoreIndicator: 'true',
          _displayedCount: '50',
        },
      ]);
      const uncounted = await client.organizationMembers(dn);
      expect(uncounted.truncated).to.equal(true);
      expect(uncounted.more).to.equal(undefined);

      // The child organizations' own row says nothing of the entries.
      subnodes([
        {
          dn: `more-organizations-${dn}`,
          objectClass: ['moreIndicator'],
          _isMoreIndicator: 'true',
          _displayedCount: '50',
        },
      ]);
      expect(await client.organizationMembers(dn)).to.deep.equal({
        entries: [
          { dn: 'uid=jsmith,ou=users,dc=example,dc=com', label: 'jsmith' },
        ],
        truncated: false,
      });
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
          // Once chosen, named by its identifier, as a value loaded is.
          token: 'jane.doe',
        },
        // No display name: the identifier alone.
        {
          dn: 'uid=jdoe,ou=users,dc=example,dc=com',
          label: 'jdoe',
          token: 'jdoe',
        },
      ]);
    });

    it('should search members by email among accounts and groups', async () => {
      const lists: EntityDescriptor = {
        ...groups,
        schema: {
          attributes: {
            ...groups.schema.attributes,
            mail: { type: 'string', role: 'primaryEmail', searchable: true },
          },
        },
      };
      const client = new ConsoleApiClient(baseUrl);
      // Neither a nomenclature nor anything else without an address.
      expect(client.memberSearch('members', [mailboxTypes])).to.equal(
        undefined
      );
      nock(baseUrl)
        .get('/api/v1/ldap/users')
        .query(query => query.match === 'jane' && Boolean(query.attribute))
        .twice()
        .reply(200, {
          jane: {
            dn: 'uid=jane,ou=users,dc=example,dc=com',
            cn: 'Jane Doe',
            mail: 'jane@example.com',
          },
        });
      nock(baseUrl)
        .get('/api/v1/ldap/groups')
        .query(query => query.match === 'jane')
        .reply(200, {
          'jane-team': {
            dn: 'cn=jane-team,ou=groups,dc=example,dc=com',
            mail: 'jane-team@example.com',
          },
        });
      const members = client.memberSearch('members', [users, lists]);
      expect(await members!('jane')).to.deep.equal([
        {
          dn: 'uid=jane,ou=users,dc=example,dc=com',
          label: 'Jane Doe <jane@example.com>',
          token: 'jane',
          mail: 'jane@example.com',
        },
        {
          dn: 'cn=jane-team,ou=groups,dc=example,dc=com',
          label: 'jane-team <jane-team@example.com>',
          token: 'jane-team',
          mail: 'jane-team@example.com',
        },
      ]);
      // An owner is an account: the groups are not asked.
      const owners = client.memberSearch('owners', [users, lists]);
      expect(await owners!('jane')).to.have.length(1);
    });

    it('should search the members a caller can read when a branch refuses', async () => {
      const lists: EntityDescriptor = {
        ...groups,
        schema: {
          attributes: {
            ...groups.schema.attributes,
            mail: { type: 'string', role: 'primaryEmail' },
          },
        },
      };
      nock(baseUrl)
        .get('/api/v1/ldap/users')
        .query(true)
        .reply(200, {
          jane: { dn: 'uid=jane,ou=users,dc=example,dc=com', cn: 'Jane' },
        });
      nock(baseUrl).get('/api/v1/ldap/groups').query(true).reply(403, {});
      const search = new ConsoleApiClient(baseUrl).memberSearch('members', [
        users,
        lists,
      ]);
      expect(await search!('jane')).to.deep.equal([
        {
          dn: 'uid=jane,ou=users,dc=example,dc=com',
          label: 'Jane',
          token: 'jane',
        },
      ]);
    });

    it('should leave room for the groups when many accounts match', async () => {
      const lists: EntityDescriptor = {
        ...groups,
        schema: {
          attributes: {
            ...groups.schema.attributes,
            mail: { type: 'string', role: 'primaryEmail' },
          },
        },
      };
      const accounts: Record<string, Entry> = {};
      for (let i = 0; i < 30; i++)
        accounts[`jane${i}`] = {
          dn: `uid=jane${i},ou=users,dc=example,dc=com`,
          cn: `Jane ${i}`,
        };
      // Answered without its DN: no member can be written from it.
      accounts.nodn = { cn: 'No DN' };
      nock(baseUrl).get('/api/v1/ldap/users').query(true).reply(200, accounts);
      nock(baseUrl)
        .get('/api/v1/ldap/groups')
        .query(true)
        .reply(200, {
          'jane-team': { dn: 'cn=jane-team,ou=groups,dc=example,dc=com' },
        });
      const found = await new ConsoleApiClient(baseUrl).memberSearch(
        'members',
        [users, lists]
      )!('jane');
      expect(found.map(option => option.dn)).to.include(
        'cn=jane-team,ou=groups,dc=example,dc=com'
      );
      expect(found.map(option => option.label)).not.to.include('No DN');
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

    it('should offer only the entries of a branch that the schema describes', async () => {
      // A tree of mail domains keeps DNS levels to hang them from: `dc=com`
      // has no `associatedDomain`, and is no mail domain to link to (#58).
      const domains: EntityDescriptor = {
        key: 'domains',
        pluralName: 'domains',
        singularName: 'domain',
        mainAttribute: 'dc',
        base: 'ou=domains,ou=nomenclature,dc=example,dc=com',
        schema: {
          attributes: {
            dc: { type: 'string', required: true, role: 'identifier' },
            associatedDomain: {
              type: 'string',
              required: true,
              role: ['domainName', 'displayName'],
            },
            userPassword: { type: 'string', required: true, neverReturn: true },
          },
        },
        endpoint: '/api/v1/ldap/domains',
        kind: 'flat',
      };
      const tree = {
        org: { dn: `dc=org,${domains.base}`, dc: 'org' },
        example: {
          dn: `dc=example,dc=org,${domains.base}`,
          dc: 'example',
        },
        sales: {
          dn: `dc=sales,dc=example,dc=org,${domains.base}`,
          dc: 'sales',
          associatedDomain: 'sales.example.org',
        },
      };
      const client = new ConsoleApiClient(baseUrl);

      nock(baseUrl).get('/api/v1/ldap/domains').reply(200, tree);
      const options = await client.pointerOptions(domains.base as string, [
        domains,
      ]);
      expect(options).to.deep.equal([
        {
          dn: `dc=sales,dc=example,dc=org,${domains.base}`,
          label: 'sales.example.org',
        },
      ]);

      // A CSV import finds them the same way.
      const lookup = client.pointerLookup(domains.base as string, [domains])!;
      nock(baseUrl).get('/api/v1/ldap/domains').query(true).reply(200, tree);
      const found = await lookup.search('o');
      expect(found.options.map(option => option.label)).to.deep.equal([
        'sales.example.org',
      ]);
      nock(baseUrl).get('/api/v1/ldap/domains/org').reply(200, tree.org);
      expect(await lookup.read('org')).to.equal(undefined);
    });

    it('should name an entry by the attribute its schema calls its display name', async () => {
      // A mail domain is stored as `dc=example` and read as `example.org`.
      const domains: EntityDescriptor = {
        key: 'domains',
        pluralName: 'domains',
        singularName: 'domain',
        mainAttribute: 'dc',
        base: 'ou=domains,ou=nomenclature,dc=example,dc=com',
        schema: {
          attributes: {
            dc: { type: 'string', role: 'identifier' },
            associatedDomain: {
              type: 'string',
              role: ['domainName', 'displayName'],
            },
          },
        },
        endpoint: '/api/v1/ldap/domains',
        kind: 'flat',
      };
      nock(baseUrl)
        .get('/api/v1/ldap/domains')
        .reply(200, {
          example: {
            dn: `dc=example,${domains.base}`,
            associatedDomain: 'example.org',
          },
          bare: { dn: `dc=bare,${domains.base}` },
          one: { dn: `dc=one,${domains.base}`, associatedDomain: 'twin.org' },
          two: { dn: `dc=two,${domains.base}`, associatedDomain: 'twin.org' },
        });

      const options = await new ConsoleApiClient(baseUrl).pointerOptions(
        domains.base as string,
        [domains]
      );
      // Two entries going by one name are told apart by their identifiers.
      expect(options.map(option => option.label)).to.deep.equal([
        'example.org',
        'bare',
        'twin.org (one)',
        'twin.org (two)',
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
      // Any other failure keeps its own words; a refusal is said plainly.
      expect(failed(400, 'Unbalanced filter')).to.equal('Unbalanced filter');
      expect(
        failed(403, 'Token does not have permission on this branch')
      ).to.equal('You may not see these entries');
    });

    describe('the mail domains of a form', () => {
      const top = 'ou=organization,dc=example,dc=com';
      const sales = `ou=Sales,${top}`;
      const europe = `ou=Europe,${sales}`;
      const support = `ou=Support,${top}`;
      const domainsBase = 'ou=domains,ou=nomenclature,dc=example,dc=com';
      const domains: EntityDescriptor = {
        key: 'domains',
        pluralName: 'domains',
        singularName: 'domain',
        mainAttribute: 'dc',
        base: domainsBase,
        schema: {
          attributes: {
            dc: { type: 'string', required: true, role: 'identifier' },
            associatedDomain: {
              type: 'string',
              required: true,
              role: ['domainName', 'displayName'],
            },
          },
        },
        endpoint: '/api/v1/ldap/domains',
        kind: 'flat',
      };
      const organizations: EntityDescriptor = {
        key: 'organizations',
        pluralName: 'organizations',
        singularName: 'organization',
        mainAttribute: 'ou',
        base: top,
        schema: {
          attributes: {
            ou: { type: 'string', role: 'identifier' },
            twakeDomainLink: {
              type: 'array',
              role: 'domainLink',
              items: { type: 'pointer', branch: [domainsBase] },
            },
          },
        },
        endpoint: '/api/v1/ldap/organizations',
        kind: 'organization',
      };
      const dn = (name: string): string => `dc=${name},${domainsBase}`;
      const tree = {
        com: { dn: `dc=com,${domainsBase}`, dc: 'com' },
        example: {
          dn: dn('example'),
          dc: 'example',
          associatedDomain: 'Example.com',
        },
        lists: {
          dn: dn('lists'),
          dc: 'lists',
          associatedDomain: 'lists.example.com',
        },
        other: { dn: dn('other'), dc: 'other', associatedDomain: 'other.org' },
        any: { dn: dn('any'), dc: 'any', associatedDomain: '*' },
      };
      const client = (): ConsoleApiClient => {
        const made = new ConsoleApiClient(baseUrl);
        Object.assign(made as unknown as object, { topOrganization: top });
        return made;
      };
      const organization = (at: string, links: string[]): nock.Scope =>
        nock(baseUrl)
          .get(`/api/v1/ldap/organizations/${encodeURIComponent(at)}`)
          .reply(200, { dn: at, twakeDomainLink: links });

      it('should know the domains’ branch by the role of their name', () => {
        const entities = [users, organizations, domains];
        expect(isDomainBranch(entities, domainsBase)).to.equal(true);
        expect(isDomainBranch(entities, domainsBase.toUpperCase())).to.equal(
          true
        );
        expect(isDomainBranch(entities, users.base)).to.equal(false);
        expect(client().mailDomains([users, organizations])).to.equal(
          undefined
        );
      });

      it('should offer what the organization and those above it link, read once', async () => {
        const lookup = client().mailDomains([organizations, domains])!;
        nock(baseUrl).get('/api/v1/ldap/domains').reply(200, tree);
        organization(europe, [dn('lists')]);
        organization(sales, [dn('example')]);
        organization(top, []);
        expect(await lookup.names(europe)).to.deep.equal([
          'example.com',
          'lists.example.com',
        ]);
        // A sibling department shares the organizations above it: only its
        // own is read, and the domains are not listed again.
        organization(`ou=Asia,${sales}`, []);
        expect(await lookup.names(`ou=Asia,${sales}`)).to.deep.equal([
          'example.com',
        ]);
        expect(await lookup.linked(europe)).to.deep.equal([
          dn('lists'),
          dn('example'),
        ]);
        expect(nock.isDone()).to.equal(true);
      });

      it('should offer every domain but "*" where nothing narrows them', async () => {
        const lookup = client().mailDomains([organizations, domains])!;
        nock(baseUrl).get('/api/v1/ldap/domains').reply(200, tree);
        const every = ['example.com', 'lists.example.com', 'other.org'];
        // Attached to nothing.
        expect(await lookup.names()).to.deep.equal(every);
        // Linking nothing, which the server reads as no restriction.
        organization(support, []);
        organization(top, []);
        expect(await lookup.names(support)).to.deep.equal(every);
        // Linking "*", which allows every domain.
        organization(sales, [dn('any')]);
        expect(await lookup.names(sales)).to.deep.equal(every);
        // An organization above that cannot be read: the server judges.
        nock(baseUrl)
          .get(
            `/api/v1/ldap/organizations/${encodeURIComponent(`ou=Lost,${top}`)}`
          )
          .reply(403, { error: 'Forbidden' });
        expect(await lookup.names(`ou=Lost,${top}`)).to.deep.equal(every);
      });

      it('should refuse to name any when the domains cannot be read', async () => {
        const lookup = client().mailDomains([organizations, domains])!;
        nock(baseUrl)
          .get('/api/v1/ldap/domains')
          .reply(403, { error: 'Forbidden' });
        let failed: unknown;
        await lookup.names().catch((err: unknown) => {
          failed = err;
        });
        expect((failed as { status?: number }).status).to.equal(403);
      });
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

    it('should show an account’s state as a badge when it is an exception', async () => {
      // "Disabled" read like the "Active" around it: a scan down the column
      // missed it (#172). The text stays; Active stays plain.
      const container = stubContainer();
      await new EntityList({
        entity: users,
        translator: new Translator('en'),
        load: () =>
          Promise.resolve({
            alice: { uid: 'alice', twakeAccountStatus: 'cn=active' },
            frank: { uid: 'frank', twakeAccountStatus: 'CN=Disabled' },
          }),
        listable: true,
        pointerLabel: dn =>
          dn.toLowerCase() === 'cn=active' ? 'Active' : 'Disabled',
        onOpen: () => undefined,
        onDelete: () => Promise.resolve(false),
        canDelete: false,
      }).render(container);
      expect(container.innerHTML)
        .to.include(
          'title="CN=Disabled"><span class="dc-state dc-state-disabled">Disabled</span></td>'
        )
        .and.include('title="cn=active">Active</td>');
    });

    it('should show an account’s state on its card as the list does', () => {
      const container = stubContainer();
      new EntityDetail({
        entity: users,
        entry: { uid: 'frank', twakeAccountStatus: 'cn=disabled' },
        translator: new Translator('en'),
        canWrite: false,
        canDelete: false,
        onEdit: () => undefined,
        onDelete: () => undefined,
        onStatus: () => undefined,
        onResetPassword: () => undefined,
        pointerLabel: () => 'Disabled',
      }).render(container);
      expect(container.innerHTML).to.include(
        '<span class="dc-value" title="cn=disabled"><span class="dc-state dc-state-disabled">Disabled</span></span>'
      );
    });

    it('should name an account’s state by its key, and badge only the exceptions', () => {
      expect(accountState(users, 'twakeAccountStatus', 'CN=disabled')).to.equal(
        'disabled'
      );
      expect(accountState(users, 'twakeAccountStatus', 'cn=active')).to.equal(
        'enabled'
      );
      // Another attribute, or a state the schema does not declare
      expect(accountState(users, 'cn', 'cn=disabled')).to.equal(undefined);
      expect(accountState(users, 'twakeAccountStatus', 'cn=gone')).to.equal(
        undefined
      );
      expect(stateMarkup('enabled', 'Active')).to.equal('Active');
      expect(stateMarkup('noAccess', 'Sans accès')).to.equal(
        '<span class="dc-state dc-state-noAccess">Sans accès</span>'
      );
      expect(stateMarkup('toDelete', '<b>')).to.equal(
        '<span class="dc-state dc-state-toDelete">&lt;b&gt;</span>'
      );
      // A deployment's own state is said as it stands.
      expect(stateMarkup('seconded', 'Seconded')).to.equal('Seconded');
      expect(stateMarkup(undefined, 'Disabled')).to.equal('Disabled');
    });

    it('should name a nomenclature’s values, and keep the others as stored', async () => {
      const container = stubContainer();
      await new EntityList({
        entity: mailboxTypes,
        translator: new Translator('fr'),
        load: () =>
          Promise.resolve({
            teamMailbox: { cn: 'teamMailbox' },
            custom: { cn: 'custom' },
          }),
        listable: true,
        onOpen: () => undefined,
        onDelete: () => Promise.resolve(false),
        canDelete: false,
      }).render(container);
      // `escapeHtml` writes a slash as an entity, which the browser reads back
      const markup = container.innerHTML.replace(/&#x2F;/g, '/');
      expect(markup).to.include(
        'title="teamMailbox"><a class="dc-row-link" href="#/mailboxTypes/teamMailbox">Boîte partagée</a></td>'
      );
      expect(markup).to.include(
        'title="custom"><a class="dc-row-link" href="#/mailboxTypes/custom">custom</a></td>'
      );
    });

    it('should open each row from a link in its first column', async () => {
      // A row with a click handler is out of reach of the keyboard: Tab
      // passed the checkboxes and could open nothing.
      for (const [entity, id, href] of [
        [users, 'alice', '#/users/alice'],
        [groups, 'sales team', '#/groups/sales%20team'],
        [mailboxTypes, 'a/b', '#/mailboxTypes/a%2Fb'],
      ] as const) {
        const container = stubContainer();
        await new EntityList({
          entity,
          translator: new Translator('en'),
          load: () =>
            Promise.resolve({
              [id]: { [entity.mainAttribute]: id },
            }),
          listable: true,
          onOpen: () => undefined,
          onDelete: () => Promise.resolve(false),
          canDelete: false,
        }).render(container);
        const links = container.innerHTML
          .replace(/&#x2F;/g, '/')
          .match(/<a class="dc-row-link"[^>]*>/g);
        expect(links, entity.key).to.deep.equal([
          `<a class="dc-row-link" href="${href}">`,
        ]);
        expect(EntityList.entryHref(entity, id)).to.equal(href);
      }
    });

    it('should open a row clicked outside its link and checkbox, and only there', async () => {
      // The link follows itself, Ctrl+click into a new tab: the row opening
      // the card too would take the current tab with it.
      let click: ((event: { target: unknown }) => void) | undefined;
      const row = {
        dataset: { id: 'alice' },
        addEventListener: (type: string, listener: typeof click) => {
          if (type === 'click') click = listener;
        },
      };
      const container = {
        ...stubContainer(),
        querySelectorAll: (selector: string) =>
          (selector === 'tbody tr'
            ? [row]
            : []) as unknown as NodeListOf<Element>,
      } as unknown as HTMLElement & { innerHTML: string };
      const opened: string[] = [];
      await new EntityList({
        entity: users,
        translator: new Translator('en'),
        load: () => Promise.resolve({ alice: { uid: 'alice' } }),
        listable: true,
        onOpen: id => opened.push(id),
        onDelete: () => Promise.resolve(false),
        canDelete: false,
      }).render(container);
      const inside = (selectors: string[]) => ({
        closest: (selector: string) =>
          selector.split(',').some(part => selectors.includes(part.trim()))
            ? {}
            : null,
      });
      click?.({ target: inside([]) });
      click?.({ target: inside(['.dc-row-link']) });
      click?.({ target: inside(['.dc-checkbox-cell']) });
      expect(opened).to.deep.equal(['alice']);
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
        onDelete: () => Promise.resolve(false),
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
        onDelete: () => Promise.resolve(false),
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
        onDelete: () => Promise.resolve(false),
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
        onDelete: () => Promise.resolve(false),
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
        onDelete: () => Promise.resolve(false),
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
      // Opened in a spreadsheet as UTF-8, as the import's template is.
      const bytes = new Uint8Array(await captured!.arrayBuffer());
      expect([...bytes.slice(0, 3)]).to.deep.equal([0xef, 0xbb, 0xbf]);
      expect(csv).to.match(/\r\n$/);
    });

    /** A list of accounts drawn from what `listLoader` answers. */
    async function drawnList(language: string): Promise<string> {
      const list = new EntityList({
        entity: users,
        translator: new Translator(language),
        load: listLoader(new ConsoleApiClient(baseUrl), users),
        listable: true,
        onOpen: () => undefined,
        onDelete: () => Promise.resolve(false),
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
        'Seule 1 entrée est affichée ; il y en a d’autres. Utilisez la recherche pour les trouver.'
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
        onDelete: () => Promise.resolve(false),
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

      answers.push(cut, Object.assign(new Error('Nope'), { status: 400 }));
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
        onDelete: () => Promise.resolve(false),
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

      // A refusal is said plainly, not in the server's words for an API
      // client.
      nock(baseUrl).get('/api/v1/ldap/users').query(true).reply(403, {
        error: 'Token does not have permission on this branch',
      });
      const forbidden = await drawnList('en');
      expect(forbidden).to.contain('You may not see these entries');
      expect(forbidden).to.not.contain('Token');

      // Any other failure says what the server said.
      nock(baseUrl)
        .get('/api/v1/ldap/users')
        .query(true)
        .reply(400, { error: 'Unbalanced filter' });
      expect(await drawnList('en')).to.contain('Unbalanced filter');
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

    it('should show and clear the selection of a whole page from its header', async () => {
      // Each repaint is a new set of boxes, as in a browser: only the
      // listeners of the last one are live.
      type Box = {
        checked: boolean;
        indeterminate: boolean;
        dataset: Record<string, string>;
        fire(): void;
        addEventListener(type: string, handler: (event: unknown) => void): void;
      };
      const box = (id?: string): Box => {
        let handler: ((event: unknown) => void) | undefined;
        const made: Box = {
          checked: false,
          indeterminate: false,
          dataset: id ? { select: id } : {},
          fire: () => handler?.({ target: made }),
          addEventListener: (_type, callback) => {
            handler = callback;
          },
        };
        return made;
      };
      let header = box();
      let rows: Box[] = [];
      const container = stubContainer();
      Object.assign(container, {
        querySelector: (selector: string) =>
          selector === '[data-select-all]' ? header : null,
        querySelectorAll: (selector: string) =>
          selector === '[data-select]' ? rows : [],
      });
      const list = new EntityList({
        entity: users,
        translator: new Translator('en'),
        load: () =>
          Promise.resolve({
            alice: { dn: 'uid=alice,ou=users,dc=example,dc=com', uid: 'alice' },
            bob: { dn: 'uid=bob,ou=users,dc=example,dc=com', uid: 'bob' },
          }),
        listable: true,
        onOpen: () => undefined,
        onDelete: () => Promise.resolve(false),
        canDelete: false,
      });
      const repaint = (): void => {
        header = box();
        rows = [box('alice'), box('bob')];
      };
      repaint();
      await list.render(container);
      const selected = (list as unknown as { selected: Set<string> }).selected;
      const headerTag = (): string =>
        /<input type="checkbox" data-select-all[^>]*>/.exec(
          container.innerHTML
        )?.[0] ?? '';

      // One row of two: neither checked nor clear.
      const [alice] = rows;
      alice.checked = true;
      repaint();
      alice.fire();
      expect(headerTag()).to.not.contain('checked');
      expect(header.indeterminate).to.be.true;

      // The whole page, from the header: shown checked.
      const before = header;
      before.checked = true;
      repaint();
      before.fire();
      expect([...selected]).to.have.members(['alice', 'bob']);
      expect(headerTag()).to.contain('checked');
      expect(header.indeterminate).to.be.false;

      // Clicked again, it clears the page.
      const again = header;
      again.checked = false;
      repaint();
      again.fire();
      expect(selected.size).to.equal(0);
      expect(headerTag()).to.not.contain('checked');
      expect(header.indeterminate).to.be.false;
    });

    it('should show the entries just imported without a search', async () => {
      // Closing the import's result left a large branch asking for three
      // characters, and each new account took a search of its own to check.
      const searched: string[] = [];
      const read: string[] = [];
      const stored: Record<string, Entry> = {
        amartin: { uid: 'amartin', cn: 'Alice Martin', mail: 'a@example.com' },
        bob: { uid: 'bob', cn: 'Bob Brown', mail: 'b@example.com' },
        carol: { uid: 'carol', cn: 'Carol Chen', mail: 'c@example.com' },
      };
      const refusal = (status: number) =>
        Promise.reject(Object.assign(new Error('no'), { status }));
      let answer = (id: string): Promise<Entry> => Promise.resolve(stored[id]);
      const view: ListView = {
        search: 'ali',
        page: 3,
        imported: { ids: ['bob', 'carol', 'amartin'] },
      };
      const options = {
        entity: users,
        translator: new Translator('en'),
        load: (search: string) => {
          searched.push(search);
          return Promise.resolve({});
        },
        read: (id: string) => {
          read.push(id);
          return answer(id);
        },
        listable: false,
        onOpen: () => undefined,
        onDelete: () => Promise.resolve(false),
        canDelete: false,
        view,
      };
      const container = stubContainer();
      await new EntityList(options).render(container);
      // Each read whole: the creation answered little more than its name
      expect(read).to.have.members(['amartin', 'bob', 'carol']);
      expect(searched).to.deep.equal([]);
      expect(container.innerHTML)
        .to.contain('Just imported (3)')
        .and.contain('Back to search')
        .and.contain('href="#&#x2F;users&#x2F;amartin"')
        .and.contain('Bob Brown')
        .and.contain('c@example.com')
        .and.not.contain('data-search ');
      expect(container.innerHTML.indexOf('amartin')).to.be.below(
        container.innerHTML.indexOf('bob')
      );
      // The search keeps its page
      expect(view.page).to.equal(3);

      // Back from a card: one deleted, one out of reach since, left out.
      answer = id =>
        id === 'bob'
          ? refusal(404)
          : id === 'carol'
            ? refusal(403)
            : Promise.resolve(stored[id]);
      const again = stubContainer();
      await new EntityList(options).render(again);
      expect(again.innerHTML)
        .to.contain('Just imported (1)')
        .and.contain('Alice Martin')
        .and.not.contain('Bob Brown')
        .and.not.contain('Carol Chen');
      expect(view.imported?.ids).to.deep.equal(['amartin']);

      // A real failure is said, the count kept
      answer = () => refusal(500);
      const failing = stubContainer();
      await new EntityList(options).render(failing);
      expect(failing.innerHTML)
        .to.contain('Just imported (1)')
        .and.contain('dc-error-block');

      // Back to search: the search left typed is run again, on its page.
      answer = id => Promise.resolve(stored[id]);
      const list = new EntityList(options);
      await list.render(stubContainer());
      await (
        list as unknown as { leaveImported(): Promise<void> }
      ).leaveImported();
      expect(view.imported).to.equal(undefined);
      expect(searched).to.deep.equal(['ali']);
    });

    it('should read only the page shown of a large import', async () => {
      // Two thousand rows read whole on every draw, to show 25 of them
      const ids = Array.from(
        { length: 60 },
        (_, i) => `u${String(i).padStart(2, '0')}`
      );
      const read: string[] = [];
      const gone = new Set(['u03', 'u30']);
      const view: ListView = { imported: { ids: [...ids].reverse() } };
      const list = new EntityList({
        entity: users,
        translator: new Translator('en'),
        load: () => Promise.resolve({}),
        read: (id: string) => {
          read.push(id);
          return gone.has(id)
            ? Promise.reject(Object.assign(new Error('gone'), { status: 404 }))
            : Promise.resolve({ uid: id, cn: `Name ${id}` });
        },
        listable: false,
        onOpen: () => undefined,
        onDelete: () => Promise.resolve(false),
        canDelete: false,
        view,
      });
      const container = stubContainer();
      await list.render(container);
      // The first page, by identifier, refilled past the one found gone
      expect(read).to.have.length(26);
      expect(read).to.include.members(['u00', 'u03', 'u25']);
      expect(container.innerHTML)
        .to.contain('Name u25')
        // Counted from the identifiers: the pages not shown are not checked
        .and.contain('Just imported (59)')
        .and.contain('1–25 of 59')
        .and.not.contain('Name u03')
        .and.not.contain('Name u26');

      // The next page reads its own entries, and only those
      read.length = 0;
      const state = list as unknown as { page: number; turnPage(): void };
      state.page = 1;
      state.turnPage();
      await new Promise(resolve => setTimeout(resolve, 0));
      expect(read).to.have.length(26);
      expect(read).to.include.members(['u26', 'u30', 'u51']);
      expect(container.innerHTML)
        .to.contain('Name u51')
        .and.contain('26–50 of 58')
        .and.not.contain('Name u25');
      expect(view.imported?.ids).to.have.length(58);
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
      expect(error).to.equal('You may not see these entries');
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

    it('should round on the card what no unit says exactly', () => {
      // The card hands nothing back to the server: a gibibyte reads 1.07 GB
      // there rather than ten digits, and says so.
      expect(readableByteSize('1073741824')).to.deep.equal({
        text: '1.07 GB',
        exact: false,
      });
      expect(readableByteSize('15728640')).to.deep.equal({
        text: '15.7 MB',
        exact: false,
      });
      expect(readableByteSize('4000000000')).to.deep.equal({
        text: '4 GB',
        exact: true,
      });
      expect(readableByteSize('999')).to.deep.equal({
        text: '999 B',
        exact: true,
      });
      // Rounded up to a thousand, it reads in the unit above.
      expect(readableByteSize('999999999')).to.deep.equal({
        text: '1 GB',
        exact: false,
      });
      expect(readableByteSize('999999999999')).to.deep.equal({
        text: '1 TB',
        exact: false,
      });
      expect(readableByteSize('999499999')).to.deep.equal({
        text: '999 MB',
        exact: false,
      });
      expect(readableByteSize('1999999999999999')).to.deep.equal({
        text: '2,000 TB',
        exact: false,
      });
      expect(readableByteSize('lots')).to.deep.equal({
        text: 'lots',
        exact: true,
      });
    });

    it("should write a size on the card the reader's way", () => {
      // French writes 1,07 Go: a decimal comma, and octets.
      expect(readableByteSize('1073741824', 'fr')).to.deep.equal({
        text: '1,07 Go',
        exact: false,
      });
      expect(readableByteSize('4500000000', 'fr-FR')).to.deep.equal({
        text: '4,5 Go',
        exact: true,
      });
      expect(readableByteSize('999', 'fr')).to.deep.equal({
        text: '999 o',
        exact: true,
      });
      expect(readableByteSize('lots', 'fr')).to.deep.equal({
        text: 'lots',
        exact: true,
      });
      // A language without symbols of its own keeps the English ones.
      expect(readableByteSize('15728640', 'mn').text).to.equal('15.7 MB');
      // So do the lists, which show what a unit says exactly, and the digits
      // of what none does.
      const size = { type: 'number', normalize: 'byteSize' } as const;
      expect(displayValue(size, '4500000000', undefined, 'fr')).to.equal(
        '4,5 Go'
      );
      expect(displayValue(size, '4500000000')).to.equal('4.5 GB');
      expect(displayValue(size, '1073741824', undefined, 'fr')).to.equal(
        '1073741824'
      );
    });
  });

  describe('server rules', () => {
    it('should read a size as the server does', () => {
      expect(parseByteSize('4GB')).to.equal(4e9);
      expect(parseByteSize('500 mb')).to.equal(5e8);
      expect(parseByteSize('1.5 MB')).to.equal(1500000);
      expect(parseByteSize('2048')).to.equal(2048);
      expect(parseByteSize('2048B')).to.equal(2048);
      expect(parseByteSize('lots')).to.equal(undefined);
      expect(parseByteSize('4 GiB')).to.equal(undefined);
      // What the form shows a stored size as is a size the server reads back.
      expect(parseByteSize(formatByteSize('2000000000'))).to.equal(2e9);
    });

    it('should judge a date by the day in UTC, today passing', () => {
      const now = new Date(Date.UTC(2026, 9, 12, 23, 30));
      expect(beforeToday('20261011000000Z', now)).to.equal(true);
      expect(beforeToday('20261012000000Z', now)).to.equal(false);
      expect(beforeToday('2026-10-13', now)).to.equal(false);
      expect(beforeToday('soon', now)).to.equal(false);
    });

    it('should name a refused attribute by its label', () => {
      // The server's refusal named `twakeDeletionDate`, which the operator
      // had only ever seen as "Deletion date".
      const schema: EntitySchema = {
        attributes: {
          twakeDeletionDate: {
            type: 'date',
            label: { en: 'Deletion date', fr: 'Date de suppression' },
          },
          mailQuotaSize: { type: 'number', label: { en: 'Mailbox size' } },
          owner: { type: 'array', label: { en: 'Owners' } },
        },
      };
      expect(
        nameAttributes(
          'Attribute "twakeDeletionDate" must not be earlier than today',
          schema,
          'fr'
        )
      ).to.equal(
        'Attribute "Date de suppression" must not be earlier than today'
      );
      expect(
        nameAttributes(
          'Invalid value for attribute "mailquotasize": Expected pattern xGB',
          schema,
          'en'
        )
      ).to.equal(
        'Invalid value for attribute "Mailbox size": Expected pattern xGB'
      );
      expect(
        nameAttributes('Invalid value for field owner', schema, 'en')
      ).to.equal('Invalid value for field "Owners"');
      // What the schema does not know is the server's own word.
      expect(
        nameAttributes('Entry "jsmith" already exists', schema, 'en')
      ).to.equal('Entry "jsmith" already exists');
    });

    describe('a refusal ldap-rest describes', () => {
      const schema: EntitySchema = {
        attributes: {
          mail: {
            type: 'string',
            label: {
              en: 'Email',
              fr: 'Adresse électronique',
              mn: 'Цахим шуудан',
            },
          },
          cn: { type: 'string', label: { en: 'Name', fr: 'Nom' } },
        },
      };
      /** What the API client throws for an answer. */
      const refused = (
        status: number,
        message: string,
        refusal?: Record<string, unknown>
      ) => Object.assign(new Error(message), { status, refusal });
      const taken = refused(
        409,
        'user: "alice@example.com" is already used (mail must be unique)',
        { code: 'unique', attribute: 'mail', value: 'alice@example.com' }
      );
      const outside = refused(
        409,
        'The mail domain of "x@other.org" is not one of the authorised domains (example.com, lists.example.com)',
        {
          code: 'mailDomain',
          attribute: 'mail',
          value: 'x@other.org',
          domains: ['example.com', 'lists.example.com'],
        }
      );
      const forbidden = refused(
        403,
        'Token does not have permission on this branch',
        { code: 'forbidden' }
      );

      it('should say an address already used in the interface language, naming the field', () => {
        expect(
          explainRefusal(taken, schema, new Translator('fr'))
        ).to.deep.equal({
          message:
            'Adresse électronique « alice@example.com » : déjà utilisé par une autre entrée.',
          attribute: 'mail',
        });
        expect(
          explainRefusal(taken, schema, new Translator('en')).message
        ).to.equal(
          'Email “alice@example.com” is already used by another entry.'
        );
        expect(
          explainRefusal(taken, schema, new Translator('mn')).message
        ).to.equal(
          'Цахим шуудан «alice@example.com» өөр бичлэгт ашиглагдаж байна.'
        );
      });

      it('should say a mail domain the organization may not use, and those it may', () => {
        expect(
          explainRefusal(outside, schema, new Translator('en'))
        ).to.deep.equal({
          message:
            'Email: other.org is not a mail domain of this organization. Allowed: example.com, lists.example.com.',
          attribute: 'mail',
        });
        expect(
          explainRefusal(outside, schema, new Translator('fr')).message
        ).to.equal(
          'Adresse électronique : other.org n’est pas un domaine de messagerie de cette organisation. Autorisés : example.com, lists.example.com.'
        );
      });

      it('should name an attribute the schema does not know as the console names it', () => {
        const other = refused(409, 'already used', {
          code: 'unique',
          attribute: 'employeeNumber',
          value: 'E0010',
        });
        expect(
          explainRefusal(other, schema, new Translator('en'))
        ).to.deep.equal({
          message: 'Employee Number “E0010” is already used by another entry.',
          attribute: 'employeeNumber',
        });
      });

      it('should say a refusal of the caller’s rights naming the entry, not the token', () => {
        expect(
          explainRefusal(forbidden, schema, new Translator('en'), 'Transit')
        ).to.deep.equal({
          message:
            'You do not administer Transit: this change is not yours to make.',
        });
        expect(
          explainRefusal(forbidden, schema, new Translator('fr'), 'Transit')
            .message
        ).to.equal(
          'Vous n’administrez pas Transit : cette modification ne vous revient pas.'
        );
      });

      it('should keep the server’s words for another refusal, saying they are its own', () => {
        expect(
          explainRefusal(
            refused(400, 'Attribute "cn" must not be empty'),
            schema,
            new Translator('en')
          )
        ).to.deep.equal({
          message: 'The server refused: Attribute "Name" must not be empty',
        });
        expect(
          explainRefusal(
            refused(409, 'Something else', { code: 'somethingNew' }),
            schema,
            new Translator('fr')
          ).message
        ).to.equal('Le serveur a refusé : Something else');
        // Without the entry it is about, a refusal of rights stays the
        // server's.
        expect(
          explainRefusal(forbidden, schema, new Translator('en')).message
        ).to.equal(
          'The server refused: Token does not have permission on this branch'
        );
        // A failure no server answered is not one of its refusals.
        expect(
          explainRefusal(
            new TypeError('Failed to fetch'),
            schema,
            new Translator('en')
          ).message
        ).to.equal('Failed to fetch');
      });

      it('should say what is no refusal went wrong, not that the server refused', () => {
        const said = (status: number, message: string, language = 'en') =>
          explainRefusal(
            refused(status, message),
            schema,
            new Translator(language)
          ).message;
        expect(said(404, 'Not found')).to.equal(
          'The server refused: Not found'
        );
        // A server failing, a session ended, an answer nobody could read.
        expect(said(500, 'Internal Server Error')).to.equal(
          'Something went wrong'
        );
        expect(said(500, 'check logs', 'fr')).to.equal(
          'Une erreur est survenue (check logs)'
        );
        expect(said(502, '502 Bad Gateway')).to.equal(
          'Something went wrong (502 Bad Gateway)'
        );
        expect(said(401, 'Unauthorized')).to.equal(
          'Something went wrong (Unauthorized)'
        );
        expect(said(200, '200 OK')).to.equal('Something went wrong (200 OK)');
      });

      it('should name the organization a refusal of rights is about, under its field', () => {
        expect(
          explainRefusal(
            forbidden,
            schema,
            new Translator('en'),
            'Acme / Sales',
            'twakeDepartmentLink'
          )
        ).to.deep.equal({
          message:
            'You do not administer Acme / Sales: this change is not yours to make.',
          attribute: 'twakeDepartmentLink',
        });
        // The field is for that refusal only.
        expect(
          explainRefusal(
            refused(400, 'Bad'),
            schema,
            new Translator('en'),
            'Acme / Sales',
            'twakeDepartmentLink'
          )
        ).to.deep.equal({ message: 'The server refused: Bad' });
      });

      it('should blame the organization a new or moved entry goes to, not the entry', () => {
        const top = 'ou=organization,dc=example,dc=com';
        const sales = `ou=Sales,${top}`;
        const engineering = `ou=Engineering,${top}`;
        const app = consoleIn({}) as unknown as {
          scope: Scope | null;
          toast(message: string, isError?: boolean): void;
          organizationRefused(
            entity: EntityDescriptor,
            values: Record<string, string | string[]>,
            entry?: Entry,
            form?: { pointerName(dn: string): string | undefined }
          ): { name: string; attribute: string } | undefined;
          refuseSave(
            err: unknown,
            entity: EntityDescriptor,
            form: { refuse(attribute: string, message: string): boolean },
            name: string,
            field?: string
          ): void;
        };
        const form = {
          pointerName: (dn: string) =>
            dn === sales ? 'Acme / Sales' : undefined,
        };
        const link = 'twakeDepartmentLink';
        // Created: the organization it is attached to, as the form named it.
        expect(
          app.organizationRefused(
            users,
            { cn: 'Va Val', [link]: sales },
            undefined,
            form
          )
        ).to.deep.equal({ name: 'Acme / Sales', attribute: link });
        // Edited without a move: the entry itself.
        const stored: Entry = {
          dn: `uid=va,${users.base}`,
          uid: 'va',
          cn: 'Va Val',
          [link]: engineering,
          twakeDepartmentPath: 'Acme / Engineering',
        };
        expect(
          app.organizationRefused(users, { cn: 'Va Vale' }, stored, form)
        ).to.equal(undefined);
        // Moved, the scope saying nothing: where it goes.
        expect(
          app.organizationRefused(users, { [link]: sales }, stored, form)
        ).to.deep.equal({ name: 'Acme / Sales', attribute: link });
        // Moved where the caller writes: where it was, by its path.
        app.scope = {
          branches: [{ dn: sales, write: true }],
          entities: [],
        } as unknown as Scope;
        expect(
          app.organizationRefused(users, { [link]: sales }, stored, form)
        ).to.deep.equal({ name: 'Acme / Engineering', attribute: link });
        // Moved where the caller does not write, unnamed by the form.
        app.scope = {
          branches: [{ dn: engineering, write: true }],
          entities: [],
        } as unknown as Scope;
        expect(
          app.organizationRefused(users, { [link]: sales }, stored)
        ).to.deep.equal({ name: 'Sales', attribute: link });

        // Said under the organization field.
        const toasts: string[] = [];
        app.toast = message => toasts.push(message);
        const shown: [string, string][] = [];
        app.refuseSave(
          forbidden,
          users,
          {
            refuse: (attribute, message) => {
              shown.push([attribute, message]);
              return true;
            },
          },
          'Acme / Sales',
          link
        );
        expect(shown).to.deep.equal([
          [
            link,
            'You do not administer Acme / Sales: this change is not yours to make.',
          ],
        ]);
        expect(toasts).to.deep.equal(['Not saved: see the highlighted field']);
      });

      it('should show a refusal under the field at fault, the toast pointing there', () => {
        const app = consoleIn({}) as unknown as {
          toast(message: string, isError?: boolean): void;
          refuseSave(
            err: unknown,
            entity: EntityDescriptor,
            form: { refuse(attribute: string, message: string): boolean },
            name: string
          ): void;
        };
        const toasts: [string, boolean | undefined][] = [];
        app.toast = (message, isError) => toasts.push([message, isError]);
        const shown: [string, string][] = [];
        const form = {
          refuse: (attribute: string, message: string) => {
            shown.push([attribute, message]);
            return attribute === 'mail';
          },
        };
        app.refuseSave(taken, users, form, 'Alice');
        expect(shown).to.deep.equal([
          [
            'mail',
            'Mail “alice@example.com” is already used by another entry.',
          ],
        ]);
        expect(toasts).to.deep.equal([
          ['Not saved: see the highlighted field', true],
        ]);

        // A field the form does not show: the toast says it all.
        toasts.length = 0;
        app.refuseSave(
          refused(409, 'already used', {
            code: 'unique',
            attribute: 'employeeNumber',
            value: 'E0010',
          }),
          users,
          form,
          'Alice'
        );
        expect(toasts).to.deep.equal([
          ['Employee Number “E0010” is already used by another entry.', true],
        ]);

        toasts.length = 0;
        app.refuseSave(forbidden, users, form, 'Transit');
        expect(toasts).to.deep.equal([
          [
            'You do not administer Transit: this change is not yours to make.',
            true,
          ],
        ]);
      });
    });
  });

  describe('escapeDnValue', () => {
    it('should escape what RFC 4514 asks, and read back through rdnValue', () => {
      for (const value of [
        'a+b@example.com',
        'x,y=z',
        '"quoted" <a;b>',
        'back\\slash',
        ' lead and trail ',
        '#hash',
      ]) {
        const escaped = escapeDnValue(value);
        expect(
          rdnValue(`mail=${escaped},ou=external,dc=example,dc=com`)
        ).to.equal(value);
        expect(isDnShaped(`mail=${escaped},ou=external`)).to.equal(true);
      }
      expect(escapeDnValue('a+b@example.com')).to.equal('a\\+b@example.com');
      expect(escapeDnValue('#x ')).to.equal('\\#x\\ ');
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

    it('should hint a size in the console’s words, and no DN under a search', async () => {
      // "xGB, xMB, xKB" is a notation, not an example, and the members are
      // searched by name: nobody is asked to type a DN (#171).
      const render = async (
        entity: EntityDescriptor,
        language: string,
        memberSearch?: () => Promise<{ dn: string; label: string }[]>
      ): Promise<string> => {
        const container = stubContainer();
        await new EntityForm({
          entity,
          translator: new Translator(language),
          pointerOptions: () => Promise.resolve([]),
          memberSearch: memberSearch && (() => memberSearch),
          onSubmit: () => Promise.resolve(),
          onCancel: () => undefined,
        }).render(container);
        return container.innerHTML;
      };
      const sized: EntityDescriptor = {
        ...users,
        schema: {
          attributes: {
            ...usersSchema.attributes,
            mailQuotaSize: {
              type: 'number',
              normalize: 'byteSize',
              hint: {
                en: 'Expected pattern xGB, xMB, xKB or a number of bytes',
                fr: "Format attendu : xGB, xMB, xKB ou un nombre d'octets",
              },
            },
          },
        },
      };
      expect(await render(sized, 'en'))
        .to.include(
          '<p class="dc-hint" data-hint>A size such as 4 GB, 500 MB or 100 KB</p>'
        )
        .and.not.include('xGB');
      expect(await render(sized, 'fr')).to.include(
        'Une taille telle que 4 GB, 500 MB ou 100 KB'
      );
      const hinted: EntityDescriptor = {
        ...groups,
        schema: {
          attributes: {
            ...groups.schema.attributes,
            member: {
              ...groups.schema.attributes.member,
              hint: 'Expected the DN of an entry of this directory',
            },
          },
        },
      };
      const searched = await render(hinted, 'en', () => Promise.resolve([]));
      expect(searched).to.include('data-picker="member"');
      expect(searched).to.not.include('Expected the DN');
    });

    it('should refuse a size and a past expiry before sending, both at once', async () => {
      // Neither carries a pattern: their rules are the server's, which
      // refused them one per round trip, in a toast away from the field.
      const lifecycle: EntityDescriptor = {
        ...users,
        schema: {
          attributes: {
            ...usersSchema.attributes,
            mailQuotaSize: {
              type: 'number',
              normalize: 'byteSize',
              hint: 'Expected pattern xGB, xMB, xKB or a number of bytes',
            },
            twakeDeletionDate: { type: 'date', role: 'accountExpiry' },
          },
        },
      };
      const now = new Date();
      const today = `${now.getUTCFullYear()}${String(
        now.getUTCMonth() + 1
      ).padStart(2, '0')}${String(now.getUTCDate()).padStart(2, '0')}000000Z`;
      const filled = {
        cn: 'Va Val',
        mail: 'va.val@example.com',
        twakeDepartmentLink: 'ou=HR,dc=example,dc=com',
      };
      let sent = 0;
      const form = (entry?: Entry) =>
        new EntityForm({
          entity: lifecycle,
          entry,
          translator: new Translator('en'),
          pointerOptions: () => Promise.resolve([]),
          onSubmit: () => {
            sent++;
            return Promise.resolve();
          },
          onCancel: () => undefined,
        }) as unknown as {
          values: Record<string, string[]>;
          errors: Record<string, string>;
          submit(): Promise<void>;
        };

      const created = form();
      for (const [name, value] of Object.entries(filled))
        created.values[name] = [value];
      created.values.mailQuotaSize = ['lots'];
      created.values.twakeDeletionDate = ['20201008000000Z'];
      await created.submit();
      expect(sent).to.equal(0);
      expect(created.errors).to.deep.equal({
        // Said with examples, not by repeating the hint shown before.
        mailQuotaSize:
          'Expected a size such as 4 GB, 500 MB or 100 KB, or a number of bytes',
        twakeDeletionDate: 'Expected a date not earlier than today',
      });

      created.values.mailQuotaSize = ['4 GB'];
      created.values.twakeDeletionDate = [today];
      await created.submit();
      expect(created.errors).to.deep.equal({});
      expect(sent).to.equal(1);

      // A date already stored is not sent back, and not judged again.
      const edited = form({
        uid: 'va.val',
        ...filled,
        twakeDeletionDate: '20201008000000Z',
      });
      await edited.submit();
      expect(edited.errors).to.deep.equal({});
      expect(sent).to.equal(2);
    });

    describe('a person’s names', () => {
      const people: EntityDescriptor = {
        ...users,
        schema: {
          attributes: {
            ...usersSchema.attributes,
            // The fixture's cn stands for the full name; here displayName does.
            cn: { type: 'string', required: true },
            employeeNumber: {
              type: 'string',
              required: true,
              help: {
                en: 'The number HR knows the person by',
                fr: 'Matricule',
              },
            },
            givenName: { type: 'string', role: 'givenName' },
            sn: { type: 'string', role: 'surname' },
            displayName: { type: 'string', role: 'displayName' },
          },
        },
      };
      /** Inputs firing `input` as typed, found by the form's selectors. */
      const typing = (): {
        root: HTMLElement;
        type(name: string, value: string): void;
        value(name: string): string;
      } => {
        const inputs = new Map<
          string,
          { value: string; listeners: (() => void)[] }
        >();
        const input = (name: string) => {
          if (!inputs.has(name)) inputs.set(name, { value: '', listeners: [] });
          return inputs.get(name)!;
        };
        return {
          root: {
            querySelector: (selector: string) => {
              const name = /data-field="([^"]+)"\] \.dc-input/.exec(
                selector
              )?.[1];
              if (!name) return null;
              const held = input(name);
              return {
                get value() {
                  return held.value;
                },
                set value(value: string) {
                  held.value = value;
                },
                addEventListener: (_event: string, listener: () => void) =>
                  held.listeners.push(listener),
              };
            },
          } as unknown as HTMLElement,
          type(name, value) {
            input(name).value = value;
            input(name).listeners.forEach(listener => listener());
          },
          value: name => input(name).value,
        };
      };
      /** What the tests reach of a form: its values, and its binding. */
      interface Named {
        values: Record<string, string[]>;
        bindFullName(root: HTMLElement): void;
        render(container: HTMLElement): Promise<void>;
      }
      const form = (entry?: Entry, fullNameFormat?: string): Named =>
        new EntityForm({
          entity: people,
          entry,
          fullNameFormat,
          translator: new Translator('en'),
          pointerOptions: () => Promise.resolve([]),
          onSubmit: () => Promise.resolve(),
          onCancel: () => undefined,
        }) as unknown as Named;

      it('should write the full name once both parts are typed', () => {
        const created = form();
        const page = typing();
        created.bindFullName(page.root);
        page.type('givenName', 'Bat');
        expect(page.value('displayName')).to.equal('');
        page.type('sn', 'Dorj ');
        expect(page.value('displayName')).to.equal('Bat Dorj');
        expect(created.values.displayName).to.deep.equal(['Bat Dorj']);
        page.type('givenName', 'Bataa');
        expect(page.value('displayName')).to.equal('Bataa Dorj');
      });

      it('should write it in the deployment’s order', () => {
        const page = typing();
        form(undefined, '{surname} {givenName}').bindFullName(page.root);
        page.type('givenName', 'Bat');
        page.type('sn', 'Dorj');
        expect(page.value('displayName')).to.equal('Dorj Bat');
      });

      it('should leave alone a full name someone wrote', () => {
        const page = typing();
        form().bindFullName(page.root);
        page.type('displayName', 'The boss');
        page.type('givenName', 'Bat');
        page.type('sn', 'Dorj');
        expect(page.value('displayName')).to.equal('The boss');
        // Emptied, it follows again.
        page.type('displayName', '');
        page.type('sn', 'Dorjiin');
        expect(page.value('displayName')).to.equal('Bat Dorjiin');
      });

      it('should write the common name from the full name, on a new entry', () => {
        // The member pickers match names through cn: an account created
        // with none was not found by its full name.
        const created = form();
        const page = typing();
        created.bindFullName(page.root);
        page.type('givenName', 'Ux');
        page.type('sn', 'Audit');
        expect(page.value('cn')).to.equal('Ux Audit');
        expect(created.values.cn).to.deep.equal(['Ux Audit']);
        // The full name typed whole is followed too.
        page.type('displayName', 'Dr Ux Audit');
        expect(page.value('cn')).to.equal('Dr Ux Audit');
        // A common name typed by hand is kept.
        page.type('cn', 'ux');
        page.type('sn', 'Auditor');
        page.type('displayName', 'Ux Auditor');
        expect(page.value('cn')).to.equal('ux');
      });

      it('should leave an entry’s common name alone', () => {
        const page = typing();
        const entry = {
          uid: 'bat',
          givenName: 'Bat',
          sn: 'Dorj',
          displayName: 'Bat Dorj',
        };
        // Filled from the entry, as the form renders it; no common name.
        for (const [name, value] of Object.entries(entry))
          page.type(name, value);
        form(entry).bindFullName(page.root);
        page.type('sn', 'Bold');
        expect(page.value('displayName')).to.equal('Bat Bold');
        expect(page.value('cn')).to.equal('');
      });

      it('should carry along the full name of an entry its parts made', () => {
        const made = typing();
        const entry = { uid: 'bat', givenName: 'Bat', sn: 'Dorj' };
        // Filled from the entry, as the form renders it.
        for (const [name, value] of Object.entries({
          ...entry,
          displayName: 'Bat Dorj',
        }))
          made.type(name, value);
        form({ ...entry, displayName: 'Bat Dorj' }).bindFullName(made.root);
        made.type('sn', 'Bold');
        expect(made.value('displayName')).to.equal('Bat Bold');

        const chosen = typing();
        // Filled from the entry, as the form renders it.
        for (const [name, value] of Object.entries({
          ...entry,
          displayName: 'Dr Bat',
        }))
          chosen.type(name, value);
        form({ ...entry, displayName: 'Dr Bat' }).bindFullName(chosen.root);
        chosen.type('sn', 'Bold');
        expect(chosen.value('displayName')).to.equal('Dr Bat');
      });

      it('should explain a field on demand', async () => {
        const container = stubContainer();
        await form().render(container);
        // Not focusable: a panel focuses its first field, and opened on it.
        expect(container.innerHTML).to.include(
          '<span class="dc-help" aria-hidden="true">?</span>'
        );
        expect(container.innerHTML).to.match(
          /<span class="dc-tooltip" role="tooltip" id="dc-help-employeeNumber">The number HR knows the person by<\/span>/
        );
        // No help, no button.
        expect(container.innerHTML).not.to.include('dc-help-sn');
      });
    });

    describe('a long form creating an entry', () => {
      /** Users with the address fields of a real schema: past a modal's worth. */
      const located: EntityDescriptor = {
        ...users,
        schema: {
          attributes: {
            ...usersSchema.attributes,
            postalAddress: { type: 'string' },
            postalCode: { type: 'string' },
            l: { type: 'string', group: { en: 'Address', fr: 'Adresse' } },
            mailQuotaSize: {
              type: 'number',
              role: 'emailQuotaSize',
              group: { en: 'Mailbox', fr: 'Messagerie' },
            },
            twakeDelegatedUsers: {
              type: 'array',
              items: { type: 'string' },
              group: { en: 'Mailbox', fr: 'Messagerie' },
            },
          },
        },
      };
      const form = (entity: EntityDescriptor, entry?: Entry): EntityForm =>
        new EntityForm({
          entity,
          entry,
          translator: new Translator('en'),
          pointerOptions: () => Promise.resolve([]),
          onSubmit: () => Promise.resolve(),
          onCancel: () => undefined,
        });

      it('should fold what the schema does not require below what it does', async () => {
        const container = stubContainer();
        await form(located).render(container);
        const html = container.innerHTML;
        const fold = html.indexOf('<details');
        expect(fold).to.be.above(0);
        expect(html).to.include('Optional fields (5)');
        // Not required, but an account is created with its mailbox and its
        // password; and the quota's group is not split.
        for (const name of [
          'cn',
          'mail',
          'twakeDepartmentLink',
          'userPassword',
          'mailQuotaSize',
          'twakeDelegatedUsers',
        ])
          expect(html.indexOf(`data-field="${name}"`)).to.be.within(0, fold);
        for (const name of [
          'mailAlternateAddress',
          'telephoneNumber',
          'postalAddress',
          'postalCode',
          'l',
        ])
          expect(html.indexOf(`data-field="${name}"`)).to.be.above(fold);
        // The schema's groups are kept inside the fold.
        expect(html.indexOf('<legend>Address</legend>')).to.be.above(fold);
      });

      it('should fold nothing when editing, nor in a short form', async () => {
        const edited = stubContainer();
        await form(located, { uid: 'va.val', cn: 'Va Val' }).render(edited);
        expect(edited.innerHTML).not.to.include('<details');
        const short = stubContainer();
        await form(users).render(short);
        expect(short.innerHTML).not.to.include('<details');
      });

      it('should open the fold on a refusal it hides, and show the first one', async () => {
        const fold = { open: false };
        const scrolled: string[] = [];
        const fields = new Map<string, unknown>();
        const field = (name: string) => {
          if (!fields.has(name)) {
            const error = { textContent: '', hidden: true };
            fields.set(name, {
              querySelector: (selector: string) =>
                selector === '[data-error]' ? error : null,
              closest: () =>
                ['cn', 'mail', 'twakeDepartmentLink'].includes(name)
                  ? null
                  : fold,
              scrollIntoView: () => scrolled.push(name),
            });
          }
          return fields.get(name);
        };
        const created = form(located) as unknown as {
          root: unknown;
          values: Record<string, string[]>;
          submit(): Promise<void>;
        };
        created.root = {
          querySelector: (selector: string) =>
            field(/data-field="([^"]+)"/.exec(selector)![1]),
        };
        created.values.telephoneNumber = ['12'];
        await created.submit();
        expect(fold.open).to.equal(true);
        // The required fields are shown first, and refused first.
        expect(scrolled).to.deep.equal(['cn']);
      });

      it('should mark a refused field invalid, described by its message, and focus it', async () => {
        /** A control that keeps its attributes, and says when it is focused. */
        const control = (attributes: Record<string, string> = {}) => ({
          attributes,
          focused: false,
          getAttribute: (name: string) => attributes[name] ?? null,
          setAttribute: (name: string, value: string) => {
            attributes[name] = value;
          },
          removeAttribute: (name: string) => {
            delete attributes[name];
          },
          focus() {
            this.focused = true;
          },
        });
        const controls = new Map<string, ReturnType<typeof control>>();
        const fields = new Map<string, unknown>();
        const field = (name: string) => {
          if (!fields.has(name)) {
            const error = {
              id: `dc-error-${name}`,
              textContent: '',
              hidden: true,
            };
            // A field a help already describes keeps that description.
            controls.set(
              name,
              control(
                name === 'mail' ? { 'aria-describedby': 'dc-help-mail' } : {}
              )
            );
            fields.set(name, {
              querySelector: (selector: string) =>
                selector === '[data-error]'
                  ? error
                  : selector === `[id="dc-field-${name}"]`
                    ? controls.get(name)
                    : null,
              closest: () => null,
              scrollIntoView: () => undefined,
            });
          }
          return fields.get(name);
        };
        const created = form(located) as unknown as {
          root: unknown;
          values: Record<string, string[]>;
          submit(): Promise<void>;
        };
        created.root = {
          querySelector: (selector: string) =>
            field(/data-field="([^"]+)"/.exec(selector)![1]),
        };
        created.values.mail = ['not-an-email'];
        await created.submit();
        expect(controls.get('mail')!.attributes).to.deep.equal({
          'aria-describedby': 'dc-help-mail dc-error-mail',
          'aria-invalid': 'true',
        });
        expect(controls.get('cn')!.attributes['aria-invalid']).to.equal('true');
        // The first refused field has the focus, not the Create button.
        expect(controls.get('cn')!.focused).to.equal(true);
        expect(controls.get('mail')!.focused).to.equal(false);

        // Corrected, a field is no longer invalid, and keeps its help.
        created.values.mail = ['jane@example.com'];
        created.values.cn = ['Jane'];
        await created.submit();
        expect(controls.get('mail')!.attributes).to.deep.equal({
          'aria-describedby': 'dc-help-mail',
        });

        // The server's refusal of a field is shown the same way.
        controls.get('cn')!.focused = false;
        expect(
          (created as unknown as EntityForm).refuse(
            'MAIL',
            'Email “jane@example.com” is already used by another entry.'
          )
        ).to.equal(true);
        const error = (
          field('mail') as { querySelector(selector: string): unknown }
        ).querySelector('[data-error]') as {
          textContent: string;
          hidden: boolean;
        };
        expect(error).to.deep.include({
          textContent:
            'Email “jane@example.com” is already used by another entry.',
          hidden: false,
        });
        expect(controls.get('mail')!.attributes).to.deep.equal({
          'aria-describedby': 'dc-help-mail dc-error-mail',
          'aria-invalid': 'true',
        });
        expect(controls.get('mail')!.focused).to.equal(true);
        expect(controls.get('cn')!.attributes['aria-invalid']).to.equal(
          undefined
        );
        // A field the form does not hold is left to the toast.
        expect(
          (created as unknown as EntityForm).refuse('employeeNumber', 'Taken')
        ).to.equal(false);
      });
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

    describe('a group’s members', () => {
      const alice = 'uid=alice,ou=users,dc=example,dc=com';
      const jane = 'uid=jane,ou=users,dc=example,dc=com';

      /** A group form whose member field is wired to recorders. */
      const memberForm = async (
        search: (query: string) => Promise<{ dn: string; label: string }[]>,
        externalMembers?: ExternalMembers
      ): Promise<{
        form: EntityForm;
        input: ReturnType<typeof recorder>;
        results: ReturnType<typeof recorder>;
        tokens: ReturnType<typeof recorder>;
        container: HTMLElement & { innerHTML: string };
      }> => {
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
          selector === '[data-field="member"]' ? field : null;
        const form = new EntityForm({
          entity: groups,
          entry: { ...staff, member: [alice] },
          translator: new Translator('en'),
          pointerOptions: () => Promise.resolve([]),
          memberSearch: role => (role === 'members' ? search : undefined),
          externalMembers,
          onSubmit: () => Promise.resolve(),
          onCancel: () => undefined,
        });
        await form.render(container);
        return { form, input, results, tokens, container };
      };
      const members = (form: EntityForm): string[] =>
        (form as unknown as { values: Record<string, string[]> }).values.member;
      const enter = { key: 'Enter', preventDefault: () => undefined };

      it('should name each remove button after the member it removes', async () => {
        const { container } = await memberForm(() => Promise.resolve([]));
        expect(container.innerHTML).to.include('aria-label="Remove alice"');
        expect(container.innerHTML).to.not.include('Remove this value');
      });

      it('should find a member by email address rather than ask for a DN', async () => {
        const asked: string[] = [];
        const { form, input, container } = await memberForm(query => {
          asked.push(query);
          return Promise.resolve([
            { dn: jane, label: 'Jane Doe <jane@example.com>' },
          ]);
        });
        expect(container.innerHTML).to.include('data-picker="member"');
        expect(container.innerHTML).to.include('of an email address');

        input.value = 'jane@exa';
        input.fire('input');
        await new Promise(resolve => setTimeout(resolve, 300));
        input.fire('keydown', enter);
        expect(asked).to.deep.equal(['jane@exa']);
        expect(members(form)).to.deep.equal([alice, jane]);
      });

      it('should take a DN typed whole, without searching it', async () => {
        let searched = false;
        const { form, input } = await memberForm(() => {
          searched = true;
          return Promise.resolve([]);
        });
        input.value = ` ${jane} `;
        input.fire('input');
        await new Promise(resolve => setTimeout(resolve, 300));
        expect(searched).to.equal(false);
        input.fire('keydown', enter);
        expect(members(form)).to.deep.equal([alice, jane]);
        expect(input.value).to.equal('');
      });

      it('should add a DN left in the box, once', async () => {
        const { form, input } = await memberForm(() => Promise.resolve([]));
        input.value = jane;
        input.fire('blur');
        // The same DN in another case is the same member.
        input.value = jane.toUpperCase();
        input.fire('blur');
        expect(members(form)).to.deep.equal([alice, jane]);
      });

      it('should not pick a member twice in another case', async () => {
        const { form, input } = await memberForm(() =>
          Promise.resolve([{ dn: alice.toUpperCase(), label: 'Alice' }])
        );
        input.value = 'alice';
        input.fire('input');
        await new Promise(resolve => setTimeout(resolve, 300));
        input.fire('keydown', enter);
        expect(members(form)).to.deep.equal([alice]);
      });

      describe('outside the directory', () => {
        const external: ExternalMembers = {
          branch: 'ou=external,dc=example,dc=com',
          rdnAttribute: 'mail',
          managedDomains: ['example.com'],
        };
        /** Type an address, and wait for the search it issues. */
        const type = async (
          input: ReturnType<typeof recorder>,
          text: string
        ): Promise<void> => {
          input.value = text;
          input.fire('input');
          await new Promise(resolve => setTimeout(resolve, 300));
        };

        it('should offer to add an address no entry holds as an external member', async () => {
          // Only the full DN worked, which administrators do not know (#59).
          const { form, input, results, tokens } = await memberForm(
            () => Promise.resolve([]),
            external
          );
          await type(input, 'Some.One+lists@partner.org');
          expect(results.innerHTML).to.include(
            'Add Some.One+lists@partner.org as an external member'
          );
          input.fire('keydown', enter);
          // Escaped as a DN value: a bare `+` joins a second attribute.
          expect(members(form)).to.deep.equal([
            alice,
            'mail=Some.One\\+lists@partner.org,ou=external,dc=example,dc=com',
          ]);
          // Named by its address, not by the offer.
          expect(tokens.innerHTML).to.include('Some.One+lists@partner.org<');
        });

        it('should offer the account, not an external member, for an address an entry holds', async () => {
          const { results, input } = await memberForm(
            () =>
              Promise.resolve([
                { dn: jane, label: 'Jane Doe <jane@partner.org>' },
              ]),
            external
          );
          await type(input, 'JANE@partner.org');
          expect(results.innerHTML).to.include('Jane Doe');
          expect(results.innerHTML).not.to.include('external member');
        });

        it('should say an address at a domain of the directory is an account’s', async () => {
          const { form, input, results } = await memberForm(
            () => Promise.resolve([]),
            external
          );
          await type(input, 'nobody@Example.com');
          expect(results.innerHTML).to.include(
            'example.com is a domain of this directory: choose the account instead'
          );
          input.fire('keydown', enter);
          expect(members(form)).to.deep.equal([alice]);
        });

        it('should offer nothing outside when the server takes no external member', async () => {
          const { results, input } = await memberForm(() =>
            Promise.resolve([])
          );
          await type(input, 'someone@partner.org');
          expect(results.innerHTML).to.include('No entry matches this search');
        });
      });

      // linagora/twake-directory-manager#66: the server refuses a team
      // mailbox a member of another domain, so none is offered.
      describe('of a team mailbox', () => {
        const mailboxes: EntityDescriptor = {
          ...groups,
          schema: {
            attributes: {
              ...groups.schema.attributes,
              mail: { type: 'string', role: 'primaryEmail' },
              twakeMailboxType: {
                type: 'pointer',
                role: 'mailboxType',
                branch: [mailboxTypes.base as string],
              },
            },
          },
        };
        const team = `cn=teamMailbox,${mailboxTypes.base}`;
        const list = `cn=mailingList,${mailboxTypes.base}`;
        const external: ExternalMembers = {
          branch: 'ou=external,dc=example,dc=com',
          rdnAttribute: 'mail',
          managedDomains: ['example.com'],
        };
        const found = [
          {
            dn: jane,
            label: 'Jane Doe <jane@Example.com>',
            mail: 'jane@Example.com',
          },
          {
            dn: 'uid=bob,ou=users,dc=example,dc=com',
            label: 'Bob <bob@other.org>',
            mail: 'bob@other.org',
          },
        ];

        /** Type into the member field of a group, and wait for its search. */
        const typed = async (
          text: string,
          type: string,
          options: {
            keep?: boolean;
            answer?: { dn: string; label: string; mail?: string }[];
          } = {}
        ): Promise<{ form: EntityForm; html: string }> => {
          const input = recorder();
          const results = recorder();
          const field = recorder({
            '[data-picker-input]': input,
            '.dc-picker-results': results,
            '.dc-token-list': recorder(),
          });
          const container = stubContainer();
          (
            container as unknown as { querySelector(s: string): unknown }
          ).querySelector = selector =>
            selector === '[data-field="member"]' ? field : null;
          const form = new EntityForm({
            entity: mailboxes,
            entry: {
              ...staff,
              member: [alice],
              mail: 'sales@example.com',
              twakeMailboxType: type,
            },
            translator: new Translator('en'),
            pointerOptions: () => Promise.resolve([]),
            memberSearch: role =>
              role === 'members'
                ? () => Promise.resolve(options.answer ?? found)
                : undefined,
            externalMembers: external,
            teamMailboxesKeepDomain: options.keep ?? true,
            onSubmit: () => Promise.resolve(),
            onCancel: () => undefined,
          });
          await form.render(container);
          input.value = text;
          input.fire('input');
          await new Promise(resolve => setTimeout(resolve, 300));
          return { form, html: results.innerHTML };
        };

        it('should offer the accounts of its domain only', async () => {
          const { html } = await typed('jane', team);
          expect(html).to.include('Jane Doe');
          expect(html).not.to.include('bob@other.org');
        });

        it('should say why an account of another domain is not offered', async () => {
          const { html } = await typed('bob', team, {
            answer: [found[1]],
          });
          expect(html).to.include(
            'A shared mailbox at example.com only takes accounts of example.com'
          );
        });

        it('should offer no external member', async () => {
          const { form, html } = await typed('someone@partner.org', team, {
            answer: [],
          });
          expect(html).not.to.include('external member');
          expect(html).to.include('only takes accounts of example.com');
          expect(members(form)).to.deep.equal([alice]);
        });

        it('should follow an address changed in the form', async () => {
          const { form } = await typed('', team);
          (
            form as unknown as { values: Record<string, string[]> }
          ).values.mail = ['sales@other.org'];
          expect(
            (
              form as unknown as { teamMailboxDomain(): string | undefined }
            ).teamMailboxDomain()
          ).to.equal('other.org');
        });

        it('should offer every domain, and outside, to a mailing list', async () => {
          const { html } = await typed('someone@partner.org', list, {
            answer: [],
          });
          expect(html).to.include(
            'Add someone@partner.org as an external member'
          );
          const { html: both } = await typed('anyone', list);
          expect(both).to.include('Jane Doe');
          expect(both).to.include('bob@other.org');
        });

        it('should offer every domain when the server keeps none', async () => {
          const { html } = await typed('anyone', team, { keep: false });
          expect(html).to.include('Jane Doe');
          expect(html).to.include('bob@other.org');
        });
      });

      it('should keep a plain token box when there is no search', async () => {
        const container = stubContainer();
        await new EntityForm({
          entity: groups,
          entry: staff,
          translator: new Translator('en'),
          pointerOptions: () => Promise.resolve([]),
          onSubmit: () => Promise.resolve(),
          onCancel: () => undefined,
        }).render(container);
        expect(container.innerHTML).to.include('data-tokens="member"');
      });
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

    it('should write hints and section headings in the interface language', async () => {
      const translated: EntityDescriptor = {
        ...users,
        schema: {
          attributes: {
            uid: { type: 'string', required: true, role: 'identifier' },
            mail: {
              type: 'string',
              hint: { en: 'An email address', fr: 'Une adresse e-mail' },
              group: { en: 'Contact', fr: 'Coordonnées' },
            },
            mailAlternateAddress: {
              type: 'array',
              items: {
                type: 'string',
                hint: { en: 'Other addresses', fr: 'Autres adresses' },
              },
              group: { en: 'Contact', fr: 'Coordonnées' },
            },
          },
        },
      };
      const container = stubContainer();
      await new EntityForm({
        entity: translated,
        translator: new Translator('fr'),
        pointerOptions: () => Promise.resolve([]),
        onSubmit: () => Promise.resolve(),
        onCancel: () => undefined,
      }).render(container);
      expect(container.innerHTML).to.include('Une adresse e-mail');
      expect(container.innerHTML).to.include('Autres adresses');
      expect(container.innerHTML).not.to.include('[object Object]');
      // One section for both fields, headed in French.
      expect(
        container.innerHTML.match(/<legend>Coordonnées<\/legend>/g)
      ).to.have.length(1);
    });

    it('should mark required fields and say what the mark means', async () => {
      const container = stubContainer();
      await build().render(container);
      expect(container.innerHTML).to.include('dc-required');
      expect(container.innerHTML).to.include(
        'Fields marked with * are required'
      );
    });

    it('should say an empty required field is required, not repeat the legend', async () => {
      // The legend explains the *; under each field, its error is read out
      // by a screen reader once per field.
      for (const [language, word] of [
        ['en', 'Required'],
        ['fr', 'Obligatoire'],
      ]) {
        const form = new EntityForm({
          entity: users,
          translator: new Translator(language),
          pointerOptions: () => Promise.resolve([]),
          onSubmit: () => Promise.resolve(),
          onCancel: () => undefined,
        }) as unknown as {
          errors: Record<string, string>;
          submit(): Promise<void>;
        };
        await form.submit();
        const errors = Object.values(form.errors);
        expect(errors, language).not.to.be.empty;
        for (const error of errors) expect(error, language).to.equal(word);
      }
    });

    it('should ask for a token list on a multi-valued attribute', async () => {
      const container = stubContainer();
      await build().render(container);
      expect(container.innerHTML).to.include(
        'data-tokens="mailAlternateAddress"'
      );
      expect(container.innerHTML).to.include('Press Enter to add a value');
    });

    it('should give a multi-valued field’s control the id its label points at', async () => {
      const domains: EntityDescriptor = {
        ...users,
        schema: {
          ...users.schema,
          attributes: {
            ...users.schema.attributes,
            twakeDomainLink: {
              type: 'array',
              items: {
                type: 'pointer',
                branch: ['ou=domains,ou=nomenclature,dc=example,dc=com'],
              },
            },
          },
        },
      };
      const container = stubContainer();
      await new EntityForm({
        entity: domains,
        translator: new Translator('en'),
        pointerOptions: () => Promise.resolve([]),
        onSubmit: () => Promise.resolve(),
        onCancel: () => undefined,
      }).render(container);
      const html = container.innerHTML;
      for (const [name, tag] of [
        ['mailAlternateAddress', 'input'],
        ['twakeDomainLink', 'select'],
      ]) {
        expect(html).to.include(`<label for="dc-field-${name}">`);
        expect(html).to.match(
          new RegExp(`<${tag} id="dc-field-${name}"[^>]*data-token-input`)
        );
        // Once: a label points at the first element holding its id.
        expect(html.split(`id="dc-field-${name}"`)).to.have.length(2);
      }
    });

    it('should name the tokens of a multi-valued pointer the way its select does', async () => {
      const branch = 'ou=domains,ou=nomenclature,dc=example,dc=com';
      const example = `dc=example,${branch}`;
      const domains: EntityDescriptor = {
        ...users,
        schema: {
          attributes: {
            uid: users.schema.attributes.uid,
            twakeDomainLink: {
              type: 'array',
              items: { type: 'pointer', branch: [branch] },
            },
          },
        },
      };
      // The token select, inside its field, as `fillPointers` finds it.
      const list = { innerHTML: '' };
      const field = {
        dataset: { tokens: 'twakeDomainLink' },
        querySelector: (selector: string) =>
          selector === '.dc-token-list' ? list : null,
      };
      const select = Object.assign(stubSelect(branch, ''), {
        closest: (selector: string) =>
          selector === '[data-tokens]' ? field : null,
      });
      (select.dataset as Record<string, string>).tokenInput = '';
      const container = await renderWith(
        select,
        { uid: 'hr', twakeDomainLink: [example] },
        () => Promise.resolve([{ dn: example, label: 'example.com' }]),
        domains
      );
      // Before the options are known: the RDN, not the DN.
      expect(container.innerHTML).to.include('>example</span>');
      expect(container.innerHTML).to.not.include(`>${example}</span>`);
      // Once they are: the name the select offers, the DN in the title.
      expect(list.innerHTML).to.include(
        `<span title="${example}">example.com</span>`
      );
      // Its remove button says which value it removes.
      expect(container.innerHTML).to.include('aria-label="Remove example"');
      expect(list.innerHTML).to.include('aria-label="Remove example.com"');
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

    describe('mail domains', () => {
      const domainsBase = 'ou=domains,ou=nomenclature,dc=example,dc=com';
      const example = `dc=example,${domainsBase}`;
      const lists = `dc=lists,${domainsBase}`;
      const other = `dc=other,${domainsBase}`;
      const listed = [
        { dn: example, label: 'example.com' },
        { dn: lists, label: 'lists.example.com' },
        { dn: other, label: 'other.org' },
      ];
      const organizations: EntityDescriptor = {
        key: 'organizations',
        pluralName: 'organizations',
        singularName: 'organization',
        mainAttribute: 'ou',
        base: 'ou=organization,dc=example,dc=com',
        schema: {
          attributes: {
            ou: { type: 'string', role: 'identifier', required: true },
            twakeDomainLink: {
              type: 'array',
              role: 'domainLink',
              items: { type: 'pointer', branch: [domainsBase] },
            },
          },
        },
        endpoint: '/api/v1/ldap/organizations',
        kind: 'organization',
      };
      const enter = { key: 'Enter', preventDefault: () => undefined };
      const down = { key: 'ArrowDown', preventDefault: () => undefined };
      const tick = (): Promise<void> =>
        new Promise(resolve => setTimeout(resolve, 0));

      describe('chosen by typing', () => {
        /**
         * An organization form whose domain field is a select inside its
         * field, the field holding what the picker it turns into looks up.
         */
        const domainForm = async (
          pointerOptions: () => Promise<{ dn: string; label: string }[]>,
          linkableDomains?: () => Promise<string[] | undefined>
        ): Promise<{
          form: EntityForm;
          field: ReturnType<typeof recorder>;
          input: ReturnType<typeof recorder>;
          results: ReturnType<typeof recorder>;
          select: HTMLSelectElement;
          note: { textContent: string; hidden: boolean; id: string };
          asked: () => number;
        }> => {
          const input = recorder();
          const results = recorder();
          const note = {
            textContent: '',
            hidden: true,
            id: 'dc-note-twakeDomainLink',
          };
          const field = recorder(
            {
              '[data-picker-input]': input,
              '.dc-picker-results': results,
              '.dc-token-list': recorder(),
              '[data-pointer-note]': note,
            },
            { field: 'twakeDomainLink' }
          );
          const select = stubSelect(domainsBase, '') as unknown as Record<
            string,
            unknown
          >;
          select.dataset = { pointer: domainsBase, tokenInput: '' };
          select.closest = (): unknown => field;
          const container = stubContainer() as unknown as {
            querySelector(selector: string): unknown;
            querySelectorAll(): unknown[];
          };
          container.querySelector = selector =>
            selector === '[data-field="twakeDomainLink"]' ? field : null;
          container.querySelectorAll = (): unknown[] => [select];
          let calls = 0;
          const form = new EntityForm({
            entity: organizations,
            entry: {
              dn: `ou=Sales,${organizations.base}`,
              ou: 'Sales',
              twakeDomainLink: [example],
            },
            translator: new Translator('en'),
            typeAhead: branch => branch === domainsBase,
            linkableDomains,
            pointerOptions: () => {
              calls++;
              return pointerOptions();
            },
            onSubmit: () => Promise.resolve(),
            onCancel: () => undefined,
          });
          await form.render(container as unknown as HTMLElement);
          return {
            form,
            field,
            input,
            results,
            select: select as unknown as HTMLSelectElement,
            note,
            asked: () => calls,
          };
        };
        const links = (form: EntityForm): string[] =>
          (form as unknown as { values: Record<string, string[]> }).values
            .twakeDomainLink;

        it('should filter the domains listed once by their name, from the first letter', async () => {
          const { form, field, input, results, asked } = await domainForm(() =>
            Promise.resolve(listed)
          );
          // A picker, named by the domain, not by its RDN.
          expect(field.innerHTML).to.include('data-picker="twakeDomainLink"');
          expect(field.innerHTML).to.include(
            'Type part of a name, or press ↓ to list them all'
          );
          expect(field.innerHTML).to.include(`title="${example}">example.com<`);

          input.value = 'L';
          input.fire('input');
          await tick();
          expect(results.hidden).to.equal(false);
          expect(results.innerHTML).to.include('lists.example.com');
          expect(results.innerHTML).not.to.include('other.org');
          input.fire('keydown', enter);
          expect(links(form)).to.deep.equal([example, lists]);

          // What is linked already is not offered again; the arrow lists
          // the rest of them, the box empty.
          input.fire('keydown', { key: 'Escape', preventDefault: () => {} });
          input.value = '';
          input.fire('keydown', down);
          await tick();
          expect(results.innerHTML).to.include('other.org');
          expect(results.innerHTML).not.to.include('>example.com<');
          // Every keystroke filtered what one request listed.
          expect(asked()).to.equal(1);
        });

        it('should offer only what an organization above links, to a caller below the top', async () => {
          const { form, input, results } = await domainForm(
            () => Promise.resolve(listed),
            () => Promise.resolve([lists])
          );
          input.value = 'o';
          input.fire('input');
          await tick();
          expect(results.innerHTML).to.include('lists.example.com');
          expect(results.innerHTML).not.to.include('other.org');

          input.value = 'other';
          input.fire('input');
          await tick();
          expect(results.innerHTML).to.include(
            'Only a domain an organization above this one links can be linked here'
          );
          input.fire('keydown', enter);
          expect(links(form)).to.deep.equal([example]);
        });

        it('should offer every domain when what is linked above cannot be read', async () => {
          const { input, results } = await domainForm(
            () => Promise.resolve(listed),
            () => Promise.reject(new Error('Forbidden'))
          );
          input.value = 'o';
          input.fire('input');
          await tick();
          expect(results.innerHTML).to.include('other.org');
        });

        it('should keep the select, quietly, when the domains cannot be read', async () => {
          const { field, select, note } = await domainForm(() =>
            Promise.reject(
              Object.assign(new Error('Forbidden'), { status: 403 })
            )
          );
          expect(field.innerHTML).to.equal('');
          expect(select.disabled).to.equal(false);
          await new Promise(resolve => setTimeout(resolve, 150));
          expect(note.hidden).to.equal(true);
          expect(note.textContent).to.equal('');
        });
      });

      describe('completing an address', () => {
        /** An account form whose address fields are wired to recorders. */
        const addressForm = async (
          mailDomains?: (organization?: string) => Promise<string[]>,
          rule: Partial<SchemaAttribute> = { mailDomainScope: 'organization' }
        ): Promise<{
          form: EntityForm;
          container: HTMLElement & { innerHTML: string };
          mail: ReturnType<typeof recorder>;
          mailList: ReturnType<typeof recorder>;
          alias: ReturnType<typeof recorder>;
          aliasList: ReturnType<typeof recorder>;
          values: Record<string, string[]>;
        }> => {
          const mail = recorder();
          const mailList = recorder();
          const alias = recorder();
          const aliasList = recorder();
          const fields: Record<string, unknown> = {
            '[data-field="mail"]': recorder({
              '.dc-input': mail,
              '[data-completions]': mailList,
            }),
            '[data-field="mailAlternateAddress"]': recorder({
              '[data-token-input]': alias,
              '[data-completions]': aliasList,
              '.dc-token-list': recorder(),
            }),
          };
          const container = stubContainer();
          (
            container as unknown as { querySelector(s: string): unknown }
          ).querySelector = selector => fields[selector] ?? null;
          // The rule ldap-rest's `ldap/enterpriseRules` checks addresses by.
          const { mail: address, mailAlternateAddress: aliases } =
            users.schema.attributes;
          const form = new EntityForm({
            entity: {
              ...users,
              schema: {
                attributes: {
                  ...users.schema.attributes,
                  mail: { ...address, ...rule },
                  mailAlternateAddress: { ...aliases, ...rule },
                },
              },
            },
            entry: {
              uid: 'jane',
              mail: 'jane@other.org',
              twakeDepartmentLink: 'ou=Sales,dc=example,dc=com',
            },
            translator: new Translator('en'),
            pointerOptions: () => Promise.resolve([]),
            mailDomains,
            onSubmit: () => Promise.resolve(),
            onCancel: () => undefined,
          });
          await form.render(container);
          return {
            form,
            container,
            mail,
            mailList,
            alias,
            aliasList,
            values: (form as unknown as { values: Record<string, string[]> })
              .values,
          };
        };
        const type = async (
          box: ReturnType<typeof recorder>,
          text: string
        ): Promise<void> => {
          box.value = text;
          box.fire('input');
          await tick();
        };

        it('should offer the domains of the entry’s organization after an "@"', async () => {
          const asked: (string | undefined)[] = [];
          const { container, mail, mailList, values } = await addressForm(
            organization => {
              asked.push(organization);
              return Promise.resolve(['example.com', 'lists.example.com']);
            }
          );
          expect(container.innerHTML).to.match(
            /<input id="dc-field-mail"[^>]*role="combobox"/
          );
          expect(container.innerHTML).to.include('data-completions');

          await type(mail, 'jane');
          expect(mailList.hidden).to.equal(true);
          await type(mail, 'jane@');
          expect(mailList.hidden).to.equal(false);
          expect(mailList.innerHTML).to.include('>jane@example.com<');
          expect(mailList.innerHTML).to.include('>jane@lists.example.com<');
          // Those the typed text begins come first, then those holding it.
          await type(mail, 'jane@l');
          expect(mailList.innerHTML.indexOf('>jane@lists.')).to.be.within(
            0,
            mailList.innerHTML.indexOf('>jane@example.com<')
          );
          // The first line is chosen, as a picker's: Enter takes it.
          await type(mail, 'jane@ex');
          expect(mailList.innerHTML).to.match(
            /aria-selected="true"\s+data-suggestion="0">jane@example\.com</
          );
          mail.fire('keydown', enter);
          expect(mail.value).to.equal('jane@example.com');
          expect(values.mail).to.deep.equal(['jane@example.com']);
          expect(mailList.hidden).to.equal(true);
          // A domain typed whole is offered no more.
          await type(mail, 'jane@example.com');
          expect(mailList.hidden).to.equal(true);
          // Asked once, for the organization the form attaches the entry to.
          expect(asked).to.deep.equal(['ou=Sales,dc=example,dc=com']);
        });

        it('should offer the subdomains of those allowed where the rule takes them', async () => {
          const every = ['example.com', 'lists.example.com', 'other.org'];
          const { mail, mailList } = await addressForm(
            organization =>
              Promise.resolve(organization ? ['example.com'] : every),
            { mailDomainScope: 'organization', allowSubdomains: true }
          );
          await type(mail, 'all@');
          expect(mailList.innerHTML).to.include('>all@example.com<');
          expect(mailList.innerHTML).to.include('>all@lists.example.com<');
          expect(mailList.innerHTML).not.to.include('other.org');
        });

        it('should offer every domain to an address no rule keeps to some', async () => {
          const asked: (string | undefined)[] = [];
          const { mail, mailList } = await addressForm(organization => {
            asked.push(organization);
            return Promise.resolve(
              organization ? ['example.com'] : ['example.com', 'other.org']
            );
          }, {});
          await type(mail, 'jane@');
          expect(mailList.innerHTML).to.include('>jane@other.org<');
          expect(asked).to.deep.equal([undefined]);
        });

        it('should complete an alias on Enter, and add it on the next', async () => {
          const { alias, aliasList, values } = await addressForm(() =>
            Promise.resolve(['example.com', 'lists.example.com'])
          );
          // "name@" and Enter left "name@" before: nothing was chosen.
          await type(alias, 'j.doe@exa');
          expect(aliasList.hidden).to.equal(false);
          let prevented = false;
          alias.fire('keydown', {
            key: 'Enter',
            preventDefault: () => {
              prevented = true;
            },
          });
          expect(prevented).to.equal(true);
          expect(alias.value).to.equal('j.doe@example.com');
          expect(values.mailAlternateAddress).to.deep.equal([]);
          expect(aliasList.hidden).to.equal(true);
          alias.fire('keydown', enter);
          expect(values.mailAlternateAddress).to.deep.equal([
            'j.doe@example.com',
          ]);

          // Another line, chosen with the arrows
          await type(alias, 'doe@');
          alias.fire('keydown', down);
          alias.fire('keydown', enter);
          expect(alias.value).to.equal('doe@lists.example.com');
          // Escape keeps the text as typed, for Enter to add
          await type(alias, 'x@exa');
          alias.fire('keydown', { key: 'Escape', preventDefault: () => {} });
          expect(aliasList.hidden).to.equal(true);
          expect(alias.value).to.equal('x@exa');
        });

        it('should show the identifier a new account will get', async () => {
          // The server takes it from the address; the operator met it on the
          // card only, once it could no longer be changed.
          const mail = recorder();
          const line = recorder();
          const fields: Record<string, unknown> = {
            '[data-field="mail"]': recorder({
              '.dc-input': mail,
              '[data-completions]': recorder(),
              '[data-identifier]': line,
            }),
          };
          const container = stubContainer();
          (
            container as unknown as { querySelector(s: string): unknown }
          ).querySelector = selector => fields[selector] ?? null;
          const entity = (entry?: Entry): EntityForm =>
            new EntityForm({
              entity: {
                ...users,
                schema: {
                  attributes: {
                    ...users.schema.attributes,
                    uid: {
                      ...users.schema.attributes.uid,
                      label: { en: 'Identifier', fr: 'Identifiant' },
                      generatedFrom: {
                        attribute: 'mail',
                        extract: '^([^@]+)@',
                        lowercase: true,
                        strip: '[^a-zA-Z0-9._-]',
                        onCollision: 'suffix',
                      },
                    },
                  },
                },
              },
              entry,
              translator: new Translator('en'),
              pointerOptions: () => Promise.resolve([]),
              mailDomains: () => Promise.resolve(['example.com']),
              onSubmit: () => Promise.resolve(),
              onCancel: () => undefined,
            });
          await entity().render(container);
          expect(container.innerHTML).to.include(
            '<p class="dc-hint" id="dc-identifier-mail" data-identifier hidden></p>'
          );

          // Not before the address is one
          await type(mail, 'Ux-Audit+1@');
          expect(line.hidden).to.equal(true);
          await type(mail, 'Ux-Audit+1@example.com');
          expect(line.hidden).to.equal(false);
          expect(
            (line as unknown as { textContent: string }).textContent
          ).to.equal(
            'Identifier: ux-audit1 (sign-in name, cannot be changed later). A number is added to it if it is already taken.'
          );
          // Completed from the list, as typed
          await type(mail, 'jane@');
          mail.fire('keydown', enter);
          expect(
            (line as unknown as { textContent: string }).textContent
          ).to.match(/^Identifier: jane /);
          await type(mail, '');
          expect(line.hidden).to.equal(true);

          // Editing, the identifier exists: no line
          const edit = stubContainer();
          await entity({ uid: 'jane', mail: 'jane@example.com' }).render(edit);
          expect(edit.innerHTML).not.to.include('data-identifier');
        });

        it('should stay a plain box, quietly, when the domains cannot be read', async () => {
          let asked = 0;
          const { mail, mailList, values } = await addressForm(() => {
            asked++;
            return Promise.reject(
              Object.assign(new Error('Forbidden'), { status: 403 })
            );
          });
          await type(mail, 'jane@');
          await type(mail, 'jane@ex');
          expect(mailList.hidden).to.equal(true);
          expect(mailList.innerHTML).to.equal('');
          // Not asked again on every keystroke.
          expect(asked).to.equal(1);
          mail.value = 'jane@example.com';
          mail.fire('change');
          expect(values.mail).to.deep.equal(['jane@example.com']);
        });

        it('should be no combobox when the console offers no domains', async () => {
          const { container } = await addressForm();
          expect(container.innerHTML).not.to.include('role="combobox"');
          expect(container.innerHTML).not.to.include('data-completions');
        });
      });
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

    it('should name a nomenclature entry the way its schema does', () => {
      const container = stubContainer();
      new EntityDetail({
        entity: mailboxTypes,
        entry: { cn: 'teamMailbox' },
        translator: new Translator('fr'),
        canWrite: true,
        canDelete: true,
        onEdit: () => undefined,
        onDelete: () => undefined,
        onStatus: () => undefined,
        onResetPassword: () => undefined,
      }).render(container);
      expect(container.innerHTML).to.include('<h2>Boîte partagée');
      // The stored value stays at hand, in the tooltip.
      expect(container.innerHTML).to.include(
        'title="teamMailbox">Boîte partagée</span>'
      );
    });

    it('should leave off the card a value every entry of the entity holds', () => {
      const teamMailboxes: EntityDescriptor = {
        ...users,
        schema: {
          attributes: {
            ...users.schema.attributes,
            twakeMailboxType: {
              type: 'string',
              fixed: true,
              default:
                'cn=teamMailbox,ou=twakeMailboxType,ou=nomenclature,dc=example,dc=com',
              label: { en: 'Mailbox type' },
            },
          },
        },
      };
      const container = stubContainer();
      new EntityDetail({
        entity: teamMailboxes,
        entry: {
          uid: 'support',
          twakeMailboxType:
            'cn=teamMailbox,ou=twakeMailboxType,ou=nomenclature,dc=example,dc=com',
        },
        translator: new Translator('en'),
        canWrite: true,
        canDelete: true,
        onEdit: () => undefined,
        onDelete: () => undefined,
        onStatus: () => undefined,
        onResetPassword: () => undefined,
      }).render(container);
      expect(container.innerHTML).not.to.include('Mailbox type');
      expect(container.innerHTML).to.include('support');
    });

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

    it('should write a date the way the reader does, not as the directory stores it', () => {
      const dated: EntityDescriptor = {
        ...users,
        schema: {
          attributes: {
            ...usersSchema.attributes,
            twakeDeletionDate: { type: 'date' },
          },
        },
      };
      const card = (language: string): string => {
        const container = stubContainer();
        new EntityDetail({
          entity: dated,
          entry: { uid: 'imp.two2', twakeDeletionDate: '20310115000000Z' },
          translator: new Translator(language),
          canWrite: true,
          canDelete: true,
          onEdit: () => undefined,
          onDelete: () => undefined,
          onStatus: () => undefined,
          onResetPassword: () => undefined,
        }).render(container);
        return container.innerHTML;
      };
      expect(card('en')).to.include('>January 15, 2031</span>');
      expect(card('fr')).to.include('>15 janvier 2031</span>');
      // The stored day, whatever the reader's time zone: a date the form
      // set is midnight UTC, the evening before west of Greenwich.
      expect(
        displayValue({ type: 'date' }, '20240930000000Z', undefined, 'en')
      ).to.equal('September 30, 2024');
      // What is no date is shown as it stands.
      expect(displayValue({ type: 'date' }, '20241399000000Z')).to.equal(
        '20241399000000Z'
      );
      expect(displayValue({ type: 'date' }, 'soon')).to.equal('soon');
    });

    it('should show every attribute, the empty ones folded away', () => {
      const html = render({ uid: 'jsmith', mail: 'jsmith@example.com' });
      // The defect this replaces: a card showing two fields, the rest only
      // reachable by opening the edit dialog. They are still on the card, but
      // the empty ones no longer make up most of it.
      const [shown, folded] = html.split('data-empty>');
      expect(shown).to.include('jsmith@example.com');
      expect(shown).not.to.include('Telephone Number');
      expect(folded).to.include('Show empty fields (7)');
      expect(folded).to.include('Name');
      expect(folded).to.include('Telephone Number');
      expect(folded).to.include('Twake Department Link');
    });

    it('should head an account with the person’s name, the identifier under it', () => {
      const html = render({
        uid: 'jsmith',
        cn: 'John Smith',
        mail: 'jsmith@example.com',
      });
      expect(html).to.include('<h2>John Smith</h2>');
      expect(html).to.include(
        '<p class="dc-detail-subtitle" data-subtitle>jsmith · jsmith@example.com</p>'
      );
      // Said in the heading, not again in Details.
      expect(html).not.to.include('<dt>Name</dt>');
      expect(html).not.to.include('<dt>Uid</dt>');
      // Without a name, the identifier heads the card, as it always did.
      expect(render({ uid: 'jsmith' })).to.include('<h2>jsmith</h2>');
      expect(render({ uid: 'jsmith' })).not.to.include('data-subtitle');
    });

    it('should group the details under headings', () => {
      const card = (entity: EntityDescriptor, entry: Entry): string => {
        const container = stubContainer();
        new EntityDetail({
          entity,
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
      const html = card(users, {
        uid: 'jsmith',
        cn: 'John Smith',
        mail: 'jsmith@example.com',
        telephoneNumber: '555 0100',
        twakeDepartmentLink: 'ou=France,ou=Sales,dc=example,dc=com',
        twakeDepartmentPath: 'Sales / France',
      });
      const headings = [...html.matchAll(/<h4>([^<]*)<\/h4>/g)].map(
        match => match[1]
      );
      expect(headings).to.deep.equal([
        'Organization',
        'Contact',
        // Under Show empty fields
        'Identity',
        'Contact',
      ]);
      // The path names the department and leads there: its link would say
      // "France" a second time.
      expect(html).to.include('Sales &#x2F; France');
      expect(html).not.to.include('Twake Department Link');

      // A group the schema gives the form is the card's too, after Contact.
      const quota: EntityDescriptor = {
        ...users,
        schema: {
          attributes: {
            ...usersSchema.attributes,
            mailQuotaSize: {
              type: 'number',
              normalize: 'byteSize',
              group: { en: 'Mailbox Settings' },
            },
            twakeDeletionDate: { type: 'date', role: 'accountExpiry' },
          },
        },
      };
      const sized = card(quota, {
        uid: 'jsmith',
        mail: 'jsmith@example.com',
        mailQuotaSize: '1073741824',
        twakeDeletionDate: '20310115000000Z',
      });
      expect(
        [...sized.matchAll(/<h4>([^<]*)<\/h4>/g)].map(match => match[1])
      ).to.deep.equal([
        'Identity',
        'Contact',
        'Mailbox Settings',
        'Lifecycle',
        // Under Show empty fields
        'Identity',
        'Organization',
        'Contact',
      ]);
      // Rounded, the exact count in the tooltip.
      expect(sized).to.include(
        '<span class="dc-value" title="1073741824 bytes">1.07 GB</span>'
      );
    });

    it('should leave out a common name that repeats the full name', () => {
      const named: EntityDescriptor = {
        ...users,
        schema: {
          attributes: {
            ...usersSchema.attributes,
            cn: { type: 'string', label: { en: 'Common name' } },
            displayName: {
              type: 'string',
              role: 'displayName',
              label: { en: 'Full name' },
            },
          },
        },
      };
      const card = (cn: string): string => {
        const container = stubContainer();
        new EntityDetail({
          entity: named,
          entry: { uid: 'jsmith', cn, displayName: 'John Smith' },
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
      expect(card('John Smith')).not.to.include('Common name');
      expect(card('Smith John')).to.include('<dt>Common name</dt>');
    });

    it('should fold the entry’s DN, which no attribute carries, under Technical details', () => {
      const html = render({
        dn: 'uid=jsmith,ou=users,dc=example,dc=com',
        uid: 'jsmith',
      });
      const [, technical] = html.split('data-technical>');
      expect(technical).to.include('<summary>Technical details</summary>');
      expect(technical).to.include('Distinguished name (DN)');
      expect(technical).to.include(
        '<code class="dc-dn">uid=jsmith,ou=users,dc=example,dc=com</code>'
      );
      expect(technical).to.include('data-copy-dn');
    });

    it('should put Edit first, and Hand over and Delete in a More menu', () => {
      const container = stubContainer();
      new EntityDetail({
        entity: users,
        entry: { uid: 'jsmith' },
        translator: new Translator('en'),
        canWrite: true,
        canDelete: true,
        onEdit: () => undefined,
        onDelete: () => undefined,
        onStatus: () => undefined,
        onResetPassword: () => undefined,
        onHandOver: () => undefined,
      }).render(container);
      const html = container.innerHTML;
      const order = ['data-edit', 'data-password', 'data-status', 'data-more'];
      expect(order.map(data => html.indexOf(data))).to.deep.equal(
        order.map(data => html.indexOf(data)).sort((a, b) => a - b)
      );
      expect(html).to.include('aria-haspopup="menu"');
      expect(html).to.include('aria-expanded="false"');
      const [, menu] = html.split('data-more-menu hidden>');
      expect(menu).to.match(
        /role="menuitem"[^>]*data-hand-over>Hand over<\/button><button type="button" role="menuitem" class="dc-menu-item dc-menu-item-danger" data-delete>Delete<\/button>/
      );
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

    it('should only open the change of state, never write it from the card', () => {
      // A select wrote the state on its first change: an arrow key on it
      // locked an account out. The card now holds a button that opens the
      // panel, and nothing on the card names a state to write.
      let listener: (() => void) | undefined;
      const opened: unknown[][] = [];
      const button = {
        addEventListener: (_type: string, callback: () => void) => {
          listener = callback;
        },
      };
      const container = Object.assign(stubContainer(), {
        querySelector: (selector: string) =>
          selector === '[data-status]' ? button : null,
      });
      new EntityDetail({
        entity: users,
        entry: { uid: 'jsmith' },
        translator: new Translator('en'),
        canWrite: true,
        canDelete: true,
        onEdit: () => undefined,
        onDelete: () => undefined,
        onStatus: (...args: unknown[]) => {
          opened.push(args);
        },
        onResetPassword: () => undefined,
      }).render(container);
      expect(container.innerHTML).to.not.include('<select');
      expect(container.innerHTML).to.not.include('value="disabled"');
      expect(container.innerHTML).to.include(
        '<button type="button" class="dc-button" data-status>Change state…</button>'
      );
      listener?.();
      expect(opened).to.deep.equal([[]]);
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

    it('should name the owners of a group and lead to them', () => {
      // A group's owners are DNs the schema types as strings, and the card
      // showed them whole, where its members read as names leading to them.
      const owned: EntityDescriptor = {
        ...groups,
        schema: {
          attributes: {
            ...groups.schema.attributes,
            owner: {
              type: 'array',
              role: 'owners',
              items: { type: 'string' },
              label: { en: 'Owners' },
            },
          },
        },
      };
      const owner = 'uid=sophie.martin,ou=users,dc=example,dc=com';
      const card = (relationHref?: (dn: string) => string | undefined) => {
        const container = stubContainer();
        new EntityDetail({
          entity: owned,
          entry: { cn: 'sales-team', owner: [owner, 'not a dn'] },
          translator: new Translator('en'),
          canWrite: true,
          canDelete: true,
          onEdit: () => undefined,
          onDelete: () => undefined,
          onStatus: () => undefined,
          onResetPassword: () => undefined,
          relations: { title: 'Members', attribute: 'member', items: [] },
          relationHref,
        }).render(container);
        return container.innerHTML;
      };
      // A link, which a middle click opens in a new tab (#174).
      expect(card(dn => `#/users/${rdnValue(dn)}`))
        .to.include(
          `<a href="#&#x2F;users&#x2F;sophie.martin" class="dc-link" data-relation="${owner}" title="${owner}">sophie.martin</a>`
        )
        .and.not.include(`>${owner}<`);
      // An entry no page shows is named all the same.
      expect(card(() => undefined)).to.include(
        `<span class="dc-value" data-relation="${owner}" title="${owner}">sophie.martin</span>`
      );
      // What is no DN has nowhere to lead.
      expect(card()).to.include(
        '<span class="dc-value" title="not a dn">not a dn</span>'
      );
    });

    it('should say how many related entries the list leaves out', () => {
      const card = (
        language: string,
        relations: { truncated?: boolean; more?: number }
      ): string => {
        const container = stubContainer();
        new EntityDetail({
          entity: groups,
          entry: { cn: 'Human Resources' },
          translator: new Translator(language),
          canWrite: true,
          canDelete: true,
          onEdit: () => undefined,
          onDelete: () => undefined,
          onStatus: () => undefined,
          onResetPassword: () => undefined,
          relations: {
            title: 'Attached entries',
            items: [
              { id: 'uid=erin,ou=users,dc=example,dc=com', label: 'erin' },
            ],
            ...relations,
          },
        }).render(container);
        return container.innerHTML;
      };
      expect(card('en', { truncated: true, more: 48 })).to.include(
        'And 48 more entries, not listed here'
      );
      expect(card('en', { truncated: true, more: 1 })).to.include(
        'And 1 more entry, not listed here'
      );
      expect(card('fr', { truncated: true, more: 1 })).to.include(
        'Et 1 autre entrée, non affichée ici'
      );
      expect(card('en', { truncated: true })).to.include(
        'And more entries than the directory lists at once'
      );
      expect(card('en', {})).to.not.include('more entr');
    });

    it('should escape what the directory holds', () => {
      const html = render({ uid: '<script>alert(1)</script>' });
      expect(html).to.not.include('<script>alert(1)</script>');
      expect(html).to.include('&lt;script&gt;');
    });
  });
});
