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
const TAG = /compat\(ldap-rest<(\d+\.\d+\.\d+)\)/g;

const parse = version => version.split('.').map(Number);
const atMost = (a, b) => {
  const [x, y] = [parse(a), parse(b)];
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] < y[i];
  return true;
};

function* files(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* files(path);
    else if (
      /\.(ts|mjs|js|css|sh|yaml|yml)$/.test(name) ||
      name === 'Dockerfile'
    )
      yield path;
  }
}

const failures = [];
for (const path of [...files('src'), ...files('docker'), 'Dockerfile']) {
  const text = readFileSync(path, 'utf8');
  for (const match of text.matchAll(TAG)) {
    const line = text.slice(0, match.index).split('\n').length;
    if (atMost(match[1], ldapRest.min))
      failures.push(
        `${path}:${line}: compat(ldap-rest<${match[1]}) serves no supported server (the floor is ${ldapRest.min}): remove the fallback`
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
