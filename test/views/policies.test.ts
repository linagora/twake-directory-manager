/**
 * The password policies page, mounted: the table, and the panel that
 * creates, edits and deletes a policy (src/views/policies.ts).
 */
import { expect } from 'chai';
import type nock from 'nock';

import type { PasswordPolicy } from '../../src/types';
import { click, panelOf, press, type, until } from '../support/act';
import { mountConsole, settled, type Mounted } from '../support/mount';

const base = 'ou=policies,dc=example,dc=com';
const policy = (
  cn: string,
  values: Partial<PasswordPolicy> = {}
): PasswordPolicy => ({
  dn: `cn=${cn},${base}`,
  cn,
  isDefault: false,
  ...values,
});

/** What the directory holds: its default policy and one of its own. */
const held = (): PasswordPolicy[] => [
  policy('default', { isDefault: true, pwdMinLength: 8, pwdMaxAge: 31536000 }),
  policy('software', { pwdMinLength: 12 }),
];

/**
 * The page mounted as the global administrator, over a server holding
 * these policies: what a write changes there, the next read says.
 */
const page = async (
  options: { language?: string; policies?: PasswordPolicy[] } = {}
): Promise<Mounted & { policies: PasswordPolicy[] }> => {
  const policies = options.policies ?? held();
  const mounted = await mountConsole({
    hash: 'password-policies',
    scope: 'admin',
    policies: true,
    language: options.language,
    answers: (server: nock.Scope) => {
      server.get('/api/v1/password-policies').reply(() => [200, { policies }]);
    },
  });
  return { ...mounted, policies };
};

/** The toast's message, or nothing while it is hidden. */
const toast = (root: HTMLElement): string => {
  const element = root.querySelector<HTMLElement>('[data-toast]');
  return element && !element.hidden ? (element.textContent ?? '') : '';
};

/** The names of the policies the table lists, in its order. */
const listed = (root: HTMLElement): string[] =>
  Array.from(
    root.querySelectorAll<HTMLElement>('[data-main] [data-policy-open]')
  ).map(button => button.textContent ?? '');

describe('views/policies', () => {
  it('should list the policies, each named by a button that opens it', async () => {
    const { root, calls } = await page();
    const main = root.querySelector<HTMLElement>('[data-main]');
    expect(main?.querySelector('h1')?.textContent).to.equal(
      'Password policies'
    );
    expect(calls).to.include('passwordPolicies()');
    expect(listed(root)).to.deep.equal(['default', 'software']);
    const open = main?.querySelector<HTMLButtonElement>(
      'button[data-policy-open="default"]'
    );
    expect(open?.getAttribute('aria-label')).to.equal(
      'Open the policy default'
    );
    expect(
      main?.querySelector('tr[data-policy="default"] .dc-tag')?.textContent
    ).to.equal('Default');
    expect(main?.querySelector('tr[data-policy="software"] .dc-tag')).to.equal(
      null
    );
  });

  it('should create a policy from New policy, and list it', async () => {
    const { root, calls, server, policies } = await page();
    const { panel, title, body } = panelOf(root);
    server.post('/api/v1/password-policies').reply((_uri, sent) => {
      policies.push(policy((sent as { cn: string }).cn));
      return [200, policies[policies.length - 1]];
    });
    click(root, '[data-main] [data-new]');
    expect(panel.hidden).to.be.false;
    expect(title.textContent).to.equal('New password policy');
    // On its first field, the name.
    const name = body.querySelector<HTMLInputElement>('#dc-policy-cn');
    expect(document.activeElement).to.equal(name);
    type(name, 'contractors');
    click(body, 'button[type="submit"]');
    await until(() => panel.hidden);
    expect(
      calls.some(call => call.startsWith('createPasswordPolicy(contractors'))
    ).to.be.true;
    expect(toast(root)).to.equal('Password policy created');
    await settled(root);
    expect(calls.filter(call => call === 'passwordPolicies()')).to.have.length(
      2
    );
    expect(listed(root)).to.deep.equal(['default', 'software', 'contractors']);
  });

  it('should say under Name that a policy already has the name', async () => {
    // A toast quoted the server's English and the other policy's DN.
    const { root, server } = await page({ language: 'fr' });
    const { panel, body } = panelOf(root);
    server.post('/api/v1/password-policies').reply(409, {
      error:
        'A password policy is named default: cn=default,ou=policies,dc=example,dc=com',
    });
    click(root, '[data-main] [data-new]');
    const name = body.querySelector<HTMLInputElement>('#dc-policy-cn');
    type(name, 'default');
    click(body, 'button[type="submit"]');
    const error = body.querySelector<HTMLElement>('#dc-policy-cn-error');
    await until(() => error?.hidden === false);
    expect(error?.textContent).to.equal(
      'Une politique de mot de passe s’appelle déjà default'
    );
    expect(name?.getAttribute('aria-invalid')).to.equal('true');
    expect(name?.getAttribute('aria-describedby')).to.equal(
      'dc-policy-cn-error'
    );
    expect(document.activeElement).to.equal(name);
    expect(panel.hidden).to.be.false;
    expect(toast(root)).to.equal('');
  });

  it('should edit a policy opened from its row', async () => {
    const { root, calls, server } = await page();
    const { panel, title, body } = panelOf(root);
    server
      .patch('/api/v1/password-policies/software')
      .reply(200, policy('software', { pwdMinLength: 14 }));
    // Anywhere on the row, for the mouse.
    click(root, '[data-main] tr[data-policy="software"] td:last-child');
    expect(panel.hidden).to.be.false;
    expect(title.textContent).to.equal('Password policy software');
    type(body.querySelector<HTMLInputElement>('#dc-policy-pwdMinLength'), '14');
    click(body, 'button[type="submit"]');
    await until(() => panel.hidden);
    expect(calls).to.include(
      'updatePasswordPolicy(software, {"pwdMinLength":14})'
    );
    expect(toast(root)).to.equal('Password policy saved');
  });

  it('should ask over the form before deleting, and give the form back on Cancel', async () => {
    const { root, calls, server, policies } = await page();
    const { panel, dialog, title, body } = panelOf(root);
    server.delete('/api/v1/password-policies/software').reply(() => {
      policies.splice(
        policies.findIndex(item => item.cn === 'software'),
        1
      );
      return [204];
    });
    click(root, '[data-main] [data-policy-open="software"]');
    const length = body.querySelector<HTMLInputElement>(
      '#dc-policy-pwdMinLength'
    );
    type(length, '20');
    // Pressed from the keyboard: the focus is on the button.
    const remove = body.querySelector<HTMLButtonElement>('[data-delete]');
    remove?.focus();
    remove?.click();
    expect(title.textContent).to.equal('Delete the password policy software?');
    expect(dialog.getAttribute('role')).to.equal('alertdialog');
    expect(body.textContent).to.include('This cannot be undone.');
    expect(body.querySelector('#dc-policy-pwdMinLength')).to.equal(null);
    // Enter out of habit deletes nothing.
    expect(document.activeElement).to.equal(
      body.querySelector('[data-cancel]')
    );
    click(body, '[data-cancel]');
    expect(panel.hidden).to.be.false;
    expect(title.textContent).to.equal('Password policy software');
    expect(dialog.getAttribute('role')).to.equal('dialog');
    expect(body.querySelector('#dc-policy-pwdMinLength')).to.equal(length);
    expect(length?.value).to.equal('20');
    expect(document.activeElement).to.equal(remove);
    expect(calls.some(call => call.startsWith('deletePasswordPolicy'))).to.be
      .false;
    // Asked again, and confirmed.
    remove?.click();
    click(body, '[data-confirm]');
    await until(() => panel.hidden);
    expect(calls).to.include('deletePasswordPolicy(software)');
    expect(toast(root)).to.equal('Password policy deleted');
    await settled(root);
    expect(listed(root)).to.deep.equal(['default']);
  });

  it('should say in words why a policy cannot be deleted', async () => {
    const { root, server } = await page({ language: 'fr' });
    const { panel, body } = panelOf(root);
    server.delete('/api/v1/password-policies/software').reply(409, {
      error: 'cn=software,ou=policies is still applied to at least one entry',
    });
    click(root, '[data-main] [data-policy-open="software"]');
    click(body, '[data-delete]');
    click(body, '[data-confirm]');
    await until(() => toast(root) !== '');
    expect(toast(root)).to.equal(
      'software est la politique par défaut, ou des comptes l’utilisent encore'
    );
    // The form is given back, to be cancelled or changed.
    expect(panel.hidden).to.be.false;
    expect(body.querySelector('#dc-policy-pwdMinLength')).to.not.equal(null);
  });

  it('should say why the policies cannot be read', async () => {
    const { root } = await mountConsole({
      hash: 'password-policies',
      scope: 'admin',
      policies: false,
    });
    const said = root.querySelector<HTMLElement>('[data-main] [data-list] p');
    expect(said?.textContent).to.equal('You may not see this entry');
    // A refusal, not a failure of the console.
    expect(said?.classList.contains('dc-error-block')).to.be.false;
    expect(root.querySelector('[data-main] [data-policy-open]')).to.equal(null);
  });

  it('should close on Escape and give the focus back to what opened it', async () => {
    const { root } = await page();
    const { panel } = panelOf(root);
    const create = root.querySelector<HTMLElement>('[data-main] [data-new]');
    create?.focus();
    create?.click();
    expect(panel.hidden).to.be.false;
    expect(press('Escape')).to.be.true;
    expect(panel.hidden).to.be.true;
    expect(document.activeElement).to.equal(create);
    // Opened from anywhere on a row, the name's button stands for it.
    click(root, '[data-main] tr[data-policy="software"] td:last-child');
    expect(panel.hidden).to.be.false;
    press('Escape');
    expect(panel.hidden).to.be.true;
    expect(document.activeElement).to.equal(
      root.querySelector('[data-main] [data-policy-open="software"]')
    );
  });

  it('should ask before Escape loses what was typed', async () => {
    const { root } = await page();
    const { panel, body } = panelOf(root);
    click(root, '[data-main] [data-new]');
    type(body.querySelector<HTMLInputElement>('#dc-policy-cn'), 'contractors');
    press('Escape');
    expect(panel.hidden).to.be.false;
    expect(document.activeElement).to.equal(
      body.querySelector('[data-discard-keep]')
    );
    press('Escape');
    expect(panel.hidden).to.be.true;
  });

  it('should keep Tab in the panel', async () => {
    const { root } = await page();
    const { dialog, body } = panelOf(root);
    click(root, '[data-main] [data-new]');
    const close = dialog.querySelector<HTMLElement>('[data-panel-close]');
    const submit = body.querySelector<HTMLElement>('button[type="submit"]');
    // Past the last control, back to the first: the header's ×.
    submit?.focus();
    expect(press('Tab')).to.be.true;
    expect(document.activeElement).to.equal(close);
    // And the other way with Shift.
    expect(press('Tab', true)).to.be.true;
    expect(document.activeElement).to.equal(submit);
    // Between two of its controls, Tab is the browser's to move.
    body.querySelector<HTMLElement>('#dc-policy-cn')?.focus();
    expect(press('Tab')).to.be.false;
  });
});
