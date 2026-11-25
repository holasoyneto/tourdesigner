import { MessageCircle, Phone, Share2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api/client';
import { fileAssetUrl, fullUrl } from '../lib/basePath';
import { AutocompleteInput } from '../components/AutocompleteInput';
import type { CopyDict } from '../i18n/copy';
import { useIsMobile } from '../lib/useIsMobile';
import type { FileRecord, Gig, GigItem, Locale, Person, PersonLoyalty, User } from '../types';

interface Props {
  people: Person[];
  gigs: Gig[];
  itemsByGig: Record<string, GigItem[]>;
  files: FileRecord[];
  user: User;
  locale: Locale;
  copy: CopyDict;
  onRefresh: () => Promise<void>;
  onOpenGig: (id: string) => void;
  onOpenFile?: (fileId: string) => void;
}

const strip = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

function letterOf(name: string): string {
  const first = strip(name.trim()).toUpperCase().charAt(0);
  return /[A-Z]/.test(first) ? first : '#';
}

function expiryState(iso?: string | null): 'expired' | 'soon' | 'ok' | 'none' {
  if (!iso || !/^\d{4}-\d{2}-\d{2}/.test(iso)) return 'none';
  const today = new Date().toISOString().slice(0, 10);
  if (iso < today) return 'expired';
  const soon = new Date(Date.now() + 90 * 864e5).toISOString().slice(0, 10);
  return iso <= soon ? 'soon' : 'ok';
}

function fileMentionsPerson(fileName: string, p: Person): boolean {
  const hay = strip(fileName);
  const parts = strip(p.name)
    .split(/\s+/)
    .filter((w) => w.length >= 3);
  if (!parts.length) return false;
  return parts.some((part) => new RegExp(`(^|[^a-z0-9])${part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z0-9]|$)`).test(hay));
}

export function ContactsPage({ people, gigs, itemsByGig, files, user, locale, copy, onRefresh, onOpenGig, onOpenFile }: Props) {
  const fr = locale === 'fr';
  const canEdit = user.role !== 'viewer';
  const isOwner = user.role === 'owner';
  const isMobile = useIsMobile();
  const today = new Date().toISOString().slice(0, 10);

  const [q, setQ] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [expandedDates, setExpandedDates] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Add / Edit / Merge modes
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState(false);
  const [merging, setMerging] = useState(false);
  const [mergeTarget, setMergeTarget] = useState('');

  // Form state for add / edit
  const [fName, setFName] = useState('');
  const [fRole, setFRole] = useState('');
  const [fCompany, setFCompany] = useState('');
  const [fPhone, setFPhone] = useState('');
  const [fEmail, setFEmail] = useState('');
  const [fAliases, setFAliases] = useState('');
  const [fNotes, setFNotes] = useState('');
  const [fPermanent, setFPermanent] = useState(false);
  const [fLoyalty, setFLoyalty] = useState<PersonLoyalty[]>([]);
  const [newLoyKind, setNewLoyKind] = useState<'airline' | 'hotel'>('airline');
  const [newLoyProg, setNewLoyProg] = useState('');
  const [newLoyNum, setNewLoyNum] = useState('');
  const [namesake, setNamesake] = useState<Person | null>(null);

  // Inline row cell editing
  const [inlineCell, setInlineCell] = useState<{ id: string; field: 'name' | 'role' | 'phone' | 'email'; value: string } | null>(null);

  // Inline travel route note editing (visa / health / preferences)
  const [routeEdit, setRouteEdit] = useState<{ field: 'visa' | 'health' | 'preferences'; value: string } | null>(null);
  const [dismissedSug, setDismissedSug] = useState<Record<string, true>>({});
  const searchRef = useRef<HTMLInputElement>(null);

  const flash = (msg: string) => {
    setNotice(msg);
    window.setTimeout(() => setNotice((prev) => (prev === msg ? null : prev)), 2600);
  };

  useEffect(() => {
    setExpandedDates(false);
    setEditing(false);
    setMerging(false);
    setRouteEdit(null);
  }, [selectedId]);

  const roleSuggestions = useMemo(
    () =>
      [...new Set(people.map((p) => (p.role || '').trim()).filter(Boolean))]
        .sort()
        .map((r) => ({ value: r, label: r })),
    [people],
  );

  // Gigs linked to each person
  const gigsByPerson = useMemo(() => {
    const gigMap = new Map(gigs.filter((g) => !g.deleted_at).map((g) => [g.id, g]));
    const out = new Map<string, Gig[]>();
    for (const [gigId, items] of Object.entries(itemsByGig)) {
      const g = gigMap.get(gigId);
      if (!g) continue;
      const seen = new Set<string>();
      for (const it of items) {
        for (const pid of it.person_ids || []) {
          if (seen.has(pid)) continue;
          seen.add(pid);
          const list = out.get(pid) || [];
          list.push(g);
          out.set(pid, list);
        }
      }
    }
    for (const list of out.values()) list.sort((a, b) => a.date.localeCompare(b.date));
    return out;
  }, [gigs, itemsByGig]);

  // Documents linked to each person
  const docsByPerson = useMemo(() => {
    const rank = { expired: 0, soon: 1, ok: 2, none: 3 } as const;
    const out = new Map<string, FileRecord[]>();
    for (const f of files) {
      if (!f.person_id) continue;
      const list = out.get(f.person_id) || [];
      list.push(f);
      out.set(f.person_id, list);
    }
    for (const list of out.values()) {
      list.sort((a, b) => rank[expiryState(a.doc_expires)] - rank[expiryState(b.doc_expires)] || a.name.localeCompare(b.name));
    }
    return out;
  }, [files]);

  // Suggested unattached files whose filename mentions a single person
  const suggestionsByPerson = useMemo(() => {
    const out = new Map<string, FileRecord[]>();
    if (!canEdit) return out;
    for (const f of files) {
      if (f.person_id || dismissedSug[f.id] || !f.name) continue;
      const hits = people.filter((p) => fileMentionsPerson(f.name, p));
      if (hits.length !== 1) continue;
      const list = out.get(hits[0].id) || [];
      list.push(f);
      out.set(hits[0].id, list);
    }
    return out;
  }, [files, people, canEdit, dismissedSug]);

  // Filtered + Permanent + A–Z Groups
  const filtered = useMemo(() => {
    const needle = strip(q.trim());
    const list = needle
      ? people.filter((p) =>
          strip(`${p.name} ${p.role || ''} ${p.company || ''} ${p.phone || ''} ${p.email || ''} ${(p.profile?.aliases || []).join(' ')}`).includes(needle),
        )
      : people;
    return list.slice().sort((a, b) => a.name.localeCompare(b.name, fr ? 'fr' : 'en'));
  }, [people, q, fr]);

  const permanents = useMemo(() => filtered.filter((p) => p.permanent), [filtered]);
  const permanentIds = useMemo(() => new Set(permanents.map((p) => p.id)), [permanents]);
  const groups = useMemo(() => {
    const map = new Map<string, Person[]>();
    for (const p of filtered) {
      if (permanentIds.has(p.id)) continue;
      const l = letterOf(p.name);
      const list = map.get(l) || [];
      list.push(p);
      map.set(l, list);
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [filtered, permanentIds]);

  const selected = useMemo(() => people.find((p) => p.id === selectedId) || null, [people, selectedId]);

  function openAdd() {
    setAdding(true);
    setEditing(false);
    setMerging(false);
    setNamesake(null);
    setFName('');
    setFRole('');
    setFCompany('');
    setFPhone('');
    setFEmail('');
    setFAliases('');
    setFNotes('');
    setFPermanent(false);
    setFLoyalty([]);
  }

  function openEdit(p: Person) {
    setEditing(true);
    setAdding(false);
    setMerging(false);
    setNamesake(null);
    setFName(p.name);
    setFRole(p.role || '');
    setFCompany(p.company || '');
    setFPhone(p.phone || '');
    setFEmail(p.email || '');
    setFAliases((p.profile?.aliases || []).join(', '));
    setFNotes(p.notes || '');
    setFPermanent(Boolean(p.permanent));
    setFLoyalty(p.loyalty ? [...p.loyalty] : []);
  }

  async function savePerson(force = false) {
    if (!fName.trim()) return;
    const aliases = fAliases
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    if (adding && !force) {
      const norm = strip(fName.trim());
      const dup = people.find(
        (p) =>
          (fEmail.trim() && p.email && strip(p.email) === strip(fEmail.trim())) ||
          strip(p.name) === norm,
      );
      if (dup) {
        setNamesake(dup);
        return;
      }
    }

    setBusy(true);
    try {
      if (adding) {
        const res = await api.createPerson({
          name: fName.trim(),
          role: fRole.trim() || undefined,
          company: fCompany.trim() || undefined,
          phone: fPhone.trim() || undefined,
          email: fEmail.trim() || undefined,
          notes: fNotes.trim() || undefined,
          permanent: fPermanent,
          loyalty: fLoyalty,
          profile: { aliases },
        });
        setAdding(false);
        setNamesake(null);
        await onRefresh();
        setSelectedId(res.person.id);
        flash(fr ? `Contact créé : ${res.person.name}` : `Contact created: ${res.person.name}`);
      } else if (selected) {
        await api.updatePerson(
          selected.id,
          {
            name: fName.trim(),
            role: fRole.trim() || null,
            company: fCompany.trim() || null,
            phone: fPhone.trim() || null,
            email: fEmail.trim() || null,
            notes: fNotes.trim() || null,
            permanent: fPermanent,
            loyalty: fLoyalty,
            profile: { ...(selected.profile || {}), aliases },
          },
          selected.version,
        );
        setEditing(false);
        await onRefresh();
        flash(fr ? 'Fiche enregistrée' : 'Contact saved');
      }
    } finally {
      setBusy(false);
    }
  }

  async function commitInlineCell(overrideVal?: string) {
    if (!inlineCell) return;
    const p = people.find((x) => x.id === inlineCell.id);
    const val = (overrideVal ?? inlineCell.value).trim();
    setInlineCell(null);
    if (!p) return;
    const current = String((p as unknown as Record<string, unknown>)[inlineCell.field] || '');
    if (val === current) return;
    if (inlineCell.field === 'name' && !val) return;
    await api.updatePerson(p.id, { [inlineCell.field]: val || null }, p.version);
    await onRefresh();
    flash(fr ? 'Modifié' : 'Updated');
  }

  async function togglePermanent(p: Person) {
    if (!canEdit) return;
    await api.updatePerson(p.id, { permanent: !p.permanent }, p.version);
    await onRefresh();
    flash(p.permanent ? (fr ? 'Retiré de l’équipe permanente' : 'Removed from permanent crew') : fr ? 'Épinglé équipe permanente' : 'Pinned as permanent crew');
  }

  async function saveRouteNote(p: Person, field: 'visa' | 'health' | 'preferences', value: string) {
    await api.updatePerson(p.id, { profile: { ...(p.profile || {}), [field]: value.trim() || undefined } }, p.version);
    setRouteEdit(null);
    await onRefresh();
    flash(fr ? 'Note de route enregistrée' : 'Travel note saved');
  }

  async function copyPersonalShare(p: Person) {
    const res = await api.createShare({ scope: 'person', person_id: p.id, label: p.name });
    const url = fullUrl(`/link/${res.share.key}`);
    await navigator.clipboard.writeText(url).catch(() => undefined);
    flash(fr ? `Lien personnel copié : ${p.name}` : `Personal link copied: ${p.name}`);
  }

  async function copyTextValue(val: string, label: string) {
    await navigator.clipboard.writeText(val).catch(() => undefined);
    flash(fr ? `${label} copié` : `${label} copied`);
  }

  async function handleMerge(source: Person) {
    if (!mergeTarget || mergeTarget === source.id) return;
    setBusy(true);
    try {
      await api.mergePeople(source.id, mergeTarget);
      setMerging(false);
      setSelectedId(mergeTarget);
      setMergeTarget('');
      await onRefresh();
      flash(fr ? 'Contacts fusionnés' : 'Contacts merged');
    } finally {
      setBusy(false);
    }
  }

  async function assignDoc(fileId: string, personId: string | null) {
    await api.updateFile(fileId, { person_id: personId });
    await onRefresh();
    flash(personId ? (fr ? 'Document associé' : 'Document attached') : fr ? 'Document détaché' : 'Document detached');
  }

  const renderRow = (p: Person) => {
    const on = selectedId === p.id && !adding;
    const gigCount = (gigsByPerson.get(p.id) || []).length;
    const docs = docsByPerson.get(p.id) || [];
    const expired = docs.some((d) => expiryState(d.doc_expires) === 'expired');

    const renderCell = (field: 'name' | 'role' | 'phone' | 'email', display: string, mono = false, bold = false) => {
      const isEditing = inlineCell?.id === p.id && inlineCell.field === field;
      if (isEditing) {
        return (
          <span className="pc-c" onClick={(e) => e.stopPropagation()}>
            {field === 'role' ? (
              <AutocompleteInput
                value={inlineCell.value}
                onChange={(v) => setInlineCell({ ...inlineCell, value: v })}
                suggestions={roleSuggestions}
                onCommit={(v) => void commitInlineCell(v)}
                onCancel={() => setInlineCell(null)}
                autoFocus
              />
            ) : (
              <input
                className={`in${mono ? ' mono' : ''}`}
                style={{ width: '100%', height: 22, padding: '1px 5px' }}
                value={inlineCell.value}
                autoFocus
                onChange={(e) => setInlineCell({ ...inlineCell, value: e.target.value })}
                onBlur={() => void commitInlineCell()}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void commitInlineCell();
                  if (e.key === 'Escape') setInlineCell(null);
                }}
              />
            )}
          </span>
        );
      }
      return (
        <span
          className={`pc-c${mono ? ' mono' : ''}`}
          title={canEdit ? (fr ? 'Double-clic pour modifier' : 'Double-click to edit') : undefined}
          onDoubleClick={(e) => {
            if (!canEdit) return;
            e.stopPropagation();
            setInlineCell({ id: p.id, field, value: display });
          }}
        >
          {bold ? <b>{display || '—'}</b> : display || <span className="sub">—</span>}
        </span>
      );
    };

    if (isMobile) {
      const digits = (p.phone || '').replace(/[^\d+]/g, '');
      const waDigits = digits.replace(/^\+/, '');
      return (
        <li key={p.id} className="pc-li">
          <div
            role="row"
            tabIndex={0}
            className={`m2032-pcard${on ? ' m2032-pcard--on' : ''}`}
            onClick={() => {
              setAdding(false);
              setSelectedId(p.id);
            }}
          >
            <div className="min-w-0 flex-1">
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <strong className="truncate" style={{ fontSize: 14 }}>{p.name}</strong>
                {gigCount > 0 && <span className="mono m2032-status">{gigCount}d</span>}
                {expired && <span className="warn" style={{ fontSize: 11, fontWeight: 700 }}>!</span>}
              </div>
              {(p.role || p.company) && (
                <div className="sub truncate" style={{ fontSize: 12 }}>
                  {[p.role, p.company].filter(Boolean).join(' · ')}
                </div>
              )}
              {p.phone && <div className="mono sub" style={{ fontSize: 12, marginTop: 2 }}>{p.phone}</div>}
            </div>
            <div className="m2032-pcard__acts" onClick={(e) => e.stopPropagation()}>
              {digits.length >= 7 && (
                <>
                  <a className="m2032-qicon" href={`tel:${digits}`} aria-label={fr ? 'Appeler' : 'Call'}>
                    <Phone className="h-4 w-4" />
                  </a>
                  <a className="m2032-qicon" href={`https://wa.me/${waDigits}`} target="_blank" rel="noreferrer" aria-label="WhatsApp">
                    <MessageCircle className="h-4 w-4" />
                  </a>
                </>
              )}
              <button type="button" className="m2032-qicon" aria-label={fr ? 'Lien personnel' : 'Personal link'} onClick={() => void copyPersonalShare(p)}>
                <Share2 className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        </li>
      );
    }

    return (
      <li key={p.id} className="pc-li">
        <div
          role="row"
          tabIndex={0}
          className={`item pc-row${on ? ' item--on' : ''}`}
          onClick={() => {
            setAdding(false);
            setSelectedId(p.id);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              setAdding(false);
              setSelectedId(p.id);
            }
          }}
        >
          {renderCell('name', p.name, false, true)}
          {renderCell('role', [p.role, p.company].filter(Boolean).join(' · '))}
          {renderCell('phone', p.phone || '', true)}
          {renderCell('email', p.email || '')}
          <span className="pc-c mono pc-c--n">{gigCount || ''}</span>
          <span className={`pc-c${expired ? ' warn' : ' sub'}`}>
            {expired ? (fr ? '! Expiré' : '! Expired') : docs.length ? `${docs.length} doc` : ''}
          </span>
        </div>
      </li>
    );
  };

  const renderSection = (key: string, title: string, list: Person[]) => (
    <li key={key} className="pc-group">
      <div className="sep pc-sep">
        <span>{title}</span>
        <span className="mono sub">{list.length}</span>
      </div>
      <ul className="pc-list__ul">{list.map(renderRow)}</ul>
    </li>
  );

  const renderIdentityForm = (isNew: boolean) => (
    <div className="pc-edit">
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 8 }}>
        <label className="block space-y-1">
          <span className="lab">{fr ? 'Nom *' : 'Name *'}</span>
          <input className="in" value={fName} onChange={(e) => { setNamesake(null); setFName(e.target.value); }} autoFocus />
        </label>
        <label className="block space-y-1">
          <span className="lab">{fr ? 'Rôle' : 'Role'}</span>
          <AutocompleteInput
            value={fRole}
            onChange={setFRole}
            onCommit={setFRole}
            suggestions={roleSuggestions}
            placeholder="TM, FOH, Promoteur…"
            autoFocus={false}
          />
        </label>
        <label className="block space-y-1">
          <span className="lab">{fr ? 'Société' : 'Company'}</span>
          <input className="in" value={fCompany} onChange={(e) => setFCompany(e.target.value)} />
        </label>
        <label className="block space-y-1">
          <span className="lab">{fr ? 'Téléphone' : 'Phone'}</span>
          <input className="in mono" value={fPhone} onChange={(e) => setFPhone(e.target.value)} placeholder="+33 6…" />
        </label>
        <label className="block space-y-1">
          <span className="lab">E-mail</span>
          <input className="in" value={fEmail} onChange={(e) => setFEmail(e.target.value)} />
        </label>
        <label className="block space-y-1">
          <span className="lab">{fr ? 'Alias (séparés par virgule)' : 'Aliases (comma-separated)'}</span>
          <input className="in" value={fAliases} onChange={(e) => setFAliases(e.target.value)} placeholder="Kael, K." />
        </label>
      </div>

      {/* Loyalty / Frequent Flyer Programs */}
      <div style={{ marginTop: 10 }}>
        <div className="lab" style={{ marginBottom: 4 }}>{fr ? 'Programmes fidélité (compagnies / hôtels)' : 'Loyalty programs (airline / hotel)'}</div>
        {fLoyalty.map((l, idx) => (
          <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
            <span className="sub">{l.kind === 'airline' ? '✈' : '🏨'}</span>
            <b>{l.program}</b>
            <span className="mono">{l.number}</span>
            <button type="button" className="btn" onClick={() => setFLoyalty((prev) => prev.filter((_, i) => i !== idx))}>
              ×
            </button>
          </div>
        ))}
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <select className="in" style={{ width: 'auto' }} value={newLoyKind} onChange={(e) => setNewLoyKind(e.target.value as 'airline' | 'hotel')}>
            <option value="airline">{fr ? 'Compagnie' : 'Airline'}</option>
            <option value="hotel">{fr ? 'Hôtel' : 'Hotel'}</option>
          </select>
          <input className="in" style={{ width: 150 }} value={newLoyProg} onChange={(e) => setNewLoyProg(e.target.value)} placeholder="Flying Blue, Bonvoy…" />
          <input className="in mono" style={{ width: 150 }} value={newLoyNum} onChange={(e) => setNewLoyNum(e.target.value)} placeholder="Numéro" />
          <button
            type="button"
            className="btn"
            disabled={!newLoyProg.trim() || !newLoyNum.trim()}
            onClick={() => {
              setFLoyalty((prev) => [...prev, { kind: newLoyKind, program: newLoyProg.trim(), number: newLoyNum.trim() }]);
              setNewLoyProg('');
              setNewLoyNum('');
            }}
          >
            + {fr ? 'Ajouter' : 'Add'}
          </button>
        </div>
      </div>

      <label className="block space-y-1" style={{ marginTop: 8 }}>
        <span className="lab">Notes</span>
        <textarea className="in" rows={2} value={fNotes} onChange={(e) => setFNotes(e.target.value)} />
      </label>

      <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginTop: 8, cursor: 'pointer' }}>
        <input type="checkbox" checked={fPermanent} onChange={(e) => setFPermanent(e.target.checked)} />
        <span>★ {fr ? 'Équipe permanente (épinglé en haut)' : 'Permanent crew (pinned at top)'}</span>
      </label>

      {namesake && (
        <div style={{ marginTop: 8, padding: 8, background: 'var(--cv-paper2)', border: '1px solid var(--cv-warn)' }}>
          <div className="warn">
            {fr ? `Un contact similaire existe déjà : ${namesake.name}` : `A similar contact already exists: ${namesake.name}`}
          </div>
          <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
            <button type="button" className="btn btn--def" onClick={() => { setAdding(false); setNamesake(null); setSelectedId(namesake.id); }}>
              {fr ? 'Ouvrir l’existant' : 'Open existing'}
            </button>
            <button type="button" className="btn" onClick={() => void savePerson(true)}>
              {fr ? 'Créer quand même' : 'Create anyway'}
            </button>
          </div>
        </div>
      )}

      <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', marginTop: 10 }}>
        <button type="button" className="btn" onClick={() => { setAdding(false); setEditing(false); setNamesake(null); }}>
          {copy.cancel}
        </button>
        <button type="button" className="btn btn--def" disabled={busy || !fName.trim()} onClick={() => void savePerson()}>
          {isNew ? (fr ? 'Créer' : 'Create') : copy.save}
        </button>
      </div>
    </div>
  );

  return (
    <div className="pc" data-page="contacts">
      {/* Top Search Bar */}
      <div className="pc-bar" role="search">
        <label className="pc-find">
          <span className="lab">{fr ? 'Chercher' : 'Find'}</span>
          <input
            ref={searchRef}
            className="in"
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={fr ? 'Nom, rôle, téléphone, société…' : 'Name, role, phone, company…'}
          />
        </label>
        {q && (
          <button type="button" className="btn" onClick={() => { setQ(''); searchRef.current?.focus(); }}>
            {fr ? 'Effacer' : 'Clear'}
          </button>
        )}
        <span className="sub mono">
          {filtered.length}/{people.length}
        </span>
        {notice && <span className="sub" style={{ color: 'var(--cv-sel)', fontWeight: 700 }}>{notice}</span>}
        {canEdit && (
          <button type="button" className="btn btn--def" style={{ marginLeft: 'auto' }} onClick={openAdd}>
            + {fr ? 'Ajouter' : 'Add'}
          </button>
        )}
      </div>

      {/* Main Scrollable Grouped List */}
      <div className="pc-list">
        {!isMobile && (
          <div className="pc-row pc-head" aria-hidden="true">
            <span className="pc-c">{fr ? 'Nom' : 'Name'}</span>
            <span className="pc-c">{fr ? 'Rôle' : 'Role'}</span>
            <span className="pc-c">{fr ? 'Téléphone' : 'Phone'}</span>
            <span className="pc-c">E-mail</span>
            <span className="pc-c pc-c--n">{fr ? 'Dates' : 'Dates'}</span>
            <span className="pc-c">{fr ? 'Docs' : 'Docs'}</span>
          </div>
        )}

        {!filtered.length ? (
          <p className="sub" style={{ padding: 14 }}>
            {q ? (fr ? 'Aucun contact trouvé.' : 'No matching contacts.') : fr ? 'Aucun contact.' : 'No contacts.'}
          </p>
        ) : (
          <ul className="pc-list__ul">
            {q.trim() ? (
              renderSection('results', fr ? 'Résultats' : 'Results', filtered)
            ) : (
              <>
                {permanents.length > 0 && renderSection('perm', fr ? '★ Équipe permanente' : '★ Permanent crew', permanents)}
                {groups.map(([letter, list]) => renderSection(letter, letter, list))}
              </>
            )}
          </ul>
        )}
      </div>

      {/* Bottom Split Contact Detail Card */}
      <div className={`pc-pane${adding || selected ? '' : ' pc-pane--idle'}`}>
        {adding ? (
          <section className="pc-card">
            <header className="pc-card__head">
              <strong className="pc-card__name">{fr ? 'Nouveau contact' : 'New contact'}</strong>
              <span className="pc-card__end">
                <button type="button" className="btn" onClick={() => setAdding(false)}>
                  {fr ? 'Fermer' : 'Close'}
                </button>
              </span>
            </header>
            {renderIdentityForm(true)}
          </section>
        ) : selected ? (
          (() => {
            const p = selected;
            const tel = p.phone ? p.phone.replace(/\s/g, '') : '';
            const wa = p.phone && p.phone.trim().startsWith('+') ? `https://wa.me/${p.phone.replace(/[^\d]/g, '')}` : null;
            const docs = docsByPerson.get(p.id) || [];
            const sugs = suggestionsByPerson.get(p.id) || [];
            const pGigs = gigsByPerson.get(p.id) || [];
            const upcoming = pGigs.filter((g) => g.date >= today);
            const initial = upcoming.length ? upcoming.slice(0, 5) : pGigs.slice(-5);
            const shownGigs = expandedDates ? pGigs : initial;
            const extraGigs = pGigs.length - initial.length;

            return (
              <section className="pc-card">
                <header className="pc-card__head">
                  <div className="pc-card__identity">
                    <strong className="pc-card__name">{p.name}</strong>
                    {(p.role || p.company) && (
                      <span className="sub">{[p.role, p.company].filter(Boolean).join(' · ')}</span>
                    )}
                  </div>
                  <span className="pc-card__end">
                    {canEdit && (
                      <button type="button" className="btn" onClick={() => void togglePermanent(p)}>
                        {p.permanent ? '★' : '☆'} {fr ? 'Permanent' : 'Permanent'}
                      </button>
                    )}
                    <button type="button" className="btn" onClick={() => void copyPersonalShare(p)}>
                      🔗 {fr ? 'Lien personnel' : 'Personal link'}
                    </button>
                    {canEdit && !editing && !merging && (
                      <button type="button" className="btn" onClick={() => openEdit(p)}>
                        {fr ? 'Modifier' : 'Edit'}
                      </button>
                    )}
                    {isOwner && !merging && people.length > 1 && (
                      <button type="button" className="btn" onClick={() => { setMerging(true); setEditing(false); }}>
                        {fr ? 'Fusionner' : 'Merge'}
                      </button>
                    )}
                    <button type="button" className="btn" onClick={() => setSelectedId(null)}>
                      {fr ? 'Fermer' : 'Close'}
                    </button>
                  </span>
                </header>

                {editing ? (
                  renderIdentityForm(false)
                ) : merging ? (
                  <div className="pc-edit">
                    <p style={{ margin: '0 0 8px' }}>
                      {fr
                        ? `Fusionner « ${p.name} » dans un autre contact (toutes les dates, fichiers et liens seront transférés) :`
                        : `Merge "${p.name}" into another contact (all dates, files, and links transfer atomically):`}
                    </p>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      <select className="in" value={mergeTarget} onChange={(e) => setMergeTarget(e.target.value)} style={{ maxWidth: 280 }}>
                        <option value="">{fr ? 'Choisir la cible…' : 'Choose target…'}</option>
                        {people
                          .filter((x) => x.id !== p.id)
                          .map((x) => (
                            <option key={x.id} value={x.id}>
                              {x.name} {x.role ? `(${x.role})` : ''}
                            </option>
                          ))}
                      </select>
                      <button type="button" className="btn btn--def" disabled={!mergeTarget || busy} onClick={() => void handleMerge(p)}>
                        {fr ? 'Confirmer la fusion' : 'Confirm merge'}
                      </button>
                      <button type="button" className="btn" onClick={() => setMerging(false)}>
                        {copy.cancel}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="pc-card__body">
                    {/* Col 1: Identity, Quick Actions, Loyalty, Travel Notes */}
                    <div className="pc-col">
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
                        {p.phone && <a className="btn" href={`tel:${tel}`}>{fr ? 'Appeler' : 'Call'}</a>}
                        {wa && <a className="btn" href={wa} target="_blank" rel="noreferrer">WhatsApp</a>}
                        {p.phone && <a className="btn" href={`sms:${tel}`}>SMS</a>}
                        {p.email && <a className="btn" href={`mailto:${p.email}`}>Mail</a>}
                      </div>

                      <dl className="pc-kv">
                        {p.phone && (
                          <div>
                            <dt className="lab">{fr ? 'Tél.' : 'Phone'}</dt>
                            <dd>
                              <button type="button" className="pc-copy mono" onClick={() => void copyTextValue(p.phone!, fr ? 'Téléphone' : 'Phone')}>
                                {p.phone}
                              </button>
                            </dd>
                          </div>
                        )}
                        {p.email && (
                          <div>
                            <dt className="lab">Email</dt>
                            <dd>
                              <button type="button" className="pc-copy" onClick={() => void copyTextValue(p.email!, 'Email')}>
                                {p.email}
                              </button>
                            </dd>
                          </div>
                        )}
                        {p.profile?.aliases && p.profile.aliases.length > 0 && (
                          <div>
                            <dt className="lab">Alias</dt>
                            <dd className="sub">{p.profile.aliases.join(' · ')}</dd>
                          </div>
                        )}
                        {p.notes && (
                          <div>
                            <dt className="lab">Notes</dt>
                            <dd>{p.notes}</dd>
                          </div>
                        )}
                      </dl>

                      {/* Loyalty programs */}
                      {p.loyalty && p.loyalty.length > 0 && (
                        <div className="pc-sec">
                          <div className="lab" style={{ marginBottom: 4 }}>{fr ? 'Fidélité' : 'Loyalty'} ({p.loyalty.length})</div>
                          {p.loyalty.map((l, idx) => (
                            <div key={idx} className="pc-subrow">
                              <span>{l.kind === 'airline' ? '✈' : '🏨'} <b>{l.program}</b></span>
                              <span className="mono">{l.number}</span>
                              <button type="button" className="btn" onClick={() => void copyTextValue(l.number, l.program)}>
                                {fr ? 'Copier' : 'Copy'}
                              </button>
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Travel Route Notes: Visa / Health / Preferences */}
                      {canEdit && (
                        <div className="pc-sec">
                          <div className="lab" style={{ marginBottom: 4 }}>{fr ? 'Notes de route' : 'Travel profile'}</div>
                          {(
                            [
                              ['visa', 'Visa / Passeport'],
                              ['health', fr ? 'Santé / Allergies' : 'Health / Allergies'],
                              ['preferences', fr ? 'Préférences' : 'Preferences'],
                            ] as const
                          ).map(([key, label]) => {
                            const val = p.profile?.[key] || '';
                            const isEd = routeEdit?.field === key;
                            return (
                              <div key={key} style={{ marginBottom: 4 }}>
                                <span className="lab" style={{ marginRight: 6 }}>{label}:</span>
                                {isEd ? (
                                  <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
                                    <input
                                      className="in"
                                      style={{ height: 22, width: 180 }}
                                      value={routeEdit.value}
                                      autoFocus
                                      onChange={(e) => setRouteEdit({ field: key, value: e.target.value })}
                                      onKeyDown={(e) => {
                                        if (e.key === 'Enter') void saveRouteNote(p, key, routeEdit.value);
                                        if (e.key === 'Escape') setRouteEdit(null);
                                      }}
                                    />
                                    <button type="button" className="btn btn--def" onClick={() => void saveRouteNote(p, key, routeEdit.value)}>
                                      OK
                                    </button>
                                  </span>
                                ) : (
                                  <button
                                    type="button"
                                    className="pc-copy"
                                    onClick={() => setRouteEdit({ field: key, value: val })}
                                  >
                                    {val || <span className="sub">{fr ? 'Non renseigné…' : 'Not set…'}</span>}
                                  </button>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>

                    {/* Col 2: Person Documents & Suggested Matches */}
                    <div className="pc-col">
                      <div className="lab" style={{ marginBottom: 6 }}>
                        {fr ? 'Documents' : 'Documents'} ({docs.length})
                      </div>
                      {docs.length ? (
                        docs.map((f) => {
                          const exp = expiryState(f.doc_expires);
                          return (
                            <div key={f.id} className="pc-subrow">
                              <button
                                type="button"
                                className="pc-copy"
                                style={{ flex: 1, textAlign: 'left' }}
                                onClick={() => (onOpenFile ? onOpenFile(f.id) : window.open(fileAssetUrl(f.id, true), '_blank'))}
                              >
                                {f.name}
                              </button>
                              {f.doc_expires && (
                                <span className={`mono ${exp === 'expired' ? 'warn' : 'sub'}`} style={{ fontSize: 11 }}>
                                  {exp === 'expired' ? '!' : ''} {f.doc_expires}
                                </span>
                              )}
                              {canEdit && (
                                <button type="button" className="btn" title={fr ? 'Détacher' : 'Detach'} onClick={() => void assignDoc(f.id, null)}>
                                  ×
                                </button>
                              )}
                            </div>
                          );
                        })
                      ) : (
                        <p className="sub" style={{ margin: 0 }}>{fr ? 'Aucun document associé.' : 'No linked documents.'}</p>
                      )}

                      {sugs.length > 0 && (
                        <div style={{ marginTop: 10 }}>
                          <div className="lab" style={{ marginBottom: 4 }}>
                            {fr ? 'Documents suggérés' : 'Suggested matches'} ({sugs.length})
                          </div>
                          {sugs.map((f) => (
                            <div key={f.id} className="pc-subrow">
                              <span className="truncate" style={{ flex: 1 }}>{f.name}</span>
                              <button type="button" className="btn" onClick={() => void assignDoc(f.id, p.id)}>
                                {fr ? 'Associer' : 'Attach'}
                              </button>
                              <button type="button" className="btn" onClick={() => setDismissedSug((prev) => ({ ...prev, [f.id]: true }))}>
                                ×
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Col 3: Associated Dates */}
                    <div className="pc-col">
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                        <span className="lab">{fr ? 'Dates' : 'Dates'} ({pGigs.length})</span>
                        {extraGigs > 0 && (
                          <button type="button" className="btn" onClick={() => setExpandedDates((v) => !v)}>
                            {expandedDates ? (fr ? 'Réduire' : 'Show less') : `+${extraGigs}`}
                          </button>
                        )}
                      </div>
                      {shownGigs.length ? (
                        shownGigs.map((g) => (
                          <button
                            key={g.id}
                            type="button"
                            className="day"
                            style={{ width: '100%', opacity: g.date < today ? 0.65 : 1 }}
                            onClick={() => onOpenGig(g.id)}
                          >
                            <span className="mono">{g.date}</span>
                            <span className="truncate">
                              <b>{g.city || g.name}</b> {g.venue ? `· ${g.venue}` : ''}
                            </span>
                          </button>
                        ))
                      ) : (
                        <p className="sub" style={{ margin: 0 }}>{fr ? 'Aucune date associée.' : 'No dates assigned.'}</p>
                      )}
                    </div>
                  </div>
                )}
              </section>
            );
          })()
        ) : (
          <p className="sub" style={{ padding: 12, margin: 0 }}>
            {fr ? 'Cliquez un contact pour voir sa fiche complète (téléphone, WhatsApp, fidélité, visa, documents, dates). Double-clic sur une cellule pour modifier sur place.' : 'Click a contact to inspect full card (phone, WhatsApp, loyalty, travel notes, documents, dates). Double-click any cell to edit inline.'}
          </p>
        )}
      </div>
    </div>
  );
}
