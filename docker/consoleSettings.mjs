/**
 * Tell the console what the deployment decided about it.
 *
 * The console reads everything from ldap-rest's config API, under
 * `features`; this plugin adds `features.console`. What it carries:
 *
 * - `hiddenAttributes`, from DM_CONSOLE_HIDDEN_ATTRIBUTES (comma-separated):
 *   attributes the console leaves out of its forms, cards, lists and CSV
 *   files. The Twake schemas describe attributes nothing in a given
 *   deployment acts on, and an administrator filling one in expects an
 *   effect there is none of.
 *
 * - `fullNameFormat`, from DM_CONSOLE_FULL_NAME_FORMAT: how a form writes a
 *   full name from its parts, `{givenName}` and `{surname}` standing for the
 *   attributes of those schema roles — `{surname} {givenName}` where the
 *   family name comes first. Empty leaves it to the console's own default.
 *
 * - `appList`, from DM_CONSOLE_APP_LIST: the Workplace's applications the
 *   header offers (#392), a JSON array in Twake Calendar's `appList`
 *   format, `[{ "name": "Mail", "link": "https://…", "icon": "https://…" }]`.
 *   Unset, or not a JSON array, offers none; the console leaves out an
 *   entry without a name or whose link or icon is no web address.
 *
 * Read from the environment rather than from ldap-rest's configuration,
 * which only parses the options ldap-rest itself declares.
 *
 * Loaded by the image through DM_CONSOLE_PLUGINS, by its path.
 */
import DmPlugin from 'ldap-rest/plugin';

/**
 * DM_CONSOLE_APP_LIST, read: a JSON array, or none.
 *
 * @param {string | undefined} value the variable
 * @returns {unknown[]} the applications, unchecked: the console checks them
 */
export function appList(value) {
  if (!value || !value.trim()) return [];
  try {
    const list = JSON.parse(value);
    if (Array.isArray(list)) return list;
  } catch {
    // Said below, as for a value that parses to something else.
  }
  console.warn(
    'DM_CONSOLE_APP_LIST is not a JSON array: no application offered'
  );
  return [];
}

export default class ConsoleSettings extends DmPlugin {
  constructor(...args) {
    super(...args);
    this.name = 'consoleSettings';
    this.roles = ['configurable'];
    this.configApiKey = 'console';
  }

  getConfigApiData() {
    return {
      hiddenAttributes: (process.env.DM_CONSOLE_HIDDEN_ATTRIBUTES || '')
        .split(',')
        .map(name => name.trim())
        .filter(Boolean),
      fullNameFormat: process.env.DM_CONSOLE_FULL_NAME_FORMAT || '',
      appList: appList(process.env.DM_CONSOLE_APP_LIST),
    };
  }
}
