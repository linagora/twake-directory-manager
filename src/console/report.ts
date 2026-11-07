/**
 * What the console does with a failure nobody waits for: log it, say it in a
 * toast, and hand it to the page's own hook. A failure in showing or
 * reporting it is logged rather than thrown back into the boundary that
 * called here.
 *
 * @module twake-directory-manager/console/report
 */

import type { Reporter } from '../shared/background';

/**
 * Build the console's reporter.
 *
 * @param t the translator's `t`, in the interface's language now
 * @param toast show a message, a refusal interrupting
 * @param onError the page's own hook, when it gave one
 * @returns what `background` calls when a task fails
 */
export function consoleReporter(
  t: (key: string, values?: Record<string, string | number>) => string,
  toast: (message: string, isError?: boolean) => void,
  onError?: (error: unknown, context: string) => void
): Reporter {
  return (error, context): void => {
    try {
      console.error('[twake-directory-manager]', context, error);
      const cause =
        error instanceof Error
          ? error.message
          : typeof error === 'string'
            ? error
            : '';
      toast(cause ? t('app.failed', { cause }) : t('app.error'), true);
    } catch (shown) {
      // A `message` getter that throws, a toast element gone: logged.
      console.error('[twake-directory-manager] toast', shown);
    }
    try {
      onError?.(error, context);
    } catch (hook) {
      // The hook's own failure is not reported through itself.
      console.error('[twake-directory-manager] onError', hook);
    }
  };
}
