import { expect } from 'chai';
import { EntityDetail } from '../../src/components/EntityDetail';
import { displayValue, rdnValue } from '../../src/format';
import { Translator } from '../../src/i18n';
import type { EntityDescriptor, Entry } from '../../src/types';
import { stubContainer } from '../support/stubs';
import { usersSchema, users, groups, mailboxTypes } from '../fixtures/entities';

describe('EntityDetail', () => {
  const render = (entry: Record<string, string | string[]>): string => {
    const container = stubContainer();
    new EntityDetail({
      entity: users,
      entry,
      translator: new Translator('en'),
      canWrite: true,
      canDelete: true,
      onEdit: () => undefined,
      onDelete: () => undefined,
      onStatus: () => undefined,
      onResetPassword: () => undefined,
    }).render(container);
    return container.innerHTML;
  };

  it('should name a nomenclature entry the way its schema does', () => {
    const container = stubContainer();
    new EntityDetail({
      entity: mailboxTypes,
      entry: { cn: 'teamMailbox' },
      translator: new Translator('fr'),
      canWrite: true,
      canDelete: true,
      onEdit: () => undefined,
      onDelete: () => undefined,
      onStatus: () => undefined,
      onResetPassword: () => undefined,
    }).render(container);
    expect(container.innerHTML).to.include('<h2>Boîte partagée');
    // The stored value stays at hand, in the tooltip.
    expect(container.innerHTML).to.include(
      'title="teamMailbox">Boîte partagée</span>'
    );
  });

  it('should leave off the card a value every entry of the entity holds', () => {
    const teamMailboxes: EntityDescriptor = {
      ...users,
      schema: {
        attributes: {
          ...users.schema.attributes,
          twakeMailboxType: {
            type: 'string',
            fixed: true,
            default:
              'cn=teamMailbox,ou=twakeMailboxType,ou=nomenclature,dc=example,dc=com',
            label: { en: 'Mailbox type' },
          },
        },
      },
    };
    const container = stubContainer();
    new EntityDetail({
      entity: teamMailboxes,
      entry: {
        uid: 'support',
        twakeMailboxType:
          'cn=teamMailbox,ou=twakeMailboxType,ou=nomenclature,dc=example,dc=com',
      },
      translator: new Translator('en'),
      canWrite: true,
      canDelete: true,
      onEdit: () => undefined,
      onDelete: () => undefined,
      onStatus: () => undefined,
      onResetPassword: () => undefined,
    }).render(container);
    expect(container.innerHTML).not.to.include('Mailbox type');
    expect(container.innerHTML).to.include('support');
  });

  it('should name attributes in the reader’s language', () => {
    const container = stubContainer();
    new EntityDetail({
      entity: users,
      entry: { uid: 'jsmith' },
      translator: new Translator('fr'),
      canWrite: true,
      canDelete: true,
      onEdit: () => undefined,
      onDelete: () => undefined,
      onStatus: () => undefined,
      onResetPassword: () => undefined,
    }).render(container);
    expect(container.innerHTML).to.include('Nom');
  });

  it('should write a date the way the reader does, not as the directory stores it', () => {
    const dated: EntityDescriptor = {
      ...users,
      schema: {
        attributes: {
          ...usersSchema.attributes,
          twakeDeletionDate: { type: 'date' },
        },
      },
    };
    const card = (language: string): string => {
      const container = stubContainer();
      new EntityDetail({
        entity: dated,
        entry: { uid: 'imp.two2', twakeDeletionDate: '20310115000000Z' },
        translator: new Translator(language),
        canWrite: true,
        canDelete: true,
        onEdit: () => undefined,
        onDelete: () => undefined,
        onStatus: () => undefined,
        onResetPassword: () => undefined,
      }).render(container);
      return container.innerHTML;
    };
    expect(card('en')).to.include('>January 15, 2031</span>');
    expect(card('fr')).to.include('>15 janvier 2031</span>');
    // The stored day, whatever the reader's time zone: a date the form
    // set is midnight UTC, the evening before west of Greenwich.
    expect(
      displayValue({ type: 'date' }, '20240930000000Z', undefined, 'en')
    ).to.equal('September 30, 2024');
    // What is no date is shown as it stands.
    expect(displayValue({ type: 'date' }, '20241399000000Z')).to.equal(
      '20241399000000Z'
    );
    expect(displayValue({ type: 'date' }, 'soon')).to.equal('soon');
  });

  it('should show every attribute, the empty ones folded away', () => {
    const html = render({ uid: 'jsmith', mail: 'jsmith@example.com' });
    // The defect this replaces: a card showing two fields, the rest only
    // reachable by opening the edit dialog. They are still on the card, but
    // the empty ones no longer make up most of it.
    const [shown, folded] = html.split('data-empty>');
    expect(shown).to.include('jsmith@example.com');
    expect(shown).not.to.include('Telephone Number');
    expect(folded).to.include('Show empty fields (7)');
    expect(folded).to.include('Name');
    expect(folded).to.include('Telephone Number');
    expect(folded).to.include('Twake Department Link');
  });

  it('should head an account with the person’s name, the identifier under it', () => {
    const html = render({
      uid: 'jsmith',
      cn: 'John Smith',
      mail: 'jsmith@example.com',
    });
    expect(html).to.include('<h2>John Smith</h2>');
    expect(html).to.include(
      '<p class="dc-detail-subtitle" data-subtitle>jsmith · jsmith@example.com</p>'
    );
    // Said in the heading, not again in Details.
    expect(html).not.to.include('<dt>Name</dt>');
    expect(html).not.to.include('<dt>Uid</dt>');
    // Without a name, the identifier heads the card, as it always did.
    expect(render({ uid: 'jsmith' })).to.include('<h2>jsmith</h2>');
    expect(render({ uid: 'jsmith' })).not.to.include('data-subtitle');
  });

  it('should group the details under headings', () => {
    const card = (entity: EntityDescriptor, entry: Entry): string => {
      const container = stubContainer();
      new EntityDetail({
        entity,
        entry,
        translator: new Translator('en'),
        canWrite: true,
        canDelete: true,
        onEdit: () => undefined,
        onDelete: () => undefined,
        onStatus: () => undefined,
        onResetPassword: () => undefined,
      }).render(container);
      return container.innerHTML;
    };
    const html = card(users, {
      uid: 'jsmith',
      cn: 'John Smith',
      mail: 'jsmith@example.com',
      telephoneNumber: '555 0100',
      twakeDepartmentLink: 'ou=France,ou=Sales,dc=example,dc=com',
      twakeDepartmentPath: 'Sales / France',
    });
    const headings = [...html.matchAll(/<h4>([^<]*)<\/h4>/g)].map(
      match => match[1]
    );
    expect(headings).to.deep.equal([
      'Organization',
      'Contact',
      // Under Show empty fields
      'Identity',
      'Contact',
    ]);
    // The path names the department and leads there: its link would say
    // "France" a second time.
    expect(html).to.include('Sales &#x2F; France');
    expect(html).not.to.include('Twake Department Link');

    // A group the schema gives the form is the card's too, after Contact.
    const quota: EntityDescriptor = {
      ...users,
      schema: {
        attributes: {
          ...usersSchema.attributes,
          mailQuotaSize: {
            type: 'number',
            normalize: 'byteSize',
            group: { en: 'Mailbox Settings' },
          },
          twakeDeletionDate: { type: 'date', role: 'accountExpiry' },
        },
      },
    };
    const sized = card(quota, {
      uid: 'jsmith',
      mail: 'jsmith@example.com',
      mailQuotaSize: '1073741824',
      twakeDeletionDate: '20310115000000Z',
    });
    expect(
      [...sized.matchAll(/<h4>([^<]*)<\/h4>/g)].map(match => match[1])
    ).to.deep.equal([
      'Identity',
      'Contact',
      'Mailbox Settings',
      'Lifecycle',
      // Under Show empty fields
      'Identity',
      'Organization',
      'Contact',
    ]);
    // Rounded, the exact count in the tooltip.
    expect(sized).to.include(
      '<span class="dc-value" title="1073741824 bytes">1.07 GB</span>'
    );
  });

  it('should leave out a common name that repeats the full name', () => {
    const named: EntityDescriptor = {
      ...users,
      schema: {
        attributes: {
          ...usersSchema.attributes,
          cn: { type: 'string', label: { en: 'Common name' } },
          displayName: {
            type: 'string',
            role: 'displayName',
            label: { en: 'Full name' },
          },
        },
      },
    };
    const card = (cn: string): string => {
      const container = stubContainer();
      new EntityDetail({
        entity: named,
        entry: { uid: 'jsmith', cn, displayName: 'John Smith' },
        translator: new Translator('en'),
        canWrite: true,
        canDelete: true,
        onEdit: () => undefined,
        onDelete: () => undefined,
        onStatus: () => undefined,
        onResetPassword: () => undefined,
      }).render(container);
      return container.innerHTML;
    };
    expect(card('John Smith')).not.to.include('Common name');
    expect(card('Smith John')).to.include('<dt>Common name</dt>');
  });

  it('should fold the entry’s DN, which no attribute carries, under Technical details', () => {
    const html = render({
      dn: 'uid=jsmith,ou=users,dc=example,dc=com',
      uid: 'jsmith',
    });
    const [, technical] = html.split('data-technical>');
    expect(technical).to.include('<summary>Technical details</summary>');
    expect(technical).to.include('Distinguished name (DN)');
    expect(technical).to.include(
      '<code class="dc-dn">uid=jsmith,ou=users,dc=example,dc=com</code>'
    );
    expect(technical).to.include('data-copy-dn');
  });

  it('should put Edit first, and Hand over and Delete in a More menu', () => {
    const container = stubContainer();
    new EntityDetail({
      entity: users,
      entry: { uid: 'jsmith' },
      translator: new Translator('en'),
      canWrite: true,
      canDelete: true,
      onEdit: () => undefined,
      onDelete: () => undefined,
      onStatus: () => undefined,
      onResetPassword: () => undefined,
      onHandOver: () => undefined,
    }).render(container);
    const html = container.innerHTML;
    const order = ['data-edit', 'data-password', 'data-status', 'data-more'];
    expect(order.map(data => html.indexOf(data))).to.deep.equal(
      order.map(data => html.indexOf(data)).sort((a, b) => a - b)
    );
    expect(html).to.include('aria-haspopup="menu"');
    expect(html).to.include('aria-expanded="false"');
    const [, menu] = html.split('data-more-menu hidden>');
    expect(menu).to.match(
      /role="menuitem"[^>]*data-hand-over>Hand over<\/button><button type="button" role="menuitem" class="dc-menu-item dc-menu-item-danger" data-delete>Delete<\/button>/
    );
  });

  it('should never show a write-only attribute', () => {
    expect(render({ uid: 'jsmith' })).to.not.include('userPassword');
  });

  it('should show a value the directory answered in another case than the schema’s', () => {
    // LDAP attribute names are case-insensitive (RFC 4512); a directory
    // that answers `MAIL` where the schema says `mail` still has the value,
    // and the card used to show it empty. The title, read from the schema's
    // `mainAttribute` (`uid`), is affected the same way.
    const html = render({ UID: 'jsmith', MAIL: 'jsmith@example.com' });
    expect(html).to.include('<h2>jsmith</h2>');
    expect(html).to.include('jsmith@example.com');
  });

  it('should only open the change of state, never write it from the card', () => {
    // A select wrote the state on its first change: an arrow key on it
    // locked an account out. The card now holds a button that opens the
    // panel, and nothing on the card names a state to write.
    let listener: (() => void) | undefined;
    const opened: unknown[][] = [];
    const button = {
      addEventListener: (_type: string, callback: () => void) => {
        listener = callback;
      },
    };
    const container = Object.assign(stubContainer(), {
      querySelector: (selector: string) =>
        selector === '[data-status]' ? button : null,
    });
    new EntityDetail({
      entity: users,
      entry: { uid: 'jsmith' },
      translator: new Translator('en'),
      canWrite: true,
      canDelete: true,
      onEdit: () => undefined,
      onDelete: () => undefined,
      onStatus: (...args: unknown[]) => {
        opened.push(args);
      },
      onResetPassword: () => undefined,
    }).render(container);
    expect(container.innerHTML).to.not.include('<select');
    expect(container.innerHTML).to.not.include('value="disabled"');
    expect(container.innerHTML).to.include(
      '<button type="button" class="dc-button" data-status>Change state…</button>'
    );
    listener?.();
    expect(opened).to.deep.equal([[]]);
  });

  it('should hide every action from a reader', () => {
    const container = stubContainer();
    new EntityDetail({
      entity: users,
      entry: { uid: 'jsmith' },
      translator: new Translator('en'),
      canWrite: false,
      canDelete: false,
      onEdit: () => undefined,
      onDelete: () => undefined,
      onStatus: () => undefined,
      onResetPassword: () => undefined,
    }).render(container);
    expect(container.innerHTML).to.not.include('data-edit');
    expect(container.innerHTML).to.not.include('data-delete');
    expect(container.innerHTML).to.not.include('data-status');
    expect(container.innerHTML).to.not.include('data-password');
  });

  it('should lead from an organization to its managers and local administrators', () => {
    // Named by their identifier, with nowhere to go: checking who
    // administers a branch meant searching the users (#173).
    const sophie = 'uid=sophie.martin,ou=users,dc=example,dc=com';
    const branch: EntityDescriptor = {
      key: 'organizations',
      pluralName: 'organizations',
      singularName: 'organization',
      mainAttribute: 'ou',
      base: 'ou=organization,dc=example,dc=com',
      endpoint: '/api/v1/ldap/organizations',
      kind: 'organization',
      schema: {
        attributes: {
          ou: { type: 'string', role: 'identifier' },
          twakeManagerLink: {
            type: 'array',
            role: 'managers',
            items: {
              type: 'pointer',
              branch: ['ou=users,dc=example,dc=com'],
            },
            label: { en: 'Managers' },
          },
          twakeLocalAdminLink: {
            type: 'array',
            role: 'localAdmins',
            items: {
              type: 'pointer',
              branch: ['ou=users,dc=example,dc=com'],
            },
            label: { en: 'Local administrators' },
          },
        },
      },
    };
    const container = stubContainer();
    new EntityDetail({
      entity: branch,
      entry: {
        dn: 'ou=Sales,ou=organization,dc=example,dc=com',
        ou: 'Sales',
        twakeManagerLink: [sophie],
        twakeLocalAdminLink: [sophie],
      },
      translator: new Translator('en'),
      canWrite: false,
      canDelete: false,
      onEdit: () => undefined,
      onDelete: () => undefined,
      onStatus: () => undefined,
      onResetPassword: () => undefined,
      relationHref: dn => `#/users/${rdnValue(dn)}`,
    }).render(container);
    expect(
      container.innerHTML.match(
        /<a href="#&#x2F;users&#x2F;sophie.martin" class="dc-link" data-relation="[^"]+" title="[^"]+">sophie.martin<\/a>/g
      )
    ).to.have.length(2);
  });

  it('should count a group’s members and let its writer manage them there', () => {
    // Members were chips with no count and no action: the whole form was
    // the only way to add or remove one (#168).
    const card = (manage: boolean) => {
      const container = stubContainer();
      new EntityDetail({
        entity: groups,
        entry: {
          cn: 'sales-team',
          member: ['uid=bob,ou=users,dc=example,dc=com'],
        },
        translator: new Translator('en'),
        canWrite: manage,
        canDelete: false,
        onEdit: () => undefined,
        onDelete: () => undefined,
        onStatus: () => undefined,
        onResetPassword: () => undefined,
        relations: {
          title: 'Members',
          attribute: 'member',
          items: [
            {
              id: 'uid=bob,ou=users,dc=example,dc=com',
              label: 'bob',
              removable: manage,
            },
          ],
        },
        onAddMembers: manage ? () => undefined : undefined,
        onLeaveGroup: manage ? () => undefined : undefined,
      }).render(container);
      return container.innerHTML;
    };
    const managed = card(true);
    expect(managed).to.include('<h3>Members (1)</h3>');
    expect(managed).to.include('data-add-members>Add members…</button>');
    expect(managed).to.include('aria-label="Remove bob from sales-team"');
    const read = card(false);
    expect(read).to.include('<h3>Members (1)</h3>');
    expect(read).to.not.include('data-add-members');
    expect(read).to.not.include('dc-relation-remove');
  });

  it('should name the owners of a group and lead to them', () => {
    // A group's owners are DNs the schema types as strings, and the card
    // showed them whole, where its members read as names leading to them.
    const owned: EntityDescriptor = {
      ...groups,
      schema: {
        attributes: {
          ...groups.schema.attributes,
          owner: {
            type: 'array',
            role: 'owners',
            items: { type: 'string' },
            label: { en: 'Owners' },
          },
        },
      },
    };
    const owner = 'uid=sophie.martin,ou=users,dc=example,dc=com';
    const card = (relationHref?: (dn: string) => string | undefined) => {
      const container = stubContainer();
      new EntityDetail({
        entity: owned,
        entry: { cn: 'sales-team', owner: [owner, 'not a dn'] },
        translator: new Translator('en'),
        canWrite: true,
        canDelete: true,
        onEdit: () => undefined,
        onDelete: () => undefined,
        onStatus: () => undefined,
        onResetPassword: () => undefined,
        relations: { title: 'Members', attribute: 'member', items: [] },
        relationHref,
      }).render(container);
      return container.innerHTML;
    };
    // A link, which a middle click opens in a new tab (#174).
    expect(card(dn => `#/users/${rdnValue(dn)}`))
      .to.include(
        `<a href="#&#x2F;users&#x2F;sophie.martin" class="dc-link" data-relation="${owner}" title="${owner}">sophie.martin</a>`
      )
      .and.not.include(`>${owner}<`);
    // An entry no page shows is named all the same.
    expect(card(() => undefined)).to.include(
      `<span class="dc-value" data-relation="${owner}" title="${owner}">sophie.martin</span>`
    );
    // What is no DN has nowhere to lead.
    expect(card()).to.include(
      '<span class="dc-value" title="not a dn">not a dn</span>'
    );
  });

  it('should say how many related entries the list leaves out', () => {
    const card = (
      language: string,
      relations: { truncated?: boolean; more?: number }
    ): string => {
      const container = stubContainer();
      new EntityDetail({
        entity: groups,
        entry: { cn: 'Human Resources' },
        translator: new Translator(language),
        canWrite: true,
        canDelete: true,
        onEdit: () => undefined,
        onDelete: () => undefined,
        onStatus: () => undefined,
        onResetPassword: () => undefined,
        relations: {
          title: 'Attached entries',
          items: [{ id: 'uid=erin,ou=users,dc=example,dc=com', label: 'erin' }],
          ...relations,
        },
      }).render(container);
      return container.innerHTML;
    };
    expect(card('en', { truncated: true, more: 48 })).to.include(
      'And 48 more entries, not listed here'
    );
    expect(card('en', { truncated: true, more: 1 })).to.include(
      'And 1 more entry, not listed here'
    );
    expect(card('fr', { truncated: true, more: 1 })).to.include(
      'Et 1 autre entrée, non affichée ici'
    );
    expect(card('en', { truncated: true })).to.include(
      'And more entries than the directory lists at once'
    );
    expect(card('en', {})).to.not.include('more entr');
  });

  it('should escape what the directory holds', () => {
    const html = render({ uid: '<script>alert(1)</script>' });
    expect(html).to.not.include('<script>alert(1)</script>');
    expect(html).to.include('&lt;script&gt;');
  });
});
