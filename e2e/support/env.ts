import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Where the containers of the stack answer, as written by scripts/start.sh. The console and Dex
 * are published on 127.0.0.1 (scripts/qa-environment/docker-compose.yaml); OpenLDAP is not, the
 * harness reaches it by its IP, and the browser reaches Dex by its IP too: its issuer is
 * `http://sso:<port>`, a name only the stack network resolves.
 */
export interface StackAddresses {
  project: string;
  appPort: number;
  ssoPort: number;
  directory: string;
  sso: string;
  ldap: string;
}

/** Every knob of the suite, read once */
export interface E2EEnv {
  /** The console's server, as the browser sees it (DM_BASE_URL of the stack) */
  baseUrl: string;
  /** null until scripts/start.sh has run */
  stack: StackAddresses | null;
  /** Password of every account, seeded or created by a test */
  password: string;
}

const E2E_DIR = join(__dirname, '..');
export const STACK_FILE = join(E2E_DIR, '.generated', 'stack.json');

/** Path of the console on its server */
export const CONSOLE_PATH = '/static/console/';

function isStack(value: unknown): value is StackAddresses {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    ['project', 'directory', 'sso', 'ldap'].every(
      key => typeof record[key] === 'string' && record[key] !== ''
    ) &&
    typeof record.appPort === 'number' &&
    typeof record.ssoPort === 'number'
  );
}

function readStack(): StackAddresses | null {
  if (!existsSync(STACK_FILE)) return null;
  const parsed: unknown = JSON.parse(readFileSync(STACK_FILE, 'utf8'));
  return isStack(parsed) ? parsed : null;
}

const stackAddresses = readStack();

export const env: E2EEnv = {
  baseUrl: `http://localhost:${stackAddresses?.appPort ?? 18700}`,
  stack: stackAddresses,
  password: 'secret',
};

/** The stack, or a failure telling how to start it */
export function stack(): StackAddresses {
  if (env.stack === null) {
    throw new Error(
      `No e2e stack: ${STACK_FILE} is missing. Start it with ./scripts/start.sh`
    );
  }
  return env.stack;
}

/** Chromium flag resolving Dex's issuer host to its container, as a host's /etc/hosts would */
export function hostResolverRules(): string[] {
  if (env.stack === null) return [];
  return [`--host-resolver-rules=MAP sso ${env.stack.sso}`];
}
