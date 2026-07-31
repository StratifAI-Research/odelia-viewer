// ESLint flat config, scoped to the ODELIA custom/ layer.
//
// Upstream OHIF 3.13 dropped every eslint dependency from the monorepo (they went
// with the old addOns/externals/devDependencies package, which 3.13 removed), so
// the leftover `.eslintrc.json` / `.eslintignore` at the repo root are inert:
// ESLint >= 9 only reads `eslint.config.*`. This file is the fork's linting
// setup and deliberately covers custom/ only — platform/, extensions/ and modes/
// are upstream code that the fork does not lint.

import js from '@eslint/js';
import globals from 'globals';
import reactPlugin from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import prettierConfig from 'eslint-config-prettier';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/coverage/**',
      '**/*.d.ts',
      'custom/orthanc-routing-example/**',
    ],
  },
  {
    files: ['custom/**/*.{ts,tsx,js,jsx}'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended, prettierConfig],
    plugins: { react: reactPlugin, 'react-hooks': reactHooks },
    languageOptions: {
      globals: { ...globals.browser, ...globals.node, ...globals.jest },
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    settings: { react: { version: 'detect' } },
    rules: {
      ...reactPlugin.configs.flat.recommended.rules,
      ...reactHooks.configs.flat.recommended.rules,
      // JSX is compiled with the automatic runtime, so React need not be in scope.
      'react/react-in-jsx-scope': 'off',
      'react/prop-types': 'off',
      // Consistent brace style for control statements (carried over from the
      // fork's previous .eslintrc rules).
      curly: 'error',
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
    },
  },
  {
    files: ['custom/**/*.test.{ts,tsx,js,jsx}', 'custom/**/test-utils/**', 'custom/**/__mocks__/**'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-require-imports': 'off',
    },
  }
);
