import { expect } from 'chai';
import nock from 'nock';
import { GroupPicker } from '../../src/components/GroupPicker';
import { Translator } from '../../src/i18n';
import type { EntityDescriptor, Entry, Scope } from '../../src/types';
import {
  baseUrl,
  stubContainer,
  consoleIn,
  toastElement,
} from '../support/stubs';
import {
  usersSchema,
  users,
  groups,
  twakeGroups,
  mailboxTypes,
  staff,
} from '../fixtures/entities';

describe('Directory console: entries and their groups', () => {
  afterEach(() => nock.cleanAll());

  describe('reference data, for a local administrator', () => {
    const base = 'ou=positions,dc=example,dc=com';
    const positions: EntityDescriptor = {
      key: 'positions',
      pluralName: 'positions',
      singularName: 'position',
      mainAttribute: 'cn',
      base,
      schema: { attributes: { cn: { type: 'string', role: 'identifier' } } },
      endpoint: '/api/v1/ldap/positions',
      kind: 'flat',
    };
    const scoped = (create: boolean): Scope => ({
      user: 'uid=sophie.martin,ou=users,dc=example,dc=com',
      unrestricted: false,
      described: true,
      branches: [
        {
          dn: 'ou=Sales,dc=example,dc=com',
          read: true,
          write: true,
          delete: true,
        },
      ],
      entities: [{ name: 'positions', base, create }],
    });
    /** The list and the card of a position, as this scope sees them */
    const views = async (
      scope: Scope,
      failed = false,
      entities: EntityDescriptor[] = [users, positions]
    ): Promise<{ list: string; card: string }> => {
      const holder = stubContainer();
      const detail = stubContainer();
      const main = {
        innerHTML: '',
        querySelector: (selector: string): unknown =>
          ({ '[data-list]': holder, '[data-detail]': detail })[selector] ??
          null,
      };
      const app = consoleIn({ '[data-main]': main });
      Object.assign(app as unknown as object, {
        scope: failed ? null : scope,
        scopeError: failed ? 'Service Unavailable' : undefined,
        entities,
      });
      Object.assign((app as unknown as { api: object }).api, {
        listBounded: async () => ({
          entries: { Administrator: { cn: 'Administrator' } },
          truncated: false,
        }),
        get: async () => ({
          dn: `cn=Administrator,${base}`,
          cn: 'Administrator',
        }),
        pointerOptions: async () => [],
      });
      const app2 = app as unknown as {
        renderList(main: unknown, entity: EntityDescriptor): Promise<void>;
        renderDetail(
          main: unknown,
          entity: EntityDescriptor,
          id: string,
          generation: number
        ): Promise<void>;
      };
      await app2.renderList(main, positions);
      const list = main.innerHTML + holder.innerHTML;
      await app2.renderDetail(main, positions, 'Administrator', 0);
      return { list, card: detail.innerHTML };
    };
    const readOnly =
      'Reference data is kept outside the console: you can read it and use it in forms';

    it('should offer no Edit nor Delete the server would refuse, and say why', async () => {
      // Edit was offered on a position, to the administrator of Sales, and
      // Save refused: reference data lies outside every department (#167).
      const { list, card } = await views(scoped(false));
      expect(list).to.include(readOnly);
      expect(card).to.include(readOnly);
      expect(card).to.not.include('data-edit');
      expect(card).to.not.include('data-delete');
    });

    it('should withhold them in a directory with no tree, without calling it reference data', async () => {
      // Every collection is put forward there: the line would be untrue.
      const { list, card } = await views(scoped(false), false, [positions]);
      expect(card).to.not.include('data-edit');
      expect(card).to.not.include(readOnly);
      expect(list).to.not.include(readOnly);
    });

    it('should give no reason when the scope could not be read', async () => {
      // The banner says the scope is unavailable; every action is withheld
      // already.
      const { list } = await views(scoped(false), true);
      expect(list).to.not.include(readOnly);
    });

    it('should offer them to whoever the scope lets write them', async () => {
      const { list, card } = await views(scoped(true));
      expect(list).to.not.include(readOnly);
      expect(card).to.include('data-edit');
      expect(card).to.not.include(readOnly);
    });
  });

  describe('a group’s members on its card', () => {
    const bob = 'uid=bob,ou=users,dc=example,dc=com';
    const staff = 'cn=staff,ou=groups,dc=example,dc=com';
    /** The card of a group of one member, as this scope sees it */
    const shown = async (scope: Scope | null, member: string[] = [bob]) => {
      const detail = stubContainer();
      const removed: unknown[][] = [];
      const main = {
        innerHTML: '',
        querySelector: (selector: string): unknown =>
          selector === '[data-detail]' ? detail : null,
      };
      const app = consoleIn({ '[data-main]': main });
      Object.assign(app as unknown as object, {
        scope,
        entities: [users, groups],
      });
      Object.assign((app as unknown as { api: object }).api, {
        get: async () => ({ dn: staff, cn: 'staff', member }),
        pointerOptions: async () => [],
        memberSearch: () => async () => [],
        removeMember: async (...args: unknown[]) => {
          removed.push(args);
        },
      });
      const views = app as unknown as {
        renderDetail(
          main: unknown,
          entity: EntityDescriptor,
          id: string,
          generation: number
        ): Promise<void>;
        removeMember(
          entity: EntityDescriptor,
          id: string,
          name: string,
          dn: string
        ): Promise<void>;
        renderMain(): Promise<void>;
      };
      views.renderMain = async () => undefined;
      await views.renderDetail(main, groups, 'staff', 0);
      return { html: detail.innerHTML, views, removed };
    };

    it('should offer the ×s and Add members… to whoever writes the group only', async () => {
      // Read-only, as the server judges it: neither is offered (#168).
      const readOnly: Scope = {
        user: 'uid=alice,ou=users,dc=example,dc=com',
        unrestricted: false,
        described: true,
        branches: [
          { dn: 'ou=groups,dc=example,dc=com', read: true, write: false },
        ],
        entities: [],
      };
      const read = await shown(readOnly);
      // The same branch written: the right is what decides.
      const writer = await shown({
        ...readOnly,
        branches: [
          { dn: 'ou=groups,dc=example,dc=com', read: true, write: true },
        ],
      });
      expect(writer.html).to.include('data-add-members');
      expect(read.html).to.match(/<h3>[^<]+ \(1\)<\/h3>/);
      expect(read.html).to.not.include('data-add-members');
      expect(read.html).to.not.include('dc-relation-remove');
      const written = await shown(null);
      expect(written.html).to.include('data-add-members');
      expect(written.html).to.include('aria-label="Remove bob from staff"');
      // The × sends one removal, the group by its id, the member by its DN.
      await written.views.removeMember(groups, 'staff', 'staff', bob);
      expect(written.removed).to.deep.equal([[groups, 'staff', bob]]);
    });

    it('should neither count nor offer to remove the empty member', async () => {
      // groupOfNames needs one: ldap-rest writes the empty DN for none.
      const { html } = await shown(null, ['', bob]);
      expect(html).to.match(/<h3>[^<]+ \(1\)<\/h3>/);
      expect(html.match(/dc-relation-remove/g) ?? []).to.have.length(1);
    });

    it('should say why a shared mailbox’s search offers nobody', async () => {
      // It takes accounts of its domain: one found elsewhere is left out,
      // and an address typed at another domain will be refused alike.
      const app = consoleIn({});
      Object.assign(app as unknown as object, {
        entities: [users, groups],
        openPanel: (_title: string, build: (body: unknown) => void) =>
          build(stubContainer()),
        teamMailboxDomain: () => 'example.com',
      });
      Object.assign((app as unknown as { api: object }).api, {
        memberSearch: () => async (query: string) =>
          query === 'carol'
            ? [
                {
                  dn: 'uid=carol,ou=users,dc=example,dc=com',
                  mail: 'carol@other.org',
                },
              ]
            : [],
      });
      let picker: {
        options: {
          search(query: string): Promise<unknown[]>;
          emptyNote(query: string): string | undefined;
        };
      } = undefined as never;
      const original = GroupPicker.prototype.render;
      GroupPicker.prototype.render = function (this: GroupPicker) {
        picker = this as unknown as typeof picker;
      };
      try {
        (
          app as unknown as {
            addMembers(
              entity: EntityDescriptor,
              entry: Entry,
              id: string,
              name: string,
              held: string[]
            ): void;
          }
        ).addMembers(groups, { dn: staff }, 'staff', 'staff', []);
      } finally {
        GroupPicker.prototype.render = original;
      }
      const note =
        'A shared mailbox at example.com only takes accounts of example.com';
      expect(await picker.options.search('dave')).to.deep.equal([]);
      expect(picker.options.emptyNote('dave')).to.equal(undefined);
      expect(picker.options.emptyNote('dave@exam')).to.equal(undefined);
      expect(picker.options.emptyNote('dave@other.org')).to.equal(note);
      expect(await picker.options.search('carol')).to.deep.equal([]);
      expect(picker.options.emptyNote('carol')).to.equal(note);
    });

    it('should leave a flat entity’s members to its form', async () => {
      // A team mailbox has no route for one member: saved whole.
      const mailboxes: EntityDescriptor = { ...groups, kind: 'flat' };
      const detail = stubContainer();
      const main = {
        innerHTML: '',
        querySelector: (selector: string): unknown =>
          selector === '[data-detail]' ? detail : null,
      };
      const app = consoleIn({ '[data-main]': main });
      Object.assign(app as unknown as object, {
        scope: null,
        entities: [users, mailboxes],
      });
      Object.assign((app as unknown as { api: object }).api, {
        get: async () => ({ dn: staff, cn: 'staff', member: [bob] }),
        pointerOptions: async () => [],
        memberSearch: () => async () => [],
      });
      await (
        app as unknown as {
          renderDetail(
            main: unknown,
            entity: EntityDescriptor,
            id: string,
            generation: number
          ): Promise<void>;
        }
      ).renderDetail(main, mailboxes, 'staff', 0);
      expect(detail.innerHTML).to.not.include('data-add-members');
      expect(detail.innerHTML).to.not.include('dc-relation-remove');
    });
  });

  describe('actions on a selection of accounts', () => {
    const actions = (scope: Scope | null, entity: EntityDescriptor = users) => {
      const app = consoleIn({});
      Object.assign(app as unknown as object, {
        scope,
        entities: [users, groups],
      });
      Object.assign((app as unknown as { api: object }).api, {
        groupSearch: () => async () => [],
      });
      return (
        app as unknown as {
          bulkActions(entity: EntityDescriptor): { label: string }[];
        }
      )
        .bulkActions(entity)
        .map(action => action.label);
    };

    it('should offer Add to a group… and Change state… on accounts to whoever writes', () => {
      expect(actions(null)).to.deep.equal(['Add to a group…', 'Change state…']);
      // Nor to someone who administers nothing, nor on another list.
      const nobody: Scope = {
        user: 'alice',
        unrestricted: false,
        described: true,
        branches: [],
        entities: [],
      };
      expect(actions(nobody)).to.deep.equal([]);
      expect(actions(null, groups)).to.deep.equal([]);
    });

    const alice = 'uid=alice,ou=users,dc=example,dc=com';
    const bob = 'uid=bob,ou=users,dc=example,dc=com';
    /** A console whose panel draws what Add to a group… opens */
    const bench = () => {
      const toast = toastElement();
      const holder = stubContainer();
      const body = {
        innerHTML: '',
        scrollTop: 0,
        querySelector: (selector: string): unknown =>
          selector === '[data-bulk-picker]' ? holder : null,
        querySelectorAll: () => [],
      };
      const title = { textContent: '' };
      const panel = { hidden: true, classList: { toggle: () => undefined } };
      const app = consoleIn({
        '[data-panel]': panel,
        '[data-panel-title]': title,
        '[data-panel-body]': body,
        '[data-toast]': toast,
      }) as unknown as {
        scope: Scope | null;
        entities: EntityDescriptor[];
        api: object;
        bulkAddToGroups(
          entity: EntityDescriptor,
          selected: [string, Entry][]
        ): Promise<boolean>;
        closePanel(force?: boolean): void;
        openPanel(title: string, build: (body: unknown) => void): void;
      };
      app.scope = null;
      app.entities = [users, groups];
      return { app, toast, body, title, panel };
    };
    const settled = (promise: Promise<boolean>) => {
      let value: boolean | undefined;
      void promise.then(result => (value = result));
      return async (): Promise<boolean | undefined> => {
        await new Promise(resolve => setTimeout(resolve, 0));
        return value;
      };
    };
    /** The group picker the action draws, caught as it renders */
    const picked = async (start: () => Promise<boolean>) => {
      let picker: {
        options: {
          search(query: string): Promise<unknown>;
          onAdd(
            groups: { dn: string; name: string; label: string }[]
          ): Promise<{ left: { name: string }[]; error?: string }>;
        };
      } = undefined as never;
      const original = GroupPicker.prototype.render;
      GroupPicker.prototype.render = function (this: GroupPicker) {
        picker = this as unknown as typeof picker;
      };
      let outcome: Promise<boolean>;
      try {
        outcome = start();
      } finally {
        GroupPicker.prototype.render = original;
      }
      return { picker, outcome };
    };

    it('should add the accounts to each group, sending none it holds, and keep a refused one', async () => {
      // One member sent again failed the whole request, the others with it.
      const { app, toast, body, title, panel } = bench();
      const found = (cn: string, member: string[]) => ({
        entity: groups,
        dn: `cn=${cn},ou=groups,dc=example,dc=com`,
        entry: { dn: `cn=${cn},ou=groups,dc=example,dc=com`, cn, member },
      });
      const sent: [string, string[]][] = [];
      Object.assign(app.api, {
        groupSearch: () => async () => [
          found('all-staff', [alice]),
          found('sales-team', ['']),
          found('locked', []),
          found('everyone', [alice, bob]),
        ],
        addMembers: async (_entity: unknown, id: string, members: string[]) => {
          sent.push([id, members]);
          if (id === 'locked') throw new Error('Forbidden');
        },
      });
      const { picker, outcome } = await picked(() =>
        app.bulkAddToGroups(users, [
          ['alice', { dn: alice, uid: 'alice' }],
          ['bob', { dn: bob, uid: 'bob' }],
          ['ghost', { uid: 'ghost' }],
        ])
      );
      const done = settled(outcome);
      expect(title.textContent).to.equal('Add 2 accounts to groups');
      expect(body.innerHTML).to.include(
        '1 account you do not administer is left out.'
      );
      const choices = (await picker.options.search('a')) as {
        dn: string;
        name: string;
        label: string;
      }[];
      const answer = await picker.options.onAdd(choices);
      expect(sent).to.deep.equal([
        ['all-staff', [bob]],
        ['sales-team', [alice, bob]],
        ['locked', [alice, bob]],
      ]);
      // One already in a group is not said to be added to it.
      expect(toast.textContent).to.equal(
        '1 account added to all-staff. 2 accounts added to sales-team. 2 accounts were in everyone already.'
      );
      // The refused one stays, named with why, and the panel with it.
      expect(answer.left.map(group => group.name)).to.deep.equal(['locked']);
      expect(answer.error).to.match(/^locked: /);
      expect(panel.hidden).to.equal(false);
      expect(await done()).to.equal(undefined);
      app.closePanel();
      expect(await done()).to.equal(true);
    });

    it('should be done with accounts already in every group chosen', async () => {
      const { app, toast, panel } = bench();
      const sent: unknown[] = [];
      Object.assign(app.api, {
        groupSearch: () => async () => [
          {
            entity: groups,
            dn: 'cn=everyone,ou=groups,dc=example,dc=com',
            entry: {
              dn: 'cn=everyone,ou=groups,dc=example,dc=com',
              cn: 'everyone',
              member: [alice, bob],
            },
          },
        ],
        addMembers: async (...args: unknown[]) => sent.push(args),
      });
      const { picker, outcome } = await picked(() =>
        app.bulkAddToGroups(users, [
          ['alice', { dn: alice, uid: 'alice' }],
          ['bob', { dn: bob, uid: 'bob' }],
        ])
      );
      const done = settled(outcome);
      const choices = (await picker.options.search('every')) as {
        dn: string;
        name: string;
        label: string;
      }[];
      await picker.options.onAdd(choices);
      expect(sent).to.deep.equal([]);
      expect(toast.textContent).to.equal(
        '2 accounts were in everyone already.'
      );
      // The selection goes, as after any action done.
      expect(panel.hidden).to.equal(true);
      expect(await done()).to.equal(true);
    });

    it('should settle nothing changed once its panel is replaced unused', async () => {
      const { app } = bench();
      Object.assign(app.api, { groupSearch: () => async () => [] });
      const { outcome } = await picked(() =>
        app.bulkAddToGroups(users, [['alice', { dn: alice, uid: 'alice' }]])
      );
      const done = settled(outcome);
      app.openPanel('Edit — alice', () => undefined);
      expect(await done()).to.equal(false);
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
});
