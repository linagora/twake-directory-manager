/**
 * An entity's list, mounted: its title and what it offers by the rights the
 * scope gives, the names of what its entries point at, where the reader left
 * it, the actions on a selection, the CSV import and the list it refreshes,
 * a late answer drawn over no newer page (src/views/list.ts).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { expect } from 'chai';
import type nock from 'nock';

import type { Entry, Scope } from '../../src/types';
import { click, gate, panelOf, press, type, until } from '../support/act';
import { mountConsole, settled, type Mounted } from '../support/mount';

const FIXTURES = join(__dirname, '..', 'fixtures');
const read = <T>(file: string): T =>
  JSON.parse(readFileSync(join(FIXTURES, file), 'utf8')) as T;

/** The refusal of a branch the caller does not administer, as recorded. */
const forbidden = read<{ body: object }>(
  'contract/refusal-forbidden.json'
).body;

/** The configuration the ldap-rest tested serves, to be changed by a test. */
interface Config {
  features: {
    ldapFlatGeneric: {
      flatResources: {
        name: string;
        schema: { attributes: Record<string, Record<string, unknown>> };
        [key: string]: unknown;
      }[];
    };
    [feature: string]: unknown;
  };
  [key: string]: unknown;
}
const config = (): Config => read<Config>('config.json');

const users = 'ou=users,dc=example,dc=com';
const positions = 'ou=positions,dc=example,dc=com';
const groupsBase = 'ou=groups,dc=example,dc=com';
const listTypes = 'ou=twakeListType,ou=nomenclature,dc=example,dc=com';

/** An account of the users' branch. */
const account = (uid: string, name: string): Entry => ({
  dn: `uid=${uid},${users}`,
  uid,
  displayName: name,
});
/** A position, by its name. */
const position = (cn: string): Entry => ({ dn: `cn=${cn},${positions}`, cn });

/**
 * A configuration where the types of list name themselves, by their
 * description: the list of groups reads their branch to name its column.
 */
const namedListTypes = (): Config => {
  const served = config();
  const types = served.features.ldapFlatGeneric.flatResources.find(
    resource => resource.name === 'twakeListType'
  );
  if (!types) throw new Error('no types of list');
  types.schema.attributes.description.role = 'displayName';
  return served;
};

/** The toast's message, or nothing while it is hidden. */
const toast = (root: HTMLElement): string => {
  const element = root.querySelector<HTMLElement>('[data-toast]');
  return element && !element.hidden ? (element.textContent ?? '') : '';
};

/** The calls of a method of the client. */
const callsOf = (calls: string[], method: string): string[] =>
  calls.filter(call => call.startsWith(`${method}(`));

/** How many times an entity's list was read. */
const reads = (calls: string[], entity: string): number =>
  calls.filter(call => call.startsWith(`listBounded(${entity}`)).length;

/** The main area's heading. */
const heading = (root: HTMLElement): string =>
  root.querySelector('[data-main] h1')?.textContent?.trim() ?? '';

/** The rows of the list drawn, by the name of their first cell. */
const rows = (root: HTMLElement): string[] =>
  Array.from(root.querySelectorAll('[data-main] [data-select]')).map(
    box => (box as HTMLElement).dataset.select ?? ''
  );

/** What the bar of a selection offers, by label. */
const offered = (root: HTMLElement): string[] =>
  Array.from(root.querySelectorAll('[data-main] [data-bulk-action]')).map(
    button => button.textContent?.trim() ?? ''
  );

/** Whether the bar of a selection shows: hidden once nothing is selected. */
const selecting = (root: HTMLElement): boolean =>
  root.querySelector<HTMLElement>('[data-main] .dc-bulk')?.hidden === false;

/** Open an address, as a link or a typed address does. */
const visit = async (root: HTMLElement, hash: string): Promise<void> => {
  window.location.hash = `#/${hash}`;
  await settled(root);
};

/** The list of users, every account listed, these selected. */
const selected = async (
  accounts: Record<string, Entry>,
  options: { scope?: Scope | null; answers?(server: nock.Scope): void } = {}
): Promise<Mounted> => {
  const mounted = await mountConsole({
    hash: 'users',
    scope: null,
    ...options,
  });
  const { root, server } = mounted;
  server.get(/\/api\/v1\/ldap\/users\?/).reply(200, accounts);
  click(root, '[data-main] [data-list-all]');
  await settled(root);
  for (const uid of Object.keys(accounts))
    click(root, `[data-select="${uid}"]`);
  return mounted;
};

/** Choose a file in the import's input, as the browser's picker does. */
const choose = (root: HTMLElement, content: string, name: string): void => {
  const input = root.querySelector<HTMLInputElement>(
    '[data-panel-body] [data-import-file]'
  );
  if (!input) throw new Error('no file input');
  const files = new DataTransfer();
  files.items.add(new File([content], name, { type: 'text/csv' }));
  input.files = files.files;
  input.dispatchEvent(new Event('change', { bubbles: true }));
};

/** Import a file of positions through the panel, to its summary. */
const importing = async (
  root: HTMLElement,
  content: string
): Promise<HTMLElement> => {
  const { body } = panelOf(root);
  click(root, '[data-main] [data-import]');
  choose(root, content, 'positions.csv');
  await until(() => !!body.querySelector('[data-import-check]'));
  click(body, '[data-import-check]');
  await until(() => !!body.querySelector('[data-import-run]'));
  click(body, '[data-import-run]');
  await until(() => !!body.querySelector('.dc-import-summary'));
  return body.querySelector<HTMLElement>('.dc-import-summary') as HTMLElement;
};

describe('views/list', () => {
  describe('the page', () => {
    it('should title the page after the entity and name what its entries point at', async () => {
      document.title = 'Twake Directory Manager';
      const { root, calls } = await mountConsole({
        hash: 'groups',
        scope: null,
        answers: server => {
          server.get('/api/v1/config').reply(200, namedListTypes());
          server.get(/\/api\/v1\/ldap\/listTypes(\?.*)?$/).reply(200, {
            open: {
              dn: `cn=open,${listTypes}`,
              objectClass: ['top', 'applicationProcess'],
              cn: 'open',
              description: 'Anyone may write',
            },
          });
          server.get(/\/api\/v1\/ldap\/groups\?/).reply(200, {
            staff: {
              dn: `cn=staff,${groupsBase}`,
              cn: 'staff',
              businessCategory: `cn=open,${listTypes}`,
            },
          });
        },
      });
      expect(heading(root)).to.equal('Groups');
      expect(document.title).to.equal('Groups — Twake Directory Manager');
      // The names are read before the list is drawn.
      expect(callsOf(calls, 'pointerOptions')).to.have.length(1);
      expect(callsOf(calls, 'pointerOptions')[0]).to.include(listTypes);
      click(root, '[data-main] [data-list-all]');
      await settled(root);
      expect(rows(root)).to.deep.equal(['staff']);
      // A type is named as its branch names it, not by its RDN.
      const row = root.querySelector('[data-main] tbody tr')?.textContent;
      expect(row).to.include('Anyone may write').and.not.include('open');
    });

    it('should offer New… and Import CSV to whoever creates, Import CSV on a flat entity only', async () => {
      const { root, unmount } = await mountConsole({
        hash: 'users',
        scope: null,
      });
      expect(
        root.querySelector('[data-main] [data-new]')?.textContent?.trim()
      ).to.equal('New user');
      expect(
        root.querySelector('[data-main] [data-import]')?.textContent?.trim()
      ).to.equal('Import CSV');
      unmount();
      // A group's list: no import.
      const groups = await mountConsole({ hash: 'groups', scope: null });
      expect(groups.root.querySelector('[data-main] [data-new]')).to.not.equal(
        null
      );
      expect(groups.root.querySelector('[data-main] [data-import]')).to.equal(
        null
      );
      groups.unmount();
      // Sophie Martin creates no position: neither is offered.
      const sophie = await mountConsole({
        hash: 'positions',
        scope: 'sophie.martin',
      });
      expect(sophie.root.querySelector('[data-main] [data-new]')).to.equal(
        null
      );
      expect(sophie.root.querySelector('[data-main] [data-import]')).to.equal(
        null
      );
    });

    it('should open the form of a new entry on New…', async () => {
      const { root } = await mountConsole({ hash: 'positions', scope: null });
      const { panel, title, body } = panelOf(root);
      click(root, '[data-main] [data-new]');
      await until(() => !panel.hidden);
      expect(title.textContent).to.equal('New position');
      expect(body.querySelector('[name="cn"]')).to.not.equal(null);
    });

    it('should come back to the search, the field and the page it was left on', async () => {
      // Moved from the shell's stub test. Back from a card drew the list
      // anew: an empty box, "Every field", the prompt to type, and no rows.
      const entries: Record<string, Entry> = {};
      for (let i = 10; i < 40; i++)
        entries[`alice${i}`] = account(`alice${i}`, `Alice ${i}`);
      const { root, calls } = await mountConsole({
        hash: 'users',
        scope: null,
        answers: server => {
          server.get(/\/api\/v1\/ldap\/users\?/).reply(200, entries);
        },
      });
      const loads = (): string[] => callsOf(calls, 'listBounded');
      const field = root.querySelector<HTMLSelectElement>(
        '[data-main] [data-search-attribute]'
      );
      if (!field) throw new Error('no field');
      field.value = 'mail';
      field.dispatchEvent(new Event('change', { bubbles: true }));
      type(
        root.querySelector<HTMLInputElement>('[data-main] [data-search]'),
        'alice'
      );
      await until(() => rows(root).length > 0);
      click(root, '[data-main] [data-page="1"]');
      await until(() =>
        (
          root.querySelector('[data-main] .dc-count')?.textContent ?? ''
        ).includes('26–30 of 30')
      );
      const searched = loads().filter(call => call.includes('alice, mail'));
      expect(searched).to.have.length(1);
      await visit(root, '');
      expect(root.querySelector('[data-main] [data-search]')).to.equal(null);
      await visit(root, 'users');
      const list = root.querySelector('[data-main] [data-list]');
      expect(
        root.querySelector<HTMLInputElement>('[data-main] [data-search]')?.value
      ).to.equal('alice');
      // Read from the markup: happy-dom's `value` does not follow the
      // option a select drawn again marks selected.
      expect(
        root.querySelector<HTMLOptionElement>(
          '[data-main] [data-search-attribute] option[selected]'
        )?.value
      ).to.equal('mail');
      expect(list?.textContent).to.include('26–30 of 30');
      // Read again for the same search, and nothing else.
      expect(
        loads().filter(call => call.includes('alice, mail'))
      ).to.have.length(2);
      expect(
        loads().filter(call => !call.includes('alice, mail'))
      ).to.deep.equal([]);
    });

    it('should draw no list over the page asked for after it, its names read first', async () => {
      const held = gate();
      const { root, calls, idle } = await mountConsole({
        scope: null,
        answers: server => {
          server.get('/api/v1/config').reply(200, namedListTypes());
          server.get(/\/api\/v1\/ldap\/listTypes(\?.*)?$/).reply(async () => {
            await held.opened;
            return [200, {}];
          });
          server
            .get(/\/api\/v1\/ldap\/positions(\?.*)?$/)
            .reply(200, { Clerk: position('Clerk') });
        },
      });
      // Its header drawn, its list waiting on the types' names.
      await visit(root, 'groups');
      expect(heading(root)).to.equal('Groups');
      expect(root.querySelector('[data-main] [data-list-all]')).to.equal(null);
      await visit(root, 'positions');
      await until(() => rows(root).length > 0);
      held.open();
      await idle();
      expect(heading(root)).to.equal('Positions');
      expect(rows(root)).to.deep.equal(['Clerk']);
      expect(root.querySelectorAll('[data-main] [data-list]')).to.have.length(
        1
      );
      expect(root.querySelector('[data-main] [data-list-all]')).to.equal(null);
      expect(window.location.hash).to.equal('#/positions');
      expect(callsOf(calls, 'listBounded')).to.deep.equal([
        'listBounded(positions, 1000)',
      ]);
      expect(toast(root)).to.equal('');
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
    const notice =
      'You administer no branch: there is nothing here for you to manage.';

    it('should say there is nothing to manage, and ask nothing the server would refuse', async () => {
      // Moved from the shell's stub test: each page answered in red with
      // the server's "Token does not have permission on this branch".
      for (const hash of ['users', 'positions']) {
        const { root, calls, unmount } = await mountConsole({
          hash,
          scope: nobody,
        });
        const list = root.querySelector('[data-main] [data-list]');
        expect(list?.textContent, hash).to.include(notice);
        expect(list?.innerHTML, hash).to.not.include('error');
        expect(root.querySelector('[data-main] [data-new]'), hash).to.equal(
          null
        );
        expect(callsOf(calls, 'listBounded'), hash).to.deep.equal([]);
        expect(callsOf(calls, 'pointerOptions'), hash).to.deep.equal([]);
        unmount();
      }
    });

    it('should still read for an unrestricted or undescribed scope, which names no branch either', async () => {
      // Moved from the shell's stub test.
      for (const scope of [
        { ...nobody, unrestricted: true },
        { ...nobody, described: false },
      ]) {
        const { root, calls, unmount } = await mountConsole({
          hash: 'positions',
          scope,
          answers: server => {
            server
              .get(/\/api\/v1\/ldap\/positions(\?.*)?$/)
              .reply(200, { Clerk: position('Clerk') });
          },
        });
        expect(root.querySelector('[data-main]')?.textContent).to.not.include(
          notice
        );
        expect(callsOf(calls, 'listBounded')).to.deep.equal([
          'listBounded(positions, 1000)',
        ]);
        expect(rows(root)).to.deep.equal(['Clerk']);
        unmount();
      }
    });
  });

  describe('a selection', () => {
    const two = {
      alice: account('alice', 'Alice Moreau'),
      bob: account('bob', 'Bob Durand'),
    };

    it('should offer Add to a group… and Change state… on accounts to whoever writes', async () => {
      // Moved from the stub test of test/console/entries.test.ts.
      const writer = await selected(two);
      expect(selecting(writer.root)).to.equal(true);
      expect(offered(writer.root)).to.deep.equal([
        'Add to a group…',
        'Change state…',
      ]);
      writer.unmount();
      // Nor to someone who writes nothing, who still deletes what the
      // scope lets them.
      const reader = await selected(two, {
        scope: {
          user: 'uid=reader,ou=users,dc=example,dc=com',
          unrestricted: false,
          described: true,
          branches: [{ dn: 'dc=example,dc=com', read: true, delete: true }],
          entities: [{ name: 'users', base: users, create: false }],
        },
      });
      expect(selecting(reader.root)).to.equal(true);
      expect(offered(reader.root)).to.deep.equal([]);
      expect(
        reader.root.querySelector('[data-main] [data-delete-selected]')
      ).to.not.equal(null);
      reader.unmount();
      // Nor on another list.
      const groups = await mountConsole({
        hash: 'groups',
        scope: null,
        answers: server => {
          server.get(/\/api\/v1\/ldap\/groups\?/).reply(200, {
            staff: { dn: `cn=staff,${groupsBase}`, cn: 'staff' },
          });
        },
      });
      click(groups.root, '[data-main] [data-list-all]');
      await settled(groups.root);
      click(groups.root, '[data-select="staff"]');
      expect(selecting(groups.root)).to.equal(true);
      expect(offered(groups.root)).to.deep.equal([]);
      groups.unmount();
      // A directory with no groups to search: Change state… alone.
      const served = config();
      delete served.features.ldapGroups;
      const flat = await selected(two, {
        answers: server => {
          server.get('/api/v1/config').reply(200, served);
        },
      });
      expect(offered(flat.root)).to.deep.equal(['Change state…']);
    });

    it('should change the state of the accounts, list the refused, and read the list again once closed', async () => {
      const { root, server, calls } = await selected(two);
      const { panel, title, body } = panelOf(root);
      server.post('/api/v1/ldap/users/alice/status').reply(200, {});
      server.post('/api/v1/ldap/users/bob/status').reply(403, forbidden);
      click(root, '[data-main] [data-bulk-action="1"]');
      await until(() => !panel.hidden);
      expect(title.textContent).to.equal('Change state — 2 accounts');
      click(body, '#dc-state-disabled');
      click(body, 'button[type="submit"]');
      await until(() => !!body.querySelector('[data-close]'));
      expect(callsOf(calls, 'setStatus')).to.have.length(2);
      expect(toast(root)).to.equal('1 account is now Disabled');
      const refused = body.querySelectorAll('.dc-confirm-items li');
      expect(refused).to.have.length(1);
      expect(refused[0].textContent).to.match(/^Bob Durand: /);
      // The list waits for the panel, then is read again, its selection
      // gone.
      expect(reads(calls, 'users')).to.equal(1);
      expect(selecting(root)).to.equal(true);
      click(body, '[data-close]');
      await until(() => reads(calls, 'users') === 2);
      await settled(root);
      expect(selecting(root)).to.equal(false);
      expect(rows(root)).to.deep.equal(['alice', 'bob']);
    });

    it('should add the accounts to a group, say so, and read the list again', async () => {
      const staff = `cn=staff,${groupsBase}`;
      const { root, server, calls } = await selected(two, {
        answers: answer => {
          answer
            .get(
              (uri: string) =>
                uri.startsWith('/api/v1/ldap/groups?') &&
                new URLSearchParams(uri.split('?')[1]).has('attribute')
            )
            .reply(200, { staff: { dn: staff, cn: 'staff', member: [''] } });
        },
      });
      const { panel, title, body } = panelOf(root);
      server.post('/api/v1/ldap/groups/staff/members').reply(200, {});
      click(root, '[data-main] [data-bulk-action="0"]');
      await until(() => !panel.hidden);
      expect(title.textContent).to.equal('Add 2 accounts to groups');
      type(body.querySelector<HTMLInputElement>('#dc-group-search'), 'sta');
      await until(
        () => !!body.querySelector('#dc-group-results [role="option"]')
      );
      press('Enter');
      click(body, '[data-add]');
      await until(() => panel.hidden);
      expect(callsOf(calls, 'addMembers')).to.deep.equal([
        `addMembers(groups, staff, [uid=alice,${users}, uid=bob,${users}])`,
      ]);
      expect(toast(root)).to.equal('2 accounts added to staff');
      await until(() => reads(calls, 'users') === 2);
      await settled(root);
      expect(selecting(root)).to.equal(false);
    });

    it('should delete the selection once asked, say each refusal, and read the list again', async () => {
      const { root, server, calls } = await mountConsole({
        hash: 'positions',
        scope: null,
        answers: answer => {
          answer.get(/\/api\/v1\/ldap\/positions(\?.*)?$/).reply(200, {
            Clerk: position('Clerk'),
            Intern: position('Intern'),
          });
        },
      });
      const { body } = panelOf(root);
      server.delete('/api/v1/ldap/positions/Clerk').reply(200, {});
      server.delete('/api/v1/ldap/positions/Intern').reply(403, forbidden);
      click(root, '[data-select="Clerk"]');
      click(root, '[data-select="Intern"]');
      click(root, '[data-main] [data-delete-selected]');
      await until(() => !!body.querySelector('[data-confirm]'));
      expect(body.querySelector('[data-confirm]')?.textContent).to.equal(
        'Delete 2 entries'
      );
      click(body, '[data-confirm]');
      await until(() => toast(root) !== '');
      expect(callsOf(calls, 'remove')).to.have.length(2);
      expect(toast(root)).to.match(/^You do not administer Intern/);
      await until(() => reads(calls, 'positions') === 2);
      await settled(root);
      expect(selecting(root)).to.equal(false);
    });
  });

  describe('the CSV import', () => {
    /** The positions' list, answered with Clerk until it changes. */
    const listed = (server: nock.Scope): void => {
      server
        .get(/\/api\/v1\/ldap\/positions(\?.*)?$/)
        .reply(200, { Clerk: position('Clerk') });
    };

    it('should open in a wide panel, named after the entity', async () => {
      const { root } = await mountConsole({
        hash: 'positions',
        scope: null,
        answers: listed,
      });
      const { panel, title, body } = panelOf(root);
      click(root, '[data-main] [data-import]');
      expect(panel.hidden).to.equal(false);
      expect(title.textContent).to.equal('Import Positions');
      expect(panel.classList.contains('dc-panel-wide')).to.equal(true);
      expect(body.querySelector('[data-import-file]')).to.not.equal(null);
      // Closed from its own button.
      click(body, '[data-import-close]');
      expect(panel.hidden).to.equal(true);
    });

    it('should create each row, say how many, and show the list what was just created', async () => {
      const { root, server, calls } = await mountConsole({
        hash: 'positions',
        scope: null,
        answers: answer => {
          listed(answer);
          answer
            .get('/api/v1/ldap/positions/Intern')
            .reply(200, position('Intern'));
        },
      });
      server
        .post('/api/v1/ldap/positions', body => body.cn === 'Intern')
        .reply(200, position('Intern'));
      server
        .post('/api/v1/ldap/positions', body => body.cn === 'Trainee')
        .reply(403, forbidden);
      const summary = await importing(
        root,
        'cn,description\nIntern,Learns\nTrainee,Watches\n'
      );
      expect(summary.textContent?.replace(/\s+/g, ' ')).to.include('1 created');
      expect(callsOf(calls, 'create')).to.have.length(2);
      // The list behind the panel shows what was created, read for it.
      await until(() => !!root.querySelector('[data-main] [data-imported]'));
      await settled(root);
      expect(callsOf(calls, 'get')).to.include('get(positions, Intern)');
      expect(rows(root)).to.deep.equal(['Intern']);
      expect(panelOf(root).panel.hidden).to.equal(false);
    });

    it('should put the search back after an import that created nothing, and leave it otherwise', async () => {
      const { root, server, calls, idle } = await mountConsole({
        hash: 'positions',
        scope: null,
        answers: answer => {
          listed(answer);
          answer
            .get('/api/v1/ldap/positions/Intern')
            .reply(200, position('Intern'));
        },
      });
      server
        .post('/api/v1/ldap/positions', body => body.cn === 'Intern')
        .reply(200, position('Intern'));
      server
        .post('/api/v1/ldap/positions', body => body.cn === 'Trainee')
        .reply(403, forbidden);
      // Nothing created over the list's own entries: not drawn again.
      await importing(root, 'cn\nTrainee\n');
      await idle();
      expect(reads(calls, 'positions')).to.equal(1);
      expect(rows(root)).to.deep.equal(['Clerk']);
      click(panelOf(root).body, '[data-import-close]');
      // One created: shown.
      await importing(root, 'cn\nIntern\n');
      await until(() => !!root.querySelector('[data-main] [data-imported]'));
      await settled(root);
      expect(rows(root)).to.deep.equal(['Intern']);
      click(panelOf(root).body, '[data-import-close]');
      // Then none: the list is its search again, read again.
      await importing(root, 'cn\nTrainee\n');
      await until(() => !root.querySelector('[data-main] [data-imported]'));
      await settled(root);
      expect(rows(root)).to.deep.equal(['Clerk']);
      expect(reads(calls, 'positions')).to.equal(2);
    });
  });
});
