import { createHash } from 'crypto';
import { cpSync, readFileSync, writeFileSync } from 'fs';

import commonjs from '@rollup/plugin-commonjs';
import resolve from '@rollup/plugin-node-resolve';
import terser from '@rollup/plugin-terser';
import typescript from '@rollup/plugin-typescript';
import postcss from 'rollup-plugin-postcss';

const NAME = 'twake-directory-manager';

/** Files the page loads, named the same from one release to the next. */
const PAGE_ASSETS = [`${NAME}.esm.js`, `${NAME}.css`];

/**
 * The page and its favicon go next to the bundles, so `dist/` is the whole
 * application: a static server pointed at it serves the console.
 *
 * The page names each file it loads with a digest of its content. ldap-rest
 * serves them with `max-age=0` and a weak ETag, yet after an upgrade browsers
 * kept running the former bundle until a forced reload; a new address is
 * never answered from the cache. The digest rather than the version: the
 * version in package.json has lagged behind a release before.
 */
const copyPublic = () => ({
  name: 'copy-public',
  writeBundle() {
    cpSync('public', 'dist', { recursive: true });
    let page = readFileSync('dist/index.html', 'utf8');
    for (const asset of PAGE_ASSETS) {
      const digest = createHash('sha256')
        .update(readFileSync(`dist/${asset}`))
        .digest('hex')
        .slice(0, 12);
      page = page.replaceAll(`./${asset}'`, `./${asset}?v=${digest}'`);
      page = page.replaceAll(`"${asset}"`, `"${asset}?v=${digest}"`);
    }
    writeFileSync('dist/index.html', page);
  },
});

export default {
  input: 'src/index.ts',
  output: [
    {
      file: `dist/${NAME}.esm.js`,
      format: 'esm',
      sourcemap: true,
    },
    {
      file: `dist/${NAME}.js`,
      format: 'umd',
      name: 'TwakeDirectoryManager',
      sourcemap: true,
      exports: 'named',
    },
    {
      file: `dist/${NAME}.min.js`,
      format: 'umd',
      name: 'TwakeDirectoryManager',
      sourcemap: true,
      exports: 'named',
      plugins: [terser()],
    },
  ],
  plugins: [
    resolve({ browser: true }),
    commonjs(),
    typescript({
      tsconfig: './tsconfig.json',
      include: ['src/**/*'],
      sourceMap: true,
    }),
    postcss({
      extract: `${NAME}.css`,
      minimize: true,
      sourceMap: true,
    }),
    copyPublic(),
  ],
};
