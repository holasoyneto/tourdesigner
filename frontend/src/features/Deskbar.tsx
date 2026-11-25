import { useMemo, useState } from 'react';
import type { CopyDict } from '../i18n/copy';
import type { TourSyncState } from '../offline/sync';
import type { Gig, Locale, Person, Project, User } from '../types';

interface Props {
  path: string;
  gigs: Gig[];
  allGigsCount?: number;
  projects?: Project[];
  activeProjectId?: string;
  onSelectProject?: (id: string) => void;
  selectedGigId: string;
  onSitePeople: Person[];
  clock: string;
  locale: Locale;
  user: User;
  copy: CopyDict;
  sync: TourSyncState;
  toolsOpen: boolean;
  onToggleTools: () => void;
  onNavigate: (path: string) => void;
  onSearch: () => void;
  onNewDate: () => void;
  onOpenPaste: () => void;
  onOpenCommunityShare?: () => void;
}

function weekdayDay(iso: string, locale: Locale): string {
  if (!iso) return 'TBD';
  const d = new Date(`${iso.slice(0, 10)}T12:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  const wd = new Intl.DateTimeFormat(locale === 'fr' ? 'fr-FR' : 'en-GB', { weekday: 'short' })
    .format(d)
    .replace(/\.$/, '');
  return `${wd} ${d.getDate()}`;
}

function monthLabel(ym: string, locale: Locale): string {
  const d = new Date(`${ym}-15T12:00:00`);
  if (Number.isNaN(d.getTime())) return ym;
  return new Intl.DateTimeFormat(locale === 'fr' ? 'fr-FR' : 'en-GB', { month: 'long' }).format(d);
}

export function Deskbar({
  path,
  gigs,
  allGigsCount,
  projects = [],
  activeProjectId = 'all',
  onSelectProject,
  selectedGigId,
  onSitePeople,
  clock,
  locale,
  user,
  copy,
  sync,
  toolsOpen,
  onToggleTools,
  onNavigate,
  onSearch,
  onNewDate,
  onOpenPaste,
  onOpenCommunityShare,
}: Props) {
  const fr = locale === 'fr';
  const [pastOpen, setPastOpen] = useState(false);
  const today = new Date().toISOString().slice(0, 10);

  const { months, past } = useMemo(() => {
    const active = gigs.filter((g) => !g.archived && !g.deleted_at);
    const up = active.filter((g) => !g.date || g.date >= today).sort((a, b) => a.date.localeCompare(b.date));
    const pa = active.filter((g) => Boolean(g.date && g.date < today)).sort((a, b) => b.date.localeCompare(a.date));
    const map = new Map<string, Gig[]>();
    for (const g of up) {
      const key = (g.date || '0000-00').slice(0, 7);
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(g);
    }
    return {
      months: [...map.entries()].map(([key, items]) => ({ key, label: monthLabel(key, locale), items })),
      past: pa,
    };
  }, [gigs, today, locale]);

  const conflicts = sync.outbox.filter((o) => o.status === 'conflict').length;
  const pending = sync.outbox.filter((o) => o.status === 'pending').length;

  const isDates = path === '/' || path === '/tour' || path.startsWith('/gig/');
  const isCal = path === '/calendar' || path === '/calendar-view';
  const isFiles = path === '/files';
  const isContacts = path === '/contacts' || path === '/rolodex';
  const inTools = path === '/settings' || path === '/sync' || path === '/trash' || path === '/print';
  const toolCount = user.role === 'viewer' ? 2 : 5;

  return (
    <aside className="win dk-bar no-print" aria-label="Deskbar">
      {/* Top Bar: Tour + Online dot + Live Clock */}
      <div className="dk-bar__head">
        <strong className="dk-bar__tour">Tour</strong>
        <span className="dk-bar__tray">
          <span
            className={`dk-online${sync.online ? '' : ' dk-online--off'}`}
            title={sync.online ? copy.synced : copy.offline}
          />
          <span className="mono sub">{clock}</span>
        </span>
      </div>

      {/* Search Button (⌘K / /) */}
      <button type="button" className="btn dk-find" onClick={onSearch}>
        <span>{fr ? 'Rechercher' : 'Search'}</span>
        <span className="mono sub">⌘K</span>
      </button>

      {/* Multi-Artist / Project Agenda Switcher */}
      {projects.length > 0 && (
        <div style={{ padding: '4px 8px 2px' }}>
          {projects.length > 1 && onSelectProject ? (
            <select
              className="in"
              style={{ width: '100%', minHeight: 26, fontSize: 12, fontWeight: 600 }}
              aria-label={fr ? 'Projet / Artiste' : 'Project / Artist'}
              value={activeProjectId}
              onChange={(e) => onSelectProject(e.target.value)}
            >
              <option value="all">
                {fr
                  ? `Tous les projets (${allGigsCount ?? gigs.length})`
                  : `All projects (${allGigsCount ?? gigs.length})`}
              </option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  ● {p.name}
                </option>
              ))}
            </select>
          ) : (
            <div
              className="flex items-center gap-1.5 px-1.5 py-1 text-xs font-semibold"
              style={{ border: '1px solid var(--cv-line2)', background: 'var(--cv-paper)' }}
            >
              <span
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  background: projects[0].color || 'var(--cv-y1)',
                  flexShrink: 0,
                }}
              />
              <span className="truncate">{projects[0].name}</span>
            </div>
          )}
        </div>
      )}

      {/* 2x2 Section Grid (exact prod Deskbar layout) */}
      <nav className="dk-sections" aria-label="Sections">
        <button type="button" className={`btn${isDates ? ' dk-sect--on' : ''}`} onClick={() => onNavigate('/tour')}>
          Dates
        </button>
        <button type="button" className={`btn${isCal ? ' dk-sect--on' : ''}`} onClick={() => onNavigate('/calendar-view')}>
          {copy.calendar}
        </button>
        {user.role !== 'viewer' && (
          <>
            <button type="button" className={`btn${isFiles ? ' dk-sect--on' : ''}`} onClick={() => onNavigate('/files')}>
              {fr ? 'Documents' : 'Files'}
            </button>
            <button type="button" className={`btn${isContacts ? ' dk-sect--on' : ''}`} onClick={() => onNavigate('/rolodex')}>
              {copy.contacts}
            </button>
          </>
        )}
      </nav>

      {/* Month-grouped Dates Rail */}
      <div className="dk-dates">
        {months.map((m) => (
          <div key={m.key}>
            <div className="lab dk-month">
              {`${m.label} · ${m.items.length} date${m.items.length > 1 ? 's' : ''}`}
            </div>
            {m.items.map((g) => {
              const cancelled = g.status === 'cancelled';
              const mark =
                g.date === today
                  ? fr ? 'aujourd’hui' : 'today'
                  : g.status === 'hold' || g.status === 'pending'
                    ? 'option'
                    : cancelled
                      ? fr ? 'annulée' : 'cancelled'
                      : '';
              const label = [g.city || g.venue || g.name, mark].filter(Boolean).join(' · ');
              return (
                <button
                  key={g.id}
                  type="button"
                  onClick={() => onNavigate(`/gig/${g.id}`)}
                  className={`day${g.id === selectedGigId ? ' day--on' : ''}${cancelled ? ' day--off' : ''}`}
                >
                  <span className="mono">{weekdayDay(g.date, locale)}</span>
                  <span className="truncate">{label}</span>
                </button>
              );
            })}
          </div>
        ))}
        {pastOpen && past.length > 0 && (
          <div>
            <div className="lab dk-month">{copy.past} · {past.length}</div>
            {past.map((g) => (
              <button
                key={g.id}
                type="button"
                onClick={() => onNavigate(`/gig/${g.id}`)}
                className={`day${g.id === selectedGigId ? ' day--on' : ''}`}
              >
                <span className="mono">{weekdayDay(g.date, locale)}</span>
                <span className="truncate">{g.city || g.venue || g.name}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Sur place (people on the active date) */}
      {onSitePeople.length > 0 && (
        <>
          <div className="lab dk-month" style={{ borderTop: '1px solid var(--cv-edge)' }}>
            {fr ? 'Sur place' : 'On site'}
          </div>
          <div className="dk-who">
            {onSitePeople.slice(0, 5).map((p) => (
              <span key={p.id} className="dk-who__one">
                <b>{p.name}</b> <span className="sub">{p.role || ''}</span>
              </span>
            ))}
          </div>
        </>
      )}

      {/* Outils Row (opens bottom DeskTools panel just like prod!) */}
      <button
        type="button"
        className={`day dk-toolsrow${toolsOpen || inTools ? ' day--on' : ''}`}
        aria-expanded={toolsOpen}
        onClick={onToggleTools}
      >
        <span>{fr ? 'Outils' : 'Tools'}</span>
        <span className="mono sub">{toolCount}</span>
      </button>

      {/* Footer: Nouvelle date + Coller AI + Passées + Status */}
      <div className="dk-bar__foot">
        {user.role !== 'viewer' && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 4 }}>
            <button type="button" className="btn" onClick={onNewDate}>
              {copy.newDate}
            </button>
            <button type="button" className="btn" title={fr ? 'Coller / Importer (AI)' : 'Paste / AI Import'} onClick={onOpenPaste}>
              ✨
            </button>
          </div>
        )}
        {past.length > 0 && (
          <button type="button" className="btn" style={{ justifyContent: 'space-between' }} onClick={() => setPastOpen((v) => !v)}>
            <span>{pastOpen ? (fr ? 'Masquer les passées' : 'Hide past') : `${copy.past} · ${past.length}`}</span>
            <span>{pastOpen ? '▴' : '▾'}</span>
          </button>
        )}
        <button
          type="button"
          className={`dk-status${conflicts > 0 || !sync.online ? ' dk-status--needs' : ''}`}
          style={{ width: '100%', textAlign: 'left', border: 0, cursor: 'pointer' }}
          onClick={() => onNavigate('/sync')}
        >
          <span className="truncate">
            {conflicts > 0
              ? `${copy.conflict} (${conflicts})`
              : !sync.online
                ? `${copy.offline}${pending ? ` · ${pending}` : ''}`
                : pending > 0
                  ? copy.pendingSync(pending)
                  : fr
                    ? 'Tout est enregistré'
                    : 'Everything is saved'}
          </span>
        </button>
        {onOpenCommunityShare && (
          <button
            type="button"
            className="dk-status"
            style={{
              width: '100%',
              textAlign: 'left',
              border: 0,
              cursor: 'pointer',
              fontSize: 11,
              opacity: 0.82,
              paddingTop: 2,
            }}
            onClick={onOpenCommunityShare}
          >
            <span className="truncate">
              ✦ {fr ? 'Partager avec un DJ / TM' : 'Share with a fellow DJ / TM'}
            </span>
          </button>
        )}
      </div>
    </aside>
  );
}
