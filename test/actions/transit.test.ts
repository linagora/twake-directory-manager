/**
 * The transit branch, mounted: Hand over on an account's card, asked first
 * with the groups it may leave, and Claim… on the card of an entry in
 * transit or on the Overview's row (src/actions/transit.ts).
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

/** Alice's entry, as the ldap-rest tested answers it: in Sales / France, in two groups. */
const alice = read<{ body: Entry }>('contract/users-alice.json').body;
/** The refusal of a branch the caller does not administer, as recorded. */
const forbidden = read<{ body: object }>(
  'contract/refusal-forbidden.json'
).body;

const top = 'ou=organization,dc=example,dc=com';
const sales = `ou=Sales,${top}`;
const engineering = `ou=Engineering,${top}`;
const transit = `ou=Transit,${top}`;
const groupsBase = 'ou=groups,dc=example,dc=com';
const mailboxTypes = 'ou=twakeMailboxType,ou=nomenclature,dc=example,dc=com';

/** Bob, handed over by another administrator: waiting in transit. */
const bob: Entry = {
  dn: 'uid=bob,ou=users,dc=example,dc=com',
  objectClass: ['top', 'twakeAccount', 'twakeWhitePages'],
  uid: 'bob',
  cn: 'Bob Schneider',
  displayName: 'Bob Schneider',
  twakeDepartmentLink: transit,
  twakeDepartmentPath: 'Transit',
};

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

/** How many times what waits in transit was read. */
const transitReads = (calls: string[]): number =>
  callsOf(calls, 'organizationMembers').filter(call =>
    call.startsWith(`organizationMembers(${transit}`)
  ).length;

/** Wait for the question to be asked in the panel. */
const question = (root: HTMLElement): Promise<void> =>
  until(() => !!panelOf(root).body.querySelector('[data-confirm]'));

/** An organization's children, as the tree and the claim's walk read them. */
const children =
  (dn: string, nodes: Entry[]) =>
  (server: nock.Scope): void => {
    const path = `/api/v1/ldap/organizations/${dn}/subnodes?objectClass=organizationalUnit`;
    server.get(uri => decodeURIComponent(uri) === path).reply(200, nodes);
  };

describe('actions/transit', () => {
  describe('Hand over, from an account’s card', () => {
    /** A group of the directory, attached to an organization, of a type. */
    const group = (cn: string, link: string, type: string): Entry => ({
      dn: `cn=${cn},${groupsBase}`,
      cn,
      twakeDepartmentLink: link,
      twakeMailboxType: `cn=${type},${mailboxTypes}`,
      member: [String(alice.dn)],
    });

    /**
     * Alice's card as Sophie Martin, who administers Sales, sees it: her
     * groups answered, sales-team a shared mailbox of Sales, which Sophie
     * writes, and all-staff a list of the whole organization, which she
     * does not. Hand over pressed, the question asked.
     */
    const handingOver = async (
      account: Entry = alice,
      answers?: (server: nock.Scope) => void,
      delegated = false
    ): Promise<Mounted> => {
      // The scenario is a group Sophie does not write: keep the delegation
      // out of it, as a server before it answered none.
      const scope = read<Scope>('scopes/sophie.martin.json');
      if (!delegated) delete scope.delegatedGroups;
      const mounted = await mountConsole({
        hash: 'users/alice',
        scope,
        account,
        answers: server => {
          answers?.(server);
          server
            .get('/api/v1/ldap/groups/sales-team')
            .reply(200, group('sales-team', sales, 'teamMailbox'));
          server
            .get('/api/v1/ldap/groups/all-staff')
            .reply(200, group('all-staff', top, 'mailingList'));
        },
      });
      await settled(mounted.root);
      mounted.root
        .querySelector<HTMLElement>('[data-main] [data-more]')
        ?.focus();
      click(mounted.root, '[data-main] [data-hand-over]');
      await question(mounted.root);
      return mounted;
    };

    /** The move to transit, and the removal from sales-team, answered. */
    const moves = (
      server: nock.Scope,
      move: [number, object] = [200, {}],
      removal: [number, object] = [200, {}]
    ): void => {
      server
        .post('/api/v1/ldap/users/alice/move', { targetOrgDn: transit })
        .reply(...move);
      server
        .delete(
          uri =>
            decodeURIComponent(uri) ===
            `/api/v1/ldap/groups/sales-team/members/${String(alice.dn)}`
        )
        .reply(...removal);
    };

    const moved = `move(users, alice, ${transit})`;
    const removed = `removeMember(groups, sales-team, ${String(alice.dn)})`;
    const removedDelegated = `removeMember(groups, all-staff, ${String(alice.dn)})`;
    const restored = `addMembers(groups, sales-team, [${String(alice.dn)}])`;

    it('should name the person and the organization they leave, and move nothing when declined', async () => {
      // In no group: the question is the hand-over's alone.
      const { root, calls } = await handingOver(
        { ...alice, memberOf: [] },
        server => server.get(/\/api\/v1\/ldap\/groups\?match=/).reply(200, {})
      );
      const { title, body, dialog } = panelOf(root);
      expect(title.textContent).to.equal('Hand Alice Moreau over?');
      expect(
        Array.from(body.querySelectorAll('[data-confirm-body] > p')).map(
          line => line.textContent
        )
      ).to.deep.equal([
        'Alice Moreau leaves Sales / France for Transit.',
        'Every administrator will see this entry and may claim it; you will no longer manage it.',
      ]);
      expect(body.querySelector('.dc-confirm-choices')).to.equal(null);
      // Reversible: claimed back, it is the button of a step, not a danger.
      const action = body.querySelector('[data-confirm]');
      expect(action?.textContent).to.equal('Hand over');
      expect(action?.classList.contains('dc-button-primary')).to.be.true;
      expect(dialog.getAttribute('role')).to.equal('alertdialog');
      expect(document.activeElement).to.equal(
        body.querySelector('[data-cancel]')
      );
      click(body, '[data-cancel]');
      expect(panelOf(root).panel.hidden).to.be.true;
      expect(document.activeElement).to.equal(
        root.querySelector('[data-main] [data-more]')
      );
      expect(callsOf(calls, 'move')).to.deep.equal([]);
    });

    it('should offer to take the account out of the groups the caller writes, before moving it', async () => {
      // Out of the groups while the account is still in Sales: a delegated
      // group's administrator may only remove a member attached to their own
      // organizations, and the move would take it out of theirs (#329).
      const { root, calls, server } = await handingOver();
      const { body, panel } = panelOf(root);
      expect(
        body.querySelector('.dc-confirm-choices legend')?.textContent
      ).to.equal('Also remove Alice Moreau from:');
      const boxes = Array.from(
        body.querySelectorAll<HTMLInputElement>('[data-confirm-choice]')
      );
      expect(
        boxes.map(box => box.closest('label')?.textContent?.trim())
      ).to.deep.equal(['sales-team · Shared mailbox']);
      expect(boxes[0].checked).to.be.true;
      expect(body.querySelector('[data-confirm-body]')?.textContent).to.include(
        'Alice Moreau stays in all-staff, which you do not manage.'
      );
      moves(server);
      const cards = callsOf(calls, 'get').filter(
        call => call === 'get(users, alice)'
      ).length;
      const counted = transitReads(calls);
      click(body, '[data-confirm]');
      await until(() => toast(root) !== '');
      // Removed first, then moved: the server judges a delegated removal on
      // the organization the member is still attached to.
      const order = calls.filter(call => call === moved || call === removed);
      expect(order).to.deep.equal([removed, moved]);
      expect(toast(root)).to.equal('alice (Sales / France) is in transit');
      expect(refused(root)).to.be.false;
      expect(panel.hidden).to.be.true;
      // The card drawn again, and what waits in transit counted again.
      await until(() => transitReads(calls) > counted);
      expect(
        callsOf(calls, 'get').filter(call => call === 'get(users, alice)')
      ).to.have.length(cards + 1);
    });

    it('should remove a delegated group before moving the account', async () => {
      const { root, calls, server } = await handingOver(alice, undefined, true);
      const { body } = panelOf(root);
      expect(
        Array.from(
          body.querySelectorAll<HTMLInputElement>('[data-confirm-choice]')
        ).map(box => box.closest('label')?.textContent?.trim())
      ).to.deep.equal([
        'all-staff · Distribution list',
        'sales-team · Shared mailbox',
      ]);
      moves(server);
      server
        .delete(
          uri =>
            decodeURIComponent(uri) ===
            `/api/v1/ldap/groups/all-staff/members/${String(alice.dn)}`
        )
        .reply(200, {});
      click(body, '[data-confirm]');
      await until(() => toast(root) !== '');
      const order = calls.filter(
        call => call === moved || call === removed || call === removedDelegated
      );
      expect(order).to.deep.equal([removedDelegated, removed, moved]);
      expect(toast(root)).to.equal('alice (Sales / France) is in transit');
    });

    it('should leave the account in a group unchecked', async () => {
      const { root, calls, server } = await handingOver();
      const { body } = panelOf(root);
      const box = body.querySelector<HTMLInputElement>(
        '[data-confirm-choice="0"]'
      );
      if (box) box.checked = false;
      moves(server);
      click(body, '[data-confirm]');
      await until(() => toast(root) !== '');
      expect(calls).to.include(moved);
      expect(calls).to.not.include(removed);
      expect(toast(root)).to.equal('alice (Sales / France) is in transit');
    });

    it('should say the groups a removal was refused in', async () => {
      const { root, server } = await handingOver();
      moves(server, [200, {}], [403, forbidden]);
      click(panelOf(root).body, '[data-confirm]');
      await until(() => toast(root) !== '');
      expect(toast(root)).to.equal(
        'alice (Sales / France) is in transit; still in sales-team'
      );
      expect(refused(root)).to.be.true;
    });

    it('should put back the groups the account left when the move is refused', async () => {
      const { root, calls, server } = await handingOver();
      moves(server, [403, forbidden]);
      server
        .post('/api/v1/ldap/groups/sales-team/members', {
          member: [String(alice.dn)],
        })
        .reply(200, {});
      click(panelOf(root).body, '[data-confirm]');
      await until(() => toast(root) !== '');
      const order = calls.filter(
        call => call === removed || call === moved || call === restored
      );
      expect(order).to.deep.equal([removed, moved, restored]);
      expect(toast(root)).to.equal(
        'You do not administer Sales / France: this change is not yours to make.'
      );
      expect(refused(root)).to.be.true;
      expect(window.location.hash).to.equal('#/users/alice');
    });

    it('should say the groups it could not put back when the move is refused', async () => {
      const { root, calls, server } = await handingOver();
      const cards = callsOf(calls, 'get').filter(
        call => call === 'get(users, alice)'
      ).length;
      moves(server, [403, forbidden]);
      server
        .post('/api/v1/ldap/groups/sales-team/members', {
          member: [String(alice.dn)],
        })
        .reply(403, forbidden);
      click(panelOf(root).body, '[data-confirm]');
      await until(() => toast(root) !== '');
      expect(toast(root)).to.equal(
        'You do not administer Sales / France: this change is not yours to make; no longer in sales-team'
      );
      expect(refused(root)).to.be.true;
      // The card is drawn again: it would still show the group it left.
      await settled(root);
      expect(
        callsOf(calls, 'get').filter(call => call === 'get(users, alice)')
      ).to.have.length(cards + 1);
    });

    it('should leave the groups left when the move may have gone through', async () => {
      const { root, calls, server } = await handingOver();
      const cards = callsOf(calls, 'get').filter(
        call => call === 'get(users, alice)'
      ).length;
      moves(server, [503, { error: 'Service Unavailable' }]);
      click(panelOf(root).body, '[data-confirm]');
      await until(() => toast(root) !== '');
      // A server failure may have moved the entry: putting the groups back
      // would re-add it after it reached Transit.
      expect(calls).to.include(removed);
      expect(calls).to.not.include(restored);
      expect(toast(root)).to.equal(
        'Something went wrong (Service Unavailable); no longer in sales-team'
      );
      expect(refused(root)).to.be.true;
      await settled(root);
      expect(
        callsOf(calls, 'get').filter(call => call === 'get(users, alice)')
      ).to.have.length(cards + 1);
    });

    it('should say when the account’s groups could not be listed', async () => {
      const { root, calls } = await handingOver(
        { ...alice, memberOf: [] },
        server =>
          server.get(/\/api\/v1\/ldap\/groups\?match=/).reply(403, forbidden)
      );
      // Every group is to be gone through: searched strictly, one entity
      // that cannot be searched fails them all.
      expect(
        callsOf(calls, 'memberships').filter(call => call.endsWith(', true)'))
      ).to.have.length(1);
      expect(
        panelOf(root).body.querySelector('[data-confirm-body]')?.textContent
      ).to.include('The groups Alice Moreau belongs to could not be listed.');
    });

    it('should say where a handed-over account comes from, and nothing when it names none', async () => {
      // In transit the entry no longer names its organization: the toast is
      // the last place that says where it came from.
      const nowhere: Entry = { ...alice, memberOf: [] };
      delete nowhere.twakeDepartmentPath;
      const { root, calls, server } = await handingOver(nowhere, answer =>
        answer.get(/\/api\/v1\/ldap\/groups\?match=/).reply(200, {})
      );
      expect(
        Array.from(
          panelOf(root).body.querySelectorAll('[data-confirm-body] > p')
        ).map(line => line.textContent)
      ).to.deep.equal([
        'Every administrator will see this entry and may claim it; you will no longer manage it.',
      ]);
      moves(server);
      click(panelOf(root).body, '[data-confirm]');
      await until(() => toast(root) !== '');
      expect(calls).to.include(moved);
      expect(toast(root)).to.equal('alice is in transit');
    });
  });

  describe('Claim…', () => {
    /** Bob's card, waiting in transit, as this administrator sees it. */
    const card = async (
      scope: MountOptions['scope'],
      answers: (server: nock.Scope) => void,
      language = 'en'
    ): Promise<Mounted> => {
      const mounted = await mountConsole({
        hash: 'users/bob',
        scope,
        account: bob,
        language,
        answers,
      });
      await settled(mounted.root);
      return mounted;
    };

    /** Open Claim… from the card, the focus on it first. */
    const claiming = async (root: HTMLElement): Promise<HTMLElement> => {
      const button = root.querySelector<HTMLElement>(
        '[data-main] [data-claim]'
      );
      if (!button) throw new Error('no Claim…');
      button.focus();
      click(root, '[data-main] [data-claim]');
      await until(() => !panelOf(root).panel.hidden);
      return button;
    };

    /** The organizations offered, as the select names them. */
    const offered = (body: HTMLElement): string[] =>
      Array.from(body.querySelectorAll('#dc-claim-target option')).map(
        option => option.textContent ?? ''
      );

    /** The global administrator's tree: Sales and the transit branch under the top. */
    const tree = children(top, [
      { dn: sales, ou: 'Sales', twakeDepartmentPath: 'Sales' },
      { dn: transit, ou: 'Transit', twakeDepartmentPath: 'Transit' },
    ]);

    it('should name the person to claim, and offer the caller’s organizations but the transit branch', async () => {
      const { root } = await card('admin', tree);
      const opener = await claiming(root);
      const { title, body } = panelOf(root);
      expect(title.textContent).to.equal('Claim Bob Schneider');
      expect(offered(body)).to.deep.equal(['organization', 'Sales']);
      // Into the panel, on the select.
      expect(document.activeElement).to.equal(
        body.querySelector('#dc-claim-target')
      );
      expect(body.querySelector('button[type="submit"]')?.textContent).to.equal(
        'Claim into organization'
      );
      click(body, '[data-cancel]');
      expect(panelOf(root).panel.hidden).to.be.true;
      expect(document.activeElement).to.equal(opener);
    });

    it('should name the organization alone on its button, a slash in its name kept', async () => {
      // The select shows the whole path; the button says the leaf. The path
      // is split on the separator as the directory writes it, ` / `: a name
      // holding a bare slash is one segment.
      const unit = `ou=R&D/IT,${engineering}`;
      const { root } = await card(
        'eric.dubois',
        children(engineering, [
          {
            dn: unit,
            ou: 'R&D/IT',
            twakeDepartmentPath: 'Engineering / R&D/IT',
          },
        ])
      );
      await claiming(root);
      const { body } = panelOf(root);
      expect(offered(body)).to.deep.equal([
        'Engineering',
        'Engineering / R&D/IT',
      ]);
      const submit = body.querySelector('button[type="submit"]');
      expect(submit?.textContent).to.equal('Claim into Engineering');
      const select = body.querySelector<HTMLSelectElement>('#dc-claim-target');
      if (!select) throw new Error('no select');
      select.value = unit;
      select.dispatchEvent(new Event('change', { bubbles: true }));
      expect(submit?.textContent).to.equal('Claim into R&D/IT');
    });

    it('should move it where chosen, say so, and draw its card again', async () => {
      const { root, calls, server } = await card('admin', tree);
      await claiming(root);
      const { body, panel } = panelOf(root);
      const select = body.querySelector<HTMLSelectElement>('#dc-claim-target');
      if (!select) throw new Error('no select');
      select.value = sales;
      select.dispatchEvent(new Event('change', { bubbles: true }));
      server
        .post('/api/v1/ldap/users/bob/move', { targetOrgDn: sales })
        .reply(200, {});
      const cards = callsOf(calls, 'get').filter(
        call => call === 'get(users, bob)'
      ).length;
      const counted = transitReads(calls);
      click(body, 'button[type="submit"]');
      await until(() => toast(root) !== '');
      expect(calls).to.include(`move(users, bob, ${sales})`);
      expect(panel.hidden).to.be.true;
      expect(toast(root)).to.equal('Bob Schneider moved to Sales');
      // Already on its card: drawn again, and transit counted again.
      await until(() => transitReads(calls) > counted);
      expect(
        callsOf(calls, 'get').filter(call => call === 'get(users, bob)')
      ).to.have.length(cards + 1);
      expect(window.location.hash).to.equal('#/users/bob');
    });

    it('should keep the panel and say why when the claim is refused', async () => {
      const { root, server } = await card('admin', tree);
      await claiming(root);
      const { body, panel } = panelOf(root);
      server.post('/api/v1/ldap/users/bob/move').reply(403, forbidden);
      click(body, 'button[type="submit"]');
      await until(() => toast(root) !== '');
      // Claiming is judged on the organization chosen alone.
      expect(toast(root)).to.equal(
        'You do not administer organization: this change is not yours to make.'
      );
      expect(refused(root)).to.be.true;
      expect(panel.hidden).to.be.false;
    });

    it('should say there is nowhere to claim into for whom writes only the transit branch', async () => {
      const admin = read<Scope>('scopes/admin.json');
      const scope: Scope = {
        ...admin,
        branches: [
          {
            dn: transit,
            read: true,
            write: true,
            delete: false,
            name: 'Transit',
            path: 'Transit',
          },
        ],
      };
      const { root } = await card(scope, () => undefined);
      await claiming(root);
      const { body, dialog } = panelOf(root);
      expect(body.querySelector('.dc-empty')?.textContent).to.equal(
        'You write in no organization that could take it'
      );
      expect(body.querySelector('form')).to.equal(null);
      // No field to start on: the panel holds the focus.
      expect(document.activeElement).to.equal(dialog);
    });

    describe('over a tree too wide to walk', () => {
      // The production case: 1,136 domains under one parent, the one the
      // account was meant for 650th of them. The walk stopped after 200
      // organizations, which the select offered, and left it out.
      const government = `ou=Government of Mongolia,${top}`;
      const wanted = `ou=mojha.gov.mn,${government}`;
      const domain = (ou: string): Entry => ({
        dn: `ou=${ou},${government}`,
        ou,
        twakeDepartmentPath: `Government of Mongolia / ${ou}`,
      });
      const domains = Array.from({ length: 1136 }, (_, index) =>
        index === 649
          ? domain('mojha.gov.mn')
          : domain(`agency-${String(index).padStart(4, '0')}.gov.mn`)
      );
      const wide = (server: nock.Scope): void => {
        children(top, [
          {
            dn: government,
            ou: 'Government of Mongolia',
            twakeDepartmentPath: 'Government of Mongolia',
          },
          { dn: transit, ou: 'Transit', twakeDepartmentPath: 'Transit' },
        ])(server);
        children(government, domains)(server);
      };
      /** The tree searched from a branch, for a text, as the server answers. */
      const searched = (
        from: string,
        query: string,
        found: Entry[]
      ): ((server: nock.Scope) => void) => {
        const path = `/api/v1/ldap/organizations/${from}/search?q=${query}`;
        return server => {
          server.get(uri => decodeURIComponent(uri) === path).reply(200, found);
        };
      };
      /** The search box of the panel, and the suggestions under it. */
      const pickerOf = (
        body: HTMLElement
      ): { input: HTMLInputElement; results: HTMLElement } => {
        const input = body.querySelector<HTMLInputElement>('[role="combobox"]');
        const results = body.querySelector<HTMLElement>('[role="listbox"]');
        if (!input || !results) throw new Error('no picker');
        return { input, results };
      };
      const suggestions = (results: HTMLElement): string[] =>
        Array.from(results.querySelectorAll('[role="option"]')).map(
          option => option.textContent ?? ''
        );

      it('should search the organizations past the walk’s bound, and claim into the one found', async () => {
        const { root, calls, server } = await card('admin', server => {
          searched(top, 'moj', [
            // The server answers the transit branch too: it is no choice.
            { dn: transit, ou: 'Transit', twakeDepartmentPath: 'Transit' },
            domain('mojha.gov.mn'),
          ])(server);
          wide(server);
        });
        await claiming(root);
        const { body, panel } = panelOf(root);
        // No select of the first organizations walked: a search.
        expect(body.querySelector('#dc-claim-target')).to.equal(null);
        const { input, results } = pickerOf(body);
        expect(document.activeElement).to.equal(input);
        expect(
          body.querySelector(`label[for="${input.id}"]`)?.textContent
        ).to.equal('Into the organization');
        expect(body.textContent).to.include(
          'Type 3 characters of the organization’s name or path'
        );
        const submit = body.querySelector<HTMLButtonElement>(
          'button[type="submit"]'
        );
        expect(submit?.textContent).to.equal('Claim');
        expect(submit?.disabled).to.be.true;
        type(input, 'moj');
        await until(() => suggestions(results).length > 0);
        expect(suggestions(results)).to.deep.equal([
          'Government of Mongolia / mojha.gov.mn',
        ]);
        // Searched from the caller's branch, which holds the whole tree.
        expect(callsOf(calls, 'organizationSearchRead')).to.deep.equal([
          `organizationSearchRead(moj, ${top})`,
        ]);
        press('Enter');
        // Chosen: a token with its path, the button naming it alone.
        expect(body.querySelector('[data-chosen]')?.textContent).to.include(
          'Government of Mongolia / mojha.gov.mn'
        );
        expect(submit?.textContent).to.equal('Claim into mojha.gov.mn');
        expect(submit?.disabled).to.be.false;
        await until(
          () =>
            root.querySelector('[data-announce]')?.textContent ===
            'Chosen: Government of Mongolia / mojha.gov.mn'
        );
        server
          .post('/api/v1/ldap/users/bob/move', { targetOrgDn: wanted })
          .reply(200, {});
        const counted = transitReads(calls);
        click(body, 'button[type="submit"]');
        await until(() => toast(root) !== '');
        expect(calls).to.include(`move(users, bob, ${wanted})`);
        expect(panel.hidden).to.be.true;
        expect(toast(root)).to.equal(
          'Bob Schneider moved to Government of Mongolia / mojha.gov.mn'
        );
        await until(() => transitReads(calls) > counted);
      });

      it('should open the search once a read shows the tree too wide, without walking on', async () => {
        const read: string[] = [];
        const { root } = await card('admin', server => {
          wide(server);
          // Any other organization read, as the walk would go on to.
          server
            .persist()
            .get(uri => {
              const path = decodeURIComponent(uri);
              if (!path.includes(`,${government}/subnodes`)) return false;
              read.push(path);
              return true;
            })
            .reply(200, []);
        });
        await claiming(root);
        pickerOf(panelOf(root).body);
        // The top, then the parent of 1,136, past the bound already: none of
        // the 48 reads more the walk made before.
        expect(read).to.deep.equal([]);
      });

      /** A scope writing the parent of 1,136 and Sales, and the branches named. */
      const twoBranches = (...more: string[]): Scope => {
        const admin = read<Scope>('scopes/admin.json');
        const branch = (dn: string): Scope['branches'][number] => ({
          dn,
          read: true,
          write: true,
          delete: false,
          name: rdnName(dn),
          path: rdnName(dn),
        });
        return {
          ...admin,
          branches: [government, sales, ...more].map(branch),
        };
      };
      const rdnName = (dn: string): string => dn.split(',')[0].split('=')[1];
      const salesGov: Entry = {
        dn: `ou=gov,${sales}`,
        ou: 'gov',
        twakeDepartmentPath: 'Sales / gov',
      };
      /** A branch whose search fails, as a gateway answers. */
      const failing =
        (from: string, query: string) =>
        (server: nock.Scope): void => {
          const path = `/api/v1/ldap/organizations/${from}/search?q=${query}`;
          server
            .get(uri => decodeURIComponent(uri) === path)
            .reply(502, 'Bad Gateway');
        };

      it('should offer what the other branches found when one search fails, and say some are missing', async () => {
        const { root } = await card(twoBranches(), server => {
          failing(government, 'gov')(server);
          searched(sales, 'gov', [salesGov])(server);
          children(government, domains)(server);
        });
        await claiming(root);
        const { body } = panelOf(root);
        const { input, results } = pickerOf(body);
        type(input, 'gov');
        await until(() => suggestions(results).length > 0);
        expect(suggestions(results)).to.deep.equal(['Sales / gov']);
        const missing =
          'Some of your branches could not be searched: their organizations are missing';
        expect(
          results.querySelector('[data-picker-cut]')?.textContent
        ).to.equal(missing);
        await until(
          () => root.querySelector('[data-announce]')?.textContent === missing
        );
      });

      it('should say the search failed when every branch failed', async () => {
        const { root } = await card(twoBranches(), server => {
          failing(government, 'gov')(server);
          failing(sales, 'gov')(server);
          children(government, domains)(server);
        });
        await claiming(root);
        const { body } = panelOf(root);
        const { input, results } = pickerOf(body);
        type(input, 'gov');
        await until(
          () =>
            !!results.textContent && !results.textContent.includes('Searching')
        );
        expect(suggestions(results)).to.deep.equal([]);
        expect(results.textContent).to.not.include('could not be searched');
        expect(results.textContent).to.not.equal('No match');
      });

      it('should not search the transit branch, when the caller writes it as a branch', async () => {
        const { root, calls } = await card(twoBranches(transit), server => {
          searched(government, 'gov', [domain('mojha.gov.mn')])(server);
          searched(sales, 'gov', [salesGov])(server);
          children(government, domains)(server);
        });
        await claiming(root);
        const { body } = panelOf(root);
        const { input, results } = pickerOf(body);
        type(input, 'gov');
        await until(() => suggestions(results).length > 0);
        expect(callsOf(calls, 'organizationSearchRead')).to.have.members([
          `organizationSearchRead(gov, ${government})`,
          `organizationSearchRead(gov, ${sales})`,
        ]);
        expect(callsOf(calls, 'organizationSearchRead')).to.have.length(2);
      });

      it('should search each branch the caller writes once, a nested one in its parent’s answer', async () => {
        const admin = read<Scope>('scopes/admin.json');
        const branch = (
          dn: string,
          name: string
        ): Scope['branches'][number] => ({
          dn,
          read: true,
          write: true,
          delete: false,
          name,
          path: name,
        });
        const scope: Scope = {
          ...admin,
          branches: [
            branch(wanted, 'mojha.gov.mn'),
            branch(government, 'Government of Mongolia'),
            // Named twice, as two rules of the scope may.
            branch(government.toLowerCase(), 'Government of Mongolia'),
            branch(sales, 'Sales'),
          ],
        };
        const { root, calls } = await card(scope, server => {
          searched(government, 'gov', [
            domain('mojha.gov.mn'),
            domain('agency-0001.gov.mn'),
          ])(server);
          searched(sales, 'gov', [
            {
              dn: `ou=gov,${sales}`,
              ou: 'gov',
              twakeDepartmentPath: 'Sales / gov',
            },
          ])(server);
          children(government, domains)(server);
        });
        await claiming(root);
        const { body } = panelOf(root);
        const { input, results } = pickerOf(body);
        type(input, 'gov');
        await until(() => suggestions(results).length > 0);
        // Both answers, merged and sorted by path; mojha.gov.mn, a branch
        // of its own under another, searched once and offered once.
        expect(suggestions(results)).to.deep.equal([
          'Government of Mongolia / agency-0001.gov.mn',
          'Government of Mongolia / mojha.gov.mn',
          'Sales / gov',
        ]);
        expect(callsOf(calls, 'organizationSearchRead')).to.have.members([
          `organizationSearchRead(gov, ${government})`,
          `organizationSearchRead(gov, ${sales})`,
        ]);
        expect(callsOf(calls, 'organizationSearchRead')).to.have.length(2);
      });

      it('should say when the server answered only the first organizations found', async () => {
        const { root } = await card('admin', server => {
          searched(top, 'gov', [
            domain('agency-0001.gov.mn'),
            {
              dn: `more-organizations-${top}`,
              _isMoreIndicator: 'true',
              _totalCount: '1136',
              _displayedCount: '50',
            },
          ])(server);
          wide(server);
        });
        await claiming(root);
        const { body } = panelOf(root);
        const { input, results } = pickerOf(body);
        type(input, 'gov');
        await until(() => suggestions(results).length > 0);
        const cut =
          'Only the first organizations found are shown: type more of the name to find the others';
        expect(suggestions(results)).to.deep.equal([
          'Government of Mongolia / agency-0001.gov.mn',
        ]);
        expect(
          results.querySelector('[data-picker-cut]')?.textContent
        ).to.equal(cut);
        // Under the options, where the arrows never go: said as well.
        await until(
          () => root.querySelector('[data-announce]')?.textContent === cut
        );
      });

      it('should keep the panel and the choice, and say why, when the claim is refused', async () => {
        const { root, server } = await card('admin', server => {
          searched(top, 'moj', [domain('mojha.gov.mn')])(server);
          wide(server);
        });
        await claiming(root);
        const { body, panel } = panelOf(root);
        const { input, results } = pickerOf(body);
        type(input, 'moj');
        await until(() => suggestions(results).length > 0);
        press('Enter');
        server.post('/api/v1/ldap/users/bob/move').reply(403, forbidden);
        click(body, 'button[type="submit"]');
        await until(() => toast(root) !== '');
        expect(toast(root)).to.equal(
          'You do not administer Government of Mongolia / mojha.gov.mn: this change is not yours to make.'
        );
        expect(refused(root)).to.be.true;
        expect(panel.hidden).to.be.false;
        const submit = body.querySelector<HTMLButtonElement>(
          'button[type="submit"]'
        );
        await until(() => submit?.disabled === false);
        expect(submit?.textContent).to.equal('Claim into mojha.gov.mn');
      });

      it('should keep the select of the organizations walked on a server that cannot search the tree', async () => {
        const served = read<{
          features: { ldapOrganizations: { endpoints: { search?: string } } };
        }>('config.json');
        delete served.features.ldapOrganizations.endpoints.search;
        const { root, calls } = await card('admin', server => {
          server.get('/api/v1/config').reply(200, served);
          wide(server);
        });
        const button = root.querySelector<HTMLElement>(
          '[data-main] [data-claim]'
        );
        button?.focus();
        button?.click();
        // A walk of 200 organizations, one request each: given its time.
        for (let i = 0; i < 20 && panelOf(root).panel.hidden; i++)
          await until(() => !panelOf(root).panel.hidden).catch(() => undefined);
        const { body } = panelOf(root);
        expect(body.querySelector('[role="combobox"]')).to.equal(null);
        const shown = offered(body);
        // The walk's bound, as before: the transit branch left out.
        expect(shown).to.have.length(199);
        expect(shown.slice(0, 3)).to.deep.equal([
          'organization',
          'Government of Mongolia',
          'Government of Mongolia / agency-0000.gov.mn',
        ]);
        expect(shown).to.not.include('Government of Mongolia / mojha.gov.mn');
        expect(callsOf(calls, 'organizationSearchRead')).to.deep.equal([]);
      });
    });

    it('should open the card of an entry claimed from the Overview', async () => {
      const waiting = `/api/v1/ldap/organizations/${transit}/subnodes?objectClass=twakeAccount`;
      const { root, calls, server } = await mountConsole({
        scope: 'admin',
        answers: answer => {
          tree(answer);
          answer
            .get(uri => decodeURIComponent(uri) === waiting)
            .reply(200, [bob]);
        },
      });
      await until(() => !!root.querySelector('[data-transit-section]'));
      const row = root.querySelector<HTMLElement>(
        `[data-transit-section] [data-row-action="${String(bob.dn)}"]`
      );
      expect(row?.textContent).to.equal('Claim…');
      row?.focus();
      row?.click();
      await until(() => !panelOf(root).panel.hidden);
      const { title, body } = panelOf(root);
      expect(title.textContent).to.equal('Claim Bob Schneider');
      server.post('/api/v1/ldap/users/bob/move').reply(200, {});
      const counted = transitReads(calls);
      click(body, 'button[type="submit"]');
      // To its card, where its position and its groups wait to be put
      // right, and the banner counts transit again.
      await until(() => window.location.hash === '#/users/bob');
      expect(toast(root)).to.equal('Bob Schneider moved to organization');
      await until(() => transitReads(calls) > counted);
      await settled(root);
      expect(calls).to.include('get(users, bob)');
    });
  });
});
