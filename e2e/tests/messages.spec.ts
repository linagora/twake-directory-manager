import { ConsolePage, LoginPage } from '../pages';
import { ADMIN, ORG, SOPHIE } from '../support/accounts';
import { expect, test } from '../support/fixtures';

test.describe('MSG messages and error handling', () => {
  test('MSG-01 a server refusal shows as a red toast with the reason', async ({
    page,
    directory,
  }) => {
    const app = await new LoginPage(page).loginAs(SOPHIE);
    const organizations = await app.openOrganizations(ORG.sales);
    await expect(organizations.card.heading).toHaveText('Sales');

    await organizations.card.action('Edit').click();
    const form = app.form();
    await form.expectOpen('Edit — Sales');
    await form.fill('Locality', 'Lille');
    await form.submit();

    await expect(app.errorToast).toBeVisible();
    await expect(app.errorToast).toHaveCSS('position', /fixed|absolute|sticky/);
    await expect(app.errorToast).not.toHaveText(
      /Internal Server Error|check logs|^\s*[{[]/
    );
    expect(await directory.values(ORG.sales, 'l')).toEqual(['Paris']);

    // the console stays usable
    await form.cancel();
    await app.navItem('Users').click();
    await app.list().listEverything();
    await expect(app.list().row('alice')).toBeVisible();
  });

  test('MSG-02 a session ended elsewhere signs in again', async ({
    page,
    context,
  }) => {
    const app = await new LoginPage(page).loginAs(ADMIN);

    const other = await context.newPage();
    await other.goto('/logout');
    await other.close();

    await app.navItem('Users').click();
    await app
      .list()
      .listEverythingButton.click()
      .catch(() => undefined);
    const login = new LoginPage(page);
    await login.expectShown();
    await expect(page.locator('body')).not.toContainText(/401|Unauthorized/);
    await login.submit(ADMIN);

    const again = new ConsolePage(page);
    await again.expectLoaded();
    await again.open('users');
    await again.list().listEverything();
    await expect(again.list().row('alice')).toBeVisible();
  });
});
