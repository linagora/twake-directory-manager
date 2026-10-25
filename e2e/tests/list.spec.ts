import type { Locator } from '@playwright/test';

import { ConfirmDialog, csv, LoginPage, readDownload } from '../pages';
import { ADMIN, ALICE, SEEDED_UIDS, SOPHIE } from '../support/accounts';
import { TEST_DOMAIN, TRANSIT, uniquePart } from '../support/directory';
import { expect, test } from '../support/fixtures';

const USER_COLUMNS = [
  'Identifier',
  'Employee ID',
  'Full name',
  'Email',
  'Department path',
  'Status',
];

test.describe('LIST lists, search and bulk actions', () => {
  test('LIST-01 users list: three-character search and List without searching', async ({
    page,
  }) => {
    const app = await new LoginPage(page).loginAs(ADMIN, 'users');
    const list = app.list();

    await list.search('al');
    await expect(list.searchGuard).toContainText(
      'Type at least 3 characters to search'
    );
    await expect(list.listEverythingButton).toHaveText(
      'List without searching'
    );
    await expect(list.table).toHaveCount(0);

    await list.search('ali');
    await expect(list.ids()).toHaveText(['alice']);

    await list.search('');
    await list.listEverything();
    await list.setPerPage(200);
    await expect(list.columnHeaders).toHaveText(USER_COLUMNS);
    const rows = await list.read();
    for (const uid of SEEDED_UIDS) {
      const row = rows.find(r => r.Identifier === uid);
      expect(row, uid).toBeDefined();
      expect(row?.Status, uid).toBe(uid === 'frank' ? 'Disabled' : 'Active');
    }
    // An exception shows as a badge, the norm as text (#172)
    await expect(list.cells('frank').locator('.dc-state-disabled')).toHaveText(
      'Disabled'
    );
    await expect(list.cells('alice').locator('.dc-state')).toHaveCount(0);
    await expect(list.cells('alice')).toHaveText([
      'alice',
      'E0010',
      'Alice Moreau',
      'alice@example.com',
      'Sales / France',
      'Active',
    ]);
    // 10 on a stack of its own; the other tests' accounts come and go
    await expect(list.counter).toHaveText(/^1–(\d+) of \1$/);
  });

  test('LIST-02 search scoped to one field', async ({ page }) => {
    const app = await new LoginPage(page).loginAs(ADMIN, 'users');
    const list = app.list();

    await expect(list.searchIn.locator('option')).toHaveText([
      'Every field',
      'Identifier',
      'Employee ID',
      'Common name',
      'Last name',
      'First name',
      'Email',
      // offered apart, kept out of Every field (#166)
      'Department path',
    ]);
    await list.search('Backend', 'Department path');
    await expect(list.ids()).toContainText(['carol', 'frank']);
    await list.search('Moreau', 'Last name');
    await expect(list.ids()).toHaveText(['alice']);
    await list.search('Moreau', 'Identifier');
    await expect(list.emptyState).toHaveText('No entry matches this search');
    await list.search('E002', 'Employee ID');
    await expect(list.ids()).toHaveText(['carol', 'dave', 'frank']);
    await list.search('example.com', 'Every field');
    await list.setPerPage(200);
    for (const uid of SEEDED_UIDS) await expect(list.row(uid)).toBeVisible();
    await list.search('Nguyen', 'Every field');
    await expect(list.ids()).toHaveText(['carol']);
  });

  test('LIST-03 groups list and search', async ({ page }) => {
    const app = await new LoginPage(page).loginAs(ADMIN, 'groups');
    const list = app.list();

    await expect(list.importButton).toHaveCount(0);
    await list.search('sales');
    await expect(list.ids()).toHaveText(['sales-team']);
    await expect(list.columnHeaders).toHaveText([
      'Name',
      'Email',
      'Department path',
      'List type',
    ]);
    await expect(list.cells('sales-team').nth(1)).toHaveText(
      'sales@example.com'
    );
    await expect(list.cells('sales-team').nth(2)).toHaveText('Sales');

    await list.search('');
    await list.listEverything();
    await list.setPerPage(200);
    for (const [cn, mail] of [
      ['all-staff', 'all-staff@lists.example.com'],
      ['sales-team', 'sales@example.com'],
      ['engineering', 'engineering@lists.example.com'],
      ['backend-guild', ''],
    ]) {
      await expect(list.cells(cn).nth(1), cn).toHaveText(mail);
    }

    await list.search('lists.example', 'Email');
    await expect(list.row('all-staff')).toBeVisible();
    await expect(list.row('engineering')).toBeVisible();
    await expect(list.row('sales-team')).toHaveCount(0);
    await expect(list.row('backend-guild')).toHaveCount(0);
  });

  test('LIST-04 paging and remembered page size', async ({
    page,
    directory,
  }) => {
    const { lastName } = await directory.createUsers(27);
    const app = await new LoginPage(page).loginAs(ADMIN, 'users');
    const list = app.list();

    await list.search(lastName, 'Last name');
    await expect(list.perPage.locator('option')).toHaveText([
      '25',
      '50',
      '100',
      '200',
    ]);
    await list.setPerPage(25);
    await expect(list.counter).toHaveText('1–25 of 27');
    await expect(list.rows).toHaveCount(25);
    await expect(list.previousButton).toBeDisabled();
    await expect(list.nextButton).toBeEnabled();
    await list.nextButton.click();
    await expect(list.counter).toHaveText('26–27 of 27');
    await expect(list.rows).toHaveCount(2);
    await expect(list.nextButton).toBeDisabled();
    await list.previousButton.click();
    await expect(list.counter).toHaveText('1–25 of 27');

    await list.setPerPage(50);
    await expect(list.counter).toHaveText('1–27 of 27');
    await app.reload();
    await app.openList('Users');
    await list.search(lastName, 'Last name');
    await expect(list.perPage).toHaveValue('50');
    await expect(list.counter).toHaveText('1–27 of 27');
  });

  test('LIST-05 a deep department path is shortened, whole in its tooltip', async ({
    page,
    directory,
    tenant,
  }) => {
    const lyon = await directory.createOrganization({
      parent: tenant.org.dn,
      name: 'Lyon',
    });
    const center = await directory.createOrganization({
      parent: lyon.dn,
      name: 'Center',
    });
    const user = await directory.createUser({ org: center });
    const app = await new LoginPage(page).loginAs(ADMIN, 'users');
    const list = app.list();

    await list.search(user.uid, 'Identifier');
    const path = list.cells(user.uid).nth(4);
    await expect(path).toHaveText(`${tenant.org.name} / … / ${center.name}`);
    await expect(path).toHaveAttribute('title', center.path);
  });

  test('LIST-06 export the selection as CSV', async ({ page, directory }) => {
    const { lastName, users } = await directory.createUsers(2, {
      extra: { description: 'exported' },
    });
    const formula = await directory.createUser({
      lastName,
      extra: {
        displayName: '=HYPERLINK("x")',
        employeeNumber: `-${uniquePart()}`,
      },
    });
    const app = await new LoginPage(page).loginAs(ADMIN, 'users');
    const list = app.list();
    await list.listEverything();
    await list.setPerPage(200);

    await expect(list.bulkBar).toBeHidden();
    await list.rowCheckbox('alice').check();
    await expect(list.bulkBar).toBeVisible();
    await expect(list.exportButton).toHaveText('Export selection');
    await expect(list.deleteSelectionButton).toHaveText('Delete selection');
    await list.rowCheckbox('bob').check();
    await expect(list.bulkBar).toContainText('2 selected');

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      list.exportButton.click(),
    ]);
    const csv = await readDownload(download);
    // A byte-order mark, for a spreadsheet to read it as UTF-8 (#77)
    expect(csv.startsWith('\uFEFF')).toBe(true);
    const lines = csv.slice(1).trim().split(/\r?\n/);
    expect(lines).toHaveLength(3);
    const headings = lines[0]?.split(',') ?? [];
    expect(headings).toEqual(
      expect.arrayContaining(['uid', 'employeeNumber', 'mail'])
    );
    expect(lines.slice(1).join('\n')).toContain('alice@example.com');
    expect(lines.slice(1).join('\n')).toContain('bob@example.com');

    // A value a spreadsheet would run as a formula starts with an apostrophe
    await list.search(lastName, 'Last name');
    await expect(list.rows).toHaveCount(3);
    await list.selectAll.check();
    for (const user of [...users, formula])
      await expect(list.rowCheckbox(user.uid)).toBeChecked();
    const [exported] = await Promise.all([
      page.waitForEvent('download'),
      list.exportButton.click(),
    ]);
    const text = await readDownload(exported);
    expect(text).toContain(`'=HYPERLINK`);
    expect(text).toMatch(/'-[a-z]+/);
  });

  test('LIST-07 delete the selection', async ({
    page,
    directory,
    loginInNewContext,
  }) => {
    const { lastName, users } = await directory.createUsers(2);
    const app = await new LoginPage(page).loginAs(ADMIN, 'users');
    const list = app.list();
    await list.search(lastName, 'Last name');
    await expect(list.rows).toHaveCount(2);

    await list.selectAll.check();
    const confirm = new ConfirmDialog(page);
    await list.deleteSelectionButton.click();
    await confirm.expectOpen('Delete 2 entries?');
    await expect(confirm.items).toHaveCount(2);
    for (const user of users)
      await expect(confirm.items.filter({ hasText: user.uid })).toHaveCount(1);
    await expect(confirm.confirmButton).toHaveText('Delete 2 entries');
    await confirm.confirm();

    await expect(app.toast).toBeVisible();
    await expect(list.emptyState).toHaveText('No entry matches this search');
    for (const user of users)
      expect(await directory.exists(user.dn)).toBe(false);

    const alice = await loginInNewContext(ALICE, 'users');
    await expect(alice.nothingToManage).toBeVisible();
    await expect(alice.list().deleteSelectionButton).toHaveCount(0);
  });

  test('LIST-07 delete the selection: an entry the server refuses is named and kept', async ({
    page,
    directory,
    tenant,
  }) => {
    // entries in transit show in every administrator's list, but only admin deletes them
    const lastName = `Mixed${uniquePart()}`;
    const own = await directory.createUser({ org: tenant.org, lastName });
    const inTransit = await directory.createUser({ org: TRANSIT, lastName });
    const app = await new LoginPage(page).loginAs(tenant.admin, 'users');
    const list = app.list();
    await list.search(lastName, 'Last name');
    await expect(list.rows).toHaveCount(2);

    await list.selectAll.check();
    const confirm = new ConfirmDialog(page);
    await list.deleteSelectionButton.click();
    await confirm.expectOpen('Delete 2 entries?');
    await confirm.confirm();

    await expect(app.errorToast).toContainText(inTransit.uid);
    await expect(app.errorToast).not.toHaveText(
      /Internal Server Error|check logs/
    );
    await expect(list.ids()).toHaveText([inTransit.uid]);
    expect(await directory.exists(inTransit.dn)).toBe(true);
    expect(await directory.exists(own.dn)).toBe(false);
  });

  test('LIST-08 reference data lists', async ({ page, loginInNewContext }) => {
    const app = await new LoginPage(page).loginAs(ADMIN);
    const list = app.list();
    const lists: [string, string][] = [
      ['positions', 'Positions'],
      ['titles', 'Titles'],
      ['accountStatuses', 'Account states'],
      ['listTypes', 'List types'],
      ['mailboxTypes', 'Group types'],
    ];
    for (const [hash, name] of lists) {
      await app.open(hash);
      await expect(list.heading).toHaveText(name);
      await expect(list.rows.first()).toBeVisible();
      await expect(list.searchGuard).toHaveCount(0);
      await expect(list.importButton).toHaveCount(0);
      await expect(
        list.main.getByRole('button', { name: /^New / })
      ).toHaveCount(0);
    }

    await app.open('listTypes');
    await expect(list.columnHeaders).toHaveText(['Name', 'Description']);
    await expect(list.ids()).toHaveText([
      'Members only',
      'Open to all',
      'Owners only',
    ]);
    await expect(list.main).not.toContainText('memberRestrictedList');
    await app.open('mailboxTypes');
    expect(
      (await list.ids().allTextContents()).map(id => id.trim()).sort()
    ).toEqual(['Distribution list', 'Group', 'Shared mailbox']);
    await app.open('accountStatuses');
    await expect(list.columnHeaders).toHaveText(['Name', 'Description']);
    await expect(list.rows).toHaveCount(4);

    // admin, a global administrator of the stack, adds and imports them (DOMAIN-01)
    await app.open('domains');
    await expect(list.heading).toHaveText('Mail domains');
    await expect(list.searchGuard).toHaveCount(0);
    await expect(list.newButton).toHaveText('New domain');
    await expect(list.columnHeaders).toHaveText(['Identifier', 'Mail domain']);
    await expect(list.row('example')).toBeVisible();
    expect(
      (await list.read()).filter(
        row => !TEST_DOMAIN.test(row['Mail domain'] ?? '')
      )
    ).toEqual([
      { Identifier: 'example', 'Mail domain': 'example.com' },
      { Identifier: 'lists', 'Mail domain': 'lists.example.com' },
    ]);

    const sophie = await loginInNewContext(SOPHIE, 'positions');
    await expect(sophie.list().row('Sales Manager')).toBeVisible();
  });

  test('LIST-09 the header checkbox reflects the selection and clears the page', async ({
    page,
    directory,
  }) => {
    const { lastName, users } = await directory.createUsers(3);
    const app = await new LoginPage(page).loginAs(ADMIN, 'users');
    const list = app.list();
    await list.search(lastName, 'Last name');
    await expect(list.rows).toHaveCount(3);
    const [first, ...others] = users;
    const indeterminate = (): Promise<boolean> =>
      list.selectAll.evaluate(box => (box as HTMLInputElement).indeterminate);

    await list.rowCheckbox(first?.uid ?? '').check();
    await expect.poll(indeterminate).toBe(true);
    await expect(list.selectAll).not.toBeChecked();

    for (const user of others) await list.rowCheckbox(user.uid).check();
    await expect(list.selectAll).toBeChecked();
    await expect.poll(indeterminate).toBe(false);

    await list.selectAll.click();
    for (const user of users)
      await expect(list.rowCheckbox(user.uid)).not.toBeChecked();
    await expect(list.selectAll).not.toBeChecked();
    await expect(list.bulkBar).toBeHidden();

    await list.selectAll.click();
    for (const user of users)
      await expect(list.rowCheckbox(user.uid)).toBeChecked();
    await expect(list.selectAll).toBeChecked();
    await expect(list.bulkBar).toContainText('3 selected');
  });

  test('LIST-10 back from a card returns to the list as it was left', async ({
    page,
    directory,
  }) => {
    const { lastName, users } = await directory.createUsers(27);
    const app = await new LoginPage(page).loginAs(ADMIN, 'users');
    const list = app.list();

    await list.search('Moreau', 'Last name');
    await list.open('alice');
    await app.entry().expectName('Alice Moreau');
    await app.entry().backButton.click();
    await expect(list.searchBox).toHaveValue('Moreau');
    await expect(list.searchIn).toHaveValue('sn');
    await expect(list.ids()).toHaveText(['alice']);

    await list.open('alice');
    await app.entry().expectName('Alice Moreau');
    await page.goBack();
    await expect(list.searchBox).toHaveValue('Moreau');
    await expect(list.ids()).toHaveText(['alice']);

    await list.search(lastName, 'Last name');
    await list.setPerPage(25);
    await list.nextButton.click();
    await expect(list.counter).toHaveText('26–27 of 27');
    const onPageTwo = (await list.ids().first().textContent())?.trim() ?? '';
    expect(users.map(user => user.uid)).toContain(onPageTwo);
    await list.open(onPageTwo);
    await app.entry().expectIdentifier(onPageTwo);
    await app.entry().backButton.click();
    await expect(list.counter).toHaveText('26–27 of 27');
    await expect(list.searchBox).toHaveValue(lastName);

    await app.openList('Groups');
    await list.search('eng');
    await list.open('engineering');
    await app.entry().expectName('engineering');
    await app.entry().backButton.click();
    await expect(list.searchBox).toHaveValue('eng');
    await expect(list.row('engineering')).toBeVisible();
  });

  test('LIST-12 a keyboard user opens an entry from a list', async ({
    page,
  }) => {
    const app = await new LoginPage(page).loginAs(ADMIN, 'users');
    const list = app.list();

    /** Tabs from the search box to a row's link, past the controls and rows before it */
    const tabTo = async (row: Locator): Promise<void> => {
      const link = row.getByRole('link');
      await list.searchBox.focus();
      for (let i = 0; i < 40; i++) {
        await page.keyboard.press('Tab');
        if (await link.evaluate(el => el === document.activeElement)) break;
      }
      await expect(link).toBeFocused();
    };

    await list.search('Moreau', 'Last name');
    await expect(list.row('alice').getByRole('link')).toHaveAttribute(
      'href',
      '#/users/alice'
    );
    await tabTo(list.row('alice'));
    await page.keyboard.press('Enter');
    await app.entry().expectName('Alice Moreau');
    await app.entry().backButton.click();
    await expect(list.searchBox).toHaveValue('Moreau');
    await expect(list.ids()).toHaveText(['alice']);

    await app.openList('Groups');
    await list.search('eng');
    await tabTo(list.row('engineering'));
    await page.keyboard.press('Enter');
    await app.entry().expectName('engineering');

    await app.open('accountStatuses');
    await expect(list.rows.first()).toBeVisible();
    await tabTo(list.rows.first());
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/#\/accountStatuses\/[^/]+$/);
    await expect(app.entry().heading).toBeVisible();
  });

  test('LIST-11 a count of one reads in the singular', async ({
    page,
    directory,
    tenant,
  }) => {
    const one = await directory.createUsers(1);
    const two = await directory.createUsers(2);
    const app = await new LoginPage(page).loginAs(ADMIN, 'users');
    const list = app.list();
    const panel = app.importPanel();

    const confirm = new ConfirmDialog(page);
    /**
     * Ticks every account of `lastName`, reads the bar, asks to delete them, reads the question
     * and the button, and says no
     */
    const askToDelete = async (
      lastName: string,
      selected: string,
      [question, button]: [string, string]
    ): Promise<void> => {
      await list.search(
        lastName,
        selected.includes('sélection') ? 'Nom de famille' : 'Last name'
      );
      await list.selectAll.check();
      await expect(list.bulkBar).toContainText(selected);
      await list.deleteSelectionButton.click();
      await expect(confirm.title).toHaveText(question);
      await expect(confirm.confirmButton).toHaveText(button);
      await confirm.cancel();
    };
    /** Opens Import CSV and feeds it `count` valid rows into the tenant's organization */
    const feed = async (count: number): Promise<void> => {
      const rows = [
        [
          'Employee ID',
          'Last name',
          'First name',
          'Full name',
          'Email',
          'Department',
        ],
      ];
      for (let i = 0; i < count; i++) {
        const unique = uniquePart();
        directory.trackUser(`one.${unique}`);
        rows.push([
          `I-${unique}`,
          'One',
          'Row',
          'Row One',
          `one.${unique}@example.com`,
          tenant.org.path,
        ]);
      }
      await list.importButton.click();
      await panel.feed(csv(rows));
    };

    await askToDelete(one.lastName, '1 selected', [
      'Delete 1 entry?',
      'Delete 1 entry',
    ]);
    await askToDelete(two.lastName, '2 selected', [
      'Delete 2 entries?',
      'Delete 2 entries',
    ]);
    await feed(1);
    await expect(panel.readLine).toHaveText('1 row read from x.csv');
    await panel.check();
    await expect(panel.runButton).toHaveText('Import 1 entry');
    await panel.run();
    await expect(panel.stat('created')).toHaveText('1');
    await panel.closeButton.click();
    // the list shows what the import created, until asked back to its search
    await list.backToSearchButton.click();

    await app.setLanguage('fr');
    await askToDelete(one.lastName, '1 sélectionné', [
      'Supprimer 1 entrée ?',
      'Supprimer 1 entrée',
    ]);
    await askToDelete(two.lastName, '2 sélectionnés', [
      'Supprimer 2 entrées ?',
      'Supprimer 2 entrées',
    ]);
    await feed(1);
    await expect(panel.readLine).toHaveText('1 ligne lue dans x.csv');
    await panel.check();
    await expect(panel.stats.first()).toHaveText(
      /^\s*1\s+prête à importer\s*$/
    );
    await expect(panel.runButton).toHaveText('Importer 1 entrée');
    await panel.run();
    await expect(panel.stats.first()).toHaveText(/^\s*1\s+créée\s*$/);
    await panel.closeButton.click();
    await feed(2);
    await expect(panel.readLine).toHaveText('2 lignes lues dans x.csv');
    await panel.check();
    await expect(panel.stats.first()).toHaveText(
      /^\s*2\s+prêtes à importer\s*$/
    );
    await expect(panel.runButton).toHaveText('Importer 2 entrées');
  });

  test('LIST-13 the LINAGORA badge covers no row', async ({ page }) => {
    // Fixed in the corner, it hid the Status cell of the row under it and
    // took its clicks.
    const app = await new LoginPage(page).loginAs(ADMIN, 'users');
    const list = app.list();
    const badge = page.locator('a.dc-powered');
    // A short page still ends with it, at the bottom of the window.
    await expect(list.listEverythingButton).toBeVisible();
    await expect(badge).toBeVisible();
    const bottom = await badge.evaluate(
      element => window.innerHeight - element.getBoundingClientRect().bottom
    );
    expect(bottom).toBeGreaterThanOrEqual(0);
    expect(bottom).toBeLessThanOrEqual(24);

    // A short window puts rows where it was.
    await page.setViewportSize({ width: 1280, height: 480 });
    await list.listEverything();
    await expect(list.rows.first()).toBeVisible();
    /** The rows the badge overlaps, all measured in one frame */
    const covered = (): Promise<string[]> =>
      badge.evaluate(element => {
        const logo = element.getBoundingClientRect();
        return Array.from(document.querySelectorAll('tbody tr'))
          .filter(row => {
            const box = row.getBoundingClientRect();
            return (
              box.left < logo.right &&
              logo.left < box.right &&
              box.top < logo.bottom &&
              logo.top < box.bottom
            );
          })
          .map(row => row.textContent ?? '');
      });
    expect(await covered()).toEqual([]);
    await page.evaluate(() =>
      window.scrollTo({ top: document.documentElement.scrollHeight })
    );
    await expect(badge).toBeInViewport({ ratio: 1 });
    expect(await covered()).toEqual([]);
  });
});
