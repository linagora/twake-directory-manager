/**
 * What the browser remembers of the reader's choices: the language, whether
 * the reference section was left open, the contrast. Read and written here
 * only, and never a reason to fail: a browser that refuses its storage (a
 * private window with it blocked) throws on the property itself, and the
 * console then goes by its defaults, or by what the system asks.
 *
 * @module twake-directory-manager/console/settings
 */

const LANGUAGE_KEY = 'ldap-rest.console.language';
const REFERENCE_OPEN_KEY = 'ldap-rest.console.referenceOpen';
/** The reader's choice of contrast: `high`, `standard`, or none (the system's). */
const CONTRAST_KEY = 'ldap-rest.console.contrast';
/** The system's wish for more contrast, followed until the reader chooses. */
const MORE_CONTRAST = '(prefers-contrast: more)';

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Refused: the choice holds for this page, and is asked again next time.
  }
}

/** The language of the last visit, if any. */
export function storedLanguage(): string | undefined {
  return read(LANGUAGE_KEY) || undefined;
}

export function rememberLanguage(code: string): void {
  write(LANGUAGE_KEY, code);
}

/** Whether the reader left the reference section open last time. */
export function referenceOpen(): boolean {
  return read(REFERENCE_OPEN_KEY) === '1';
}

export function rememberReference(open: boolean): void {
  write(REFERENCE_OPEN_KEY, open ? '1' : '');
}

/**
 * Whether the high-contrast colours are on: as the reader chose, else as the
 * system asks (#210).
 */
export function highContrast(): boolean {
  const stored = read(CONTRAST_KEY);
  if (stored === 'high') return true;
  if (stored === 'standard') return false;
  return typeof matchMedia === 'function' && matchMedia(MORE_CONTRAST).matches;
}

export function rememberContrast(on: boolean): void {
  write(CONTRAST_KEY, on ? 'high' : 'standard');
}

/**
 * Tell when the system's wish for contrast changes; the reader's own choice,
 * once made, is read by `highContrast` over it.
 *
 * @param listener what to run then
 */
export function onContrastChange(listener: () => void): void {
  if (typeof matchMedia !== 'function') return;
  matchMedia(MORE_CONTRAST).addEventListener?.('change', listener);
}
