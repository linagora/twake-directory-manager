import { expect, type Locator, type Page } from '@playwright/test';

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** The accessible name of a field: its label, with " *" when required */
function labelled(label: string): RegExp {
  return new RegExp(`^${escapeRegExp(label)}( \\*)?$`);
}

/**
 * The create / edit form of the side panel (a modal dialog named "New user", "Edit — bob"…).
 *
 * Fields are found by their label. A creation form folds the optional fields under "Optional
 * fields (N)": every method opens the fold first. Pickers (Department, Delegates, Members,
 * Owners, Managers…) are comboboxes searching after 3 characters, whose choices become tokens.
 */
export class FormPanel {
  readonly page: Page;
  readonly dialog: Locator;
  readonly title: Locator;
  readonly closeButton: Locator;
  readonly cancelButton: Locator;
  /** Create or Save */
  readonly submitButton: Locator;
  /** "Fields marked with * are required", above the fields */
  readonly requiredLegend: Locator;
  readonly optionalFold: Locator;

  constructor(page: Page) {
    this.page = page;
    this.dialog = page.getByRole('dialog');
    this.title = this.dialog.getByRole('heading', { level: 2 });
    this.closeButton = this.dialog.locator('[data-panel-close]');
    this.cancelButton = this.dialog.locator('form [data-cancel]');
    this.submitButton = this.dialog.locator('form button[type=submit]');
    this.requiredLegend = this.dialog.locator('.dc-form-required');
    this.optionalFold = this.dialog.locator('details[data-optional]');
  }

  async expectOpen(title: string | RegExp): Promise<void> {
    await expect(this.dialog).toBeVisible();
    await expect(this.title).toHaveText(title);
    // the selects of reference data are filled after the form is drawn
    await expect(this.dialog.locator('[aria-busy=true]')).toHaveCount(0);
  }

  async expectClosed(): Promise<void> {
    await expect(this.dialog).toBeHidden();
  }

  /** Opens "Optional fields (N)" when the form folds some */
  async unfold(): Promise<void> {
    if ((await this.optionalFold.count()) === 0) return;
    if (await this.optionalFold.evaluate(d => (d as HTMLDetailsElement).open))
      return;
    await this.optionalFold.locator('summary').click();
  }

  /** Whether "Optional fields (N)" is open; never opens it */
  async isUnfolded(): Promise<boolean> {
    return this.optionalFold.evaluate(d => (d as HTMLDetailsElement).open);
  }

  /** Opens or closes "Optional fields (N)", as a click on its summary does */
  async toggleFold(): Promise<void> {
    await this.optionalFold.locator('summary').click();
  }

  /**
   * The control of a field by its label, without opening the fold: for what the form does by
   * itself (a value it writes, a fold it opens)
   */
  control(label: string): Locator {
    return this.dialog.getByLabel(labelled(label));
  }

  /** The control of a field (textbox, select, picker), by its label */
  async field(label: string): Promise<Locator> {
    await this.unfold();
    return this.dialog.getByLabel(labelled(label));
  }

  /** The block of a field: label, control, tokens, hint, error */
  container(label: string): Locator {
    return this.dialog.locator('.dc-field').filter({
      has: this.page.getByLabel(labelled(label)),
    });
  }

  /** The red message under a field */
  error(label: string): Locator {
    return this.container(label).locator('[data-error]');
  }

  /** The red messages shown */
  errors(): Locator {
    return this.dialog.locator('[data-error]:not([hidden])');
  }

  /** The grey hint under a field */
  hint(label: string): Locator {
    return this.container(label).locator('p.dc-hint:not([data-error])');
  }

  async fill(label: string, value: string): Promise<void> {
    await (await this.field(label)).fill(value);
  }

  async fillAll(values: Record<string, string>): Promise<void> {
    for (const [label, value] of Object.entries(values))
      await this.fill(label, value);
  }

  /** Picks an option of a select field, by its text */
  async select(label: string, option: string): Promise<void> {
    await (await this.field(label)).selectOption({ label: option });
  }

  // ------------------------------------------------------------------ tokens and pickers

  /** The values of a multi-valued field or a picker, shown as tokens: their text */
  tokens(label: string): Locator {
    return this.container(label).locator('.dc-token > span');
  }

  /** A token: its text, the value in its title, its × button */
  token(label: string, text: string): Locator {
    return this.container(label).locator('.dc-token').filter({ hasText: text });
  }

  async removeToken(label: string, text: string): Promise<void> {
    await this.token(label, text).getByRole('button').click();
  }

  /** Adds a value to a multi-valued text field (Email aliases, Phone…): typed, then Enter */
  async addValue(label: string, value: string): Promise<void> {
    const input = await this.field(label);
    await input.fill(value);
    await input.press('Enter');
    await expect(this.token(label, value)).toBeVisible();
  }

  /** The suggestions of a picker */
  options(label: string): Locator {
    return this.container(label).getByRole('option');
  }

  /** The listbox of a picker, with its options or a message ("Press Enter to add this DN") */
  suggestions(label: string): Locator {
    return this.container(label).getByRole('listbox');
  }

  /** Types in a picker key by key, as a person does (the search starts at 3 characters) */
  async type(label: string, text: string): Promise<void> {
    const input = await this.field(label);
    await input.fill('');
    await input.pressSequentially(text, { delay: 30 });
  }

  /** Searches a picker and clicks the suggestion `option` */
  async pick(
    label: string,
    query: string,
    option: string | RegExp
  ): Promise<void> {
    await this.type(label, query);
    await this.options(label)
      .filter({ hasText: typeof option === 'string' ? option : option })
      .first()
      .click();
  }

  /** The suggestion the arrow keys are on */
  activeOption(label: string): Locator {
    return this.container(label).locator('[role=option][aria-selected=true]');
  }

  /** Searches a picker, goes down the suggestions with the arrow keys to `option`, then Enter */
  async chooseWithKeyboard(
    label: string,
    query: string,
    option: string
  ): Promise<void> {
    await this.type(label, query);
    const wanted = this.options(label).filter({ hasText: option }).first();
    await expect(wanted).toBeVisible();
    const input = await this.field(label);
    const count = await this.options(label).count();
    for (let i = 0; i <= count; i++) {
      if ((await wanted.getAttribute('aria-selected')) === 'true') break;
      await input.press('ArrowDown');
    }
    await expect(wanted).toHaveAttribute('aria-selected', 'true');
    await input.press('Enter');
  }

  // ------------------------------------------------------------------ actions

  async submit(): Promise<void> {
    await this.submitButton.click();
  }

  async cancel(): Promise<void> {
    await this.cancelButton.click();
    await this.expectClosed();
  }
}
