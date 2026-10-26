/**
 * What the address names: the hash the console routes on, read into a route.
 * The frame's routing follows here as #220 moves it.
 *
 * @module twake-directory-manager/console/route
 */

/** The address of the password policies page, after `#/`. */
export const POLICIES_KEY = 'password-policies';

/** Where the console currently is. */
export interface Route {
  view: 'dashboard' | 'entity' | 'organizations' | 'policies';
  entity?: string;
  id?: string;
}

/**
 * Read `#/entity/id` into a route. A hash is typed, pasted and mailed around,
 * so it is not always the one `go()` wrote: `#/users/50%` throws out of
 * `decodeURIComponent`, and an exception here left the console on "Loading…"
 * for good. A segment that does not decode is taken as it stands.
 *
 * @param hash `window.location.hash`, `#` and all
 * @returns the route it names; the overview for an empty one
 */
export function routeOf(hash: string): Route {
  const [first, second] = hash
    .replace(/^#\/?/, '')
    .split('/')
    .map(segment => {
      try {
        return decodeURIComponent(segment);
      } catch {
        return segment;
      }
    });
  if (!first) return { view: 'dashboard' };
  if (first === 'organizations') return { view: 'organizations', id: second };
  if (first === POLICIES_KEY) return { view: 'policies' };
  return { view: 'entity', entity: first, id: second };
}
