import { useMemo, useState } from 'react';
import { formatClock, timelineSortScore } from '../lib/smartParse';
import type { Gig, GigItem, Locale, Person, User } from '../types';

type PrintLayout = 'day' | 'driver' | 'internal';

interface Props {
  gig: Gig;
  items: GigItem[];
  people: Person[];
  user: User;
  locale: Locale;
  initialLayout?: PrintLayout;
  onBack: () => void;
}

interface PrintTimelineEntry {
  id: string;
  sortKey: number;
  clock: string;
  subtime?: string;
  kind: 'flight' | 'hotel' | 'transport' | 'schedule' | 'set';
  badgeLabel: string;
  title: string;
  subtitle?: string;
  badges: Array<{ label: string; tone?: 'ref' | 'seat' | 'plain'; href?: string }>;
  notes?: string;
}

function formatDateChip(raw: string, gigDate: string, locale: Locale): string | undefined {
  const m = (raw || '').match(/^(\d{4}-\d{2}-\d{2})/);
  if (!m || m[1] === gigDate) return undefined;
  const d = new Date(`${m[1]}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return m[1];
  return new Intl.DateTimeFormat(locale === 'fr' ? 'fr-FR' : 'en-GB', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  }).format(d);
}

function fmtTerm(val: unknown): string {
  const s = String(val || '').trim();
  if (!s) return '';
  return /^[0-9A-Za-z]{1,3}$/.test(s) && !s.toUpperCase().startsWith('T') ? `T${s}` : s;
}

export function PrintPage({ gig, items, people, user, locale, initialLayout = 'day', onBack }: Props) {
  const fr = locale === 'fr';
  const isOwner = user.role === 'owner';
  const [layout, setLayout] = useState<PrintLayout>(initialLayout === 'internal' && !isOwner ? 'day' : initialLayout);
  const [showRefs, setShowRefs] = useState(true);
  const peopleMap = useMemo(() => new Map(people.map((p) => [p.id, p])), [people]);

  const timeline = useMemo<PrintTimelineEntry[]>(() => {
    const out: PrintTimelineEntry[] = [];
    const includeBookingRefs = layout === 'internal' || (layout === 'day' && showRefs);

    for (const it of items) {
      const d = it.data || {};
      const who = (it.person_ids || []).map((id) => peopleMap.get(id)?.name).filter(Boolean).join(', ');

      if (it.collection === 'flights') {
        const depRaw = String(d.dep_time || d.arr_time || '');
        const arrRaw = String(d.arr_time || '');
        const pnr = String(d.booking_ref || d.pnr || d.ref || '').trim();
        const seatByPerson =
          d.seat_by_person && typeof d.seat_by_person === 'object'
            ? Object.entries(d.seat_by_person as Record<string, string>)
                .map(([pid, s]) => `${(peopleMap.get(pid)?.name || pid).split(' ')[0]} ${s}`)
                .join(' · ')
            : '';
        const seats = seatByPerson || String(d.seat || d.seats || '').trim();
        const term =
          [fmtTerm(d.terminal_dep), fmtTerm(d.terminal_arr)].filter(Boolean).join(' → ') || fmtTerm(d.terminal);

        const badges: PrintTimelineEntry['badges'] = [];
        if (includeBookingRefs && pnr) badges.push({ label: `PNR ${pnr}`, tone: 'ref' });
        if (seats) badges.push({ label: `${fr ? 'Siège' : 'Seat'} ${seats}`, tone: 'seat' });
        if (term) badges.push({ label: term });
        if (d.gate) badges.push({ label: `Gate ${String(d.gate)}` });
        if (d.baggage) badges.push({ label: String(d.baggage) });
        if (who) badges.push({ label: who });

        out.push({
          id: it.id,
          sortKey: timelineSortScore(depRaw, gig.date, 'flight'),
          clock: depRaw ? formatClock(depRaw, locale) : '—',
          subtime: [arrRaw ? `→ ${formatClock(arrRaw, locale)}` : '', formatDateChip(depRaw, gig.date, locale)]
            .filter(Boolean)
            .join(' · '),
          kind: 'flight',
          badgeLabel: fr ? 'Vol' : 'Flight',
          title: `${d.airline ? `${String(d.airline)} · ` : ''}${String(d.flight_no || (fr ? 'Vol' : 'Flight'))} (${d.dep_iata || '?'} → ${d.arr_iata || '?'})`,
          badges,
          notes: d.notes ? String(d.notes) : undefined,
        });
      } else if (it.collection === 'hotels') {
        const ciRaw = String(d.check_in || d.checkin || '15:00');
        const coRaw = String(d.check_out || d.checkout || '');
        const conf = String(d.confirmation || d.booking_ref || d.ref || '').trim();
        const badges: PrintTimelineEntry['badges'] = [];
        if (includeBookingRefs && conf) badges.push({ label: `Conf ${conf}`, tone: 'ref' });
        if (d.room_type) badges.push({ label: String(d.room_type), tone: 'seat' });
        if (coRaw) {
          badges.push({
            label: `Checkout ${/^\d{4}-\d{2}-\d{2}$/.test(coRaw) ? coRaw : formatClock(coRaw, locale)}`,
          });
        }
        if (d.phone) badges.push({ label: String(d.phone), href: `tel:${String(d.phone).replace(/[^\d+]/g, '')}` });
        if (d.wifi_ssid) badges.push({ label: `Wi-Fi: ${String(d.wifi_ssid)}` });
        if (who) badges.push({ label: who });

        const ciTime = /\d{1,2}[h:]\d{2}/.test(ciRaw) ? formatClock(ciRaw, locale) : '15:00';
        out.push({
          id: it.id,
          sortKey: timelineSortScore(ciRaw, gig.date, 'hotel', 900),
          clock: ciTime,
          subtime: formatDateChip(ciRaw, gig.date, locale) || (fr ? 'Check-in' : 'Check-in'),
          kind: 'hotel',
          badgeLabel: fr ? 'Hôtel' : 'Hotel',
          title: String(d.name || (fr ? 'Hôtel' : 'Hotel')),
          subtitle: d.address ? String(d.address) : undefined,
          badges,
          notes: d.notes ? String(d.notes) : undefined,
        });
      } else if (it.collection === 'transport') {
        const from = String(d.from || d.pickup || '?');
        const to = String(d.to || d.dropoff || '?');
        const driver = String(d.driver_name || d.driver || '');
        const pnr = String(d.pnr || d.ref || '').trim();
        const rawTime = String(d.time || '');
        const endRaw = String(d.end_time || d.arr_time || '');

        const badges: PrintTimelineEntry['badges'] = [];
        if (includeBookingRefs && pnr) badges.push({ label: `Ref ${pnr}`, tone: 'ref' });
        if (driver) badges.push({ label: driver });
        if (d.driver_phone) {
          badges.push({ label: String(d.driver_phone), href: `tel:${String(d.driver_phone).replace(/[^\d+]/g, '')}` });
        }
        if (d.vehicle) badges.push({ label: String(d.vehicle) });
        if (who) badges.push({ label: who });

        out.push({
          id: it.id,
          sortKey: timelineSortScore(rawTime, gig.date, 'transport'),
          clock: rawTime ? formatClock(rawTime, locale) : '—',
          subtime: endRaw ? `→ ${formatClock(endRaw, locale)}` : undefined,
          kind: 'transport',
          badgeLabel: String(d.mode || '').toLowerCase() === 'train' ? 'Train' : fr ? 'Trajet' : 'Transfer',
          title: `${from} → ${to}`,
          badges,
          notes: d.notes ? String(d.notes) : undefined,
        });
      } else if (it.collection === 'schedule') {
        const title = String(d.title || d.label || '');
        if (layout === 'driver' && !/pickup|transfer|lobby|airport|hotel|venue|soundcheck|set/i.test(title)) {
          continue;
        }
        const rawTime = String(d.time || '');
        const endRaw = String(d.end_time || '');
        const badges: PrintTimelineEntry['badges'] = [];
        if (who) badges.push({ label: who });

        out.push({
          id: it.id,
          sortKey: timelineSortScore(rawTime, gig.date, 'schedule'),
          clock: rawTime ? formatClock(rawTime, locale) : '—',
          subtime: endRaw ? `→ ${formatClock(endRaw, locale)}` : undefined,
          kind: 'schedule',
          badgeLabel: fr ? 'Planning' : 'Call',
          title,
          subtitle: d.location ? String(d.location) : undefined,
          badges,
          notes: d.notes ? String(d.notes) : undefined,
        });
      }
    }

    if (gig.set_time) {
      const badges: PrintTimelineEntry['badges'] = [];
      if (gig.doors_time) badges.push({ label: `Doors ${formatClock(gig.doors_time, locale)}` });
      if (gig.soundcheck_time) badges.push({ label: `Check ${formatClock(gig.soundcheck_time, locale)}` });
      if (gig.venue_capacity) badges.push({ label: `Cap ${gig.venue_capacity}` });

      out.push({
        id: '__set__',
        sortKey: timelineSortScore(gig.set_time, gig.date, 'set') + (gig.set_day_offset ? gig.set_day_offset * 1440 : 0),
        clock: formatClock(gig.set_time, locale),
        subtime: gig.set_end ? `→ ${formatClock(gig.set_end, locale)}` : undefined,
        kind: 'set',
        badgeLabel: 'Showtime',
        title: `★ SET — ${gig.name || gig.city}`,
        subtitle: [gig.venue, gig.venue_address].filter(Boolean).join(' · ') || undefined,
        badges,
      });
    }

    return out.sort((a, b) => a.sortKey - b.sortKey);
  }, [items, gig, layout, showRefs, peopleMap, fr, locale]);

  const contacts = useMemo(() => {
    const seen = new Set<string>();
    const list: Array<{ name: string; role: string; phone?: string; email?: string; company?: string }> = [];
    for (const it of items) {
      if (it.collection !== 'crew' && it.collection !== 'contacts') continue;
      for (const pid of it.person_ids) {
        if (seen.has(pid)) continue;
        seen.add(pid);
        const p = peopleMap.get(pid);
        if (p) {
          list.push({
            name: p.name,
            role: String(it.data.role || p.role || ''),
            phone: p.phone || undefined,
            email: p.email || undefined,
            company: p.company || undefined,
          });
        }
      }
      if (!it.person_ids.length && it.data.name) {
        list.push({
          name: String(it.data.name),
          role: String(it.data.role || ''),
          phone: it.data.phone ? String(it.data.phone) : undefined,
          email: it.data.email ? String(it.data.email) : undefined,
        });
      }
    }
    return list;
  }, [items, peopleMap]);

  const lineup = useMemo(
    () =>
      items
        .filter((it) => it.collection === 'timetable')
        .sort(
          (a, b) =>
            timelineSortScore(String(a.data.start || ''), gig.date, 'set') -
            timelineSortScore(String(b.data.start || ''), gig.date, 'set'),
        ),
    [items, gig.date],
  );

  const rider = useMemo(() => items.filter((it) => it.collection === 'rider'), [items]);
  const guests = useMemo(() => items.filter((it) => it.collection === 'guests'), [items]);

  const formattedDate = useMemo(() => {
    const d = new Date(`${gig.date}T12:00:00Z`);
    if (Number.isNaN(d.getTime())) return gig.date;
    return new Intl.DateTimeFormat(fr ? 'fr-FR' : 'en-GB', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      timeZone: 'UTC',
    }).format(d);
  }, [gig.date, fr]);

  const mapsVenueUrl = gig.venue_address || gig.venue
    ? `https://maps.google.com/?q=${encodeURIComponent([gig.venue, gig.venue_address, gig.city].filter(Boolean).join(', '))}`
    : null;

  return (
    <div className="pr-root">
      <div className="pr-bar no-print">
        <button type="button" className="btn" onClick={onBack}>
          ‹ {fr ? 'Retour à la fiche' : 'Back to day'}
        </button>
        <div className="segs">
          <button type="button" className={`seg${layout === 'day' ? ' seg--on' : ''}`} onClick={() => setLayout('day')}>
            {fr ? 'Feuille de route' : 'Day sheet'}
          </button>
          <button type="button" className={`seg${layout === 'driver' ? ' seg--on' : ''}`} onClick={() => setLayout('driver')}>
            {fr ? 'Fiche chauffeur' : 'Driver card'}
          </button>
          {isOwner && (
            <button type="button" className={`seg${layout === 'internal' ? ' seg--on' : ''}`} onClick={() => setLayout('internal')}>
              {fr ? 'Dossier interne' : 'Internal pack'}
            </button>
          )}
        </div>
        {layout === 'day' && (
          <label className="inline-flex items-center gap-1.5 text-xs" style={{ color: 'var(--cv-ink)' }}>
            <input type="checkbox" checked={showRefs} onChange={(e) => setShowRefs(e.target.checked)} />
            <span>{fr ? 'PNR & Conf hôtels' : 'PNR & Hotel refs'}</span>
          </label>
        )}
        <button type="button" className="btn btn--def" style={{ marginLeft: 'auto' }} onClick={() => window.print()}>
          {fr ? 'Imprimer / PDF' : 'Print / PDF'}
        </button>
      </div>

      <article className="pr-pg">
        <div className="pr-ribbon" />
        <div className="pr-inner">
          <header className="pr-top">
            <div>
              <p className="pr-kicker">
                {layout === 'driver'
                  ? fr ? 'FICHE CHAUFFEUR · SANS CACHET' : 'DRIVER CARD · DEAL SCRUBBED'
                  : layout === 'internal'
                    ? fr ? 'DOSSIER INTERNE · CONFIDENTIEL' : 'INTERNAL PACK · CONFIDENTIAL'
                    : fr ? 'FEUILLE DE ROUTE COMPLÈTE' : 'TOUR DAY SHEET'}
              </p>
              <h1>
                {gig.city || gig.name}
                {gig.venue ? ` · ${gig.venue}` : ''}
              </h1>
              <p className="pr-date">
                {formattedDate}
                {gig.country ? ` · ${gig.country}` : ''}
              </p>
            </div>

            {gig.set_time && (
              <div className="pr-hero-set">
                <small>{fr ? 'Set principale' : 'Showtime'}</small>
                <strong className="mono">
                  {formatClock(gig.set_time, locale)}
                  {gig.set_end ? `–${formatClock(gig.set_end, locale)}` : ''}
                </strong>
                {gig.doors_time && (
                  <span style={{ fontSize: 11, color: '#d1d5db' }}>
                    Doors {formatClock(gig.doors_time, locale)}
                  </span>
                )}
              </div>
            )}
          </header>

          <dl className="pr-meta">
            <div className="pr-stat">
              <dt>{fr ? 'Salle & Adresse' : 'Venue & Address'}</dt>
              <dd>
                <div>{gig.venue || '—'}</div>
                {gig.venue_address && <div className="sub" style={{ fontWeight: 400, marginTop: 2 }}>{gig.venue_address}</div>}
                {mapsVenueUrl && (
                  <a href={mapsVenueUrl} target="_blank" rel="noreferrer" className="no-print" style={{ fontSize: 11, color: '#0369a1', fontWeight: 700, textDecoration: 'underline' }}>
                    {fr ? 'Ouvrir dans Maps ↗' : 'Open in Maps ↗'}
                  </a>
                )}
              </dd>
            </div>

            <div className="pr-stat">
              <dt>{fr ? 'Horaires Clés' : 'Key Show Times'}</dt>
              <dd className="mono">
                {gig.doors_time ? `Doors ${formatClock(gig.doors_time, locale)}` : 'Doors TBD'}
                {gig.soundcheck_time ? ` · Check ${formatClock(gig.soundcheck_time, locale)}` : ''}
                {gig.set_time ? ` · Set ${formatClock(gig.set_time, locale)}` : ''}
              </dd>
            </div>

            <div className="pr-stat">
              <dt>{fr ? 'Fuseau & Capacité' : 'Timezone & Scale'}</dt>
              <dd>
                <span className="mono">{gig.timezone || 'UTC'}</span>
                {gig.venue_capacity ? ` · Cap ${gig.venue_capacity}` : ''}
                {gig.promoter ? ` · ${gig.promoter}` : ''}
              </dd>
            </div>

            {layout === 'internal' && gig.fee != null && (
              <div className="pr-stat" style={{ background: '#ecfdf5', borderColor: '#6ee7b7' }}>
                <dt style={{ color: '#047857' }}>{fr ? 'Cachet / Accord (Privé)' : 'Deal & Fee (Owner Only)'}</dt>
                <dd className="mono" style={{ color: '#064e3b' }}>
                  {gig.fee.toLocaleString()} {gig.currency} {gig.deal_type ? `· ${gig.deal_type}` : ''}
                </dd>
              </div>
            )}
          </dl>

          <section className="pr-section">
            <div className="pr-section__head">
              <h2>{fr ? 'Itinéraire & Mouvements (Chronologique)' : 'Full Itinerary & Movements'}</h2>
              <span className="sub mono" style={{ fontSize: 11 }}>
                {timeline.length} {fr ? 'étapes' : 'entries'}
              </span>
            </div>
            <div className="pr-timeline">
              {timeline.map((row) => (
                <div key={row.id} className={`pr-card pr-card--${row.kind}`}>
                  <div className="pr-card__time">
                    <span className="pr-card__clock mono">{row.clock}</span>
                    {row.subtime && <span className="pr-card__subtime mono">{row.subtime}</span>}
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 7 }}>
                      <span className={`pr-kindpill pr-kindpill--${row.kind}`}>{row.badgeLabel}</span>
                      <strong style={{ fontSize: 13.5, color: '#111827' }}>{row.title}</strong>
                    </div>
                    {row.subtitle && (
                      <div className="sub" style={{ fontSize: 12.5, marginTop: 3 }}>
                        {row.subtitle}
                      </div>
                    )}
                    {row.badges.length > 0 && (
                      <div className="pr-badges">
                        {row.badges.map((b, i) =>
                          b.href ? (
                            <a
                              key={i}
                              href={b.href}
                              className={`pr-badge mono${b.tone === 'ref' ? ' pr-badge--ref' : b.tone === 'seat' ? ' pr-badge--seat' : ''}`}
                            >
                              {b.label}
                            </a>
                          ) : (
                            <span
                              key={i}
                              className={`pr-badge mono${b.tone === 'ref' ? ' pr-badge--ref' : b.tone === 'seat' ? ' pr-badge--seat' : ''}`}
                            >
                              {b.label}
                            </span>
                          ),
                        )}
                      </div>
                    )}
                    {row.notes && (
                      <div style={{ fontSize: 12, color: '#57534e', marginTop: 5, fontStyle: 'italic' }}>
                        {row.notes}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </section>

          {layout !== 'driver' && contacts.length > 0 && (
            <section className="pr-section">
              <div className="pr-section__head">
                <h2>{fr ? 'Contacts & Équipe sur place' : 'Crew & Key Contacts'}</h2>
                <span className="sub mono" style={{ fontSize: 11 }}>{contacts.length}</span>
              </div>
              <div className="pr-contacts-grid">
                {contacts.map((c, idx) => (
                  <div key={idx} className="pr-person-card">
                    <span className="pr-person-role">{c.role || 'Team'}</span>
                    <strong style={{ fontSize: 13.5, color: '#111827', marginTop: 2 }}>{c.name}</strong>
                    {c.company && <span className="sub" style={{ fontSize: 11.5 }}>{c.company}</span>}
                    {c.phone && (
                      <a
                        href={`tel:${c.phone.replace(/[^\d+]/g, '')}`}
                        className="mono"
                        style={{ fontSize: 12, color: '#0369a1', fontWeight: 600, textDecoration: 'none' }}
                      >
                        {c.phone}
                      </a>
                    )}
                    {c.email && (
                      <a href={`mailto:${c.email}`} className="sub" style={{ fontSize: 11.5, textDecoration: 'none' }}>
                        {c.email}
                      </a>
                    )}
                  </div>
                ))}
              </div>
            </section>
          )}

          {layout !== 'driver' && lineup.length > 0 && (
            <section className="pr-section">
              <div className="pr-section__head">
                <h2>Running order / Lineup</h2>
              </div>
              <div className="pr-lineup">
                {lineup.map((it) => {
                  const isUs = Boolean(it.data.is_us);
                  return (
                    <div key={it.id} className={`pr-lineup__row${isUs ? ' pr-lineup__row--us' : ''}`}>
                      <span className="mono" style={{ fontWeight: 700 }}>
                        {formatClock(String(it.data.start || ''), locale)}
                        {it.data.end ? `–${formatClock(String(it.data.end), locale)}` : ''}
                      </span>
                      <span>
                        {isUs ? '★ ' : ''}
                        <strong>{String(it.data.act || it.data.artist || '')}</strong>
                      </span>
                      {Boolean(it.data.stage) && (
                        <span className="sub" style={{ fontSize: 12 }}>
                          {String(it.data.stage)}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {layout !== 'driver' && (rider.length > 0 || guests.length > 0) && (
            <section className="pr-section" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 14 }}>
              {rider.length > 0 && (
                <div className="pr-stat" style={{ background: '#ffffff' }}>
                  <dt style={{ marginBottom: 6 }}>Rider / Tech Checklist</dt>
                  <ul style={{ margin: 0, paddingLeft: 16, fontSize: 12.5, lineHeight: 1.55 }}>
                    {rider.map((it) => {
                      const done = Boolean(it.data.fulfilled || it.data.done || it.data.checked);
                      const cat = it.data.category ? `${String(it.data.category)}: ` : '';
                      const body = String(it.data.items || it.data.text || it.data.item || '');
                      return (
                        <li key={it.id}>
                          {done ? '☑ ' : '☐ '}
                          {cat && <strong style={{ textTransform: 'capitalize' }}>{cat}</strong>}
                          {body}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}
              {guests.length > 0 && (
                <div className="pr-stat" style={{ background: '#ffffff' }}>
                  <dt style={{ marginBottom: 6 }}>VIP / Guestlist ({guests.length})</dt>
                  <ul style={{ margin: 0, paddingLeft: 16, fontSize: 12.5, lineHeight: 1.55 }}>
                    {guests.map((g) => (
                      <li key={g.id}>
                        <strong>{String(g.data.name || '')}</strong>
                        {g.data.plus ? ` (+${String(g.data.plus)})` : ''}
                        {g.data.pass_type ? ` · ${String(g.data.pass_type)}` : ''}
                        {g.data.notes ? ` — ${String(g.data.notes)}` : ''}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </section>
          )}

          {layout !== 'driver' && gig.notes && (
            <section className="pr-section">
              <div className="pr-stat" style={{ background: '#fffbeb', borderColor: '#fde68a' }}>
                <dt style={{ color: '#92400e', marginBottom: 4 }}>{fr ? 'Notes de production & avance' : 'Production & Advance Notes'}</dt>
                <p style={{ whiteSpace: 'pre-wrap', margin: 0, fontSize: 12.5, lineHeight: 1.5 }}>{gig.notes}</p>
              </div>
            </section>
          )}

          <footer className="pr-foot">
            <span>Tour Designer · {gig.city} ({gig.date})</span>
            <span>{fr ? 'Synchronisé hors ligne · Généré le' : 'Offline-ready roadsheet · Printed'} {new Date().toLocaleDateString(fr ? 'fr-FR' : 'en-GB')}</span>
          </footer>
        </div>
      </article>
    </div>
  );
}
