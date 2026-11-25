import { Calendar, CalendarDays, FolderOpen, Moon, RotateCcw, Search, SlidersHorizontal, Sparkles, Sun, Users } from 'lucide-react';
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api/client';
import { COPY } from '../i18n/copy';
import { clearDemoFileUrls } from '../lib/basePath';
import { STATUS_LABELS } from '../lib/smartParse';
import type { TourSyncState } from '../offline/sync';
import type { GigStatus, Locale, SkinPref } from '../types';
import { DEMO_USER, installDemoApiSandbox, type DemoStore } from '../demo/demoSandbox';
import { buildDemoTourSnapshot } from '../demo/demoTourData';
import { DayPage } from './DayPage';
import { Deskbar } from './Deskbar';
import { TourPage } from './TourPage';

const CalendarPage = lazy(() => import('./CalendarPage').then((m) => ({ default: m.CalendarPage })));
const ContactsPage = lazy(() => import('./ContactsPage').then((m) => ({ default: m.ContactsPage })));
const FilesPage = lazy(() => import('./FilesPage').then((m) => ({ default: m.FilesPage })));
const PasteWindow = lazy(() => import('./PasteWindow').then((m) => ({ default: m.PasteWindow })));
const PrintPage = lazy(() => import('./PrintPage').then((m) => ({ default: m.PrintPage })));
const TrashPage = lazy(() => import('./TrashPage').then((m) => ({ default: m.TrashPage })));

interface Props {
  locale: Locale;
  onLocale: (l: Locale) => void;
  skin?: SkinPref;
  onSkin?: (s: SkinPref) => void;
  onNavigate: (path: string) => void;
  shareMode?: boolean;
}

const fold = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

function DemoRoleScrubbedShare({ locale, onLocale, onNavigate }: Props) {
  const fr = locale === 'fr';
  const snap = useMemo(() => buildDemoTourSnapshot(), []);
  const gig = snap.gigs.find((g) => g.id === 'gig_mex') || snap.gigs[0];
  const items = (snap.itemsByGig[gig.id] || []).filter((it) => it.collection !== 'notes_list');
  const flights = items.filter((it) => it.collection === 'flights');
  const transports = items.filter((it) => it.collection === 'transport');
  const hotels = items.filter((it) => it.collection === 'hotels');
  const timetable = items.filter((it) => it.collection === 'timetable');
  const contacts = items.filter((it) => it.collection === 'crew');

  return (
    <div className="dk-root" style={{ display: 'block', height: 'auto', minHeight: '100dvh', overflowY: 'auto', padding: '14px 12px 48px' }}>
      <div className="mx-auto w-full max-w-2xl space-y-3">
        <div
          className="win flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-xs"
          style={{
            background: 'linear-gradient(var(--cv-y1), var(--cv-y2))',
            color: 'var(--cv-yink)',
            borderColor: 'var(--cv-ylo)',
          }}
        >
          <span className="font-bold">
            {fr ? 'LIEN CHAUFFEUR / ÉQUIPE · CACHETS MASQUÉS' : 'SHARED DRIVER / CREW LINK · DEALS SCRUBBED'}
          </span>
          <div className="flex items-center gap-1.5">
            <button type="button" className="btn" style={{ minHeight: 24, padding: '0 8px', fontSize: 11 }} onClick={() => onNavigate('/demo')}>
              {fr ? 'Ouvrir les 20 dates' : 'Full 20-date sandbox'}
            </button>
            <button type="button" className="btn btn--def" style={{ minHeight: 24, padding: '0 8px', fontSize: 11 }} onClick={() => onNavigate('/login')}>
              {fr ? 'Créer un compte' : 'Start free →'}
            </button>
            <button type="button" className="btn mono" style={{ minHeight: 24, padding: '0 6px', fontSize: 11 }} onClick={() => onLocale(fr ? 'en' : 'fr')}>
              {fr ? 'EN' : 'FR'}
            </button>
          </div>
        </div>

        <div className="ytab" style={{ margin: '0 0 -1px -1px' }}>
          <span className="box" />
          <span>{gig.city}</span>
          <span className="dk-venue">{gig.venue}</span>
        </div>

        <div className="win p-4 space-y-4 text-xs">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--cv-line)] pb-2.5">
            <div>
              <div className="text-base font-bold">{gig.name}</div>
              <div className="mono sub">{gig.date} · {gig.venue_address}</div>
            </div>
            <span className="dk-pill" style={{ color: 'var(--cv-online)', borderColor: 'var(--cv-online)' }}>
              {fr ? 'Cachets & passeports masqués' : 'Fees & private docs redacted'}
            </span>
          </div>

          <div className="space-y-1.5">
            <div className="lab">{fr ? 'Vols & correspondances' : 'Flights & connections'}</div>
            {flights.map((f) => (
              <div key={f.id} className="border border-[var(--cv-line)] bg-[var(--cv-paper2)] px-3 py-2 flex flex-wrap justify-between gap-2">
                <span>
                  <strong>{String(f.data.flight_no)}</strong> · {String(f.data.dep_iata)} → {String(f.data.arr_iata)} ({String(f.data.airline)})
                </span>
                <span className="mono">{String(f.data.dep_time)}–{String(f.data.arr_time)} · PNR {String(f.data.ref)}</span>
              </div>
            ))}
          </div>

          <div className="space-y-1.5">
            <div className="lab">{fr ? 'Chauffeur & hôtel' : 'Ground pickup & hotel'}</div>
            {transports.map((t) => (
              <div key={t.id} className="border border-[var(--cv-nextline)] bg-[var(--cv-next)] px-3 py-2">
                <strong>{String(t.data.time)}</strong> · {String(t.data.from)} → {String(t.data.to)} · {String(t.data.driver_name)} ({String(t.data.driver_phone)})
              </div>
            ))}
            {hotels.map((h) => (
              <div key={h.id} className="border border-[var(--cv-line)] bg-[var(--cv-paper2)] px-3 py-2">
                <strong>{String(h.data.name)}</strong> · {String(h.data.address)} · {String(h.data.confirmation)}
              </div>
            ))}
          </div>

          <div className="space-y-1.5">
            <div className="lab">Running order</div>
            {timetable.map((slot) => (
              <div key={slot.id} className="flex justify-between border-b border-[var(--cv-line)] py-1">
                <span><span className="mono font-semibold">{String(slot.data.start)}–{String(slot.data.end)}</span> · {String(slot.data.act)}</span>
                <span className="sub">{String(slot.data.stage)}</span>
              </div>
            ))}
          </div>

          <div className="space-y-1">
            <div className="lab">{fr ? 'Contacts sur place' : 'On-site contacts'}</div>
            {contacts.map((c) => (
              <div key={c.id} className="sub">
                <strong>{String(c.data.name)}</strong> ({String(c.data.role)}) · <span className="mono">{String(c.data.phone)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export function DemoPage(props: Props) {
  const { locale, onLocale, skin: propSkin, onSkin, onNavigate, shareMode } = props;
  if (shareMode) {
    return <DemoRoleScrubbedShare {...props} />;
  }

  const fr = locale === 'fr';
  const copy = COPY[locale];

  const [rev, setRev] = useState(0);
  const storeRef = useRef<DemoStore>({
    snap: buildDemoTourSnapshot(),
    notify: () => setRev((v) => v + 1),
  });
  storeRef.current.notify = () => setRev((v) => v + 1);

  // Install in-memory client-side API interceptor synchronously so zero real API calls run
  const uninstall = useMemo(() => installDemoApiSandbox(storeRef.current), []);
  useEffect(() => {
    return () => {
      uninstall();
      clearDemoFileUrls();
    };
  }, [uninstall]);

  const [demoRoute, setDemoRoute] = useState<string>('/gig/gig_mex');
  const [lastGigId, setLastGigId] = useState<string>('gig_mex');
  const [activeProjectId, setActiveProjectId] = useState<string>('all');
  const [toolsOpen, setToolsOpen] = useState(false);
  const [localSkin, setLocalSkin] = useState<SkinPref>('night');
  const skin = propSkin ?? localSkin;
  const setSkin = (next: SkinPref) => {
    if (onSkin) onSkin(next);
    else setLocalSkin(next);
  };
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchIdx, setSearchIdx] = useState(0);
  const [newOpen, setNewOpen] = useState(false);
  const [previewFileId, setPreviewFileId] = useState<string | null>(null);
  const [printPreset, setPrintPreset] = useState<'day' | 'driver' | 'internal'>('day');
  const [pasteReq, setPasteReq] = useState<{ gigId: string; text?: string; files?: File[] } | null>(null);

  // New date form state
  const [nArtistId, setNArtistId] = useState('proj_hype');
  const [nDate, setNDate] = useState('2027-01-30');
  const [nCity, setNCity] = useState('');
  const [nCountry, setNCountry] = useState('');
  const [nTz, setNTz] = useState('Europe/London');
  const [nVenue, setNVenue] = useState('');
  const [nSet, setNSet] = useState('02:00');
  const [nStatus, setNStatus] = useState<GigStatus>('confirmed');
  const [citySug, setCitySug] = useState<Array<{ city: string; country: string; timezone: string }>>([]);

  useEffect(() => {
    if (propSkin !== undefined) return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      document.documentElement.dataset.skin = skin === 'auto' ? (mq.matches ? 'night' : 'day') : skin;
    };
    apply();
    if (skin !== 'auto') return;
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [skin, propSkin]);

  // Global / and ⌘K search shortcut inside demo
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setSearchOpen(true);
        setSearchQuery('');
        setSearchIdx(0);
      } else if (e.key === 'Escape') {
        setSearchOpen(false);
        setNewOpen(false);
        setToolsOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const snap = storeRef.current.snap;
  const triggerRefresh = useCallback(async () => {
    setRev((v) => v + 1);
  }, []);

  const sync: TourSyncState = useMemo(() => {
    const bump = () => setRev((v) => v + 1);
    return {
      gigs: snap.gigs,
      itemsByGig: snap.itemsByGig,
      people: snap.people,
      files: snap.files,
      outbox: [],
      online: true,
      syncing: false,
      lastSyncedAt: new Date().toISOString(),
      hydrateFromIDB: async () => bump(),
      refreshFull: async () => bump(),
      flushOutbox: async () => undefined,
      updateGigHeader: async (gigId, patch) => {
        await api.updateGig(gigId, patch);
      },
      addGigItem: async (gigId, collection, data, personIds = []) => {
        const res = await api.addItems(gigId, [{ collection, data, person_ids: personIds }]);
        return res.items[0]?.id || '';
      },
      updateGigItem: async (gigId, itemId, data, personIds) => {
        await api.updateItem(gigId, itemId, data, undefined, personIds);
      },
      removeGigItem: async (gigId, itemId) => {
        await api.removeItem(gigId, itemId);
      },
      resolveConflict: async () => undefined,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rev]);

  const demoNavigate = useCallback(
    (to: string) => {
      setToolsOpen(false);
      if (to !== '/files') setPreviewFileId(null);
      if (to === '/' || to === '/login') {
        onNavigate(to);
        return;
      }
      if (to === '/link/demo') {
        onNavigate('/link/demo');
        return;
      }
      if (to.startsWith('/print')) {
        const q = to.includes('?') ? new URLSearchParams(to.split('?')[1]) : null;
        if (q?.get('gig')) setLastGigId(q.get('gig')!);
        setPrintPreset((q?.get('preset') as 'day' | 'driver' | 'internal') || 'day');
        setDemoRoute('/print');
        return;
      }
      const m = to.match(/^\/gig\/([^?#]+)/);
      if (m) setLastGigId(m[1]);
      setDemoRoute(to.split('#')[0] || '/tour');
    },
    [onNavigate],
  );

  function resetDemo() {
    clearDemoFileUrls();
    storeRef.current.snap = buildDemoTourSnapshot();
    setActiveProjectId('all');
    setDemoRoute('/gig/gig_mex');
    setLastGigId('gig_mex');
    setRev((v) => v + 1);
  }

  const gigMatch = demoRoute.match(/^\/gig\/([^/]+)$/);
  const visibleGigs = useMemo(() => {
    const active = snap.gigs.filter((g) => !g.archived && !g.deleted_at);
    if (activeProjectId === 'all') return active;
    return active.filter((g) => g.artist_id === activeProjectId);
  }, [snap.gigs, activeProjectId, rev]);

  const activeGig = useMemo(() => {
    if (!gigMatch) return null;
    const found = snap.gigs.find((g) => g.id === gigMatch[1] && !g.deleted_at);
    return found || null;
  }, [gigMatch, snap.gigs, rev]);

  const activeItems = useMemo(() => (activeGig ? snap.itemsByGig[activeGig.id] || [] : []), [activeGig, snap.itemsByGig, rev]);
  const onSitePeople = useMemo(() => {
    const ids = new Set<string>();
    for (const it of activeItems) {
      if (it.collection === 'crew' || it.collection === 'contacts') {
        for (const pid of it.person_ids) ids.add(pid);
      }
    }
    return snap.people.filter((p) => ids.has(p.id));
  }, [activeItems, snap.people, rev]);

  const omnibarHits = useMemo(() => {
    const q = fold(searchQuery.trim());
    const hits: Array<{ id: string; group: string; label: string; sub: string; run: () => void }> = [];
    for (const g of visibleGigs) {
      if (!q || fold(`${g.date} ${g.city} ${g.venue} ${g.country} ${g.name}`).includes(q)) {
        hits.push({
          id: `g_${g.id}`,
          group: 'Date',
          label: `${g.city} · ${g.venue}`,
          sub: g.date,
          run: () => {
            setSearchOpen(false);
            demoNavigate(`/gig/${g.id}`);
          },
        });
      }
    }
    for (const p of snap.people) {
      if (!q || fold(`${p.name} ${p.role || ''} ${p.company || ''}`).includes(q)) {
        hits.push({
          id: `p_${p.id}`,
          group: 'Contact',
          label: p.name,
          sub: p.role || p.company || '',
          run: () => {
            setSearchOpen(false);
            demoNavigate('/rolodex');
          },
        });
      }
    }
    for (const f of snap.files) {
      if (!q || fold(`${f.name} ${f.doc_kind || ''}`).includes(q)) {
        hits.push({
          id: `f_${f.id}`,
          group: 'Doc',
          label: f.name,
          sub: f.doc_kind || 'file',
          run: () => {
            setSearchOpen(false);
            setPreviewFileId(f.id);
            demoNavigate('/files');
          },
        });
      }
    }
    return hits.slice(0, 18);
  }, [searchQuery, visibleGigs, snap.people, snap.files, demoNavigate]);

  async function onCityType(val: string) {
    setNCity(val);
    if (val.trim().length >= 2) {
      const r = await api.searchCities(val);
      setCitySug(r.cities.slice(0, 5));
    } else setCitySug([]);
  }

  async function handleCreateGig(e: React.FormEvent) {
    e.preventDefault();
    const { gig } = await api.createGig({
      artist_id: nArtistId || (activeProjectId !== 'all' ? activeProjectId : 'proj_hype'),
      date: nDate,
      city: nCity || 'Ibiza',
      country: nCountry,
      timezone: nTz,
      venue: nVenue,
      name: nCity || nVenue || nDate,
      set_time: nSet,
      status: nStatus,
    });
    setNewOpen(false);
    setNCity('');
    setNVenue('');
    demoNavigate(`/gig/${gig.id}`);
  }

  const tabTitle = activeGig
    ? activeGig.city || activeGig.name
    : demoRoute === '/calendar-view'
      ? copy.calendar
      : demoRoute === '/rolodex'
        ? copy.contacts
        : demoRoute === '/files'
          ? fr ? 'Documents' : 'Files'
          : demoRoute === '/trash'
            ? fr ? 'Corbeille' : 'Removed dates'
            : fr ? 'Tournée complète' : 'Full Tour';

  if (demoRoute === '/print') {
    const printGig = snap.gigs.find((g) => g.id === lastGigId) || snap.gigs[0];
    if (printGig) {
      return (
        <Suspense fallback={<div className="dk-root items-center justify-center text-[var(--cv-on-desk)]">Loading…</div>}>
          <PrintPage
            gig={printGig}
            items={snap.itemsByGig[printGig.id] || []}
            people={snap.people}
            user={DEMO_USER}
            locale={locale}
            initialLayout={printPreset}
            onBack={() => demoNavigate(`/gig/${printGig.id}`)}
          />
        </Suspense>
      );
    }
  }

  return (
    <div className="dk-root">
      {/* Persistent Sandbox & Conversion Top Strip — 1 slim crisp row on iPhone, full details on desktop */}
      <div
        className="no-print flex flex-wrap items-center justify-between gap-1.5 px-2.5 py-1 sm:px-3 text-xs"
        style={{
          background: 'linear-gradient(var(--cv-y1), var(--cv-y2))',
          color: 'var(--cv-yink)',
          borderBottom: '1px solid var(--cv-ylo)',
          flex: 'none',
        }}
      >
        <div className="flex items-center gap-2 font-semibold min-w-0">
          <span className="mono shrink-0" style={{ fontSize: 10.5, border: '1px solid rgba(0,0,0,0.35)', padding: '0 5px' }}>
            DEMO
          </span>
          <span className="hidden md:inline truncate">
            {fr
              ? 'Tournée 20 dates · Joseph Le Hype × DJ Triesto (éditez, ouvrez billets & passeports)'
              : 'Interactive 20-date world tour · Joseph Le Hype × DJ Triesto (edit anything, inspect passes & visas)'}
          </span>
          <span className="md:hidden truncate text-[11px]">
            {fr ? '20 dates · Le Hype × Triesto' : 'Le Hype × Triesto'}
          </span>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button type="button" className="btn" style={{ minHeight: 24, padding: '0 7px', fontSize: 11 }} onClick={resetDemo} title="Reset sandbox">
            <RotateCcw className="h-3 w-3" />
            <span className="hidden sm:inline">{fr ? 'Réinitialiser' : 'Reset'}</span>
          </button>
          <button type="button" className="btn" style={{ minHeight: 24, padding: '0 7px', fontSize: 11 }} onClick={() => onNavigate('/link/demo')}>
            {fr ? 'Chauffeur' : 'Driver'}
          </button>
          <button type="button" className="btn hidden sm:inline-flex" style={{ minHeight: 24, padding: '0 8px', fontSize: 11 }} onClick={() => onNavigate('/')}>
            {fr ? 'Accueil' : 'Overview'}
          </button>
          <button type="button" className="btn btn--def" style={{ minHeight: 24, padding: '0 9px', fontSize: 11, fontWeight: 700 }} onClick={() => onNavigate('/login')}>
            {fr ? 'Démarrer →' : 'Start free →'}
          </button>
          <button type="button" className="btn mono" style={{ minHeight: 24, padding: '0 6px', fontSize: 11 }} onClick={() => onLocale(fr ? 'en' : 'fr')}>
            {fr ? 'EN' : 'FR'}
          </button>
        </div>
      </div>

      {/* Real Full-Featured Tour Designer Workspace */}
      <div className="dk-page" style={{ flex: 1, minHeight: 0 }}>
        <Deskbar
          path={demoRoute}
          gigs={visibleGigs}
          allGigsCount={snap.gigs.filter((g) => !g.archived && !g.deleted_at).length}
          projects={snap.projects}
          activeProjectId={activeProjectId}
          onSelectProject={(pid) => {
            setActiveProjectId(pid);
            if (pid !== 'all' && activeGig && activeGig.artist_id !== pid) {
              const firstInProj = snap.gigs.find((g) => !g.archived && !g.deleted_at && g.artist_id === pid);
              demoNavigate(firstInProj ? `/gig/${firstInProj.id}` : '/tour');
            }
          }}
          selectedGigId={activeGig?.id || ''}
          onSitePeople={onSitePeople}
          clock={fr ? '20h30' : '20:30'}
          locale={locale}
          user={DEMO_USER}
          copy={copy}
          sync={sync}
          toolsOpen={toolsOpen}
          onToggleTools={() => setToolsOpen((v) => !v)}
          onNavigate={demoNavigate}
          onSearch={() => {
            setSearchOpen(true);
            setSearchIdx(0);
          }}
          onNewDate={() => setNewOpen(true)}
          onOpenPaste={() => setPasteReq({ gigId: activeGig?.id || lastGigId })}
        />

        <main className="dk-main">
          <div className="dk-tabrow">
            <h1 className="ytab" style={{ margin: '0 0 -1px -1px' }}>
              {activeGig ? (
                <button type="button" className="box" title={fr ? 'Tout le tour' : 'Whole tour'} onClick={() => demoNavigate('/tour')} />
              ) : (
                <span className="box" />
              )}
              <span className="truncate">{tabTitle}</span>
              {activeGig?.venue && <span className="dk-venue truncate">{activeGig.venue}</span>}
            </h1>

            <div className="m2032-tray no-print">
              <span className="m2032-tray__clock mono">
                <i className="dk-online" />
                {fr ? '20h30' : '20:30'}
              </span>
              <button
                type="button"
                className="m2032-tray__btn"
                aria-label="Search"
                onClick={() => {
                  setSearchOpen(true);
                  setSearchIdx(0);
                }}
              >
                <Search className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                className="m2032-tray__btn m2032-tray__btn--ai"
                aria-label="Paste / AI Import"
                onClick={() => setPasteReq({ gigId: activeGig?.id || lastGigId })}
              >
                <Sparkles className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>

          <div className="win">
            <Suspense fallback={<div className="flex flex-1 items-center justify-center p-6 sub">Loading…</div>}>
              {activeGig ? (
                <DayPage
                  gig={activeGig}
                  items={activeItems}
                  allGigs={visibleGigs}
                  allItemsByGig={snap.itemsByGig}
                  people={snap.people}
                  projects={snap.projects}
                  user={DEMO_USER}
                  locale={locale}
                  copy={copy}
                  sync={sync}
                  onNavigate={demoNavigate}
                  onOpenFile={(fid) => {
                    setPreviewFileId(fid);
                    demoNavigate('/files');
                  }}
                />
              ) : demoRoute === '/calendar-view' ? (
                <CalendarPage
                  gigs={visibleGigs}
                  itemsByGig={snap.itemsByGig}
                  selectedGigId={lastGigId}
                  locale={locale}
                  onOpenGig={(id) => demoNavigate(`/gig/${id}`)}
                  onCreateGigOnDate={(iso) => {
                    setNDate(iso);
                    setNewOpen(true);
                  }}
                />
              ) : demoRoute === '/rolodex' ? (
                <ContactsPage
                  people={snap.people}
                  gigs={visibleGigs}
                  itemsByGig={snap.itemsByGig}
                  files={snap.files}
                  user={DEMO_USER}
                  locale={locale}
                  copy={copy}
                  onRefresh={triggerRefresh}
                  onOpenGig={(id) => demoNavigate(`/gig/${id}`)}
                  onOpenFile={(fid) => {
                    setPreviewFileId(fid);
                    demoNavigate('/files');
                  }}
                />
              ) : demoRoute === '/files' ? (
                <FilesPage
                  files={snap.files}
                  gigs={visibleGigs}
                  people={snap.people}
                  user={DEMO_USER}
                  locale={locale}
                  initialPreviewFileId={previewFileId}
                  onRefresh={triggerRefresh}
                  onOpenGig={(id) => demoNavigate(`/gig/${id}`)}
                />
              ) : demoRoute === '/trash' ? (
                <TrashPage gigs={visibleGigs} user={DEMO_USER} locale={locale} onRefresh={triggerRefresh} />
              ) : (
                <TourPage
                  gigs={visibleGigs}
                  itemsByGig={snap.itemsByGig}
                  user={DEMO_USER}
                  locale={locale}
                  copy={copy}
                  sync={sync}
                  onOpenGig={(id) => demoNavigate(`/gig/${id}`)}
                  onNewDate={() => setNewOpen(true)}
                />
              )}
            </Suspense>

            {toolsOpen && (
              <section className="dk-tools" aria-label={fr ? 'Outils' : 'Tools'}>
                <div className="dk-tools__head">
                  <strong>{fr ? 'Outils démo' : 'Demo tools'}</strong>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    {(() => {
                      const isNightActive =
                        skin === 'night' ||
                        (skin === 'auto' && typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches);
                      return (
                        <button
                          type="button"
                          className="btn"
                          style={{ minHeight: 24, padding: '0 8px', fontSize: 11.5 }}
                          onClick={() => setSkin(isNightActive ? 'day' : 'night')}
                        >
                          {isNightActive ? <Sun className="h-3 w-3" /> : <Moon className="h-3 w-3" />}
                          {isNightActive ? (fr ? 'Jour (Teal)' : 'Day (Teal)') : fr ? 'Nuit' : 'Night'}
                        </button>
                      );
                    })()}
                    <button type="button" className="btn" style={{ minHeight: 24, padding: '0 8px', fontSize: 11.5 }} onClick={() => setToolsOpen(false)}>
                      {fr ? 'Fermer' : 'Close'}
                    </button>
                  </div>
                </div>
                <button type="button" className="item dk-tool" onClick={() => { setToolsOpen(false); setPasteReq({ gigId: activeGig?.id || lastGigId }); }}>
                  <b>{fr ? 'Coller / Import multi-dates' : 'Paste / Multi-date CSV import'}</b>
                  <span className="sub">{fr ? 'Testez l’extraction locale sans modifier de serveur' : 'Try itinerary extraction locally in sandbox'}</span>
                </button>
                <button type="button" className="item dk-tool" onClick={() => demoNavigate(`/print?gig=${encodeURIComponent(activeGig?.id || lastGigId)}&preset=day`)}>
                  <b>{fr ? 'Imprimer Pack A4 (Journée · Chauffeur · Interne)' : 'Print A4 Roadsheet (Day · Driver · Owner)'}</b>
                  <span className="sub">{fr ? 'Comparez la feuille chauffeur sans cachets et la feuille propriétaire' : 'Compare fee-redacted driver card vs full owner sheet'}</span>
                </button>
                <button type="button" className="item dk-tool" onClick={() => demoNavigate('/trash')}>
                  <b>{fr ? 'Dates archivées / supprimées' : 'Archive & Trash'}</b>
                  <span className="sub">{fr ? 'Restaurer une date archivée du bac à sable' : 'Inspect archived/deleted demo dates'}</span>
                </button>
                <button type="button" className="item dk-tool" onClick={() => onNavigate('/login')}>
                  <b>{fr ? 'Créer votre véritable espace cloud' : 'Create your live cloud workspace'}</b>
                  <span className="sub">{fr ? 'Connexion Google ou Email · Synchronisation hors ligne' : 'Google or Email sign-in · Encrypted vault & MCP'}</span>
                </button>
              </section>
            )}
          </div>
        </main>
      </div>

      {/* Mobile Hardware Dock */}
      <nav className="dk-dock no-print" aria-label="Demo Navigation">
        <button
          type="button"
          className={`dock${demoRoute === '/tour' || demoRoute.startsWith('/gig/') ? ' dock--on' : ''}`}
          onClick={() => demoNavigate(demoRoute.startsWith('/gig/') ? '/tour' : `/gig/${lastGigId}`)}
        >
          <CalendarDays className="h-4 w-4" />
          <span>Dates</span>
        </button>
        <button type="button" className={`dock${demoRoute === '/calendar-view' ? ' dock--on' : ''}`} onClick={() => demoNavigate('/calendar-view')}>
          <Calendar className="h-4 w-4" />
          <span>{fr ? 'Cal.' : 'Cal'}</span>
        </button>
        <button type="button" className={`dock${demoRoute === '/files' ? ' dock--on' : ''}`} onClick={() => demoNavigate('/files')}>
          <FolderOpen className="h-4 w-4" />
          <span>Docs</span>
        </button>
        <button type="button" className={`dock${demoRoute === '/rolodex' ? ' dock--on' : ''}`} onClick={() => demoNavigate('/rolodex')}>
          <Users className="h-4 w-4" />
          <span>{copy.contacts}</span>
        </button>
        <button type="button" className={`dock${toolsOpen ? ' dock--on' : ''}`} onClick={() => setToolsOpen((v) => !v)}>
          <SlidersHorizontal className="h-4 w-4" />
          <span>{fr ? 'Outils' : 'Tools'}</span>
        </button>
      </nav>

      {/* Omnibar Search */}
      {searchOpen && (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/45 p-4 pt-14" onClick={() => setSearchOpen(false)}>
          <div className="w-full max-w-lg" onClick={(e) => e.stopPropagation()}>
            <div className="ytab">
              <button type="button" className="box" onClick={() => setSearchOpen(false)} />
              <span>{fr ? 'Rechercher · Dates, Contacts, Documents' : 'Search · Dates, Contacts, Documents'}</span>
            </div>
            <div className="win">
              <div className="border-b border-[var(--cv-line2)] p-2">
                <input
                  className="in"
                  value={searchQuery}
                  onChange={(e) => { setSearchQuery(e.target.value); setSearchIdx(0); }}
                  onKeyDown={(e) => {
                    if (e.key === 'ArrowDown') { e.preventDefault(); setSearchIdx((i) => Math.min(omnibarHits.length - 1, i + 1)); }
                    else if (e.key === 'ArrowUp') { e.preventDefault(); setSearchIdx((i) => Math.max(0, i - 1)); }
                    else if (e.key === 'Enter' && omnibarHits[searchIdx]) { e.preventDefault(); omnibarHits[searchIdx].run(); }
                  }}
                  placeholder={fr ? 'Ibiza, Tomorrowland, Triesto, Passeport…' : 'Ibiza, Tomorrowland, Triesto, Passport…'}
                  autoFocus
                />
              </div>
              <div className="max-h-80 overflow-y-auto bg-[var(--cv-paper)]">
                {omnibarHits.map((h, i) => (
                  <button key={h.id} type="button" className={`day${i === searchIdx ? ' day--on' : ''}`} style={{ gridTemplateColumns: '80px minmax(0, 1fr) auto' }} onMouseEnter={() => setSearchIdx(i)} onClick={h.run}>
                    <span className="lab">{h.group}</span>
                    <span className="truncate"><b>{h.label}</b></span>
                    <span className="sub truncate" style={{ maxWidth: 180 }}>{h.sub}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Paste Window */}
      {pasteReq && (
        <Suspense fallback={null}>
          <PasteWindow
            gigs={snap.gigs}
            initialGigId={pasteReq.gigId}
            initialText={pasteReq.text}
            initialFiles={pasteReq.files}
            locale={locale}
            onClose={() => setPasteReq(null)}
            onApplied={async (gid) => {
              await triggerRefresh();
              if (gid) demoNavigate(`/gig/${gid}`);
            }}
          />
        </Suspense>
      )}

      {/* New Gig Modal */}
      {newOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4">
          <div className="w-full max-w-md">
            <div className="ytab">
              <button type="button" className="box" onClick={() => setNewOpen(false)} />
              <span>{copy.newDate}</span>
            </div>
            <form onSubmit={handleCreateGig} className="win space-y-2.5 p-3">
              <label className="block space-y-1">
                <span className="lab">{fr ? 'Artiste' : 'Artist / Project'}</span>
                <select className="in" value={nArtistId} onChange={(e) => setNArtistId(e.target.value)}>
                  {snap.projects.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </label>
              <div className="grid grid-cols-2 gap-2">
                <label className="space-y-1"><span className="lab">Date</span><input type="date" className="in mono" value={nDate} onChange={(e) => setNDate(e.target.value)} required /></label>
                <label className="space-y-1">
                  <span className="lab">{fr ? 'Statut' : 'Status'}</span>
                  <select className="in" value={nStatus} onChange={(e) => setNStatus(e.target.value as GigStatus)}>
                    {(['hold', 'pending', 'confirmed', 'announced', 'advancing'] as GigStatus[]).map((s) => (
                      <option key={s} value={s}>{STATUS_LABELS[locale][s]}</option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="relative space-y-1">
                <span className="lab">{fr ? 'Ville' : 'City'}</span>
                <input className="in" value={nCity} onChange={(e) => void onCityType(e.target.value)} placeholder="Ibiza, Miami, Amsterdam…" />
                {citySug.length > 0 && (
                  <div className="win absolute z-10 mt-1 w-full bg-[var(--cv-paper)]">
                    {citySug.map((s) => (
                      <button key={`${s.city}-${s.country}`} type="button" className="day" style={{ gridTemplateColumns: 'minmax(0, 1fr) auto' }} onClick={() => { setNCity(s.city); setNCountry(s.country); setNTz(s.timezone); setCitySug([]); }}>
                        <span>{s.city}, {s.country}</span>
                        <span className="mono sub">{s.timezone}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <div className="grid grid-cols-2 gap-2">
                <label className="space-y-1"><span className="lab">{fr ? 'Salle / Festival' : 'Venue'}</span><input className="in" value={nVenue} onChange={(e) => setNVenue(e.target.value)} placeholder="Amnesia / Hï" /></label>
                <label className="space-y-1"><span className="lab">Set</span><input className="in mono" value={nSet} onChange={(e) => setNSet(e.target.value)} /></label>
              </div>
              <div className="flex justify-end gap-2 border-t border-[var(--cv-line2)] pt-2">
                <button type="button" className="btn" onClick={() => setNewOpen(false)}>{copy.cancel}</button>
                <button type="submit" className="btn btn--def">{copy.save}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
