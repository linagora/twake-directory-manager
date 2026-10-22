import { Client } from 'ldapts';

import { STACK_FILE, env } from './env';

/**
 * Fails fast, with a hint, when the stack is not running: a broken stack would otherwise show
 * up as dozens of unrelated timeouts.
 */
async function probe(
  what: string,
  check: () => Promise<boolean>
): Promise<string | null> {
  try {
    return (await check()) ? null : `${what}: unexpected answer`;
  } catch (error: unknown) {
    const cause =
      error instanceof Error && error.cause instanceof Error
        ? ` (${error.cause.message})`
        : '';
    return `${what}: ${error instanceof Error ? error.message : String(error)}${cause}`;
  }
}

// Playwright loads globalSetup through its default export: the one exception to named exports
export default async function globalSetup(): Promise<void> {
  const stack = env.stack;
  if (stack === null) {
    throw new Error(
      `No e2e stack: ${STACK_FILE} is missing.\n` +
        'Build the image with ../scripts/qa-environment/build.sh, then start the stack with ./scripts/start.sh'
    );
  }
  const problems = (
    await Promise.all([
      // 302: the console's server is up and sends a browser without a session to Dex
      probe(
        `console ${env.baseUrl}/static/console/`,
        async () =>
          (
            await fetch(`${env.baseUrl}/static/console/`, {
              redirect: 'manual',
            })
          ).status < 500
      ),
      probe(
        `Dex http://${stack.sso}:${stack.ssoPort}`,
        async () =>
          (
            await fetch(
              `http://${stack.sso}:${stack.ssoPort}/.well-known/openid-configuration`
            )
          ).ok
      ),
      probe(`OpenLDAP ldap://${stack.ldap}:389`, async () => {
        const client = new Client({ url: `ldap://${stack.ldap}:389` });
        try {
          await client.bind('cn=admin,dc=example,dc=com', 'admin');
          return true;
        } finally {
          await client.unbind();
        }
      }),
    ])
  ).filter((problem): problem is string => problem !== null);

  if (problems.length > 0) {
    throw new Error(
      `The e2e stack is not reachable:\n  - ${problems.join('\n  - ')}\n` +
        'Restart it with ./scripts/stop.sh && ./scripts/start.sh'
    );
  }
}
