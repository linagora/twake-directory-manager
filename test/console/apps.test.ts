/**
 * The Workplace's applications in the header (#392): the list the
 * deployment writes, checked (src/console/apps.ts), and the button and grid
 * of a mounted console.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { expect } from 'chai';
import nock from 'nock';

import { readAppList } from '../../src/console/apps';
import { press, until } from '../support/act';
import { mountConsole, settled } from '../support/mount';

const origin = 'https://directory.twake.local';
const config = JSON.parse(
  readFileSync(join(__dirname, '..', 'fixtures', 'config.json'), 'utf8')
) as { features: { console: Record<string, unknown> } };

/** An icon nothing has to fetch: happy-dom fails a fetch, and says so late. */
const icon =
  'data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%2F%3E';

/** Twake Calendar's list, as a deployment writes it for the Workplace. */
const workplace = [
  { name: 'Calendar', link: 'https://calendar.twake.local/', icon },
  { name: 'Mail', link: 'https://mail.twake.local/' },
];

describe('console/apps', () => {
  afterEach(() => nock.cleanAll());

  it('should keep the applications in their order, and leave out those written wrong', () => {
    expect(
      readAppList(
        [
          ...workplace,
          // A link that would run in the console, no name, no link.
          { name: 'Evil', link: 'javascript:alert(1)' },
          { name: ' ', link: '/home' },
          { name: 'Nowhere' },
          'Drive',
          null,
          // A relative link, an icon that is no web address, dropped alone.
          { name: ' Home ', link: '/home', icon: 'javascript:x' },
          {
            name: 'Drive',
            link: '//drive.twake.local/',
            icon: 'data:image/svg+xml;base64,PHN2Zy8+',
          },
        ],
        origin
      )
    ).to.deep.equal([
      ...workplace,
      { name: 'Home', link: '/home' },
      {
        name: 'Drive',
        link: '//drive.twake.local/',
        icon: 'data:image/svg+xml;base64,PHN2Zy8+',
      },
    ]);
    // An image that predates the list, or a list that is no list.
    expect(readAppList(undefined, origin)).to.deep.equal([]);
    expect(readAppList({ name: 'Mail' }, origin)).to.deep.equal([]);
  });

  it('should read DM_CONSOLE_APP_LIST as a JSON array, or none', async () => {
    // The image's plugin, an ES module of ldap-rest's: imported as one.
    // Named through a variable: the type checker reads no plain JavaScript.
    const plugin = '../../docker/consoleSettings.mjs';
    const { appList } = (await import(plugin)) as {
      appList: (value?: string) => unknown[];
    };
    const warn = console.warn;
    const warned: unknown[] = [];
    console.warn = (...args: unknown[]): void => {
      warned.push(args[0]);
    };
    try {
      expect(appList(undefined)).to.deep.equal([]);
      expect(appList(' ')).to.deep.equal([]);
      expect(appList(JSON.stringify(workplace))).to.deep.equal(workplace);
      expect(warned).to.deep.equal([]);
      expect(appList('{not json')).to.deep.equal([]);
      expect(appList('{"name": "Mail"}')).to.deep.equal([]);
      expect(warned).to.have.length(2);
    } finally {
      console.warn = warn;
    }
  });

  describe('in the header', () => {
    /** The console mounted with the deployment's list. */
    const mounted = async (appList?: unknown) => {
      const served = structuredClone(config);
      if (appList === undefined) delete served.features.console.appList;
      else served.features.console.appList = appList;
      const mount = await mountConsole({
        hash: '',
        answers: server => {
          server.get('/api/v1/config').reply(200, served);
        },
      });
      await settled(mount.root);
      return mount;
    };

    it('should offer the applications in a grid the button opens, before Sign out', async () => {
      const { root } = await mounted(workplace);
      const toggle = root.querySelector<HTMLButtonElement>(
        '.dc-header [data-apps-toggle]'
      );
      const menu = root.querySelector<HTMLElement>('#dc-apps-menu');
      expect(toggle?.textContent?.trim()).to.equal('Applications');
      expect(toggle?.getAttribute('aria-controls')).to.equal('dc-apps-menu');
      expect(toggle?.getAttribute('aria-expanded')).to.equal('false');
      expect(menu?.hidden).to.equal(true);
      toggle?.click();
      expect(menu?.hidden).to.equal(false);
      expect(toggle?.getAttribute('aria-expanded')).to.equal('true');
      const links = Array.from(
        menu?.querySelectorAll<HTMLAnchorElement>('a') ?? []
      );
      expect(links.map(link => link.textContent)).to.deep.equal([
        'Calendar',
        'MMail',
      ]);
      expect(links.map(link => link.getAttribute('href'))).to.deep.equal([
        'https://calendar.twake.local/',
        'https://mail.twake.local/',
      ]);
      // An icon when the deployment gives one, its initial otherwise; the
      // name says what the link is either way.
      expect(links[0].querySelector('img')?.getAttribute('alt')).to.equal('');
      expect(
        links[1].querySelector('[aria-hidden="true"]')?.textContent
      ).to.equal('M');
      // Opened, the first application has the focus.
      expect(document.activeElement).to.equal(links[0]);
      // Escape closes it and gives the focus back to the button.
      press('Escape');
      expect(menu?.hidden).to.equal(true);
      expect(toggle?.getAttribute('aria-expanded')).to.equal('false');
      expect(document.activeElement).to.equal(toggle);
    });

    it('should close the grid when the focus leaves it', async () => {
      const { root } = await mounted(workplace);
      const toggle =
        root.querySelector<HTMLButtonElement>('[data-apps-toggle]');
      const menu = root.querySelector<HTMLElement>('#dc-apps-menu');
      toggle?.click();
      expect(menu?.hidden).to.equal(false);
      root.querySelector<HTMLElement>('[data-main]')?.focus();
      expect(menu?.hidden).to.equal(true);
    });

    it('should keep the grid open under a press on it, as Safari focuses nothing, and close it on a press elsewhere', async () => {
      const { root } = await mounted(workplace);
      const toggle =
        root.querySelector<HTMLButtonElement>('[data-apps-toggle]');
      const menu = root.querySelector<HTMLElement>('#dc-apps-menu');
      const link = menu?.querySelector('a');
      toggle?.click();
      // Safari, pressing a link: the focus goes nowhere, and the click still
      // has to land on the link.
      link?.dispatchEvent(
        new FocusEvent('focusout', { bubbles: true, relatedTarget: null })
      );
      link?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
      expect(menu?.hidden).to.equal(false);
      root
        .querySelector('[data-main]')
        ?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
      expect(menu?.hidden).to.equal(true);
      // The button closes it too, once opened again.
      toggle?.click();
      expect(menu?.hidden).to.equal(false);
      toggle?.click();
      expect(menu?.hidden).to.equal(true);
      expect(toggle?.getAttribute('aria-expanded')).to.equal('false');
    });

    it('should close the grid on Escape, and leave an open panel alone', async () => {
      const { root } = await mounted(workplace);
      const panel = root.querySelector<HTMLElement>('[data-panel]');
      if (panel) panel.hidden = false;
      root.querySelector<HTMLButtonElement>('[data-apps-toggle]')?.click();
      expect(press('Escape')).to.equal(true);
      expect(root.querySelector<HTMLElement>('#dc-apps-menu')?.hidden).to.equal(
        true
      );
      expect(panel?.hidden).to.equal(false);
    });

    it('should show the initial of an application whose icon does not load', async () => {
      const { root } = await mounted([
        { name: '🗓 Agenda', link: '/agenda', icon: '/missing.svg' },
      ]);
      const link = root.querySelector('#dc-apps-menu a');
      // Said by the browser once the fetch failed: dispatched, not waited for.
      link?.querySelector('img')?.dispatchEvent(new Event('error'));
      await until(() => !!link?.querySelector('.dc-apps-initial'));
      expect(link?.querySelector('img')).to.equal(null);
      // A whole character, not half of a surrogate pair.
      expect(link?.querySelector('.dc-apps-initial')?.textContent).to.equal(
        '🗓'
      );
    });

    it('should keep the button across a change of language, its name in the new one', async () => {
      const { root } = await mounted(workplace);
      const select = root.querySelector<HTMLSelectElement>('[data-language]');
      if (!select) throw new Error('no language');
      select.value = 'mn';
      select.dispatchEvent(new Event('change', { bubbles: true }));
      await settled(root);
      const toggle =
        root.querySelector<HTMLButtonElement>('[data-apps-toggle]');
      expect(root.querySelectorAll('[data-apps-toggle]')).to.have.length(1);
      expect(toggle?.textContent?.trim()).to.equal('Програмууд');
      toggle?.click();
      expect(root.querySelector<HTMLElement>('#dc-apps-menu')?.hidden).to.equal(
        false
      );
    });

    it('should offer no button inside the Home, whose bar lists the applications', async () => {
      const own = Object.getOwnPropertyDescriptor(window, 'top');
      Object.defineProperty(window, 'top', {
        configurable: true,
        get: () => ({}),
      });
      try {
        const { root } = await mounted(workplace);
        expect(root.querySelector('[data-apps]')).to.equal(null);
      } finally {
        if (own) Object.defineProperty(window, 'top', own);
        else delete (window as { top?: unknown }).top;
      }
    });

    it('should offer no button without applications', async () => {
      for (const appList of [
        undefined,
        [],
        [{ name: 'Evil', link: 'javascript:x' }],
      ]) {
        const { root, unmount } = await mounted(appList);
        expect(root.querySelector('[data-apps]')).to.equal(null);
        unmount();
      }
    });
  });
});
