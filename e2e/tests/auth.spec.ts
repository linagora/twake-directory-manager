import { ConsolePage, LoginPage } from '../pages';
import { ADMIN, ALICE, ERIN, FRANK, GRACE } from '../support/accounts';
import { CONSOLE_PATH } from '../support/env';
import { expect, test } from '../support/fixtures';

test.describe('AUTH sign-in and session', () => {
  test('AUTH-01 sign in through Dex lands on the overview', async ({
    page,
  }) => {
    const app = await new LoginPage(page).loginAs(ADMIN);

    await expect(page).toHaveURL(new RegExp(`${CONSOLE_PATH}(#/)?$`));
    await expect(app.mainHeading).toHaveText('Twake Directory Manager');
    await expect(
      app.main.getByText('Signed in as Ada Admin (admin@example.com)', {
        exact: true,
      })
    ).toBeVisible();
    await expect(app.main).not.toContainText('uid=admin');
    await expect(
      app.main.getByRole('heading', { name: 'What you can manage' })
    ).toBeVisible();
    await expect(app.banner).toContainText('You administer');
    await expect(app.scopeBranches).toHaveText([
      /^\s*organization\s+read, write, delete\s*$/,
    ]);
    await expect(app.toast).toBeHidden();
  });

  test('AUTH-02 sign out ends the session at the provider', async ({
    page,
  }) => {
    const app = await new LoginPage(page).loginAs(ADMIN);

    await app.signOutLink.click();

    await expect(page).not.toHaveURL(new RegExp(CONSOLE_PATH));
    await expect(app.banner).toBeHidden();
    await page.goto(CONSOLE_PATH);
    await new LoginPage(page).expectShown();
    await expect(app.banner).toBeHidden();
  });

  test('AUTH-03 deep link to an entry', async ({ page, loginInNewContext }) => {
    const app = await new LoginPage(page).loginAs(ADMIN);

    await page.goto(`${CONSOLE_PATH}#/users/alice`);
    await app.entry().expectName('Alice Moreau');

    // Without a session: after the sign-in, the card or the overview (documented)
    const other = await loginInNewContext(ADMIN);
    await other.page.goto(`${CONSOLE_PATH}#/users/alice`);
    await expect(
      other
        .entry()
        .heading.or(
          other.mainHeading.filter({ hasText: 'Twake Directory Manager' })
        )
    ).toBeVisible();
    await expect(other.errorToast).toBeHidden();
  });

  test('AUTH-03 a deep link opened without a session asks for the sign-in first', async ({
    page,
  }) => {
    const login = new LoginPage(page);
    await page.goto(`${CONSOLE_PATH}#/users/alice`);
    await login.expectShown();
    await login.submit(ADMIN);

    const app = new ConsolePage(page);
    await app.expectLoaded();
    await expect(
      app
        .entry()
        .heading.or(
          app.mainHeading.filter({ hasText: 'Twake Directory Manager' })
        )
    ).toBeVisible();
    await expect(app.errorToast).toBeHidden();
  });

  for (const account of [ALICE, GRACE, ERIN]) {
    test(`AUTH-04 ${account.uid}, who administers nothing, signs in and may do nothing`, async ({
      page,
    }) => {
      const app = await new LoginPage(page).loginAs(account);

      await expect(app.banner).toContainText('You administer no branch');
      await app.expectNoRights(account.uid);

      for (const hash of ['users', 'groups', 'organizations', 'users/bob']) {
        await app.open(hash);
        await expect(app.nothingToManage).toBeVisible();
        await expect(app.nothingToManage).not.toHaveClass(/dc-error/);
        await expect(app.main.getByRole('searchbox')).toHaveCount(0);
        await expect(app.main.getByRole('table')).toHaveCount(0);
        await expect(
          app.main.getByRole('button', { name: 'Import CSV' })
        ).toHaveCount(0);
        await expect(
          app.main.getByRole('button', { name: 'Edit' })
        ).toHaveCount(0);
        await expect(app.main).not.toContainText(
          'Token does not have permission'
        );
        await expect(app.errorToast).toBeHidden();
      }

      await app.setLanguage('fr');
      for (const hash of ['users', 'groups', 'organizations']) {
        await app.open(hash);
        await expect(
          app.main.getByText(
            'Vous n’administrez aucune branche : il n’y a rien à gérer ici pour vous.',
            { exact: true }
          )
        ).toBeVisible();
      }
    });
  }

  test('AUTH-05 a disabled account gets no right', async ({ page }) => {
    const login = new LoginPage(page);
    await page.goto(CONSOLE_PATH);
    await login.submit(FRANK);

    // Dex's LDAP connector lets a disabled account authenticate: the console grants it nothing
    const app = new ConsolePage(page);
    const refused = page.getByText(/invalid username and password/i);
    await expect(refused.or(app.banner)).toBeVisible();
    if (await refused.isVisible()) return;
    await expect(app.banner).toContainText('You administer no branch');
    await app.expectNoRights(FRANK.uid);
    await app.open('users');
    await expect(app.nothingToManage).toBeVisible();
  });
});
