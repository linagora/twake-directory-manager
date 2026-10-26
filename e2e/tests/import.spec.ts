import { csv, LoginPage } from '../pages';
import { ADMIN } from '../support/accounts';
import { type Directory, uniquePart } from '../support/directory';
import { expect, test } from '../support/fixtures';

const HEADINGS = [
  'Employee ID',
  'Last name',
  'First name',
  'Full name',
  'Email',
  'Department',
];

/** A valid row for `HEADINGS`, its account registered for removal */
function validRow(
  directory: Directory,
  department: string,
  prefix = 'imp'
): string[] {
  const unique = uniquePart();
  directory.trackUser(`${prefix}.${unique}`);
  return [
    `I-${unique}`,
    'Imported',
    'Row',
    'Row Imported',
    `${prefix}.${unique}@example.com`,
    department,
  ];
}

test.describe('IMPORT CSV import', () => {
  test('IMPORT-01 the import panel and the empty template', async ({
    page,
  }) => {
    const app = await new LoginPage(page).loginAs(ADMIN, 'users');
    await app.list().importButton.click();
    const panel = app.importPanel();
    await panel.expectOpen();

    await expect(panel.dialog).toContainText(
      'The first row names the columns.'
    );
    await expect(panel.dialog).toContainText('separated by |');
    await expect(panel.dialog).toContainText('the whole path of a department');
    await expect(panel.dropZone).toHaveText(
      /Choose a CSV file\s*Separated by commas, semicolons or tabs/
    );
    await expect(panel.templateButton).toHaveText('Download an empty file');
    await expect(panel.cancelButton).toHaveText('Cancel');

    const english = await panel.download(panel.templateButton);
    const headings =
      english.text.replace(/^﻿/, '').trim().split(/\r?\n/)[0] ?? '';
    for (const label of [
      'Employee ID',
      'Department',
      'Last name',
      'First name',
      'Email',
      'Mailbox size',
    ])
      expect(headings).toContain(label);
    expect(headings).not.toMatch(/Delivery mode|Other mailboxes/);
    expect(english.text.trim().split(/\r?\n/)).toHaveLength(1);

    await panel.cancelButton.click();
    await app.setLanguage('fr');
    await app.list().importButton.click();
    const french = await panel.download(panel.templateButton);
    const frenchHeadings =
      french.text.replace(/^﻿/, '').trim().split(/\r?\n/)[0] ?? '';
    expect(frenchHeadings).toContain('Matricule');
    expect(frenchHeadings).toContain('Nom de famille');
    expect(frenchHeadings).not.toContain('Employee ID');
  });

  test('IMPORT-02 column matching', async ({ page }) => {
    const app = await new LoginPage(page).loginAs(ADMIN, 'users');
    await app.list().importButton.click();
    const panel = app.importPanel();

    await panel.feed(
      csv([
        [
          'Matricule',
          'nom de FAMILLE',
          'Prénom',
          'Full name',
          'Email address',
          'Department',
          'Foo',
        ],
        [
          'E1',
          'Doe',
          'Jane',
          'Jane Doe',
          'jane@example.com',
          'Human Resources',
          'bar',
        ],
      ])
    );
    await expect(panel.readLine).toHaveText('1 row read from x.csv');
    await expect(
      panel.dialog.locator('table.dc-import-mapping thead th')
    ).toHaveText(['Column', 'First row', 'Field']);
    await expect(panel.mapping('Matricule')).toHaveValue('employeeNumber');
    await expect(panel.mapping('nom de FAMILLE')).toHaveValue('sn');
    await expect(panel.mapping('Prénom')).toHaveValue('givenName');
    await expect(panel.mapping('Full name')).toHaveValue('displayName');
    await expect(panel.mapping('Email address')).toHaveValue('mail');
    await expect(panel.mapping('Department')).toHaveValue(
      'twakeDepartmentLink'
    );
    await expect(panel.mapping('Foo')).toHaveValue('');
    await expect(panel.mapping('Foo').locator('option:checked')).toHaveText(
      'Ignore'
    );
    await expect(panel.checkButton).toBeEnabled();

    await panel.otherFileButton.click();
    await expect(panel.dropZone).toBeVisible();
    await panel.feed(
      csv([
        ['Employee ID', 'Last name', 'First name', 'Full name', 'Department'],
        ['E1', 'Doe', 'Jane', 'Jane Doe', 'Human Resources'],
      ])
    );
    await expect(panel.errors).toContainText([
      'No column fills these required fields: Email',
    ]);
    await expect(panel.checkButton).toBeDisabled();

    await panel.otherFileButton.click();
    await panel.feed(
      csv([
        [...HEADINGS, 'Email'],
        [
          'E1',
          'Doe',
          'Jane',
          'Jane Doe',
          'jane@example.com',
          'Human Resources',
          'j@example.com',
        ],
      ])
    );
    await expect(panel.errors).toContainText([
      'Several columns fill the same field: Email',
    ]);
    await expect(panel.checkButton).toBeDisabled();
    await panel.otherFileButton.click();
    await expect(panel.dropZone).toBeVisible();
  });

  test('IMPORT-03 check and import valid rows', async ({
    page,
    directory,
    tenant,
  }) => {
    const france = await directory.createOrganization({
      parent: tenant.org.dn,
      name: 'France',
    });
    const backend = await directory.createOrganization({
      parent: tenant.org.dn,
      name: 'Backend',
    });
    const [one, two] = [uniquePart(), uniquePart()];
    const first = directory.trackUser(`imp.${one}`);
    const second = directory.trackUser(`imp.${two}`);
    const app = await new LoginPage(page).loginAs(ADMIN, 'users');
    await app.list().importButton.click();
    const panel = app.importPanel();

    await panel.feed(
      csv([
        [...HEADINGS, 'Position', 'Email aliases'],
        [
          `I-${one}`,
          'One',
          'Imp',
          'Imp One',
          `imp.${one}@example.com`,
          france.path,
          'Sales Manager',
          `i1.${one}@example.com|io.${one}@example.com`,
        ],
        [
          `I-${two}`,
          'Two',
          'Imp',
          'Imp Two',
          `imp.${two}@example.com`,
          backend.path,
          'Software Engineer',
          '',
        ],
      ])
    );
    // Each step moves the focus to what it says (#213)
    await expect(panel.dialog.locator(':focus')).toHaveText(
      /^2 rows read from /
    );
    await panel.check();
    await expect(panel.stat('ready to import')).toHaveText('2');
    await expect(panel.stat('with errors')).toHaveText('0');
    await expect(
      panel.dialog.getByRole('group', {
        name: '2 ready to import, 0 with errors, not imported',
      })
    ).toBeFocused();
    await expect(panel.runButton).toHaveText('Import 2 entries');
    await panel.runButton.click();
    await expect(panel.progress.or(panel.closeButton)).toBeVisible();
    await expect(panel.closeButton).toBeVisible({ timeout: 60_000 });
    await expect(panel.stat('created')).toHaveText('2');
    await expect(
      panel.dialog.getByRole('group', {
        name: '2 created, 0 refused by the server',
      })
    ).toBeFocused();
    // no Password column: the accounts cannot sign in yet, and it says so (#164)
    await expect(panel.dialog).toContainText(
      '2 accounts were created without a password: give each one from its card (Reset password)'
    );

    // Each created account named, and linked to its card
    await expect(panel.created.locator('td:first-child')).toHaveText([
      '2',
      '3',
    ]);
    await expect(panel.created.nth(0)).toContainText(`Imp One (imp.${one})`);
    await expect(panel.created.nth(1)).toContainText(`Imp Two (imp.${two})`);
    await expect(
      panel.created.nth(0).getByRole('link', { name: 'Imp One' })
    ).toHaveAttribute('href', `#/users/imp.${one}`);

    // Closed, the list shows them without a search, until Back to search
    await panel.closeButton.click();
    const list = app.list();
    await expect(list.importedView).toHaveText('Just imported (2)');
    await expect(list.ids()).toHaveText(
      [`imp.${one}`, `imp.${two}`].sort((a, b) => a.localeCompare(b))
    );
    await expect(list.searchBox).toBeHidden();
    await list.backToSearchButton.click();
    await expect(list.searchGuard).toBeVisible();
    await expect(list.searchBox).toBeFocused();

    expect(await directory.values(first, 'twakeDepartmentLink')).toEqual([
      france.dn,
    ]);
    expect(await directory.values(second, 'twakeDepartmentLink')).toEqual([
      backend.dn,
    ]);
    expect(await directory.values(first, 'title')).toEqual([
      'cn=Sales Manager,ou=positions,dc=example,dc=com',
    ]);
    expect(
      (await directory.values(first, 'mailAlternateAddress')).sort()
    ).toEqual([`i1.${one}@example.com`, `io.${one}@example.com`]);
  });

  test('IMPORT-04 rows with errors and refused rows', async ({
    page,
    directory,
    tenant,
  }) => {
    const department = tenant.org.path;
    const dup = uniquePart();
    const row = (
      unique: string,
      changes: Record<number, string> = {},
      extra: string[] = ['', '', '']
    ): string[] => {
      directory.trackUser(`bad.${unique}`);
      const cells = [
        `I-${unique}`,
        'Bad',
        'Row',
        'Row Bad',
        `bad.${unique}@example.com`,
        department,
        ...extra,
      ];
      for (const [index, value] of Object.entries(changes))
        cells[Number(index)] = value;
      return cells;
    };
    directory.trackUser(`bad.${dup}`);
    const rows = [
      [...HEADINGS, 'Deletion date', 'Password reset required', 'Mailbox size'],
      row(uniquePart(), { 1: '' }), // 2: no last name
      row(uniquePart(), { 4: 'bad' }), // 3
      row(uniquePart(), { 5: 'Nowhere' }), // 4
      row(uniquePart(), { 4: `bad.${dup}@example.com` }), // 5
      row(uniquePart(), { 4: `bad.${dup}@example.com` }), // 6: repeats line 5
      row(uniquePart(), { 4: 'alice@example.com' }), // 7: passes the check, refused by the server
      row(uniquePart(), {}, ['30/09/2030', '', '']), // 8
      row(uniquePart(), {}, ['', 'oui', '']), // 9
      row(uniquePart(), {}, ['', '', 'lots']), // 10
      row(uniquePart(), {}, ['01/01/2020', '', '']), // 11
    ];
    const app = await new LoginPage(page).loginAs(ADMIN, 'users');
    await app.list().importButton.click();
    const panel = app.importPanel();
    await panel.feed(csv(rows));
    await panel.check();

    await expect(panel.stat('ready to import')).toHaveText('4');
    await expect(panel.stat('with errors')).toHaveText('6');
    const problems = panel.problems;
    await expect(problems.locator('td:first-child')).toHaveText([
      '2',
      '3',
      '4',
      '6',
      '10',
      '11',
    ]);
    await expect(problems.nth(0)).toContainText('Last name is required');
    await expect(problems.nth(1)).toContainText('Email');
    await expect(problems.nth(2)).toContainText(
      'Department: “Nowhere” not found'
    );
    await expect(problems.nth(3)).toContainText(`is already on line 5`);
    await expect(problems.nth(4)).toContainText(
      'Mailbox size: “lots” is not a size, such as 4 GB'
    );
    await expect(problems.nth(5)).toContainText(
      'Deletion date: “01/01/2020” is earlier than today'
    );

    const invalid = await panel.download(panel.downloadInvalidButton);
    const invalidLines = invalid.text.replace(/^﻿/, '').trim().split(/\r?\n/);
    expect(invalidLines).toHaveLength(7);
    expect(invalidLines[3]).toContain('Nowhere');
    expect(invalidLines[3]).toMatch(/not found"?$/);

    await panel.backButton.click();
    await expect(panel.mappingRows.first()).toBeVisible();
    await panel.check();
    await panel.run();
    await expect(panel.stat('created')).toHaveText('3');
    await expect(panel.stat('refused')).toHaveText('1');
    await expect(problems.locator('td:first-child')).toHaveText(['7']);
    // in the console's words, not the server's
    const taken = 'Email “alice@example.com” is already used by another entry.';
    await expect(problems.nth(0)).toContainText(taken);
    await expect(problems.nth(0)).not.toContainText('must be unique');
    const refused = await panel.download(panel.downloadRefusedButton);
    expect(refused.text).toContain(taken);
  });

  test('IMPORT-05 the import respects the scope', async ({
    page,
    directory,
    tenant,
  }) => {
    const germany = await directory.createOrganization({
      parent: tenant.org.dn,
      name: 'Germany',
    });
    const inside = validRow(directory, germany.path, 'in');
    const outside = validRow(directory, 'Engineering', 'out');
    const app = await new LoginPage(page).loginAs(tenant.admin, 'users');
    await app.list().importButton.click();
    const panel = app.importPanel();

    await panel.feed(csv([HEADINGS, inside, outside]));
    await panel.check();
    await expect(panel.runButton).toBeEnabled();
    await panel.run();
    await expect(panel.stat(/created/)).toHaveText('1');
    expect(
      await directory.usersStartingWith(inside[4]?.split('@')[0] ?? '-')
    ).toHaveLength(1);
    expect(
      await directory.usersStartingWith(outside[4]?.split('@')[0] ?? '-')
    ).toEqual([]);
  });

  test('IMPORT-06 stop an import', async ({ page, directory, tenant }) => {
    const rows = [HEADINGS];
    for (let i = 0; i < 150; i++)
      rows.push(validRow(directory, tenant.org.path, 'stop'));
    const app = await new LoginPage(page).loginAs(ADMIN, 'users');
    await app.list().importButton.click();
    const panel = app.importPanel();
    await panel.feed(csv(rows));
    await panel.check();
    await expect(panel.runButton).toHaveText('Import 150 entries');

    await panel.runButton.click();
    await panel.stopButton.click();
    await expect(panel.closeButton).toBeVisible({ timeout: 60_000 });
    const created = Number(await panel.stat(/^\s*\d+\s+created/).textContent());
    await expect(panel.stat('not sent')).toBeVisible();
    const notSent = Number(await panel.stat('not sent').textContent());
    expect(created).toBeLessThan(150);
    expect(created + notSent).toBe(150);
    await expect
      .poll(async () => (await directory.usersStartingWith('stop.')).length)
      .toBeGreaterThanOrEqual(created);
  });
});
