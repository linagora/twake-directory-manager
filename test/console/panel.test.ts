import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { expect } from 'chai';
import type nock from 'nock';
import { ToastController } from '../../src/DirectoryConsole';
import { EntityForm } from '../../src/components/EntityForm';
import { Translator } from '../../src/i18n';
import type { EntityDescriptor, Entry } from '../../src/types';
import { consoleIn, toastElement } from '../support/stubs';
import { usersSchema, users } from '../fixtures/entities';
import { mountConsole, settled, type Mounted } from '../support/mount';
import { click, gate, panelOf, press, type, until } from '../support/act';

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

/**
 * Create Hélène from the list's New user, with no password: the server
 * generates one, which the console shows before her card.
 *
 * @param mounted the console, on the list of users
 * @param held what the creation's answer waits for, when it is held back
 * @returns once the password is answered, which the page may not show yet
 */
const create = async (
  { root, server }: Mounted,
  held?: Promise<void>
): Promise<{ answered: Promise<void> }> => {
  let answer = (): void => undefined;
  const answered = new Promise<void>(resolve => (answer = resolve));
  server.post('/api/v1/ldap/users').reply(async () => {
    await held;
    return [200, { uid: 'helene' }];
  });
  server.post('/api/v1/ldap/users/helene/password').reply(() => {
    answer();
    return [200, { generated: true, password: 's3cret' }];
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
  type(
    body.querySelector<HTMLInputElement>('#dc-field-twakeDepartmentLink'),
    'Sal'
  );
  await until(() => !!body.querySelector('[data-candidate="0"]'));
  // The first match is the active one: Enter takes it, as the reader does.
  press('Enter');
  click(body, 'button[type="submit"]');
  // Read by the console a few turns after nock answers it. Too short a wait
  // fails the test — the password expected behind the panel is not there —
  // rather than passing it.
  return {
    answered: answered.then(
      () => new Promise(resolve => setTimeout(resolve, 20))
    ),
  };
};

describe('Directory console: the side panel and the toast', () => {
  describe('the toast', () => {
    /** A toast element and a clock the test advances by hand. */
    const setup = () => {
      const element = {
        textContent: '',
        hidden: true,
        onclick: null as unknown,
        classList: { toggle: () => undefined },
      } as unknown as HTMLElement;
      return { element, toasts: new ToastController(() => element, 20) };
    };
    const wait = (ms: number) => new Promise(r => setTimeout(r, ms));

    it('should hide an ordinary message after a while', async () => {
      const { element, toasts } = setup();
      toasts.show('Saved');
      expect(element.hidden).to.be.false;
      await wait(40);
      expect(element.hidden).to.be.true;
    });

    it('should be said by a screen reader, a refusal at once', () => {
      const live: string[] = [];
      const region = {
        setAttribute: (name: string, value: string) => {
          if (name === 'aria-live') live.push(value);
        },
      };
      const element = {
        textContent: '',
        hidden: true,
        onclick: null as unknown,
        classList: { toggle: () => undefined },
        closest: (selector: string) =>
          selector === '[data-toast-region]' ? region : null,
      } as unknown as HTMLElement;
      const toasts = new ToastController(() => element, 20);
      toasts.show('Refused', true);
      toasts.show('Saved');
      expect(live).to.deep.equal(['assertive', 'polite']);
      // The region the toast is announced from is drawn with the shell.
      const app = consoleIn({});
      (app as unknown as { drawShell(): void }).drawShell();
      expect(
        (app as unknown as { container: { innerHTML: string } }).container
          .innerHTML
      ).to.match(
        /<div data-toast-region role="status" aria-live="polite" aria-atomic="true">\s*<div class="dc-toast" data-toast hidden><\/div>/
      );
    });

    it('should give a new message its whole delay', async () => {
      const { element, toasts } = setup();
      toasts.show('First');
      await wait(12);
      toasts.show('Second');
      await wait(12);
      expect(element.hidden, 'hidden by the first timer').to.be.false;
      await wait(20);
      expect(element.hidden).to.be.true;
    });
  });

  describe('a generated password', () => {
    /** An element the panel's code queries, records and fires. */
    const control = (props: Record<string, unknown> = {}) => {
      const listeners: Record<string, ((event: unknown) => void)[]> = {};
      return {
        hidden: false,
        textContent: '',
        value: '',
        checked: true,
        disabled: false,
        focused: 0,
        selected: 0,
        isConnected: true,
        ...props,
        addEventListener(
          type: string,
          listener: (event: unknown) => void
        ): void {
          (listeners[type] ||= []).push(listener);
        },
        fire(type: string): void {
          const event = { preventDefault: () => undefined };
          for (const listener of listeners[type] || []) listener(event);
        },
        focus(): void {
          this.focused++;
        },
        select(): void {
          this.selected++;
        },
      };
    };
    const tick = () => new Promise(resolve => setTimeout(resolve, 0));

    /**
     * Reset alice's password, typed or generated, through the panel.
     *
     * @param typed the password typed, or none to have one generated
     * @param meanwhile what happens before the server answers
     * @param refusal what the server answers instead of a password
     * @param answer what the server answers, when not the default
     */
    const reset = async (
      typed: string,
      meanwhile?: (sent: {
        app: {
          closePanel(force?: boolean): void;
          openPanel(title: string, build: (body: unknown) => void): void;
        };
        els: Record<string, ReturnType<typeof control>>;
        panel: { hidden: boolean };
      }) => void,
      refusal?: Error,
      answer?: { generated: boolean; password?: string; forceChange?: boolean }
    ) => {
      const els = {
        form: control(),
        send: control(),
        cancel: control(),
        password: control({ value: typed }),
        force: control({ checked: true }),
        field: control(),
        copy: control(),
        leave: control({ hidden: true }),
        done: control(),
        doneButton: control(),
        back: control(),
        close: control(),
      };
      const selectors: Record<string, unknown> = {
        form: els.form,
        'button[type="submit"]': els.send,
        '[data-cancel]': els.cancel,
        '#dc-new-password': els.password,
        '#dc-force-change': els.force,
        '#dc-generated-password': els.field,
        '[data-copy-password]': els.copy,
        '[data-leave]': els.leave,
        '[data-done-actions]': els.done,
        '[data-done]': els.doneButton,
        '[data-leave-back]': els.back,
        '[data-leave-close]': els.close,
      };
      const body = {
        innerHTML: '',
        scrollTop: 0,
        querySelector: (selector: string) => selectors[selector] ?? null,
        querySelectorAll: () => [],
      };
      const panel = { hidden: true, classList: { toggle: () => undefined } };
      const title = { textContent: '' };
      const toast = toastElement();
      const app = consoleIn({
        '[data-panel]': panel,
        '[data-panel-title]': title,
        '[data-panel-body]': body,
        '[data-toast]': toast,
      }) as unknown as {
        api: unknown;
        resetPassword(entity: unknown, id: string): void;
        closePanel(force?: boolean): void;
        openPanel(title: string, build: (body: unknown) => void): void;
      };
      let calls = 0;
      app.api = {
        resetPassword: () => {
          calls++;
          if (refusal) return Promise.reject(refusal);
          if (answer) return Promise.resolve(answer);
          return Promise.resolve(
            typed
              ? { generated: false }
              : { generated: true, password: 's3cret!<x>' }
          );
        },
      };
      await app.resetPassword({ key: 'users' }, 'alice');
      els.form.fire('submit');
      meanwhile?.({ app, els, panel });
      await tick();
      return { app, els, body, panel, title, toast, calls: () => calls };
    };

    it('should stay in the panel, never in a toast', async () => {
      // In a toast, the click that began selecting it dismissed it for good.
      const { els, body, panel, title, toast } = await reset('');
      expect(panel.hidden).to.be.false;
      expect(toast.textContent).to.equal('');
      expect(title.textContent).to.equal('New password — alice');
      expect(body.innerHTML).to.match(
        /<input id="dc-generated-password"[^>]*readonly value="s3cret!&lt;x&gt;"/
      );
      expect(body.innerHTML).to.contain('data-copy-password>Copy</button>');
      expect(body.innerHTML).to.contain(
        'Give this password to alice. It will not be shown again. They will have to change it when they next sign in.'
      );
      // Focus on the field, which a screen reader reads with its help
      expect(els.field.focused).to.equal(1);
      els.field.fire('focus');
      expect(els.field.selected).to.equal(1);
    });

    it('should say no change is required when the server set none', async () => {
      // An entity with no reset attribute flags nothing, whatever was asked.
      const { body } = await reset('', undefined, undefined, {
        generated: true,
        password: 's3cret',
        forceChange: false,
      });
      expect(body.innerHTML).to.contain('It will not be shown again.');
      expect(body.innerHTML).to.not.contain('change it when they next sign in');
    });

    it('should ask once before it is closed uncopied', async () => {
      const { app, els, panel } = await reset('');
      // Done, × and Escape all close the panel through closePanel
      els.doneButton.fire('click');
      expect(panel.hidden).to.be.false;
      expect(els.leave.hidden).to.be.false;
      expect(els.done.hidden).to.be.true;
      expect(els.close.focused).to.equal(1);
      // Back keeps it, and asks again next time
      els.back.fire('click');
      expect(els.leave.hidden).to.be.true;
      app.closePanel();
      expect(panel.hidden).to.be.false;
      // Asked: the second attempt closes
      app.closePanel();
      expect(panel.hidden).to.be.true;
    });

    it('should close at once once copied', async () => {
      const g = globalThis as Record<string, unknown>;
      const original = Object.getOwnPropertyDescriptor(g, 'navigator');
      const written: string[] = [];
      Object.defineProperty(g, 'navigator', {
        configurable: true,
        value: {
          clipboard: {
            writeText: (text: string) => {
              written.push(text);
              return Promise.resolve();
            },
          },
        },
      });
      try {
        const { app, els, panel } = await reset('');
        els.copy.fire('click');
        await tick();
        expect(written).to.deep.equal(['s3cret!<x>']);
        expect(els.copy.textContent).to.equal('Copied');
        app.closePanel();
        expect(panel.hidden).to.be.true;
      } finally {
        if (original) Object.defineProperty(g, 'navigator', original);
        else delete g.navigator;
      }
    });

    it('should still close on a typed password, with a toast', async () => {
      const { panel, toast } = await reset('N3w-Passw0rd!');
      expect(panel.hidden).to.be.true;
      expect(toast.textContent).to.equal('Password changed');
    });

    it('should leave no password in the page once closed', async () => {
      // Hidden, the panel kept the field and its value, for any script or
      // open developer tools to read on the next page.
      const generated = await reset('');
      generated.app.closePanel();
      generated.app.closePanel();
      expect(generated.panel.hidden).to.be.true;
      expect(generated.body.innerHTML).to.equal('');
      const typed = await reset('N3w-Passw0rd!');
      expect(typed.panel.hidden).to.be.true;
      expect(typed.body.innerHTML).to.equal('');
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
      const { panel, title } = await reset('', ({ els, panel }) => {
        els.cancel.fire('click');
        expect(panel.hidden).to.be.true;
        els.form.isConnected = false;
      });
      // The password generated all the same gets a panel of its own.
      expect(panel.hidden).to.be.false;
      expect(title.textContent).to.equal('New password — alice');
    });

    it('should wait for the panel opened meanwhile to close', async () => {
      // Replaced, that panel lost what it held: another password perhaps.
      const { app, panel, title, body } = await reset('', ({ app, els }) => {
        els.cancel.fire('click');
        els.form.isConnected = false;
        app.openPanel('Edit bob', inner => {
          (inner as { innerHTML: string }).innerHTML = 'bob’s form';
        });
      });
      expect(title.textContent).to.equal('Edit bob');
      expect(body.innerHTML).to.equal('bob’s form');
      app.closePanel();
      expect(panel.hidden).to.be.false;
      expect(title.textContent).to.equal('New password — alice');
      expect(body.innerHTML).to.contain('id="dc-generated-password"');
    });

    it('should be sent again after the server refused it', async () => {
      const { app, els, panel, toast, calls } = await reset(
        'N3w-Passw0rd!',
        undefined,
        new Error('Password fails quality checking policy')
      );
      expect(toast.textContent).to.equal(
        'Password fails quality checking policy'
      );
      expect(els.send.disabled).to.be.false;
      expect(panel.hidden).to.be.false;
      els.form.fire('submit');
      await tick();
      expect(calls()).to.equal(2);
      app.closePanel();
      expect(panel.hidden).to.be.true;
    });

    it('should show a password generated after its panel was shut by force', async () => {
      // The only copy there is: in a panel of its own, not a hidden one.
      const { panel, body, title } = await reset('', ({ app, els, panel }) => {
        app.closePanel(true);
        expect(panel.hidden).to.be.true;
        els.form.isConnected = false;
      });
      expect(panel.hidden).to.be.false;
      expect(title.textContent).to.equal('New password — alice');
      expect(body.innerHTML).to.match(
        /<input id="dc-generated-password"[^>]*readonly value="s3cret!&lt;x&gt;"/
      );
    });
  });

  describe('a password for an account just created', () => {
    const setup = (reset: () => Promise<unknown>) => {
      const body = {
        innerHTML: '',
        scrollTop: 0,
        querySelector: () => null,
        querySelectorAll: () => [],
      };
      const title = { textContent: '' };
      const toast = toastElement();
      const panel = { hidden: true, classList: { toggle: () => undefined } };
      const app = consoleIn({
        '[data-panel]': panel,
        '[data-panel-body]': body,
        '[data-panel-title]': title,
        '[data-toast]': toast,
      });
      const asked: unknown[][] = [];
      Object.assign((app as unknown as { api: object }).api, {
        resetPassword: (...args: unknown[]) => {
          asked.push(args);
          return reset();
        },
      });
      const give = (
        values: Record<string, string>,
        next: () => void,
        own = true,
        entity: EntityDescriptor = { ...users, password: 'userPassword' },
        id = 'helene'
      ) =>
        (
          app as unknown as {
            givePassword(
              entity: EntityDescriptor,
              values: Record<string, string>,
              id: string,
              next: () => void,
              own: () => boolean
            ): Promise<boolean>;
          }
        ).givePassword(entity, values, id, next, () => own);
      return { app, body, title, toast, asked, give, panel };
    };

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
      const { asked, give } = setup(async () => ({
        generated: true,
        password: 's3cret',
        forceChange: false,
      }));
      const reset: EntityDescriptor = {
        ...users,
        password: 'userPassword',
        schema: {
          attributes: {
            ...usersSchema.attributes,
            pwdReset: { type: 'boolean', role: 'passwordReset' },
          },
        },
      };
      await give({ pwdReset: 'FALSE' }, () => undefined, true, reset);
      expect(asked[0][3]).to.equal(false);
    });

    it('should say what the server did of the change required', async () => {
      // An entity with no reset attribute flags nothing, whatever was asked.
      const { body, give } = setup(async () => ({
        generated: true,
        password: 's3cret',
        forceChange: false,
      }));
      await give({}, () => undefined);
      expect(body.innerHTML).to.include('id="dc-generated-password"');
      expect(body.innerHTML).to.not.include('change it when they next sign in');
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
      const { asked, toast, give } = setup(async () => ({
        generated: true,
        password: 'x',
      }));
      expect(
        await give(
          {},
          () => undefined,
          true,
          { ...users, password: 'userPassword' },
          ''
        )
      ).to.equal(false);
      expect(asked).to.deep.equal([]);
      expect(toast.textContent).to.include('without a password');
    });

    it('should not be asked for when one was typed, and say when it fails', async () => {
      const typed = setup(async () => ({ generated: true, password: 'x' }));
      expect(
        await typed.give({ userPassword: 'Typed-1!' }, () => undefined)
      ).to.equal(false);
      expect(typed.asked).to.deep.equal([]);
      const refused = setup(async () => {
        throw new Error('Forbidden');
      });
      expect(await refused.give({}, () => undefined)).to.equal(false);
      expect(refused.toast.textContent).to.match(
        /created, without a password: use Reset password on the card to give one$/
      );
    });
  });

  describe('a form closed with what was typed in it', () => {
    /** A button the question holds, which records its focus and fires */
    const button = () => {
      let click = (): void => undefined;
      return {
        focused: 0,
        focus(): void {
          this.focused++;
        },
        addEventListener: (_type: string, listener: () => void): void => {
          click = listener;
        },
        fire: (): void => click(),
      };
    };
    const setup = () => {
      const keep = button();
      const discard = button();
      const question = {
        className: '',
        innerHTML: '',
        removed: false,
        setAttribute: (): void => undefined,
        remove(): void {
          this.removed = true;
        },
        querySelector: (selector: string) =>
          selector === '[data-discard-keep]'
            ? keep
            : selector === '[data-discard-confirm]'
              ? discard
              : null,
      };
      const row = {
        hidden: false,
        added: null as unknown,
        after(element: unknown): void {
          this.added = element;
        },
        querySelector: () => null,
      };
      const body = {
        innerHTML: '',
        scrollTop: 0,
        querySelector: (selector: string) =>
          selector === '.dc-form-actions' ? row : null,
        querySelectorAll: () => [],
      };
      const panel = { hidden: false, classList: { toggle: () => undefined } };
      const app = consoleIn({
        '[data-panel]': panel,
        '[data-panel-body]': body,
        '[data-panel-title]': { textContent: '' },
      }) as unknown as {
        guardDiscard(body: unknown, dirty: () => boolean): void;
        closePanel(force?: boolean): void;
      };
      return { app, body, panel, row, question, keep, discard };
    };
    const g = globalThis as Record<string, unknown>;
    let original: unknown;
    beforeEach(() => {
      original = g.document;
    });
    afterEach(() => {
      g.document = original;
    });

    it('should ask before discarding, Keep editing first', () => {
      // Escape, × or Cancel closed a filled form at once (#169).
      const { app, panel, row, question, keep, discard } = setup();
      g.document = { createElement: () => question, activeElement: null };
      app.guardDiscard({ querySelector: () => row }, () => true);
      app.closePanel();
      expect(panel.hidden).to.be.false;
      expect(row.hidden).to.be.true;
      expect(row.added).to.equal(question);
      expect(question.innerHTML)
        .to.include('Discard what you typed?')
        .and.include('Keep editing')
        .and.include('>Discard<');
      expect(keep.focused).to.equal(1);
      // Keep editing gives the form back as it was.
      keep.fire();
      expect(question.removed).to.be.true;
      expect(row.hidden).to.be.false;
      expect(panel.hidden).to.be.false;
      // Asked again, Discard closes.
      app.closePanel();
      discard.fire();
      expect(panel.hidden).to.be.true;
    });

    it('should close on a second Escape, and at once when nothing changed', () => {
      const { app, panel, row, question } = setup();
      g.document = { createElement: () => question, activeElement: null };
      app.guardDiscard({ querySelector: () => row }, () => true);
      app.closePanel();
      expect(panel.hidden).to.be.false;
      app.closePanel();
      expect(panel.hidden).to.be.true;
      const clean = setup();
      g.document = { createElement: () => clean.question, activeElement: null };
      clean.app.guardDiscard({ querySelector: () => clean.row }, () => false);
      clean.app.closePanel();
      expect(clean.panel.hidden).to.be.true;
      expect(clean.row.added).to.equal(null);
    });

    it('should tell a changed form from one only opened', () => {
      const form = new EntityForm({
        entity: users,
        entry: { uid: 'alice', cn: 'Alice' },
        translator: new Translator('en'),
        pointerOptions: () => Promise.resolve([]),
        onSubmit: () => Promise.resolve(),
        onCancel: () => undefined,
      });
      expect(form.isDirty()).to.be.false;
      (form as unknown as { values: Record<string, string[]> }).values.cn = [
        'Alice Moreau',
      ];
      expect(form.isDirty()).to.be.true;
    });
  });

  describe('the side panel', () => {
    /** A console whose panel is made of elements just real enough for it. */
    const setup = () => {
      const panel = {
        hidden: true,
        classList: { toggle: () => undefined },
      };
      // As in a browser, an element with no box keeps its offset whatever
      // is written to it: the panel's body has none while the panel is hidden.
      let offset = 0;
      const body = {
        innerHTML: '',
        querySelectorAll: () => [],
        get scrollTop(): number {
          return offset;
        },
        set scrollTop(value: number) {
          if (!panel.hidden) offset = value;
        },
      };
      const app = consoleIn({
        '[data-panel]': panel,
        '[data-panel-title]': { textContent: '' },
        '[data-panel-body]': body,
      });
      return {
        app: app as unknown as {
          openPanel(title: string, build: (body: unknown) => void): void;
          closePanel(): void;
          followHash(): Promise<void>;
        },
        panel,
        body,
      };
    };

    it('should open every form at its top', () => {
      const { app, panel, body } = setup();
      app.openPanel('Edit — bob', () => undefined);
      body.scrollTop = 739;
      app.closePanel();
      app.openPanel('New group', () => undefined);
      expect(panel.hidden).to.be.false;
      expect(body.scrollTop).to.equal(0);
    });

    it('should close the panel when the page changes under it', async () => {
      const { app, panel } = setup();
      app.openPanel('Edit — alice', () => undefined);
      const g = globalThis as Record<string, unknown>;
      const original = g.window;
      g.window = { location: { hash: '#/organizations' } };
      try {
        await app.followHash();
      } finally {
        g.window = original;
      }
      expect(panel.hidden).to.be.true;
    });

    describe('and the keyboard', () => {
      const g = globalThis as Record<string, unknown>;
      let original: unknown;
      /** Which element has the focus, as `document.activeElement` says. */
      const page = {
        activeElement: null as unknown,
        documentElement: { lang: '' },
      };
      beforeEach(() => {
        original = g.document;
        page.activeElement = null;
        g.document = page;
      });
      afterEach(() => {
        g.document = original;
      });

      const element = (name: string) => {
        const made = {
          name,
          isConnected: true,
          closest: () => null,
          focus: () => {
            page.activeElement = made;
          },
        };
        return made;
      };
      const press = (key: string, shiftKey = false, used = false) => ({
        key,
        shiftKey,
        defaultPrevented: used,
        preventDefault() {
          this.defaultPrevented = true;
        },
      });

      /** A panel whose header holds Close, and whose body a field and Save. */
      const keyboardSetup = () => {
        const edit = element('Edit');
        const close = element('Close');
        const field = element('Name');
        const save = element('Save');
        const panel = { hidden: true, classList: { toggle: () => undefined } };
        const dialog = {
          ...element('dialog'),
          querySelectorAll: () => [close, field, save],
        };
        const app = consoleIn({
          '[data-panel]': panel,
          '[data-panel-dialog]': dialog,
          '[data-panel-title]': { textContent: '' },
          '[data-panel-body]': {
            innerHTML: '',
            scrollTop: 0,
            querySelectorAll: () => [field, save],
          },
        }) as unknown as {
          openPanel(title: string, build: (body: unknown) => void): void;
          closePanel(): void;
          panelKey(event: unknown): void;
        };
        return { app, panel, edit, close, field, save };
      };

      it('should be announced as a dialog named by its title', () => {
        const app = consoleIn({});
        (app as unknown as { drawShell(): void }).drawShell();
        const html = (app as unknown as { container: { innerHTML: string } })
          .container.innerHTML;
        expect(html).to.match(
          /<div class="dc-panel-inner" data-panel-dialog role="dialog"\s+aria-modal="true" aria-labelledby="dc-panel-title"/
        );
        expect(html).to.contain('<h2 id="dc-panel-title" data-panel-title>');
      });

      it('should take the focus to its first field, and give it back on close', () => {
        // The focus stayed on Edit, and Tab went on through the page behind.
        const { app, edit, field } = keyboardSetup();
        edit.focus();
        app.openPanel('Edit — alice', () => undefined);
        expect(page.activeElement).to.equal(field);
        app.closePanel();
        expect(page.activeElement).to.equal(edit);
      });

      it('should keep Tab and Shift+Tab inside it', () => {
        const { app, close, field, save } = keyboardSetup();
        app.openPanel('Edit — alice', () => undefined);

        save.focus();
        const forward = press('Tab');
        app.panelKey(forward);
        expect(forward.defaultPrevented).to.be.true;
        expect(page.activeElement).to.equal(close);

        const backward = press('Tab', true);
        app.panelKey(backward);
        expect(backward.defaultPrevented).to.be.true;
        expect(page.activeElement).to.equal(save);

        // Between two of its controls, Tab is the browser's to move.
        field.focus();
        const within = press('Tab');
        app.panelKey(within);
        expect(within.defaultPrevented).to.be.false;

        // From outside it, back in.
        page.activeElement = null;
        app.panelKey(press('Tab'));
        expect(page.activeElement).to.equal(close);
      });

      it('should close on Escape, but not on one a control in it used', () => {
        const { app, panel, edit } = keyboardSetup();
        edit.focus();
        app.openPanel('Edit — alice', () => undefined);
        // A picker closing its list of suggestions prevents the default.
        app.panelKey(press('Escape', false, true));
        expect(panel.hidden).to.be.false;
        app.panelKey(press('Escape'));
        expect(panel.hidden).to.be.true;
        expect(page.activeElement).to.equal(edit);
      });

      it('should leave the keys alone while it is closed', () => {
        const { app, edit } = keyboardSetup();
        edit.focus();
        const tab = press('Tab');
        app.panelKey(tab);
        app.panelKey(press('Escape'));
        expect(tab.defaultPrevented).to.be.false;
        expect(page.activeElement).to.equal(edit);
      });
    });
  });
});
