import { expect } from 'chai';
import { EntityForm, pointerFallback } from '../../src/components/EntityForm';
import { Translator } from '../../src/i18n';
import type {
  EntityDescriptor,
  EntitySchema,
  Entry,
  ExternalMembers,
  SchemaAttribute,
} from '../../src/types';
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
        '<p class="dc-hint" data-hint>A size such as 4 GB, 500 MB or 100 KB</p>'
      )
      .and.not.include('xGB');
    expect(await render(sized, 'fr')).to.include(
      'Une taille telle que 4 GB, 500 MB ou 100 KB'
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

  it('should refuse a size and a past expiry before sending, both at once', async () => {
    // Neither carries a pattern: their rules are the server's, which
    // refused them one per round trip, in a toast away from the field.
    const lifecycle: EntityDescriptor = {
      ...users,
      schema: {
        attributes: {
          ...usersSchema.attributes,
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
    ).padStart(2, '0')}${String(now.getUTCDate()).padStart(2, '0')}000000Z`;
    const filled = {
      cn: 'Va Val',
      mail: 'va.val@example.com',
      twakeDepartmentLink: 'ou=HR,dc=example,dc=com',
    };
    let sent = 0;
    const form = (entry?: Entry) =>
      new EntityForm({
        entity: lifecycle,
        entry,
        translator: new Translator('en'),
        pointerOptions: () => Promise.resolve([]),
        onSubmit: () => {
          sent++;
          return Promise.resolve();
        },
        onCancel: () => undefined,
      }) as unknown as {
        values: Record<string, string[]>;
        errors: Record<string, string>;
        submit(): Promise<void>;
      };

    const created = form();
    for (const [name, value] of Object.entries(filled))
      created.values[name] = [value];
    created.values.mailQuotaSize = ['lots'];
    created.values.twakeDeletionDate = ['20201008000000Z'];
    await created.submit();
    expect(sent).to.equal(0);
    expect(created.errors).to.deep.equal({
      // Said with examples, not by repeating the hint shown before.
      mailQuotaSize:
        'Expected a size such as 4 GB, 500 MB or 100 KB, or a number of bytes',
      twakeDeletionDate: 'Expected a date not earlier than today',
    });

    created.values.mailQuotaSize = ['4 GB'];
    created.values.twakeDeletionDate = [today];
    await created.submit();
    expect(created.errors).to.deep.equal({});
    expect(sent).to.equal(1);

    // A date already stored is not sent back, and not judged again.
    const edited = form({
      uid: 'va.val',
      ...filled,
      twakeDeletionDate: '20201008000000Z',
    });
    await edited.submit();
    expect(edited.errors).to.deep.equal({});
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
    /** Inputs firing `input` as typed, found by the form's selectors. */
    const typing = (): {
      root: HTMLElement;
      type(name: string, value: string): void;
      value(name: string): string;
    } => {
      const inputs = new Map<
        string,
        { value: string; listeners: (() => void)[] }
      >();
      const input = (name: string) => {
        if (!inputs.has(name)) inputs.set(name, { value: '', listeners: [] });
        return inputs.get(name)!;
      };
      return {
        root: {
          querySelector: (selector: string) => {
            const name = /data-field="([^"]+)"\] \.dc-input/.exec(
              selector
            )?.[1];
            if (!name) return null;
            const held = input(name);
            return {
              get value() {
                return held.value;
              },
              set value(value: string) {
                held.value = value;
              },
              addEventListener: (_event: string, listener: () => void) =>
                held.listeners.push(listener),
            };
          },
        } as unknown as HTMLElement,
        type(name, value) {
          input(name).value = value;
          input(name).listeners.forEach(listener => listener());
        },
        value: name => input(name).value,
      };
    };
    /** What the tests reach of a form: its values, and its binding. */
    interface Named {
      values: Record<string, string[]>;
      bindFullName(root: HTMLElement): void;
      render(container: HTMLElement): Promise<void>;
    }
    const form = (entry?: Entry, fullNameFormat?: string): Named =>
      new EntityForm({
        entity: people,
        entry,
        fullNameFormat,
        translator: new Translator('en'),
        pointerOptions: () => Promise.resolve([]),
        onSubmit: () => Promise.resolve(),
        onCancel: () => undefined,
      }) as unknown as Named;

    it('should write the full name once both parts are typed', () => {
      const created = form();
      const page = typing();
      created.bindFullName(page.root);
      page.type('givenName', 'Bat');
      expect(page.value('displayName')).to.equal('');
      page.type('sn', 'Dorj ');
      expect(page.value('displayName')).to.equal('Bat Dorj');
      expect(created.values.displayName).to.deep.equal(['Bat Dorj']);
      page.type('givenName', 'Bataa');
      expect(page.value('displayName')).to.equal('Bataa Dorj');
    });

    it('should write it in the deployment’s order', () => {
      const page = typing();
      form(undefined, '{surname} {givenName}').bindFullName(page.root);
      page.type('givenName', 'Bat');
      page.type('sn', 'Dorj');
      expect(page.value('displayName')).to.equal('Dorj Bat');
    });

    it('should leave alone a full name someone wrote', () => {
      const page = typing();
      form().bindFullName(page.root);
      page.type('displayName', 'The boss');
      page.type('givenName', 'Bat');
      page.type('sn', 'Dorj');
      expect(page.value('displayName')).to.equal('The boss');
      // Emptied, it follows again.
      page.type('displayName', '');
      page.type('sn', 'Dorjiin');
      expect(page.value('displayName')).to.equal('Bat Dorjiin');
    });

    it('should write the common name from the full name, on a new entry', () => {
      // The member pickers match names through cn: an account created
      // with none was not found by its full name.
      const created = form();
      const page = typing();
      created.bindFullName(page.root);
      page.type('givenName', 'Ux');
      page.type('sn', 'Audit');
      expect(page.value('cn')).to.equal('Ux Audit');
      expect(created.values.cn).to.deep.equal(['Ux Audit']);
      // The full name typed whole is followed too.
      page.type('displayName', 'Dr Ux Audit');
      expect(page.value('cn')).to.equal('Dr Ux Audit');
      // A common name typed by hand is kept.
      page.type('cn', 'ux');
      page.type('sn', 'Auditor');
      page.type('displayName', 'Ux Auditor');
      expect(page.value('cn')).to.equal('ux');
    });

    it('should leave an entry’s common name alone', () => {
      const page = typing();
      const entry = {
        uid: 'bat',
        givenName: 'Bat',
        sn: 'Dorj',
        displayName: 'Bat Dorj',
      };
      // Filled from the entry, as the form renders it; no common name.
      for (const [name, value] of Object.entries(entry)) page.type(name, value);
      form(entry).bindFullName(page.root);
      page.type('sn', 'Bold');
      expect(page.value('displayName')).to.equal('Bat Bold');
      expect(page.value('cn')).to.equal('');
    });

    it('should carry along the full name of an entry its parts made', () => {
      const made = typing();
      const entry = { uid: 'bat', givenName: 'Bat', sn: 'Dorj' };
      // Filled from the entry, as the form renders it.
      for (const [name, value] of Object.entries({
        ...entry,
        displayName: 'Bat Dorj',
      }))
        made.type(name, value);
      form({ ...entry, displayName: 'Bat Dorj' }).bindFullName(made.root);
      made.type('sn', 'Bold');
      expect(made.value('displayName')).to.equal('Bat Bold');

      const chosen = typing();
      // Filled from the entry, as the form renders it.
      for (const [name, value] of Object.entries({
        ...entry,
        displayName: 'Dr Bat',
      }))
        chosen.type(name, value);
      form({ ...entry, displayName: 'Dr Bat' }).bindFullName(chosen.root);
      chosen.type('sn', 'Bold');
      expect(chosen.value('displayName')).to.equal('Dr Bat');
    });

    it('should explain a field on demand', async () => {
      const container = stubContainer();
      await form().render(container);
      // Not focusable: a panel focuses its first field, and opened on it.
      expect(container.innerHTML).to.include(
        '<span class="dc-help" aria-hidden="true">?</span>'
      );
      expect(container.innerHTML).to.match(
        /<span class="dc-tooltip" role="tooltip" id="dc-help-employeeNumber">The number HR knows the person by<\/span>/
      );
      // No help, no button.
      expect(container.innerHTML).not.to.include('dc-help-sn');
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
      const fold = { open: false };
      const scrolled: string[] = [];
      const fields = new Map<string, unknown>();
      const field = (name: string) => {
        if (!fields.has(name)) {
          const error = { textContent: '', hidden: true };
          fields.set(name, {
            querySelector: (selector: string) =>
              selector === '[data-error]' ? error : null,
            closest: () =>
              ['cn', 'mail', 'twakeDepartmentLink'].includes(name)
                ? null
                : fold,
            scrollIntoView: () => scrolled.push(name),
          });
        }
        return fields.get(name);
      };
      const created = form(located) as unknown as {
        root: unknown;
        values: Record<string, string[]>;
        submit(): Promise<void>;
      };
      created.root = {
        querySelector: (selector: string) =>
          field(/data-field="([^"]+)"/.exec(selector)![1]),
      };
      created.values.telephoneNumber = ['12'];
      await created.submit();
      expect(fold.open).to.equal(true);
      // The required fields are shown first, and refused first.
      expect(scrolled).to.deep.equal(['cn']);
    });

    it('should mark a refused field invalid, described by its message, and focus it', async () => {
      /** A control that keeps its attributes, and says when it is focused. */
      const control = (attributes: Record<string, string> = {}) => ({
        attributes,
        focused: false,
        getAttribute: (name: string) => attributes[name] ?? null,
        setAttribute: (name: string, value: string) => {
          attributes[name] = value;
        },
        removeAttribute: (name: string) => {
          delete attributes[name];
        },
        focus() {
          this.focused = true;
        },
      });
      const controls = new Map<string, ReturnType<typeof control>>();
      const fields = new Map<string, unknown>();
      const field = (name: string) => {
        if (!fields.has(name)) {
          const error = {
            id: `dc-error-${name}`,
            textContent: '',
            hidden: true,
          };
          // A field a help already describes keeps that description.
          controls.set(
            name,
            control(
              name === 'mail' ? { 'aria-describedby': 'dc-help-mail' } : {}
            )
          );
          fields.set(name, {
            querySelector: (selector: string) =>
              selector === '[data-error]'
                ? error
                : selector === `[id="dc-field-${name}"]`
                  ? controls.get(name)
                  : null,
            closest: () => null,
            scrollIntoView: () => undefined,
          });
        }
        return fields.get(name);
      };
      const created = form(located) as unknown as {
        root: unknown;
        values: Record<string, string[]>;
        submit(): Promise<void>;
      };
      created.root = {
        querySelector: (selector: string) =>
          field(/data-field="([^"]+)"/.exec(selector)![1]),
      };
      created.values.mail = ['not-an-email'];
      await created.submit();
      expect(controls.get('mail')!.attributes).to.deep.equal({
        'aria-describedby': 'dc-help-mail dc-error-mail',
        'aria-invalid': 'true',
      });
      expect(controls.get('cn')!.attributes['aria-invalid']).to.equal('true');
      // The first refused field has the focus, not the Create button.
      expect(controls.get('cn')!.focused).to.equal(true);
      expect(controls.get('mail')!.focused).to.equal(false);

      // Corrected, a field is no longer invalid, and keeps its help.
      created.values.mail = ['jane@example.com'];
      created.values.cn = ['Jane'];
      await created.submit();
      expect(controls.get('mail')!.attributes).to.deep.equal({
        'aria-describedby': 'dc-help-mail',
      });

      // The server's refusal of a field is shown the same way.
      controls.get('cn')!.focused = false;
      expect(
        (created as unknown as EntityForm).refuse(
          'MAIL',
          'Email “jane@example.com” is already used by another entry.'
        )
      ).to.equal(true);
      const error = (
        field('mail') as { querySelector(selector: string): unknown }
      ).querySelector('[data-error]') as {
        textContent: string;
        hidden: boolean;
      };
      expect(error).to.deep.include({
        textContent:
          'Email “jane@example.com” is already used by another entry.',
        hidden: false,
      });
      expect(controls.get('mail')!.attributes).to.deep.equal({
        'aria-describedby': 'dc-help-mail dc-error-mail',
        'aria-invalid': 'true',
      });
      expect(controls.get('mail')!.focused).to.equal(true);
      expect(controls.get('cn')!.attributes['aria-invalid']).to.equal(
        undefined
      );
      // A field the form does not hold is left to the toast.
      expect(
        (created as unknown as EntityForm).refuse('employeeNumber', 'Taken')
      ).to.equal(false);
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

  /** A select just real enough for `fillPointers`, which only rewrites markup. */
  const stubSelect = (
    branch: string,
    value: string,
    required = false
  ): HTMLSelectElement & { dataset: { pointer: string } } => {
    const select = {
      dataset: required
        ? { pointer: branch, required: 'true' }
        : { pointer: branch },
      value,
      innerHTML: '',
      disabled: true,
      removeAttribute: (_name: string): void => undefined,
      insertAdjacentHTML: (_position: string, html: string): void => {
        select.innerHTML += html;
      },
    };
    return select as unknown as HTMLSelectElement & {
      dataset: { pointer: string };
    };
  };

  /** Render a form whose one pointer control is that select. */
  const renderWith = async (
    select: HTMLSelectElement,
    entry: Record<string, string | string[]>,
    pointerOptions: () => Promise<{ dn: string; label: string }[]>,
    entity: EntityDescriptor = users
  ): Promise<HTMLElement & { innerHTML: string }> => {
    const container = stubContainer();
    (
      container as unknown as { querySelectorAll: () => unknown[] }
    ).querySelectorAll = (): unknown[] => [select];
    await new EntityForm({
      entity,
      entry,
      translator: new Translator('en'),
      pointerOptions,
      onSubmit: () => Promise.resolve(),
      onCancel: () => undefined,
    }).render(container);
    return container;
  };

  const held = 'ou=Demo,dc=example,dc=com';

  it('should keep a pointer inert until its candidates are known', async () => {
    const select = stubSelect('dc=example,dc=com', held);
    const container = await renderWith(
      select,
      { uid: 'bob', twakeDepartmentLink: [held] },
      () => Promise.resolve([])
    );
    // A click meant to open the list would otherwise take the empty choice
    // and clear the organization the entry holds.
    expect(container.innerHTML).to.include('data-required="true"');
    expect(container.innerHTML).to.include('disabled aria-busy="true"');
    expect(container.innerHTML).to.include('<option value="" disabled>');
  });

  it('should not offer the empty choice on a required field', async () => {
    const select = stubSelect('dc=example,dc=com', held, true);
    await renderWith(select, { uid: 'bob', twakeDepartmentLink: [held] }, () =>
      Promise.resolve([{ dn: held, label: 'Demo' }])
    );
    // The form refuses to save without it: a choice that cannot be taken is
    // not offered.
    expect(select.disabled).to.equal(false);
    expect(select.innerHTML).to.include('<option value="" disabled>');
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
    const select = stubSelect('dc=example,dc=com', held);
    await renderWith(
      select,
      { uid: 'bob', title: [held] },
      () => Promise.resolve([{ dn: held, label: 'Demo' }]),
      optional
    );
    expect(select.disabled).to.equal(false);
    // The empty choice is there and carries no `disabled`: taking it is a
    // real choice, and how the value an entry holds is cleared.
    expect(select.innerHTML).to.include('<option value="">');
    expect(select.innerHTML).to.include('>Demo</option>');
    expect(select.value).to.equal(held);
  });

  it('should keep the value of a branch that answered nothing', async () => {
    const select = stubSelect('dc=example,dc=com', held);
    await renderWith(select, { uid: 'bob', twakeDepartmentLink: [held] }, () =>
      Promise.reject(Object.assign(new Error('Forbidden'), { status: 403 }))
    );
    // Nothing to choose: the empty choice cannot be taken, and the value the
    // directory holds stays selected rather than being silently dropped.
    // An unreadable branch has nothing more to say: the stub has no
    // `closest`, and looking for the field to write a message in would throw.
    expect(select.disabled).to.equal(false);
    expect(select.innerHTML).to.include('<option value="" disabled>');
    expect(select.innerHTML).to.include(`${held}" selected`);
    expect(select.value).to.equal(held);
  });

  /** An element recording its listeners, for wiring a stub cannot run. */
  const recorder = (
    children: Record<string, unknown> = {},
    dataset: Record<string, string> = {}
  ): {
    innerHTML: string;
    value: string;
    hidden: boolean;
    dataset: Record<string, string>;
    addEventListener(type: string, handler: (event: unknown) => void): void;
    setAttribute(): void;
    removeAttribute(): void;
    querySelector(selector: string): unknown;
    fire(type: string, event?: unknown): void;
  } => {
    const handlers: Record<string, ((event: unknown) => void)[]> = {};
    return {
      innerHTML: '',
      value: '',
      hidden: true,
      dataset,
      addEventListener: (type, handler) => {
        (handlers[type] ||= []).push(handler);
      },
      setAttribute: () => undefined,
      removeAttribute: () => undefined,
      querySelector: selector => children[selector] ?? null,
      fire: (type, event = {}) => {
        for (const handler of handlers[type] || []) handler(event);
      },
    };
  };

  it('should add a second choice to a multi-valued pointer, not replace the first', async () => {
    // The picker read "multiple" from the field element, which never
    // carried it: choosing a second delegate dropped the first.
    const alice = 'uid=alice,ou=users,dc=example,dc=com';
    const jane = 'uid=jane,ou=users,dc=example,dc=com';
    const input = recorder();
    const results = recorder();
    const tokens = recorder();
    const field = recorder({
      '[data-picker-input]': input,
      '.dc-picker-results': results,
      '.dc-token-list': tokens,
    });
    const container = stubContainer();
    (
      container as unknown as { querySelector(s: string): unknown }
    ).querySelector = selector =>
      selector === '[data-field="twakeDelegatedUsers"]' ? field : null;
    const form = new EntityForm({
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
    });
    await form.render(container);

    input.value = 'jane';
    input.fire('input');
    // Past the debounce, and the search it then issues.
    await new Promise(resolve => setTimeout(resolve, 300));
    input.fire('keydown', { key: 'Enter', preventDefault: () => undefined });
    expect(
      (form as unknown as { values: Record<string, string[]> }).values
        .twakeDelegatedUsers
    ).to.deep.equal([alice, jane]);
  });

  describe('a group’s members', () => {
    const alice = 'uid=alice,ou=users,dc=example,dc=com';
    const jane = 'uid=jane,ou=users,dc=example,dc=com';

    /** A group form whose member field is wired to recorders. */
    const memberForm = async (
      search: (query: string) => Promise<{ dn: string; label: string }[]>,
      externalMembers?: ExternalMembers
    ): Promise<{
      form: EntityForm;
      input: ReturnType<typeof recorder>;
      results: ReturnType<typeof recorder>;
      tokens: ReturnType<typeof recorder>;
      container: HTMLElement & { innerHTML: string };
    }> => {
      const input = recorder();
      const results = recorder();
      const tokens = recorder();
      const field = recorder({
        '[data-picker-input]': input,
        '.dc-picker-results': results,
        '.dc-token-list': tokens,
      });
      const container = stubContainer();
      (
        container as unknown as { querySelector(s: string): unknown }
      ).querySelector = selector =>
        selector === '[data-field="member"]' ? field : null;
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
      return { form, input, results, tokens, container };
    };
    const members = (form: EntityForm): string[] =>
      (form as unknown as { values: Record<string, string[]> }).values.member;
    const enter = { key: 'Enter', preventDefault: () => undefined };

    it('should name each remove button after the member it removes', async () => {
      const { container } = await memberForm(() => Promise.resolve([]));
      expect(container.innerHTML).to.include('aria-label="Remove alice"');
      expect(container.innerHTML).to.not.include('Remove this value');
    });

    it('should find a member by email address rather than ask for a DN', async () => {
      const asked: string[] = [];
      const { form, input, container } = await memberForm(query => {
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

      input.value = 'jane@exa';
      input.fire('input');
      await new Promise(resolve => setTimeout(resolve, 300));
      input.fire('keydown', enter);
      expect(asked).to.deep.equal(['jane@exa']);
      expect(members(form)).to.deep.equal([alice, jane]);
    });

    it('should take a DN typed whole, without searching it', async () => {
      let searched = false;
      const { form, input } = await memberForm(() => {
        searched = true;
        return Promise.resolve([]);
      });
      input.value = ` ${jane} `;
      input.fire('input');
      await new Promise(resolve => setTimeout(resolve, 300));
      expect(searched).to.equal(false);
      input.fire('keydown', enter);
      expect(members(form)).to.deep.equal([alice, jane]);
      expect(input.value).to.equal('');
    });

    it('should add a DN left in the box, once', async () => {
      const { form, input } = await memberForm(() => Promise.resolve([]));
      input.value = jane;
      input.fire('blur');
      // The same DN in another case is the same member.
      input.value = jane.toUpperCase();
      input.fire('blur');
      expect(members(form)).to.deep.equal([alice, jane]);
    });

    it('should not pick a member twice in another case', async () => {
      const { form, input } = await memberForm(() =>
        Promise.resolve([{ dn: alice.toUpperCase(), label: 'Alice' }])
      );
      input.value = 'alice';
      input.fire('input');
      await new Promise(resolve => setTimeout(resolve, 300));
      input.fire('keydown', enter);
      expect(members(form)).to.deep.equal([alice]);
    });

    describe('outside the directory', () => {
      const external: ExternalMembers = {
        branch: 'ou=external,dc=example,dc=com',
        rdnAttribute: 'mail',
        managedDomains: ['example.com'],
      };
      /** Type an address, and wait for the search it issues. */
      const type = async (
        input: ReturnType<typeof recorder>,
        text: string
      ): Promise<void> => {
        input.value = text;
        input.fire('input');
        await new Promise(resolve => setTimeout(resolve, 300));
      };

      it('should offer to add an address no entry holds as an external member', async () => {
        // Only the full DN worked, which administrators do not know (#59).
        const { form, input, results, tokens } = await memberForm(
          () => Promise.resolve([]),
          external
        );
        await type(input, 'Some.One+lists@partner.org');
        expect(results.innerHTML).to.include(
          'Add Some.One+lists@partner.org as an external member'
        );
        input.fire('keydown', enter);
        // Escaped as a DN value: a bare `+` joins a second attribute.
        expect(members(form)).to.deep.equal([
          alice,
          'mail=Some.One\\+lists@partner.org,ou=external,dc=example,dc=com',
        ]);
        // Named by its address, not by the offer.
        expect(tokens.innerHTML).to.include('Some.One+lists@partner.org<');
      });

      it('should offer the account, not an external member, for an address an entry holds', async () => {
        const { results, input } = await memberForm(
          () =>
            Promise.resolve([
              { dn: jane, label: 'Jane Doe <jane@partner.org>' },
            ]),
          external
        );
        await type(input, 'JANE@partner.org');
        expect(results.innerHTML).to.include('Jane Doe');
        expect(results.innerHTML).not.to.include('external member');
      });

      it('should say an address at a domain of the directory is an account’s', async () => {
        const { form, input, results } = await memberForm(
          () => Promise.resolve([]),
          external
        );
        await type(input, 'nobody@Example.com');
        expect(results.innerHTML).to.include(
          'example.com is a domain of this directory: choose the account instead'
        );
        input.fire('keydown', enter);
        expect(members(form)).to.deep.equal([alice]);
      });

      it('should offer nothing outside when the server takes no external member', async () => {
        const { results, input } = await memberForm(() => Promise.resolve([]));
        await type(input, 'someone@partner.org');
        expect(results.innerHTML).to.include('No entry matches this search');
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

      /** Type into the member field of a group, and wait for its search. */
      const typed = async (
        text: string,
        type: string,
        options: {
          keep?: boolean;
          answer?: { dn: string; label: string; mail?: string }[];
        } = {}
      ): Promise<{ form: EntityForm; html: string }> => {
        const input = recorder();
        const results = recorder();
        const field = recorder({
          '[data-picker-input]': input,
          '.dc-picker-results': results,
          '.dc-token-list': recorder(),
        });
        const container = stubContainer();
        (
          container as unknown as { querySelector(s: string): unknown }
        ).querySelector = selector =>
          selector === '[data-field="member"]' ? field : null;
        const form = new EntityForm({
          entity: mailboxes,
          entry: {
            ...staff,
            member: [alice],
            mail: 'sales@example.com',
            twakeMailboxType: type,
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
        input.value = text;
        input.fire('input');
        await new Promise(resolve => setTimeout(resolve, 300));
        return { form, html: results.innerHTML };
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
        const { form, html } = await typed('someone@partner.org', team, {
          answer: [],
        });
        expect(html).not.to.include('external member');
        expect(html).to.include('only takes accounts of example.com');
        expect(members(form)).to.deep.equal([alice]);
      });

      it('should follow an address changed in the form', async () => {
        const { form } = await typed('', team);
        (form as unknown as { values: Record<string, string[]> }).values.mail =
          ['sales@other.org'];
        expect(
          (
            form as unknown as { teamMailboxDomain(): string | undefined }
          ).teamMailboxDomain()
        ).to.equal('other.org');
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

    /** A select inside its field, both just real enough for the form. */
    const inField = (
      name: string,
      branch: string,
      value: string
    ): {
      select: HTMLSelectElement;
      field: { innerHTML: string };
      note: { textContent: string; hidden: boolean; id: string };
      describedBy: () => string | undefined;
    } => {
      const select = stubSelect(branch, value) as unknown as Record<
        string,
        unknown
      >;
      let describedBy: string | undefined;
      select.setAttribute = (attribute: string, text: string): void => {
        if (attribute === 'aria-describedby') describedBy = text;
      };
      const note = {
        textContent: '',
        hidden: true,
        id: `dc-note-${name}`,
      };
      const field = {
        innerHTML: '',
        dataset: { field: name },
        querySelector: (selector: string): unknown =>
          selector === '[data-pointer-note]'
            ? note
            : selector.includes('[data-pointer]')
              ? select
              : null,
      };
      select.closest = (): unknown => field;
      return {
        select: select as unknown as HTMLSelectElement,
        field,
        note,
        describedBy: () => describedBy,
      };
    };

    it('should keep the select and say why it offers nothing', async () => {
      const { select, field, note, describedBy } = inField(
        'twakeDepartmentLink',
        'dc=example,dc=com',
        held
      );
      await renderWith(
        select,
        { uid: 'bob', twakeDepartmentLink: [held] },
        () => Promise.reject(failure(504, 'Gateway Timeout'))
      );
      expect(select.disabled).to.equal(false);
      expect(select.innerHTML).to.include(`${held}" selected`);
      expect(field.innerHTML).to.equal('');
      expect(note.hidden).to.equal(false);
      // Filled a moment after it is shown, for a screen reader to say it.
      await new Promise(resolve => setTimeout(resolve, 150));
      expect(note.textContent).to.equal(
        'The list could not be loaded. If the directory holds many entries, narrow the search.'
      );
      expect(describedBy()).to.equal('dc-note-twakeDepartmentLink');
    });

    it('should trade the select for a search when the branch has one', async () => {
      const { select, field, note } = inField(
        'twakeDepartmentLink',
        'dc=example,dc=com',
        held
      );
      const container = stubContainer();
      (
        container as unknown as { querySelectorAll: () => unknown[] }
      ).querySelectorAll = (): unknown[] => [select];
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
      expect(field.innerHTML).to.include('data-picker="twakeDepartmentLink"');
      // The value held is still there, as a token of the search.
      expect(field.innerHTML).to.include('>Demo</span>');
      await new Promise(resolve => setTimeout(resolve, 150));
      expect(note.textContent).to.equal(
        'Too many entries to show them all: narrow the search.'
      );
      // The select was not filled: it is gone.
      expect(select.disabled).to.equal(true);
    });

    it('should remove one value per click once a token list became a search', async () => {
      // The token list listens on the field itself, which the swap keeps:
      // left alone, it removed a value on the same click as the search did.
      const alice = 'uid=alice,ou=users,dc=example,dc=com';
      const bob = 'uid=bob,ou=users,dc=example,dc=com';
      const tokens = recorder();
      const note = { textContent: '', hidden: true, id: 'note' };
      const field = recorder(
        {
          '[data-picker-input]': recorder(),
          '.dc-picker-results': recorder(),
          '.dc-token-list': tokens,
          '[data-pointer-note]': note,
        },
        { field: 'twakeDelegatedUsers' }
      );
      const select = stubSelect(users.base as string, '') as unknown as {
        closest(): unknown;
      };
      select.closest = (): unknown => field;
      const container = stubContainer() as unknown as {
        querySelector(selector: string): unknown;
        querySelectorAll(): unknown[];
      };
      container.querySelector = selector =>
        selector === '[data-field="twakeDelegatedUsers"]' ? field : null;
      container.querySelectorAll = (): unknown[] => [select];
      const form = new EntityForm({
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
      });
      await form.render(container as unknown as HTMLElement);
      expect(field.innerHTML).to.include('data-picker="twakeDelegatedUsers"');

      // One click on the first token's button, bubbling from the token
      // list up to the field.
      const click = {
        target: { closest: () => ({ dataset: { remove: '0' } }) },
      };
      tokens.fire('click', click);
      field.fire('click', click);
      expect(
        (form as unknown as { values: Record<string, string[]> }).values
          .twakeDelegatedUsers
      ).to.deep.equal([bob]);
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
      const form = new EntityForm({
        entity: users,
        translator: new Translator(language),
        pointerOptions: () => Promise.resolve([]),
        onSubmit: () => Promise.resolve(),
        onCancel: () => undefined,
      }) as unknown as {
        errors: Record<string, string>;
        submit(): Promise<void>;
      };
      await form.submit();
      const errors = Object.values(form.errors);
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
    // The token select, inside its field, as `fillPointers` finds it.
    const list = { innerHTML: '' };
    const field = {
      dataset: { tokens: 'twakeDomainLink' },
      querySelector: (selector: string) =>
        selector === '.dc-token-list' ? list : null,
    };
    const select = Object.assign(stubSelect(branch, ''), {
      closest: (selector: string) =>
        selector === '[data-tokens]' ? field : null,
    });
    (select.dataset as Record<string, string>).tokenInput = '';
    const container = await renderWith(
      select,
      { uid: 'hr', twakeDomainLink: [example] },
      () => Promise.resolve([{ dn: example, label: 'example.com' }]),
      domains
    );
    // Before the options are known: the RDN, not the DN.
    expect(container.innerHTML).to.include('>example</span>');
    expect(container.innerHTML).to.not.include(`>${example}</span>`);
    // Once they are: the name the select offers, the DN in the title.
    expect(list.innerHTML).to.include(
      `<span title="${example}">example.com</span>`
    );
    // Its remove button says which value it removes.
    expect(container.innerHTML).to.include('aria-label="Remove example"');
    expect(list.innerHTML).to.include('aria-label="Remove example.com"');
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
    const enter = { key: 'Enter', preventDefault: () => undefined };
    const down = { key: 'ArrowDown', preventDefault: () => undefined };
    const tick = (): Promise<void> =>
      new Promise(resolve => setTimeout(resolve, 0));

    describe('chosen by typing', () => {
      /**
       * An organization form whose domain field is a select inside its
       * field, the field holding what the picker it turns into looks up.
       */
      const domainForm = async (
        pointerOptions: () => Promise<{ dn: string; label: string }[]>,
        linkableDomains?: () => Promise<string[] | undefined>
      ): Promise<{
        form: EntityForm;
        field: ReturnType<typeof recorder>;
        input: ReturnType<typeof recorder>;
        results: ReturnType<typeof recorder>;
        select: HTMLSelectElement;
        note: { textContent: string; hidden: boolean; id: string };
        asked: () => number;
      }> => {
        const input = recorder();
        const results = recorder();
        const note = {
          textContent: '',
          hidden: true,
          id: 'dc-note-twakeDomainLink',
        };
        const field = recorder(
          {
            '[data-picker-input]': input,
            '.dc-picker-results': results,
            '.dc-token-list': recorder(),
            '[data-pointer-note]': note,
          },
          { field: 'twakeDomainLink' }
        );
        const select = stubSelect(domainsBase, '') as unknown as Record<
          string,
          unknown
        >;
        select.dataset = { pointer: domainsBase, tokenInput: '' };
        select.closest = (): unknown => field;
        const container = stubContainer() as unknown as {
          querySelector(selector: string): unknown;
          querySelectorAll(): unknown[];
        };
        container.querySelector = selector =>
          selector === '[data-field="twakeDomainLink"]' ? field : null;
        container.querySelectorAll = (): unknown[] => [select];
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
        await form.render(container as unknown as HTMLElement);
        return {
          form,
          field,
          input,
          results,
          select: select as unknown as HTMLSelectElement,
          note,
          asked: () => calls,
        };
      };
      const links = (form: EntityForm): string[] =>
        (form as unknown as { values: Record<string, string[]> }).values
          .twakeDomainLink;

      it('should filter the domains listed once by their name, from the first letter', async () => {
        const { form, field, input, results, asked } = await domainForm(() =>
          Promise.resolve(listed)
        );
        // A picker, named by the domain, not by its RDN.
        expect(field.innerHTML).to.include('data-picker="twakeDomainLink"');
        expect(field.innerHTML).to.include(
          'Type part of a name, or press ↓ to list them all'
        );
        expect(field.innerHTML).to.include(`title="${example}">example.com<`);

        input.value = 'L';
        input.fire('input');
        await tick();
        expect(results.hidden).to.equal(false);
        expect(results.innerHTML).to.include('lists.example.com');
        expect(results.innerHTML).not.to.include('other.org');
        input.fire('keydown', enter);
        expect(links(form)).to.deep.equal([example, lists]);

        // What is linked already is not offered again; the arrow lists
        // the rest of them, the box empty.
        input.fire('keydown', { key: 'Escape', preventDefault: () => {} });
        input.value = '';
        input.fire('keydown', down);
        await tick();
        expect(results.innerHTML).to.include('other.org');
        expect(results.innerHTML).not.to.include('>example.com<');
        // Every keystroke filtered what one request listed.
        expect(asked()).to.equal(1);
      });

      it('should offer only what an organization above links, to a caller below the top', async () => {
        const { form, input, results } = await domainForm(
          () => Promise.resolve(listed),
          () => Promise.resolve([lists])
        );
        input.value = 'o';
        input.fire('input');
        await tick();
        expect(results.innerHTML).to.include('lists.example.com');
        expect(results.innerHTML).not.to.include('other.org');

        input.value = 'other';
        input.fire('input');
        await tick();
        expect(results.innerHTML).to.include(
          'Only a domain an organization above this one links can be linked here'
        );
        input.fire('keydown', enter);
        expect(links(form)).to.deep.equal([example]);
      });

      it('should offer every domain when what is linked above cannot be read', async () => {
        const { input, results } = await domainForm(
          () => Promise.resolve(listed),
          () => Promise.reject(new Error('Forbidden'))
        );
        input.value = 'o';
        input.fire('input');
        await tick();
        expect(results.innerHTML).to.include('other.org');
      });

      it('should keep the select, quietly, when the domains cannot be read', async () => {
        const { field, select, note } = await domainForm(() =>
          Promise.reject(Object.assign(new Error('Forbidden'), { status: 403 }))
        );
        expect(field.innerHTML).to.equal('');
        expect(select.disabled).to.equal(false);
        await new Promise(resolve => setTimeout(resolve, 150));
        expect(note.hidden).to.equal(true);
        expect(note.textContent).to.equal('');
      });
    });

    describe('completing an address', () => {
      /** An account form whose address fields are wired to recorders. */
      const addressForm = async (
        mailDomains?: (organization?: string) => Promise<string[]>,
        rule: Partial<SchemaAttribute> = { mailDomainScope: 'organization' }
      ): Promise<{
        form: EntityForm;
        container: HTMLElement & { innerHTML: string };
        mail: ReturnType<typeof recorder>;
        mailList: ReturnType<typeof recorder>;
        alias: ReturnType<typeof recorder>;
        aliasList: ReturnType<typeof recorder>;
        values: Record<string, string[]>;
      }> => {
        const mail = recorder();
        const mailList = recorder();
        const alias = recorder();
        const aliasList = recorder();
        const fields: Record<string, unknown> = {
          '[data-field="mail"]': recorder({
            '.dc-input': mail,
            '[data-completions]': mailList,
          }),
          '[data-field="mailAlternateAddress"]': recorder({
            '[data-token-input]': alias,
            '[data-completions]': aliasList,
            '.dc-token-list': recorder(),
          }),
        };
        const container = stubContainer();
        (
          container as unknown as { querySelector(s: string): unknown }
        ).querySelector = selector => fields[selector] ?? null;
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
        return {
          form,
          container,
          mail,
          mailList,
          alias,
          aliasList,
          values: (form as unknown as { values: Record<string, string[]> })
            .values,
        };
      };
      const type = async (
        box: ReturnType<typeof recorder>,
        text: string
      ): Promise<void> => {
        box.value = text;
        box.fire('input');
        await tick();
      };

      it('should offer the domains of the entry’s organization after an "@"', async () => {
        const asked: (string | undefined)[] = [];
        const { container, mail, mailList, values } = await addressForm(
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
        mail.fire('keydown', enter);
        expect(mail.value).to.equal('jane@example.com');
        expect(values.mail).to.deep.equal(['jane@example.com']);
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
        const { alias, aliasList, values } = await addressForm(() =>
          Promise.resolve(['example.com', 'lists.example.com'])
        );
        // "name@" and Enter left "name@" before: nothing was chosen.
        await type(alias, 'j.doe@exa');
        expect(aliasList.hidden).to.equal(false);
        let prevented = false;
        alias.fire('keydown', {
          key: 'Enter',
          preventDefault: () => {
            prevented = true;
          },
        });
        expect(prevented).to.equal(true);
        expect(alias.value).to.equal('j.doe@example.com');
        expect(values.mailAlternateAddress).to.deep.equal([]);
        expect(aliasList.hidden).to.equal(true);
        alias.fire('keydown', enter);
        expect(values.mailAlternateAddress).to.deep.equal([
          'j.doe@example.com',
        ]);

        // Another line, chosen with the arrows
        await type(alias, 'doe@');
        alias.fire('keydown', down);
        alias.fire('keydown', enter);
        expect(alias.value).to.equal('doe@lists.example.com');
        // Escape keeps the text as typed, for Enter to add
        await type(alias, 'x@exa');
        alias.fire('keydown', { key: 'Escape', preventDefault: () => {} });
        expect(aliasList.hidden).to.equal(true);
        expect(alias.value).to.equal('x@exa');
      });

      it('should show the identifier a new account will get', async () => {
        // The server takes it from the address; the operator met it on the
        // card only, once it could no longer be changed.
        const mail = recorder();
        const line = recorder();
        const fields: Record<string, unknown> = {
          '[data-field="mail"]': recorder({
            '.dc-input': mail,
            '[data-completions]': recorder(),
            '[data-identifier]': line,
          }),
        };
        const container = stubContainer();
        (
          container as unknown as { querySelector(s: string): unknown }
        ).querySelector = selector => fields[selector] ?? null;
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
        await entity().render(container);
        expect(container.innerHTML).to.include(
          '<p class="dc-hint" id="dc-identifier-mail" data-identifier hidden></p>'
        );

        // Not before the address is one
        await type(mail, 'Ux-Audit+1@');
        expect(line.hidden).to.equal(true);
        await type(mail, 'Ux-Audit+1@example.com');
        expect(line.hidden).to.equal(false);
        expect(
          (line as unknown as { textContent: string }).textContent
        ).to.equal(
          'Identifier: ux-audit1 (sign-in name, cannot be changed later). A number is added to it if it is already taken.'
        );
        // Completed from the list, as typed
        await type(mail, 'jane@');
        mail.fire('keydown', enter);
        expect(
          (line as unknown as { textContent: string }).textContent
        ).to.match(/^Identifier: jane /);
        await type(mail, '');
        expect(line.hidden).to.equal(true);

        // Editing, the identifier exists: no line
        const edit = stubContainer();
        await entity({ uid: 'jane', mail: 'jane@example.com' }).render(edit);
        expect(edit.innerHTML).not.to.include('data-identifier');
      });

      it('should stay a plain box, quietly, when the domains cannot be read', async () => {
        let asked = 0;
        const { mail, mailList, values } = await addressForm(() => {
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
        mail.fire('change');
        expect(values.mail).to.deep.equal(['jane@example.com']);
      });

      it('should be no combobox when the console offers no domains', async () => {
        const { container } = await addressForm();
        expect(container.innerHTML).not.to.include('role="combobox"');
        expect(container.innerHTML).not.to.include('data-completions');
      });
    });
  });
});
