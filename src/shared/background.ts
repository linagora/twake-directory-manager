/**
 * Work the console starts without waiting for it.
 *
 * Much of what the console does is fired from a listener and left to run:
 * drawing a view again after a save, counting what waits in transit,
 * following a change of address. Left as a bare promise, such work that
 * fails — an exception in new code, an answer shaped otherwise than
 * expected — rejects with nobody listening: a panel stays half drawn, a
 * button stays disabled, and the administrator sees nothing explaining it.
 * Every such start goes through `background`, which hands a failure to the
 * reporter it is given; the console's reporter shows it, logs it and passes
 * it to the page embedding the console (`ConsoleOptions.onError`).
 *
 * @module twake-directory-manager/shared/background
 */

/** Told what failed, and in which part of the console (`context`). */
export type Reporter = (error: unknown, context: string) => void;

/**
 * The reporter a component falls back on when the page gave it none: the
 * failure is at least on the console, with the context naming its source.
 */
export const logReporter: Reporter = (error, context): void => {
  console.error('[twake-directory-manager]', context, error);
};

/**
 * Run `task` without waiting for it, and report its failure.
 *
 * The task starts at once, on the caller's tick, as the bare promise did:
 * what it sets before its first `await` (a generation ticket, a busy flag)
 * is set when `background` returns. What it throws synchronously is reported
 * like a rejection. A reporter that throws is logged rather than thrown
 * back: a rejection raised from inside the report would reach the page's
 * global handlers, which report it again through the same reporter.
 *
 * @param task what to run; its value, if any, is dropped
 * @param context where the task was started, for the report
 * @param report told of a failure; the console's own, or the log
 */
export function background(
  task: () => Promise<unknown> | unknown,
  context: string,
  report: Reporter = logReporter
): void {
  const tell = (err: unknown): void => {
    try {
      report(err, context);
    } catch (failed) {
      logReporter(failed, `${context} (reporting)`);
    }
  };
  let result: unknown;
  try {
    result = task();
  } catch (err) {
    tell(err);
    return;
  }
  Promise.resolve(result).then(undefined, tell);
}

/**
 * The bundles as the build names them (`rollup.config.mjs`), with or without
 * a query string after: `twake-directory-manager.esm.js?v=…`, `.js`, `.min.js`.
 * The name alone would also match a page served from a host or a path that
 * carries it.
 */
const BUNDLE = /\btwake-directory-manager(?:\.esm|\.min)?\.js\b/;

/**
 * Whether an error escaped from the console's own code, as far as its
 * stack trace tells.
 *
 * The console registers for the page's uncaught errors and unhandled
 * rejections, to report what slipped past `background`. A page embedding
 * the console has errors of its own, which are none of the console's to
 * show: only an error whose stack names the console's bundle is taken. A
 * page that bundles the console under another name (an `import` from the
 * npm package, through the page's own bundler), or an error without a
 * stack, is left alone — the global handlers then report nothing, and
 * `background` still reports what goes through it.
 *
 * @param error what the page reported
 * @returns true when a frame of its stack is in the console's bundle
 */
export function fromConsole(error: unknown): boolean {
  const stack = (error as { stack?: unknown } | null)?.stack;
  return typeof stack === 'string' && BUNDLE.test(stack);
}
