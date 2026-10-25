import { ConfirmDialog, LoginPage, ResetPasswordDialog } from '../pages';
import { ADMIN, ALICE, ORG, SOPHIE } from '../support/accounts';
import { uniquePart } from '../support/directory';
import { expect, test } from '../support/fixtures';

test.describe('ORG organizations', () => {
  test('ORG-01 browse the tree and open a card', async ({ page }) => {
    const app = await new LoginPage(page).loginAs(ADMIN);
    const organizations = await app.openOrganizations();

    await expect(organizations.toggle('organization')).toHaveAttribute(
      'aria-expanded',
      'true'
    );
    const children = organizations.children('organization');
    for (const name of ['Sales', 'Engineering', 'Human Resources', 'Transit'])
      await expect(children.filter({ hasText: name }).first()).toBeVisible();
    await expect(organizations.tag('Transit')).toHaveText('Transit');
    await expect(organizations.tag('Sales')).toHaveCount(0);

    await expect(organizations.toggle('Sales')).toHaveText('▸');
    await organizations.toggle('Sales').click();
    await expect(organizations.toggle('Sales')).toHaveText('▾');
    await expect(organizations.children('Sales')).toHaveText([
      'France',
      'Germany',
    ]);
    await organizations.toggle('France').click();
    await expect(organizations.toggle('France')).toHaveText('·');
    await organizations.toggle('Sales').click();
    await expect(organizations.label('France')).toBeHidden();
    await organizations.toggle('Sales').click();

    await expect(organizations.label('Sales')).toHaveAttribute(
      'title',
      'Sales'
    );
    const card = await organizations.select('Sales');
    await expect(card.detail('Name')).toHaveText('Sales');
    await expect(card.detail('Description')).toHaveText('Sales department');
    await expect(card.detail('Locality')).toHaveText('Paris');
    await expect(card.detail('Path')).toHaveText('Sales');
    await expect(card.detail('Managers')).toHaveText('sophie.martin');
    await expect(card.detail('Local administrators')).toHaveText(
      'sophie.martin'
    );
    // Sales has no mail domain: the field waits with the empty ones (#133)
    await expect(card.emptyField('Mail domains')).toHaveCount(1);
    await expect(card.attachedHeading('People')).toHaveText('People (1)');
    await expect(card.attachedRows('People').locator('td')).toHaveText([
      'Sophie Martin',
      'sophie.martin@example.com',
      'Sales Manager',
      'Active',
    ]);
    await expect(card.attachedHeading('Groups')).toHaveText('Groups (1)');
    await expect(card.attachedRows('Groups').locator('td')).toHaveText([
      'sales-team',
      'sales@example.com',
      'Shared mailbox',
    ]);

    await card.action('Edit').click();
    const form = app.form();
    await form.expectOpen('Edit — Sales');
    await expect(organizations.tree).toBeVisible();
    await form.cancel();
    await expect(organizations.tree).toBeVisible();
    await expect(organizations.card.heading).toHaveText('Sales');
  });

  test('ORG-02 the tree filter types forwards', async ({ page }) => {
    const app = await new LoginPage(page).loginAs(ADMIN);
    const organizations = await app.openOrganizations();
    await organizations.expand('Sales');
    await organizations.expand('Engineering');

    await organizations.filter.click();
    await organizations.filter.pressSequentially('Back', { delay: 120 });
    await expect(organizations.filter).toHaveValue('Back');
    await expect(organizations.filter).toBeFocused();
    expect(
      await organizations.filter.evaluate(
        input => (input as HTMLInputElement).selectionStart
      )
    ).toBe(4);
    await expect(organizations.results).toHaveText(['Engineering / Backend']);

    await organizations.filter.pressSequentially('en', { delay: 120 });
    await expect(organizations.filter).toHaveValue('Backen');
    await organizations.filter.press('Backspace');
    await expect(organizations.filter).toHaveValue('Backe');
    await organizations.filter.press('ArrowLeft');
    await organizations.filter.press('ArrowLeft');
    await organizations.filter.pressSequentially('x');
    await expect(organizations.filter).toHaveValue('Bacxke');
    await expect(organizations.filter).toBeFocused();

    await organizations.filter.fill('');
    await expect(organizations.label('Sales')).toBeVisible();
    await expect(organizations.label('France')).toBeVisible();
    await expect(organizations.label('Backend')).toBeVisible();
    await expect(organizations.label('Human Resources')).toBeVisible();
  });

  test('ORG-03 create a sub-organization', async ({
    page,
    directory,
    tenant,
  }) => {
    const name = `QA Lab ${uniquePart()}`;
    directory.track(`ou=${name},${tenant.org.dn}`);
    const app = await new LoginPage(page).loginAs(ADMIN);
    const organizations = await app.openOrganizations(tenant.org.dn);

    await organizations
      .node(tenant.org.name)
      .locator('.dc-tree-row')
      .first()
      .hover();
    await expect(organizations.addButton(tenant.org.name)).toHaveAttribute(
      'title',
      'New organization here'
    );
    await organizations.addButton(tenant.org.name).click();
    const form = app.form();
    await form.expectOpen('New organization');

    await form.fill('Name', '-Lab');
    await form.submit();
    await expect(form.error('Name')).toContainText(
      'starting with a letter or a digit'
    );

    await form.fill('Name', name);
    await form.fill('Description', 'Test');
    await form.addValue('Phone', '+33 1 00 00 00 00');
    await form.submit();
    await app.expectToast(`${name} created`);

    const card = organizations.card;
    await expect(card.heading).toHaveText(name);
    await expect(card.detail('Path')).toHaveText(
      `${tenant.org.path} / ${name}`
    );
    await expect(organizations.children(tenant.org.name)).toContainText([name]);
    await card.action('Edit').click();
    await form.expectOpen(`Edit — ${name}`);
    await expect(form.dialog.getByLabel(/^Name( \*)?$/)).toHaveCount(0);
    await form.cancel();
  });

  test('ORG-04 edit an organization: managers, local administrators, mail domains', async ({
    page,
    directory,
    loginInNewContext,
  }) => {
    const org = await directory.createOrganization();
    const person = await directory.createUser({ org });
    const app = await new LoginPage(page).loginAs(ADMIN);
    const organizations = await app.openOrganizations(org.dn);
    const card = organizations.card;
    await expect(card.heading).toHaveText(org.name);

    await card.action('Edit').click();
    const form = app.form();
    await form.expectOpen(`Edit — ${org.name}`);
    await form.pick('Managers', person.uid, person.uid);
    await form.pick('Local administrators', person.uid, person.uid);
    await form.type('Mail domains', 'exa');
    await expect(
      form.options('Mail domains').filter({ hasText: 'example.com' }).first()
    ).toBeVisible();
    await expect(form.options('Mail domains')).not.toContainText([
      'dc=example',
    ]);
    await form
      .options('Mail domains')
      .filter({ hasText: /^example\.com$/ })
      .click();
    await expect(form.tokens('Mail domains')).toHaveText(['example.com']);
    // named, not shown as DNs (the label right after a pick also holds the full name)
    for (const label of ['Managers', 'Local administrators']) {
      await expect(form.tokens(label)).toHaveCount(1);
      await expect(form.tokens(label)).toContainText(person.uid);
      await expect(form.tokens(label)).not.toContainText('uid=');
    }
    await form.submit();

    await app.expectToast('Saved');
    await expect(card.detail('Managers')).toContainText(person.uid);
    await expect(card.detail('Managers')).not.toContainText('uid=');
    await expect(card.detail('Local administrators')).toContainText(person.uid);
    await expect(card.detail('Mail domains')).toHaveText('example.com');

    const local = await loginInNewContext(person);
    await expect(local.scopeBranches).toHaveText([
      new RegExp(`^\\s*${org.name}\\s+read, write, delete\\s*$`),
    ]);

    await card.action('Edit').click();
    await form.expectOpen(`Edit — ${org.name}`);
    await form.removeToken('Local administrators', person.uid);
    await form.submit();
    await app.expectToast('Saved');
    expect(await directory.values(org.dn, 'twakeLocalAdminLink')).toEqual([]);
  });

  test('ORG-05 delete an organization', async ({ page, directory, tenant }) => {
    const lab = await directory.createOrganization({
      parent: tenant.org.dn,
      name: 'QA Lab',
    });
    const germany = await directory.createOrganization({
      parent: tenant.org.dn,
      name: 'Germany',
    });
    await directory.createUser({ org: germany });
    const app = await new LoginPage(page).loginAs(ADMIN);
    const organizations = await app.openOrganizations(lab.dn);
    await expect(organizations.card.heading).toHaveText(lab.name);

    const confirm = new ConfirmDialog(page);
    await organizations.card.perform('Delete');
    await confirm.expectOpen(`Delete ${lab.path}?`);
    await expect(confirm.message).toHaveText('This cannot be undone.');
    await expect(confirm.confirmButton).toHaveText('Delete organization');
    await confirm.confirm();
    await app.expectToast('Deleted');
    await expect(organizations.label(lab.name)).toHaveCount(0);
    await expect(organizations.card.heading).toHaveText(tenant.org.name);
    await expect(organizations.selected).toHaveText(tenant.org.name);
    await expect(organizations.label(germany.name)).toBeVisible();
    expect(await directory.exists(lab.dn)).toBe(false);

    await organizations.select(germany.name);
    await organizations.card.perform('Delete');
    await confirm.confirm();
    await app.expectToast(
      `${germany.path} is not empty: move or delete its entries first`,
      true
    );
    expect(await directory.exists(germany.dn)).toBe(true);

    await app.setLanguage('fr');
    await organizations.card.perform('Supprimer');
    await confirm.expectOpen(`Supprimer ${germany.path} ?`);
    await expect(confirm.cancelButton).toHaveText('Annuler');
    await expect(confirm.confirmButton).toHaveText('Supprimer l’organisation');
    await confirm.confirm();
    await app.expectToast(
      `${germany.path} n’est pas vide : déplacez ou supprimez d’abord ses entrées`,
      true
    );
  });

  test('ORG-06 a local administrator and organizations', async ({
    page,
    directory,
    tenant,
  }) => {
    const app = await new LoginPage(page).loginAs(tenant.admin);
    const organizations = await app.openOrganizations();
    await expect(organizations.names().first()).toHaveText(tenant.org.name);
    const spain = `Spain ${uniquePart()}`;
    directory.track(`ou=${spain},${tenant.org.dn}`);

    await organizations.addButton(tenant.org.name).click();
    const form = app.form();
    await form.expectOpen('New organization');
    await form.fill('Name', spain);
    await form.submit();
    await app.expectToast(`${spain} created`);
    await expect(organizations.card.heading).toHaveText(spain);

    await organizations.card.action('Edit').click();
    await form.expectOpen(`Edit — ${spain}`);
    await form.fill('Description', 'Ventas');
    await form.submit();
    await app.expectToast('Saved');
    await expect(organizations.card.detail('Description')).toHaveText('Ventas');

    await organizations.card.perform('Delete');
    await new ConfirmDialog(page).confirm();
    await app.expectToast('Deleted');
    await expect(organizations.label(spain)).toHaveCount(0);

    // its own organization is changed from above it (#167)
    await organizations.select(tenant.org.name);
    await expect(organizations.card.action('Edit')).toHaveCount(0);
    await expect(organizations.card.action('Delete')).toHaveCount(0);
    await expect(page.locator('[data-notice]')).toHaveText(
      `${tenant.org.name} is changed by the administrator above you; you manage what it contains`
    );
    expect(await directory.values(tenant.org.dn, 'description')).toEqual([]);
  });

  test('ORG-07 the Department path link of an entry opens the tree', async ({
    page,
  }) => {
    const app = await new LoginPage(page).loginAs(ADMIN, 'users/carol');

    await app
      .entry()
      .detail('Department path')
      .getByRole('link', { name: 'Engineering / Backend' })
      .click();

    const organizations = app.organizations();
    await expect(organizations.card.heading).toHaveText('Backend');
    await expect(organizations.selected).toHaveText('Backend');
    await expect(organizations.toggle('Engineering')).toHaveAttribute(
      'aria-expanded',
      'true'
    );
    await expect(page).toHaveURL(
      new RegExp(encodeURIComponent(ORG.backend).replace(/[%]/g, '%'))
    );
  });

  test('ORG-08 the tree keeps its state after a write, and a typed address opens it down', async ({
    page,
    directory,
    tenant,
    loginInNewContext,
  }) => {
    const france = await directory.createOrganization({
      parent: tenant.org.dn,
      name: 'France',
    });
    const app = await new LoginPage(page).loginAs(ADMIN);
    const organizations = await app.openOrganizations();
    // the top of the tree is shown at once, its address in place (#173)
    await expect(page).toHaveURL(
      new RegExp(`#/organizations/${encodeURIComponent(ORG.root)}$`)
    );
    await expect(organizations.card.heading).toBeVisible();
    await organizations.expand('Sales');
    await organizations.expand(tenant.org.name);
    await organizations.label(france.name).click();
    await expect(organizations.card.detail('Path')).toHaveText(france.path);
    await expect(page).toHaveURL(
      new RegExp(`#/organizations/${encodeURIComponent(`ou=${france.name}`)}`)
    );
    const address = page.url();

    await organizations.card.action('Edit').click();
    const form = app.form();
    await form.fill('Description', 'Updated');
    await form.submit();
    await app.expectToast('Saved');
    await expect(organizations.card.detail('Description')).toHaveText(
      'Updated'
    );
    await expect(organizations.toggle('Sales')).toHaveAttribute(
      'aria-expanded',
      'true'
    );
    await expect(organizations.toggle(tenant.org.name)).toHaveAttribute(
      'aria-expanded',
      'true'
    );
    await expect(organizations.card.detail('Path')).toHaveText(france.path);

    const temporary = `QA Tmp ${uniquePart()}`;
    directory.track(`ou=${temporary},${tenant.org.dn}`);
    await organizations.addButton(tenant.org.name).click();
    await form.fill('Name', temporary);
    await form.submit();
    await app.expectToast(`${temporary} created`);
    await expect(organizations.card.heading).toHaveText(temporary);
    await expect(organizations.selected).toHaveText(temporary);
    await organizations.card.perform('Delete');
    await new ConfirmDialog(page).confirm();
    await app.expectToast('Deleted');
    await expect(organizations.selected).toHaveText(tenant.org.name);
    await expect(organizations.toggle('Sales')).toHaveAttribute(
      'aria-expanded',
      'true'
    );

    const other = await loginInNewContext(ADMIN);
    await other.page.goto(address);
    const tree = other.organizations();
    await expect(tree.card.detail('Path')).toHaveText(france.path);
    await expect(tree.toggle(tenant.org.name)).toHaveAttribute(
      'aria-expanded',
      'true'
    );
  });

  test('ORG-10 the filter searches the whole tree, and a selected organization opens', async ({
    page,
    directory,
    tenant,
  }) => {
    const app = await new LoginPage(page).loginAs(ADMIN);
    const organizations = await app.openOrganizations();
    await expect(organizations.toggle('Sales')).toHaveAttribute(
      'aria-expanded',
      'false'
    );

    // Under a branch never opened
    await organizations.filter.fill('Fra');
    await organizations.result('Sales / France').click();
    await expect(organizations.filter).toHaveValue('');
    await expect(organizations.card.heading).toHaveText('France');
    await expect(organizations.selected).toHaveText('France');
    await expect(organizations.selected).toBeFocused();
    await expect(organizations.toggle('Sales')).toHaveAttribute(
      'aria-expanded',
      'true'
    );

    const nowhere = `Nowhere ${uniquePart()}`;
    await organizations.filter.fill(nowhere);
    await expect(organizations.notice).toHaveText(
      `No organization matches “${nowhere}”`
    );
    await organizations.filter.fill('');

    // Selecting opens; the toggle alone closes
    await organizations.select('Engineering');
    await expect(organizations.toggle('Engineering')).toHaveAttribute(
      'aria-expanded',
      'true'
    );
    await expect(organizations.children('Engineering')).toContainText([
      'Backend',
      'Frontend',
    ]);
    // The selected row keeps its "+" in view, pointed at or not
    await page.mouse.move(0, 0);
    await expect(organizations.addButton('Engineering')).toHaveCSS(
      'opacity',
      '1'
    );
    await organizations.toggle('Engineering').click();
    await expect(organizations.label('Backend')).toBeHidden();
    await expect(organizations.selected).toHaveText('Engineering');

    // The card offers what the "+" does
    const name = `QA Card ${uniquePart()}`;
    directory.track(`ou=${name},${tenant.org.dn}`);
    await app.openOrganizations(tenant.org.dn);
    await expect(organizations.card.heading).toHaveText(tenant.org.name);
    await organizations.card.action('New organization here').click();
    const form = app.form();
    await form.expectOpen('New organization');
    await form.fill('Name', name);
    await form.submit();
    await app.expectToast(`${name} created`);
    await expect(organizations.card.heading).toHaveText(name);
    await expect(organizations.card.detail('Path')).toHaveText(
      `${tenant.org.path} / ${name}`
    );
  });

  test('ORG-11 a local administrator filters only their branch', async ({
    page,
  }) => {
    const app = await new LoginPage(page).loginAs(SOPHIE);
    const organizations = await app.openOrganizations();

    await organizations.filter.fill('Fra');
    await expect(organizations.result('Sales / France')).toBeVisible();
    await organizations.filter.fill('an');
    await expect(organizations.result('Sales / Germany')).toBeVisible();
    for (const path of await organizations.results.allTextContents())
      expect(path.trim()).toMatch(/^Sales\b/);
    await organizations.filter.fill('Backend');
    await expect(organizations.notice).toHaveText(
      'No organization matches “Backend”'
    );

    await organizations.filter.fill('');
    await organizations.select('Sales');
    await expect(
      organizations.card.action('New organization here')
    ).toBeVisible();
  });

  test('ORG-09 the card counts the attached entries it does not list', async ({
    page,
    directory,
    tenant,
  }) => {
    for (let i = 0; i < 55; i++)
      await directory.createUser({ org: tenant.org });
    const single = await directory.createOrganization();
    for (let i = 0; i < 51; i++) await directory.createUser({ org: single });
    const app = await new LoginPage(page).loginAs(ADMIN);

    const organizations = await app.openOrganizations(tenant.org.dn);
    const people = organizations.card.attached('People');
    await expect(organizations.card.attachedRows('People')).toHaveCount(50);
    // fifty listed of more is not fifty
    await expect(organizations.card.attachedHeading('People')).toHaveText(
      'People (50+)'
    );
    await expect(people.getByRole('status')).toHaveText(
      'And 6 more entries, not listed here: search the lists to find them.'
    );
    await expect(
      organizations.card.attached('Groups').getByRole('status')
    ).toHaveCount(0);
    await app.setLanguage('fr');
    await expect(
      organizations.card.attached('Personnes').getByRole('status')
    ).toHaveText(
      'Et 6 autres entrées, non affichées ici : recherchez-les dans les listes.'
    );
    await app.setLanguage('en');

    await app.openOrganizations(single.dn);
    await expect(
      organizations.card.attached('People').getByRole('status')
    ).toHaveText(
      'And 1 more entry, not listed here: search the lists to find it.'
    );
  });

  test('ORG-12 the card lists its people and groups, and creates a user there', async ({
    page,
    directory,
    tenant,
    loginInNewContext,
  }) => {
    const app = await new LoginPage(page).loginAs(ADMIN);
    const organizations = await app.openOrganizations(ORG.sales);
    const card = organizations.card;

    // who administers it leads to them (#173)
    await expect(
      card.detail('Local administrators').getByRole('link', {
        name: 'sophie.martin',
      })
    ).toHaveAttribute('href', '#/users/sophie.martin');

    // a row opens the card, and Back returns to the organization
    await card
      .attachedRow('People', 'Sophie Martin')
      .locator('td')
      .nth(1)
      .click();
    await app.entry().expectName('Sophie Martin');
    await page.goBack();
    await expect(card.heading).toHaveText('Sales');
    await card
      .attachedRow('Groups', 'sales-team')
      .getByRole('link', { name: 'sales-team' })
      .press('Enter');
    await app.entry().expectName('sales-team');
    await page.goBack();
    await expect(card.heading).toHaveText('Sales');

    // as the Overview does, New user here only where the caller creates
    const sophie = await loginInNewContext(
      SOPHIE,
      `organizations/${encodeURIComponent(ORG.france)}`
    );
    const france = sophie.organizations().card;
    await expect(france.heading).toHaveText('France');
    await expect(france.attached('People').getByRole('button')).toHaveText(
      'New user here'
    );
    await expect(france.attached('Groups').getByRole('button')).toHaveText(
      'New group here'
    );
    const alice = await loginInNewContext(
      ALICE,
      `organizations/${encodeURIComponent(ORG.france)}`
    );
    await expect(alice.nothingToManage).toBeVisible();
    await expect(
      alice.page.getByRole('button', { name: 'New user here' })
    ).toHaveCount(0);

    // created there, the account joins the table without a reload
    const local = await loginInNewContext(
      tenant.admin,
      `organizations/${encodeURIComponent(tenant.org.dn)}`
    );
    const own = local.organizations().card;
    await expect(own.attachedHeading('People')).toHaveText('People (1)');
    await own
      .attached('People')
      .getByRole('button', { name: 'New user here' })
      .click();
    const form = local.form();
    await form.expectOpen('New user');
    await expect(form.tokens('Department')).toHaveText([tenant.org.path]);
    const unique = uniquePart();
    const uid = `here.${unique}`;
    const dn = directory.trackUser(uid);
    await form.fillAll({
      'Employee ID': `E-${unique}`,
      'Last name': 'Here',
      'First name': 'Hilda',
      'Full name': 'Hilda Here',
      Email: `${uid}@example.com`,
    });
    await form.submit();
    await local.expectToast('Hilda Here created');
    await new ResetPasswordDialog(local.page).closeUncopied();
    await form.expectClosed();
    await expect(own.heading).toHaveText(tenant.org.name);
    await expect(own.attachedHeading('People')).toHaveText('People (2)');
    await expect(own.attachedRow('People', 'Hilda Here')).toBeVisible();
    expect(await directory.values(dn, 'twakeDepartmentLink')).toEqual([
      tenant.org.dn,
    ]);
  });
});
