import { test } from '@playwright/test';

/**
 * Marks the running test as expected to fail because of an open issue of the QA campaign
 * (automation/twake-qa/twake-directory-manager, `critical_issues/<slug>.md`). The suite stays
 * green while the bug is there, and turns red the day it is fixed: then remove the call.
 */
export function knownIssue(slug: string): void {
  test.info().annotations.push({ type: 'known issue', description: slug });
  test.fail();
}
