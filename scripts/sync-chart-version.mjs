#!/usr/bin/env node
// Write package.json's version into the Helm chart, as `version` and
// `appVersion`. Run by `npm version` (the "version" script), so that the
// release commit bumps both at once: the release workflow refuses a tag the
// chart disagrees with.
import { readFileSync, writeFileSync } from 'node:fs';

const { version } = JSON.parse(readFileSync('package.json', 'utf8'));
const path = 'helm/twake-directory-manager/Chart.yaml';
const chart = readFileSync(path, 'utf8')
  .replace(/^version: .*$/m, `version: ${version}`)
  .replace(/^appVersion: .*$/m, `appVersion: "${version}"`);
if (!chart.includes(`version: ${version}\n`))
  throw new Error(`${path}: no version line to rewrite`);
writeFileSync(path, chart);
console.log(`${path}: ${version}`);
