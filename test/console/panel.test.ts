import { expect } from 'chai';
import { ToastController } from '../../src/DirectoryConsole';
import { EntityForm } from '../../src/components/EntityForm';
import { Translator } from '../../src/i18n';
import { consoleIn } from '../support/stubs';
import { users } from '../fixtures/entities';

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

  describe('a form closed with what was typed in it', () => {
    // Asked before discarding, and closed on a second Escape: in
    // test/actions/forms.test.ts.
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
