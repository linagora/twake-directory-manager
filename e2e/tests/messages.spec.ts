import { ConfirmDialog, ConsolePage, LoginPage } from '../pages';
import { ADMIN } from '../support/accounts';
import { expect, test } from '../support/fixtures';

test.describe('MSG messages and error handling', () => {
  test('MSG-01 a server refusal shows as a red toast with the reason', async ({
    page,
    directory,
    tenant,
  }) => {
    // an organization still holding an account: offered to delete, refused
    const team = await directory.createOrganization({
      parent: tenant.org.dn,
      name: 'Team',
    });
    await directory.createUser({ org: team });
    const app = await new LoginPage(page).loginAs(tenant.admin);
    const organizations = await app.openOrganizations(team.dn);
    await expect(organizations.card.heading).toHaveText(team.name);

    await organizations.card.perform('Delete');
    await new ConfirmDialog(page).confirm();

    await expect(app.errorToast).toHaveText(
      `${team.path} is not empty: move or delete its entries first`
    );
    await expect(app.errorToast).toHaveCSS('position', /fixed|absolute|sticky/);
    expect(await directory.exists(team.dn)).toBe(true);

    // the console stays usable
    await app.navItem('Users').click();
    await app.list().listEverything();
    await expect(app.list().rows.first()).toBeVisible();
  });

  test('MSG-03 a failure the console did not wait for is reported, and the page stays usable', async ({
    page,
  }) => {
    const app = await new LoginPage(page).loginAs(ADMIN);

    // What the boundary catches last: a rejection nobody handled, from the console's own code
    // (its stack names the bundle, as one escaping a listener would). Raised from the page since
    // no server answer reaches the console unhandled by design.
    await page.evaluate(() => {
      const error = new Error('Transit count went wrong');
      error.stack = `Error: Transit count went wrong\n    at readTransit (${location.origin}/static/console/twake-directory-manager.esm.js:1:1)`;
      const rejected = Promise.reject(error);
      rejected.catch(() => undefined);
      window.dispatchEvent(
        new PromiseRejectionEvent('unhandledrejection', {
          promise: rejected,
          reason: error,
        })
      );
    });
    await expect(app.errorToast).toHaveText(
      'Something went wrong: Transit count went wrong'
    );

    // the console stays usable
    await app.navItem('Users').click();
    await app.list().listEverything();
    await expect(app.list().rows.first()).toBeVisible();
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
