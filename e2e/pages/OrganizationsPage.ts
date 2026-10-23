import { expect, type Locator, type Page } from '@playwright/test';

import { EntryPage, exactly } from './EntryPage';

/**
 * The Organizations screen: the tree on the left (Filter box, ▸ / ▾ toggles, a **+** per
 * organization), the card of the selected organization on the right. A filter of two letters
 * or more lists the organizations of the whole tree by path in place of the tree.
 */
export class OrganizationsPage {
  readonly page: Page;
  readonly tree: Locator;
  readonly filter: Locator;
  /** The selected organization's card, or "Select an organization" */
  readonly detail: Locator;
  readonly card: EntryPage;
  readonly selected: Locator;
  /** What a filter of two letters or more found in the whole tree, by path */
  readonly results: Locator;
  /** What the tree says in place of a list: loading, or that nothing matches */
  readonly notice: Locator;

  constructor(page: Page) {
    this.page = page;
    this.tree = page.locator('[data-tree]');
    this.filter = this.tree.getByRole('searchbox');
    this.detail = page.locator('[data-org-detail]');
    this.card = new EntryPage(page, this.detail);
    this.selected = this.tree.locator(
      'li.dc-selected > .dc-tree-row .dc-tree-label'
    );
    this.results = this.tree.locator('[data-found]');
    this.notice = this.tree.locator('[data-tree-list] > .dc-empty');
  }

  /** An organization the filter found, by its path */
  result(path: string): Locator {
    return this.results.filter({ hasText: exactly(path) });
  }

  /** The node of an organization, by its name: its row and, when open, its children */
  node(name: string): Locator {
    return this.tree.locator('li.dc-tree-node').filter({
      has: this.page.locator(':scope > .dc-tree-row .dc-tree-label', {
        hasText: exactly(name),
      }),
    });
  }

  /** The name of an organization in the tree, which selects it */
  label(name: string): Locator {
    return this.node(name).locator(':scope > .dc-tree-row .dc-tree-label');
  }

  /** ▸ / ▾ before the name; "·" once opened without children */
  toggle(name: string): Locator {
    return this.node(name).locator(':scope > .dc-tree-row .dc-tree-toggle');
  }

  /** The **+** of a row, "New organization here" */
  addButton(name: string): Locator {
    return this.node(name).locator(':scope > .dc-tree-row .dc-tree-add');
  }

  /** The "Transit" tag of a row */
  tag(name: string): Locator {
    return this.node(name).locator(':scope > .dc-tree-row .dc-tag');
  }

  /** The names of the children shown under an open organization */
  children(name: string): Locator {
    return this.node(name).locator(
      ':scope > ul > li > .dc-tree-row .dc-tree-label'
    );
  }

  /** The names of every organization shown in the tree, in order */
  names(): Locator {
    return this.tree.locator('.dc-tree-label');
  }

  async expand(name: string): Promise<void> {
    const toggle = this.toggle(name);
    if ((await toggle.getAttribute('aria-expanded')) !== 'true')
      await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  }

  /** Selects an organization and waits for its card */
  async select(name: string): Promise<EntryPage> {
    await this.label(name).click();
    await expect(this.card.heading).toHaveText(exactly(name));
    return this.card;
  }
}
