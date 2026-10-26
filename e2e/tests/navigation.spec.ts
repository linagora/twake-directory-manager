import { LoginPage } from '../pages';
import { ADMIN, SOPHIE } from '../support/accounts';
import { uniquePart } from '../support/directory';
import { CONSOLE_PATH } from '../support/env';
import { expect, test } from '../support/fixtures';
import { t } from '../support/i18n';

const REFERENCE_LISTS = [
  'Positions',
  'Titles',
  'Account states',
  'List types',
  'Group types',
  'Mail domains',
  // admin's only, a global administrator of the stack (POLICY-01)
  'Password policies',
];

/** A translation key left as is, or an object printed as a string */
const RAW_TEXT =
  /\[object Object\]|\b(app|nav|list|form|detail|scope|import|dashboard|tree|transit|password|status|state)\.[a-z][A-Za-z]+\b/;

test.describe('NAV layout, navigation and language', () => {
  test('NAV-01 sidebar, highlighted entry and Reference data section', async ({
    page,
  }) => {
    const app = await new LoginPage(page).loginAs(ADMIN);

    await expect(app.navLabels).toHaveText([
      'Overview',
      'Users',
      'Groups',
      'Organizations',
      'Reference data',
    ]);
    await expect(app.referenceToggle()).toHaveAttribute(
      'aria-expanded',
      'false'
    );
    await expect(app.languageSelect).toBeVisible();
    await expect(app.navItem('Overview')).toHaveAttribute(
      'aria-current',
      'page'
    );

    await app.referenceToggle().click();
    await expect(app.referenceToggle()).toHaveAttribute(
      'aria-expanded',
      'true'
    );
    for (const name of REFERENCE_LISTS)
      await expect(app.navItem(name)).toBeVisible();
    await expect(app.navItem('Delivery modes')).toHaveCount(0);
    await app.reload();
    await expect(app.referenceToggle()).toHaveAttribute(
      'aria-expanded',
      'true'
    );
    await expect(app.navItem('Positions')).toBeVisible();

    await app.navItem('Positions').click();
    await expect(app.mainHeading).toHaveText('Positions');
    await expect(app.navItem('Positions')).toHaveAttribute(
      'aria-current',
      'page'
    );
    await expect(app.nav.locator('[aria-current]')).toHaveCount(1);
    await app.navItem('Users').click();
    await expect(app.navItem('Users')).toHaveAttribute('aria-current', 'page');
    await expect(app.nav.locator('[aria-current]')).toHaveCount(1);

    await app.referenceToggle().click();
    await expect(app.navItem('Titles')).toBeHidden();
    await app.navItem('Overview').click();
    await app.referenceLink('Titles').click();
    await expect(app.mainHeading).toHaveText('Titles');
    await expect(app.referenceToggle()).toHaveAttribute(
      'aria-expanded',
      'true'
    );
    await expect(app.navItem('Titles')).toHaveAttribute('aria-current', 'page');
  });

  test('NAV-02 overview cards', async ({
    page,
    directory,
    tenant,
    loginInNewContext,
  }) => {
    const app = await new LoginPage(page).loginAs(ADMIN);

    await app.card('Users').getByRole('button', { name: 'Open' }).click();
    await expect(app.mainHeading).toHaveText('Users');
    await page.goBack();
    for (const [card, title] of [
      ['Users', 'New user'],
      ['Groups', 'New group'],
      ['Organizations', 'New organization'],
    ] as const) {
      await app.card(card).getByRole('button', { name: title }).click();
      const form = app.form();
      await form.expectOpen(title);
      await form.cancel();
    }

    for (const name of REFERENCE_LISTS) {
      await app.navItem('Overview').click();
      await app.referenceLink(name).click();
      await expect(app.mainHeading).toHaveText(name);
      await expect(app.list().rows.first()).toBeVisible();
    }
    await app.navItem('Overview').click();
    await expect(app.referenceLink('Delivery modes')).toHaveCount(0);

    // Since d698457 the card creates under the one branch a local administrator administers,
    // where the plan (audited before it) still reads "Creation not allowed here"
    const sophie = await loginInNewContext(SOPHIE);
    await expect(
      sophie.main.getByText(
        'Signed in as Sophie Martin (sophie.martin@example.com)',
        { exact: true }
      )
    ).toBeVisible();
    await expect(
      sophie.card('Users').getByRole('button', { name: 'New user' })
    ).toBeVisible();
    await expect(
      sophie.card('Groups').getByRole('button', { name: 'New group' })
    ).toBeVisible();
    await expect(
      sophie
        .card('Organizations')
        .getByRole('button', { name: 'New organization' })
    ).toBeVisible();

    // created under that branch: shown on a branch of the test's own, not to write in Sales
    const local = await loginInNewContext(tenant.admin);
    await local
      .card('Organizations')
      .getByRole('button', { name: 'New organization' })
      .click();
    const form = local.form();
    await form.expectOpen('New organization');
    const name = `Card ${uniquePart()}`;
    const dn = `ou=${name},${tenant.org.dn}`;
    directory.track(dn);
    await form.fill('Name', name);
    await form.submit();
    await local.expectToast(`${name} created`);
    expect(await directory.values(dn, 'twakeDepartmentPath')).toEqual([
      `${tenant.org.path} / ${name}`,
    ]);
  });

  test('NAV-03 switch the whole interface to French and back', async ({
    page,
  }) => {
    const app = await new LoginPage(page).loginAs(ADMIN, 'users');
    const list = app.list();
    await list.listEverything();
    await list.open('alice');
    await app.entry().expectName('Alice Moreau');

    // each language by its own name, whatever the interface's
    await expect(app.languageSelect.locator('option')).toHaveText([
      'English',
      'Français',
      'Монгол',
    ]);
    await app.setLanguage('fr');
    await expect(app.languageSelect.locator('option')).toHaveText([
      'English',
      'Français',
      'Монгол',
    ]);

    await expect(app.navLabels).toHaveText([
      'Vue d’ensemble',
      'Utilisateurs',
      'Groupes',
      'Organisations',
      'Référentiels',
    ]);
    await expect(app.sidebar).toContainText('Langue');
    await expect(app.banner).toContainText('Vous administrez');
    await expect(app.scopeBranches).toContainText(
      'lecture, écriture, suppression'
    );
    await expect(app.signOutLink).toHaveText('Se déconnecter');
    const entry = app.entry();
    await expect(entry.action('Modifier')).toBeVisible();
    await expect(entry.detail('Matricule')).toHaveText('E0010');
    await expect(entry.detail('Nom de famille')).toHaveText('Moreau');
    await expect(entry.detail('Prénom')).toHaveText('Alice');
    await expect(app.main).not.toContainText(RAW_TEXT);

    await entry.action('Modifier').click();
    const form = app.form();
    await form.expectOpen('Modifier — alice');
    await expect(form.requiredLegend).toHaveText(
      'Les champs marqués d’une * sont obligatoires'
    );
    await expect(
      form.dialog.getByRole('group', { name: /messagerie/ })
    ).toBeVisible();
    await expect(form.dialog).not.toContainText(RAW_TEXT);
    await expect(form.dialog).not.toContainText(
      /Expected|Fields marked|Mailbox Settings/
    );
    await form.cancel();

    await app.reload();
    await expect(app.languageSelect).toHaveValue('fr');
    await expect(app.navItem('Utilisateurs')).toBeVisible();

    await app.navItem('Utilisateurs').click();
    await expect(app.list().searchBox).toHaveAccessibleName(
      'Rechercher dans Utilisateurs'
    );
    await expect(app.main).toContainText('dans');
    await expect(app.list().searchIn.locator('option').first()).toHaveText(
      'Tous les champs'
    );
    await expect(
      app
        .list()
        .importButton.or(
          app.main.getByRole('button', { name: 'Importer un CSV' })
        )
    ).toBeVisible();
    await expect(app.list().listEverythingButton).toHaveText(
      'Lister sans rechercher'
    );

    await app.setLanguage('en');
    await expect(app.navItem('Users')).toBeVisible();
    await expect(app.list().listEverythingButton).toHaveText(
      'List without searching'
    );
    await expect(app.signOutLink).toHaveText('Sign out');
  });

  test('NAV-04 French on secondary screens', async ({ page }) => {
    const app = await new LoginPage(page).loginAs(ADMIN);
    await app.setLanguage('fr');

    await expect(
      app.main.getByRole('heading', { name: 'Ce que vous pouvez gérer' })
    ).toBeVisible();
    await app.navItem('Groupes').click();
    await expect(app.list().listEverythingButton).toHaveText(
      'Lister sans rechercher'
    );
    await app.list().listEverything();
    await expect(app.list().columnHeaders.first()).toBeVisible();

    const organizations = await app.openOrganizations();
    await organizations.select('Sales');
    await expect(organizations.card.detail('Description')).toHaveText(
      'Sales department'
    );
    await expect(organizations.card.attachedHeading('Personnes')).toHaveText(
      'Personnes (1)'
    );
    await expect(organizations.card.attachedHeading('Groupes')).toHaveText(
      'Groupes (1)'
    );

    await app.navItem('Référentiels').click();
    await app
      .navItem('Postes')
      .or(app.nav.getByRole('button').nth(5))
      .first()
      .click();
    await expect(app.list().rows.first()).toBeVisible();

    await app.open('users/grace');
    const grace = app.entry();
    await expect(grace.transitTag).toHaveText(t('fr', 'transit.badge'));
    await expect(grace.changeState).toHaveText(t('fr', 'status.change'));
    await grace.changeState.click();
    await expect(grace.statePanel).toContainText(
      t('fr', 'status.current', { state: t('fr', 'state.enabled') })
    );
    await expect(grace.stateChoices()).toHaveCount(3);
    for (const key of ['state.disabled', 'state.noAccess', 'state.toDelete'])
      await expect(
        grace.statePanel.getByRole('radio', { name: t('fr', key), exact: true })
      ).toBeVisible();
    await app.panel.getByRole('button', { name: 'Annuler' }).click();
    await grace.action(t('fr', 'password.title')).click();
    await expect(app.panel).toContainText(
      'Laissez vide pour générer un mot de passe'
    );
    await app.panel.getByRole('button', { name: 'Annuler' }).click();
    await grace.action(t('fr', 'transit.claim')).click();
    await expect(app.panel).toContainText(t('fr', 'transit.target'));
    await app.panel.getByRole('button', { name: 'Annuler' }).click();

    await app.navItem('Utilisateurs').click();
    await app.main.getByRole('button', { name: 'Importer un CSV' }).click();
    await expect(app.panel).toContainText('Choisir un fichier CSV');
    await expect(app.panel).toContainText('Télécharger un fichier vide');
    await expect(app.panel).not.toContainText(RAW_TEXT);
    await app.panel.locator('[data-import-close]').click();

    const list = app.list();
    await list.listEverything();
    await expect(list.counter).toHaveText(/^1–\d+ sur \d+$/);
    await expect(list.previousButton).toHaveText('Précédent');
    await list.rowCheckbox('alice').check();
    await expect(list.bulkBar).toContainText('1 sélectionné');
    await expect(list.exportButton).toHaveText('Exporter la sélection');
    await expect(list.deleteSelectionButton).toHaveText(
      'Supprimer la sélection'
    );
    await expect(app.main).not.toContainText(RAW_TEXT);

    await app.main.getByRole('button', { name: /^Créer/ }).click();
    const form = app.form();
    await form.submit();
    await expect(form.errors().first()).toHaveText('Obligatoire');
    await expect(form.dialog).not.toContainText(/Fields marked|Expected an/);
  });

  test('NAV-05 narrow screen and dark mode', async ({ page }) => {
    await page.setViewportSize({ width: 400, height: 800 });
    const app = await new LoginPage(page).loginAs(ADMIN);

    // The sidebar becomes a row that scrolls sideways, above the page
    const nav = await app.nav.boundingBox();
    expect(nav).not.toBeNull();
    expect(nav?.height ?? 0).toBeLessThan(120);
    await expect(app.languageSelect).toBeInViewport();
    await app.setLanguage('fr');
    await expect(app.navItem('Utilisateurs')).toBeVisible();
    await app.setLanguage('en');

    await app.open('users/alice');
    await app.entry().action('Edit').click();
    const form = app.form();
    await form.expectOpen('Edit — alice');
    await form.submitButton.scrollIntoViewIfNeeded();
    await expect(form.submitButton).toBeInViewport();
    await form.cancel();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth)
    ).toBeLessThanOrEqual(400);

    await page.setViewportSize({ width: 1280, height: 800 });
    await page.emulateMedia({ colorScheme: 'dark' });
    for (const hash of ['', 'users', 'users/alice']) {
      await app.open(hash);
      const colors = await app.main.evaluate(main => {
        const luminance = (color: string): number => {
          const [r, g, b] = (color.match(/\d+(\.\d+)?/g) ?? ['0', '0', '0'])
            .slice(0, 3)
            .map(Number)
            .map(v => v / 255)
            .map(v =>
              v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
            );
          return 0.2126 * (r ?? 0) + 0.7152 * (g ?? 0) + 0.0722 * (b ?? 0);
        };
        let background = 'rgb(255, 255, 255)';
        for (let el: Element | null = main; el; el = el.parentElement) {
          const value = getComputedStyle(el).backgroundColor;
          if (value !== 'rgba(0, 0, 0, 0)' && value !== 'transparent') {
            background = value;
            break;
          }
        }
        if (background === 'rgb(255, 255, 255)')
          background = getComputedStyle(document.body).backgroundColor;
        const text = getComputedStyle(
          main.querySelector('h1, h2') ?? main
        ).color;
        const [light, dark] = [luminance(text), luminance(background)].sort(
          (a, b) => b - a
        );
        return {
          contrast: ((light ?? 0) + 0.05) / ((dark ?? 0) + 0.05),
          background: luminance(background),
        };
      });
      expect(colors.background, `dark background on #/${hash}`).toBeLessThan(
        0.2
      );
      expect(colors.contrast, `readable text on #/${hash}`).toBeGreaterThan(
        4.5
      );
    }
  });

  test('NAV-06 Mongolian interface', async ({ page }) => {
    const app = await new LoginPage(page).loginAs(ADMIN);

    await app.setLanguage('mn');

    await expect(app.navLabels).toHaveText([
      'Тойм',
      'Хэрэглэгчид',
      'Бүлгүүд',
      'Байгууллагууд',
      'Лавлах өгөгдөл',
    ]);
    await expect(app.sidebar).toContainText('Хэл');
    await expect(app.signOutLink).toHaveText('Гарах');
    await expect(app.main).not.toContainText(RAW_TEXT);

    await app.navItem('Хэрэглэгчид').click();
    await app.list().listEverything();
    await expect(app.list().row('alice')).toBeVisible();
    await expect(app.main).not.toContainText(RAW_TEXT);
    await app.list().open('alice');
    const entry = app.entry();
    await entry.expectName('Alice Moreau');
    await expect(app.main).not.toContainText(RAW_TEXT);
    await entry.actions().filter({ hasText: 'Засах' }).click();
    const form = app.form();
    await expect(form.dialog).toBeVisible();
    await expect(form.dialog).not.toContainText(RAW_TEXT);
    await expect(form.dialog).not.toContainText(
      /Employee ID|Last name|Expected|Mailbox Settings/
    );
    await form.cancelButton.click();
    await app.openOrganizations();
    await expect(app.organizations().label('Sales')).toBeVisible();

    await app.reload();
    await expect(app.languageSelect).toHaveValue('mn');
    await expect(app.navItem('Тойм')).toBeVisible();
    await app.setLanguage('en');
    await expect(app.navItem('Overview')).toBeVisible();
  });

  test('NAV-07 the bare host opens the console', async ({ page }) => {
    await page.goto('/');

    const login = new LoginPage(page);
    await login.expectShown();
    await expect(page.locator('body')).not.toContainText('Cannot GET');
    await login.submit(ADMIN);
    await expect(page).toHaveURL(new RegExp(CONSOLE_PATH));
    const app = await new LoginPage(page).loginAs(ADMIN);
    await expect(app.mainHeading).toHaveText('Twake Directory Manager');
  });

  test('NAV-08 side panel is a modal dialog: focus, Tab, Escape', async ({
    page,
  }) => {
    const app = await new LoginPage(page).loginAs(ADMIN, 'users/bob');
    const entry = app.entry();
    const edit = entry.action('Edit');

    await edit.click();
    const form = app.form();
    await form.expectOpen('Edit — bob');
    await expect(
      page.getByRole('dialog', { name: 'Edit — bob' })
    ).toHaveAttribute('aria-modal', 'true');
    await expect(await form.field('Employee ID')).toBeFocused();

    // The field's help is a button the keyboard reaches; Escape hides it
    // and leaves the form open, the focus on the button (#216)
    const help = form.dialog.getByRole('button', {
      name: 'Help on Employee ID',
    });
    const tooltip = form.dialog.locator('#dc-help-employeeNumber');
    await expect(tooltip).toBeHidden();
    // Reached with the keyboard (Shift+Tab from the field it precedes), which
    // is what shows the help: a focus set by a script does not.
    await page.keyboard.press('Shift+Tab');
    await expect(help).toBeFocused();
    await expect(tooltip).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(tooltip).toBeHidden();
    await expect(form.dialog).toBeVisible();
    await expect(help).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(tooltip).toBeVisible();

    const insidePanel = (): Promise<boolean> =>
      page.evaluate(() =>
        Boolean(document.activeElement?.closest('[role=dialog]'))
      );
    for (let i = 0; i < 30; i++) {
      await page.keyboard.press('Tab');
      expect(await insidePanel(), `focus after ${i + 1} Tab`).toBe(true);
    }
    for (let i = 0; i < 5; i++) {
      await page.keyboard.press('Shift+Tab');
      expect(await insidePanel(), `focus after ${i + 1} Shift+Tab`).toBe(true);
    }

    // From a field: a help button showing its text would spend the Escape
    await (await form.field('Employee ID')).focus();
    await page.keyboard.press('Escape');
    await form.expectClosed();
    await expect(edit).toBeFocused();

    await edit.click();
    await form.expectOpen('Edit — bob');
    await form.type('Delegates', 'dav');
    await expect(form.options('Delegates').first()).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(form.suggestions('Delegates')).toBeHidden();
    await expect(form.dialog).toBeVisible();
    await page.keyboard.press('Escape');
    await form.expectClosed();
  });

  test('NAV-09 side panel opens at its top and closes when the page changes', async ({
    page,
    directory,
  }) => {
    const app = await new LoginPage(page).loginAs(ADMIN, 'users/alice');
    const form = app.form();
    // whichever element of the panel scrolls
    const scrolled = (): Promise<number> =>
      page
        .locator('[data-panel]')
        .evaluate(panel =>
          Math.max(
            panel.scrollTop,
            ...Array.from(panel.querySelectorAll('*')).map(el => el.scrollTop)
          )
        );

    await app.entry().action('Edit').click();
    await form.expectOpen('Edit — alice');
    // the last field: the actions stay at the bottom of the panel
    await (await form.field('Delegates')).scrollIntoViewIfNeeded();
    expect(await scrolled()).toBeGreaterThan(0);
    await form.cancel();

    await app.open('users/bob');
    await app.entry().action('Edit').click();
    await form.expectOpen('Edit — bob');
    expect(await scrolled()).toBe(0);
    await expect(await form.field('Employee ID')).toBeInViewport();

    await form.fill('Locality', 'Nowhere');
    await page.goBack();
    await form.expectClosed();
    expect(
      await directory.values('uid=bob,ou=users,dc=example,dc=com', 'l')
    ).toEqual(['Berlin']);

    await app.open('users/carol');
    await app.entry().action('Edit').click();
    await form.expectOpen('Edit — carol');
    await form.fill('Locality', 'Nowhere');
    await page.goto(`${CONSOLE_PATH}#/groups`);
    await form.expectClosed();
    await expect(app.mainHeading).toHaveText('Groups');
    expect(
      await directory.values('uid=carol,ou=users,dc=example,dc=com', 'l')
    ).toEqual([]);
  });

  test('NAV-10 an unknown address says there is no page there', async ({
    page,
  }) => {
    const app = await new LoginPage(page).loginAs(ADMIN, 'passwordPolicies');
    const notFound = app.main.getByText('There is no page at this address.', {
      exact: true,
    });
    const toOverview = app.main.getByRole('link', {
      name: 'Go to the Overview',
      exact: true,
    });

    await expect(notFound).toBeVisible();
    await expect(toOverview).toBeVisible();
    await expect(app.main.locator('.dc-dashboard')).toHaveCount(0);
    await expect(app.nav.locator('[aria-current]')).toHaveCount(0);

    for (const code of ['fr', 'mn'] as const) {
      await app.setLanguage(code);
      await expect(
        app.main.getByText(t(code, 'app.notFound'), { exact: true })
      ).toBeVisible();
      await expect(
        app.main.getByRole('link', { name: t(code, 'app.toOverview') })
      ).toBeVisible();
    }
    await app.setLanguage('en');

    await toOverview.click();
    await expect(app.mainHeading).toHaveText('Twake Directory Manager');
    await expect(app.navItem('Overview')).toHaveAttribute(
      'aria-current',
      'page'
    );

    await app.open('accountStates');
    await expect(notFound).toBeVisible();
    for (const [hash, heading] of [
      ['', 'Twake Directory Manager'],
      ['accountStatuses', 'Account states'],
      ['password-policies', 'Password policies'],
    ]) {
      await app.open(hash);
      await expect(app.mainHeading).toHaveText(heading);
      await expect(notFound).toHaveCount(0);
    }
    await page.goto(CONSOLE_PATH);
    await app.expectLoaded();
    await expect(app.mainHeading).toHaveText('Twake Directory Manager');
  });

  test('NAV-12 the discard question is read with Keep editing', async ({
    page,
  }) => {
    // A screen reader heard "Keep editing, button" and nothing of why the
    // form had not closed (#217).
    const app = await new LoginPage(page).loginAs(ADMIN, 'users/bob');
    await app.entry().action('Edit').click();
    const form = app.form();
    await form.expectOpen('Edit — bob');
    await form.fill('Employee ID', 'E9999');
    await page.keyboard.press('Escape');
    const question = form.dialog.getByRole('group', {
      name: 'Discard what you typed?',
    });
    await expect(question).toBeVisible();
    await expect(form.keepEditingButton).toBeFocused();
    await expect(form.keepEditingButton).toHaveAccessibleDescription(
      'Discard what you typed?'
    );
    await form.keepEditingButton.click();
    await expect(form.dialog).toBeVisible();
    await expect(question).toHaveCount(0);
    await page.keyboard.press('Escape');
    await form.discardButton.click();
    await form.expectClosed();
  });

  test('NAV-11 the frame for keyboard and screen-reader users: titles, skip link, lists, language', async ({
    page,
  }) => {
    const app = await new LoginPage(page).loginAs(ADMIN);

    // One title per page, the cards keeping their names (#214)
    for (const [hash, name] of [
      ['', 'Overview'],
      ['users', 'Users'],
      ['groups', 'Groups'],
      ['positions', 'Positions'],
      ['password-policies', 'Password policies'],
      ['nowhere', 'No such page'],
      ['users/alice', 'Alice Moreau'],
    ]) {
      await app.open(hash);
      await expect(page).toHaveTitle(`${name} — Twake Directory Manager`);
    }

    // The sidebar is a list, the reference data another once opened (#219).
    // Showing a reference page above opened its section; close it first.
    await app.open('users');
    if ((await app.referenceToggle().getAttribute('aria-expanded')) === 'true')
      await app.referenceToggle().click();
    await expect(app.nav.getByRole('list')).toHaveCount(1);
    await expect(app.nav.getByRole('list').getByRole('listitem')).toHaveCount(
      4
    );
    await app.referenceToggle().click();
    await expect(app.nav.getByRole('list')).toHaveCount(2);
    await expect(
      app.nav.getByRole('list').nth(1).getByRole('listitem')
    ).toHaveCount(REFERENCE_LISTS.length);
    await expect(app.navItem('Users')).toHaveAttribute('aria-current', 'page');
    await app.referenceToggle().click();

    // The first Tab reaches a link to the main area; Enter focuses it, the
    // address does not change, and the next Tab is the page's first control
    // (#215)
    // The link is the first thing the page offers the keyboard; Enter on it
    // focuses the main area, the address does not change, and the next Tab
    // is the page's first control. Chromium, after loading `#/`, does not
    // start Tab from the top of the document, so the link is checked as the
    // first focusable element in the page's order, then focused.
    await app.open('');
    await app.reload();
    const skip = page.getByRole('link', { name: 'Skip to main content' });
    await expect(skip).not.toBeInViewport();
    expect(
      await page.evaluate(() =>
        document
          .querySelector(
            'a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])'
          )
          ?.getAttribute('data-skip')
      )
    ).toBe('');
    await skip.focus();
    await expect(skip).toBeFocused();
    await expect(skip).toBeInViewport();
    await page.keyboard.press('Enter');
    await expect(app.main).toBeFocused();
    await expect(page).toHaveURL(/#\/$/);
    await page.keyboard.press('Tab');
    await expect(app.main.locator(':focus')).toHaveCount(1);
    await expect(skip).not.toBeInViewport();

    // The page speaks the interface's language, and the select that changed
    // it keeps the focus and says what it does (#209)
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(app.languageSelect).toHaveAccessibleDescription(
      'The interface changes language as soon as one is chosen.'
    );
    await app.languageSelect.focus();
    await app.languageSelect.selectOption('fr');
    await expect(app.languageSelect).toHaveValue('fr');
    await expect(app.languageSelect).toBeFocused();
    await expect(page.locator('html')).toHaveAttribute('lang', 'fr');
    await expect(page).toHaveTitle('Vue d’ensemble — Twake Directory Manager');
    await app.reload();
    await expect(page.locator('html')).toHaveAttribute('lang', 'fr');
    await app.setLanguage('mn');
    await expect(page.locator('html')).toHaveAttribute('lang', 'mn');
    await app.setLanguage('en');
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  });
});
