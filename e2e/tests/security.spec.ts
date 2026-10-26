import { type Page } from '@playwright/test';

import { LoginPage } from '../pages';
import { ADMIN } from '../support/accounts';
import { expect, test } from '../support/fixtures';

/** The browser's own account of what the Content-Security-Policy refused, as it logs it */
function cspViolations(page: Page): string[] {
  const refused: string[] = [];
  page.on('console', message => {
    if (/Content Security Policy/i.test(message.text()))
      refused.push(message.text());
  });
  return refused;
}

test.describe('SEC the page against what the directory holds', () => {
  test('SEC-01 the console is served under a strict Content-Security-Policy, which it keeps to', async ({
    page,
  }) => {
    const response = await page.request.get('/static/console/');
    const policy = response.headers()['content-security-policy'] ?? '';
    expect(policy).toContain("script-src 'self'");
    expect(policy).toContain("style-src 'self'");
    expect(policy).not.toContain('unsafe-inline');

    // Every page the console draws, without the browser refusing anything: no inline script or
    // style is left, and none is written by the console.
    const refused = cspViolations(page);
    const app = await new LoginPage(page).loginAs(ADMIN);
    await app.navItem('Users').click();
    await app.list().listEverything();
    await expect(app.list().rows.first()).toBeVisible();
    await app.list().open('alice');
    await app.entry().expectName('Alice Moreau');
    await app.navItem('Groups').click();
    await expect(app.list().heading).toBeVisible();
    const organizations = await app.openOrganizations();
    await expect(organizations.tree).toBeVisible();
    expect(refused, 'CSP violations logged by the browser').toEqual([]);
  });

  test('SEC-02 a name written as markup is shown as text, and runs nowhere', async ({
    page,
    directory,
    tenant,
  }) => {
    // Directory values are written by many hands: a display name that is a script must stay a
    // name, on the card, in the list, and in the organization's table.
    const payload = '<img src=x onerror="window.__xss=1">';
    const user = await directory.createUser({
      org: tenant.org,
      extra: { displayName: payload, cn: payload },
    });
    const refused = cspViolations(page);
    const app = await new LoginPage(page).loginAs(ADMIN, 'users');
    const list = app.list();
    await list.search(user.uid);
    await expect(list.cells(user.uid).first()).toContainText(payload);
    await list.open(user.uid);
    await app.entry().expectName(payload);
    const organizations = await app.openOrganizations(tenant.org.dn);
    await expect(organizations.card.heading).toHaveText(tenant.org.name);
    await expect(page.getByText(payload).first()).toBeVisible();

    expect(
      await page.evaluate(() => (window as { __xss?: number }).__xss)
    ).toBeUndefined();
    await expect(page.locator('img[src="x"]')).toHaveCount(0);
    expect(refused, 'CSP violations logged by the browser').toEqual([]);
  });
});
