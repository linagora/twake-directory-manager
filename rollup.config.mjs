import { createHash } from 'crypto';
import { cpSync, readFileSync, writeFileSync } from 'fs';

import commonjs from '@rollup/plugin-commonjs';
import resolve from '@rollup/plugin-node-resolve';
import terser from '@rollup/plugin-terser';
import typescript from '@rollup/plugin-typescript';
import browserslist from 'browserslist';
import { browserslistToTargets, transform } from 'lightningcss';

const NAME = 'twake-directory-manager';

/**
 * Files the page loads, named the same from one release to the next. The
 * bundle first: boot.js imports it, and is rewritten to the digested name
 * before its own digest is taken.
 */
const PAGE_ASSETS = [`${NAME}.esm.js`, `${NAME}.css`, 'page.css', 'boot.js'];

/**
 * The stylesheet, minified, next to the bundles. One plain CSS file needs no
 * PostCSS pipeline: lightningcss reads it, drops what it can, and writes it
 * with a source map, as the former plugin did. Told the browsers the console
 * supports (`browserslist` in package.json): without them it writes the
 * newest syntax it knows — a range media query Safari 16.4 is the first to
 * read, one `backdrop-filter` where the prefixed one is still needed.
 */
const stylesheet = () => ({
  name: 'stylesheet',
  writeBundle() {
    const file = `${NAME}.css`;
    const { code, map } = transform({
      // Named from where the map will sit, so devtools find the source. The
      // same name resolves a relative `url()` or `@import`, of which the
      // stylesheet has none (its images are `data:` URLs).
      filename: '../src/styles.css',
      code: readFileSync('src/styles.css'),
      minify: true,
      sourceMap: true,
      targets: browserslistToTargets(browserslist()),
    });
    writeFileSync(
      `dist/${file}`,
      `${code}\n/*# sourceMappingURL=${file}.map */\n`
    );
    writeFileSync(`dist/${file}.map`, map);
  },
});

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
      // The page names the file; so does boot.js for the bundle it imports,
      // which must follow the same digest or the browser keeps the old one.
      for (const file of ['dist/index.html', 'dist/boot.js']) {
        const text =
          file === 'dist/index.html' ? page : readFileSync(file, 'utf8');
        const named = text
          .replaceAll(`./${asset}'`, `./${asset}?v=${digest}'`)
          .replaceAll(`"${asset}"`, `"${asset}?v=${digest}"`);
        if (file === 'dist/index.html') page = named;
        else if (named !== text) writeFileSync(file, named);
      }
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
    stylesheet(),
    copyPublic(),
  ],
};
