/**
 * Vitest global setup.
 *
 * Registers `@testing-library/jest-dom` matchers so component tests can
 * use `toBeInTheDocument`, `toHaveAttribute`, etc. Also wires a per-test
 * `cleanup` so rendered components (including their global listeners)
 * unmount between cases.
 */

import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

afterEach(() => {
  cleanup();
});
