import AxeBuilder from '@axe-core/playwright';
import { type Page, expect } from '@playwright/test';

/**
 * What axe-core finds against WCAG 2.2 AA on the page as it stands: one line
 * per rule broken, with how many elements and the first of them, so that a
 * failure names what to fix. Rules outside the WCAG tags (best practices) are
 * left out: the gate is the standard, not axe's opinions.
 */
export async function violations(
  page: Page,
  options: { exclude?: string[] } = {}
): Promise<string[]> {
  let builder = new AxeBuilder({ page }).withTags([
    'wcag2a',
    'wcag2aa',
    'wcag21aa',
    'wcag22aa',
  ]);
  for (const selector of options.exclude ?? [])
    builder = builder.exclude(selector);
  const results = await builder.analyze();
  return results.violations.map(violation => {
    const targets = violation.nodes
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
    return `${violation.id} [${violation.impact ?? '?'}]: ${violation.help} — ${violation.nodes.length} × ${targets}`;
  });
}

/**
 * The page passes axe-core's WCAG 2.2 AA rules. Exclude a selector only with a
 * comment that says why (a false positive on a custom widget), and review the
 * exclusions.
 */
export async function expectAccessible(
  page: Page,
  options: { exclude?: string[] } = {}
): Promise<void> {
  expect(await violations(page, options), 'axe violations').toEqual([]);
}
