/**
 * The change of an account's state, mounted: the panel of its card, the one
 * the deletion's way out opens, and Change state… on a list's selection
 * (src/actions/state.ts).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { expect } from 'chai';
import type nock from 'nock';

import type { Entry } from '../../src/types';
import { click, gate, panelOf, press, until } from '../support/act';
import {
  mountConsole,
  settled,
  type Mounted,
  type MountOptions,
} from '../support/mount';

const FIXTURES = join(__dirname, '..', 'fixtures');

/** Alice's entry, as the ldap-rest tested answers it: Active. */
const alice = (
  JSON.parse(
    readFileSync(join(FIXTURES, 'contract', 'users-alice.json'), 'utf8')
  ) as { body: Entry }
).body;

const states = 'ou=twakeAccountStatus,ou=nomenclature,dc=example,dc=com';
const sales = 'ou=Sales,ou=organization,dc=example,dc=com';

/** Alice in another state, or in none: a dangling value is left out. */
const aliceIn = (state?: string): Entry => {
  const entry: Entry = { ...alice };
  delete entry.twakeAccountStatus;
  return state
    ? { ...entry, twakeAccountStatus: `cn=${state},${states}` }
    : entry;
};

/** The toast's message, or nothing while it is hidden. */
const toast = (root: HTMLElement): string => {
  const element = root.querySelector<HTMLElement>('[data-toast]');
  return element && !element.hidden ? (element.textContent ?? '') : '';
};

/** Pick a state in the panel, as a click on its radio does. */
const pick = (body: HTMLElement, state: string): void =>
  click(body, `#dc-state-${state}`);

/**
 * Alice's card, and the panel its Change state… opens, once the
 * descriptions of the states are read.
 */
const card = async (
  options: Partial<MountOptions> = {}
): Promise<Mounted & ReturnType<typeof panelOf>> => {
  const mounted = await mountConsole({
    hash: 'users/alice',
    account: alice,
    ...options,
  });
  const parts = panelOf(mounted.root);
  click(mounted.root, '[data-main] [data-status]');
  await until(() => !parts.panel.hidden);
  return { ...mounted, ...parts };
};

/** The submit button of the panel. */
const submitOf = (body: HTMLElement): HTMLButtonElement => {
  const found = body.querySelector<HTMLButtonElement>('button[type="submit"]');
  if (!found) throw new Error('no submit');
  return found;
};

describe('actions/state', () => {
  describe('from the card', () => {
    it('should show the current state and offer the others, explained', async () => {
      const { title, body } = await card();
      expect(title.textContent).to.equal('Change state — Alice Moreau');
      expect(body.querySelector('[data-current-state]')?.textContent).to.equal(
        'Current state: Active'
      );
      expect(body.querySelector('input[value="disabled"]')).to.not.equal(null);
      expect(body.querySelector('input[value="enabled"]')).to.equal(null);
      expect(
        body.querySelector('#dc-state-disabled-help')?.textContent
      ).to.equal('Suspended, during a long absence for instance.');
    });

    it('should explain a state in the deployment’s own words first', async () => {
      // The reference entry a state points at says what it means here.
      const { body, calls } = await card({
        answers: (server: nock.Scope) => {
          server.get(/\/api\/v1\/ldap\/accountStatuses(\?.*)?$/).reply(200, {
            disabled: {
              dn: `cn=disabled,${states}`,
              cn: 'disabled',
              description: '  Suspended by HR.  ',
            },
            noaccess: { dn: `cn=noaccess,${states}`, cn: 'noaccess' },
          });
        },
      });
      expect(calls).to.include('list(accountStatuses)');
      expect(
        body.querySelector('#dc-state-disabled-help')?.textContent
      ).to.equal('Suspended by HR.');
      // One the entry does not describe keeps the catalogue's words.
      expect(
        body.querySelector('#dc-state-noAccess-help')?.textContent
      ).to.equal('Kept in the directory, with no access to the services.');
    });

    it('should translate the states it knows and keep the ones it does not', async () => {
      // A deployment of its own: Disabled, and a state it invented.
      const config = JSON.parse(
        readFileSync(join(FIXTURES, 'config.json'), 'utf8')
      ) as {
        features: {
          ldapFlatGeneric: {
            flatResources: {
              schema: {
                attributes: Record<string, { states?: Record<string, string> }>;
              };
            }[];
          };
        };
      };
      config.features.ldapFlatGeneric.flatResources[0].schema.attributes.twakeAccountStatus.states =
        {
          disabled: `cn=disabled,${states}`,
          seconded: `cn=seconded,${states}`,
        };
      const { body } = await card({
        language: 'fr',
        account: aliceIn(),
        answers: (server: nock.Scope) => {
          server.get('/api/v1/config').reply(200, config);
        },
      });
      // A state not stored is no current state.
      expect(body.querySelector('[data-current-state]')).to.equal(null);
      expect(
        body.querySelector('label[for="dc-state-disabled"]')?.textContent
      ).to.equal('Désactivé');
      expect(
        body.querySelector('#dc-state-disabled-help')?.textContent
      ).to.equal('Suspendu, pendant une longue absence par exemple.');
      // A state the deployment invented keeps the name the deployment gave
      // it, with no explanation the catalogue would have to invent, and a
      // button that says what it does in general terms.
      expect(
        body.querySelector('label[for="dc-state-seconded"]')?.textContent
      ).to.equal('seconded');
      expect(body.querySelector('#dc-state-seconded-help')).to.equal(null);
      const submit = submitOf(body);
      pick(body, 'seconded');
      expect(submit.textContent).to.equal('Changer l’état');
      pick(body, 'disabled');
      expect(submit.textContent).to.equal('Désactiver');
    });

    it('should write nothing until the button naming the choice is pressed', async () => {
      const { root, body, panel, calls, server } = await card();
      const submit = submitOf(body);
      expect(submit.disabled).to.equal(true);
      expect(submit.textContent).to.equal('Change state');
      pick(body, 'disabled');
      expect(submit.disabled).to.equal(false);
      expect(submit.textContent).to.equal('Disable');
      expect(toast(root)).to.equal('');
      expect(calls.some(call => call.startsWith('setStatus'))).to.be.false;

      server
        .post('/api/v1/ldap/users/alice/status', { state: 'disabled' })
        .reply(200, {});
      const reads = calls.filter(call => call === 'get(users, alice)').length;
      click(body, 'button[type="submit"]');
      await until(() => panel.hidden);
      expect(calls).to.include('setStatus(users, alice, disabled)');
      expect(toast(root)).to.equal('Alice Moreau is now Disabled');
      // The card is drawn again, to show the state written.
      await settled(root);
      expect(
        calls.filter(call => call === 'get(users, alice)').length
      ).to.equal(reads + 1);
    });

    it('should name the account and the state in the interface language', async () => {
      const { root, body, panel, calls, server } = await card({
        language: 'fr',
        account: aliceIn('disabled'),
      });
      pick(body, 'enabled');
      server
        .post('/api/v1/ldap/users/alice/status', { state: 'enabled' })
        .reply(200, {});
      click(body, 'button[type="submit"]');
      await until(() => panel.hidden);
      expect(calls).to.include('setStatus(users, alice, enabled)');
      expect(toast(root)).to.equal('Alice Moreau est désormais Actif');
    });

    it('should keep the panel and say why when the server refuses', async () => {
      const { root, body, panel, server } = await card();
      server
        .post('/api/v1/ldap/users/alice/status')
        .reply(403, { error: 'Forbidden' });
      pick(body, 'disabled');
      click(body, 'button[type="submit"]');
      await until(() => toast(root) !== '');
      expect(toast(root)).to.equal('The server refused: Forbidden');
      expect(panel.hidden).to.be.false;
    });

    it('should open on Disabled, focused, from the deletion’s way out', async () => {
      // Not the first state offered: the focus is the action's, not the
      // panel's own.
      const { root, calls } = await mountConsole({
        hash: 'users/alice',
        account: aliceIn('noaccess'),
      });
      const { panel, body } = panelOf(root);
      click(root, '[data-main] [data-delete]');
      await until(() => !!body.querySelector('[data-confirm-alternative]'));
      click(body, '[data-confirm-alternative]');
      await until(() => !!body.querySelector('input[name="dc-state"]'));
      expect(panel.hidden).to.be.false;
      const offered = Array.from(
        body.querySelectorAll<HTMLInputElement>('input[name="dc-state"]')
      ).map(radio => radio.value);
      expect(offered[0]).to.equal('enabled');
      const disabled =
        body.querySelector<HTMLInputElement>('#dc-state-disabled');
      expect(disabled?.checked).to.be.true;
      expect(document.activeElement).to.equal(disabled);
      // Picked, but written only by the button.
      expect(submitOf(body).disabled).to.be.false;
      expect(submitOf(body).textContent).to.equal('Disable');
      expect(calls.some(call => call.startsWith('setStatus'))).to.be.false;
      expect(calls.some(call => call.startsWith('delete'))).to.be.false;
    });
  });

  describe('on a selection of accounts', () => {
    /** An account of Sales, which Sophie Martin administers. */
    const account = (uid: string, name: string, branch = sales): Entry => ({
      dn: `uid=${uid},ou=users,dc=example,dc=com`,
      uid,
      displayName: name,
      twakeDepartmentLink: branch,
    });

    /**
     * The list of users, as Sophie Martin sees it, with these accounts
     * selected and Change state… pressed.
     */
    const selection = async (
      accounts: Record<string, Entry>,
      language = 'en'
    ): Promise<Mounted & ReturnType<typeof panelOf>> => {
      const mounted = await mountConsole({
        hash: 'users',
        scope: 'sophie.martin',
        language,
      });
      const { root, server } = mounted;
      server.get(/\/api\/v1\/ldap\/users\?/).reply(200, accounts);
      click(root, '[data-main] [data-list-all]');
      await settled(root);
      for (const uid of Object.keys(accounts))
        click(root, `[data-select="${uid}"]`);
      const parts = panelOf(root);
      click(root, '[data-main] [data-bulk-action="1"]');
      await until(() => !parts.panel.hidden);
      return { ...mounted, ...parts };
    };

    /** How many times the list was read. */
    const reads = (calls: string[]): number =>
      calls.filter(call => call.startsWith('listBounded(users')).length;

    it('should move each account to the state, list those refused, and hold its panel meanwhile', async () => {
      const held = gate();
      const asked: string[] = [];
      const mounted = await selection({
        alice: account('alice', 'Alice Martin'),
        bob: account('bob', 'Bob Durand'),
        carol: account('carol', 'Carol <b>Diaz</b>'),
        // In a branch Sophie only reads: left out.
        dave: account(
          'dave',
          'Dave Petit',
          'ou=Engineering,ou=organization,dc=example,dc=com'
        ),
      });
      const { root, body, panel, title, server, calls } = mounted;
      server
        .post(/\/api\/v1\/ldap\/users\/[^/]+\/status$/)
        .reply(async (uri, sent) => {
          const id = uri.split('/').slice(-2)[0];
          asked.push(`${id} ${(sent as { state: string }).state}`);
          if (id === 'alice') await held.opened;
          return id === 'carol' ? [403, { error: 'Forbidden' }] : [200, {}];
        });
      expect(title.textContent).to.equal('Change state — 3 accounts');
      expect(body.textContent).to.include(
        '1 account you do not administer is left out.'
      );
      const submit = submitOf(body);
      const cancel = body.querySelector<HTMLButtonElement>('[data-cancel]');
      pick(body, 'disabled');
      click(body, 'button[type="submit"]');
      // A second press, or another state picked, sends nothing more.
      const enabled = body.querySelector<HTMLInputElement>('#dc-state-enabled');
      if (enabled) {
        enabled.checked = true;
        enabled.dispatchEvent(new Event('change', { bubbles: true }));
      }
      body.querySelector('form')?.requestSubmit();
      expect(submit.disabled).to.equal(true);
      expect(submit.textContent).to.equal('Disable');
      expect(cancel?.disabled).to.equal(true);
      expect(
        body.querySelector('[data-bulk-progress] [role="status"]')?.textContent
      ).to.equal('0 of 3 accounts');
      // Escape while it runs: the panel stays, the work going on in it.
      press('Escape');
      expect(panel.hidden).to.equal(false);
      held.open();
      await until(() => !!body.querySelector('[data-close]'));
      expect(asked).to.deep.equal([
        'alice disabled',
        'bob disabled',
        'carol disabled',
      ]);
      expect(toast(root)).to.equal('2 accounts are now Disabled');
      expect(body.textContent).to.include('1 account was refused:');
      // The one left out is still said beside them.
      expect(body.textContent).to.include(
        '1 account you do not administer is left out.'
      );
      const refused = body.querySelectorAll('.dc-confirm-items li');
      expect(refused).to.have.length(1);
      expect(refused[0].textContent).to.equal(
        'Carol <b>Diaz</b>: The server refused: Forbidden'
      );
      expect(refused[0].querySelector('b')).to.equal(null);
      // Settled once its panel is closed, not before: the list is read
      // again then, its selection gone.
      expect(reads(calls)).to.equal(1);
      click(body, '[data-close]');
      expect(panel.hidden).to.be.true;
      await until(() => reads(calls) === 2);
      await settled(root);
      expect(root.querySelector<HTMLElement>('[data-main] .dc-bulk')?.hidden).to
        .be.true;
    });

    it('should count one account in the singular, and not write over a panel opened since', async () => {
      const held = gate();
      const mounted = await selection(
        { alice: account('alice', 'Alice Martin') },
        'fr'
      );
      const { root, body, panel, title, server, calls } = mounted;
      server.post('/api/v1/ldap/users/alice/status').reply(async () => {
        await held.opened;
        return [200, {}];
      });
      expect(title.textContent).to.equal('Changer l’état — 1 compte');
      pick(body, 'disabled');
      click(body, 'button[type="submit"]');
      expect(
        body.querySelector('[data-bulk-progress] [role="status"]')?.textContent
      ).to.equal('0 sur 1 compte');
      // Another panel replaces it: the work ends, then settles it.
      click(root, '[data-main] [data-new]');
      await until(() => !!body.querySelector('[name="sn"]'));
      const other = title.textContent;
      expect(other).to.not.equal('Changer l’état — 1 compte');
      expect(reads(calls)).to.equal(1);
      held.open();
      await until(() => toast(root) !== '');
      expect(toast(root)).to.match(/^1 compte est maintenant /);
      await until(() => reads(calls) === 2);
      // The new user's form is left as it was.
      expect(panel.hidden).to.be.false;
      expect(title.textContent).to.equal(other);
      expect(body.querySelector('[data-bulk-progress]')).to.equal(null);
      expect(body.querySelector('.dc-confirm-items')).to.equal(null);
      expect(body.querySelector('[name="sn"]')).to.not.equal(null);
    });

    it('should hold its panel through a page left while it works, then close it', async () => {
      const held = gate();
      const mounted = await selection({
        alice: account('alice', 'Alice Martin'),
      });
      const { root, body, panel, server, calls } = mounted;
      server.post('/api/v1/ldap/users/alice/status').reply(async () => {
        await held.opened;
        return [200, {}];
      });
      server.get(/\/api\/v1\/ldap\/groups\?/).reply(200, {});
      pick(body, 'disabled');
      click(body, 'button[type="submit"]');
      // The address changes while the work runs: a page left closes a form,
      // not work under way, whose guard holds the panel over the new page.
      window.location.hash = '#/groups';
      await settled(root);
      expect(window.location.hash).to.equal('#/groups');
      expect(panel.hidden).to.be.false;
      expect(
        body.querySelector('[data-bulk-progress] [role="status"]')?.textContent
      ).to.equal('0 of 1 account');
      // Done, it says so and closes, the page reached left as it is.
      held.open();
      await until(() => toast(root) !== '');
      expect(toast(root)).to.match(/^1 account is now /);
      expect(calls).to.include('setStatus(users, alice, disabled)');
      await until(() => panel.hidden);
      expect(window.location.hash).to.equal('#/groups');
      expect(root.querySelector('[data-main] [data-bulk-progress]')).to.equal(
        null
      );
    });
  });
});
