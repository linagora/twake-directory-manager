/**
 * Getting a session back once the server has ended it.
 * @module session
 */

const REAUTH_KEY = 'ldap-rest.console.reauthAt';
/** How long after a reload another `401` means a page nothing will sign in */
const REAUTH_WINDOW = 60_000;

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
