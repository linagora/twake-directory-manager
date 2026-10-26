import { expect } from 'chai';
import nock from 'nock';
import { DirectoryConsole } from '../../src/DirectoryConsole';
import { Translator, availableLanguages, languageName } from '../../src/i18n';
import { referenceOpen } from '../../src/console/settings';
import { mountConsole, settled } from '../support/mount';
import type { SafeHtml } from '../../src/shared/html';
import type { EntityDescriptor, Entry, Scope } from '../../src/types';
import {
  baseUrl,
  stubContainer,
  treeContainer,
  consoleIn,
} from '../support/stubs';
import { users, groups, mailboxTypes } from '../fixtures/entities';

describe('Directory console: the shell and the overview', () => {
  afterEach(() => nock.cleanAll());

  describe('the shell and its actions', () => {
    it('should name the states the same way in the panel, the card and the reference list', () => {
      // English said "Enabled" and "To be deleted" in the select, "Active"
      // and "To delete" on the card and in the Account states list.
      const en = new Translator('en');
      expect(en.t('state.enabled')).to.equal('Active');
      expect(en.t('state.toDelete')).to.equal('To delete');
    });

    // A nomenclature entry named as its card names it, to edit it and to
    // delete it: in test/actions/forms.test.ts and deletion.test.ts.

    describe('what the browser remembers', () => {
      const original = Object.getOwnPropertyDescriptor(
        globalThis,
        'localStorage'
      ) as PropertyDescriptor;
      afterEach(() => {
        Object.defineProperty(globalThis, 'localStorage', original);
      });
      const fresh = () =>
        new DirectoryConsole({
          containerId: 'console',
          apiBaseUrl: baseUrl,
        }) as unknown as {
          translator: Translator;
        };

      it('should start in the language of the last visit, with the reference section as it was left', () => {
        localStorage.setItem('ldap-rest.console.language', 'fr');
        localStorage.setItem('ldap-rest.console.referenceOpen', '1');
        const app = fresh();
        expect(app.translator.language).to.equal('fr');
        expect(referenceOpen()).to.equal(true);
      });

      it('should start in English with the section closed when storage is denied', () => {
        // A browser that refuses storage (a private window with it blocked)
        // throws on the property itself.
        Object.defineProperty(globalThis, 'localStorage', {
          configurable: true,
          get: () => {
            throw new Error('denied');
          },
        });
        const app = fresh();
        // The browser's language then, which happy-dom fixes at en-US.
        expect(app.translator.language).to.equal('en');
        expect(referenceOpen()).to.equal(false);
      });
    });

    describe('the frame, drawn into the document', () => {
      /** A console mounted into the page, as the browser would have it. */
      const drawn = (language = 'en') => mountConsole({ language });
      const labels = (list: Element): (string | null | undefined)[] =>
        Array.from(list.querySelectorAll('li > button[data-nav]')).map(
          button => button.querySelector('.dc-nav-label')?.textContent
        );
      /** Choose a language in the sidebar, as the reader does. */
      const choose = (root: HTMLElement, code: string): void => {
        const select = root.querySelector<HTMLSelectElement>(
          'select[data-language]'
        );
        if (!select) throw new Error('no language select');
        select.value = code;
        select.dispatchEvent(new Event('change'));
      };
      /** Go to an address, as a link or a typed hash does, and wait for the page. */
      const go = async (root: HTMLElement, hash: string): Promise<void> => {
        // The browser sends `hashchange` itself, a moment later
        window.location.hash = `#/${hash}`;
        await settled(root);
      };

      it('should offer the entries as a list, the reference data as one of its own', async () => {
        // Announced "navigation, list, 4 items", and the reference data as a
        // list of its own once opened (#219).
        const { root } = await drawn();
        const lists = root.querySelectorAll('.dc-nav ul.dc-nav-list');
        expect(lists).to.have.length(2);
        // What the recorded configuration offers the global administrator
        expect(labels(lists[0])).to.deep.equal([
          'Overview',
          'Users',
          'Groups',
          'Organizations',
        ]);
        expect(lists[1].closest('#dc-nav-reference')).to.not.equal(null);
        expect(labels(lists[1])).to.include.members([
          'Positions',
          'Password policies',
        ]);
      });

      it('should let the keyboard skip to the main area without changing the address', async () => {
        // The first thing Tab reaches; Enter focuses the main area, and the
        // hash, which the console routes on, is left alone (#215).
        const { root } = await drawn();
        const link = root.querySelector<HTMLElement>(
          'a.dc-skip-link[data-skip]'
        );
        const main = root.querySelector<HTMLElement>(
          'main#dc-main[tabindex="-1"]'
        );
        expect(link?.textContent).to.equal('Skip to main content');
        expect(root.firstElementChild?.firstElementChild).to.equal(link);
        expect(main).to.not.equal(null);
        link?.click();
        expect(document.activeElement).to.equal(main);
        expect(window.location.hash).to.equal('');
      });

      it('should declare the language of the page, and keep the focus on the selector that changed it', async () => {
        // A screen reader reads French with a French voice only when the
        // document says so; chosen by arrow keys, the select keeps the focus
        // and says what it does (#209).
        const { root } = await drawn();
        expect(document.documentElement.lang).to.equal('en');
        const select = root.querySelector<HTMLSelectElement>(
          'select[data-language]'
        );
        expect(select?.getAttribute('aria-describedby')).to.equal(
          'dc-language-hint'
        );
        expect(
          root.querySelector('#dc-language-hint.dc-visually-hidden')
            ?.textContent
        ).to.equal('The interface changes language as soon as one is chosen.');
        choose(root, 'fr');
        expect(document.documentElement.lang).to.equal('fr');
        const fresh = root.querySelector<HTMLSelectElement>(
          'select[data-language]'
        );
        expect(fresh).to.not.equal(select);
        expect(document.activeElement).to.equal(fresh);
        expect(root.querySelector('#dc-language-hint')?.textContent).to.equal(
          'L’interface change de langue dès qu’une langue est choisie.'
        );
      });

      it('should close the reference section in one click after a reference page opened it', async () => {
        // The toggle read what the browser remembered (closed) and stored
        // "open" first; the section, opened by the page shown, stayed open.
        const { root } = await drawn();
        const toggle = root.querySelector<HTMLElement>('[data-nav-toggle]');
        const section = root.querySelector<HTMLElement>('#dc-nav-reference');
        if (!toggle || !section) throw new Error('no reference section');
        expect(section.hidden).to.equal(true);
        // A reference page shown opens its section
        await go(root, 'password-policies');
        expect(toggle.getAttribute('aria-expanded')).to.equal('true');
        toggle.click();
        expect(section.hidden).to.equal(true);
        expect(
          localStorage.getItem('ldap-rest.console.referenceOpen')
        ).to.equal('');
        toggle.click();
        expect(section.hidden).to.equal(false);
        expect(
          localStorage.getItem('ldap-rest.console.referenceOpen')
        ).to.equal('1');
      });

      it('should take Tab on from the lead of a panel step, not back to the panel’s first control', async () => {
        // A lead focused for the screen reader is no control: Tab went to
        // the header's × from it, wherever it stood.
        const { root } = await drawn();
        const panel = root.querySelector<HTMLElement>('[data-panel]');
        const body = root.querySelector<HTMLElement>('[data-panel-body]');
        if (!panel || !body) throw new Error('no panel');
        panel.hidden = false;
        body.innerHTML =
          '<button type="button" id="one">one</button>' +
          '<p tabindex="-1" id="lead">lead</p>' +
          '<button type="button" id="two">two</button>';
        const lead = body.querySelector<HTMLElement>('#lead');
        lead?.focus();
        // The console listens on the document, as the browser delivers it
        const press = (shiftKey: boolean): boolean => {
          const event = new KeyboardEvent('keydown', {
            key: 'Tab',
            shiftKey,
            cancelable: true,
            bubbles: true,
          });
          document.dispatchEvent(event);
          return event.defaultPrevented;
        };
        expect(press(false)).to.equal(true);
        expect(document.activeElement?.id).to.equal('two');
        lead?.focus();
        expect(press(true)).to.equal(true);
        expect(document.activeElement?.id).to.equal('one');
        // From a control, the browser's own Tab, until the last one
        expect(press(false)).to.equal(false);
        body.querySelector<HTMLElement>('#two')?.focus();
        expect(press(false)).to.equal(true);
        expect(
          document.activeElement?.getAttribute('data-panel-close')
        ).to.equal('');
      });

      it('should offer high contrast under the language, remembered and applied at once', async () => {
        // Fields outlined at 1.5:1 and a current place shown by a tint only
        // left low-vision readers to guess (#210).
        const { root } = await drawn();
        const app = root.querySelector('.dc-app');
        const box = root.querySelector<HTMLInputElement>(
          '.dc-sidebar-footer label.dc-contrast input[type="checkbox"][data-contrast]'
        );
        if (!app || !box) throw new Error('no contrast box');
        expect(box.checked).to.equal(false);
        expect(app.classList.contains('dc-contrast-high')).to.equal(false);
        expect(box.parentElement?.textContent?.trim()).to.equal(
          'High contrast'
        );
        box.checked = true;
        box.dispatchEvent(new Event('change'));
        expect(app.classList.contains('dc-contrast-high')).to.equal(true);
        expect(localStorage.getItem('ldap-rest.console.contrast')).to.equal(
          'high'
        );
        // Drawn anew, in another language, the choice holds
        const again = await drawn('fr');
        expect(
          again.root
            .querySelector('.dc-app')
            ?.classList.contains('dc-contrast-high')
        ).to.equal(true);
        expect(
          again.root.querySelector<HTMLInputElement>('[data-contrast]')?.checked
        ).to.equal(true);
        expect(
          again.root.querySelector('.dc-contrast span')?.textContent
        ).to.equal('Contraste élevé');
        const fresh =
          again.root.querySelector<HTMLInputElement>('[data-contrast]');
        if (!fresh) throw new Error('no contrast box');
        fresh.checked = false;
        fresh.dispatchEvent(new Event('change'));
        expect(localStorage.getItem('ldap-rest.console.contrast')).to.equal(
          'standard'
        );
      });

      it('should lay the panel, the toast region and the hidden region over the page', async () => {
        const { root } = await drawn();
        const dialog = root.querySelector('[data-panel] [data-panel-dialog]');
        expect(dialog?.getAttribute('role')).to.equal('dialog');
        expect(dialog?.getAttribute('aria-modal')).to.equal('true');
        expect(dialog?.getAttribute('aria-labelledby')).to.equal(
          'dc-panel-title'
        );
        expect(
          root.querySelector('[data-panel-close]')?.getAttribute('aria-label')
        ).to.equal('Close');
        const toast = root.querySelector('[data-toast-region]');
        expect(toast?.getAttribute('role')).to.equal('status');
        expect(toast?.getAttribute('aria-live')).to.equal('polite');
        expect(
          root.querySelector('[data-toast-region] [data-toast]')
        ).to.not.equal(null);
        const region = root.querySelector(
          '.dc-app > [data-announce].dc-visually-hidden'
        );
        expect(region?.getAttribute('role')).to.equal('status');
        expect(region?.getAttribute('aria-live')).to.equal('polite');
        expect(region?.getAttribute('aria-atomic')).to.equal('true');
      });

      it('should title the tab after the page shown', async () => {
        // Every page, not only a card, so that tabs and history tell them
        // apart (#214).
        document.title = 'Twake Directory Manager';
        const { root } = await drawn();
        expect(document.title).to.equal('Overview — Twake Directory Manager');
        await go(root, 'nowhere');
        expect(document.title).to.equal(
          'No such page — Twake Directory Manager'
        );
        await go(root, 'users');
        expect(document.title).to.equal('Users — Twake Directory Manager');
        choose(root, 'fr');
        await settled(root);
        expect(document.title).to.equal(
          'Utilisateurs — Twake Directory Manager'
        );
      });

      it('should leave the page alone once unmounted', async () => {
        // A console taken off the page listens to nothing any more: a hash
        // changed after it would otherwise draw into a detached container.
        const first = await drawn();
        expect(first.calls[0]).to.equal('discover()');
        // Its listeners on the window and the document, all under signals
        expect(first.signals.length).to.be.greaterThan(4);
        expect(first.signals.every(signal => !signal.aborted)).to.equal(true);
        first.unmount();
        expect(first.signals.every(signal => signal.aborted)).to.equal(true);
        expect(document.body.contains(first.root)).to.equal(false);
        const before = first.calls.length;
        await go(document.body, 'users');
        expect(first.calls.length).to.equal(before);
        // The next console mounts and answers for itself
        const second = await drawn();
        expect(second.root.querySelector('.dc-nav')).to.not.equal(null);
        expect(second.url).to.not.equal(first.url);
      });
    });

    it('should keep an open panel, and what was typed, across a change of language', () => {
      const typed = { hidden: false, value: 'E9901' };
      let drawn = false;
      const replaced: unknown[] = [];
      const fresh = {
        hidden: true,
        replaceWith: (element: unknown) => replaced.push(element),
      };
      const app = new DirectoryConsole({
        containerId: 'console',
        apiBaseUrl: baseUrl,
        language: 'en',
      }) as unknown as {
        container: unknown;
        translator: Translator;
        renderMain(): Promise<void>;
        changeLanguage(code: string): void;
      };
      app.container = {
        set innerHTML(_html: string) {
          drawn = true;
        },
        querySelector: (selector: string) =>
          selector === '[data-panel]' ? (drawn ? fresh : typed) : null,
        querySelectorAll: () => [],
      };
      app.renderMain = () => Promise.resolve();
      app.changeLanguage('fr');
      expect(app.translator.language).to.equal('fr');
      expect(replaced).to.deep.equal([typed]);

      // A closed one is drawn afresh, in the new language.
      typed.hidden = true;
      drawn = false;
      app.changeLanguage('en');
      expect(replaced).to.have.length(1);
    });

    it('should name the transit branch in the scope banner, tooltip included', () => {
      const app = consoleIn({}) as unknown as {
        scope: Scope;
        scopeMarkup(): SafeHtml;
      };
      app.scope = {
        user: 'sophie.martin',
        unrestricted: false,
        branches: [
          {
            dn: 'ou=Sales,ou=organization,dc=example,dc=com',
            name: 'Sales',
            path: 'Sales',
            read: true,
            write: true,
          },
        ],
        entities: [],
        transit: 'ou=Transit,ou=organization,dc=example,dc=com',
      };
      const markup = app.scopeMarkup().markup;
      expect(markup).to.contain('title="Transit">Transit</a>');
      expect(markup).to.not.contain('title="ou=Transit');
      // "Transit Transit (1)" said it twice: the label goes (#171), and
      // stays before a branch named otherwise.
      expect(markup).to.not.contain(
        '<span class="dc-scope-label">Transit</span>'
      );
      app.scope.transit = 'ou=Mobility,ou=organization,dc=example,dc=com';
      expect(app.scopeMarkup().markup)
        .to.contain('<span class="dc-scope-label">Transit</span>')
        .and.contain('title="Mobility">Mobility</a>');
    });
  });

  describe('the list, between visits', () => {
    /**
     * The controls of one drawing of a list. Each repaint binds them again,
     * so only the listener bound last is live, as in a browser.
     */
    const controls = () => {
      const control = (dataset: Record<string, string> = {}) => {
        let handler: ((event: unknown) => void) | undefined;
        const made = {
          value: '',
          dataset,
          fire: () => handler?.({ target: made }),
          addEventListener: (
            _type: string,
            callback: (event: unknown) => void
          ) => {
            handler = callback;
          },
        };
        return made;
      };
      const search = control();
      const field = control();
      const next = control({ page: '1' });
      const holder = stubContainer();
      Object.assign(holder, {
        querySelector: (selector: string) =>
          selector === '[data-search]'
            ? search
            : selector === '[data-search-attribute]'
              ? field
              : null,
        querySelectorAll: (selector: string) =>
          selector === '[data-page]' ? [next] : [],
      });
      return { holder, search, field, next };
    };

    it('should come back to the search, the field and the page it was left on', async () => {
      // Back from a card drew the list anew: an empty box, "Every field",
      // the prompt to type, and no rows.
      const app = consoleIn({});
      const loads: [string | undefined, string | undefined][] = [];
      const entries: Record<string, Entry> = {};
      for (let i = 10; i < 40; i++)
        entries[`alice${i}`] = {
          dn: `uid=alice${i},ou=users,dc=example,dc=com`,
          uid: `alice${i}`,
        };
      Object.assign((app as unknown as { api: object }).api, {
        listBounded: async (
          _entity: EntityDescriptor,
          search?: string,
          attribute?: string
        ) => {
          loads.push([search, attribute]);
          return { entries, truncated: false };
        },
      });
      const visit = async () => {
        const list = controls();
        const main = {
          innerHTML: '',
          querySelector: (selector: string) =>
            selector === '[data-list]' ? list.holder : null,
        };
        await (
          app as unknown as {
            renderList(main: unknown, entity: EntityDescriptor): Promise<void>;
          }
        ).renderList(main, users);
        return list;
      };

      const first = await visit();
      first.field.value = 'mail';
      first.field.fire();
      first.search.value = 'alice';
      first.search.fire();
      await new Promise(resolve => setTimeout(resolve, 300));
      first.next.fire();
      expect(first.holder.innerHTML).to.contain('26–30 of 30');
      expect(loads).to.deep.equal([['alice', 'mail']]);

      const back = await visit();
      expect(loads).to.deep.equal([
        ['alice', 'mail'],
        ['alice', 'mail'],
      ]);
      expect(back.holder.innerHTML)
        .to.contain('value="alice"')
        .and.match(/<option value="mail" selected>/)
        .and.contain('26–30 of 30');
    });
  });

  describe('an address naming no page', () => {
    const organizations: EntityDescriptor = {
      key: 'organizations',
      pluralName: 'organizations',
      singularName: 'organization',
      mainAttribute: 'ou',
      base: 'ou=organization,dc=example,dc=com',
      schema: { attributes: { ou: { type: 'string', role: 'identifier' } } },
      endpoint: '/api/v1/ldap/organizations',
      kind: 'organization',
    };

    /**
     * A console on the page this hash names, its views recording which one
     * was drawn and its navigation which entry was highlighted.
     */
    const visit = async (hash: string, language = 'en') => {
      const main = { innerHTML: '', querySelectorAll: () => [] };
      const nav = ['', 'users', 'organizations', 'mailboxTypes'].map(key => {
        const item = {
          dataset: { nav: key },
          active: false,
          classList: {
            contains: () => false,
            toggle: (_name: string, on: boolean) => {
              item.active = on;
            },
          },
          setAttribute: () => undefined,
          removeAttribute: () => undefined,
        };
        return item;
      });
      const app = new DirectoryConsole({
        containerId: 'console',
        apiBaseUrl: baseUrl,
        language,
      });
      const drawn: string[] = [];
      Object.assign(app as unknown as object, {
        container: {
          querySelector: (selector: string) =>
            selector === '[data-main]' ? main : null,
          querySelectorAll: (selector: string) =>
            selector === '[data-nav]' ? nav : [],
        },
        entities: [users, organizations, mailboxTypes],
        policiesReadable: true,
        renderList: async (_main: unknown, entity: EntityDescriptor) => {
          drawn.push(`list ${entity.key}`);
        },
        renderDetail: async (
          _main: unknown,
          entity: EntityDescriptor,
          id: string
        ) => {
          drawn.push(`detail ${entity.key} ${id}`);
        },
        renderOrganizations: async () => {
          drawn.push('organizations');
        },
        renderPolicies: async () => {
          drawn.push('policies');
        },
      });
      const g = globalThis as Record<string, unknown>;
      const original = g.window;
      g.window = { location: { hash } };
      try {
        await (app as unknown as { followHash(): Promise<void> }).followHash();
      } finally {
        g.window = original;
      }
      return {
        main,
        drawn,
        highlighted: nav
          .filter(item => item.active)
          .map(item => item.dataset.nav),
      };
    };

    it('should say there is no page, with a way to the overview', async () => {
      // A mistyped or outdated link drew the overview, as if it had worked.
      for (const [language, text, link] of [
        ['en', 'There is no page at this address.', 'Go to the Overview'],
        ['fr', 'Il n’y a pas de page à cette adresse.', 'Aller à l’accueil'],
        ['mn', 'Энэ хаягт хуудас алга.', 'Нүүр хуудас руу очих'],
      ]) {
        for (const hash of ['#/passwordPolicies', '#/accountStates/active']) {
          const { main, drawn, highlighted } = await visit(hash, language);
          expect(main.innerHTML)
            .to.include(text)
            .and.include(`href="#/">${link}</a>`)
            .and.not.include('dc-dashboard');
          expect(drawn).to.deep.equal([]);
          expect(highlighted).to.deep.equal([]);
        }
      }
    });

    it('should still open the overview and every page that exists', async () => {
      for (const hash of ['', '#', '#/']) {
        const { main, highlighted } = await visit(hash);
        expect(main.innerHTML).to.include('dc-dashboard');
        expect(highlighted).to.deep.equal(['']);
      }
      const pages: [string, string][] = [
        ['#/users', 'list users'],
        ['#/users/alice', 'detail users alice'],
        ['#/mailboxTypes', 'list mailboxTypes'],
        ['#/organizations', 'organizations'],
        ['#/organizations/ou=Sales', 'organizations'],
        ['#/password-policies', 'policies'],
      ];
      for (const [hash, page] of pages) {
        const { main, drawn } = await visit(hash);
        expect(drawn, hash).to.deep.equal([page]);
        expect(main.innerHTML, hash).to.not.include('There is no page');
      }
    });
  });

  describe('an account administering nothing', () => {
    const top = 'ou=organization,dc=example,dc=com';
    const organizations: EntityDescriptor = {
      key: 'organizations',
      pluralName: 'organizations',
      singularName: 'organization',
      mainAttribute: 'ou',
      base: top,
      schema: { attributes: { ou: { type: 'string', role: 'identifier' } } },
      endpoint: '/api/v1/ldap/organizations',
      kind: 'organization',
    };
    const notice =
      'You administer no branch: there is nothing here for you to manage.';

    /** A console with this scope, which records what it asks the server. */
    const setup = (scope: Scope) => {
      const asked: string[] = [];
      const holder = stubContainer();
      const main = {
        innerHTML: '',
        querySelector: (selector: string): unknown =>
          ({
            '[data-list]': holder,
            '[data-detail]': stubContainer(),
            '[data-tree]': treeContainer(),
          })[selector] ?? null,
      };
      const app = consoleIn({ '[data-main]': main });
      Object.assign(app as unknown as object, {
        scope,
        entities: [users, organizations],
      });
      Object.assign((app as unknown as { api: object }).api, {
        listBounded: async () => {
          asked.push('list');
          return { entries: {}, truncated: false };
        },
        get: async () => {
          asked.push('get');
          return { dn: 'uid=bob,ou=users,dc=example,dc=com', uid: 'bob' };
        },
        organizationTop: async () => {
          asked.push('top');
          return null;
        },
      });
      const views = app as unknown as {
        renderList(main: unknown, entity: EntityDescriptor): Promise<void>;
        renderDetail(
          main: unknown,
          entity: EntityDescriptor,
          id: string,
          generation: number
        ): Promise<void>;
        renderOrganizations(main: unknown, generation: number): Promise<void>;
      };
      return { views, main, holder, asked };
    };
    const nobody: Scope = {
      user: 'alice',
      unrestricted: false,
      described: true,
      branches: [],
      entities: [],
    };

    it('should say there is nothing to manage, and ask nothing the server would refuse', async () => {
      // Each page answered in red with the server's "Token does not have
      // permission on this branch".
      const { views, main, holder, asked } = setup(nobody);
      await views.renderList(main, users);
      expect(holder.innerHTML).to.contain(notice).and.not.contain('error');
      await views.renderDetail(main, users, 'bob', 0);
      expect(main.innerHTML).to.contain(notice);
      await views.renderOrganizations(main, 0);
      expect(main.innerHTML).to.contain(notice);
      expect(asked).to.deep.equal([]);
    });

    it('should still read for an unrestricted or undescribed scope, which names no branch either', async () => {
      for (const scope of [
        { ...nobody, unrestricted: true },
        { ...nobody, described: false },
      ]) {
        const { views, main, holder, asked } = setup(scope);
        await views.renderList(main, users);
        expect(holder.innerHTML).to.not.contain(notice);
        await views.renderDetail(main, users, 'bob', 0);
        await views.renderOrganizations(main, 0);
        expect(asked).to.include.members(['get', 'top']);
      }
    });
  });

  describe('the overview, in names', () => {
    const admin = 'uid=admin,ou=users,dc=example,dc=com';
    const alice = 'uid=alice,ou=users,dc=example,dc=com';
    const global: Scope = {
      user: admin,
      unrestricted: false,
      described: true,
      branches: [
        { dn: 'dc=example,dc=com', read: true, write: true, delete: true },
      ],
      entities: [{ name: 'users', base: users.base, create: true }],
    };
    const nobody: Scope = { ...global, user: alice, branches: [] };

    /**
     * A console for this scope, the account read as `read` answers, and its
     * server offering to sign out.
     */
    const setup = (
      scope: Scope,
      read: () => Promise<Entry> = async () => ({
        dn: admin,
        uid: 'admin',
        cn: 'Ada Admin',
        mail: 'admin@example.com',
      }),
      language = 'en'
    ) => {
      const main = { innerHTML: '', querySelectorAll: () => [] };
      const app = consoleIn({ '[data-main]': main }, language);
      const asked: string[] = [];
      Object.assign(app as unknown as object, {
        scope,
        entities: [users, groups, mailboxTypes],
      });
      Object.assign((app as unknown as { api: object }).api, {
        logoutPath: '/logout',
        get: async (entity: EntityDescriptor, id: string) => {
          asked.push(`${entity.key} ${id}`);
          return read();
        },
      });
      const inner = app as unknown as {
        account: unknown;
        container: { innerHTML: string };
        readAccount(): Promise<unknown>;
        renderDashboard(main: unknown): void;
        drawShell(): void;
        scopeMarkup(): SafeHtml;
      };
      const overview = async (): Promise<string> => {
        inner.account = await inner.readAccount();
        inner.renderDashboard(main);
        return main.innerHTML;
      };
      const shell = (): string => {
        inner.drawShell();
        return inner.container.innerHTML;
      };
      return { app: inner, asked, overview, shell };
    };

    it('should greet the account by its name and address, read as its card is', async () => {
      // "Signed in as uid=admin,ou=users,dc=example,dc=com"
      const { asked, overview } = setup(global);
      const html = await overview();
      expect(html)
        .to.include('Signed in as Ada Admin (admin@example.com)')
        .and.include('What you can manage')
        .and.include('data-open="users"')
        .and.not.include(admin);
      expect(asked).to.deep.equal(['users admin']);

      const fr = setup(global, undefined, 'fr');
      expect(await fr.overview()).to.include(
        'Connecté en tant que Ada Admin (admin@example.com)'
      );
    });

    it('should fall back to the identifier when the account cannot be read', async () => {
      // A department head's own account, attached to the organization above
      // the one they administer: authz-linid1 hides it from them (#157).
      const local: Scope = {
        ...global,
        branches: [
          {
            dn: 'ou=sales,ou=organization,dc=example,dc=com',
            read: true,
            write: true,
            delete: true,
          },
        ],
      };
      const { asked, overview } = setup(local, async () => {
        throw Object.assign(new Error('Not found'), { status: 404 });
      });
      expect(await overview())
        .to.include('Signed in as admin<')
        .and.not.include(admin);
      // Its link decides, which the scope does not give: it is still asked
      expect(asked).to.deep.equal(['users admin']);
      // Nor is a DN no entity holds greeted whole
      const outside = setup({ ...global, user: 'cn=root,dc=example,dc=com' });
      expect(await outside.overview())
        .to.include('Signed in as root<')
        .and.not.include('cn=root');
      expect(outside.asked).to.deep.equal([]);
      // A user the scope names otherwise than by a DN is shown as it comes
      const plain = setup({ ...global, user: 'admin@example.com' });
      expect(await plain.overview()).to.include(
        'Signed in as admin@example.com<'
      );
      // An account with no address is still named
      const nameless = setup(global, async () => ({ dn: admin, cn: 'Ada' }));
      expect(await nameless.overview()).to.include('Signed in as Ada<');
    });

    it('should tell an account administering nothing once, and where to turn', async () => {
      // Three cards, each opening on "nothing to manage", and a green dot
      const { app, asked, overview, shell } = setup(nobody);
      const html = await overview();
      expect(html)
        .to.include('There is nothing for you to manage here')
        .and.include(
          'Your account (alice) does not administer any part of the directory.'
        )
        .and.match(
          /<a class="dc-button dc-button-primary" href="[^"]+logout">Sign out<\/a>/
        )
        .and.include('Signed in as alice')
        .and.not.include('What you can manage')
        .and.not.include('dc-card')
        .and.not.include('data-open');
      // The server refuses such an account every read: none is asked
      expect(asked).to.deep.equal([]);
      expect(app.scopeMarkup().markup).to.include(
        'dc-scope-empty dc-scope-none'
      );
      expect(shell())
        .to.include('data-nav=""')
        .and.not.include('data-nav="users"')
        .and.not.include('data-nav-toggle');

      const local = setup({
        ...nobody,
        branches: [
          { dn: 'ou=Sales,dc=example,dc=com', read: true, write: true },
        ],
      });
      expect(local.app.scopeMarkup().markup).to.not.include('dc-scope-none');
      expect(local.shell())
        .to.include('data-nav="users"')
        .and.include('data-nav="mailboxTypes"');
      expect(await local.overview())
        .to.include('What you can manage')
        .and.not.include('There is nothing for you to manage here');
    });

    it('should name each language in itself', () => {
      const { shell } = setup(global, undefined, 'fr');
      const options = [
        ...shell().matchAll(
          /<option value="(\w+)" lang="(\w+)"[^>]*>([^<]*)</g
        ),
      ].map(([, value, lang, text]) => [value, lang, text]);
      expect(options).to.deep.equal([
        ['en', 'en', 'English'],
        ['fr', 'fr', 'Français'],
        ['mn', 'mn', 'Монгол'],
      ]);
      for (const code of availableLanguages)
        expect(languageName(code), code).to.not.equal(code);
    });
  });
});
