import { defineConfig, devices } from '@playwright/test';

import { env, hostResolverRules } from './support/env';

const isCI = process.env.CI !== undefined && process.env.CI !== '';

type TraceMode = 'on' | 'off' | 'retain-on-failure' | 'on-first-retry';
const TRACE_MODES: readonly TraceMode[] = [
  'on',
  'off',
  'retain-on-failure',
  'on-first-retry',
];

function traceMode(raw: string | undefined): TraceMode {
  return TRACE_MODES.find(mode => mode === raw) ?? 'retain-on-failure';
}

/**
 * One retry by default: on a Docker host, Chromium aborts the requests in flight with
 * net::ERR_NETWORK_CHANGED whenever a container joins or leaves any network of the host (another
 * stack starting). Playwright reports a test that passed on its retry as flaky — and in CI, where
 * the stack is up before the first test and nothing else starts, a flaky test fails the run
 * (`failOnFlakyTests`): one that passes only on retry would otherwise go unseen for good.
 */
function retries(raw: string | undefined): number {
  const parsed = Number(raw);
  return raw !== undefined && Number.isInteger(parsed) && parsed >= 0
    ? parsed
    : 1;
}

function workers(raw: string | undefined): number | undefined {
  const parsed = Number(raw);
  if (raw !== undefined && Number.isInteger(parsed) && parsed > 0) {
    return parsed;
  }
  return isCI ? 2 : 4;
}

/**
 * Twake Directory Manager e2e suite. Backend: e2e/scripts/start.sh. Conventions: e2e/README.md.
 * Backlog of scenarios: e2e/e2e.md.
 *
 * `export default` is what Playwright loads: the one exception to the named exports rule.
 */
export default defineConfig({
  testDir: './tests',
  outputDir: './test-results/artifacts',
  globalSetup: './support/global-setup.ts',
  fullyParallel: true,
  forbidOnly: isCI,
  retries: retries(process.env.E2E_RETRIES),
  failOnFlakyTests: isCI,
  workers: workers(process.env.E2E_WORKERS),
  timeout: 90_000,
  expect: { timeout: 10_000 },
  reporter: [
    isCI ? ['github'] : ['list'],
    ['html', { outputFolder: './playwright-report', open: 'never' }],
    ['junit', { outputFile: './test-results/junit.xml' }],
  ],
  use: {
    baseURL: env.baseUrl,
    locale: 'en-US',
    timezoneId: 'Europe/Paris',
    trace: traceMode(process.env.E2E_TRACE),
    video: 'retain-on-failure',
    screenshot: 'only-on-failure',
    headless: process.env.E2E_HEADLESS !== 'false',
    launchOptions: {
      slowMo: Number(process.env.E2E_SLOWMO ?? 0),
      // sso is Dex's container: its issuer is http://sso:<port>
      args: hostResolverRules(),
    },
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1280, height: 800 },
      },
    },
  ],
});
