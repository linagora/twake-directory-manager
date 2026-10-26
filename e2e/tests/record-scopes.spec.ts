import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { type APIResponse } from '@playwright/test';

import { LoginPage } from '../pages';
import { ADMIN, ALICE, ERIC, GRACE, ORG, SOPHIE } from '../support/accounts';
import { expect, test } from '../support/fixtures';

/**
 * Not a test: a recorder. Run with `RECORD_SCOPES=1 npx playwright test
 * record-scopes` against the QA stack, it signs in as each persona and writes
 * what the server answers to `test/fixtures/`, where `test/rights.test.ts`
 * reads the rights of each persona from the scope the real server describes
 * rather than from a scope written by hand. Run again whenever the seed
 * (`scripts/qa-environment/ldap/seed.ldif`) or the authorization settings of
 * the stack change.
 */
const FIXTURES = join(__dirname, '..', '..', 'test', 'fixtures');
const PERSONAS = [ADMIN, SOPHIE, ERIC, ALICE, GRACE];

function save(file: string, body: unknown): void {
  const path = join(FIXTURES, file);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(body, null, 2)}\n`);
}

/** A response as the contract test replays it: status, the headers it reads, the body. */
async function answer(response: APIResponse): Promise<unknown> {
  const headers = response.headers();
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    body = await response.text();
  }
  return {
    status: response.status(),
    headers: Object.fromEntries(
      Object.entries(headers).filter(([name]) =>
        ['content-type', 'x-result-truncated'].includes(name)
      )
    ),
    body,
  };
}

test.describe('record the personas’ scopes', () => {
  test.skip(!process.env.RECORD_SCOPES, 'a recorder, run on demand');

  for (const account of PERSONAS) {
    test(`record ${account.uid}`, async ({ page }) => {
      await new LoginPage(page).loginAs(account);
      const scope = await page.request.get('/api/v1/authz/scope');
      expect(scope.ok()).toBe(true);
      save(`scopes/${account.uid}.json`, await scope.json());
      if (account === ADMIN) {
        const config = await page.request.get('/api/v1/config');
        expect(config.ok()).toBe(true);
        save('config.json', await config.json());
      }
    });
  }

  // What the API client reads besides the scope: a bounded list and the header
  // saying it was cut, one entry, and the refusals the console explains.
  test('record the contract answers', async ({ page }) => {
    const app = await new LoginPage(page).loginAs(ADMIN);
    await expect(app.navItem('Users')).toBeVisible();
    save(
      'contract/users-list-limited.json',
      await answer(await page.request.get('/api/v1/ldap/users?limit=2'))
    );
    save(
      'contract/users-alice.json',
      await answer(await page.request.get('/api/v1/ldap/users/alice'))
    );
    // The identifier and the organization path are computed by the server:
    // not sent.
    const account = (
      employeeNumber: string,
      mail: string,
      organization: string
    ) => ({
      employeeNumber,
      cn: 'Contract Recorder',
      sn: 'Recorder',
      givenName: 'Contract',
      displayName: 'Contract Recorder',
      mail,
      twakeDepartmentLink: organization,
    });
    const refused = async (file: string, body: Record<string, string>) => {
      const response = await page.request.post('/api/v1/ldap/users', {
        data: body,
      });
      save(file, await answer(response));
      // Not refused after all: leave nothing behind.
      if (response.ok()) {
        const created = (await response.json()) as { uid?: string };
        if (created.uid)
          await page.request.delete(
            `/api/v1/ldap/users/${encodeURIComponent(created.uid)}`
          );
      }
    };
    // An address already taken (alice's).
    await refused(
      'contract/refusal-duplicate.json',
      account(`C-${Date.now()}`, 'alice@example.com', ORG.sales)
    );
    // An address at a domain the directory does not manage.
    await refused(
      'contract/refusal-mailDomain.json',
      account(
        `C-${Date.now()}`,
        'contract.recorder@unmanaged.invalid',
        ORG.sales
      )
    );
  });

  test('record a refusal of a local administrator', async ({ page }) => {
    // Sophie administers Sales: an account created in Engineering is refused.
    await new LoginPage(page).loginAs(SOPHIE);
    const response = await page.request.post('/api/v1/ldap/users', {
      data: {
        employeeNumber: `C-${Date.now()}`,
        cn: 'Contract Recorder',
        sn: 'Recorder',
        givenName: 'Contract',
        displayName: 'Contract Recorder',
        mail: 'contract.recorder@example.com',
        twakeDepartmentLink: ORG.engineering,
      },
    });
    save('contract/refusal-forbidden.json', await answer(response));
    expect(response.ok()).toBe(false);
  });
});
