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
  treeContainer,
  consoleIn,
  toastElement,
  type TreeContainer,
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

    it('should open on the top of the tree, the address naming it in place', async () => {
      // "Select an organization" beside a tree of one root: the root was
      // always clicked first (#173). Replaced, not pushed: Back leaves.
      const { app, pushed, replaced, read, tree, restore } = setup();
      try {
        await app.followHash();
      } finally {
        restore();
      }
      expect(replaced).to.deep.equal([
        `#/organizations/${encodeURIComponent(top)}`,
      ]);
      expect(pushed).to.deep.equal([]);
      expect(app.route.id).to.equal(top);
      expect(selected(tree())).to.equal(top);
      expect(read).to.deep.equal([top]);
    });

    it('should keep Select an organization when there is no tree to open on', async () => {
      for (const top of [
        async () => null,
        async () => {
          throw new Error('Forbidden');
        },
      ]) {
        const { app, replaced, read, restore } = setup();
        Object.assign((app as unknown as { api: object }).api, {
          organizationTop: top,
        });
        try {
          await app.followHash();
        } finally {
          restore();
        }
        expect(replaced).to.deep.equal([]);
        expect(read).to.deep.equal([]);
        expect(app.route.id).to.equal(undefined);
      }
    });

    it('should name a node picked in the tree in the address, without drawing the view again', async () => {
      const { app, pushed, read, tree, restore } = setup();
      try {
        await app.followHash();
        read.length = 0;
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
        read.length = 0;
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
      const picker = { value: '', addEventListener: () => undefined };
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
        // Counted again after a creation; the transit branch is not served.
        readMembers: async () => null,
      });
      const created: (string | undefined)[] = [];
      Object.assign((app as unknown as { api: object }).api, {
        createOrganization: async (_values: unknown, parentDn?: string) => {
          created.push(parentDn);
        },
      });
      const views = app as unknown as {
        renderDashboard(main: unknown): void;
        openForm(entity: EntityDescriptor): void;
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

    it('should list everyone in an organization holding others, not on the top', async () => {
      // Who is in Sales was a question only reading the whole directory
      // answered (#166). The top is in no path: listed by its own, it gave
      // the people attached to it alone.
      const shown = async (dn: string, children: unknown[]) => {
        const holder = stubContainer();
        const app = consoleIn({ '[data-org-detail]': holder });
        Object.assign(app as unknown as object, {
          entities: [organizations, people],
        });
        Object.assign((app as unknown as { api: object }).api, {
          organization: async () => ({
            dn,
            ou: rdnValue(dn),
            twakeDepartmentPath: dn === top ? 'organization' : 'Sales',
          }),
          organizationMembers: async () => ({ entries: [], truncated: false }),
          organizationChildren: async () => children,
          pointerOptions: async () => [],
        });
        await (
          app as unknown as {
            showOrganization(node: { dn: string; name: string }): Promise<void>;
          }
        ).showOrganization({ dn, name: rdnValue(dn) });
        return { html: holder.innerHTML, app };
      };
      const { html, app } = await shown(sales, [
        { dn: france, name: 'France' },
      ]);
      expect(html).to.include('data-list-everyone');
      expect((await shown(france, [])).html).to.not.include(
        'data-list-everyone'
      );
      expect(
        (await shown(top, [{ dn: sales, name: 'Sales' }])).html
      ).to.not.include('data-list-everyone');
      // It opens the accounts searched by path, cut to Sales and below.
      const g = globalThis as Record<string, unknown>;
      const original = g.window;
      const location = { hash: '' };
      g.window = { location };
      try {
        (
          app as unknown as {
            listEveryone(
              entity: EntityDescriptor,
              entry: Entry,
              dn: string
            ): () => void;
          }
        ).listEveryone(
          organizations,
          { dn: sales, ou: 'Sales', twakeDepartmentPath: 'Sales' },
          sales
        )();
      } finally {
        g.window = original;
      }
      expect(location.hash).to.equal(`#/${people.key}`);
      expect(
        (app as unknown as { listViews: Map<string, unknown> }).listViews.get(
          people.key
        )
      ).to.deep.equal({
        search: 'Sales',
        searchAttribute: 'twakeDepartmentPath',
        under: 'Sales',
      });
    });

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

    it('should say why the organization one administers offers no Edit', async () => {
      // Edit was offered on Sales, to sophie, Sales' administrator, and Save
      // refused: the server judges an organization by its parent (#167).
      const own = await card(sales, localAdmin(sales));
      expect(own).to.not.include('data-edit');
      expect(own).to.include(
        '<p class="dc-muted dc-detail-notice" data-notice>Sales is changed by the administrator above you; you manage what it contains</p>'
      );
      expect(own).to.include('New user here');
      const below = await card(france, localAdmin(sales));
      expect(below).to.include('data-edit');
      expect(below).to.not.include('data-notice');
      // The administrator above is offered it, and told nothing.
      const above = await card(sales, null);
      expect(above).to.include('data-edit');
      expect(above).to.not.include('data-notice');
      // Nor is the administrator of the top of the tree, which nobody above
      // changes from the console: no Edit, and no one above to name.
      const root = await card(
        organizations.base,
        localAdmin(organizations.base)
      );
      expect(root).to.not.include('data-edit');
      expect(root).to.not.include('data-notice');
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
