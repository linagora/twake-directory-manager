import { ConfirmDialog, LoginPage } from '../pages';
import { ADMIN, ALICE, CAROL, ERIC, ORG, SOPHIE } from '../support/accounts';
import { callApi } from '../support/api';
import { HUMAN_RESOURCES, uniquePart } from '../support/directory';
import { expect, test } from '../support/fixtures';

const ACTIVE =
  'cn=active,ou=twakeAccountStatus,ou=nomenclature,dc=example,dc=com';

/** What a refusal must never read like */
const UNREADABLE = /Internal Server Error|check logs|^\s*\{|"error"/;

test.describe('SCOPE scope banner and authorization', () => {
  test('SCOPE-01 a local administrator sees only their branch', async ({
    page,
  }) => {
    const app = await new LoginPage(page).loginAs(SOPHIE);

    await expect(app.scopeBranches).toHaveText([
      /^\s*Sales\s+read, write, delete\s*$/,
    ]);
    await expect(app.scopeBranch('Sales')).toHaveAttribute('title', 'Sales');
    await expect(app.transitLink).toHaveAttribute('title', 'Transit');
    await expect(app.signOutLink).toHaveText('Sign out');
    // the banner reads: branches, then Transit once (with what waits there,
    // when something does), then Sign out (#171)
    await expect(app.banner).toHaveText(
      /You administer\s+Sales\s+read, write, delete\s+Transit(?: \(\d+\+?\))?\s*Sign out/
    );

    await app.navItem('Users').click();
    await app.list().listEverything();
    expect((await app.list().idsOutsideTransit()).sort()).toEqual([
      'alice',
      'bob',
      'sophie.martin',
    ]);

    await app.navItem('Groups').click();
    await app.list().listEverything();
    expect(await app.list().idsOutsideTransit()).toEqual(['sales-team']);

    const organizations = await app.openOrganizations();
    await expect(organizations.names().first()).toHaveText('Sales');
    await organizations.expand('Sales');
    await expect(organizations.children('Sales')).toHaveText([
      'France',
      'Germany',
    ]);
    await expect(organizations.label('organization')).toHaveCount(0);

    await app.open('users/carol');
    await expect(app.entry().notice).toHaveText('This entry no longer exists');
    await expect(app.entry().heading).toHaveCount(0);
  });

  test('SCOPE-02 the local administrator of Engineering', async ({ page }) => {
    const app = await new LoginPage(page).loginAs(ERIC);

    await expect(app.scopeBranches).toHaveText([
      /^\s*Engineering\s+read, write, delete\s*$/,
    ]);
    await app.navItem('Users').click();
    await app.list().listEverything();
    expect((await app.list().idsOutsideTransit()).sort()).toEqual([
      'carol',
      'dave',
      'eric.dubois',
      'frank',
    ]);
    await app.navItem('Groups').click();
    await app.list().listEverything();
    expect((await app.list().idsOutsideTransit()).sort()).toEqual([
      'backend-guild',
      'engineering',
    ]);
    const organizations = await app.openOrganizations();
    await expect(organizations.names().first()).toHaveText('Engineering');
    await organizations.expand('Engineering');
    await expect(organizations.children('Engineering')).toHaveText([
      'Backend',
      'Frontend',
    ]);
  });

  test('SCOPE-03 an organization is judged on its parent: editing Sales itself is refused', async ({
    page,
    directory,
  }) => {
    const app = await new LoginPage(page).loginAs(SOPHIE);
    const organizations = await app.openOrganizations(ORG.sales);
    const sales = organizations.card;
    await expect(sales.heading).toHaveText('Sales');

    // the button may be shown (documented): the server refuses
    if ((await sales.action('Edit').count()) > 0) {
      await sales.action('Edit').click();
      const form = app.form();
      await form.expectOpen('Edit — Sales');
      await form.fill('Description', 'Changed by sophie');
      await form.submit();
      await expect(app.errorToast).toBeVisible();
      await expect(app.errorToast).not.toHaveText(UNREADABLE);
    }
    expect(await directory.values(ORG.sales, 'description')).toEqual([
      'Sales department',
    ]);
  });

  test('SCOPE-03 reference data changes are refused with the server reason', async ({
    page,
    directory,
  }) => {
    const position = await directory.createPosition();
    const app = await new LoginPage(page).loginAs(SOPHIE, 'positions');
    const list = app.list();
    await expect(list.row(position.cn)).toBeVisible();
    await expect(list.newButton).toHaveCount(0);
    await list.open(position.cn);
    const entry = app.entry();
    await entry.expectName(position.cn);

    if ((await entry.action('Delete').count()) > 0) {
      await entry.perform('Delete');
      await new ConfirmDialog(page).confirm();
      await expect(app.errorToast).toBeVisible();
      await expect(app.errorToast).not.toHaveText(UNREADABLE);
    }
    expect(await directory.exists(position.dn)).toBe(true);
  });

  test('SCOPE-03 deleting a reference entry still in use is refused readably', async ({
    page,
    directory,
  }) => {
    const app = await new LoginPage(page).loginAs(
      SOPHIE,
      'positions/Sales%20Manager'
    );
    const entry = app.entry();
    await entry.expectName('Sales Manager');
    if ((await entry.action('Delete').count()) > 0) {
      await entry.perform('Delete');
      await new ConfirmDialog(page).confirm();
      await expect(app.errorToast).toBeVisible();
      await expect(app.errorToast).not.toContainText(
        'cn=Sales Manager,ou=positions'
      );
      await expect(app.errorToast).not.toContainText('(title)');
    }
    expect(
      await directory.exists('cn=Sales Manager,ou=positions,dc=example,dc=com')
    ).toBe(true);
  });

  test('SCOPE-03 the Department search offers no branch out of scope', async ({
    page,
  }) => {
    const app = await new LoginPage(page).loginAs(SOPHIE, 'users');
    await app.list().newButton.click();
    const form = app.form();
    await form.expectOpen('New user');

    await form.type('Department', 'Eng');
    await expect(form.suggestions('Department')).toBeVisible();
    await expect(form.options('Department')).toHaveCount(0);

    await form.type('Department', 'Sal');
    await expect(form.options('Department')).toHaveText([
      'Sales',
      'Sales / France',
      'Sales / Germany',
    ]);
  });

  test('SCOPE-04 the scope API agrees with the banner', async ({
    page,
    loginInNewContext,
  }) => {
    const expected = [
      { account: ADMIN, branches: ['organization'] },
      { account: SOPHIE, branches: ['Sales'] },
      { account: ALICE, branches: [] },
    ];
    for (const { account, branches } of expected) {
      const app =
        account === ADMIN
          ? await new LoginPage(page).loginAs(account)
          : await loginInNewContext(account);
      const scope = await callApi(app.page, 'GET', '/api/v1/authz/scope');
      expect(scope.status).toBe(200);
      const body = scope.body as {
        branches: {
          name: string;
          read: boolean;
          write: boolean;
          delete: boolean;
        }[];
        transit: string;
      };
      expect(body.branches.map(branch => branch.name)).toEqual(branches);
      expect(body.transit).toBe(ORG.transit);
      if (branches.length === 0) {
        await expect(app.banner).toContainText('You administer no branch');
      } else {
        for (const branch of body.branches) {
          expect([branch.read, branch.write, branch.delete]).toEqual([
            true,
            true,
            true,
          ]);
          await expect(app.scopeBranch(branch.name)).toContainText(
            'read, write, delete'
          );
        }
        await expect(app.transitLink).toBeVisible();
      }
    }
  });

  test('SCOPE-05 the server holds a local administrator to their branch', async ({
    page,
    directory,
    tenant,
    loginInNewContext,
  }) => {
    const app = await new LoginPage(page).loginAs(SOPHIE);

    const addToEngineering = await callApi(
      page,
      'POST',
      '/api/v1/ldap/groups/engineering/members',
      { member: [ALICE.dn] }
    );
    expect(addToEngineering.status).toBe(403);
    const removeFromAllStaff = await callApi(
      page,
      'DELETE',
      `/api/v1/ldap/groups/all-staff/members/${encodeURIComponent(CAROL.dn)}`
    );
    expect(removeFromAllStaff.status).toBe(403);
    expect(
      await directory.values(
        'cn=engineering,ou=groups,dc=example,dc=com',
        'member'
      )
    ).not.toContain(ALICE.dn);
    expect(
      await directory.values(
        'cn=all-staff,ou=groups,dc=example,dc=com',
        'member'
      )
    ).toContain(CAROL.dn);
    await expect(app.banner).toBeVisible();

    // Control, in a branch of its own: its administrator adds a member to its group
    const member = await directory.createUser({ org: tenant.org });
    const group = await directory.createGroup({
      org: tenant.org,
      members: [tenant.admin],
    });
    const local = await loginInNewContext(tenant.admin);
    const add = await callApi(
      local.page,
      'POST',
      `/api/v1/ldap/groups/${group.cn}/members`,
      {
        member: [member.dn],
      }
    );
    expect(add.status).toBe(200);
    expect(await directory.values(group.dn, 'member')).toContain(member.dn);
    // and is refused outside of it, as sophie is
    const outside = await callApi(
      local.page,
      'POST',
      '/api/v1/ldap/groups/sales-team/members',
      {
        member: [member.dn],
      }
    );
    expect(outside.status).toBe(403);
  });

  test('SCOPE-06 the server refuses a local administrator any write on an account outside their branch', async ({
    page,
    directory,
    tenant,
  }) => {
    // Human Resources: nobody but admin administers it
    const outside = await directory.createUser();
    const own = await directory.createUser({ org: tenant.org });
    const elsewhere = HUMAN_RESOURCES.dn;
    const password = await directory.values(outside.dn, 'userPassword');
    await new LoginPage(page).loginAs(tenant.admin);

    const writes: [string, string, unknown?][] = [
      [
        'PUT',
        `/api/v1/ldap/users/${outside.uid}`,
        { replace: { mobile: '+00 0' } },
      ],
      [
        'POST',
        `/api/v1/ldap/users/${outside.uid}/status`,
        { state: 'disabled' },
      ],
      [
        'POST',
        `/api/v1/ldap/users/${outside.uid}/password`,
        { password: 'Taken-0ver!', forceChange: false },
      ],
      [
        'POST',
        `/api/v1/ldap/users/${outside.uid}/move`,
        { targetOrgDn: tenant.org.dn },
      ],
      ['DELETE', `/api/v1/ldap/users/${outside.uid}`],
      // an account of the branch pushed out of it, by an edit or a move
      [
        'PUT',
        `/api/v1/ldap/users/${own.uid}`,
        { replace: { twakeDepartmentLink: elsewhere } },
      ],
      [
        'POST',
        `/api/v1/ldap/users/${own.uid}/move`,
        { targetOrgDn: elsewhere },
      ],
    ];
    for (const [method, path, body] of writes) {
      const answer = await callApi(page, method, path, body);
      // 403, or 404 for an entry the caller cannot even see: never a success, never a crash
      expect([403, 404], `${method} ${path}`).toContain(answer.status);
    }

    const unique = uniquePart();
    const uid = `out.${unique}`;
    directory.trackUser(uid);
    const create = await callApi(page, 'POST', '/api/v1/ldap/users', {
      employeeNumber: `O-${unique}`,
      sn: 'Out',
      givenName: 'Side',
      displayName: 'Side Out',
      mail: `${uid}@example.com`,
      twakeDepartmentLink: elsewhere,
    });
    expect(create.status, 'POST /api/v1/ldap/users').toBe(403);

    expect(await directory.exists(outside.dn)).toBe(true);
    expect(await directory.values(outside.dn, 'mobile')).toEqual([]);
    expect(await directory.values(outside.dn, 'twakeAccountStatus')).toEqual([
      ACTIVE,
    ]);
    expect(await directory.values(outside.dn, 'twakeDepartmentLink')).toEqual([
      elsewhere,
    ]);
    expect(await directory.values(outside.dn, 'userPassword')).toEqual(
      password
    );
    expect(await directory.values(own.dn, 'twakeDepartmentLink')).toEqual([
      tenant.org.dn,
    ]);
    expect(await directory.usersStartingWith(uid)).toEqual([]);
  });
});
