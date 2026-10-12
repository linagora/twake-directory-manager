/**
 * Send the bare host to the console.
 *
 * The console is served under /static/console/, so `/` had no route and
 * answered Express's own "Cannot GET /": anyone typing the hostname landed
 * there, which is the first thing they saw of the product. Only `/` itself
 * is redirected; the API, the OIDC callback and every other path are left
 * alone.
 *
 * Loaded by the image through DM_CONSOLE_PLUGINS, by its path.
 */
import DmPlugin from 'ldap-rest/plugin';

export default class ConsoleRoot extends DmPlugin {
  constructor(...args) {
    super(...args);
    this.name = 'consoleRoot';
    this.roles = ['api'];
  }

  api(app) {
    // Where the static plugin serves its directory, which the image puts the
    // console in.
    const target = `/${this.config.static_name || 'static'}/console/`;
    // Temporary: a browser keeps a permanent redirect for good, and would
    // follow it still after the console moved.
    app.get('/', (req, res) => res.redirect(302, target));
  }
}
