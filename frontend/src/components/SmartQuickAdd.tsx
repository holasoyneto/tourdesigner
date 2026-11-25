import { Building2, Car, Clock, CornerDownLeft, MapPin, Plane, Plus, Sparkles, Train, Users } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type RefObject } from 'react';
import { api } from '../api/client';
import { formatClock } from '../lib/smartParse';
import {
  buildSmartSuggestions,
  parseSmartQuickAdd,
  type ParsedQuickAdd,
  type QuickIntent,
} from '../lib/smartQuickAdd';
import { useIsMobile } from '../lib/useIsMobile';
import type { Gig, GigItem, ItemCollection, Locale, Person } from '../types';
import type { SuggestionOption } from './AutocompleteInput';

interface Props {
  gig: Gig;
  items: GigItem[];
  people: Person[];
  onDatePersonIds: ReadonlySet<string>;
  placeSuggestions: SuggestionOption[];
  activitySuggestions: SuggestionOption[];
  locale: Locale;
  inputRef?: RefObject<HTMLInputElement | null>;
  onAdd: (collection: ItemCollection, data: Record<string, unknown>, personIds: string[], label: string) => Promise<void>;
  onOpenFullEditor: (parsed: ParsedQuickAdd) => void;
}

function IntentIcon({ intent, className = 'h-3.5 w-3.5' }: { intent: QuickIntent; className?: string }) {
  if (intent === 'flight') return <Plane className={className} />;
  if (intent === 'train') return <Train className={className} />;
  if (intent === 'ground') return <Car className={className} />;
  if (intent === 'hotel') return <Building2 className={className} />;
  return <Clock className={className} />;
}

function intentLabel(intent: QuickIntent, fr: boolean): string {
  if (intent === 'flight') return fr ? 'Vol' : 'Flight';
  if (intent === 'train') return 'Train';
  if (intent === 'ground') return fr ? 'Transfert' : 'Transfer';
  if (intent === 'hotel') return fr ? 'Hôtel' : 'Hotel';
  return fr ? 'Horaire' : 'Schedule';
}

export function SmartQuickAdd({
  gig,
  items,
  people,
  onDatePersonIds,
  placeSuggestions,
  activitySuggestions,
  locale,
  inputRef,
  onAdd,
  onOpenFullEditor,
}: Props) {
  const fr = locale === 'fr';
  const isMobile = useIsMobile();
  const localRef = useRef<HTMLInputElement>(null);
  const ref = inputRef || localRef;
  const wrapRef = useRef<HTMLDivElement>(null);

  const [raw, setRaw] = useState('');
  const [open, setOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(-1);
  const [busy, setBusy] = useState(false);
  const [justAdded, setJustAdded] = useState<string | null>(null);
  const [flightCands, setFlightCands] = useState<Array<Record<string, unknown>>>([]);

  const peopleById = useMemo(() => new Map(people.map((p) => [p.id, p])), [people]);

  const parsed = useMemo(
    () => parseSmartQuickAdd(raw, gig, items, people, onDatePersonIds, locale),
    [raw, gig, items, people, onDatePersonIds, locale],
  );

  const suggestions = useMemo(
    () => buildSmartSuggestions(raw, gig, items, people, onDatePersonIds, placeSuggestions, activitySuggestions, locale),
    [raw, gig, items, people, onDatePersonIds, placeSuggestions, activitySuggestions, locale],
  );

  // Debounced live flight lookup whenever user types a flight code like "AF1181"
  useEffect(() => {
    const code = parsed?.intent === 'flight' && parsed.flightNo && /^[A-Z]{2}\d{2,4}$/.test(parsed.flightNo) ? parsed.flightNo : '';
    if (!code) {
      setFlightCands([]);
      return;
    }
    const timer = window.setTimeout(() => {
      api
        .lookupFlight(code)
        .then((res) => setFlightCands(res.candidates.slice(0, 3)))
        .catch(() => setFlightCands([]));
    }, 340);
    return () => window.clearTimeout(timer);
  }, [parsed?.intent, parsed?.flightNo]);

  // Reset highlight when input changes
  useEffect(() => {
    setActiveIdx(-1);
  }, [raw]);

  // Close popover on outside click
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);

  async function commitParsed(p: ParsedQuickAdd) {
    if (busy) return;
    if (p.needsEditor) {
      setOpen(false);
      onOpenFullEditor(p);
      setRaw('');
      return;
    }
    setBusy(true);
    try {
      await onAdd(p.collection, p.data, p.personIds, p.title);
      setRaw('');
      setFlightCands([]);
      setOpen(false);
      setJustAdded(p.title);
      window.setTimeout(() => setJustAdded((cur) => (cur === p.title ? null : cur)), 2200);
      ref.current?.blur();
    } finally {
      setBusy(false);
    }
  }

  function applySuggestion(fillText: string, submitNow = false) {
    if (submitNow) {
      const p = parseSmartQuickAdd(fillText, gig, items, people, onDatePersonIds, locale);
      if (p) {
        void commitParsed(p);
        return;
      }
    }
    setRaw(fillText);
    setActiveIdx(-1);
    ref.current?.focus();
  }

  function applyFlightCandidate(c: Record<string, unknown>) {
    const dep = String(c.dep_iata || '');
    const arr = String(c.arr_iata || '');
    const dt = String(c.dep_time || '');
    const at = String(c.arr_time || '');
    const t = c.terminal ? ` T${String(c.terminal)}` : '';
    const g = c.gate ? ` gate ${String(c.gate)}` : '';
    const code = parsed?.flightNo || String(c.flight_no || '');
    setRaw(`${code} ${dep} ${arr} ${dt}${at ? `-${at}` : ''}${t}${g}`.trim() + ' ');
    setFlightCands([]);
    ref.current?.focus();
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Escape') {
      e.preventDefault();
      if (raw) setRaw('');
      else {
        setOpen(false);
        ref.current?.blur();
      }
      return;
    }

    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && parsed) {
      e.preventDefault();
      setOpen(false);
      onOpenFullEditor(parsed);
      setRaw('');
      return;
    }

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(true);
      if (suggestions.length) setActiveIdx((i) => (i + 1) % suggestions.length);
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setOpen(true);
      if (suggestions.length) setActiveIdx((i) => (i <= 0 ? suggestions.length - 1 : i - 1));
      return;
    }

    // Tab completes top/selected suggestion seamlessly!
    if (e.key === 'Tab' && open && suggestions.length > 0) {
      e.preventDefault();
      const target = suggestions[activeIdx >= 0 ? activeIdx : 0];
      if (target) applySuggestion(target.fillText);
      return;
    }

    if (e.key === 'Enter') {
      e.preventDefault();
      // If user explicitly navigated to a suggestion with arrows
      if (activeIdx >= 0 && suggestions[activeIdx]) {
        const s = suggestions[activeIdx];
        // If input was empty and it's a complete contextual preset, submit or fill
        const isPreset = !raw.trim() && !s.fillText.endsWith(' ') && s.fillText !== 'AF';
        applySuggestion(s.fillText, isPreset);
        return;
      }
      if (parsed) {
        void commitParsed(parsed);
      }
    }
  }

  const parsedWhoNames = parsed
    ? parsed.personIds.map((id) => peopleById.get(id)?.name.split(/\s+/)[0] || '').filter(Boolean)
    : [];

  return (
    <div ref={wrapRef} className={`sqa no-print${open ? ' sqa--open' : ''}`}>
      {/* Floating upward popover: live parsed preview and contextual suggestions */}
      {open && (parsed || suggestions.length > 0 || flightCands.length > 0) && (
        <div className="win sqa-pop" role="listbox">
          {/* Live Structured Preview Strip */}
          {parsed && (
            <div className="sqa-preview">
              <span className={`sqa-badge sqa-badge--${parsed.intent}`}>
                <IntentIcon intent={parsed.intent} className="h-3 w-3" />
                {intentLabel(parsed.intent, fr)}
              </span>
              {parsed.startTime && (
                <span className="mono" style={{ fontWeight: 700 }}>
                  {formatClock(parsed.startTime, locale)}
                  {parsed.endTime && parsed.endTime !== parsed.startTime ? `–${formatClock(parsed.endTime, locale)}` : ''}
                </span>
              )}
              <strong className="truncate">{parsed.title}</strong>
              {parsed.location && <span className="sub truncate">· {parsed.location}</span>}
              {parsed.refCode && <span className="mono sub">· {parsed.refCode}</span>}
              {parsed.phone && <span className="mono sub">· {parsed.phone}</span>}
              {parsedWhoNames.length > 0 && (
                <span className="sqa-who">👥 {parsedWhoNames.join(', ')}</span>
              )}
              <span className="sqa-hints">
                <button
                  type="button"
                  className="btn"
                  style={{ minHeight: 22, padding: '0 8px', fontSize: 11.5 }}
                  title={fr ? 'Ouvrir dans l’éditeur complet (⌘⏎)' : 'Open in full editor (⌘⏎)'}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    setOpen(false);
                    onOpenFullEditor(parsed);
                    setRaw('');
                  }}
                >
                  ⌘⏎ {fr ? 'Détails' : 'Details'}
                </button>
              </span>
            </div>
          )}

          {/* Live FlightAware Candidates */}
          {flightCands.length > 0 && (
            <div className="sqa-section">
              <div className="lab sqa-sec-lab">{fr ? 'Vols trouvés (cliquez pour remplir)' : 'Live flights found'}</div>
              {flightCands.map((c, i) => (
                <button key={i} type="button" className="sqa-opt" onClick={() => applyFlightCandidate(c)}>
                  <Plane className="h-3.5 w-3.5 shrink-0 opacity-75" />
                  <b className="mono">{String(c.dep_iata || '')} → {String(c.arr_iata || '')}</b>
                  <span className="mono sub">{String(c.dep_time || '')}–{String(c.arr_time || '')}</span>
                  <span className="sub truncate">{String(c.airline || '')}</span>
                  <span className="sqa-tab">↵</span>
                </button>
              ))}
            </div>
          )}

          {/* Contextual / Autocomplete Suggestions */}
          {suggestions.length > 0 && (
            <div className="sqa-section">
              <div className="lab sqa-sec-lab">
                {!raw.trim()
                  ? fr ? 'Suggestions pour cette journée' : 'Smart suggestions for this day'
                  : fr ? 'Autocomplétion (Tab)' : 'Autocomplete (Tab)'}
              </div>
              {suggestions.map((s, i) => {
                const isOn = i === activeIdx;
                return (
                  <button
                    key={s.id}
                    type="button"
                    role="option"
                    aria-selected={isOn}
                    className={`sqa-opt${isOn ? ' sqa-opt--on' : ''}`}
                    onMouseEnter={() => setActiveIdx(i)}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      const isPreset = !raw.trim() && !s.fillText.endsWith(' ') && s.fillText !== 'AF';
                      applySuggestion(s.fillText, isPreset);
                    }}
                  >
                    {s.icon === 'person' ? (
                      <Users className="h-3.5 w-3.5 shrink-0 opacity-75" />
                    ) : s.icon === 'place' ? (
                      <MapPin className="h-3.5 w-3.5 shrink-0 opacity-75" />
                    ) : (
                      <IntentIcon intent={s.intent} className="h-3.5 w-3.5 shrink-0 opacity-75" />
                    )}
                    <span className="truncate" style={{ fontWeight: 600 }}>{s.label}</span>
                    {s.sub && <span className="sub truncate">{s.sub}</span>}
                    <span className="sqa-tab mono">{i === 0 && raw.trim() ? 'Tab' : !raw.trim() ? '⏎' : ''}</span>
                  </button>
                );
              })}
            </div>
          )}

          {/* Subtle syntax chips footer */}
          <div className="sqa-foot">
            <button type="button" className="sqa-chip" onMouseDown={(e) => { e.preventDefault(); setRaw((v) => `${v}${v && !v.endsWith(' ') ? ' ' : ''}@`); ref.current?.focus(); }}>
              {fr ? '@lieu' : '@venue'}
            </button>
            <button type="button" className="sqa-chip" onMouseDown={(e) => { e.preventDefault(); setRaw((v) => `${v}${v && !v.endsWith(' ') ? ' ' : ''}#`); ref.current?.focus(); }}>
              {fr ? '#équipe' : '#crew'}
            </button>
            <button type="button" className="sqa-chip" onMouseDown={(e) => { e.preventDefault(); setRaw('AF'); ref.current?.focus(); }}>
              {fr ? '✈ vol' : '✈ flight'}
            </button>
            <button type="button" className="sqa-chip" onMouseDown={(e) => { e.preventDefault(); setRaw('taxi '); ref.current?.focus(); }}>
              🚗 taxi
            </button>
            <button type="button" className="sqa-chip" onMouseDown={(e) => { e.preventDefault(); setRaw(fr ? 'hotel 15h ' : 'hotel 15:00 '); ref.current?.focus(); }}>
              {fr ? '🏨 hôtel' : '🏨 hotel'}
            </button>
            <span className="sqa-foot-keys">
              <kbd>Tab</kbd>
              <kbd>⏎</kbd>
              <kbd>⌘⏎</kbd>
            </span>
          </div>
        </div>
      )}

      {/* Main Single-Line Command Input */}
      <div className="sqa-bar">
        <span className={`sqa-lead${parsed ? ` sqa-lead--${parsed.intent}` : ''}`}>
          {parsed ? <IntentIcon intent={parsed.intent} className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
        </span>
        <input
          ref={ref}
          className="sqa-input"
          value={raw}
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            setRaw(e.target.value);
            if (!open) setOpen(true);
          }}
          onKeyDown={onKeyDown}
          placeholder={
            isMobile
              ? fr
                ? 'Ajouter vol, taxi, hôtel, soundcheck…'
                : 'Add flight, taxi, hotel, soundcheck…'
              : fr
                ? 'Ajouter… « 18h30 soundcheck », « taxi hotel → salle », « AF1181 »'
                : 'Add anything… "18:30 soundcheck", "taxi hotel -> venue", "AF1181"'
          }
          autoComplete="off"
          spellCheck={false}
        />
        {justAdded && !raw && (
          <span className="sqa-toast">
            <Sparkles className="h-3 w-3" /> {justAdded} ✓
          </span>
        )}
        {!raw.trim() && !justAdded && (
          <kbd
            className="sqa-kbd"
            title={fr ? (open ? 'Fermer (Esc)' : 'Raccourci : touche N') : open ? 'Close (Esc)' : 'Shortcut: press N'}
          >
            {open ? 'Esc' : 'N'}
          </kbd>
        )}
        {raw.trim() && parsed && (
          <button
            type="button"
            className="btn btn--def"
            style={{ minHeight: 24, padding: '0 9px', fontSize: 12 }}
            disabled={busy}
            onClick={() => void commitParsed(parsed)}
          >
            <CornerDownLeft className="h-3 w-3" /> {fr ? 'Ajouter' : 'Add'}
          </button>
        )}
      </div>
    </div>
  );
}
