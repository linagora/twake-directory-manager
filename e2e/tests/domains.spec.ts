import { LoginPage } from '../pages';
import { ADMIN, SOPHIE } from '../support/accounts';
import { answerNextConfirm } from '../support/confirm';
import { DOMAINS, uniquePart } from '../support/directory';
import { expect, test } from '../support/fixtures';

/** What a refusal must never read like */
const UNREADABLE = /Internal Server Error|check logs|^\s*\{|"error"/;

test.describe('DOMAIN mail domains', () => {
  test('DOMAIN-01 a global administrator adds a mail domain, offered at once, and deletes it', async ({
    page,
    directory,
  }) => {
    // .test, as createDomain names them: the tests reading every domain ignore it (TEST_DOMAIN)
    const id = `qa${uniquePart()}`;
    const name = `${id}.test`;
    const dn = `dc=${id},${DOMAINS}`;
    directory.track(dn);
    const app = await new LoginPage(page).loginAs(ADMIN, 'domains');
    const list = app.list();
    await expect(list.row('example')).toBeVisible();

    await expect(list.newButton).toHaveText('New domain');
    await list.newButton.click();
    const form = app.form();
    await form.expectOpen('New domain');
    await form.fill('Identifier', id);
    await form.fill('Mail domain', name);
    await form.submit();
    await app.expectToast(`${name} created`);
    expect(await directory.values(dn, 'associatedDomain')).toEqual([name]);

    // "@" offers it with no department chosen
    await app.navItem('Users').click();
    await app.list().newButton.click();
    await form.expectOpen('New user');
    await form.control('Email').pressSequentially('someone@');
    await expect(
      form.options('Email').filter({ hasText: `someone@${name}` })
    ).toHaveCount(1);
    await form.cancel();

    const card = await app.openEntry(`domains/${id}`);
    const message = answerNextConfirm(page, true);
    await card.action('Delete').click();
    await message;
    await app.expectToast('Deleted');
    expect(await directory.exists(dn)).toBe(false);
    await app.open('domains');
    await expect(list.row('example')).toBeVisible();
    await expect(list.row(id)).toHaveCount(0);
  });

  test('DOMAIN-02 a local administrator reads the mail domains and changes none', async ({
    page,
    directory,
  }) => {
    const domain = await directory.createDomain();
    const app = await new LoginPage(page).loginAs(SOPHIE, 'domains');
    const list = app.list();
    await expect(list.row(domain.id)).toBeVisible();
    await expect(list.main.getByRole('button', { name: /^New / })).toHaveCount(
      0
    );
    await expect(list.importButton).toHaveCount(0);

    // the card may offer Delete (documented, as for the other reference data): the server refuses
    const card = await app.openEntry(`domains/${domain.id}`);
    if ((await card.action('Delete').count()) > 0) {
      const message = answerNextConfirm(page, true);
      await card.action('Delete').click();
      await message;
      await expect(app.errorToast).toBeVisible();
      await expect(app.errorToast).not.toHaveText(UNREADABLE);
    }
    expect(await directory.exists(domain.dn)).toBe(true);
  });
});
