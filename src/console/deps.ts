/**
 * What the console would build itself, given instead: the client, which a
 * test replaces with one answering from fixtures (#221). What #220's
 * `ConsoleContext` grows from.
 *
 * @module twake-directory-manager/console/deps
 */

import type { ConsoleApiClient } from '../api/ConsoleApiClient';

export interface ConsoleDeps {
  api?: ConsoleApiClient;
}
