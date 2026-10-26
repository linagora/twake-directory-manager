/**
 * The memberships of groups, mounted: Add to a group… and the × of a group
 * on an account's card, Add members… and the × of a member on a group's,
 * Add to a group… on a list's selection (src/actions/groups.ts).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { expect } from 'chai';
import type nock from 'nock';

import type { Entry } from '../../src/types';
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

/** Alice's entry, as the ldap-rest tested answers it: in two groups. */
const alice = read<{ body: Entry }>('contract/users-alice.json').body;
/** The refusal of a branch the caller does not administer, as recorded. */
const forbidden = read<{ body: object }>(
  'contract/refusal-forbidden.json'
).body;

const top = 'ou=organization,dc=example,dc=com';
const sales = `ou=Sales,${top}`;
const engineering = `ou=Engineering,${top}`;
const users = 'ou=users,dc=example,dc=com';
const groupsBase = 'ou=groups,dc=example,dc=com';
const mailboxTypes = 'ou=twakeMailboxType,ou=nomenclature,dc=example,dc=com';
const aliceDn = String(alice.dn);
const bob = `uid=bob,${users}`;
const carol = `uid=carol,${users}`;

/** A group of the directory, attached to an organization, of a type. */
const group = (
  cn: string,
  link: string,
  kind = 'group',
  member: string[] = []
): Entry => ({
  dn: `cn=${cn},${groupsBase}`,
  cn,
  mail: `${cn}@example.com`,
  twakeMailboxType: `cn=${kind},${mailboxTypes}`,
  twakeDepartmentLink: link,
  member,
});
const salesTeam = group('sales-team', sales, 'teamMailbox', [aliceDn]);
const allStaff = group('all-staff', top, 'mailingList', [aliceDn]);

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

/** The card drawn, as markup; empty while there is none. */
const card = (root: HTMLElement): string =>
  root.querySelector('[data-main] [data-detail]')?.innerHTML ?? '';

/** A search of an entity's list, as a picker makes it: by a text. */
const searchOf =
  (entity: string) =>
  (uri: string): boolean =>
    uri.startsWith(`/api/v1/ldap/${entity}?`) &&
    new URLSearchParams(uri.split('?')[1]).has('attribute');

/** The text a search of a list was made for. */
const searchedFor = (uri: string): string =>
  new URLSearchParams(uri.split('?')[1]).get('match') ?? '';

/** A path, decoded, as a request names it. */
const path =
  (wanted: string) =>
  (uri: string): boolean =>
    decodeURIComponent(uri) === wanted;

/** The picker of the panel: its box, what it offers, what is chosen. */
const pickerOf = (body: HTMLElement) => {
  const input = (): HTMLInputElement => {
    const found = body.querySelector<HTMLInputElement>('#dc-group-search');
    if (!found) throw new Error('no picker');
    return found;
  };
  const results = (): HTMLElement | null =>
    body.querySelector<HTMLElement>('#dc-group-results');
  /** Type a text, and wait for what the search answers. */
  const search = async (text: string): Promise<string[]> => {
    type(input(), text);
    await until(
      () =>
        !results()?.hidden &&
        !(results()?.textContent ?? '').includes('Searching')
    );
    return Array.from(results()?.querySelectorAll('[role="option"]') ?? []).map(
      option => option.textContent?.trim() ?? ''
    );
  };
  return {
    search,
    /** What the list says when it offers nothing */
    note: (): string => results()?.textContent?.trim() ?? '',
    /** Search, and choose the first suggestion with Enter */
    choose: async (text: string): Promise<void> => {
      await search(text);
      press('Enter');
    },
    chosen: (): string[] =>
      Array.from(body.querySelectorAll('[data-chosen] .dc-token span')).map(
        token => token.textContent ?? ''
      ),
    error: (): string => body.querySelector('[data-error]')?.textContent ?? '',
  };
};

describe('actions/groups', () => {
  describe('Add to a group… and the × of a group, on an account’s card', () => {
    /** Sophie Martin, who administers Sales. */
    const sophie = 'sophie.martin';

    /**
     * Alice's card, in Sales / France unless attached elsewhere, her groups
     * answered: sales-team, a shared mailbox of Sales, and all-staff, a
     * list of the whole organization.
     */
    const aliceCard = (
      options: Partial<MountOptions> = {},
      link = String(alice.twakeDepartmentLink)
    ): Promise<Mounted> =>
      mountConsole({
        hash: 'users/alice',
        account: { ...alice, twakeDepartmentLink: link },
        ...options,
        answers: server => {
          options.answers?.(server);
          server.get('/api/v1/ldap/groups/sales-team').reply(200, salesTeam);
          server.get('/api/v1/ldap/groups/all-staff').reply(200, allStaff);
        },
      });

    /** Add to a group…, pressed on the card, its panel open. */
    const adding = async (
      mounted: Mounted
    ): Promise<ReturnType<typeof panelOf>> => {
      const parts = panelOf(mounted.root);
      click(mounted.root, '[data-main] [data-add-groups]');
      await until(() => !parts.panel.hidden);
      return parts;
    };

    it('should say each group’s type, and offer Add to a group… and a × on each', async () => {
      const { root } = await aliceCard({ scope: null });
      expect(card(root))
        .to.include('<h3>Groups</h3>')
        .and.include('data-add-groups="">Add to a group…</button>')
        .and.include(
          // A link: a middle click opens it in a new tab.
          `<a href="#/groups/sales-team" class="dc-link" data-relation="${salesTeam.dn}">sales-team</a><span class="dc-relation-note">· Shared mailbox</span>`
        )
        .and.include('aria-label="Remove from sales-team"')
        .and.include('aria-label="Remove from all-staff"');
      // memberOf is the section, not a field of Details as well.
      expect(card(root)).to.not.include('<dt>Mailing lists</dt>');
    });

    it('should offer a × only on the groups a local administrator writes', async () => {
      const { root } = await aliceCard({ scope: sophie });
      expect(card(root))
        .to.include('data-add-groups')
        .and.include('aria-label="Remove from sales-team"');
      expect(card(root)).to.not.include('aria-label="Remove from all-staff"');
      // Still listed, with its type: only the × goes.
      expect(card(root)).to.include(
        `data-relation="${String(allStaff.dn)}">all-staff</a><span class="dc-relation-note">· Distribution list</span></li>`
      );
    });

    it('should not offer Add to a group… on an account the caller does not write', async () => {
      const { root } = await aliceCard({ scope: sophie }, engineering);
      expect(card(root)).to.include('<h3>Groups</h3>');
      expect(card(root)).to.not.include('data-add-groups');
    });

    it('should offer only the groups the caller writes and the account is not in', async () => {
      const other = group('sales-fr', `ou=France,${sales}`);
      const mounted = await aliceCard({
        scope: sophie,
        answers: server => {
          server.get(searchOf('groups')).reply(200, {
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
            engineering: group('engineering', engineering),
          });
        },
      });
      const { title, body } = await adding(mounted);
      expect(title.textContent).to.equal('Add Alice Moreau to groups');
      expect(await pickerOf(body).search('sal')).to.deep.equal([
        'sales-fr — Group — sales-fr@example.com',
      ]);
    });

    it('should add the account to each group chosen, keep a refused one with why, and offer none joined again', async () => {
      const fr = group('sales-fr', `ou=France,${sales}`);
      const de = group('sales-de', `ou=Germany,${sales}`);
      const uk = group('sales-uk', `ou=UK,${sales}`);
      const mounted = await aliceCard({
        scope: sophie,
        answers: server => {
          server.get(searchOf('groups')).reply(200, {
            'sales-fr': fr,
            'sales-de': de,
            'sales-uk': uk,
          });
          server
            .post('/api/v1/ldap/groups/sales-fr/members', { member: [aliceDn] })
            .reply(200, {});
          for (const name of ['sales-de', 'sales-uk'])
            server
              .post(`/api/v1/ldap/groups/${name}/members`)
              .reply(403, forbidden);
        },
      });
      const { root, calls } = mounted;
      const { panel, body } = await adding(mounted);
      const picker = pickerOf(body);
      for (let i = 0; i < 3; i++) await picker.choose('sales');
      expect(picker.chosen()).to.deep.equal([
        'sales-fr',
        'sales-de',
        'sales-uk',
      ]);
      const reads = callsOf(calls, 'get').length;
      click(body, '[data-add]');
      await until(() => picker.error() !== '');
      expect(callsOf(calls, 'addMembers')).to.deep.equal([
        `addMembers(groups, sales-fr, [${aliceDn}])`,
        `addMembers(groups, sales-de, [${aliceDn}])`,
        `addMembers(groups, sales-uk, [${aliceDn}])`,
      ]);
      expect(toast(root)).to.equal('Alice Moreau added to sales-fr');
      expect(picker.chosen()).to.deep.equal(['sales-de', 'sales-uk']);
      // Each refusal said with its group, when there are several.
      expect(picker.error()).to.equal(
        'sales-de: You do not administer sales-de: this change is not yours to make. ' +
          'sales-uk: You do not administer sales-uk: this change is not yours to make.'
      );
      expect(panel.hidden).to.equal(false);
      // The card behind is drawn again, the group joined on it.
      await until(() => callsOf(calls, 'get').length > reads);

      // A group joined is not offered again: the server would refuse it.
      click(body, '[data-chosen] [data-remove="0"]');
      click(body, '[data-chosen] [data-remove="0"]');
      expect(await picker.search('sales')).to.deep.equal([
        'sales-de — Group — sales-de@example.com',
        'sales-uk — Group — sales-uk@example.com',
      ]);

      // Closed, the panel gives the focus to the button drawn anew.
      click(body, '[data-cancel]');
      expect(panel.hidden).to.equal(true);
      const button = root.querySelector('[data-main] [data-add-groups]');
      expect(button?.isConnected).to.equal(true);
      expect(document.activeElement).to.equal(button);
    });

    it('should close the panel once every group is joined, the focus on Add to a group… drawn anew', async () => {
      const fr = group('sales-fr', `ou=France,${sales}`);
      const mounted = await aliceCard({
        scope: sophie,
        answers: server => {
          server.get(searchOf('groups')).reply(200, { 'sales-fr': fr });
          server
            .post('/api/v1/ldap/groups/sales-fr/members', { member: [aliceDn] })
            .reply(200, {});
        },
      });
      const { root, calls } = mounted;
      const before = root.querySelector('[data-main] [data-add-groups]');
      const { panel, body } = await adding(mounted);
      await pickerOf(body).choose('sales');
      click(body, '[data-add]');
      await until(() => panel.hidden);
      await until(() => {
        const button = root.querySelector('[data-main] [data-add-groups]');
        return (
          !!button && button !== before && document.activeElement === button
        );
      });
      expect(toast(root)).to.equal('Alice Moreau added to sales-fr');
      expect(callsOf(calls, 'addMembers')).to.deep.equal([
        `addMembers(groups, sales-fr, [${aliceDn}])`,
      ]);
    });

    it('should take the account out of a group in one click, say so, and give the focus to Add to a group…', async () => {
      const removal = path(`/api/v1/ldap/groups/sales-team/members/${aliceDn}`);
      const { root, calls } = await aliceCard({
        scope: sophie,
        answers: server => {
          server.delete(removal).reply(200, {});
        },
      });
      const leave = root.querySelector<HTMLElement>(
        `[data-main] [data-leave="${String(salesTeam.dn)}"]`
      );
      leave?.focus();
      expect(document.activeElement).to.equal(leave);
      leave?.click();
      await until(
        () =>
          document.activeElement ===
          root.querySelector('[data-main] [data-add-groups]')
      );
      expect(toast(root)).to.equal('Alice Moreau removed from sales-team');
      expect(refused(root)).to.equal(false);
      expect(callsOf(calls, 'removeMember')).to.deep.equal([
        `removeMember(groups, sales-team, ${aliceDn})`,
      ]);
    });

    it('should say why the server refused to take the account out, and draw nothing again', async () => {
      const removal = path(`/api/v1/ldap/groups/sales-team/members/${aliceDn}`);
      const { root, calls, idle } = await aliceCard({
        scope: sophie,
        answers: server => {
          server.delete(removal).reply(403, forbidden);
        },
      });
      const reads = callsOf(calls, 'get').length;
      const selector = `[data-main] [data-leave="${String(salesTeam.dn)}"]`;
      const leave = root.querySelector<HTMLElement>(selector);
      leave?.click();
      await until(() => refused(root));
      await idle();
      expect(toast(root)).to.equal(
        'You do not administer sales-team: this change is not yours to make.'
      );
      expect(callsOf(calls, 'get')).to.have.length(reads);
      // The same ×, ready for another try.
      expect(root.querySelector(selector)).to.equal(leave);
      expect(leave?.getAttribute('aria-disabled')).to.equal(null);
    });
  });

  describe('Add members… and the × of a member, on a group’s card', () => {
    /** The card of staff, as the server holds it, and the accounts it finds. */
    const staffCard = (
      staff: Entry,
      options: Partial<MountOptions> = {}
    ): Promise<Mounted> =>
      mountConsole({
        hash: 'groups/staff',
        scope: null,
        ...options,
        answers: server => {
          options.answers?.(server);
          server.get('/api/v1/ldap/groups/staff').reply(200, staff);
          server.get(searchOf('users')).reply(uri =>
            searchedFor(uri) === 'carol'
              ? [
                  200,
                  {
                    carol: {
                      dn: carol,
                      uid: 'carol',
                      displayName: 'Carol Diaz',
                      mail: 'carol@other.org',
                    },
                  },
                ]
              : [200, {}]
          );
          server.get(searchOf('groups')).reply(200, {});
        },
      });

    /** Add members…, pressed on the card, its panel open. */
    const adding = async (
      mounted: Mounted
    ): Promise<ReturnType<typeof panelOf>> => {
      const parts = panelOf(mounted.root);
      click(mounted.root, '[data-main] [data-add-members]');
      await until(() => !parts.panel.hidden);
      return parts;
    };

    it('should say why a shared mailbox’s search offers nobody', async () => {
      // It takes accounts of its domain: one found elsewhere is left out,
      // and an address typed at another domain will be refused alike. The
      // server says so in its configuration (`james`).
      const served = read<{ features: Record<string, unknown> }>('config.json');
      served.features.james = {};
      const mounted = await staffCard(
        {
          ...group('staff', top, 'teamMailbox'),
          mail: 'staff@example.com',
        },
        {
          answers: (server: nock.Scope) => {
            server.get('/api/v1/config').reply(200, served);
          },
        }
      );
      const { title, body } = await adding(mounted);
      expect(title.textContent).to.equal('Add members to staff');
      const picker = pickerOf(body);
      const note =
        'A shared mailbox at example.com only takes accounts of example.com';
      expect(await picker.search('dave')).to.deep.equal([]);
      expect(picker.note()).to.not.include(note);
      expect(await picker.search('dave@exam')).to.deep.equal([]);
      expect(picker.note()).to.not.include(note);
      expect(await picker.search('dave@other.org')).to.deep.equal([]);
      expect(picker.note()).to.equal(note);
      expect(await picker.search('carol')).to.deep.equal([]);
      expect(picker.note()).to.equal(note);
    });

    it('should add the members chosen, close its panel, and give the focus to Add members… drawn anew', async () => {
      const mounted = await staffCard(group('staff', top, 'group', [bob]), {
        answers: server => {
          server
            .post('/api/v1/ldap/groups/staff/members', { member: [carol] })
            .reply(200, {});
        },
      });
      const { root, calls } = mounted;
      const { panel, body } = await adding(mounted);
      await pickerOf(body).choose('carol');
      click(body, '[data-add]');
      await until(() => panel.hidden);
      await until(
        () =>
          document.activeElement ===
          root.querySelector('[data-main] [data-add-members]')
      );
      expect(toast(root)).to.equal('carol added to staff');
      expect(callsOf(calls, 'addMembers')).to.deep.equal([
        `addMembers(groups, staff, [${carol}])`,
      ]);
    });

    it('should take a member out in one click, by the group’s id and the member’s DN', async () => {
      // Moved from the card's stub test: the × sends one removal.
      const { root, calls } = await staffCard(
        group('staff', top, 'group', [bob]),
        {
          answers: server => {
            server
              .delete(path(`/api/v1/ldap/groups/staff/members/${bob}`))
              .reply(200, {});
          },
        }
      );
      const leave = root.querySelector<HTMLElement>(
        `[data-main] [data-leave="${bob}"]`
      );
      expect(leave?.getAttribute('aria-label')).to.equal(
        'Remove bob from staff'
      );
      leave?.focus();
      leave?.click();
      await until(
        () =>
          document.activeElement ===
          root.querySelector('[data-main] [data-add-members]')
      );
      expect(toast(root)).to.equal('bob removed from staff');
      expect(callsOf(calls, 'removeMember')).to.deep.equal([
        `removeMember(groups, staff, ${bob})`,
      ]);
    });
  });

  describe('Add to a group…, on a selection of accounts', () => {
    /** An account, of Sales unless said. */
    const account = (uid: string, name: string, branch = sales): Entry => ({
      dn: `uid=${uid},${users}`,
      uid,
      displayName: name,
      twakeDepartmentLink: branch,
    });
    /** A group Sophie writes, holding these members. */
    const held = (cn: string, member: string[]): Entry =>
      group(cn, sales, 'group', member);

    /**
     * The list of users, as Sophie Martin sees it, Alice and Bob selected
     * and Dave, whom she does not administer, with them; Add to a group…
     * pressed.
     */
    const selection = async (
      found: Record<string, Entry>,
      answers?: (server: nock.Scope) => void
    ): Promise<Mounted & ReturnType<typeof panelOf>> => {
      const mounted = await mountConsole({
        hash: 'users',
        scope: 'sophie.martin',
        answers: server => {
          answers?.(server);
          server.get(searchOf('groups')).reply(200, found);
        },
      });
      const { root, server } = mounted;
      server.get(/\/api\/v1\/ldap\/users\?/).reply(200, {
        alice: account('alice', 'Alice Martin'),
        bob: account('bob', 'Bob Durand'),
        dave: account('dave', 'Dave Petit', engineering),
      });
      click(root, '[data-main] [data-list-all]');
      await settled(root);
      for (const uid of ['alice', 'bob', 'dave'])
        click(root, `[data-select="${uid}"]`);
      const parts = panelOf(root);
      click(root, '[data-main] [data-bulk-action="0"]');
      await until(() => !parts.panel.hidden);
      return { ...mounted, ...parts };
    };

    /** How many times the list was read. */
    const reads = (calls: string[]): number =>
      calls.filter(call => call.startsWith('listBounded(users')).length;
    const aliceIn = `uid=alice,${users}`;

    it('should add the accounts to each group, sending none it holds, and keep a refused one', async () => {
      // One member sent again failed the whole request, the others with it.
      const mounted = await selection(
        {
          'all-staff': held('all-staff', [aliceIn]),
          'sales-team': held('sales-team', ['']),
          locked: held('locked', []),
          everyone: held('everyone', [aliceIn, bob]),
        },
        server => {
          for (const cn of ['all-staff', 'sales-team'])
            server.post(`/api/v1/ldap/groups/${cn}/members`).reply(200, {});
          server
            .post('/api/v1/ldap/groups/locked/members')
            .reply(403, { error: 'Forbidden' });
        }
      );
      const { root, title, body, panel, calls } = mounted;
      expect(title.textContent).to.equal('Add 2 accounts to groups');
      expect(body.textContent).to.include(
        '1 account you do not administer is left out.'
      );
      const picker = pickerOf(body);
      for (let i = 0; i < 4; i++) await picker.choose('grp');
      click(body, '[data-add]');
      await until(() => picker.error() !== '');
      expect(callsOf(calls, 'addMembers')).to.deep.equal([
        `addMembers(groups, all-staff, [${bob}])`,
        `addMembers(groups, sales-team, [${aliceIn}, ${bob}])`,
        `addMembers(groups, locked, [${aliceIn}, ${bob}])`,
      ]);
      // One already in a group is not said to be added to it.
      expect(toast(root)).to.equal(
        '1 account added to all-staff. 2 accounts added to sales-team. 2 accounts were in everyone already.'
      );
      // The refused one stays, named with why, and the panel with it.
      expect(picker.chosen()).to.deep.equal(['locked']);
      expect(picker.error()).to.match(/^locked: /);
      expect(panel.hidden).to.equal(false);
      // Settled once its panel is closed, not before: the list is read
      // again then, its selection gone.
      expect(reads(calls)).to.equal(1);
      click(body, '[data-cancel]');
      expect(panel.hidden).to.equal(true);
      await until(() => reads(calls) === 2);
      await settled(root);
      expect(root.querySelector<HTMLElement>('[data-main] .dc-bulk')?.hidden).to
        .be.true;
    });

    it('should be done with accounts already in every group chosen', async () => {
      const { root, body, panel, calls } = await selection({
        everyone: held('everyone', [aliceIn, bob]),
      });
      await pickerOf(body).choose('every');
      click(body, '[data-add]');
      await until(() => panel.hidden);
      expect(callsOf(calls, 'addMembers')).to.deep.equal([]);
      expect(toast(root)).to.equal('2 accounts were in everyone already.');
      // The selection goes, as after any action done.
      await until(() => reads(calls) === 2);
    });

    it('should settle nothing changed once its panel is replaced unused', async () => {
      const { root, title, panel, calls, idle } = await selection({});
      // New user, pressed while it is open: its form takes the panel.
      click(root, '[data-main] [data-new]');
      await until(() => title.textContent !== 'Add 2 accounts to groups');
      await idle();
      expect(reads(calls)).to.equal(1);
      expect(root.querySelector<HTMLElement>('[data-main] .dc-bulk')?.hidden).to
        .be.false;
      // Settled: another action on the selection may start.
      click(root, '[data-panel-close]');
      await until(() => panel.hidden);
      click(root, '[data-main] [data-bulk-action="1"]');
      await until(() => title.textContent === 'Change state — 2 accounts');
    });
  });
});
