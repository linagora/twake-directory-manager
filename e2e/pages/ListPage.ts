import { expect, type Locator, type Page } from '@playwright/test';

import { exactly } from './EntryPage';

/**
 * The table of an entity: users, groups, a reference data list. Users and groups show nothing
 * until three characters are typed or **List without searching** is clicked; the search is
 * debounced (250 ms), the web-first assertions wait for it.
 */
export class ListPage {
  readonly page: Page;
  readonly main: Locator;
  readonly heading: Locator;
  readonly newButton: Locator;
  readonly importButton: Locator;
  readonly searchBox: Locator;
  /** The "in" select next to Search */
  readonly searchIn: Locator;
  readonly listEverythingButton: Locator;
  /** "Type at least 3 characters to search", with List without searching */
  readonly searchGuard: Locator;
  /** The plain message in place of the table: no match, nothing to show, refusals */
  readonly emptyState: Locator;
  readonly table: Locator;
  readonly columnHeaders: Locator;
  readonly rows: Locator;
  readonly selectAll: Locator;
  /** The bar shown once a row is ticked */
  readonly bulkBar: Locator;
  readonly exportButton: Locator;
  readonly deleteSelectionButton: Locator;
  readonly perPage: Locator;
  /** "1–10 of 10" */
  readonly counter: Locator;
  readonly previousButton: Locator;
  readonly nextButton: Locator;

  constructor(page: Page) {
    this.page = page;
    this.main = page.getByRole('main');
    this.heading = this.main.getByRole('heading', { level: 1 });
    this.newButton = this.main
      .locator('.dc-view-actions')
      .getByRole('button')
      .last();
    this.importButton = this.main.locator('[data-import]');
    this.searchBox = this.main.getByRole('searchbox');
    this.searchIn = this.main.locator('[data-search-attribute]');
    this.listEverythingButton = this.main.locator('[data-list-all]');
    this.searchGuard = this.main.locator('p.dc-empty').filter({
      has: page.locator('[data-list-all]'),
    });
    this.emptyState = this.main.locator('p.dc-empty');
    this.table = this.main.getByRole('table');
    this.columnHeaders = this.table
      .getByRole('columnheader')
      .filter({ hasNot: page.getByRole('checkbox') });
    this.rows = this.table.locator('tbody').getByRole('row');
    this.selectAll = this.table.locator('thead').getByRole('checkbox');
    this.bulkBar = this.main.locator('.dc-bulk');
    this.exportButton = this.bulkBar.getByRole('button').first();
    this.deleteSelectionButton = this.bulkBar.locator('[data-delete-selected]');
    this.perPage = this.main.locator('[data-page-size]');
    this.counter = this.main.locator('.dc-count');
    this.previousButton = this.main.locator('[data-page="-1"]');
    this.nextButton = this.main.locator('[data-page="1"]');
  }

  /** The row whose first column (the identifier, the name) is `id` */
  row(id: string): Locator {
    return this.rows.filter({
      has: this.page.locator('td:nth-child(2)', { hasText: exactly(id) }),
    });
  }

  /** The cells of a row, without the checkbox */
  cells(id: string): Locator {
    return this.row(id)
      .getByRole('cell')
      .filter({
        hasNot: this.page.getByRole('checkbox'),
      });
  }

  /** The identifiers (first column) of the rows shown */
  ids(): Locator {
    return this.rows.locator('td:nth-child(2)');
  }

  /** The rows shown, as objects keyed by column heading */
  async read(): Promise<Record<string, string>[]> {
    await expect(this.table).toBeVisible();
    return this.table.evaluate(table => {
      const headings = Array.from(table.querySelectorAll('thead th')).map(th =>
        (th.textContent ?? '').trim()
      );
      return Array.from(table.querySelectorAll('tbody tr')).map(tr => {
        const row: Record<string, string> = {};
        Array.from(tr.querySelectorAll('td')).forEach((td, index) => {
          const heading = headings[index];
          if (heading) row[heading] = (td.textContent ?? '').trim();
        });
        return row;
      });
    });
  }

  /**
   * The identifiers listed, but the entries in transit, which every administrator sees (and the
   * other tests put there)
   */
  async idsOutsideTransit(): Promise<string[]> {
    const rows = await this.read();
    const first = Object.keys(rows[0] ?? {})[0] ?? '';
    return rows
      .filter(row => row['Department path'] !== 'Transit')
      .map(row => row[first] ?? '');
  }

  rowCheckbox(id: string): Locator {
    return this.row(id).getByRole('checkbox');
  }

  /**
   * Types in Search, with the field to search in when given ("Last name"), and waits for the
   * server's answer to that search: the list drawn before it is not the one to act on.
   */
  async search(text: string, field?: string): Promise<void> {
    if (field !== undefined) await this.searchIn.selectOption({ label: field });
    if (text.length < 3) {
      await this.searchBox.fill(text);
      return;
    }
    const answered = this.page.waitForResponse(
      response => new URL(response.url()).searchParams.get('match') === text
    );
    await this.searchBox.fill(text);
    await answered;
    await expect(this.table.or(this.emptyState)).toBeVisible();
  }

  async listEverything(): Promise<void> {
    await this.listEverythingButton.click();
    await expect(this.table.or(this.emptyState)).toBeVisible();
  }

  /** Opens the card of a row by clicking its identifier */
  async open(id: string): Promise<void> {
    await this.row(id).locator('td:nth-child(2)').click();
  }

  async setPerPage(size: 25 | 50 | 100 | 200): Promise<void> {
    await this.perPage.selectOption(String(size));
  }
}
