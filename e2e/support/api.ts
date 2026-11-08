import type { Page } from '@playwright/test';

export interface ApiAnswer {
  status: number;
  body: unknown;
}

/**
 * Whether the server serving this page delegates group membership: ldap-rest
 * lists the delegated groups in the scope from 2.2.0. The suite also runs
 * against the floor, 2.1.0, where the console and the group lists know no
 * delegation.
 */
export async function serverDelegatesGroups(page: Page): Promise<boolean> {
  const answer = await callApi(page, 'GET', '/api/v1/authz/scope');
  const scope = answer.body as { delegatedGroups?: unknown[] };
  return (scope.delegatedGroups?.length ?? 0) > 0;
}

/**
 * Calls the console's server from the page, with the page's session cookie, as a person
 * replaying a request from the browser would. Every call gives up after 8 s: an answer that
 * never comes fails the test instead of hanging it.
 */
export async function callApi(
  page: Page,
  method: string,
  path: string,
  body?: unknown
): Promise<ApiAnswer> {
  return page.evaluate(
    async ({ method, path, body }) => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8000);
      try {
        const response = await fetch(path, {
          method,
          headers:
            body === undefined ? {} : { 'Content-Type': 'application/json' },
          body: body === undefined ? undefined : JSON.stringify(body),
          signal: controller.signal,
          redirect: 'manual',
        });
        const text = await response.text();
        let parsed: unknown = text;
        try {
          parsed = JSON.parse(text);
        } catch {
          // not JSON: kept as text
        }
        return { status: response.status, body: parsed };
      } finally {
        clearTimeout(timer);
      }
    },
    { method, path, body }
  );
}
