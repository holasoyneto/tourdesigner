import { useEffect, useMemo, useState, type FormEvent, type KeyboardEvent } from 'react';
import { api } from '../api/client';
import { AutocompleteInput, type SuggestionOption } from '../components/AutocompleteInput';
import { AIRPORTS, clockToMinutes, foldText, parseSingleClock } from '../lib/smartParse';
import type { Gig, GigItem, ItemCollection, Locale, Person } from '../types';

export type RowEditorMode =
  | { kind: 'edit'; item: GigItem }
  | {
      kind: 'add';
      collection: 'flights' | 'transport' | 'hotels' | 'schedule';
      presetTime?: string;
      travelKind?: 'flight' | 'train' | 'ground' | 'vessel';
      presetData?: Record<string, unknown>;
      presetPersonIds?: string[];
    };

interface Props {
  mode: RowEditorMode;
  gig: Gig;
  people: Person[];
  onDatePersonIds: string[];
  placeSuggestions: SuggestionOption[];
  hotelSuggestions?: SuggestionOption[];
  transferPlaceSuggestions?: SuggestionOption[];
  activitySuggestions: SuggestionOption[];
  locale: Locale;
  onClose: () => void;
  onSave: (
    collection: ItemCollection,
    data: Record<string, unknown>,
    personIds: string[],
    existingItemId?: string,
  ) => Promise<void>;
  onDelete?: (itemId: string) => Promise<void>;
}

const AIRLINE_PREFIXES: Record<string, string> = {
  AF: 'Air France',
  BA: 'British Airways',
  LH: 'Lufthansa',
  KL: 'KLM',
  IB: 'Iberia',
  U2: 'easyJet',
  EZY: 'easyJet',
  FR: 'Ryanair',
  VY: 'Vueling',
  LX: 'SWISS',
  OS: 'Austrian',
  SN: 'Brussels Airlines',
  TP: 'TAP Air Portugal',
  AZ: 'ITA Airways',
  SK: 'SAS',
  TK: 'Turkish Airlines',
  EK: 'Emirates',
  QR: 'Qatar Airways',
  AM: 'Aeroméxico',
  VB: 'Viva Aerobus',
  Y4: 'Volaris',
  DL: 'Delta',
  UA: 'United',
  AA: 'American Airlines',
  AC: 'Air Canada',
  LA: 'LATAM',
  AV: 'Avianca',
  G3: 'GOL',
  AD: 'Azul',
};

function guessAirlineFromFlightNo(code: string): string {
  const clean = code.trim().toUpperCase().replace(/\s+/g, '');
  const m = clean.match(/^([A-Z]{2,3}|[A-Z]\d|\d[A-Z])\d{1,4}$/);
  if (!m) return '';
  return AIRLINE_PREFIXES[m[1]] || '';
}

const airportSuggestions: SuggestionOption[] = AIRPORTS.map((a) => ({
  value: a.iata,
  label: `${a.iata} — ${a.city}`,
  sub: a.name,
}));

function shiftClock(hhmm: string, deltaMin: number): string {
  const parsed = parseSingleClock(hhmm) || '12:00';
  const mins = clockToMinutes(parsed);
  if (mins === null) return parsed;
  const wrapped = ((mins + deltaMin) % 1440 + 1440) % 1440;
  return `${String(Math.floor(wrapped / 60)).padStart(2, '0')}:${String(wrapped % 60).padStart(2, '0')}`;
}

function addDaysIso(iso: string, n: number): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function diffDaysIso(a: string, b: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(a) || !/^\d{4}-\d{2}-\d{2}$/.test(b)) return 0;
  return Math.round((new Date(`${b}T12:00:00Z`).getTime() - new Date(`${a}T12:00:00Z`).getTime()) / 864e5);
}

function formatDuration(mins: number): string {
  if (mins <= 0) return '';
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h ? `${h}h${m ? String(m).padStart(2, '0') : ''}` : `${m} min`;
}

export function DayRowEditor({
  mode,
  gig,
  people,
  onDatePersonIds,
  placeSuggestions,
  hotelSuggestions = [],
  transferPlaceSuggestions = [],
  activitySuggestions,
  locale,
  onClose,
  onSave,
  onDelete,
}: Props) {
  const fr = locale === 'fr';
  const existing = mode.kind === 'edit' ? mode.item : null;
  const initCol = mode.kind === 'edit' ? mode.item.collection : mode.collection;
  const initData = (existing?.data || (mode.kind === 'add' ? mode.presetData : undefined) || {}) as Record<string, unknown>;

  const isTravel = initCol === 'flights' || initCol === 'transport';
  const isHotel = initCol === 'hotels';

  // Travel mode: flight | train | ground | vessel
  const [travelKind, setTravelKind] = useState<'flight' | 'train' | 'ground' | 'vessel'>(() => {
    if (initCol === 'flights') return 'flight';
    if (mode.kind === 'add' && mode.travelKind) return mode.travelKind;
    const raw = String(initData.mode || initData.kind || 'ground').toLowerCase();
    if (raw.includes('train') || raw.includes('rail')) return 'train';
    if (raw.includes('vessel') || raw.includes('ferry') || raw.includes('boat')) return 'vessel';
    return 'ground';
  });

  // Shared WhoChips
  const [selectedPersonIds, setSelectedPersonIds] = useState<string[]>(() =>
    existing?.person_ids || (mode.kind === 'add' ? mode.presetPersonIds : undefined) || [],
  );
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Travel fields
  const [carrier, setCarrier] = useState(String(initData.airline || initData.carrier || ''));
  const [number, setNumber] = useState(String(initData.flight_no || initData.number || (initCol === 'flights' ? '' : initData.ref || '')));
  const [pnr, setPnr] = useState(String(initData.pnr || initData.ref || initData.booking_ref || ''));
  const [depPlace, setDepPlace] = useState(String(initData.dep_iata || initData.from || initData.pickup || ''));
  const [arrPlace, setArrPlace] = useState(String(initData.arr_iata || initData.to || initData.dropoff || ''));
  const [depDate, setDepDate] = useState(String(initData.dep_date || initData.date || gig.date));
  const [arrDate, setArrDate] = useState(String(initData.arr_date || initData.dep_date || gig.date));
  const [arrDateTouched, setArrDateTouched] = useState(Boolean(initData.arr_date));
  const [depTime, setDepTime] = useState(String(initData.dep_time || initData.time || (mode.kind === 'add' ? mode.presetTime || '' : '')));
  const [arrTime, setArrTime] = useState(String(initData.arr_time || ''));
  const [terminal, setTerminal] = useState(String(initData.terminal || initData.platform || ''));
  const [gate, setGate] = useState(String(initData.gate || initData.carriage || ''));
  const [boarding, setBoarding] = useState(String(initData.boarding_time || ''));
  const [arrTerminal, setArrTerminal] = useState(String(initData.arr_terminal || ''));
  const [driverName, setDriverName] = useState(String(initData.driver_name || initData.driver || ''));
  const [driverPhone, setDriverPhone] = useState(String(initData.driver_phone || ''));
  const [vehicle, setVehicle] = useState(String(initData.vehicle || ''));
  const [meetingPoint, setMeetingPoint] = useState(String(initData.meeting_point || ''));
  const [seats, setSeats] = useState<Record<string, { seat?: string; ticket?: string }>>(() => {
    const merged: Record<string, { seat?: string; ticket?: string }> = {};
    const byPerson = initData.seat_by_person;
    if (byPerson && typeof byPerson === 'object') {
      for (const [pid, s] of Object.entries(byPerson as Record<string, unknown>)) {
        if (s) merged[pid] = { seat: String(s) };
      }
    }
    const raw = initData.seats;
    if (raw && typeof raw === 'object') {
      for (const [pid, entry] of Object.entries(raw as Record<string, { seat?: string; ticket?: string }>)) {
        merged[pid] = { ...merged[pid], ...entry };
      }
    }
    return merged;
  });
  const [lookupBusy, setLookupBusy] = useState(false);
  const [lookupCands, setLookupCands] = useState<Array<Record<string, unknown>>>([]);
  const [lookupMsg, setLookupMsg] = useState<string | null>(null);

  // Hotel fields
  const [hotelName, setHotelName] = useState(String(initData.name || ''));
  const [hotelAddress, setHotelAddress] = useState(String(initData.address || ''));
  const [checkInDate, setCheckInDate] = useState(String(initData.check_in_date || gig.date));
  const [checkInTime, setCheckInTime] = useState(String(initData.check_in || initData.checkin || '15:00'));
  const [checkOutDate, setCheckOutDate] = useState(String(initData.check_out_date || addDaysIso(gig.date, 1)));
  const [checkOutTime, setCheckOutTime] = useState(String(initData.check_out || initData.checkout || '12:00'));
  const [hotelConf, setHotelConf] = useState(String(initData.confirmation || initData.ref || ''));
  const [hotelPhone, setHotelPhone] = useState(String(initData.phone || ''));
  const [hotelRoom, setHotelRoom] = useState(String(initData.room || ''));
  const [hotelWifi, setHotelWifi] = useState(String(initData.wifi_ssid || ''));

  // Schedule fields
  const [schedType, setSchedType] = useState(String(initData.type || ''));
  const [schedTitle, setSchedTitle] = useState(String(initData.title || initData.label || ''));
  const [schedDay, setSchedDay] = useState(String(initData.date || gig.date));
  const [schedStart, setSchedStart] = useState(String(initData.time || (mode.kind === 'add' ? mode.presetTime || '' : '')));
  const [schedEnd, setSchedEnd] = useState(String(initData.end_time || ''));
  const [schedLoc, setSchedLoc] = useState(String(initData.location || ''));

  // Shared notes
  const [notes, setNotes] = useState(String(initData.notes || ''));

  const chipPeople = useMemo(() => {
    const onDate = new Set(onDatePersonIds);
    const ordered = [...people.filter((p) => onDate.has(p.id)), ...people.filter((p) => !onDate.has(p.id) && selectedPersonIds.includes(p.id))];
    return ordered.length ? ordered : people.slice(0, 12);
  }, [people, onDatePersonIds, selectedPersonIds]);

  // Auto-follow arrival date when arrival time crosses midnight
  useEffect(() => {
    if (!isTravel || arrDateTouched || !depDate) return;
    const dm = clockToMinutes(parseSingleClock(depTime) || '');
    const am = clockToMinutes(parseSingleClock(arrTime) || '');
    if (dm !== null && am !== null && am < dm) setArrDate(addDaysIso(depDate, 1));
    else setArrDate(depDate);
  }, [depDate, depTime, arrTime, arrDateTouched, isTravel]);

  const travelDuration = useMemo(() => {
    const dm = clockToMinutes(parseSingleClock(depTime) || '');
    const am = clockToMinutes(parseSingleClock(arrTime) || '');
    if (dm === null || am === null) return '';
    const days = diffDaysIso(depDate, arrDate);
    return formatDuration(days * 1440 + am - dm);
  }, [depDate, arrDate, depTime, arrTime]);

  const hotelNights = useMemo(() => Math.max(1, diffDaysIso(checkInDate, checkOutDate)), [checkInDate, checkOutDate]);

  async function lookupFlight() {
    if (!number.trim()) return;
    setLookupBusy(true);
    setLookupMsg(null);
    const guessed = guessAirlineFromFlightNo(number);
    if (guessed && !carrier.trim()) setCarrier(guessed);
    try {
      const res = await api.lookupFlight(number.trim());
      setLookupCands(res.candidates);
      if (res.candidates.length === 1) {
        applyCandidate(res.candidates[0]);
        setLookupMsg(fr ? 'Vol rempli automatiquement ✓' : 'Flight auto-filled ✓');
      } else if (res.candidates.length === 0) {
        setLookupMsg(
          guessed
            ? fr
              ? `Compagnie détectée (${guessed}) — aucun horaire en direct, complétez ci-dessous.`
              : `Airline detected (${guessed}) — no live schedule found, enter times below.`
            : fr
              ? 'Aucun horaire en direct trouvé — complétez le trajet ci-dessous.'
              : 'No live flight schedule found — fill route & times below.',
        );
      }
    } catch {
      setLookupMsg(fr ? 'Recherche vol indisponible — saisissez manuellement.' : 'Flight lookup unavailable — enter manually.');
    } finally {
      setLookupBusy(false);
    }
  }

  function applyCandidate(c: Record<string, unknown>) {
    if (c.airline) setCarrier(String(c.airline));
    if (c.dep_iata) setDepPlace(String(c.dep_iata));
    if (c.arr_iata) setArrPlace(String(c.arr_iata));
    if (c.dep_time) setDepTime(String(c.dep_time));
    if (c.arr_time) setArrTime(String(c.arr_time));
    if (c.terminal) setTerminal(String(c.terminal));
    if (c.gate) setGate(String(c.gate));
    setDirty(true);
    setLookupCands([]);
  }

  function handleTimeKey(e: KeyboardEvent<HTMLInputElement>, current: string, setVal: (v: string) => void) {
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      const step = e.shiftKey ? 60 : 5;
      setVal(shiftClock(current, e.key === 'ArrowUp' ? step : -step));
      setDirty(true);
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setErr(null);
    setSaving(true);
    try {
      if (isTravel) {
        const parsedDep = depTime.trim() ? parseSingleClock(depTime) : '';
        const parsedArr = arrTime.trim() ? parseSingleClock(arrTime) : '';
        if (depTime.trim() && !parsedDep) {
          setErr(fr ? `Heure de départ invalide : ${depTime}` : `Invalid departure time: ${depTime}`);
          setSaving(false);
          return;
        }
        if (arrTime.trim() && !parsedArr) {
          setErr(fr ? `Heure d’arrivée invalide : ${arrTime}` : `Invalid arrival time: ${arrTime}`);
          setSaving(false);
          return;
        }
        if (travelKind === 'flight') {
          if (!number.trim() && !depPlace.trim() && !arrPlace.trim()) {
            setErr(fr ? 'Indiquez un numéro de vol ou un trajet (ex: CDG → BER)' : 'Enter a flight number or route (e.g. CDG → BER)');
            setSaving(false);
            return;
          }
          const seatByPerson: Record<string, string> = {};
          for (const [pid, entry] of Object.entries(seats)) {
            if (entry?.seat?.trim()) seatByPerson[pid] = entry.seat.trim().toUpperCase();
          }
          const cleanPnr = pnr.trim().toUpperCase();
          await onSave(
            'flights',
            {
              ...initData,
              airline: carrier.trim() || guessAirlineFromFlightNo(number),
              flight_no: number.trim().toUpperCase(),
              pnr: cleanPnr,
              ref: cleanPnr,
              dep_iata: depPlace.trim().toUpperCase(),
              arr_iata: arrPlace.trim().toUpperCase(),
              dep_date: depDate,
              arr_date: arrDate,
              dep_time: parsedDep || '',
              arr_time: parsedArr || '',
              terminal: terminal.trim(),
              gate: gate.trim(),
              boarding_time: boarding.trim() ? parseSingleClock(boarding) || boarding.trim() : '',
              arr_terminal: arrTerminal.trim(),
              seats,
              seat_by_person: seatByPerson,
              notes: notes.trim(),
            },
            selectedPersonIds,
            existing?.id,
          );
        } else {
          if (!depPlace.trim() && !arrPlace.trim() && !notes.trim()) {
            setErr(fr ? 'Indiquez au moins un départ ou une destination' : 'Enter a pickup or destination');
            setSaving(false);
            return;
          }
          await onSave(
            'transport',
            {
              ...initData,
              mode: travelKind,
              carrier: carrier.trim(),
              number: number.trim(),
              pnr: pnr.trim(),
              ref: pnr.trim(),
              pickup: depPlace.trim(),
              dropoff: arrPlace.trim(),
              from: depPlace.trim(),
              to: arrPlace.trim(),
              date: depDate,
              arr_date: arrDate,
              time: parsedDep || '',
              arr_time: parsedArr || '',
              platform: travelKind === 'train' ? terminal.trim() : undefined,
              carriage: travelKind === 'train' ? gate.trim() : undefined,
              driver_name: driverName.trim(),
              driver_phone: driverPhone.trim(),
              vehicle: vehicle.trim(),
              meeting_point: meetingPoint.trim(),
              seats,
              notes: notes.trim(),
            },
            selectedPersonIds,
            existing?.id,
          );
        }
      } else if (isHotel) {
        if (!hotelName.trim()) {
          setErr(fr ? 'Nom de l’hôtel requis' : 'Hotel name is required');
          setSaving(false);
          return;
        }
        const ciVal = parseSingleClock(checkInTime) || checkInTime.trim();
        const coVal = parseSingleClock(checkOutTime) || checkOutTime.trim();
        await onSave(
          'hotels',
          {
            ...initData,
            name: hotelName.trim(),
            address: hotelAddress.trim(),
            check_in_date: checkInDate,
            check_in: ciVal,
            checkin: ciVal,
            check_out_date: checkOutDate,
            check_out: coVal,
            checkout: coVal,
            confirmation: hotelConf.trim(),
            phone: hotelPhone.trim(),
            room: hotelRoom.trim(),
            wifi_ssid: hotelWifi.trim(),
            notes: notes.trim(),
          },
          selectedPersonIds,
          existing?.id,
        );
      } else {
        if (!schedTitle.trim()) {
          setErr(fr ? 'Titre requis' : 'Title is required');
          setSaving(false);
          return;
        }
        const ps = schedStart.trim() ? parseSingleClock(schedStart) : '';
        const pe = schedEnd.trim() ? parseSingleClock(schedEnd) : '';
        if (schedStart.trim() && !ps) {
          setErr(fr ? `Heure invalide : ${schedStart}` : `Invalid start time: ${schedStart}`);
          setSaving(false);
          return;
        }
        if (schedEnd.trim() && !pe) {
          setErr(fr ? `Heure de fin invalide : ${schedEnd}` : `Invalid end time: ${schedEnd}`);
          setSaving(false);
          return;
        }
        await onSave(
          'schedule',
          {
            ...initData,
            type: schedType,
            title: schedTitle.trim(),
            label: schedTitle.trim(),
            date: schedDay,
            time: ps || '',
            end_time: pe || '',
            location: schedLoc.trim(),
            notes: notes.trim(),
          },
          selectedPersonIds,
          existing?.id,
        );
      }
      onClose();
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : 'save_failed');
      setSaving(false);
    }
  }

  const title = existing
    ? isTravel
      ? travelKind === 'flight'
        ? fr ? 'Modifier le vol' : 'Edit flight'
        : travelKind === 'train'
          ? fr ? 'Modifier le train' : 'Edit train'
          : travelKind === 'vessel'
            ? fr ? 'Modifier le bateau' : 'Edit ferry'
            : fr ? 'Modifier le transfert' : 'Edit transfer'
      : isHotel
        ? fr ? 'Modifier l’hôtel' : 'Edit hotel'
        : fr ? 'Modifier le moment' : 'Edit moment'
    : isTravel
      ? fr ? 'Ajouter un trajet' : 'Add a journey'
      : isHotel
        ? fr ? 'Ajouter un hôtel' : 'Add a hotel'
        : fr ? 'Ajouter un horaire' : 'Add a schedule item';

  const toggleWho = (pid: string) => {
    setDirty(true);
    setSelectedPersonIds((prev) => (prev.includes(pid) ? prev.filter((id) => id !== pid) : [...prev, pid]));
  };

  return (
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 60, background: 'rgba(0,0,0,0.52)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 14 }}
      onClick={onClose}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose();
        if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
          e.preventDefault();
          void handleSubmit(e as unknown as FormEvent);
        }
      }}
    >
      <div style={{ width: '100%', maxWidth: isTravel ? 760 : 560, maxHeight: '90vh', display: 'flex', flexDirection: 'column' }} onClick={(e) => e.stopPropagation()}>
        <div className="ytab" style={{ margin: '0 0 -1px 0' }}>
          <button type="button" className="box" onClick={onClose} title={fr ? 'Fermer' : 'Close'} />
          <span>{title}</span>
          {dirty && (
            <span style={{ marginLeft: 'auto', fontSize: 11, fontWeight: 700, color: 'var(--cv-yink)', opacity: 0.78 }}>
              • {fr ? 'Modifié' : 'Unsaved'}
            </span>
          )}
        </div>

        <form onSubmit={handleSubmit} className="win" style={{ display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
          <div style={{ flex: 1, overflowY: 'auto', padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
            {err && <div className="warn" role="alert">{err}</div>}

            {/* TRAVEL (FLIGHT / TRAIN / GROUND / VESSEL) */}
            {isTravel && (
              <>
                {!existing && (
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
                    <div className="segs">
                      {(
                        [
                          ['flight', fr ? '✈ Vol' : '✈ Flight'],
                          ['train', '🚆 Train'],
                          ['ground', fr ? '🚐 Transfert' : '🚐 Transfer'],
                          ['vessel', fr ? '⛴ Bateau' : '⛴ Ferry'],
                        ] as const
                      ).map(([k, lbl]) => (
                        <button
                          key={k}
                          type="button"
                          className={`seg${travelKind === k ? ' seg--on' : ''}`}
                          onClick={() => { setTravelKind(k); setLookupMsg(null); setDirty(true); }}
                        >
                          {lbl}
                        </button>
                      ))}
                    </div>
                    {travelKind === 'ground' && (depPlace || arrPlace) && (
                      <button
                        type="button"
                        className="btn"
                        style={{ minHeight: 26, padding: '0 8px', fontSize: 11.5 }}
                        title={fr ? 'Inverser départ et destination' : 'Swap pickup & drop-off'}
                        onClick={() => {
                          const tmp = depPlace;
                          setDepPlace(arrPlace);
                          setArrPlace(tmp);
                          setDirty(true);
                        }}
                      >
                        ⇄ {fr ? 'Inverser' : 'Swap'}
                      </button>
                    )}
                  </div>
                )}

                <div className="dre-g3">
                  <label className="block space-y-1">
                    <span className="lab">{travelKind === 'flight' ? (fr ? 'Compagnie' : 'Airline') : fr ? 'Opérateur' : 'Carrier'}</span>
                    <input className="in" value={carrier} onChange={(e) => { setCarrier(e.target.value); setDirty(true); }} placeholder={travelKind === 'flight' ? 'Air France' : 'Eurostar / VTC'} />
                  </label>
                  <label className="block space-y-1">
                    <span className="lab">{travelKind === 'flight' ? (fr ? 'N° de vol' : 'Flight no.') : fr ? 'Numéro' : 'Number'}</span>
                    <div style={{ display: 'flex', gap: 4 }}>
                      <input
                        className="in mono"
                        value={number}
                        onChange={(e) => {
                          const v = e.target.value;
                          setNumber(v);
                          setDirty(true);
                          if (travelKind === 'flight' && !carrier.trim()) {
                            const guessed = guessAirlineFromFlightNo(v);
                            if (guessed) setCarrier(guessed);
                          }
                        }}
                        placeholder={travelKind === 'flight' ? 'AF1234' : '9012'}
                        autoFocus={travelKind === 'flight'}
                      />
                      {travelKind === 'flight' && (
                        <button type="button" className="btn" disabled={lookupBusy || !number.trim()} onClick={() => void lookupFlight()} title={fr ? 'Rechercher ce vol' : 'Lookup live flight'}>
                          {lookupBusy ? '…' : '🔍'}
                        </button>
                      )}
                    </div>
                  </label>
                  <label className="block space-y-1">
                    <span className="lab">{fr ? 'Réservation (PNR)' : 'Booking ref'}</span>
                    <input className="in mono" value={pnr} onChange={(e) => { setPnr(e.target.value); setDirty(true); }} placeholder="XK89P2" />
                  </label>
                </div>

                {lookupMsg && (
                  <div className="sub" style={{ padding: '4px 8px', background: 'var(--cv-paper2)', border: '1px solid var(--cv-line2)', fontSize: 11.5 }}>
                    {lookupMsg}
                  </div>
                )}

                {lookupCands.length > 0 && (
                  <div style={{ border: '1px solid var(--cv-sel)', background: 'var(--cv-sepbg)', padding: 6 }}>
                    <div className="lab" style={{ marginBottom: 4 }}>{fr ? 'Vols trouvés (cliquez pour remplir)' : 'Matching flights'}</div>
                    {lookupCands.map((c, idx) => (
                      <button
                        key={idx}
                        type="button"
                        className="day"
                        style={{ gridTemplateColumns: 'auto 1fr auto' }}
                        onClick={() => applyCandidate(c)}
                      >
                        <span className="mono">{String(c.dep_iata || '')}→{String(c.arr_iata || '')}</span>
                        <span>{String(c.airline || '')} {String(c.dep_time || '')}–{String(c.arr_time || '')}</span>
                        <span className="sub">{c.terminal ? `T${String(c.terminal)}` : ''}</span>
                      </button>
                    ))}
                  </div>
                )}

                {/* Departure & Arrival Side-by-Side Fieldsets */}
                <div className="dre-g2">
                  <fieldset style={{ border: '1px solid var(--cv-line2)', padding: 8, margin: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <legend className="lab">{fr ? 'Départ' : 'Departure'}</legend>
                    <label className="block space-y-1">
                      <span className="lab">{travelKind === 'flight' ? (fr ? 'Aéroport (IATA)' : 'Airport (IATA)') : fr ? 'Lieu de départ' : 'Pickup'}</span>
                      <AutocompleteInput
                        inlineCell={false}
                        value={depPlace}
                        onChange={(v) => { setDepPlace(v); setDirty(true); }}
                        onCommit={(v) => { setDepPlace(v); setDirty(true); }}
                        suggestions={(travelKind === 'flight' ? airportSuggestions : transferPlaceSuggestions.length ? transferPlaceSuggestions : placeSuggestions)
                          .filter((s) => foldText(`${s.label} ${s.sub || ''}`).includes(foldText(depPlace)))
                          .slice(0, 6)}
                        placeholder={travelKind === 'flight' ? 'CDG' : 'Hôtel / Aéroport'}
                        autoFocus={travelKind === 'ground'}
                      />
                    </label>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                      <label className="block space-y-1">
                        <span className="lab">Date</span>
                        <input type="date" className="in mono" value={depDate} onChange={(e) => { setDepDate(e.target.value); setDirty(true); }} />
                      </label>
                      <label className="block space-y-1">
                        <span className="lab">{fr ? 'Heure' : 'Time'}</span>
                        <input
                          className="in mono"
                          value={depTime}
                          onChange={(e) => { setDepTime(e.target.value); setDirty(true); }}
                          onKeyDown={(e) => handleTimeKey(e, depTime, setDepTime)}
                          placeholder="11:20"
                        />
                      </label>
                    </div>
                    {travelKind === 'ground' ? (
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                        <label className="block space-y-1">
                          <span className="lab">{fr ? 'Chauffeur' : 'Driver'}</span>
                          <input className="in" value={driverName} onChange={(e) => { setDriverName(e.target.value); setDirty(true); }} />
                        </label>
                        <label className="block space-y-1">
                          <span className="lab">{fr ? 'Tél. chauffeur' : 'Driver phone'}</span>
                          <input className="in mono" value={driverPhone} onChange={(e) => { setDriverPhone(e.target.value); setDirty(true); }} />
                        </label>
                      </div>
                    ) : (
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6 }}>
                        <label className="block space-y-1">
                          <span className="lab">{travelKind === 'train' ? (fr ? 'Voie' : 'Platform') : 'Terminal'}</span>
                          <input className="in mono" value={terminal} onChange={(e) => { setTerminal(e.target.value); setDirty(true); }} placeholder="2F" />
                        </label>
                        <label className="block space-y-1">
                          <span className="lab">{travelKind === 'train' ? (fr ? 'Voiture' : 'Coach') : fr ? 'Porte' : 'Gate'}</span>
                          <input className="in mono" value={gate} onChange={(e) => { setGate(e.target.value); setDirty(true); }} placeholder="F32" />
                        </label>
                        <label className="block space-y-1">
                          <span className="lab">{fr ? 'Embarq.' : 'Board.'}</span>
                          <input className="in mono" value={boarding} onChange={(e) => { setBoarding(e.target.value); setDirty(true); }} placeholder="10:45" />
                        </label>
                      </div>
                    )}
                  </fieldset>

                  <fieldset style={{ border: '1px solid var(--cv-line2)', padding: 8, margin: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <legend className="lab">
                      {fr ? 'Arrivée' : 'Arrival'} {travelDuration ? `· ${travelDuration}` : ''}
                    </legend>
                    <label className="block space-y-1">
                      <span className="lab">{travelKind === 'flight' ? (fr ? 'Aéroport (IATA)' : 'Airport (IATA)') : fr ? 'Destination' : 'Drop-off'}</span>
                      <AutocompleteInput
                        inlineCell={false}
                        value={arrPlace}
                        onChange={(v) => { setArrPlace(v); setDirty(true); }}
                        onCommit={(v) => { setArrPlace(v); setDirty(true); }}
                        suggestions={(travelKind === 'flight' ? airportSuggestions : transferPlaceSuggestions.length ? transferPlaceSuggestions : placeSuggestions)
                          .filter((s) => foldText(`${s.label} ${s.sub || ''}`).includes(foldText(arrPlace)))
                          .slice(0, 6)}
                        placeholder={travelKind === 'flight' ? 'BER' : 'Salle / Hôtel'}
                        autoFocus={false}
                      />
                    </label>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                      <label className="block space-y-1">
                        <span className="lab">Date</span>
                        <input
                          type="date"
                          className="in mono"
                          value={arrDate}
                          onChange={(e) => { setArrDate(e.target.value); setArrDateTouched(true); setDirty(true); }}
                        />
                      </label>
                      <label className="block space-y-1">
                        <span className="lab">{fr ? 'Heure' : 'Time'}</span>
                        <input
                          className="in mono"
                          value={arrTime}
                          onChange={(e) => { setArrTime(e.target.value); setDirty(true); }}
                          onKeyDown={(e) => handleTimeKey(e, arrTime, setArrTime)}
                          placeholder="13:05"
                        />
                      </label>
                    </div>
                    {travelKind === 'ground' ? (
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                        <label className="block space-y-1">
                          <span className="lab">{fr ? 'Véhicule' : 'Vehicle'}</span>
                          <input className="in" value={vehicle} onChange={(e) => { setVehicle(e.target.value); setDirty(true); }} placeholder="Mercedes V-Class" />
                        </label>
                        <label className="block space-y-1">
                          <span className="lab">{fr ? 'Point RDV' : 'Meeting point'}</span>
                          <input className="in" value={meetingPoint} onChange={(e) => { setMeetingPoint(e.target.value); setDirty(true); }} placeholder="Sortie T2" />
                        </label>
                      </div>
                    ) : (
                      <label className="block space-y-1">
                        <span className="lab">{fr ? 'Terminal arrivée' : 'Arrival terminal'}</span>
                        <input className="in mono" value={arrTerminal} onChange={(e) => { setArrTerminal(e.target.value); setDirty(true); }} placeholder="T1" />
                      </label>
                    )}
                  </fieldset>
                </div>
              </>
            )}

            {/* HOTEL */}
            {isHotel && (
              <>
                <div className="dre-g2">
                  <label className="block space-y-1">
                    <span className="lab">{fr ? 'Hôtel *' : 'Hotel *'}</span>
                    <AutocompleteInput
                      inlineCell={false}
                      value={hotelName}
                      onChange={(v) => { setHotelName(v); setDirty(true); }}
                      onCommit={(v) => { setHotelName(v); setDirty(true); }}
                      suggestions={hotelSuggestions.filter((s) => foldText(`${s.label} ${s.sub || ''}`).includes(foldText(hotelName))).slice(0, 6)}
                      placeholder="Hôtel Amour / Michelberger"
                      autoFocus
                    />
                  </label>
                  <label className="block space-y-1">
                    <span className="lab">{fr ? 'Confirmation' : 'Confirmation ref'}</span>
                    <input className="in mono" value={hotelConf} onChange={(e) => { setHotelConf(e.target.value); setDirty(true); }} placeholder="HR9921" />
                  </label>
                </div>
                <label className="block space-y-1">
                  <span className="lab">{fr ? 'Adresse' : 'Address'}</span>
                  <input className="in" value={hotelAddress} onChange={(e) => { setHotelAddress(e.target.value); setDirty(true); }} />
                </label>
                <div className="dre-hotel-dates">
                  <label className="block space-y-1">
                    <span className="lab">{fr ? 'Arrivée' : 'Check-in'}</span>
                    <input type="date" className="in mono" value={checkInDate} onChange={(e) => { setCheckInDate(e.target.value); setDirty(true); }} />
                  </label>
                  <input className="in mono" value={checkInTime} onChange={(e) => { setCheckInTime(e.target.value); setDirty(true); }} placeholder="15:00" />
                  <label className="block space-y-1">
                    <span className="lab">{fr ? `Départ (${hotelNights}n)` : `Check-out (${hotelNights}n)`}</span>
                    <input type="date" className="in mono" value={checkOutDate} onChange={(e) => { setCheckOutDate(e.target.value); setDirty(true); }} />
                  </label>
                  <input className="in mono" value={checkOutTime} onChange={(e) => { setCheckOutTime(e.target.value); setDirty(true); }} placeholder="12:00" />
                </div>
                <div className="dre-g3">
                  <label className="block space-y-1">
                    <span className="lab">{fr ? 'Téléphone' : 'Phone'}</span>
                    <input className="in mono" value={hotelPhone} onChange={(e) => { setHotelPhone(e.target.value); setDirty(true); }} />
                  </label>
                  <label className="block space-y-1">
                    <span className="lab">{fr ? 'Chambre(s)' : 'Room(s)'}</span>
                    <input className="in mono" value={hotelRoom} onChange={(e) => { setHotelRoom(e.target.value); setDirty(true); }} placeholder="402, 405" />
                  </label>
                  <label className="block space-y-1">
                    <span className="lab">Wi-Fi</span>
                    <input className="in" value={hotelWifi} onChange={(e) => { setHotelWifi(e.target.value); setDirty(true); }} placeholder="SSID / pass" />
                  </label>
                </div>
              </>
            )}

            {/* SCHEDULE / MOMENT */}
            {!isTravel && !isHotel && (
              <>
                <div className="dre-sched-head">
                  <label className="block space-y-1">
                    <span className="lab">Type</span>
                    <select
                      className="in"
                      value={schedType}
                      onChange={(e) => {
                        const t = e.target.value;
                        setSchedType(t);
                        setDirty(true);
                        if (t === 'soundcheck') {
                          if (!schedTitle.trim()) setSchedTitle('Soundcheck');
                          if (!schedLoc.trim() && gig.venue) setSchedLoc(gig.venue);
                        } else if (t === 'repas' && !schedTitle.trim()) {
                          setSchedTitle(fr ? 'Dîner équipe' : 'Team dinner');
                        } else if (t === 'scène' && !schedLoc.trim() && gig.venue) {
                          setSchedLoc(gig.venue);
                        }
                      }}
                    >
                      <option value="">{fr ? 'Horaire' : 'Schedule'}</option>
                      <option value="logistique">{fr ? 'Logistique' : 'Logistics'}</option>
                      <option value="soundcheck">{fr ? 'Essai son / Soundcheck' : 'Soundcheck'}</option>
                      <option value="scène">Set / Show</option>
                      <option value="repas">{fr ? 'Repas / Catering' : 'Meal'}</option>
                      <option value="dayoff">{fr ? 'Jour off' : 'Day off'}</option>
                      <option value="autre">{fr ? 'Autre' : 'Other'}</option>
                    </select>
                  </label>
                  <label className="block space-y-1">
                    <span className="lab">{fr ? 'Titre *' : 'Title *'}</span>
                    <AutocompleteInput
                      inlineCell={false}
                      value={schedTitle}
                      onChange={(v) => { setSchedTitle(v); setDirty(true); }}
                      onCommit={(v) => { setSchedTitle(v); setDirty(true); }}
                      suggestions={activitySuggestions.filter((s) => foldText(s.label).includes(foldText(schedTitle))).slice(0, 6)}
                      placeholder="Soundcheck, Lobby call, Dîner…"
                      autoFocus
                    />
                  </label>
                </div>

                <div className="dre-g3">
                  <label className="block space-y-1">
                    <span className="lab">{fr ? 'Jour' : 'Day'}</span>
                    <input type="date" className="in mono" value={schedDay} onChange={(e) => { setSchedDay(e.target.value); setDirty(true); }} />
                  </label>
                  <label className="block space-y-1">
                    <span className="lab">{fr ? 'Début (↑↓ 5m · ⇧↑↓ 1h)' : 'Start (↑↓ 5m · ⇧↑↓ 1h)'}</span>
                    <div style={{ display: 'flex', gap: 3 }}>
                      <button type="button" className="btn" onClick={() => { setSchedStart(shiftClock(schedStart || '18:00', -15)); setDirty(true); }}>−15</button>
                      <input
                        className="in mono"
                        value={schedStart}
                        onChange={(e) => { setSchedStart(e.target.value); setDirty(true); }}
                        onKeyDown={(e) => handleTimeKey(e, schedStart, setSchedStart)}
                        placeholder="18:30"
                      />
                      <button type="button" className="btn" onClick={() => { setSchedStart(shiftClock(schedStart || '18:00', 15)); setDirty(true); }}>+15</button>
                    </div>
                  </label>
                  <label className="block space-y-1">
                    <span className="lab">{fr ? 'Fin (optionnel)' : 'End (optional)'}</span>
                    <input
                      className="in mono"
                      value={schedEnd}
                      onChange={(e) => { setSchedEnd(e.target.value); setDirty(true); }}
                      onKeyDown={(e) => handleTimeKey(e, schedEnd, setSchedEnd)}
                      placeholder="20:00"
                    />
                  </label>
                </div>

                <label className="block space-y-1">
                  <span className="lab">{fr ? 'Lieu' : 'Place'}</span>
                  <AutocompleteInput
                    inlineCell={false}
                    value={schedLoc}
                    onChange={(v) => { setSchedLoc(v); setDirty(true); }}
                    onCommit={(v) => { setSchedLoc(v); setDirty(true); }}
                    suggestions={placeSuggestions.filter((s) => foldText(`${s.label} ${s.sub || ''}`).includes(foldText(schedLoc))).slice(0, 6)}
                    placeholder={gig.venue || (fr ? 'Salle, hôtel, restaurant…' : 'Venue, hotel, restaurant…')}
                    autoFocus={false}
                  />
                </label>
              </>
            )}

            {/* WHO CHIPS (Pour qui) */}
            {chipPeople.length > 0 && (
              <div>
                <div className="lab" style={{ marginBottom: 4 }}>{fr ? 'Pour qui' : 'For whom'}</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                  {chipPeople.map((p) => {
                    const on = selectedPersonIds.includes(p.id);
                    return (
                      <button
                        key={p.id}
                        type="button"
                        className={`btn${on ? ' dk-sect--on' : ''}`}
                        style={{ minHeight: 24, padding: '0 8px', fontSize: 12 }}
                        onClick={() => toggleWho(p.id)}
                      >
                        {on ? '✓ ' : ''}{p.name.split(' ')[0]}
                      </button>
                    );
                  })}
                  <button
                    type="button"
                    className="btn"
                    style={{ minHeight: 24, padding: '0 8px', fontSize: 12 }}
                    onClick={() => {
                      setDirty(true);
                      setSelectedPersonIds(selectedPersonIds.length === chipPeople.length ? [] : chipPeople.map((p) => p.id));
                    }}
                  >
                    {selectedPersonIds.length === chipPeople.length ? (fr ? 'Personne' : 'Clear') : fr ? 'Tout le monde' : 'Everyone'}
                  </button>
                </div>
              </div>
            )}

            {/* PER-TRAVELLER SEATS & TICKET REFS (Flight / Train) */}
            {isTravel && (travelKind === 'flight' || travelKind === 'train') && selectedPersonIds.length > 0 && (
              <div style={{ borderTop: '1px solid var(--cv-line2)', paddingTop: 8 }}>
                <div className="lab" style={{ marginBottom: 4 }}>{fr ? 'Voyageurs · sièges & billets' : 'Travellers · seats & tickets'}</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {selectedPersonIds.map((pid) => {
                    const p = people.find((x) => x.id === pid);
                    if (!p) return null;
                    const s = seats[pid] || {};
                    return (
                      <div key={pid} style={{ display: 'grid', gridTemplateColumns: '120px 90px 1fr', gap: 6, alignItems: 'center' }}>
                        <span className="truncate"><b>{p.name}</b></span>
                        <input
                          className="in mono"
                          style={{ minHeight: 24, padding: '2px 6px' }}
                          value={s.seat || ''}
                          onChange={(e) => {
                            setSeats((prev) => ({ ...prev, [pid]: { ...prev[pid], seat: e.target.value } }));
                            setDirty(true);
                          }}
                          placeholder={fr ? 'Siège 12A' : 'Seat 12A'}
                        />
                        <input
                          className="in mono"
                          style={{ minHeight: 24, padding: '2px 6px' }}
                          value={s.ticket || ''}
                          onChange={(e) => {
                            setSeats((prev) => ({ ...prev, [pid]: { ...prev[pid], ticket: e.target.value } }));
                            setDirty(true);
                          }}
                          placeholder={fr ? 'N° billet / réf.' : 'Ticket / ref.'}
                        />
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* NOTES */}
            <label className="block space-y-1">
              <span className="lab">Notes</span>
              <textarea className="in" rows={2} value={notes} onChange={(e) => { setNotes(e.target.value); setDirty(true); }} />
            </label>
          </div>

          {/* BeOS Editor Footer */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', background: 'var(--cv-chrome2)', borderTop: '1px solid var(--cv-edge)' }}>
            {existing && onDelete && (
              <button
                type="button"
                className="btn warn"
                onClick={() => {
                  void onDelete(existing.id).then(onClose);
                }}
              >
                {fr ? 'Supprimer…' : 'Delete…'}
              </button>
            )}
            <span className="sub" style={{ fontSize: 11, marginLeft: 4 }}>Esc · ⌘↵</span>
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
              <button type="button" className="btn" onClick={onClose}>
                {fr ? 'Annuler' : 'Cancel'}
              </button>
              <button type="submit" className="btn btn--def" disabled={saving}>
                {saving ? '…' : existing ? (fr ? 'Enregistrer' : 'Save') : fr ? 'Ajouter' : 'Add'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
