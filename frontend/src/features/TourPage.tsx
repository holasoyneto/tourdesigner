import { Archive, ChevronRight, Pencil, Plus, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { api } from '../api/client';
import { AutocompleteInput, type SuggestionOption } from '../components/AutocompleteInput';
import type { CopyDict } from '../i18n/copy';
import { foldText, parseSmartClockCell, parseStatusWord, STATUS_LABELS } from '../lib/smartParse';
import { useIsMobile } from '../lib/useIsMobile';
import type { TourSyncState } from '../offline/sync';
import type { Gig, GigItem, GigStatus, Locale, User } from '../types';

interface Props {
  gigs: Gig[];
  itemsByGig: Record<string, GigItem[]>;
  user: User;
  locale: Locale;
  copy: CopyDict;
  sync: TourSyncState;
  onOpenGig: (id: string) => void;
  onNewDate: () => void;
}

type TourFilter = 'next' | 'option' | 'todo' | 'past' | 'archived';
type EditField = 'city' | 'venue' | 'set' | 'status';

function monthKeyLabel(ym: string, locale: Locale): string {
  const d = new Date(`${ym}-15T12:00:00`);
  if (Number.isNaN(d.getTime())) return ym;
  return new Intl.DateTimeFormat(locale === 'fr' ? 'fr-FR' : 'en-GB', { month: 'long', year: 'numeric' }).format(d);
}

export function TourPage({ gigs, itemsByGig, user, locale, copy, sync, onOpenGig, onNewDate }: Props) {
  const canEdit = user.role !== 'viewer';
  const isMobile = useIsMobile();
  const [filter, setFilter] = useState<TourFilter>('next');
  const [query, setQuery] = useState('');
  const [pickedId, setPickedId] = useState<string>('');
  const [editing, setEditing] = useState<{ gigId: string; field: EditField; draft: string } | null>(null);
  const [cityOpts, setCityOpts] = useState<SuggestionOption[]>([]);
  const [errMsg, setErrMsg] = useState<string | null>(null);

  const today = new Date().toISOString().slice(0, 10);

  const readinessOf = (g: Gig) => {
    const list = itemsByGig[g.id] || [];
    const flights = list.filter((i) => i.collection === 'flights').length;
    const hotels = list.filter((i) => i.collection === 'hotels').length;
    const people = list.filter((i) => i.collection === 'crew' || i.collection === 'contacts').length;
    const missing: string[] = [];
    if (!g.venue) missing.push(locale === 'fr' ? 'lieu' : 'venue');
    if (!flights) missing.push(locale === 'fr' ? 'vol' : 'flight');
    if (!hotels) missing.push(locale === 'fr' ? 'hôtel' : 'hotel');
    return {
      flights,
      hotels,
      people,
      needsWork: !g.archived && g.date >= today && g.status !== 'cancelled' && missing.length > 0,
      note: missing.length ? `${locale === 'fr' ? 'Manque' : 'Missing'}: ${missing.join(', ')}` : `✈ ${flights} · 🏨 ${hotels}`,
      warn: missing.length > 0,
    };
  };

  const counts = useMemo(() => {
    const active = gigs.filter((g) => !g.archived);
    return {
      next: active.filter((g) => !g.date || g.date >= today).length,
      option: active.filter((g) => (!g.date || g.date >= today) && (g.status === 'hold' || g.status === 'pending')).length,
      todo: active.filter((g) => readinessOf(g).needsWork).length,
      past: active.filter((g) => Boolean(g.date && g.date < today)).length,
      archived: gigs.filter((g) => g.archived).length,
    };
  }, [gigs, itemsByGig, today]);

  const shown = useMemo(() => {
    const q = foldText(query.trim());
    return gigs
      .filter((g) => {
        if (filter === 'archived') return g.archived;
        if (g.archived) return false;
        if (filter === 'past') return Boolean(g.date && g.date < today);
        if (g.date && g.date < today) return false;
        if (filter === 'option') return g.status === 'hold' || g.status === 'pending';
        if (filter === 'todo') return readinessOf(g).needsWork;
        return true;
      })
      .filter((g) => !q || foldText(`${g.city} ${g.venue} ${g.country} ${g.date} ${g.promoter || ''}`).includes(q))
      .sort((a, b) => (filter === 'past' ? b.date.localeCompare(a.date) : a.date.localeCompare(b.date)));
  }, [gigs, itemsByGig, filter, query, today]);

  const grouped = useMemo(() => {
    const out: Array<{ sep: true; key: string; label: string } | { sep: false; gig: Gig }> = [];
    let lastYm = '';
    for (const g of shown) {
      const ym = (g.date || '0000-00').slice(0, 7);
      if (ym !== lastYm) {
        lastYm = ym;
        out.push({ sep: true, key: `sep-${ym}`, label: monthKeyLabel(ym, locale) });
      }
      out.push({ sep: false, gig: g });
    }
    return out;
  }, [shown, locale]);

  const venuePool = useMemo<SuggestionOption[]>(
    () =>
      [...new Set(gigs.map((g) => g.venue?.trim()).filter(Boolean) as string[])].map((v) => ({
        value: v,
        label: v,
      })),
    [gigs],
  );

  const statusPool = useMemo<SuggestionOption[]>(
    () =>
      (Object.entries(STATUS_LABELS[locale]) as Array<[GigStatus, string]>).map(([k, label]) => ({
        value: label,
        label,
        sub: k,
      })),
    [locale],
  );

  const sel = shown.find((g) => g.id === pickedId) || shown[0] || null;

  async function onCityDraft(val: string) {
    setEditing((cur) => (cur ? { ...cur, draft: val } : null));
    if (val.trim().length >= 2) {
      const res = await api.searchCities(val).catch(() => ({ cities: [] }));
      setCityOpts(res.cities.slice(0, 6).map((c) => ({ value: c.city, label: `${c.city}, ${c.country}`, sub: c.timezone })));
    } else {
      setCityOpts([]);
    }
  }

  async function commitInline(g: Gig, field: EditField, raw: string, chosen?: SuggestionOption) {
    setErrMsg(null);
    if (field === 'city') {
      const city = (chosen?.value || raw).trim();
      setEditing(null);
      if (city && city !== g.city) {
        const patch: Record<string, unknown> = { city };
        if (chosen?.sub) patch.timezone = chosen.sub;
        if (chosen?.label.includes(', ')) patch.country = chosen.label.split(', ').slice(1).join(', ');
        await sync.updateGigHeader(g.id, patch);
      }
    } else if (field === 'venue') {
      const venue = raw.trim();
      setEditing(null);
      if (venue !== g.venue) await sync.updateGigHeader(g.id, { venue });
    } else if (field === 'set') {
      const parsed = parseSmartClockCell(raw, g.set_time, g.set_end);
      if (!parsed.ok) {
        setErrMsg(parsed.error);
        return;
      }
      setEditing(null);
      await sync.updateGigHeader(g.id, { set_time: parsed.start, set_end: parsed.end });
    } else if (field === 'status') {
      const st = parseStatusWord(raw);
      if (!st) {
        setErrMsg(locale === 'fr' ? 'Statut non reconnu (Confirmé, Option, Annulé…)' : 'Unknown status');
        return;
      }
      setEditing(null);
      if (st !== g.status) await sync.updateGigHeader(g.id, { status: st });
    }
  }

  const filterTabs: Array<{ id: TourFilter; label: string; n: number }> = [
    { id: 'next', label: locale === 'fr' ? 'À venir' : 'Upcoming', n: counts.next },
    { id: 'option', label: locale === 'fr' ? 'Options' : 'Holds', n: counts.option },
    { id: 'todo', label: locale === 'fr' ? 'À préparer' : 'To advance', n: counts.todo },
    { id: 'past', label: locale === 'fr' ? 'Passées' : 'Past', n: counts.past },
    { id: 'archived', label: locale === 'fr' ? 'Archivées' : 'Archived', n: counts.archived },
  ];

  const colStyle = { gridTemplateColumns: '112px minmax(0, 1.3fr) minmax(0, 1.2fr) 118px 112px minmax(0, 1.1fr)' };

  if (isMobile) {
    return (
      <div className="m2032-tour">
        {/* Horizontal scrollable filter strip */}
        <div className="m2032-tour__filters">
          {filterTabs.map((t) => (
            <button
              key={t.id}
              type="button"
              className={`m2032-fpill${filter === t.id ? ' m2032-fpill--on' : ''}`}
              onClick={() => setFilter(t.id)}
            >
              <span>{t.label}</span>
              <span className="mono">{t.n}</span>
            </button>
          ))}
        </div>

        {/* Search + New Date Strip */}
        <div className="m2032-tour__search">
          <input
            className="in"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={locale === 'fr' ? 'Filtrer par ville ou salle…' : 'Filter city or venue…'}
          />
          {canEdit && (
            <button type="button" className="btn btn--def shrink-0" onClick={onNewDate}>
              <Plus className="h-3.5 w-3.5" /> {locale === 'fr' ? 'Date' : 'Date'}
            </button>
          )}
        </div>

        {/* 2032 Boarding-Pass Tour Ticket Cards */}
        <div className="m2032-tour__list">
          {grouped.length === 0 ? (
            <div className="sub" style={{ padding: 18, textAlign: 'center' }}>{copy.noDates}</div>
          ) : (
            grouped.map((entry) => {
              if (entry.sep) {
                return (
                  <div key={entry.key} className="sep" style={{ textTransform: 'capitalize' }}>
                    {entry.label}
                  </div>
                );
              }
              const g = entry.gig;
              const r = readinessOf(g);
              const d = g.date ? new Date(`${g.date}T12:00:00Z`) : null;
              const wk = d && !Number.isNaN(d.getTime())
                ? new Intl.DateTimeFormat(locale === 'fr' ? 'fr-FR' : 'en-GB', { weekday: 'short', timeZone: 'UTC' }).format(d).replace('.', '').toUpperCase()
                : 'TBD';
              const dayNum = g.date ? g.date.slice(8, 10) : '--';
              const monShort = d && !Number.isNaN(d.getTime())
                ? new Intl.DateTimeFormat(locale === 'fr' ? 'fr-FR' : 'en-GB', { month: 'short', timeZone: 'UTC' }).format(d).replace('.', '').toUpperCase()
                : '';
              const setFmt = g.set_time
                ? locale === 'fr'
                  ? `${g.set_time.replace(':', 'h')}${g.set_end ? `–${g.set_end.replace(':', 'h')}` : ''}`
                  : `${g.set_time}${g.set_end ? `–${g.set_end}` : ''}`
                : '';

              return (
                <button
                  key={g.id}
                  type="button"
                  className="m2032-ticket"
                  onClick={() => onOpenGig(g.id)}
                >
                  <div className="m2032-ticket__stamp">
                    <span className="m2032-ticket__wk">{wk}</span>
                    <strong className="mono m2032-ticket__day">{dayNum}</strong>
                    <span className="m2032-ticket__mon">{monShort}</span>
                  </div>
                  <div className="m2032-ticket__body">
                    <div className="m2032-ticket__top">
                      <strong className="m2032-ticket__city">{g.city || g.name}</strong>
                      <span className={`m2032-status${g.status === 'cancelled' ? ' warn' : ''}`}>
                        {STATUS_LABELS[locale][g.status]}
                      </span>
                    </div>
                    <div className="m2032-ticket__venue">
                      <span>{g.venue || '—'}</span>
                      {setFmt && <span className="mono m2032-setpill">{setFmt}</span>}
                    </div>
                    <div className={`m2032-ticket__ready${r.warn ? ' warn' : ' sub'}`}>
                      {r.note}
                    </div>
                  </div>
                  <ChevronRight className="h-4 w-4 shrink-0 opacity-45" />
                </button>
              );
            })
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Top Filter & Action Bar */}
      <div className="dk-datebar">
        <div className="flex flex-wrap gap-1">
          {filterTabs.map((t) => (
            <button
              key={t.id}
              type="button"
              className={`btn${filter === t.id ? ' dk-sect--on' : ''}`}
              onClick={() => setFilter(t.id)}
            >
              <span>{t.label}</span>
              <span className="mono" style={{ opacity: 0.75, fontSize: 11 }}>{t.n}</span>
            </button>
          ))}
        </div>
        <input
          className="in"
          style={{ maxWidth: 210, minHeight: 28 }}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={locale === 'fr' ? 'Filtrer…' : 'Filter…'}
        />
        <div className="dk-datebar__acts">
          {canEdit && (
            <button type="button" className="btn btn--def" onClick={onNewDate}>
              {copy.newDate}
            </button>
          )}
        </div>
      </div>

      {/* Main Tour Tracker Table */}
      <div className="dk-list">
        <div className="cols head" style={colStyle}>
          <span>Date</span>
          <span>{locale === 'fr' ? 'Ville' : 'City'}</span>
          <span>{locale === 'fr' ? 'Salle / Lieu' : 'Venue'}</span>
          <span>Set</span>
          <span>{locale === 'fr' ? 'Statut' : 'Status'}</span>
          <span className="dk-col-hide-sm">{locale === 'fr' ? 'À noter' : 'Readiness'}</span>
        </div>

        {grouped.length === 0 ? (
          <div className="sub p-4">{copy.noDates}</div>
        ) : (
          grouped.map((entry) => {
            if (entry.sep) {
              return <div key={entry.key} className="sep" style={{ textTransform: 'capitalize' }}>{entry.label}</div>;
            }
            const g = entry.gig;
            const r = readinessOf(g);
            const isSel = sel?.id === g.id;
            const isEdit = (f: EditField) => editing?.gigId === g.id && editing.field === f;

            return (
              <div
                key={g.id}
                className={`cols item${isSel ? ' item--on' : ''}`}
                style={colStyle}
                onClick={() => setPickedId(g.id)}
                onDoubleClick={() => onOpenGig(g.id)}
              >
                <span className="mono">{g.date || 'TBD'}</span>

                {/* City (inline editable with live /api/places/cities autocomplete) */}
                <div className={`item__cell${isEdit('city') ? ' item__cell--edit' : ''}`} onClick={(e) => { if (isEdit('city')) e.stopPropagation(); }}>
                  {isEdit('city') ? (
                    <AutocompleteInput
                      value={editing!.draft}
                      onChange={(v) => void onCityDraft(v)}
                      onCommit={(v, opt) => void commitInline(g, 'city', v, opt)}
                      onCancel={() => { setEditing(null); setErrMsg(null); }}
                      suggestions={cityOpts}
                    />
                  ) : (
                    <>
                      <span className="truncate" style={{ fontWeight: 600 }}>{g.city || g.name}</span>
                      {canEdit && (
                        <button
                          type="button"
                          className="ml-auto opacity-45 hover:opacity-100"
                          style={{ background: 'none', border: 0, color: 'inherit', cursor: 'pointer', padding: 2 }}
                          onClick={(e) => { e.stopPropagation(); setEditing({ gigId: g.id, field: 'city', draft: g.city }); }}
                        >
                          <Pencil className="h-3 w-3" />
                        </button>
                      )}
                    </>
                  )}
                </div>

                {/* Venue (inline editable with tour venue autocomplete) */}
                <div className={`item__cell${isEdit('venue') ? ' item__cell--edit' : ''}`} onClick={(e) => { if (isEdit('venue')) e.stopPropagation(); }}>
                  {isEdit('venue') ? (
                    <AutocompleteInput
                      value={editing!.draft}
                      onChange={(v) => setEditing({ ...editing!, draft: v })}
                      onCommit={(v) => void commitInline(g, 'venue', v)}
                      onCancel={() => { setEditing(null); setErrMsg(null); }}
                      suggestions={venuePool.filter((o) => foldText(o.label).includes(foldText(editing!.draft))).slice(0, 6)}
                    />
                  ) : (
                    <>
                      <span className="truncate">{g.venue || '—'}</span>
                      {canEdit && (
                        <button
                          type="button"
                          className="ml-auto opacity-45 hover:opacity-100"
                          style={{ background: 'none', border: 0, color: 'inherit', cursor: 'pointer', padding: 2 }}
                          onClick={(e) => { e.stopPropagation(); setEditing({ gigId: g.id, field: 'venue', draft: g.venue }); }}
                        >
                          <Pencil className="h-3 w-3" />
                        </button>
                      )}
                    </>
                  )}
                </div>

                {/* Set range (smart clock with duration carry) */}
                <div className={`mono item__cell${isEdit('set') ? ' item__cell--edit' : ''}`} onClick={(e) => { if (isEdit('set')) e.stopPropagation(); }}>
                  {isEdit('set') ? (
                    <input
                      className="in mono"
                      style={{ minHeight: 24, padding: '2px 5px' }}
                      value={editing!.draft}
                      onChange={(e) => setEditing({ ...editing!, draft: e.target.value })}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') { e.preventDefault(); void commitInline(g, 'set', editing!.draft); }
                        if (e.key === 'Escape') { setEditing(null); setErrMsg(null); }
                      }}
                      onBlur={() => void commitInline(g, 'set', editing!.draft)}
                      autoFocus
                    />
                  ) : (
                    <>
                      <span>
                        {g.set_time
                          ? locale === 'fr'
                            ? `${g.set_time.replace(':', 'h')}${g.set_end ? `–${g.set_end.replace(':', 'h')}` : ''}`
                            : `${g.set_time}${g.set_end ? `–${g.set_end}` : ''}`
                          : '—'}
                      </span>
                      {canEdit && (
                        <button
                          type="button"
                          className="ml-auto opacity-45 hover:opacity-100"
                          style={{ background: 'none', border: 0, color: 'inherit', cursor: 'pointer', padding: 2 }}
                          onClick={(e) => { e.stopPropagation(); setEditing({ gigId: g.id, field: 'set', draft: g.set_time ? `${g.set_time}${g.set_end ? ` → ${g.set_end}` : ''}` : '' }); }}
                        >
                          <Pencil className="h-3 w-3" />
                        </button>
                      )}
                    </>
                  )}
                </div>

                {/* Status (inline FR/EN status autocomplete) */}
                <div className={`item__cell${isEdit('status') ? ' item__cell--edit' : ''}`} onClick={(e) => { if (isEdit('status')) e.stopPropagation(); }}>
                  {isEdit('status') ? (
                    <AutocompleteInput
                      value={editing!.draft}
                      onChange={(v) => setEditing({ ...editing!, draft: v })}
                      onCommit={(v) => void commitInline(g, 'status', v)}
                      onCancel={() => { setEditing(null); setErrMsg(null); }}
                      suggestions={statusPool.filter((s) => foldText(`${s.label} ${s.sub}`).includes(foldText(editing!.draft)))}
                    />
                  ) : (
                    <>
                      <span className={g.status === 'cancelled' ? 'warn' : ''}>{STATUS_LABELS[locale][g.status]}</span>
                      {canEdit && (
                        <button
                          type="button"
                          className="ml-auto opacity-45 hover:opacity-100"
                          style={{ background: 'none', border: 0, color: 'inherit', cursor: 'pointer', padding: 2 }}
                          onClick={(e) => { e.stopPropagation(); setEditing({ gigId: g.id, field: 'status', draft: STATUS_LABELS[locale][g.status] }); }}
                        >
                          <Pencil className="h-3 w-3" />
                        </button>
                      )}
                    </>
                  )}
                </div>

                {/* Readiness / Note */}
                <span className={`dk-col-hide-sm ${r.warn && !isSel ? 'warn' : 'sub'}`} style={{ fontWeight: r.warn ? 600 : 400 }}>
                  {r.note}
                </span>
              </div>
            );
          })
        )}
      </div>

      {errMsg && <div className="dk-sheetline"><span className="warn">{errMsg}</span></div>}

      {/* Bottom Selected Date Preview & Lifecycle Bar (.dk-tprev) */}
      {sel && (
        <section className="dk-tprev no-print">
          <strong>{sel.city || sel.name}</strong>
          <span className="mono sub">{sel.date}</span>
          {sel.venue && <span className="sub">· {sel.venue}</span>}
          {typeof sel.fee === 'number' && <span className="mono sub">· {sel.fee.toLocaleString()} {sel.currency}</span>}
          <span className="sub">· {readinessOf(sel).note}</span>
          {user.role === 'owner' && (
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                className="btn"
                onClick={() => void sync.updateGigHeader(sel.id, { archived: !sel.archived })}
              >
                <Archive className="h-3.5 w-3.5" />
                {sel.archived ? (locale === 'fr' ? 'Désarchiver' : 'Unarchive') : (locale === 'fr' ? 'Archiver' : 'Archive')}
              </button>
              <button
                type="button"
                className="btn"
                onClick={() => {
                  if (
                    !window.confirm(
                      locale === 'fr'
                        ? `Mettre « ${sel.city || sel.date} » à la corbeille ?`
                        : `Move "${sel.city || sel.date}" to trash?`,
                    )
                  )
                    return;
                  void api.deleteGig(sel.id).then(() => sync.refreshFull());
                }}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
          <button type="button" className="btn dk-sect--on dk-tprev__open" onClick={() => onOpenGig(sel.id)}>
            {locale === 'fr' ? 'Ouvrir' : 'Open'}
          </button>
        </section>
      )}
    </div>
  );
}
