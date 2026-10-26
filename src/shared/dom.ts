/**
 * DOM helpers, taken from ldap-rest's browser libraries.
 *
 * @module twake-directory-manager/shared/dom
 */

/**
 * Escape HTML special characters to prevent XSS attacks
 * Reference: https://cheatsheetseries.owasp.org/cheatsheets/DOM_based_XSS_Prevention_Cheat_Sheet.html
 */
export function escapeHtml(text: string | null | undefined): string {
  if (text == null) return '';
  const map: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#x27;',
    '/': '&#x2F;',
  };
  return String(text).replace(/[&<>"'/]/g, m => map[m]);
}

/**
 * Convert camelCase or snake_case to Title Case
 */
export function toTitleCase(text: string): string {
  const label = text.replace(/([A-Z])/g, ' $1').replace(/_/g, ' ');
  return label.charAt(0).toUpperCase() + label.slice(1);
}

/**
 * A value written into an attribute selector, `[data-id="…"]`: its quotes
 * and backslashes escaped.
 *
 * @param value the value
 * @returns what goes between the quotes
 */
export function selectorValue(value: string): string {
  return value.replace(/["\\]/g, '\\$&').replace(
    // A control character ends a CSS string: written as its code point.
    // eslint-disable-next-line no-control-regex
    /[\x00-\x1f\x7f]/g,
    character => `\\${character.charCodeAt(0).toString(16)} `
  );
}
