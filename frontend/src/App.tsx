import { Calendar, CalendarDays, FolderOpen, Moon, Search, SlidersHorizontal, Sparkles, Sun, Users } from 'lucide-react';
import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { api, type AuthMeResponse, type UpdateCheckStatus } from './api/client';
import { DayPage } from './features/DayPage';
import { Deskbar } from './features/Deskbar';
import { TourPage } from './features/TourPage';
import { COPY } from './i18n/copy';
import { stripBase, withBase } from './lib/basePath';
import { STATUS_LABELS } from './lib/smartParse';
import { purgeOfflineCopy } from './offline/db';
import { useTourSync } from './offline/sync';
import type { GigStatus, Locale, Project, SkinPref, User } from './types';

const AdminDashboardPage = lazy(() =>
  import('./features/AdminDashboardPage').then((m) => ({ default: m.AdminDashboardPage })),
);
const CalendarPage = lazy(() => import('./features/CalendarPage').then((m) => ({ default: m.CalendarPage })));
const CommunityShareModal = lazy(() =>
  import('./features/CommunityShareModal').then((m) => ({ default: m.CommunityShareModal })),
);
const ContactsPage = lazy(() => import('./features/ContactsPage').then((m) => ({ default: m.ContactsPage })));
const DemoPage = lazy(() => import('./features/DemoPage').then((m) => ({ default: m.DemoPage })));
const FilesPage = lazy(() => import('./features/FilesPage').then((m) => ({ default: m.FilesPage })));
const HelpPage = lazy(() => import('./features/HelpPage').then((m) => ({ default: m.HelpPage })));
const FirstDayChecklist = lazy(() =>
  import('./features/FirstDayChecklist').then((m) => ({ default: m.FirstDayChecklist })),
);
const LandingPage = lazy(() => import('./features/LandingPage').then((m) => ({ default: m.LandingPage })));
const LegalPage = lazy(() => import('./features/LegalPage').then((m) => ({ default: m.LegalPage })));
const PasteWindow = lazy(() => import('./features/PasteWindow').then((m) => ({ default: m.PasteWindow })));
const PrintPage = lazy(() => import('./features/PrintPage').then((m) => ({ default: m.PrintPage })));
const SettingsPage = lazy(() => import('./features/SettingsPage').then((m) => ({ default: m.SettingsPage })));
const SharePage = lazy(() => import('./features/SharePage').then((m) => ({ default: m.SharePage })));
const SyncPage = lazy(() => import('./features/SyncPage').then((m) => ({ default: m.SyncPage })));
const TrashPage = lazy(() => import('./features/TrashPage').then((m) => ({ default: m.TrashPage })));

function useLocationState() {
  const [loc, setLoc] = useState(() => ({
    path: stripBase(window.location.pathname),
    search: window.location.search,
  }));
  useEffect(() => {
    const onPop = () => setLoc({ path: stripBase(window.location.pathname), search: window.location.search });
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  const navigate = (next: string) => {
    const u = new URL(withBase(next), window.location.origin);
    const nextPath = stripBase(u.pathname);
    if (nextPath === stripBase(window.location.pathname) && u.search === window.location.search) return;
    window.history.pushState(null, '', u.pathname + u.search);
    setLoc({ path: nextPath, search: u.search });
  };
  return { path: loc.path, search: loc.search, navigate };
}

function liveClock(locale: Locale): string {
  const d = new Date();
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return locale === 'fr' ? `${hh}h${mm}` : `${hh}:${mm}`;
}

const fold = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

export function App() {
  const { path, search, navigate } = useLocationState();
  const [user, setUser] = useState<User | null>(null);
  const [authMeta, setAuthMeta] = useState<AuthMeResponse | null>(null);
  const [updateStatus, setUpdateStatus] = useState<UpdateCheckStatus | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [password, setPassword] = useState('');
  const [authMode, setAuthMode] = useState<'signin' | 'signup'>('signin');
  const [emailInput, setEmailInput] = useState('');
  const [nameInput, setNameInput] = useState('');
  const [emailPasswordInput, setEmailPasswordInput] = useState('');
  const [teamKeyInput, setTeamKeyInput] = useState('');
  const [showKeyForm, setShowKeyForm] = useState(false);
  const [consentChecked, setConsentChecked] = useState(true);
  const [loginErr, setLoginErr] = useState<string | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchIdx, setSearchIdx] = useState(0);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [newOpen, setNewOpen] = useState(false);
  const [pasteReq, setPasteReq] = useState<{ gigId?: string; text?: string; files?: File[] } | null>(null);
  const [previewFileId, setPreviewFileId] = useState<string | null>(null);
  const [lastGigId, setLastGigId] = useState<string>('');
  const [projects, setProjects] = useState<Project[]>([]);
  const [activeProjectId, setActiveProjectId] = useState<string>(() => localStorage.getItem('td_project') || 'all');

  // Non-blocking background GitHub update check for self-hosted owners (6h server cache, offline-safe)
  useEffect(() => {
    if (!user || user.role !== 'owner') return;
    if (typeof navigator !== 'undefined' && !navigator.onLine) return;
    let alive = true;
    api
      .checkUpdate(false)
      .then((res) => {
        if (alive) setUpdateStatus(res);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [user]);

  // New date window state
  const [nDate, setNDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [nArtistId, setNArtistId] = useState('');
  const [nCity, setNCity] = useState('');
  const [nCountry, setNCountry] = useState('');
  const [nTz, setNTz] = useState('Europe/Paris');
  const [nVenue, setNVenue] = useState('');
  const [nSet, setNSet] = useState('01:00');
  const [nStatus, setNStatus] = useState<GigStatus>('hold');
  const [citySug, setCitySug] = useState<Array<{ city: string; country: string; timezone: string }>>([]);

  const [locale, setLocale] = useState<Locale>(() => (localStorage.getItem('td_locale') as Locale) || 'en');
  const [skin, setSkinState] = useState<SkinPref>(() => {
    const saved = localStorage.getItem('td_skin_pref');
    return saved === 'day' || saved === 'auto' || saved === 'night' ? saved : 'night';
  });
  const setSkin = (next: SkinPref) => {
    localStorage.setItem('td_skin_pref', next);
    setSkinState(next);
  };
  const [uiScale, setUiScale] = useState<number>(() => Number(localStorage.getItem('td_scale') || '1') || 1);
  const [clock, setClock] = useState(() => liveClock(locale));
  const copy = COPY[locale];
  const fr = locale === 'fr';

  useEffect(() => {
    localStorage.setItem('td_scale', String(uiScale));
    document.documentElement.style.setProperty('--ui-scale', String(uiScale));
  }, [uiScale]);

  useEffect(() => {
    setClock(liveClock(locale));
    const id = window.setInterval(() => setClock(liveClock(locale)), 15_000);
    return () => window.clearInterval(id);
  }, [locale]);

  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      const resolved = skin === 'auto' ? (mq.matches ? 'night' : 'day') : skin;
      document.documentElement.dataset.skin = resolved;
    };
    apply();
    if (skin !== 'auto') return;
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [skin]);

  useEffect(() => {
    localStorage.setItem('td_locale', locale);
    document.documentElement.lang = locale;
  }, [locale]);

  const shareMatch = path.match(/^\/link\/([^/]+)/);
  const isLegalRoute = path === '/legal/privacy' || path === '/legal/terms';

  useEffect(() => {
    if (shareMatch || isLegalRoute) {
      setAuthChecked(true);
      return;
    }
    async function bootAuth() {
      const qs = new URLSearchParams(window.location.search);
      const authError = qs.get('auth_error');
      if (authError) {
        const msgMap: Record<string, string> = {
          not_invited: 'This Google account is not invited to this workspace.',
          google_cancelled: 'Google sign-in was cancelled.',
          google_unverified_email: 'A verified Google email address is required.',
          google_exchange_failed: 'Could not complete Google sign-in. Please try again.',
          oauth_state_mismatch: 'Session expired during sign-in. Please try again.',
          oauth_state_missing: 'Sign-in session expired. Please try again.',
        };
        setLoginErr(msgMap[authError] || 'Sign-in failed. Please try again.');
      }
      const urlKey = qs.get('key');
      if (urlKey) {
        try {
          const res = await api.keyLogin(urlKey, true);
          setUser(res.user);
          window.history.replaceState(null, '', withBase('/tour'));
          const meRes = await api.me().catch(() => null);
          if (meRes) setAuthMeta(meRes);
          setAuthChecked(true);
          return;
        } catch {
          setLoginErr('Invalid key');
        }
      }
      try {
        const res = await api.me();
        setAuthMeta(res);
        setUser(res.authenticated && res.user ? res.user : null);
      } catch {
        const cached = localStorage.getItem('td_last_user');
        if (cached) setUser(JSON.parse(cached));
      } finally {
        setAuthChecked(true);
      }
    }
    void bootAuth();
  }, [Boolean(shareMatch), isLegalRoute]);

  useEffect(() => {
    if (user) localStorage.setItem('td_last_user', JSON.stringify(user));
  }, [user]);

  const sync = useTourSync(shareMatch ? null : user);
  const conflicts = useMemo(() => sync.outbox.filter((o) => o.status === 'conflict'), [sync.outbox]);
  const [communityModal, setCommunityModal] = useState<'milestone' | 'invite' | null>(null);
  const [mcpConnectedLocal, setMcpConnectedLocal] = useState(false);
  const [firstDayDismissed, setFirstDayDismissed] = useState<boolean>(() => {
    try {
      return localStorage.getItem('td:day1:dismissed:v1') === '1';
    } catch {
      return false;
    }
  });

  const nonDeletedGigsCount = useMemo(
    () => sync.gigs.filter((g) => !g.deleted_at).length,
    [sync.gigs],
  );
  const day1StorageKey = `td:day1:dismissed:v1:${authMeta?.tenant_id || 'default'}`;
  const hasMcpConnected = Boolean(user?.has_mcp_key || mcpConnectedLocal);
  const showFirstDayChecklist = Boolean(
    user &&
      user.role !== 'viewer' &&
      !firstDayDismissed &&
      !shareMatch &&
      !isLegalRoute &&
      path !== '/print' &&
      path !== '/settings' &&
      !(hasMcpConnected && nonDeletedGigsCount > 0 && sync.files.length > 0),
  );

  useEffect(() => {
    try {
      if (localStorage.getItem(day1StorageKey) === '1') setFirstDayDismissed(true);
    } catch {
      // ignore storage errors
    }
  }, [day1StorageKey]);

  const dismissFirstDayChecklist = () => {
    setFirstDayDismissed(true);
    try {
      localStorage.setItem('td:day1:dismissed:v1', '1');
      localStorage.setItem(day1StorageKey, '1');
    } catch {
      // ignore storage errors
    }
  };
  const milestoneStorageKey = `td:milestone:v1:${authMeta?.tenant_id || 'default'}`;

  useEffect(() => {
    const community = authMeta?.community;
    if (!user || !community?.enabled || shareMatch || isLegalRoute || path === '/print') return;
    if (communityModal !== null) return;
    if (nonDeletedGigsCount < (community.milestone_gigs || 7)) return;
    try {
      if (localStorage.getItem(milestoneStorageKey) === '1') return;
    } catch {
      return;
    }
    const timer = window.setTimeout(() => {
      setCommunityModal('milestone');
    }, 650);
    return () => window.clearTimeout(timer);
  }, [user, authMeta, nonDeletedGigsCount, milestoneStorageKey, communityModal, shareMatch, isLegalRoute, path]);

  const closeCommunityModal = () => {
    if (communityModal === 'milestone') {
      try {
        localStorage.setItem(milestoneStorageKey, '1');
      } catch {
        // ignore storage quota errors
      }
    }
    setCommunityModal(null);
  };

  const gigMatch = path.match(/^\/gig\/([^/]+)/);
  const activeGig = gigMatch ? sync.gigs.find((g) => g.id === decodeURIComponent(gigMatch[1])) : undefined;
  const activeItems = activeGig ? sync.itemsByGig[activeGig.id] || [] : [];

  const refreshProjects = async () => {
    const res = await api.listProjects().catch(() => ({ projects: [] as Project[] }));
    setProjects(res.projects);
    setActiveProjectId((cur) => {
      if (cur !== 'all' && !res.projects.some((p) => p.id === cur)) return 'all';
      return cur;
    });
  };

  useEffect(() => {
    if (!user) return;
    void refreshProjects();
  }, [user]);

  useEffect(() => {
    localStorage.setItem('td_project', activeProjectId);
  }, [activeProjectId]);

  const visibleGigs = useMemo(() => {
    if (activeProjectId === 'all') return sync.gigs;
    return sync.gigs.filter((g) => g.artist_id === activeProjectId);
  }, [sync.gigs, activeProjectId]);

  const visibleFiles = useMemo(() => {
    if (activeProjectId === 'all') return sync.files;
    const ids = new Set(visibleGigs.map((g) => g.id));
    return sync.files.filter((f) => !f.gig_id || ids.has(f.gig_id));
  }, [sync.files, visibleGigs, activeProjectId]);

  useEffect(() => {
    if (activeGig?.id) setLastGigId(activeGig.id);
  }, [activeGig?.id]);

  // Global keyboard shortcuts: ⌘K / / (Search), J / K (Deskbar day rail), ⌘S (saved toast), Esc
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing = Boolean(target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));
      if (((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') || (!typing && e.key === '/')) {
        e.preventDefault();
        setSearchOpen((v) => !v);
        setSearchIdx(0);
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        void sync.flushOutbox();
      } else if (!typing && activeGig && (e.key === 'j' || e.key === 'k') && !e.metaKey && !e.ctrlKey && !e.altKey) {
        const ordered = sync.gigs.filter((g) => !g.archived && !g.deleted_at).sort((a, b) => a.date.localeCompare(b.date));
        const idx = ordered.findIndex((g) => g.id === activeGig.id);
        const next = ordered[idx + (e.key === 'j' ? 1 : -1)];
        if (next) {
          e.preventDefault();
          navigate(`/gig/${next.id}`);
        }
      } else if (e.key === 'Escape') {
        setSearchOpen(false);
        setToolsOpen(false);
        setNewOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [activeGig, sync.gigs, sync.flushOutbox, navigate]);

  const onSitePeople = useMemo(() => {
    if (!activeGig) return [];
    const ids = new Set<string>();
    for (const it of activeItems) {
      if (it.collection === 'crew' || it.collection === 'contacts') {
        for (const pid of it.person_ids) ids.add(pid);
      }
    }
    return sync.people.filter((p) => ids.has(p.id));
  }, [activeGig, activeItems, sync.people]);

  // Full Omnibar Search Hits (Gigs + Contacts + Flights/Hotels + Files + Quick Commands)
  const omnibarHits = useMemo(() => {
    const q = fold(searchQuery.trim());
    const hits: Array<{ id: string; group: string; label: string; sub: string; run: () => void }> = [];

    const open = (route: string) => {
      setSearchOpen(false);
      setSearchQuery('');
      setToolsOpen(false);
      navigate(route);
    };

    // Quick commands & sections
    const commands: Array<{ label: string; sub: string; keywords: string; run: () => void }> = [
      { label: fr ? 'Tout le tour (Dates)' : 'Whole tour (Dates)', sub: '/tour', keywords: 'tour dates list liste', run: () => open('/tour') },
      { label: copy.calendar, sub: '/calendar-view', keywords: 'calendar calendrier mois semaine', run: () => open('/calendar-view') },
      { label: fr ? 'Documents' : 'Files', sub: '/files', keywords: 'files documents pdf billets', run: () => open('/files') },
      { label: copy.contacts, sub: '/rolodex', keywords: 'contacts rolodex equipe people', run: () => open('/rolodex') },
      { label: fr ? 'Coller / Importer (AI Intake)' : 'Paste / Import (AI Intake)', sub: 'AI', keywords: 'paste coller intake ai import email billet', run: () => { setSearchOpen(false); setPasteReq({ gigId: activeGig?.id || lastGigId, text: searchQuery.trim() }); setSearchQuery(''); } },
      { label: fr ? 'Enregistrement & Historique' : 'Saving & History', sub: '/sync', keywords: 'sync hors ligne offline history historique', run: () => open('/sync') },
      { label: fr ? 'Dates retirées (Corbeille & Archives)' : 'Removed dates (Trash & Archive)', sub: '/trash', keywords: 'trash corbeille archive', run: () => open('/trash') },
      { label: copy.settings, sub: '/settings', keywords: 'settings reglages theme langue mcp', run: () => open('/settings') },
      { label: skin === 'night' ? (fr ? 'Passer en thème Jour' : 'Switch to Day theme') : fr ? 'Passer en thème Nuit' : 'Switch to Night theme', sub: 'theme', keywords: 'theme dark light jour nuit night day', run: () => { setSkin(skin === 'night' ? 'day' : 'night'); setSearchOpen(false); setSearchQuery(''); } },
      { label: locale === 'fr' ? 'Switch language to English' : 'Passer la langue en Français', sub: 'i18n', keywords: 'langue language fr en english francais', run: () => { setLocale(locale === 'fr' ? 'en' : 'fr'); setSearchOpen(false); setSearchQuery(''); } },
    ];

    if (activeGig || lastGigId) {
      commands.push({
        label: fr ? 'Imprimer la feuille de route' : 'Print roadsheet',
        sub: '/print',
        keywords: 'print imprimer pdf roadsheet chauffeur driver',
        run: () => open(`/print?gig=${encodeURIComponent(activeGig?.id || lastGigId)}`),
      });
    }

    // Gigs
    for (const g of sync.gigs) {
      if (g.deleted_at) continue;
      if (!q || fold(`${g.date} ${g.city} ${g.venue} ${g.country} ${g.name} ${g.status} ${g.notes}`).includes(q)) {
        hits.push({
          id: `gig:${g.id}`,
          group: fr ? 'Dates' : 'Dates',
          label: `${g.date} · ${g.city || g.name}`,
          sub: [g.venue, STATUS_LABELS[locale][g.status] || g.status].filter(Boolean).join(' · '),
          run: () => open(`/gig/${g.id}`),
        });
      }
      if (hits.length >= 6 && !q) break;
    }

    if (q) {
      // Flights / Hotels / Schedule inside gigs
      for (const g of sync.gigs) {
        for (const it of sync.itemsByGig[g.id] || []) {
          if (!['flights', 'hotels', 'transport', 'schedule'].includes(it.collection)) continue;
          const blob = fold(Object.values(it.data || {}).join(' '));
          if (blob.includes(q)) {
            const title =
              it.collection === 'flights'
                ? `✈ ${String(it.data.flight_no || '')} ${String(it.data.dep_iata || '')}→${String(it.data.arr_iata || '')}`
                : it.collection === 'hotels'
                  ? `🏨 ${String(it.data.name || '')}`
                  : String(it.data.title || it.data.pickup || it.collection);
            hits.push({
              id: `item:${it.id}`,
              group: fr ? 'Logistique' : 'Logistics',
              label: title,
              sub: `${g.date} · ${g.city || g.name}`,
              run: () => open(`/gig/${g.id}`),
            });
          }
        }
      }

      // People
      for (const p of sync.people) {
        if (fold(`${p.name} ${p.role || ''} ${p.company || ''} ${p.phone || ''} ${p.email || ''}`).includes(q)) {
          hits.push({
            id: `per:${p.id}`,
            group: copy.contacts,
            label: p.name,
            sub: [p.role, p.phone].filter(Boolean).join(' · '),
            run: () => open('/rolodex'),
          });
        }
      }

      // Files
      for (const f of sync.files) {
        if (fold(`${f.name} ${f.doc_kind || ''}`).includes(q)) {
          hits.push({
            id: `fil:${f.id}`,
            group: fr ? 'Documents' : 'Files',
            label: f.name,
            sub: f.doc_kind || f.mime,
            run: () => {
              setPreviewFileId(f.id);
              open('/files');
            },
          });
        }
      }
    }

    for (const cmd of commands) {
      if (!q || fold(`${cmd.label} ${cmd.keywords}`).includes(q)) {
        hits.push({ id: `cmd:${cmd.label}`, group: fr ? 'Actions' : 'Actions', label: cmd.label, sub: cmd.sub, run: cmd.run });
      }
    }

    return hits.slice(0, 18);
  }, [searchQuery, sync.gigs, sync.itemsByGig, sync.people, sync.files, activeGig, lastGigId, fr, copy, skin, locale, navigate]);

  if (isLegalRoute) {
    return (
      <Suspense fallback={<div className="dk-root items-center justify-center text-[var(--cv-on-desk)]">tourdesigner…</div>}>
        <LegalPage
          doc={path === '/legal/privacy' ? 'privacy' : 'terms'}
          locale={locale}
          onLocale={setLocale}
          onNavigate={navigate}
        />
      </Suspense>
    );
  }
  if (path === '/help') {
    return (
      <Suspense fallback={<div className="dk-root items-center justify-center text-[var(--cv-on-desk)]">tourdesigner…</div>}>
        <HelpPage locale={locale} onLocale={setLocale} onNavigate={navigate} />
      </Suspense>
    );
  }
  if (path === '/demo' || path === '/link/demo') {
    return (
      <Suspense fallback={<div className="dk-root items-center justify-center text-[var(--cv-on-desk)]">tourdesigner…</div>}>
        <DemoPage locale={locale} onLocale={setLocale} skin={skin} onSkin={setSkin} onNavigate={navigate} shareMode={path === '/link/demo'} />
      </Suspense>
    );
  }
  if (shareMatch) {
    return (
      <Suspense fallback={<div className="dk-root items-center justify-center text-[var(--cv-on-desk)]">tourdesigner…</div>}>
        <SharePage shareKey={decodeURIComponent(shareMatch[1])} />
      </Suspense>
    );
  }
  if (!authChecked) return <div className="dk-root items-center justify-center text-[var(--cv-on-desk)]">tourdesigner…</div>;

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoginErr(null);
    try {
      const res = await api.ownerLogin(password);
      setUser(res.user);
      setPassword('');
      const meRes = await api.me().catch(() => null);
      if (meRes) setAuthMeta(meRes);
      navigate('/tour');
    } catch {
      setLoginErr(fr ? 'Mot de passe invalide' : 'Invalid password');
    }
  }

  async function handleTeamKeySubmit(e: React.FormEvent) {
    e.preventDefault();
    const cleaned = teamKeyInput.trim();
    if (!cleaned) return;
    setLoginErr(null);
    try {
      const res = await api.keyLogin(cleaned, true);
      setUser(res.user);
      setTeamKeyInput('');
      const meRes = await api.me().catch(() => null);
      if (meRes) setAuthMeta(meRes);
      navigate('/tour');
    } catch {
      setLoginErr(fr ? 'Clé d’accès invalide ou révoquée' : 'Invalid or revoked access key');
    }
  }

  async function handleEmailAuthSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoginErr(null);
    const cleanedEmail = emailInput.trim().toLowerCase();
    if (!cleanedEmail || !emailPasswordInput) return;
    if (authMode === 'signup' && !consentChecked) {
      setLoginErr(
        fr
          ? 'Veuillez accepter les Conditions et l’Avis de confidentialité.'
          : 'Please accept the Terms of Service and Privacy Notice.',
      );
      return;
    }
    try {
      const res =
        authMode === 'signup'
          ? await api.registerAccount({
              name: nameInput.trim() || undefined,
              email: cleanedEmail,
              password: emailPasswordInput,
              consent: consentChecked,
            })
          : await api.passwordLogin({
              email: cleanedEmail,
              password: emailPasswordInput,
            });
      setUser(res.user);
      setEmailPasswordInput('');
      const meRes = await api.me().catch(() => null);
      if (meRes) setAuthMeta(meRes);
      navigate('/tour');
    } catch (err) {
      const code = err instanceof Error ? err.message : '';
      if (code === 'email_already_registered') {
        setLoginErr(
          fr
            ? 'Un compte existe déjà avec cet email — utilisez « Se connecter » ou Google.'
            : 'An account already exists with this email — use Sign in or Continue with Google.',
        );
      } else if (code === 'password_too_short') {
        setLoginErr(fr ? 'Mot de passe : 8 caractères minimum.' : 'Password must be at least 8 characters.');
      } else if (code === 'invalid_email') {
        setLoginErr(fr ? 'Adresse email invalide.' : 'Please enter a valid email address.');
      } else {
        setLoginErr(fr ? 'Email ou mot de passe incorrect.' : 'Invalid email or password.');
      }
    }
  }

  async function handleLogout() {
    await api.logout().catch(() => undefined);
    await purgeOfflineCopy();
    localStorage.removeItem('td_last_user');
    setUser(null);
    navigate('/login');
  }

  if (!user) {
    const isMulti = authMeta?.tenancy_mode === 'multi';
    if (isMulti && path !== '/login') {
      return (
        <Suspense fallback={<div className="dk-root items-center justify-center text-[var(--cv-on-desk)]">tourdesigner…</div>}>
          <LandingPage
            locale={locale}
            onLocale={setLocale}
            hostedPlan={authMeta?.hosted_plan}
            landingVideoUrl={authMeta?.landing_video_url}
            onNavigate={navigate}
          />
        </Suspense>
      );
    }
    const googleEnabled = Boolean(authMeta?.google_oauth_enabled);
    const emailPasswordEnabled = Boolean(authMeta?.email_password_enabled ?? isMulti);
    const passwordEnabled = authMeta?.password_login_enabled ?? !isMulti;
    const planLabel = authMeta?.hosted_plan || 'Free Beta';

    return (
      <div className="dk-root items-center justify-center p-4">
        <div className="w-full max-w-md">
          <div className="dk-tabrow">
            <div className="ytab" style={{ margin: '0 0 -1px -1px' }}>
              <span className="box" />
              <span>tourdesigner</span>
              {isMulti && <span className="dk-venue">{planLabel}</span>}
            </div>
            <button
              type="button"
              className="btn mono"
              style={{ marginLeft: 'auto', marginBottom: 4, minHeight: 24, padding: '0 8px', fontSize: 11 }}
              onClick={() => setLocale(fr ? 'en' : 'fr')}
            >
              {fr ? 'EN' : 'FR'}
            </button>
          </div>

          <div className="win space-y-4 p-5">
            <div className="space-y-1">
              <h1 className="m-0 text-base font-bold">
                {isMulti
                  ? fr
                    ? 'Votre bureau de tournée, prêt hors ligne.'
                    : 'Your touring desk, built for the road.'
                  : fr
                    ? 'Connexion à l’espace de tournée'
                    : 'Sign in to Tour Designer'}
              </h1>
              <p className="sub m-0 text-xs leading-relaxed">
                {isMulti
                  ? fr
                    ? `${planLabel} — Cloud synchronisé et Google Gemini AI inclus gratuitement pendant la bêta. Espace isolé par compte, fonctionne hors ligne sur iOS, Android, macOS, Windows et Linux.`
                    : `${planLabel} — Cloud sync and Google Gemini AI included free during beta. Isolated workspace per account, works offline on iOS, Android, macOS, Windows & Linux.`
                  : fr
                    ? 'Connectez-vous pour accéder aux feuilles de route et aux contacts.'
                    : 'Sign in to access your day sheets, crew contacts, and offline vault.'}
              </p>
            </div>

            {loginErr && <div className="warn text-xs">{loginErr}</div>}

            {isMulti && (
              <label className="flex cursor-pointer items-start gap-2 text-xs leading-snug">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={consentChecked}
                  onChange={(e) => setConsentChecked(e.target.checked)}
                />
                <span className="sub">
                  {fr ? (
                    <>
                      Je confirme avoir 18 ans ou plus et j’accepte les{' '}
                      <button type="button" className="underline" style={{ background: 'none', border: 0, padding: 0, color: 'inherit', cursor: 'pointer' }} onClick={() => navigate('/legal/terms')}>
                        Conditions d’utilisation
                      </button>{' '}
                      et l’
                      <button type="button" className="underline" style={{ background: 'none', border: 0, padding: 0, color: 'inherit', cursor: 'pointer' }} onClick={() => navigate('/legal/privacy')}>
                        Avis de confidentialité (RGPD / US / Mexique)
                      </button>
                      .
                    </>
                  ) : (
                    <>
                      I confirm I am 18+ and accept the{' '}
                      <button type="button" className="underline" style={{ background: 'none', border: 0, padding: 0, color: 'inherit', cursor: 'pointer' }} onClick={() => navigate('/legal/terms')}>
                        Terms of Service
                      </button>{' '}
                      and{' '}
                      <button type="button" className="underline" style={{ background: 'none', border: 0, padding: 0, color: 'inherit', cursor: 'pointer' }} onClick={() => navigate('/legal/privacy')}>
                        Privacy Notice (GDPR / US / Mexico)
                      </button>
                      .
                    </>
                  )}
                </span>
              </label>
            )}

            {googleEnabled && (
              <button
                type="button"
                className="btn btn--def w-full justify-center gap-2"
                style={{ minHeight: 38, fontSize: 13.5, fontWeight: 700 }}
                disabled={isMulti && !consentChecked}
                onClick={() => {
                  window.location.assign(withBase(`/api/auth/google/start?consent=${consentChecked ? '1' : '0'}`));
                }}
              >
                <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0" aria-hidden="true">
                  <path fill="#4285F4" d="M23.49 12.27c0-.79-.07-1.54-.19-2.27H12v4.51h6.47a5.54 5.54 0 0 1-2.4 3.63v3h3.88c2.27-2.09 3.54-5.17 3.54-8.87Z" />
                  <path fill="#34A853" d="M12 24c3.24 0 5.95-1.07 7.94-2.91l-3.88-3c-1.07.72-2.44 1.15-4.06 1.15-3.12 0-5.77-2.11-6.72-4.95H1.28v3.1A12 12 0 0 0 12 24Z" />
                  <path fill="#FBBC05" d="M5.28 14.29A7.22 7.22 0 0 1 4.9 12c0-.79.14-1.56.38-2.29V6.61H1.28A12 12 0 0 0 0 12c0 1.94.46 3.77 1.28 5.39l4-3.1Z" />
                  <path fill="#EA4335" d="M12 4.77c1.76 0 3.34.61 4.58 1.8l3.44-3.44C17.95 1.19 15.24 0 12 0A12 12 0 0 0 1.28 6.61l4 3.1C6.23 6.88 8.88 4.77 12 4.77Z" />
                </svg>
                {fr ? 'Continuer avec Google' : 'Continue with Google'}
              </button>
            )}

            {emailPasswordEnabled && (
              <form onSubmit={handleEmailAuthSubmit} className="space-y-2.5 border-t border-[var(--cv-line)] pt-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="lab">
                    {fr ? 'Ou avec email & mot de passe' : 'Or with email & password'}
                  </span>
                  <div className="segs" role="tablist" aria-label={fr ? 'Mode email' : 'Email auth mode'}>
                    <button
                      type="button"
                      role="tab"
                      aria-selected={authMode === 'signin'}
                      className={`seg${authMode === 'signin' ? ' seg--on' : ''}`}
                      style={{ minHeight: 22, padding: '1px 8px', fontSize: 11 }}
                      onClick={() => {
                        setAuthMode('signin');
                        setLoginErr(null);
                      }}
                    >
                      {fr ? 'Se connecter' : 'Sign in'}
                    </button>
                    <button
                      type="button"
                      role="tab"
                      aria-selected={authMode === 'signup'}
                      className={`seg${authMode === 'signup' ? ' seg--on' : ''}`}
                      style={{ minHeight: 22, padding: '1px 8px', fontSize: 11 }}
                      onClick={() => {
                        setAuthMode('signup');
                        setLoginErr(null);
                      }}
                    >
                      {fr ? 'Créer un compte' : 'Create account'}
                    </button>
                  </div>
                </div>

                {authMode === 'signup' && (
                  <label className="block space-y-1">
                    <span className="lab">{fr ? 'Nom / Projet' : 'Name / Artist or Team'}</span>
                    <input
                      type="text"
                      className="in"
                      placeholder={fr ? 'Ex: Alex · Tour Manager' : 'e.g. Alex · Tour Manager'}
                      value={nameInput}
                      onChange={(e) => setNameInput(e.target.value)}
                      autoComplete="name"
                    />
                  </label>
                )}

                <label className="block space-y-1">
                  <span className="lab">Email</span>
                  <input
                    type="email"
                    className="in"
                    placeholder="you@example.com"
                    value={emailInput}
                    onChange={(e) => setEmailInput(e.target.value)}
                    autoComplete="email"
                    required
                  />
                </label>

                <label className="block space-y-1">
                  <span className="lab">
                    {copy.password}
                    {authMode === 'signup' ? (fr ? ' (8+ car.)' : ' (8+ chars)') : ''}
                  </span>
                  <input
                    type="password"
                    className="in"
                    value={emailPasswordInput}
                    onChange={(e) => setEmailPasswordInput(e.target.value)}
                    autoComplete={authMode === 'signup' ? 'new-password' : 'current-password'}
                    minLength={authMode === 'signup' ? 8 : undefined}
                    required
                  />
                </label>

                <button
                  type="submit"
                  className={googleEnabled ? 'btn w-full justify-center' : 'btn btn--def w-full justify-center'}
                  disabled={authMode === 'signup' && !consentChecked}
                >
                  {authMode === 'signup'
                    ? fr
                      ? 'Créer mon espace gratuit'
                      : 'Create free workspace'
                    : fr
                      ? 'Se connecter par email'
                      : 'Sign in with email'}
                </button>
              </form>
            )}

            {passwordEnabled && (
              <form onSubmit={handleLogin} className="space-y-2.5 border-t border-[var(--cv-line)] pt-3">
                <label className="block space-y-1">
                  <span className="lab">{copy.password}</span>
                  <input
                    type="password"
                    className="in"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoFocus={!googleEnabled}
                    required
                  />
                </label>
                <button type="submit" className={googleEnabled ? 'btn w-full' : 'btn btn--def w-full'}>
                  {copy.enter}
                </button>
              </form>
            )}

            <div className="border-t border-[var(--cv-line)] pt-2.5">
              {!showKeyForm ? (
                <button
                  type="button"
                  className="sub text-xs underline"
                  style={{ background: 'none', border: 0, padding: 0, cursor: 'pointer' }}
                  onClick={() => setShowKeyForm(true)}
                >
                  {fr ? 'Vous avez une clé d’accès équipe ?' : 'Have a team access key?'}
                </button>
              ) : (
                <form onSubmit={handleTeamKeySubmit} className="flex gap-1.5">
                  <input
                    className="in mono flex-1"
                    placeholder={fr ? 'Coller la clé d’accès…' : 'Paste team access key…'}
                    value={teamKeyInput}
                    onChange={(e) => setTeamKeyInput(e.target.value)}
                    autoFocus
                  />
                  <button type="submit" className="btn btn--def">
                    {fr ? 'Entrer' : 'Sign in'}
                  </button>
                </form>
              )}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--cv-line)] pt-2.5 text-[11px] sub">
              <span>{fr ? 'Zéro cookie publicitaire · Export & suppression en 1 clic' : 'Zero tracking cookies · 1-click export & deletion'}</span>
              <div className="flex gap-2">
                <button type="button" className="underline" style={{ background: 'none', border: 0, padding: 0, color: 'inherit', cursor: 'pointer' }} onClick={() => navigate('/legal/terms')}>
                  {fr ? 'Conditions' : 'Terms'}
                </button>
                <button type="button" className="underline" style={{ background: 'none', border: 0, padding: 0, color: 'inherit', cursor: 'pointer' }} onClick={() => navigate('/legal/privacy')}>
                  {fr ? 'Confidentialité' : 'Privacy'}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Dedicated Print View (/print?gig=...&preset=day|driver|internal)
  if (path === '/print') {
    const params = new URLSearchParams(search);
    const gid = params.get('gig') || lastGigId || sync.gigs[0]?.id || '';
    const preset = (params.get('preset') as 'day' | 'driver' | 'internal') || 'day';
    const printGig = sync.gigs.find((g) => g.id === gid) || sync.gigs[0];
    if (printGig) {
      return (
        <Suspense fallback={<div className="dk-root items-center justify-center text-[var(--cv-on-desk)]">Loading…</div>}>
          <PrintPage
            gig={printGig}
            items={sync.itemsByGig[printGig.id] || []}
            people={sync.people}
            user={user}
            locale={locale}
            initialLayout={preset}
            onBack={() => navigate(`/gig/${printGig.id}`)}
          />
        </Suspense>
      );
    }
  }

  const tabTitle = activeGig
    ? activeGig.city || activeGig.name || 'Date'
    : path === '/calendar' || path === '/calendar-view'
      ? copy.calendar
      : path === '/contacts' || path === '/rolodex'
        ? copy.contacts
        : path === '/files'
          ? fr ? 'Documents' : 'Files'
          : path === '/sync'
            ? fr ? 'Enregistrement' : 'Saving'
            : path === '/admin'
              ? fr ? 'Admin Plateforme' : 'Platform Admin'
              : path === '/trash'
              ? fr ? 'Dates retirées' : 'Removed dates'
              : path === '/settings'
                ? copy.settings
                : fr ? 'Tout le tour' : 'Whole tour';

  async function onCityType(val: string) {
    setNCity(val);
    if (val.trim().length >= 2) {
      const r = await api.searchCities(val).catch(() => ({ cities: [] }));
      setCitySug(r.cities.slice(0, 5));
    } else setCitySug([]);
  }

  async function handleCreateGig(e: React.FormEvent) {
    e.preventDefault();
    const resolvedArtistId =
      nArtistId ||
      (activeProjectId !== 'all' ? activeProjectId : '') ||
      (user?.artist_ids?.length === 1 ? user.artist_ids[0] : '') ||
      undefined;
    const { gig } = await api.createGig({
      artist_id: resolvedArtistId,
      date: nDate,
      city: nCity,
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
    setNArtistId('');
    await sync.refreshFull();
    navigate(`/gig/${gig.id}`);
  }

  const openNewOnDate = (isoDate: string) => {
    setNDate(isoDate);
    setNewOpen(true);
  };

  return (
    <div
      className="dk-root"
      onDragOver={(e) => {
        if (user.role !== 'viewer' && path !== '/files' && e.dataTransfer.types.includes('Files')) e.preventDefault();
      }}
      onDrop={(e) => {
        if (user.role === 'viewer' || path === '/files' || !e.dataTransfer.files.length) return;
        e.preventDefault();
        setPasteReq({ gigId: activeGig?.id || lastGigId, files: Array.from(e.dataTransfer.files) });
      }}
    >
      <div className="dk-page">
        {/* Left BeOS Deskbar (exact prod layout) */}
        <Deskbar
          path={path}
          gigs={visibleGigs}
          allGigsCount={sync.gigs.filter((g) => !g.archived && !g.deleted_at).length}
          projects={projects}
          activeProjectId={activeProjectId}
          onSelectProject={(pid) => {
            setActiveProjectId(pid);
            if (pid !== 'all' && activeGig && activeGig.artist_id !== pid) {
              const firstInProj = sync.gigs.find((g) => !g.archived && !g.deleted_at && g.artist_id === pid);
              navigate(firstInProj ? `/gig/${firstInProj.id}` : '/tour');
            }
          }}
          selectedGigId={activeGig?.id || ''}
          onSitePeople={onSitePeople}
          clock={clock}
          locale={locale}
          user={user}
          copy={copy}
          sync={sync}
          toolsOpen={toolsOpen}
          onToggleTools={() => setToolsOpen((v) => !v)}
          onNavigate={(to) => {
            setToolsOpen(false);
            navigate(to);
          }}
          onSearch={() => {
            setSearchOpen(true);
            setSearchIdx(0);
          }}
          onNewDate={() => setNewOpen(true)}
          onOpenPaste={() => setPasteReq({ gigId: activeGig?.id || lastGigId })}
          onOpenCommunityShare={authMeta?.community?.enabled ? () => setCommunityModal('invite') : undefined}
        />

        {/* Right Main BeOS Window (Yellow Tab + Bevelled Frame) */}
        <main className="dk-main">
          <div className="dk-tabrow">
            <h1 className="ytab" style={{ margin: '0 0 -1px -1px' }}>
              {activeGig ? (
                <button type="button" className="box" title={fr ? 'Retour au tour' : 'Back to tour'} onClick={() => navigate('/tour')} />
              ) : (
                <span className="box" />
              )}
              <span className="truncate">{tabTitle}</span>
              {activeGig?.venue && <span className="dk-venue truncate">{activeGig.venue}</span>}
            </h1>

            {/* 2032 Handheld Top Hardware Telemetry Tray (mobile only) */}
            <div className="m2032-tray no-print">
              <span className="m2032-tray__clock mono">
                <i className={`dk-online${sync.online ? '' : ' dk-online--off'}`} />
                {clock}
              </span>
              <button
                type="button"
                className="m2032-tray__btn"
                aria-label={fr ? 'Rechercher' : 'Search'}
                onClick={() => {
                  setSearchOpen(true);
                  setSearchIdx(0);
                }}
              >
                <Search className="h-3.5 w-3.5" />
              </button>
              {user.role !== 'viewer' && (
                <button
                  type="button"
                  className="m2032-tray__btn m2032-tray__btn--ai"
                  aria-label={fr ? 'Importer (AI)' : 'Paste / AI Import'}
                  onClick={() => setPasteReq({ gigId: activeGig?.id || lastGigId })}
                >
                  <Sparkles className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          </div>

          <div className="win">
            {showFirstDayChecklist && (
              <Suspense fallback={null}>
                <FirstDayChecklist
                  user={user}
                  locale={locale}
                  hasMcp={hasMcpConnected}
                  gigsCount={nonDeletedGigsCount}
                  filesCount={sync.files.length}
                  onConnectMcp={() => {
                    navigate('/settings#mcp');
                    window.setTimeout(() => {
                      document.getElementById('mcp')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                    }, 120);
                  }}
                  onOpenPaste={() => setPasteReq({ gigId: activeGig?.id || lastGigId || '__new__' })}
                  onOpenFiles={() => navigate('/files')}
                  onDismiss={dismissFirstDayChecklist}
                />
              </Suspense>
            )}
            <Suspense fallback={<div className="flex flex-1 items-center justify-center p-6 sub">Loading…</div>}>
              {activeGig ? (
                <DayPage
                  gig={activeGig}
                  items={activeItems}
                  allGigs={visibleGigs}
                  allItemsByGig={sync.itemsByGig}
                  people={sync.people}
                  projects={projects}
                  user={user}
                  locale={locale}
                  copy={copy}
                  sync={sync}
                  onNavigate={navigate}
                  onOpenFile={(fid) => {
                    setPreviewFileId(fid);
                    navigate('/files');
                  }}
                />
              ) : path === '/calendar' || path === '/calendar-view' ? (
                <CalendarPage
                  gigs={visibleGigs}
                  itemsByGig={sync.itemsByGig}
                  selectedGigId={lastGigId}
                  locale={locale}
                  onOpenGig={(id) => navigate(`/gig/${id}`)}
                  onCreateGigOnDate={user.role !== 'viewer' ? openNewOnDate : undefined}
                />
              ) : path === '/contacts' || path === '/rolodex' ? (
                <ContactsPage
                  people={sync.people}
                  gigs={visibleGigs}
                  itemsByGig={sync.itemsByGig}
                  files={visibleFiles}
                  user={user}
                  locale={locale}
                  copy={copy}
                  onRefresh={sync.refreshFull}
                  onOpenGig={(id) => navigate(`/gig/${id}`)}
                  onOpenFile={(fid) => {
                    setPreviewFileId(fid);
                    navigate('/files');
                  }}
                />
              ) : path === '/files' ? (
                <FilesPage
                  files={visibleFiles}
                  gigs={visibleGigs}
                  people={sync.people}
                  user={user}
                  locale={locale}
                  initialPreviewFileId={previewFileId}
                  onRefresh={sync.refreshFull}
                  onOpenGig={(id) => navigate(`/gig/${id}`)}
                />
              ) : path === '/sync' ? (
                <SyncPage
                  gigs={visibleGigs}
                  initialGigId={lastGigId}
                  user={user}
                  locale={locale}
                  sync={sync}
                  onOpenGig={(id) => navigate(`/gig/${id}`)}
                />
              ) : path === '/trash' ? (
                <TrashPage gigs={visibleGigs} user={user} locale={locale} onRefresh={sync.refreshFull} />
              ) : path === '/admin' && authMeta?.is_platform_admin ? (
                <AdminDashboardPage locale={locale} />
              ) : path === '/settings' ? (
                <SettingsPage
                  user={user}
                  locale={locale}
                  skin={skin}
                  uiScale={uiScale}
                  copy={copy}
                  sync={sync}
                  projects={projects}
                  hostedUsage={authMeta?.hosted_usage || null}
                  community={authMeta?.community || null}
                  updateStatus={updateStatus}
                  onRefreshUpdate={async () => {
                    const res = await api.checkUpdate(true);
                    setUpdateStatus(res);
                  }}
                  onOpenCommunityShare={authMeta?.community?.enabled ? () => setCommunityModal('invite') : undefined}
                  onMcpConnected={() => setMcpConnectedLocal(true)}
                  onRefreshProjects={refreshProjects}
                  onNavigate={navigate}
                  onLocale={setLocale}
                  onSkin={setSkin}
                  onScale={setUiScale}
                  onLogout={handleLogout}
                />
              ) : (
                <TourPage
                  gigs={visibleGigs}
                  itemsByGig={sync.itemsByGig}
                  user={user}
                  locale={locale}
                  copy={copy}
                  sync={sync}
                  onOpenGig={(id) => navigate(`/gig/${id}`)}
                  onNewDate={() => setNewOpen(true)}
                />
              )}
            </Suspense>

            {/* Prod DeskTools Bottom Panel inside the Main Window */}
            {toolsOpen && (
              <section className="dk-tools" aria-label={fr ? 'Outils' : 'Tools'}>
                <div className="dk-tools__head">
                  <strong>{fr ? 'Outils' : 'Tools'}</strong>
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
                          {isNightActive ? (fr ? 'Jour' : 'Day') : fr ? 'Nuit' : 'Night'}
                        </button>
                      );
                    })()}
                    <button
                      type="button"
                      className="btn"
                      style={{ minHeight: 24, padding: '0 8px', fontSize: 11.5 }}
                      onClick={() => setLocale(locale === 'fr' ? 'en' : 'fr')}
                    >
                      {locale === 'fr' ? 'EN' : 'FR'}
                    </button>
                    <button type="button" className="btn" style={{ minHeight: 24, padding: '0 8px', fontSize: 11.5 }} onClick={() => setToolsOpen(false)}>
                      {fr ? 'Fermer' : 'Close'}
                    </button>
                  </div>
                </div>
                {authMeta?.is_platform_admin && (
                  <button type="button" className="item dk-tool" onClick={() => { setToolsOpen(false); navigate('/admin'); }}>
                    <b style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                      {fr ? 'Admin Plateforme' : 'Platform Admin'}
                      <span
                        className="mono"
                        style={{
                          fontSize: 10,
                          fontWeight: 700,
                          padding: '1px 5px',
                          border: '1px solid var(--cv-y1)',
                          color: 'var(--cv-y1)',
                        }}
                      >
                        OPS
                      </span>
                    </b>
                    <span className="sub">{fr ? 'Utilisateurs, quotas IA/stockage, analytics et support' : 'Users, AI/storage metering, analytics & support'}</span>
                  </button>
                )}
                <button type="button" className="item dk-tool" onClick={() => { setToolsOpen(false); navigate('/settings'); }}>
                  <b style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    {fr ? 'Réglages' : 'Settings'}
                    {updateStatus?.update_available && (
                      <span
                        className="mono"
                        style={{
                          fontSize: 10,
                          fontWeight: 700,
                          padding: '1px 5px',
                          background: 'var(--cv-ylo)',
                          color: '#111',
                          borderRadius: 2,
                        }}
                      >
                        {fr ? 'MAJ' : 'UPDATE'}
                      </span>
                    )}
                  </b>
                  <span className="sub">{fr ? 'Langue, thème, taille du texte, équipe & clés MCP, audit' : 'Language, theme, text size, team & MCP keys, audit'}</span>
                </button>
                {user.role !== 'viewer' && (
                  <>
                    <button type="button" className="item dk-tool" onClick={() => { setToolsOpen(false); navigate('/sync'); }}>
                      <b>{fr ? 'Enregistrement & Historique' : 'Saving & History'}</b>
                      <span className="sub">{fr ? 'File hors ligne IndexedDB, conflits et retour arrière par lot' : 'IndexedDB offline queue, conflicts & batch undo'}</span>
                    </button>
                    <button type="button" className="item dk-tool" onClick={() => { setToolsOpen(false); navigate('/trash'); }}>
                      <b>{fr ? 'Dates retirées' : 'Removed dates'}</b>
                      <span className="sub">{fr ? 'Corbeille (restaurer / détruire) et archives' : 'Trash (restore / destroy) and archive'}</span>
                    </button>
                    <button type="button" className="item dk-tool" onClick={() => { setToolsOpen(false); setPasteReq({ gigId: activeGig?.id || lastGigId }); }}>
                      <b>{fr ? 'Coller / Importer (AI Intake)' : 'Paste / Import (AI Intake)'}</b>
                      <span className="sub">{fr ? 'Extraire vols, hôtels, horaires ou fichiers d’un email ou PDF' : 'Extract flights, hotels, schedules or files from email/PDF'}</span>
                    </button>
                  </>
                )}
                {(activeGig || lastGigId || sync.gigs[0]) && (
                  <button
                    type="button"
                    className="item dk-tool"
                    onClick={() => {
                      setToolsOpen(false);
                      navigate(`/print?gig=${encodeURIComponent(activeGig?.id || lastGigId || sync.gigs[0].id)}`);
                    }}
                  >
                    <b>{fr ? 'Imprimer la feuille de route' : 'Print roadsheet'}</b>
                    <span className="sub">{fr ? 'Mise en page A4 : Journée · Chauffeur · Interne' : 'A4 layouts: Day sheet · Driver card · Internal pack'}</span>
                  </button>
                )}
              </section>
            )}
          </div>
        </main>
      </div>

      {/* Mobile / Narrow 2032 BeOS Hardware Bottom Dock */}
      <nav className="dk-dock no-print" aria-label="Navigation">
        <button
          type="button"
          className={`dock${path === '/' || path === '/tour' || path.startsWith('/gig/') ? ' dock--on' : ''}`}
          onClick={() => {
            setToolsOpen(false);
            navigate(path.startsWith('/gig/') ? '/tour' : lastGigId && path !== '/tour' ? `/gig/${lastGigId}` : '/tour');
          }}
        >
          <CalendarDays className="h-4 w-4" />
          <span>Dates</span>
        </button>
        <button
          type="button"
          className={`dock${path === '/calendar' || path === '/calendar-view' ? ' dock--on' : ''}`}
          onClick={() => { setToolsOpen(false); navigate('/calendar-view'); }}
        >
          <Calendar className="h-4 w-4" />
          <span>{fr ? 'Cal.' : 'Cal'}</span>
        </button>
        {user.role !== 'viewer' && (
          <>
            <button
              type="button"
              className={`dock${path === '/files' ? ' dock--on' : ''}`}
              onClick={() => { setToolsOpen(false); navigate('/files'); }}
            >
              <FolderOpen className="h-4 w-4" />
              <span>Docs</span>
            </button>
            <button
              type="button"
              className={`dock${path === '/rolodex' || path === '/contacts' ? ' dock--on' : ''}`}
              onClick={() => { setToolsOpen(false); navigate('/rolodex'); }}
            >
              <Users className="h-4 w-4" />
              <span>{copy.contacts}</span>
            </button>
          </>
        )}
        <button
          type="button"
          className={`dock${toolsOpen || path === '/settings' || path === '/sync' || path === '/trash' ? ' dock--on' : ''}`}
          style={{ position: 'relative' }}
          onClick={() => setToolsOpen((v) => !v)}
        >
          <SlidersHorizontal className="h-4 w-4" />
          <span>{fr ? 'Outils' : 'Tools'}</span>
          {updateStatus?.update_available && (
            <span
              aria-label={fr ? 'Mise à jour disponible' : 'Update available'}
              style={{
                position: 'absolute',
                top: 6,
                right: 8,
                width: 7,
                height: 7,
                borderRadius: '50%',
                background: 'var(--cv-ylo)',
                boxShadow: '0 0 0 1.5px var(--cv-chrome)',
              }}
            />
          )}
        </button>
      </nav>

      {/* BeOS Omnibar Search Window (/ or ⌘K) */}
      {searchOpen && (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/45 p-4 pt-14" onClick={() => setSearchOpen(false)}>
          <div className="w-full max-w-lg" onClick={(e) => e.stopPropagation()}>
            <div className="ytab">
              <button type="button" className="box" onClick={() => setSearchOpen(false)} />
              <span>{fr ? 'Rechercher · Dates, Contacts, Vols, Fichiers, Actions' : 'Search · Dates, Contacts, Flights, Files, Actions'}</span>
            </div>
            <div className="win">
              <div className="border-b border-[var(--cv-line2)] p-2">
                <input
                  className="in"
                  value={searchQuery}
                  onChange={(e) => {
                    setSearchQuery(e.target.value);
                    setSearchIdx(0);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'ArrowDown') {
                      e.preventDefault();
                      setSearchIdx((i) => Math.min(omnibarHits.length - 1, i + 1));
                    } else if (e.key === 'ArrowUp') {
                      e.preventDefault();
                      setSearchIdx((i) => Math.max(0, i - 1));
                    } else if (e.key === 'Enter' && omnibarHits[searchIdx]) {
                      e.preventDefault();
                      omnibarHits[searchIdx].run();
                    }
                  }}
                  placeholder={fr ? 'Ville, salle, contact, vol, hôtel, fichier ou commande…' : 'City, venue, contact, flight, hotel, file, or command…'}
                  autoFocus
                />
              </div>
              <div className="max-h-80 overflow-y-auto bg-[var(--cv-paper)]">
                {omnibarHits.length === 0 ? (
                  <div className="sub p-3">{fr ? 'Aucun résultat.' : 'No results.'}</div>
                ) : (
                  omnibarHits.map((h, i) => (
                    <button
                      key={h.id}
                      type="button"
                      className={`day${i === searchIdx ? ' day--on' : ''}`}
                      style={{ gridTemplateColumns: '80px minmax(0, 1fr) auto' }}
                      onMouseEnter={() => setSearchIdx(i)}
                      onClick={h.run}
                    >
                      <span className="lab">{h.group}</span>
                      <span className="truncate"><b>{h.label}</b></span>
                      <span className="sub truncate" style={{ maxWidth: 180 }}>{h.sub}</span>
                    </button>
                  ))
                )}
              </div>
              <div className="sqa-foot" style={{ borderTop: '1px solid var(--cv-line2)' }}>
                <span className="sub" style={{ fontSize: 11 }}>
                  {fr ? 'Navigation rapide dans tout le tour' : 'Quick jump across the entire tour'}
                </span>
                <span className="sqa-foot-keys">
                  <kbd>↑↓</kbd>
                  <kbd>⏎</kbd>
                  <kbd>Esc</kbd>
                </span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Universal AI Paste / Drop Intake Window */}
      {pasteReq && (
        <Suspense fallback={null}>
          <PasteWindow
            gigs={sync.gigs}
            initialGigId={pasteReq.gigId}
            initialText={pasteReq.text}
            initialFiles={pasteReq.files}
            locale={locale}
            onClose={() => setPasteReq(null)}
            onApplied={async (gid) => {
              await sync.refreshFull();
              navigate(`/gig/${gid}`);
            }}
          />
        </Suspense>
      )}

      {/* BeOS Nouvelle Date Window */}
      {newOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4">
          <div className="w-full max-w-md">
            <div className="ytab">
              <button type="button" className="box" onClick={() => setNewOpen(false)} />
              <span>{copy.newDate}</span>
            </div>
            <form onSubmit={handleCreateGig} className="win space-y-2.5 p-3">
              {projects.length > 0 && (
                <label className="block space-y-1">
                  <span className="lab">{fr ? 'Projet / Artiste' : 'Project / Artist'}</span>
                  <select
                    className="in"
                    value={nArtistId || (activeProjectId !== 'all' ? activeProjectId : '')}
                    onChange={(e) => setNArtistId(e.target.value)}
                  >
                    {(!user.artist_ids || user.artist_ids.length === 0) && (
                      <option value="">{fr ? '— Aucun projet assigné —' : '— Unassigned —'}</option>
                    )}
                    {projects.map((p) => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                </label>
              )}
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
                <input className="in" value={nCity} onChange={(e) => void onCityType(e.target.value)} placeholder="Paris, Berlin, Mexico City…" />
                {citySug.length > 0 && (
                  <div className="win absolute z-10 mt-1 w-full bg-[var(--cv-paper)]">
                    {citySug.map((s) => (
                      <button
                        key={`${s.city}-${s.country}`}
                        type="button"
                        className="day"
                        style={{ gridTemplateColumns: 'minmax(0, 1fr) auto' }}
                        onClick={() => { setNCity(s.city); setNCountry(s.country); setNTz(s.timezone); setCitySug([]); }}
                      >
                        <span>{s.city}, {s.country}</span>
                        <span className="mono sub">{s.timezone}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <div className="grid grid-cols-2 gap-2">
                <label className="space-y-1"><span className="lab">{fr ? 'Lieu' : 'Venue'}</span><input className="in" value={nVenue} onChange={(e) => setNVenue(e.target.value)} placeholder="Rex Club" /></label>
                <label className="space-y-1"><span className="lab">Set</span><input className="in mono" value={nSet} onChange={(e) => setNSet(e.target.value)} placeholder={fr ? '02h00' : '02:00'} /></label>
              </div>
              <div className="flex justify-between gap-2 border-t border-[var(--cv-line2)] pt-2">
                <button
                  type="button"
                  className="btn"
                  onClick={() => {
                    setNewOpen(false);
                    setPasteReq({ gigId: '__new__' });
                  }}
                >
                  ✨ {fr ? 'Depuis un texte / PDF' : 'From text / PDF'}
                </button>
                <div className="flex gap-2">
                  <button type="button" className="btn" onClick={() => setNewOpen(false)}>{copy.cancel}</button>
                  <button type="submit" className="btn btn--def">{copy.save}</button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* BeOS 409 Conflict Window */}
      {conflicts[0] && conflicts[0].id !== undefined && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-lg">
            <div className="ytab">
              <span className="box" />
              <span>{copy.conflictTitle}</span>
            </div>
            <div className="win space-y-3 p-3">
              <p className="m-0 text-xs">{copy.conflictDesc}</p>
              <div className="grid grid-cols-2 gap-2">
                <pre className="mono m-0 max-h-40 overflow-auto border border-[var(--cv-line2)] bg-[var(--cv-paper)] p-2 text-xs">{JSON.stringify(conflicts[0].payload, null, 2)}</pre>
                <pre className="mono m-0 max-h-40 overflow-auto border border-[var(--cv-line2)] bg-[var(--cv-paper)] p-2 text-xs">{JSON.stringify(conflicts[0].conflict_current, null, 2)}</pre>
              </div>
              <div className="flex justify-end gap-2">
                <button type="button" className="btn" onClick={() => void sync.resolveConflict(conflicts[0].id!, 'server')}>{copy.keepServer}</button>
                <button type="button" className="btn btn--def" onClick={() => void sync.resolveConflict(conflicts[0].id!, 'mine')}>{copy.keepMine}</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Community 7-gig confetti celebration & invite / Bitcoin tip modal */}
      {communityModal && authMeta?.community && (
        <Suspense fallback={null}>
          <CommunityShareModal
            mode={communityModal}
            gigsCount={nonDeletedGigsCount}
            community={authMeta.community}
            locale={locale}
            onClose={closeCommunityModal}
          />
        </Suspense>
      )}
    </div>
  );
}
