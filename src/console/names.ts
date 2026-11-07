/**
 * What the console calls things: a collection, an entry on a card or in a
 * list, a new entry in a toast, a person as a colleague names them, and the
 * names of what pointers land on (#220).
 *
 * The entities and the translator change over the console's life — a
 * language switch, a directory read again — so they are asked each time,
 * never copied.
 *
 * @module twake-directory-manager/console/names
 */

import {
  isLarge,
  roleAttribute,
  type ConsoleApiClient,
} from '../api/ConsoleApiClient';
import { attachedEntity } from '../components/AttachedTables';
import {
  comparableDn,
  entryValue,
  ownValueLabel,
  pointerLabel,
  resolveText,
} from '../format';
import type { Translator } from '../i18n';
import type { EntityDescriptor, Entry } from '../types';

/** What naming asks of the console. */
export interface NameDeps {
  /** The client of ldap-rest */
  readonly api: ConsoleApiClient;
  /** The entities the directory serves, as discovered */
  entities(): EntityDescriptor[];
  /** The translator of the interface's language now */
  translator(): Translator;
}

export class Names {
  /** @param deps the console, as naming sees it */
  constructor(private readonly deps: NameDeps) {}

  /**
   * An entry named as its card and its list name it: a nomenclature's by the
   * label its schema gives it, _Members only_ for `memberRestrictedList`.
   *
   * @param entity the entity the entry belongs to
   * @param id the entry's main attribute value
   * @returns the name
   */
  entryName(entity: EntityDescriptor, id: string): string {
    return (
      ownValueLabel(
        entity,
        entity.mainAttribute,
        id,
        this.deps.translator().language
      ) || id
    );
  }

  /**
   * A new entry named by its full name, else as its card names it.
   *
   * @param entity the entity the entry belongs to
   * @param values what the form sent
   * @param id the entry's main attribute value; empty when unknown
   * @returns the name, empty when the form gave none
   */
  submittedName(
    entity: EntityDescriptor,
    values: Record<string, string | string[]>,
    id: string
  ): string {
    const display = roleAttribute(entity.schema, 'displayName');
    const full = display ? values[display] : undefined;
    return (
      (Array.isArray(full) ? full[0] : full)?.trim() ||
      (id ? this.entryName(entity, id) : '')
    );
  }

  /**
   * A person as a colleague names them: their full name, else the name
   * {@link entryName} gives.
   *
   * @param entity the entity the entry belongs to
   * @param entry the entry as read
   * @param id the entry's main attribute value
   * @returns the name
   */
  personName(entity: EntityDescriptor, entry: Entry, id: string): string {
    const display = roleAttribute(entity.schema, 'displayName');
    const full = display
      ? [entryValue(entry, display) ?? []].flat()[0]
      : undefined;
    return full && String(full).trim()
      ? String(full).trim()
      : this.entryName(entity, id);
  }

  /**
   * The first value of the attribute playing a role, trimmed.
   *
   * @param entity the entity the entry belongs to
   * @param entry the entry as read
   * @param role the role its schema gives the attribute
   * @returns the value, or undefined when the entry has none
   */
  roleValue(
    entity: EntityDescriptor,
    entry: Entry,
    role: string
  ): string | undefined {
    const attribute = roleAttribute(entity.schema, role);
    const value = attribute
      ? [entryValue(entry, attribute) ?? []].flat()[0]
      : undefined;
    return value && String(value).trim() ? String(value).trim() : undefined;
  }

  /**
   * What to call a collection: the schema's label in the current language,
   * falling back to the name the schema gives it.
   *
   * @param entity entity to name
   * @returns the plural name to show
   */
  plural(entity: EntityDescriptor): string {
    const translator = this.deps.translator();
    return (
      resolveText(entity.label, translator.language) ||
      // The organization tree is the one collection the product itself names,
      // because it is the product that draws it.
      (entity.kind === 'organization'
        ? translator.t('tree.title')
        : entity.pluralName)
    );
  }

  /**
   * Readable names of what the attached entries point at — a position, a
   * state, a type of group — read for both the accounts and the groups.
   *
   * @returns a name for a DN, undefined when none is known
   */
  async attachedNames(): Promise<(dn: string) => string | undefined> {
    const named = await Promise.all(
      (['people', 'groups'] as const)
        .map(kind => attachedEntity(this.deps.entities(), kind))
        .filter((entity): entity is EntityDescriptor => !!entity)
        .map(entity => this.pointerNames(entity))
    );
    return (dn: string): string | undefined =>
      named.map(name => name(dn)).find(Boolean);
  }

  /**
   * How a card or a list names the entries an entity's pointers land on.
   *
   * A schema names a nomenclature's values itself, and `pointerLabel` reads
   * them there. An entry that carries its own name — a mail domain, stored
   * as `dc=sales` and called `sales.example.org` — has to be read:
   * its branch is listed, as the form's select lists it, when its entity
   * marks a display name and is small enough to list. Read on every view
   * rather than kept, so a domain renamed a moment ago reads renamed. A
   * branch that cannot be read leaves its entries named by their RDN.
   *
   * @param entity the entity whose entries are shown
   * @returns the names, by DN, falling back on the schema's
   */
  async pointerNames(
    entity: EntityDescriptor
  ): Promise<(dn: string) => string | undefined> {
    const { api } = this.deps;
    const entities = this.deps.entities();
    const { language } = this.deps.translator();
    const branches = new Set<string>();
    for (const attr of Object.values(entity.schema.attributes)) {
      if (attr.type !== 'pointer' && attr.items?.type !== 'pointer') continue;
      for (const branch of attr.branch || attr.items?.branch || []) {
        const owner = entities.find(
          candidate =>
            candidate.base &&
            comparableDn(candidate.base) === comparableDn(branch)
        );
        if (
          owner &&
          !isLarge(owner) &&
          roleAttribute(owner.schema, 'displayName')
        )
          branches.add(owner.base);
      }
    }
    const names = new Map<string, string>();
    await Promise.all(
      [...branches].map(async branch => {
        try {
          const options = await api.pointerOptions(branch, entities, language);
          for (const { dn, label } of options)
            names.set(comparableDn(dn), label);
        } catch {
          // Named by their RDN, as before the branch was read.
        }
      })
    );
    return (dn: string): string | undefined =>
      names.get(comparableDn(dn)) ?? pointerLabel(entities, dn, language);
  }
}
