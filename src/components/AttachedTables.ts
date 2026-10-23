/**
 * The people and the groups attached to an organization, as two tables.
 *
 * "Who is in this department?" is what an organization card is opened to
 * answer. A row of identifier chips mixing accounts and groups answered it
 * with names nobody uses and no count: each kind gets a table of its own,
 * with the columns the lists use for it — the full name, the address, the
 * position and the state of an account, the name, the address and the type
 * of a group — and each row leads to the entry's card.
 *
 * The tables are the lists' tables without the search, the selection or the
 * paging: an organization's attached entries are what the server lists in
 * one answer, and it says when it left some out.
 *
 * @module browser/directory-console/components/AttachedTables
 */

import { escapeHtml } from '../shared/dom';
import { attributeLabel, displayValue, ownValueLabel } from '../format';
import { hasRole, roleAttribute } from '../api/ConsoleApiClient';
import { EntityList } from './EntityList';
import type { Translator } from '../i18n';
import type {
  AttachedEntries,
  AttachedEntry,
  EntityDescriptor,
} from '../types';

/** The two tables: accounts, and groups. */
export type AttachedKind = 'people' | 'groups';

/** The roles of a table's columns, its name column first. */
const COLUMNS: Record<AttachedKind, string[]> = {
  people: ['displayName', 'primaryEmail', 'position', 'accountStatus'],
  groups: ['identifier', 'primaryEmail', 'mailboxType'],
};

export interface AttachedOptions {
  /** Entities the console knows, to name the columns and lead to the cards */
  entities: EntityDescriptor[];
  /** What the server listed */
  members: AttachedEntries;
  translator: Translator;
  /** Name of the organization, for the tables that list no one */
  name: string;
  /** Readable name of the entry a pointer lands on, when one is known */
  pointerLabel?(dn: string): string | undefined;
  /**
   * Create an entry of this kind in the organization, when the caller may:
   * the button stands in the table's heading
   */
  onCreate?: Partial<Record<AttachedKind, () => void>>;
  /** Open a card, given the address `EntityList.entryHref` gives it */
  onOpen(href: string): void;
}

/**
 * Whether an entity is one of groups: the groups themselves, or a flat
 * entity holding members, as team mailboxes do.
 *
 * @param entity the entity
 * @returns true for a group-like entity
 */
export function groupLike(entity: EntityDescriptor): boolean {
  return (
    entity.kind === 'group' ||
    Object.values(entity.schema.attributes).some(attr =>
      hasRole(attr, 'members')
    )
  );
}

/**
 * The entity a table stands for: the first of its kind that is attached to
 * organizations, else the first of its kind. Its schema names the columns,
 * and New user here or New group here creates one of its entries.
 *
 * @param entities entities the console knows
 * @param kind the table
 * @returns the entity, or undefined when the directory has none of the kind
 */
export function attachedEntity(
  entities: EntityDescriptor[],
  kind: AttachedKind
): EntityDescriptor | undefined {
  const candidates = entities.filter(
    entity =>
      entity.kind !== 'organization' &&
      (kind === 'groups') === groupLike(entity)
  );
  const linked = candidates.filter(entity => entity.organizationLink);
  // The groups themselves before a flat entity holding members.
  return (
    linked.find(entity => entity.kind === 'group') ?? linked[0] ?? candidates[0]
  );
}

export class AttachedTables {
  private readonly options: AttachedOptions;

  constructor(options: AttachedOptions) {
    this.options = options;
  }

  /** The entity holding an attached entry, when the console knows it. */
  private entityOf(entry: AttachedEntry): EntityDescriptor | undefined {
    return entry.entity
      ? this.options.entities.find(entity => entity.key === entry.entity)
      : undefined;
  }

  /**
   * The table an entry goes in. An entry no entity holds is listed with the
   * people, by its name.
   */
  private kindOf(entry: AttachedEntry): AttachedKind {
    const entity = this.entityOf(entry);
    return entity && groupLike(entity) ? 'groups' : 'people';
  }

  /** The entity a table's columns are named after. */
  private lead(kind: AttachedKind): EntityDescriptor | undefined {
    return attachedEntity(this.options.entities, kind);
  }

  /**
   * The attribute a column reads in an entity: the one carrying its role,
   * the identifier being the entity's main attribute.
   */
  private attribute(
    entity: EntityDescriptor,
    role: string
  ): string | undefined {
    return role === 'identifier'
      ? entity.mainAttribute
      : roleAttribute(entity.schema, role);
  }

  /** The entries of each table, in the order the server listed them. */
  rows(): Record<AttachedKind, AttachedEntry[]> {
    const rows: Record<AttachedKind, AttachedEntry[]> = {
      people: [],
      groups: [],
    };
    for (const entry of this.options.members.entries)
      rows[this.kindOf(entry)].push(entry);
    return rows;
  }

  /** Both tables. */
  markup(): string {
    const rows = this.rows();
    // The server counts what it left out without saying of which kind: the
    // notice goes under the people, who are what crowds a department, unless
    // it listed groups alone.
    const notice: AttachedKind =
      rows.people.length || !rows.groups.length ? 'people' : 'groups';
    return (['people', 'groups'] as const)
      .filter(kind => rows[kind].length || this.lead(kind))
      .map(kind => this.tableMarkup(kind, rows[kind], kind === notice))
      .join('');
  }

  /**
   * One table under its heading, which counts it and carries its New … here
   * button.
   *
   * @param kind the table
   * @param rows its entries
   * @param notice whether the server's truncation is said under it
   */
  private tableMarkup(
    kind: AttachedKind,
    rows: AttachedEntry[],
    notice: boolean
  ): string {
    const { translator, members, name, onCreate } = this.options;
    const lead = this.lead(kind);
    const roles = COLUMNS[kind].filter(
      (role, index) =>
        index === 0 || !lead || this.attribute(lead, role) !== undefined
    );
    const truncated = notice && members.truncated;
    // Fifty listed of more is not fifty.
    const count = truncated ? `${rows.length}+` : rows.length;
    const create = onCreate?.[kind];
    return `
      <section class="dc-card dc-attached" data-attached="${kind}">
        <header class="dc-attached-header">
          <h3>${escapeHtml(
            translator.t(kind === 'people' ? 'org.people' : 'org.groups', {
              count,
            })
          )}</h3>
          ${
            create
              ? `<button type="button" class="dc-button" data-create-attached="${kind}">${escapeHtml(
                  translator.t(
                    kind === 'people' ? 'org.newUserHere' : 'org.newGroupHere'
                  )
                )}</button>`
              : ''
          }
        </header>
        ${
          rows.length === 0
            ? `<p class="dc-muted">${escapeHtml(
                translator.t('org.nobody', { name })
              )}</p>`
            : `<div class="dc-table-scroll">
                <table class="dc-table dc-attached-table">
                  <thead>
                    <tr>${roles
                      .map(
                        role =>
                          `<th>${escapeHtml(this.heading(lead, role))}</th>`
                      )
                      .join('')}</tr>
                  </thead>
                  <tbody>${rows
                    .map(entry => this.rowMarkup(entry, roles))
                    .join('')}</tbody>
                </table>
              </div>`
        }
        ${truncated ? this.moreMarkup() : ''}
      </section>`;
  }

  /** What a column is called: as the lead entity's schema labels it. */
  private heading(lead: EntityDescriptor | undefined, role: string): string {
    const name = lead && this.attribute(lead, role);
    if (!lead || !name) return '';
    return attributeLabel(
      name,
      lead.schema.attributes[name],
      this.options.translator.language
    );
  }

  /**
   * One entry. Its name leads to its card: a link Tab reaches and Enter
   * follows, as in the lists; the rest of the row stands in for it, for the
   * mouse. An entry no entity holds has no card to lead to.
   */
  private rowMarkup(entry: AttachedEntry, roles: string[]): string {
    const entity = this.entityOf(entry);
    const href = entity ? EntityList.entryHref(entity, entry.label) : '';
    const cells = roles.map((role, index) => {
      const shown =
        index === 0
          ? (role === 'identifier' ? '' : entry.values?.[role]) || entry.label
          : this.value(entity, role, entry.values?.[role]);
      const content =
        index === 0 && href
          ? `<a class="dc-row-link" href="${escapeHtml(href)}">${escapeHtml(
              shown
            )}</a>`
          : escapeHtml(shown);
      return `<td title="${escapeHtml(shown)}">${content}</td>`;
    });
    return `<tr${href ? ` data-href="${escapeHtml(href)}"` : ''}>${cells.join(
      ''
    )}</tr>`;
  }

  /** A value as the lists show it: a pointer by the name of its target. */
  private value(
    entity: EntityDescriptor | undefined,
    role: string,
    value: string | undefined
  ): string {
    if (!entity || value === undefined) return '';
    const { language } = this.options.translator;
    const name = this.attribute(entity, role);
    const attr = name ? entity.schema.attributes[name] : undefined;
    return (
      (name && ownValueLabel(entity, name, value, language)) ||
      displayValue(attr, value, this.options.pointerLabel, language)
    );
  }

  /**
   * What the server left out, said where the table stops: a department
   * whose card lists fifty names otherwise reads as a department of fifty.
   */
  private moreMarkup(): string {
    const { members, translator } = this.options;
    return `<p class="dc-muted" role="status">${escapeHtml(
      members.more === undefined
        ? translator.t('detail.moreUncounted')
        : translator.t('detail.more', { count: members.more })
    )}</p>`;
  }

  /**
   * Make the tables work: a row opens its card, a New … here button the
   * creation of an entry here.
   *
   * @param container element the tables were drawn in
   */
  bind(container: HTMLElement): void {
    for (const row of Array.from(
      container.querySelectorAll<HTMLElement>('[data-attached] tr[data-href]')
    ))
      row.addEventListener('click', event => {
        // The link follows itself, into this tab or, with Ctrl, a new one.
        if ((event.target as HTMLElement).closest('.dc-row-link')) return;
        this.options.onOpen(row.dataset.href as string);
      });
    for (const button of Array.from(
      container.querySelectorAll<HTMLElement>('[data-create-attached]')
    ))
      button.addEventListener('click', () =>
        this.options.onCreate?.[
          button.dataset.createAttached as AttachedKind
        ]?.()
      );
  }
}
