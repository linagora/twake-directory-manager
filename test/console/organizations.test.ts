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
import { Rights } from '../../src/rights';
import type { EntityDescriptor, Entry, Scope } from '../../src/types';
import { baseUrl } from '../support/stubs';
import { until } from '../support/act';
import { mountConsole, settled } from '../support/mount';
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

    /** The overview mounted under a scope, with organizations alone. */
    const setup = async (granted: Scope): Promise<string> => {
      const configured = {
        apiPrefix: '/api',
        features: {
          ldapOrganizations: {
            enabled: true,
            topOrganization: top,
            schema: {
              entity: {
                singularName: 'organization',
                pluralName: 'organizations',
                mainAttribute: 'ou',
                base: top,
              },
              attributes: {
                ou: { type: 'string', role: 'identifier' },
                description: { type: 'string' },
              },
            },
          },
        },
      };
      const { root } = await mountConsole({
        hash: '',
        scope: granted,
        answers: server => {
          server.get('/api/v1/config').reply(200, configured);
          server
            .get(/\/api\/v1\/ldap\/organizations\/.*\/subnodes.*/)
            .reply(200, []);
        },
      });
      return root.querySelector('[data-main]')?.innerHTML ?? '';
    };

    it('should still refuse a creation to an administrator writing no organization', async () => {
      const dashboard = await setup(
        scope({
          branches: [
            { dn: government, name: 'Government of Mongolia', read: true },
            writes(transit),
            writes('ou=users,dc=example,dc=com'),
          ],
        })
      );
      expect(dashboard)
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
      const people = empty.slice(0, empty.indexOf('data-attached="groups"'));
      const groups = empty.slice(empty.indexOf('data-attached="groups"'));
      expect(people).to.include('People (0)');
      expect(people).to.include('No one is attached to Sales.');
      expect(groups).to.include('Groups (0)');
      // An empty table of groups says no group, not no one (#271).
      expect(groups).to.include('No group is attached to Sales.');
      expect(groups).to.not.include('No one is attached');
      const french = tables([], {}, undefined, 'fr');
      expect(french).to.include('Personne n’est rattaché à Sales.');
      expect(french).to.include('Aucun groupe n’est rattaché à Sales.');

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

    it('should open the New user form with the department already set', async () => {
      const container = document.createElement('div');
      document.body.append(container);
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
      });
      await form.render(container);
      const token = container.querySelector<HTMLElement>(
        '[data-picker="twakeDepartmentLink"] .dc-token > span'
      );
      expect(token?.textContent).to.equal('Sales / France');
      expect(token?.getAttribute('title')).to.equal(france);
    });

    it('should send a form once while the server answers', async () => {
      // A second Enter created a second account (#164).
      let release = (): void => undefined;
      let sent = 0;
      const form = new EntityForm({
        entity: users,
        entry: {
          uid: 'alice',
          cn: 'Alice',
          mail: 'alice@example.com',
          twakeDepartmentLink: france,
        },
        translator: new Translator('en'),
        pointerOptions: () =>
          Promise.resolve([{ dn: france, label: 'Sales / France' }]),
        onSubmit: () => {
          sent++;
          return new Promise<void>(resolve => (release = resolve));
        },
        onCancel: () => undefined,
      });
      const container = document.createElement('div');
      document.body.append(container);
      await form.render(container);
      const element = container.querySelector('form');
      if (!element) throw new Error('no form');
      const submit = (): void => {
        element.dispatchEvent(
          new Event('submit', { bubbles: true, cancelable: true })
        );
      };
      submit();
      submit();
      expect(sent).to.equal(1);
      release();
      await new Promise(resolve => setTimeout(resolve, 0));
      submit();
      expect(sent).to.equal(2);
      release();
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
      /** The Overview of this scope, the transit branch holding these entries. */
      const mounted = (scope: Scope | null, waiting: Entry[]) =>
        mountConsole({
          hash: '',
          scope,
          answers: server => {
            server
              .get(
                uri =>
                  decodeURIComponent(uri).includes(
                    `/organizations/${transit}/subnodes`
                  ) && decodeURIComponent(uri).includes('twakeAccount')
              )
              .reply(200, waiting);
            server
              .get(uri =>
                decodeURIComponent(uri).includes(
                  `/organizations/${transit}/subnodes`
                )
              )
              .reply(200, []);
          },
        });

      it('should count what waits on the banner, and list it on the Overview', async () => {
        const { root, unmount } = await mounted(eric(), [bob, grace]);
        await until(() => !!root.querySelector('[data-transit-section]'));
        expect(root.querySelector('[data-transit-link]')?.textContent).to.equal(
          'Transit (2)'
        );
        const section = root.querySelector<HTMLElement>(
          '[data-transit-section]'
        ) as HTMLElement;
        expect(section.textContent).to.include('Waiting in transit (2)');
        expect(section.textContent).to.include(
          'Handed over between administrators: claim those that belong to you.'
        );
        expect(section.textContent).to.include('Bob Schneider');
        expect(section.textContent).to.include('Grace Kim');
        expect(section.innerHTML.match(/>Claim…</g)).to.have.length(2);
        // Each button named after its row for a screen reader, and the
        // column holding them named too.
        expect(section.innerHTML).to.include(
          'aria-label="Claim Bob Schneider"'
        );
        expect(section.innerHTML).to.include('aria-label="Claim Grace Kim"');
        expect(section.innerHTML).to.include(
          '<th scope="col"><span class="dc-visually-hidden">Actions</span></th>'
        );
        // No group waits: no Groups table saying so.
        expect(section.innerHTML).to.not.include('data-attached="groups"');
        unmount();
      });

      it('should not invite a read-only administrator to claim', async () => {
        const readOnly = (): Scope => ({
          ...localAdmin(`ou=Engineering,${top}`),
          branches: [{ dn: `ou=Engineering,${top}`, read: true }],
        });
        const { root, unmount } = await mounted(readOnly(), [bob, grace]);
        await until(() => !!root.querySelector('[data-transit-section]'));
        const section = root.querySelector<HTMLElement>(
          '[data-transit-section]'
        ) as HTMLElement;
        expect(section.textContent).to.include('Waiting in transit (2)');
        expect(section.textContent).to.include(
          'Handed over between administrators: no branch you write can take them.'
        );
        expect(section.innerHTML).to.not.include('Claim…');
        unmount();
      });

      it('should not let an older answer count over a newer one', async () => {
        // Read again when the page is drawn again: the answers may come
        // back in any order.
        const answers: ((entries: Entry[]) => void)[] = [];
        const { root, unmount } = await mountConsole({
          hash: '',
          scope: eric(),
          answers: server => {
            server
              .get(
                uri =>
                  decodeURIComponent(uri).includes(
                    `/organizations/${transit}/subnodes`
                  ) && decodeURIComponent(uri).includes('twakeAccount')
              )
              .times(2)
              .reply(async () => {
                const entries = await new Promise<Entry[]>(resolve =>
                  answers.push(resolve)
                );
                return [200, entries];
              });
            server
              .get(uri =>
                decodeURIComponent(uri).includes(
                  `/organizations/${transit}/subnodes`
                )
              )
              .times(2)
              .reply(200, []);
          },
        });
        await until(() => answers.length === 1);
        const language =
          root.querySelector<HTMLSelectElement>('[data-language]');
        if (!language) throw new Error('no language select');
        language.value = 'fr';
        language.dispatchEvent(new Event('change', { bubbles: true }));
        await until(() => answers.length === 2);
        const link = (): string | null | undefined =>
          root.querySelector('[data-transit-link]')?.textContent;
        answers[1]([grace]);
        await until(() => link() === 'Transit (1)');
        answers[0]([bob, grace]);
        await settled(root);
        expect(link()).to.equal('Transit (1)');
        unmount();
      });

      it('should say nothing when nothing waits', async () => {
        const none = await mounted(eric(), []);
        await none.idle();
        expect(none.root.querySelector('[data-transit-section]')).to.equal(
          null
        );
        expect(
          none.root.querySelector('[data-transit-link]')?.textContent
        ).to.equal('Transit');
        none.unmount();

        // Nor to a scope without a transit branch, which is not asked.
        const without = await mounted({ ...eric(), transit: null }, [bob]);
        await without.idle();
        expect(without.root.querySelector('[data-transit-section]')).to.equal(
          null
        );
        expect(without.root.querySelector('[data-transit-link]')).to.equal(
          null
        );
      });

      it('should offer Edit and Delete on the transit branch to its writer above only', () => {
        // Every administrator writes the transit branch to hand entries
        // over: Edit was offered on it, and Save refused at the end.
        const rights = (scope: Scope): Rights => new Rights(scope, null, false);
        expect(rights(eric()).organizationRights(transit)).to.deep.equal({
          write: false,
          delete: false,
        });
        // An organization is judged by its parent: Engineering is changed
        // from above it, what it holds by its administrator (#167).
        expect(
          rights(eric()).organizationRights(`ou=Engineering,${top}`)
        ).to.deep.equal({ write: false, delete: false });
        expect(
          rights(eric()).organizationRights(`ou=Backend,ou=Engineering,${top}`)
        ).to.deep.equal({ write: true, delete: true });
        expect(
          rights(eric()).organizationRights(`ou=Sales,${top}`)
        ).to.deep.equal({
          write: false,
          delete: false,
        });
        const admin = rights({
          ...eric(),
          branches: [{ dn: top, read: true, write: true, delete: true }],
        });
        expect(admin.organizationRights(transit)).to.deep.equal({
          write: true,
          delete: true,
        });
        // A branch naming the organization itself must grant it too.
        const narrowed = rights({
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
        });
        expect(
          narrowed.organizationRights(`ou=Engineering,${top}`)
        ).to.deep.equal({ write: true, delete: false });
        // The most specific branch holding the parent judges, as the
        // server's does; and Delete needs every branch below as well.
        const backend = `ou=Backend,ou=Engineering,${top}`;
        expect(narrowed.organizationRights(backend)).to.deep.equal({
          write: true,
          delete: false,
        });
        const below = rights({
          ...eric(),
          branches: [
            { dn: top, read: true, write: true, delete: true },
            { dn: backend, read: true, write: true, delete: false },
          ],
        });
        expect(below.organizationRights(`ou=Engineering,${top}`)).to.deep.equal(
          { write: true, delete: false }
        );
      });
    });
  });
});
