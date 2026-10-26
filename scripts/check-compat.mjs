#!/usr/bin/env node
// The ldap-rest versions the console supports, kept honest.
//
// package.json declares the range: `ldapRest.min`, the oldest server the
// console runs on, and `ldapRest.tested`, the one the Dockerfile builds on
// and CI tests against. A fallback for an older server is tagged where it
// stands, `compat(ldap-rest<X.Y.Z)`: it serves servers before X.Y.Z. Once
// the floor reaches X.Y.Z the fallback serves nobody, and this refuses the
// build until it is removed — dead code otherwise lingers for years. The
// Dockerfile's default image has to be the tested version, or CI tests one
// server and the image ships another.
//
// Run by `npm run lint`.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const { ldapRest } = JSON.parse(readFileSync('package.json', 'utf8'));
// A tag written otherwise (`compat(ldap-rest < 1.2)`) would escape the check
// and linger as surely as none: every mention has to take the one form.
const MENTION = /compat\(ldap-rest[^)\n]*\)?/g;
const TAG = /^compat\(ldap-rest<(\d+\.\d+\.\d+)\)$/;

// `1.2.0-rc.1` compares as 1.2.0: a prerelease of the floor is below it.
const parse = version => version.split('-')[0].split('.').map(Number);
const atMost = (a, b) => {
  const [x, y] = [parse(a), parse(b)];
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] < y[i];
  return true;
};

// Everything that could hold a fallback: the sources, the page, the image's
// plugins and script, the chart, the QA stack, the e2e suite. Not the docs,
// which speak of the tag, nor this script, nor what is installed or built.
const SKIPPED = new Set([
  'node_modules',
  'dist',
  '.generated',
  'playwright-report',
  'test-results',
]);
const SELF = join('scripts', 'check-compat.mjs');
function* files(dir) {
  for (const name of readdirSync(dir)) {
    if (SKIPPED.has(name)) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* files(path);
    else if (
      path !== SELF &&
      (/\.(ts|mjs|js|css|sh|yaml|yml|json)$/.test(name) ||
        name === 'Dockerfile')
    )
      yield path;
  }
}

const failures = [];
const scanned = ['src', 'public', 'docker', 'scripts', 'helm', 'e2e'].flatMap(
  dir => [...files(dir)]
);
for (const path of [...scanned, 'Dockerfile']) {
  const text = readFileSync(path, 'utf8');
  for (const mention of text.matchAll(MENTION)) {
    const line = text.slice(0, mention.index).split('\n').length;
    const tag = mention[0].match(TAG);
    if (!tag) {
      failures.push(
        `${path}:${line}: "${mention[0]}" is not written compat(ldap-rest<X.Y.Z), the one form this checks`
      );
      continue;
    }
    if (atMost(tag[1], ldapRest.min))
      failures.push(
        `${path}:${line}: compat(ldap-rest<${tag[1]}) serves no supported server (the floor is ${ldapRest.min}): remove the fallback`
      );
  }
}

const dockerfile = readFileSync('Dockerfile', 'utf8');
const image = dockerfile.match(/^ARG LDAP_REST_IMAGE=\S+:(\S+)$/m)?.[1];
if (image !== ldapRest.tested)
  failures.push(
    `Dockerfile: ARG LDAP_REST_IMAGE names ${image}, package.json ldapRest.tested says ${ldapRest.tested}`
  );
if (atMost(ldapRest.tested, ldapRest.min) && ldapRest.tested !== ldapRest.min)
  failures.push(
    `package.json: ldapRest.tested (${ldapRest.tested}) is below ldapRest.min (${ldapRest.min})`
  );

if (failures.length) {
  for (const failure of failures) console.error(failure);
  process.exit(1);
}
console.log(
  `ldap-rest ${ldapRest.min} to ${ldapRest.tested}: no stale compatibility branch`
);
