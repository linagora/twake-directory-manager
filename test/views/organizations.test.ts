/**
 * The organizations page, mounted: the tree, the card of the organization
 * selected beside it, its people and groups, what it offers to create there
 * (src/views/organizations.ts).
 */
import { expect } from 'chai';
import type nock from 'nock';

import type { Entry, Scope } from '../../src/types';
import { click, gate, until } from '../support/act';
import { mountConsole, settled, type Mounted } from '../support/mount';

const top = 'ou=organization,dc=example,dc=com';
const sales = `ou=Sales,${top}`;
const france = `ou=France,${sales}`;
const engineering = `ou=Engineering,${top}`;
const backend = `ou=Backend,${engineering}`;
const transit = `ou=Transit,${top}`;
const users = 'ou=users,dc=example,dc=com';
const groups = 'ou=groups,dc=example,dc=com';
const domains = 'ou=domains,ou=nomenclature,dc=example,dc=com';

/** The last name of a DN: `Sales` for `ou=Sales,…`. */
const rdn = (dn: string): string => /^[^=]+=([^,]+)/.exec(dn)?.[1] ?? dn;

/** Whether a request is for this path, decoded. */
const path =
  (wanted: string) =>
  (uri: string): boolean =>
    decodeURIComponent(uri) === wanted;
/** The path the tree reads an organization's children at. */
const subnodes = (dn: string): ((uri: string) => boolean) =>
  path(
    `/api/v1/ldap/organizations/${dn}/subnodes?objectClass=organizationalUnit`
  );
/** The path the card reads an organization's entries of a class at. */
const attached = (
  dn: string,
  objectClass: string
): ((uri: string) => boolean) =>
  path(`/api/v1/ldap/organizations/${dn}/subnodes?objectClass=${objectClass}`);
/** The path an organization is read at. */
const at = (dn: string): ((uri: string) => boolean) =>
  path(`/api/v1/ldap/organizations/${dn}`);

/** The tree the server holds: Sales and Engineering under the top, one more level under each. */
const held = (): Record<string, { dn: string; ou: string }[]> => ({
  [top]: [
    { dn: sales, ou: 'Sales' },
    { dn: engineering, ou: 'Engineering' },
    { dn: transit, ou: 'Transit' },
  ],
  [sales]: [{ dn: france, ou: 'France' }],
  [france]: [],
  [engineering]: [{ dn: backend, ou: 'Backend' }],
  [backend]: [],
  [transit]: [],
});

interface PageOptions {
  scope?: Scope | null | 'admin';
  language?: string;
  /** The organizations as the server answers them, by DN; the others by their name */
  entries?: Record<string, Entry>;
  /** Answers set before the page's own */
  answers?(server: nock.Scope): void;
}

/**
 * The organizations page at an address, the server holding the tree above:
 * each organization read answers its entry, each branch its children.
 */
const page = async (
  hash: string,
  options: PageOptions = {}
): Promise<Mounted> =>
  mountConsole({
    hash,
    scope: options.scope === undefined ? 'admin' : options.scope,
    language: options.language,
    answers: server => {
      options.answers?.(server);
      server
        .get('/api/v1/ldap/organizations/top')
        .reply(200, { dn: top, ou: 'organization' });
      for (const [dn, children] of Object.entries(held()))
        server.get(subnodes(dn)).reply(200, children);
      for (const dn of Object.keys(held()))
        server
          .get(at(dn))
          .reply(200, options.entries?.[dn] ?? { dn, ou: rdn(dn) });
    },
  });

/** The address of an organization's page, after `#/`. */
const of = (dn: string): string => `organizations/${encodeURIComponent(dn)}`;

/** The heading of the card beside the tree, none while there is no card. */
const heading = (root: HTMLElement): string | undefined =>
  root.querySelector('[data-org-detail] .dc-detail-title h2')?.textContent ??
  undefined;

/** Wait for the card of an organization to be drawn. */
const shown = (root: HTMLElement, name: string): Promise<void> =>
  until(() => heading(root) === name);

/** What the box beside the tree says, card or not. */
const detail = (root: HTMLElement): string =>
  root.querySelector('[data-org-detail]')?.textContent?.trim() ?? '';

/** The node the tree draws as selected. */
const selected = (root: HTMLElement): string | undefined =>
  root.querySelector<HTMLElement>(
    '[data-tree] .dc-selected > .dc-tree-row [data-select]'
  )?.dataset.select;

/** Whether the tree draws a node open. */
const open = (root: HTMLElement, dn: string): boolean =>
  root
    .querySelector(`[data-tree] [data-toggle="${dn}"]`)
    ?.getAttribute('aria-expanded') === 'true';

/** The nodes drawn with a "+". */
const adds = (root: HTMLElement): string[] =>
  Array.from(root.querySelectorAll<HTMLElement>('[data-tree] [data-add]')).map(
    button => button.dataset.add ?? ''
  );

/** The calls of a method of the client. */
const callsOf = (calls: string[], method: string): string[] =>
  calls.filter(call => call.startsWith(`${method}(`));

/** Choose a language in the sidebar, as the reader does. */
const speak = (root: HTMLElement, code: string): void => {
  const select = root.querySelector<HTMLSelectElement>('[data-language]');
  if (!select) throw new Error('no language select');
  select.value = code;
  select.dispatchEvent(new Event('change', { bubbles: true }));
};

/** A local administrator of a branch, who also writes the transit branch. */
const localAdmin = (branch: string): Scope => ({
  user: 'uid=sophie.martin,ou=users,dc=example,dc=com',
  unrestricted: false,
  described: true,
  branches: [
    { dn: branch, read: true, write: true, delete: true },
    { dn: transit, read: true, write: true },
  ],
  entities: [
    { name: 'users', base: users, create: true },
    { name: 'groups', base: groups, create: true },
  ],
  transit,
});

describe('views/organizations', () => {
  describe('the tree', () => {
    it('should open the tree down to the organization an address names', async () => {
      // The Department path link of an account's card leads here: the card
      // showed, but the tree stayed folded and nothing in it was selected.
      const { root, calls } = await page(of(backend));
      await shown(root, 'Backend');
      // Read down to it, and no other branch. Backend's own children are
      // asked by its card (whether it holds others), not by the tree.
      expect(
        callsOf(calls, 'organizationChildren').filter(
          call => call !== `organizationChildren(${backend})`
        )
      ).to.deep.equal([
        `organizationChildren(${top})`,
        `organizationChildren(${engineering})`,
      ]);
      expect(open(root, engineering)).to.be.true;
      expect(open(root, sales)).to.be.false;
      expect(selected(root)).to.equal(backend);
      expect(callsOf(calls, 'organization')).to.deep.equal([
        `organization(${backend})`,
      ]);
    });

    it('should open on the top of the tree, the address naming it in place', async () => {
      // "Select an organization" beside a tree of one root: the root was
      // always clicked first (#173). Replaced, not pushed: Back leaves.
      const steps = window.history.length;
      const { root, calls } = await page('organizations');
      await shown(root, 'organization');
      expect(window.location.hash).to.equal(`#/${of(top)}`);
      // One step for the address the test opened, none for the top's.
      expect(window.history.length).to.equal(steps + 1);
      expect(selected(root)).to.equal(top);
      // Only the top is read. happy-dom tells a `replaceState` as a change
      // of hash, which a browser does not: on its own timer, the page may be
      // drawn, and its card read, once more.
      expect(callsOf(calls, 'organization')).to.include(`organization(${top})`);
      expect(
        callsOf(calls, 'organization').filter(
          call => call !== `organization(${top})`
        )
      ).to.deep.equal([]);
    });

    it('should keep Select an organization when there is no tree to open on', async () => {
      // A tree with no top stands on "Loading…" beside the box, which the
      // mount would wait for: the page is opened from the Overview.
      for (const [status, answer] of [
        [200, {}],
        [403, { error: 'Forbidden' }],
      ] as const) {
        const { root, calls, idle, unmount } = await mountConsole({
          answers: server => {
            server.get('/api/v1/ldap/organizations/top').reply(status, answer);
          },
        });
        await idle();
        const asked = calls.length;
        window.location.hash = '#/organizations';
        await until(() => !!root.querySelector('[data-org-detail]'));
        await idle();
        expect(calls.slice(asked)).to.include('organizationTop()');
        expect(window.location.hash).to.equal('#/organizations');
        expect(callsOf(calls, 'organization')).to.deep.equal([]);
        expect(detail(root)).to.equal('Select an organization');
        unmount();
      }
    });

    it('should name a node picked in the tree in the address, and show its card', async () => {
      const { root, calls } = await page(of(backend));
      await shown(root, 'Backend');
      const steps = window.history.length;
      const reads = callsOf(calls, 'organization').length;
      click(root, `[data-tree] [data-select="${sales}"]`);
      await shown(root, 'Sales');
      expect(window.location.hash).to.equal(`#/${of(sales)}`);
      expect(window.history.length).to.equal(steps + 1);
      await until(() => selected(root) === sales);
      // Picked, it opens; what was open stays so.
      await until(() => open(root, sales));
      expect(open(root, engineering)).to.be.true;
      // Only its card is read. In a browser the page is not drawn again:
      // happy-dom tells a `pushState` as a change of hash, and on its own
      // timer the page may be drawn, and the card read, once more.
      await settled(root);
      expect(callsOf(calls, 'organization').slice(reads)).to.include(
        `organization(${sales})`
      );
      expect(
        callsOf(calls, 'organization')
          .slice(reads)
          .filter(call => call !== `organization(${sales})`)
      ).to.deep.equal([]);
    });

    it('should go Back and Forward between the organizations picked', async () => {
      const { root } = await page(of(sales));
      await shown(root, 'Sales');
      click(root, `[data-tree] [data-select="${engineering}"]`);
      await shown(root, 'Engineering');
      window.history.back();
      await shown(root, 'Sales');
      await until(() => selected(root) === sales);
      expect(window.location.hash).to.equal(`#/${of(sales)}`);
      window.history.forward();
      await shown(root, 'Engineering');
      await until(() => selected(root) === engineering);
    });

    it('should offer a "+" only where a restricted administrator writes', async () => {
      // The tree is drawn from the root, and its "+" there ended in a 403 for
      // an administrator of a branch below it.
      const { root } = await page('organizations', {
        scope: {
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
        },
      });
      await shown(root, 'organization');
      expect(adds(root)).to.deep.equal([engineering]);
      click(root, `[data-tree] [data-toggle="${engineering}"]`);
      await until(() => open(root, engineering));
      expect(adds(root)).to.deep.equal([engineering, backend]);
    });

    it('should offer a "+" on every node when the scope restricts nothing', async () => {
      const { root } = await page('organizations', {
        scope: {
          user: 'admin',
          unrestricted: true,
          branches: [],
          entities: [],
        },
      });
      await shown(root, 'organization');
      expect(adds(root)).to.deep.equal([top, sales, engineering, transit]);
    });

    it('should offer a "+" on every node to a branch written above the root', async () => {
      // An administrator of the whole directory writes no organization as
      // such: the "+" disappeared from the tree altogether.
      const { root } = await page('organizations', {
        scope: {
          user: 'admin',
          unrestricted: false,
          described: true,
          branches: [{ dn: 'dc=example,dc=com', read: true, write: true }],
          entities: [{ name: 'organizations', base: top, create: true }],
        },
      });
      await shown(root, 'organization');
      expect(adds(root)).to.deep.equal([top, sales, engineering, transit]);
    });
  });

  describe('an account administering nothing', () => {
    const nobody: Scope = {
      user: 'alice',
      unrestricted: false,
      described: true,
      branches: [],
      entities: [],
    };

    it('should say there is nothing to manage, and ask for no tree', async () => {
      // The page answered in red with the server's "Token does not have
      // permission on this branch".
      const { root, calls } = await page('organizations', { scope: nobody });
      expect(root.querySelector('[data-main]')?.textContent).to.include(
        'You administer no branch: there is nothing here for you to manage.'
      );
      expect(root.querySelector('[data-tree]')).to.equal(null);
      expect(callsOf(calls, 'organizationTop')).to.deep.equal([]);
    });

    it('should still read the tree for an unrestricted or undescribed scope, which names no branch either', async () => {
      for (const scope of [
        { ...nobody, unrestricted: true },
        { ...nobody, described: false },
      ]) {
        const { root, calls, unmount } = await page('organizations', {
          scope,
        });
        await shown(root, 'organization');
        expect(callsOf(calls, 'organizationTop')).to.have.length.greaterThan(0);
        unmount();
      }
    });
  });

  describe('the card', () => {
    const acme = `ou=Acme,${top}`;
    const salesDomain = `dc=sales,dc=example,dc=org,${domains}`;
    /** Acme, with a mail domain, its card opened; the domains answered so. */
    const acmeCard = async (
      domainsAnswer: [number, object]
    ): Promise<Mounted> => {
      const mounted = await page(of(acme), {
        answers: server => {
          server.get(at(acme)).reply(200, {
            dn: acme,
            ou: 'Acme',
            twakeDomainLink: [salesDomain],
          });
          server.get(/\/api\/v1\/ldap\/domains/).reply(...domainsAnswer);
        },
      });
      await shown(mounted.root, 'Acme');
      return mounted;
    };
    /** The name the card gives a pointer, by the DN it lands on. */
    const named = (root: HTMLElement, dn: string): string | undefined =>
      Array.from(
        root.querySelectorAll<HTMLElement>('[data-org-detail] [title]')
      ).find(element => element.title === dn)?.textContent ?? undefined;

    it('should name a mail domain on a card the way the select does', async () => {
      // The card read `sales`, the RDN, where the form's select offered
      // `sales.example.org` (#57).
      const { root } = await acmeCard([
        200,
        {
          sales: {
            dn: salesDomain,
            dc: 'sales',
            associatedDomain: 'sales.example.org',
            objectClass: ['top', 'domain', 'domainRelatedObject'],
          },
        },
      ]);
      expect(named(root, salesDomain)).to.equal('sales.example.org');
    });

    it('should fall back on the RDN when the branch cannot be read', async () => {
      const { root } = await acmeCard([403, { error: 'Forbidden' }]);
      expect(named(root, salesDomain)).to.equal('sales');
    });

    it('should name the tab after the organization, then the page when a card fails to load', async () => {
      document.title = 'Twake Directory Manager';
      const { root } = await page(of(sales), {
        answers: server => {
          server.get(at(engineering)).reply(503, {
            error: 'Service Unavailable',
          });
        },
      });
      await shown(root, 'Sales');
      expect(document.title).to.equal('Sales — Twake Directory Manager');
      window.location.hash = `#/${of(engineering)}`;
      await until(() => detail(root).includes('Service Unavailable'));
      expect(document.title).to.equal(
        'Organizations — Twake Directory Manager'
      );
    });

    it('should say an address that names no DN names no organization', async () => {
      // `#/organizations/zzz` read the server's "zzz is not a valid DN", in
      // English and red, where any other unknown entry is simply not there.
      const zzz = await page('organizations/zzz');
      await until(() => detail(zzz.root) !== 'Select an organization');
      expect(
        zzz.root.querySelector('[data-org-detail]')?.innerHTML.trim()
      ).to.equal('<p class="dc-empty">This entry no longer exists</p>');
      expect(callsOf(zzz.calls, 'organization')).to.deep.equal([]);
      zzz.unmount();

      const empty = await page('organizations/ou=', { language: 'fr' });
      await until(() => detail(empty.root) !== 'Sélectionnez une organisation');
      expect(
        empty.root.querySelector('[data-org-detail]')?.innerHTML.trim()
      ).to.equal('<p class="dc-empty">Cette entrée n’existe plus</p>');
      empty.unmount();

      // A DN refused all the same is a failure to say as one: a proxy may
      // answer 400 to a real DN, which is no reason to call it gone.
      const acme = `ou=Acme,${top}`;
      const refused = await page(of(acme), {
        answers: server => {
          server
            .get(at(acme))
            .reply(400, { error: `${acme} is not a valid DN` });
        },
      });
      await until(() => detail(refused.root) !== 'Select an organization');
      expect(
        refused.root.querySelector('[data-org-detail]')?.innerHTML.trim()
      ).to.equal(
        `<p class="dc-empty dc-error-block">${acme} is not a valid DN</p>`
      );
      expect(callsOf(refused.calls, 'organization')).to.deep.equal([
        `organization(${acme})`,
      ]);
    });

    it('should list everyone in an organization holding others, not on the top', async () => {
      // Who is in Sales was a question only reading the whole directory
      // answered (#166). The top is in no path: listed by its own, it gave
      // the people attached to it alone.
      const entries = {
        [top]: {
          dn: top,
          ou: 'organization',
          twakeDepartmentPath: 'organization',
        },
        [sales]: { dn: sales, ou: 'Sales', twakeDepartmentPath: 'Sales' },
        [france]: {
          dn: france,
          ou: 'France',
          twakeDepartmentPath: 'Sales / France',
        },
      };
      for (const [dn, offered] of [
        [france, false],
        [top, false],
      ] as const) {
        const { root, unmount } = await page(of(dn), { entries });
        await shown(root, rdn(dn));
        await settled(root);
        expect(!!root.querySelector('[data-list-everyone]'), dn).to.equal(
          offered
        );
        unmount();
      }
      // A search of the path matches a substring: Salesforce is found with
      // Sales, and the list cut to Sales and below leaves it out.
      const account = (uid: string, path: string): Entry => ({
        dn: `uid=${uid},${users}`,
        objectClass: ['top', 'twakeAccount', 'twakeWhitePages'],
        uid,
        displayName: uid,
        twakeDepartmentPath: path,
      });
      const { root, calls } = await page(of(sales), {
        entries,
        answers: server => {
          server
            .get(uri => uri.startsWith('/api/v1/ldap/users?'))
            .reply(200, {
              claire: account('claire', 'Sales / France'),
              marc: account('marc', 'Salesforce'),
            });
        },
      });
      await shown(root, 'Sales');
      await until(() => !!root.querySelector('[data-list-everyone]'));
      // It opens the accounts searched by path, cut to Sales and below.
      click(root, '[data-list-everyone]');
      await until(() => window.location.hash === '#/users');
      await until(() =>
        callsOf(calls, 'listBounded').some(call =>
          call.startsWith('listBounded(users, Sales, twakeDepartmentPath')
        )
      );
      expect(
        root.querySelector<HTMLInputElement>('[data-main] input[type="search"]')
          ?.value
      ).to.equal('Sales');
      await until(() => !!root.querySelector('[data-main] tr[data-id]'));
      expect(
        Array.from(
          root.querySelectorAll<HTMLElement>('[data-main] tr[data-id]')
        ).map(row => row.dataset.id)
      ).to.deep.equal(['claire']);
    });

    /** The card of an organization drawn for a caller of this scope. */
    const card = async (
      dn: string,
      scope: Scope | null,
      answers?: (server: nock.Scope) => void
    ): Promise<HTMLElement> => {
      const { root } = await page(of(dn), { scope, answers });
      await shown(root, rdn(dn));
      await settled(root);
      const holder = root.querySelector<HTMLElement>('[data-org-detail]');
      if (!holder) throw new Error('no card');
      return holder;
    };
    const has = (holder: HTMLElement, selector: string): boolean =>
      !!holder.querySelector(selector);
    const creates = (holder: HTMLElement): string[] =>
      Array.from(
        holder.querySelectorAll<HTMLElement>('[data-create-attached]')
      ).map(button => button.textContent ?? '');

    it('should say why the organization one administers offers no Edit', async () => {
      // Edit was offered on Sales, to sophie, Sales' administrator, and Save
      // refused: the server judges an organization by its parent (#167).
      const own = await card(sales, localAdmin(sales));
      expect(has(own, '[data-edit]')).to.be.false;
      expect(own.querySelector('[data-notice]')?.textContent).to.equal(
        'Sales is changed by the administrator above you; you manage what it contains'
      );
      expect(creates(own)).to.include('New user here');
      const below = await card(france, localAdmin(sales));
      expect(has(below, '[data-edit]')).to.be.true;
      expect(has(below, '[data-notice]')).to.be.false;
      // The administrator above is offered it, and told nothing.
      const above = await card(sales, null);
      expect(has(above, '[data-edit]')).to.be.true;
      expect(has(above, '[data-notice]')).to.be.false;
      // Nor is the administrator of the top of the tree, which nobody above
      // changes from the console: no Edit, and no one above to name.
      const root = await card(top, localAdmin(top));
      expect(has(root, '[data-edit]')).to.be.false;
      expect(has(root, '[data-notice]')).to.be.false;
    });

    it('should offer New user here where the caller creates, as the Overview does', async () => {
      expect(creates(await card(france, localAdmin(sales)))).to.include(
        'New user here'
      );
      expect(creates(await card(france, null))).to.include('New group here');
      // Not on another administrator's organization, nor in transit.
      expect(creates(await card(sales, localAdmin(france)))).to.deep.equal([]);
      expect(creates(await card(transit, localAdmin(sales)))).to.deep.equal([]);
      // Nor where the scope lets the caller create no account.
      const noAccounts = localAdmin(sales);
      noAccounts.entities = [];
      expect(creates(await card(france, noAccounts))).to.deep.equal([]);
      // The global administrator writes above the transit branch: still no
      // account is created there.
      const global: Scope = {
        ...localAdmin(top),
        branches: [{ dn: top, read: true, write: true, delete: true }],
      };
      expect(creates(await card(france, global))).to.include('New user here');
      expect(creates(await card(transit, global))).to.deep.equal([]);
    });

    it('should not say no one is attached where the scope hides the entries, nor when they could not be read', async () => {
      // The server lists a local administrator only the entries of their own
      // branches: on another organization, "No one" was not true.
      expect((await card(france, localAdmin(sales))).textContent).to.include(
        'No one is attached to France.'
      );
      const elsewhere = (await card(engineering, localAdmin(sales)))
        .textContent;
      expect(elsewhere).to.include(
        'None you manage is attached to Engineering.'
      );
      expect(elsewhere).to.not.include('No one');
      // What waits in transit is every administrator's to read.
      expect((await card(transit, localAdmin(sales))).textContent).to.include(
        'No one is attached to Transit.'
      );

      const failed = await card(france, localAdmin(sales), server => {
        server
          .get(attached(france, 'twakeAccount'))
          .reply(500, { error: 'Directory unreachable' });
      });
      expect(has(failed, '.dc-error-block')).to.be.true;
      expect(failed.textContent).to.include('Directory unreachable');
      expect(failed.textContent).to.not.include('No one');
    });

    it('should ask the accounts and the groups apart, each table saying what it leaves out', async () => {
      // Asked at once, they shared one cap of fifty and one count, which did
      // not say of which kind: "Groups (0)" could hide groups.
      const { root, calls } = await page(of(france), {
        scope: localAdmin(sales),
        answers: server => {
          server.get(attached(france, 'twakeAccount')).reply(200, [
            {
              dn: `uid=sophie.martin,${users}`,
              objectClass: ['top', 'twakeAccount', 'twakeWhitePages'],
              uid: 'sophie.martin',
              displayName: 'Sophie Martin',
            },
          ]);
          server.get(attached(france, 'groupOfNames')).reply(200, [
            {
              dn: `cn=sales-team,${groups}`,
              objectClass: ['top', 'groupOfNames', 'twakeStaticGroup'],
              cn: 'sales-team',
            },
            {
              dn: 'more-entries',
              objectClass: ['moreIndicator'],
              _totalCount: 4,
              _displayedCount: 1,
            },
          ]);
        },
      });
      await shown(root, 'France');
      await settled(root);
      expect(
        callsOf(calls, 'organizationMembers')
          .filter(call => call.startsWith(`organizationMembers(${france},`))
          .map(call => /, (\w+)\)$/.exec(call)?.[1])
      ).to.deep.equal(['twakeAccount', 'groupOfNames']);
      const text = root.querySelector('[data-org-detail]')?.textContent ?? '';
      expect(text).to.include('People (1)');
      expect(text).to.include('Groups (1+)');
      const html = root.querySelector('[data-org-detail]')?.innerHTML ?? '';
      expect(html.indexOf('And 3 more entries')).to.be.greaterThan(
        html.indexOf('data-attached="groups"')
      );
    });
  });

  describe('a language switched, then another organization opened (#257)', () => {
    it('should draw the card of the organization opened last', async () => {
      // ORG-09: the card of the first organization checked in English and
      // French, the language set back, the second organization's address
      // opened at once. The tree and "Select an organization" stayed.
      const { root } = await page(of(sales));
      await shown(root, 'Sales');
      speak(root, 'fr');
      await shown(root, 'Sales');
      speak(root, 'en');
      window.location.hash = `#/${of(engineering)}`;
      await shown(root, 'Engineering');
      await until(() => selected(root) === engineering);
      await settled(root);
      expect(heading(root)).to.equal('Engineering');
      expect(document.documentElement.lang).to.equal('en');
    });

    it('should draw it when the cards asked for before answer after it', async () => {
      // Each language drew the page again and read Sales' card again; held,
      // those answers come after the second organization's.
      const held = gate();
      let holding = false;
      const { root, calls, idle } = await page(of(sales), {
        answers: server => {
          server.get(attached(sales, 'twakeAccount')).reply(async () => {
            if (holding) await held.opened;
            return [200, []];
          });
        },
      });
      await shown(root, 'Sales');
      holding = true;
      /** Sales' accounts asked for, as a card past its organization's read asks. */
      const accounts = (): number =>
        callsOf(calls, 'organizationMembers').filter(
          call =>
            call.startsWith(`organizationMembers(${sales},`) &&
            call.endsWith('twakeAccount)')
        ).length;
      const asked = accounts();
      speak(root, 'fr');
      speak(root, 'en');
      // The English page is past Sales' read, its accounts held: the answer
      // that comes after the second organization's exists.
      await until(() => accounts() > asked);
      const reads = callsOf(calls, 'organization').length;
      window.location.hash = `#/${of(engineering)}`;
      await shown(root, 'Engineering');
      held.open();
      await idle();
      await settled(root);
      expect(heading(root)).to.equal('Engineering');
      expect(selected(root)).to.equal(engineering);
      // A change of hash, which happy-dom tells once as a browser does:
      // Engineering read once, by one rendering, and nothing else read.
      expect(callsOf(calls, 'organization').slice(reads)).to.deep.equal([
        `organization(${engineering})`,
      ]);
    });

    it('should draw it when the language is switched while its card is read', async () => {
      const held = gate();
      const { root, calls } = await page(of(sales), {
        answers: server => {
          server.get(attached(engineering, 'twakeAccount')).reply(async () => {
            await held.opened;
            return [200, []];
          });
        },
      });
      await shown(root, 'Sales');
      window.location.hash = `#/${of(engineering)}`;
      await until(() =>
        callsOf(calls, 'organizationMembers').some(call =>
          call.startsWith(`organizationMembers(${engineering},`)
        )
      );
      speak(root, 'fr');
      speak(root, 'en');
      held.open();
      await shown(root, 'Engineering');
      await settled(root);
      expect(heading(root)).to.equal('Engineering');
      expect(selected(root)).to.equal(engineering);
    });

    it('should draw it when the language is switched while the tree is read down to it', async () => {
      // Backend hangs under a branch the tree has not read yet: opening it
      // waits for Engineering's children, and each language asks again.
      const held = gate();
      let holding = false;
      const { root, calls } = await page(of(sales), {
        answers: server => {
          server.get(subnodes(engineering)).reply(async () => {
            if (holding) await held.opened;
            return [200, [{ dn: backend, ou: 'Backend' }]];
          });
        },
      });
      await shown(root, 'Sales');
      holding = true;
      window.location.hash = `#/${of(backend)}`;
      await until(() =>
        callsOf(calls, 'organizationChildren').includes(
          `organizationChildren(${engineering})`
        )
      );
      speak(root, 'fr');
      speak(root, 'en');
      held.open();
      await shown(root, 'Backend');
      await settled(root);
      expect(selected(root)).to.equal(backend);
      expect(callsOf(calls, 'organization')).to.include(
        `organization(${backend})`
      );
    });
  });
});
