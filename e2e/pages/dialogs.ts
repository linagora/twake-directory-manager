import { expect, type Locator, type Page } from '@playwright/test';

/**
 * Reset password, in the side panel: a password to set or none to generate
 * one, then the generated one in the same panel
 */
export class ResetPasswordDialog {
  readonly dialog: Locator;
  readonly title: Locator;
  readonly passwordInput: Locator;
  readonly hint: Locator;
  readonly forceChange: Locator;
  readonly confirmButton: Locator;
  readonly cancelButton: Locator;
  /** The generated password, read-only */
  readonly generated: Locator;
  readonly generatedHelp: Locator;
  readonly copyButton: Locator;
  readonly doneButton: Locator;
  /** Asked before closing with the password uncopied */
  readonly leavePrompt: Locator;
  readonly leaveBack: Locator;
  readonly leaveClose: Locator;

  constructor(page: Page) {
    this.dialog = page.getByRole('dialog');
    this.title = this.dialog.getByRole('heading', { level: 2 });
    this.passwordInput = this.dialog.locator('#dc-new-password');
    this.hint = this.dialog.locator('#dc-new-password-hint');
    this.forceChange = this.dialog.locator('#dc-force-change');
    this.confirmButton = this.dialog.locator('button[type=submit]');
    this.cancelButton = this.dialog.locator('[data-cancel]');
    this.generated = this.dialog.locator('#dc-generated-password');
    this.generatedHelp = this.dialog.locator('#dc-generated-password-help');
    this.copyButton = this.dialog.locator('[data-copy-password]');
    this.doneButton = this.dialog.locator('[data-done]');
    this.leavePrompt = this.dialog.locator('[data-leave]');
    this.leaveBack = this.dialog.locator('[data-leave-back]');
    this.leaveClose = this.dialog.locator('[data-leave-close]');
  }

  async expectOpen(): Promise<void> {
    await expect(this.dialog).toBeVisible();
    await expect(this.passwordInput).toBeVisible();
  }

  /** Close the generated password without copying it, as asked */
  async closeUncopied(): Promise<void> {
    await this.doneButton.click();
    await this.leaveClose.click();
    await expect(this.dialog).toBeHidden();
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
