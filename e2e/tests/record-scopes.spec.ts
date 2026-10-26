import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { LoginPage } from '../pages';
import { ADMIN, ALICE, ERIC, GRACE, SOPHIE } from '../support/accounts';
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
});
