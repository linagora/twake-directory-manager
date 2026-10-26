import { expect } from 'chai';
import nock from 'nock';
import { listLoader } from '../../src/DirectoryConsole';
import { ConsoleApiClient } from '../../src/api/ConsoleApiClient';
import { EntityDetail } from '../../src/components/EntityDetail';
import { EntityImport } from '../../src/components/EntityImport';
import {
  EntityList,
  csvCell,
  type ListView,
} from '../../src/components/EntityList';
import {
  accountState,
  displayValue,
  pointerLabel,
  stateMarkup,
} from '../../src/format';
import { Translator } from '../../src/i18n';
import type { EntityDescriptor, Entry, EntryList } from '../../src/types';
import { baseUrl, stubContainer } from '../support/stubs';
import { users, groups, mailboxTypes } from '../fixtures/entities';

afterEach(() => nock.cleanAll());

describe('EntityList', () => {
  it('should build its columns from the roles, identifier first', () => {
    expect(EntityList.chooseColumns(users)).to.deep.equal([
      'uid',
      'cn',
      'mail',
      'twakeDepartmentPath',
      'twakeAccountStatus',
    ]);
  });

  it('should still build a table for a schema with no roles', () => {
    const bare: EntityDescriptor = {
      ...users,
      schema: {
        attributes: {
          cn: { type: 'string' },
          description: { type: 'string' },
          objectClass: { type: 'array' },
        },
      },
      mainAttribute: 'cn',
    };
    expect(EntityList.chooseColumns(bare)).to.deep.equal(['cn', 'description']);
  });

  it('should keep the root and the leaf of a deep path', () => {
    // The separators the shortened form adds are literal; the ones inside a
    // short path come through the shared HTML escaper, which encodes `/`.
    expect(EntityList.shortenPath('A / B / C / D').markup).to.equal(
      'A / … / D'
    );
    expect(EntityList.shortenPath('A / B').markup).to.equal('A &#x2F; B');
    expect(EntityList.shortenPath('A').markup).to.equal('A');
  });

  it('should not cut a path up with a scanner that squares its length', () => {
    // `path.split(/\s*\/\s*/)` walks back over the run of blanks before
    // every position it tries, so a path holding one long run costs the
    // square of its length — and a path is whatever the directory holds.
    // The shortened form is the same either way; the time it takes is not:
    // this input took over seven seconds before, and no measurable time
    // now.
    const path = `A / B${' '.repeat(100000)}x / C`;
    const started = Date.now();
    expect(EntityList.shortenPath(path).markup).to.equal('A / … / C');
    expect(Date.now() - started).to.be.below(1000);
  });

  it('should escape a path it shortens', () => {
    expect(EntityList.shortenPath('<A> / B / <D>').markup).to.equal(
      '&lt;A&gt; / … / &lt;D&gt;'
    );
  });

  it('should search the department path apart, never under Every field', async () => {
    // "Sales" in every field found nobody, and the path was not offered;
    // offered under Every field, a name search would match departments.
    const asked: string[] = [];
    const container = stubContainer();
    const list = new EntityList({
      entity: users,
      translator: new Translator('en'),
      view: { search: 'Sales', searchAttribute: 'twakeDepartmentPath' },
      load: (_search, attribute) => {
        asked.push(attribute);
        return Promise.resolve({});
      },
      listable: false,
      onOpen: () => undefined,
      onDelete: () => Promise.resolve(false),
      canDelete: false,
    });
    await list.render(container);
    expect(container.innerHTML).to.include('value="twakeDepartmentPath"');
    expect(asked).to.deep.equal(['twakeDepartmentPath']);
    const everywhere = new EntityList({
      entity: users,
      translator: new Translator('en'),
      view: { search: 'Sales' },
      load: (_search, attribute) => {
        asked.push(attribute);
        return Promise.resolve({});
      },
      listable: false,
      onOpen: () => undefined,
      onDelete: () => Promise.resolve(false),
      canDelete: false,
    });
    await everywhere.render(stubContainer());
    expect(asked[1].split(',')).to.not.include('twakeDepartmentPath');
  });

  it('should list a department of a short name, and say a cut answer is', async () => {
    // "IT" drew the three-character guard, and asked without a search.
    const asked: unknown[] = [];
    const container = stubContainer();
    await new EntityList({
      entity: users,
      translator: new Translator('en'),
      view: {
        search: 'IT',
        searchAttribute: 'twakeDepartmentPath',
        under: 'IT',
      },
      load: (search, attribute, cut) => {
        asked.push([search, attribute, cut]);
        return Promise.resolve({
          entries: { ann: { uid: 'ann', twakeDepartmentPath: 'it / Ops' } },
          truncated: true,
        });
      },
      listable: false,
      onOpen: () => undefined,
      onDelete: () => Promise.resolve(false),
      canDelete: false,
    }).render(container);
    expect(asked).to.deep.equal([['IT', 'twakeDepartmentPath', true]]);
    expect(container.innerHTML).to.include('<tr data-id="ann"');
    expect(container.innerHTML).to.not.include('data-list-all');
    expect(container.innerHTML).to.include(
      'The directory answered only its first matches: some of IT may be missing'
    );
  });

  it('should name the search, its scope, the table and each row’s box', async () => {
    // Ten boxes all read "Select this row", and the search box had only a
    // placeholder, gone as soon as one typed (#211).
    const listed = async (title?: string): Promise<string> => {
      const container = stubContainer();
      await new EntityList({
        entity: users,
        title,
        translator: new Translator('en'),
        view: {
          search: 'IT',
          searchAttribute: 'twakeDepartmentPath',
          under: 'IT',
        },
        load: () =>
          Promise.resolve({
            entries: {
              ann: { uid: 'ann', twakeDepartmentPath: 'it / Ops' },
              // No identifier shown: the box is named after the id
              zed: { twakeDepartmentPath: 'it / Ops' },
            },
            truncated: false,
          }),
        listable: false,
        onOpen: () => undefined,
        onDelete: () => Promise.resolve(false),
        canDelete: false,
      }).render(container);
      return container.innerHTML;
    };
    const html = await listed('Users');
    expect(html)
      .to.include('aria-label="Search Users" title="Search Users"')
      .and.include('aria-label="Search in"')
      .and.include('<caption class="dc-visually-hidden">Users</caption>')
      .and.include('<th scope="col" class="dc-checkbox-cell">')
      .and.include('aria-label="Select all rows on this page"')
      .and.include('aria-label="Select ann"')
      .and.include('aria-label="Select zed"');
    expect(html).to.not.include('Select this row');
    // Without a title, the entity's plural name
    expect(await listed()).to.include('aria-label="Search users"');
  });

  it('should cut a department’s list to it and what lies under it', async () => {
    // A search of the path matches a substring: "Sales" found Presales.
    const container = stubContainer();
    await new EntityList({
      entity: users,
      translator: new Translator('en'),
      view: {
        search: 'Sales',
        searchAttribute: 'twakeDepartmentPath',
        under: 'Sales',
      },
      load: () =>
        Promise.resolve({
          sophie: { uid: 'sophie', twakeDepartmentPath: 'Sales' },
          alice: { uid: 'alice', twakeDepartmentPath: 'Sales / France' },
          pat: { uid: 'pat', twakeDepartmentPath: 'Presales' },
          sam: { uid: 'sam', twakeDepartmentPath: 'Engineering / Sales' },
        }),
      listable: false,
      onOpen: () => undefined,
      onDelete: () => Promise.resolve(false),
      canDelete: false,
    }).render(container);
    const ids = [...container.innerHTML.matchAll(/<tr data-id="([^"]+)"/g)].map(
      match => match[1]
    );
    expect(ids).to.deep.equal(['alice', 'sophie']);
  });

  it('should offer the selection’s own actions between Export and Delete', async () => {
    // Forty accounts imported took forty visits to join a group (#170).
    const container = stubContainer();
    const list = new EntityList({
      entity: users,
      translator: new Translator('en'),
      load: () => Promise.resolve({ alice: { uid: 'alice' } }),
      listable: true,
      onOpen: () => undefined,
      onDelete: () => Promise.resolve(false),
      canDelete: true,
      bulkActions: [
        { label: 'Add to a group…', run: async () => false },
        { label: 'Change state…', run: async () => false },
      ],
    });
    await list.render(container);
    const html = container.innerHTML;
    const order = [
      'data-export',
      'data-bulk-action="0"',
      'data-bulk-action="1"',
      'data-delete-selected',
    ].map(marker => html.indexOf(marker));
    expect(order.every(index => index >= 0)).to.equal(true);
    expect([...order].sort((a, b) => a - b)).to.deep.equal(order);
    expect(html).to.include('data-bulk-action="1">Change state…</button>');
  });

  it('should show an account’s state as a badge when it is an exception', async () => {
    // "Disabled" read like the "Active" around it: a scan down the column
    // missed it (#172). The text stays; Active stays plain.
    const container = stubContainer();
    await new EntityList({
      entity: users,
      translator: new Translator('en'),
      load: () =>
        Promise.resolve({
          alice: { uid: 'alice', twakeAccountStatus: 'cn=active' },
          frank: { uid: 'frank', twakeAccountStatus: 'CN=Disabled' },
        }),
      listable: true,
      pointerLabel: dn =>
        dn.toLowerCase() === 'cn=active' ? 'Active' : 'Disabled',
      onOpen: () => undefined,
      onDelete: () => Promise.resolve(false),
      canDelete: false,
    }).render(container);
    expect(container.innerHTML)
      .to.include(
        'title="CN=Disabled"><span class="dc-state dc-state-disabled">Disabled</span></td>'
      )
      .and.include('title="cn=active">Active</td>');
  });

  it('should show an account’s state on its card as the list does', () => {
    const container = stubContainer();
    new EntityDetail({
      entity: users,
      entry: { uid: 'frank', twakeAccountStatus: 'cn=disabled' },
      translator: new Translator('en'),
      canWrite: false,
      canDelete: false,
      onEdit: () => undefined,
      onDelete: () => undefined,
      onStatus: () => undefined,
      onResetPassword: () => undefined,
      pointerLabel: () => 'Disabled',
    }).render(container);
    expect(container.innerHTML).to.include(
      '<span class="dc-value" title="cn=disabled"><span class="dc-state dc-state-disabled">Disabled</span></span>'
    );
  });

  it('should name an account’s state by its key, and badge only the exceptions', () => {
    expect(accountState(users, 'twakeAccountStatus', 'CN=disabled')).to.equal(
      'disabled'
    );
    expect(accountState(users, 'twakeAccountStatus', 'cn=active')).to.equal(
      'enabled'
    );
    // Another attribute, or a state the schema does not declare
    expect(accountState(users, 'cn', 'cn=disabled')).to.equal(undefined);
    expect(accountState(users, 'twakeAccountStatus', 'cn=gone')).to.equal(
      undefined
    );
    expect(stateMarkup('enabled', 'Active').markup).to.equal('Active');
    expect(stateMarkup('noAccess', 'Sans accès').markup).to.equal(
      '<span class="dc-state dc-state-noAccess">Sans accès</span>'
    );
    expect(stateMarkup('toDelete', '<b>').markup).to.equal(
      '<span class="dc-state dc-state-toDelete">&lt;b&gt;</span>'
    );
    // A deployment's own state is said as it stands.
    expect(stateMarkup('seconded', 'Seconded').markup).to.equal('Seconded');
    expect(stateMarkup(undefined, 'Disabled').markup).to.equal('Disabled');
  });

  it('should name a nomenclature’s values, and keep the others as stored', async () => {
    const container = stubContainer();
    await new EntityList({
      entity: mailboxTypes,
      translator: new Translator('fr'),
      load: () =>
        Promise.resolve({
          teamMailbox: { cn: 'teamMailbox' },
          custom: { cn: 'custom' },
        }),
      listable: true,
      onOpen: () => undefined,
      onDelete: () => Promise.resolve(false),
      canDelete: false,
    }).render(container);
    // `escapeHtml` writes a slash as an entity, which the browser reads back
    const markup = container.innerHTML.replace(/&#x2F;/g, '/');
    expect(markup).to.include(
      'title="teamMailbox"><a class="dc-row-link" href="#/mailboxTypes/teamMailbox">Boîte partagée</a></td>'
    );
    expect(markup).to.include(
      'title="custom"><a class="dc-row-link" href="#/mailboxTypes/custom">custom</a></td>'
    );
    // The box is named as the column shows the value, not as it is stored
    expect(markup)
      .to.include('aria-label="Sélectionner Boîte partagée"')
      .and.include('aria-label="Sélectionner custom"');
  });

  it('should open each row from a link in its first column', async () => {
    // A row with a click handler is out of reach of the keyboard: Tab
    // passed the checkboxes and could open nothing.
    for (const [entity, id, href] of [
      [users, 'alice', '#/users/alice'],
      [groups, 'sales team', '#/groups/sales%20team'],
      [mailboxTypes, 'a/b', '#/mailboxTypes/a%2Fb'],
    ] as const) {
      const container = stubContainer();
      await new EntityList({
        entity,
        translator: new Translator('en'),
        load: () =>
          Promise.resolve({
            [id]: { [entity.mainAttribute]: id },
          }),
        listable: true,
        onOpen: () => undefined,
        onDelete: () => Promise.resolve(false),
        canDelete: false,
      }).render(container);
      const links = container.innerHTML
        .replace(/&#x2F;/g, '/')
        .match(/<a class="dc-row-link"[^>]*>/g);
      expect(links, entity.key).to.deep.equal([
        `<a class="dc-row-link" href="${href}">`,
      ]);
      expect(EntityList.entryHref(entity, id)).to.equal(href);
    }
  });

  it('should open a row clicked outside its link and checkbox, and only there', async () => {
    // The link follows itself, Ctrl+click into a new tab: the row opening
    // the card too would take the current tab with it.
    let click: ((event: { target: unknown }) => void) | undefined;
    const row = {
      dataset: { id: 'alice' },
      addEventListener: (type: string, listener: typeof click) => {
        if (type === 'click') click = listener;
      },
    };
    const container = {
      ...stubContainer(),
      querySelectorAll: (selector: string) =>
        (selector === 'tbody tr'
          ? [row]
          : []) as unknown as NodeListOf<Element>,
    } as unknown as HTMLElement & { innerHTML: string };
    const opened: string[] = [];
    await new EntityList({
      entity: users,
      translator: new Translator('en'),
      load: () => Promise.resolve({ alice: { uid: 'alice' } }),
      listable: true,
      onOpen: id => opened.push(id),
      onDelete: () => Promise.resolve(false),
      canDelete: false,
    }).render(container);
    const inside = (selectors: string[]) => ({
      closest: (selector: string) =>
        selector.split(',').some(part => selectors.includes(part.trim()))
          ? {}
          : null,
    });
    click?.({ target: inside([]) });
    click?.({ target: inside(['.dc-row-link']) });
    click?.({ target: inside(['.dc-checkbox-cell']) });
    expect(opened).to.deep.equal(['alice']);
  });

  it('should search every field the schema marks, not just the identifier', async () => {
    // Looking for a person by surname meant knowing which attribute holds
    // it and switching a selector to it first — schema knowledge asked of
    // someone searching precisely because they lack it.
    const asked: string[] = [];
    const list = new EntityList({
      entity: {
        ...users,
        schema: {
          attributes: {
            uid: { type: 'string', role: 'identifier', searchable: true },
            sn: { type: 'string', searchable: true },
            userPassword: { type: 'string', neverReturn: true },
            twakeSecret: { type: 'string' },
          },
        },
      },
      translator: new Translator('en'),
      load: (_search: string, attribute: string) => {
        asked.push(attribute);
        return Promise.resolve({});
      },
      listable: true,
      onOpen: () => undefined,
      onDelete: () => Promise.resolve(false),
      canDelete: false,
    });
    await list.render(stubContainer());
    // Marked attributes only: an unmarked one is not offered, because the
    // marker says which the directory indexed.
    expect(asked).to.deep.equal(['uid,sn']);
  });

  it('should guess when the schema marks nothing', async () => {
    const asked: string[] = [];
    const list = new EntityList({
      entity: {
        ...users,
        schema: {
          attributes: {
            objectClass: { type: 'array' },
            uid: { type: 'string' },
            userPassword: { type: 'string', neverReturn: true },
            manager: { type: 'pointer' },
          },
        },
      },
      translator: new Translator('en'),
      load: (_search: string, attribute: string) => {
        asked.push(attribute);
        return Promise.resolve({});
      },
      listable: true,
      onOpen: () => undefined,
      onDelete: () => Promise.resolve(false),
      canDelete: false,
    });
    await list.render(stubContainer());
    // Everything returnable, single-valued and not a DN.
    expect(asked).to.deep.equal(['uid']);
  });

  it('should show the answer to the last search, not the last answer', async () => {
    // Typing is debounced, not serialised: two loads are in flight whenever
    // the operator keeps typing, and the slow one used to overwrite the
    // fast one — the box saying "smith" over a table of "smi" results.
    const pending: ((value: Record<string, Entry>) => void)[] = [];
    const list = new EntityList({
      entity: users,
      translator: new Translator('en'),
      load: () =>
        new Promise<Record<string, Entry>>(resolve => pending.push(resolve)),
      listable: true,
      onOpen: () => undefined,
      onDelete: () => Promise.resolve(false),
      canDelete: false,
    });
    const container = stubContainer();

    const first = list.render(container);
    const second = list.refresh();
    expect(pending).to.have.length(2);

    // The newer search answers first, the older one after it.
    pending[1]({ smith: { dn: 'uid=smith', uid: 'smith' } });
    pending[0]({ smi: { dn: 'uid=smi', uid: 'smi' } });
    await Promise.all([first, second]);

    expect(container.innerHTML).to.contain('smith');
    expect(container.innerHTML).to.not.contain('>smi<');
  });

  it('should show a value the directory answered in another case than the schema’s', async () => {
    // LDAP attribute names are case-insensitive (RFC 4512): a directory that
    // answers `MAIL` where the schema says `mail` still holds the value, and
    // reading the entry by the schema's exact spelling missed it — the cell
    // showed empty for a value that was there.
    const list = new EntityList({
      entity: users,
      translator: new Translator('en'),
      load: () =>
        Promise.resolve({
          jsmith: {
            dn: 'uid=jsmith,ou=users,dc=example,dc=com',
            UID: 'jsmith',
            CN: 'John Smith',
            MAIL: 'jsmith@example.com',
          },
        }),
      listable: true,
      onOpen: () => undefined,
      onDelete: () => Promise.resolve(false),
      canDelete: false,
    });
    const container = stubContainer();
    await list.render(container);
    expect(container.innerHTML).to.contain('jsmith@example.com');
  });

  it('should carry a value the directory answered in another case, into the export', async () => {
    const list = new EntityList({
      entity: users,
      translator: new Translator('en'),
      load: () =>
        Promise.resolve({
          jsmith: {
            dn: 'uid=jsmith,ou=users,dc=example,dc=com',
            UID: 'jsmith',
            CN: 'John Smith',
            MAIL: 'jsmith@example.com',
          },
        }),
      listable: true,
      onOpen: () => undefined,
      onDelete: () => Promise.resolve(false),
      canDelete: false,
    });
    await list.render(stubContainer());
    (list as unknown as { selected: Set<string> }).selected = new Set([
      'jsmith',
    ]);

    // `exportSelection` reaches for `document` and `URL` the way a browser
    // provides them; only `document` is missing under Node, so it alone is
    // stubbed here, and the real `Blob`/`URL.createObjectURL` are left in
    // place to carry the CSV text out for inspection.
    const originalDocument = (globalThis as Record<string, unknown>).document;
    const originalCreateObjectURL = URL.createObjectURL;
    const originalRevokeObjectURL = URL.revokeObjectURL;
    let captured: Blob | undefined;
    (globalThis as Record<string, unknown>).document = {
      createElement: () => ({
        click: () => undefined,
        href: '',
        download: '',
      }),
    };
    URL.createObjectURL = (blob: Blob): string => {
      captured = blob;
      return 'blob:stub';
    };
    URL.revokeObjectURL = () => undefined;
    try {
      (list as unknown as { exportSelection(): void }).exportSelection();
    } finally {
      (globalThis as Record<string, unknown>).document = originalDocument;
      URL.createObjectURL = originalCreateObjectURL;
      URL.revokeObjectURL = originalRevokeObjectURL;
    }
    const csv = await captured?.text();
    expect(csv).to.contain('jsmith@example.com');
    // Opened in a spreadsheet as UTF-8, as the import's template is.
    const bytes = new Uint8Array(await captured!.arrayBuffer());
    expect([...bytes.slice(0, 3)]).to.deep.equal([0xef, 0xbb, 0xbf]);
    expect(csv).to.match(/\r\n$/);
  });

  /** A list of accounts drawn from what `listLoader` answers. */
  async function drawnList(language: string): Promise<string> {
    const list = new EntityList({
      entity: users,
      translator: new Translator(language),
      load: listLoader(new ConsoleApiClient(baseUrl), users),
      listable: true,
      onOpen: () => undefined,
      onDelete: () => Promise.resolve(false),
      canDelete: false,
    });
    const container = stubContainer();
    await list.render(container);
    return container.innerHTML;
  }

  it('should say when the server left entries out, and only then', async () => {
    nock(baseUrl)
      .get('/api/v1/ldap/users')
      .query(true)
      .reply(
        200,
        { jsmith: { dn: 'uid=jsmith', uid: 'jsmith' } },
        { 'X-Result-Truncated': 'true' }
      );
    const cut = await drawnList('fr');
    expect(cut).to.contain(
      'Seule 1 entrée est affichée ; il y en a d’autres. Utilisez la recherche pour les trouver.'
    );
    expect(cut).to.contain('jsmith');

    nock(baseUrl)
      .get('/api/v1/ldap/users')
      .query(true)
      .reply(200, { jsmith: { dn: 'uid=jsmith', uid: 'jsmith' } });
    const whole = await drawnList('en');
    expect(whole).to.contain('jsmith');
    expect(whole).to.not.contain('dc-list-notice');
    expect(whole).to.not.contain('Only ');
  });

  it('should count what was received, in the reader’s way of writing numbers', async () => {
    // The server cuts where it likes — it may cap lower than asked — so the
    // notice counts the rows it sent, not the rows the console asked for.
    const many: Record<string, Entry> = {};
    for (let i = 0; i < 1200; i++)
      many[`u${i}`] = { dn: `uid=u${i}`, uid: `u${i}` };
    nock(baseUrl)
      .get('/api/v1/ldap/users')
      .query(true)
      .reply(200, many, { 'X-Result-Truncated': 'true' });
    expect(await drawnList('en')).to.contain(
      'Only 1,200 entries are shown; there are more.'
    );
    nock(baseUrl)
      .get('/api/v1/ldap/users')
      .query(true)
      .reply(200, many, { 'X-Result-Truncated': 'true' });
    expect(await drawnList('fr')).to.contain(
      `Seules ${(1200).toLocaleString('fr')} entrées sont affichées`
    );
  });

  it('should drop the notice once an answer is complete, or fails', async () => {
    const answers: (EntryList | Error)[] = [];
    const list = new EntityList({
      entity: users,
      translator: new Translator('en'),
      load: () => {
        const answer = answers.shift() as EntryList | Error;
        return answer instanceof Error
          ? Promise.reject(answer)
          : Promise.resolve(answer);
      },
      listable: true,
      onOpen: () => undefined,
      onDelete: () => Promise.resolve(false),
      canDelete: false,
    });
    const container = stubContainer();
    const cut: EntryList = {
      entries: { a: { dn: 'uid=a', uid: 'a' } },
      truncated: true,
    };

    answers.push(cut, { entries: cut.entries, truncated: false });
    await list.render(container);
    expect(container.innerHTML).to.contain('dc-list-notice');
    await list.refresh();
    expect(container.innerHTML).to.contain('>a<');
    expect(container.innerHTML).to.not.contain('dc-list-notice');

    answers.push(cut, Object.assign(new Error('Nope'), { status: 400 }));
    await list.refresh();
    expect(container.innerHTML).to.contain('dc-list-notice');
    await list.refresh();
    expect(container.innerHTML).to.contain('Nope');
    expect(container.innerHTML).to.not.contain('dc-list-notice');
  });

  it('should still take a plain map from a loader, as complete', async () => {
    // `EntityList` is exported: a loader written before `EntryList` answers
    // the map alone, and that says nothing was left out.
    const list = new EntityList({
      entity: users,
      translator: new Translator('en'),
      load: () =>
        Promise.resolve({ truncated: { dn: 'uid=truncated', uid: 'x' } }),
      listable: true,
      onOpen: () => undefined,
      onDelete: () => Promise.resolve(false),
      canDelete: false,
    });
    const container = stubContainer();
    await list.render(container);
    // Even an entry named after the flag is read as an entry.
    expect(container.innerHTML).to.contain('data-id="truncated"');
    expect(container.innerHTML).to.not.contain('dc-list-notice');
  });

  it('should explain a search too broad for the directory, not repeat the server', async () => {
    // A server that knows the refusal answers 422.
    nock(baseUrl)
      .get('/api/v1/ldap/users')
      .query(true)
      .reply(422, { error: 'Size limit exceeded, use limit or match' });
    const refused = await drawnList('fr');
    expect(refused).to.contain(
      'Trop d’entrées pour les afficher toutes : affinez la recherche.'
    );
    expect(refused).to.not.contain('Size limit exceeded');

    // A failure of the server's own is said in its words, not as a search
    // too broad: ldap-rest 0.12.0 reported both as a 500, a current one
    // does not, and advising a narrower search hid the failure.
    nock(baseUrl).get('/api/v1/ldap/users').query(true).reply(500, {
      error: 'Internal Server Error',
      message: 'An error occurred',
    });
    const failed = await drawnList('en');
    expect(failed).to.contain('The list could not be loaded');
    expect(failed).to.not.contain('Internal Server Error');
    expect(failed).to.not.contain('narrow the search');

    // A refusal is said plainly, not in the server's words for an API
    // client.
    nock(baseUrl).get('/api/v1/ldap/users').query(true).reply(403, {
      error: 'Token does not have permission on this branch',
    });
    const forbidden = await drawnList('en');
    expect(forbidden).to.contain('You may not see these entries');
    expect(forbidden).to.not.contain('Token');

    // Any other failure says what the server said.
    nock(baseUrl)
      .get('/api/v1/ldap/users')
      .query(true)
      .reply(400, { error: 'Unbalanced filter' });
    expect(await drawnList('en')).to.contain('Unbalanced filter');
  });

  it('should not let an exported cell become a formula', () => {
    // A directory holds what was written into it, and a spreadsheet reads a
    // cell opening on one of these as a formula. Quoting does not help: the
    // quotes are stripped on import and the formula still runs.
    expect(csvCell('=HYPERLINK("http://evil.example")')).to.equal(
      '"\'=HYPERLINK(""http://evil.example"")"'
    );
    expect(csvCell('@SUM(A1)')).to.equal("'@SUM(A1)");
    expect(csvCell('-1+1')).to.equal("'-1+1");
    // Ordinary values are left alone, quoted only when they need it.
    expect(csvCell('John Smith')).to.equal('John Smith');
    expect(csvCell('Smith, John')).to.equal('"Smith, John"');
  });

  it('should show and clear the selection of a whole page from its header', async () => {
    // Each repaint is a new set of boxes, as in a browser: only the
    // listeners of the last one are live.
    type Box = {
      checked: boolean;
      indeterminate: boolean;
      dataset: Record<string, string>;
      fire(): void;
      addEventListener(type: string, handler: (event: unknown) => void): void;
    };
    const box = (id?: string): Box => {
      let handler: ((event: unknown) => void) | undefined;
      const made: Box = {
        checked: false,
        indeterminate: false,
        dataset: id ? { select: id } : {},
        fire: () => handler?.({ target: made }),
        addEventListener: (_type, callback) => {
          handler = callback;
        },
      };
      return made;
    };
    let header = box();
    let rows: Box[] = [];
    const container = stubContainer();
    Object.assign(container, {
      querySelector: (selector: string) =>
        selector === '[data-select-all]' ? header : null,
      querySelectorAll: (selector: string) =>
        selector === '[data-select]' ? rows : [],
    });
    const list = new EntityList({
      entity: users,
      translator: new Translator('en'),
      load: () =>
        Promise.resolve({
          alice: { dn: 'uid=alice,ou=users,dc=example,dc=com', uid: 'alice' },
          bob: { dn: 'uid=bob,ou=users,dc=example,dc=com', uid: 'bob' },
        }),
      listable: true,
      onOpen: () => undefined,
      onDelete: () => Promise.resolve(false),
      canDelete: false,
    });
    const repaint = (): void => {
      header = box();
      rows = [box('alice'), box('bob')];
    };
    repaint();
    await list.render(container);
    const selected = (list as unknown as { selected: Set<string> }).selected;
    const headerTag = (): string =>
      /<input type="checkbox" data-select-all[^>]*>/.exec(
        container.innerHTML
      )?.[0] ?? '';

    // One row of two: neither checked nor clear.
    const [alice] = rows;
    alice.checked = true;
    repaint();
    alice.fire();
    expect(headerTag()).to.not.contain('checked');
    expect(header.indeterminate).to.be.true;

    // The whole page, from the header: shown checked.
    const before = header;
    before.checked = true;
    repaint();
    before.fire();
    expect([...selected]).to.have.members(['alice', 'bob']);
    expect(headerTag()).to.contain('checked');
    expect(header.indeterminate).to.be.false;

    // Clicked again, it clears the page.
    const again = header;
    again.checked = false;
    repaint();
    again.fire();
    expect(selected.size).to.equal(0);
    expect(headerTag()).to.not.contain('checked');
    expect(header.indeterminate).to.be.false;
  });

  it('should show the entries just imported without a search', async () => {
    // Closing the import's result left a large branch asking for three
    // characters, and each new account took a search of its own to check.
    const searched: string[] = [];
    const read: string[] = [];
    const stored: Record<string, Entry> = {
      amartin: { uid: 'amartin', cn: 'Alice Martin', mail: 'a@example.com' },
      bob: { uid: 'bob', cn: 'Bob Brown', mail: 'b@example.com' },
      carol: { uid: 'carol', cn: 'Carol Chen', mail: 'c@example.com' },
    };
    const refusal = (status: number) =>
      Promise.reject(Object.assign(new Error('no'), { status }));
    let answer = (id: string): Promise<Entry> => Promise.resolve(stored[id]);
    const view: ListView = {
      search: 'ali',
      page: 3,
      imported: { ids: ['bob', 'carol', 'amartin'] },
    };
    const options = {
      entity: users,
      translator: new Translator('en'),
      load: (search: string) => {
        searched.push(search);
        return Promise.resolve({});
      },
      read: (id: string) => {
        read.push(id);
        return answer(id);
      },
      listable: false,
      onOpen: () => undefined,
      onDelete: () => Promise.resolve(false),
      canDelete: false,
      view,
    };
    const container = stubContainer();
    await new EntityList(options).render(container);
    // Each read whole: the creation answered little more than its name
    expect(read).to.have.members(['amartin', 'bob', 'carol']);
    expect(searched).to.deep.equal([]);
    expect(container.innerHTML)
      .to.contain('Just imported (3)')
      .and.contain('Back to search')
      .and.contain('href="#&#x2F;users&#x2F;amartin"')
      .and.contain('Bob Brown')
      .and.contain('c@example.com')
      .and.not.contain('data-search ');
    expect(container.innerHTML.indexOf('amartin')).to.be.below(
      container.innerHTML.indexOf('bob')
    );
    // The search keeps its page
    expect(view.page).to.equal(3);

    // Back from a card: one deleted, one out of reach since, left out.
    answer = id =>
      id === 'bob'
        ? refusal(404)
        : id === 'carol'
          ? refusal(403)
          : Promise.resolve(stored[id]);
    const again = stubContainer();
    await new EntityList(options).render(again);
    expect(again.innerHTML)
      .to.contain('Just imported (1)')
      .and.contain('Alice Martin')
      .and.not.contain('Bob Brown')
      .and.not.contain('Carol Chen');
    expect(view.imported?.ids).to.deep.equal(['amartin']);

    // A real failure is said, the count kept
    answer = () => refusal(500);
    const failing = stubContainer();
    await new EntityList(options).render(failing);
    expect(failing.innerHTML)
      .to.contain('Just imported (1)')
      .and.contain('dc-error-block');

    // Back to search: the search left typed is run again, on its page.
    answer = id => Promise.resolve(stored[id]);
    const list = new EntityList(options);
    await list.render(stubContainer());
    await (
      list as unknown as { leaveImported(): Promise<void> }
    ).leaveImported();
    expect(view.imported).to.equal(undefined);
    expect(searched).to.deep.equal(['ali']);
  });

  it('should read only the page shown of a large import', async () => {
    // Two thousand rows read whole on every draw, to show 25 of them
    const ids = Array.from(
      { length: 60 },
      (_, i) => `u${String(i).padStart(2, '0')}`
    );
    const read: string[] = [];
    const gone = new Set(['u03', 'u30']);
    const view: ListView = { imported: { ids: [...ids].reverse() } };
    const list = new EntityList({
      entity: users,
      translator: new Translator('en'),
      load: () => Promise.resolve({}),
      read: (id: string) => {
        read.push(id);
        return gone.has(id)
          ? Promise.reject(Object.assign(new Error('gone'), { status: 404 }))
          : Promise.resolve({ uid: id, cn: `Name ${id}` });
      },
      listable: false,
      onOpen: () => undefined,
      onDelete: () => Promise.resolve(false),
      canDelete: false,
      view,
    });
    const container = stubContainer();
    await list.render(container);
    // The first page, by identifier, refilled past the one found gone
    expect(read).to.have.length(26);
    expect(read).to.include.members(['u00', 'u03', 'u25']);
    expect(container.innerHTML)
      .to.contain('Name u25')
      // Counted from the identifiers: the pages not shown are not checked
      .and.contain('Just imported (59)')
      .and.contain('1–25 of 59')
      .and.not.contain('Name u03')
      .and.not.contain('Name u26');

    // The next page reads its own entries, and only those
    read.length = 0;
    const state = list as unknown as { page: number; turnPage(): void };
    state.page = 1;
    state.turnPage();
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(read).to.have.length(26);
    expect(read).to.include.members(['u26', 'u30', 'u51']);
    expect(container.innerHTML)
      .to.contain('Name u51')
      .and.contain('26–50 of 58')
      .and.not.contain('Name u25');
    expect(view.imported?.ids).to.have.length(58);
  });
});

describe('importing pointers into a large branch', () => {
  const accounts: EntityDescriptor = {
    ...users,
    schema: {
      attributes: {
        uid: { type: 'string', role: 'identifier', required: true },
        manager: { type: 'pointer', branch: [users.base as string] },
        delegates: {
          type: 'array',
          items: { type: 'pointer', branch: [users.base as string] },
        },
      },
    },
  };
  const dn = (uid: string): string => `uid=${uid},${users.base}`;
  const account = (uid: string): Entry => ({ dn: dn(uid), uid });

  /**
   * Run the import's check on a file, the way the button does, and hand
   * back the rows it prepared and the error it showed.
   */
  async function check(
    rows: string[][]
  ): Promise<{ errors: string[][]; values: unknown[]; error: string }> {
    const client = new ConsoleApiClient(baseUrl);
    const importer = new EntityImport({
      entity: accounts,
      translator: new Translator('en'),
      pointerOptions: branch => client.pointerOptions(branch, [accounts]),
      pointerLookup: branch => client.pointerLookup(branch, [accounts]),
      create: () => Promise.resolve(),
      onDone: () => undefined,
      onClose: () => undefined,
    });
    importer.render(stubContainer());
    const state = importer as unknown as {
      table: unknown;
      mapping: string[];
      rows: { errors: string[]; values: unknown }[];
      error: string;
      check(): Promise<void>;
    };
    state.table = {
      headers: ['uid', 'manager', 'delegates'],
      rows,
      delimiter: ',',
    };
    state.mapping = ['uid', 'manager', 'delegates'];
    await state.check();
    return {
      errors: state.rows.map(row => row.errors),
      values: state.rows.map(row => row.values),
      error: state.error,
    };
  }

  it('should resolve from the whole branch when it can be listed', async () => {
    // One listing for both columns, and no request per value.
    nock(baseUrl)
      .get('/api/v1/ldap/users')
      .reply(200, { alice: account('alice'), bob: account('bob') });
    const { errors, values } = await check([['new1', 'alice', 'bob|Alice']]);
    expect(errors).to.deep.equal([[]]);
    expect(values[0]).to.deep.include({
      manager: dn('alice'),
      delegates: [dn('bob'), dn('alice')],
    });
    expect(nock.isDone()).to.equal(true);
  });

  for (const status of [422, 504]) {
    it(`should look each value up when the branch answers ${status}`, async () => {
      nock(baseUrl)
        .get('/api/v1/ldap/users')
        .reply(status, { error: 'Internal Server Error' });
      // Every interceptor answers once: a value looked up twice fails.
      nock(baseUrl)
        .get(`/api/v1/ldap/users/${encodeURIComponent(dn('alice'))}`)
        .reply(200, account('alice'));
      nock(baseUrl).get('/api/v1/ldap/users/bob').reply(200, account('bob'));
      // Spaces around the separators, as a DN typed by hand has them: read
      // by the DN rebuilt on the base, as the full list would match it.
      nock(baseUrl)
        .get(`/api/v1/ldap/users/${encodeURIComponent(dn('carol'))}`)
        .reply(200, account('carol'));
      for (const missing of ['ann', 'zoé', 'dup', 'jo', 'x', 'ka'])
        nock(baseUrl)
          .get(`/api/v1/ldap/users/${encodeURIComponent(missing)}`)
          .reply(404, { error: 'user not found' });
      const search = (match: string) =>
        nock(baseUrl)
          .get('/api/v1/ldap/users')
          .query({ match, attribute: 'uid', limit: '50' });
      // Names containing "ann", none of them "ann" itself.
      search('ann').reply(200, {
        anna: account('anna'),
        joanne: account('joanne'),
      });
      // What the search answered is compared the way the full list
      // compares names: without accents. OpenLDAP's substring match does
      // not fold accents, so this answer stands for the resolver's exact
      // comparison, not for what a directory would send.
      search('zoé').reply(200, { zoe: account('zoe') });
      // Two answers the exact comparison reads as the same name are refused,
      // not guessed. A directory ignores a uid's trailing space and would
      // not hold both: again the comparison is tested, not the directory.
      search('dup').reply(200, {
        dup: { dn: 'uid=dup,ou=users,dc=example,dc=com', uid: 'dup' },
        'Dup ': { dn: 'uid=Dup\\20,ou=users,dc=example,dc=com', uid: 'Dup ' },
      });
      // Cut before the end with no exact match: the name may be further.
      search('jo').reply(
        200,
        { john: account('john') },
        {
          'X-Result-Truncated': 'true',
        }
      );
      // Refused as too broad: says as little as an answer cut short.
      search('x').reply(422, { error: 'Size limit exceeded' });
      // Exactly as long as asked, and no header — which a cross-origin page
      // may not see: read as cut all the same.
      const many: Record<string, Entry> = {};
      for (let i = 0; i < 50; i++) many[`ka${i}`] = account(`ka${i}`);
      search('ka').reply(200, many);

      const { errors, values, error } = await check([
        ['new1', dn('alice'), 'bob|zoé'],
        ['new2', 'bob', 'ann|uid=carol, ou=users, dc=example, dc=com|ka'],
        ['new3', 'dup', 'jo|x'],
        ['new4', 'uid=eve,ou=other,dc=example,dc=com', ''],
      ]);
      expect(error).to.equal('');
      expect(values[0]).to.deep.include({
        manager: dn('alice'),
        delegates: [dn('bob'), dn('zoe')],
      });
      expect(values[1]).to.deep.include({ delegates: [dn('carol')] });
      const undecided = (value: string): string =>
        `Delegates: “${value}” is no identifier, and too many entries contain it to rule out another spelling: check it, or use a DN`;
      expect(errors[0]).to.deep.equal([]);
      expect(errors[1]).to.deep.equal([
        'Delegates: “ann” not found',
        undecided('ka'),
      ]);
      expect(errors[2]).to.deep.equal([
        'Manager: “dup” matches several entries',
        undecided('jo'),
        undecided('x'),
      ]);
      // A DN outside the branch is no entry of it, and costs no request.
      expect(errors[3]).to.deep.equal([
        'Manager: “uid=eve,ou=other,dc=example,dc=com” not found',
      ]);
      expect(nock.isDone()).to.equal(true);
    });
  }

  it('should explain a branch it could neither list nor look up', async () => {
    nock(baseUrl)
      .get('/api/v1/ldap/users')
      .reply(422, { error: 'Size limit exceeded' });
    nock(baseUrl)
      .get('/api/v1/ldap/users/bob')
      .reply(502, '<html>Bad gateway</html>', {
        'Content-Type': 'text/html',
      });
    const { error } = await check([['new1', 'bob', '']]);
    expect(error).to.equal(
      'The list could not be loaded. If the directory holds many entries, narrow the search.'
    );
  });

  it('should not look values up when the branch failed on its own', async () => {
    // A 500 is no search too broad: looking each value up would hide the
    // failure behind "not found" for every one of them.
    nock(baseUrl)
      .get('/api/v1/ldap/users')
      .reply(500, { error: 'Internal Server Error' });
    const { error } = await check([['new1', 'bob', '']]);
    expect(error).to.equal('The list could not be loaded');
    expect(nock.isDone()).to.equal(true);
  });

  it('should not look values up when the branch was refused for another reason', async () => {
    nock(baseUrl)
      .get('/api/v1/ldap/users')
      .reply(403, { error: 'Out of your scope' });
    const { error } = await check([['new1', 'bob', '']]);
    expect(error).to.equal('You may not see these entries');
    expect(nock.isDone()).to.equal(true);
  });
});

describe('pointerLabel', () => {
  const dn = (value: string): string =>
    `cn=${value},ou=twakeMailboxType, ou=nomenclature,DC=example,dc=com`;

  it('should name the value a pointer lands on', () => {
    // The DN is spelled as a directory may answer it: spaces after a comma,
    // upper-case attribute names, the value in another case.
    expect(
      pointerLabel([users, mailboxTypes], dn('TEAMMAILBOX'), 'en')
    ).to.equal('Shared mailbox');
    expect(
      displayValue({ type: 'pointer' }, dn('teamMailbox'), value =>
        pointerLabel([mailboxTypes], value, 'fr')
      )
    ).to.equal('Boîte partagée');
  });

  it('should fall back to the stored value when no schema names it', () => {
    expect(pointerLabel([mailboxTypes], dn('custom'), 'en')).to.equal(
      undefined
    );
    expect(
      displayValue({ type: 'pointer' }, dn('custom'), value =>
        pointerLabel([mailboxTypes], value, 'en')
      )
    ).to.equal('custom');
    // An entry of an entity without a map, or of no entity at all.
    expect(
      pointerLabel([users], 'uid=alice,ou=users,dc=example,dc=com', 'en')
    ).to.equal(undefined);
    expect(pointerLabel([mailboxTypes], 'not a dn', 'en')).to.equal(undefined);
  });
});
