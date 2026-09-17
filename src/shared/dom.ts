/**
 * DOM helpers, taken from ldap-rest's browser libraries.
 *
 * @module shared/dom
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
