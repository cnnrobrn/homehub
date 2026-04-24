import { describe, expect, it } from 'vitest';

import { scopesForCalendar, scopesForGmail } from './scopes.js';

describe('scopesForCalendar', () => {
  it('includes openid and calendar scopes', () => {
    const scopes = scopesForCalendar();
    expect(scopes).toContain('openid');
    expect(scopes).toContain('email');
    expect(scopes).toContain('https://www.googleapis.com/auth/calendar.events');
  });
});

describe('scopesForGmail', () => {
  it('requires at least one category', () => {
    expect(() => scopesForGmail([])).toThrow();
  });

  it('returns a deduped scope list covering read + modify for any category', () => {
    const scopes = scopesForGmail(['receipt']);
    expect(scopes).toContain('https://www.googleapis.com/auth/gmail.readonly');
    expect(scopes).toContain('https://www.googleapis.com/auth/gmail.modify');
    expect(new Set(scopes).size).toBe(scopes.length);
  });

  it('is identical regardless of which categories are passed (until matrix diverges)', () => {
    const a = scopesForGmail(['receipt']);
    const b = scopesForGmail(['receipt', 'bill', 'shipping']);
    expect(new Set(a)).toEqual(new Set(b));
  });
});
