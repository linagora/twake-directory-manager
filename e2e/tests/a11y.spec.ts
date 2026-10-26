import { type Page } from '@playwright/test';

import {
  AddToGroupsDialog,
  ConfirmDialog,
  type ConsolePage,
  csv,
  LoginPage,
  PolicyPanel,
  ResetPasswordDialog,
} from '../pages';
import { type Account, ADMIN, ORG, SOPHIE } from '../support/accounts';
import { expectAccessible } from '../support/a11y';
import { expect, test } from '../support/fixtures';
import { t } from '../support/i18n';

/**
 * Every main view and panel of the console, scanned by axe-core against
 * WCAG 2.2 AA, as the global administrator and as a local one, in English
 * and in French. A view with a defect on file is marked `knownIssue` until
 * it is fixed; a new defect fails the run.
 */
const LANGUAGES = ['en', 'fr'] as const;
const PERSONAS: [string, Account][] = [
  ['the global administrator', ADMIN],
  ['a local administrator', SOPHIE],
];

async function signIn(
  page: Page,
  account: Account,
  language: (typeof LANGUAGES)[number],
  hash?: string
): Promise<ConsolePage> {
  const app = await new LoginPage(page).loginAs(account, hash);
  if (language !== 'en') await app.setLanguage(language);
  return app;
}

for (const language of LANGUAGES)
  for (const [who, account] of PERSONAS)
    test.describe(`A11Y ${who}, ${language}`, () => {
      test(`A11Y-01 overview`, async ({ page }) => {
        await signIn(page, account, language);
        await expectAccessible(page);
      });

      test(`A11Y-02 users list`, async ({ page }) => {
        const app = await signIn(page, account, language, 'users');
        await app.list().listEverything();
        await expect(app.list().rows.first()).toBeVisible();
        await expectAccessible(page);
      });

      test(`A11Y-03 a user's card`, async ({ page }) => {
        const app = await signIn(page, account, language, 'users/alice');
        await expect(app.entry().heading).toBeVisible();
        await expectAccessible(page);
      });

      test(`A11Y-04 the create-user panel`, async ({ page }) => {
        const app = await signIn(page, account, language, 'users');
        await app.list().newButton.click();
        await expect(app.form().dialog).toBeVisible();
        await expectAccessible(page);
      });

      test(`A11Y-05 groups list`, async ({ page }) => {
        const app = await signIn(page, account, language, 'groups');
        await app.list().listEverything();
        await expect(app.list().rows.first()).toBeVisible();
        await expectAccessible(page);
      });

      test(`A11Y-06 a group's card`, async ({ page }) => {
        // A seed group of the global branch, which both personas read; the
        // list's first row would depend on what parallel tests created.
        const app = await signIn(page, account, language, 'groups/sales-team');
        await expect(app.entry().heading).toBeVisible();
        await expectAccessible(page);
      });

      test(`A11Y-07 organizations with a card open`, async ({ page }) => {
        const app = await signIn(page, account, language);
        const organizations = await app.openOrganizations(ORG.sales);
        await expect(organizations.card.heading).toBeVisible();
        await expectAccessible(page);
      });

      test(`A11Y-08 the CSV import panel`, async ({ page }) => {
        const app = await signIn(page, account, language, 'users');
        await app.list().importButton.click();
        await expect(app.importPanel().dialog).toBeVisible();
        await expectAccessible(page);
      });

      test(`A11Y-10 the edit panel of a user`, async ({ page }) => {
        const app = await signIn(page, account, language, 'users/alice');
        await app.entry().action(t(language, 'app.edit')).click();
        await expect(app.form().dialog).toBeVisible();
        await expectAccessible(page);
      });

      test(`A11Y-11 the reset password dialog`, async ({ page }) => {
        const app = await signIn(page, account, language, 'users/alice');
        await app.entry().action(t(language, 'password.title')).click();
        await new ResetPasswordDialog(page).expectOpen();
        await expectAccessible(page);
      });

      test(`A11Y-12 the delete confirmation`, async ({ page }) => {
        const app = await signIn(page, account, language, 'users/alice');
        // In the More menu, which opens first
        await app.entry().perform(t(language, 'app.delete'));
        await new ConfirmDialog(page).expectOpen();
        await expectAccessible(page);
      });

      test(`A11Y-13 the Add to a group dialog`, async ({ page }) => {
        const app = await signIn(page, account, language, 'users/alice');
        await app.entry().addToGroup().click();
        await new AddToGroupsDialog(page).expectOpen();
        await expectAccessible(page);
      });

      test(`A11Y-14 the change of state`, async ({ page }) => {
        const app = await signIn(page, account, language, 'users/alice');
        await app.entry().changeState.click();
        await expect(app.entry().statePanel).toBeVisible();
        await expectAccessible(page);
      });

      test(`A11Y-15 the CSV import, matched, checked and done`, async ({
        page,
      }) => {
        const app = await signIn(page, account, language, 'users');
        await app.list().importButton.click();
        const panel = app.importPanel();
        await expect(panel.dialog).toBeVisible();
        // Every required column matched, with one row that fails its check
        await panel.feed(
          csv([
            [
              'Employee ID',
              'Last name',
              'First name',
              'Full name',
              'Email',
              'Department',
            ],
            ['A11Y-1', 'Scan', 'Axe', 'Axe Scan', 'not-an-address', 'Nowhere'],
          ])
        );
        await expect(panel.readLine).toBeVisible();
        await expectAccessible(page);
        await panel.checkButton.click();
        await expect(panel.stats.first()).toBeVisible();
        await expectAccessible(page);
      });

      if (account === ADMIN)
        test(`A11Y-09 password policies with the form open`, async ({
          page,
        }) => {
          const app = await signIn(
            page,
            account,
            language,
            'password-policies'
          );
          await expect(app.policies().rows.first()).toBeVisible();
          // The page object names the button in English; the scan runs in both languages.
          await app
            .policies()
            .main.getByRole('button', {
              name: t(language, 'policy.new'),
              exact: true,
            })
            .click();
          await expect(new PolicyPanel(page).dialog).toBeVisible();
          await expectAccessible(page);
        });
    });
