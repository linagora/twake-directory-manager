import AxeBuilder from '@axe-core/playwright';
import { type Page, expect, test } from '@playwright/test';
import type { AxeResults, Result } from 'axe-core';

/** What a scan may leave out: a selector, with a comment saying why. */
export interface ScanOptions {
  exclude?: string[];
}

/**
 * Run axe-core against WCAG 2.2 AA on the page as it stands. A rule runs when
 * it carries one of the listed tags, so every level and version up to 2.2 AA
 * is named: a rule tagged only `wcag21a` (label in name, 2.5.3) would
 * otherwise never run. Rules outside the WCAG tags (best practices) are left
 * out: the gate is the standard, not axe's opinions.
 */
async function analyze(page: Page, options: ScanOptions): Promise<AxeResults> {
  let builder = new AxeBuilder({ page }).withTags([
    'wcag2a',
    'wcag2aa',
    'wcag21a',
    'wcag21aa',
    'wcag22a',
    'wcag22aa',
  ]);
  for (const selector of options.exclude ?? [])
    builder = builder.exclude(selector);
  return builder.analyze();
}

/**
 * One line for a rule: how many elements and the first of them, so that a
 * failure names what to fix.
 */
function line(result: Result): string {
  const targets = result.nodes
    .slice(0, 3)
    .map(node => {
      // What axe measured, for a contrast: the colours and the ratio.
      const data = node.any[0]?.data as
        | { fgColor?: string; bgColor?: string; contrastRatio?: number }
        | undefined;
      const measured = data?.contrastRatio
        ? ` (${data.fgColor} on ${data.bgColor}: ${data.contrastRatio})`
        : '';
      return node.target.join(' ') + measured;
    })
    .join(', ');
  return `${result.id} [${result.impact ?? '?'}]: ${result.help} — ${result.nodes.length} × ${targets}`;
}

/**
 * What axe-core finds broken on the page, one line per rule.
 */
export async function violations(
  page: Page,
  options: ScanOptions = {}
): Promise<string[]> {
  return (await analyze(page, options)).violations.map(line);
}

/**
 * The page passes axe-core's WCAG 2.2 AA rules. The scan waits for nothing on
 * the page to say it is busy (a select filled after the form is drawn says
 * `aria-busy`, and a disabled control is exempt from the contrast rule), so
 * that what it judges is the settled page, every time. What axe could not
 * decide — a contrast over an overlap, over a background image — is neither a
 * pass nor a failure: it is annotated on the test, for a reader of the report.
 * Exclude a selector only with a comment that says why (a false positive on a
 * custom widget), and review the exclusions.
 */
export async function expectAccessible(
  page: Page,
  options: ScanOptions = {}
): Promise<void> {
  await expect(page.locator('[aria-busy="true"]')).toHaveCount(0);
  // A panel sliding in, a token fading in: a colour measured mid-transition
  // is neither the one before nor the one after. Scanned once they are done.
  await page.evaluate(() =>
    Promise.allSettled(
      document.getAnimations().map(animation => animation.finished)
    )
  );
  const results = await analyze(page, options);
  if (results.incomplete.length > 0)
    test.info().annotations.push({
      type: 'axe incomplete',
      description: results.incomplete.map(line).join('; '),
    });
  expect(results.violations.map(line), 'axe violations').toEqual([]);
}

/**
 * Whether every scenario scans the states it reaches, through the page
 * objects: `E2E_A11Y_EVERYWHERE=1`. Off by default, since each scan costs
 * about half a second and `a11y.spec.ts` scans the states on its own; on, a
 * run says where a view a scenario reaches breaks a rule (#226, step 4).
 */
export const SCAN_EVERYWHERE = process.env.E2E_A11Y_EVERYWHERE === '1';

/**
 * Scan the page where a page object has just found the state it expects, when
 * asked to scan everywhere; nothing otherwise.
 *
 * @param page the page
 */
export async function scanHere(page: Page): Promise<void> {
  if (SCAN_EVERYWHERE) await expectAccessible(page);
}
