import { cpSync } from 'fs';

import commonjs from '@rollup/plugin-commonjs';
import resolve from '@rollup/plugin-node-resolve';
import terser from '@rollup/plugin-terser';
import typescript from '@rollup/plugin-typescript';
import postcss from 'rollup-plugin-postcss';

const NAME = 'twake-directory-manager';

/**
 * The page and its favicon go next to the bundles, so `dist/` is the whole
 * application: a static server pointed at it serves the console.
 */
const copyPublic = () => ({
  name: 'copy-public',
  writeBundle() {
    cpSync('public', 'dist', { recursive: true });
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
