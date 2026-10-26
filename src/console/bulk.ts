/**
 * What the list's bulk actions share, Add to a group… in
 * `actions/groups.ts` and Change state… in `actions/state.ts`: the
 * accounts of the selection the caller writes, and the panel an action
 * holds while its work runs (#220).
 *
 * @module twake-directory-manager/console/bulk
 */

import type { Translator } from '../i18n';
import type { Rights } from '../rights';
import type { EntityDescriptor, Entry } from '../types';
import type { PanelService } from './panel';

/** The panel one bulk action opened, followed until it settles. */
export interface BulkPanel {
  /** Whether the panel is still the action's */
  own(): boolean;
  /** The work begins: the panel is held until it ends */
  start(): void;
  /** The work ends, having changed something or not */
  finish(changed: boolean): void;
  /** Whether anything changed, once the panel is closed and the work done */
  settled: Promise<boolean>;
}

/**
 * The accounts selected that the caller writes, and how many others were
 * left out: an account in transit, or in a branch only read, is listed
 * as well, and its card offers neither action.
 *
 * @param rights what the caller may do
 * @param translator the words of the sentence saying who was left out
 * @param entity the entity listed
 * @param selected the selection, by identifier
 */
export function bulkWritable(
  rights: Rights,
  translator: Translator,
  entity: EntityDescriptor,
  selected: [string, Entry][]
): { kept: [string, Entry][]; leftOut: string | undefined } {
  const kept = selected.filter(
    ([, entry]) => entry.dn && rights.writes(entity, entry)
  );
  const count = selected.length - kept.length;
  return {
    kept,
    leftOut: count ? translator.t('bulk.leftOut', { count }) : undefined,
  };
}

/**
 * Opened for one action: the panel's close, or its replacement, settles
 * it unless its work is under way, which settles it once done. Called once
 * the action's panel is open.
 *
 * @param panel the side panel
 * @returns `own`, whether the panel is still the action's, `start` and
 *   `finish` around the work, and `settled`, its outcome once known
 */
export function bulkPanel(panel: PanelService): BulkPanel {
  let closed = false;
  let running = false;
  let changed = false;
  let settle = (_changed: boolean): void => undefined;
  const settled = new Promise<boolean>(resolve => (settle = resolve));
  panel.whenClosed((): void => {
    closed = true;
    if (!running) settle(changed);
  });
  return {
    own: () => !closed,
    start: (): void => {
      running = true;
      // Escape and Cancel would leave the work going, unseen; a reload
      // would stop it halfway, and the browser asks first.
      panel.setGuard((): boolean => !running);
      panel.setDirty((): boolean => running);
    },
    finish: (done: boolean): void => {
      running = false;
      changed ||= done;
      if (closed) settle(changed);
      else {
        panel.setGuard(null);
        panel.setDirty(null);
      }
    },
    settled,
  };
}
