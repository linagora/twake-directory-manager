import {
  AddToGroupsDialog,
  ConfirmDialog,
  LoginPage,
  ResetPasswordDialog,
} from '../pages';
import { ADMIN, ALICE, ORG, SOPHIE } from '../support/accounts';
import {
  HUMAN_RESOURCES,
  TEST_DOMAIN,
  type Organization,
  uniquePart,
} from '../support/directory';
import { expect, test } from '../support/fixtures';

/** The seeded Sales and Engineering, for groups of the test's own */
const SALES: Organization = { dn: ORG.sales, name: 'Sales', path: 'Sales' };
const ENGINEERING: Organization = {
  dn: ORG.engineering,
  name: 'Engineering',
  path: 'Engineering',
};

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
    await card.expectName('Alice Moreau');
    await expect(card.subtitle).toHaveText('alice · alice@example.com');
    await expect(page).toHaveTitle('Alice Moreau — Twake Directory Manager');
    await expect(card.actions()).toHaveText([
      'Edit',
      'Reset password',
      'Change state…',
      'More',
    ]);
    await expect(card.moreActions()).toHaveText(['Hand over', 'Delete']);
    await expect(card.moreMenu).toBeHidden();
    await expect(card.changeState).toBeVisible();

    await expect(card.detailGroups()).toHaveText([
      'Identity',
      'Organization',
      'Contact',
      'Mailbox Settings',
    ]);
    await expect(card.detail('Title')).toHaveText('Mrs');
    await expect(card.detail('Position')).toHaveText('Sales Representative');
    await expect(card.detail('Status')).toHaveText('Active');
    // The path names the department, which is not said a second time
    await expect(card.detail('Department')).toHaveCount(0);
    await expect(card.detail('Department path')).toHaveText('Sales / France');
    // Said in the heading: neither the identifier nor the full name, nor the
    // common name that repeats it
    for (const said of ['Identifier', 'Full name', 'Common name'])
      await expect(card.detail(said)).toHaveCount(0);
    await expect(card.detail('Email aliases')).toHaveText(
      'alice.moreau@example.com'
    );
    await expect(card.detail('Mailbox size')).toHaveText('1.07 GB');
    await expect(card.detail('Mailbox size').locator('span')).toHaveAttribute(
      'title',
      '1073741824 bytes'
    );
    await expect(card.detail('Comment')).toBeHidden();
    await expect(card.emptyFields.locator('summary')).toHaveText(
      /^Show empty fields \(\d+\)$/
    );
    await card.showEmptyFields();
    await expect(card.detail('Comment')).toHaveText('—');
    for (const hidden of ['Delivery mode', 'Other mailboxes', 'Password'])
      await expect(card.detail(hidden)).toHaveCount(0);

    // The DN waits under Technical details
    await expect(card.dn).toBeHidden();
    await card.showTechnicalDetails();
    await expect(card.dn).toHaveText('uid=alice,ou=users,dc=example,dc=com');

    // More, from the keyboard
    await card.moreButton.focus();
    await page.keyboard.press('Enter');
    await expect(card.moreButton).toHaveAttribute('aria-expanded', 'true');
    await expect(card.action('Hand over')).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(card.action('Delete')).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(card.action('Hand over')).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(card.moreMenu).toBeHidden();
    await expect(card.moreButton).toHaveAttribute('aria-expanded', 'false');
    await expect(card.moreButton).toBeFocused();
    // Groups, each with its type, whatever the schema calls them (#129)
    await expect(card.relatedLinks('Groups')).toHaveText([
      'all-staff',
      'sales-team',
    ]);
    await expect(card.groupTypes()).toHaveText([
      '· Distribution list',
      '· Shared mailbox',
    ]);
    await expect(card.addToGroup()).toBeVisible();
    await expect(card.leaveGroup('sales-team')).toBeVisible();

    // Links, which a middle click opens in a new tab (#174)
    await expect(
      card.related('Groups').getByRole('link', { name: 'sales-team' })
    ).toHaveAttribute('href', '#/groups/sales-team');
    await card.relatedLinks('Groups').filter({ hasText: 'sales-team' }).click();
    await app.entry().expectName('sales-team');
    await page.goBack();
    await card.expectName('Alice Moreau');

    await card
      .detail('Department path')
      .getByRole('link', { name: 'Sales / France' })
      .click();
    const organizations = app.organizations();
    await expect(organizations.card.heading).toHaveText('France');
    await expect(organizations.selected).toHaveText('France');
    await page.goBack();
    await card.expectName('Alice Moreau');
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
    // created with no password: one is generated and shown, before the card
    // opens (#164)
    const password = new ResetPasswordDialog(page);
    await expect(password.title).toHaveText('New password — Tom Tester');
    await expect(password.generated).not.toHaveValue('');
    await expect(password.generatedHelp).toContainText(
      'They will have to change it when they next sign in.'
    );
    await password.closeUncopied();
    await form.expectClosed();
    const card = app.entry();
    await card.expectName('Tom Tester');
    await card.expectIdentifier(uid);
    await expect(card.detail('Status')).toHaveText('Active');
    await expect(card.detail('Department path')).toHaveText(backend.path);
    await expect(card.detail('Email aliases')).toHaveText(
      `tom-${unique}@example.com`
    );

    await app.openList('Users');
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
      // the creation only: the password generated next is posted under it
      if (
        request.method() === 'POST' &&
        new URL(request.url()).pathname === '/api/v1/ldap/users'
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
    await new ResetPasswordDialog(page).closeUncopied();
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
    await new ResetPasswordDialog(page).closeUncopied();
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

    // said under Email, in the console's words; the toast only points there
    for (const [mail, refusal] of [
      [
        'alice@example.com',
        'Email “alice@example.com” is already used by another entry.',
      ],
      [
        `x.${unique}@other.org`,
        /^Email: other\.org is not a mail domain of this organization\. Allowed: .*example\.com.*\.$/,
      ],
      [
        'alice.moreau@example.com',
        'Email “alice.moreau@example.com” is already used by another entry.',
      ],
    ] as const) {
      await form.fill('Email', mail);
      await form.submit();
      await app.expectToast('Not saved: see the highlighted field', true);
      await expect(form.error('Email'), mail).toHaveText(refusal);
      await expect(form.control('Email')).toHaveAttribute(
        'aria-invalid',
        'true'
      );
      await expect(form.control('Email')).toBeFocused();
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

  test('USER-04 an address already used is said in French under its field', async ({
    page,
  }) => {
    const unique = uniquePart();
    const app = await new LoginPage(page).loginAs(ADMIN, 'users');
    await app.setLanguage('fr');
    await app.list().newButton.click();
    const form = app.form();
    await form.expectOpen('Créer un utilisateur');
    await form.fillAll({
      Matricule: `E-${unique}`,
      'Nom de famille': 'Doublon',
      Prénom: 'Adresse',
      'Nom complet': 'Adresse Doublon',
    });
    await form.pick('Organisation', 'Human', 'Human Resources');
    await form.fill('Adresse électronique', 'alice@example.com');
    await form.submit();

    await app.expectToast('Non enregistré : voir le champ signalé', true);
    await expect(form.error('Adresse électronique')).toHaveText(
      'Adresse électronique « alice@example.com » : déjà utilisé par une autre entrée.'
    );
    const email = form.control('Adresse électronique');
    await expect(email).toHaveAttribute('aria-invalid', 'true');
    await expect(email).toBeFocused();
    await expect(form.dialog).toBeVisible();
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
    await expect(card.emptyField('Email aliases')).toHaveCount(1);
    expect(await directory.values(user.dn, 'mailAlternateAddress')).toEqual([]);

    // Cancel and × ask before throwing it away, then close without saving
    // (#169); Keep editing gives the form back as it was
    await card.action('Edit').click();
    await form.fill('Mobile', '+00 0');
    await form.cancelButton.click();
    await expect(form.discardPrompt).toContainText('Discard what you typed?');
    await expect(form.keepEditingButton).toBeFocused();
    await form.keepEditingButton.click();
    await expect(form.discardPrompt).toHaveCount(0);
    await expect(form.control('Mobile')).toHaveValue('+00 0');
    await form.discard();
    await card.action('Edit').click();
    await form.fill('Mobile', '+00 0');
    await form.closeButton.click();
    await expect(form.discardPrompt).toBeVisible();
    await page.keyboard.press('Escape');
    await form.expectClosed();
    // nothing changed: closed at once
    await card.action('Edit').click();
    await page.keyboard.press('Escape');
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
      await app.expectToast('Not saved: see the highlighted field', true);
      await expect(form.error('Email'), taken).toContainText(
        taken.endsWith('other.org') ? 'other.org' : `“${taken}”`
      );
      await expect(form.control('Email')).toHaveAttribute(
        'aria-invalid',
        'true'
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
    await card.expectIdentifier(user.uid);
    expect(await directory.values(user.dn, 'mail')).toEqual([renamed]);
    expect(await directory.values(user.dn, 'mailAlternateAddress')).toEqual([
      alias,
    ]);

    const list = await app.openList('Users');
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
    await app.openList('Users');
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
    await expect(dialog.confirmButton).toHaveText('Reset password');
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
    await expect(card.relatedLinks('Groups')).toHaveText([group.cn]);

    // named as a colleague would tell them apart, with the groups they leave
    const confirm = new ConfirmDialog(page);
    await card.perform('Delete');
    await confirm.expectOpen(`Delete ${user.displayName}?`);
    await expect(confirm.paragraphs).toHaveText([
      `${user.displayName} · ${user.mail} · ${HUMAN_RESOURCES.path}`,
      `This cannot be undone. ${user.displayName} will be removed from: ${group.cn}.`,
    ]);
    await expect(confirm.cancelButton).toBeFocused();
    await expect(confirm.confirmButton).toHaveText(
      `Delete ${user.displayName.split(' ')[0]}`
    );
    await page.keyboard.press('Escape');
    await expect(confirm.dialog).toBeHidden();
    await card.expectName(user.displayName);
    expect(await directory.exists(user.dn)).toBe(true);

    // the way out: the state change, Disabled picked, and nothing deleted
    await card.perform('Delete');
    await expect(confirm.alternative).toHaveText(
      'To stop access without deleting, set the state to Disabled instead.'
    );
    await confirm.alternative.click();
    await expect(confirm.dialog).toBeHidden();
    await expect(card.stateChoice('Disabled')).toBeChecked();
    await page.keyboard.press('Escape');
    await expect(card.statePanel).toBeHidden();
    await expect(card.detail('Status')).toHaveText('Active');
    expect(await directory.exists(user.dn)).toBe(true);

    await card.perform('Delete');
    await confirm.confirm();
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

    const confirm = new ConfirmDialog(page);
    await card.perform('Delete');
    await confirm.expectOpen(`Delete ${user.displayName}?`);
    await expect(confirm.alternative).toBeVisible();
    await confirm.confirm();
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

    await app.entry().perform('Delete');
    await new ConfirmDialog(page).confirm();
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

    await app.entry().perform('Delete');
    await new ConfirmDialog(page).confirm();
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
    await expect(
      organizations.card.emptyField('Local administrators')
    ).toHaveCount(1);
    await expect(organizations.card.emptyField('Managers')).toHaveCount(1);
    const card = await app.openEntry(`users/${colleague.uid}`);
    await expect(card.emptyField('Delegates')).toHaveCount(1);

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
    await app.openList('Users');
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
    await new ResetPasswordDialog(page).closeUncopied();
    await app.entry().expectName('Front Dev');

    await app.openList('Users');
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
      // Folded under Technical details, one click away
      await expect(card.technical.locator('summary')).toHaveText(
        'Technical details'
      );
      await expect(card.dn).toBeHidden();
      await card.showTechnicalDetails();
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
    await expect(card.technical.locator('summary')).toHaveText(
      'Détails techniques'
    );
    await card.showTechnicalDetails();
    await expect(card.technical.getByRole('term')).toHaveText(
      'Nom distinctif (DN)'
    );
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

  test('USER-16 add an account to groups and take it out of one, from its card', async ({
    page,
    directory,
  }) => {
    const user = await directory.createUser();
    // A member already: the groups are the test's own, and no seeded account's card lists them
    const colleague = await directory.createUser();
    const prefix = `join${uniquePart()}`;
    const shared = await directory.createGroup({
      prefix,
      org: SALES,
      mailboxType: 'teamMailbox',
      mail: `${prefix}@example.com`,
      members: [colleague],
    });
    const list = await directory.createGroup({
      prefix,
      org: ENGINEERING,
      mailboxType: 'mailingList',
      members: [colleague],
    });
    const app = await new LoginPage(page).loginAs(ADMIN, `users/${user.uid}`);
    const card = app.entry();
    await expect(card.related('Groups')).toBeVisible();
    await expect(card.relatedLinks('Groups')).toHaveCount(0);

    await card.addToGroup().click();
    const dialog = new AddToGroupsDialog(page);
    await dialog.expectOpen(`Add ${user.displayName} to groups`);
    await expect(dialog.search).toBeFocused();
    await expect(dialog.hint).toHaveText(
      'Type 3 characters of the group’s name'
    );
    await expect(dialog.addButton).toBeDisabled();
    // a click picks a suggestion, which says the group's type and address
    await dialog.search.fill(prefix);
    await expect(dialog.option(shared.cn)).toHaveText(
      `${shared.cn} — Shared mailbox — ${prefix}@example.com`
    );
    // the arrows walk the suggestions, round, the active one in view
    await expect(dialog.options).toHaveCount(2);
    const [first, second] = [dialog.options.nth(0), dialog.options.nth(1)];
    await expect(first).toHaveAttribute('aria-selected', 'true');
    await dialog.search.press('ArrowDown');
    await expect(second).toHaveAttribute('aria-selected', 'true');
    await expect(first).toHaveAttribute('aria-selected', 'false');
    await expect(dialog.search).toHaveAttribute(
      'aria-activedescendant',
      (await second.getAttribute('id')) as string
    );
    await expect(second).toBeInViewport();
    await dialog.search.press('ArrowDown');
    await expect(first).toHaveAttribute('aria-selected', 'true');
    await dialog.search.press('ArrowUp');
    await expect(second).toHaveAttribute('aria-selected', 'true');
    await expect(dialog.search).toHaveAttribute(
      'aria-activedescendant',
      (await second.getAttribute('id')) as string
    );
    await dialog.option(shared.cn).click();
    await expect(dialog.chosen).toHaveCount(1);
    await expect(dialog.chosen).toContainText(shared.cn);
    // so does Enter, and Enter in the empty box adds them
    await dialog.search.fill(list.cn);
    await expect(dialog.option(list.cn)).toHaveAttribute(
      'aria-selected',
      'true'
    );
    await dialog.search.press('Enter');
    await expect(dialog.chosen).toHaveCount(2);
    await expect(dialog.search).toHaveValue('');
    await dialog.search.press('Enter');

    await app.expectToast(
      `${user.displayName} added to ${shared.cn}, ${list.cn}`
    );
    await expect(dialog.dialog).toBeHidden();
    await expect(card.relatedLinks('Groups')).toHaveCount(2);
    await expect(
      card.relatedItems('Groups').filter({ hasText: shared.cn })
    ).toContainText('· Shared mailbox');
    await expect(
      card.relatedItems('Groups').filter({ hasText: list.cn })
    ).toContainText('· Distribution list');
    await expect(card.addToGroup()).toBeFocused();
    expect(await directory.values(shared.dn, 'member')).toContain(user.dn);
    expect(await directory.values(list.dn, 'member')).toContain(user.dn);
    // what the account is in is not offered again
    await card.addToGroup().click();
    await dialog.search.fill(prefix);
    await expect(dialog.note).toHaveText('No entry matches this search');
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await expect(dialog.dialog).toBeHidden();

    // one click on the ×, or Enter on it
    await card.leaveGroup(list.cn).click();
    await app.expectToast(`${user.displayName} removed from ${list.cn}`);
    await expect(card.relatedLinks('Groups')).toHaveText([shared.cn]);
    expect(await directory.values(list.dn, 'member')).not.toContain(user.dn);
    await card.leaveGroup(shared.cn).focus();
    await page.keyboard.press('Enter');
    await app.expectToast(`${user.displayName} removed from ${shared.cn}`);
    await expect(card.relatedLinks('Groups')).toHaveCount(0);
    expect(await directory.values(shared.dn, 'member')).toEqual([colleague.dn]);

    await app.setLanguage('fr');
    await expect(card.related('Groupes')).toBeVisible();
    await expect(card.addToGroup()).toHaveText('Ajouter à un groupe…');
  });

  test('USER-17 a solid focus ring, and remove buttons large enough to hit', async ({
    page,
  }) => {
    // The pale halo vanished around a blue button, and the × of a group was
    // 22 px against its name (#184).
    const app = await new LoginPage(page).loginAs(ADMIN, 'users');
    const card = await app.openEntry('users/alice');
    await card.expectName('Alice Moreau');
    const edit = card.action('Edit');
    await edit.focus();
    // By the keyboard, as :focus-visible asks.
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Tab');
    await expect(edit).toBeFocused();
    // Two rings: the surface's colour inside, the accent's outside, once the
    // button's shadow transition has run.
    await expect
      .poll(() => edit.evaluate(element => getComputedStyle(element).boxShadow))
      .toMatch(/^rgb\([^)]*\) 0px 0px 0px 2px, rgb\([^)]*\) 0px 0px 0px 4px$/);
    const remove = await card.leaveGroup('sales-team').boundingBox();
    expect(remove?.width).toBeGreaterThanOrEqual(24);
    expect(remove?.height).toBeGreaterThanOrEqual(24);
  });

  test('USER-16 a local administrator is offered the groups of their branch only', async ({
    page,
    directory,
    tenant,
  }) => {
    const user = await directory.createUser({ org: tenant.org });
    const colleague = await directory.createUser({ org: tenant.org });
    const prefix = `join${uniquePart()}`;
    const ours = await directory.createGroup({
      prefix,
      org: tenant.org,
      members: [colleague],
    });
    await directory.createGroup({
      prefix,
      org: ENGINEERING,
      members: [colleague],
    });
    // Engineering's, which the account is in: listed, with no ×
    const theirs = await directory.createGroup({
      org: ENGINEERING,
      members: [user],
    });
    const app = await new LoginPage(page).loginAs(
      tenant.admin,
      `users/${user.uid}`
    );
    const card = app.entry();
    await expect(card.relatedLinks('Groups')).toHaveText([theirs.cn]);
    await expect(card.leaveGroup(theirs.cn)).toHaveCount(0);

    await card.addToGroup().click();
    const dialog = new AddToGroupsDialog(page);
    await dialog.expectOpen();
    await dialog.search.fill(prefix);
    await expect(dialog.options).toHaveText([`${ours.cn} — Group`]);
    await dialog.choose(ours.cn);
    await dialog.addButton.click();
    await app.expectToast(`${user.displayName} added to ${ours.cn}`);
    await expect(card.leaveGroup(ours.cn)).toBeVisible();
    expect(await directory.values(ours.dn, 'member')).toContain(user.dn);
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
