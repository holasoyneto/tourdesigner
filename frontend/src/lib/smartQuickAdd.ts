/**
 * Natural-language quick-add parser and contextual suggestion engine for the Day Sheet.
 *
 * Understands flights, trains, taxis/vans/pickups, hotels/check-ins, soundchecks, dinners,
 * @places, #people, PNR/confirmation refs, phone numbers, and flexible FR/EN clock expressions
 * anywhere in the line — zero modal hunting required.
 */

import type { Gig, GigItem, ItemCollection, Locale, Person } from '../types';
import { AIRPORTS, clockToMinutes, foldText, formatClock, minutesToClock, parseSingleClock } from './smartParse';

export type QuickIntent = 'flight' | 'train' | 'ground' | 'hotel' | 'schedule';

export interface ParsedQuickAdd {
  intent: QuickIntent;
  collection: ItemCollection;
  startTime: string; // HH:MM or ''
  endTime: string; // HH:MM or ''
  title: string;
  location: string;
  from: string;
  to: string;
  flightNo: string;
  refCode: string;
  phone: string;
  terminal: string;
  gate: string;
  personIds: string[];
  notes: string;
  data: Record<string, unknown>;
  confidence: 'high' | 'medium';
  needsEditor?: boolean;
}

export interface SmartSuggestion {
  id: string;
  intent: QuickIntent;
  icon?: 'person' | 'place';
  label: string;
  sub?: string;
  fillText: string;
  instantSubmit?: boolean;
}

const IATA_SET = new Set(AIRPORTS.map((a) => a.iata));

const FLIGHT_NO_RE = /\b([A-Z]{2}\s?\d{2,4})\b/i;
const TRAIN_KW_RE = /\b(train|tgv|eurostar|thalys|ice|sncf|ouigo|rail|ave)\b/i;
const GROUND_KW_RE = /\b(taxi|van|uber|vtc|pickup|pick-up|transfer|transfert|chauffeur|driver|car|voiture|shuttle|navette|sprinter|mercedes|runner|ride)\b/i;
const HOTEL_KW_RE = /\b(hotel|hôtel|check[\s-]?in|checkin|check[\s-]?out|checkout|auberge|hostel|airbnb|marriott|hilton|sofitel|novotel|ibis|pullman|mercure|hoxton|soho\s+house)\b/i;
const SOUNDCHECK_KW_RE = /\b(soundcheck|sound[\s-]?check|line[\s-]?check|essai[\s-]?son|load[\s-]?in|doors|portes|curfew|changeover|set)\b/i;
const LOBBY_KW_RE = /\b(lobby|hall|réception|reception|breakfast|petit[\s-]?d[eé]j)\b/i;

function shiftClockMin(hhmm: string, delta: number): string {
  const m = clockToMinutes(hhmm);
  if (m === null) return '';
  return minutesToClock(((m + delta) % 1440 + 1440) % 1440);
}

/** Extract time range, single time, or start + duration from anywhere in the input string. */
function extractTimes(raw: string): { start: string; end: string; rest: string } {
  let text = raw;
  let start = '';
  let end = '';

  // 1. Explicit range: "11h25-13h45", "18:30 -> 20h", "2h–4h"
  const rangeRe = /\b(\d{1,2}(?:[h:]\d{0,2}))\s*(?:->|→|–|-|à|to)\s*(\d{1,2}(?:[h:]\d{0,2}))\b/i;
  const rm = text.match(rangeRe);
  if (rm) {
    const s = parseSingleClock(rm[1]);
    const e = parseSingleClock(rm[2]);
    if (s && e) {
      start = s;
      end = e;
      text = text.replace(rm[0], ' ');
    }
  }

  // 2. Single clock + optional duration: "18h30 1h30" or "18h30 pour 1h" or just "18h30"
  if (!start) {
    const singleRe = /\b(\d{1,2}[h:]\d{0,2})\b/i;
    const sm = text.match(singleRe);
    if (sm) {
      const s = parseSingleClock(sm[1]);
      if (s) {
        start = s;
        text = text.replace(sm[0], ' ');
        // Optional trailing duration right after or nearby: "1h", "1h30", "45m", "90min"
        const durRe = /\b(?:pour\s+|for\s+)?(\d{1,2})h(\d{2})?\b|\b(\d{2,3})\s?min(?:s|utes?)?\b/i;
        const dm = text.match(durRe);
        if (dm) {
          const mins = dm[1] ? Number(dm[1]) * 60 + Number(dm[2] || '0') : Number(dm[3]);
          if (mins > 0 && mins <= 720) {
            end = shiftClockMin(start, mins);
            text = text.replace(dm[0], ' ');
          }
        }
      }
    }
  }

  // 3. Two standalone clocks (e.g. "AF1181 LHR CDG 11h25 13h45")
  if (start && !end) {
    const secondRe = /\b(\d{1,2}[h:]\d{0,2})\b/i;
    const sm2 = text.match(secondRe);
    if (sm2) {
      const e = parseSingleClock(sm2[1]);
      if (e) {
        end = e;
        text = text.replace(sm2[0], ' ');
      }
    }
  }

  return { start, end, rest: text.replace(/\s+/g, ' ').trim() };
}

/** Find context places already known for THIS gig (hotel, venue, arriving airport). */
export function getGigDayContext(gig: Gig, items: GigItem[]) {
  const hotel = items.find((i) => i.collection === 'hotels');
  const hotelName = hotel ? String(hotel.data.name || '').trim() : '';
  const flights = items.filter((i) => i.collection === 'flights');
  const firstArrFlight = flights.find((f) => f.data.arr_iata || f.data.arr_time);
  const arrIata = firstArrFlight ? String(firstArrFlight.data.arr_iata || '').trim().toUpperCase() : '';
  const arrTime = firstArrFlight ? String(firstArrFlight.data.arr_time || '').trim() : '';
  const scheds = items.filter((i) => i.collection === 'schedule');
  const soundcheck = scheds.find((s) => SOUNDCHECK_KW_RE.test(String(s.data.title || s.data.label || '')));
  const hasTransport = items.some((i) => i.collection === 'transport');
  const hasDinner = scheds.some((s) => /d[iî]ner|dinner|repas|lunch|catering/i.test(String(s.data.title || s.data.label || '')));

  return {
    venue: (gig.venue || '').trim(),
    city: (gig.city || '').trim(),
    hotelName,
    arrIata,
    arrTime,
    hasHotel: Boolean(hotel),
    hasSoundcheck: Boolean(soundcheck || gig.soundcheck_time),
    soundcheckTime: String(soundcheck?.data.time || gig.soundcheck_time || ''),
    hasFlight: flights.length > 0,
    hasTransport,
    hasDinner,
    setTime: gig.set_time || '',
    setEnd: gig.set_end || '',
  };
}

/** Parse any natural-language line into a structured Day Sheet entry with zero friction. */
export function parseSmartQuickAdd(
  rawInput: string,
  gig: Gig,
  items: GigItem[],
  people: Person[],
  onDatePersonIds: ReadonlySet<string>,
  locale: Locale,
): ParsedQuickAdd | null {
  const raw = rawInput.trim();
  if (!raw) return null;

  const ctx = getGigDayContext(gig, items);
  let text = raw;

  // 1. Extract #people mentions (e.g. "#Kael #Maya" or "#all")
  const personIds: string[] = [];
  const hashMatches = [...text.matchAll(/#([a-zA-ZÀ-ÿ0-9_-]+)/g)];
  for (const m of hashMatches) {
    const token = foldText(m[1]);
    text = text.replace(m[0], ' ');
    if (token === 'tous' || token === 'all' || token === 'tout' || token === 'team' || token === 'equipe') {
      for (const pid of onDatePersonIds) if (!personIds.includes(pid)) personIds.push(pid);
      continue;
    }
    const found =
      people.find((p) => onDatePersonIds.has(p.id) && foldText(p.name).startsWith(token)) ||
      people.find((p) => foldText(p.name).includes(token));
    if (found && !personIds.includes(found.id)) personIds.push(found.id);
  }

  // 2. Extract @place mention (supports multi-word until next # or time or end, or quoted)
  let explicitPlace = '';
  const atMatch = text.match(/@(?:"([^"]+)"|([^#@]+?)(?=\s+(?:\d{1,2}[h:]|\+\d|pnr|ref|conf|$)|$))/i);
  if (atMatch) {
    explicitPlace = (atMatch[1] || atMatch[2] || '').trim();
    text = text.replace(atMatch[0], ' ');
  }

  // 3. Extract phone number (+33 6 12 34 56 78)
  let phone = '';
  const phoneMatch = text.match(/(\+\d[\d\s.-]{7,16}\d)/);
  if (phoneMatch) {
    phone = phoneMatch[1].trim();
    text = text.replace(phoneMatch[0], ' ');
  }

  // 4. Extract PNR / Conf ref ("PNR AFX92K", "conf HR9921", "ref XK89P2")
  let refCode = '';
  const refMatch = text.match(/\b(?:pnr|ref|conf|code|booking)[:#\s]+([A-Z0-9-]{4,10})\b/i);
  if (refMatch) {
    refCode = refMatch[1].toUpperCase();
    text = text.replace(refMatch[0], ' ');
  }

  // 5. Extract Terminal & Gate ("T2E", "terminal 2E", "gate K42", "porte K42")
  let terminal = '';
  let gate = '';
  const termMatch = text.match(/\b(?:terminal\s*|T)([1-9][A-Z]?)\b/i);
  if (termMatch) {
    terminal = termMatch[1].toUpperCase();
    text = text.replace(termMatch[0], ' ');
  }
  const gateMatch = text.match(/\b(?:gate|porte)\s*([A-Z]?\d{1,3}[A-Z]?)\b/i);
  if (gateMatch) {
    gate = gateMatch[1].toUpperCase();
    text = text.replace(gateMatch[0], ' ');
  }

  // 6. Extract times
  const { start, end, rest: afterTime } = extractTimes(text);
  let rest = afterTime;

  // 7. Extract route "A -> B" or "A → B" or "LHR CDG"
  let from = '';
  let to = '';
  const arrowMatch = rest.match(/([^→>]+?)\s*(?:->|→)\s*(.+)$/);
  if (arrowMatch) {
    const leftClean = arrowMatch[1].replace(GROUND_KW_RE, '').replace(TRAIN_KW_RE, '').replace(/\b(vol|flight)\b/i, '').trim();
    const rightClean = arrowMatch[2].trim();
    if (leftClean && rightClean) {
      from = expandContextPlace(leftClean, ctx);
      to = expandContextPlace(rightClean, ctx);
    }
  }

  // 8. Detect Flight number
  let flightNo = '';
  const fm = rest.match(FLIGHT_NO_RE);
  if (fm && !HOTEL_KW_RE.test(rest) && !GROUND_KW_RE.test(rest) && !TRAIN_KW_RE.test(rest)) {
    const candidate = fm[1].replace(/\s/g, '').toUpperCase();
    if (!/^(?:AM|PM)\d/.test(candidate)) {
      flightNo = candidate;
    }
  }

  // Check for two IATA codes even without arrow ("AF1181 LHR CDG")
  const words = rest.split(/\s+/).map((w) => w.replace(/[^A-Za-z]/g, '').toUpperCase());
  const iatas = words.filter((w) => w.length === 3 && IATA_SET.has(w));
  if (!from && !to && iatas.length >= 2) {
    from = iatas[0];
    to = iatas[1];
  }

  // 9. Classify intent
  let intent: QuickIntent = 'schedule';
  if (flightNo || /\b(vol|flight)\b/i.test(rest) || (iatas.length >= 2 && !GROUND_KW_RE.test(rest) && !TRAIN_KW_RE.test(rest))) {
    intent = 'flight';
  } else if (TRAIN_KW_RE.test(rest)) {
    intent = 'train';
  } else if (GROUND_KW_RE.test(rest) || (from && to && !HOTEL_KW_RE.test(rest))) {
    intent = 'ground';
  } else if (HOTEL_KW_RE.test(rest)) {
    intent = 'hotel';
  }

  // 10. Build clean, ready-to-save entity payload
  if (intent === 'flight') {
    const code = flightNo || '';
    const routeLabel = from && to ? `${from} → ${to}` : '';
    const bare = !code && !routeLabel && !start;
    return {
      intent,
      collection: 'flights',
      startTime: start,
      endTime: end,
      title: code ? `${code}${routeLabel ? ` · ${routeLabel}` : ''}` : routeLabel || (locale === 'fr' ? 'Nouveau vol' : 'New flight'),
      location: [terminal ? `T${terminal}` : '', gate ? `Gate ${gate}` : ''].filter(Boolean).join(' · '),
      from,
      to,
      flightNo: code,
      refCode,
      phone,
      terminal,
      gate,
      personIds,
      notes: '',
      confidence: flightNo || iatas.length >= 2 ? 'high' : 'medium',
      needsEditor: bare,
      data: {
        flight_no: code,
        dep_iata: from,
        arr_iata: to,
        dep_date: gig.date,
        dep_time: start,
        arr_time: end,
        terminal,
        gate,
        pnr: refCode,
        ref: refCode,
        status: 'on_time',
      },
    };
  }

  if (intent === 'train' || intent === 'ground') {
    let driver = '';
    const drvMatch = rest.match(/\b(?:chauffeur|driver)\s+([A-ZÀ-Ÿa-zà-ÿ]+(?:\s+[A-ZÀ-Ÿa-zà-ÿ]\.?)?)/i);
    if (drvMatch) {
      driver = drvMatch[1].trim();
      rest = rest.replace(drvMatch[0], ' ');
    }
    const cleanRest = rest
      .replace(GROUND_KW_RE, '')
      .replace(TRAIN_KW_RE, '')
      .replace(/\b(?:from|de|to|vers)\b/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    // Smart default route if user typed a time ("taxi 14h15")
    let rFrom = from;
    let rTo = to;
    if (!rFrom && !rTo && start) {
      if (ctx.arrIata && ctx.hotelName && ctx.arrTime && Math.abs((clockToMinutes(start) ?? 0) - (clockToMinutes(ctx.arrTime) ?? 0)) <= 90) {
        rFrom = ctx.arrIata;
        rTo = ctx.hotelName;
      } else if (ctx.hotelName && ctx.venue) {
        rFrom = ctx.hotelName;
        rTo = ctx.venue;
      }
    }
    const bare = !rFrom && !rTo && !start && !cleanRest && !phone && !driver;
    const routeStr = rFrom && rTo ? `${rFrom} → ${rTo}` : cleanRest || (intent === 'train' ? 'Train' : locale === 'fr' ? 'Transfert' : 'Transfer');
    return {
      intent,
      collection: 'transport',
      startTime: start,
      endTime: end,
      title: routeStr,
      location: explicitPlace || driver || (intent === 'train' ? 'Train' : 'Van / Taxi'),
      from: rFrom,
      to: rTo,
      flightNo: '',
      refCode,
      phone,
      terminal,
      gate,
      personIds,
      notes: '',
      confidence: from && to ? 'high' : 'medium',
      needsEditor: bare,
      data: {
        mode: intent === 'train' ? 'train' : 'ground',
        date: gig.date,
        time: start,
        arr_time: end,
        from: rFrom || routeStr,
        to: rTo,
        pickup: rFrom || routeStr,
        dropoff: rTo,
        driver_name: driver,
        driver_phone: phone,
        pnr: refCode,
        ref: refCode,
        vehicle: /\bvan\b/i.test(raw) ? 'Van' : /\btaxi\b/i.test(raw) ? 'Taxi' : /\buber\b/i.test(raw) ? 'Uber' : '',
      },
    };
  }

  if (intent === 'hotel') {
    const hadCheckinKw = /\b(check[\s-]?in|checkin|check[\s-]?out|checkout)\b/i.test(rest);
    const strippedCheckin = rest
      .replace(/\b(check[\s-]?in|checkin|check[\s-]?out|checkout)\b/gi, '')
      .replace(/\s+/g, ' ')
      .trim();
    const isBareHotelWord = /^(?:hotel|hôtel)$/i.test(strippedCheckin);
    const cleanName = isBareHotelWord
      ? ''
      : !hadCheckinKw && /^hotel[:\s-]+/i.test(strippedCheckin) && strippedCheckin[0] === 'h'
        ? strippedCheckin.replace(/^hotel[:\s-]+/i, '').trim()
        : strippedCheckin;
    const bare = !cleanName && !explicitPlace && !start && !refCode;
    const hName = cleanName || explicitPlace || ctx.hotelName || (locale === 'fr' ? 'Hôtel' : 'Hotel');
    const ci = start || '15:00';
    return {
      intent,
      collection: 'hotels',
      startTime: ci,
      endTime: end || '12:00',
      title: hName,
      location: explicitPlace && explicitPlace !== hName ? explicitPlace : ctx.city,
      from: '',
      to: '',
      flightNo: '',
      refCode,
      phone,
      terminal: '',
      gate: '',
      personIds,
      notes: '',
      confidence: 'high',
      needsEditor: bare,
      data: {
        name: hName,
        address: explicitPlace && explicitPlace !== hName ? explicitPlace : '',
        check_in_date: gig.date,
        check_in: ci,
        checkin: ci,
        check_out: end || '12:00',
        checkout: end || '12:00',
        confirmation: refCode,
        phone,
      },
    };
  }

  // Schedule item — smart context-aware venue/hotel location fill!
  const title = rest.trim() || (locale === 'fr' ? 'Nouveau moment' : 'New schedule item');
  let location = explicitPlace;
  if (!location) {
    if (SOUNDCHECK_KW_RE.test(title) && ctx.venue) location = ctx.venue;
    else if (LOBBY_KW_RE.test(title) && ctx.hotelName) location = ctx.hotelName;
  }
  const autoEnd = !end && start && SOUNDCHECK_KW_RE.test(title) ? shiftClockMin(start, 60) : end;
  const schedType = SOUNDCHECK_KW_RE.test(title)
    ? 'soundcheck'
    : /d[iî]ner|dinner|lunch|repas|catering/i.test(title)
      ? 'repas'
      : LOBBY_KW_RE.test(title)
        ? 'logistique'
        : '';

  return {
    intent: 'schedule',
    collection: 'schedule',
    startTime: start,
    endTime: autoEnd,
    title,
    location,
    from: '',
    to: '',
    flightNo: '',
    refCode,
    phone,
    terminal: '',
    gate: '',
    personIds,
    notes: refCode ? `Ref ${refCode}` : '',
    confidence: 'high',
    data: {
      type: schedType,
      date: gig.date,
      time: start,
      end_time: autoEnd,
      title,
      label: title,
      location,
      notes: refCode ? `Ref ${refCode}` : '',
    },
  };
}

function expandContextPlace(token: string, ctx: ReturnType<typeof getGigDayContext>): string {
  const f = foldText(token);
  if ((f === 'hotel' || f === 'lhotel' || f === "l'hotel") && ctx.hotelName) return ctx.hotelName;
  if ((f === 'venue' || f === 'club' || f === 'salle' || f === 'festival') && ctx.venue) return ctx.venue;
  if ((f === 'airport' || f === 'aeroport') && ctx.arrIata) return ctx.arrIata;
  const up = token.toUpperCase();
  if (up.length === 3 && IATA_SET.has(up)) return up;
  return token;
}

/** Generate contextual suggestions for the current input (or missing-item presets when empty). */
export function buildSmartSuggestions(
  input: string,
  gig: Gig,
  items: GigItem[],
  people: Person[],
  onDatePersonIds: ReadonlySet<string>,
  placePool: ReadonlyArray<{ value: string; label: string; sub?: string }>,
  activityPool: ReadonlyArray<{ value: string; label: string }>,
  locale: Locale,
): SmartSuggestion[] {
  const fr = locale === 'fr';
  const ctx = getGigDayContext(gig, items);
  const trimmed = input.trim();

  // 1. Active #person token at the end -> instant people autocomplete (hides once exact-matched!)
  const hashTail = input.match(/#([a-zA-ZÀ-ÿ0-9_-]*)$/);
  if (hashTail) {
    const q = foldText(hashTail[1]);
    const prefix = input.slice(0, input.length - hashTail[0].length);
    const exactMatch =
      q.length > 0 &&
      (q === 'tous' ||
        q === 'all' ||
        people.some((p) => foldText(p.name.split(/\s+/)[0]) === q));
    if (exactMatch) return [];
    const matches = people
      .filter((p) => !q || foldText(p.name).includes(q))
      .sort((a, b) => (onDatePersonIds.has(a.id) ? 0 : 1) - (onDatePersonIds.has(b.id) ? 0 : 1))
      .slice(0, 6);
    const out: SmartSuggestion[] = [];
    if (!q || 'tous'.startsWith(q) || 'all'.startsWith(q)) {
      out.push({
        id: 'who-all',
        intent: 'schedule',
        icon: 'person',
        label: fr ? '#tous — Toute l’équipe' : '#all — Whole team',
        fillText: `${prefix}#${fr ? 'tous' : 'all'} `,
      });
    }
    for (const p of matches) {
      const first = p.name.split(/\s+/)[0];
      out.push({
        id: `who-${p.id}`,
        intent: 'schedule',
        icon: 'person',
        label: `#${first}`,
        sub: [p.name, p.role].filter(Boolean).join(' · '),
        fillText: `${prefix}#${first} `,
      });
    }
    return out;
  }

  // 2. Active @place token at the end -> instant venue/hotel/airport autocomplete!
  const atTail = input.match(/@([^\s#@]*)$/);
  if (atTail) {
    const q = foldText(atTail[1]);
    const prefix = input.slice(0, input.length - atTail[0].length);
    const prioritized: Array<{ value: string; label: string; sub?: string }> = [];
    if (ctx.venue) prioritized.push({ value: ctx.venue, label: ctx.venue, sub: fr ? 'Salle du soir' : 'Tonight’s venue' });
    if (ctx.hotelName) prioritized.push({ value: ctx.hotelName, label: ctx.hotelName, sub: fr ? 'Hôtel du jour' : 'Today’s hotel' });
    if (ctx.arrIata) prioritized.push({ value: ctx.arrIata, label: ctx.arrIata, sub: fr ? 'Aéroport' : 'Airport' });
    const seen = new Set(prioritized.map((p) => foldText(p.value)));
    for (const p of placePool) {
      if (!seen.has(foldText(p.value))) {
        seen.add(foldText(p.value));
        prioritized.push(p);
      }
    }
    return prioritized
      .filter((p) => !q || foldText(`${p.label} ${p.sub || ''}`).includes(q))
      .slice(0, 6)
      .map((p, idx) => ({
        id: `place-${idx}`,
        intent: 'schedule',
        icon: 'place',
        label: `@${p.value}`,
        sub: p.sub,
        fillText: `${prefix}@${p.value} `,
      }));
  }

  // 3. Empty input -> context-aware presets for missing rows on this date
  if (!trimmed) {
    const sugs: SmartSuggestion[] = [];
    if (ctx.arrIata && ctx.hotelName && !ctx.hasTransport) {
      const pickup = ctx.arrTime ? shiftClockMin(ctx.arrTime, 30) : '14:00';
      sugs.push({
        id: 'ctx-airport-pickup',
        intent: 'ground',
        label: `${formatClock(pickup, locale)} · ${ctx.arrIata} → ${ctx.hotelName}`,
        sub: fr ? 'Transfert aéroport (30 min après l’atterrissage)' : 'Airport pickup (30m after landing)',
        fillText: `van ${formatClock(pickup, locale)} ${ctx.arrIata} -> ${ctx.hotelName}`,
      });
    }
    if (!ctx.hasSoundcheck) {
      const scTime = formatClock('18:30', locale);
      sugs.push({
        id: 'ctx-soundcheck',
        intent: 'schedule',
        label: `${scTime} · Soundcheck${ctx.venue ? ` @ ${ctx.venue}` : ''}`,
        sub: fr ? '1h · lieu rempli automatiquement' : '1h · auto-fills venue',
        fillText: `${scTime} Soundcheck 1h${ctx.venue ? ` @${ctx.venue}` : ''}`,
      });
    }
    if (ctx.hotelName && ctx.venue) {
      const dep = ctx.soundcheckTime ? shiftClockMin(ctx.soundcheckTime, -30) : ctx.setTime ? shiftClockMin(ctx.setTime, -60) : '18:00';
      sugs.push({
        id: 'ctx-venue-transfer',
        intent: 'ground',
        label: `${formatClock(dep, locale)} · ${ctx.hotelName} → ${ctx.venue}`,
        sub: fr ? 'Transfert hôtel → salle' : 'Hotel → venue transfer',
        fillText: `taxi ${formatClock(dep, locale)} ${ctx.hotelName} -> ${ctx.venue}`,
      });
    }
    if (!ctx.hasHotel) {
      sugs.push({
        id: 'ctx-hotel',
        intent: 'hotel',
        label: fr ? '15h00 · Check-in Hôtel' : '15:00 · Hotel Check-in',
        sub: fr ? 'Tapez le nom de l’hôtel et la réf.' : 'Type hotel name & ref',
        fillText: fr ? 'hotel 15h00 ' : 'hotel 15:00 ',
      });
    }
    if (!ctx.hasDinner) {
      sugs.push({
        id: 'ctx-dinner',
        intent: 'schedule',
        label: fr ? '20h00 · Dîner équipe' : '20:00 · Team dinner',
        sub: fr ? 'Ajoutez @lieu et #personnes' : 'Add @place and #people',
        fillText: fr ? '20h00 Dîner équipe ' : '20h00 Team dinner ',
      });
    }
    if (!ctx.hasFlight) {
      sugs.push({
        id: 'ctx-flight',
        intent: 'flight',
        label: fr ? 'Vol · ex: AF1181 LHR → CDG 11h25-13h45' : 'Flight · e.g. AF1181 LHR → CDG 11h25-13h45',
        sub: fr ? 'Lookup vol automatique' : 'Auto flight lookup',
        fillText: 'AF',
      });
    }
    return sugs.slice(0, 5);
  }

  // 4. Typing a transfer keyword ("taxi", "van", "pickup", "uber", "chauffeur") without route yet
  if (GROUND_KW_RE.test(trimmed) && !trimmed.includes('->') && !trimmed.includes('→')) {
    const out: SmartSuggestion[] = [];
    if (ctx.arrIata && ctx.hotelName) {
      const t = ctx.arrTime ? formatClock(shiftClockMin(ctx.arrTime, 30), locale) : '';
      out.push({
        id: 'tr-1',
        intent: 'ground',
        label: `${ctx.arrIata} → ${ctx.hotelName}`,
        sub: t ? `${fr ? 'Suggéré' : 'Suggested'} ${t}` : undefined,
        fillText: `${trimmed} ${ctx.arrIata} -> ${ctx.hotelName}`,
      });
    }
    if (ctx.hotelName && ctx.venue) {
      out.push({
        id: 'tr-2',
        intent: 'ground',
        label: `${ctx.hotelName} → ${ctx.venue}`,
        sub: fr ? 'Aller salle' : 'To venue',
        fillText: `${trimmed} ${ctx.hotelName} -> ${ctx.venue}`,
      });
      out.push({
        id: 'tr-3',
        intent: 'ground',
        label: `${ctx.venue} → ${ctx.hotelName}`,
        sub: fr ? 'Retour hôtel' : 'Back to hotel',
        fillText: `${trimmed} ${ctx.venue} -> ${ctx.hotelName}`,
      });
    }
    if (ctx.hotelName && ctx.arrIata) {
      out.push({
        id: 'tr-4',
        intent: 'ground',
        label: `${ctx.hotelName} → ${ctx.arrIata}`,
        sub: fr ? 'Départ aéroport' : 'To airport',
        fillText: `${trimmed} ${ctx.hotelName} -> ${ctx.arrIata}`,
      });
    }
    if (out.length) return out.slice(0, 4);
  }

  // 5. Typing a flight or 3-letter airport fragment -> suggest matching IATA airports!
  const lastWord = trimmed.split(/\s+/).pop() || '';
  if ((FLIGHT_NO_RE.test(trimmed) || /\b(vol|flight)\b/i.test(trimmed)) && lastWord.length >= 2 && lastWord.length <= 10 && !/\d/.test(lastWord)) {
    const q = foldText(lastWord);
    const prefix = trimmed.slice(0, trimmed.length - lastWord.length);
    const matches = AIRPORTS.filter((a) => foldText(`${a.iata} ${a.city} ${a.name}`).includes(q)).slice(0, 5);
    if (matches.length) {
      return matches.map((a) => ({
        id: `iata-${a.iata}`,
        intent: 'flight',
        label: `${a.iata} · ${a.city}`,
        sub: a.name,
        fillText: `${prefix}${a.iata} `,
      }));
    }
  }

  // 6. Typing a hotel keyword -> suggest tour hotels!
  if (HOTEL_KW_RE.test(trimmed)) {
    const q = foldText(trimmed.replace(HOTEL_KW_RE, '').trim());
    const hotels = placePool.filter((p) => p.sub?.toLowerCase().includes('hôtel') || p.sub?.toLowerCase().includes('hotel') || p.value === ctx.hotelName);
    const matches = hotels.filter((h) => !q || foldText(h.label).includes(q)).slice(0, 4);
    if (matches.length) {
      return matches.map((h, i) => ({
        id: `hot-${i}`,
        intent: 'hotel',
        label: h.label,
        sub: fr ? 'Hôtel du tour' : 'Tour hotel',
        fillText: `hotel ${h.value} 15h00`,
      }));
    }
  }

  // 7. General activity autocomplete (preserving any time already typed!)
  const timePrefix = trimmed.match(/^(\d{1,2}[h:]\d{0,2}(?:\s*(?:->|→|-)\s*\d{1,2}[h:]\d{0,2})?)\s+(.*)$/i);
  const queryPart = foldText(timePrefix ? timePrefix[2] : trimmed);
  const keepPrefix = timePrefix ? `${timePrefix[1]} ` : '';
  if (queryPart.length >= 1) {
    const matches = activityPool
      .filter((a) => foldText(a.label).includes(queryPart) && foldText(a.label) !== queryPart)
      .slice(0, 5);
    if (matches.length) {
      return matches.map((a, i) => ({
        id: `act-${i}`,
        intent: 'schedule',
        label: `${keepPrefix}${a.label}`,
        sub: SOUNDCHECK_KW_RE.test(a.label) && ctx.venue ? `@ ${ctx.venue}` : undefined,
        fillText: `${keepPrefix}${a.label}${SOUNDCHECK_KW_RE.test(a.label) && ctx.venue ? ` @${ctx.venue}` : ''} `,
      }));
    }
  }

  return [];
}
