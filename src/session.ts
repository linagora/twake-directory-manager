/**
 * Getting a session back once the server has ended it, and what the reader
 * was typing when it did.
 *
 * @module twake-directory-manager/session
 */

const REAUTH_KEY = 'ldap-rest.console.reauthAt';
/** How long after a reload another `401` means a page nothing will sign in */
const REAUTH_WINDOW = 60_000;

const DRAFT_KEY = 'ldap-rest.console.draft';
/** How long after the sign-in again a draft is offered back */
const DRAFT_WINDOW = 15 * 60_000;

/**
 * What an open form held when the session ended, kept for it to be offered
 * back once signed in again: it survives the reload and the provider's round
 * trip, in `sessionStorage`, so that it is gone when the tab closes and never
 * picked up by another administrator on the same workstation.
 *
 * A password is never part of it.
 */
export interface Draft {
  /** When it was saved, in milliseconds since the epoch */
  at: number;
  /** Who was signed in, as the scope names them: another account's draft is not its own */
  user?: string;
  /** The page it was opened on, after `#/` */
  page: string;
  /** The entity's key */
  entity: string;
  /** The organization a new entry goes under, or the DN of the entry edited */
  dn?: string;
  /** What the form held that its entry did not: values by attribute */
  values: Record<string, string[]>;
  /** Attributes the form emptied */
  cleared: string[];
}

/**
 * Keep a form's draft across the reload of a sign-in again.
 *
 * @param draft what the form held and where it was
 */
export function saveDraft(draft: Draft): void {
  try {
    sessionStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
  } catch {
    // Without storage, the form is lost as it was before: nothing to say
  }
}

/**
 * Take the draft kept, if it is recent and was kept by the same account, and
 * drop it: offered once, to the one signing in again.
 *
 * A draft kept for someone else, or too old, is dropped all the same: it is
 * not to linger in the tab once it has been seen.
 *
 * @param user who is signed in now, as the scope names them
 * @param now current time, in milliseconds
 * @returns the draft to offer back, or null
 */
export function takeDraft(
  user: string | undefined,
  now = Date.now()
): Draft | null {
  let raw: string | null;
  try {
    raw = sessionStorage.getItem(DRAFT_KEY);
    sessionStorage.removeItem(DRAFT_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const draft = JSON.parse(raw) as Partial<Draft>;
    if (
      typeof draft.page !== 'string' ||
      typeof draft.entity !== 'string' ||
      !draft.values ||
      typeof draft.values !== 'object'
    )
      return null;
    if (now - Number(draft.at) > DRAFT_WINDOW) return null;
    if ((draft.user || undefined) !== (user || undefined)) return null;
    const values: Record<string, string[]> = {};
    for (const [name, list] of Object.entries(draft.values))
      if (Array.isArray(list)) values[name] = list.map(String);
    return {
      at: Number(draft.at),
      ...(draft.user ? { user: draft.user } : {}),
      page: draft.page,
      entity: draft.entity,
      ...(typeof draft.dn === 'string' ? { dn: draft.dn } : {}),
      values,
      cleared: Array.isArray(draft.cleared) ? draft.cleared.map(String) : [],
    };
  } catch {
    // What was kept is not a draft: nothing to offer back
    return null;
  }
}

/** Drop the draft kept, if any: it was saved, or its form closed. */
export function forgetDraft(): void {
  try {
    sessionStorage.removeItem(DRAFT_KEY);
  } catch {
    // Nothing was kept, or nothing can be: either way, nothing to drop
  }
}

/**
 * Load the page again after the server answered `401`, so the browser goes
 * through the sign-in.
 *
 * A `401` on a page the console could load means the session ended since: a
 * logout at the provider or in another application, which the server learned
 * through Back-Channel Logout, or a session that expired. Behind OpenID
 * Connect the page itself requires a session, so loading it again sends the
 * browser to the provider and back here. Once a minute at most: a page the
 * server serves without a session would answer `401` again after the reload,
 * and reloading on every one would never end.
 *
 * @param now current time, in milliseconds
 * @returns whether the page is being loaded again
 */
export function signInAgain(now = Date.now()): boolean {
  try {
    const last = Number(sessionStorage.getItem(REAUTH_KEY));
    if (last && now - last < REAUTH_WINDOW) return false;
    sessionStorage.setItem(REAUTH_KEY, String(now));
  } catch {
    // Without storage, nothing would stop the loop
    return false;
  }
  window.location.reload();
  return true;
}
