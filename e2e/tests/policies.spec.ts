import { ConfirmDialog, LoginPage } from '../pages';
import { ADMIN, SOPHIE } from '../support/accounts';
import { callApi } from '../support/api';
import { DEFAULT_POLICY, POLICIES, uniquePart } from '../support/directory';
import { expect, test } from '../support/fixtures';

test.describe('POLICY password policies', () => {
  test('POLICY-01 only the global administrators see the policies', async ({
    page,
    tenant,
    loginInNewContext,
  }) => {
    const app = await new LoginPage(page).loginAs(ADMIN);
    await app.referenceToggle().click();
    await app.navItem('Password policies').click();
    const policies = app.policies();
    await expect(policies.heading).toHaveText('Password policies');
    await expect(policies.newButton).toBeVisible();
    await expect(policies.cells('default')).toHaveText([
      'default Default',
      'Never',
      '—',
      'Off',
    ]);
    // the default policy cannot be deleted
    const panel = await policies.open('default');
    await expect(panel.deleteButton).toHaveCount(0);
    expect(await callApi(page, 'GET', '/api/v1/password-policies')).toEqual(
      expect.objectContaining({ status: 200 })
    );

    for (const account of [SOPHIE, tenant.admin]) {
      const local = await loginInNewContext(account);
      // the scope says it: a page load asks nothing the server would refuse
      const asked: string[] = [];
      local.page.on('request', request => {
        if (new URL(request.url()).pathname.endsWith('/password-policies'))
          asked.push(request.url());
      });
      await local.reload();
      await local.referenceToggle().click();
      await expect(local.navItem('Positions')).toBeVisible();
      await expect(local.navItem('Password policies')).toHaveCount(0);
      await local.open('password-policies');
      await expect(local.mainHeading).not.toHaveText('Password policies');
      await expect(local.policies().newButton).toHaveCount(0);
      expect(asked, account.uid).toEqual([]);
      const answer = await callApi(
        local.page,
        'GET',
        '/api/v1/password-policies'
      );
      expect(answer.status, account.uid).toBe(403);
    }
  });

  test('POLICY-02 create, edit and delete a policy', async ({
    page,
    directory,
  }) => {
    const cn = `qa-${uniquePart()}`;
    const dn = `cn=${cn},${POLICIES}`;
    directory.track(dn);
    const app = await new LoginPage(page).loginAs(ADMIN, 'password-policies');
    const policies = app.policies();

    const panel = await policies.openNew();
    // The QA directory is OpenLDAP 2.4, which has no pwdMaxLength: the form
    // offers only what the directory defines (#118)
    await expect(panel.control('pwdMaxLength')).toHaveCount(0);
    await expect(panel.control('pwdMinLength')).toHaveCount(1);
    await panel.nameInput.fill(cn);
    await expect(panel.unit('pwdMaxAge')).toHaveValue('days');
    await panel.fill('pwdMaxAge', '90');
    await panel.fill('pwdMinLength', '12');
    await panel.select('pwdLockout', 'Yes');
    await panel.fill('pwdMaxFailure', '5');
    await expect(panel.unit('pwdLockoutDuration')).toHaveValue('minutes');
    await panel.fill('pwdLockoutDuration', '15');
    await panel.submit();
    await app.expectToast('Password policy created');
    await expect(panel.dialog).toBeHidden();

    await expect(policies.cells(cn)).toHaveText([
      cn,
      '90 days',
      '12',
      'After 5 failures, 15 minutes',
    ]);
    // durations are stored in seconds
    expect(
      await directory.read(dn, [
        'pwdMaxAge',
        'pwdMinLength',
        'pwdLockout',
        'pwdMaxFailure',
        'pwdLockoutDuration',
      ])
    ).toEqual({
      pwdMaxAge: ['7776000'],
      pwdMinLength: ['12'],
      pwdLockout: ['TRUE'],
      pwdMaxFailure: ['5'],
      pwdLockoutDuration: ['900'],
    });

    // an emptied field removes its attribute
    let edit = await policies.open(cn);
    await expect(edit.control('pwdMaxAge')).toHaveValue('90');
    await edit.fill('pwdMinLength', '14');
    await edit.fill('pwdMaxAge', '');
    await edit.submit();
    await app.expectToast('Password policy saved');
    await expect(policies.cells(cn)).toHaveText([
      cn,
      'Never',
      '14',
      'After 5 failures, 15 minutes',
    ]);
    await app.reload();
    edit = await policies.open(cn);
    await expect(edit.control('pwdMinLength')).toHaveValue('14');
    await expect(edit.control('pwdMaxAge')).toHaveValue('');
    expect(await directory.values(dn, 'pwdMaxAge')).toEqual([]);
    expect(await directory.values(dn, 'pwdMinLength')).toEqual(['14']);
    expect(await directory.values(dn, 'pwdLockoutDuration')).toEqual(['900']);

    const confirm = new ConfirmDialog(page);
    await edit.deleteButton.click();
    await confirm.expectOpen(`Delete the password policy ${cn}?`);
    await expect(confirm.message).toHaveText('This cannot be undone.');
    await expect(confirm.confirmButton).toHaveText('Delete policy');
    await confirm.cancel();
    // the policy's form is back, as it was
    await expect(edit.control('pwdMinLength')).toHaveValue('14');
    expect(await directory.exists(dn)).toBe(true);
    await edit.deleteButton.click();
    await confirm.confirm();
    await app.expectToast('Password policy deleted');
    await expect(policies.row(cn)).toHaveCount(0);
    await expect(policies.row('default')).toBeVisible();
    expect(await directory.exists(dn)).toBe(false);
    expect(await directory.exists(DEFAULT_POLICY)).toBe(true);
  });

  test('POLICY-03 a policy accounts use is not deleted', async ({
    page,
    directory,
  }) => {
    const policy = await directory.createPolicy({ pwdMinLength: '12' });
    await directory.createUser({ extra: { pwdPolicySubentry: policy.dn } });
    const app = await new LoginPage(page).loginAs(ADMIN, 'password-policies');
    const policies = app.policies();
    await expect(policies.cells(policy.cn)).toHaveText([
      policy.cn,
      'Never',
      '12',
      'Off',
    ]);

    const panel = await policies.open(policy.cn);
    await panel.deleteButton.click();
    await new ConfirmDialog(page).confirm();
    await expect(app.errorToast).toHaveText(
      `${policy.cn} is the default policy, or accounts still use it`
    );
    expect(await directory.exists(policy.dn)).toBe(true);
  });
});
