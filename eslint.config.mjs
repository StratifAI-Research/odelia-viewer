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
      // The production bundle uses babel's classic JSX runtime, so React must be
      // imported — but it is then referenced only by the compiled output.
      'react/react-in-jsx-scope': 'off',
      // Props are typed with TypeScript, not runtime propTypes.
      'react/prop-types': 'off',
      // Consistent brace style for control statements (carried over from the
      // fork's previous .eslintrc rules).
      curly: 'error',
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          args: 'after-used',
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
          ignoreRestSiblings: true,
        },
      ],
      // `declare global { namespace AppTypes { ... } }` is how an extension adds
      // its services to OHIF's global service map; upstream's own AppTypes.ts
      // disables this rule for the same reason.
      '@typescript-eslint/no-namespace': 'off',
      // eslint-plugin-react-hooks 7 added compiler-informed rules that flag a lot
      // of pre-existing, working patterns in these panels. They are useful signal
      // but not a merge gate, so they report as warnings until addressed.
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/refs': 'warn',
      'react-hooks/immutability': 'warn',
      'react-hooks/globals': 'warn',
      'react-hooks/use-memo': 'warn',
    },
  },
  {
    // Tooling configs are CommonJS by design.
    files: ['custom/**/*.config.js'],
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },
  {
    files: ['custom/**/*.test.{ts,tsx,js,jsx}', 'custom/**/test-utils/**', 'custom/**/__mocks__/**'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-require-imports': 'off',
      // Test doubles are intentionally anonymous inline components.
      'react/display-name': 'off',
    },
  }
);
