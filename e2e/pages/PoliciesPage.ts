import { expect, type Locator, type Page } from '@playwright/test';

import { scanHere } from '../support/a11y';

/**
 * Reference data → Password policies (`#/password-policies`), which only the administrators the
 * server lets read them are offered: the table of OpenLDAP's policies, and the side panel
 * creating or editing one. A policy's fields are found by the ppolicy attribute they edit
 * (`pwdMaxAge`), which every language shows beside the label.
 */
export class PoliciesPage {
  readonly page: Page;
  readonly main: Locator;
  readonly heading: Locator;
  readonly newButton: Locator;
  readonly rows: Locator;
  /** The plain message in place of the table */
  readonly emptyState: Locator;

  constructor(page: Page) {
    this.page = page;
    this.main = page.getByRole('main');
    this.heading = this.main.getByRole('heading', { level: 1 });
    this.newButton = this.main.getByRole('button', {
      name: 'New policy',
      exact: true,
    });
    this.rows = this.main.locator('tr[data-policy]');
    this.emptyState = this.main.locator('p.dc-empty');
  }

  /** The row of a policy, by its name */
  row(cn: string): Locator {
    return this.main.locator(`tr[data-policy="${cn}"]`);
  }

  /** Name, Expires after, Minimum length, Lockout */
  cells(cn: string): Locator {
    return this.row(cn).getByRole('cell');
  }

  /** Opens the panel of a policy */
  async open(cn: string): Promise<PolicyPanel> {
    await this.row(cn).click();
    const panel = new PolicyPanel(this.page);
    await panel.expectOpen(`Password policy ${cn}`);
    return panel;
  }

  async openNew(): Promise<PolicyPanel> {
    await this.newButton.click();
    const panel = new PolicyPanel(this.page);
    await panel.expectOpen('New password policy');
    return panel;
  }
}

/** The side panel creating or editing a password policy */
export class PolicyPanel {
  readonly page: Page;
  readonly dialog: Locator;
  readonly title: Locator;
  /** The name, asked of a new policy only */
  readonly nameInput: Locator;
  /** Create or Save */
  readonly submitButton: Locator;
  readonly deleteButton: Locator;
  readonly cancelButton: Locator;

  constructor(page: Page) {
    this.page = page;
    this.dialog = page.getByRole('dialog');
    this.title = this.dialog.getByRole('heading', { level: 2 });
    this.nameInput = this.dialog.locator('#dc-policy-cn');
    this.submitButton = this.dialog.locator('form button[type=submit]');
    this.deleteButton = this.dialog.locator('[data-delete]');
    this.cancelButton = this.dialog.locator('[data-cancel]');
  }

  async expectOpen(title: string): Promise<void> {
    await expect(this.dialog).toBeVisible();
    await expect(this.title).toHaveText(title);
    await scanHere(this.page);
  }

  /** The block of an attribute's field: label, control, unit, hint, error */
  container(attribute: string): Locator {
    return this.dialog.locator(`[data-field="${attribute}"]`);
  }

  /** The control of an attribute: a number box, a select or a text area */
  control(attribute: string): Locator {
    return this.dialog.locator(`#dc-policy-${attribute}`);
  }

  /** The unit select beside a duration */
  unit(attribute: string): Locator {
    return this.container(attribute).locator('[data-unit]');
  }

  error(attribute: string): Locator {
    return this.container(attribute).locator('[data-error]');
  }

  /** Types an amount, in `unit` for a duration ('days', 'minutes'…) */
  async fill(attribute: string, value: string, unit?: string): Promise<void> {
    await this.control(attribute).fill(value);
    if (unit !== undefined) await this.unit(attribute).selectOption(unit);
  }

  /** Picks an option of a select (Yes, No, Check required…), by its text */
  async select(attribute: string, option: string): Promise<void> {
    await this.control(attribute).selectOption({ label: option });
  }

  async submit(): Promise<void> {
    await this.submitButton.click();
  }
}
