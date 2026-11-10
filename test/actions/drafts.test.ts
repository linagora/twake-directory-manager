/**
 * What a form holds across a sign-in again, mounted: a 401 keeps the form's
 * draft before the page would reload, and the console offers it back — prefilled,
 * with a notice — once signed in again (#68).
 */
import { expect } from 'chai';
import type nock from 'nock';

import { click, panelOf, press, type, until } from '../support/act';
import { mountConsole, settled, type Mounted } from '../support/mount';
import { saveDraft, type Draft } from '../../src/session';

const top = 'ou=organization,dc=example,dc=com';
const sales = `ou=Sales,${top}`;
const DRAFT_KEY = 'ldap-rest.console.draft';

/** The toast's message, or nothing while it is hidden. */
const toast = (root: HTMLElement): string => {
  const element = root.querySelector<HTMLElement>('[data-toast]');
  return element && !element.hidden ? (element.textContent ?? '') : '';
};

/** A field of the form open in the panel, by its attribute. */
const field = (root: HTMLElement, name: string): HTMLInputElement | null =>
  panelOf(root).body.querySelector<HTMLInputElement>(`[name="${name}"]`);

/** Wait for the form to be drawn in the panel. */
const drawn = (root: HTMLElement): Promise<void> =>
  until(() => !!panelOf(root).body.querySelector('form button[type="submit"]'));

/** The organization tree the department picker searches. */
const departments = (server: nock.Scope): void => {
  server
    .get('/api/v1/ldap/organizations/top')
    .reply(200, { dn: top, ou: 'organization' });
  server
    .get(/\/api\/v1\/ldap\/organizations\/[^/]+\/search\?q=/)
    .reply(200, [{ dn: sales, ou: 'Sales', twakeDepartmentPath: 'Sales' }]);
};

/** Pick Sales in the department field, searched as the reader does. */
const pickSales = async (root: HTMLElement): Promise<void> => {
  const { body } = panelOf(root);
  type(
    body.querySelector<HTMLInputElement>('#dc-field-twakeDepartmentLink'),
    'Sal'
  );
  await until(() => !!body.querySelector('[data-candidate="0"]'));
  press('Enter');
};

/** The list of users, its New user form open and filled; Save not pressed yet. */
const newUser = async (): Promise<Mounted> => {
  const mounted = await mountConsole({ hash: 'users', answers: departments });
  const { root } = mounted;
  click(root, '[data-main] [data-new]');
  await drawn(root);
  type(field(root, 'employeeNumber'), 'E0099');
  type(field(root, 'sn'), 'Lefèvre');
  type(field(root, 'givenName'), 'Hélène');
  type(field(root, 'displayName'), 'Hélène Lefèvre');
  type(field(root, 'mail'), 'helene@example.com');
  type(field(root, 'userPassword'), 'Typed-1!');
  await pickSales(root);
  return mounted;
};

/** Press Save, from the button, as the reader does. */
const save = (root: HTMLElement): void => {
  const button = panelOf(root).body.querySelector<HTMLElement>(
    'form button[type="submit"]'
  );
  if (!button) throw new Error('no Save');
  button.focus();
  button.click();
};

/** The draft kept, as the console wrote it. */
const kept = (): Draft | null =>
  JSON.parse(sessionStorage.getItem(DRAFT_KEY) ?? 'null') as Draft | null;

describe('actions/drafts', () => {
  it('should keep what the form holds when the session ends, and offer it back', async () => {
    const first = await newUser();
    first.server
      .post('/api/v1/ldap/users')
      .reply(401, { error: 'No authenticated user' });
    save(first.root);
    await until(() => toast(first.root) !== '');
    // The mounted API is on another origin: the client does not end the
    // session itself, so the test does it as the page's own origin would.
    first.endSession();
    const draft = kept();
    expect(draft).to.include({
      entity: 'users',
      page: 'users',
      user: 'uid=admin,ou=users,dc=example,dc=com',
    });
    expect(draft?.edit).to.equal(undefined);
    expect(draft?.values.displayName).to.deep.equal(['Hélène Lefèvre']);
    expect(draft?.values.mail).to.deep.equal(['helene@example.com']);
    expect(draft?.values.twakeDepartmentLink).to.deep.equal([sales]);
    // A password is never kept.
    expect(draft?.values).to.not.have.property('userPassword');
    first.unmount();

    // Signed in again, on the page the form was opened on.
    const second = await mountConsole({ hash: 'users' });
    await drawn(second.root);
    const { body } = panelOf(second.root);
    expect(
      body.querySelector<HTMLInputElement>('#dc-field-displayName')?.value
    ).to.equal('Hélène Lefèvre');
    expect(
      body.querySelector<HTMLInputElement>('#dc-field-mail')?.value
    ).to.equal('helene@example.com');
    expect(
      body.querySelector<HTMLInputElement>('#dc-field-userPassword')?.value
    ).to.equal('');
    expect(body.querySelector('.dc-form-notice')?.textContent).to.equal(
      'Restored after signing in again — check it before saving.'
    );
    // Taken: nothing left to offer on the next load.
    expect(kept()).to.equal(null);
  });

  it('should offer the draft back when the sign-in came back without its page', async () => {
    // The provider's round trip loses the hash: the console comes back on
    // `#/` and must open the draft's page before restoring its form (#330).
    saveDraft({
      at: Date.now(),
      user: 'uid=admin,ou=users,dc=example,dc=com',
      page: 'users',
      entity: 'users',
      values: { displayName: ['Hélène Lefèvre'] },
      cleared: [],
    });
    const mounted = await mountConsole({ hash: '' });
    await drawn(mounted.root);
    expect(window.location.hash).to.equal('#/users');
    expect(panelOf(mounted.root).panel.hidden).to.be.false;
    expect(
      panelOf(mounted.root).body.querySelector<HTMLInputElement>(
        '#dc-field-displayName'
      )?.value
    ).to.equal('Hélène Lefèvre');
    expect(kept()).to.equal(null);
  });

  it('should not ask before leaving when the session ended and the page reloads', async () => {
    const mounted = await newUser();
    const asked = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(asked);
    expect(asked.defaultPrevented).to.equal(true);

    mounted.endSession();
    const reloading = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(reloading);
    expect(reloading.defaultPrevented).to.equal(false);
  });

  it('should forget the draft when its form is cancelled', async () => {
    const mounted = await newUser();
    mounted.server
      .post('/api/v1/ldap/users')
      .reply(401, { error: 'No authenticated user' });
    save(mounted.root);
    await until(() => toast(mounted.root) !== '');
    mounted.endSession();
    await until(() => kept() !== null);
    click(panelOf(mounted.root).body, '[data-cancel]');
    // The form holds changes: leaving is asked, and confirmed.
    await until(
      () => !!panelOf(mounted.root).body.querySelector('[data-discard]')
    );
    click(panelOf(mounted.root).body, '[data-discard-confirm]');
    expect(panelOf(mounted.root).panel.hidden).to.be.true;
    expect(kept()).to.equal(null);
  });

  it('should forget the draft once the entry is saved', async () => {
    const mounted = await newUser();
    // A draft kept by an earlier reload, its form open again and saved now.
    saveDraft({
      at: Date.now(),
      page: 'users',
      entity: 'users',
      values: { displayName: ['Hélène Lefèvre'] },
      cleared: [],
    });
    mounted.server.post('/api/v1/ldap/users').reply(201, {});
    save(mounted.root);
    await until(() => kept() === null);
    await settled(mounted.root);
  });
});
