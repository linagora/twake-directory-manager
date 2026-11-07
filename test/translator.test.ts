import { expect } from 'chai';
import { createdEntryId } from '../src/format';
import { EntityImport } from '../src/components/EntityImport';
import { attributeLabel, resolveText } from '../src/format';
import { createLabel } from '../src/console/labels';
import { Translator, availableLanguages } from '../src/i18n';
import type { EntityDescriptor, Entry } from '../src/types';
import { usersSchema, users, groups } from './fixtures/entities';
import { drivenImport } from './support/importer';

describe('Translator', () => {
  it('should fall back to English for an unknown language', () => {
    expect(new Translator('xx').language).to.equal('en');
  });

  it('should read a region tag as its language', () => {
    expect(new Translator('fr-CA').language).to.equal('fr');
    expect(new Translator('mn-MN').language).to.equal('mn');
  });

  it('should substitute placeholders', () => {
    const t = new Translator('en');
    expect(t.t('list.count', { from: 1, to: 10, total: 42 })).to.equal(
      '1–10 of 42'
    );
  });

  it('should show an untranslated key rather than nothing', () => {
    expect(new Translator('en').t('no.such.key')).to.equal('no.such.key');
  });

  it('should agree with a count of one', () => {
    // A count of one read "Import 1 entries", and "1 sélectionné(s)" where
    // French had no other way to say it.
    const en = new Translator('en');
    expect(en.t('import.run', { count: 1 })).to.equal('Import 1 entry');
    expect(en.t('import.run', { count: 2 })).to.equal('Import 2 entries');
    expect(en.t('import.run', { count: 0 })).to.equal('Import 0 entries');
    const fr = new Translator('fr');
    expect(fr.t('import.read', { count: 1, file: 'a.csv' })).to.equal(
      '1 ligne lue dans a.csv'
    );
    expect(fr.t('list.selected', { count: 1 })).to.equal('1 sélectionné');
    expect(fr.t('list.selected', { count: 3 })).to.equal('3 sélectionnés');
    // French counts nothing in the singular, where English does not.
    expect(fr.t('import.run', { count: 0 })).to.equal('Importer 0 entrée');
  });

  it('should write once what a language does not inflect', () => {
    // Mongolian leaves a noun as it is after a number: its catalogue holds
    // the plain key, and every count reads it.
    const mn = new Translator('mn');
    expect(mn.t('import.run', { count: 1 })).to.equal('1 бичлэг импортлох');
    expect(mn.t('import.run', { count: 5 })).to.equal('5 бичлэг импортлох');
    // A language-wide category the catalogue has no form for falls back
    // on the general one: French calls a million `many`.
    expect(new Translator('fr').t('import.run', { count: 1e6 })).to.equal(
      `Importer ${(1e6).toLocaleString('fr')} entrées`
    );
  });

  it('should draw no more once its panel is closed', async () => {
    // Its panel closed while it ran, an import filled the hidden panel
    // again row after row, or wrote over the form opened next.
    const importer = new EntityImport({
      entity: users,
      translator: new Translator('en'),
      pointerOptions: () => Promise.resolve([]),
      create: () => Promise.resolve(),
      onDone: () => undefined,
      onClose: () => undefined,
    });
    const root = document.createElement('div');
    document.body.append(root);
    importer.render(root);
    expect(root.innerHTML).to.contain('class="dc-import"');
    // The panel closed: what it drew goes with it.
    root.remove();
    const drawn = root.innerHTML;
    const input = root.querySelector<HTMLInputElement>('[data-import-file]');
    if (!input) throw new Error('no file input');
    Object.defineProperty(input, 'files', {
      configurable: true,
      value: [new File(['Identifier,Name\nA1,Ann\n'], 'x.csv')],
    });
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(root.innerHTML).to.equal(drawn);
  });

  it('should say the accounts it created have no password', async () => {
    // "2 created" hid that their owners could not sign in yet (#164), and
    // a Password column left empty creates them without one as well.
    const sales = 'ou=Sales,ou=organization,dc=example,dc=com';
    const importing = async (
      content: string,
      mapping: string[]
    ): Promise<HTMLElement> => {
      const driven = drivenImport({
        entity: { ...users, password: 'userPassword' },
        translator: new Translator('en'),
        pointerOptions: () => Promise.resolve([{ dn: sales, label: 'Sales' }]),
        create: () => Promise.resolve(),
        onDone: () => undefined,
        onClose: () => undefined,
      });
      await driven.choose(content);
      await driven.map(mapping);
      await driven.check();
      await driven.run();
      return driven.root;
    };
    const without = await importing(
      'Name,Mail,Department\nAlice,alice@example.com,Sales\nBob,bob@example.com,Sales\n',
      ['cn', 'mail', 'twakeDepartmentLink']
    );
    expect(without.innerHTML).to.include(
      '2 accounts were created without a password: give each one from its card (Reset password)'
    );
    const withPasswords = await importing(
      'Name,Mail,Department,Password\nAlice,alice@example.com,Sales,Typed-1!\nBob,bob@example.com,Sales,Typed-2!\n',
      ['cn', 'mail', 'twakeDepartmentLink', 'userPassword']
    );
    expect(withPasswords.innerHTML).to.not.include('without a password');
    const one = await importing(
      'Name,Mail,Department,Password\nAlice,alice@example.com,Sales,Typed-1!\nBob,bob@example.com,Sales,\n',
      ['cn', 'mail', 'twakeDepartmentLink', 'userPassword']
    );
    expect(one.innerHTML).to.include(
      '1 account was created without a password: give it one from its card'
    );
  });

  it('should say the import counts of one in the singular', async () => {
    const sales = 'ou=Sales,ou=organization,dc=example,dc=com';
    const driven = drivenImport({
      entity: users,
      translator: new Translator('fr'),
      pointerOptions: () => Promise.resolve([{ dn: sales, label: 'Sales' }]),
      create: () => Promise.resolve(),
      onDone: () => undefined,
      onClose: () => undefined,
    });
    // One row with no name, refused before the server sees it; one ready.
    await driven.choose(
      'Nom;Mail;Organisation\n;alice@example.com;Sales\nBob;bob@example.com;Sales\n'
    );
    await driven.map(['cn', 'mail', 'twakeDepartmentLink']);
    await driven.check();
    expect(driven.root.innerHTML)
      .to.contain('prête à importer<')
      .and.contain('en erreur, non importée<')
      .and.contain('Importer 1 entrée<');
  });

  it('should name a field the server refused on import by its label', async () => {
    const sales = 'ou=Sales,ou=organization,dc=example,dc=com';
    const driven = drivenImport({
      entity: users,
      translator: new Translator('fr'),
      pointerOptions: () => Promise.resolve([{ dn: sales, label: 'Sales' }]),
      create: () =>
        Promise.reject(new Error('Attribute "cn" must not be empty')),
      onDone: () => undefined,
      onClose: () => undefined,
    });
    await driven.choose(
      'Nom;Mail;Organisation\nAlice;alice@example.com;Sales\n'
    );
    await driven.map(['cn', 'mail', 'twakeDepartmentLink']);
    await driven.check();
    await driven.run();
    expect(
      Array.from(
        driven.root.querySelectorAll('.dc-import-problems .dc-import-message')
      ).map(message => message.textContent)
    ).to.deep.equal(['Attribute "Nom" must not be empty']);
  });

  it('should say a refused row in the interface language, as a form does', async () => {
    const sales = 'ou=Sales,ou=organization,dc=example,dc=com';
    const forbidden = (): Error =>
      Object.assign(new Error('Token does not have permission'), {
        status: 403,
        refusal: { code: 'forbidden' },
      });
    const refusals: Record<string, Error> = {
      'alice@example.com': Object.assign(
        new Error('user: "alice@example.com" is already used'),
        {
          status: 409,
          refusal: {
            code: 'unique',
            attribute: 'mail',
            value: 'alice@example.com',
          },
        }
      ),
      'eva@example.com': forbidden(),
      'gilles@example.com': Object.assign(
        new Error('Attribute "cn" must not be empty'),
        { status: 400 }
      ),
      'fay@example.com': forbidden(),
      'gil@example.com': forbidden(),
    };
    // The department is not what this test is about: a row attached to none
    // is judged on the entry it would create.
    const optional: EntityDescriptor = {
      ...users,
      schema: {
        attributes: {
          ...users.schema.attributes,
          twakeDepartmentLink: {
            ...users.schema.attributes.twakeDepartmentLink,
            required: false,
          },
        },
      },
    };
    const driven = drivenImport({
      entity: optional,
      translator: new Translator('fr'),
      pointerOptions: () =>
        Promise.resolve([
          { dn: sales, label: 'Sales' },
          // The file names the organization as the form shows it.
          { dn: sales, label: 'Acme / Sales' },
        ]),
      create: values => {
        const mail = Array.isArray(values.mail) ? values.mail[0] : values.mail;
        return Promise.reject(refusals[mail]);
      },
      onDone: () => undefined,
      onClose: () => undefined,
    });
    await driven.choose(
      'Nom;Mail;Organisation\n' +
        'Alice;alice@example.com;Sales\n' +
        'Eva Ernst;eva@example.com;\n' +
        'Gilles;gilles@example.com;\n' +
        'Fay Fox;fay@example.com;Acme / Sales\n' +
        'Gil Gray;gil@example.com;Sales\n'
    );
    await driven.map(['cn', 'mail', 'twakeDepartmentLink']);
    await driven.check();
    await driven.run();
    expect(
      Array.from(
        driven.root.querySelectorAll('.dc-import-problems .dc-import-message')
      ).map(message => message.textContent)
    ).to.deep.equal([
      'Mail « alice@example.com » : déjà utilisé par une autre entrée.',
      'Vous n’administrez pas Eva Ernst : cette modification ne vous revient pas.',
      'Le serveur a refusé : Attribute "Nom" must not be empty',
      'Vous n’administrez pas Acme / Sales : cette modification ne vous revient pas.',
      'Vous n’administrez pas Sales : cette modification ne vous revient pas.',
    ]);
  });

  it('should name and link each entry an import created', async () => {
    const done: string[][] = [];
    const answers: (Entry | undefined)[] = [
      // What ldap-rest answers a creation: the DN and the identifier,
      // here made by the server from the address
      { dn: 'uid=amartin,ou=users,dc=example,dc=com', uid: 'amartin' },
      // An answer naming nothing: the row's identifier names it
      undefined,
    ];
    const entity: EntityDescriptor = {
      ...users,
      schema: {
        attributes: {
          uid: { type: 'string', role: 'identifier' },
          cn: { type: 'string', role: 'displayName' },
          mail: { type: 'string', role: 'primaryEmail' },
        },
      },
    };
    const driven = drivenImport({
      entity,
      translator: new Translator('en'),
      pointerOptions: () => Promise.resolve([]),
      create: values =>
        Promise.resolve(createdEntryId(entity, answers.shift(), values)),
      onDone: created => done.push(created),
      onClose: () => undefined,
    });
    await driven.choose(
      'Mail,Name,Identifier\nalice@example.com,Alice Martin,\n,,bob\n'
    );
    await driven.map(['mail', 'cn', 'uid']);
    await driven.check();
    await driven.run();
    const created = driven.root.querySelector('.dc-import-created');
    expect(created?.innerHTML)
      .to.contain('href="#/users/amartin">Alice Martin</a>')
      .and.contain('(amartin)')
      // Named by its identifier alone, not twice
      .and.contain('href="#/users/bob">bob</a></td>');
    expect(done).to.deep.equal([['amartin', 'bob']]);
  });

  it('should create and import in natural French, the article agreeing', () => {
    const fr = new Translator('fr');
    const organizations = {
      ...groups,
      key: 'organizations',
      singularLabel: { en: 'organization', fr: 'organisation' },
    };
    expect(createLabel(fr, users)).to.equal('Créer un utilisateur');
    expect(createLabel(fr, organizations)).to.equal('Créer une organisation');
    // An entity the catalogue does not know keeps the schema's name.
    expect(
      createLabel(fr, { ...groups, key: 'rooms', singularName: 'salle' })
    ).to.equal('Créer : salle');
    expect(createLabel(new Translator('en'), organizations)).to.equal(
      'New organization'
    );
    expect(
      fr.t('import.title', {
        entities: 'Utilisateurs',
        lowerEntities: 'utilisateurs',
      })
    ).to.equal('Importer des utilisateurs');
  });

  // What was created, named in its toast: in test/actions/forms.test.ts.

  it('should name the department in the import rules as its field does', () => {
    // The Twake schema labels the field "Organisation" / "Байгууллага",
    // the template's column with it: the rules must not say "département".
    expect(new Translator('fr').t('import.noteReference')).to.equal(
      'Une organisation, un poste ou une civilité s’écrit comme il apparaît dans le formulaire : son nom, ou le chemin complet d’une organisation.'
    );
    expect(new Translator('mn').t('import.noteReference')).to.match(
      /^Байгууллага, .* байгууллагын бүтэн замаар\.$/
    );
  });

  it('should translate every key of every catalogue', () => {
    // A key present in one catalogue and missing from the other is exactly
    // the mixed-language interface this replaces.
    expect(availableLanguages).to.include.members(['en', 'fr', 'mn']);
    for (const language of availableLanguages) {
      expect(new Translator(language).t('list.perPage')).to.not.equal(
        'list.perPage'
      );
    }
  });
});

describe('localized text', () => {
  it('should take a plain string as the text itself', () => {
    expect(resolveText('Department', 'fr')).to.equal('Department');
  });

  it('should pick the language, then its base tag, then English', () => {
    const label = { en: 'Department', fr: 'Organisation' };
    expect(resolveText(label, 'fr')).to.equal('Organisation');
    expect(resolveText(label, 'fr-CA')).to.equal('Organisation');
    expect(resolveText(label, 'de')).to.equal('Department');
  });

  it('should show something rather than nothing for a partial schema', () => {
    // A schema translated into one language the reader does not speak is
    // still more useful than a blank label.
    expect(resolveText({ nl: 'Afdeling' }, 'fr')).to.equal('Afdeling');
  });

  it('should treat an absent or empty text as absent', () => {
    expect(resolveText(undefined, 'en')).to.be.undefined;
    expect(resolveText('', 'en')).to.be.undefined;
    expect(resolveText({}, 'en')).to.be.undefined;
  });

  it('should name an attribute in the reader’s language', () => {
    const attr = usersSchema.attributes.cn;
    expect(attributeLabel('cn', attr, 'fr')).to.equal('Nom');
    expect(attributeLabel('cn', attr, 'en')).to.equal('Name');
  });

  it('should make an unlabelled attribute readable rather than raw', () => {
    expect(
      attributeLabel('twakeDepartmentPath', { type: 'string' }, 'fr')
    ).to.equal('Twake Department Path');
  });
});
