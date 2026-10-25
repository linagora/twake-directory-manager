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

/**
 * The confirmation of what cannot be taken back (a deletion, a hand-over), a centred alert
 * dialog: the question as its heading, what goes with it, Cancel and a button naming the action.
 * Located by the console's `data-*` hooks, whose names do not change with the language.
 */
export class ConfirmDialog {
  readonly dialog: Locator;
  readonly title: Locator;
  /** The paragraphs and the list under the question */
  readonly message: Locator;
  readonly paragraphs: Locator;
  /** The entries of a selection, then "and n more" */
  readonly items: Locator;
  /** The safer way offered instead: set the state to Disabled */
  readonly alternative: Locator;
  /** What to do along with the action: the groups a hand-over leaves */
  readonly choices: Locator;
  readonly choicesLegend: Locator;
  readonly confirmButton: Locator;
  readonly cancelButton: Locator;

  constructor(page: Page) {
    this.dialog = page.getByRole('alertdialog');
    this.title = this.dialog.getByRole('heading', { level: 2 });
    this.message = this.dialog.locator('[data-confirm-body]');
    this.paragraphs = this.message.locator('p');
    this.items = this.message.getByRole('listitem');
    this.alternative = this.dialog.locator('[data-confirm-alternative]');
    this.choices = this.dialog.getByRole('checkbox');
    this.choicesLegend = this.dialog.locator('.dc-confirm-choices legend');
    this.confirmButton = this.dialog.locator('[data-confirm]');
    this.cancelButton = this.dialog.locator('[data-cancel]');
  }

  /** Open, asking `title` when given */
  async expectOpen(title?: string): Promise<void> {
    await expect(this.dialog).toBeVisible();
    if (title !== undefined) await expect(this.title).toHaveText(title);
  }

  /** Confirms, and waits for the dialog to go */
  async confirm(): Promise<void> {
    await this.confirmButton.click();
    await expect(this.dialog).toBeHidden();
  }

  /** Cancels, and waits for the dialog to go */
  async cancel(): Promise<void> {
    await this.cancelButton.click();
    await expect(this.dialog).toBeHidden();
  }
}

/**
 * Add to a group…, in the side panel an account's card opens: a search over the groups the
 * administrator writes, the groups chosen as tokens, and Add
 */
export class AddToGroupsDialog {
  readonly dialog: Locator;
  readonly title: Locator;
  readonly search: Locator;
  /** "Type 3 characters of the group's name", under the search */
  readonly hint: Locator;
  /** The suggestions: "sales-team — Shared mailbox — sales@example.com" */
  readonly options: Locator;
  /** What stands for the suggestions: "Searching…", "No entry matches this search" */
  readonly note: Locator;
  /** The groups chosen, as tokens */
  readonly chosen: Locator;
  /** Why a group chosen was not joined */
  readonly error: Locator;
  readonly addButton: Locator;
  readonly cancelButton: Locator;

  constructor(page: Page) {
    this.dialog = page.getByRole('dialog');
    this.title = this.dialog.getByRole('heading', { level: 2 });
    this.search = this.dialog.getByRole('combobox');
    this.hint = this.dialog.locator('#dc-group-hint');
    this.options = this.dialog.getByRole('option');
    this.note = this.dialog.locator('.dc-picker-note');
    this.chosen = this.dialog.locator('[data-chosen] li');
    this.error = this.dialog.locator('[data-error]');
    this.addButton = this.dialog.locator('[data-add]');
    this.cancelButton = this.dialog.locator('[data-cancel]');
  }

  async expectOpen(title?: string): Promise<void> {
    await expect(this.dialog).toBeVisible();
    await expect(this.search).toBeVisible();
    if (title !== undefined) await expect(this.title).toHaveText(title);
  }

  /** The suggestion of a group, by its name */
  option(group: string): Locator {
    return this.options.filter({
      hasText: new RegExp(
        `^\\s*${group.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}( —|\\s*$)`
      ),
    });
  }

  /** Searches a group by its name and picks it from the suggestions */
  async choose(group: string): Promise<void> {
    await this.search.fill(group);
    await this.option(group).click();
    await expect(this.chosen.filter({ hasText: group })).toBeVisible();
  }
}
