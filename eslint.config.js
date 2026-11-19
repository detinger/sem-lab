// ESLint flat config for the whole monorepo. Workspaces run `eslint .` from their own
// directory and find this file by walking up, so every package shares one rule set.
//
// Version notes (docs/validation/phase-0/web-spike.md has the evidence):
// - TypeScript is pinned to 6.0.x because typescript-eslint 8 declares `typescript <6.1.0`.
// - eslint-plugin-jsx-a11y 6.10.2 declares `eslint ^9` at most. The root package.json carries a
//   scoped `overrides` entry for that one peer range; apps/web/src/tests/spike/eslint-a11y.spike.test.ts
//   keeps proving that every rule of the plugin still loads and runs under the installed ESLint.
import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default defineConfig(
  globalIgnores([
    '**/node_modules/',
    '**/dist/',
    '**/coverage/',
    '**/playwright-report/',
    '**/test-results/',
    'TEMP/',
    'docs/',
    'content/',
    'notebooks/',
    'services/',
    'apps/api/',
    // generated artefacts inside packages (emitted JSON Schema, fixtures) are data, not source
    'packages/*/schema/',
    'packages/fixtures/',
  ]),

  {
    linterOptions: {
      reportUnusedDisableDirectives: 'error',
    },
  },

  js.configs.recommended,

  // TypeScript everywhere, with type information.
  {
    files: ['**/*.{ts,tsx,mts,cts}'],
    extends: [tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/switch-exhaustiveness-check': 'error',
    },
  },

  // Rules that apply to every source language.
  {
    files: ['**/*.{js,mjs,cjs,ts,tsx,mts,cts}'],
    rules: {
      eqeqeq: ['error', 'always'],
      // Architecture ground rule 4: generated R/Python code is inert text, never evaluated.
      'no-eval': 'error',
      'no-new-func': 'error',
      // Architecture ground rule 3: row-level data must not be logged. console.log is not
      // available in application code; warnings and errors must never carry data values.
      'no-console': ['error', { allow: ['warn', 'error'] }],
    },
  },

  // Browser application.
  {
    files: ['apps/web/src/**/*.{ts,tsx}'],
    extends: [reactHooks.configs.flat.recommended, jsxA11y.flatConfigs.recommended],
    languageOptions: {
      globals: globals.browser,
    },
  },

  // Tests: assertions on untyped library output are the point of a spike test.
  {
    files: ['**/*.test.{ts,tsx}', '**/src/tests/**/*.{ts,tsx}'],
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
    },
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/unbound-method': 'off',
    },
  },

  // Node-side tooling: config files and maintenance scripts.
  {
    files: ['**/*.config.{js,mjs,ts,mts}', '**/scripts/**/*.{js,mjs,ts}'],
    languageOptions: {
      globals: globals.node,
    },
    rules: {
      'no-console': 'off',
    },
  },
);
