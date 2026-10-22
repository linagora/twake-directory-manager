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
 * entry. Its header holds the name, the "In transit" tag and the actions; **Details** lists the
 * fields as a description list; a related section (Mailing lists, Members, Attached entries)
 * lists links to other cards.
 */
export class EntryPage {
  readonly page: Page;
  readonly article: Locator;
  /** The name of the entry, with "In transit" after it when it is */
  readonly heading: Locator;
  readonly transitTag: Locator;
  /** Back to the list, above the card */
  readonly backButton: Locator;
  readonly changeState: Locator;
  readonly dn: Locator;
  readonly copyButton: Locator;
  /** The plain message standing for a card that cannot be shown */
  readonly notice: Locator;

  constructor(page: Page, scope: Locator) {
    this.page = page;
    this.article = scope.getByRole('article');
    this.heading = this.article.getByRole('heading', { level: 2 });
    this.transitTag = this.heading.locator('.dc-tag-transit');
    this.backButton = scope.getByRole('button', { name: 'Back', exact: true });
    this.changeState = this.article.getByRole('combobox');
    this.dn = this.article.locator('code').first();
    this.copyButton = this.dn.locator('xpath=following-sibling::button[1]');
    this.notice = scope.locator('p.dc-empty');
  }

  /** An action of the header: Edit, Delete, Hand over, Claim…, Reset password */
  action(name: string): Locator {
    return this.article
      .locator('.dc-detail-actions')
      .getByRole('button', { name, exact: true });
  }

  /** The buttons of the header, in order */
  actions(): Locator {
    return this.article.locator('.dc-detail-actions').getByRole('button');
  }

  /** The value of a field of Details, by its label */
  detail(label: string): Locator {
    return this.article
      .getByRole('term')
      .filter({ hasText: exactly(label) })
      .locator('xpath=following-sibling::dd[1]');
  }

  /** The labels of Details, in order */
  detailLabels(): Locator {
    return this.article.getByRole('term');
  }

  /** A related section (Mailing lists, Members, Attached entries), by its heading */
  related(heading: string): Locator {
    return this.article.locator('section').filter({
      has: this.page.getByRole('heading', { name: heading, exact: true }),
    });
  }

  /** The links of a related section */
  relatedItems(heading: string): Locator {
    return this.related(heading).getByRole('listitem');
  }

  async expectName(name: string): Promise<void> {
    await expect(this.heading).toHaveText(exactly(name));
  }

  /** Picks a state in Change state (Enabled, Disabled, No access, To be deleted) */
  async changeStateTo(state: string): Promise<void> {
    await this.changeState.selectOption({ label: state });
  }
}
