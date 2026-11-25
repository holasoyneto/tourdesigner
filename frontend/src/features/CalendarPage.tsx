import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { formatClock } from '../lib/smartParse';
import type { Gig, GigItem, Locale } from '../types';

interface Props {
  gigs: Gig[];
  itemsByGig: Record<string, GigItem[]>;
  selectedGigId?: string;
  locale: Locale;
  onOpenGig: (id: string) => void;
  onCreateGigOnDate?: (isoDate: string) => void;
}

type DayKind = 'show' | 'travel' | 'road' | 'free';
type ShowState = 'confirmed' | 'option' | 'cancelled';
type Filter = 'all' | 'shows' | 'travel' | 'free';
type View = 'month' | 'week';
type TravelMode = 'flight' | 'train' | 'ground' | 'vessel';

interface CalShow {
  gigId: string;
  city: string;
  venue: string;
  set: string;
  night: boolean;
  state: ShowState;
  travelDay: boolean;
}

interface CalLeg {
  id: string;
  gigId: string;
  mode: TravelMode;
  from: string;
  to: string;
  dep: string;
  arr: string;
  depDay: string;
  arrDay: string;
  ref: string;
  role: 'day' | 'dep' | 'through' | 'arr';
}

interface CalHotel {
  key: string;
  gigId: string;
  name: string;
  inDay: string;
  outDay: string;
  nights: number;
}

interface CalMark {
  code: 'twoShows' | 'setMissing' | 'hotelOverlap' | 'legTimes';
  city?: string;
}

interface CalDay {
  iso: string;
  kind: DayKind;
  shows: CalShow[];
  legs: CalLeg[];
  nightHotels: CalHotel[];
  checkouts: CalHotel[];
  scheduleCount: number;
  marks: CalMark[];
  openId: string;
}

interface Band {
  hotel: CalHotel;
  from: number;
  to: number;
  openStart: boolean;
  openEnd: boolean;
  lane: number;
}

interface FreeSpan {
  from: number;
  to: number;
  length: number;
  outside: boolean;
}

interface Week {
  week: number;
  days: string[];
  bands: Band[];
  frees: FreeSpan[];
  lanes: number;
}

const ISO_RE = /^(19|20|21)\d{2}-\d{2}-\d{2}$/;
const noon = (iso: string) => new Date(`${iso}T12:00:00Z`);
const toIso = (d: Date) => d.toISOString().slice(0, 10);
const validIso = (v: unknown): v is string =>
  typeof v === 'string' && ISO_RE.test(v) && !Number.isNaN(noon(v).getTime()) && toIso(noon(v)) === v;

function addDays(iso: string, n: number): string {
  const d = noon(iso);
  d.setUTCDate(d.getUTCDate() + n);
  return toIso(d);
}
function weekday(iso: string): number {
  return (noon(iso).getUTCDay() + 6) % 7; // Mon=0..Sun=6
}
function dayDiff(a: string, b: string): number {
  return Math.round((noon(b).getTime() - noon(a).getTime()) / 864e5);
}
function isoWeek(iso: string): number {
  const thursday = noon(addDays(iso, 3 - weekday(iso)));
  const jan4 = noon(`${thursday.getUTCFullYear()}-01-04`);
  return 1 + Math.round((dayDiff(toIso(jan4), toIso(thursday)) - 3 + weekday(toIso(jan4))) / 7);
}
function addMonths(ym: string, n: number): string {
  const y = Number(ym.slice(0, 4));
  const m = Number(ym.slice(5, 7)) - 1 + n;
  return toIso(new Date(Date.UTC(y, m, 1, 12))).slice(0, 7);
}
function monthLength(ym: string): number {
  return new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)), 0, 12)).getUTCDate();
}
function showState(status: string | undefined): ShowState {
  const s = String(status || '').toLowerCase();
  if (s === 'cancelled' || s.startsWith('annul')) return 'cancelled';
  return /option|hold|tbc|pending/.test(s) ? 'option' : 'confirmed';
}
function cap(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : '';
}
function fmtDate(iso: string, locale: Locale, opts: Intl.DateTimeFormatOptions): string {
  const d = noon(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat(locale === 'fr' ? 'fr-FR' : 'en-GB', { ...opts, timeZone: 'UTC' }).format(d);
}

function ModeMark({ mode }: { mode: TravelMode }) {
  const common = { width: 12, height: 12, viewBox: '0 0 12 12', 'aria-hidden': true as const, className: 'dk-cal__mode' };
  if (mode === 'train') {
    return (
      <svg {...common}>
        <rect x="2.5" y="1" width="7" height="8" rx="1.5" fill="none" stroke="currentColor" />
        <path d="M3 5h6M4 9l-1.5 2.5M8 9l1.5 2.5" stroke="currentColor" fill="none" />
      </svg>
    );
  }
  if (mode === 'ground') {
    return (
      <svg {...common}>
        <path d="M1.5 8V5.5L3 3h6l1.5 2.5V8z" fill="none" stroke="currentColor" />
        <circle cx="3.5" cy="9" r="1.2" fill="currentColor" />
        <circle cx="8.5" cy="9" r="1.2" fill="currentColor" />
      </svg>
    );
  }
  if (mode === 'vessel') {
    return (
      <svg {...common}>
        <path d="M1 7h10l-2 3H3zM5 7V2l3 4" fill="none" stroke="currentColor" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <path d="M1 7l4-1 2-5h1.5L7.5 6 11 5.5V7L7.5 7.5 8.5 11H7L5 8 1 8z" fill="currentColor" />
    </svg>
  );
}

function ShowMark() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" className="dk-cal__mode">
      <path d="M4 9.5V2l6-1v7" fill="none" stroke="currentColor" />
      <circle cx="3" cy="9.5" r="1.6" fill="currentColor" />
      <circle cx="9" cy="8" r="1.6" fill="currentColor" />
    </svg>
  );
}

function BedMark() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" className="dk-cal__mode">
      <path d="M1 3v7M1 8h10v2M11 8V6.5A1.5 1.5 0 0 0 9.5 5H5v3" fill="none" stroke="currentColor" />
      <circle cx="3" cy="6.3" r="1" fill="currentColor" />
    </svg>
  );
}

export function CalendarPage({ gigs, itemsByGig, selectedGigId, locale, onOpenGig, onCreateGigOnDate }: Props) {
  const fr = locale === 'fr';
  const today = new Date().toISOString().slice(0, 10);
  const activeGigs = useMemo(() => gigs.filter((g) => !g.archived && !g.deleted_at), [gigs]);
  const openIso = activeGigs.find((g) => g.id === selectedGigId)?.date || '';

  const [cursor, setCursor] = useState<string>(() => {
    if (openIso && validIso(openIso)) return openIso;
    const next = activeGigs
      .filter((g) => validIso(g.date) && g.date >= today)
      .sort((a, b) => a.date.localeCompare(b.date))[0];
    return next?.date || today;
  });
  const [view, setView] = useState<View>('month');
  const [filter, setFilter] = useState<Filter>('all');
  const [peek, setPeek] = useState<string | null>(null);
  const [pickerYear, setPickerYear] = useState<string | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const keyed = useRef(false);

  // Build normalized calendar index from gigs + itemsByGig (flights, transport, hotels, schedule)
  const cal = useMemo(() => {
    const live = new Set<string>();
    const showsBy = new Map<string, CalShow[]>();
    const legsBy = new Map<string, CalLeg[]>();
    const nightsBy = new Map<string, CalHotel[]>();
    const outsBy = new Map<string, CalHotel[]>();
    const schedBy = new Map<string, number>();
    const hotels: CalHotel[] = [];
    const hotelKeys = new Set<string>();
    let first = '';
    let last = '';
    const seen = (iso: string) => {
      if (!first || iso < first) first = iso;
      if (!last || iso > last) last = iso;
    };
    const push = <T,>(m: Map<string, T[]>, k: string, v: T) => {
      const l = m.get(k);
      if (l) l.push(v);
      else m.set(k, [v]);
    };

    for (const g of activeGigs) {
      if (!validIso(g.date)) continue;
      live.add(g.id);
      const set = g.set_time || '';
      const night = (g.set_day_offset ?? (set && set < '06:00' ? 1 : 0)) === 1;
      const travelDay = /^\s*travel day\b/i.test(g.venue || g.name || '');
      push(showsBy, g.date, {
        gigId: g.id,
        city: (g.city || '').trim() || g.name || '',
        venue: (g.venue || '').trim(),
        set,
        night,
        state: showState(g.status),
        travelDay,
      });
      seen(g.date);

      const items = itemsByGig[g.id] || [];
      for (const it of items) {
        const d = it.data || {};
        if (it.collection === 'flights' || it.collection === 'transport') {
          const depDay = validIso(d.dep_date) ? String(d.dep_date) : validIso(d.date) ? String(d.date) : g.date;
          let arrDay = validIso(d.arr_date) && String(d.arr_date) >= depDay ? String(d.arr_date) : depDay;
          if (dayDiff(depDay, arrDay) > 7) arrDay = depDay;
          const rawKind = String(d.kind || d.mode || (it.collection === 'flights' ? 'flight' : 'ground')).toLowerCase();
          const mode: TravelMode =
            it.collection === 'flights'
              ? 'flight'
              : rawKind.includes('train') || rawKind.includes('rail')
                ? 'train'
                : rawKind.includes('ferry') || rawKind.includes('boat') || rawKind.includes('vessel')
                  ? 'vessel'
                  : 'ground';
          const from = String(d.dep_iata || d.from || d.pickup || '');
          const to = String(d.arr_iata || d.to || d.dropoff || '');
          const dep = String(d.dep_time || d.time || '');
          const arr = String(d.arr_time || '');
          const ref = String(d.flight_no || d.ref || d.driver || d.vehicle || '');
          const span = dayDiff(depDay, arrDay);
          for (let i = 0; i <= span; i++) {
            const iso = addDays(depDay, i);
            const role: CalLeg['role'] = i === 0 ? (span === 0 ? 'day' : 'dep') : i === span ? 'arr' : 'through';
            push(legsBy, iso, { id: it.id, gigId: g.id, mode, from, to, dep, arr, depDay, arrDay, ref, role });
            seen(iso);
          }
        } else if (it.collection === 'hotels') {
          const inDay = validIso(d.check_in_date) ? String(d.check_in_date) : g.date;
          let outDay =
            validIso(d.check_out_date) && String(d.check_out_date) > inDay ? String(d.check_out_date) : addDays(inDay, 1);
          if (dayDiff(inDay, outDay) > 30) outDay = addDays(inDay, 1);
          const name = String(d.name || '').trim() || (fr ? 'Hôtel' : 'Hotel');
          const key = `${name.toLowerCase()}|${inDay}|${outDay}`;
          if (!hotelKeys.has(key)) {
            hotelKeys.add(key);
            const nights = dayDiff(inDay, outDay);
            const h: CalHotel = { key, gigId: g.id, name, inDay, outDay, nights };
            hotels.push(h);
            for (let i = 0; i < nights; i++) push(nightsBy, addDays(inDay, i), h);
            push(outsBy, outDay, h);
            seen(inDay);
            seen(outDay);
          }
        } else if (it.collection === 'schedule') {
          const dayIso = validIso(d.date) ? String(d.date) : g.date;
          schedBy.set(dayIso, (schedBy.get(dayIso) || 0) + 1);
        }
      }
    }

    hotels.sort((a, b) => a.inDay.localeCompare(b.inDay) || a.outDay.localeCompare(b.outDay));
    for (const list of legsBy.values()) {
      list.sort((a, b) => (a.role === 'arr' ? a.arr : a.dep).localeCompare(b.role === 'arr' ? b.arr : b.dep));
    }

    const cache = new Map<string, CalDay>();
    const day = (iso: string): CalDay => {
      const hit = cache.get(iso);
      if (hit) return hit;
      const shows = showsBy.get(iso) || [];
      const legs = legsBy.get(iso) || [];
      const nightHotels = nightsBy.get(iso) || [];
      const checkouts = (outsBy.get(iso) || []).filter((h) => !nightHotels.includes(h));
      const real = shows.filter((s) => s.state !== 'cancelled' && !s.travelDay);
      const marks: CalMark[] = [];
      if (real.length > 1) marks.push({ code: 'twoShows' });
      for (const s of real) if (!s.set && s.state === 'confirmed') marks.push({ code: 'setMissing', city: s.city });
      if (new Set(nightHotels.map((h) => h.name.toLowerCase())).size > 1) marks.push({ code: 'hotelOverlap' });
      if (legs.some((l) => (l.role === 'day' || l.role === 'dep') && l.mode === 'flight' && (!l.dep || !l.arr))) {
        marks.push({ code: 'legTimes' });
      }
      const kind: DayKind = real.length
        ? 'show'
        : legs.length || shows.some((s) => s.travelDay && s.state !== 'cancelled')
          ? 'travel'
          : nightHotels.length || checkouts.length
            ? 'road'
            : 'free';
      const openId =
        real[0]?.gigId ||
        shows.find((s) => s.state !== 'cancelled')?.gigId ||
        shows[0]?.gigId ||
        [...legs, ...nightHotels, ...checkouts].map((x) => x.gigId).find((id) => live.has(id)) ||
        '';
      const out: CalDay = {
        iso,
        kind,
        shows,
        legs,
        nightHotels,
        checkouts,
        scheduleCount: schedBy.get(iso) || 0,
        marks,
        openId,
      };
      cache.set(iso, out);
      return out;
    };

    const freeRun = (iso: string) => {
      if (day(iso).kind !== 'free') return { length: 0, outside: false };
      if (!first || iso < first || iso > last) return { length: 0, outside: true };
      let start = iso;
      let end = iso;
      let n = 0;
      while (n < 366 && start > first && day(addDays(start, -1)).kind === 'free') {
        start = addDays(start, -1);
        n++;
      }
      while (n < 366 && end < last && day(addDays(end, 1)).kind === 'free') {
        end = addDays(end, 1);
        n++;
      }
      if (n >= 366) return { length: 0, outside: true };
      return { length: dayDiff(start, end) + 1, outside: false };
    };

    return { day, freeRun, first, last, hotels };
  }, [activeGigs, itemsByGig, fr]);

  const ym = cursor.slice(0, 7);
  const year = ym.slice(0, 4);

  // Build Monday-first weeks with hotel bands & free-run dimension lines
  const weeks = useMemo<Week[]>(() => {
    const firstDay = `${ym}-01`;
    const lastDay = `${ym}-${String(monthLength(ym)).padStart(2, '0')}`;
    const all: Week[] = [];
    for (let i = 0, start = addDays(firstDay, -weekday(firstDay)); i < 6 && start <= lastDay; i++, start = addDays(start, 7)) {
      const days = Array.from({ length: 7 }, (_, j) => addDays(start, j));
      const end = days[6];
      const laneEnds: number[] = [];
      const bands: Band[] = [];
      for (const hotel of cal.hotels) {
        if (hotel.outDay < start || hotel.inDay > end) continue;
        const openStart = hotel.inDay < start;
        const openEnd = hotel.outDay > end;
        const from = openStart ? 0 : weekday(hotel.inDay);
        const to = openEnd ? 6 : weekday(hotel.outDay);
        const s = openStart ? from * 2 : from * 2 + 1;
        const e = openEnd ? to * 2 + 2 : to * 2 + 1;
        let lane = laneEnds.findIndex((le) => le <= s);
        if (lane < 0) {
          lane = laneEnds.length;
          laneEnds.push(e);
        } else {
          laneEnds[lane] = e;
        }
        bands.push({ hotel, from, to, openStart, openEnd, lane });
      }
      const frees: FreeSpan[] = [];
      for (let c = 0; c < 7; c++) {
        if (cal.day(days[c]).kind !== 'free') continue;
        const run = cal.freeRun(days[c]);
        let e = c;
        while (e < 6 && cal.day(days[e + 1]).kind === 'free' && cal.freeRun(days[e + 1]).outside === run.outside) e++;
        if (e - c >= 1 || (!run.outside && run.length >= 2)) {
          frees.push({ from: c, to: e, length: run.length, outside: run.outside });
        }
        c = e;
      }
      all.push({ week: isoWeek(start), days, bands, frees, lanes: Math.max(1, laneEnds.length) });
    }
    return view === 'week' ? all.filter((w) => w.days.includes(cursor)) : all;
  }, [cal, ym, view, cursor]);

  // 12-month year strip data
  const strip = useMemo(() => {
    const yr = pickerYear || year;
    return Array.from({ length: 12 }, (_, i) => {
      const mYm = `${yr}-${String(i + 1).padStart(2, '0')}`;
      const len = monthLength(mYm);
      const kinds: DayKind[] = [];
      let shows = 0;
      for (let d = 1; d <= len; d++) {
        const day = cal.day(`${mYm}-${String(d).padStart(2, '0')}`);
        kinds.push(day.kind);
        shows += day.shows.filter((s) => s.state !== 'cancelled' && !s.travelDay).length;
      }
      const hasToday = today.slice(0, 7) === mYm ? Number(today.slice(8)) : 0;
      return { ym: mYm, shows, kinds, hasToday };
    });
  }, [cal, year, pickerYear, today]);

  // Summary stats for visible month
  const summary = useMemo(() => {
    const len = monthLength(ym);
    let shows = 0;
    let options = 0;
    let travel = 0;
    let nights = 0;
    let marks = 0;
    for (let d = 1; d <= len; d++) {
      const day = cal.day(`${ym}-${String(d).padStart(2, '0')}`);
      for (const s of day.shows) {
        if (s.travelDay || s.state === 'cancelled') continue;
        if (s.state === 'option') options++;
        else shows++;
      }
      if (day.legs.length || day.kind === 'travel') travel++;
      if (day.nightHotels.length) nights++;
      marks += day.marks.length;
    }
    return { shows, options, travel, nights, marks };
  }, [cal, ym]);

  useEffect(() => {
    if (!keyed.current) return;
    keyed.current = false;
    gridRef.current?.querySelector<HTMLElement>(`[data-iso="${cursor}"]`)?.focus();
  }, [cursor]);

  const matches = (d: CalDay) =>
    filter === 'all'
      ? true
      : filter === 'shows'
        ? d.shows.length > 0
        : filter === 'travel'
          ? d.legs.length > 0 || d.kind === 'travel' || d.kind === 'road'
          : d.kind === 'free';

  const goMonth = (nextYm: string) => setCursor(nextYm === today.slice(0, 7) ? today : `${nextYm}-01`);
  const step = (dir: -1 | 1) => (view === 'week' ? setCursor(addDays(cursor, 7 * dir)) : goMonth(addMonths(ym, dir)));

  function onCellKey(e: KeyboardEvent<HTMLDivElement>, iso: string) {
    let next: string | null = null;
    if (e.key === 'ArrowLeft') next = addDays(iso, -1);
    else if (e.key === 'ArrowRight') next = addDays(iso, 1);
    else if (e.key === 'ArrowUp') next = addDays(iso, -7);
    else if (e.key === 'ArrowDown') next = addDays(iso, 7);
    else if (e.key === 'Home') next = addDays(iso, -weekday(iso));
    else if (e.key === 'End') next = addDays(iso, 6 - weekday(iso));
    else if (e.key === 'PageUp') next = `${addMonths(iso.slice(0, 7), e.shiftKey ? -12 : -1)}-01`;
    else if (e.key === 'PageDown') next = `${addMonths(iso.slice(0, 7), e.shiftKey ? 12 : 1)}-01`;
    else if (e.key.toLowerCase() === 't') next = today;
    else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      const d = cal.day(iso);
      if (d.openId) onOpenGig(d.openId);
      return;
    }
    if (next) {
      e.preventDefault();
      keyed.current = true;
      setPeek(null);
      setCursor(next);
    }
  }

  const markText = (m: CalMark) => {
    if (m.code === 'twoShows') return fr ? '2 concerts le même jour' : 'Two shows same day';
    if (m.code === 'setMissing') return fr ? `Horaire de set manquant${m.city ? ` (${m.city})` : ''}` : `Missing set time${m.city ? ` (${m.city})` : ''}`;
    if (m.code === 'hotelOverlap') return fr ? 'Chevauchement d’hôtels' : 'Overlapping hotels';
    return fr ? 'Heures de vol incomplètes' : 'Incomplete flight times';
  };

  const kindLabel = (k: DayKind) =>
    k === 'show'
      ? fr ? 'Concert' : 'Show'
      : k === 'travel'
        ? fr ? 'Trajet' : 'Travel'
        : k === 'road'
          ? fr ? 'En route' : 'On the road'
          : fr ? 'Libre' : 'Free';

  const activeDay = cal.day(peek || cursor);
  const activeRun = cal.freeRun(activeDay.iso);
  const weekdays = fr ? ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'] : ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const weekStart = addDays(cursor, -weekday(cursor));
  const weekEnd = addDays(weekStart, 6);
  const title =
    view === 'week'
      ? `${fr ? 'Semaine' : 'Week'} ${weeks[0]?.week ?? ''} · ${fmtDate(weekStart, locale, { day: 'numeric', month: 'short' })} – ${fmtDate(weekEnd, locale, { day: 'numeric', month: 'short', year: 'numeric' })}`
      : cap(fmtDate(`${ym}-01`, locale, { month: 'long', year: 'numeric' }));

  return (
    <div className="dk-cal">
      {/* Top Toolbar: Month Title Picker + ‹ Today › + Month/Week Seg */}
      <div className="dk-cal__bar">
        <span className="dk-cal__head">
          <button
            type="button"
            className="btn dk-cal__title"
            aria-expanded={Boolean(pickerYear)}
            onClick={() => setPickerYear((p) => (p ? null : year))}
          >
            <strong>{title}</strong>
            <span>▾</span>
          </button>
          {pickerYear && (
            <div className="win dk-cal__pop" style={{ padding: 10 }}>
              <div className="dk-cal__picker">
                <div className="dk-cal__pyear">
                  <button type="button" className="btn" onClick={() => setPickerYear(String(Number(pickerYear) - 1))}>
                    ‹
                  </button>
                  <strong className="mono">{pickerYear}</strong>
                  <button type="button" className="btn" onClick={() => setPickerYear(String(Number(pickerYear) + 1))}>
                    ›
                  </button>
                </div>
                <div className="dk-cal__pgrid">
                  {strip.map((m) => {
                    const busy = m.kinds.filter((k) => k !== 'free').length / Math.max(1, m.kinds.length);
                    const on = m.ym === ym;
                    return (
                      <button
                        key={m.ym}
                        type="button"
                        className={`btn dk-cal__pm${on ? ' btn--def' : ''}`}
                        onClick={() => {
                          goMonth(m.ym);
                          setPickerYear(null);
                        }}
                      >
                        <span className={`dk-cal__pml${m.hasToday ? (on ? ' dk-cal__pml--nowon' : ' dk-cal__pml--now') : ''}`}>
                          {cap(fmtDate(`${m.ym}-01`, locale, { month: 'short' }))}
                        </span>
                        <span className="dk-cal__pmn mono">{m.shows || ''}</span>
                        <span className="dk-cal__dens">
                          <i style={{ width: `${Math.round(100 * busy)}%` }} />
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
        </span>

        <span className="dk-cal__nav">
          <button type="button" className="btn" onClick={() => step(-1)} title={fr ? 'Précédent' : 'Previous'}>
            ‹
          </button>
          <button type="button" className="btn" onClick={() => setCursor(today)}>
            {fr ? 'Aujourd’hui' : 'Today'}
          </button>
          <button type="button" className="btn" onClick={() => step(1)} title={fr ? 'Suivant' : 'Next'}>
            ›
          </button>
        </span>

        <div className="segs">
          <button type="button" className={`seg${view === 'month' ? ' seg--on' : ''}`} onClick={() => setView('month')}>
            {fr ? 'Mois' : 'Month'}
          </button>
          <button type="button" className={`seg${view === 'week' ? ' seg--on' : ''}`} onClick={() => setView('week')}>
            {fr ? 'Semaine' : 'Week'}
          </button>
        </div>

        <span className="dk-cal__stats">
          <span>
            <b className="mono">{summary.shows}</b> {fr ? 'dates' : 'shows'}
          </span>
          {summary.options > 0 && (
            <span>
              <b className="mono">{summary.options}</b> {fr ? 'options' : 'holds'}
            </span>
          )}
          <span>
            <b className="mono">{summary.travel}</b> {fr ? 'trajets' : 'travel'}
          </span>
          <span>
            <b className="mono">{summary.nights}</b> {fr ? `nuit${summary.nights > 1 ? 's' : ''}` : `night${summary.nights !== 1 ? 's' : ''}`}
          </span>
          {summary.marks > 0 && (
            <span className="dk-cal__stw">
              <b className="mono">{summary.marks}</b> {fr ? 'à vérifier' : 'to check'}
            </span>
          )}
        </span>
      </div>

      {/* Filters Seg Bar */}
      <div className="dk-cal__tools" style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <div className="segs">
          {(
            [
              ['all', fr ? 'Tout' : 'All'],
              ['shows', fr ? 'Dates' : 'Shows'],
              ['travel', fr ? 'Trajets' : 'Travel'],
              ['free', fr ? 'Libre' : 'Free'],
            ] as const
          ).map(([val, label]) => (
            <button key={val} type="button" className={`seg${filter === val ? ' seg--on' : ''}`} onClick={() => setFilter(val)}>
              {label}
            </button>
          ))}
        </div>
        {onCreateGigOnDate && (
          <button type="button" className="btn" onClick={() => onCreateGigOnDate(cursor)}>
            + {fr ? 'Date le' : 'Add on'} {fmtDate(cursor, locale, { day: 'numeric', month: 'short' })}
          </button>
        )}
      </div>

      {/* 12-Month Year Density Strip */}
      <nav className="dk-cal__strip" aria-label={fr ? 'Mois de l’année' : 'Months'}>
        <span className="dk-cal__yr mono">{year}</span>
        {strip.map((m) => {
          const on = m.ym === ym;
          return (
            <button
              key={m.ym}
              type="button"
              className={`dk-cal__mo${on ? ' dk-cal__mo--on' : ''}`}
              onClick={() => goMonth(m.ym)}
            >
              <span className="dk-cal__mol">{cap(fmtDate(`${m.ym}-01`, locale, { month: 'short' }))}</span>
              <span className="dk-cal__mon mono">{m.shows || ''}</span>
              <span className="dk-cal__ticks" aria-hidden="true">
                {m.kinds.map((k, idx) => (
                  <i key={idx} className={`dk-cal__tk dk-cal__tk--${k}${m.hasToday === idx + 1 ? ' dk-cal__tk--today' : ''}`} />
                ))}
              </span>
            </button>
          );
        })}
      </nav>

      {/* Main ISO-Week Grid */}
      <div className="dk-cal__scroll">
        <div className="dk-cal__grid" role="grid" ref={gridRef}>
          <div className="dk-cal__gh" role="row">
            <span role="columnheader">{fr ? 'Sem.' : 'Wk'}</span>
            {weekdays.map((d) => (
              <span key={d} role="columnheader">
                {d}
              </span>
            ))}
          </div>

          {weeks.map((w) => {
            const full = view === 'week';
            return (
              <div
                key={w.days[0]}
                className="dk-cal__wk"
                role="row"
                style={{ gridTemplateRows: `minmax(${full ? 240 : 74}px, auto) repeat(${w.lanes}, 16px)` }}
              >
                <span className="dk-cal__wkn mono" role="rowheader">
                  S{w.week}
                </span>

                {w.days.map((iso, col) => {
                  const day = cal.day(iso);
                  const cls = [
                    'dk-cal__cell',
                    !full && iso.slice(0, 7) !== ym ? 'dk-cal__cell--out' : '',
                    iso === today ? 'dk-cal__cell--today' : '',
                    iso === openIso ? 'dk-cal__cell--open' : '',
                    iso === cursor ? 'dk-cal__cell--cur' : '',
                    matches(day) ? '' : 'dk-cal__cell--dim',
                  ]
                    .filter(Boolean)
                    .join(' ');
                  const shows = full ? day.shows : day.shows.slice(0, 2);
                  const legs = full ? day.legs : day.legs.slice(0, day.shows.length > 1 ? 1 : 2);
                  const hidden = day.shows.length - shows.length + day.legs.length - legs.length;

                  return (
                    <div
                      key={iso}
                      role="gridcell"
                      data-iso={iso}
                      tabIndex={iso === cursor ? 0 : -1}
                      className={cls}
                      style={{ gridColumn: col + 2, paddingBottom: w.lanes * 16 + 4 }}
                      onClick={() => setCursor(iso)}
                      onDoubleClick={() => (day.openId ? onOpenGig(day.openId) : onCreateGigOnDate?.(iso))}
                      onKeyDown={(e) => onCellKey(e, iso)}
                      onMouseEnter={() => setPeek(iso)}
                      onMouseLeave={() => setPeek(null)}
                    >
                      <span className="dk-cal__top">
                        <span className="dk-cal__n mono">{Number(iso.slice(8))}</span>
                        {(iso.slice(8) === '01' || full) && (
                          <span className="sub">{fmtDate(iso, locale, { month: 'short' })}</span>
                        )}
                        {(day.kind === 'travel' || day.kind === 'road') && (
                          <span className="dk-cal__k">{kindLabel(day.kind)}</span>
                        )}
                      </span>

                      <span className="dk-cal__body">
                        {shows.map((s) => (
                          <span key={s.gigId} className={`dk-cal__sh dk-cal__sh--${s.state}`}>
                            <b>{s.city || (fr ? 'Sans lieu' : 'No place')}</b>
                            <span className="dk-cal__t mono">
                              {s.set ? `${formatClock(s.set, locale)}${s.night ? (fr ? ' nuit' : ' night') : ''}` : ''}
                            </span>
                            <span className="dk-cal__v">
                              <span className="dk-cal__vn">{s.venue}</span>
                              {s.state === 'option' && <span className="dk-cal__opt">{fr ? 'option' : 'hold'}</span>}
                              {s.state === 'cancelled' && <span className="dk-cal__can">{fr ? 'annulé' : 'cancelled'}</span>}
                            </span>
                          </span>
                        ))}

                        {legs.map((l) => (
                          <span key={`${l.id}-${l.role}`} className="dk-cal__lg">
                            <ModeMark mode={l.mode} />
                            <span className="dk-cal__lgl">
                              {l.role === 'arr' ? `→ ${l.to}` : `${l.from || '?'} → ${l.to || '?'}`}
                            </span>
                            <span className="dk-cal__t mono">{formatClock(l.role === 'arr' ? l.arr : l.dep, locale)}</span>
                          </span>
                        ))}

                        {full &&
                          day.nightHotels.map((h) => (
                            <span key={h.key} className="dk-cal__lg">
                              <BedMark />
                              <span className="dk-cal__lgl">{h.name}</span>
                            </span>
                          ))}

                        {hidden > 0 && <span className="dk-cal__more">+{hidden}</span>}

                        {day.marks.length > 0 && (
                          <span className="dk-cal__mark">
                            ! {day.marks.length === 1 ? markText(day.marks[0]) : `${day.marks.length} ${fr ? 'points' : 'issues'}`}
                          </span>
                        )}
                      </span>
                    </div>
                  );
                })}

                {/* Free-day horizontal dimension lines */}
                {w.frees.map((f) => (
                  <span
                    key={`f-${f.from}`}
                    className={`dk-cal__free${f.outside ? ' dk-cal__free--out' : ''}`}
                    style={{ gridColumn: `${f.from + 2} / ${f.to + 3}` }}
                  >
                    {f.outside
                      ? fr ? 'hors tournée' : 'outside tour'
                      : `${f.length} ${fr ? `jour${f.length > 1 ? 's' : ''} libre${f.length > 1 ? 's' : ''}` : `free day${f.length > 1 ? 's' : ''}`}`}
                  </span>
                ))}

                {/* Multi-day Hotel Bands */}
                {w.bands.map((b) => {
                  const span = b.to - b.from + 1;
                  return (
                    <span
                      key={b.hotel.key}
                      title={`${b.hotel.name} · ${b.hotel.nights} ${fr ? `nuit${b.hotel.nights > 1 ? 's' : ''}` : `night${b.hotel.nights !== 1 ? 's' : ''}`}`}
                      className={`dk-cal__band${b.openStart ? ' dk-cal__band--l' : ''}${b.openEnd ? ' dk-cal__band--r' : ''}`}
                      style={{
                        gridColumn: `${b.from + 2} / ${b.to + 3}`,
                        gridRow: b.lane + 2,
                        marginLeft: b.openStart ? 0 : `calc(50% / ${span})`,
                        marginRight: b.openEnd ? 0 : `calc(50% / ${span})`,
                      }}
                    >
                      {b.hotel.name} · {b.hotel.nights}n
                    </span>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>

      {/* Bottom Live Detail Panel (Hover Peek + Keyboard Cursor) */}
      <section className="dk-cal__det" aria-label={activeDay.iso}>
        <div className="dk-cal__deth">
          <strong className="dk-cal__dett">
            {cap(fmtDate(activeDay.iso, locale, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }))}
          </strong>
          <span className="sub">{kindLabel(activeDay.kind)}</span>
          <span className="dk-cal__detacts">
            {!activeDay.openId && onCreateGigOnDate && (
              <button type="button" className="btn" onClick={() => onCreateGigOnDate(activeDay.iso)}>
                + {fr ? 'Nouvelle date' : 'New date'}
              </button>
            )}
            <button
              type="button"
              className="btn btn--def"
              disabled={!activeDay.openId}
              onClick={() => activeDay.openId && onOpenGig(activeDay.openId)}
            >
              {activeDay.openId ? (fr ? 'Ouvrir la date' : 'Open date') : fr ? 'Aucune fiche' : 'Nothing to open'}
            </button>
          </span>
        </div>

        <dl className="dk-cal__kv">
          {activeDay.shows.map((s) => (
            <div key={s.gigId} className="dk-cal__kvrow">
              <dt>{s.state === 'cancelled' ? (fr ? 'Annulé' : 'Cancelled') : s.state === 'option' ? (fr ? 'Option' : 'Hold') : fr ? 'Concert' : 'Show'}</dt>
              <dd className={s.state === 'cancelled' ? 'dk-cal__strike' : undefined}>
                {[s.city, s.venue, s.set ? `Set ${formatClock(s.set, locale)}${s.night ? (fr ? ' (nuit)' : ' (night)') : ''}` : '']
                  .filter(Boolean)
                  .join(' · ')}
              </dd>
            </div>
          ))}
          {activeDay.legs.map((l) => (
            <div key={`${l.id}-${l.role}`} className="dk-cal__kvrow">
              <dt>{l.mode === 'flight' ? (fr ? 'Vol' : 'Flight') : l.mode === 'train' ? 'Train' : fr ? 'Trajet' : 'Transport'}</dt>
              <dd>
                {[l.ref, `${l.from || '?'} ${formatClock(l.dep, locale)} → ${l.to || '?'} ${formatClock(l.arr, locale)}`]
                  .filter(Boolean)
                  .join(' · ')}
              </dd>
            </div>
          ))}
          {activeDay.nightHotels.map((h) => (
            <div key={h.key} className="dk-cal__kvrow">
              <dt>{fr ? 'Hôtel' : 'Hotel'}</dt>
              <dd>
                {h.name} · {fr ? `Nuit ${dayDiff(h.inDay, activeDay.iso) + 1}/${h.nights}` : `Night ${dayDiff(h.inDay, activeDay.iso) + 1}/${h.nights}`} · {fr ? 'départ' : 'checkout'}{' '}
                {fmtDate(h.outDay, locale, { day: 'numeric', month: 'short' })}
              </dd>
            </div>
          ))}
          {activeDay.checkouts.map((h) => (
            <div key={`out-${h.key}`} className="dk-cal__kvrow">
              <dt>Checkout</dt>
              <dd>{h.name}</dd>
            </div>
          ))}
          {activeDay.scheduleCount > 0 && (
            <div className="dk-cal__kvrow">
              <dt>{fr ? 'Horaire' : 'Schedule'}</dt>
              <dd>{activeDay.scheduleCount} {fr ? 'entrées' : 'entries'}</dd>
            </div>
          )}
          {activeDay.marks.map((m, idx) => (
            <div key={idx} className="dk-cal__kvrow">
              <dt>{fr ? 'À vérifier' : 'Check'}</dt>
              <dd className="warn">{markText(m)}</dd>
            </div>
          ))}
          {activeDay.kind === 'free' && (
            <div className="dk-cal__kvrow">
              <dt>{fr ? 'Libre' : 'Free'}</dt>
              <dd>
                {activeRun.outside
                  ? fr ? 'Hors période de tournée' : 'Outside tour window'
                  : `${activeRun.length} ${fr ? 'jours libres consécutifs' : 'consecutive free days'}`}
              </dd>
            </div>
          )}
        </dl>
      </section>

      {/* Keyboard Legend Footer */}
      <footer className="dk-cal__legend">
        <span className="sub">{fr ? 'Double-clic pour ouvrir' : 'Double-click to open'}</span>
        <span><kbd>←↑↓→</kbd> {fr ? 'Jour' : 'Day'}</span>
        <span><kbd>T</kbd> {fr ? 'Aujourd’hui' : 'Today'}</span>
        <span><kbd>PgUp/Dn</kbd> {fr ? 'Mois' : 'Month'}</span>
        <span><kbd>⏎</kbd> {fr ? 'Ouvrir' : 'Open'}</span>
        <span className="dk-cal__legr">
          <span className="dk-cal__key">
            <span><ShowMark /> {fr ? 'Concert' : 'Show'}</span>
            <span><i className="dk-cal__sw dk-cal__sw--band" />{fr ? 'Hôtel' : 'Hotel'}</span>
            <span><span className="dk-cal__opt">{fr ? 'option' : 'hold'}</span></span>
            <span className="dk-cal__strike">{fr ? 'annulé' : 'cancelled'}</span>
            <span className="warn">! {fr ? 'à vérifier' : 'check'}</span>
          </span>
        </span>
      </footer>
    </div>
  );
}
