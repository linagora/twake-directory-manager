/**
 * The deletions, mounted: an entry from its card, a selection from its
 * list, an organization from its card, each asked first in the panel
 * (src/actions/deletion.ts).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { expect } from 'chai';
import type nock from 'nock';

import type { Entry, Scope } from '../../src/types';
import { click, panelOf, until } from '../support/act';
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

const states = 'ou=twakeAccountStatus,ou=nomenclature,dc=example,dc=com';
const top = 'ou=organization,dc=example,dc=com';
const engineering = `ou=Engineering,${top}`;
const qa = `ou=QA Lab,${engineering}`;

/** The toast's message, or nothing while it is hidden. */
const toast = (root: HTMLElement): string => {
  const element = root.querySelector<HTMLElement>('[data-toast]');
  return element && !element.hidden ? (element.textContent ?? '') : '';
};

/** What the question in the panel asks, as the reader sees it. */
const asked = (
  root: HTMLElement
): {
  title: string;
  lines: string[];
  items: string[];
  action: string;
  alternative?: string;
} => {
  const { title, body } = panelOf(root);
  const texts = (selector: string): string[] =>
    Array.from(body.querySelectorAll(selector)).map(
      element => element.textContent ?? ''
    );
  return {
    title: title.textContent ?? '',
    lines: texts('[data-confirm-body] > p'),
    items: texts('.dc-confirm-items li'),
    action: body.querySelector('[data-confirm]')?.textContent ?? '',
    alternative:
      body.querySelector('[data-confirm-alternative]')?.textContent ??
      undefined,
  };
};

/** Wait for the question to be asked in the panel. */
const question = (root: HTMLElement): Promise<void> =>
  until(() => !!panelOf(root).body.querySelector('[data-confirm]'));

/** The calls of a method of the client. */
const callsOf = (calls: string[], method: string): string[] =>
  calls.filter(call => call.startsWith(`${method}(`));

/**
 * The groups' search an account without `memberOf` is looked for with,
 * answered: none found, or a refusal.
 */
const groupsSearch =
  (status: number, answer: object = {}) =>
  (server: nock.Scope): void => {
    server.get(/\/api\/v1\/ldap\/groups\?match=/).reply(status, answer);
  };

/** Alice's card, its Delete pressed, the question asked. */
const deleting = async (options: MountOptions = {}): Promise<Mounted> => {
  const mounted = await mountConsole({
    hash: 'users/alice',
    account: alice,
    ...options,
  });
  click(mounted.root, '[data-main] [data-delete]');
  await question(mounted.root);
  return mounted;
};

describe('actions/deletion', () => {
  describe('an entry from its card', () => {
    it('should name the person, the consequences and the way out before deleting an account', async () => {
      const { root, calls } = await mountConsole({
        hash: 'users/alice',
        account: alice,
      });
      const { dialog, body, title } = panelOf(root);
      root.querySelector<HTMLElement>('[data-main] [data-more]')?.focus();
      click(root, '[data-main] [data-delete]');
      await question(root);
      expect(asked(root)).to.deep.equal({
        title: 'Delete Alice Moreau?',
        lines: [
          'Alice Moreau · alice@example.com · Sales / France',
          'This cannot be undone. Alice Moreau will be removed from: all-staff, sales-team.',
        ],
        items: [],
        action: 'Delete Alice',
        alternative:
          'To stop access without deleting, set the state to Disabled instead.',
      });
      // Not reversible: the button says so, and the question is an alert.
      expect(
        body
          .querySelector('[data-confirm]')
          ?.classList.contains('dc-button-destructive')
      ).to.be.true;
      expect(dialog.getAttribute('role')).to.equal('alertdialog');
      // An Enter pressed out of habit deletes nothing.
      expect(document.activeElement).to.equal(
        body.querySelector('[data-cancel]')
      );
      // The way out opens the state change, Disabled picked, and deletes
      // nothing.
      click(body, '[data-confirm-alternative]');
      await until(() => !!body.querySelector('input[name="dc-state"]'));
      expect(title.textContent).to.equal('Change state — Alice Moreau');
      expect(
        body.querySelector<HTMLInputElement>('#dc-state-disabled')?.checked
      ).to.be.true;
      expect(callsOf(calls, 'remove')).to.deep.equal([]);
    });

    it('should not offer the way out to whom may not change the account', async () => {
      // Deletes, writes nowhere: the card offers Delete and no Edit.
      const admin = read<Scope>('scopes/admin.json');
      const scope: Scope = {
        ...admin,
        branches: admin.branches.map(branch => ({ ...branch, write: false })),
      };
      const { root } = await deleting({ scope });
      expect(root.querySelector('[data-main] [data-edit]')).to.equal(null);
      expect(asked(root).alternative).to.equal(undefined);
      expect(asked(root).action).to.equal('Delete Alice');
    });

    it('should not offer the way out to an account disabled already', async () => {
      const { root } = await deleting({
        account: {
          ...alice,
          twakeAccountStatus: `cn=disabled,${states}`,
          memberOf: [],
        },
        answers: groupsSearch(200),
      });
      expect(asked(root).alternative).to.equal(undefined);
      // In no group: nothing said of groups.
      expect(asked(root).lines[1]).to.equal('This cannot be undone.');
    });

    it('should say when an account’s groups could not be listed, and still delete it', async () => {
      // Without `memberOf`, they are searched among the groups: a refusal
      // read as none said nothing about groups (#157).
      const { root, calls, server } = await deleting({
        account: { ...alice, memberOf: [] },
        answers: groupsSearch(403, forbidden),
      });
      // Searched strictly: one group entity unsearched fails them all.
      expect(
        callsOf(calls, 'memberships').filter(call => call.endsWith(', true)'))
      ).to.have.length(1);
      expect(asked(root).lines[1]).to.equal(
        'This cannot be undone. The groups Alice Moreau belongs to could not be listed.'
      );
      expect(asked(root).action).to.equal('Delete Alice');
      server.delete('/api/v1/ldap/users/alice').reply(200, {});
      click(panelOf(root).body, '[data-confirm]');
      await until(() => toast(root) !== '');
      expect(callsOf(calls, 'remove')).to.deep.equal(['remove(users, alice)']);
      expect(toast(root)).to.equal('Deleted');
      expect(panelOf(root).panel.hidden).to.be.true;
      // Gone: its list takes its place.
      await until(() => window.location.hash === '#/users');
    });

    it('should say so in French when the search of the groups fails', async () => {
      const { root } = await deleting({
        language: 'fr',
        account: { ...alice, memberOf: [] },
        answers: groupsSearch(500, { error: 'Internal Server Error' }),
      });
      expect(asked(root).lines[1]).to.include(
        'Les groupes de Alice Moreau n’ont pas pu être listés.'
      );
    });

    it('should say nothing of groups for an account in none, and delete it', async () => {
      const { root, calls, server } = await deleting({
        account: { ...alice, memberOf: [] },
        answers: groupsSearch(200),
      });
      expect(asked(root).lines).to.deep.equal([
        'Alice Moreau · alice@example.com · Sales / France',
        'This cannot be undone.',
      ]);
      server.delete('/api/v1/ldap/users/alice').reply(200, {});
      click(panelOf(root).body, '[data-confirm]');
      await until(() => toast(root) === 'Deleted');
      expect(callsOf(calls, 'remove')).to.deep.equal(['remove(users, alice)']);
    });

    it('should keep the card and say why when the server refuses', async () => {
      const { root, calls, server } = await deleting();
      server.delete('/api/v1/ldap/users/alice').reply(403, forbidden);
      click(panelOf(root).body, '[data-confirm]');
      await until(() => toast(root) !== '');
      expect(callsOf(calls, 'remove')).to.deep.equal(['remove(users, alice)']);
      // A refusal of rights names the account as the question did.
      expect(toast(root)).to.equal(
        'You do not administer Alice Moreau: this change is not yours to make.'
      );
      expect(
        root.querySelector('[data-toast]')?.classList.contains('dc-toast-error')
      ).to.be.true;
      expect(window.location.hash).to.equal('#/users/alice');
    });

    it('should say a deleted group leaves its members', async () => {
      const { root, calls } = await mountConsole({
        hash: 'groups/sales-team',
        language: 'fr',
        answers: server => {
          server.get('/api/v1/ldap/groups/sales-team').reply(200, {
            dn: 'cn=sales-team,ou=groups,dc=example,dc=com',
            cn: 'sales-team',
            // Attached to nothing, a group would be in transit, and nobody's.
            twakeDepartmentLink: `ou=Sales,${top}`,
            member: [
              'uid=a,ou=users,dc=example,dc=com',
              'uid=b,ou=users,dc=example,dc=com',
              'uid=c,ou=users,dc=example,dc=com',
              // groupOfNames needs a member: an empty one stands for none.
              '',
            ],
          });
        },
      });
      click(root, '[data-main] [data-delete]');
      await question(root);
      expect(asked(root)).to.deep.equal({
        title: 'Supprimer sales-team ?',
        lines: [
          'Ses 3 membres restent dans l’annuaire ; seul le groupe disparaît.',
          'Cette action est irréversible.',
        ],
        items: [],
        action: 'Supprimer le groupe',
        alternative: undefined,
      });
      // Declined: nothing goes.
      click(panelOf(root).body, '[data-cancel]');
      expect(panelOf(root).panel.hidden).to.be.true;
      expect(callsOf(calls, 'remove')).to.deep.equal([]);
    });

    it('should name a nomenclature entry as its card does', async () => {
      // A server without the scope plugin: reference data is written.
      const named = async (id: string): Promise<string[]> => {
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
        click(mounted.root, '[data-main] [data-delete]');
        await question(mounted.root);
        const { title, action } = asked(mounted.root);
        mounted.unmount();
        return [title, action];
      };
      expect(await named('teamMailbox')).to.deep.equal([
        'Supprimer Boîte partagée ?',
        'Supprimer Boîte partagée',
      ]);
      // A value the schema does not name keeps its own.
      expect(await named('archive')).to.deep.equal([
        'Supprimer archive ?',
        'Supprimer archive',
      ]);
    });

    it('should explain a refused deletion of an entry still pointed at', async () => {
      const { root, server } = await mountConsole({
        hash: `positions/${encodeURIComponent('Sales Manager')}`,
        scope: null,
        language: 'fr',
        answers: answer => {
          answer.get('/api/v1/ldap/positions/Sales%20Manager').reply(200, {
            dn: 'cn=Sales Manager,ou=positions,dc=example,dc=com',
            cn: 'Sales Manager',
          });
        },
      });
      click(root, '[data-main] [data-delete]');
      await question(root);
      server.delete('/api/v1/ldap/positions/Sales%20Manager').reply(409, {
        error:
          'Cannot delete cn=Sales Manager,ou=positions,dc=example,dc=com: still referenced by another entry (title)',
      });
      click(panelOf(root).body, '[data-confirm]');
      await until(() => toast(root) !== '');
      // The pointer named by the field landing in the branch: Position.
      expect(toast(root)).to.equal(
        'Sales Manager est encore utilisé par des entrées (Poste) : modifiez-les d’abord'
      );
    });
  });

  describe('a selection from its list', () => {
    /** The list of users, every account listed, these selected. */
    const selecting = async (
      ids: string[],
      options: MountOptions = {}
    ): Promise<Mounted> => {
      const mounted = await mountConsole({
        hash: 'users',
        language: 'fr',
        ...options,
      });
      const { root, server } = mounted;
      server
        .get(/\/api\/v1\/ldap\/users\?/)
        .reply(
          200,
          Object.fromEntries(
            ids.map(id => [
              id,
              { dn: `uid=${id},ou=users,dc=example,dc=com`, uid: id },
            ])
          )
        );
      click(root, '[data-main] [data-list-all]');
      await settled(root);
      for (const id of ids) click(root, `[data-select="${id}"]`);
      return mounted;
    };

    /** How many times the list was read. */
    const reads = (calls: string[]): number =>
      calls.filter(call => call.startsWith('listBounded(users')).length;

    it('should name the first few, and delete nothing on Cancel', async () => {
      const ids = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
      const { root, calls } = await selecting(ids);
      const button = root.querySelector<HTMLElement>(
        '[data-main] [data-delete-selected]'
      );
      button?.focus();
      click(root, '[data-main] [data-delete-selected]');
      await question(root);
      expect(asked(root)).to.deep.equal({
        title: 'Supprimer 7 entrées ?',
        lines: ['Cette action est irréversible.'],
        items: ['a', 'b', 'c', 'd', 'e', 'et 2 de plus'],
        action: 'Supprimer 7 entrées',
        alternative: undefined,
      });
      click(panelOf(root).body, '[data-cancel]');
      await settled(root);
      // Cancelled, nothing went: the list is not read again, its selection
      // and the focus left as they were.
      expect(callsOf(calls, 'remove')).to.deep.equal([]);
      expect(reads(calls)).to.equal(1);
      expect(root.querySelector<HTMLElement>('[data-main] .dc-bulk')?.hidden).to
        .be.false;
      expect(document.activeElement).to.equal(button);
    });

    it('should count one entry in the singular', async () => {
      const { root } = await selecting(['a']);
      click(root, '[data-main] [data-delete-selected]');
      await question(root);
      expect(asked(root)).to.deep.equal({
        title: 'Supprimer 1 entrée ?',
        lines: ['Cette action est irréversible.'],
        items: ['a'],
        action: 'Supprimer 1 entrée',
        alternative: undefined,
      });
    });

    it('should say each refusal on its own, and read the list again once one went', async () => {
      const ids = ['Sales Manager', 'Intern', 'Trainee', 'Clerk'];
      const { root, calls, server } = await mountConsole({
        hash: 'positions',
        scope: null,
        language: 'fr',
        answers: answer => {
          answer
            .get(/\/api\/v1\/ldap\/positions(\?.*)?$/)
            .reply(
              200,
              Object.fromEntries(
                ids.map(id => [
                  id,
                  { dn: `cn=${id},ou=positions,dc=example,dc=com`, cn: id },
                ])
              )
            );
        },
      });
      await settled(root);
      const listed = (): number =>
        calls.filter(call => /^list(Bounded)?\(positions/.test(call)).length;
      const before = listed();
      for (const id of ids) click(root, `[data-select="${id}"]`);
      click(root, '[data-main] [data-delete-selected]');
      await question(root);
      server.delete('/api/v1/ldap/positions/Sales%20Manager').reply(409, {
        error:
          'Cannot delete cn=Sales Manager,ou=positions,dc=example,dc=com: still referenced by another entry (title)',
      });
      server.delete('/api/v1/ldap/positions/Intern').reply(403, forbidden);
      server
        .delete('/api/v1/ldap/positions/Trainee')
        .reply(400, { error: 'Not allowed' });
      server.delete('/api/v1/ldap/positions/Clerk').reply(200, {});
      click(panelOf(root).body, '[data-confirm]');
      await until(() => toast(root) !== '');
      // Each refusal in the console's words, the entry named once.
      expect(toast(root)).to.equal(
        'Sales Manager est encore utilisé par des entrées (Poste) : modifiez-les d’abord · ' +
          'Vous n’administrez pas Intern : cette modification ne vous revient pas. · ' +
          'Trainee : Le serveur a refusé : Not allowed'
      );
      expect(callsOf(calls, 'remove')).to.have.length(4);
      // One went: the list is read again.
      await until(() => listed() > before);
    });
  });

  describe('an organization from its card', () => {
    /**
     * The organizations page on QA Lab, the tree read down to it, QA Lab
     * answered as given.
     */
    const organization = async (
      entry: Entry,
      language = 'en'
    ): Promise<Mounted> => {
      const subnodes = (dn: string): ((uri: string) => boolean) => {
        const path = `/api/v1/ldap/organizations/${dn}/subnodes?objectClass=organizationalUnit`;
        return uri => decodeURIComponent(uri) === path;
      };
      const mounted = await mountConsole({
        hash: `organizations/${encodeURIComponent(qa)}`,
        language,
        answers: server => {
          server
            .get('/api/v1/ldap/organizations/top')
            .reply(200, { dn: top, ou: 'organization' });
          server
            .get(subnodes(top))
            .reply(200, [{ dn: engineering, ou: 'Engineering' }]);
          server
            .get(subnodes(engineering))
            .reply(200, [{ dn: qa, ou: 'QA Lab' }]);
          server.get(subnodes(qa)).reply(200, []);
          server
            .get(
              uri =>
                decodeURIComponent(uri) === `/api/v1/ldap/organizations/${qa}`
            )
            .reply(200, entry);
          server
            .get(
              uri =>
                decodeURIComponent(uri) ===
                `/api/v1/ldap/organizations/${engineering}`
            )
            .reply(200, { dn: engineering, ou: 'Engineering' });
        },
      });
      await until(
        () =>
          !!mounted.root.querySelector(
            '[data-org-detail] h1, [data-org-detail] h2'
          )
      );
      return mounted;
    };

    /** The node the tree draws as selected. */
    const selected = (root: HTMLElement): string | undefined =>
      root.querySelector<HTMLElement>(
        '[data-tree] .dc-selected > .dc-tree-row [data-select]'
      )?.dataset.select;

    it('should ask by its path, and delete nothing when declined', async () => {
      const { root, calls } = await organization({
        dn: qa,
        ou: 'QA Lab',
        twakeDepartmentPath: 'Engineering / QA Lab',
      });
      click(root, '[data-org-detail] [data-delete]');
      await question(root);
      expect(asked(root)).to.deep.equal({
        title: 'Delete Engineering / QA Lab?',
        lines: ['This cannot be undone.'],
        items: [],
        action: 'Delete organization',
        alternative: undefined,
      });
      click(panelOf(root).body, '[data-cancel]');
      expect(panelOf(root).panel.hidden).to.be.true;
      expect(callsOf(calls, 'deleteOrganization')).to.deep.equal([]);
    });

    it('should name an organization with no path by its own name, not its DN', async () => {
      const { root } = await organization({ dn: qa });
      click(root, '[data-org-detail] [data-delete]');
      await question(root);
      expect(asked(root).title).to.equal('Delete QA Lab?');
    });

    it('should select the parent of an organization just deleted', async () => {
      const { root, calls, server } = await organization({
        dn: qa,
        ou: 'QA Lab',
      });
      expect(selected(root)).to.equal(qa);
      const steps = window.history.length;
      click(root, '[data-org-detail] [data-delete]');
      await question(root);
      server
        .delete(
          uri => decodeURIComponent(uri) === `/api/v1/ldap/organizations/${qa}`
        )
        .reply(200, {});
      const reads = callsOf(calls, 'organization').length;
      const listed = callsOf(calls, 'organizationChildren').length;
      click(panelOf(root).body, '[data-confirm]');
      await until(() => toast(root) === 'Deleted');
      await until(() => selected(root) === engineering);
      expect(callsOf(calls, 'deleteOrganization')).to.deep.equal([
        `deleteOrganization(${qa})`,
      ]);
      // Its address replaced: Back could only lead to a page now gone.
      expect(window.location.hash).to.equal(
        `#/organizations/${encodeURIComponent(engineering)}`
      );
      expect(window.history.length).to.equal(steps);
      // Its parent read again, for the organization gone from it, and shown:
      // counted from the deletion, the tree having read it once already.
      expect(callsOf(calls, 'organizationChildren').slice(listed)).to.include(
        `organizationChildren(${engineering})`
      );
      // Only it is read. happy-dom tells a `replaceState` as a change of
      // hash, which a browser does not: on its own timer, the page may be
      // drawn, and its card read, once more.
      expect(callsOf(calls, 'organization').slice(reads)).to.include(
        `organization(${engineering})`
      );
      expect(
        callsOf(calls, 'organization')
          .slice(reads)
          .filter(call => call !== `organization(${engineering})`)
      ).to.deep.equal([]);
    });

    it('should explain a refused deletion of a non-empty organization', async () => {
      const { root, server } = await organization({ dn: qa }, 'fr');
      click(root, '[data-org-detail] [data-delete]');
      await question(root);
      server
        .delete(
          uri => decodeURIComponent(uri) === `/api/v1/ldap/organizations/${qa}`
        )
        .reply(409, { error: `Entry ${qa} is not empty` });
      click(panelOf(root).body, '[data-confirm]');
      await until(() => toast(root) !== '');
      expect(toast(root)).to.equal(
        'QA Lab n’est pas vide : déplacez ou supprimez d’abord ses entrées'
      );
    });
  });
});
