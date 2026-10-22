import type { Page } from '@playwright/test';

export interface ApiAnswer {
  status: number;
  body: unknown;
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
