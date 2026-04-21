/**
 * Integration test for `registerAllExecutors`. Verifies every kind
 * documented in `REGISTERED_KINDS` registers against the caller's
 * registry exactly once, so the worker's executor registry is complete
 * from a single `registerAllExecutors` call.
 */

import { type CalendarProvider } from '@homehub/providers-calendar';
import { type EmailProvider } from '@homehub/providers-email';
import { type GroceryProvider } from '@homehub/providers-grocery';
import { describe, expect, it, vi } from 'vitest';

import { REGISTERED_KINDS, registerAllExecutors, type ActionExecutor } from './index.js';

function noopCalendar(): CalendarProvider {
  return {
    listEvents: vi.fn(),
    watch: vi.fn(),
    unwatch: vi.fn(),
    createEvent: vi.fn(),
  } as never;
}

function noopEmail(): EmailProvider {
  return {
    listRecentMessages: vi.fn(),
    fetchMessage: vi.fn(),
    fetchFullBody: vi.fn(),
    fetchAttachment: vi.fn(),
    watch: vi.fn(),
    unwatch: vi.fn(),
    addLabel: vi.fn(),
    ensureLabel: vi.fn(),
    createDraft: vi.fn(),
  } as never;
}

function noopGrocery(): GroceryProvider {
  return {
    listRecentOrders: vi.fn(async () => []),
    getOrder: vi.fn(),
    createDraftOrder: vi.fn(),
  };
}

describe('registerAllExecutors', () => {
  it('registers every kind listed in REGISTERED_KINDS', () => {
    const registered = new Map<string, ActionExecutor>();
    const register = (kind: string, handler: ActionExecutor): void => {
      if (registered.has(kind)) throw new Error(`duplicate kind: ${kind}`);
      registered.set(kind, handler);
    };

    registerAllExecutors(register, {
      supabase: {} as never,
      calendar: noopCalendar(),
      email: noopEmail(),
      grocery: noopGrocery(),
    });

    for (const kind of REGISTERED_KINDS) {
      expect(registered.has(kind), `missing kind: ${kind}`).toBe(true);
    }
    expect(registered.size).toBe(REGISTERED_KINDS.length);
  });

  it('registers add_to_calendar and propose_add_to_calendar with compatible handlers', () => {
    const registered = new Map<string, ActionExecutor>();
    const register = (kind: string, handler: ActionExecutor): void => {
      registered.set(kind, handler);
    };

    registerAllExecutors(register, {
      supabase: {} as never,
      calendar: noopCalendar(),
      email: noopEmail(),
      grocery: noopGrocery(),
    });

    expect(registered.get('add_to_calendar')).toBeDefined();
    expect(registered.get('propose_add_to_calendar')).toBeDefined();
  });
});
