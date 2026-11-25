/**
 * Smart touring parsers & intelligence — all prod quirks in ~200 clean lines:
 * - Smart clocks: "00h30", "4h", "18:30", "24h00", ranges "18h30 -> 20h", durations "2h"
 * - Refuses invalid clocks ("17h75", "25h") with clear FR/EN error reasons
 * - Free-time gap rows (>= 45 min) & tight connection warnings (< 15 min)
 * - Airport IATA autocomplete dictionary + FR/EN status words + WhatsApp plain-text day export
 */

import type { Gig, GigItem, GigStatus, Locale, Person } from '../types';

export const AIRPORTS: ReadonlyArray<{ iata: string; city: string; name: string; tz: string }> = [
  { iata: 'CDG', city: 'Paris', name: 'Charles de Gaulle', tz: 'Europe/Paris' },
  { iata: 'ORY', city: 'Paris', name: 'Orly', tz: 'Europe/Paris' },
  { iata: 'LYS', city: 'Lyon', name: 'Saint-Exupéry', tz: 'Europe/Paris' },
  { iata: 'MRS', city: 'Marseille', name: 'Provence', tz: 'Europe/Paris' },
  { iata: 'NCE', city: 'Nice', name: 'Côte d’Azur', tz: 'Europe/Paris' },
  { iata: 'TLS', city: 'Toulouse', name: 'Blagnac', tz: 'Europe/Paris' },
  { iata: 'BOD', city: 'Bordeaux', name: 'Mérignac', tz: 'Europe/Paris' },
  { iata: 'NTE', city: 'Nantes', name: 'Atlantique', tz: 'Europe/Paris' },
  { iata: 'LHR', city: 'London', name: 'Heathrow', tz: 'Europe/London' },
  { iata: 'LGW', city: 'London', name: 'Gatwick', tz: 'Europe/London' },
  { iata: 'STN', city: 'London', name: 'Stansted', tz: 'Europe/London' },
  { iata: 'MAN', city: 'Manchester', name: 'Manchester', tz: 'Europe/London' },
  { iata: 'BER', city: 'Berlin', name: 'Brandenburg', tz: 'Europe/Berlin' },
  { iata: 'FRA', city: 'Frankfurt', name: 'Frankfurt', tz: 'Europe/Berlin' },
  { iata: 'MUC', city: 'Munich', name: 'Munich', tz: 'Europe/Berlin' },
  { iata: 'AMS', city: 'Amsterdam', name: 'Schiphol', tz: 'Europe/Amsterdam' },
  { iata: 'BRU', city: 'Brussels', name: 'Zaventem', tz: 'Europe/Brussels' },
  { iata: 'GVA', city: 'Geneva', name: 'Genève', tz: 'Europe/Zurich' },
  { iata: 'ZRH', city: 'Zurich', name: 'Zürich', tz: 'Europe/Zurich' },
  { iata: 'MAD', city: 'Madrid', name: 'Barajas', tz: 'Europe/Madrid' },
  { iata: 'BCN', city: 'Barcelona', name: 'El Prat', tz: 'Europe/Madrid' },
  { iata: 'IBZ', city: 'Ibiza', name: 'Ibiza', tz: 'Europe/Madrid' },
  { iata: 'LIS', city: 'Lisbon', name: 'Humberto Delgado', tz: 'Europe/Lisbon' },
  { iata: 'OPO', city: 'Porto', name: 'Francisco Sá Carneiro', tz: 'Europe/Lisbon' },
  { iata: 'MXP', city: 'Milan', name: 'Malpensa', tz: 'Europe/Rome' },
  { iata: 'FCO', city: 'Rome', name: 'Fiumicino', tz: 'Europe/Rome' },
  { iata: 'VIE', city: 'Vienna', name: 'Schwechat', tz: 'Europe/Vienna' },
  { iata: 'PRG', city: 'Prague', name: 'Václav Havel', tz: 'Europe/Prague' },
  { iata: 'ATH', city: 'Athens', name: 'Eleftherios Venizelos', tz: 'Europe/Athens' },
  { iata: 'IST', city: 'Istanbul', name: 'Istanbul', tz: 'Europe/Istanbul' },
  { iata: 'DXB', city: 'Dubai', name: 'Dubai Intl', tz: 'Asia/Dubai' },
  { iata: 'TLV', city: 'Tel Aviv', name: 'Ben Gurion', tz: 'Asia/Jerusalem' },
  { iata: 'BOM', city: 'Mumbai', name: 'Chhatrapati Shivaji', tz: 'Asia/Kolkata' },
  { iata: 'GOI', city: 'Goa', name: 'Dabolim', tz: 'Asia/Kolkata' },
  { iata: 'BLR', city: 'Bengaluru', name: 'Kempegowda', tz: 'Asia/Kolkata' },
  { iata: 'SIN', city: 'Singapore', name: 'Changi', tz: 'Asia/Singapore' },
  { iata: 'BKK', city: 'Bangkok', name: 'Suvarnabhumi', tz: 'Asia/Bangkok' },
  { iata: 'HND', city: 'Tokyo', name: 'Haneda', tz: 'Asia/Tokyo' },
  { iata: 'NRT', city: 'Tokyo', name: 'Narita', tz: 'Asia/Tokyo' },
  { iata: 'MEL', city: 'Melbourne', name: 'Tullamarine', tz: 'Australia/Melbourne' },
  { iata: 'SYD', city: 'Sydney', name: 'Kingsford Smith', tz: 'Australia/Sydney' },
  { iata: 'MEX', city: 'Mexico City', name: 'Benito Juárez', tz: 'America/Mexico_City' },
  { iata: 'CUN', city: 'Cancún', name: 'Cancún Intl', tz: 'America/Cancun' },
  { iata: 'GDL', city: 'Guadalajara', name: 'Miguel Hidalgo', tz: 'America/Mexico_City' },
  { iata: 'MTY', city: 'Monterrey', name: 'Mariano Escobedo', tz: 'America/Monterrey' },
  { iata: 'CUU', city: 'Chihuahua', name: 'Roberto Fierro', tz: 'America/Chihuahua' },
  { iata: 'GRU', city: 'São Paulo', name: 'Guarulhos', tz: 'America/Sao_Paulo' },
  { iata: 'GIG', city: 'Rio de Janeiro', name: 'Galeão', tz: 'America/Sao_Paulo' },
  { iata: 'CNF', city: 'Belo Horizonte', name: 'Confins', tz: 'America/Sao_Paulo' },
  { iata: 'EZE', city: 'Buenos Aires', name: 'Ezeiza', tz: 'America/Argentina/Buenos_Aires' },
  { iata: 'SCL', city: 'Santiago', name: 'Arturo Merino', tz: 'America/Santiago' },
  { iata: 'BOG', city: 'Bogotá', name: 'El Dorado', tz: 'America/Bogota' },
  { iata: 'JFK', city: 'New York', name: 'John F. Kennedy', tz: 'America/New_York' },
  { iata: 'MIA', city: 'Miami', name: 'Miami Intl', tz: 'America/New_York' },
  { iata: 'LAX', city: 'Los Angeles', name: 'Los Angeles Intl', tz: 'America/Los_Angeles' },
  { iata: 'YUL', city: 'Montreal', name: 'Trudeau', tz: 'America/Toronto' },
];

export const foldText = (s: string) =>
  s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

export const STATUS_LABELS: Record<Locale, Record<GigStatus, string>> = {
  fr: {
    confirmed: 'Confirmé',
    announced: 'Annoncé',
    advancing: 'En préparation',
    show_day: 'Jour J',
    hold: 'Option',
    pending: 'En attente',
    played: 'Joué',
    cancelled: 'Annulé',
  },
  en: {
    confirmed: 'Confirmed',
    announced: 'Announced',
    advancing: 'Advancing',
    show_day: 'Show day',
    hold: 'Hold',
    pending: 'Pending',
    played: 'Played',
    cancelled: 'Cancelled',
  },
};

export function parseStatusWord(raw: string): GigStatus | null {
  const q = foldText(raw.trim());
  if (!q) return null;
  const aliases: Array<[RegExp, GigStatus]> = [
    [/^(confirm|ok|valide|lock)/, 'confirmed'],
    [/^(annonc|announc)/, 'announced'],
    [/^(advanc|prep|en prep)/, 'advancing'],
    [/^(show|jour j)/, 'show_day'],
    [/^(opt|hold|tbc)/, 'hold'],
    [/^(pend|attent)/, 'pending'],
    [/^(play|joue|done|passe)/, 'played'],
    [/^(cancel|annul)/, 'cancelled'],
  ];
  for (const [re, st] of aliases) {
    if (re.test(q)) return st;
  }
  return null;
}

export function parseSingleClock(raw: string): string | null {
  const s = raw.trim().toLowerCase();
  if (!s) return null;
  const m = s.match(/^(\d{1,2})(?:[h:](\d{1,2})?)?$/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = m[2] !== undefined ? Number(m[2]) : 0;
  if (h === 24 && min === 0) return '24:00';
  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

export function clockToMinutes(hhmm: string): number | null {
  const m = hhmm.match(/^(\d{2}):(\d{2})$/);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

export const timeToMinutes = clockToMinutes;

export function timelineSortScore(
  raw: string,
  baseDate: string,
  kind: string,
  defaultTimeMin = 900,
): number {
  const s = (raw || '').trim();
  if (!s) return 99999;
  const dateM = s.match(/^(\d{4}-\d{2}-\d{2})(?:[T\s](.*))?$/);
  let dayOffset = 0;
  let clockPart = s;
  if (dateM) {
    const a = Date.parse(`${dateM[1]}T00:00:00Z`);
    const b = Date.parse(`${baseDate}T00:00:00Z`);
    if (!Number.isNaN(a) && !Number.isNaN(b)) {
      dayOffset = Math.round((a - b) / 86400000) * 1440;
    }
    clockPart = (dateM[2] || '').trim();
    if (!clockPart) return dayOffset + defaultTimeMin;
  }
  const timeM = clockPart.match(/(\d{1,2})[h:](\d{2})/);
  if (!timeM) return dateM ? dayOffset + defaultTimeMin : 99999;
  const mins = Number(timeM[1]) * 60 + Number(timeM[2]);
  if (!dateM && mins < 360 && kind !== 'flight') {
    return mins + 1440;
  }
  return dayOffset + mins;
}

export function formatClock(hhmm: string, locale: Locale = 'en'): string {
  const s = (hhmm || '').trim();
  if (!s) return '';
  const m = s.match(/^(?:\d{4}-\d{2}-\d{2}[T\s])?(\d{1,2}):(\d{2})(?::\d{2})?(?:[Zz]|[+-]\d{2}:?\d{2})?$/);
  if (!m) return s;
  const hh = m[1].padStart(2, '0');
  return locale === 'fr' ? `${hh}h${m[2]}` : `${hh}:${m[2]}`;
}

export function formatClockFr(hhmm: string): string {
  return formatClock(hhmm, 'fr');
}

export function minutesToClock(total: number): string {
  const wrapped = ((total % 1440) + 1440) % 1440;
  return `${String(Math.floor(wrapped / 60)).padStart(2, '0')}:${String(wrapped % 60).padStart(2, '0')}`;
}

/**
 * Parse a smart clock cell:
 * - "18h30" -> { start: "18:30" } (optionally carries previous duration!)
 * - "18h30 -> 20h" or "18:30-20:00" -> { start: "18:30", end: "20:00" }
 * - "2h" or "1h30" (when existingStart given) -> duration relative to start!
 * - "h ->" or "" -> clears clock
 */
export function parseSmartClockCell(
  raw: string,
  existingStart?: string | null,
  existingEnd?: string | null,
): { ok: true; start: string; end: string | null } | { ok: false; error: string } {
  const s = raw.trim();
  if (!s || /^h\s*(?:->|→|-)?$/i.test(s)) return { ok: true, start: '', end: null };

  // Range: start -> end
  const rangeParts = s.split(/\s*(?:->|→|–|—|-)\s*/);
  if (rangeParts.length === 2) {
    const a = parseSingleClock(rangeParts[0]);
    const b = parseSingleClock(rangeParts[1]);
    if (!a || !b) return { ok: false, error: 'Heure invalide (ex: 18h30 → 20h00)' };
    return { ok: true, start: a, end: b };
  }

  // Bare duration (e.g. "2h", "1h30", "45m") when we already have a start time
  const dur = s.match(/^(\d{1,2})h(\d{2})?$/i);
  if (dur && existingStart && !s.startsWith('0') && Number(dur[1]) <= 6 && !raw.includes(':')) {
    const base = clockToMinutes(existingStart);
    if (base !== null) {
      const add = Number(dur[1]) * 60 + Number(dur[2] || '0');
      if (add > 0) return { ok: true, start: existingStart, end: minutesToClock(base + add) };
    }
  }

  const single = parseSingleClock(s);
  if (!single) return { ok: false, error: 'Heure non reconnue (ex: 00h30, 18:30, 02h→04h)' };

  // Carry previous duration if both start and end existed
  if (existingStart && existingEnd) {
    const prevS = clockToMinutes(existingStart);
    const prevE = clockToMinutes(existingEnd);
    const nextS = clockToMinutes(single);
    if (prevS !== null && prevE !== null && nextS !== null) {
      let span = prevE - prevS;
      if (span <= 0) span += 1440;
      return { ok: true, start: single, end: minutesToClock(nextS + span) };
    }
  }
  return { ok: true, start: single, end: existingEnd || null };
}

export function formatDuration(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h && m) return `${h}h${String(m).padStart(2, '0')}`;
  if (h) return `${h}h`;
  return `${m} min`;
}

export interface GapInfo {
  minutes: number;
  tight: boolean;
  label: string;
}

/** Exact prod gaps.ts logic: free time >= 45m, tight transport connection < 15m */
export function computeGap(
  prev: { endTime?: string | null; isTravel: boolean; isHotel: boolean },
  next: { startTime?: string | null; label: string; isTravel: boolean },
  locale: Locale,
): GapInfo | null {
  if ((!prev.endTime && !prev.isHotel) || !next.startTime || !prev.endTime) return null;
  const a = clockToMinutes(prev.endTime);
  let b = clockToMinutes(next.startTime);
  if (a === null || b === null) return null;
  if (b < a && a >= 18 * 60 && b < 6 * 60) b += 1440; // past-midnight set
  const diff = b - a;
  if (diff < 0) return null;
  const span = formatDuration(diff);
  if (prev.isTravel && next.isTravel && diff < 15) {
    return {
      minutes: diff,
      tight: true,
      label: locale === 'fr' ? `⚠ Correspondance serrée · ${span}` : `⚠ Tight connection · ${span}`,
    };
  }
  if (diff >= 45) {
    const cleanNext = next.label.replace(/^[\p{Emoji_Presentation}\p{Extended_Pictographic}★✈\s]+/u, '').trim();
    return {
      minutes: diff,
      tight: false,
      label:
        locale === 'fr'
          ? `${span} libre avant ${cleanNext}`
          : `${span} free before ${cleanNext}`,
    };
  }
  return null;
}

/** WhatsApp / SMS ready plain-text Day Sheet copy (matches prod "Copier la journée") */
export function formatDayPlainText(gig: Gig, items: GigItem[], people: Person[], locale: Locale): string {
  const byId = Object.fromEntries(people.map((p) => [p.id, p]));
  const lines: string[] = [
    `${gig.date} — ${gig.city || gig.name}${gig.venue ? ` · ${gig.venue}` : ''}`,
    gig.set_time ? `Set : ${gig.set_time}${gig.set_end ? `–${gig.set_end}` : ''}` : '',
    '',
  ].filter((x, i) => i < 2 ? Boolean(x) : true);

  const flights = items.filter((i) => i.collection === 'flights');
  if (flights.length) {
    lines.push(locale === 'fr' ? 'VOLS' : 'FLIGHTS');
    for (const f of flights) {
      const d = f.data;
      lines.push(
        `• ${d.dep_time || ''}–${d.arr_time || ''} ${d.flight_no || ''} ${d.dep_iata || ''}→${d.arr_iata || ''}${d.ref ? ` (PNR ${d.ref})` : ''}`.trim(),
      );
    }
    lines.push('');
  }
  const transports = items.filter((i) => i.collection === 'transport');
  if (transports.length) {
    lines.push(locale === 'fr' ? 'TRANSPORTS' : 'TRANSPORT');
    for (const t of transports) {
      const d = t.data;
      lines.push(`• ${d.time || ''} ${d.from || ''}→${d.to || ''} ${d.driver_name || ''} ${d.driver_phone || ''}`.trim());
    }
    lines.push('');
  }
  const hotels = items.filter((i) => i.collection === 'hotels');
  if (hotels.length) {
    lines.push(locale === 'fr' ? 'HÔTEL' : 'HOTEL');
    for (const h of hotels) {
      const d = h.data;
      lines.push(`• ${d.name || ''}${d.address ? ` — ${d.address}` : ''}${d.confirmation ? ` (Conf ${d.confirmation})` : ''}`);
    }
    lines.push('');
  }
  const sched = items.filter((i) => i.collection === 'schedule');
  if (sched.length) {
    lines.push(locale === 'fr' ? 'FEUILLE DE ROUTE' : 'SCHEDULE');
    for (const s of sched) {
      const d = s.data;
      const who = s.person_ids.map((id) => byId[id]?.name).filter(Boolean).join(', ');
      lines.push(`• ${d.time || ''}${d.end_time ? `–${d.end_time}` : ''} ${d.label || ''}${d.location ? ` · ${d.location}` : ''}${who ? ` (${who})` : ''}`.trim());
    }
    lines.push('');
  }
  const contacts = items.filter((i) => i.collection === 'crew' || i.collection === 'contacts');
  if (contacts.length) {
    lines.push(locale === 'fr' ? 'CONTACTS' : 'CONTACTS');
    for (const c of contacts) {
      lines.push(`• ${c.data.name || ''}${c.data.role ? ` (${c.data.role})` : ''}${c.data.phone ? ` · ${c.data.phone}` : ''}`);
    }
  }
  return lines.join('\n').trim();
}

/** Parse pasted multi-line running order / lineup ("23:30-02:00 Warmup\n02:00-04:00 Kael") */
export function parseLineupPaste(
  raw: string,
  artistName?: string,
): Array<{ start: string; end?: string; act: string; is_us: boolean }> {
  const out: Array<{ start: string; end?: string; act: string; is_us: boolean }> = [];
  const needle = (artistName || '').trim().toLowerCase();
  for (const line of raw.split(/\r?\n/)) {
    const clean = line.trim().replace(/^[•\-*]\s*/, '');
    if (!clean) continue;
    const m = clean.match(/^(\d{1,2}[h:]\d{0,2})\s*(?:[-–—→]|->|to)?\s*(\d{1,2}[h:]\d{0,2})?\s+(.+)$/i);
    if (!m) continue;
    const start = parseSingleClock(m[1]);
    const end = m[2] ? parseSingleClock(m[2]) || undefined : undefined;
    if (!start) continue;
    const act = m[3].trim().replace(/^[-–—:]\s*/, '');
    out.push({ start, end, act, is_us: Boolean(needle && act.toLowerCase().includes(needle)) });
  }
  return out;
}
