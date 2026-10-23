import { expect, type Locator, type Page } from '@playwright/test';

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** A whole text, nothing before nor after */
export function exactly(text: string): RegExp {
  return new RegExp(`^\\s*${escapeRegExp(text)}\\s*$`);
}

/**
 * The card of one entry: an account, a group, an organization (beside the tree) or a reference
 * entry. Its header holds the name (an account's full name), the "In transit" tag, the identifier
 * and the address under the name, and the actions — Hand over and Delete in a **More** menu;
 * **Details** lists the fields as description lists under headings, the empty ones folded under
 * "Show empty fields (N)" and the DN under "Technical details"; a related section (Groups, Members,
 * Attached entries) lists links to other cards. An account's Groups says each group's type, and
 * offers Add to a group… and a × on each group the administrator writes.
 */
export class EntryPage {
  readonly page: Page;
  readonly article: Locator;
  /** The name of the entry, with "In transit" after it when it is */
  readonly heading: Locator;
  readonly transitTag: Locator;
  /** Under the name: "alice · alice@example.com" */
  readonly subtitle: Locator;
  /** Back to the list, above the card */
  readonly backButton: Locator;
  /** Change state…, which opens the panel offering the states */
  readonly changeState: Locator;
  /** The panel Change state… opens */
  readonly statePanel: Locator;
  /** More, the menu holding Hand over and Delete */
  readonly moreButton: Locator;
  readonly moreMenu: Locator;
  /** Show empty fields (N), folding the fields that hold nothing */
  readonly emptyFields: Locator;
  /** Technical details, folding the DN */
  readonly technical: Locator;
  readonly dn: Locator;
  readonly copyButton: Locator;
  /** The plain message standing for a card that cannot be shown */
  readonly notice: Locator;

  constructor(page: Page, scope: Locator) {
    this.page = page;
    this.article = scope.getByRole('article');
    this.heading = this.article.getByRole('heading', { level: 2 });
    this.transitTag = this.heading.locator('.dc-tag-transit');
    this.subtitle = this.article.locator('[data-subtitle]');
    this.backButton = scope.getByRole('button', { name: 'Back', exact: true });
    this.changeState = this.article.locator('[data-status]');
    this.statePanel = page.getByRole('dialog');
    this.moreButton = this.article.locator('[data-more]');
    this.moreMenu = this.article.locator('[data-more-menu]');
    this.emptyFields = this.article.locator('details[data-empty]');
    this.technical = this.article.locator('details[data-technical]');
    this.dn = this.technical.locator('code');
    this.copyButton = this.dn.locator('xpath=following-sibling::button[1]');
    this.notice = scope.locator('p.dc-empty');
  }

  /**
   * An action of the header — Edit, Claim…, Reset password, Change state… — or of its More
   * menu — Hand over, Delete —, found whether the menu is open or not. Click it with `perform()`.
   */
  action(name: string): Locator {
    const actions = this.article.locator('.dc-detail-actions');
    return actions.getByRole('button', { name, exact: true }).or(
      actions.getByRole('menuitem', {
        name,
        exact: true,
        includeHidden: true,
      })
    );
  }

  /** Clicks an action, opening the More menu first when it sits there */
  async perform(name: string): Promise<void> {
    const action = this.action(name);
    await action.waitFor({ state: 'attached' });
    if (
      (await action.getAttribute('role')) === 'menuitem' &&
      !(await action.isVisible())
    )
      await this.openMore();
    await action.click();
  }

  /** Opens the More menu */
  async openMore(): Promise<void> {
    if ((await this.moreButton.getAttribute('aria-expanded')) !== 'true')
      await this.moreButton.click();
    await expect(this.moreMenu).toBeVisible();
  }

  /** The buttons of the header, in order, More included and its items left out */
  actions(): Locator {
    return this.article.locator('.dc-detail-actions').getByRole('button');
  }

  /** The items of the More menu, in order, whether it is open or not */
  moreActions(): Locator {
    return this.moreMenu.getByRole('menuitem', { includeHidden: true });
  }

  /** Opens "Show empty fields (N)", so that the empty fields can be read */
  async showEmptyFields(): Promise<void> {
    if ((await this.emptyFields.getAttribute('open')) === null)
      await this.emptyFields.locator('summary').click();
  }

  /** Opens "Technical details", where the DN and its Copy button are */
  async showTechnicalDetails(): Promise<void> {
    if ((await this.technical.getAttribute('open')) === null)
      await this.technical.locator('summary').click();
    await expect(this.dn).toBeVisible();
  }

  /** The value of a field of Details, by its label */
  detail(label: string): Locator {
    return this.article
      .getByRole('term')
      .filter({ hasText: exactly(label) })
      .locator('xpath=following-sibling::dd[1]');
  }

  /**
   * The label of a field folded under "Show empty fields", whether the fold is open or not: a
   * field holding nothing is found there, and only there
   */
  emptyField(label: string): Locator {
    return this.emptyFields.locator('dt').filter({ hasText: exactly(label) });
  }

  /** The labels of Details, in order, those folded away left out */
  detailLabels(): Locator {
    return this.article.getByRole('term');
  }

  /** The headings Details groups its fields under, in order, those folded away left out */
  detailGroups(): Locator {
    return this.article
      .locator('.dc-detail-group h4')
      .filter({ visible: true });
  }

  /** The card of the entry with this identifier, whatever its name */
  async expectIdentifier(id: string): Promise<void> {
    await expect(this.subtitle).toHaveText(
      new RegExp(`^\\s*${escapeRegExp(id)}(\\s+·|\\s*$)`)
    );
  }

  /** A related section (Groups, Members, Attached entries), by its heading */
  related(heading: string): Locator {
    return this.article.locator('section').filter({
      has: this.page.getByRole('heading', { name: heading, exact: true }),
    });
  }

  /** The entries of a related section, a group with its type and its × */
  relatedItems(heading: string): Locator {
    return this.related(heading).getByRole('listitem');
  }

  /** The names of a related section's entries, each a link to its card */
  relatedLinks(heading: string): Locator {
    return this.related(heading).locator('[data-relation]');
  }

  /** The type said after each group of an account's Groups: "· Shared mailbox" */
  groupTypes(heading = 'Groups'): Locator {
    return this.related(heading).locator('.dc-relation-note');
  }

  /** Add to a group…, beside the heading of an account's Groups */
  addToGroup(): Locator {
    return this.article.locator('[data-add-groups]');
  }

  /** The × taking the account out of a group, named "Remove from {group}" */
  leaveGroup(group: string): Locator {
    return this.article.getByRole('button', {
      name: `Remove from ${group}`,
      exact: true,
    });
  }

  async expectName(name: string): Promise<void> {
    await expect(this.heading).toHaveText(exactly(name));
  }

  /** The states the Change state panel offers, by their names */
  stateChoices(): Locator {
    return this.statePanel.getByRole('radio');
  }

  /** One state of the Change state panel, by its name */
  stateChoice(state: string): Locator {
    return this.statePanel.getByRole('radio', { name: state, exact: true });
  }

  /**
   * Changes the state in the Change state panel (Active, Disabled, No access,
   * To delete): picks it, then presses the button named after the choice.
   */
  async changeStateTo(state: string): Promise<void> {
    await this.changeState.click();
    await this.statePanel
      .getByRole('radio', { name: state, exact: true })
      .check();
    await this.statePanel.locator('button[type=submit]').click();
    await expect(this.statePanel).toBeHidden();
  }
}
