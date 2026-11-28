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
import { press } from '../support/act';
import { mountConsole, settled } from '../support/mount';

const origin = 'https://directory.twake.local';
const config = JSON.parse(
  readFileSync(join(__dirname, '..', 'fixtures', 'config.json'), 'utf8')
) as { features: { console: Record<string, unknown> } };

/** Twake Calendar's list, as twake-agent writes it for the Workplace. */
const workplace = [
  {
    name: 'Calendar',
    link: 'https://calendar.twake.local/',
    icon: '/assets/images/svg/app-calendar.svg',
  },
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
