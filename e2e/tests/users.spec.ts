import { LoginPage, ResetPasswordDialog } from '../pages';
import { ADMIN, ALICE, ORG, SOPHIE } from '../support/accounts';
import { answerNextConfirm } from '../support/confirm';
import { HUMAN_RESOURCES, TEST_DOMAIN, uniquePart } from '../support/directory';
import { expect, test } from '../support/fixtures';

/** Today plus `days`, as a date input takes it */
function isoDate(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

test.describe('USER user accounts', () => {
  test('USER-01 account card', async ({ page }) => {
    const app = await new LoginPage(page).loginAs(ADMIN, 'users');
    const list = app.list();
    await list.search('alice');
    await list.open('alice');

    const card = app.entry();
    await card.expectName('alice');
    await expect(card.actions()).toHaveText([
      'Hand over',
      'Edit',
      'Change state…',
      'Reset password',
      'Delete',
    ]);
    await expect(card.changeState).toBeVisible();
    await expect(card.detailLabels().first()).toHaveText(
      'Distinguished name (DN)'
    );
    await expect(card.dn).toHaveText('uid=alice,ou=users,dc=example,dc=com');
    await expect(card.detail('Title')).toHaveText('Mrs');
    await expect(card.detail('Position')).toHaveText('Sales Representative');
    await expect(card.detail('Status')).toHaveText('Active');
    await expect(card.detail('Department')).toHaveText('France');
    await expect(card.detail('Email aliases')).toHaveText(
      'alice.moreau@example.com'
    );
    await expect(card.detail('Comment')).toHaveText('—');
    for (const hidden of ['Delivery mode', 'Other mailboxes', 'Password'])
      await expect(card.detail(hidden)).toHaveCount(0);
    await expect(card.relatedItems('Mailing lists')).toHaveText([
      'all-staff',
      'sales-team',
    ]);

    await card
      .relatedItems('Mailing lists')
      .filter({ hasText: 'sales-team' })
      .getByRole('button')
      .click();
    await app.entry().expectName('sales-team');
    await page.goBack();
    await card.expectName('alice');

    await card
      .detail('Department path')
      .getByRole('link', { name: 'Sales / France' })
      .click();
    const organizations = app.organizations();
    await expect(organizations.card.heading).toHaveText('France');
    await expect(organizations.selected).toHaveText('France');
    await page.goBack();
    await card.expectName('alice');
    await card.backButton.click();
    await expect(list.heading).toHaveText('Users');
    await expect(list.row('alice')).toBeVisible();
  });

  test('USER-02 create an account through the form', async ({
    page,
    directory,
    tenant,
  }) => {
    const backend = await directory.createOrganization({
      parent: tenant.org.dn,
      name: 'Backend',
    });
    const unique = uniquePart();
    const uid = `tom.${unique}`;
    directory.trackUser(uid);
    const app = await new LoginPage(page).loginAs(ADMIN, 'users');

    await app.list().newButton.click();
    const form = app.form();
    await form.expectOpen('New user');
    await form.fillAll({
      'Employee ID': `E-${unique}`,
      'Last name': 'Tester',
      'First name': 'Tom',
    });
    await form.fill('Full name', 'Tom Tester');
    await form.fill('Email', `${uid}@example.com`);
    // the identifier the server will take from it, before it is created
    await expect(form.identifier('Email')).toHaveText(
      `Identifier: ${uid} (sign-in name, cannot be changed later). A number is added to it if it is already taken.`
    );
    await form.select('Title', 'Mr');
    await form.select('Position', 'Software Engineer');
    await form.pick('Department', 'Back', backend.path);
    await expect(form.tokens('Department')).toHaveText([backend.path]);
    await form.addValue('Email aliases', `tom-${unique}@example.com`);
    await form.submit();

    await app.expectToast('Tom Tester created');
    await form.expectClosed();
    const card = app.entry();
    await card.expectName(uid);
    await expect(card.detail('Identifier')).toHaveText(uid);
    await expect(card.detail('Status')).toHaveText('Active');
    await expect(card.detail('Department path')).toHaveText(backend.path);
    await expect(card.detail('Email aliases')).toHaveText(
      `tom-${unique}@example.com`
    );

    await app.navItem('Users').click();
    await app.list().search(uid);
    await expect(app.list().row(uid)).toBeVisible();
  });

  test('USER-03 the form checks the values before sending', async ({
    page,
    directory,
  }) => {
    const unique = uniquePart();
    const uid = `form.${unique}`;
    directory.trackUser(uid);
    const app = await new LoginPage(page).loginAs(ADMIN, 'users');
    const creations: string[] = [];
    page.on('request', request => {
      if (
        request.method() === 'POST' &&
        request.url().includes('/api/v1/ldap/users')
      )
        creations.push(request.url());
    });

    await app.list().newButton.click();
    const form = app.form();
    await form.expectOpen('New user');
    await expect(form.requiredLegend).toHaveText(
      'Fields marked with * are required'
    );
    await form.submit();
    for (const label of [
      'Employee ID',
      'Department',
      'Last name',
      'First name',
      'Email',
    ])
      await expect(form.error(label), label).toHaveText('Required');
    await expect(form.dialog).toBeVisible();

    await form.fill('Email', 'not-an-email');
    await form.fill('Mailbox size', 'lots');
    await form.fill('Deletion date', isoDate(-1));
    await form.submit();
    await expect(form.error('Email')).toContainText(
      'Expected an email address, e.g. jane.doe@example.org'
    );
    await expect(form.error('Mailbox size')).toBeVisible();
    await expect(form.error('Deletion date')).toHaveText(
      'Expected a date not earlier than today'
    );
    expect(creations).toEqual([]);

    await form.fillAll({
      'Employee ID': `E-${unique}`,
      'Last name': 'Form',
      'First name': 'Checked',
      'Full name': 'Checked Form',
      Email: `${uid}@example.com`,
      'Mailbox size': '4 GB',
      'Deletion date': isoDate(365),
    });
    await form.pick('Department', 'Human', 'Human Resources');
    await form.submit();
    await app.expectToast('Checked Form created');
    await expect(app.entry().detail('Mailbox size')).toHaveText('4 GB');
    expect(creations).toHaveLength(1);
  });

  test('USER-03 the form refuses in French, colons spaced', async ({
    page,
  }) => {
    const app = await new LoginPage(page).loginAs(ADMIN, 'users');
    await app.setLanguage('fr');
    await app.list().newButton.click();
    const form = app.form();
    await expect(form.dialog).toBeVisible();

    await form.fill('Adresse électronique', 'not-an-email').catch(async () => {
      await form.dialog.locator('#dc-field-mail').fill('not-an-email');
    });
    await form.dialog.locator('#dc-field-twakeDeletionDate').fill(isoDate(-1));
    await form.submit();
    await expect(
      form.dialog.locator('[data-field=twakeDeletionDate] [data-error]')
    ).toHaveText('Attendu : aujourd’hui ou une date ultérieure');
    await expect(
      form.dialog.locator('[data-field=mail] [data-error]')
    ).toBeVisible();
  });

  test('USER-03 an invalid Mailbox size reads the console message', async ({
    page,
  }) => {
    const app = await new LoginPage(page).loginAs(ADMIN, 'users');
    await app.list().newButton.click();
    const form = app.form();
    await form.expectOpen('New user');
    await form.fill('Mailbox size', 'lots');
    await form.submit();
    await expect(form.error('Mailbox size')).toHaveText(
      'Expected a size such as 4 GB, 500 MB or 100 KB, or a number of bytes'
    );
  });

  test('USER-15 the creation form writes the full name, completes the domain and folds optional fields', async ({
    page,
    directory,
  }) => {
    const unique = uniquePart();
    const uid = `jeanne.${unique}`;
    const dn = directory.trackUser(uid);
    const app = await new LoginPage(page).loginAs(ADMIN, 'users');
    await app.list().newButton.click();
    const form = app.form();
    await form.expectOpen('New user');

    // folded at first, Deletion date among them; nothing here goes through field(), which unfolds
    await expect(form.optionalFold.locator('summary')).toHaveText(
      /^Optional fields \(\d+\)$/
    );
    expect(await form.isUnfolded()).toBe(false);
    await expect(
      form.optionalFold.getByLabel(/^Deletion date( \*)?$/)
    ).toHaveCount(1);

    // Full name follows the names, as typed, until it is typed itself
    await form.control('First name').pressSequentially('Jeanne');
    await form.control('Last name').pressSequentially(`Durand${unique}`);
    await expect(form.control('Full name')).toHaveValue(
      `Jeanne Durand${unique}`
    );
    await form.control('Full name').fill(`Dr Jeanne Durand${unique}`);
    await form.control('First name').pressSequentially('x');
    await expect(form.control('Full name')).toHaveValue(
      `Dr Jeanne Durand${unique}`
    );
    await form.control('First name').fill('Jeanne');

    // "@" offers every domain with no department, then those the department allows
    const email = form.control('Email');
    await email.pressSequentially(`${uid}@`);
    // but the domains DOMAIN-01 adds meanwhile
    await expect(
      form.options('Email').filter({ hasNotText: TEST_DOMAIN })
    ).toHaveText([`${uid}@example.com`, `${uid}@lists.example.com`]);
    await form.pick('Department', 'Human', 'Human Resources');
    await email.fill('');
    await email.pressSequentially(`${uid}@`);
    await expect(form.options('Email')).toHaveText([`${uid}@example.com`]);
    await form.options('Email').first().click();
    await expect(email).toHaveValue(`${uid}@example.com`);
    await form.control('Employee ID').fill(`J-${unique}`);

    // a refused value inside the closed fold opens it
    if (!(await form.isUnfolded())) await form.toggleFold();
    await form.control('Deletion date').fill(isoDate(-1));
    await form.toggleFold();
    expect(await form.isUnfolded()).toBe(false);
    await form.submit();
    await expect(form.error('Deletion date')).toHaveText(
      'Expected a date not earlier than today'
    );
    expect(await form.isUnfolded()).toBe(true);

    await form.control('Deletion date').fill('');
    await form.submit();
    await app.expectToast(`Dr Jeanne Durand${unique} created`);
    expect(await directory.values(dn, 'displayName')).toEqual([
      `Dr Jeanne Durand${unique}`,
    ]);
  });

  test('USER-15 "@" offers the domains the department and the organizations above it link', async ({
    page,
    directory,
  }) => {
    const lists = await directory.createOrganization({ name: 'Lists' });
    await directory.addValues(lists.dn, 'twakeDomainLink', [
      'dc=lists,ou=domains,ou=nomenclature,dc=example,dc=com',
    ]);
    const local = `lists.${uniquePart()}`;
    const app = await new LoginPage(page).loginAs(ADMIN, 'users');
    await app.list().newButton.click();
    const form = app.form();
    await form.expectOpen('New user');

    // Human Resources links nothing: the top organization's example.com only
    await form.pick('Department', 'Human', 'Human Resources');
    const email = form.control('Email');
    await email.pressSequentially(`${local}@`);
    await expect(form.options('Email')).toHaveText([`${local}@example.com`]);
    // Enter takes the first, as in the other pickers
    await email.press('Enter');
    await expect(email).toHaveValue(`${local}@example.com`);

    // its own lists.example.com, beside example.com, which the top links
    await form.removeToken('Department', 'Human Resources');
    await form.pick('Department', 'Lists', lists.path);
    await email.fill('');
    await email.pressSequentially(`${local}@`);
    await expect(form.options('Email')).toHaveText([
      `${local}@example.com`,
      `${local}@lists.example.com`,
    ]);
  });

  test('USER-04 server rules: unique address and allowed domain', async ({
    page,
    directory,
  }) => {
    const unique = uniquePart();
    const app = await new LoginPage(page).loginAs(ADMIN, 'users');
    await app.list().newButton.click();
    const form = app.form();
    await form.expectOpen('New user');
    await form.fillAll({
      'Employee ID': `E-${unique}`,
      'Last name': 'Rules',
      'First name': 'Server',
      'Full name': 'Server Rules',
    });
    await form.pick('Department', 'Human', 'Human Resources');

    for (const mail of [
      'alice@example.com',
      `x.${unique}@other.org`,
      'alice.moreau@example.com',
    ]) {
      await form.fill('Email', mail);
      await form.submit();
      await expect(app.errorToast, mail).toBeVisible();
      await expect(app.errorToast).not.toHaveText(
        /Internal Server Error|check logs|^\s*\{/
      );
      await expect(form.dialog).toBeVisible();
      await app.errorToast.evaluate(
        toast => ((toast as HTMLElement).hidden = true)
      );
    }
    expect(await directory.usersStartingWith(`x.${unique}`)).toEqual([]);
    expect(await directory.values(ALICE.dn, 'employeeNumber')).toEqual([
      'E0010',
    ]);
  });

  test('USER-05 edit an account', async ({ page, directory }) => {
    const user = await directory.createUser({
      extra: {
        title: 'cn=Sales Representative,ou=positions,dc=example,dc=com',
      },
    });
    const alias = `${user.uid}.s@example.com`;
    const app = await new LoginPage(page).loginAs(ADMIN, `users/${user.uid}`);
    const card = app.entry();

    await card.action('Edit').click();
    const form = app.form();
    await form.expectOpen(`Edit — ${user.uid}`);
    await expect(form.dialog.getByLabel(/^Identifier/)).toHaveCount(0);
    await expect(form.tokens('Department')).toHaveText([HUMAN_RESOURCES.path]);
    await expect(await form.field('Position')).toHaveValue(
      'cn=Sales Representative,ou=positions,dc=example,dc=com'
    );
    await form.fill('Mobile', '+49 170 0000000');
    await form.select('Position', 'Sales Manager');
    await form.addValue('Email aliases', alias);
    await form.submit();

    await app.expectToast('Saved');
    await expect(card.detail('Mobile')).toHaveText('+49 170 0000000');
    await expect(card.detail('Position')).toHaveText('Sales Manager');
    await expect(card.detail('Email aliases')).toHaveText(alias);

    await card.action('Edit').click();
    await form.expectOpen(`Edit — ${user.uid}`);
    await form.removeToken('Email aliases', alias);
    await form.submit();
    await app.expectToast('Saved');
    await expect(card.detail('Email aliases')).toHaveText('—');
    expect(await directory.values(user.dn, 'mailAlternateAddress')).toEqual([]);

    // Cancel and × close without saving
    await card.action('Edit').click();
    await form.fill('Mobile', '+00 0');
    await form.cancel();
    await card.action('Edit').click();
    await form.fill('Mobile', '+00 0');
    await form.closeButton.click();
    await form.expectClosed();
    expect(await directory.values(user.dn, 'mobile')).toEqual([
      '+49 170 0000000',
    ]);
  });

  test('USER-05 change the address of an account; a taken one is refused', async ({
    page,
    directory,
  }) => {
    const user = await directory.createUser();
    const unique = uniquePart();
    const app = await new LoginPage(page).loginAs(ADMIN, `users/${user.uid}`);
    const card = app.entry();
    await card.action('Edit').click();
    const form = app.form();
    await form.expectOpen(`Edit — ${user.uid}`);

    // alice's alias, bob's address, a domain the directory does not have
    for (const taken of [
      'alice.moreau@example.com',
      'bob@example.com',
      `x.${unique}@other.org`,
    ]) {
      await form.fill('Email', taken);
      await form.submit();
      await expect(app.errorToast, taken).toBeVisible();
      if (!taken.endsWith('other.org'))
        await expect(app.errorToast).toContainText(taken);
      await expect(app.errorToast).not.toHaveText(
        /Internal Server Error|check logs|^\s*\{/
      );
      await expect(form.dialog).toBeVisible();
      await app.errorToast.evaluate(
        toast => ((toast as HTMLElement).hidden = true)
      );
    }
    expect(await directory.values(user.dn, 'mail')).toEqual([user.mail]);

    const renamed = `renamed.${unique}@example.com`;
    const alias = `alias.${unique}@example.com`;
    await form.fill('Email', renamed);
    await form.addValue('Email aliases', alias);
    await form.submit();
    await app.expectToast('Saved');
    await form.expectClosed();
    await expect(card.detail('Email')).toHaveText(renamed);
    await expect(card.detail('Email aliases')).toHaveText(alias);
    // the identifier comes from the address at creation only
    await expect(card.detail('Identifier')).toHaveText(user.uid);
    expect(await directory.values(user.dn, 'mail')).toEqual([renamed]);
    expect(await directory.values(user.dn, 'mailAlternateAddress')).toEqual([
      alias,
    ]);

    await app.navItem('Users').click();
    const list = app.list();
    await list.search(renamed, 'Email');
    await expect(list.row(user.uid)).toBeVisible();
    await list.search(user.mail, 'Email');
    await expect(list.emptyState).toHaveText('No entry matches this search');
  });

  test('USER-06 the Department field searches the tree', async ({
    page,
    directory,
    tenant,
    loginInNewContext,
  }) => {
    const france = await directory.createOrganization({
      parent: tenant.org.dn,
      name: 'France',
    });
    const germany = await directory.createOrganization({
      parent: tenant.org.dn,
      name: 'Germany',
    });
    const user = await directory.createUser({ org: france });
    const app = await new LoginPage(page).loginAs(ADMIN, `users/${user.uid}`);
    const card = app.entry();

    await card.action('Edit').click();
    const form = app.form();
    await form.expectOpen(`Edit — ${user.uid}`);
    await expect(form.tokens('Department')).toHaveText([france.path]);
    await expect(
      form.token('Department', france.path).locator('span')
    ).toHaveAttribute('title', france.dn);
    await form.removeToken('Department', france.path);

    await form.type('Department', 'Ge');
    await expect(form.options('Department')).toHaveCount(0);
    await form.type('Department', 'ackend');
    await expect(
      form.options('Department').filter({ hasText: 'Engineering / Backend' })
    ).toBeVisible();
    await form.type('Department', 'Sales');
    await expect(
      form.options('Department').filter({ hasText: 'Sales / France' })
    ).toBeVisible();
    await expect(
      form.options('Department').filter({ hasText: 'Sales / Germany' })
    ).toBeVisible();

    await form.chooseWithKeyboard('Department', 'Ger', germany.path);
    await expect(form.tokens('Department')).toHaveText([germany.path]);
    await form.submit();
    await app.expectToast('Saved');
    await expect(card.detail('Department path')).toHaveText(germany.path);
    expect(await directory.values(user.dn, 'twakeDepartmentLink')).toEqual([
      germany.dn,
    ]);

    const sophie = await loginInNewContext(SOPHIE, 'users');
    await sophie.list().newButton.click();
    const sophieForm = sophie.form();
    await sophieForm.expectOpen('New user');
    await sophieForm.type('Department', 'Eng');
    await expect(sophieForm.suggestions('Department')).toBeVisible();
    await expect(sophieForm.options('Department')).toHaveCount(0);
    await sophieForm.type('Department', 'Fra');
    await expect(sophieForm.options('Department')).toHaveText([
      'Sales / France',
    ]);
  });

  test('USER-07 account-pointer fields are search boxes (Delegates)', async ({
    page,
    directory,
  }) => {
    const user = await directory.createUser();
    const app = await new LoginPage(page).loginAs(ADMIN, `users/${user.uid}`);
    const card = app.entry();

    await card.action('Edit').click();
    const form = app.form();
    await form.expectOpen(`Edit — ${user.uid}`);
    await form.type('Delegates', 'da');
    await expect(form.options('Delegates')).toHaveCount(0);
    await form.type('Delegates', 'dav');
    await expect(
      form.options('Delegates').filter({ hasText: 'Dave Okafor' })
    ).toContainText('dave');
    await form.chooseWithKeyboard('Delegates', 'dav', 'Dave Okafor');
    await form.chooseWithKeyboard('Delegates', 'eri', 'Erin Walsh');
    await expect(form.tokens('Delegates')).toHaveCount(2);
    await form.submit();

    await app.expectToast('Saved');
    await expect(card.detail('Delegates')).toContainText('dave');
    await expect(card.detail('Delegates')).toContainText('erin');
    expect(
      (await directory.values(user.dn, 'twakeDelegatedUsers')).sort()
    ).toEqual([
      'uid=dave,ou=users,dc=example,dc=com',
      'uid=erin,ou=users,dc=example,dc=com',
    ]);
  });

  test("USER-08 change an account's state", async ({ page, directory }) => {
    const user = await directory.createUser();
    const disabled = await directory.createUser({ status: 'disabled' });
    const app = await new LoginPage(page).loginAs(ADMIN, `users/${user.uid}`);
    const card = app.entry();

    // The panel shows the current state and offers the others; nothing is
    // written until its button, named after the choice, is pressed.
    await card.changeState.click();
    await expect(card.statePanel).toContainText('Current state: Active');
    await expect(card.stateChoices()).toHaveCount(3);
    for (const state of ['Disabled', 'No access', 'To delete'])
      await expect(
        card.statePanel.getByRole('radio', { name: state, exact: true })
      ).toBeVisible();
    await card.statePanel
      .getByRole('radio', { name: 'Disabled', exact: true })
      .press('ArrowDown');
    await expect(card.statePanel.locator('button[type=submit]')).toHaveText(
      'Remove access'
    );
    await card.statePanel.getByRole('button', { name: 'Cancel' }).click();
    await expect(card.statePanel).toBeHidden();
    await expect(card.detail('Status')).toHaveText('Active');

    for (const state of ['Disabled', 'No access', 'To delete', 'Active']) {
      await card.changeStateTo(state);
      await expect(app.toast).toBeVisible();
      await expect(app.toast).toContainText(`is now ${state}`);
      await expect(app.toast).not.toContainText(
        /cn=|twakeAccountStatus|noaccess|todelete/
      );
      await expect(card.detail('Status')).toHaveText(state);
    }
    await app.navItem('Users').click();
    await app.list().search(user.uid);
    await expect(app.list().cells(user.uid).nth(5)).toHaveText('Active');

    await app.open(`users/${disabled.uid}`);
    await expect(card.detail('Status')).toHaveText('Disabled');
    await card.changeStateTo('Active');
    await expect(card.detail('Status')).toHaveText('Active');
  });

  test('USER-09 reset password: generated and typed', async ({
    page,
    directory,
    loginInNewContext,
  }) => {
    const user = await directory.createUser();
    await page.clock.install();
    const app = await new LoginPage(page).loginAs(ADMIN, `users/${user.uid}`);
    const card = app.entry();
    const dialog = new ResetPasswordDialog(page);

    await card.action('Reset password').click();
    await dialog.expectOpen();
    await expect(dialog.hint).toHaveText('Leave empty to generate a password');
    await expect(dialog.forceChange).toBeChecked();
    await dialog.confirmButton.click();
    // in the panel, never in a toast, which one click dismissed for good
    await expect(dialog.title).toHaveText(`New password — ${user.uid}`);
    await expect(dialog.generated).toHaveValue(/.+/);
    await expect(dialog.generated).toBeFocused();
    await expect(dialog.generatedHelp).toHaveText(
      `Give this password to ${user.uid}. It will not be shown again. They will have to change it when they next sign in.`
    );
    await expect(dialog.copyButton).toHaveText('Copy');
    await expect(app.toast).toBeHidden();
    // it stays, and a click in it selects it rather than losing it
    await page.clock.runFor(30_000);
    await dialog.generated.click();
    await expect(dialog.generated).toBeVisible();
    // closing it uncopied asks first, once per attempt
    await dialog.doneButton.click();
    await expect(dialog.leavePrompt).toContainText(
      'Close without copying the password?'
    );
    await dialog.leaveBack.click();
    await expect(dialog.leavePrompt).toBeHidden();
    await page.keyboard.press('Escape');
    await expect(dialog.leavePrompt).toBeVisible();
    await dialog.leaveClose.click();
    await expect(dialog.dialog).toBeHidden();

    await card.action('Reset password').click();
    await dialog.passwordInput.fill('N3w-Passw0rd!');
    await dialog.forceChange.uncheck();
    await dialog.confirmButton.click();
    await app.expectToast('Password changed');
    await expect(app.toast).not.toContainText('N3w-Passw0rd!');

    const signedIn = await loginInNewContext({
      ...user,
      password: 'N3w-Passw0rd!',
    });
    await expect(signedIn.banner).toContainText('You administer no branch');
  });

  test('USER-09 the dialog hint in French', async ({ page, directory }) => {
    const user = await directory.createUser();
    const app = await new LoginPage(page).loginAs(ADMIN, `users/${user.uid}`);
    await app.setLanguage('fr');
    await app.entry().actions().filter({ hasText: 'Réinitialiser' }).click();
    await expect(new ResetPasswordDialog(page).hint).toHaveText(
      'Laissez vide pour générer un mot de passe'
    );
  });

  test('USER-10 delete an account', async ({ page, directory }) => {
    const user = await directory.createUser();
    const group = await directory.createGroup({ members: [user, ALICE] });
    const app = await new LoginPage(page).loginAs(ADMIN, `users/${user.uid}`);
    const card = app.entry();
    await expect(card.relatedItems('Mailing lists')).toHaveText([group.cn]);

    let message = answerNextConfirm(page, false);
    await card.action('Delete').click();
    expect(await message).toBe(`Delete ${user.uid}? This cannot be undone.`);
    await card.expectName(user.uid);
    expect(await directory.exists(user.dn)).toBe(true);

    message = answerNextConfirm(page, true);
    await card.action('Delete').click();
    await message;
    await app.expectToast('Deleted');
    await expect(app.mainHeading).toHaveText('Users');
    expect(await directory.exists(user.dn)).toBe(false);

    await app.open(`groups/${group.cn}`);
    await expect(app.entry().relatedItems('Members')).toHaveText(['alice']);
    expect(await directory.values(group.dn, 'member')).not.toContain(user.dn);
  });

  test('USER-08 USER-09 USER-10 a local administrator changes the state, sets the password and deletes an account of their branch', async ({
    page,
    directory,
    tenant,
    loginInNewContext,
  }) => {
    const user = await directory.createUser({ org: tenant.org });
    const app = await new LoginPage(page).loginAs(
      tenant.admin,
      `users/${user.uid}`
    );
    const card = app.entry();

    await card.changeStateTo('Disabled');
    await expect(app.toast).toContainText('is now Disabled');
    await expect(app.errorToast).toHaveCount(0);
    await expect(card.detail('Status')).toHaveText('Disabled');
    expect(await directory.values(user.dn, 'twakeAccountStatus')).toEqual([
      'cn=disabled,ou=twakeAccountStatus,ou=nomenclature,dc=example,dc=com',
    ]);
    await card.changeStateTo('Active');
    await expect(card.detail('Status')).toHaveText('Active');
    expect(await directory.values(user.dn, 'twakeAccountStatus')).toEqual([
      'cn=active,ou=twakeAccountStatus,ou=nomenclature,dc=example,dc=com',
    ]);

    // generated, a change required at next sign-in (the default)
    const dialog = new ResetPasswordDialog(page);
    await card.action('Reset password').click();
    await dialog.expectOpen();
    await expect(dialog.forceChange).toBeChecked();
    await dialog.confirmButton.click();
    await expect(dialog.generated).toHaveValue(/.+/);
    await dialog.closeUncopied();
    expect(await directory.values(user.dn, 'pwdReset')).toEqual(['TRUE']);

    // typed, no change required
    await card.action('Reset password').click();
    await dialog.expectOpen();
    await dialog.passwordInput.fill('L0cal-Admin-Set!');
    await dialog.forceChange.uncheck();
    await dialog.confirmButton.click();
    await app.expectToast('Password changed');
    // ldap-rest writes FALSE rather than removing the attribute
    expect(await directory.values(user.dn, 'pwdReset')).not.toContain('TRUE');
    const owner = await loginInNewContext({
      ...user,
      password: 'L0cal-Admin-Set!',
    });
    await expect(owner.banner).toContainText('You administer no branch');

    const message = answerNextConfirm(page, true);
    await card.action('Delete').click();
    expect(await message).toBe(`Delete ${user.uid}? This cannot be undone.`);
    await app.expectToast('Deleted');
    await expect(app.mainHeading).toHaveText('Users');
    expect(await directory.exists(user.dn)).toBe(false);
  });

  test('USER-10 a deleted account leaves the groups it owns and belongs to', async ({
    page,
    directory,
  }) => {
    const leaver = await directory.createUser({ prefix: 'leaver' });
    const colleague = await directory.createUser();
    const group = await directory.createGroup({
      owners: [leaver, colleague],
      members: [leaver, colleague],
    });
    const app = await new LoginPage(page).loginAs(ADMIN, `users/${leaver.uid}`);

    const message = answerNextConfirm(page, true);
    await app.entry().action('Delete').click();
    await message;
    await app.expectToast('Deleted');

    expect(await directory.values(group.dn, 'owner')).toEqual([colleague.dn]);
    expect(await directory.values(group.dn, 'member')).toEqual([colleague.dn]);
    const card = await app.openEntry(`groups/${group.cn}`);
    await expect(card.relatedItems('Members')).toHaveText([colleague.uid]);
    await expect(card.detail('Owners')).not.toContainText(leaver.uid);
  });

  test('USER-10 a deleted account is removed from the organizations and accounts naming it, and grants nothing to its successor', async ({
    page,
    directory,
    loginInNewContext,
  }) => {
    const leaver = await directory.createUser({ prefix: 'leaver' });
    const colleague = await directory.createUser();
    const org = await directory.createOrganization({
      managers: [leaver],
      localAdmins: [leaver],
    });
    await directory.addValues(colleague.dn, 'twakeDelegatedUsers', [leaver.dn]);
    const app = await new LoginPage(page).loginAs(ADMIN, `users/${leaver.uid}`);

    const message = answerNextConfirm(page, true);
    await app.entry().action('Delete').click();
    await message;
    await app.expectToast('Deleted');

    // the server removes the links once the deletion has landed, after its answer
    await expect
      .poll(() => directory.values(org.dn, 'twakeLocalAdminLink'))
      .toEqual([]);
    await expect
      .poll(() => directory.values(org.dn, 'twakeManagerLink'))
      .toEqual([]);
    await expect
      .poll(() => directory.values(colleague.dn, 'twakeDelegatedUsers'))
      .toEqual([]);

    const organizations = await app.openOrganizations(org.dn);
    await expect(organizations.card.detail('Local administrators')).toHaveText(
      '—'
    );
    await expect(organizations.card.detail('Managers')).toHaveText('—');
    const card = await app.openEntry(`users/${colleague.uid}`);
    await expect(card.detail('Delegates')).toHaveText('—');

    // the uid comes from the address: a new account given it gets the same DN
    const successor = await directory.createUser({ uid: leaver.uid });
    const signedIn = await loginInNewContext(successor);
    await expect(signedIn.banner).toContainText('You administer no branch');
  });

  test('USER-11 a local administrator moves an account between two organizations of their scope', async ({
    page,
    directory,
    tenant,
  }) => {
    const france = await directory.createOrganization({
      parent: tenant.org.dn,
      name: 'France',
    });
    const germany = await directory.createOrganization({
      parent: tenant.org.dn,
      name: 'Germany',
    });
    const user = await directory.createUser({ org: germany });
    const app = await new LoginPage(page).loginAs(
      tenant.admin,
      `users/${user.uid}`
    );
    const card = app.entry();

    await card.action('Edit').click();
    const form = app.form();
    await form.expectOpen(`Edit — ${user.uid}`);
    await form.removeToken('Department', germany.path);
    await form.pick('Department', 'Fra', france.path);
    await form.submit();

    await app.expectToast('Saved');
    await expect(card.detail('Department path')).toHaveText(france.path);
    await app.navItem('Users').click();
    await app.list().search(user.uid);
    await expect(app.list().row(user.uid)).toBeVisible();
  });

  test('USER-12 a local administrator creates an account in their branch only', async ({
    page,
    directory,
    tenant,
    loginInNewContext,
  }) => {
    const frontend = await directory.createOrganization({
      parent: tenant.org.dn,
      name: 'Frontend',
    });
    const unique = uniquePart();
    const uid = `fe.${unique}`;
    directory.trackUser(uid);
    const app = await new LoginPage(page).loginAs(tenant.admin, 'users');

    await app.list().newButton.click();
    const form = app.form();
    await form.expectOpen('New user');
    await form.fillAll({
      'Employee ID': `E-${unique}`,
      'Last name': 'Dev',
      'First name': 'Front',
      'Full name': 'Front Dev',
      Email: `${uid}@example.com`,
    });
    await form.pick('Department', 'Front', frontend.path);
    await form.submit();
    await app.expectToast('Front Dev created');
    await app.entry().expectName(uid);

    await app.navItem('Users').click();
    await app.list().search(uid);
    await expect(app.list().row(uid)).toBeVisible();

    const admin = await loginInNewContext(ADMIN, 'users');
    await admin.list().search(uid);
    await expect(admin.list().row(uid)).toBeVisible();
    const sophie = await loginInNewContext(SOPHIE, 'users');
    await sophie.list().search(uid);
    await expect(sophie.list().emptyState).toHaveText(
      'No entry matches this search'
    );
  });

  test('USER-13 a DN with a Copy button', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    const app = await new LoginPage(page).loginAs(ADMIN);
    const cards: [string, string][] = [
      ['users/alice', 'uid=alice,ou=users,dc=example,dc=com'],
      ['groups/sales-team', 'cn=sales-team,ou=groups,dc=example,dc=com'],
      [`organizations/${encodeURIComponent(ORG.sales)}`, ORG.sales],
    ];
    for (const [hash, dn] of cards) {
      await app.open(hash);
      const card = hash.startsWith('organizations')
        ? app.organizations().card
        : app.entry();
      await expect(card.dn).toHaveText(dn);
      await expect(card.dn).toHaveCSS('font-family', /mono/i);
      await expect(card.copyButton).toHaveText('Copy');
      await card.copyButton.click();
      await expect(card.copyButton).toHaveText('Copied');
      expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
        dn
      );
      await expect(card.copyButton).toHaveText('Copy');
    }

    await app.setLanguage('fr');
    await app.open('users/alice');
    const card = app.entry();
    await expect(card.detailLabels().first()).toHaveText('Nom distinctif (DN)');
    await expect(card.copyButton).toHaveText('Copier');
    await card.copyButton.click();
    await expect(card.copyButton).toHaveText('Copié');
  });

  test('USER-14 a date reads as a date in the interface language', async ({
    page,
    directory,
  }) => {
    const user = await directory.createUser();
    const app = await new LoginPage(page).loginAs(ADMIN, `users/${user.uid}`);
    const card = app.entry();

    await card.action('Edit').click();
    const form = app.form();
    await form.expectOpen(`Edit — ${user.uid}`);
    await form.fill('Deletion date', '2031-01-15');
    await form.submit();
    await app.expectToast('Saved');
    await expect(card.detail('Deletion date')).toHaveText(
      /January 15, 2031|1\/15\/2031|15 January 2031/
    );
    await expect(card.detail('Deletion date')).not.toContainText('20310115');

    await app.setLanguage('fr');
    await expect(
      card.article.getByText(/^(15 janvier 2031|15\/01\/2031)$/)
    ).toBeVisible();
    await card.actions().filter({ hasText: 'Modifier' }).click();
    await expect(
      form.dialog.locator('#dc-field-twakeDeletionDate')
    ).toHaveValue('2031-01-15');
  });
});

test.describe('USER dates far from Paris', () => {
  test.use({ timezoneId: 'Pacific/Honolulu' });

  test('USER-14 the same day whatever the time zone', async ({
    page,
    directory,
  }) => {
    const user = await directory.createUser({
      extra: { twakeDeletionDate: '20310115000000Z' },
    });
    const app = await new LoginPage(page).loginAs(ADMIN, `users/${user.uid}`);
    await expect(app.entry().detail('Deletion date')).toHaveText(
      /January 15, 2031|1\/15\/2031/
    );
    await app.entry().action('Edit').click();
    await expect(
      app.form().dialog.locator('#dc-field-twakeDeletionDate')
    ).toHaveValue('2031-01-15');
  });
});
