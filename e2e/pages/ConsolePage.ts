import { expect, type Locator, type Page } from '@playwright/test';

import { CONSOLE_PATH } from '../support/env';
import { EntryPage } from './EntryPage';
import { FormPanel } from './FormPanel';
import { ImportPanel } from './ImportPanel';
import { ListPage } from './ListPage';
import { OrganizationsPage } from './OrganizationsPage';
import { PoliciesPage } from './PoliciesPage';

/**
 * The console's frame (sidebar, scope banner, main area, side panel, toast) and its overview.
 *
 * The console exposes no `data-testid`: everything is located by role and accessible name, in
 * English, the default language. Methods taking a name accept the French or Mongolian one too,
 * for the language cases. The toast, which has no role (toasts-not-announced-to-screen-readers),
 * is the one element found by its class.
 */
export class ConsolePage {
  readonly page: Page;
  readonly sidebar: Locator;
  readonly nav: Locator;
  /** The names of the visible entries of the sidebar, in order */
  readonly navLabels: Locator;
  /** The Language select at the bottom of the sidebar */
  readonly languageSelect: Locator;
  /** The scope banner above the main area */
  readonly banner: Locator;
  /** One item per administered branch: name, then rights */
  readonly scopeBranches: Locator;
  /** "Transit", or "Transit (2)" when entries wait there */
  readonly transitLink: Locator;
  /** Waiting in transit (N), on the Overview, when entries wait there */
  readonly transitWaiting: Locator;
  readonly signOutLink: Locator;
  readonly main: Locator;
  readonly mainHeading: Locator;
  /** The side panel (create, edit, import, reset password, claim) */
  readonly panel: Locator;
  readonly toast: Locator;
  readonly errorToast: Locator;
  /** The plain notice of an account that administers nothing */
  readonly nothingToManage: Locator;

  constructor(page: Page) {
    this.page = page;
    this.sidebar = page.getByRole('complementary');
    this.nav = this.sidebar.getByRole('navigation');
    this.navLabels = this.nav
      .locator('.dc-nav-label, [data-nav-toggle] > span:first-child')
      .filter({ visible: true });
    this.languageSelect = this.sidebar.getByRole('combobox');
    this.banner = page.locator('.dc-header');
    this.scopeBranches = this.banner.getByRole('listitem');
    this.transitLink = this.banner.getByRole('link', { name: 'Transit' });
    this.transitWaiting = page.locator('[data-transit-section]');
    this.signOutLink = this.banner.getByRole('link').last();
    this.main = page.getByRole('main');
    this.mainHeading = this.main.getByRole('heading', { level: 1 });
    this.panel = page.getByRole('dialog');
    this.toast = page.locator('[data-toast]');
    this.errorToast = page.locator('[data-toast].dc-toast-error');
    this.nothingToManage = this.main.getByText(
      'You administer no branch: there is nothing here for you to manage.',
      { exact: true }
    );
  }

  /** The console is signed in and drew its frame */
  async expectLoaded(): Promise<void> {
    await expect(this.page).toHaveURL(new RegExp(`${CONSOLE_PATH}`));
    await expect(this.banner).toBeVisible();
    await expect(this.languageSelect).toBeVisible();
  }

  /** Opens an address of the console (`users/alice`, `groups`, '' for the overview) */
  async open(hash: string): Promise<void> {
    await expect(async () => {
      await this.page.goto(`${CONSOLE_PATH}#/${hash}`);
      await this.expectLoaded();
    }).toPass({ timeout: 45_000 });
  }

  /** Full reload: the session cookie keeps the console signed in on the same address */
  async reload(): Promise<void> {
    await expect(async () => {
      await this.page.reload();
      await this.expectLoaded();
    }).toPass({ timeout: 45_000 });
  }

  // ------------------------------------------------------------------ sidebar

  /** An entry of the sidebar: Overview, Users, … or a reference data list once opened */
  navItem(name: string): Locator {
    return this.nav.getByRole('button', { name, exact: true });
  }

  /** The heading of the Reference data section, which opens and closes it */
  referenceToggle(name = 'Reference data'): Locator {
    return this.nav.getByRole('button', { name, exact: true });
  }

  async setLanguage(code: 'en' | 'fr' | 'mn'): Promise<void> {
    await this.languageSelect.selectOption(code);
    await expect(this.languageSelect).toHaveValue(code);
  }

  // ------------------------------------------------------------------ banner

  /** The branch of the banner named `name` ("Sales"), its title holding its path */
  scopeBranch(name: string): Locator {
    return this.scopeBranches.filter({
      has: this.page.getByText(name, { exact: true }),
    });
  }

  // ------------------------------------------------------------------ overview

  /** A card of the overview, by its heading (Users, Groups, Organizations) */
  card(name: string): Locator {
    return this.main.getByRole('listitem').filter({
      has: this.page.getByRole('heading', { name, exact: true, level: 3 }),
    });
  }

  /**
   * The overview of an account administering nothing: one message naming it, a Sign out
   * button, a grey dot in the banner, and nothing to open in the sidebar but the overview
   */
  async expectNoRights(name: string): Promise<void> {
    const block = this.main.locator('[data-no-rights]');
    await expect(
      block.getByRole('heading', {
        name: 'There is nothing for you to manage here',
      })
    ).toBeVisible();
    await expect(block).toContainText(
      `Your account (${name}) does not administer any part of the directory.`
    );
    await expect(block.getByRole('link', { name: 'Sign out' })).toBeVisible();
    await expect(this.main.getByRole('heading', { level: 3 })).toHaveCount(0);
    await expect(
      this.main.getByRole('heading', { name: 'What you can manage' })
    ).toHaveCount(0);
    await expect(this.navLabels).toHaveText(['Overview']);
    // the green of "all is well" is #1d8540, rgb(29, 133, 64)
    const dot = await this.banner
      .locator('.dc-scope-empty')
      .evaluate(badge => getComputedStyle(badge, '::before').backgroundColor);
    expect(dot).not.toBe('rgb(29, 133, 64)');
  }

  /** A reference data link of the overview (Positions, Titles…) */
  referenceLink(name: string): Locator {
    return this.main.getByRole('button', { name, exact: true });
  }

  // ------------------------------------------------------------------ screens

  /** The list of the main area (users, groups, reference data) */
  list(): ListPage {
    return new ListPage(this.page);
  }

  /** The card of the main area (an account, a group, a reference entry) */
  entry(): EntryPage {
    return new EntryPage(this.page, this.main);
  }

  organizations(): OrganizationsPage {
    return new OrganizationsPage(this.page);
  }

  /** Reference data → Password policies */
  policies(): PoliciesPage {
    return new PoliciesPage(this.page);
  }

  /** The create / edit form of the side panel */
  form(): FormPanel {
    return new FormPanel(this.page);
  }

  importPanel(): ImportPanel {
    return new ImportPanel(this.page);
  }

  /** Opens Users, Groups… from the sidebar and waits for its list */
  async openList(name: string): Promise<ListPage> {
    await this.navItem(name).click();
    await expect(this.mainHeading).toHaveText(name);
    return this.list();
  }

  /** Opens the card of `users/alice`, `groups/sales-team`… by its address */
  async openEntry(hash: string): Promise<EntryPage> {
    await this.open(hash);
    const entry = this.entry();
    await expect(entry.heading).toBeVisible();
    return entry;
  }

  async openOrganizations(dn?: string): Promise<OrganizationsPage> {
    await this.open(
      dn === undefined
        ? 'organizations'
        : `organizations/${encodeURIComponent(dn)}`
    );
    const organizations = this.organizations();
    await expect(organizations.tree).toBeVisible();
    return organizations;
  }

  /** Waits for a confirmation toast (or a red one with `error`) */
  async expectToast(text: string | RegExp, error = false): Promise<void> {
    const toast = error ? this.errorToast : this.toast;
    await expect(toast).toBeVisible();
    await expect(toast).toHaveText(text);
  }
}
