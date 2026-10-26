#!/usr/bin/env node
// Write package.json's version into the Helm chart, as `version` and
// `appVersion`. Run by `npm version` (the "version" script), which then
// stages the chart with package.json and the lockfile — `npm version
// --no-git-tag-version` stages nothing itself — so that the release commit
// bumps all three at once: the release workflow refuses a tag the chart
// disagrees with.
import { readFileSync, writeFileSync } from 'node:fs';

const { version } = JSON.parse(readFileSync('package.json', 'utf8'));
const path = 'helm/twake-directory-manager/Chart.yaml';
const chart = readFileSync(path, 'utf8')
  .replace(/^version: .*$/m, `version: ${version}`)
  .replace(/^appVersion: .*$/m, `appVersion: "${version}"`);
for (const line of [`\nversion: ${version}\n`, `\nappVersion: "${version}"\n`])
  if (!chart.includes(line))
    throw new Error(`${path}: no ${line.trim().split(':')[0]} line to rewrite`);
writeFileSync(path, chart);
console.log(`${path}: ${version}`);
