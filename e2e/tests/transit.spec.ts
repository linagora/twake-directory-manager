import { ClaimDialog, ConfirmDialog, LoginPage } from '../pages';
import { ADMIN, ALICE, ORG } from '../support/accounts';
import {
  type Directory,
  type Organization,
  TRANSIT,
} from '../support/directory';
import { expect, test, type Tenant } from '../support/fixtures';

/** A second branch of its own, with two sub-organizations, as Engineering has */
async function otherTenant(
  directory: Directory
): Promise<Tenant & { backend: Organization; frontend: Organization }> {
  const org = await directory.createOrganization();
  const backend = await directory.createOrganization({
    parent: org.dn,
    name: 'Backend',
  });
  const frontend = await directory.createOrganization({
    parent: org.dn,
    name: 'Frontend',
  });
  const admin = await directory.createUser({ org, prefix: 'boss' });
  await directory.addValues(org.dn, 'twakeLocalAdminLink', [admin.dn]);
  return { org, admin, backend, frontend };
}

test.describe('TRANSIT hand over and claim', () => {
  test('TRANSIT-01 hand an account over to transit', async ({
    page,
    directory,
    tenant,
  }) => {
    const user = await directory.createUser({ org: tenant.org });
    const app = await new LoginPage(page).loginAs(
      tenant.admin,
      `users/${user.uid}`
    );
    const card = app.entry();

    const confirm = new ConfirmDialog(page);
    await card.perform('Hand over');
    await confirm.expectOpen(`Hand ${user.displayName} over?`);
    await expect(confirm.paragraphs).toHaveText([
      `${user.displayName} leaves ${tenant.org.path} for Transit.`,
      'Every administrator will see this entry and may claim it; you will no longer manage it.',
    ]);
    await expect(confirm.cancelButton).toBeFocused();
    await expect(confirm.confirmButton).toHaveText('Hand over');
    await confirm.confirm();
    await app.expectToast(`${user.uid} is in transit`);
    expect(await directory.values(user.dn, 'twakeDepartmentLink')).toEqual([
      ORG.transit,
    ]);

    // still listed, as every entry in transit is, but under Transit
    await app.openList('Users');
    await app.list().search(user.uid);
    await expect(app.list().cells(user.uid).nth(4)).toHaveText('Transit');

    await app.transitLink.click();
    const transit = app.organizations().card;
    await expect(transit.heading).toHaveText('Transit');
    await expect(transit.attachedRow('People', user.displayName)).toBeVisible();
    await expect(transit.attachedRow('People', 'Grace Kim')).toBeVisible();

    await transit
      .attachedRow('People', user.displayName)
      .getByRole('link')
      .click();
    await expect(card.transitTag).toHaveText('In transit');
    await expect(card.actions()).toHaveText(['Claim…']);
    await expect(card.changeState).toHaveCount(0);
  });

  test('TRANSIT-02 claim an entry into one of its own organizations', async ({
    page,
    directory,
  }) => {
    const other = await otherTenant(directory);
    const user = await directory.createUser({ org: TRANSIT });
    const app = await new LoginPage(page).loginAs(other.admin);

    await app.transitLink.click();
    const transit = app.organizations().card;
    await transit
      .attachedRow('People', user.displayName)
      .getByRole('link')
      .click();
    const card = app.entry();
    await expect(card.transitTag).toBeVisible();
    await card.action('Claim…').click();
    const claim = new ClaimDialog(page);
    await expect(claim.title).toHaveText(`Claim ${user.uid}`);
    await expect(claim.targets()).toHaveText([
      other.org.path,
      other.backend.path,
      other.frontend.path,
    ]);
    // the button names where the entry goes, and follows the select
    await expect(claim.confirmButton).toHaveText(
      `Claim into ${other.org.path}`
    );
    await claim.target.selectOption({ label: other.backend.path });
    await expect(claim.confirmButton).toHaveText(
      `Claim into ${other.backend.path}`
    );
    await claim.claimInto(other.frontend.path);

    await app.expectToast(`${user.uid} moved to ${other.frontend.path}`);
    await expect(card.transitTag).toHaveCount(0);
    await expect(card.detail('Department path')).toHaveText(
      other.frontend.path
    );
    await expect(card.actions()).toContainText([
      'Edit',
      'Reset password',
      'More',
    ]);
    await expect(card.moreActions()).toContainText(['Delete']);
    await expect(card.changeState).toBeVisible();
    await app.openList('Users');
    await app.list().search(user.uid);
    await expect(app.list().cells(user.uid).nth(4)).toHaveText(
      other.frontend.path
    );
  });

  test('TRANSIT-03 admin has every action on an entry in transit', async ({
    page,
  }) => {
    const app = await new LoginPage(page).loginAs(ADMIN, 'users/grace');
    const card = app.entry();

    await expect(card.transitTag).toHaveText('In transit');
    await expect(card.actions()).toHaveText([
      'Claim…',
      'Edit',
      'Reset password',
      'Change state…',
      'More',
    ]);
    await expect(card.moreActions()).toHaveText(['Delete']);
    await expect(card.changeState).toBeVisible();

    await card.action('Claim…').click();
    const claim = new ClaimDialog(page);
    for (const path of [
      'organization',
      'Sales',
      'Engineering',
      'Human Resources',
      'Sales / France',
      'Sales / Germany',
      'Engineering / Backend',
      'Engineering / Frontend',
    ])
      await expect(
        claim.targets().filter({ hasText: new RegExp(`^${path}$`) })
      ).toHaveCount(1);
    await expect(claim.targets().filter({ hasText: /^Transit$/ })).toHaveCount(
      0
    );
    await claim.cancelButton.click();
    await expect(claim.dialog).toBeHidden();
  });

  test('TRANSIT-04 hand over and claim a group', async ({
    page,
    directory,
    tenant,
    loginInNewContext,
  }) => {
    const other = await otherTenant(directory);
    const group = await directory.createGroup({
      org: tenant.org,
      members: [tenant.admin],
    });
    const app = await new LoginPage(page).loginAs(
      tenant.admin,
      `groups/${group.cn}`
    );

    await app.entry().perform('Hand over');
    await new ConfirmDialog(page).confirm();
    await app.expectToast(`${group.cn} is in transit`);
    expect(await directory.values(group.dn, 'twakeDepartmentLink')).toEqual([
      ORG.transit,
    ]);

    const claimer = await loginInNewContext(other.admin, `groups/${group.cn}`);
    await claimer.entry().action('Claim…').click();
    await new ClaimDialog(claimer.page).claimInto(other.org.path);
    await claimer.expectToast(`${group.cn} moved to ${other.org.path}`);
    await claimer.openList('Groups');
    await claimer.list().search(group.cn);
    await expect(claimer.list().row(group.cn)).toBeVisible();

    await app.openList('Groups');
    await app.list().search(group.cn);
    await expect(app.list().emptyState).toHaveText(
      'No entry matches this search'
    );
  });

  test('TRANSIT-05 an account with no rights to claim into', async ({
    page,
    directory,
  }) => {
    const app = await new LoginPage(page).loginAs(ALICE);

    await expect(app.transitLink).toHaveCount(0);
    await app.open('users/grace');
    const claim = app.entry().action('Claim…');
    if ((await claim.count()) > 0) {
      await claim.click();
      await expect(new ClaimDialog(page).noTarget).toHaveText(
        'You write in no organization that could take it'
      );
    } else {
      await expect(app.nothingToManage).toBeVisible();
    }
    expect(
      await directory.values(
        'uid=grace,ou=users,dc=example,dc=com',
        'twakeDepartmentLink'
      )
    ).toEqual([ORG.transit]);
  });
});
