import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react';
import { api } from '../api/client';
import { fileAssetUrl } from '../lib/basePath';
import type { FileRecord, Gig, Locale, Person, User } from '../types';

interface Props {
  files: FileRecord[];
  gigs: Gig[];
  people: Person[];
  user: User;
  locale: Locale;
  initialPreviewFileId?: string | null;
  onRefresh: () => Promise<void>;
  onOpenGig: (id: string) => void;
}

type ViewMode = 'liste' | 'grille';
type FileKind = 'pdf' | 'image' | 'doc' | 'autre';
type ScopeFilter = 'all' | 'crew' | 'private';
type SortMode = 'pertinence' | 'recent' | 'nom' | 'taille' | 'gig';

const VIEW_KEY = 'td:v2:files:view';

const strip = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

function getFileKind(f: FileRecord): FileKind {
  const m = (f.mime || '').toLowerCase();
  const n = (f.name || '').toLowerCase();
  if (m.includes('pdf') || n.endsWith('.pdf')) return 'pdf';
  if (m.startsWith('image/') || /\.(png|jpe?g|webp|gif|heic)$/.test(n)) return 'image';
  if (/\.(docx?|xlsx?|csv|txt|rtf|pptx?|md)$/.test(n) || m.includes('word') || m.includes('sheet') || m.startsWith('text/')) {
    return 'doc';
  }
  return 'autre';
}

function smartCategory(f: FileRecord, fr = false): string {
  const dk = (f.doc_kind || '').toLowerCase();
  if (dk === 'boarding_pass' || dk === 'flight' || dk === 'ticket') return fr ? 'Billets' : 'Boarding Passes';
  if (dk === 'hotel' || dk === 'voucher') return fr ? 'Hôtels' : 'Hotel Vouchers';
  if (dk === 'passport') return fr ? 'Passeports' : 'Passports';
  if (dk === 'visa' || dk === 'permit') return fr ? 'Visas & Permis' : 'Visas & Permits';
  if (dk === 'pass' || dk === 'aaa' || dk === 'credential') return fr ? 'Accréditations AAA' : 'AAA Credentials';
  if (dk === 'rider' || dk === 'stageplot') return 'Rider & Tech';
  if (dk === 'settlement' || dk === 'contract') return fr ? 'Contrats & Cachets' : 'Deals & Settlements';
  if (f.doc_kind) return f.doc_kind;
  const hay = strip(`${f.name}`);
  if (/boarding|embarquement|billet|ticket|flight|vol|eticket|e-ticket|train|eurostar|sncf/.test(hay)) return fr ? 'Billets' : 'Boarding Passes';
  if (/hotel|voucher|check-?in|reservation|booking/.test(hay)) return fr ? 'Hôtels' : 'Hotel Vouchers';
  if (/rider|tech|stage|patch|input|plot|backline/.test(hay)) return 'Rider & Tech';
  if (/contract|contrat|invoice|facture|deal|devis|fee|rib|settlement/.test(hay)) return fr ? 'Contrats & Cachets' : 'Deals & Settlements';
  if (/passport|passeport/.test(hay)) return fr ? 'Passeports' : 'Passports';
  if (/visa|permit|coe|identite|carte/.test(hay)) return fr ? 'Visas & Permis' : 'Visas & Permits';
  if (/aaa|credential|laminate|wristband/.test(hay)) return fr ? 'Accréditations AAA' : 'AAA Credentials';
  if (/lineup|timetable|running|schedule|roadsheet|feuille/.test(hay)) return fr ? 'Feuilles de route' : 'Roadsheets';
  return fr ? 'Autres' : 'Other';
}

function isTravelDoc(f: FileRecord): boolean {
  const dk = (f.doc_kind || '').toLowerCase();
  return dk === 'boarding_pass' || dk === 'hotel' || smartCategory(f, false) === 'Boarding Passes';
}

function formatBytes(n: number): string {
  if (!n) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function expiryState(iso?: string | null): 'expired' | 'soon' | 'ok' | 'none' {
  if (!iso || !/^\d{4}-\d{2}-\d{2}/.test(iso)) return 'none';
  const today = new Date().toISOString().slice(0, 10);
  if (iso < today) return 'expired';
  const soon = new Date(Date.now() + 90 * 864e5).toISOString().slice(0, 10);
  return iso <= soon ? 'soon' : 'ok';
}

function FileGlyph({ kind }: { kind: FileKind }) {
  const label = kind === 'pdf' ? 'PDF' : kind === 'image' ? 'IMG' : kind === 'doc' ? 'DOC' : 'FILE';
  return (
    <span className="pf-glyph mono" data-kind={kind}>
      {label}
    </span>
  );
}

export function FilesPage({ files, gigs, people, user, locale, initialPreviewFileId, onRefresh, onOpenGig }: Props) {
  const fr = locale === 'fr';
  const canEdit = user.role !== 'viewer';
  const isOwner = user.role === 'owner';
  const today = new Date().toISOString().slice(0, 10);

  const [query, setQuery] = useState('');
  const [library, setLibrary] = useState<string>('all'); // all | current | week | cat:X | person:ID
  const [viewMode, setViewMode] = useState<ViewMode>(() => (localStorage.getItem(VIEW_KEY) === 'liste' ? 'liste' : 'grille'));
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [gigFilter, setGigFilter] = useState('');
  const [kindFilter, setKindFilter] = useState<FileKind | 'all'>('all');
  const [scopeFilter, setScopeFilter] = useState<ScopeFilter>('all');
  const [sortMode, setSortMode] = useState<SortMode>('pertinence');

  // Batch selection
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());

  // Upload drawer
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadGigId, setUploadGigId] = useState('');
  const [uploadPersonId, setUploadPersonId] = useState('');
  const [uploadCat, setUploadCat] = useState('');
  const [uploadExpires, setUploadExpires] = useState('');
  const [uploadScope, setUploadScope] = useState<'crew' | 'private'>('crew');
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  // QuickLook modal
  const [previewId, setPreviewId] = useState<string | null>(initialPreviewFileId || null);
  const [qlName, setQlName] = useState('');
  const [qlCat, setQlCat] = useState('');
  const [qlGigId, setQlGigId] = useState('');
  const [qlPersonId, setQlPersonId] = useState('');
  const [qlExpires, setQlExpires] = useState('');
  const [qlScope, setQlScope] = useState<'crew' | 'private'>('crew');
  const [qlSaving, setQlSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const flash = (msg: string) => {
    setNotice(msg);
    window.setTimeout(() => setNotice((prev) => (prev === msg ? null : prev)), 2600);
  };

  useEffect(() => {
    localStorage.setItem(VIEW_KEY, viewMode);
  }, [viewMode]);

  useEffect(() => {
    if (initialPreviewFileId) setPreviewId(initialPreviewFileId);
  }, [initialPreviewFileId]);

  const activeGigs = useMemo(
    () => gigs.filter((g) => !g.deleted_at).slice().sort((a, b) => a.date.localeCompare(b.date)),
    [gigs],
  );
  const gigsById = useMemo(() => new Map(activeGigs.map((g) => [g.id, g])), [activeGigs]);
  const peopleById = useMemo(() => new Map(people.map((p) => [p.id, p])), [people]);

  const operationalGigId = useMemo(() => {
    const next = activeGigs.find((g) => !g.archived && g.date >= today);
    return next?.id || activeGigs[0]?.id || '';
  }, [activeGigs, today]);

  const visiblePool = useMemo(
    () => (isOwner ? files : files.filter((f) => (f.scope || 'crew') !== 'private')),
    [files, isOwner],
  );

  // Category & Person facet counts
  const categoryCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const f of visiblePool) {
      const cat = smartCategory(f, fr);
      map.set(cat, (map.get(cat) || 0) + 1);
    }
    return [...map.entries()].sort((a, b) => b[1] - a[1]);
  }, [visiblePool, fr]);

  const personCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const f of visiblePool) {
      if (f.person_id) map.set(f.person_id, (map.get(f.person_id) || 0) + 1);
    }
    return [...map.entries()]
      .map(([id, count]) => ({ id, label: peopleById.get(id)?.name || id, count }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [visiblePool, peopleById]);

  const filtered = useMemo(() => {
    const terms = strip(query.trim()).split(/\s+/).filter(Boolean);
    const weekEnd = new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10);

    const list = visiblePool.filter((f) => {
      const g = f.gig_id ? gigsById.get(f.gig_id) : undefined;
      const p = f.person_id ? peopleById.get(f.person_id) : undefined;
      if (library === 'current' && f.gig_id !== operationalGigId) return false;
      if (library === 'week' && (!g?.date || g.date < today || g.date > weekEnd)) return false;
      if (library.startsWith('cat:') && smartCategory(f, fr) !== library.slice(4)) return false;
      if (library.startsWith('person:') && f.person_id !== library.slice(7)) return false;
      if (gigFilter && f.gig_id !== gigFilter) return false;
      if (kindFilter !== 'all' && getFileKind(f) !== kindFilter) return false;
      if (scopeFilter === 'crew' && f.scope === 'private') return false;
      if (scopeFilter === 'private' && f.scope !== 'private') return false;
      if (terms.length) {
        const blob = strip(`${f.name} ${smartCategory(f, fr)} ${g?.city || ''} ${g?.venue || ''} ${g?.date || ''} ${p?.name || ''}`);
        if (!terms.every((t) => blob.includes(t))) return false;
      }
      return true;
    });

    return list.slice().sort((a, b) => {
      if (sortMode === 'pertinence') {
        const td = (isTravelDoc(a) ? 0 : 1) - (isTravelDoc(b) ? 0 : 1);
        if (td !== 0) return td;
        return (b.added_at || '').localeCompare(a.added_at || '');
      }
      if (sortMode === 'recent') return (b.added_at || '').localeCompare(a.added_at || '');
      if (sortMode === 'nom') return a.name.localeCompare(b.name);
      if (sortMode === 'taille') return (b.size || 0) - (a.size || 0);
      const da = (a.gig_id && gigsById.get(a.gig_id)?.date) || '9999-99-99';
      const db = (b.gig_id && gigsById.get(b.gig_id)?.date) || '9999-99-99';
      return da.localeCompare(db);
    });
  }, [visiblePool, query, library, gigFilter, kindFilter, scopeFilter, sortMode, gigsById, peopleById, operationalGigId, today, fr]);

  const previewIndex = previewId ? filtered.findIndex((f) => f.id === previewId) : -1;
  const previewFile = previewIndex >= 0 ? filtered[previewIndex] : previewId ? visiblePool.find((f) => f.id === previewId) || null : null;

  // Sync QuickLook edit form when previewed file changes
  useEffect(() => {
    if (!previewFile) return;
    setQlName(previewFile.name);
    setQlCat(previewFile.doc_kind || '');
    setQlGigId(previewFile.gig_id || '');
    setQlPersonId(previewFile.person_id || '');
    setQlExpires(previewFile.doc_expires || '');
    setQlScope(previewFile.scope || 'crew');
  }, [previewFile?.id]);

  // QuickLook keyboard navigation
  useEffect(() => {
    if (!previewFile) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && ['INPUT', 'SELECT', 'TEXTAREA'].includes(target.tagName)) {
        if (e.key === 'Escape') setPreviewId(null);
        return;
      }
      if (e.key === 'Escape') setPreviewId(null);
      else if (e.key === 'ArrowRight' && previewIndex >= 0 && previewIndex < filtered.length - 1) {
        setPreviewId(filtered[previewIndex + 1].id);
      } else if (e.key === 'ArrowLeft' && previewIndex > 0) {
        setPreviewId(filtered[previewIndex - 1].id);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [previewFile, previewIndex, filtered]);

  const activeFilterCount =
    (library !== 'all' ? 1 : 0) +
    (gigFilter ? 1 : 0) +
    (kindFilter !== 'all' ? 1 : 0) +
    (scopeFilter !== 'all' ? 1 : 0) +
    (query.trim() ? 1 : 0);

  function resetFilters() {
    setQuery('');
    setLibrary('all');
    setGigFilter('');
    setKindFilter('all');
    setScopeFilter('all');
    searchRef.current?.focus();
  }

  async function uploadFiles(fileList: File[]) {
    if (!fileList.length || !canEdit) return;
    setUploading(true);
    try {
      const targetGig = uploadGigId || gigFilter || operationalGigId || undefined;
      for (const f of fileList) {
        await api.uploadFile(f, targetGig, {
          personId: uploadPersonId || undefined,
          docKind: uploadCat || undefined,
          docExpires: uploadExpires || undefined,
          scope: uploadScope,
        });
      }
      await onRefresh();
      setUploadOpen(false);
      flash(fr ? `${fileList.length} fichier(s) ajouté(s)` : `Uploaded ${fileList.length} file(s)`);
    } finally {
      setUploading(false);
    }
  }

  async function saveQuickLook() {
    if (!previewFile || !canEdit) return;
    setQlSaving(true);
    try {
      await api.updateFile(previewFile.id, {
        name: qlName.trim() || previewFile.name,
        doc_kind: qlCat.trim() || null,
        gig_id: qlGigId || null,
        person_id: qlPersonId || null,
        doc_expires: qlExpires.trim() || null,
        scope: qlScope,
      });
      await onRefresh();
      flash(fr ? 'Document mis à jour' : 'Document updated');
    } finally {
      setQlSaving(false);
    }
  }

  async function removeFile(id: string) {
    if (!canEdit) return;
    await api.deleteFile(id);
    if (previewId === id) setPreviewId(null);
    await onRefresh();
    flash(fr ? 'Document supprimé' : 'Document deleted');
  }

  function toggleSelect(id: string, e?: MouseEvent) {
    if (e && !(selectionMode || e.metaKey || e.ctrlKey || e.shiftKey)) return false;
    e?.preventDefault();
    setSelectionMode(true);
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (e?.shiftKey && prev.size) {
        const ids = filtered.map((f) => f.id);
        const a = ids.indexOf([...prev].pop() || id);
        const b = ids.indexOf(id);
        if (a >= 0 && b >= 0) {
          for (let i = Math.min(a, b); i <= Math.max(a, b); i++) next.add(ids[i]);
          return next;
        }
      }
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    return true;
  }

  function onListKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'a') {
      e.preventDefault();
      setSelectionMode(true);
      setSelectedIds(new Set(filtered.map((f) => f.id)));
    } else if (e.key === 'Escape' && selectionMode) {
      setSelectionMode(false);
      setSelectedIds(new Set());
    }
  }

  const gigLabel = (f: FileRecord) => {
    const g = f.gig_id ? gigsById.get(f.gig_id) : undefined;
    return g ? `${g.date} · ${g.city || g.name}` : fr ? 'Tour (général)' : 'Tour-wide';
  };

  return (
    <div
      className={`pf${dragOver ? ' pf--drop' : ''}`}
      onDragOver={(e) => {
        if (canEdit && e.dataTransfer.types.includes('Files')) {
          e.preventDefault();
          setDragOver(true);
        }
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        setDragOver(false);
        if (!canEdit || !e.dataTransfer.files.length) return;
        e.preventDefault();
        void uploadFiles(Array.from(e.dataTransfer.files));
      }}
    >
      {/* Top Search & Action Bar */}
      <div className="pf-bar" role="search">
        <label className="pf-find">
          <span className="lab">{fr ? 'Chercher' : 'Find'}</span>
          <input
            ref={searchRef}
            className="in"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={fr ? 'Nom, billet, hôtel, ville, personne…' : 'Filename, ticket, hotel, city, person…'}
          />
        </label>
        <span className="sub mono">{filtered.length}/{visiblePool.length}</span>
        {notice && <span className="sub" style={{ color: 'var(--cv-sel)', fontWeight: 700 }}>{notice}</span>}
        <button type="button" className="btn" onClick={() => setFiltersOpen((v) => !v)}>
          {fr ? 'Filtres' : 'Filters'}{activeFilterCount ? ` (${activeFilterCount})` : ''} {filtersOpen ? '▴' : '▾'}
        </button>
        <button
          type="button"
          className={`btn${selectionMode ? ' dk-sect--on' : ''}`}
          onClick={() => {
            setSelectionMode((v) => !v);
            if (selectionMode) setSelectedIds(new Set());
          }}
        >
          {selectionMode ? (fr ? 'Terminer' : 'Done') : fr ? 'Sélection' : 'Select'}
        </button>
        {canEdit && (
          <button
            type="button"
            className="btn btn--def"
            style={{ marginLeft: 'auto' }}
            onClick={() => {
              setUploadGigId(gigFilter || operationalGigId);
              setUploadOpen((v) => !v);
            }}
          >
            + {fr ? 'Ajouter fichiers' : 'Add files'}
          </button>
        )}
      </div>

      {/* Library & View Mode Row */}
      <div className="pf-browse">
        <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span className="lab">{fr ? 'Bibliothèque' : 'Library'}</span>
          <select className="in" style={{ width: 'auto', minWidth: 200 }} value={library} onChange={(e) => setLibrary(e.target.value)}>
            <option value="all">{fr ? `Tous les documents (${visiblePool.length})` : `All documents (${visiblePool.length})`}</option>
            {operationalGigId && <option value="current">{fr ? 'Date en cours' : 'Current date'}</option>}
            <option value="week">{fr ? '7 prochains jours' : 'Next 7 days'}</option>
            {categoryCounts.length > 0 && (
              <optgroup label={fr ? 'Catégories' : 'Categories'}>
                {categoryCounts.map(([cat, count]) => (
                  <option key={cat} value={`cat:${cat}`}>
                    {cat} · {count}
                  </option>
                ))}
              </optgroup>
            )}
            {personCounts.length > 0 && (
              <optgroup label={fr ? 'Par personne' : 'By person'}>
                {personCounts.map((p) => (
                  <option key={p.id} value={`person:${p.id}`}>
                    {p.label} · {p.count}
                  </option>
                ))}
              </optgroup>
            )}
          </select>
        </label>

        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 'auto' }}>
          <span className="lab">{fr ? 'Vue' : 'View'}</span>
          <div className="segs">
            <button type="button" className={`seg${viewMode === 'liste' ? ' seg--on' : ''}`} onClick={() => setViewMode('liste')}>
              {fr ? 'Liste' : 'List'}
            </button>
            <button type="button" className={`seg${viewMode === 'grille' ? ' seg--on' : ''}`} onClick={() => setViewMode('grille')}>
              {fr ? 'Grille' : 'Grid'}
            </button>
          </div>
        </div>
      </div>

      {/* Collapsible Filters */}
      {filtersOpen && (
        <div className="pf-filters">
          <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span className="lab">{fr ? 'Date' : 'Date'}</span>
            <select className="in" style={{ width: 'auto' }} value={gigFilter} onChange={(e) => setGigFilter(e.target.value)}>
              <option value="">{fr ? 'Toutes les dates' : 'All dates'}</option>
              {activeGigs.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.date} · {g.city || g.name}
                </option>
              ))}
            </select>
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span className="lab">{fr ? 'Type' : 'Kind'}</span>
            <select className="in" style={{ width: 'auto' }} value={kindFilter} onChange={(e) => setKindFilter(e.target.value as FileKind | 'all')}>
              <option value="all">{fr ? 'Tous' : 'All'}</option>
              <option value="pdf">PDF</option>
              <option value="image">Image</option>
              <option value="doc">Doc</option>
              <option value="autre">{fr ? 'Autre' : 'Other'}</option>
            </select>
          </label>
          {isOwner && (
            <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span className="lab">{fr ? 'Accès' : 'Scope'}</span>
              <select className="in" style={{ width: 'auto' }} value={scopeFilter} onChange={(e) => setScopeFilter(e.target.value as ScopeFilter)}>
                <option value="all">{fr ? 'Tout' : 'All'}</option>
                <option value="crew">{fr ? 'Équipe' : 'Crew'}</option>
                <option value="private">{fr ? 'Privé' : 'Private'}</option>
              </select>
            </label>
          )}
          <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span className="lab">{fr ? 'Tri' : 'Sort'}</span>
            <select className="in" style={{ width: 'auto' }} value={sortMode} onChange={(e) => setSortMode(e.target.value as SortMode)}>
              <option value="pertinence">{fr ? 'Pertinence (billets d’abord)' : 'Relevance (tickets first)'}</option>
              <option value="recent">{fr ? 'Plus récents' : 'Most recent'}</option>
              <option value="nom">{fr ? 'Nom A→Z' : 'Name A→Z'}</option>
              <option value="taille">{fr ? 'Taille' : 'Size'}</option>
              <option value="gig">{fr ? 'Date du tour' : 'Tour date'}</option>
            </select>
          </label>
          {activeFilterCount > 0 && (
            <button type="button" className="btn" onClick={resetFilters}>
              {fr ? 'Réinitialiser' : 'Reset'}
            </button>
          )}
        </div>
      )}

      {/* Upload Drawer */}
      {uploadOpen && canEdit && (
        <div className="pf-up">
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'flex-end' }}>
            <label className="block space-y-1">
              <span className="lab">{fr ? 'Destination (date)' : 'Destination date'}</span>
              <select className="in" style={{ width: 'auto' }} value={uploadGigId} onChange={(e) => setUploadGigId(e.target.value)}>
                <option value="">{fr ? 'Tour (général)' : 'Tour-wide'}</option>
                {activeGigs.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.date} · {g.city || g.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="block space-y-1">
              <span className="lab">{fr ? 'Personne (optionnel)' : 'Person (optional)'}</span>
              <select className="in" style={{ width: 'auto' }} value={uploadPersonId} onChange={(e) => setUploadPersonId(e.target.value)}>
                <option value="">—</option>
                {people.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="block space-y-1">
              <span className="lab">{fr ? 'Catégorie' : 'Category'}</span>
              <input className="in" style={{ width: 140 }} value={uploadCat} onChange={(e) => setUploadCat(e.target.value)} placeholder="Billets, Hôtels…" />
            </label>
            <label className="block space-y-1">
              <span className="lab">{fr ? 'Expiration' : 'Expiry'}</span>
              <input className="in mono" type="date" style={{ width: 135 }} value={uploadExpires} onChange={(e) => setUploadExpires(e.target.value)} />
            </label>
            {isOwner && (
              <label className="block space-y-1">
                <span className="lab">{fr ? 'Accès' : 'Scope'}</span>
                <select className="in" style={{ width: 'auto' }} value={uploadScope} onChange={(e) => setUploadScope(e.target.value as 'crew' | 'private')}>
                  <option value="crew">{fr ? 'Équipe' : 'Crew'}</option>
                  <option value="private">{fr ? 'Privé (owner)' : 'Private (owner)'}</option>
                </select>
              </label>
            )}
            <label className="btn btn--def" style={{ cursor: 'pointer' }}>
              {uploading ? '…' : fr ? 'Choisir fichiers…' : 'Choose files…'}
              <input
                type="file"
                multiple
                style={{ display: 'none' }}
                disabled={uploading}
                onChange={(e) => {
                  const list = Array.from(e.target.files || []);
                  e.target.value = '';
                  void uploadFiles(list);
                }}
              />
            </label>
            <button type="button" className="btn" onClick={() => setUploadOpen(false)}>
              {fr ? 'Fermer' : 'Close'}
            </button>
          </div>
          <div className="sub" style={{ marginTop: 6 }}>
            {fr ? 'Astuce : vous pouvez aussi glisser-déposer des fichiers directement n’importe où sur cette fenêtre.' : 'Tip: you can also drag & drop files anywhere onto this window.'}
          </div>
        </div>
      )}

      {/* Batch Selection Toolbar */}
      {(selectionMode || selectedIds.size > 0) && (
        <div className="pf-batch">
          <span className="mono">{selectedIds.size} {fr ? 'sélectionné(s)' : 'selected'}</span>
          <button
            type="button"
            className="btn btn--def"
            disabled={!selectedIds.size}
            onClick={() => {
              const first = filtered.find((f) => selectedIds.has(f.id));
              if (first) setPreviewId(first.id);
            }}
          >
            {fr ? 'Aperçu' : 'Preview'}
          </button>
          <button
            type="button"
            className="btn"
            disabled={!selectedIds.size}
            onClick={() => {
              const first = [...selectedIds][0];
              if (first) {
                const u = fileAssetUrl(first, true);
                if (u.startsWith('data:')) {
                  setPreviewId(first);
                  return;
                }
              }
              for (const id of selectedIds) window.open(fileAssetUrl(id, true), '_blank', 'noopener,noreferrer');
            }}
          >
            {fr ? 'Ouvrir' : 'Open'}
          </button>
          <button
            type="button"
            className="btn"
            onClick={() =>
              setSelectedIds(
                selectedIds.size === filtered.length ? new Set() : new Set(filtered.map((f) => f.id)),
              )
            }
          >
            {selectedIds.size === filtered.length ? (fr ? 'Tout désélectionner' : 'Deselect all') : fr ? 'Tout sélectionner' : 'Select all'}
          </button>
          <button type="button" className="btn" onClick={() => { setSelectedIds(new Set()); setSelectionMode(false); }}>
            {fr ? 'Annuler' : 'Cancel'}
          </button>
        </div>
      )}

      {/* File List / Grid */}
      <div className="pf-list" tabIndex={-1} onKeyDown={onListKeyDown}>
        {viewMode === 'liste' && (
          <div className="pf-row pf-head" aria-hidden="true">
            {selectionMode && <span />}
            <span>{fr ? 'Nom' : 'Name'}</span>
            <span>{fr ? 'Catégorie' : 'Category'}</span>
            <span>{fr ? 'Date' : 'Date'}</span>
            <span style={{ textAlign: 'right' }}>{fr ? 'Taille' : 'Size'}</span>
            <span>{fr ? 'État' : 'State'}</span>
          </div>
        )}

        {!filtered.length ? (
          <div className="sub" style={{ padding: 20, textAlign: 'center' }}>
            {activeFilterCount > 0
              ? fr ? 'Aucun document ne correspond aux filtres.' : 'No documents match your filters.'
              : fr ? 'Aucun document. Glissez un billet, voucher hôtel ou rider ici.' : 'No documents yet. Drop a boarding pass, hotel voucher, or rider here.'}
          </div>
        ) : viewMode === 'liste' ? (
          <ul className="pf-ul">
            {filtered.map((f) => {
              const kind = getFileKind(f);
              const checked = selectedIds.has(f.id);
              const exp = expiryState(f.doc_expires);
              const who = f.person_id ? peopleById.get(f.person_id)?.name : null;
              return (
                <li key={f.id}>
                  <div
                    role="button"
                    tabIndex={0}
                    className={`item pf-row${selectionMode ? ' pf-row--sel' : ''}${checked ? ' item--on' : ''}`}
                    onClick={(e) => {
                      if (toggleSelect(f.id, e)) return;
                      setPreviewId(f.id);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') setPreviewId(f.id);
                    }}
                  >
                    {selectionMode && (
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleSelect(f.id)}
                        onClick={(e) => e.stopPropagation()}
                      />
                    )}
                    <span className="truncate" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <FileGlyph kind={kind} />
                      <b className="truncate">{f.name}</b>
                    </span>
                    <span className="sub truncate">{smartCategory(f, fr)}</span>
                    <span className="sub truncate">{gigLabel(f)}</span>
                    <span className="mono sub" style={{ textAlign: 'right' }}>{formatBytes(f.size)}</span>
                    <span className="truncate" style={{ fontSize: 11 }}>
                      {exp === 'expired' && <span className="warn">{fr ? 'Expiré' : 'Expired'} · </span>}
                      {exp === 'soon' && <span className="warn">{f.doc_expires} · </span>}
                      {who && <span>{who} · </span>}
                      {f.scope === 'private' && <span className="sub">{fr ? 'Privé' : 'Private'}</span>}
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
        ) : (
          <div className="pf-grid">
            {filtered.map((f) => {
              const kind = getFileKind(f);
              const checked = selectedIds.has(f.id);
              return (
                <button
                  key={f.id}
                  type="button"
                  className={`pf-card${checked ? ' pf-card--on' : ''}`}
                  onClick={(e) => {
                    if (toggleSelect(f.id, e)) return;
                    setPreviewId(f.id);
                  }}
                >
                  <div className="pf-card__thumb">
                    {kind === 'image' ? (
                      <img src={fileAssetUrl(f.id, true)} alt={f.name} loading="lazy" />
                    ) : (
                      <FileGlyph kind={kind} />
                    )}
                  </div>
                  <div className="pf-card__meta">
                    <b className="truncate">{f.name}</b>
                    <span className="sub truncate">{smartCategory(f, fr)} · {gigLabel(f)}</span>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* DeskQuickLook Full-Viewport Reader & Metadata Editor Modal */}
      {previewFile && (
        <div
          style={{ position: 'fixed', inset: 0, zIndex: 60, background: 'rgba(0,0,0,0.65)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
          onClick={() => setPreviewId(null)}
        >
          <div style={{ width: '100%', maxWidth: 1020, height: '86vh', display: 'flex', flexDirection: 'column' }} onClick={(e) => e.stopPropagation()}>
            <div className="ytab" style={{ margin: '0 0 -1px 0' }}>
              <button type="button" className="box" onClick={() => setPreviewId(null)} title="Fermer" />
              <span className="truncate">{previewFile.name}</span>
              {previewIndex >= 0 && (
                <span className="mono sub" style={{ marginLeft: 'auto' }}>
                  {previewIndex + 1}/{filtered.length}
                </span>
              )}
            </div>
            <div className="win" style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
              <div className="pf-ql__bar">
                <button
                  type="button"
                  className="btn"
                  disabled={previewIndex <= 0}
                  onClick={() => previewIndex > 0 && setPreviewId(filtered[previewIndex - 1].id)}
                >
                  ‹ {fr ? 'Précédent' : 'Prev'}
                </button>
                <button
                  type="button"
                  className="btn"
                  disabled={previewIndex < 0 || previewIndex >= filtered.length - 1}
                  onClick={() => previewIndex >= 0 && previewIndex < filtered.length - 1 && setPreviewId(filtered[previewIndex + 1].id)}
                >
                  {fr ? 'Suivant' : 'Next'} ›
                </button>
                {previewFile.gig_id && (
                  <button
                    type="button"
                    className="btn"
                    onClick={() => {
                      const gid = previewFile.gig_id!;
                      setPreviewId(null);
                      onOpenGig(gid);
                    }}
                  >
                    {fr ? 'Ouvrir la date' : 'Open date'}
                  </button>
                )}
                <a
                  className="btn btn--def"
                  style={{ marginLeft: 'auto' }}
                  href={fileAssetUrl(previewFile.id, false)}
                  download={previewFile.name}
                >
                  {fr ? 'Télécharger' : 'Download'}
                </a>
                <button type="button" className="btn" onClick={() => setPreviewId(null)}>
                  {fr ? 'Fermer' : 'Close'}
                </button>
              </div>

              <div className="pf-ql__body">
                {/* Preview Stage */}
                <div className="pf-ql__stage">
                  {getFileKind(previewFile) === 'image' ? (
                    <img
                      src={fileAssetUrl(previewFile.id, true)}
                      alt={previewFile.name}
                      style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }}
                    />
                  ) : getFileKind(previewFile) === 'pdf' ? (
                    <iframe
                      src={fileAssetUrl(previewFile.id, true)}
                      title={previewFile.name}
                      style={{ width: '100%', height: '100%', border: 0, background: '#fff' }}
                    />
                  ) : (
                    <div style={{ textAlign: 'center', padding: 24 }}>
                      <FileGlyph kind={getFileKind(previewFile)} />
                      <p style={{ marginTop: 10 }}><b>{previewFile.name}</b></p>
                      <p className="sub">{previewFile.mime} · {formatBytes(previewFile.size)}</p>
                      <a className="btn btn--def" href={fileAssetUrl(previewFile.id, true)} target="_blank" rel="noreferrer">
                        {fr ? 'Ouvrir dans un nouvel onglet' : 'Open in new tab'}
                      </a>
                    </div>
                  )}
                </div>

                {/* Metadata & Edit Rail */}
                <aside className="pf-ql__side">
                  <div className="lab">{fr ? 'Propriétés' : 'Metadata'}</div>
                  <label className="block space-y-1">
                    <span className="lab">{fr ? 'Nom du fichier' : 'Filename'}</span>
                    <input className="in" value={qlName} disabled={!canEdit} onChange={(e) => setQlName(e.target.value)} />
                  </label>
                  <label className="block space-y-1">
                    <span className="lab">{fr ? 'Catégorie' : 'Category'}</span>
                    <input className="in" value={qlCat} disabled={!canEdit} onChange={(e) => setQlCat(e.target.value)} placeholder={smartCategory(previewFile, fr)} />
                  </label>
                  <label className="block space-y-1">
                    <span className="lab">{fr ? 'Date du tour' : 'Tour date'}</span>
                    <select className="in" value={qlGigId} disabled={!canEdit} onChange={(e) => setQlGigId(e.target.value)}>
                      <option value="">{fr ? 'Tour (général)' : 'Tour-wide'}</option>
                      {activeGigs.map((g) => (
                        <option key={g.id} value={g.id}>
                          {g.date} · {g.city || g.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="block space-y-1">
                    <span className="lab">{fr ? 'Personne associée' : 'Linked person'}</span>
                    <select className="in" value={qlPersonId} disabled={!canEdit} onChange={(e) => setQlPersonId(e.target.value)}>
                      <option value="">—</option>
                      {people.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="block space-y-1">
                    <span className="lab">{fr ? 'Date d’expiration' : 'Expiry date'}</span>
                    <input className="in mono" type="date" value={qlExpires} disabled={!canEdit} onChange={(e) => setQlExpires(e.target.value)} />
                  </label>
                  {isOwner && (
                    <label className="block space-y-1">
                      <span className="lab">{fr ? 'Visibilité' : 'Visibility'}</span>
                      <select className="in" value={qlScope} onChange={(e) => setQlScope(e.target.value as 'crew' | 'private')}>
                        <option value="crew">{fr ? 'Équipe' : 'Crew'}</option>
                        <option value="private">{fr ? 'Privé (owner)' : 'Private (owner)'}</option>
                      </select>
                    </label>
                  )}
                  <div className="sub mono" style={{ fontSize: 11 }}>
                    {formatBytes(previewFile.size)} · {previewFile.mime}
                  </div>
                  {canEdit && (
                    <div style={{ display: 'flex', gap: 6, marginTop: 'auto', paddingTop: 8 }}>
                      <button type="button" className="btn btn--def" style={{ flex: 1 }} disabled={qlSaving} onClick={() => void saveQuickLook()}>
                        {qlSaving ? '…' : fr ? 'Enregistrer' : 'Save'}
                      </button>
                      <button type="button" className="btn warn" onClick={() => void removeFile(previewFile.id)}>
                        {fr ? 'Supprimer' : 'Delete'}
                      </button>
                    </div>
                  )}
                </aside>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
