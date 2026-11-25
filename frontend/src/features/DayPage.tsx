import {
  Archive,
  Bot,
  Building2,
  Car,
  Check,
  CheckSquare,
  ClipboardList,
  Clock,
  Copy,
  FileText,
  HelpCircle,
  Link2,
  ListMusic,
  MapPin,
  MessageCircle,
  MoreHorizontal,
  Music,
  PanelRightClose,
  PanelRightOpen,
  Pencil,
  Phone,
  Plane,
  Plus,
  Printer,
  Share2,
  Sparkles,
  Square,
  StickyNote,
  Train,
  Trash2,
  Undo2,
  Upload,
  Users,
  Zap,
} from 'lucide-react';
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type ClipboardEvent, type KeyboardEvent, type MouseEvent } from 'react';
import { api } from '../api/client';
import { fileAssetUrl, fullUrl } from '../lib/basePath';
import { AutocompleteInput, type SuggestionOption } from '../components/AutocompleteInput';
import { PeoplePicker } from '../components/PeoplePicker';
import { SmartQuickAdd } from '../components/SmartQuickAdd';
import type { CopyDict } from '../i18n/copy';
import {
  AIRPORTS,
  computeGap,
  foldText,
  formatClock,
  formatDayPlainText,
  parseLineupPaste,
  parseSmartClockCell,
  STATUS_LABELS,
  type GapInfo,
} from '../lib/smartParse';
import type { TourSyncState } from '../offline/sync';
import type { FileRecord, Gig, GigItem, Locale, Person, Project, User } from '../types';
import { DayHeaderEditor } from './DayHeaderEditor';
import { DayRowEditor, type RowEditorMode } from './DayRowEditor';
import { MobileDaySheet } from './MobileDaySheet';
import { useIsMobile } from '../lib/useIsMobile';
const PasteWindow = lazy(() => import('./PasteWindow').then((m) => ({ default: m.PasteWindow })));

interface Props {
  gig: Gig;
  items: GigItem[];
  allGigs: Gig[];
  allItemsByGig: Record<string, GigItem[]>;
  people: Person[];
  projects?: Project[];
  user: User;
  locale: Locale;
  copy: CopyDict;
  sync: TourSyncState;
  onNavigate?: (path: string) => void;
  onOpenFile?: (fileId: string) => void;
}

type FolderId = 'crew' | 'docs' | 'order' | 'rider' | 'notes';
type SheetCol = 0 | 1 | 2 | 3; // 0=Heure, 1=Activité, 2=Lieu, 3=Pour qui
type RowKindIcon = 'flight' | 'train' | 'ground' | 'hotel' | 'set' | 'schedule';

interface TimelineRow {
  key: string;
  item?: GigItem;
  sortKey: string;
  startTime?: string | null;
  endTime?: string | null;
  isTravel: boolean;
  isHotel: boolean;
  iconKind: RowKindIcon;
  time: string;
  what: string;
  where: string;
  who: string;
  note: string;
  facts: Array<[string, string]>;
  refCode?: string;
  mapsQuery?: string;
  phone?: string;
}

function RowGlyph({ kind }: { kind: RowKindIcon }) {
  const cls = 'h-3.5 w-3.5 shrink-0 opacity-75';
  if (kind === 'flight') return <Plane className={cls} />;
  if (kind === 'train') return <Train className={cls} />;
  if (kind === 'ground') return <Car className={cls} />;
  if (kind === 'hotel') return <Building2 className={cls} />;
  if (kind === 'set') return <Music className={cls} />;
  return <Clock className={cls} />;
}

function shortDateLabel(iso: string, locale: Locale): string {
  if (!iso) return '—';
  const d = new Date(`${iso.slice(0, 10)}T12:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  const s = new Intl.DateTimeFormat(locale === 'fr' ? 'fr-FR' : 'en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(d);
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function clockRangeCompact(start?: string | null, end?: string | null, locale: Locale = 'en'): string {
  const s = start ? formatClock(start, locale) : '';
  const e = end ? formatClock(end, locale) : '';
  if (s && e && e !== s) return `${s}–${e}`;
  return s || '—';
}

function personInitials(name: string): string {
  const parts = name.replace(/[()]/g, '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
}

function roleTone(role: string): 'artist' | 'tm' | 'other' {
  const r = role.toLowerCase();
  if (/artist|dj|lead|performer/.test(r)) return 'artist';
  if (/tour|manager|tm|prod|agent/.test(r)) return 'tm';
  return 'other';
}

function clubSlotSort(hhmm: string): number {
  const m = hhmm.match(/^(\d{1,2}):(\d{2})/);
  if (!m) return 9999;
  const mins = parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
  return mins < 360 ? mins + 1440 : mins;
}

interface UndoEntry {
  label: string;
  revert: () => Promise<void>;
  redo: () => Promise<void>;
}

function fullDateLabel(iso: string, locale: Locale): string {
  if (!iso) return '—';
  const d = new Date(`${iso.slice(0, 10)}T12:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat(locale === 'fr' ? 'fr-FR' : 'en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(d);
}

export function DayPage({ gig, items, allGigs, allItemsByGig, people, projects = [], user, locale, copy, sync, onNavigate, onOpenFile }: Props) {
  const canEdit = user.role !== 'viewer';
  const isOwner = user.role === 'owner';
  const fr = locale === 'fr';
  const isMobile = useIsMobile();
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [multiKeys, setMultiKeys] = useState<Set<string>>(() => new Set());
  const [bulkWhoOpen, setBulkWhoOpen] = useState(false);
  const [cursor, setCursor] = useState<{ row: number; col: SheetCol } | null>(null);
  const [cellNav, setCellNav] = useState(false);
  const [editingCell, setEditingCell] = useState<{ rowKey: string; col: SheetCol; draft: string } | null>(null);
  const [sheetMsg, setSheetMsg] = useState<{ text: string; warn?: boolean } | null>(null);
  const [folder, setFolder] = useState<FolderId>('crew');
  const [viewMineOnly, setViewMineOnly] = useState(false);
  const [detailHeight, setDetailHeight] = useState<number>(168);
  const [dossierOpen, setDossierOpen] = useState(true);
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [flashRowKey, setFlashRowKey] = useState<string | null>(null);
  const quickAddInputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const addMenuRef = useRef<HTMLDivElement>(null);

  // Per-date Undo / Redo stacks (⌘Z / ⇧⌘Z)
  const undoStack = useRef<UndoEntry[]>([]);
  const redoStack = useRef<UndoEntry[]>([]);

  // Header, Entry Menu, Lifecycle Dialog & Rich Row Editor
  const [editingHeader, setEditingHeader] = useState(false);
  const [entryMenuOpen, setEntryMenuOpen] = useState(false);
  const [rowEditor, setRowEditor] = useState<RowEditorMode | null>(null);
  const [lifecycleConfirm, setLifecycleConfirm] = useState<'archive' | 'trash' | null>(null);

  // Folder interactive forms & inline editors
  const [crewAddKind, setCrewAddKind] = useState<null | 'crew' | 'contacts' | 'guests'>(null);
  const [crewInput, setCrewInput] = useState({ name: '', role: '', phone: '', email: '', pass_type: '+1' });
  const [editCrewId, setEditCrewId] = useState<string | null>(null);
  const [editCrewDraft, setEditCrewDraft] = useState({ role: '', phone: '', pass_type: '' });
  const [orderForm, setOrderForm] = useState({ start: '', end: '', act: '', is_us: false });
  const [orderAddOpen, setOrderAddOpen] = useState(false);
  const [editOrderId, setEditOrderId] = useState<string | null>(null);
  const [editOrderDraft, setEditOrderDraft] = useState({ start: '', end: '', act: '' });
  const [orderPasteOpen, setOrderPasteOpen] = useState(false);
  const [orderPasteText, setOrderPasteText] = useState('');
  const [riderText, setRiderText] = useState('');
  const [riderCat, setRiderCat] = useState<'booth' | 'hospitality' | 'tech'>('booth');
  const [editRiderId, setEditRiderId] = useState<string | null>(null);
  const [editRiderDraft, setEditRiderDraft] = useState('');
  const [docsDrag, setDocsDrag] = useState(false);
  const [notesDraft, setNotesDraft] = useState(gig.notes || '');
  const [linkForm, setLinkForm] = useState({ label: '', url: '' });

  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [files, setFiles] = useState<FileRecord[]>([]);
  const [showIntake, setShowIntake] = useState(false);
  const [intakeText, setIntakeText] = useState('');

  useEffect(() => {
    setNotesDraft(gig.notes || '');
    setSelectedKey(null);
    setMultiKeys(new Set());
    setBulkWhoOpen(false);
    setCursor(null);
    setCellNav(false);
    setEditingCell(null);
    setEditingHeader(false);
    setEntryMenuOpen(false);
    setRowEditor(null);
    setLifecycleConfirm(null);
    undoStack.current = [];
    redoStack.current = [];
    setSheetMsg(null);
  }, [gig.id]);

  useEffect(() => {
    if (user.role === 'viewer') return;
    api.listFiles(gig.id).then((r) => setFiles(r.files)).catch(() => undefined);
  }, [gig.id, user.role]);

  // Dismiss floating + Ajouter & ⋯ popovers on outside click or Escape
  useEffect(() => {
    if (!entryMenuOpen && !moreMenuOpen) return;
    const onDown = (e: globalThis.MouseEvent) => {
      if (addMenuRef.current && !addMenuRef.current.contains(e.target as Node)) {
        setEntryMenuOpen(false);
        setMoreMenuOpen(false);
      }
    };
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        setEntryMenuOpen(false);
        setMoreMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [entryMenuOpen, moreMenuOpen]);

  const flashCopy = (id: string, text: string) => {
    void navigator.clipboard?.writeText(text).catch(() => undefined);
    setCopiedKey(id);
    window.setTimeout(() => setCopiedKey((cur) => (cur === id ? null : cur)), 1800);
  };

  const say = useCallback((text: string, warn = false) => {
    setSheetMsg({ text, warn });
    if (!warn) window.setTimeout(() => setSheetMsg((cur) => (cur?.text === text ? null : cur)), 3200);
  }, []);

  const pushUndo = useCallback((entry: UndoEntry) => {
    undoStack.current.push(entry);
    redoStack.current = [];
  }, []);

  // ⌘Z / ⇧⌘Z per-date undo/redo + N hotkey to jump straight to SmartQuickAdd
  useEffect(() => {
    if (!canEdit) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const isEmptyQuickAdd =
        target === quickAddInputRef.current && !(target as HTMLInputElement).value;
      if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) {
        if (!(isEmptyQuickAdd && (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z')) return;
      }
      if (!e.metaKey && !e.ctrlKey && !e.altKey && e.key.toLowerCase() === 'n') {
        e.preventDefault();
        quickAddInputRef.current?.focus();
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) {
          const next = redoStack.current.pop();
          if (!next) { say(locale === 'fr' ? 'Rien à rétablir' : 'Nothing to redo'); return; }
          undoStack.current.push(next);
          void next.redo().then(() => say(`${locale === 'fr' ? 'Rétabli' : 'Redone'} · ${next.label}`));
        } else {
          const prev = undoStack.current.pop();
          if (!prev) { say(locale === 'fr' ? 'Rien à annuler' : 'Nothing to undo'); return; }
          redoStack.current.push(prev);
          void prev.revert().then(() => say(`${locale === 'fr' ? 'Annulé' : 'Undone'} · ${prev.label}`));
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [canEdit, locale, say]);

  const peopleById = useMemo(() => Object.fromEntries(people.map((p) => [p.id, p])), [people]);
  const byCol = useMemo(() => {
    const m: Record<string, GigItem[]> = {};
    for (const it of items) (m[it.collection] ||= []).push(it);
    return m;
  }, [items]);

  const onDatePersonIds = useMemo(() => {
    const set = new Set<string>();
    for (const c of [...(byCol.crew || []), ...(byCol.contacts || [])]) {
      for (const pid of c.person_ids) set.add(pid);
    }
    return set;
  }, [byCol]);

  // Context-smart suggestion pools (current gig Venue & Hotel FIRST; airports separated from Hotel/Schedule!)
  const { placeSuggestions, hotelSuggestions, transferPlaceSuggestions, activitySuggestions } = useMemo(() => {
    const places = new Map<string, SuggestionOption>();
    const hotels = new Map<string, SuggestionOption>();
    const transfers = new Map<string, SuggestionOption>();

    // 1. Current gig's own hotel, venue, and flight airports go FIRST!
    for (const h of byCol.hotels || []) {
      const n = String(h.data.name || '').trim();
      if (n) {
        const opt = { value: n, label: n, sub: String(h.data.city || gig.city || 'Hôtel') };
        hotels.set(n.toLowerCase(), opt);
        places.set(n.toLowerCase(), opt);
        transfers.set(n.toLowerCase(), opt);
      }
    }
    if (gig.venue) {
      const opt = { value: gig.venue, label: gig.venue, sub: gig.city };
      places.set(gig.venue.toLowerCase(), opt);
      transfers.set(gig.venue.toLowerCase(), opt);
    }
    for (const f of byCol.flights || []) {
      for (const code of [f.data.arr_iata, f.data.dep_iata]) {
        const iata = String(code || '').trim().toUpperCase();
        if (!iata) continue;
        const ap = AIRPORTS.find((a) => a.iata === iata);
        const opt = { value: ap ? `${ap.iata} (${ap.city})` : iata, label: ap ? `${ap.iata} · ${ap.city}` : iata, sub: ap?.name || 'Airport' };
        transfers.set(iata, opt);
      }
    }

    // 2. Tour-wide venues, hotels & historical locations
    const acts = new Set<string>(['Soundcheck', 'Lobby call', 'Dîner équipe', 'Load-in', 'Press / Interview', 'Meet & greet', 'Doors', 'Curfew']);
    for (const g of allGigs) {
      if (g.venue && !places.has(g.venue.toLowerCase())) {
        const opt = { value: g.venue, label: g.venue, sub: g.city };
        places.set(g.venue.toLowerCase(), opt);
        transfers.set(g.venue.toLowerCase(), opt);
      }
    }
    for (const list of Object.values(allItemsByGig)) {
      for (const it of list) {
        if (it.collection === 'hotels' && it.data.name) {
          const n = String(it.data.name).trim();
          const opt = { value: n, label: n, sub: String(it.data.city || 'Hôtel') };
          if (!hotels.has(n.toLowerCase())) hotels.set(n.toLowerCase(), opt);
          if (!places.has(n.toLowerCase())) places.set(n.toLowerCase(), opt);
          if (!transfers.has(n.toLowerCase())) transfers.set(n.toLowerCase(), opt);
        }
        if (it.collection === 'schedule') {
          if (it.data.label) acts.add(String(it.data.label));
          if (it.data.title) acts.add(String(it.data.title));
          if (it.data.location) {
            const loc = String(it.data.location).trim();
            if (loc && !places.has(loc.toLowerCase())) {
              places.set(loc.toLowerCase(), { value: loc, label: loc });
            }
          }
        }
      }
    }

    // 3. Major airports appended AFTER local venues/hotels for transfers only (never polluting Hotels!)
    for (const a of AIRPORTS) {
      if (!transfers.has(a.iata)) {
        transfers.set(a.iata, { value: `${a.iata} (${a.city})`, label: `${a.iata} · ${a.city}`, sub: a.name });
      }
    }

    return {
      placeSuggestions: [...places.values()],
      hotelSuggestions: [...hotels.values()],
      transferPlaceSuggestions: [...transfers.values()],
      activitySuggestions: [...acts].map((a) => ({ value: a, label: a })),
    };
  }, [allGigs, allItemsByGig, byCol, gig.city, gig.venue]);

  // Disambiguated first names (adds last initial when two people share a first name!)
  const firstCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const p of people) {
      const f = p.name.split(' ')[0]?.toLowerCase() || '';
      if (f) counts[f] = (counts[f] || 0) + 1;
    }
    return counts;
  }, [people]);

  const shortPersonName = useCallback(
    (id: string) => {
      const p = peopleById[id];
      if (!p) return id;
      const parts = p.name.trim().split(/\s+/);
      if (parts.length > 1 && (firstCounts[parts[0].toLowerCase()] || 0) > 1) {
        return `${parts[0]} ${parts[1][0]}.`;
      }
      return parts[0];
    },
    [peopleById, firstCounts],
  );

  const whoLabel = useCallback(
    (pids: string[]) => {
      if (!pids.length) return locale === 'fr' ? 'Tous' : 'All';
      const names = pids.map(shortPersonName);
      return names.length === 1 ? names[0] : `${names[0]} +${names.length - 1}`;
    },
    [locale, shortPersonName],
  );

  const myPersonId = useMemo(
    () => user.travel_person_id || people.find((p) => p.email && user.email && p.email.toLowerCase() === user.email.toLowerCase())?.id || null,
    [user, people],
  );

  // Unified chronological rows (clean text titles, compact FR clocks, vector icons — zero truncation clutter!)
  const timeline = useMemo<TimelineRow[]>(() => {
    const rows: TimelineRow[] = [];
    const matchMine = (pids: string[]) => !viewMineOnly || !myPersonId || pids.length === 0 || pids.includes(myPersonId);

    for (const f of byCol.flights || []) {
      if (!matchMine(f.person_ids)) continue;
      const d = f.data;
      const dep = String(d.dep_time || '');
      const arr = String(d.arr_time || '');
      const route = [d.dep_iata || d.dep_city, d.arr_iata || d.arr_city].filter(Boolean).join(' → ');
      const refVal = String(d.pnr || d.ref || '');
      const seats = d.seat_by_person && typeof d.seat_by_person === 'object'
        ? Object.entries(d.seat_by_person as Record<string, string>).map(([pid, s]) => `${shortPersonName(pid)} ${s}`).join(', ')
        : String(d.seat || '');
      rows.push({
        key: f.id,
        item: f,
        sortKey: dep || '08:00',
        startTime: dep || null,
        endTime: arr || null,
        isTravel: true,
        isHotel: false,
        iconKind: 'flight',
        time: clockRangeCompact(dep, arr, locale),
        what: `${String(d.flight_no || (fr ? 'Vol' : 'Flight'))}${route ? ` · ${route}` : ''}`,
        where: [d.airline, d.terminal ? (String(d.terminal).startsWith('T') ? String(d.terminal) : `T${d.terminal}`) : '', d.gate ? `Gate ${d.gate}` : ''].filter(Boolean).join(' · '),
        who: whoLabel(f.person_ids),
        note: [refVal ? `PNR ${refVal}` : '', seats].filter(Boolean).join(' · '),
        refCode: refVal || undefined,
        mapsQuery: String(d.arr_city || d.arr_iata || gig.city || ''),
        facts: [
          [fr ? 'Vol' : 'Flight', `${String(d.airline || '')} ${String(d.flight_no || '')}`.trim()],
          [fr ? 'Trajet' : 'Route', route || '—'],
          [fr ? 'Horaires' : 'Times', clockRangeCompact(dep, arr, locale)],
          ['Terminal / Gate', [d.terminal ? (String(d.terminal).startsWith('T') ? String(d.terminal) : `T${d.terminal}`) : '', d.gate ? `Gate ${d.gate}` : ''].filter(Boolean).join(' · ') || '—'],
          [fr ? 'Référence' : 'Ref / PNR', refVal || '—'],
          [fr ? 'Sièges' : 'Seats', seats || '—'],
          [fr ? 'Passagers' : 'Passengers', f.person_ids.map((id) => peopleById[id]?.name || id).join(', ') || '—'],
        ],
      });
    }

    for (const t of byCol.transport || []) {
      if (!matchMine(t.person_ids)) continue;
      const d = t.data;
      const tm = String(d.time || '');
      const arr = String(d.arr_time || '');
      const route = [d.from || d.pickup, d.to || d.dropoff].filter(Boolean).join(' → ');
      const refVal = String(d.pnr || d.ref || '');
      rows.push({
        key: t.id,
        item: t,
        sortKey: tm || '12:00',
        startTime: tm || null,
        endTime: arr || tm || null,
        isTravel: true,
        isHotel: false,
        iconKind: String(d.mode || '').toLowerCase() === 'train' ? 'train' : 'ground',
        time: clockRangeCompact(tm, arr, locale),
        what: route || String(d.notes || (fr ? 'Transfert' : 'Transfer')),
        where: [d.driver_name, d.vehicle].filter(Boolean).join(' · '),
        who: whoLabel(t.person_ids),
        note: String(d.driver_phone || refVal || ''),
        refCode: refVal || undefined,
        mapsQuery: String(d.to || d.dropoff || d.from || d.pickup || ''),
        phone: d.driver_phone ? String(d.driver_phone) : undefined,
        facts: [
          [fr ? 'Trajet' : 'Route', route || String(d.notes || '—')],
          [fr ? 'Chauffeur' : 'Driver', String(d.driver_name || d.driver || '—')],
          [fr ? 'Téléphone' : 'Phone', String(d.driver_phone || '—')],
          [fr ? 'Véhicule' : 'Vehicle', String(d.vehicle || '—')],
          [fr ? 'Référence' : 'Ref / PNR', refVal || '—'],
          [fr ? 'Passagers' : 'Passengers', t.person_ids.map((id) => peopleById[id]?.name || id).join(', ') || '—'],
          ['Notes', String(d.notes || '—')],
        ],
      });
    }

    for (const h of byCol.hotels || []) {
      if (!matchMine(h.person_ids)) continue;
      const d = h.data;
      const ci = String(d.check_in || d.checkin || '15:00');
      const co = String(d.check_out || d.checkout || '');
      rows.push({
        key: h.id,
        item: h,
        sortKey: ci,
        startTime: ci,
        endTime: ci,
        isTravel: false,
        isHotel: true,
        iconKind: 'hotel',
        time: formatClock(ci, locale),
        what: String(d.name || (fr ? 'Hôtel' : 'Hotel')),
        where: String(d.address || d.city || ''),
        who: whoLabel(h.person_ids),
        note: [d.confirmation ? `Conf ${d.confirmation}` : '', co ? `out ${formatClock(co, locale)}` : ''].filter(Boolean).join(' · '),
        refCode: d.confirmation ? String(d.confirmation) : undefined,
        mapsQuery: String(d.address || d.name || ''),
        phone: d.phone ? String(d.phone) : undefined,
        facts: [
          [fr ? 'Hôtel' : 'Hotel', String(d.name || '—')],
          [fr ? 'Adresse' : 'Address', String(d.address || '—')],
          ['Check-in / out', `${formatClock(ci, locale)}${co ? ` / ${formatClock(co, locale)}` : ''}`],
          ['Confirmation', String(d.confirmation || '—')],
          [fr ? 'Téléphone' : 'Phone', String(d.phone || '—')],
          ['Wi-Fi', String(d.wifi_ssid || '—')],
          [fr ? 'Passagers' : 'Guests', h.person_ids.map((id) => peopleById[id]?.name || id).join(', ') || '—'],
        ],
      });
    }

    for (const s of byCol.schedule || []) {
      if (!matchMine(s.person_ids)) continue;
      const d = s.data;
      const start = String(d.time || '');
      const end = String(d.end_time || '');
      rows.push({
        key: s.id,
        item: s,
        sortKey: start || '18:00',
        startTime: start || null,
        endTime: end || null,
        isTravel: false,
        isHotel: false,
        iconKind: 'schedule',
        time: clockRangeCompact(start, end, locale),
        what: String(d.title || d.label || '—'),
        where: String(d.location || ''),
        who: whoLabel(s.person_ids),
        note: String(d.notes || ''),
        mapsQuery: String(d.location || ''),
        facts: [
          [fr ? 'Horaire' : 'Time', clockRangeCompact(start, end, locale)],
          [fr ? 'Activité' : 'Activity', String(d.title || d.label || '—')],
          [fr ? 'Lieu' : 'Location', String(d.location || '—')],
          [fr ? 'Pour qui' : 'Who', s.person_ids.map((id) => peopleById[id]?.name || id).join(', ') || (fr ? 'Tous' : 'All')],
          ['Notes', String(d.notes || '—')],
        ],
      });
    }

    if (gig.set_time) {
      const h = parseInt(gig.set_time.slice(0, 2), 10);
      const sortSet = !Number.isNaN(h) && h < 6 ? `2${gig.set_time}` : gig.set_time;
      const gigArtist = gig.name && gig.name.includes('—') ? gig.name.split('—')[0].trim() : '';
      const setLabel = gigArtist ? `Set ${gigArtist}` : fr ? 'Concert / Set' : 'Main Set';
      rows.push({
        key: '__set__',
        sortKey: sortSet,
        startTime: gig.set_time,
        endTime: gig.set_end || null,
        isTravel: false,
        isHotel: false,
        iconKind: 'set',
        time: clockRangeCompact(gig.set_time, gig.set_end, locale),
        what: setLabel,
        where: gig.venue || gig.city,
        who: gigArtist || (fr ? 'Artiste' : 'Artist'),
        note: gig.doors_time ? `Doors ${formatClock(gig.doors_time, locale)}` : '',
        mapsQuery: String(gig.venue_address || gig.venue || gig.city || ''),
        facts: [
          ['Set', clockRangeCompact(gig.set_time, gig.set_end, locale)],
          [fr ? 'Salle' : 'Venue', [gig.venue, gig.venue_address].filter(Boolean).join(' · ') || '—'],
          ['Soundcheck', gig.soundcheck_time ? formatClock(gig.soundcheck_time, locale) : '—'],
          ['Doors', gig.doors_time ? formatClock(gig.doors_time, locale) : '—'],
          [fr ? 'Promoteur' : 'Promoter', gig.promoter || '—'],
        ],
      });
    }

    return rows.sort((a, b) => a.sortKey.localeCompare(b.sortKey));
  }, [byCol, gig, peopleById, locale, viewMineOnly, myPersonId, shortPersonName, whoLabel]);

  // Precompute free-time / tight-connection gap rows between consecutive events
  const gapsAfter = useMemo(() => {
    const map: Record<string, GapInfo> = {};
    for (let i = 0; i < timeline.length - 1; i++) {
      const g = computeGap(timeline[i], { startTime: timeline[i + 1].startTime, label: timeline[i + 1].what, isTravel: timeline[i + 1].isTravel }, locale);
      if (g) map[timeline[i].key] = g;
    }
    return map;
  }, [timeline, locale]);

  const activeRow = timeline.find((r) => r.key === selectedKey) || timeline[0] || null;
  const nextRow = timeline[0] || null;

  const latestMcpBatch = useMemo(() => {
    const mcpItems = items.filter((it) => it.added_channel === 'mcp' && it.batch_id);
    if (!mcpItems.length) return null;
    mcpItems.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
    const bid = mcpItems[0].batch_id!;
    return { batchId: bid, actor: mcpItems[0].added_by_name || 'Assistant', count: mcpItems.filter((it) => it.batch_id === bid).length };
  }, [items]);

  // Inline cell edit commit (4 clean columns: Heure, Activité, Lieu, Pour qui + smart clock validation + undo!)
  function beginCellEdit(row: TimelineRow, col: SheetCol, seed?: string) {
    if (!canEdit) return;
    if (!row.item && row.key !== '__set__') return;
    if (row.key === '__set__' && col !== 0) return;
    const initial =
      seed ??
      (col === 0
        ? row.time.replace('—', '')
        : col === 1
          ? row.item
            ? String(row.item.data.title || row.item.data.label || row.item.data.flight_no || row.item.data.name || row.item.data.from || row.item.data.pickup || '')
            : row.what
          : col === 2
            ? row.where
            : '');
    setEditingCell({ rowKey: row.key, col, draft: initial });
  }

  async function commitCellEdit(row: TimelineRow, col: SheetCol, raw: string) {
    // Handle Set row clock edit directly on gig header!
    if (row.key === '__set__') {
      if (col === 0) {
        const parsed = parseSmartClockCell(raw, gig.set_time, gig.set_end);
        if (!parsed.ok) { say(parsed.error, true); return; }
        const prev = { set_time: gig.set_time, set_end: gig.set_end };
        const next = { set_time: parsed.start, set_end: parsed.end };
        setEditingCell(null);
        await sync.updateGigHeader(gig.id, next);
        pushUndo({ label: 'Set', revert: () => sync.updateGigHeader(gig.id, prev), redo: () => sync.updateGigHeader(gig.id, next) });
        say(fr ? 'Enregistré' : 'Saved');
      } else {
        setEditingCell(null);
      }
      return;
    }

    const item = row.item;
    if (!item) { setEditingCell(null); return; }

    let patch: Record<string, unknown> | null = null;
    if (col === 0) {
      const parsed = parseSmartClockCell(raw, row.startTime, row.endTime);
      if (!parsed.ok) { say(parsed.error, true); return; }
      if (item.collection === 'flights') patch = { dep_time: parsed.start, ...(parsed.end ? { arr_time: parsed.end } : {}) };
      else if (item.collection === 'hotels') patch = { check_in: parsed.start, checkin: parsed.start, ...(parsed.end ? { check_out: parsed.end, checkout: parsed.end } : {}) };
      else if (item.collection === 'transport') patch = { time: parsed.start, ...(parsed.end ? { arr_time: parsed.end } : {}) };
      else patch = { time: parsed.start, end_time: parsed.end };
    } else if (col === 1) {
      const v = raw.trim();
      if (!v) { setEditingCell(null); return; }
      if (item.collection === 'flights') patch = { flight_no: v.replace(/\s/g, '').toUpperCase() };
      else if (item.collection === 'hotels') patch = { name: v };
      else if (item.collection === 'transport') {
        const parts = v.split(/\s*(?:->|→)\s*/);
        patch = parts.length === 2 ? { from: parts[0], to: parts[1], pickup: parts[0], dropoff: parts[1] } : { notes: v };
      } else patch = { title: v, label: v };
    } else if (col === 2) {
      const v = raw.trim();
      if (item.collection === 'hotels') patch = { address: v };
      else if (item.collection === 'transport') patch = { vehicle: v };
      else if (item.collection === 'flights') patch = { airline: v };
      else patch = { location: v };
    }

    setEditingCell(null);
    if (!patch) return;
    const prevData = Object.fromEntries(Object.keys(patch).map((k) => [k, item.data[k]]));
    const nextPatch = patch;
    await sync.updateGigItem(gig.id, item.id, nextPatch);
    pushUndo({
      label: row.what,
      revert: () => sync.updateGigItem(gig.id, item.id, prevData),
      redo: () => sync.updateGigItem(gig.id, item.id, nextPatch),
    });
    say(fr ? 'Enregistré' : 'Saved');
  }

  function handleCellClick(row: TimelineRow, rowIdx: number, col: SheetCol, e: MouseEvent) {
    if (e.shiftKey && cursor) {
      const lo = Math.min(cursor.row, rowIdx);
      const hi = Math.max(cursor.row, rowIdx);
      const next = new Set(multiKeys);
      for (let i = lo; i <= hi; i++) {
        if (timeline[i]?.item) next.add(timeline[i].key);
      }
      setMultiKeys(next);
    } else if (e.metaKey || e.ctrlKey) {
      if (row.item) {
        const next = new Set(multiKeys);
        if (next.has(row.key)) next.delete(row.key);
        else next.add(row.key);
        setMultiKeys(next);
      }
    } else {
      if (multiKeys.size) setMultiKeys(new Set());
    }
    setSelectedKey(row.key);
    setCursor({ row: rowIdx, col });
    setCellNav(false);
  }

  async function removeItemWithUndo(item: GigItem, label: string) {
    await sync.removeGigItem(gig.id, item.id);
    pushUndo({
      label: `${fr ? 'Suppression' : 'Delete'} · ${label}`,
      revert: async () => { await sync.addGigItem(gig.id, item.collection, item.data, item.person_ids); },
      redo: () => sync.removeGigItem(gig.id, item.id),
    });
    say(fr ? `Supprimé · ${label} (⌘Z pour annuler)` : `Deleted · ${label} (⌘Z to undo)`);
  }

  async function duplicateItem(item: GigItem) {
    await sync.addGigItem(gig.id, item.collection, { ...item.data }, [...item.person_ids]);
    say(fr ? 'Ligne dupliquée' : 'Row duplicated');
  }

  async function copySelectedTsv() {
    const picked = multiKeys.size
      ? timeline.filter((r) => multiKeys.has(r.key))
      : activeRow
        ? [activeRow]
        : [];
    if (!picked.length) return;
    const tsv = picked.map((r) => [r.time, r.what, r.where, r.who, r.note].join('\t')).join('\n');
    await navigator.clipboard?.writeText(tsv).catch(() => undefined);
    say(fr ? `${picked.length} ligne(s) copiée(s) (TSV)` : `Copied ${picked.length} row(s) as TSV`);
  }

  async function fillDownSelected() {
    if (!canEdit || !cursor || multiKeys.size < 2) return;
    const picked = timeline.filter((r) => multiKeys.has(r.key) && r.item);
    if (picked.length < 2) return;
    const src = picked[0];
    const col = cursor.col;
    const targets = picked.slice(1);
    if (col === 3 && src.item) {
      const ids = [...src.item.person_ids];
      for (const t of targets) {
        if (t.item) await sync.updateGigItem(gig.id, t.item.id, {}, ids);
      }
      say(fr ? `Pour qui recopié sur ${targets.length} ligne(s)` : `Filled Who down to ${targets.length} row(s)`);
    } else if (col === 2) {
      for (const t of targets) {
        if (!t.item) continue;
        const field = t.item.collection === 'hotels' ? 'address' : t.item.collection === 'transport' ? 'vehicle' : 'location';
        await sync.updateGigItem(gig.id, t.item.id, { [field]: src.where });
      }
      say(fr ? `Lieu recopié sur ${targets.length} ligne(s)` : `Filled Where down to ${targets.length} row(s)`);
    } else {
      say(fr ? 'Placez le curseur sur Lieu ou Pour qui pour recopier vers le bas (⌘D)' : 'Focus Where or Who column to Fill Down (⌘D)', true);
    }
  }

  async function deleteSelectedRows() {
    if (!canEdit) return;
    const targets = multiKeys.size
      ? timeline.filter((r) => multiKeys.has(r.key) && r.item)
      : activeRow?.item
        ? [activeRow]
        : [];
    if (!targets.length) return;
    for (const r of targets) {
      if (r.item) await sync.removeGigItem(gig.id, r.item.id);
    }
    setMultiKeys(new Set());
    say(fr ? `${targets.length} ligne(s) supprimée(s)` : `Deleted ${targets.length} row(s)`);
  }

  // Keyboard navigation on the 5-column spreadsheet grid
  function onGridKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (editingCell || !timeline.length) return;
    if ((e.target as HTMLElement).closest('input, textarea, select')) return;
    const cur = cursor || { row: 0, col: 0 as SheetCol };
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key.toLowerCase() === 'a') {
      e.preventDefault();
      setMultiKeys(new Set(timeline.filter((r) => r.item).map((r) => r.key)));
      return;
    }
    if (mod && e.key.toLowerCase() === 'c') {
      e.preventDefault();
      void copySelectedTsv();
      return;
    }
    if (mod && e.key.toLowerCase() === 'd' && canEdit) {
      e.preventDefault();
      void fillDownSelected();
      return;
    }
    if (mod && e.key.toLowerCase() === 'e' && canEdit && timeline[cur.row]?.item) {
      e.preventDefault();
      setRowEditor({ kind: 'edit', item: timeline[cur.row].item! });
      return;
    }
    if (e.key === 'Escape' && multiKeys.size) {
      e.preventDefault();
      setMultiKeys(new Set());
      return;
    }
    if ((e.key === 'Delete' || e.key === 'Backspace') && canEdit) {
      e.preventDefault();
      void deleteSelectedRows();
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      const next = Math.min(timeline.length - 1, cur.row + 1);
      if (e.shiftKey && timeline[next]?.item) {
        setMultiKeys((prev) => new Set([...prev, timeline[cur.row].key, timeline[next].key]));
      }
      setCursor({ row: next, col: cur.col });
      setCellNav(true);
      setSelectedKey(timeline[next].key);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      const next = Math.max(0, cur.row - 1);
      if (e.shiftKey && timeline[next]?.item) {
        setMultiKeys((prev) => new Set([...prev, timeline[cur.row].key, timeline[next].key]));
      }
      setCursor({ row: next, col: cur.col });
      setCellNav(true);
      setSelectedKey(timeline[next].key);
    } else if (e.key === 'ArrowRight' || (e.key === 'Tab' && !e.shiftKey)) {
      e.preventDefault();
      setCursor({ row: cur.row, col: ((cur.col + 1) % 4) as SheetCol });
      setCellNav(true);
    } else if (e.key === 'ArrowLeft' || (e.key === 'Tab' && e.shiftKey)) {
      e.preventDefault();
      setCursor({ row: cur.row, col: ((cur.col + 3) % 4) as SheetCol });
      setCellNav(true);
    } else if (e.key === 'Enter' && e.shiftKey && canEdit) {
      e.preventDefault();
      setRowEditor({ kind: 'add', collection: 'schedule', presetTime: timeline[cur.row]?.endTime || timeline[cur.row]?.startTime || '' });
    } else if ((e.key === 'Enter' || e.key === 'F2') && canEdit) {
      e.preventDefault();
      beginCellEdit(timeline[cur.row], cur.col);
    } else if (canEdit && e.key.length === 1 && !mod && !e.altKey && !['j', 'k', '/', 'n'].includes(e.key.toLowerCase())) {
      e.preventDefault();
      beginCellEdit(timeline[cur.row], cur.col, e.key);
    }
  }

  // Direct multi-line / spreadsheet paste onto the Day Sheet!
  async function onGridPaste(e: ClipboardEvent<HTMLDivElement>) {
    if (!canEdit || editingCell) return;
    if ((e.target as HTMLElement).closest('input, textarea')) return;
    const text = e.clipboardData.getData('text/plain').trim();
    if (!text) return;
    e.preventDefault();
    // Direct TSV paste (copied from another date or Excel!)
    const lines = text.split(/\r?\n/).filter((l) => l.includes('\t'));
    if (lines.length > 0 && lines.every((l) => l.split('\t').length >= 2)) {
      for (const line of lines) {
        const [rawTime, rawWhat, rawWhere, , rawNote] = line.split('\t');
        const parsed = rawTime ? parseSmartClockCell(rawTime) : null;
        await sync.addGigItem(gig.id, 'schedule', {
          time: parsed?.ok ? parsed.start : '',
          end_time: parsed?.ok && parsed.end ? parsed.end : '',
          title: (rawWhat || '').trim(),
          label: (rawWhat || '').trim(),
          location: (rawWhere || '').trim(),
          notes: (rawNote || '').trim(),
        });
      }
      say(fr ? `${lines.length} ligne(s) collée(s) depuis le tableau` : `Pasted ${lines.length} spreadsheet row(s)`);
      return;
    }
    const res = await api.extractIntake(text, gig.id);
    if (res.proposal.items.length > 0) {
      await api.applyIntake(gig.id, res.proposal);
      await sync.refreshFull();
      say(`${res.proposal.items.length} ligne(s) collée(s)`);
    } else {
      setIntakeText(text);
      setShowIntake(true);
    }
  }

  async function handleLifecycleConfirm() {
    if (!lifecycleConfirm) return;
    if (lifecycleConfirm === 'archive') {
      await sync.updateGigHeader(gig.id, { archived: true });
    } else {
      await api.deleteGig(gig.id);
      await sync.refreshFull();
    }
    setLifecycleConfirm(null);
    onNavigate?.('/tour');
  }

  function startSplitResize(e: MouseEvent) {
    e.preventDefault();
    const startY = e.clientY;
    const startH = detailHeight;
    const onMove = (ev: globalThis.MouseEvent) => {
      setDetailHeight(Math.max(96, Math.min(380, startH + (startY - ev.clientY))));
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }

  async function handleShare(scope: 'gig_master' | 'gig_crew' = 'gig_master', personId?: string, label?: string) {
    const existing = await api.listShares(gig.id);
    let key = existing.shares.find((s) => s.scope === scope && (!personId || s.person_id === personId) && s.enabled)?.key;
    if (!key) {
      const created = await api.createShare({ scope, gig_id: gig.id, person_id: personId, label: label || `${gig.city} — ${gig.venue}` });
      key = created.share.key;
    }
    flashCopy(personId || 'share_master', fullUrl(`/link/${key}`));
  }

  const crewAndContacts = [...(byCol.crew || []), ...(byCol.contacts || [])];
  const folderTabs: Array<{ id: FolderId; label: string; count: number; icon: typeof Users }> = [
    { id: 'crew', label: locale === 'fr' ? 'Équipe et contacts' : 'Crew & contacts', count: crewAndContacts.length + (byCol.guests?.length || 0), icon: Users },
    { id: 'docs', label: 'Documents', count: files.length, icon: FileText },
    { id: 'order', label: 'Running order', count: byCol.timetable?.length || 0, icon: ListMusic },
    { id: 'rider', label: 'Rider', count: byCol.rider?.length || 0, icon: ClipboardList },
    { id: 'notes', label: locale === 'fr' ? 'Notes & partage' : 'Notes & share', count: (gig.notes ? 1 : 0) + (byCol.notes_list?.length || 0) + (byCol.links?.length || 0), icon: StickyNote },
  ];
  const activeTabMeta = folderTabs.find((t) => t.id === folder)!;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {isMobile ? (
        <MobileDaySheet
          gig={gig}
          items={items}
          allGigs={allGigs}
          people={people}
          files={files}
          setFiles={setFiles}
          timeline={timeline}
          gapsAfter={gapsAfter}
          nextRow={nextRow}
          byCol={byCol}
          onDatePersonIds={onDatePersonIds}
          placeSuggestions={placeSuggestions}
          activitySuggestions={activitySuggestions}
          latestMcpBatch={latestMcpBatch}
          canEdit={canEdit}
          isOwner={isOwner}
          locale={locale}
          copy={copy}
          sync={sync}
          copiedKey={copiedKey}
          flashCopy={flashCopy}
          quickAddInputRef={quickAddInputRef}
          viewMineOnly={viewMineOnly}
          myPersonId={myPersonId}
          onToggleMine={() => setViewMineOnly((v) => !v)}
          onNavigate={onNavigate}
          onOpenFile={onOpenFile}
          onOpenHeaderEditor={() => setEditingHeader(true)}
          onOpenRowEditorAdd={(collection, presetTime) => setRowEditor({ kind: 'add', collection, presetTime })}
          onOpenRowEditorEdit={(item) => setRowEditor({ kind: 'edit', item })}
          onOpenRowEditorParsed={(p) => {
            const col =
              p.collection === 'flights' || p.collection === 'transport' || p.collection === 'hotels'
                ? p.collection
                : 'schedule';
            setRowEditor({
              kind: 'add',
              collection: col,
              presetTime: p.startTime,
              travelKind: p.intent === 'train' ? 'train' : p.intent === 'ground' ? 'ground' : p.intent === 'flight' ? 'flight' : undefined,
              presetData: p.data,
              presetPersonIds: p.personIds,
            });
          }}
          onQuickAddCommit={async (collection, data, personIds, label) => {
            const newId = await sync.addGigItem(gig.id, collection, data, personIds);
            setSelectedKey(newId);
            pushUndo({
              label: `${fr ? 'Ajout' : 'Add'} · ${label}`,
              revert: () => sync.removeGigItem(gig.id, newId),
              redo: async () => { await sync.addGigItem(gig.id, collection, data, personIds); },
            });
            say(fr ? `Ajouté · ${label}` : `Added · ${label}`);
          }}
          onDuplicateItem={duplicateItem}
          onRemoveItem={removeItemWithUndo}
          onOpenIntake={() => setShowIntake(true)}
          onShare={handleShare}
          onLifecycleRequest={(kind) => setLifecycleConfirm(kind)}
          say={say}
        />
      ) : (
        <>
      {/* 1. Clean Single-Row Date Bar (M1 MacBook Air first — zero wrapping clutter) */}
      <div className="dk-datebar">
        <div className="flex min-w-0 items-baseline gap-2 truncate">
          <strong style={{ fontSize: 14, whiteSpace: 'nowrap' }}>{shortDateLabel(gig.date, locale)}</strong>
          <span className="dk-pill">{STATUS_LABELS[locale][gig.status]}</span>
          {gig.set_time && (
            <span className="mono sub" style={{ whiteSpace: 'nowrap' }}>
              Set {clockRangeCompact(gig.set_time, gig.set_end, locale)}
            </span>
          )}
          {typeof gig.fee === 'number' && (
            <span className="mono sub dk-hide-1280" style={{ whiteSpace: 'nowrap' }}>
              · {gig.fee.toLocaleString()} {gig.currency}
            </span>
          )}
        </div>

        <div ref={addMenuRef} className="dk-datebar__acts no-print" style={{ position: 'relative' }}>
          {canEdit && (
            <button
              type="button"
              className={`btn${entryMenuOpen ? ' dk-sect--on' : !nextRow?.refCode ? ' btn--def' : ''}`}
              aria-expanded={entryMenuOpen}
              onClick={() => { setEntryMenuOpen((v) => !v); setMoreMenuOpen(false); }}
            >
              + {fr ? 'Ajouter' : 'Add'}
            </button>
          )}
          {canEdit && (
            <button type="button" className="btn" onClick={() => setEditingHeader(true)}>
              {fr ? 'Infos' : 'Info'}
            </button>
          )}
          <button
            type="button"
            className="btn"
            onClick={() => (onNavigate ? onNavigate(`/print?gig=${encodeURIComponent(gig.id)}`) : window.print())}
          >
            {copy.print}
          </button>
          <button
            type="button"
            className="btn"
            aria-expanded={moreMenuOpen}
            title={fr ? 'Plus d’actions' : 'More actions'}
            onClick={() => { setMoreMenuOpen((v) => !v); setEntryMenuOpen(false); }}
          >
            <MoreHorizontal className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            className="btn"
            title={dossierOpen ? (fr ? 'Masquer le dossier' : 'Hide dossier') : fr ? 'Afficher le dossier' : 'Show dossier'}
            onClick={() => setDossierOpen((v) => !v)}
          >
            {dossierOpen ? <PanelRightClose className="h-3.5 w-3.5" /> : <PanelRightOpen className="h-3.5 w-3.5" />}
          </button>

          {/* Crisp Floating + Ajouter Command Popover (Zero layout jump, Esc & outside-click dismiss!) */}
          {canEdit && entryMenuOpen && (
            <div className="win dk-addmenu" role="menu" aria-label={fr ? 'Compléter la journée' : 'Fill day sheet'}>
              <div className="dk-addmenu__sec">
                <div className="lab dk-addmenu__lab">{fr ? 'Sur la journée' : 'On the day sheet'}</div>
                <div className="dk-addmenu__grid">
                  <button type="button" className="dk-addmenu__item" onClick={() => { setEntryMenuOpen(false); setRowEditor({ kind: 'add', collection: 'flights', travelKind: 'flight' }); }}>
                    <Plane className="h-3.5 w-3.5" />
                    <span>{fr ? 'Vol' : 'Flight'}</span>
                  </button>
                  <button type="button" className="dk-addmenu__item" onClick={() => { setEntryMenuOpen(false); setRowEditor({ kind: 'add', collection: 'transport', travelKind: 'ground' }); }}>
                    <Car className="h-3.5 w-3.5" />
                    <span>{fr ? 'Transfert / Train' : 'Transfer / Train'}</span>
                  </button>
                  <button type="button" className="dk-addmenu__item" onClick={() => { setEntryMenuOpen(false); setRowEditor({ kind: 'add', collection: 'hotels' }); }}>
                    <Building2 className="h-3.5 w-3.5" />
                    <span>{fr ? 'Hôtel' : 'Hotel'}</span>
                  </button>
                  <button type="button" className="dk-addmenu__item" onClick={() => { setEntryMenuOpen(false); setRowEditor({ kind: 'add', collection: 'schedule' }); }}>
                    <Clock className="h-3.5 w-3.5" />
                    <span>{fr ? 'Horaire' : 'Schedule'}</span>
                  </button>
                </div>
              </div>

              <div className="dk-addmenu__sec">
                <div className="lab dk-addmenu__lab">{fr ? 'Dossier & équipe' : 'Dossier & crew'}</div>
                <div className="dk-addmenu__grid">
                  <button type="button" className="dk-addmenu__item" onClick={() => { setEntryMenuOpen(false); setDossierOpen(true); setFolder('crew'); setCrewAddKind('crew'); }}>
                    <Users className="h-3.5 w-3.5" />
                    <span>{fr ? 'Équipe' : 'Crew'}</span>
                  </button>
                  <button type="button" className="dk-addmenu__item" onClick={() => { setEntryMenuOpen(false); setDossierOpen(true); setFolder('crew'); setCrewAddKind('contacts'); }}>
                    <Phone className="h-3.5 w-3.5" />
                    <span>{fr ? 'Contact local' : 'Contact'}</span>
                  </button>
                  <button type="button" className="dk-addmenu__item" onClick={() => { setEntryMenuOpen(false); setDossierOpen(true); setFolder('crew'); setCrewAddKind('guests'); }}>
                    <Users className="h-3.5 w-3.5" />
                    <span>{fr ? 'Invité' : 'Guest'}</span>
                  </button>
                  <button type="button" className="dk-addmenu__item" onClick={() => { setEntryMenuOpen(false); setDossierOpen(true); setFolder('order'); setOrderPasteOpen(true); }}>
                    <ListMusic className="h-3.5 w-3.5" />
                    <span>Running order</span>
                  </button>
                  <button type="button" className="dk-addmenu__item" onClick={() => { setEntryMenuOpen(false); setDossierOpen(true); setFolder('rider'); }}>
                    <ClipboardList className="h-3.5 w-3.5" />
                    <span>Rider</span>
                  </button>
                  <button type="button" className="dk-addmenu__item" onClick={() => { setEntryMenuOpen(false); setDossierOpen(true); setFolder('docs'); }}>
                    <FileText className="h-3.5 w-3.5" />
                    <span>{fr ? 'Document' : 'Document'}</span>
                  </button>
                  <button type="button" className="dk-addmenu__item" onClick={() => { setEntryMenuOpen(false); setDossierOpen(true); setFolder('notes'); }}>
                    <StickyNote className="h-3.5 w-3.5" />
                    <span>{fr ? 'Note / Lien' : 'Note / Link'}</span>
                  </button>
                  <button type="button" className="dk-addmenu__item" onClick={() => { setEntryMenuOpen(false); setEditingHeader(true); }}>
                    <Pencil className="h-3.5 w-3.5" />
                    <span>{fr ? 'Infos & lieu' : 'Event & venue'}</span>
                  </button>
                </div>
              </div>

              <div className="dk-addmenu__foot">
                <button
                  type="button"
                  className="btn"
                  style={{ flex: 1, minHeight: 28, fontSize: 12 }}
                  onClick={() => {
                    setEntryMenuOpen(false);
                    quickAddInputRef.current?.focus();
                  }}
                >
                  <Zap className="h-3.5 w-3.5" />
                  {fr ? 'Saisie rapide (N)' : 'Quick bar (N)'}
                </button>
                <button
                  type="button"
                  className="btn btn--def"
                  style={{ flex: 1, minHeight: 28, fontSize: 12 }}
                  onClick={() => { setEntryMenuOpen(false); setShowIntake(true); }}
                >
                  <Sparkles className="h-3.5 w-3.5" />
                  {fr ? 'Coller AI / PDF' : 'Paste AI / PDF'}
                </button>
              </div>
            </div>
          )}

          {moreMenuOpen && (
            <div className="win dk-popmenu dk-popmenu--rich" role="menu" onClick={() => setMoreMenuOpen(false)}>
              <div className="dk-addmenu__sec" style={{ padding: '6px 8px' }}>
                <div className="lab dk-addmenu__lab">{fr ? 'Partager & vue' : 'Share & view'}</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <button
                    type="button"
                    className="dk-addmenu__item"
                    onClick={() => flashCopy('copy_day', formatDayPlainText(gig, items, people, locale))}
                  >
                    {copiedKey === 'copy_day' ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                    <span>{copiedKey === 'copy_day' ? copy.copied : fr ? 'Copier la journée (WhatsApp)' : 'Copy day sheet (WhatsApp)'}</span>
                  </button>
                  {canEdit && (
                    <button type="button" className="dk-addmenu__item" onClick={() => void handleShare('gig_master')}>
                      {copiedKey === 'share_master' ? <Check className="h-3.5 w-3.5" /> : <Share2 className="h-3.5 w-3.5" />}
                      <span>{copiedKey === 'share_master' ? copy.copied : fr ? 'Copier lien voyageur' : 'Copy traveler link'}</span>
                    </button>
                  )}
                  {myPersonId && (
                    <button type="button" className="dk-addmenu__item" onClick={() => setViewMineOnly((v) => !v)}>
                      <Users className="h-3.5 w-3.5" />
                      <span>{viewMineOnly ? (fr ? 'Afficher toute l’équipe' : 'Show whole team') : fr ? 'Mes trajets uniquement' : 'Filter to my travel only'}</span>
                    </button>
                  )}
                </div>
              </div>
              {isOwner && !gig.archived && (
                <div className="dk-addmenu__sec" style={{ padding: '6px 8px', borderBottom: 0 }}>
                  <div className="lab dk-addmenu__lab">{fr ? 'Cycle de vie' : 'Lifecycle'}</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <button type="button" className="dk-addmenu__item" onClick={() => setLifecycleConfirm('archive')}>
                      <Archive className="h-3.5 w-3.5" />
                      <span>{fr ? 'Archiver cette date…' : 'Archive this date…'}</span>
                    </button>
                    <button type="button" className="dk-addmenu__item warn" onClick={() => setLifecycleConfirm('trash')}>
                      <Trash2 className="h-3.5 w-3.5" />
                      <span>{fr ? 'Mettre à la corbeille…' : 'Move to Trash…'}</span>
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* 2. 2032 Telemetry Up-Next Banner (THE one yellow primary CTA on the page) */}
      {nextRow && (
        <section className="dk-next dk-next--2032" onClick={() => setSelectedKey(nextRow.key)} style={{ cursor: 'pointer' }}>
          <span className={`dk-row-badge dk-row-badge--${nextRow.iconKind}`}>
            <RowGlyph kind={nextRow.iconKind} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 min-w-0">
              <span className="dk-next__kicker">
                <i className="m2032-led" />
                {fr ? 'À SUIVRE' : 'UP NEXT'}
              </span>
              <span className="mono dk-detail__time">{nextRow.time}</span>
              <strong className="truncate" style={{ fontSize: 13.5 }}>{nextRow.what}</strong>
            </div>
            {(nextRow.where || nextRow.note) && (
              <div className="sub truncate" style={{ fontSize: 12, marginTop: 2 }}>
                {[nextRow.where, nextRow.note].filter(Boolean).join(' · ')}
              </div>
            )}
          </div>
          {nextRow.refCode ? (
            <button
              type="button"
              className="btn btn--def dk-next__go"
              onClick={(e) => {
                e.stopPropagation();
                flashCopy('next_ref', nextRow.refCode!);
              }}
            >
              {copiedKey === 'next_ref' ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
              {copiedKey === 'next_ref' ? copy.copied : `${fr ? 'Copier' : 'Copy'} ${nextRow.refCode}`}
            </button>
          ) : nextRow.phone ? (
            <a
              className="btn btn--def dk-next__go"
              href={`tel:${nextRow.phone.replace(/[^\d+]/g, '')}`}
              onClick={(e) => e.stopPropagation()}
            >
              <Phone className="h-3.5 w-3.5" />
              {fr ? 'Appeler' : 'Call'}
            </a>
          ) : null}
        </section>
      )}

      {/* MCP Attribution Undo Strip (quiet, 1-line) */}
      {latestMcpBatch && canEdit && (
        <div className="no-print flex items-center justify-between gap-2 border-t border-[var(--cv-line)] bg-[var(--cv-paper2)] px-3 py-1 text-xs">
          <span className="sub inline-flex items-center gap-1.5 truncate">
            <Bot className="h-3.5 w-3.5 shrink-0" />
            <span><b>{latestMcpBatch.actor}</b> {copy.viaAssistant} ({latestMcpBatch.count})</span>
          </span>
          <button
            type="button"
            className="btn"
            style={{ minHeight: 22, fontSize: 11.5 }}
            onClick={() => void api.undoBatch(gig.id, latestMcpBatch.batchId).then(() => sync.refreshFull())}
          >
            <Undo2 className="h-3 w-3" /> {copy.undoAdd}
          </button>
        </div>
      )}

      {/* 3. Main Split: Spacious 4-Column Day Sheet + Collapsible 272px Right Dossier */}
      <div className="dk-split">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div ref={listRef} className="dk-list" tabIndex={0} onKeyDown={onGridKeyDown} onPaste={(e) => void onGridPaste(e)}>
            <div className="cols cols--4 head">
              <span>{fr ? 'Heure' : 'Time'}</span>
              <span>{fr ? 'Activité' : 'Activity'}</span>
              <span className="dk-col-hide-sm">{fr ? 'Lieu' : 'Where'}</span>
              <span className="dk-col-hide-sm">{fr ? 'Pour qui' : 'Who'}</span>
            </div>

            <div className="sep">
              <span style={{ textTransform: 'capitalize' }}>{fullDateLabel(gig.date, locale)}</span>
              <span className="mono sub" style={{ fontSize: 11, fontWeight: 500 }}>
                {[
                  `${timeline.length} ${fr ? 'étapes' : 'items'}`,
                  byCol.flights?.length ? `${byCol.flights.length} ${fr ? 'vol' : 'flight'}` : '',
                  byCol.transport?.length ? `${byCol.transport.length} ${fr ? 'transfert' : 'transfer'}` : '',
                  byCol.hotels?.length ? `${byCol.hotels.length} ${fr ? 'hôtel' : 'hotel'}` : '',
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </span>
            </div>

            {timeline.map((row, rowIdx) => {
              const isSelected = activeRow?.key === row.key;
              const isMulti = multiKeys.has(row.key);
              const isEditCol = (col: SheetCol) => editingCell?.rowKey === row.key && editingCell.col === col;
              const isAt = (col: SheetCol) => cellNav && cursor?.row === rowIdx && cursor.col === col;
              const gap = gapsAfter[row.key];
              const nextTimelineRow = timeline[rowIdx + 1];
              const rowSub = row.note || String(row.item?.data.notes || '');
              const rowPhoneDigits = (row.phone || '').replace(/[^\d+]/g, '');
              const rowWaDigits = rowPhoneDigits.replace(/^\+/, '');

              return (
                <div key={row.key} data-row-key={row.key}>
                  <div className={`cols cols--4 item dk-row dk-row--${row.iconKind}${isSelected ? ' item--on' : ''}${isMulti ? ' item--multi' : ''}${row.key === '__set__' ? ' dk-row--set' : ''}${flashRowKey === row.key ? ' dk-row--flash' : ''}`}>
                    {/* Col 0: Heure (compact FR clock — never truncates!) */}
                    <div
                      className={`mono item__cell${isAt(0) ? ' item__cell--at' : ''}${isEditCol(0) ? ' item__cell--edit' : ''}`}
                      onClick={(e) => handleCellClick(row, rowIdx, 0, e)}
                      onDoubleClick={() => beginCellEdit(row, 0)}
                    >
                      {isEditCol(0) ? (
                        <input
                          className="in mono"
                          style={{ minHeight: 24, padding: '2px 5px' }}
                          value={editingCell!.draft}
                          onChange={(e) => setEditingCell({ ...editingCell!, draft: e.target.value })}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); void commitCellEdit(row, 0, editingCell!.draft); }
                            if (e.key === 'Escape') setEditingCell(null);
                          }}
                          onBlur={() => void commitCellEdit(row, 0, editingCell!.draft)}
                          autoFocus
                        />
                      ) : (
                        <span style={{ fontWeight: row.key === '__set__' ? 700 : 500 }}>{row.time}</span>
                      )}
                    </div>

                    {/* Col 1: Activité (Vector Icon + Full Title + Quiet Subline Note) */}
                    <div
                      className={`item__cell dk-cell-main${isAt(1) ? ' item__cell--at' : ''}${isEditCol(1) ? ' item__cell--edit' : ''}`}
                      onClick={(e) => handleCellClick(row, rowIdx, 1, e)}
                      onDoubleClick={() => beginCellEdit(row, 1)}
                    >
                      {isEditCol(1) ? (
                        <AutocompleteInput
                          value={editingCell!.draft}
                          onChange={(val) => setEditingCell({ ...editingCell!, draft: val })}
                          onCommit={(val) => void commitCellEdit(row, 1, val)}
                          onCancel={() => setEditingCell(null)}
                          suggestions={activitySuggestions.filter((s) => foldText(s.label).includes(foldText(editingCell!.draft))).slice(0, 6)}
                        />
                      ) : (
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 min-w-0">
                            <span className={`dk-row-badge dk-row-badge--${row.iconKind}`}>
                              <RowGlyph kind={row.iconKind} />
                            </span>
                            <div className="min-w-0 flex-1">
                              <div className="truncate" style={{ fontWeight: 600 }}>{row.what}</div>
                              {rowSub && (
                                <div className="sub truncate" style={{ fontSize: 11.5, marginTop: 1 }}>
                                  {rowSub}
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Col 2: Lieu */}
                    <div
                      className={`dk-col-hide-sm item__cell${isAt(2) ? ' item__cell--at' : ''}${isEditCol(2) ? ' item__cell--edit' : ''}`}
                      onClick={(e) => handleCellClick(row, rowIdx, 2, e)}
                      onDoubleClick={() => beginCellEdit(row, 2)}
                    >
                      {isEditCol(2) ? (
                        <AutocompleteInput
                          value={editingCell!.draft}
                          onChange={(val) => setEditingCell({ ...editingCell!, draft: val })}
                          onCommit={(val) => void commitCellEdit(row, 2, val)}
                          onCancel={() => setEditingCell(null)}
                          suggestions={placeSuggestions.filter((s) => foldText(`${s.label} ${s.sub || ''}`).includes(foldText(editingCell!.draft))).slice(0, 7)}
                        />
                      ) : (
                        <span className="truncate sub" style={{ color: isSelected ? 'inherit' : 'var(--cv-ink2)' }}>{row.where}</span>
                      )}
                    </div>

                    {/* Col 3: Who (compact Name +1 — never truncates) */}
                    <div
                      className={`dk-col-hide-sm item__cell${isAt(3) ? ' item__cell--at' : ''}${isEditCol(3) ? ' item__cell--edit' : ''}`}
                      onClick={(e) => {
                        handleCellClick(row, rowIdx, 3, e);
                        if (!e.shiftKey && !e.metaKey && !e.ctrlKey && canEdit && row.item) beginCellEdit(row, 3);
                      }}
                    >
                      <span className="truncate sub" style={{ color: isSelected ? 'inherit' : 'var(--cv-ink2)' }}>{row.who}</span>
                      {isEditCol(3) && row.item && (
                        <PeoplePicker
                          people={people}
                          onDateIds={onDatePersonIds}
                          selectedIds={row.item.person_ids}
                          locale={locale}
                          onCancel={() => setEditingCell(null)}
                          onSave={(nextIds) => {
                            const prevIds = row.item!.person_ids;
                            setEditingCell(null);
                            void sync.updateGigItem(gig.id, row.item!.id, {}, nextIds);
                            pushUndo({
                              label: 'Pour qui',
                              revert: () => sync.updateGigItem(gig.id, row.item!.id, {}, prevIds),
                              redo: () => sync.updateGigItem(gig.id, row.item!.id, {}, nextIds),
                            });
                            say(fr ? 'Enregistré' : 'Saved');
                          }}
                        />
                      )}
                    </div>

                    {/* Floating opaque quick-actions docked cleanly at far right edge of row (never covers Activity) */}
                    {(!editingCell || editingCell.rowKey !== row.key) &&
                      (row.refCode || rowPhoneDigits.length >= 7 || (canEdit && row.item)) && (
                        <div className="dk-row-qacts no-print" onClick={(e) => e.stopPropagation()}>
                          {row.refCode && (
                            <button
                              type="button"
                              className="dk-row-qpill mono"
                              title={fr ? `Copier ${row.refCode}` : `Copy ${row.refCode}`}
                              onClick={() => flashCopy(`rq_${row.key}`, row.refCode!)}
                            >
                              {copiedKey === `rq_${row.key}` ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                              {row.refCode}
                            </button>
                          )}
                          {rowPhoneDigits.length >= 7 && (
                            <>
                              <a className="dk-row-qbtn" href={`tel:${rowPhoneDigits}`} title={fr ? 'Appeler' : 'Call'}>
                                <Phone className="h-3 w-3" />
                              </a>
                              <a className="dk-row-qbtn" href={`https://wa.me/${rowWaDigits}`} target="_blank" rel="noreferrer" title="WhatsApp">
                                <MessageCircle className="h-3 w-3" />
                              </a>
                            </>
                          )}
                          {canEdit && row.item && (
                            <button
                              type="button"
                              className="dk-row-qbtn"
                              title={fr ? 'Modifier (⌘E)' : 'Edit (⌘E)'}
                              onClick={() => setRowEditor({ kind: 'edit', item: row.item! })}
                            >
                              <Pencil className="h-3 w-3" />
                            </button>
                          )}
                        </div>
                      )}
                  </div>

                  {/* Interactive Free-time / Tight-connection Telemetry Gap Row */}
                  {gap && (
                    canEdit ? (
                      <button
                        type="button"
                        className={`gap gap--btn dk-gap-2032${gap.tight ? ' gap--tight' : ''}`}
                        onClick={() => {
                          if (gap.tight && nextTimelineRow?.item) {
                            setRowEditor({ kind: 'edit', item: nextTimelineRow.item });
                          } else {
                            setRowEditor({ kind: 'add', collection: 'schedule', presetTime: row.endTime || row.startTime || '' });
                          }
                        }}
                      >
                        <span className="dk-gap-line" />
                        <span className="dk-gap-pill">{gap.label}</span>
                        <span className="dk-gap-line" />
                        <span className="gap__act">
                          {gap.tight ? (fr ? 'Modifier ›' : 'Edit ›') : fr ? '+ Ajouter ici' : '+ Add here'}
                        </span>
                      </button>
                    ) : (
                      <div className={`gap dk-gap-2032${gap.tight ? ' gap--tight' : ''}`}>
                        <span className="dk-gap-line" />
                        <span className="dk-gap-pill">{gap.label}</span>
                        <span className="dk-gap-line" />
                      </div>
                    )
                  )}
                </div>
              );
            })}

          </div>

          {/* Pinned quick-add command bar (shortcut: N) */}
          {canEdit && (
            <SmartQuickAdd
              gig={gig}
              items={items}
              people={people}
              onDatePersonIds={onDatePersonIds}
              placeSuggestions={placeSuggestions}
              activitySuggestions={activitySuggestions}
              locale={locale}
              inputRef={quickAddInputRef}
              onAdd={async (collection, data, personIds, label) => {
                const newId = await sync.addGigItem(gig.id, collection, data, personIds);
                setSelectedKey(newId);
                setFlashRowKey(newId);
                window.setTimeout(() => setFlashRowKey((cur) => (cur === newId ? null : cur)), 1400);
                window.requestAnimationFrame(() => {
                  listRef.current?.querySelector<HTMLElement>(`[data-row-key="${newId}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
                });
                pushUndo({
                  label: `${fr ? 'Ajout' : 'Add'} · ${label}`,
                  revert: () => sync.removeGigItem(gig.id, newId),
                  redo: async () => { await sync.addGigItem(gig.id, collection, data, personIds); },
                });
                say(fr ? `Ajouté · ${label} (⌘Z pour annuler)` : `Added · ${label} (⌘Z to undo)`);
              }}
              onOpenFullEditor={(p) => {
                const col =
                  p.collection === 'flights' || p.collection === 'transport' || p.collection === 'hotels'
                    ? p.collection
                    : 'schedule';
                setRowEditor({
                  kind: 'add',
                  collection: col,
                  presetTime: p.startTime,
                  travelKind: p.intent === 'train' ? 'train' : p.intent === 'ground' ? 'ground' : p.intent === 'flight' ? 'flight' : undefined,
                  presetData: p.data,
                  presetPersonIds: p.personIds,
                });
              }}
            />
          )}

          {/* Multi-Row Bulk Selection Bar (only appears when rows are multi-selected) */}
          {multiKeys.size > 0 && (
            <div className="pf-batch no-print" style={{ position: 'relative' }}>
              <span className="mono">{multiKeys.size} {fr ? 'sélectionnée(s)' : 'selected'}</span>
              <button type="button" className="btn" onClick={() => void copySelectedTsv()}>
                {fr ? 'Copier TSV' : 'Copy TSV'}
              </button>
              {canEdit && multiKeys.size >= 2 && (
                <button type="button" className="btn" onClick={() => void fillDownSelected()}>
                  {fr ? 'Recopier vers le bas' : 'Fill down'}
                </button>
              )}
              {canEdit && (
                <button type="button" className="btn" onClick={() => setBulkWhoOpen((v) => !v)}>
                  {fr ? 'Pour qui…' : 'Assign who…'}
                </button>
              )}
              {canEdit && (
                <button type="button" className="btn warn" onClick={() => void deleteSelectedRows()}>
                  {fr ? 'Supprimer' : 'Delete'}
                </button>
              )}
              <button type="button" className="btn" style={{ marginLeft: 'auto' }} onClick={() => { setMultiKeys(new Set()); setBulkWhoOpen(false); }}>
                ×
              </button>
              {bulkWhoOpen && (
                <div style={{ position: 'absolute', bottom: '100%', left: 140, zIndex: 40 }}>
                  <PeoplePicker
                    people={people}
                    onDateIds={onDatePersonIds}
                    selectedIds={[]}
                    locale={locale}
                    onCancel={() => setBulkWhoOpen(false)}
                    onSave={async (nextIds) => {
                      setBulkWhoOpen(false);
                      const targets = timeline.filter((r) => multiKeys.has(r.key) && r.item);
                      for (const t of targets) {
                        if (t.item) await sync.updateGigItem(gig.id, t.item.id, {}, nextIds);
                      }
                      say(fr ? `Pour qui appliqué à ${targets.length} ligne(s)` : `Assigned to ${targets.length} row(s)`);
                    }}
                  />
                </div>
              )}
            </div>
          )}

          {/* Quiet Status Line (shows live feedback or tiny ? shortcuts button — zero clutter) */}
          <div className="dk-sheetline no-print" style={{ position: 'relative' }}>
            {sheetMsg ? (
              <span className={sheetMsg.warn ? 'warn' : ''}>{sheetMsg.text}</span>
            ) : (
              <span className="sub">{fr ? 'Double-clic sur une cellule pour modifier' : 'Double-click any cell to edit'}</span>
            )}
            <button
              type="button"
              className="sub"
              style={{ marginLeft: 'auto', background: 'none', border: 0, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11.5 }}
              onClick={() => setShortcutsOpen((v) => !v)}
            >
              <HelpCircle className="h-3.5 w-3.5" /> {fr ? 'Raccourcis' : 'Shortcuts'}
            </button>
            {shortcutsOpen && (
              <div className="win dk-shortcuts-pop" onClick={() => setShortcutsOpen(false)}>
                <div><kbd>⏎</kbd> / <kbd>F2</kbd> {fr ? 'Éditer la cellule' : 'Edit cell'}</div>
                <div><kbd>⌘E</kbd> {fr ? 'Ouvrir l’éditeur complet' : 'Open full editor'}</div>
                <div><kbd>⇧⏎</kbd> {fr ? 'Ajouter un horaire' : 'Add schedule item'}</div>
                <div><kbd>⇧Clic</kbd> / <kbd>⌘A</kbd> {fr ? 'Sélection multiple' : 'Multi-select rows'}</div>
                <div><kbd>⌘C</kbd> / <kbd>⌘V</kbd> {fr ? 'Copier / coller tableau' : 'Copy / paste rows'}</div>
                <div><kbd>⌘D</kbd> {fr ? 'Recopier vers le bas' : 'Fill down'}</div>
                <div><kbd>⌘Z</kbd> / <kbd>⇧⌘Z</kbd> {fr ? 'Annuler / rétablir' : 'Undo / redo'}</div>
              </div>
            )}
          </div>

          {/* Resizable Split Handle + Clean Bottom Row Detail Inspector */}
          {activeRow && (
            <>
              <div className="dk-splitbar no-print" title={fr ? 'Redimensionner le détail' : 'Resize detail pane'} onMouseDown={startSplitResize} />
              <section className="dk-detail" style={{ height: detailHeight, minHeight: 96 }}>
                <div className="dk-detail__head">
                  <span className={`dk-detail__badge dk-detail__badge--${activeRow.iconKind}`}>
                    <RowGlyph kind={activeRow.iconKind} />
                  </span>
                  <strong className="truncate" style={{ fontSize: 13.5, minWidth: 0 }}>{activeRow.what}</strong>
                  {activeRow.time && activeRow.time !== '—' && (
                    <span className="mono dk-detail__time">{activeRow.time}</span>
                  )}
                  <div className="dk-detail__acts no-print">
                    {(activeRow.mapsQuery || activeRow.where) && (
                      <a
                        className="btn"
                        title={fr ? `Ouvrir dans Google Maps : ${activeRow.mapsQuery || activeRow.where}` : `Open in Google Maps: ${activeRow.mapsQuery || activeRow.where}`}
                        href={`https://maps.google.com/?q=${encodeURIComponent(`${activeRow.mapsQuery || activeRow.where}${gig.city && !(activeRow.mapsQuery || activeRow.where).toLowerCase().includes(gig.city.toLowerCase()) ? ` ${gig.city}` : ''}`)}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        <MapPin className="h-3 w-3" />
                        Maps
                      </a>
                    )}
                    {canEdit && activeRow.item && (
                      <>
                        <button
                          type="button"
                          className="btn"
                          title={fr ? 'Dupliquer cette ligne' : 'Duplicate row'}
                          onClick={() => void duplicateItem(activeRow.item!)}
                        >
                          <Copy className="h-3 w-3" />
                        </button>
                        <button type="button" className="btn" onClick={() => setRowEditor({ kind: 'edit', item: activeRow.item! })}>
                          <Pencil className="h-3 w-3" />
                          {fr ? 'Modifier' : 'Edit'}
                        </button>
                        <button type="button" className="btn warn" title={fr ? 'Supprimer' : 'Delete'} onClick={() => void removeItemWithUndo(activeRow.item!, activeRow.what)}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </>
                    )}
                  </div>
                </div>
                <div className="dk-detail__body">
                  {activeRow.facts.filter(([, v]) => v && v !== '—').map(([k, v]) => {
                    const trimmed = v.trim();
                    const isPhone = k === 'Téléphone' || k === 'Phone' || /^\+?[\d\s().-]{7,}$/.test(trimmed);
                    const isCode = k === 'Référence' || k === 'Ref / PNR' || k === 'Confirmation';
                    const isPeople = k === 'Passagers' || k === 'Passengers' || k === 'Guests' || k === 'Pour qui' || k === 'Who';
                    const isRoute = (k === 'Trajet' || k === 'Route') && trimmed.includes('→');
                    const digits = trimmed.replace(/[^\d+]/g, '');
                    const waDigits = digits.replace(/^\+/, '');
                    const copyId = `kv_${activeRow.key}_${k}`;
                    return (
                      <div key={k} className="kv">
                        <span className="lab">{k}</span>
                        <span className="kv-val">
                          {isPhone ? (
                            <span className="kv-phone">
                              <a href={`tel:${digits}`} className="mono kv-tel">{trimmed}</a>
                              <span className="kv-micros no-print">
                                <a className="kv-micro" href={`tel:${digits}`} title={fr ? 'Appeler' : 'Call'}>
                                  <Phone className="h-3 w-3" />
                                </a>
                                {waDigits.length >= 7 && (
                                  <a className="kv-micro" href={`https://wa.me/${waDigits}`} target="_blank" rel="noreferrer" title="WhatsApp">
                                    <MessageCircle className="h-3 w-3" />
                                  </a>
                                )}
                                <button type="button" className="kv-micro" title={fr ? 'Copier le numéro' : 'Copy number'} onClick={() => flashCopy(copyId, trimmed)}>
                                  {copiedKey === copyId ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                                </button>
                              </span>
                            </span>
                          ) : isCode ? (
                            <button type="button" className="kv-code mono" onClick={() => flashCopy(copyId, trimmed)}>
                              <span>{trimmed}</span>
                              {copiedKey === copyId ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3 opacity-60" />}
                            </button>
                          ) : isPeople ? (
                            <span className="kv-chips">
                              {trimmed.split(',').map((name) => (
                                <span key={name.trim()} className="kv-chip">{name.trim()}</span>
                              ))}
                            </span>
                          ) : isRoute ? (
                            <span className="kv-route">
                              {trimmed.split('→').map((part, idx, arr) => (
                                <span key={idx} className="kv-route__seg">
                                  <span>{part.trim()}</span>
                                  {idx < arr.length - 1 && <span className="kv-arrow">→</span>}
                                </span>
                              ))}
                            </span>
                          ) : (
                            trimmed
                          )}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </section>
            </>
          )}
        </div>

        {/* Right: Collapsible 5-Folder Dossier Panel (BeOS 2032 Precision Sidebar) */}
        {dossierOpen && (
        <aside className="dk-folds" aria-label="Dossier">
          <div className="dk-folderbar no-print">
            {folderTabs.map((t) => {
              const Icon = t.icon;
              const openRiderCount =
                t.id === 'rider'
                  ? (byCol.rider || []).filter((r) => !r.data.fulfilled).length
                  : 0;
              return (
                <button
                  key={t.id}
                  type="button"
                  className="dk-folder-button"
                  aria-expanded={folder === t.id}
                  aria-label={`${t.label} (${t.count})`}
                  title={`${t.label} (${t.count})`}
                  onClick={() => setFolder(t.id)}
                >
                  <Icon className="h-4 w-4" />
                  {t.count > 0 && (
                    <span className={`dk-ftab-cnt mono${openRiderCount > 0 ? ' dk-ftab-cnt--warn' : ''}`}>
                      {t.count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          <div className="dk-folder-heading">
            <span className="inline-flex items-center gap-1.5 min-w-0 truncate">
              {(() => {
                const TabIcon = activeTabMeta.icon;
                return <TabIcon className="h-3.5 w-3.5 shrink-0 opacity-75" />;
              })()}
              <span className="truncate">{activeTabMeta.label}</span>
            </span>
            <span className="dk-folder-pill mono">{activeTabMeta.count}</span>
          </div>

          <div className="flex-1 overflow-y-auto">
            {/* FOLDER 1: CREW, CONTACTS & GUESTS (Avatars, 1-click Call/WhatsApp/Copy/Share, inline edit!) */}
            {folder === 'crew' && (
              <>
                {crewAndContacts.map((c) => {
                  const pid = c.person_ids[0];
                  const isEd = editCrewId === c.id;
                  const cName = String(c.data.name || '');
                  const cRole = String(c.data.role || '');
                  const cPhone = String(c.data.phone || '');
                  const cDigits = cPhone.replace(/[^\d+]/g, '');
                  const cWa = cDigits.replace(/^\+/, '');
                  const tone = roleTone(cRole);
                  if (isEd) {
                    return (
                      <form
                        key={c.id}
                        className="border-b border-[var(--cv-line2)] bg-[var(--cv-paper2)] p-2 space-y-1.5"
                        onSubmit={async (e) => {
                          e.preventDefault();
                          await sync.updateGigItem(gig.id, c.id, { role: editCrewDraft.role, phone: editCrewDraft.phone });
                          setEditCrewId(null);
                          say(fr ? 'Contact mis à jour' : 'Contact updated');
                        }}
                      >
                        <div className="lab">{cName}</div>
                        <div className="grid grid-cols-2 gap-1">
                          <input className="in" value={editCrewDraft.role} onChange={(e) => setEditCrewDraft({ ...editCrewDraft, role: e.target.value })} placeholder={fr ? 'Rôle' : 'Role'} autoFocus />
                          <input className="in mono" value={editCrewDraft.phone} onChange={(e) => setEditCrewDraft({ ...editCrewDraft, phone: e.target.value })} placeholder={fr ? 'Téléphone' : 'Phone'} />
                        </div>
                        <div className="flex justify-end gap-1">
                          <button type="button" className="btn" onClick={() => setEditCrewId(null)}>{copy.cancel}</button>
                          <button type="submit" className="btn btn--def">{copy.save}</button>
                        </div>
                      </form>
                    );
                  }
                  return (
                    <div key={c.id} className="person-card">
                      <div className="person-card__top">
                        <span className={`dk-avatar dk-avatar--${tone}`} aria-hidden="true">
                          {personInitials(cName)}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5 min-w-0">
                            <span className="truncate" style={{ fontWeight: 600, fontSize: 13 }}>{cName}</span>
                          </div>
                          {cRole && (
                            <span className={`dk-rolepill dk-rolepill--${tone}`}>
                              {cRole}
                            </span>
                          )}
                        </div>
                        <div className="person-card__acts no-print">
                          {canEdit && c.collection === 'crew' && pid && (
                            <button
                              type="button"
                              className="dk-mini-act"
                              title={fr ? 'Copier le lien personnel' : 'Copy personal link'}
                              onClick={() => void handleShare('gig_crew', pid, `${cName} — ${gig.city}`)}
                            >
                              {copiedKey === pid ? <Check className="h-3 w-3" /> : <Share2 className="h-3 w-3" />}
                            </button>
                          )}
                          {canEdit && (
                            <button
                              type="button"
                              className="dk-mini-act"
                              title={fr ? 'Modifier' : 'Edit'}
                              onClick={() => {
                                setEditCrewId(c.id);
                                setEditCrewDraft({ role: cRole, phone: cPhone, pass_type: '' });
                              }}
                            >
                              <Pencil className="h-3 w-3" />
                            </button>
                          )}
                          {canEdit && (
                            <button
                              type="button"
                              className="dk-mini-act"
                              title={fr ? 'Retirer' : 'Remove'}
                              onClick={() => void sync.removeGigItem(gig.id, c.id)}
                            >
                              ×
                            </button>
                          )}
                        </div>
                      </div>
                      {cPhone && (
                        <div className="person-card__phone">
                          <button
                            type="button"
                            className="mono person-card__tel"
                            title={fr ? 'Cliquer pour copier' : 'Click to copy'}
                            onClick={() => flashCopy(c.id, cPhone)}
                          >
                            {copiedKey === c.id ? copy.copied : cPhone}
                          </button>
                          {cDigits.length >= 7 && (
                            <span className="person-card__comm no-print">
                              <a className="dk-mini-act" href={`tel:${cDigits}`} title={fr ? 'Appeler' : 'Call'}>
                                <Phone className="h-3 w-3" />
                              </a>
                              <a className="dk-mini-act" href={`https://wa.me/${cWa}`} target="_blank" rel="noreferrer" title="WhatsApp">
                                <MessageCircle className="h-3 w-3" />
                              </a>
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}

                {(byCol.guests || []).length > 0 && (
                  <>
                    <div className="sep">
                      <span>{copy.guests}</span>
                      <span className="mono">{byCol.guests.length}</span>
                    </div>
                    {byCol.guests.map((g) => {
                      const st = String(g.data.status || 'confirmed');
                      const isConf = st === 'confirmed';
                      return (
                        <div key={g.id} className="dk-guest-row">
                          <span className="truncate">
                            <b>{String(g.data.name || '')}</b>{' '}
                            <span className="dk-rolepill dk-rolepill--artist mono">{String(g.data.pass_type || '+1')}</span>
                          </span>
                          <div className="flex shrink-0 items-center gap-1">
                            <button
                              type="button"
                              disabled={!canEdit}
                              className={`dk-guest-st${isConf ? ' dk-guest-st--ok' : ''}`}
                              title={canEdit ? (fr ? 'Changer le statut' : 'Toggle status') : undefined}
                              onClick={() => void sync.updateGigItem(gig.id, g.id, { status: isConf ? 'pending' : 'confirmed' })}
                            >
                              {isConf ? (fr ? 'confirmé' : 'confirmed') : fr ? 'en attente' : 'pending'}
                            </button>
                            {canEdit && (
                              <button type="button" className="dk-mini-act no-print" onClick={() => void sync.removeGigItem(gig.id, g.id)}>
                                ×
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </>
                )}

                {canEdit && (
                  <div className="no-print dk-dossier-foot">
                    <div className="grid grid-cols-3 gap-1">
                      <button type="button" className={`btn${crewAddKind === 'crew' ? ' dk-sect--on' : ''}`} style={{ minHeight: 26, padding: '0 4px', fontSize: 11.5 }} onClick={() => setCrewAddKind((k) => (k === 'crew' ? null : 'crew'))}>+ {fr ? 'Équipe' : 'Crew'}</button>
                      <button type="button" className={`btn${crewAddKind === 'contacts' ? ' dk-sect--on' : ''}`} style={{ minHeight: 26, padding: '0 4px', fontSize: 11.5 }} onClick={() => setCrewAddKind((k) => (k === 'contacts' ? null : 'contacts'))}>+ Contact</button>
                      <button type="button" className={`btn${crewAddKind === 'guests' ? ' dk-sect--on' : ''}`} style={{ minHeight: 26, padding: '0 4px', fontSize: 11.5 }} onClick={() => setCrewAddKind((k) => (k === 'guests' ? null : 'guests'))}>+ {fr ? 'Invité' : 'Guest'}</button>
                    </div>
                    {crewAddKind && (
                      <form
                        className="space-y-1.5 pt-2"
                        onSubmit={async (e) => {
                          e.preventDefault();
                          if (!crewInput.name.trim()) return;
                          if (crewAddKind === 'guests') {
                            await sync.addGigItem(gig.id, 'guests', { name: crewInput.name, pass_type: crewInput.pass_type, status: 'confirmed' });
                          } else {
                            const match = people.find((p) => foldText(p.name) === foldText(crewInput.name));
                            await sync.addGigItem(
                              gig.id,
                              crewAddKind,
                              { name: crewInput.name, role: crewInput.role, phone: crewInput.phone, email: crewInput.email },
                              match ? [match.id] : [],
                            );
                          }
                          setCrewInput({ name: '', role: '', phone: '', email: '', pass_type: '+1' });
                          setCrewAddKind(null);
                          say(fr ? 'Ajouté au dossier' : 'Added to dossier');
                        }}
                      >
                        <AutocompleteInput
                          inlineCell={false}
                          value={crewInput.name}
                          onChange={(val) => setCrewInput({ ...crewInput, name: val })}
                          onCommit={(val, opt) => {
                            const p = people.find((x) => x.name === (opt?.value || val));
                            setCrewInput({
                              ...crewInput,
                              name: opt?.value || val,
                              role: p?.role || crewInput.role,
                              phone: p?.phone || crewInput.phone,
                              email: p?.email || crewInput.email,
                            });
                          }}
                          suggestions={
                            crewAddKind === 'guests'
                              ? []
                              : people
                                  .filter((p) => foldText(p.name).includes(foldText(crewInput.name)))
                                  .slice(0, 6)
                                  .map((p) => ({ value: p.name, label: p.name, sub: p.role || '' }))
                          }
                          placeholder={
                            crewAddKind === 'guests'
                              ? fr ? 'Nom de l’invité' : 'Guest name'
                              : fr ? 'Nom (annuaire…)' : 'Name (directory…)'
                          }
                        />
                        {crewAddKind === 'guests' ? (
                          <input className="in" value={crewInput.pass_type} onChange={(e) => setCrewInput({ ...crewInput, pass_type: e.target.value })} placeholder="Pass (+1, AAA, VIP)" />
                        ) : (
                          <div className="grid grid-cols-2 gap-1">
                            <input className="in" value={crewInput.role} onChange={(e) => setCrewInput({ ...crewInput, role: e.target.value })} placeholder={fr ? 'Rôle' : 'Role'} />
                            <input className="in mono" value={crewInput.phone} onChange={(e) => setCrewInput({ ...crewInput, phone: e.target.value })} placeholder={fr ? 'Téléphone' : 'Phone'} />
                          </div>
                        )}
                        <div className="flex justify-end gap-1">
                          <button type="button" className="btn" onClick={() => setCrewAddKind(null)}>{copy.cancel}</button>
                          <button type="submit" className="btn btn--def">{copy.add}</button>
                        </div>
                      </form>
                    )}
                  </div>
                )}
              </>
            )}

            {/* FOLDER 2: DOCUMENTS (Drag-and-Drop Vault + Color-Coded File Badges) */}
            {folder === 'docs' && (
              <div
                className={`dk-docs-folder${docsDrag ? ' dk-docs-folder--drag' : ''}`}
                onDragOver={(e) => {
                  if (!canEdit || !e.dataTransfer.types.includes('Files')) return;
                  e.preventDefault();
                  setDocsDrag(true);
                }}
                onDragLeave={() => setDocsDrag(false)}
                onDrop={async (e) => {
                  if (!canEdit || !e.dataTransfer.files.length) return;
                  e.preventDefault();
                  e.stopPropagation();
                  setDocsDrag(false);
                  for (const f of Array.from(e.dataTransfer.files)) {
                    const rec = await api.uploadFile(f, gig.id);
                    setFiles((prev) => [rec, ...prev]);
                  }
                  say(fr ? 'Document(s) ajouté(s)' : 'File(s) uploaded');
                }}
              >
                {canEdit && (
                  <div className="no-print p-2 border-b border-[var(--cv-line2)]">
                    <label className="dk-dropzone cursor-pointer">
                      <Upload className="h-4 w-4 opacity-75" />
                      <span>{fr ? 'Glisser ou ajouter un PDF / billet' : 'Drop or upload PDF / ticket'}</span>
                      <input
                        type="file"
                        multiple
                        className="hidden"
                        onChange={async (e) => {
                          const list = Array.from(e.target.files || []);
                          e.target.value = '';
                          for (const f of list) {
                            const rec = await api.uploadFile(f, gig.id);
                            setFiles((prev) => [rec, ...prev]);
                          }
                          if (list.length) say(fr ? 'Document(s) ajouté(s)' : 'File(s) uploaded');
                        }}
                      />
                    </label>
                  </div>
                )}
                {files.length === 0 ? (
                  <div className="dk-empty-folder">
                    <FileText className="h-5 w-5 opacity-40" />
                    <span className="sub">{fr ? 'Aucun billet, voucher ou rider attaché.' : 'No tickets, vouchers, or riders yet.'}</span>
                  </div>
                ) : (
                  files.map((f) => {
                    const ext = f.name.split('.').pop()?.toUpperCase().slice(0, 4) || 'DOC';
                    const kind = f.mime.includes('pdf') ? 'pdf' : f.mime.startsWith('image/') ? 'image' : 'doc';
                    return (
                      <div key={f.id} className="dk-doc-row">
                        <span className="pf-glyph" data-kind={kind}>{ext}</span>
                        {onOpenFile ? (
                          <button
                            type="button"
                            onClick={() => onOpenFile(f.id)}
                            className="min-w-0 flex-1 truncate text-left"
                            style={{ background: 'none', border: 0, padding: 0, color: 'inherit', fontWeight: 500, cursor: 'pointer' }}
                          >
                            {f.name}
                          </button>
                        ) : (
                          <a href={fileAssetUrl(f.id, true)} target="_blank" rel="noreferrer" className="min-w-0 flex-1 truncate" style={{ textDecoration: 'none', color: 'inherit', fontWeight: 500 }}>
                            {f.name}
                          </a>
                        )}
                        <span className="mono sub" style={{ fontSize: 11 }}>{Math.max(1, Math.round(f.size / 1024))} KB</span>
                        {canEdit && (
                          <button type="button" className="dk-mini-act no-print" onClick={() => void api.deleteFile(f.id).then(() => setFiles((prev) => prev.filter((x) => x.id !== f.id)))}>
                            ×
                          </button>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            )}

            {/* FOLDER 3: RUNNING ORDER (Club-Night Sorted Cards + Toggleable Add/Paste!) */}
            {folder === 'order' && (
              <>
                {(byCol.timetable || [])
                  .slice()
                  .sort((a, b) => clubSlotSort(String(a.data.start || '')) - clubSlotSort(String(b.data.start || '')))
                  .map((t) => {
                  const isUs = Boolean(t.data.is_us);
                  if (editOrderId === t.id) {
                    return (
                      <form
                        key={t.id}
                        className="border-b border-[var(--cv-line2)] bg-[var(--cv-paper2)] p-2 space-y-1.5"
                        onSubmit={async (e) => {
                          e.preventDefault();
                          await sync.updateGigItem(gig.id, t.id, { start: editOrderDraft.start, end: editOrderDraft.end || undefined, act: editOrderDraft.act.trim() });
                          setEditOrderId(null);
                        }}
                      >
                        <div className="grid grid-cols-2 gap-1">
                          <input className="in mono" value={editOrderDraft.start} onChange={(e) => setEditOrderDraft({ ...editOrderDraft, start: e.target.value })} placeholder="02:00" />
                          <input className="in mono" value={editOrderDraft.end} onChange={(e) => setEditOrderDraft({ ...editOrderDraft, end: e.target.value })} placeholder="04:00" />
                        </div>
                        <input className="in" value={editOrderDraft.act} onChange={(e) => setEditOrderDraft({ ...editOrderDraft, act: e.target.value })} autoFocus />
                        <div className="flex justify-end gap-1">
                          <button type="button" className="btn" onClick={() => setEditOrderId(null)}>{copy.cancel}</button>
                          <button type="submit" className="btn btn--def">{copy.save}</button>
                        </div>
                      </form>
                    );
                  }
                  return (
                    <div key={t.id} className={`dk-slot-card${isUs ? ' dk-slot-card--us' : ''}`}>
                      <div className="dk-slot-card__top">
                        <span className="mono dk-slot-time">
                          {clockRangeCompact(String(t.data.start || ''), String(t.data.end || ''), locale)}
                        </span>
                        <div className="person-card__acts no-print" style={{ marginLeft: 'auto' }}>
                          {canEdit && (
                            <button
                              type="button"
                              className="dk-mini-act"
                              title={fr ? 'Marquer comme notre set' : 'Mark as our set'}
                              onClick={() => void sync.updateGigItem(gig.id, t.id, { is_us: !isUs })}
                            >
                              {isUs ? '★' : '☆'}
                            </button>
                          )}
                          {canEdit && (
                            <button
                              type="button"
                              className="dk-mini-act"
                              onClick={() => {
                                setEditOrderId(t.id);
                                setEditOrderDraft({ start: String(t.data.start || ''), end: String(t.data.end || ''), act: String(t.data.act || '') });
                              }}
                            >
                              <Pencil className="h-3 w-3" />
                            </button>
                          )}
                          {canEdit && (
                            <button type="button" className="dk-mini-act" onClick={() => void sync.removeGigItem(gig.id, t.id)}>×</button>
                          )}
                        </div>
                      </div>
                      <div className="dk-slot-card__act">
                        {isUs && <span className="dk-slot-star">★</span>}
                        <strong className="truncate">{String(t.data.act || '')}</strong>
                        {Boolean(t.data.stage) && <span className="sub truncate" style={{ fontSize: 11 }}>· {String(t.data.stage)}</span>}
                      </div>
                    </div>
                  );
                })}
                {canEdit && (
                  <div className="no-print dk-dossier-foot space-y-2">
                    <div className="grid grid-cols-2 gap-1">
                      <button
                        type="button"
                        className={`btn${orderAddOpen ? ' dk-sect--on' : ''}`}
                        style={{ minHeight: 26, fontSize: 11.5 }}
                        onClick={() => { setOrderAddOpen((v) => !v); setOrderPasteOpen(false); }}
                      >
                        <Plus className="h-3 w-3" /> {fr ? 'Créneau' : 'Slot'}
                      </button>
                      <button
                        type="button"
                        className={`btn${orderPasteOpen ? ' dk-sect--on' : ''}`}
                        style={{ minHeight: 26, fontSize: 11.5 }}
                        onClick={() => { setOrderPasteOpen((v) => !v); setOrderAddOpen(false); }}
                      >
                        {fr ? 'Coller lineup' : 'Paste lineup'}
                      </button>
                    </div>
                    {orderAddOpen && (
                      <form
                        className="space-y-1.5"
                        onSubmit={async (e) => {
                          e.preventDefault();
                          if (!orderForm.act.trim()) return;
                          await sync.addGigItem(gig.id, 'timetable', {
                            start: orderForm.start,
                            end: orderForm.end || undefined,
                            act: orderForm.act.trim(),
                            is_us: orderForm.is_us,
                          });
                          setOrderForm({ start: '', end: '', act: '', is_us: false });
                          setOrderAddOpen(false);
                        }}
                      >
                        <div className="grid grid-cols-2 gap-1">
                          <input className="in mono" value={orderForm.start} onChange={(e) => setOrderForm({ ...orderForm, start: e.target.value })} placeholder={fr ? 'Début 02h00' : 'Start 02:00'} />
                          <input className="in mono" value={orderForm.end} onChange={(e) => setOrderForm({ ...orderForm, end: e.target.value })} placeholder={fr ? 'Fin 04h00' : 'End 04:00'} />
                        </div>
                        <input className="in" value={orderForm.act} onChange={(e) => setOrderForm({ ...orderForm, act: e.target.value })} placeholder={fr ? 'Artiste' : 'Artist'} autoFocus />
                        <div className="flex justify-end gap-1">
                          <button type="button" className="btn" onClick={() => setOrderAddOpen(false)}>{copy.cancel}</button>
                          <button type="submit" className="btn btn--def">{copy.add}</button>
                        </div>
                      </form>
                    )}
                    {orderPasteOpen && (
                      <div className="space-y-1.5">
                        <textarea
                          className="in mono"
                          style={{ minHeight: 72 }}
                          value={orderPasteText}
                          onChange={(e) => setOrderPasteText(e.target.value)}
                          placeholder={'23:30-02:00 Warmup\n02:00-04:00 Main Act\n04:00-06:00 Closing'}
                          autoFocus
                        />
                        <button
                          type="button"
                          className="btn btn--def w-full"
                          onClick={async () => {
                            const parsed = parseLineupPaste(orderPasteText);
                            for (const slot of parsed) {
                              await sync.addGigItem(gig.id, 'timetable', slot);
                            }
                            setOrderPasteText('');
                            setOrderPasteOpen(false);
                            say(fr ? `${parsed.length} créneau(x) importé(s)` : `Imported ${parsed.length} slot(s)`);
                          }}
                        >
                          {fr ? 'Importer le running order' : 'Import running order'}
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </>
            )}

            {/* FOLDER 4: RIDER (Progress Bar + Category Pills + Inline Edit!) */}
            {folder === 'rider' && (() => {
              const rList = byCol.rider || [];
              const rDone = rList.filter((x) => Boolean(x.data.fulfilled)).length;
              const pct = rList.length ? Math.round((rDone / rList.length) * 100) : 0;
              return (
                <>
                  {rList.length > 0 && (
                    <div className="dk-rider-prog">
                      <div className="flex items-center justify-between text-xs">
                        <span className="sub">{rDone}/{rList.length} {fr ? 'validé(s)' : 'checked'}</span>
                        <span className="mono" style={{ fontWeight: 700, fontSize: 11 }}>{pct}%</span>
                      </div>
                      <div className="dk-rider-bar">
                        <i style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  )}
                  {rList.map((r) => {
                    const done = Boolean(r.data.fulfilled);
                    const cat = String(r.data.category || '');
                    if (editRiderId === r.id) {
                      return (
                        <form
                          key={r.id}
                          className="flex gap-1 border-b border-[var(--cv-line2)] bg-[var(--cv-paper2)] p-2"
                          onSubmit={async (e) => {
                            e.preventDefault();
                            if (editRiderDraft.trim()) await sync.updateGigItem(gig.id, r.id, { items: editRiderDraft.trim() });
                            setEditRiderId(null);
                          }}
                        >
                          <input className="in" value={editRiderDraft} onChange={(e) => setEditRiderDraft(e.target.value)} autoFocus />
                          <button type="submit" className="btn btn--def">OK</button>
                          <button type="button" className="btn" onClick={() => setEditRiderId(null)}>×</button>
                        </form>
                      );
                    }
                    return (
                      <div key={r.id} className={`dk-rider-card${done ? ' dk-rider-card--done' : ''}`}>
                        <button
                          type="button"
                          disabled={!canEdit}
                          onClick={() => void sync.updateGigItem(gig.id, r.id, { fulfilled: !done })}
                          className="flex flex-1 items-start gap-2 text-left min-w-0"
                          style={{ background: 'none', border: 0, color: 'inherit', cursor: canEdit ? 'pointer' : 'default', padding: 0 }}
                        >
                          {done ? <CheckSquare className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--cv-online)]" /> : <Square className="mt-0.5 h-3.5 w-3.5 shrink-0 opacity-65" />}
                          <div className="min-w-0 flex-1">
                            {cat && <span className="dk-rolepill dk-rolepill--tm" style={{ marginBottom: 3, textTransform: 'capitalize' }}>{cat}</span>}
                            <div style={done ? { textDecoration: 'line-through', opacity: 0.6, fontSize: 12.5 } : { fontSize: 12.5 }}>{String(r.data.items || '')}</div>
                          </div>
                        </button>
                        {canEdit && (
                          <div className="person-card__acts no-print">
                            <button type="button" className="dk-mini-act" onClick={() => { setEditRiderId(r.id); setEditRiderDraft(String(r.data.items || '')); }}>
                              <Pencil className="h-3 w-3" />
                            </button>
                            <button type="button" className="dk-mini-act" onClick={() => void sync.removeGigItem(gig.id, r.id)}>×</button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                  {canEdit && (
                    <form
                      className="no-print dk-dossier-foot space-y-1.5"
                      onSubmit={async (e) => {
                        e.preventDefault();
                        if (!riderText.trim()) return;
                        await sync.addGigItem(gig.id, 'rider', { category: riderCat, items: riderText.trim(), fulfilled: false });
                        setRiderText('');
                      }}
                    >
                      <div className="segs" style={{ width: '100%' }}>
                        {(['booth', 'hospitality', 'tech'] as const).map((cat) => (
                          <button
                            key={cat}
                            type="button"
                            className={`seg${riderCat === cat ? ' seg--on' : ''}`}
                            style={{ flex: 1, padding: '3px 4px', fontSize: 11, minHeight: 22, textTransform: 'capitalize' }}
                            onClick={() => setRiderCat(cat)}
                          >
                            {cat}
                          </button>
                        ))}
                      </div>
                      <div className="flex gap-1">
                        <input className="in" value={riderText} onChange={(e) => setRiderText(e.target.value)} placeholder="Ex: 3x CDJ-3000 + DJM-A9" />
                        <button type="submit" className="btn btn--def">+</button>
                      </div>
                    </form>
                  )}
                </>
              );
            })()}

            {/* FOLDER 5: NOTES, LINKS & QUICK SHARE COCKPIT */}
            {folder === 'notes' && (
              <div className="space-y-3 p-2.5">
                {canEdit ? (
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="lab">{fr ? 'Notes de la date' : 'Day notes'}</span>
                      <span className="sub" style={{ fontSize: 10.5 }}>
                        {notesDraft !== (gig.notes || '') ? (fr ? '• Modifié' : '• Unsaved') : fr ? 'Enregistré' : 'Saved'}
                      </span>
                    </div>
                    <textarea className="in" style={{ minHeight: 84 }} value={notesDraft} onChange={(e) => setNotesDraft(e.target.value)} placeholder={fr ? 'Infos backstage, parking, wifi, code porte…' : 'Backstage notes, parking, wifi, door code…'} />
                    {notesDraft !== (gig.notes || '') && (
                      <button type="button" className="btn btn--def w-full" onClick={() => void sync.updateGigHeader(gig.id, { notes: notesDraft }).then(() => say(fr ? 'Notes enregistrées' : 'Notes saved'))}>
                        {copy.save}
                      </button>
                    )}
                  </div>
                ) : (
                  <p className="m-0 whitespace-pre-wrap">{gig.notes || '—'}</p>
                )}

                {(byCol.links || []).length > 0 && (
                  <div className="space-y-1 border-t border-[var(--cv-line)] pt-2">
                    <span className="lab">{fr ? 'Liens' : 'Links'}</span>
                    {byCol.links.map((l) => (
                      <div key={l.id} className="dk-link-card">
                        <a href={String(l.data.url || '#')} target="_blank" rel="noreferrer" className="inline-flex min-w-0 flex-1 items-center gap-1.5 truncate" style={{ textDecoration: 'none', color: 'inherit' }}>
                          <Link2 className="h-3 w-3 shrink-0 opacity-70" />
                          <span className="truncate">{String(l.data.label || l.data.url)}</span>
                        </a>
                        {canEdit && <button type="button" className="dk-mini-act" onClick={() => void sync.removeGigItem(gig.id, l.id)}>×</button>}
                      </div>
                    ))}
                  </div>
                )}

                {canEdit && (
                  <form
                    className="no-print space-y-1 border-t border-[var(--cv-line)] pt-2"
                    onSubmit={async (e) => {
                      e.preventDefault();
                      if (!linkForm.url.trim()) return;
                      await sync.addGigItem(gig.id, 'links', { label: linkForm.label.trim() || linkForm.url.trim(), url: linkForm.url.trim() });
                      setLinkForm({ label: '', url: '' });
                    }}
                  >
                    <input className="in" value={linkForm.label} onChange={(e) => setLinkForm({ ...linkForm, label: e.target.value })} placeholder={fr ? 'Titre du lien (ex: Billetterie)' : 'Link title (e.g. Tickets)'} />
                    <div className="flex gap-1">
                      <input className="in mono" value={linkForm.url} onChange={(e) => setLinkForm({ ...linkForm, url: e.target.value })} placeholder="https://…" />
                      <button type="submit" className="btn">+</button>
                    </div>
                  </form>
                )}

                <div className="no-print space-y-1.5 border-t border-[var(--cv-line)] pt-2">
                  <div className="lab">{fr ? 'Export & partage' : 'Export & share'}</div>
                  <button type="button" className="btn w-full" style={{ justifyContent: 'flex-start' }} onClick={() => flashCopy('copy_day_f', formatDayPlainText(gig, items, people, locale))}>
                    {copiedKey === 'copy_day_f' ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                    {copiedKey === 'copy_day_f' ? copy.copied : fr ? 'Copier la journée (WhatsApp)' : 'Copy day sheet (WhatsApp)'}
                  </button>
                  <button
                    type="button"
                    className="btn w-full"
                    style={{ justifyContent: 'flex-start' }}
                    onClick={() => (onNavigate ? onNavigate(`/print?gig=${encodeURIComponent(gig.id)}`) : window.print())}
                  >
                    <Printer className="h-3.5 w-3.5" />
                    {fr ? 'Feuille de route A4 / PDF' : 'A4 Roadsheet / PDF'}
                  </button>
                  {canEdit && (
                    <button type="button" className="btn btn--def w-full" style={{ justifyContent: 'flex-start' }} onClick={() => void handleShare('gig_master')}>
                      {copiedKey === 'share_master' ? <Check className="h-3.5 w-3.5" /> : <Share2 className="h-3.5 w-3.5" />}
                      {copiedKey === 'share_master' ? copy.copied : fr ? 'Copier lien voyageur' : 'Copy traveler link'}
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        </aside>
        )}
      </div>
        </>
      )}

      {/* Rich Structured Row Editor (Flights w/ FlightAware + Seats, Transport, Hotel, Schedule w/ ±15m & WhoChips) */}
      {rowEditor && (
        <DayRowEditor
          mode={rowEditor}
          gig={gig}
          people={people}
          onDatePersonIds={[...onDatePersonIds]}
          placeSuggestions={placeSuggestions}
          hotelSuggestions={hotelSuggestions}
          transferPlaceSuggestions={transferPlaceSuggestions}
          activitySuggestions={activitySuggestions}
          locale={locale}
          onClose={() => setRowEditor(null)}
          onSave={async (col, data, personIds, existingId) => {
            const label = String(data.flight_no || data.title || data.label || data.name || (data.from && data.to ? `${data.from} → ${data.to}` : '') || col);
            if (existingId) {
              const prevItem = items.find((x) => x.id === existingId);
              const prevData = prevItem ? { ...prevItem.data } : null;
              const prevPids = prevItem ? [...prevItem.person_ids] : undefined;
              await sync.updateGigItem(gig.id, existingId, data, personIds);
              setSelectedKey(existingId);
              setFlashRowKey(existingId);
              window.setTimeout(() => setFlashRowKey((cur) => (cur === existingId ? null : cur)), 1400);
              if (prevData) {
                pushUndo({
                  label: `${fr ? 'Modif.' : 'Edit'} · ${label}`,
                  revert: () => sync.updateGigItem(gig.id, existingId, prevData, prevPids),
                  redo: () => sync.updateGigItem(gig.id, existingId, data, personIds),
                });
              }
              say(fr ? `Enregistré · ${label} (⌘Z pour annuler)` : `Saved · ${label} (⌘Z to undo)`);
            } else {
              const newId = await sync.addGigItem(gig.id, col, data, personIds);
              setSelectedKey(newId);
              setFlashRowKey(newId);
              window.setTimeout(() => setFlashRowKey((cur) => (cur === newId ? null : cur)), 1400);
              window.requestAnimationFrame(() => {
                listRef.current?.querySelector<HTMLElement>(`[data-row-key="${newId}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
              });
              pushUndo({
                label: `${fr ? 'Ajout' : 'Add'} · ${label}`,
                revert: () => sync.removeGigItem(gig.id, newId),
                redo: async () => { await sync.addGigItem(gig.id, col, data, personIds); },
              });
              say(fr ? `Ajouté · ${label} (⌘Z pour annuler)` : `Added · ${label} (⌘Z to undo)`);
            }
          }}
          onDelete={async (itemId) => {
            const found = items.find((x) => x.id === itemId);
            if (found) await removeItemWithUndo(found, activeRow?.what || found.collection);
          }}
        />
      )}

      {/* Rich Full Date Header / Venue & Finance Editor */}
      {editingHeader && (
        <DayHeaderEditor
          gig={gig}
          projects={projects}
          user={user}
          locale={locale}
          onClose={() => setEditingHeader(false)}
          onSave={async (patch) => {
            await sync.updateGigHeader(gig.id, patch);
            say(fr ? 'Informations enregistrées' : 'Information saved');
          }}
        />
      )}

      {/* Full Universal AI Paste Window */}
      {showIntake && (
        <Suspense fallback={null}>
          <PasteWindow
            gigs={allGigs}
            initialGigId={gig.id}
            initialText={intakeText}
            locale={locale}
            onClose={() => { setShowIntake(false); setIntakeText(''); }}
            onApplied={async () => {
              await sync.refreshFull();
              say(fr ? 'Itinéraire appliqué' : 'Itinerary applied');
            }}
          />
        </Suspense>
      )}

      {/* Lifecycle Confirm Dialog (Archive / Move to Trash) */}
      {lifecycleConfirm && (
        <div
          style={{ position: 'fixed', inset: 0, zIndex: 70, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
          onClick={() => setLifecycleConfirm(null)}
        >
          <div style={{ width: '100%', maxWidth: 420 }} onClick={(e) => e.stopPropagation()}>
            <div className="ytab">
              <button type="button" className="box" onClick={() => setLifecycleConfirm(null)} />
              <span>
                {lifecycleConfirm === 'archive'
                  ? fr ? 'Archiver cette date ?' : 'Archive this date?'
                  : fr ? 'Déplacer dans la corbeille ?' : 'Move this date to Trash?'}
              </span>
            </div>
            <div className="win" style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
              <p style={{ margin: 0 }}>
                <b>{gig.city || gig.name} · {gig.date}</b> —{' '}
                {lifecycleConfirm === 'archive'
                  ? fr
                    ? 'La date quitte la liste principale sans rien effacer. Vous pouvez la désarchiver depuis « Dates retirées ».'
                    : 'The date leaves the main tour list without deleting anything. You can unarchive it from Removed Dates.'
                  : fr
                    ? 'La date rejoint la corbeille (récupérable depuis « Dates retirées »). Rien n’est effacé définitivement ici.'
                    : 'The date moves to Trash (recoverable from Removed Dates). Nothing is permanently deleted here.'}
              </p>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6 }}>
                <button type="button" className="btn" onClick={() => setLifecycleConfirm(null)}>{copy.cancel}</button>
                <button
                  type="button"
                  className={`btn${lifecycleConfirm === 'trash' ? ' warn' : ' btn--def'}`}
                  onClick={() => void handleLifecycleConfirm()}
                >
                  {lifecycleConfirm === 'archive' ? (fr ? 'Archiver' : 'Archive') : fr ? 'Mettre à la corbeille' : 'Move to Trash'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
