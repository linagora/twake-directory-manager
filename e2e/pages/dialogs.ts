import { expect, type Locator, type Page } from '@playwright/test';

/** Reset password, in the side panel: a password to set or none to generate one */
export class ResetPasswordDialog {
  readonly dialog: Locator;
  readonly passwordInput: Locator;
  readonly hint: Locator;
  readonly forceChange: Locator;
  readonly confirmButton: Locator;
  readonly cancelButton: Locator;

  constructor(page: Page) {
    this.dialog = page.getByRole('dialog');
    this.passwordInput = this.dialog.locator('#dc-new-password');
    this.hint = this.dialog.locator('#dc-new-password-hint');
    this.forceChange = this.dialog.locator('#dc-force-change');
    this.confirmButton = this.dialog.locator('button[type=submit]');
    this.cancelButton = this.dialog.locator('[data-cancel]');
  }

  async expectOpen(): Promise<void> {
    await expect(this.dialog).toBeVisible();
    await expect(this.passwordInput).toBeVisible();
  }
}

/** Claim…, in the side panel: the organization to take an entry in transit into */
export class ClaimDialog {
  readonly dialog: Locator;
  readonly title: Locator;
  readonly target: Locator;
  /** The plain message of an account that writes in no organization */
  readonly noTarget: Locator;
  readonly confirmButton: Locator;
  readonly cancelButton: Locator;

  constructor(page: Page) {
    this.dialog = page.getByRole('dialog');
    this.title = this.dialog.getByRole('heading', { level: 2 });
    this.target = this.dialog.locator('#dc-claim-target');
    this.noTarget = this.dialog.locator('p.dc-empty');
    this.confirmButton = this.dialog.locator('button[type=submit]');
    this.cancelButton = this.dialog.locator('[data-cancel]');
  }

  /** The organizations offered, by their path */
  targets(): Locator {
    return this.target.locator('option');
  }

  async claimInto(path: string): Promise<void> {
    await this.target.selectOption({ label: path });
    await this.confirmButton.click();
    await expect(this.dialog).toBeHidden();
  }
}
