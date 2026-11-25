import {
  Building2,
  Car,
  Check,
  Clock,
  Copy,
  MapPin,
  MessageCircle,
  Music,
  Phone,
  Plane,
  RefreshCw,
  Train,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../api/client';
import { formatClock, timelineSortScore } from '../lib/smartParse';
import type { Gig, Locale } from '../types';

type ShareKind = 'flight' | 'train' | 'ground' | 'hotel' | 'schedule' | 'set';

interface ShareRow {
  id: string;
  time: string;
  endTime?: string;
  title: string;
  detail: string;
  kind: ShareKind;
  refCode?: string;
  phone?: string;
  mapsQuery?: string;
}

function fmtShareTerm(val: unknown): string {
  const s = String(val || '').trim();
  if (!s) return '';
  return /^[0-9A-Za-z]{1,3}$/.test(s) && !s.toUpperCase().startsWith('T') ? `T${s}` : s;
}

function KindGlyph({ kind }: { kind: ShareKind }) {
  const cls = 'h-3.5 w-3.5 shrink-0';
  if (kind === 'flight') return <Plane className={cls} />;
  if (kind === 'train') return <Train className={cls} />;
  if (kind === 'ground') return <Car className={cls} />;
  if (kind === 'hotel') return <Building2 className={cls} />;
  if (kind === 'set') return <Music className={cls} />;
  return <Clock className={cls} />;
}

export function SharePage({ shareKey }: { shareKey: string }) {
  const [locale, setLocale] = useState<Locale>(() => (localStorage.getItem('td_locale') as Locale) || 'en');
  const fr = locale === 'fr';
  const [data, setData] = useState<{
    scope: string;
    label: string;
    person?: { id: string; name: string; role?: string } | null;
    gigs: Gig[];
    show_footer?: boolean;
    launch_url?: string;
  } | null>(null);
  const [error, setError] = useState<boolean>(false);
  const [selectedId, setSelectedId] = useState<string>('');
  const [copiedId, setCopiedId] = useState<string | null>(null);

  useEffect(() => {
    localStorage.setItem('td_locale', locale);
    document.documentElement.lang = locale;
  }, [locale]);

  const load = useCallback(async () => {
    setError(false);
    try {
      const res = await api.resolveShare(shareKey);
      setData(res);
      const today = new Date().toISOString().slice(0, 10);
      const sorted = res.gigs.slice().sort((a, b) => a.date.localeCompare(b.date));
      const hashId = window.location.hash.startsWith('#/gig/') ? decodeURIComponent(window.location.hash.slice(6)) : '';
      const initial =
        sorted.find((g) => g.id === hashId)?.id ||
        sorted.find((g) => g.date >= today)?.id ||
        sorted[0]?.id ||
        '';
      setSelectedId((prev) => prev || initial);
    } catch {
      setError(true);
    }
  }, [shareKey]);

  useEffect(() => {
    void load();
  }, [load]);

  const gigs = useMemo(() => (data?.gigs || []).slice().sort((a, b) => a.date.localeCompare(b.date)), [data]);
  const selected = gigs.find((g) => g.id === selectedId) || gigs[0] || null;

  const months = useMemo(() => {
    const map = new Map<string, Gig[]>();
    for (const g of gigs) {
      const ym = (g.date || '0000-00').slice(0, 7);
      const list = map.get(ym) || [];
      list.push(g);
      map.set(ym, list);
    }
    return [...map.entries()].map(([ym, list]) => {
      const d = new Date(`${ym}-15T12:00:00Z`);
      const label = Number.isNaN(d.getTime())
        ? ym
        : new Intl.DateTimeFormat(fr ? 'fr-FR' : 'en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(d);
      return { ym, label: label.charAt(0).toUpperCase() + label.slice(1), list };
    });
  }, [gigs, fr]);

  const timeline = useMemo<ShareRow[]>(() => {
    if (!selected) return [];
    const out: ShareRow[] = [];
    for (const it of selected.items || []) {
      const d = it.data || {};
      if (it.collection === 'flights') {
        const refCode = String(d.booking_ref || d.pnr || d.ref || '') || undefined;
        const term =
          [fmtShareTerm(d.terminal_dep), fmtShareTerm(d.terminal_arr)].filter(Boolean).join(' → ') || fmtShareTerm(d.terminal);
        const seat = String(d.seat || d.seats || '').trim();
        out.push({
          id: it.id,
          time: String(d.dep_time || ''),
          endTime: d.arr_time ? String(d.arr_time) : undefined,
          title: `${d.flight_no || (fr ? 'Vol' : 'Flight')} · ${d.dep_iata || ''} → ${d.arr_iata || ''}`,
          detail: [
            d.airline ? String(d.airline) : '',
            term,
            d.gate ? `Gate ${d.gate}` : '',
            seat ? `${fr ? 'Siège' : 'Seat'} ${seat}` : '',
            refCode ? `PNR ${refCode}` : '',
          ]
            .filter(Boolean)
            .join(' · '),
          kind: 'flight',
          refCode,
          mapsQuery: String(d.arr_city || d.arr_iata || selected.city || ''),
        });
      } else if (it.collection === 'transport') {
        const from = String(d.from || d.pickup || '?');
        const to = String(d.to || d.dropoff || '?');
        const driver = String(d.driver_name || d.driver || '');
        const phone = d.driver_phone ? String(d.driver_phone) : undefined;
        const mode = String(d.mode || '').toLowerCase();
        out.push({
          id: it.id,
          time: String(d.time || ''),
          endTime: d.arr_time ? String(d.arr_time) : undefined,
          title: `${from} → ${to}`,
          detail: [driver, phone, d.vehicle ? String(d.vehicle) : ''].filter(Boolean).join(' · '),
          kind: mode === 'train' ? 'train' : 'ground',
          phone,
          mapsQuery: to !== '?' ? to : from,
        });
      } else if (it.collection === 'hotels') {
        const ci = String(d.check_in || d.checkin || '15:00');
        const co = String(d.check_out || d.checkout || '');
        const refCode = String(d.confirmation || d.booking_ref || d.ref || '') || undefined;
        out.push({
          id: it.id,
          time: ci,
          title: String(d.name || (fr ? 'Hôtel' : 'Hotel')),
          detail: [
            d.address ? String(d.address) : '',
            refCode ? `Conf ${refCode}` : '',
            d.room_type ? String(d.room_type) : '',
            co ? `out ${formatClock(co, locale)}` : '',
          ]
            .filter(Boolean)
            .join(' · '),
          kind: 'hotel',
          refCode,
          phone: d.phone ? String(d.phone) : undefined,
          mapsQuery: String(d.address || d.name || ''),
        });
      } else if (it.collection === 'schedule') {
        out.push({
          id: it.id,
          time: String(d.time || ''),
          endTime: d.end_time ? String(d.end_time) : undefined,
          title: String(d.title || d.label || ''),
          detail: [d.location ? String(d.location) : '', d.notes ? String(d.notes) : ''].filter(Boolean).join(' · '),
          kind: 'schedule',
          mapsQuery: d.location ? String(d.location) : undefined,
        });
      }
    }
    if (selected.set_time) {
      out.push({
        id: '__set__',
        time: selected.set_time,
        endTime: selected.set_end || undefined,
        title: `★ SET — ${selected.venue || selected.city}`,
        detail: [
          selected.venue_address,
          selected.doors_time ? `Doors ${formatClock(selected.doors_time, locale)}` : '',
        ]
          .filter(Boolean)
          .join(' · '),
        kind: 'set',
        mapsQuery: String(selected.venue_address || selected.venue || selected.city || ''),
      });
    }
    return out.sort(
      (a, b) => timelineSortScore(a.time, selected.date, a.kind) - timelineSortScore(b.time, selected.date, b.kind),
    );
  }, [selected, fr, locale]);

  const lineup = useMemo(() => {
    if (!selected) return [];
    return (selected.items || [])
      .filter((it) => it.collection === 'timetable')
      .sort(
        (a, b) =>
          timelineSortScore(String(a.data.start || ''), selected.date, 'set') -
          timelineSortScore(String(b.data.start || ''), selected.date, 'set'),
      );
  }, [selected]);

  const heroRow = timeline[0] || null;

  function openGig(id: string) {
    setSelectedId(id);
    window.history.replaceState(null, '', `${window.location.pathname}#/gig/${encodeURIComponent(id)}`);
  }

  async function flashCopy(id: string, text: string) {
    await navigator.clipboard.writeText(text).catch(() => undefined);
    setCopiedId(id);
    window.setTimeout(() => setCopiedId((cur) => (cur === id ? null : cur)), 1800);
  }

  async function copyDay() {
    if (!selected) return;
    const lines = [
      `${selected.date} — ${selected.city}${selected.venue ? ` (${selected.venue})` : ''}`,
      ...timeline.map(
        (r) => `${r.time ? formatClock(r.time, locale) : '--:--'}  ${r.title}${r.detail ? ` (${r.detail})` : ''}`,
      ),
      selected.notes ? `\nNotes: ${selected.notes}` : '',
    ].filter(Boolean);
    await flashCopy('day', lines.join('\n'));
  }

  if (error) {
    return (
      <div className="dk-root items-center justify-center p-4">
        <div style={{ width: '100%', maxWidth: 420 }}>
          <div className="ytab">
            <span className="box" />
            <span>{fr ? 'tourdesigner · Lien voyageur' : 'tourdesigner · Traveler link'}</span>
          </div>
          <div className="win" style={{ padding: 16 }}>
            <strong className="warn">{fr ? 'Lien invalide ou désactivé.' : 'Link invalid or disabled.'}</strong>
            <p className="sub">
              {fr ? 'Demandez un nouveau lien à votre tour manager.' : 'Ask your tour manager for an updated link.'}
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="dk-root items-center justify-center" style={{ color: 'var(--cv-on-desk)' }}>
        {fr ? 'Chargement de votre itinéraire…' : 'Loading itinerary…'}
      </div>
    );
  }

  return (
    <div className="dk-root">
      <div className="dk-page">
        {/* Desktop Left Traveler Sidebar */}
        <aside className="win dk-bar">
          <div className="dk-bar__head">
            <strong className="dk-bar__tour">Tour</strong>
            <span className="sub truncate">{data.person?.name || data.label}</span>
          </div>
          <div className="dk-dates">
            {months.map((m) => (
              <div key={m.ym}>
                <div className="lab dk-month">
                  {m.label} · {m.list.length}
                </div>
                {m.list.map((g) => (
                  <button
                    key={g.id}
                    type="button"
                    className={`day${selected?.id === g.id ? ' day--on' : ''}`}
                    onClick={() => openGig(g.id)}
                  >
                    <span className="mono">{g.date.slice(5)}</span>
                    <span className="truncate">{g.city || g.name}</span>
                  </button>
                ))}
              </div>
            ))}
          </div>
          <div className="dk-bar__foot" style={{ display: 'flex', gap: 6 }}>
            <button type="button" className="btn flex-1" onClick={() => void load()}>
              <RefreshCw className="h-3.5 w-3.5" /> {fr ? 'Actualiser' : 'Refresh'}
            </button>
            <button
              type="button"
              className="btn mono"
              onClick={() => setLocale(fr ? 'en' : 'fr')}
              title={fr ? 'Switch to English' : 'Passer en français'}
            >
              {fr ? 'EN' : 'FR'}
            </button>
          </div>
        </aside>

        {/* Main Traveler Handheld / Desktop Window */}
        <main className="dk-main">
          <div className="dk-tabrow">
            <h1 className="ytab" style={{ margin: '0 0 -1px -1px' }}>
              <span className="box" />
              <span className="truncate">{selected ? selected.city || selected.name : data.label}</span>
              {selected?.venue && <span className="dk-venue truncate">{selected.venue}</span>}
            </h1>
            <div className="m2032-tray no-print">
              <button
                type="button"
                className="m2032-tray__btn mono"
                style={{ fontSize: 11, fontWeight: 700, padding: '0 8px' }}
                onClick={() => setLocale(fr ? 'en' : 'fr')}
                aria-label="Toggle language"
              >
                {fr ? 'EN' : 'FR'}
              </button>
              <button type="button" className="m2032-tray__btn" onClick={() => void load()} aria-label="Refresh">
                <RefreshCw className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>

          <div className="win" style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
            {gigs.length > 1 && (
              <div className="m2032-share-dates">
                {gigs.map((g) => (
                  <button
                    key={g.id}
                    type="button"
                    className={`m2032-fpill${selected?.id === g.id ? ' m2032-fpill--on' : ''}`}
                    onClick={() => openGig(g.id)}
                  >
                    <span className="mono">{g.date.slice(5)}</span>
                    <span>{g.city || g.name}</span>
                  </button>
                ))}
              </div>
            )}

            {selected ? (
              <div className="m2032-scroll" style={{ paddingBottom: 24 }}>
                <div className="m2032-datestrip" style={{ justifyContent: 'space-between', padding: '8px 12px' }}>
                  <div className="min-w-0">
                    <strong className="mono">{selected.date}</strong> · <b>{selected.city}</b>
                    {selected.venue ? <span className="sub"> · {selected.venue}</span> : null}
                  </div>
                  <button type="button" className="btn btn--def" style={{ minHeight: 28, fontSize: 12 }} onClick={() => void copyDay()}>
                    {copiedId === 'day' ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                    {copiedId === 'day' ? (fr ? 'Copié ✓' : 'Copied ✓') : fr ? 'Copier' : 'Copy'}
                  </button>
                </div>

                {heroRow && (
                  <section className="m2032-hero">
                    <div className="m2032-hero__top">
                      <span className="m2032-hero__kicker">
                        <i className="m2032-led" />
                        {fr ? 'À SUIVRE' : 'UP NEXT'}
                      </span>
                      <span className="mono m2032-hero__clock">
                        {formatClock(heroRow.time, locale)}
                        {heroRow.endTime ? `–${formatClock(heroRow.endTime, locale)}` : ''}
                      </span>
                    </div>
                    <div className="m2032-hero__title">
                      <span className={`m2032-kind m2032-kind--${heroRow.kind}`}>
                        <KindGlyph kind={heroRow.kind} />
                      </span>
                      <span className="truncate">{heroRow.title}</span>
                    </div>
                    {heroRow.detail && <div className="m2032-hero__sub">{heroRow.detail}</div>}
                    <div className="m2032-hero__acts">
                      {heroRow.refCode && (
                        <button type="button" className="btn btn--def m2032-hero__cta" onClick={() => void flashCopy('hero', heroRow.refCode!)}>
                          {copiedId === 'hero' ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                          {copiedId === 'hero'
                            ? fr
                              ? 'Copié ✓'
                              : 'Copied ✓'
                            : fr
                              ? `Copier ${heroRow.refCode}`
                              : `Copy ${heroRow.refCode}`}
                        </button>
                      )}
                      {heroRow.mapsQuery && (
                        <a
                          className="btn m2032-hero__btn"
                          href={`https://maps.google.com/?q=${encodeURIComponent(`${heroRow.mapsQuery} ${selected.city}`)}`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          <MapPin className="h-3.5 w-3.5" /> Maps
                        </a>
                      )}
                    </div>
                  </section>
                )}

                <div className="m2032-timeline">
                  {timeline.length === 0 ? (
                    <p className="sub" style={{ padding: 14 }}>
                      {fr ? 'Aucun horaire publié pour cette date.' : 'No schedule published for this date yet.'}
                    </p>
                  ) : (
                    timeline.map((r) => {
                      const digits = (r.phone || '').replace(/[^\d+]/g, '');
                      const wa = digits.replace(/^\+/, '');
                      return (
                        <article key={r.id} className={`m2032-card m2032-card--${r.kind}`}>
                          <div className="m2032-card__rail">
                            <span className="mono m2032-card__t1">{r.time ? formatClock(r.time, locale) : '—'}</span>
                            {r.endTime && <span className="mono m2032-card__t2">{formatClock(r.endTime, locale)}</span>}
                            <span className={`m2032-railbar m2032-railbar--${r.kind}`} />
                          </div>
                          <div className="m2032-card__body">
                            <div className="m2032-card__head">
                              <span className={`m2032-kind m2032-kind--${r.kind}`}>
                                <KindGlyph kind={r.kind} />
                              </span>
                              <strong className="m2032-card__title">{r.title}</strong>
                            </div>
                            {r.detail && <div className="m2032-card__sub">{r.detail}</div>}
                            <div className="m2032-card__meta">
                              <div className="m2032-card__quick" style={{ marginLeft: 'auto' }}>
                                {r.refCode && (
                                  <button type="button" className="m2032-qbtn mono" onClick={() => void flashCopy(r.id, r.refCode!)}>
                                    {copiedId === r.id ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                                    {r.refCode}
                                  </button>
                                )}
                                {digits.length >= 7 && (
                                  <>
                                    <a className="m2032-qicon" href={`tel:${digits}`} aria-label="Call"><Phone className="h-3.5 w-3.5" /></a>
                                    <a className="m2032-qicon" href={`https://wa.me/${wa}`} target="_blank" rel="noreferrer" aria-label="WhatsApp"><MessageCircle className="h-3.5 w-3.5" /></a>
                                  </>
                                )}
                                {r.mapsQuery && (
                                  <a
                                    className="m2032-qicon"
                                    href={`https://maps.google.com/?q=${encodeURIComponent(`${r.mapsQuery} ${selected.city}`)}`}
                                    target="_blank"
                                    rel="noreferrer"
                                    aria-label="Maps"
                                  >
                                    <MapPin className="h-3.5 w-3.5" />
                                  </a>
                                )}
                              </div>
                            </div>
                          </div>
                        </article>
                      );
                    })
                  )}
                </div>

                {lineup.length > 0 && (
                  <div style={{ margin: '10px 10px 0' }}>
                    <div className="sep">
                      <span>Running order</span>
                      <span className="mono">{lineup.length}</span>
                    </div>
                    {lineup.map((it) => {
                      const isUs = Boolean(it.data.is_us);
                      return (
                        <div key={it.id} className={`m2032-slot${isUs ? ' m2032-slot--us' : ''}`}>
                          <span className="mono m2032-slot__time">
                            {formatClock(String(it.data.start || ''), locale)}
                            {it.data.end ? `–${formatClock(String(it.data.end), locale)}` : ''}
                          </span>
                          <strong>
                            {isUs ? '★ ' : ''}
                            {String(it.data.act || it.data.artist || '')}
                          </strong>
                        </div>
                      );
                    })}
                  </div>
                )}

                {selected.notes && (
                  <div style={{ margin: '12px 10px 0', padding: 12, background: 'var(--cv-paper2)', border: '1px solid var(--cv-line2)' }}>
                    <div className="lab">Notes</div>
                    <p style={{ margin: '4px 0 0', whiteSpace: 'pre-wrap' }}>{selected.notes}</p>
                  </div>
                )}

                {data?.show_footer && (
                  <div
                    className="no-print"
                    style={{
                      margin: '16px 10px 8px',
                      paddingTop: 10,
                      borderTop: '1px solid var(--cv-line)',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      fontSize: 11,
                    }}
                  >
                    <a
                      href={data.launch_url || '/'}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="sub underline"
                      style={{ textDecoration: 'underline' }}
                    >
                      {fr
                        ? 'Créé avec Tour Designer — Feuilles de route hors ligne gratuites →'
                        : 'Built with Tour Designer — Free offline roadsheets →'}
                    </a>
                  </div>
                )}
              </div>
            ) : (
              <p className="sub" style={{ padding: 16 }}>
                {fr ? 'Aucune date disponible sur ce lien.' : 'No dates available on this link.'}
              </p>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}
