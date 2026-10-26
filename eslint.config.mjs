import js from '@eslint/js';
import tseslint from '@typescript-eslint/eslint-plugin';
import tsparser from '@typescript-eslint/parser';
import prettier from 'eslint-plugin-prettier';
import prettierConfig from 'eslint-config-prettier';
import globals from 'globals';

// The rules ldap-rest applies to its browser libraries, which is where this
// code comes from.
const rules = {
  ...tseslint.configs.recommended.rules,
  ...prettierConfig.rules,
  'prettier/prettier': 'error',
  '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
  '@typescript-eslint/explicit-function-return-type': 'warn',
  '@typescript-eslint/no-explicit-any': 'warn',
  'prefer-const': 'error',
  'no-var': 'error',
  // A module that keeps growing is one nobody holds in their head: a new page
  // or action goes in a file of its own. The files over the budget today are
  // listed in `oversized` below; that list only shrinks.
  'max-lines': [
    'error',
    { max: 1200, skipComments: true, skipBlankLines: true },
  ],
  // TypeScript resolves names itself, DOM types included, which `no-undef`
  // knows nothing about.
  'no-undef': 'off',
};

// The files over the line budget when it was set. Remove a file from the list
// when it goes under; never add one.
const oversized = {
  src: [
    'src/DirectoryConsole.ts',
    'src/components/EntityForm.ts',
    'src/i18n.ts',
  ],
  test: ['test/console.test.ts'],
};

export default [
  js.configs.recommended,
  {
    files: ['src/**/*.ts'],
    languageOptions: {
      parser: tsparser,
      parserOptions: { ecmaVersion: 2020, sourceType: 'module' },
      globals: globals.browser,
    },
    plugins: { '@typescript-eslint': tseslint, prettier },
    rules,
  },
  {
    files: ['test/**/*.ts'],
    languageOptions: {
      parser: tsparser,
      parserOptions: { ecmaVersion: 2020, sourceType: 'module' },
      globals: { ...globals.node, ...globals.mocha },
    },
    plugins: { '@typescript-eslint': tseslint, prettier },
    rules: {
      ...rules,
      '@typescript-eslint/explicit-function-return-type': 'off',
      // chai asserts with property reads: `expect(x).to.be.true`.
      '@typescript-eslint/no-unused-expressions': 'off',
      'max-lines': [
        'error',
        { max: 2500, skipComments: true, skipBlankLines: true },
      ],
    },
  },
  {
    files: [...oversized.src, ...oversized.test],
    rules: { 'max-lines': 'off' },
  },
  {
    files: ['*.mjs', 'docker/*.mjs'],
    languageOptions: { globals: globals.node },
  },
  { ignores: ['dist/', 'node_modules/', 'coverage/'] },
];
