/**
 * What a view or an action is given of the console, instead of reaching into
 * it: the client, the words, the rights, the panel and the dialog, the toast
 * and the reporter, the ticket of the page drawn (#220).
 *
 * @module twake-directory-manager/console/context
 */

import type { ConsoleApiClient } from '../api/ConsoleApiClient';
import type { Translator } from '../i18n';
import type { Rights } from '../rights';
import type { Reporter } from '../shared/background';
import type { DialogService } from './dialog';
import type { PanelService } from './panel';

/**
 * The console as a view sees it, built once in `init()` from its own fields
 * and methods. What changes over the console's life — the translator after
 * a language switch, the rights once the scope is read — is asked each time
 * through a function, never copied: a view keeps the context, not what it
 * said.
 *
 * It holds what the views moved out so far need (the password policies), and
 * grows with each view and action moved out of `DirectoryConsole` (#220):
 * add a member when a moved method needs one, not before.
 */
export interface ConsoleContext {
  /** The client of ldap-rest */
  readonly api: ConsoleApiClient;
  /** The translator of the interface's language now */
  translator(): Translator;
  /** The translator's `t`, in the interface's language now */
  readonly t: (key: string, values?: Record<string, string | number>) => string;
  /** What the caller may do, read from the scope as it is now */
  rights(): Rights;
  /** Show a short message; a refusal interrupts the screen reader */
  toast(message: string, isError?: boolean): void;
  /** Where work nobody waits for ends when it fails (see `background`) */
  readonly report: Reporter;
  /** The side panel every form opens in */
  readonly panel: PanelService;
  /** The question asked before what cannot be taken back */
  readonly dialog: DialogService;
  /**
   * Whether the page this ticket was taken for is still the one asked for:
   * checked after every `await` of a view, so that a late answer never draws
   * over a newer page
   */
  current(generation: number): boolean;
  /** Title the browser tab after the page, or with the bare title for none */
  titlePage(name?: string): void;
  /** Draw the page the address names again, after a change of what it shows */
  refresh(): Promise<void>;
  /** Go to an address, as after `#/`: the hash change draws it */
  go(path: string): void;
}
