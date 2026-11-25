import { describe, expect, it } from 'vitest';
import { computeGap, formatClock, parseLineupPaste, parseSmartClockCell, parseStatusWord, timelineSortScore } from './smartParse';

describe('smartParse', () => {
  it('parses 24h and French clocks, ranges, durations, and rejects invalid clocks', () => {
    expect(parseSmartClockCell('00h30')).toEqual({ ok: true, start: '00:30', end: null });
    expect(parseSmartClockCell('4h')).toEqual({ ok: true, start: '04:00', end: null });
    expect(parseSmartClockCell('24h00')).toEqual({ ok: true, start: '24:00', end: null });
    expect(parseSmartClockCell('18:30 -> 20:00')).toEqual({ ok: true, start: '18:30', end: '20:00' });
    expect(parseSmartClockCell('2h', '02:00', null)).toEqual({ ok: true, start: '02:00', end: '04:00' });
    expect(parseSmartClockCell('01:30', '02:00', '04:00')).toEqual({ ok: true, start: '01:30', end: '03:30' });
    expect(parseSmartClockCell('h ->')).toEqual({ ok: true, start: '', end: null });
    expect(parseSmartClockCell('17h75').ok).toBe(false);
    expect(parseSmartClockCell('25h').ok).toBe(false);
    expect(formatClock('11:25', 'en')).toBe('11:25');
    expect(formatClock('11:25', 'fr')).toBe('11h25');
    expect(formatClock('2026-12-16 10:20', 'en')).toBe('10:20');
    expect(formatClock('2026-12-16T16:30:00Z', 'fr')).toBe('16h30');
  });

  it('computes free-time gaps (>=45m) and tight transport connections (<15m)', () => {
    const free = computeGap(
      { endTime: '14:00', isTravel: true, isHotel: false },
      { startTime: '18:30', label: 'Soundcheck', isTravel: false },
      'en',
    );
    expect(free?.tight).toBe(false);
    expect(free?.label).toContain('4h30 free');

    const tight = computeGap(
      { endTime: '13:45', isTravel: true, isHotel: false },
      { startTime: '13:55', label: 'Van CDG', isTravel: true },
      'en',
    );
    expect(tight?.tight).toBe(true);
    expect(tight?.label).toContain('10 min');
  });

  it('parses EN/FR status words and multi-line lineup pastes', () => {
    expect(parseStatusWord('Confirmé')).toBe('confirmed');
    expect(parseStatusWord('option')).toBe('hold');
    expect(parseStatusWord('cancelled')).toBe('cancelled');

    const slots = parseLineupPaste('23:30-02:00 Warmup\n02:00-04:00 Kael', 'Kael');
    expect(slots).toHaveLength(2);
    expect(slots[1]).toEqual({ start: '02:00', end: '04:00', act: 'Kael', is_us: true });
  });

  it('orders multi-day ISO flights, prior-day hotels, and afterhours club sets chronologically', () => {
    const base = '2026-11-28';
    const items = [
      { id: 'set', score: timelineSortScore('01:00', base, 'set') },
      { id: 'f2', score: timelineSortScore('2026-11-28 16:50', base, 'flight') },
      { id: 'h_prev', score: timelineSortScore('2026-11-27', base, 'hotel', 900) },
      { id: 'f1', score: timelineSortScore('2026-11-28 12:20', base, 'flight') },
    ].sort((a, b) => a.score - b.score);
    expect(items.map((x) => x.id)).toEqual(['h_prev', 'f1', 'f2', 'set']);
  });
});
