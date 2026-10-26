/**
 * An entry's relations, as its card lists them: the members of a group,
 * the groups an account belongs to, each group with its type and whether
 * the caller may take the account out of it; and where a related entry's
 * card is. Read by the entry's card, and through the context by the
 * actions that need an entry's groups (Hand over); a group's type is said
 * by the group pickers too (#220).
 *
 * @module twake-directory-manager/console/relations
 */

import { roleAttribute } from '../api/ConsoleApiClient';
import {
  attributeLabel,
  comparableDn,
  displayValue,
  entryValue,
  parentDn as parentOf,
  pointerLabel,
  rdnValue,
} from '../format';
import type { EntityDescriptor, Entry } from '../types';
import type { ConsoleContext, Relations } from './context';

/**
 * Entries related to this one: the members of a group, the groups an account
 * belongs to. Both are read from roles, so an entity that models them under
 * other names still gets the section.
 *
 * An account's groups come from its `memberOf`, which only a directory
 * running OpenLDAP's `memberof` overlay fills in. Without it they are
 * searched among the groups; a search that fails leaves the section empty
 * rather than the card unshown.
 *
 * @param ctx the console, for its client, its entities, its words and its
 *   rights
 * @param entity the entry's entity
 * @param entry the entry, as read
 * @param strict whether a group entity that cannot be searched fails the
 * search, which then says `unknown` rather than no group: what is to be
 * done to every group, as a hand-over, cannot take one for the other
 */
export async function readRelations(
  ctx: ConsoleContext,
  entity: EntityDescriptor,
  entry: Entry,
  strict = false
): Promise<Relations | undefined> {
  let unknown = false;
  for (const role of ['members', 'groupMemberships']) {
    for (const [name, attr] of Object.entries(entity.schema.attributes)) {
      const roles = Array.isArray(attr.role) ? attr.role : [attr.role];
      if (!roles.includes(role)) continue;
      const raw = entryValue(entry, name);
      let list = raw === undefined ? [] : Array.isArray(raw) ? raw : [raw];
      if (role === 'groupMemberships' && !list.length && entry.dn)
        list = await ctx.api
          .memberships(entry.dn, ctx.entities(), strict)
          .catch(() => {
            unknown = strict;
            return [];
          });
      // An empty value stands for no member in some directories: it is
      // neither counted nor offered a ×, as the deletion's count skips it.
      const items = list
        .filter(dn => String(dn).trim())
        .map(dn => ({
          id: String(dn),
          label: rdnValue(String(dn)),
        }));
      if (role === 'members')
        return {
          title: attributeLabel(name, attr, ctx.translator().language),
          attribute: name,
          items,
        };
      // Groups, whatever the schema calls them: a deployment's "Mailing
      // lists" listed shared mailboxes and simple groups as well.
      return {
        title: ctx.t('groups.section'),
        attribute: name,
        items: await groupItems(ctx, items),
        groups: true,
        ...(unknown ? { unknown } : {}),
      };
    }
  }
  return undefined;
}

/**
 * An account's groups, each with its type and whether the caller may take
 * the account out of it. Each group is read for that, all at once; one
 * that cannot be read is named alone, and offers no ×.
 *
 * @param ctx the console
 * @param items the groups, by DN and name
 * @returns the same groups, said in full
 */
function groupItems(
  ctx: ConsoleContext,
  items: { id: string; label: string }[]
): Promise<
  { id: string; label: string; note?: string; removable?: boolean }[]
> {
  return Promise.all(
    items.map(async item => {
      const owner = groupEntity(ctx.entities(), item.id);
      if (!owner) return item;
      let group: Entry;
      try {
        group = await ctx.api.get(owner, item.label);
      } catch {
        return item;
      }
      const note = groupType(
        ctx.entities(),
        ctx.translator().language,
        owner,
        group
      );
      return {
        ...item,
        ...(note ? { note } : {}),
        removable: ctx.rights().writes(owner, group),
      };
    })
  );
}

/**
 * The group entity whose branch holds a DN.
 *
 * @param entities the entities the directory serves
 * @param dn the group
 */
export function groupEntity(
  entities: EntityDescriptor[],
  dn: string
): EntityDescriptor | undefined {
  const parent = parentOf(dn);
  return parent
    ? entities.find(
        entity =>
          entity.kind === 'group' &&
          entity.base &&
          comparableDn(entity.base) === comparableDn(parent)
      )
    : undefined;
}

/**
 * A group's type — _Mailing list_, _Shared mailbox_ — named as its card
 * names it, from the nomenclature's own labels.
 *
 * @param entities the entities the directory serves
 * @param language the interface's language
 * @param entity the groups' entity
 * @param group the group as read
 * @returns its type, or nothing for a schema or a group with none
 */
export function groupType(
  entities: EntityDescriptor[],
  language: string,
  entity: EntityDescriptor,
  group: Entry
): string {
  const type = roleAttribute(entity.schema, 'mailboxType');
  const value = type ? [entryValue(group, type) ?? []].flat()[0] : undefined;
  if (!type || !value) return '';
  return displayValue(
    entity.schema.attributes[type],
    String(value),
    dn => pointerLabel(entities, dn, language),
    language
  );
}

/**
 * The card of a related entry, in whichever entity owns its DN.
 *
 * @param entities the entities the directory serves
 * @param dn the related entry
 * @returns its address, none when no entity holds it
 */
export function relationHref(
  entities: EntityDescriptor[],
  dn: string
): string | undefined {
  const owner = entities.find(
    entity =>
      entity.base && dn.toLowerCase().endsWith(`,${entity.base.toLowerCase()}`)
  );
  if (!owner) return undefined;
  // `rdnValue`, not a split on the first comma: `cn=Smith\, John,…` holds
  // one, and the truncated id it produced answered "no longer exists".
  const id = rdnValue(dn);
  return `#/${owner.key}/${encodeURIComponent(id)}`;
}
