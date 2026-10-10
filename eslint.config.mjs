import js from '@eslint/js';
import globals from 'globals';
import json from '@eslint/json';
import markdown from '@eslint/markdown';
import css from '@eslint/css';
import { defineConfig } from 'eslint/config';
import prettier from 'eslint-config-prettier';
import pluginPrettier from 'eslint-plugin-prettier';

export default defineConfig([
  // Never lint build output, packaged resources, generated files, or sensitive config.
  // firebase-config.js is gitignored (contains real API keys) — exclude it from linting too.
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      'package-lock.json',
      'secrets.js',
      'web-app/firebase-config.js',
    ],
  },
  {
    files: ['**/*.{js,mjs,cjs,jsx}'],
    plugins: { js, prettier: pluginPrettier },
    extends: ['js/recommended'],
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
        ...globals.commonjs,
        process: 'readonly',
        __dirname: 'readonly',
        require: 'readonly',
      },
    },
    rules: {
      // Allow empty catch blocks — many DOM APIs (pointer capture etc.) throw harmlessly and
      // are intentionally swallowed with an empty catch body.
      'no-empty': ['error', { allowEmptyCatch: true }],
      // Don't require caught error bindings to be used — `catch (err) {}` is a common idiom.
      'no-unused-vars': ['error', { caughtErrors: 'none' }],
      // Run Prettier as an ESLint rule so formatting issues show as errors.
      'prettier/prettier': 'error',
    },
  },
  prettier,
  {
    files: ['**/*.json'],
    plugins: { json },
    language: 'json/json',
    extends: ['json/recommended'],
  },
  {
    files: ['**/*.jsonc'],
    plugins: { json },
    language: 'json/jsonc',
    extends: ['json/recommended'],
  },
  {
    files: ['**/*.json5'],
    plugins: { json },
    language: 'json/json5',
    extends: ['json/recommended'],
  },
  {
    files: ['**/*.md'],
    plugins: { markdown },
    language: 'markdown/commonmark',
    extends: ['markdown/recommended'],
    rules: {
      // Project docs (AGENTS.md, newFeature.md) intentionally use multiple H1s and
      // informal link syntax — don't treat them as errors.
      'markdown/no-multiple-h1': 'off',
      'markdown/no-missing-label-refs': 'off',
    },
  },
  {
    files: ['**/*.css'],
    plugins: { css },
    language: 'css/css',
    extends: ['css/recommended'],
    rules: {
      // user-select is widely supported in all target browsers; the baseline check is too strict.
      'css/use-baseline': 'off',
    },
  },
]);
