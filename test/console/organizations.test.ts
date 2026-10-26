import { expect } from 'chai';
import nock from 'nock';
import {
  ConsoleApiClient,
  attachedEntry,
} from '../../src/api/ConsoleApiClient';
import {
  AttachedTables,
  attachedClass,
} from '../../src/components/AttachedTables';
import { EntityForm } from '../../src/components/EntityForm';
import { pointerLabel, rdnValue } from '../../src/format';
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
} from '../fixtures/entities';

describe('Directory console: organizations', () => {
  afterEach(() => nock.cleanAll());

  // The tree between views, its "+" by scope: in test/views/organizations.test.ts.

  describe('creating an organization from the overview', () => {
    // A creation under the one branch written, under the parent picked,
    // refused under it, and at the root: in test/actions/forms.test.ts.
    const top = 'ou=organization,dc=example,dc=com';
    const government = `ou=Government of Mongolia,${top}`;
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

    /** The overview's markup under a scope. */
    const setup = (granted: Scope) => {
      const main = { innerHTML: '', querySelectorAll: () => [] };
      const app = consoleIn({
        '[data-main]': main,
        '[data-toast]': toastElement(),
      });
      Object.assign(app, {
        entities: [organizations],
        scope: granted,
        // Counted on the overview; the transit branch is not served.
        readMembers: async () => null,
      });
      const views = app as unknown as {
        renderDashboard(main: unknown): void;
      };
      return {
        dashboard: (): string => {
          views.renderDashboard(main);
          return main.innerHTML;
        },
      };
    };

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

  // A pointer named by the entry it lands on, the tab's title, an address
  // naming no DN: in test/views/organizations.test.ts.

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
      }).markup().markup;

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

    // Everyone listed from an organization holding others: in
    // test/views/organizations.test.ts.

    it('should offer to list everyone in it when it holds more than its table', () => {
      const html = new AttachedTables({
        entities,
        members: {
          entries: [attachedEntry(sophie, entities)],
          truncated: false,
        },
        translator: new Translator('en'),
        name: 'Sales',
        onListEveryone: () => undefined,
        onOpen: () => undefined,
      }).markup().markup;
      expect(html).to.include(
        '<button type="button" class="dc-button" data-list-everyone>List everyone in Sales, sub-organizations included</button>'
      );
      expect(tables([sophie])).to.not.include('data-list-everyone');
    });

    it('should name each table after its heading, two blocks apart', () => {
      // A reader moving by table heard "table, four columns" twice (#218).
      const first = tables([sophie]);
      const heading = first.match(
        /<h3 id="(dc-attached-people-\d+)">People \(1\)<\/h3>/
      );
      expect(heading, 'heading with an id').to.not.equal(null);
      expect(first).to.include(
        `<table class="dc-table dc-attached-table" aria-labelledby="${heading?.[1]}">`
      );
      const second = tables([sophie]).match(
        /<h3 id="(dc-attached-people-\d+)"/
      );
      expect(second?.[1]).to.not.equal(heading?.[1]);
    });

    it('should carry New user here and New group here when offered', () => {
      const offered = tables([sophie], {}, { people: () => undefined });
      expect(offered).to.include('>New user here<');
      expect(offered).to.not.include('New group here');
      expect(tables([sophie])).to.not.match(/New (user|group) here/);
    });

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

    // Edit, New user here and the empty tables by scope, the accounts and
    // the groups asked apart: in test/views/organizations.test.ts.

    it('should tell the accounts from the groups by the class their schema fixes', () => {
      // What the card asks the server for each table apart.
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

    it('should send a form once while the server answers', async () => {
      // A second Enter created a second account (#164).
      let release = (): void => undefined;
      let sent = 0;
      const form = new EntityForm({
        entity: users,
        translator: new Translator('en'),
        pointerOptions: () => Promise.resolve([]),
        pointerSearch: () => async () => [],
        onSubmit: () => {
          sent++;
          return new Promise<void>(resolve => (release = resolve));
        },
        onCancel: () => undefined,
      }) as unknown as { validate(): boolean; submit(): Promise<void> };
      form.validate = () => true;
      const first = form.submit();
      await form.submit();
      expect(sent).to.equal(1);
      release();
      await first;
      const again = form.submit();
      expect(sent).to.equal(2);
      release();
      await again;
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
        rights: {
          organizationRights(dn: string): { write: boolean; delete: boolean };
        };
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
          '<th scope="col"><span class="dc-visually-hidden">Actions</span></th>'
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
        expect(local.rights.organizationRights(transit)).to.deep.equal({
          write: false,
          delete: false,
        });
        // An organization is judged by its parent: Engineering is changed
        // from above it, what it holds by its administrator (#167).
        expect(
          local.rights.organizationRights(`ou=Engineering,${top}`)
        ).to.deep.equal({ write: false, delete: false });
        expect(
          local.rights.organizationRights(`ou=Backend,ou=Engineering,${top}`)
        ).to.deep.equal({ write: true, delete: true });
        expect(
          local.rights.organizationRights(`ou=Sales,${top}`)
        ).to.deep.equal({
          write: false,
          delete: false,
        });
        const admin = setup(
          {
            ...eric(),
            branches: [{ dn: top, read: true, write: true, delete: true }],
          },
          []
        ).app;
        expect(admin.rights.organizationRights(transit)).to.deep.equal({
          write: true,
          delete: true,
        });
        // A branch naming the organization itself must grant it too.
        const narrowed = setup(
          {
            ...eric(),
            branches: [
              { dn: top, read: true, write: true, delete: true },
              {
                dn: `ou=Engineering,${top}`,
                read: true,
                write: true,
                delete: false,
              },
            ],
          },
          []
        ).app;
        expect(
          narrowed.rights.organizationRights(`ou=Engineering,${top}`)
        ).to.deep.equal({ write: true, delete: false });
        // The most specific branch holding the parent judges, as the
        // server's does; and Delete needs every branch below as well.
        const backend = `ou=Backend,ou=Engineering,${top}`;
        expect(narrowed.rights.organizationRights(backend)).to.deep.equal({
          write: true,
          delete: false,
        });
        const below = setup(
          {
            ...eric(),
            branches: [
              { dn: top, read: true, write: true, delete: true },
              { dn: backend, read: true, write: true, delete: false },
            ],
          },
          []
        ).app;
        expect(
          below.rights.organizationRights(`ou=Engineering,${top}`)
        ).to.deep.equal({ write: true, delete: false });
      });
    });
  });
});
