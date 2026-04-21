// @ts-check
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { FlatCompat } from '@eslint/eslintrc';

import rootConfig from '../../eslint.config.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

export default [
  ...rootConfig,
  ...compat.extends('next/core-web-vitals', 'next/typescript').map((config) => ({
    ...config,
    files: ['src/**/*.{ts,tsx,js,jsx}'],
  })),
  {
    files: ['src/**/*.{ts,tsx,js,jsx}'],
    rules: {
      'import/order': [
        'error',
        {
          groups: [
            'builtin',
            'external',
            'internal',
            'parent',
            'sibling',
            'index',
            'object',
            'type',
          ],
          'newlines-between': 'always',
          alphabetize: { order: 'asc', caseInsensitive: true },
        },
      ],
    },
  },
  {
    ignores: ['.next/**', 'out/**', 'next-env.d.ts', 'design/**'],
  },
];
