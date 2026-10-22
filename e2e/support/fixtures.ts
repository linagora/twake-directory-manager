import { type Page, test as base, expect } from '@playwright/test';

import { type ConsolePage, LoginPage } from '../pages';
import type { Account } from './accounts';
import { Directory, type Organization } from './directory';
import { env } from './env';

/**
 * A branch of the tree of its own: an organization under the root, administered by an account
 * created with it (in it). What a local administrator sees there is the test's only.
 */
export interface Tenant {
  org: Organization;
  admin: Account;
}

/**
 * The fixtures every spec imports instead of `@playwright/test`:
 *
 *   import { test, expect } from '../support/fixtures'
 *
 *   test('USER-05 …', async ({ page, directory }) => { ... })
 */
export interface E2EFixtures {
  /** Entries of the test, written into OpenLDAP and removed after it */
  directory: Directory;
  /** A fresh organization and its local administrator */
  tenant: Tenant;
  /**
   * Signs another account in, in a browser context of its own (its own sessions):
   * `const other = await loginInNewContext(SOPHIE)`. Closed after the test.
   */
  loginInNewContext: (account: Account, hash?: string) => Promise<ConsolePage>;
}

/** What every page of the suite gets; returns the uncaught exceptions it will collect */
function instrument(page: Page): string[] {
  const pageErrors: string[] = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  return pageErrors;
}

export const test = base.extend<E2EFixtures>({
  page: async ({ page }, use) => {
    const pageErrors = instrument(page);
    await use(page);
    // An uncaught exception is a bug whatever the screen shows
    expect(pageErrors, 'uncaught exceptions in the page').toEqual([]);
  },

  loginInNewContext: async ({ browser, contextOptions, viewport }, use) => {
    const opened: { close: () => Promise<void>; errors: string[] }[] = [];
    await use(async (account, hash) => {
      const context = await browser.newContext({
        ...contextOptions,
        baseURL: env.baseUrl,
        locale: 'en-US',
        timezoneId: 'Europe/Paris',
        viewport,
      });
      const page = await context.newPage();
      opened.push({ close: () => context.close(), errors: instrument(page) });
      return new LoginPage(page).loginAs(account, hash);
    });
    for (const { close, errors } of opened) {
      await close();
      expect(errors, 'uncaught exceptions in the other page').toEqual([]);
    }
  },

  // Playwright fixtures receive an empty destructuring pattern when they need no other fixture
  // eslint-disable-next-line no-empty-pattern
  directory: async ({}, use) => {
    const directory = new Directory();
    await use(directory);
    await directory.cleanUp();
  },

  tenant: async ({ directory }, use) => {
    const org = await directory.createOrganization();
    const admin = await directory.createUser({ org, prefix: 'boss' });
    await directory.addValues(org.dn, 'twakeLocalAdminLink', [admin.dn]);
    await use({ org, admin });
  },
});

export { expect };
