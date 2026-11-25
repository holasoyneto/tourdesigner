import { describe, expect, it } from 'vitest';
import type { Gig, GigItem, Person } from '../types';
import { buildSmartSuggestions, parseSmartQuickAdd } from './smartQuickAdd';

const gig: Gig = {
  id: 'g1',
  name: 'Kael — Paris',
  date: '2026-11-26',
  venue: 'Rex Club',
  city: 'Paris',
  country: 'France',
  set_time: '02:00',
  set_end: '04:00',
  status: 'confirmed',
  currency: 'EUR',
  notes: '',
  archived: false,
  version: 1,
  updated_at: '',
  items_updated_at: '',
};

const items: GigItem[] = [
  {
    id: 'f1',
    gig_id: 'g1',
    collection: 'flights',
    data: { flight_no: 'AF1181', dep_iata: 'LHR', arr_iata: 'CDG', dep_time: '11:25', arr_time: '13:45' },
    person_ids: ['p1', 'p2'],
    deleted: false,
    version: 1,
    updated_at: '',
  },
  {
    id: 'h1',
    gig_id: 'g1',
    collection: 'hotels',
    data: { name: 'Hôtel Rochechouart', checkin: '15:00' },
    person_ids: ['p1', 'p2'],
    deleted: false,
    version: 1,
    updated_at: '',
  },
];

const people: Person[] = [
  { id: 'p1', name: 'Kael (Artist)', role: 'Artist', permanent: true, version: 1, updated_at: '' },
  { id: 'p2', name: 'Maya Chen', role: 'Tour Manager', permanent: true, version: 1, updated_at: '' },
];

const onDate = new Set(['p1', 'p2']);

describe('smartQuickAdd', () => {
  it('parses flights with route, clocks, terminal, gate, PNR, and #people', () => {
    const p = parseSmartQuickAdd('AF1234 LHR CDG 11:25-13:45 T2E gate K42 PNR AFX92K #Kael #Maya', gig, items, people, onDate, 'en');
    expect(p).not.toBeNull();
    expect(p?.collection).toBe('flights');
    expect(p?.flightNo).toBe('AF1234');
    expect(p?.from).toBe('LHR');
    expect(p?.to).toBe('CDG');
    expect(p?.startTime).toBe('11:25');
    expect(p?.endTime).toBe('13:45');
    expect(p?.terminal).toBe('2E');
    expect(p?.gate).toBe('K42');
    expect(p?.refCode).toBe('AFX92K');
    expect(p?.personIds).toEqual(['p1', 'p2']);
  });

  it('expands context shortcuts like "taxi 14:15 cdg -> hotel +33699887766 #all"', () => {
    const p = parseSmartQuickAdd('taxi 14:15 cdg -> hotel +33699887766 #all', gig, items, people, onDate, 'en');
    expect(p?.collection).toBe('transport');
    expect(p?.startTime).toBe('14:15');
    expect(p?.from).toBe('CDG');
    expect(p?.to).toBe('Hôtel Rochechouart');
    expect(p?.phone).toBe('+33699887766');
    expect(p?.personIds).toEqual(['p1', 'p2']);
  });

  it('auto-fills gig venue and 1h duration for soundcheck', () => {
    const p = parseSmartQuickAdd('18:30 soundcheck', gig, items, people, onDate, 'en');
    expect(p?.collection).toBe('schedule');
    expect(p?.startTime).toBe('18:30');
    expect(p?.endTime).toBe('19:30');
    expect(p?.location).toBe('Rex Club');
  });

  it('parses hotel check-ins with confirmation code', () => {
    const p = parseSmartQuickAdd('check in 15:00 Hotel Amour conf HR9921', gig, [], people, onDate, 'en');
    expect(p?.collection).toBe('hotels');
    expect(p?.title).toBe('Hotel Amour');
    expect(p?.startTime).toBe('15:00');
    expect(p?.refCode).toBe('HR9921');
  });

  it('generates context suggestions for missing airport pickup and soundcheck', () => {
    const sugs = buildSmartSuggestions('', gig, items, people, onDate, [], [], 'en');
    expect(sugs.some((s) => s.id === 'ctx-airport-pickup' && s.label.includes('14:15'))).toBe(true);
    expect(sugs.some((s) => s.id === 'ctx-soundcheck' && s.label.includes('Rex Club'))).toBe(true);
  });

  it('guards bare keywords (flight/taxi/hotel) with needsEditor so no stub rows are created', () => {
    expect(parseSmartQuickAdd('flight', gig, items, people, onDate, 'en')?.needsEditor).toBe(true);
    expect(parseSmartQuickAdd('taxi', gig, items, people, onDate, 'en')?.needsEditor).toBe(true);
    expect(parseSmartQuickAdd('hotel', gig, items, people, onDate, 'en')?.needsEditor).toBe(true);
  });

  it('hides redundant #Kael autocomplete once exact-matched and extracts driver name', () => {
    expect(buildSmartSuggestions('taxi 17:45 hotel -> venue #Kael', gig, items, people, onDate, [], [], 'en')).toEqual([]);
    const p = parseSmartQuickAdd('taxi 14:15 cdg -> hotel driver Karim +33699887766', gig, items, people, onDate, 'en');
    expect(p?.data.driver_name).toBe('Karim');
    expect(p?.phone).toBe('+33699887766');
  });
});
