import { type Logger } from '@homehub/worker-runtime';
import { describe, expect, it } from 'vitest';

import { handler, runSuggestionsWorker } from './handler.js';

function makeLog(): Logger {
  const noop = () => {};
  const base = {
    trace: noop,
    debug: noop,
    info: noop,
    warn: noop,
    error: noop,
    fatal: noop,
    child: () => base,
  } as Logger;
  return base;
}

describe('suggestions handler (legacy)', () => {
  it('exports a function', () => {
    expect(typeof handler).toBe('function');
  });
  it('throws when called directly (use runSuggestionsWorker)', async () => {
    await expect(handler()).rejects.toThrow();
  });
});

describe('runSuggestionsWorker', () => {
  it('is a callable function', () => {
    expect(typeof runSuggestionsWorker).toBe('function');
  });

  it('returns an empty summary list when there are no households', async () => {
    const supabase = {
      schema() {
        return {
          from() {
            return {
              select() {
                return this;
              },
              limit() {
                return Promise.resolve({ data: [], error: null });
              },
            };
          },
        };
      },
    };
    const summaries = await runSuggestionsWorker({
      supabase: supabase as never,
      log: makeLog(),
    });
    expect(summaries).toEqual([]);
  });
});
