/**
 * An entry's card, mounted: its details and its title, its relations, what
 * it offers by the rights the scope gives, a late answer drawn over no newer
 * page (src/views/entry.ts).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { expect } from 'chai';
import type nock from 'nock';

import type { Entry, Scope } from '../../src/types';
import { click, gate, until } from '../support/act';
import {
  mountConsole,
  settled,
  type Mounted,
  type MountOptions,
} from '../support/mount';

const FIXTURES = join(__dirname, '..', 'fixtures');
const read = <T>(file: string): T =>
  JSON.parse(readFileSync(join(FIXTURES, file), 'utf8')) as T;

/** Alice's entry, as the ldap-rest tested answers it: in two groups. */
const alice = read<{ body: Entry }>('contract/users-alice.json').body;
/** Alice in a directory that keeps no `memberOf`. */
const aliceUnlisted = (): Entry => {
  const entry: Entry = { ...alice };
  delete entry.memberOf;
  return entry;
};

/** The configuration the ldap-rest tested serves, to be changed by a test. */
interface Config {
  features: {
    ldapFlatGeneric: {
      flatResources: { name: string; base: string; [key: string]: unknown }[];
    };
    [feature: string]: unknown;
  };
  [key: string]: unknown;
}
const config = (): Config => read<Config>('config.json');

const top = 'ou=organization,dc=example,dc=com';
const sales = `ou=Sales,${top}`;
const users = 'ou=users,dc=example,dc=com';
const groupsBase = 'ou=groups,dc=example,dc=com';
const positions = 'ou=positions,dc=example,dc=com';
const bob = `uid=bob,${users}`;
const staff = `cn=staff,${groupsBase}`;

/** The toast's message, or nothing while it is hidden. */
const toast = (root: HTMLElement): string => {
  const element = root.querySelector<HTMLElement>('[data-toast]');
  return element && !element.hidden ? (element.textContent ?? '') : '';
};

/** The calls of a method of the client. */
const callsOf = (calls: string[], method: string): string[] =>
  calls.filter(call => call.startsWith(`${method}(`));

/** The card drawn, as markup; empty while there is none. */
const card = (root: HTMLElement): string =>
  root.querySelector('[data-main] [data-detail]')?.innerHTML ?? '';

/** The heading of the card, none while there is no card. */
const heading = (root: HTMLElement): string | undefined =>
  root
    .querySelector('[data-main] [data-detail] .dc-detail-title h2')
    ?.textContent?.trim() ?? undefined;

/** Open an address, as a link or a typed address does. */
const visit = async (root: HTMLElement, hash: string): Promise<void> => {
  window.location.hash = `#/${hash}`;
  await settled(root);
};

/** An answer for one path, decoded, whatever its query. */
const at =
  (wanted: string) =>
  (uri: string): boolean =>
    decodeURIComponent(uri.split('?')[0]) === wanted;

/** The search of an account's groups, made when it keeps no `memberOf`. */
const membershipsOf =
  (dn: string) =>
  (uri: string): boolean =>
    decodeURIComponent(uri).startsWith(
      `/api/v1/ldap/groups?match=(member=${dn})`
    );

describe('views/entry', () => {
  describe('the card', () => {
    it('should draw the entry, title the tab after it, and lead Back to its list', async () => {
      document.title = 'Twake Directory Manager';
      const { root, calls } = await mountConsole({
        hash: 'users/alice',
        account: alice,
      });
      expect(heading(root)).to.equal('Alice Moreau');
      expect(document.title).to.equal('Alice Moreau — Twake Directory Manager');
      // A pointer is named, not shown as its DN.
      expect(card(root))
        .to.include('Sales Representative')
        .and.include('<h3>Groups</h3>');
      expect(callsOf(calls, 'get')).to.include('get(users, alice)');
      click(root, '[data-main] [data-back]');
      await until(() => window.location.hash === '#/users');
      await settled(root);
      expect(root.querySelector('[data-main] [data-detail]')).to.equal(null);
    });

    it('should say an entry that is not there in plain words, and any other failure as one', async () => {
      for (const [status, body, error] of [
        [404, { error: 'No such entry' }, false],
        [500, { error: 'Internal error' }, true],
      ] as const) {
        const { root, unmount } = await mountConsole({
          hash: 'users/ghost',
          answers: server => {
            server.get('/api/v1/ldap/users/ghost').reply(status, body);
          },
        });
        const said = root.querySelector('[data-main] .dc-empty');
        expect(said, String(status)).to.not.equal(null);
        expect(
          said?.classList.contains('dc-error-block'),
          String(status)
        ).to.equal(error);
        expect(root.querySelector('[data-main] [data-detail]')).to.equal(null);
        unmount();
      }
    });

    it('should draw no card over the page asked for after it, read first', async () => {
      // Opening an entry, then another before the first answered, put
      // whichever answered last on screen, under the other's address.
      const held = gate();
      const { root, idle } = await mountConsole({
        answers: server => {
          server.get('/api/v1/ldap/users/alice').reply(async () => {
            await held.opened;
            return [200, alice];
          });
          server.get('/api/v1/ldap/users/bob').reply(200, {
            dn: bob,
            uid: 'bob',
            cn: 'Bob Durand',
            displayName: 'Bob Durand',
            twakeDepartmentLink: sales,
          });
        },
      });
      window.location.hash = '#/users/alice';
      await until(() => !!root.querySelector('[data-main] .dc-empty'));
      await visit(root, 'users/bob');
      await until(() => heading(root) === 'Bob Durand');
      held.open();
      await idle();
      expect(heading(root)).to.equal('Bob Durand');
      expect(window.location.hash).to.equal('#/users/bob');
      expect(toast(root)).to.equal('');
    });

    it('should draw no card over the page asked for after it, its groups searched first', async () => {
      // Read, but its groups still searched for: the card waits for them.
      const held = gate();
      document.title = 'Twake Directory Manager';
      const { root, idle } = await mountConsole({
        answers: server => {
          server.get('/api/v1/ldap/users/alice').reply(200, aliceUnlisted());
          server.get(membershipsOf(String(alice.dn))).reply(async () => {
            await held.opened;
            return [200, { staff: { dn: staff, cn: 'staff' } }];
          });
          server.get('/api/v1/ldap/users/bob').reply(200, {
            dn: bob,
            uid: 'bob',
            cn: 'Bob Durand',
            displayName: 'Bob Durand',
            twakeDepartmentLink: sales,
          });
        },
      });
      await visit(root, 'users/alice');
      expect(heading(root)).to.equal(undefined);
      await visit(root, 'users/bob');
      await until(() => heading(root) === 'Bob Durand');
      held.open();
      await idle();
      expect(heading(root)).to.equal('Bob Durand');
      expect(document.title).to.equal('Bob Durand — Twake Directory Manager');
      expect(card(root)).to.not.include(staff);
      expect(toast(root)).to.equal('');
    });

    it('should close its More menu on a click elsewhere, and leave the page alone once left', async () => {
      // The menu listens on the document while it is open (#254): once the
      // card is gone, the next press anywhere takes that listener away, and
      // closing a menu no longer on the page moves nothing.
      const { root } = await mountConsole({
        hash: 'users/alice',
        account: alice,
      });
      const more = (): HTMLElement | null =>
        root.querySelector<HTMLElement>('[data-main] [data-more]');
      more()?.click();
      expect(more()?.getAttribute('aria-expanded')).to.equal('true');
      root
        .querySelector('[data-main] [data-back]')
        ?.dispatchEvent(new Event('pointerdown', { bubbles: true }));
      expect(more()?.getAttribute('aria-expanded')).to.equal('false');

      more()?.click();
      expect(more()?.getAttribute('aria-expanded')).to.equal('true');
      await visit(root, 'users');
      const search = root.querySelector<HTMLElement>('[data-main] input');
      search?.focus();
      expect(document.activeElement).to.equal(search);
      search?.dispatchEvent(new Event('pointerdown', { bubbles: true }));
      expect(document.activeElement).to.equal(search);
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

    it('should say there is nothing to manage, and read nothing the server would refuse', async () => {
      // Moved from the shell's stub test: the card answered in red with the
      // server's "Token does not have permission on this branch".
      const { root, calls } = await mountConsole({
        hash: 'users/bob',
        scope: nobody,
      });
      expect(root.querySelector('[data-main]')?.textContent).to.include(notice);
      expect(callsOf(calls, 'get')).to.deep.equal([]);
    });

    it('should still read for an unrestricted or undescribed scope, which names no branch either', async () => {
      for (const scope of [
        { ...nobody, unrestricted: true },
        { ...nobody, described: false },
      ]) {
        const { root, calls, unmount } = await mountConsole({
          hash: 'users/bob',
          scope,
          account: { dn: bob, uid: 'bob' },
        });
        expect(callsOf(calls, 'get')).to.include('get(users, bob)');
        expect(root.querySelector('[data-main]')?.textContent).to.not.include(
          notice
        );
        unmount();
      }
    });
  });

  describe('reference data, for a local administrator', () => {
    /** Sophie Martin, administrator of Sales, writing the positions or not. */
    const scoped = (create: boolean): Scope => ({
      user: 'uid=sophie.martin,ou=users,dc=example,dc=com',
      unrestricted: false,
      described: true,
      branches: [{ dn: sales, read: true, write: true, delete: true }],
      entities: [{ name: 'positions', base: positions, create }],
    });
    const readOnly =
      'Reference data is kept outside the console: you can read it and use it in forms';

    /**
     * The list of the positions, then the card of one, as this scope sees
     * them: what each says, as text and markup.
     */
    const views = async (
      options: Partial<MountOptions>
    ): Promise<{ list: string; card: string }> => {
      const { root } = await mountConsole({
        ...options,
        hash: 'positions',
        answers: server => {
          options.answers?.(server);
          server
            .get(at('/api/v1/ldap/positions'))
            .reply(200, { Administrator: { cn: 'Administrator' } });
          server.get('/api/v1/ldap/positions/Administrator').reply(200, {
            dn: `cn=Administrator,${positions}`,
            cn: 'Administrator',
          });
        },
      });
      const list = root.querySelector('[data-main]')?.textContent ?? '';
      await visit(root, 'positions/Administrator');
      await until(() => heading(root) === 'Administrator');
      return { list, card: card(root) };
    };

    it('should offer no Edit nor Delete the server would refuse, and say why', async () => {
      // Edit was offered on a position, to the administrator of Sales, and
      // Save refused: reference data lies outside every department (#167).
      const { list, card } = await views({ scope: scoped(false) });
      expect(list).to.include(readOnly);
      expect(card).to.include(readOnly);
      expect(card).to.not.include('data-edit');
      expect(card).to.not.include('data-delete');
    });

    it('should withhold them in a directory with no tree, without calling it reference data', async () => {
      // Every collection is put forward there: the line would be untrue.
      const served = config();
      delete served.features.ldapOrganizations;
      delete served.features.ldapGroups;
      served.features.ldapFlatGeneric.flatResources =
        served.features.ldapFlatGeneric.flatResources.filter(
          resource => resource.base === positions
        );
      const { list, card } = await views({
        scope: scoped(false),
        answers: server => {
          server.get('/api/v1/config').reply(200, served);
        },
      });
      expect(card).to.not.include('data-edit');
      expect(card).to.not.include(readOnly);
      expect(list).to.not.include(readOnly);
    });

    it('should give no reason when the scope could not be read', async () => {
      // The banner says the scope is unavailable; every action is withheld
      // already.
      const { list, card } = await views({
        answers: server => {
          server
            .get('/api/v1/authz/scope')
            .reply(503, { error: 'Service Unavailable' });
        },
      });
      expect(list).to.not.include(readOnly);
      expect(card).to.not.include(readOnly).and.not.include('data-edit');
    });

    it('should offer them to whoever the scope lets write them', async () => {
      const { list, card } = await views({ scope: scoped(true) });
      expect(list).to.not.include(readOnly);
      expect(card).to.include('data-edit');
      expect(card).to.not.include(readOnly);
    });
  });

  describe('a group’s members on its card', () => {
    /** The groups' branch, read only or written. */
    const groupsScope = (write: boolean): Scope => ({
      user: 'uid=alice,ou=users,dc=example,dc=com',
      unrestricted: false,
      described: true,
      branches: [{ dn: groupsBase, read: true, write }],
      entities: [],
    });

    /** The card of staff, holding these members, as this scope sees it. */
    const shown = async (
      scope: Scope | null,
      member: string[] = [bob]
    ): Promise<Mounted> =>
      mountConsole({
        hash: 'groups/staff',
        scope,
        answers: (server: nock.Scope) => {
          server
            .get('/api/v1/ldap/groups/staff')
            .reply(200, { dn: staff, cn: 'staff', member });
        },
      });

    it('should offer the ×s and Add members… to whoever writes the group only', async () => {
      // Read-only, as the server judges it: neither is offered (#168). The
      // removal the × sends: in test/actions/groups.test.ts.
      const read = await shown(groupsScope(false));
      expect(card(read.root)).to.match(/<h3>[^<]+ \(1\)<\/h3>/);
      expect(card(read.root)).to.not.include('data-add-members');
      expect(card(read.root)).to.not.include('dc-relation-remove');
      read.unmount();
      // The same branch written: the right is what decides.
      const writer = await shown(groupsScope(true));
      expect(card(writer.root)).to.include('data-add-members');
      writer.unmount();
      const written = await shown(null);
      expect(card(written.root))
        .to.include('data-add-members')
        .and.include('aria-label="Remove bob from staff"');
    });

    it('should neither count nor offer to remove the empty member', async () => {
      // groupOfNames needs one: ldap-rest writes the empty DN for none.
      const { root } = await shown(null, ['', bob]);
      expect(card(root)).to.match(/<h3>[^<]+ \(1\)<\/h3>/);
      expect(card(root).match(/dc-relation-remove/g) ?? []).to.have.length(1);
    });

    it('should leave a flat entity’s members to its form', async () => {
      // A team mailbox has no route for one member: saved whole.
      const served = config();
      const groups = served.features.ldapGroups as {
        schema: { attributes: object };
      };
      served.features.ldapFlatGeneric.flatResources.push({
        name: 'twakeMailbox',
        singularName: 'mailbox',
        pluralName: 'mailboxes',
        mainAttribute: 'cn',
        objectClass: ['top', 'groupOfNames'],
        base: 'ou=mailboxes,dc=example,dc=com',
        schema: { attributes: groups.schema.attributes },
        endpoints: {
          list: '/api/v1/ldap/mailboxes',
          get: '/api/v1/ldap/mailboxes/:id',
        },
      });
      const { root } = await mountConsole({
        hash: 'mailboxes/staff',
        scope: null,
        answers: server => {
          server.get('/api/v1/config').reply(200, served);
          server.get('/api/v1/ldap/mailboxes/staff').reply(200, {
            dn: 'cn=staff,ou=mailboxes,dc=example,dc=com',
            cn: 'staff',
            member: [bob],
          });
        },
      });
      expect(card(root)).to.include(`data-relation="${bob}"`);
      expect(card(root)).to.not.include('data-add-members');
      expect(card(root)).to.not.include('dc-relation-remove');
    });
  });

  describe('an account’s groups', () => {
    /** Alice's card, her groups searched for as the server answers. */
    const searched = (
      memberOf: string[] | undefined,
      answer: (search: nock.Interceptor) => void
    ): Promise<Mounted> =>
      mountConsole({
        hash: 'users/alice',
        answers: server => {
          server
            .get('/api/v1/ldap/users/alice')
            .reply(
              200,
              memberOf ? { ...aliceUnlisted(), memberOf } : aliceUnlisted()
            );
          answer(server.get(membershipsOf(String(alice.dn))));
        },
      });

    it('should search the groups when the directory keeps no memberOf', async () => {
      // Without the memberof overlay the section was always empty (#70).
      for (const memberOf of [undefined, []]) {
        let asked = 0;
        const { root, unmount } = await searched(memberOf, search => {
          search.reply(() => {
            asked += 1;
            return [200, { staff: { dn: staff, cn: 'staff' } }];
          });
        });
        await until(() => !!heading(root));
        expect(asked).to.equal(1);
        expect(card(root)).to.include('<h3>Groups</h3>');
        expect(card(root)).to.include(`data-relation="${staff}">staff<`);
        unmount();
      }
    });

    it('should read memberOf when the directory keeps it, and search nothing', async () => {
      let asked = 0;
      const { root, idle } = await searched([staff], search => {
        search.reply(() => {
          asked += 1;
          return [200, {}];
        });
      });
      await idle();
      expect(asked).to.equal(0);
      expect(card(root)).to.include(`data-relation="${staff}">staff<`);
    });

    it('should show the card, with no group, when the search is refused', async () => {
      // ldap-rest before 0.20.1 refuses a dot in the filter.
      const { root } = await searched(undefined, search => {
        search.reply(400, { error: 'Invalid match query' });
      });
      expect(heading(root)).to.equal('Alice Moreau');
      expect(card(root)).to.include('<h3>Groups</h3>');
      expect(card(root)).to.include('No related entry');
    });
  });
});
