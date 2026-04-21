// @ts-check
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { FlatCompat } from '@eslint/eslintrc';

import rootConfig from '../../eslint.config.mjs';

/**
 * ESLint flat config for `@homehub/web`.
 *
 * The repo's root flat config (`../../eslint.config.mjs`) gives us the
 * baseline rules (TypeScript, import ordering, Prettier-compat). On top
 * of that we layer `eslint-config-next`, which is still published as a
 * legacy `.eslintrc`-style config — so we use `FlatCompat` to translate
 * it into flat-config entries. `next lint` honors this file via the
 * `ESLINT_USE_FLAT_CONFIG=true` environment hint; the `lint` script in
 * this package sets it explicitly so CI doesn't need to.
 *
 * Scope the Next rules to `src/**` so they don't try to parse this
 * config file or other top-level JS. Keep the root's `ignores` in force.
 */
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
  // Re-assert the root's `import/order` rule last so Next's preset can't
  // override it. The two configs disagree on whether `type` imports come
  // before or after `internal` imports; the monorepo-wide convention
  // (root config) is authoritative, and we keep a single source of
  // truth by echoing it here instead of letting Next's shadow win.
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
    ignores: ['.next/**', 'out/**', 'public/**', 'next-env.d.ts'],
  },
];
