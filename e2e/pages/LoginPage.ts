import { expect, type Locator, type Page } from '@playwright/test';

import type { Account } from '../support/accounts';
import { CONSOLE_PATH } from '../support/env';
import { ConsolePage } from './ConsolePage';

/**
 * The Dex login form (LDAP connector, "Username" prompt) the console's server sends a browser
 * without a session to. The console keeps its session in a cookie of its server: a reload
 * stays signed in.
 */
export class LoginPage {
  readonly page: Page;
  readonly heading: Locator;
  readonly usernameInput: Locator;
  readonly passwordInput: Locator;
  readonly submitButton: Locator;

  constructor(page: Page) {
    this.page = page;
    this.heading = page.getByRole('heading', {
      name: 'Log in to Your Account',
    });
    this.usernameInput = page.getByRole('textbox', { name: 'username' });
    this.passwordInput = page.getByRole('textbox', { name: 'Password' });
    this.submitButton = page.getByRole('button', { name: 'Login' });
  }

  /** Fills the Dex form, which must be on screen */
  async submit(account: Pick<Account, 'uid' | 'password'>): Promise<void> {
    await this.usernameInput.fill(account.uid);
    await this.passwordInput.fill(account.password);
    await this.submitButton.click();
  }

  async expectShown(): Promise<void> {
    await expect(this.page).toHaveURL(/^http:\/\/sso:\d+\//);
    await expect(this.usernameInput).toBeVisible();
  }

  /**
   * Opens the console, signs in on Dex and waits for the console, then opens `hash` (`users/alice`;
   * the overview by default): `const app = await new LoginPage(page).loginAs(ADMIN)`. The
   * sign-in comes back to the console's path, not to its `#/…` address (AUTH-03).
   */
  async loginAs(account: Account, hash = ''): Promise<ConsolePage> {
    const app = new ConsolePage(this.page);
    // Chromium aborts a navigation with net::ERR_NETWORK_CHANGED when the host gets a new
    // network interface, which a Docker host does whenever a bridge is created: start again,
    // the Dex session signs in silently if the form was already submitted
    await expect(async () => {
      await this.page.goto(CONSOLE_PATH);
      await expect(this.usernameInput.or(app.banner)).toBeVisible({
        timeout: 10_000,
      });
      if (await this.usernameInput.isVisible()) await this.submit(account);
      await app.expectLoaded();
    }).toPass({ timeout: 60_000 });
    if (hash) await app.open(hash);
    return app;
  }
}
