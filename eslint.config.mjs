import js from '@eslint/js';
import tseslint from '@typescript-eslint/eslint-plugin';
import tsparser from '@typescript-eslint/parser';
import prettier from 'eslint-plugin-prettier';
import prettierConfig from 'eslint-config-prettier';
import globals from 'globals';

// What no source file writes; `rules` applies them everywhere in src/, and the
// files that may not read the scope either get one more (see below).
const restrictedSyntax = [
  {
    selector: "UnaryExpression[operator='void']",
    message:
      'Start work the caller does not wait for through background() from shared/background, which reports its failure.',
  },
  {
    selector:
      'AssignmentExpression[left.property.name=/^(innerHTML|outerHTML)$/]',
    message:
      'Write markup with render(element, html`…`) from shared/html, which escapes what it interpolates.',
  },
  {
    selector: "CallExpression[callee.property.name='insertAdjacentHTML']",
    message:
      'Add markup with append(element, html`…`) from shared/html, which escapes what it interpolates.',
  },
  {
    selector: "NewExpression[callee.name='SafeHtml']",
    message:
      'Markup is made by html`…`, or by trusted() for a constant of the console’s own; nothing else builds a SafeHtml.',
  },
];

// A table is drawn by dataTable() (src/ui/table.ts), which heads its columns
// and names it (#226); the one `<table` written by hand is in that file.
const tableSyntax = {
  selector: 'TemplateElement[value.raw=/<table/]',
  message:
    'Draw a table with dataTable() from ui/table, which heads its columns and names it.',
};

// What the caller may do is read from the scope in one module, src/rights.ts
// (#222): one file to review when the authorization model changes, and one
// table of tests to pin it. The client that fetches the scope may read it;
// nothing else does. A member read through `this.scope` or any `x.scope`;
// a local of type Scope is not caught, so none is passed around.
const scopeSyntax = [
  {
    selector:
      "MemberExpression[object.type='MemberExpression'][object.property.name='scope']",
    message:
      'What the scope allows is asked of Rights (src/rights.ts), not read from the scope.',
  },
  {
    selector:
      "MemberExpression[object.type='TSNonNullExpression'][object.expression.property.name='scope']",
    message:
      'What the scope allows is asked of Rights (src/rights.ts), not read from the scope.',
  },
];

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
  // A promise nobody waits for fails with nobody listening: it is started
  // through `background` (src/shared/background.ts), which reports it. This
  // refuses the `void` that marked such a start; a bare call statement it
  // cannot tell from a synchronous one — that takes type-aware linting
  // (`no-floating-promises`, #227).
  // Markup reaches the page through `html` and `render` (src/shared/html.ts),
  // which escape every interpolation: a bare `innerHTML` is one escaping
  // forgotten away from a stored XSS in an administrator's session.
  'no-restricted-syntax': ['error', ...restrictedSyntax, tableSyntax],
  // TypeScript resolves names itself, DOM types included, which `no-undef`
  // knows nothing about.
  'no-undef': 'off',
};

// The files over the line budget when it was set, each held to its size then
// (comments and blank lines aside): it may shrink, not grow. Lower a figure
// when the file does; remove the file when it goes under the budget; never
// add one.
const oversized = {
  'src/DirectoryConsole.ts': 3827,
  'src/components/EntityForm.ts': 1408,
};

// What the types tell on top: a promise nobody waits for or handles, a
// method torn from its object, an assertion that changes nothing. Type-aware,
// so for src/ only, where tsconfig.json covers every file.
const typedRules = {
  ...tseslint.configs['recommended-type-checked'].rules,
  '@typescript-eslint/no-floating-promises': ['error', { ignoreVoid: false }],
  '@typescript-eslint/no-misused-promises': 'error',
  // Entry values come from the wire typed `unknown` and are strings, or
  // arrays of strings, by the schema: `String(value)` is how they are read.
  '@typescript-eslint/no-base-to-string': 'off',
};

export default [
  js.configs.recommended,
  {
    files: ['src/**/*.ts'],
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        ecmaVersion: 2020,
        sourceType: 'module',
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
      globals: globals.browser,
    },
    plugins: { '@typescript-eslint': tseslint, prettier },
    rules: { ...typedRules, ...rules },
  },
  {
    files: ['test/**/*.ts'],
    languageOptions: {
      parser: tsparser,
      parserOptions: { ecmaVersion: 2020, sourceType: 'module' },
      globals: { ...globals.node, ...globals.mocha, ...globals.browser },
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
      'no-restricted-syntax': 'off',
    },
  },
  ...Object.entries(oversized).map(([file, max]) => ({
    files: [file],
    rules: {
      'max-lines': ['error', { max, skipComments: true, skipBlankLines: true }],
    },
  })),
  // The catalogues are data, one line per sentence in each language: the
  // file grows with every sentence the console says, and that is as it
  // should be (#220).
  { files: ['src/i18n.ts'], rules: { 'max-lines': 'off' } },
  {
    files: ['*.mjs', 'docker/*.mjs', 'scripts/*.mjs'],
    languageOptions: { globals: globals.node },
  },
  {
    files: ['src/**/*.ts'],
    ignores: ['src/rights.ts', 'src/api/**'],
    rules: {
      'no-restricted-syntax': [
        'error',
        ...restrictedSyntax,
        tableSyntax,
        ...scopeSyntax,
      ],
    },
  },
  {
    files: ['src/ui/table.ts'],
    rules: {
      'no-restricted-syntax': ['error', ...restrictedSyntax, ...scopeSyntax],
    },
  },
  // The page's own script, a module run by the browser.
  {
    files: ['public/*.js'],
    languageOptions: { sourceType: 'module', globals: globals.browser },
  },
  {
    ignores: [
      'dist/',
      'node_modules/',
      'coverage/',
      'docs/admin-guide/_build/',
    ],
  },
];
