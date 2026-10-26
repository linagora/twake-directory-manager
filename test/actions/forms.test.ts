/**
 * The forms, mounted: an entry created from its list or an organization's
 * card and edited from its own, a refusal said under the field at fault,
 * the discard question, and the organizations' form, from the tree, the
 * card and the Overview (src/actions/forms.ts).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { expect } from 'chai';
import type nock from 'nock';

import type { Entry, Scope } from '../../src/types';
import { click, panelOf, press, type, until } from '../support/act';
import {
  mountConsole,
  settled,
  type Mounted,
  type MountOptions,
} from '../support/mount';

const FIXTURES = join(__dirname, '..', 'fixtures');
const read = <T>(file: string): T =>
  JSON.parse(readFileSync(join(FIXTURES, file), 'utf8')) as T;

/** Alice's entry, as the ldap-rest tested answers it: in Sales / France. */
const alice = read<{ body: Entry }>('contract/users-alice.json').body;
/** The refusal of a branch the caller does not administer, as recorded. */
const forbidden = read<{ body: object }>(
  'contract/refusal-forbidden.json'
).body;
/** The refusal of an address used already, as recorded. */
const duplicate = read<{ body: object }>(
  'contract/refusal-duplicate.json'
).body;

const top = 'ou=organization,dc=example,dc=com';
const sales = `ou=Sales,${top}`;
const france = `ou=France,${sales}`;
const engineering = `ou=Engineering,${top}`;
const backend = `ou=Backend,${engineering}`;
const lyon = `ou=Lyon,${engineering}`;
const transit = `ou=Transit,${top}`;

/** The toast's message, or nothing while it is hidden. */
const toast = (root: HTMLElement): string => {
  const element = root.querySelector<HTMLElement>('[data-toast]');
  return element && !element.hidden ? (element.textContent ?? '') : '';
};

/** Whether the toast says a refusal. */
const refused = (root: HTMLElement): boolean =>
  !!root.querySelector('[data-toast]')?.classList.contains('dc-toast-error');

/** The calls of a method of the client. */
const callsOf = (calls: string[], method: string): string[] =>
  calls.filter(call => call.startsWith(`${method}(`));

/** A field of the form open in the panel, by its attribute. */
const field = (root: HTMLElement, name: string): HTMLInputElement | null =>
  panelOf(root).body.querySelector<HTMLInputElement>(`[name="${name}"]`);

/** The refusal shown under a field of the form, if any. */
const fieldError = (root: HTMLElement, name: string): string => {
  const error = panelOf(root).body.querySelector<HTMLElement>(
    `[data-field="${name}"] [data-error]`
  );
  return error && !error.hidden ? (error.textContent ?? '') : '';
};

/** Wait for the form to be drawn in the panel. */
const drawn = (root: HTMLElement): Promise<void> =>
  until(() => !!panelOf(root).body.querySelector('form button[type="submit"]'));

/** Press Save, from the button, as the reader does: the focus is on it. */
const save = (root: HTMLElement): void => {
  const button = panelOf(root).body.querySelector<HTMLElement>(
    'form button[type="submit"]'
  );
  if (!button) throw new Error('no Save');
  button.focus();
  button.click();
};

/** The organization tree the department picker searches, before the mount's empty one. */
const departments = (server: nock.Scope): void => {
  server
    .get('/api/v1/ldap/organizations/top')
    .reply(200, { dn: top, ou: 'organization' });
  server
    .get(/\/api\/v1\/ldap\/organizations\/[^/]+\/search\?q=/)
    .reply(200, [{ dn: sales, ou: 'Sales', twakeDepartmentPath: 'Sales' }]);
};

/** Pick Sales in the department field, searched as the reader does. */
const pickSales = async (root: HTMLElement): Promise<void> => {
  const { body } = panelOf(root);
  type(
    body.querySelector<HTMLInputElement>('#dc-field-twakeDepartmentLink'),
    'Sal'
  );
  await until(() => !!body.querySelector('[data-candidate="0"]'));
  // The first match is the active one: Enter takes it.
  press('Enter');
};

/**
 * The list of users, its New user form open and filled for Hélène, a
 * password typed so that none is generated; Save not pressed yet.
 */
const newUser = async (options: MountOptions = {}): Promise<Mounted> => {
  const mounted = await mountConsole({
    hash: 'users',
    answers: departments,
    ...options,
  });
  const { root } = mounted;
  click(root, '[data-main] [data-new]');
  await drawn(root);
  type(field(root, 'employeeNumber'), 'E0099');
  type(field(root, 'sn'), 'Lefèvre');
  type(field(root, 'givenName'), 'Hélène');
  type(field(root, 'displayName'), 'Hélène Lefèvre');
  type(field(root, 'mail'), 'helene@example.com');
  type(field(root, 'userPassword'), 'Typed-1!');
  await pickSales(root);
  return mounted;
};

/** Alice's card, its Edit form open. */
const editAlice = async (options: MountOptions = {}): Promise<Mounted> => {
  const mounted = await mountConsole({
    hash: 'users/alice',
    account: alice,
    ...options,
  });
  click(mounted.root, '[data-main] [data-edit]');
  await drawn(mounted.root);
  return mounted;
};

describe('actions/forms', () => {
  describe('an entry of a flat or group entity', () => {
    it('should name a nomenclature entry as its card does, to edit it', async () => {
      // Its deletion is asked in test/actions/deletion.test.ts.
      const edited = async (id: string): Promise<[string, boolean]> => {
        const mounted = await mountConsole({
          hash: `mailboxTypes/${id}`,
          scope: null,
          language: 'fr',
          answers: server => {
            server.get(`/api/v1/ldap/mailboxTypes/${id}`).reply(200, {
              dn: `cn=${id},ou=twakeMailboxType,ou=nomenclature,dc=example,dc=com`,
              cn: id,
            });
          },
        });
        const { root } = mounted;
        const edit = root.querySelector<HTMLElement>('[data-main] [data-edit]');
        edit?.focus();
        edit?.click();
        await drawn(root);
        const { title, body } = panelOf(root);
        const into = body.contains(document.activeElement);
        const said = title.textContent ?? '';
        mounted.unmount();
        return [said, into];
      };
      // The focus goes into the form, off the button that opened it.
      expect(await edited('teamMailbox')).to.deep.equal([
        'Modifier — Boîte partagée',
        true,
      ]);
      // A value the schema does not name keeps its own.
      expect(await edited('archive')).to.deep.equal([
        'Modifier — archive',
        true,
      ]);
    });

    it('should name what was created in its toast, and open its card', async () => {
      // "Created" alone did not say what: by its full name.
      const english = await newUser();
      english.server.post('/api/v1/ldap/users').reply(200, { uid: 'helene' });
      save(english.root);
      await until(() => window.location.hash === '#/users/helene');
      expect(toast(english.root)).to.equal('Hélène Lefèvre created');
      expect(refused(english.root)).to.be.false;
      expect(panelOf(english.root).panel.hidden).to.be.true;
      expect(callsOf(english.calls, 'create')).to.deep.equal([
        'create(users, ' +
          JSON.stringify({
            employeeNumber: 'E0099',
            twakeDepartmentLink: sales,
            cn: 'Hélène Lefèvre',
            sn: 'Lefèvre',
            givenName: 'Hélène',
            displayName: 'Hélène Lefèvre',
            mail: 'helene@example.com',
            userPassword: 'Typed-1!',
          }) +
          ')',
      ]);
      english.unmount();

      // Said without a gender in French, a group or an organization being
      // named by the same sentence.
      const french = await newUser({ language: 'fr' });
      french.server.post('/api/v1/ldap/users').reply(200, { uid: 'helene' });
      save(french.root);
      await until(() => window.location.hash === '#/users/helene');
      expect(toast(french.root)).to.equal(
        'Hélène Lefèvre est maintenant dans l’annuaire'
      );
    });

    it('should name a group created by its identifier, the server answering none', async () => {
      // A group answers only {success: true}: its identifier is the one sent.
      const { root, server, calls } = await mountConsole({
        hash: 'groups',
        answers: server => {
          departments(server);
          server
            .get('/api/v1/ldap/groups/sales-team')
            .reply(200, { dn: 'cn=sales-team,ou=groups,dc=example,dc=com' });
        },
      });
      click(root, '[data-main] [data-new]');
      await drawn(root);
      type(field(root, 'cn'), 'sales-team');
      await pickSales(root);
      server.post('/api/v1/ldap/groups').reply(200, { success: true });
      save(root);
      await until(() => window.location.hash === '#/groups/sales-team');
      expect(toast(root)).to.equal('sales-team created');
      expect(callsOf(calls, 'create')).to.have.length(1);
    });

    it('should save an edit, say so, and draw the card again', async () => {
      const { root, server, calls, idle } = await editAlice();
      expect(panelOf(root).title.textContent).to.equal('Edit — alice');
      server.put('/api/v1/ldap/users/alice').reply(200, {});
      const reads = callsOf(calls, 'get').length;
      type(field(root, 'l'), 'Paris');
      save(root);
      await until(() => toast(root) === 'Saved');
      await idle();
      await settled(root);
      expect(panelOf(root).panel.hidden).to.be.true;
      expect(callsOf(calls, 'update')).to.deep.equal([
        `update(users, alice, ${JSON.stringify({ l: 'Paris' })}, [], ${JSON.stringify(alice)})`,
      ]);
      // Drawn again from the server, the address unchanged.
      expect(
        callsOf(calls, 'get')
          .slice(reads)
          .filter(call => call.startsWith('get(users'))
      ).to.deep.equal(['get(users, alice)']);
      expect(window.location.hash).to.equal('#/users/alice');
    });

    it('should show a refusal under the field at fault, the toast pointing there', async () => {
      const { root, server } = await newUser();
      server.post('/api/v1/ldap/users').reply(409, duplicate);
      save(root);
      await until(() => toast(root) !== '');
      expect(toast(root)).to.equal('Not saved: see the highlighted field');
      expect(refused(root)).to.be.true;
      expect(fieldError(root, 'mail')).to.equal(
        'Email “alice@example.com” is already used by another entry.'
      );
      // On the field, off the Save button pressed: a screen reader says it
      // is invalid, and why.
      expect(document.activeElement).to.equal(
        panelOf(root).body.querySelector('#dc-field-mail')
      );
      expect(panelOf(root).panel.hidden).to.be.false;
      expect(window.location.hash).to.equal('#/users');
    });

    it('should say in the toast a refusal of a field the form does not show', async () => {
      // The identifier is generated: the form has no field for it.
      const { root, server } = await newUser();
      server.post('/api/v1/ldap/users').reply(409, {
        error: 'user: "helene" is already used (uid must be unique)',
        code: 'unique',
        attribute: 'uid',
        value: 'helene',
      });
      save(root);
      await until(() => toast(root) !== '');
      expect(toast(root)).to.match(
        /“helene” is already used by another entry\.$/
      );
      expect(refused(root)).to.be.true;
      expect(panelOf(root).panel.hidden).to.be.false;
    });

    it('should blame the organization a new account goes to, under its field', async () => {
      // "You do not administer Hélène Lefèvre" said of an account that did
      // not exist yet: the server judges it on its organization.
      const { root, server } = await newUser();
      server.post('/api/v1/ldap/users').reply(403, forbidden);
      save(root);
      await until(() => toast(root) !== '');
      expect(fieldError(root, 'twakeDepartmentLink')).to.equal(
        'You do not administer Sales: this change is not yours to make.'
      );
      expect(toast(root)).to.equal('Not saved: see the highlighted field');
    });

    it('should blame the entry itself for an edit that moves it nowhere', async () => {
      const { root, server } = await editAlice();
      server.put('/api/v1/ldap/users/alice').reply(403, forbidden);
      type(field(root, 'l'), 'Paris');
      save(root);
      await until(() => toast(root) !== '');
      expect(toast(root)).to.equal(
        'You do not administer Alice Moreau: this change is not yours to make.'
      );
      expect(refused(root)).to.be.true;
      expect(panelOf(root).panel.hidden).to.be.false;
    });

    it('should blame where a moved account goes, or where it was when the caller writes there', async () => {
      /** Alice moved to Sales under this scope, refused: what is said under the field. */
      const moved = async (scope: Scope | null): Promise<string> => {
        const mounted = await editAlice({ scope, answers: departments });
        const { root, server } = mounted;
        server.put('/api/v1/ldap/users/alice').reply(403, forbidden);
        await pickSales(root);
        save(root);
        await until(() => toast(root) !== '');
        const said = fieldError(root, 'twakeDepartmentLink');
        mounted.unmount();
        return said;
      };
      const restricted = (writes: string): Scope => ({
        user: 'uid=sophie.martin,ou=users,dc=example,dc=com',
        unrestricted: false,
        described: true,
        branches: [
          { dn: france, read: true, write: writes === france },
          { dn: sales, read: true, write: writes === sales },
        ],
        entities: [
          { name: 'users', base: 'ou=users,dc=example,dc=com', create: false },
        ],
        transit,
      });
      // The scope says nothing: where it goes, as the field named it.
      expect(await moved(null)).to.equal(
        'You do not administer Sales: this change is not yours to make.'
      );
      // Written where it goes: where it was, by its path.
      expect(await moved(restricted(sales))).to.equal(
        'You do not administer Sales / France: this change is not yours to make.'
      );
      // Not written where it goes: there.
      expect(await moved(restricted(france))).to.equal(
        'You do not administer Sales: this change is not yours to make.'
      );
    });
  });

  describe('an entry created from an organization’s card', () => {
    it('should start in the organization, and draw its card again once created', async () => {
      const subnodes =
        (dn: string) =>
        (uri: string): boolean =>
          decodeURIComponent(uri) ===
          `/api/v1/ldap/organizations/${dn}/subnodes?objectClass=organizationalUnit`;
      const { root, server, calls } = await mountConsole({
        hash: `organizations/${encodeURIComponent(france)}`,
        answers: server => {
          server
            .get('/api/v1/ldap/organizations/top')
            .reply(200, { dn: top, ou: 'organization' });
          server.get(subnodes(top)).reply(200, [{ dn: sales, ou: 'Sales' }]);
          server
            .get(subnodes(sales))
            .reply(200, [{ dn: france, ou: 'France' }]);
          server.get(subnodes(france)).reply(200, []);
          server
            .get(
              uri =>
                decodeURIComponent(uri) ===
                `/api/v1/ldap/organizations/${france}`
            )
            .reply(200, {
              dn: france,
              ou: 'France',
              twakeDepartmentPath: 'Sales / France',
            });
        },
      });
      const create = (): HTMLElement | null =>
        root.querySelector<HTMLElement>(
          '[data-org-detail] [data-create-attached="people"]'
        );
      await until(() => !!create());
      create()?.focus();
      create()?.click();
      await drawn(root);
      expect(panelOf(root).title.textContent).to.equal('New user');
      type(field(root, 'employeeNumber'), 'E0099');
      type(field(root, 'sn'), 'Lefèvre');
      type(field(root, 'givenName'), 'Hélène');
      type(field(root, 'displayName'), 'Hélène Lefèvre');
      type(field(root, 'mail'), 'helene@example.com');
      type(field(root, 'userPassword'), 'Typed-1!');
      server.post('/api/v1/ldap/users').reply(200, { uid: 'helene' });
      const reads = callsOf(calls, 'organization').length;
      const before = create();
      save(root);
      await until(() => toast(root) === 'Hélène Lefèvre created');
      // The card drawn anew, its button with it: the focus is on the new
      // one, for the next creation.
      await until(() => !!create() && create() !== before);
      await until(() => document.activeElement === create());
      expect(callsOf(calls, 'create')[0]).to.include(
        `"twakeDepartmentLink":"${france}"`
      );
      expect(callsOf(calls, 'organization').slice(reads)).to.deep.equal([
        `organization(${france})`,
      ]);
      // No card of the account opened over the organization's.
      expect(window.location.hash).to.equal(
        `#/organizations/${encodeURIComponent(france)}`
      );
      expect(panelOf(root).panel.hidden).to.be.true;
    });
  });

  describe('a form closed with what was typed in it', () => {
    it('should ask before discarding, Keep editing first', async () => {
      // Escape, × or Cancel closed a filled form at once (#169).
      const { root, calls } = await editAlice();
      const { panel, body } = panelOf(root);
      const actions = body.querySelector<HTMLElement>('.dc-form-actions');
      type(field(root, 'l'), 'Paris');
      press('Escape');
      expect(panel.hidden).to.be.false;
      expect(actions?.hidden).to.be.true;
      const asking = body.querySelector<HTMLElement>('[data-discard]');
      expect(asking?.textContent?.replace(/\s+/g, ' ').trim()).to.equal(
        'Discard what you typed? Keep editing Discard'
      );
      // Read with the button the focus is moved to.
      expect(asking?.getAttribute('role')).to.equal('group');
      const keep = body.querySelector<HTMLElement>('[data-discard-keep]');
      expect(document.activeElement).to.equal(keep);
      // Keep editing gives the form back as it was, the focus where it was.
      keep?.click();
      expect(body.querySelector('[data-discard]')).to.equal(null);
      expect(actions?.hidden).to.be.false;
      expect(panel.hidden).to.be.false;
      expect(document.activeElement).to.equal(field(root, 'l'));
      // Asked again, Discard closes, and nothing is written.
      click(panelOf(root).dialog, '[data-panel-close]');
      expect(panel.hidden).to.be.false;
      click(body, '[data-discard-confirm]');
      expect(panel.hidden).to.be.true;
      expect(callsOf(calls, 'update')).to.deep.equal([]);
    });

    it('should close on a second Escape, and at once when nothing changed', async () => {
      const typed = await editAlice();
      type(field(typed.root, 'l'), 'Paris');
      press('Escape');
      expect(panelOf(typed.root).panel.hidden).to.be.false;
      press('Escape');
      expect(panelOf(typed.root).panel.hidden).to.be.true;
      typed.unmount();

      const clean = await editAlice();
      field(clean.root, 'l')?.focus();
      press('Escape');
      expect(panelOf(clean.root).panel.hidden).to.be.true;
      expect(clean.root.querySelector('[data-discard]')).to.equal(null);
    });
  });

  describe('an organization, from the tree and its card', () => {
    /** The path the tree reads an organization's children at. */
    const subnodes =
      (dn: string) =>
      (uri: string): boolean =>
        decodeURIComponent(uri) ===
        `/api/v1/ldap/organizations/${dn}/subnodes?objectClass=organizationalUnit`;
    /** The path an organization is read and written at. */
    const at =
      (dn: string) =>
      (uri: string): boolean =>
        decodeURIComponent(uri) === `/api/v1/ldap/organizations/${dn}`;

    /**
     * The organizations page on an organization, the tree a few deep: Sales
     * and Engineering under the top, Backend under Engineering, and Lyon
     * too once created.
     */
    const page = async (dn: string): Promise<Mounted & { create(): void }> => {
      let created = false;
      const mounted = await mountConsole({
        hash: `organizations/${encodeURIComponent(dn)}`,
        answers: server => {
          server
            .get('/api/v1/ldap/organizations/top')
            .reply(200, { dn: top, ou: 'organization' });
          server.get(subnodes(top)).reply(200, [
            { dn: sales, ou: 'Sales' },
            { dn: engineering, ou: 'Engineering' },
          ]);
          server
            .get(subnodes(engineering))
            .reply(() => [
              200,
              [
                { dn: backend, ou: 'Backend' },
                ...(created ? [{ dn: lyon, ou: 'Lyon' }] : []),
              ],
            ]);
          for (const leaf of [sales, backend, lyon])
            server.get(subnodes(leaf)).reply(200, []);
          for (const one of [top, sales, engineering, backend, lyon])
            server
              .get(at(one))
              .reply(200, { dn: one, ou: /^ou=([^,]+)/.exec(one)?.[1] });
        },
      });
      await until(
        () => !!mounted.root.querySelector('[data-org-detail] [data-edit]')
      );
      return { ...mounted, create: () => (created = true) };
    };

    /** The node the tree draws as selected. */
    const selected = (root: HTMLElement): string | undefined =>
      root.querySelector<HTMLElement>(
        '[data-tree] .dc-selected > .dc-tree-row [data-select]'
      )?.dataset.select;
    /** Whether the tree draws a node open. */
    const open = (root: HTMLElement, dn: string): boolean =>
      Array.from(
        root.querySelectorAll<HTMLElement>('[data-tree] [data-toggle]')
      ).some(
        toggle =>
          toggle.dataset.toggle === dn &&
          toggle.getAttribute('aria-expanded') === 'true'
      );

    it('should keep the tree open and the organization on screen after a save', async () => {
      const { root, server, calls, idle } = await page(backend);
      expect(selected(root)).to.equal(backend);
      server.put(at(backend)).reply(200, {});
      click(root, '[data-org-detail] [data-edit]');
      await drawn(root);
      expect(panelOf(root).title.textContent).to.equal('Edit — Backend');
      const listed = callsOf(calls, 'organizationChildren').length;
      const reads = callsOf(calls, 'organization').length;
      type(field(root, 'description'), 'Servers');
      save(root);
      await until(() => toast(root) === 'Saved');
      // Its parent read again, then the page drawn again: nothing shows it
      // is done but the calls answered.
      await idle();
      await settled(root);
      expect(panelOf(root).panel.hidden).to.be.true;
      expect(callsOf(calls, 'updateOrganization')).to.deep.equal([
        `updateOrganization(${backend}, ${JSON.stringify({ description: 'Servers' })}, [])`,
      ]);
      // Its parent is read again for a changed name, and no other branch of
      // the tree. Its card asks again whether it holds others, its node
      // being read anew with its parent's children.
      expect(
        callsOf(calls, 'organizationChildren')
          .slice(listed)
          .filter(call => call !== `organizationChildren(${backend})`)
      ).to.deep.equal([`organizationChildren(${engineering})`]);
      expect(open(root, engineering)).to.be.true;
      expect(selected(root)).to.equal(backend);
      expect(callsOf(calls, 'organization').slice(reads)).to.deep.equal([
        `organization(${backend})`,
      ]);
      expect(window.location.hash).to.equal(
        `#/organizations/${encodeURIComponent(backend)}`
      );
    });

    it('should name an organization whose change is refused by its own name', async () => {
      const { root, server } = await page(backend);
      server.put(at(backend)).reply(403, forbidden);
      click(root, '[data-org-detail] [data-edit]');
      await drawn(root);
      type(field(root, 'description'), 'Servers');
      save(root);
      await until(() => toast(root) !== '');
      expect(toast(root)).to.equal(
        'You do not administer Backend: this change is not yours to make.'
      );
      expect(refused(root)).to.be.true;
      expect(panelOf(root).panel.hidden).to.be.false;
    });

    it('should show and select an organization just created where it was created', async () => {
      const mounted = await page(engineering);
      const { root, server, calls, idle } = mounted;
      click(root, `[data-tree] [data-toggle="${engineering}"]`);
      await until(() => open(root, engineering));
      server.post('/api/v1/ldap/organizations').reply(() => {
        mounted.create();
        return [200, {}];
      });
      click(root, `[data-tree] [data-add="${engineering}"]`);
      await drawn(root);
      expect(panelOf(root).title.textContent).to.equal('New organization');
      const steps = window.history.length;
      const reads = callsOf(calls, 'organization').length;
      type(field(root, 'ou'), 'Lyon');
      save(root);
      await until(() => selected(root) === lyon);
      await idle();
      await settled(root);
      expect(callsOf(calls, 'createOrganization')).to.deep.equal([
        `createOrganization(${JSON.stringify({ ou: 'Lyon' })}, ${engineering})`,
      ]);
      expect(toast(root)).to.equal('Lyon created');
      // Named in the address, a step Back leaves.
      expect(window.location.hash).to.equal(
        `#/organizations/${encodeURIComponent(lyon)}`
      );
      expect(window.history.length).to.equal(steps + 1);
      expect(open(root, engineering)).to.be.true;
      expect(
        root.querySelector(`[data-tree] [data-select="${lyon}"]`)?.textContent
      ).to.equal('Lyon');
      // Only it is read. happy-dom tells a `pushState` as a change of hash,
      // which a browser does not: on its own timer, the page may be drawn,
      // and its card read, once more.
      expect(callsOf(calls, 'organization').slice(reads)).to.include(
        `organization(${lyon})`
      );
      expect(
        callsOf(calls, 'organization')
          .slice(reads)
          .filter(call => call !== `organization(${lyon})`)
      ).to.deep.equal([]);
    });

    it('should leave the Overview where it is after a creation, the tree drawn before', async () => {
      // The tree of an earlier visit finds the new organization: shown on
      // the organizations page, it is not put in the Overview's address.
      let created = false;
      const { root, server, calls, idle } = await mountConsole({
        hash: `organizations/${encodeURIComponent(top)}`,
        answers: server => {
          server
            .get('/api/v1/ldap/organizations/top')
            .reply(200, { dn: top, ou: 'organization' });
          server
            .get(subnodes(top))
            .reply(() => [
              200,
              created ? [{ dn: `ou=QA Lab,${top}`, ou: 'QA Lab' }] : [],
            ]);
          server.get(at(top)).reply(200, { dn: top, ou: 'organization' });
        },
      });
      await until(
        () => !!root.querySelector('[data-org-detail] h1, [data-org-detail] h2')
      );
      window.location.hash = '#/';
      await settled(root);
      click(root, '[data-main] [data-new="organizations"]');
      await drawn(root);
      type(field(root, 'ou'), 'QA Lab');
      server.post('/api/v1/ldap/organizations').reply(() => {
        created = true;
        return [200, {}];
      });
      const listed = callsOf(calls, 'organizationChildren').length;
      save(root);
      await until(() => toast(root) === 'QA Lab created');
      // The tree read again, which nothing on the Overview shows.
      await idle();
      await settled(root);
      // Found among the top's children, read again, and left there.
      expect(callsOf(calls, 'organizationChildren').slice(listed)).to.include(
        `organizationChildren(${top})`
      );
      expect(window.location.hash).to.equal('#/');
      expect(root.querySelector('[data-main] .dc-dashboard')).to.not.equal(
        null
      );
    });
  });

  describe('an organization, from the Overview', () => {
    const government = `ou=Government of Mongolia,${top}`;
    const ministry = `ou=Ministry of Health,${top}`;
    const scope = (over: Partial<Scope>): Scope => ({
      user: 'uid=alice,ou=users,dc=example,dc=com',
      unrestricted: false,
      described: true,
      branches: [],
      entities: [{ name: 'organizations', base: top, create: false }],
      transit,
      ...over,
    });
    const writes = (dn: string, path?: string): Scope['branches'][number] => ({
      dn,
      name: /^ou=([^,]+)/.exec(dn)?.[1],
      path,
      read: true,
      write: true,
    });

    /** The Overview under this scope, its New organization pressed. */
    const creating = async (granted: Scope): Promise<Mounted> => {
      const mounted = await mountConsole({ scope: granted });
      const { root } = mounted;
      expect(
        root.querySelector('[data-main] [data-new="organizations"]')
      ).to.not.equal(null);
      expect(
        root
          .querySelector('[data-main] [data-open="organizations"]')
          ?.closest('.dc-card')?.textContent
      ).to.not.include('Creation not allowed here');
      click(root, '[data-main] [data-new="organizations"]');
      await drawn(root);
      type(field(root, 'ou'), 'QA Lab');
      return mounted;
    };

    /** Save, the creation answered, and wait for the Overview again. */
    const created = async ({ root, server, idle }: Mounted): Promise<void> => {
      server.post('/api/v1/ldap/organizations').reply(200, {});
      save(root);
      await until(() => toast(root) === 'QA Lab created');
      await idle();
      await settled(root);
    };

    it('should create under the one branch a restricted administrator writes', async () => {
      // A global administrator appointed below the root read "Creation not
      // allowed here", though the server takes the organization under their
      // branch.
      const mounted = await creating(
        scope({ branches: [writes(government), writes(transit)] })
      );
      const { root, calls } = mounted;
      expect(root.querySelector('#dc-organization-parent')).to.equal(null);
      await created(mounted);
      expect(callsOf(calls, 'createOrganization')).to.deep.equal([
        `createOrganization(${JSON.stringify({ ou: 'QA Lab' })}, ${government})`,
      ]);
      // From the Overview, the Overview stays.
      expect(window.location.hash).to.equal('');
      expect(panelOf(root).panel.hidden).to.be.true;
    });

    it('should let an administrator of several branches pick the parent', async () => {
      const mounted = await creating(
        scope({
          branches: [
            writes(ministry, 'Ministry of Health'),
            writes(government, 'Government of Mongolia'),
            writes(transit),
          ],
        })
      );
      const { root, calls } = mounted;
      const picker = root.querySelector<HTMLSelectElement>(
        '#dc-organization-parent'
      );
      // Sorted by name, the transit branch left out.
      expect(
        Array.from(picker?.options ?? []).map(option => option.value)
      ).to.deep.equal([government, ministry]);
      expect(
        root.querySelector('label[for="dc-organization-parent"]')?.textContent
      ).to.equal('Parent organization');
      if (!picker) throw new Error('no picker');
      picker.value = ministry;
      picker.dispatchEvent(new Event('change', { bubbles: true }));
      await created(mounted);
      expect(callsOf(calls, 'createOrganization')).to.deep.equal([
        `createOrganization(${JSON.stringify({ ou: 'QA Lab' })}, ${ministry})`,
      ]);
    });

    it('should name the parent, not the new organization, when creating under it is refused', async () => {
      const { root, server } = await creating(
        scope({
          branches: [
            writes(ministry, 'Ministry of Health'),
            writes(government, 'Government of Mongolia'),
          ],
        })
      );
      const picker = root.querySelector<HTMLSelectElement>(
        '#dc-organization-parent'
      );
      if (!picker) throw new Error('no picker');
      picker.value = ministry;
      picker.dispatchEvent(new Event('change', { bubbles: true }));
      server.post('/api/v1/ldap/organizations').reply(403, forbidden);
      save(root);
      await until(() => toast(root) !== '');
      expect(toast(root)).to.equal(
        'You do not administer Ministry of Health: this change is not yours to make.'
      );
      expect(panelOf(root).panel.hidden).to.be.false;
    });

    it('should create at the root, without a picker, where the scope allows it', async () => {
      const mounted = await creating(
        scope({
          branches: [writes(top), writes(government)],
          entities: [{ name: 'organizations', base: top, create: true }],
        })
      );
      expect(mounted.root.querySelector('#dc-organization-parent')).to.equal(
        null
      );
      await created(mounted);
      expect(callsOf(mounted.calls, 'createOrganization')).to.deep.equal([
        `createOrganization(${JSON.stringify({ ou: 'QA Lab' })})`,
      ]);
    });
  });
});
