import { describe, expect, it } from 'vitest';

import { displayToIso, isoToDisplay } from './form-fields';
import { pageWindow } from './data-table';

/**
 * The date box accepts typed input, so it owns a parser — and a date parser is
 * exactly the kind of code that looks obviously correct and silently stores
 * the wrong day. `31/02/2024` is the case that matters: JavaScript's Date
 * happily turns it into 2 March, and a subsidy application with a fabricated
 * date is worse than one that refuses to save.
 */
describe('displayToIso', () => {
  it('accepts the formats a person actually types', () => {
    expect(displayToIso('15/03/2024')).toBe('2024-03-15');
    expect(displayToIso('15-03-2024')).toBe('2024-03-15');
    expect(displayToIso('15032024')).toBe('2024-03-15');
    expect(displayToIso('2024-03-15')).toBe('2024-03-15');
    expect(displayToIso('  15/03/2024  ')).toBe('2024-03-15');
  });

  it('refuses dates that do not exist rather than rolling them forward', () => {
    expect(displayToIso('31/02/2024')).toBeNull();
    expect(displayToIso('31/04/2024')).toBeNull();
    expect(displayToIso('00/01/2024')).toBeNull();
    expect(displayToIso('15/13/2024')).toBeNull();
    expect(displayToIso('2024-02-31')).toBeNull();
  });

  it('knows which Februaries have 29 days', () => {
    expect(displayToIso('29/02/2024')).toBe('2024-02-29');
    expect(displayToIso('29/02/2023')).toBeNull();
    expect(displayToIso('29/02/2000')).toBe('2000-02-29');
    expect(displayToIso('29/02/1900')).toBeNull();
  });

  it('returns null for partial or junk input', () => {
    expect(displayToIso('')).toBeNull();
    expect(displayToIso('15/03')).toBeNull();
    expect(displayToIso('15/03/24')).toBeNull();
    expect(displayToIso('not a date')).toBeNull();
  });

  it('round-trips through the display format', () => {
    expect(isoToDisplay('2024-03-15')).toBe('15/03/2024');
    expect(isoToDisplay(displayToIso('15/03/2024'))).toBe('15/03/2024');
    expect(isoToDisplay(null)).toBe('');
    expect(isoToDisplay('rubbish')).toBe('');
  });
});

describe('pageWindow', () => {
  it('lists every page while they still fit', () => {
    expect(pageWindow(1, 3)).toEqual([1, 2, 3]);
    expect(pageWindow(2, 4)).toEqual([1, 2, 3, 4]);
  });

  it('keeps the first and last page reachable from the middle', () => {
    expect(pageWindow(50, 203)).toEqual([1, 'gap', 49, 50, 51, 'gap', 203]);
  });

  it('opens only the gap that is actually needed', () => {
    expect(pageWindow(2, 203)).toEqual([1, 2, 3, 'gap', 203]);
    expect(pageWindow(202, 203)).toEqual([1, 'gap', 201, 202, 203]);
  });

  it('handles the degenerate cases without emitting a stray gap', () => {
    expect(pageWindow(1, 0)).toEqual([]);
    expect(pageWindow(1, 1)).toEqual([1]);
  });
});
