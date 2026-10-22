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
 * Read from the environment rather than from ldap-rest's configuration,
 * which only parses the options ldap-rest itself declares.
 *
 * Loaded by the image through DM_CONSOLE_PLUGINS, by its path.
 */
import DmPlugin from 'ldap-rest/plugin';

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
    };
  }
}
