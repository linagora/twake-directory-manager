/**
 * The groups a `memberOf` names, read in as few list calls as the server
 * takes: one per group entity and per batch of names, asking only what a
 * card shows — never their members.
 *
 * Names are batched so that a card of an account in hundreds of groups keeps
 * a URL a reverse proxy accepts, and an OR filter under the server's size
 * limit. A group whose name no raw filter can hold, or whose list fails, is
 * left out: the caller reads it one by one.
 *
 * @module twake-directory-manager/api/groupEntries
 */

import { comparableDn, parentDn, rdnValue } from '../format';
import type { EntityDescriptor, Entry } from '../types';

/** Groups asked for in one OR filter. */
const GROUP_FILTER_LIMIT = 50;

/**
 * A group's name a raw OR filter can hold. ldap-rest's `match` takes
 * `[\w*=()&|, .@'-]`, but a parenthesis or an asterisk would change what
 * the filter asks for, so those stay out too. A name outside this set is
 * read one by one rather than put in a filter built here.
 */
const FILTER_SAFE_NAME = /^[\w .@',-]+$/;

/** Reads one group entity's entries for the names its filter holds. */
export type GroupList = (
  entity: EntityDescriptor,
  names: string[]
) => Promise<Entry[]>;

/**
 * The groups the given DNs name, read through `list`.
 *
 * @param dns the groups' DNs, as `memberOf` gives them
 * @param entities entities the console knows: the groups among them are read
 * @param list reads one group entity's entries for the names given
 * @returns the groups the lists answered
 */
export async function readGroupEntries(
  dns: string[],
  entities: EntityDescriptor[],
  list: GroupList
): Promise<Entry[]> {
  const byEntity = new Map<EntityDescriptor, Set<string>>();
  for (const dn of dns) {
    const parent = parentDn(dn);
    const entity = entities.find(
      item =>
        item.kind === 'group' &&
        !!item.base &&
        !!parent &&
        comparableDn(item.base) === comparableDn(parent)
    );
    const name = rdnValue(dn);
    if (!entity || !FILTER_SAFE_NAME.test(name)) continue;
    const names = byEntity.get(entity) ?? new Set<string>();
    names.add(name);
    byEntity.set(entity, names);
  }
  const found = await Promise.all(
    [...byEntity].flatMap(([entity, names]) =>
      batches([...names]).map(names => list(entity, names))
    )
  );
  return found.flat();
}

/**
 * `items` in runs the filter can hold: a long URL is refused by a reverse
 * proxy, and a long OR filter may reach the server's size limit.
 *
 * @param items what to split
 * @returns the runs, each of at most {@link GROUP_FILTER_LIMIT}
 */
function batches<T>(items: T[]): T[][] {
  const runs: T[][] = [];
  for (let index = 0; index < items.length; index += GROUP_FILTER_LIMIT)
    runs.push(items.slice(index, index + GROUP_FILTER_LIMIT));
  return runs;
}
