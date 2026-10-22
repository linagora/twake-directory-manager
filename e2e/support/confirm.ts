import type { Page } from '@playwright/test';

/**
 * Answers the next native confirm() of the page (deletions, hand-overs) and gives its message:
 *
 *   const message = answerNextConfirm(page, true);
 *   await entry.action('Delete').click();
 *   expect(await message).toBe('Delete bob? This cannot be undone.');
 *
 * One dialog only: a listener left behind would silently answer the next ones.
 */
export function answerNextConfirm(
  page: Page,
  accept: boolean
): Promise<string> {
  return new Promise(resolve => {
    page.once('dialog', dialog => {
      const message = dialog.message();
      void (accept ? dialog.accept() : dialog.dismiss()).then(() =>
        resolve(message)
      );
    });
  });
}
