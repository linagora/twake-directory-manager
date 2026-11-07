import { expect } from 'chai';
import { EntityForm, pointerFallback } from '../../src/components/EntityForm';
import type { FormDraft } from '../../src/components/formDraft';
import { Translator } from '../../src/i18n';
import type {
  EntityDescriptor,
  EntitySchema,
  Entry,
  ExternalMembers,
  SchemaAttribute,
} from '../../src/types';
import { type as typeInto } from '../support/act';
import { stubContainer } from '../support/stubs';
import {
  usersSchema,
  users,
  groups,
  mailboxTypes,
  staff,
} from '../fixtures/entities';

describe('EntityForm', () => {
  const build = (entry?: Record<string, string | string[]>): EntityForm =>
    new EntityForm({
      entity: users,
      entry,
      translator: new Translator('en'),
      pointerOptions: () => Promise.resolve([]),
      onSubmit: () => Promise.resolve(),
      onCancel: () => undefined,
    });

  describe('a draft kept across a sign-in again', () => {
    const alice: Entry = {
      uid: 'alice',
      cn: 'Alice Moreau',
      mail: 'alice@example.com',
      telephoneNumber: '555 1234',
    };

    /** Alice's form, its fields drawn in the page. */
    const editing = async (options: {
      draft?: FormDraft;
      notice?: string;
    }): Promise<{ form: EntityForm; container: HTMLElement }> => {
      const container = document.createElement('div');
      document.body.append(container);
      const form = new EntityForm({
        entity: users,
        entry: alice,
        translator: new Translator('en'),
        pointerOptions: () => Promise.resolve([]),
        onSubmit: () => Promise.resolve(),
        onCancel: () => undefined,
        ...options,
      });
      await form.render(container);
      return { form, container };
    };

    it('should keep the fields changed and those emptied, never a password', async () => {
      const { form, container } = await editing({});
      typeInto(container.querySelector('#dc-field-cn'), 'Alice Duval');
      typeInto(container.querySelector('#dc-field-telephoneNumber'), '');
      typeInto(container.querySelector('#dc-field-userPassword'), 'Typed-1!');
      expect(form.draft()).to.deep.equal({
        values: { cn: ['Alice Duval'] },
        cleared: ['telephoneNumber'],
      });
    });

    it('should put a draft back, say so, and leave a password out', async () => {
      const { form, container } = await editing({
        draft: {
          values: { cn: ['Alice Duval'], userPassword: ['Draft-1!'] },
          cleared: ['telephoneNumber'],
        },
        notice: 'Draft restored after signing in again',
      });
      const value = (name: string): string =>
        container.querySelector<HTMLInputElement>(`#dc-field-${name}`)?.value ??
        '';
      expect(value('cn')).to.equal('Alice Duval');
      expect(value('telephoneNumber')).to.equal('');
      expect(value('userPassword')).to.equal('');
      expect(container.querySelector('.dc-form-notice')?.textContent).to.equal(
        'Draft restored after signing in again'
      );
      // Something to save: the reader is to check it first.
      expect(form.isDirty()).to.be.true;
    });
  });

  it('should show a field’s help to the keyboard, and hide it on Escape without closing the form', async () => {
    // The "?" was a span shown on hover only: a keyboard user never saw the
    // help, and Escape closed the whole form (#216).
    const container = document.createElement('div');
    document.body.append(container);
    const helped: EntityDescriptor = {
      ...users,
      schema: {
        attributes: {
          uid: { type: 'string', role: 'identifier', required: true },
          employeeNumber: {
            type: 'string',
            label: { en: 'Employee ID' },
            help: { en: 'The number HR knows the person by' },
          },
        },
      },
    };
    await new EntityForm({
      entity: helped,
      translator: new Translator('en'),
      pointerOptions: () => Promise.resolve([]),
      onSubmit: () => Promise.resolve(),
      onCancel: () => undefined,
    }).render(container);
    const help = container.querySelector<HTMLElement>('button.dc-help');
    const tip = container.querySelector<HTMLElement>('#dc-help-employeeNumber');
    if (!help || !tip) throw new Error('no help');
    expect(help.getAttribute('aria-label')).to.equal('Help on Employee ID');
    expect(help.getAttribute('aria-describedby')).to.equal(
      'dc-help-employeeNumber'
    );
    expect(
      container
        .querySelector('#dc-field-employeeNumber')
        ?.getAttribute('aria-describedby')
    ).to.equal('dc-help-employeeNumber');
    const escape = (): KeyboardEvent => {
      const event = new KeyboardEvent('keydown', {
        key: 'Escape',
        cancelable: true,
        bubbles: true,
      });
      help.dispatchEvent(event);
      return event;
    };
    help.focus();
    // Pressed, shown; pressed again, hidden although the focus stays
    help.click();
    expect(help.getAttribute('aria-expanded')).to.equal('true');
    help.click();
    expect(help.getAttribute('aria-expanded')).to.equal('false');
    expect(tip.classList.contains('dc-dismissed')).to.equal(true);
    // Nothing shown: the Escape is the panel's
    expect(escape().defaultPrevented).to.equal(false);
    // Shown (pressed open), Escape hides it and is spent
    help.dispatchEvent(new Event('blur'));
    expect(tip.classList.contains('dc-dismissed')).to.equal(false);
    help.focus();
    help.click();
    expect(help.getAttribute('aria-expanded')).to.equal('true');
    expect(escape().defaultPrevented).to.equal(true);
    expect(tip.classList.contains('dc-dismissed')).to.equal(true);
    expect(help.getAttribute('aria-expanded')).to.equal('false');
    // A second Escape, with nothing left to hide, closes the form
    expect(escape().defaultPrevented).to.equal(false);
  });

  it('should tell a changed form from one only opened', async () => {
    const container = document.createElement('div');
    document.body.append(container);
    const form = new EntityForm({
      entity: users,
      entry: { uid: 'alice', cn: 'Alice' },
      translator: new Translator('en'),
      pointerOptions: () => Promise.resolve([]),
      onSubmit: () => Promise.resolve(),
      onCancel: () => undefined,
    });
    await form.render(container);
    expect(form.isDirty()).to.be.false;
    typeInto(
      container.querySelector<HTMLInputElement>('#dc-field-cn'),
      'Alice Moreau'
    );
    expect(form.isDirty()).to.be.true;
  });

  it('should group named fields in a fieldset, and the rest in a plain block', async () => {
    // A fieldset with no legend was announced as a group with no name (#211).
    const grouped: EntityDescriptor = {
      ...users,
      schema: {
        attributes: {
          uid: { type: 'string', role: 'identifier', required: true },
          description: {
            type: 'string',
            required: true,
            group: { en: 'Details', fr: 'Détails' },
          },
        },
      },
    };
    const container = stubContainer();
    await new EntityForm({
      entity: grouped,
      translator: new Translator('en'),
      pointerOptions: () => Promise.resolve([]),
      onSubmit: () => Promise.resolve(),
      onCancel: () => undefined,
    }).render(container);
    const html = container.innerHTML;
    expect(html)
      .to.include('<div class="dc-form-group">')
      .and.include('<fieldset class="dc-form-group"><legend>Details</legend>');
    expect(html.match(/<fieldset/g)).to.have.length(1);
  });

  it('should say what an empty password does, on creating only', async () => {
    // Left empty, it gave an account nobody could sign in to (#164).
    const passworded: EntityDescriptor = {
      ...users,
      schema: {
        attributes: {
          ...usersSchema.attributes,
          userPassword: { type: 'string', role: 'password' },
        },
      },
    };
    const render = async (entry?: Entry): Promise<string> => {
      const container = stubContainer();
      await new EntityForm({
        entity: passworded,
        entry,
        translator: new Translator('en'),
        pointerOptions: () => Promise.resolve([]),
        onSubmit: () => Promise.resolve(),
        onCancel: () => undefined,
      }).render(container);
      return container.innerHTML;
    };
    const hint =
      'Leave empty to generate one: it is shown once the account is created';
    expect(await render()).to.include(hint);
    expect(await render({ uid: 'alice' })).to.not.include(hint);
  });

  it('should hint a size in the console’s words, and no DN under a search', async () => {
    // "xGB, xMB, xKB" is a notation, not an example, and the members are
    // searched by name: nobody is asked to type a DN (#171).
    const render = async (
      entity: EntityDescriptor,
      language: string,
      memberSearch?: () => Promise<{ dn: string; label: string }[]>
    ): Promise<string> => {
      const container = stubContainer();
      await new EntityForm({
        entity,
        translator: new Translator(language),
        pointerOptions: () => Promise.resolve([]),
        memberSearch: memberSearch && (() => memberSearch),
        onSubmit: () => Promise.resolve(),
        onCancel: () => undefined,
      }).render(container);
      return container.innerHTML;
    };
    const sized: EntityDescriptor = {
      ...users,
      schema: {
        attributes: {
          ...usersSchema.attributes,
          mailQuotaSize: {
            type: 'number',
            normalize: 'byteSize',
            hint: {
              en: 'Expected pattern xGB, xMB, xKB or a number of bytes',
              fr: "Format attendu : xGB, xMB, xKB ou un nombre d'octets",
            },
          },
        },
      },
    };
    expect(await render(sized, 'en'))
      .to.include(
        '<p class="dc-hint" id="dc-hint-mailQuotaSize" data-hint>A size such as 4 GB, 500 MB or 100 KB</p>'
      )
      .and.not.include('xGB');
    expect(await render(sized, 'fr')).to.include(
      'Une taille telle que 4 Go, 500 Mo ou 100 Ko'
    );
    const hinted: EntityDescriptor = {
      ...groups,
      schema: {
        attributes: {
          ...groups.schema.attributes,
          member: {
            ...groups.schema.attributes.member,
            hint: 'Expected the DN of an entry of this directory',
          },
        },
      },
    };
    const searched = await render(hinted, 'en', () => Promise.resolve([]));
    expect(searched).to.include('data-picker="member"');
    expect(searched).to.not.include('Expected the DN');
  });

  it('should show and send a size in the interface units', async () => {
    // French shows 4,5 Go on the card; the form showed and refused GB, so
    // the administrator could not type back what they read (#269).
    const quota: EntityDescriptor = {
      ...users,
      schema: {
        attributes: {
          uid: usersSchema.attributes.uid,
          mailQuotaSize: {
            type: 'number',
            normalize: 'byteSize',
            label: { en: 'Mailbox size', fr: 'Taille de boîte' },
          },
        },
      },
    };
    let sent: Record<string, string | string[]> | undefined;
    const container = document.createElement('div');
    document.body.append(container);
    await new EntityForm({
      entity: quota,
      entry: { uid: 'bob', mailQuotaSize: '4500000000' },
      translator: new Translator('fr'),
      pointerOptions: () => Promise.resolve([]),
      onSubmit: values => {
        sent = values;
        return Promise.resolve();
      },
      onCancel: () => undefined,
    }).render(container);
    const size = container.querySelector<HTMLInputElement>(
      '#dc-field-mailQuotaSize'
    );
    if (!size) throw new Error('no size');
    expect(size.value).to.equal('4,5 Go');
    // Typed back as the reader read it: the server reads bytes, not Go.
    size.value = '4,5 Go';
    size.dispatchEvent(new Event('input', { bubbles: true }));
    size.dispatchEvent(new Event('change', { bubbles: true }));
    container.querySelector<HTMLElement>('form button[type="submit"]')?.click();
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(sent?.mailQuotaSize).to.equal('4500000000');
  });

  it('should describe a field by its hint, so a screen reader hears the format', async () => {
    // Hints were only visual: the format a field expects was heard once the
    // field had been refused, not when it got the focus (#268).
    const described: EntityDescriptor = {
      ...users,
      schema: {
        attributes: {
          ...usersSchema.attributes,
          mail: {
            ...usersSchema.attributes.mail,
            hint: { en: 'Expected an email address' },
          },
          mailQuotaSize: {
            type: 'number',
            normalize: 'byteSize',
            hint: { en: 'Expected pattern xGB, xMB, xKB or a number of bytes' },
          },
          twakeDeletionDate: {
            type: 'date',
            hint: { en: 'Expected a date not earlier than today' },
          },
          employeeNumber: {
            type: 'string',
            label: { en: 'Employee ID' },
            help: { en: 'The number HR knows the person by' },
            hint: { en: 'A number HR assigned' },
          },
        },
      },
    };
    const container = document.createElement('div');
    document.body.append(container);
    await new EntityForm({
      entity: described,
      translator: new Translator('en'),
      pointerOptions: () => Promise.resolve([]),
      onSubmit: () => Promise.resolve(),
      onCancel: () => undefined,
    }).render(container);
    const describedBy = (name: string): string =>
      container
        .querySelector(`#dc-field-${name}`)
        ?.getAttribute('aria-describedby') ?? '';
    for (const name of [
      'mail',
      'userPassword',
      'mailQuotaSize',
      'twakeDeletionDate',
    ])
      expect(describedBy(name)).to.include(`dc-hint-${name}`);
    // A field with help is described by both, in the order it reads.
    expect(describedBy('employeeNumber')).to.equal(
      'dc-hint-employeeNumber dc-help-employeeNumber'
    );
    expect(
      container.querySelector('#dc-hint-userPassword')?.textContent
    ).to.equal(
      'Leave empty to generate one: it is shown once the account is created'
    );
    expect(
      container.querySelector('#dc-hint-mailQuotaSize')?.textContent
    ).to.equal('A size such as 4 GB, 500 MB or 100 KB');
    expect(
      container.querySelector('#dc-hint-twakeDeletionDate')?.textContent
    ).to.equal('Expected a date not earlier than today');
  });

  it('should refuse a size and a past expiry before sending, both at once', async () => {
    // Neither carries a pattern: their rules are the server's, which
    // refused them one per round trip, in a toast away from the field.
    const lifecycle: EntityDescriptor = {
      ...users,
      schema: {
        attributes: {
          ...usersSchema.attributes,
          // The department is not what this test is about.
          twakeDepartmentLink: {
            ...usersSchema.attributes.twakeDepartmentLink,
            required: false,
          },
          mailQuotaSize: {
            type: 'number',
            normalize: 'byteSize',
            hint: 'Expected pattern xGB, xMB, xKB or a number of bytes',
          },
          twakeDeletionDate: { type: 'date', role: 'accountExpiry' },
        },
      },
    };
    const now = new Date();
    const today = `${now.getUTCFullYear()}${String(
      now.getUTCMonth() + 1
    ).padStart(2, '0')}${String(now.getUTCDate()).padStart(2, '0')}`;
    let sent = 0;
    /** The form drawn in the page, its field typed into like a reader's. */
    const drawn = async (entry?: Entry) => {
      const container = document.createElement('div');
      document.body.append(container);
      await new EntityForm({
        entity: lifecycle,
        entry,
        translator: new Translator('en'),
        pointerOptions: () => Promise.resolve([]),
        onSubmit: () => {
          sent++;
          return Promise.resolve();
        },
        onCancel: () => undefined,
      }).render(container);
      const type = (name: string, value: string): void => {
        const input = container.querySelector<HTMLInputElement>(
          `#dc-field-${name}`
        );
        if (!input) throw new Error(`no ${name}`);
        input.value = value;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
      };
      const save = async (): Promise<void> => {
        container
          .querySelector<HTMLElement>('form button[type="submit"]')
          ?.click();
        await new Promise(resolve => setTimeout(resolve, 0));
      };
      const error = (name: string): HTMLElement | null =>
        container.querySelector<HTMLElement>(
          `[data-field="${name}"] [data-error]`
        );
      return { container, type, save, error };
    };

    const created = await drawn();
    created.type('cn', 'Va Val');
    created.type('mail', 'va.val@example.com');
    created.type('mailQuotaSize', 'lots');
    created.type('twakeDeletionDate', '2020-10-08');
    await created.save();
    expect(sent).to.equal(0);
    // Said with examples, not by repeating the hint shown before.
    expect(created.error('mailQuotaSize')?.hidden).to.equal(false);
    expect(created.error('mailQuotaSize')?.textContent).to.equal(
      'Expected a size such as 4 GB, 500 MB or 100 KB, or a number of bytes'
    );
    expect(created.error('twakeDeletionDate')?.textContent).to.equal(
      'Expected a date not earlier than today'
    );

    created.type('mailQuotaSize', '4 GB');
    created.type('twakeDeletionDate', today);
    await created.save();
    expect(created.error('mailQuotaSize')?.hidden).to.equal(true);
    expect(created.error('twakeDeletionDate')?.hidden).to.equal(true);
    expect(sent).to.equal(1);

    // A date already stored is not sent back, and not judged again.
    const edited = await drawn({
      uid: 'va.val',
      cn: 'Va Val',
      mail: 'va.val@example.com',
      twakeDeletionDate: '20201008000000Z',
    });
    await edited.save();
    expect(sent).to.equal(2);
  });

  describe('a person’s names', () => {
    const people: EntityDescriptor = {
      ...users,
      schema: {
        attributes: {
          ...usersSchema.attributes,
          // The fixture's cn stands for the full name; here displayName does.
          cn: { type: 'string', required: true },
          employeeNumber: {
            type: 'string',
            required: true,
            help: {
              en: 'The number HR knows the person by',
              fr: 'Matricule',
            },
          },
          givenName: { type: 'string', role: 'givenName' },
          sn: { type: 'string', role: 'surname' },
          displayName: { type: 'string', role: 'displayName' },
        },
      },
    };
    /** The form drawn in the page, its fields typed into as a reader does. */
    const drawn = async (
      entry?: Entry,
      fullNameFormat?: string
    ): Promise<{
      container: HTMLElement;
      form: EntityForm;
      type(name: string, value: string): void;
      value(name: string): string;
    }> => {
      const container = document.createElement('div');
      document.body.append(container);
      const form = new EntityForm({
        entity: people,
        entry,
        fullNameFormat,
        translator: new Translator('en'),
        pointerOptions: () => Promise.resolve([]),
        onSubmit: () => Promise.resolve(),
        onCancel: () => undefined,
      });
      await form.render(container);
      const field = (name: string): HTMLInputElement => {
        const found = container.querySelector<HTMLInputElement>(
          `#dc-field-${name}`
        );
        if (!found) throw new Error(`no ${name}`);
        return found;
      };
      return {
        container,
        form,
        type: (name, value) => typeInto(field(name), value),
        value: name => field(name).value,
      };
    };

    it('should write the full name once both parts are typed', async () => {
      const page = await drawn();
      page.type('givenName', 'Bat');
      expect(page.value('displayName')).to.equal('');
      page.type('sn', 'Dorj ');
      expect(page.value('displayName')).to.equal('Bat Dorj');
      expect(page.form.draft().values.displayName).to.deep.equal(['Bat Dorj']);
      page.type('givenName', 'Bataa');
      expect(page.value('displayName')).to.equal('Bataa Dorj');
    });

    it('should write it in the deployment’s order', async () => {
      const page = await drawn(undefined, '{surname} {givenName}');
      page.type('givenName', 'Bat');
      page.type('sn', 'Dorj');
      expect(page.value('displayName')).to.equal('Dorj Bat');
    });

    it('should leave alone a full name someone wrote', async () => {
      const page = await drawn();
      page.type('displayName', 'The boss');
      page.type('givenName', 'Bat');
      page.type('sn', 'Dorj');
      expect(page.value('displayName')).to.equal('The boss');
      // Emptied, it follows again.
      page.type('displayName', '');
      page.type('sn', 'Dorjiin');
      expect(page.value('displayName')).to.equal('Bat Dorjiin');
    });

    it('should write the common name from the full name, on a new entry', async () => {
      // The member pickers match names through cn: an account created
      // with none was not found by its full name.
      const page = await drawn();
      page.type('givenName', 'Ux');
      page.type('sn', 'Audit');
      expect(page.value('cn')).to.equal('Ux Audit');
      expect(page.form.draft().values.cn).to.deep.equal(['Ux Audit']);
      // The full name typed whole is followed too.
      page.type('displayName', 'Dr Ux Audit');
      expect(page.value('cn')).to.equal('Dr Ux Audit');
      // A common name typed by hand is kept.
      page.type('cn', 'ux');
      page.type('sn', 'Auditor');
      page.type('displayName', 'Ux Auditor');
      expect(page.value('cn')).to.equal('ux');
    });

    it('should leave an entry’s common name alone', async () => {
      const page = await drawn({
        uid: 'bat',
        givenName: 'Bat',
        sn: 'Dorj',
        displayName: 'Bat Dorj',
      });
      page.type('sn', 'Bold');
      expect(page.value('displayName')).to.equal('Bat Bold');
      expect(page.value('cn')).to.equal('');
    });

    it('should carry along the full name of an entry its parts made', async () => {
      const entry = { uid: 'bat', givenName: 'Bat', sn: 'Dorj' };
      const made = await drawn({ ...entry, displayName: 'Bat Dorj' });
      made.type('sn', 'Bold');
      expect(made.value('displayName')).to.equal('Bat Bold');

      const chosen = await drawn({ ...entry, displayName: 'Dr Bat' });
      chosen.type('sn', 'Bold');
      expect(chosen.value('displayName')).to.equal('Dr Bat');
    });

    it('should explain a field on demand', async () => {
      const page = await drawn();
      // A button the keyboard reaches, named after the field (#216); the
      // panel's first focus skips it.
      expect(page.container.innerHTML).to.match(
        /<button type="button" class="dc-help" aria-label="Help on Employee Number"\s+aria-describedby="dc-help-employeeNumber" aria-expanded="false">\?<\/button>/
      );
      expect(page.container.innerHTML).to.match(
        /<span class="dc-tooltip" role="tooltip" id="dc-help-employeeNumber">The number HR knows the person by<\/span>/
      );
      // No help, no button.
      expect(page.container.innerHTML).not.to.include('dc-help-sn');
    });
  });

  describe('a long form creating an entry', () => {
    /** Users with the address fields of a real schema: past a modal's worth. */
    const located: EntityDescriptor = {
      ...users,
      schema: {
        attributes: {
          ...usersSchema.attributes,
          postalAddress: { type: 'string' },
          postalCode: { type: 'string' },
          l: { type: 'string', group: { en: 'Address', fr: 'Adresse' } },
          mailQuotaSize: {
            type: 'number',
            role: 'emailQuotaSize',
            group: { en: 'Mailbox', fr: 'Messagerie' },
          },
          twakeDelegatedUsers: {
            type: 'array',
            items: { type: 'string' },
            group: { en: 'Mailbox', fr: 'Messagerie' },
          },
        },
      },
    };
    const form = (entity: EntityDescriptor, entry?: Entry): EntityForm =>
      new EntityForm({
        entity,
        entry,
        translator: new Translator('en'),
        pointerOptions: () => Promise.resolve([]),
        onSubmit: () => Promise.resolve(),
        onCancel: () => undefined,
      });

    it('should fold what the schema does not require below what it does', async () => {
      const container = stubContainer();
      await form(located).render(container);
      const html = container.innerHTML;
      const fold = html.indexOf('<details');
      expect(fold).to.be.above(0);
      expect(html).to.include('Optional fields (5)');
      // Not required, but an account is created with its mailbox and its
      // password; and the quota's group is not split.
      for (const name of [
        'cn',
        'mail',
        'twakeDepartmentLink',
        'userPassword',
        'mailQuotaSize',
        'twakeDelegatedUsers',
      ])
        expect(html.indexOf(`data-field="${name}"`)).to.be.within(0, fold);
      for (const name of [
        'mailAlternateAddress',
        'telephoneNumber',
        'postalAddress',
        'postalCode',
        'l',
      ])
        expect(html.indexOf(`data-field="${name}"`)).to.be.above(fold);
      // The schema's groups are kept inside the fold.
      expect(html.indexOf('<legend>Address</legend>')).to.be.above(fold);
    });

    it('should fold nothing when editing, nor in a short form', async () => {
      const edited = stubContainer();
      await form(located, { uid: 'va.val', cn: 'Va Val' }).render(edited);
      expect(edited.innerHTML).not.to.include('<details');
      const short = stubContainer();
      await form(users).render(short);
      expect(short.innerHTML).not.to.include('<details');
    });

    it('should open the fold on a refusal it hides, and show the first one', async () => {
      // A refusal folded out of sight, the form refused to save without a
      // word of why.
      const container = document.createElement('div');
      document.body.append(container);
      await form(located).render(container);
      const fold =
        container.querySelector<HTMLDetailsElement>('[data-optional]');
      if (!fold) throw new Error('no fold');
      expect(fold.open).to.equal(false);
      // Typed in a field the fold hides, where only a refusal shows it.
      const telephone = container.querySelector<HTMLInputElement>(
        '#dc-field-telephoneNumber'
      );
      if (!telephone) throw new Error('no telephone');
      telephone.value = '12';
      telephone.dispatchEvent(new Event('input', { bubbles: true }));
      telephone.dispatchEvent(new Event('change', { bubbles: true }));
      container
        .querySelector<HTMLElement>('form button[type="submit"]')
        ?.click();
      await new Promise(resolve => setTimeout(resolve, 0));
      expect(fold.open).to.equal(true);
      expect(
        container.querySelector<HTMLElement>('#dc-error-telephoneNumber')
          ?.hidden
      ).to.equal(false);
      // The required fields are shown first, and refused first: the focus
      // is on the first of them, not left on the Create button.
      expect(document.activeElement).to.equal(
        container.querySelector('#dc-field-cn')
      );
    });

    it('should mark a refused field invalid, described by its message, and focus it', async () => {
      const container = document.createElement('div');
      document.body.append(container);
      const created = form(located);
      await created.render(container);
      const control = (name: string): HTMLInputElement => {
        const found = container.querySelector<HTMLInputElement>(
          `#dc-field-${name}`
        );
        if (!found) throw new Error(`no ${name}`);
        return found;
      };
      const type = (name: string, value: string): void => {
        const found = control(name);
        found.value = value;
        found.dispatchEvent(new Event('input', { bubbles: true }));
        found.dispatchEvent(new Event('change', { bubbles: true }));
      };
      const save = async (): Promise<void> => {
        container
          .querySelector<HTMLElement>('form button[type="submit"]')
          ?.click();
        await new Promise(resolve => setTimeout(resolve, 0));
      };
      const mail = control('mail');
      const error = container.querySelector<HTMLElement>('#dc-error-mail');
      const hint = container.querySelector<HTMLElement>('#dc-hint-mail');
      // The hint describes the field before anything is refused.
      expect(mail.getAttribute('aria-describedby')).to.contain('dc-hint-mail');

      type('cn', 'Jane');
      type('mail', 'not-an-email');
      await save();
      expect(mail.getAttribute('aria-invalid')).to.equal('true');
      expect(mail.getAttribute('aria-describedby')).to.equal(
        'dc-hint-mail dc-identifier-mail dc-error-mail'
      );
      expect(error?.hidden).to.equal(false);
      expect(error?.textContent).to.equal('Expected an email address');
      // The refusal says what the hint said, once, in red.
      expect(hint?.hidden).to.equal(true);
      // The first refused field has the focus, not the Create button.
      expect(document.activeElement).to.equal(mail);
      expect(control('cn').getAttribute('aria-invalid')).to.equal(null);

      // Corrected, a field is no longer invalid, and keeps its hint.
      type('mail', 'jane@example.com');
      await save();
      expect(mail.getAttribute('aria-invalid')).to.equal(null);
      expect(mail.getAttribute('aria-describedby')).to.equal(
        'dc-hint-mail dc-identifier-mail'
      );
      expect(error?.hidden).to.equal(true);
      expect(hint?.hidden).to.equal(false);

      // The server's refusal of a field is shown the same way.
      expect(
        created.refuse(
          'MAIL',
          'Email “jane@example.com” is already used by another entry.'
        )
      ).to.equal(true);
      expect(error?.hidden).to.equal(false);
      expect(error?.textContent).to.equal(
        'Email “jane@example.com” is already used by another entry.'
      );
      expect(mail.getAttribute('aria-describedby')).to.equal(
        'dc-hint-mail dc-identifier-mail dc-error-mail'
      );
      expect(mail.getAttribute('aria-invalid')).to.equal('true');
      expect(document.activeElement).to.equal(mail);
      expect(control('cn').getAttribute('aria-invalid')).to.equal(null);
      // A field the form does not hold is left to the toast.
      expect(created.refuse('employeeNumber', 'Taken')).to.equal(false);
    });
  });

  it('should offer a search, not a select, for a pointer into a large branch', async () => {
    const delegates = {
      ...users,
      schema: {
        ...users.schema,
        attributes: {
          ...users.schema.attributes,
          twakeDelegatedUsers: {
            type: 'array' as const,
            items: {
              type: 'pointer',
              branch: ['ou=users,dc=example,dc=com'],
            },
          },
        },
      },
    };
    let asked = '';
    const container = stubContainer();
    await new EntityForm({
      entity: delegates,
      entry: {
        uid: 'bob',
        twakeDelegatedUsers: ['uid=alice,ou=users,dc=example,dc=com'],
      },
      translator: new Translator('en'),
      pointerOptions: () => Promise.resolve([]),
      pointerSearch: branch => {
        asked = branch;
        return () => Promise.resolve([]);
      },
      onSubmit: () => Promise.resolve(),
      onCancel: () => undefined,
    }).render(container);
    expect(asked).to.equal('ou=users,dc=example,dc=com');
    expect(container.innerHTML).to.include('data-picker="twakeDelegatedUsers"');
    expect(container.innerHTML).to.include('Type 3 characters to search');
    // The value held is shown by its RDN, not as a DN.
    expect(container.innerHTML).to.include('>alice</span>');
  });

  const held = 'ou=Demo,dc=example,dc=com';

  /** A form with a pointer select, drawn in the page. */
  const drawnPointer = async (
    entry: Entry,
    pointerOptions: () => Promise<{ dn: string; label: string }[]>,
    entity: EntityDescriptor = users,
    name = 'twakeDepartmentLink'
  ): Promise<{ container: HTMLElement; select: HTMLSelectElement }> => {
    const container = document.createElement('div');
    document.body.append(container);
    await new EntityForm({
      entity,
      entry,
      translator: new Translator('en'),
      pointerOptions,
      onSubmit: () => Promise.resolve(),
      onCancel: () => undefined,
    }).render(container);
    const select = container.querySelector<HTMLSelectElement>(
      `select#dc-field-${name}`
    );
    if (!select) throw new Error(`no select for ${name}`);
    return { container, select };
  };

  it('should keep a pointer inert until its candidates are known', async () => {
    // A click meant to open the list would otherwise take the empty choice
    // and clear the organization the entry holds.
    let answer: (options: { dn: string; label: string }[]) => void = () =>
      undefined;
    const container = document.createElement('div');
    document.body.append(container);
    const rendering = new EntityForm({
      entity: users,
      entry: { uid: 'bob', twakeDepartmentLink: [held] },
      translator: new Translator('en'),
      pointerOptions: () => new Promise(resolve => (answer = resolve)),
      onSubmit: () => Promise.resolve(),
      onCancel: () => undefined,
    }).render(container);
    const select = container.querySelector<HTMLSelectElement>(
      'select#dc-field-twakeDepartmentLink'
    );
    if (!select) throw new Error('no select');
    expect(select.disabled).to.equal(true);
    expect(select.getAttribute('aria-busy')).to.equal('true');
    expect(select.dataset.required).to.equal('true');
    expect(select.innerHTML).to.match(/<option value="" disabled(="")?>/);
    answer([]);
    await rendering;
  });

  it('should not offer the empty choice on a required field', async () => {
    const { select } = await drawnPointer(
      { uid: 'bob', twakeDepartmentLink: [held] },
      () => Promise.resolve([{ dn: held, label: 'Demo' }])
    );
    // The form refuses to save without it: a choice that cannot be taken is
    // not offered.
    expect(select.disabled).to.equal(false);
    expect(select.innerHTML).to.match(/<option value="" disabled(="")?>/);
    expect(select.innerHTML).to.include('>Demo</option>');
    expect(select.value).to.equal(held);
  });

  it('should offer the empty choice on an optional field', async () => {
    const optional: EntityDescriptor = {
      ...users,
      schema: {
        ...users.schema,
        attributes: {
          ...users.schema.attributes,
          title: { type: 'pointer' as const, branch: ['dc=example,dc=com'] },
        },
      },
    };
    const { select } = await drawnPointer(
      { uid: 'bob', title: [held] },
      () => Promise.resolve([{ dn: held, label: 'Demo' }]),
      optional,
      'title'
    );
    expect(select.disabled).to.equal(false);
    // The empty choice is there and carries no `disabled`: taking it is a
    // real choice, and how the value an entry holds is cleared.
    expect(select.innerHTML).to.include('<option value="">');
    expect(select.innerHTML).to.include('>Demo</option>');
    expect(select.value).to.equal(held);
  });

  it('should keep the value of a branch that answered nothing', async () => {
    const { select } = await drawnPointer(
      { uid: 'bob', twakeDepartmentLink: [held] },
      () =>
        Promise.reject(Object.assign(new Error('Forbidden'), { status: 403 }))
    );
    // Nothing to choose: the empty choice cannot be taken, and the value the
    // directory holds stays selected rather than being silently dropped.
    expect(select.disabled).to.equal(false);
    expect(select.innerHTML).to.match(/<option value="" disabled(="")?>/);
    expect(select.innerHTML).to.include(`${held}" selected`);
    expect(select.value).to.equal(held);
  });

  /** The picker of a field drawn in the page. */
  const picker = (
    container: HTMLElement,
    field = 'twakeDelegatedUsers'
  ): HTMLInputElement => {
    const found = container.querySelector<HTMLInputElement>(
      `[data-field="${field}"] [data-picker-input]`
    );
    if (!found) throw new Error(`no picker for ${field}`);
    return found;
  };
  /** The names of the values a picker holds, as the field shows them. */
  const shownValues = (
    container: HTMLElement,
    field = 'twakeDelegatedUsers'
  ): (string | null)[] =>
    Array.from(
      container.querySelectorAll(
        `[data-field="${field}"] .dc-token-list .dc-token span`
      )
    ).map(span => span.textContent);
  /** Type a search into a picker, and wait for the answer it draws. */
  const search = async (
    container: HTMLElement,
    text: string,
    field = 'twakeDelegatedUsers'
  ): Promise<void> => {
    typeInto(picker(container, field), text);
    await new Promise(resolve => setTimeout(resolve, 300));
  };
  /** Take the offer the picker shows first, as Enter does. */
  const take = (
    container: HTMLElement,
    field = 'twakeDelegatedUsers'
  ): void => {
    picker(container, field).dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Enter',
        bubbles: true,
        cancelable: true,
      })
    );
  };
  /** What the picker offers, or says in place of an offer. */
  const offered = (
    container: HTMLElement,
    field = 'twakeDelegatedUsers'
  ): string =>
    container.querySelector<HTMLElement>(
      `[data-field="${field}"] .dc-picker-results`
    )?.innerHTML ?? '';

  it('should add a second choice to a multi-valued pointer, not replace the first', async () => {
    // The picker read "multiple" from the field element, which never
    // carried it: choosing a second delegate dropped the first.
    const alice = 'uid=alice,ou=users,dc=example,dc=com';
    const jane = 'uid=jane,ou=users,dc=example,dc=com';
    const container = document.createElement('div');
    document.body.append(container);
    await new EntityForm({
      entity: {
        ...users,
        schema: {
          attributes: {
            uid: users.schema.attributes.uid,
            twakeDelegatedUsers: {
              type: 'array',
              items: { type: 'pointer', branch: [users.base as string] },
            },
          },
        },
      },
      entry: { uid: 'bob', twakeDelegatedUsers: [alice] },
      translator: new Translator('en'),
      pointerOptions: () => Promise.resolve([]),
      pointerSearch: () => () => Promise.resolve([{ dn: jane, label: 'Jane' }]),
      onSubmit: () => Promise.resolve(),
      onCancel: () => undefined,
    }).render(container);
    await search(container, 'jane');
    take(container);
    expect(shownValues(container)).to.deep.equal(['alice', 'Jane']);
  });

  describe('a group’s members', () => {
    const alice = 'uid=alice,ou=users,dc=example,dc=com';
    const jane = 'uid=jane,ou=users,dc=example,dc=com';

    /** A group form drawn in the page, its member field a real picker. */
    const memberForm = async (
      search: (query: string) => Promise<{ dn: string; label: string }[]>,
      externalMembers?: ExternalMembers
    ): Promise<{ form: EntityForm; container: HTMLElement }> => {
      const container = document.createElement('div');
      document.body.append(container);
      const form = new EntityForm({
        entity: groups,
        entry: { ...staff, member: [alice] },
        translator: new Translator('en'),
        pointerOptions: () => Promise.resolve([]),
        memberSearch: role => (role === 'members' ? search : undefined),
        externalMembers,
        onSubmit: () => Promise.resolve(),
        onCancel: () => undefined,
      });
      await form.render(container);
      return { form, container };
    };
    /** Type into the member picker, and wait for its search. */
    const type = async (container: HTMLElement, text: string): Promise<void> =>
      search(container, text, 'member');
    const enter = (container: HTMLElement): void => take(container, 'member');
    const members = (container: HTMLElement): (string | null)[] =>
      shownValues(container, 'member');
    const results = (container: HTMLElement): string =>
      offered(container, 'member');

    it('should name each remove button after the member it removes', async () => {
      const { container } = await memberForm(() => Promise.resolve([]));
      expect(container.innerHTML).to.include('aria-label="Remove alice"');
      expect(container.innerHTML).to.not.include('Remove this value');
    });

    it('should find a member by email address rather than ask for a DN', async () => {
      const asked: string[] = [];
      const { container } = await memberForm(query => {
        asked.push(query);
        return Promise.resolve([
          { dn: jane, label: 'Jane Doe <jane@example.com>' },
        ]);
      });
      expect(container.innerHTML).to.include('data-picker="member"');
      // Found by name and employee ID as well, as the placeholder now says.
      expect(container.innerHTML).to.include(
        'of a name, an email address or an employee ID'
      );

      await type(container, 'jane@exa');
      enter(container);
      expect(asked).to.deep.equal(['jane@exa']);
      expect(members(container)).to.deep.equal([
        'alice',
        'Jane Doe <jane@example.com>',
      ]);
    });

    it('should take a DN typed whole, without searching it', async () => {
      let searched = false;
      const { container } = await memberForm(() => {
        searched = true;
        return Promise.resolve([]);
      });
      await type(container, ` ${jane} `);
      expect(searched).to.equal(false);
      enter(container);
      expect(members(container)).to.deep.equal(['alice', 'jane']);
      expect(picker(container, 'member').value).to.equal('');
    });

    it('should add a DN left in the box, once', async () => {
      const { container } = await memberForm(() => Promise.resolve([]));
      const input = picker(container, 'member');
      typeInto(input, jane);
      input.dispatchEvent(new Event('blur'));
      // The same DN in another case is the same member.
      typeInto(input, jane.toUpperCase());
      input.dispatchEvent(new Event('blur'));
      expect(members(container)).to.deep.equal(['alice', 'jane']);
    });

    it('should not pick a member twice in another case', async () => {
      const { container } = await memberForm(() =>
        Promise.resolve([{ dn: alice.toUpperCase(), label: 'Alice' }])
      );
      await type(container, 'alice');
      enter(container);
      expect(members(container)).to.deep.equal(['alice']);
    });

    describe('outside the directory', () => {
      const external: ExternalMembers = {
        branch: 'ou=external,dc=example,dc=com',
        rdnAttribute: 'mail',
        managedDomains: ['example.com'],
      };

      it('should offer to add an address no entry holds as an external member', async () => {
        // Only the full DN worked, which administrators do not know (#59).
        const { container } = await memberForm(
          () => Promise.resolve([]),
          external
        );
        await type(container, 'Some.One+lists@partner.org');
        expect(results(container)).to.include(
          'Add Some.One+lists@partner.org as an external member'
        );
        enter(container);
        // Escaped as a DN value: a bare `+` joins a second attribute.
        expect(members(container)).to.deep.equal([
          'alice',
          'Some.One+lists@partner.org',
        ]);
        // Named by its address, not by the offer.
        expect(container.innerHTML).to.include('Some.One+lists@partner.org<');
      });

      it('should offer the account, not an external member, for an address an entry holds', async () => {
        const { container } = await memberForm(
          () =>
            Promise.resolve([
              { dn: jane, label: 'Jane Doe <jane@partner.org>' },
            ]),
          external
        );
        await type(container, 'JANE@partner.org');
        expect(results(container)).to.include('Jane Doe');
        expect(results(container)).not.to.include('external member');
      });

      it('should say an address at a domain of the directory is an account’s', async () => {
        const { container } = await memberForm(
          () => Promise.resolve([]),
          external
        );
        await type(container, 'nobody@Example.com');
        expect(results(container)).to.include(
          'example.com is a domain of this directory: choose the account instead'
        );
        enter(container);
        expect(members(container)).to.deep.equal(['alice']);
      });

      it('should offer nothing outside when the server takes no external member', async () => {
        const { container } = await memberForm(() => Promise.resolve([]));
        await type(container, 'someone@partner.org');
        expect(results(container)).to.include('No entry matches this search');
      });
    });

    // linagora/twake-directory-manager#66: the server refuses a team
    // mailbox a member of another domain, so none is offered.
    describe('of a team mailbox', () => {
      const mailboxes: EntityDescriptor = {
        ...groups,
        schema: {
          attributes: {
            ...groups.schema.attributes,
            mail: { type: 'string', role: 'primaryEmail' },
            twakeMailboxType: {
              type: 'pointer',
              role: 'mailboxType',
              branch: [mailboxTypes.base as string],
            },
          },
        },
      };
      const team = `cn=teamMailbox,${mailboxTypes.base}`;
      const list = `cn=mailingList,${mailboxTypes.base}`;
      const external: ExternalMembers = {
        branch: 'ou=external,dc=example,dc=com',
        rdnAttribute: 'mail',
        managedDomains: ['example.com'],
      };
      const found = [
        {
          dn: jane,
          label: 'Jane Doe <jane@Example.com>',
          mail: 'jane@Example.com',
        },
        {
          dn: 'uid=bob,ou=users,dc=example,dc=com',
          label: 'Bob <bob@other.org>',
          mail: 'bob@other.org',
        },
      ];

      /** Draw a group of the mailbox type, and type a member search into it. */
      const typed = async (
        text: string,
        mailboxType: string,
        options: {
          keep?: boolean;
          answer?: { dn: string; label: string; mail?: string }[];
        } = {}
      ): Promise<{
        form: EntityForm;
        container: HTMLElement;
        html: string;
      }> => {
        const container = document.createElement('div');
        document.body.append(container);
        const form = new EntityForm({
          entity: mailboxes,
          entry: {
            ...staff,
            member: [alice],
            mail: 'sales@example.com',
            twakeMailboxType: mailboxType,
          },
          translator: new Translator('en'),
          pointerOptions: () => Promise.resolve([]),
          memberSearch: role =>
            role === 'members'
              ? () => Promise.resolve(options.answer ?? found)
              : undefined,
          externalMembers: external,
          teamMailboxesKeepDomain: options.keep ?? true,
          onSubmit: () => Promise.resolve(),
          onCancel: () => undefined,
        });
        await form.render(container);
        if (text) await type(container, text);
        return { form, container, html: results(container) };
      };

      it('should offer the accounts of its domain only', async () => {
        const { html } = await typed('jane', team);
        expect(html).to.include('Jane Doe');
        expect(html).not.to.include('bob@other.org');
      });

      it('should say why an account of another domain is not offered', async () => {
        const { html } = await typed('bob', team, {
          answer: [found[1]],
        });
        expect(html).to.include(
          'A shared mailbox at example.com only takes accounts of example.com'
        );
      });

      it('should offer no external member', async () => {
        const { container, html } = await typed('someone@partner.org', team, {
          answer: [],
        });
        expect(html).not.to.include('external member');
        expect(html).to.include('only takes accounts of example.com');
        expect(members(container)).to.deep.equal(['alice']);
      });

      it('should follow an address changed in the form', async () => {
        const { container } = await typed('', team);
        typeInto(
          container.querySelector<HTMLInputElement>('#dc-field-mail'),
          'sales@other.org'
        );
        await type(container, 'bob');
        expect(results(container)).to.include('Bob &lt;bob@other.org&gt;');
        // The accounts of the address left are no longer of its domain.
        expect(results(container)).not.to.include('Jane Doe');
      });

      it('should offer every domain, and outside, to a mailing list', async () => {
        const { html } = await typed('someone@partner.org', list, {
          answer: [],
        });
        expect(html).to.include(
          'Add someone@partner.org as an external member'
        );
        const { html: both } = await typed('anyone', list);
        expect(both).to.include('Jane Doe');
        expect(both).to.include('bob@other.org');
      });

      it('should offer every domain when the server keeps none', async () => {
        const { html } = await typed('anyone', team, { keep: false });
        expect(html).to.include('Jane Doe');
        expect(html).to.include('bob@other.org');
      });
    });

    it('should keep a plain token box when there is no search', async () => {
      const container = stubContainer();
      await new EntityForm({
        entity: groups,
        entry: staff,
        translator: new Translator('en'),
        pointerOptions: () => Promise.resolve([]),
        onSubmit: () => Promise.resolve(),
        onCancel: () => undefined,
      }).render(container);
      expect(container.innerHTML).to.include('data-tokens="member"');
    });
  });

  describe('a pointer branch that could not be listed', () => {
    const translator = new Translator('en');
    const failure = (status: number, message: string): Error =>
      Object.assign(new Error(message), { status });
    const search = (): Promise<{ dn: string; label: string }[]> =>
      Promise.resolve([]);

    it('should say nothing of a branch the caller may not read', () => {
      let asked = false;
      const fallback = pointerFallback(
        failure(403, 'Forbidden'),
        translator,
        () => {
          asked = true;
          return search;
        }
      );
      expect(fallback).to.deep.equal({});
      expect(asked).to.equal(false);
    });

    it('should explain a branch too broad to list, and offer its search', () => {
      const failed = pointerFallback(
        failure(504, 'Gateway Timeout'),
        translator,
        () => search
      );
      expect(failed.message).to.equal(
        'The list could not be loaded. If the directory holds many entries, narrow the search.'
      );
      expect(failed.search).to.equal(search);
      // The server's own failure is said in its words, and a search is no
      // answer to it.
      let asked = false;
      const broken = pointerFallback(
        failure(500, 'Internal Server Error'),
        translator,
        () => {
          asked = true;
          return search;
        }
      );
      expect(broken).to.deep.equal({
        message: 'The list could not be loaded',
      });
      expect(asked).to.equal(false);
      const refused = pointerFallback(
        failure(422, 'Size limit exceeded'),
        translator,
        () => undefined
      );
      expect(refused).to.deep.equal({
        message: 'Too many entries to show them all: narrow the search.',
        search: undefined,
      });
    });

    it('should repeat any other failure, with no search', () => {
      let asked = false;
      expect(
        pointerFallback(failure(404, 'Not found'), translator, () => {
          asked = true;
          return search;
        })
      ).to.deep.equal({ message: 'Not found' });
      expect(asked).to.equal(false);
    });

    it('should keep the select and say why it offers nothing', async () => {
      const { container, select } = await drawnPointer(
        { uid: 'bob', twakeDepartmentLink: [held] },
        () => Promise.reject(failure(504, 'Gateway Timeout'))
      );
      expect(select.disabled).to.equal(false);
      expect(select.innerHTML).to.include(`${held}" selected`);
      // The select stays, and no search replaces it.
      expect(
        container.querySelector('[data-picker="twakeDepartmentLink"]')
      ).to.equal(null);
      const note = container.querySelector<HTMLElement>(
        '#dc-note-twakeDepartmentLink'
      );
      // Shown empty at first, and filled a moment later, for a screen reader
      // to say it.
      expect(note?.hidden).to.equal(false);
      expect(note?.textContent).to.equal('');
      await new Promise(resolve => setTimeout(resolve, 150));
      expect(note?.textContent).to.equal(
        'The list could not be loaded. If the directory holds many entries, narrow the search.'
      );
      expect(select.getAttribute('aria-describedby')).to.equal(
        'dc-note-twakeDepartmentLink'
      );
    });

    it('should trade the select for a search when the branch has one', async () => {
      const container = document.createElement('div');
      document.body.append(container);
      const asked: [string, boolean | undefined][] = [];
      await new EntityForm({
        entity: users,
        entry: { uid: 'bob', twakeDepartmentLink: [held] },
        translator,
        pointerOptions: () => Promise.reject(failure(422, 'Too broad')),
        pointerSearch: (branch, failed) => {
          asked.push([branch, failed]);
          return failed ? search : undefined;
        },
        onSubmit: () => Promise.resolve(),
        onCancel: () => undefined,
      }).render(container);
      // Asked once as usual, then once more after the failure.
      expect(asked).to.deep.include(['dc=example,dc=com', true]);
      const field = container.querySelector(
        '[data-field="twakeDepartmentLink"]'
      );
      expect(field?.innerHTML).to.include('data-picker="twakeDepartmentLink"');
      // The value held is still there, as a token of the search.
      expect(field?.innerHTML).to.include('>Demo</span>');
      // The select was not filled: it is gone.
      expect(
        container.querySelector('select[data-pointer="dc=example,dc=com"]')
      ).to.equal(null);
      await new Promise(resolve => setTimeout(resolve, 150));
      expect(
        container.querySelector('#dc-note-twakeDepartmentLink')?.textContent
      ).to.equal('Too many entries to show them all: narrow the search.');
    });

    it('should remove one value per click once a token list became a search', async () => {
      // The token list listens on the field itself, which the swap keeps:
      // left alone, it removed a value on the same click as the search did.
      const alice = 'uid=alice,ou=users,dc=example,dc=com';
      const bob = 'uid=bob,ou=users,dc=example,dc=com';
      const container = document.createElement('div');
      document.body.append(container);
      await new EntityForm({
        entity: {
          ...users,
          schema: {
            attributes: {
              uid: users.schema.attributes.uid,
              twakeDelegatedUsers: {
                type: 'array',
                items: { type: 'pointer', branch: [users.base as string] },
              },
            },
          },
        },
        entry: { uid: 'bob', twakeDelegatedUsers: [alice, bob] },
        translator,
        pointerOptions: () => Promise.reject(failure(504, 'Gateway Timeout')),
        pointerSearch: (_branch, failed) => (failed ? search : undefined),
        onSubmit: () => Promise.resolve(),
        onCancel: () => undefined,
      }).render(container);
      const field = container.querySelector(
        '[data-field="twakeDelegatedUsers"]'
      );
      expect(field?.innerHTML).to.include('data-picker="twakeDelegatedUsers"');

      // One click on the first token's button, bubbling from the token
      // list up to the field.
      container
        .querySelector<HTMLElement>(
          '[data-field="twakeDelegatedUsers"] .dc-token-list [data-remove="0"]'
        )
        ?.click();
      expect(shownValues(container, 'twakeDelegatedUsers')).to.deep.equal([
        'bob',
      ]);
    });

    it('should build the form when the caller’s search throws', async () => {
      // Read as "no search": thrown from the constructor or from render,
      // it left the form half-built.
      const container = stubContainer();
      await new EntityForm({
        entity: users,
        entry: { uid: 'bob' },
        translator,
        pointerOptions: () => Promise.resolve([]),
        pointerSearch: () => {
          throw new Error('Not this branch');
        },
        onSubmit: () => Promise.resolve(),
        onCancel: () => undefined,
      }).render(container);
      expect(container.innerHTML).to.include(
        'data-pointer="dc=example,dc=com"'
      );
    });
  });

  it('should offer neither computed nor read-only attributes', async () => {
    const container = stubContainer();
    await build().render(container);
    expect(container.innerHTML).to.not.include('data-field="uid"');
    expect(container.innerHTML).to.not.include(
      'data-field="twakeDepartmentPath"'
    );
    expect(container.innerHTML).to.not.include('data-field="memberOf"');
    expect(container.innerHTML).to.include('data-field="mail"');
  });

  it('should show the hint under the field, not only on failure', async () => {
    const container = stubContainer();
    await build().render(container);
    expect(container.innerHTML).to.include('Expected pattern 999 9999');
    expect(container.innerHTML).to.include('Expected an email address');
  });

  it('should write hints and section headings in the interface language', async () => {
    const translated: EntityDescriptor = {
      ...users,
      schema: {
        attributes: {
          uid: { type: 'string', required: true, role: 'identifier' },
          mail: {
            type: 'string',
            hint: { en: 'An email address', fr: 'Une adresse e-mail' },
            group: { en: 'Contact', fr: 'Coordonnées' },
          },
          mailAlternateAddress: {
            type: 'array',
            items: {
              type: 'string',
              hint: { en: 'Other addresses', fr: 'Autres adresses' },
            },
            group: { en: 'Contact', fr: 'Coordonnées' },
          },
        },
      },
    };
    const container = stubContainer();
    await new EntityForm({
      entity: translated,
      translator: new Translator('fr'),
      pointerOptions: () => Promise.resolve([]),
      onSubmit: () => Promise.resolve(),
      onCancel: () => undefined,
    }).render(container);
    expect(container.innerHTML).to.include('Une adresse e-mail');
    expect(container.innerHTML).to.include('Autres adresses');
    expect(container.innerHTML).not.to.include('[object Object]');
    // One section for both fields, headed in French.
    expect(
      container.innerHTML.match(/<legend>Coordonnées<\/legend>/g)
    ).to.have.length(1);
  });

  it('should mark required fields and say what the mark means', async () => {
    const container = stubContainer();
    await build().render(container);
    // The mark is markup, not the text of its tag.
    expect(container.innerHTML).to.include(
      '<span class="dc-required">*</span>'
    );
    expect(container.innerHTML).to.not.include('&lt;span');
    expect(container.innerHTML).to.include('Fields marked with * are required');
  });

  it('should say an empty required field is required, not repeat the legend', async () => {
    // The legend explains the *; under each field, its error is read out
    // by a screen reader once per field.
    for (const [language, word] of [
      ['en', 'Required'],
      ['fr', 'Obligatoire'],
    ]) {
      const container = document.createElement('div');
      document.body.append(container);
      await new EntityForm({
        entity: users,
        translator: new Translator(language),
        pointerOptions: () => Promise.resolve([]),
        onSubmit: () => Promise.resolve(),
        onCancel: () => undefined,
      }).render(container);
      container
        .querySelector<HTMLElement>('form button[type="submit"]')
        ?.click();
      await new Promise(resolve => setTimeout(resolve, 0));
      const errors = Array.from(
        container.querySelectorAll<HTMLElement>('[data-error]')
      )
        .filter(error => !error.hidden)
        .map(error => error.textContent);
      expect(errors, language).not.to.be.empty;
      for (const error of errors) expect(error, language).to.equal(word);
    }
  });

  it('should ask for a token list on a multi-valued attribute', async () => {
    const container = stubContainer();
    await build().render(container);
    expect(container.innerHTML).to.include(
      'data-tokens="mailAlternateAddress"'
    );
    expect(container.innerHTML).to.include('Press Enter to add a value');
  });

  it('should give a multi-valued field’s control the id its label points at', async () => {
    const domains: EntityDescriptor = {
      ...users,
      schema: {
        ...users.schema,
        attributes: {
          ...users.schema.attributes,
          twakeDomainLink: {
            type: 'array',
            items: {
              type: 'pointer',
              branch: ['ou=domains,ou=nomenclature,dc=example,dc=com'],
            },
          },
        },
      },
    };
    const container = stubContainer();
    await new EntityForm({
      entity: domains,
      translator: new Translator('en'),
      pointerOptions: () => Promise.resolve([]),
      onSubmit: () => Promise.resolve(),
      onCancel: () => undefined,
    }).render(container);
    const html = container.innerHTML;
    for (const [name, tag] of [
      ['mailAlternateAddress', 'input'],
      ['twakeDomainLink', 'select'],
    ]) {
      expect(html).to.include(`<label for="dc-field-${name}">`);
      expect(html).to.match(
        new RegExp(`<${tag} id="dc-field-${name}"[^>]*data-token-input`)
      );
      // Once: a label points at the first element holding its id.
      expect(html.split(`id="dc-field-${name}"`)).to.have.length(2);
    }
  });

  it('should name the tokens of a multi-valued pointer the way its select does', async () => {
    const branch = 'ou=domains,ou=nomenclature,dc=example,dc=com';
    const example = `dc=example,${branch}`;
    const domains: EntityDescriptor = {
      ...users,
      schema: {
        attributes: {
          uid: users.schema.attributes.uid,
          twakeDomainLink: {
            type: 'array',
            items: { type: 'pointer', branch: [branch] },
          },
        },
      },
    };
    let answer: (options: { dn: string; label: string }[]) => void = () =>
      undefined;
    const container = document.createElement('div');
    document.body.append(container);
    const rendering = new EntityForm({
      entity: domains,
      entry: { uid: 'hr', twakeDomainLink: [example] },
      translator: new Translator('en'),
      pointerOptions: () => new Promise(resolve => (answer = resolve)),
      onSubmit: () => Promise.resolve(),
      onCancel: () => undefined,
    }).render(container);
    // Before the options are known: the RDN, not the DN.
    expect(container.innerHTML).to.include('>example</span>');
    expect(container.innerHTML).to.not.include(`>${example}</span>`);
    expect(container.innerHTML).to.include('aria-label="Remove example"');
    answer([{ dn: example, label: 'example.com' }]);
    await rendering;
    // Once they are: the name the select offers, the DN in the title.
    const list = container.querySelector(
      '[data-field="twakeDomainLink"] .dc-token-list'
    );
    expect(list?.innerHTML).to.include(
      `<span title="${example}">example.com</span>`
    );
    // Its remove button says which value it removes.
    expect(list?.innerHTML).to.include('aria-label="Remove example.com"');
  });

  it('should not offer the identifier for editing once it exists', async () => {
    const container = stubContainer();
    await build({ uid: 'jsmith', cn: 'John' }).render(container);
    expect(container.innerHTML).to.not.include('data-field="uid"');
  });

  it('should prefill a field from a value the directory answered in another case', async () => {
    // The schema spells the attribute `cn`; a directory that answered `CN`
    // instead used to leave the field blank on an entry that has a name.
    const container = stubContainer();
    await build({ uid: 'jsmith', CN: 'John Smith' }).render(container);
    expect(container.innerHTML).to.include('value="John Smith"');
  });

  it('should stay a modal while the form is short', () => {
    // Six editable fields: a dialog still fits on screen.
    expect(build().wantsPanel).to.be.false;
  });

  it('should become a panel when the form gets long', () => {
    const attributes: EntitySchema['attributes'] = {};
    for (let i = 0; i < 20; i++) attributes[`a${i}`] = { type: 'string' };
    const long: EntityDescriptor = { ...users, schema: { attributes } };
    expect(
      new EntityForm({
        entity: long,
        translator: new Translator('en'),
        pointerOptions: () => Promise.resolve([]),
        onSubmit: () => Promise.resolve(),
        onCancel: () => undefined,
      }).wantsPanel
    ).to.be.true;
  });

  it('should convert between the directory’s date and the browser’s', () => {
    expect(EntityForm.toDateInput('20240930220000Z')).to.equal('2024-09-30');
    expect(EntityForm.toDateInput('2024-09-30T22:00:00Z')).to.equal(
      '2024-09-30'
    );
    expect(EntityForm.toDateInput('nonsense')).to.equal('');
    expect(EntityForm.toDirectoryDate('2024-09-30')).to.equal(
      '20240930000000Z'
    );
    expect(EntityForm.toDirectoryDate('')).to.equal('');
  });

  describe('mail domains', () => {
    const domainsBase = 'ou=domains,ou=nomenclature,dc=example,dc=com';
    const example = `dc=example,${domainsBase}`;
    const lists = `dc=lists,${domainsBase}`;
    const other = `dc=other,${domainsBase}`;
    const listed = [
      { dn: example, label: 'example.com' },
      { dn: lists, label: 'lists.example.com' },
      { dn: other, label: 'other.org' },
    ];
    const organizations: EntityDescriptor = {
      key: 'organizations',
      pluralName: 'organizations',
      singularName: 'organization',
      mainAttribute: 'ou',
      base: 'ou=organization,dc=example,dc=com',
      schema: {
        attributes: {
          ou: { type: 'string', role: 'identifier', required: true },
          twakeDomainLink: {
            type: 'array',
            role: 'domainLink',
            items: { type: 'pointer', branch: [domainsBase] },
          },
        },
      },
      endpoint: '/api/v1/ldap/organizations',
      kind: 'organization',
    };
    const tick = (): Promise<void> =>
      new Promise(resolve => setTimeout(resolve, 0));
    /** Press a key on a control, as the reader does. */
    const key = (control: HTMLElement, name: string): KeyboardEvent => {
      const event = new KeyboardEvent('keydown', {
        key: name,
        bubbles: true,
        cancelable: true,
      });
      control.dispatchEvent(event);
      return event;
    };

    describe('chosen by typing', () => {
      /** An organization form, its domain field the picker it draws. */
      const domainForm = async (
        pointerOptions: () => Promise<{ dn: string; label: string }[]>,
        linkableDomains?: () => Promise<string[] | undefined>
      ): Promise<{
        container: HTMLElement;
        form: EntityForm;
        input: HTMLInputElement;
        results: HTMLElement;
        asked: () => number;
      }> => {
        const container = document.createElement('div');
        document.body.append(container);
        let calls = 0;
        const form = new EntityForm({
          entity: organizations,
          entry: {
            dn: `ou=Sales,${organizations.base}`,
            ou: 'Sales',
            twakeDomainLink: [example],
          },
          translator: new Translator('en'),
          typeAhead: branch => branch === domainsBase,
          linkableDomains,
          pointerOptions: () => {
            calls++;
            return pointerOptions();
          },
          onSubmit: () => Promise.resolve(),
          onCancel: () => undefined,
        });
        await form.render(container);
        const input = container.querySelector<HTMLInputElement>(
          '[data-field="twakeDomainLink"] [data-picker-input]'
        );
        const results = container.querySelector<HTMLElement>(
          '[data-field="twakeDomainLink"] .dc-picker-results'
        );
        if (!input || !results) throw new Error('no domain picker');
        return { container, form, input, results, asked: () => calls };
      };
      const type = async (
        input: HTMLInputElement,
        text: string
      ): Promise<void> => {
        typeInto(input, text);
        await tick();
      };
      const links = (container: HTMLElement): (string | null)[] =>
        shownValues(container, 'twakeDomainLink');

      it('should filter the domains listed once by their name, from the first letter', async () => {
        const { container, input, results, asked } = await domainForm(() =>
          Promise.resolve(listed)
        );
        // A picker, named by the domain, not by its RDN.
        expect(container.innerHTML).to.include('data-picker="twakeDomainLink"');
        expect(container.innerHTML).to.include(
          'Type part of a name, or press ↓ to list them all'
        );
        expect(container.innerHTML).to.include(
          `title="${example}">example.com<`
        );

        await type(input, 'L');
        expect(results.hidden).to.equal(false);
        expect(results.innerHTML).to.include('lists.example.com');
        expect(results.innerHTML).not.to.include('other.org');
        key(input, 'Enter');
        expect(links(container)).to.deep.equal([
          'example.com',
          'lists.example.com',
        ]);

        // What is linked already is not offered again; the arrow lists
        // the rest of them, the box empty.
        key(input, 'Escape');
        input.value = '';
        key(input, 'ArrowDown');
        await tick();
        expect(results.innerHTML).to.include('other.org');
        expect(results.innerHTML).not.to.include('>example.com<');
        // Every keystroke filtered what one request listed.
        expect(asked()).to.equal(1);
      });

      it('should offer only what an organization above links, to a caller below the top', async () => {
        const { container, input, results } = await domainForm(
          () => Promise.resolve(listed),
          () => Promise.resolve([lists])
        );
        await type(input, 'o');
        expect(results.innerHTML).to.include('lists.example.com');
        expect(results.innerHTML).not.to.include('other.org');

        await type(input, 'other');
        expect(results.innerHTML).to.include(
          'Only a domain an organization above this one links can be linked here'
        );
        key(input, 'Enter');
        expect(links(container)).to.deep.equal(['example.com']);
      });

      it('should offer every domain when what is linked above cannot be read', async () => {
        const { input, results } = await domainForm(
          () => Promise.resolve(listed),
          () => Promise.reject(new Error('Forbidden'))
        );
        await type(input, 'o');
        expect(results.innerHTML).to.include('other.org');
      });

      it('should keep the select, quietly, when the domains cannot be read', async () => {
        const container = document.createElement('div');
        document.body.append(container);
        await new EntityForm({
          entity: organizations,
          entry: {
            dn: `ou=Sales,${organizations.base}`,
            ou: 'Sales',
            twakeDomainLink: [example],
          },
          translator: new Translator('en'),
          typeAhead: branch => branch === domainsBase,
          pointerOptions: () =>
            Promise.reject(
              Object.assign(new Error('Forbidden'), { status: 403 })
            ),
          onSubmit: () => Promise.resolve(),
          onCancel: () => undefined,
        }).render(container);
        const select = container.querySelector<HTMLSelectElement>(
          'select#dc-field-twakeDomainLink'
        );
        if (!select) throw new Error('no select');
        expect(select.disabled).to.equal(false);
        const note = container.querySelector<HTMLElement>(
          '#dc-note-twakeDomainLink'
        );
        await new Promise(resolve => setTimeout(resolve, 150));
        expect(note?.hidden).to.equal(true);
        expect(note?.textContent).to.equal('');
      });
    });

    describe('completing an address', () => {
      /** An account form drawn in the page, its address boxes described. */
      const addressForm = async (
        mailDomains?: (organization?: string) => Promise<string[]>,
        rule: Partial<SchemaAttribute> = { mailDomainScope: 'organization' }
      ): Promise<{
        form: EntityForm;
        container: HTMLElement;
        mail: HTMLInputElement;
        mailList: HTMLElement;
        alias: HTMLInputElement;
        aliasList: HTMLElement;
      }> => {
        const container = document.createElement('div');
        document.body.append(container);
        // The rule ldap-rest's `ldap/enterpriseRules` checks addresses by.
        const { mail: address, mailAlternateAddress: aliases } =
          users.schema.attributes;
        const form = new EntityForm({
          entity: {
            ...users,
            schema: {
              attributes: {
                ...users.schema.attributes,
                mail: { ...address, ...rule },
                mailAlternateAddress: { ...aliases, ...rule },
              },
            },
          },
          entry: {
            uid: 'jane',
            mail: 'jane@other.org',
            twakeDepartmentLink: 'ou=Sales,dc=example,dc=com',
          },
          translator: new Translator('en'),
          pointerOptions: () => Promise.resolve([]),
          mailDomains,
          onSubmit: () => Promise.resolve(),
          onCancel: () => undefined,
        });
        await form.render(container);
        const find = <T extends Element>(selector: string): T => {
          const found = container.querySelector<T>(selector);
          if (!found) throw new Error(`no ${selector}`);
          return found;
        };
        return {
          form,
          container,
          mail: find<HTMLInputElement>('#dc-field-mail'),
          mailList: find<HTMLElement>('#dc-complete-mail'),
          alias: find<HTMLInputElement>('#dc-field-mailAlternateAddress'),
          aliasList: find<HTMLElement>('#dc-complete-mailAlternateAddress'),
        };
      };
      const type = async (
        box: HTMLInputElement,
        text: string
      ): Promise<void> => {
        typeInto(box, text);
        await tick();
      };

      it('should offer the domains of the entry’s organization after an "@"', async () => {
        const asked: (string | undefined)[] = [];
        const { form, container, mail, mailList } = await addressForm(
          organization => {
            asked.push(organization);
            return Promise.resolve(['example.com', 'lists.example.com']);
          }
        );
        expect(container.innerHTML).to.match(
          /<input id="dc-field-mail"[^>]*role="combobox"/
        );
        expect(container.innerHTML).to.include('data-completions');

        await type(mail, 'jane');
        expect(mailList.hidden).to.equal(true);
        await type(mail, 'jane@');
        expect(mailList.hidden).to.equal(false);
        expect(mailList.innerHTML).to.include('>jane@example.com<');
        expect(mailList.innerHTML).to.include('>jane@lists.example.com<');
        // Those the typed text begins come first, then those holding it.
        await type(mail, 'jane@l');
        expect(mailList.innerHTML.indexOf('>jane@lists.')).to.be.within(
          0,
          mailList.innerHTML.indexOf('>jane@example.com<')
        );
        // The first line is chosen, as a picker's: Enter takes it.
        await type(mail, 'jane@ex');
        expect(mailList.innerHTML).to.match(
          /aria-selected="true"\s+data-suggestion="0">jane@example\.com</
        );
        key(mail, 'Enter');
        expect(mail.value).to.equal('jane@example.com');
        expect(form.draft().values.mail).to.deep.equal(['jane@example.com']);
        expect(mailList.hidden).to.equal(true);
        // A domain typed whole is offered no more.
        await type(mail, 'jane@example.com');
        expect(mailList.hidden).to.equal(true);
        // Asked once, for the organization the form attaches the entry to.
        expect(asked).to.deep.equal(['ou=Sales,dc=example,dc=com']);
      });

      it('should offer the subdomains of those allowed where the rule takes them', async () => {
        const every = ['example.com', 'lists.example.com', 'other.org'];
        const { mail, mailList } = await addressForm(
          organization =>
            Promise.resolve(organization ? ['example.com'] : every),
          { mailDomainScope: 'organization', allowSubdomains: true }
        );
        await type(mail, 'all@');
        expect(mailList.innerHTML).to.include('>all@example.com<');
        expect(mailList.innerHTML).to.include('>all@lists.example.com<');
        expect(mailList.innerHTML).not.to.include('other.org');
      });

      it('should offer every domain to an address no rule keeps to some', async () => {
        const asked: (string | undefined)[] = [];
        const { mail, mailList } = await addressForm(organization => {
          asked.push(organization);
          return Promise.resolve(
            organization ? ['example.com'] : ['example.com', 'other.org']
          );
        }, {});
        await type(mail, 'jane@');
        expect(mailList.innerHTML).to.include('>jane@other.org<');
        expect(asked).to.deep.equal([undefined]);
      });

      it('should complete an alias on Enter, and add it on the next', async () => {
        const { container, alias, aliasList } = await addressForm(() =>
          Promise.resolve(['example.com', 'lists.example.com'])
        );
        // "name@" and Enter left "name@" before: nothing was chosen.
        await type(alias, 'j.doe@exa');
        expect(aliasList.hidden).to.equal(false);
        let prevented = false;
        alias.addEventListener('keydown', event => {
          if (event.defaultPrevented) prevented = true;
        });
        key(alias, 'Enter');
        expect(prevented).to.equal(true);
        expect(alias.value).to.equal('j.doe@example.com');
        expect(shownValues(container, 'mailAlternateAddress')).to.deep.equal(
          []
        );
        expect(aliasList.hidden).to.equal(true);
        key(alias, 'Enter');
        expect(shownValues(container, 'mailAlternateAddress')).to.deep.equal([
          'j.doe@example.com',
        ]);

        // Another line, chosen with the arrows
        await type(alias, 'doe@');
        key(alias, 'ArrowDown');
        key(alias, 'Enter');
        expect(alias.value).to.equal('doe@lists.example.com');
        // Escape keeps the text as typed, for Enter to add
        await type(alias, 'x@exa');
        key(alias, 'Escape');
        expect(aliasList.hidden).to.equal(true);
        expect(alias.value).to.equal('x@exa');
      });

      it('should show the identifier a new account will get', async () => {
        // The server takes it from the address; the operator met it on the
        // card only, once it could no longer be changed.
        const entity = (entry?: Entry): EntityForm =>
          new EntityForm({
            entity: {
              ...users,
              schema: {
                attributes: {
                  ...users.schema.attributes,
                  uid: {
                    ...users.schema.attributes.uid,
                    label: { en: 'Identifier', fr: 'Identifiant' },
                    generatedFrom: {
                      attribute: 'mail',
                      extract: '^([^@]+)@',
                      lowercase: true,
                      strip: '[^a-zA-Z0-9._-]',
                      onCollision: 'suffix',
                    },
                  },
                },
              },
            },
            entry,
            translator: new Translator('en'),
            pointerOptions: () => Promise.resolve([]),
            mailDomains: () => Promise.resolve(['example.com']),
            onSubmit: () => Promise.resolve(),
            onCancel: () => undefined,
          });
        const container = document.createElement('div');
        document.body.append(container);
        await entity().render(container);
        const mail =
          container.querySelector<HTMLInputElement>('#dc-field-mail');
        const line = container.querySelector<HTMLElement>(
          '#dc-identifier-mail'
        );
        if (!mail || !line) throw new Error('no identifier line');
        expect(line.hidden).to.equal(true);

        // Not before the address is one
        await type(mail, 'Ux-Audit+1@');
        expect(line.hidden).to.equal(true);
        await type(mail, 'Ux-Audit+1@example.com');
        expect(line.hidden).to.equal(false);
        expect(line.textContent).to.equal(
          'Identifier: ux-audit1 (sign-in name, cannot be changed later). A number is added to it if it is already taken.'
        );
        // Completed from the list, as typed
        await type(mail, 'jane@');
        key(mail, 'Enter');
        expect(line.textContent).to.match(/^Identifier: jane /);
        await type(mail, '');
        expect(line.hidden).to.equal(true);

        // Editing, the identifier exists: no line
        const edit = document.createElement('div');
        document.body.append(edit);
        await entity({ uid: 'jane', mail: 'jane@example.com' }).render(edit);
        expect(edit.querySelector('[data-identifier]')).to.equal(null);
      });

      it('should stay a plain box, quietly, when the domains cannot be read', async () => {
        let asked = 0;
        const { form, mail, mailList } = await addressForm(() => {
          asked++;
          return Promise.reject(
            Object.assign(new Error('Forbidden'), { status: 403 })
          );
        });
        await type(mail, 'jane@');
        await type(mail, 'jane@ex');
        expect(mailList.hidden).to.equal(true);
        expect(mailList.innerHTML).to.equal('');
        // Not asked again on every keystroke.
        expect(asked).to.equal(1);
        mail.value = 'jane@example.com';
        mail.dispatchEvent(new Event('change', { bubbles: true }));
        expect(form.draft().values.mail).to.deep.equal(['jane@example.com']);
      });

      it('should be no combobox when the console offers no domains', async () => {
        const container = document.createElement('div');
        document.body.append(container);
        await build().render(container);
        expect(container.innerHTML).not.to.include('role="combobox"');
        expect(container.innerHTML).not.to.include('data-completions');
      });
    });
  });
});
