import { ConfirmDialog, LoginPage } from '../pages';
import {
  ADMIN,
  CAROL,
  DAVE,
  ERIC,
  ERIN,
  FRANK,
  ALICE,
} from '../support/accounts';
import { callApi } from '../support/api';
import { uniquePart } from '../support/directory';
import { expect, test } from '../support/fixtures';

test.describe('GROUP groups', () => {
  test('GROUP-01 group card and members', async ({ page }) => {
    const app = await new LoginPage(page).loginAs(ADMIN, 'groups');
    await app.list().search('sales');
    await app.list().open('sales-team');

    const card = app.entry();
    await card.expectName('sales-team');
    await expect(card.detail('Name')).toHaveText('sales-team');
    await expect(card.detail('Description')).toHaveText('The sales force');
    await expect(card.detail('Email')).toHaveText('sales@example.com');
    await expect(card.detail('Group type')).toHaveText('Shared mailbox');
    await expect(card.emptyField('List type')).toHaveCount(1);
    await expect(card.detail('Department path').getByRole('link')).toHaveText(
      'Sales'
    );
    await expect(card.relatedItems('Members')).toHaveText([
      'sophie.martin',
      'alice',
      'bob',
    ]);

    await card
      .relatedItems('Members')
      .filter({ hasText: 'bob' })
      .getByRole('link')
      .click();
    await app.entry().expectName('Bob Schneider');
  });

  test('GROUP-02 create a group', async ({ page, directory, tenant }) => {
    const cn = `qa-list-${uniquePart()}`;
    directory.trackGroup(cn);
    const app = await new LoginPage(page).loginAs(ADMIN, 'groups');
    const creations: string[] = [];
    page.on('request', request => {
      if (
        request.method() === 'POST' &&
        request.url().includes('/api/v1/ldap/groups')
      )
        creations.push(request.url());
    });

    await app.list().newButton.click();
    const form = app.form();
    await form.expectOpen('New group');
    await form.fill('Name', 'qa..x');
    await form.fill('Email', `${cn}@lists.example.com`);
    await form.pick('Department', tenant.org.name.slice(0, 6), tenant.org.path);
    await form.submit();
    await expect(form.error('Name')).toBeVisible();
    expect(creations).toEqual([]);

    await form.fill('Name', cn);
    await form.fill('Description', 'QA');
    await form.select('List type', 'Members only');
    await form.select('Group type', 'Distribution list');
    await form.submit();

    await app.expectToast(`${cn} created`);
    const card = app.entry();
    await card.expectName(cn);
    await expect(card.detail('Description')).toHaveText('QA');
    await expect(card.detail('Email')).toHaveText(`${cn}@lists.example.com`);
    await expect(card.detail('List type')).toHaveText('Members only');
    await expect(card.detail('Group type')).toHaveText('Distribution list');
    await expect(card.detail('Department path')).toHaveText(tenant.org.path);

    await app.openList('Groups');
    await app.list().search(cn.slice(0, 11));
    await expect(app.list().row(cn)).toBeVisible();
  });

  test('GROUP-03 add and remove members', async ({ page, directory }) => {
    const group = await directory.createGroup({ members: [CAROL, FRANK] });
    const app = await new LoginPage(page).loginAs(ADMIN, `groups/${group.cn}`);
    const card = app.entry();

    await card.action('Edit').click();
    const form = app.form();
    await form.expectOpen(`Edit — ${group.cn}`);
    await expect(form.tokens('Members')).toHaveText(['carol', 'frank']);
    await expect(
      form.token('Members', 'carol').locator('span')
    ).toHaveAttribute('title', CAROL.dn);
    await expect(await form.field('Members')).toHaveAttribute(
      'placeholder',
      'Type 3 characters of an email address, or a full DN'
    );

    await form.type('Members', 'dave@');
    await expect(form.options('Members')).toHaveText([
      'Dave Okafor <dave@example.com>',
    ]);
    await (await form.field('Members')).press('Enter');
    await expect(form.tokens('Members')).toHaveCount(3);

    await form.type('Members', 'sal');
    await expect(
      form
        .options('Members')
        .filter({ hasText: 'sales-team <sales@example.com>' })
    ).toBeVisible();
    await form.type('Members', 'DAVE@');
    await expect(form.suggestions('Members')).toBeVisible();
    await expect(
      form.options('Members').filter({ hasText: 'dave@example.com' })
    ).toHaveCount(0);

    await form.type('Members', ERIN.dn);
    await expect(form.suggestions('Members')).toContainText(
      'Press Enter to add this DN'
    );
    await (await form.field('Members')).press('Enter');
    await expect(
      form.tokens('Members').filter({ hasText: 'erin' })
    ).toBeVisible();

    await form.removeToken('Members', 'frank');
    await form.submit();
    await app.expectToast('Saved');
    await expect(card.relatedItems('Members')).toHaveText([
      'carol',
      'dave',
      'erin',
    ]);
    expect((await directory.values(group.dn, 'member')).sort()).toEqual(
      [CAROL.dn, DAVE.dn, ERIN.dn].sort()
    );

    await card
      .relatedItems('Members')
      .filter({ hasText: 'dave' })
      .getByRole('link')
      .click();
    await app.entry().expectName('Dave Okafor');
    await expect(
      app.entry().relatedLinks('Groups').filter({ hasText: group.cn })
    ).toBeVisible();
  });

  test('GROUP-04 edit and delete a group', async ({ page, directory }) => {
    const member = await directory.createUser();
    const group = await directory.createGroup({ members: [member] });
    const app = await new LoginPage(page).loginAs(ADMIN, `groups/${group.cn}`);
    const card = app.entry();

    await card.action('Edit').click();
    const form = app.form();
    await form.expectOpen(`Edit — ${group.cn}`);
    await expect(form.dialog.getByLabel(/^Name( \*)?$/)).toHaveCount(0);
    await form.fill('Description', 'Changed');
    await form.submit();
    await app.expectToast('Saved');
    await expect(card.detail('Description')).toHaveText('Changed');

    const confirm = new ConfirmDialog(page);
    await card.perform('Delete');
    await confirm.expectOpen(`Delete ${group.cn}?`);
    await expect(confirm.paragraphs).toHaveText([
      'Its 1 member stays in the directory; only the group goes.',
      'This cannot be undone.',
    ]);
    await expect(confirm.confirmButton).toHaveText('Delete group');
    await confirm.confirm();
    await app.expectToast('Deleted');
    await expect(app.mainHeading).toHaveText('Groups');
    await app.list().search(group.cn);
    await expect(app.list().emptyState).toHaveText(
      'No entry matches this search'
    );
    expect(await directory.exists(group.dn)).toBe(false);
    expect(await directory.exists(member.dn)).toBe(true);
  });

  test("GROUP-05 a local administrator's groups", async ({
    page,
    directory,
    tenant,
  }) => {
    const france = await directory.createOrganization({
      parent: tenant.org.dn,
      name: 'France',
    });
    const cn = `sales-fr-${uniquePart()}`;
    directory.trackGroup(cn);
    const app = await new LoginPage(page).loginAs(tenant.admin, 'groups');

    await app.list().newButton.click();
    const form = app.form();
    await form.expectOpen('New group');
    await form.type('Department', 'Eng');
    await expect(form.suggestions('Department')).toBeVisible();
    await expect(form.options('Department')).toHaveCount(0);
    await form.fill('Name', cn);
    await form.fill('Email', `${cn}@example.com`);
    await form.pick('Department', 'Fra', france.path);
    await form.submit();

    await app.expectToast(`${cn} created`);
    await app.entry().expectName(cn);
    await app.openList('Groups');
    await app.list().search(cn);
    await expect(app.list().row(cn)).toBeVisible();
  });

  test('GROUP-06 owners: chosen by search, saved, named on the card', async ({
    page,
    directory,
  }) => {
    const group = await directory.createGroup({ members: [ERIC] });
    const app = await new LoginPage(page).loginAs(ADMIN, `groups/${group.cn}`);
    const card = app.entry();

    await card.action('Edit').click();
    const form = app.form();
    await form.expectOpen(`Edit — ${group.cn}`);
    await form.pick('Owners', 'eric.', 'eric.dubois');
    await form.submit();
    await app.expectToast('Saved');

    const owner = card
      .detail('Owners')
      .getByRole('link', { name: 'eric.dubois' });
    await expect(owner).toBeVisible();
    await expect(owner).toHaveAttribute('title', ERIC.dn);
    await owner.click();
    await app.entry().expectName('Eric Dubois');
    await page.goBack();

    await card.action('Edit').click();
    await form.expectOpen(`Edit — ${group.cn}`);
    await expect(form.tokens('Owners')).toHaveText(['eric.dubois']);
    await form.removeToken('Owners', 'eric.dubois');
    await form.submit();
    await app.expectToast('Saved');
    await expect(card.emptyField('Owners')).toHaveCount(1);
    expect(await directory.values(group.dn, 'owner')).toEqual([]);
  });

  test('GROUP-07 unknown member: refused by name; external address', async ({
    page,
    directory,
  }) => {
    const group = await directory.createGroup({ members: [CAROL] });
    const app = await new LoginPage(page).loginAs(ADMIN, `groups/${group.cn}`);
    const config = await callApi(page, 'GET', '/api/v1/config');
    const features = JSON.stringify(
      (config.body as { features?: unknown }).features ?? {}
    );
    const external = features.includes('externalUsersInGroups');

    await app.entry().action('Edit').click();
    const form = app.form();
    await form.expectOpen(`Edit — ${group.cn}`);
    const nobody = 'uid=nobody,ou=users,dc=example,dc=com';
    await form.type('Members', nobody);
    await (await form.field('Members')).press('Enter');
    await form.submit();
    // a refusal the console has no words for keeps the server's (#126)
    await app.expectToast(
      `The server refused: Member ${nobody} not found`,
      true
    );
    await expect(form.dialog).toBeVisible();

    await form.removeToken('Members', 'nobody');
    await form.type('Members', 'someone@partner.org');
    if (external) {
      await expect(form.suggestions('Members')).toContainText(
        'Add someone@partner.org as an external member'
      );
      await form.type('Members', 'ghost@example.com');
      await expect(form.suggestions('Members')).toContainText(
        'example.com is a domain of this directory: choose the account instead'
      );
    } else {
      await expect(form.suggestions('Members')).toContainText(
        'No entry matches this search'
      );
      await expect(form.options('Members')).toHaveCount(0);
      await form.type('Members', 'ghost@example.com');
      await expect(form.options('Members')).toHaveCount(0);
    }
    expect(await directory.values(group.dn, 'member')).toEqual([CAROL.dn]);
  });

  test("GROUP-08 a shared mailbox's member search", async ({
    page,
    directory,
  }) => {
    const group = await directory.createGroup({
      mailboxType: 'teamMailbox',
      mail: `team-${uniquePart()}@example.com`,
      members: [ALICE],
    });
    const app = await new LoginPage(page).loginAs(ADMIN, `groups/${group.cn}`);
    const config = await callApi(page, 'GET', '/api/v1/config');
    const james = JSON.stringify(
      (config.body as { features?: unknown }).features ?? {}
    ).includes('"james"');
    await expect(app.entry().detail('Group type')).toHaveText('Shared mailbox');

    await app.entry().action('Edit').click();
    const form = app.form();
    await form.expectOpen(`Edit — ${group.cn}`);
    await form.type('Members', 'all-staff');
    await expect(
      form
        .options('Members')
        .filter({ hasText: 'all-staff <all-staff@lists.example.com>' })
    ).toBeVisible();
    await form.type('Members', 'erin@');
    await expect(
      form.options('Members').filter({ hasText: 'erin@example.com' })
    ).toBeVisible();

    await form.fill(
      'Email',
      group.mail?.replace('@example.com', '@lists.example.com') ?? ''
    );
    await form.type('Members', 'erin@');
    if (james) {
      await expect(form.dialog).toContainText(
        'A shared mailbox at lists.example.com only takes accounts of lists.example.com'
      );
    } else {
      await expect(
        form.options('Members').filter({ hasText: 'erin@example.com' })
      ).toBeVisible();
    }
  });
});
