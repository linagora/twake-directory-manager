/**
 * Passwords, mounted: Reset password on an account's card, and the password
 * generated for an account created without one, both shown once in the
 * panel that asked for them (src/actions/passwords.ts).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { expect } from 'chai';
import type nock from 'nock';

import type { Entry } from '../../src/types';
import { click, gate, panelOf, press, type, until } from '../support/act';
import { mountConsole, settled, type Mounted } from '../support/mount';

/** Alice's entry, as the ldap-rest tested answers it. */
const alice = (
  JSON.parse(
    readFileSync(
      join(__dirname, '..', 'fixtures', 'contract', 'users-alice.json'),
      'utf8'
    )
  ) as { body: Entry }
).body;

const top = 'ou=organization,dc=example,dc=com';
/** The organization tree the department picker searches, before the mount's empty one. */
const tree = (server: nock.Scope): void => {
  server
    .get('/api/v1/ldap/organizations/top')
    .reply(200, { dn: top, ou: 'organization' });
  server
    .get(/\/api\/v1\/ldap\/organizations\/[^/]+\/search\?q=/)
    .reply(200, [
      { dn: `ou=Sales,${top}`, ou: 'Sales', twakeDepartmentPath: 'Sales' },
    ]);
};

/** What the server answers a creation and the password asked after it. */
interface Answers {
  /** The entry created, as the server answers it: Hélène by default */
  created?: object;
  /** The password's answer: a generated one by default */
  password?: [number, object];
  /** What the form holds besides her name, typed before it is sent */
  fill?(body: HTMLElement): void;
}

/**
 * Create Hélène from the list's New user, with no password: the server
 * generates one, which the console shows before her card.
 *
 * @param mounted the console, on the list of users
 * @param held what the creation's answer waits for, when it is held back
 * @param answers what the server answers, when not the default
 * @returns once the password is answered, which the page may not show yet
 */
const create = async (
  { root, server, idle }: Mounted,
  held?: Promise<void>,
  answers: Answers = {}
): Promise<{ answered: Promise<void> }> => {
  let answer = (): void => undefined;
  const answered = new Promise<void>(resolve => (answer = resolve));
  server.post('/api/v1/ldap/users').reply(async () => {
    await held;
    return [200, answers.created ?? { uid: 'helene' }];
  });
  server.post('/api/v1/ldap/users/helene/password').reply(() => {
    answer();
    return answers.password ?? [200, { generated: true, password: 's3cret' }];
  });
  click(root, '[data-main] [data-new]');
  await settled(root);
  const { body } = panelOf(root);
  const field = (name: string) =>
    body.querySelector<HTMLInputElement>(`[name="${name}"]`);
  type(field('employeeNumber'), 'E0099');
  type(field('sn'), 'Lefèvre');
  type(field('givenName'), 'Hélène');
  type(field('displayName'), 'Hélène Lefèvre');
  type(field('mail'), 'helene@example.com');
  answers.fill?.(body);
  type(
    body.querySelector<HTMLInputElement>('#dc-field-twakeDepartmentLink'),
    'Sal'
  );
  await until(() => !!body.querySelector('[data-candidate="0"]'));
  // The first match is the active one: Enter takes it, as the reader does.
  press('Enter');
  click(body, 'button[type="submit"]');
  // Read by the console once nock has answered it: what it does with the
  // password shows nothing on the page while another panel is open.
  return { answered: answered.then(idle) };
};

/** The toast's message, or nothing while it is hidden. */
const toast = (root: HTMLElement): string => {
  const element = root.querySelector<HTMLElement>('[data-toast]');
  return element && !element.hidden ? (element.textContent ?? '') : '';
};

/** How many resets the console asked of its client. */
const resets = (calls: string[]): string[] =>
  calls.filter(call => call.startsWith('resetPassword'));

describe('actions/passwords', () => {
  describe('a generated password', () => {
    /**
     * Alice's card, its Reset password panel open, and the server answering
     * a reset with this.
     *
     * @param reply what the server answers each reset, in turn
     */
    const card = async (
      reply: (sent: {
        password?: string;
        forceChange?: boolean;
      }) => Promise<[number, object]> | [number, object] = () => [
        200,
        { generated: true, password: 's3cret!<x>' },
      ]
    ) => {
      const mounted = await mountConsole({
        hash: 'users/alice',
        account: alice,
      });
      const { root, server } = mounted;
      server
        .post('/api/v1/ldap/users/alice/password')
        .reply((_uri, sent) => reply(sent as { password?: string }));
      click(root, '[data-main] [data-password]');
      const parts = panelOf(root);
      const send = parts.body.querySelector<HTMLButtonElement>(
        'button[type="submit"]'
      );
      if (!send) throw new Error('no Reset password button');
      return { ...mounted, ...parts, send };
    };

    /** Send the panel, the password typed first if any. */
    const submit = (
      { body, send }: { body: HTMLElement; send: HTMLButtonElement },
      typed = ''
    ): void => {
      if (typed)
        type(body.querySelector<HTMLInputElement>('#dc-new-password'), typed);
      // On the button, as a reader who pressed it: the focus is then not
      // where the console puts it next.
      send.focus();
      send.click();
    };

    /** The generated password's field, once the panel shows it. */
    const shown = async (body: HTMLElement): Promise<HTMLInputElement> => {
      await until(() => !!body.querySelector('#dc-generated-password'));
      return body.querySelector<HTMLInputElement>(
        '#dc-generated-password'
      ) as HTMLInputElement;
    };

    it('should stay in the panel, never in a toast', async () => {
      // In a toast, the click that began selecting it dismissed it for good.
      const reset = await card();
      const { root, body, panel, title } = reset;
      submit(reset);
      const field = await shown(body);
      expect(panel.hidden).to.be.false;
      expect(toast(root)).to.equal('');
      expect(title.textContent).to.equal('New password — alice');
      expect(field.readOnly).to.be.true;
      // Escaped: the password is the field's value, no markup of its own.
      expect(field.value).to.equal('s3cret!<x>');
      expect(body.querySelector('x')).to.equal(null);
      expect(body.querySelector('[data-copy-password]')?.textContent).to.equal(
        'Copy'
      );
      expect(
        body.querySelector('#dc-generated-password-help')?.textContent
      ).to.equal(
        'Give this password to alice. It will not be shown again. They will have to change it when they next sign in.'
      );
      // Focus on the field, which a screen reader reads with its help
      expect(document.activeElement).to.equal(field);
      // and which selects the password whenever it takes the focus.
      body.querySelector<HTMLElement>('[data-copy-password]')?.focus();
      field.setSelectionRange(0, 0);
      field.focus();
      expect([field.selectionStart, field.selectionEnd]).to.deep.equal([
        0,
        's3cret!<x>'.length,
      ]);
    });

    it('should say no change is required when the server set none', async () => {
      // An entity with no reset attribute flags nothing, whatever was asked.
      const reset = await card(() => [
        200,
        { generated: true, password: 's3cret', forceChange: false },
      ]);
      submit(reset);
      await shown(reset.body);
      const help = reset.body.querySelector(
        '#dc-generated-password-help'
      )?.textContent;
      expect(help).to.contain('It will not be shown again.');
      expect(help).to.not.contain('change it when they next sign in');
    });

    it('should ask once before it is closed uncopied', async () => {
      const reset = await card();
      const { body, panel } = reset;
      submit(reset);
      await shown(body);
      const leave = body.querySelector<HTMLElement>('[data-leave]');
      const done = body.querySelector<HTMLElement>('[data-done-actions]');
      // Done, × and Escape all close the panel the same way
      const button = body.querySelector<HTMLElement>('[data-done]');
      button?.focus();
      button?.click();
      expect(panel.hidden).to.be.false;
      expect(leave?.hidden).to.be.false;
      expect(done?.hidden).to.be.true;
      expect(document.activeElement).to.equal(
        body.querySelector('[data-leave-close]')
      );
      // Back keeps it, and asks again next time
      click(body, '[data-leave-back]');
      expect(leave?.hidden).to.be.true;
      expect(done?.hidden).to.be.false;
      expect(document.activeElement).to.equal(
        body.querySelector('#dc-generated-password')
      );
      press('Escape');
      expect(panel.hidden).to.be.false;
      expect(leave?.hidden).to.be.false;
      // Asked: the second attempt closes
      press('Escape');
      expect(panel.hidden).to.be.true;
    });

    it('should close at once once copied', async () => {
      const written: string[] = [];
      const original = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: {
          writeText: (text: string) => {
            written.push(text);
            return Promise.resolve();
          },
        },
      });
      try {
        const reset = await card();
        const { body, panel } = reset;
        submit(reset);
        await shown(body);
        const copy = body.querySelector<HTMLElement>('[data-copy-password]');
        copy?.click();
        await until(() => copy?.textContent === 'Copied');
        expect(written).to.deep.equal(['s3cret!<x>']);
        press('Escape');
        expect(panel.hidden).to.be.true;
      } finally {
        if (original) Object.defineProperty(navigator, 'clipboard', original);
        else delete (navigator as { clipboard?: unknown }).clipboard;
      }
    });

    it('should still close on a typed password, with a toast', async () => {
      const reset = await card(() => [200, { generated: false }]);
      const { root, panel, calls } = reset;
      submit(reset, 'N3w-Passw0rd!');
      await until(() => panel.hidden);
      expect(toast(root)).to.equal('Password changed');
      expect(resets(calls)).to.deep.equal([
        'resetPassword(users, alice, N3w-Passw0rd!, true)',
      ]);
    });

    it('should leave no password in the page once closed', async () => {
      // Hidden, the panel kept the field and its value, for any script or
      // open developer tools to read on the next page.
      const generated = await card();
      submit(generated);
      await shown(generated.body);
      press('Escape');
      press('Escape');
      expect(generated.panel.hidden).to.be.true;
      expect(generated.body.innerHTML).to.equal('');
      expect(document.querySelector('#dc-generated-password')).to.equal(null);
      generated.unmount();

      const typed = await card(() => [200, { generated: false }]);
      submit(typed, 'N3w-Passw0rd!');
      await until(() => typed.panel.hidden);
      expect(typed.body.innerHTML).to.equal('');
      expect(document.querySelector('#dc-new-password')).to.equal(null);
    });

    it('should be sent once, and stay while the server answers', async () => {
      // Closed in the meantime, it had the password shown over whatever
      // opened next; sent twice, the one shown might not be the one kept.
      const { root, calls, server } = await mountConsole({
        hash: 'users/alice',
        account: alice,
      });
      const answer = gate();
      server.post('/api/v1/ldap/users/alice/password').reply(async () => {
        await answer.opened;
        return [200, { generated: true, password: 's3cret' }];
      });
      click(root, '[data-main] [data-password]');
      const { panel, body } = panelOf(root);
      const send = body.querySelector<HTMLButtonElement>(
        'button[type="submit"]'
      );
      send?.click();
      expect(send?.disabled).to.be.true;
      press('Escape');
      expect(panel.hidden).to.be.false;
      send?.click();
      answer.open();
      await until(() => !!body.querySelector('#dc-generated-password'));
      expect(
        calls.filter(call => call.startsWith('resetPassword'))
      ).to.deep.equal(['resetPassword(users, alice, true)']);
      expect(panel.hidden).to.be.false;
      // The guard of the request let go of the panel once answered: what
      // holds it now is the password's own question, asked once.
      press('Escape');
      expect(panel.hidden).to.be.false;
      expect(body.querySelector<HTMLElement>('[data-leave]')?.hidden).to.be
        .false;
      press('Escape');
      expect(panel.hidden).to.be.true;
    });

    it('should close on Cancel even while the server answers', async () => {
      // A server that never answers would otherwise hold the panel for good.
      const answer = gate();
      const reset = await card(async () => {
        await answer.opened;
        return [200, { generated: true, password: 's3cret!<x>' }];
      });
      const { body, panel, title } = reset;
      submit(reset);
      click(body, '[data-cancel]');
      expect(panel.hidden).to.be.true;
      answer.open();
      // The password generated all the same gets a panel of its own.
      await until(() => !panel.hidden);
      expect(title.textContent).to.equal('New password — alice');
      expect((await shown(body)).value).to.equal('s3cret!<x>');
    });

    it('should wait for the panel opened meanwhile to close', async () => {
      // Replaced, that panel lost what it held: another password perhaps.
      const answer = gate();
      const reset = await card(async () => {
        await answer.opened;
        return [200, { generated: true, password: 's3cret!<x>' }];
      });
      const { root, body, panel, title, idle } = reset;
      submit(reset);
      click(body, '[data-cancel]');
      click(root, '[data-main] [data-edit]');
      await until(() => !panel.hidden);
      const other = title.textContent;
      expect(other).to.match(/^Edit/);
      answer.open();
      await idle();
      expect(title.textContent).to.equal(other);
      expect(body.querySelector('#dc-generated-password')).to.equal(null);
      press('Escape');
      expect(panel.hidden).to.be.false;
      expect(title.textContent).to.equal('New password — alice');
      expect(body.querySelector('#dc-generated-password')).to.not.equal(null);
    });

    it('should be sent again after the server refused it', async () => {
      const reset = await card(() => [
        400,
        { error: 'Password fails quality checking policy' },
      ]);
      const { root, body, panel, send, calls } = reset;
      submit(reset, 'N3w-Passw0rd!');
      await until(() => toast(root) !== '');
      expect(toast(root)).to.equal('Password fails quality checking policy');
      expect(send.disabled).to.be.false;
      expect(panel.hidden).to.be.false;
      submit(reset);
      await until(() => resets(calls).length === 2);
      await until(() => !send.disabled);
      // Nothing holds the panel once the server has answered.
      press('Escape');
      expect(panel.hidden).to.be.true;
      expect(body.innerHTML).to.equal('');
    });

    it('should show a password generated after its panel was shut by force', async () => {
      // The only copy there is: in a panel of its own, not a hidden one,
      // over the page gone to meanwhile.
      const answer = gate();
      const reset = await card(async () => {
        await answer.opened;
        return [200, { generated: true, password: 's3cret!<x>' }];
      });
      const { root, body, panel, title } = reset;
      submit(reset);
      // Cancel shuts it by force while the request runs.
      click(body, '[data-cancel]');
      expect(panel.hidden).to.be.true;
      window.location.hash = '#/groups';
      await settled(root);
      answer.open();
      await until(() => !panel.hidden);
      expect(window.location.hash).to.equal('#/groups');
      expect(title.textContent).to.equal('New password — alice');
      const field = await shown(body);
      expect(field.value).to.equal('s3cret!<x>');
      expect(body.querySelector('x')).to.equal(null);
    });
  });

  describe('a password for an account just created', () => {
    it('should be generated and shown before the card opens', async () => {
      // An account created empty could not be signed in to (#164).
      const mounted = await mountConsole({ hash: 'users', answers: tree });
      const { root, calls } = mounted;
      const { body, title, panel } = panelOf(root);
      await create(mounted);
      await until(() => !!body.querySelector('#dc-generated-password'));
      expect(
        calls.filter(call => call.startsWith('resetPassword'))
      ).to.deep.equal(['resetPassword(users, helene, true)']);
      expect(title.textContent).to.match(/^New password — /);
      expect(window.location.hash).to.equal('#/users');
      // The card opens once the password panel is closed.
      press('Escape');
      press('Escape');
      expect(panel.hidden).to.be.true;
      await settled(root);
      expect(window.location.hash).to.equal('#/users/helene');
    });

    it('should not be asked to change when the form said No', async () => {
      const mounted = await mountConsole({ hash: 'users', answers: tree });
      const { body } = panelOf(mounted.root);
      await create(mounted, undefined, {
        password: [
          200,
          { generated: true, password: 's3cret', forceChange: false },
        ],
        fill: form => {
          const reset =
            form.querySelector<HTMLSelectElement>('[name="pwdReset"]');
          if (!reset) throw new Error('no pwdReset');
          reset.value = 'FALSE';
          reset.dispatchEvent(new Event('change', { bubbles: true }));
        },
      });
      await until(() => !!body.querySelector('#dc-generated-password'));
      expect(resets(mounted.calls)).to.deep.equal([
        'resetPassword(users, helene, false)',
      ]);
    });

    it('should say what the server did of the change required', async () => {
      // An entity with no reset attribute flags nothing, whatever was asked.
      const mounted = await mountConsole({ hash: 'users', answers: tree });
      const { body } = panelOf(mounted.root);
      await create(mounted, undefined, {
        password: [
          200,
          { generated: true, password: 's3cret', forceChange: false },
        ],
      });
      await until(() => !!body.querySelector('#dc-generated-password'));
      // Asked to require a change, and told none is.
      expect(resets(mounted.calls)).to.deep.equal([
        'resetPassword(users, helene, true)',
      ]);
      expect(
        body.querySelector('#dc-generated-password-help')?.textContent
      ).to.not.include('change it when they next sign in');
    });

    it('should wait behind the panel opened meanwhile, and open no card', async () => {
      const mounted = await mountConsole({ hash: 'users', answers: tree });
      const { root } = mounted;
      const { body, title, panel } = panelOf(root);
      const created = gate();
      const { answered } = await create(mounted, created.opened);
      // The form is left while the server answers, and another panel opens.
      press('Escape');
      click(root, '[data-panel-body] [data-discard-confirm]');
      expect(panel.hidden).to.be.true;
      click(root, '[data-main] [data-import]');
      const other = title.textContent;
      expect(panel.hidden).to.be.false;
      created.open();
      await answered;
      expect(title.textContent).to.equal(other);
      expect(body.querySelector('#dc-generated-password')).to.equal(null);
      // Shown once that one is closed, and no card opened over the list.
      press('Escape');
      expect(panel.hidden).to.be.false;
      expect(body.querySelector('#dc-generated-password')).to.not.equal(null);
      press('Escape');
      press('Escape');
      expect(panel.hidden).to.be.true;
      await settled(root);
      expect(window.location.hash).to.equal('#/users');
    });

    it('should open the card only if the administrator stayed', async () => {
      const mounted = await mountConsole({ hash: 'users', answers: tree });
      const { root } = mounted;
      const { body, panel } = panelOf(root);
      await create(mounted);
      await until(() => !!body.querySelector('#dc-generated-password'));
      // Gone elsewhere: the password stays until it is closed on purpose,
      // and its card does not open over the page gone to.
      window.location.hash = '#/groups';
      await settled(root);
      expect(panel.hidden).to.be.false;
      press('Escape');
      expect(panel.hidden).to.be.true;
      await settled(root);
      expect(window.location.hash).to.equal('#/groups');
      // Stayed: the card opens.
      window.location.hash = '#/users';
      await settled(root);
      await create(mounted);
      await until(() => !!body.querySelector('#dc-generated-password'));
      press('Escape');
      press('Escape');
      await settled(root);
      expect(window.location.hash).to.equal('#/users/helene');
    });

    it('should give the password a panel of its own when its form was closed meanwhile', async () => {
      // Written into the hidden panel, it was seen by nobody, and the card
      // it queued opened at some later close (#164).
      const mounted = await mountConsole({ hash: 'users', answers: tree });
      const { root } = mounted;
      const { body, panel } = panelOf(root);
      const created = gate();
      await create(mounted, created.opened);
      press('Escape');
      click(root, '[data-panel-body] [data-discard-confirm]');
      expect(panel.hidden).to.be.true;
      created.open();
      await until(() => !panel.hidden);
      expect(body.querySelector('#dc-generated-password')).to.not.equal(null);
      // Nothing waits behind it: closed, it opens no card.
      press('Escape');
      press('Escape');
      expect(panel.hidden).to.be.true;
      await settled(root);
      expect(window.location.hash).to.equal('#/users');
      expect(panel.hidden).to.be.true;
    });

    it('should say so when the server named no account to give one to', async () => {
      const mounted = await mountConsole({ hash: 'users', answers: tree });
      const { root, calls } = mounted;
      const { panel } = panelOf(root);
      await create(mounted, undefined, { created: { success: true } });
      await until(() => panel.hidden);
      expect(resets(calls)).to.deep.equal([]);
      expect(toast(root)).to.include('without a password');
    });

    it('should not be asked for when one was typed, and say when it fails', async () => {
      const typed = await mountConsole({ hash: 'users', answers: tree });
      await create(typed, undefined, {
        fill: form =>
          type(
            form.querySelector<HTMLInputElement>('[name="userPassword"]'),
            'Typed-1!'
          ),
      });
      // Not shown: the panel closes and the card opens, as for any entry.
      await until(() => window.location.hash === '#/users/helene');
      expect(panelOf(typed.root).panel.hidden).to.be.true;
      expect(resets(typed.calls)).to.deep.equal([]);
      typed.unmount();

      const refused = await mountConsole({ hash: 'users', answers: tree });
      await create(refused, undefined, {
        password: [403, { error: 'Forbidden' }],
      });
      await until(() => window.location.hash === '#/users/helene');
      expect(panelOf(refused.root).panel.hidden).to.be.true;
      expect(resets(refused.calls)).to.deep.equal([
        'resetPassword(users, helene, true)',
      ]);
      expect(toast(refused.root)).to.match(
        /created, without a password: use Reset password on the card to give one$/
      );
    });
  });
});
