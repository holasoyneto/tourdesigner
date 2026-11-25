import { useEffect, useState } from 'react';
import { api } from '../api/client';
import type { Gig, Locale, User } from '../types';

interface Props {
  gigs: Gig[];
  user: User;
  locale: Locale;
  onRefresh: () => Promise<void>;
}

function shortDate(iso: string): string {
  return iso.length >= 10 ? `${iso.slice(8, 10)}.${iso.slice(5, 7)}` : iso;
}

export function TrashPage({ gigs, user, locale, onRefresh }: Props) {
  const fr = locale === 'fr';
  const isOwner = user.role === 'owner';
  const [trashed, setTrashed] = useState<Gig[]>([]);
  const [loading, setLoading] = useState(true);
  const [armed, setArmed] = useState<Gig | null>(null);
  const [typed, setTyped] = useState('');
  const [notice, setNotice] = useState<string | null>(null);

  const archived = gigs.filter((g) => g.archived && !g.deleted_at).sort((a, b) => a.date.localeCompare(b.date));

  async function loadTrash() {
    setLoading(true);
    try {
      const r = await api.listTrash();
      setTrashed(r.gigs.sort((a, b) => a.date.localeCompare(b.date)));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadTrash();
  }, []);

  async function restore(g: Gig) {
    await api.restoreTrash(g.id);
    await onRefresh();
    await loadTrash();
    setNotice(fr ? `Restauré : ${g.city || g.name}` : `Restored: ${g.city || g.name}`);
  }

  async function unarchive(g: Gig) {
    await api.updateGig(g.id, { archived: false }, g.version);
    await onRefresh();
    setNotice(fr ? `Désarchivé : ${g.city || g.name}` : `Unarchived: ${g.city || g.name}`);
  }

  const confirmMatches = armed ? typed.trim() === armed.date || typed.trim() === shortDate(armed.date) : false;

  async function destroyConfirmed() {
    if (!armed || !confirmMatches) return;
    await api.destroyTrash(armed.id);
    const label = armed.city || armed.name;
    setArmed(null);
    setTyped('');
    await onRefresh();
    await loadTrash();
    setNotice(fr ? `Détruit définitivement : ${label}` : `Permanently deleted: ${label}`);
  }

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: 14, display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <strong>{fr ? 'Dates retirées' : 'Removed dates'}</strong>
          <div className="sub">
            {fr ? `Corbeille ${trashed.length} · Archives ${archived.length}` : `Trash ${trashed.length} · Archive ${archived.length}`}
          </div>
        </div>
        {notice && <span style={{ color: 'var(--cv-sel)', fontWeight: 700 }}>{notice}</span>}
      </div>

      {!isOwner && (
        <p className="sub">{fr ? 'Lecture seule : seul le propriétaire peut restaurer ou détruire.' : 'Read only: only the owner can restore or destroy.'}</p>
      )}

      {/* Trash Section */}
      <section>
        <div className="sep">
          <span>{fr ? 'Corbeille' : 'Trash'}</span>
          <span className="mono">{trashed.length}</span>
        </div>
        {loading ? (
          <p className="sub">{fr ? 'Chargement…' : 'Loading…'}</p>
        ) : trashed.length === 0 ? (
          <p className="sub" style={{ padding: '8px 0', margin: 0 }}>{fr ? 'Aucune date dans la corbeille.' : 'No dates in Trash.'}</p>
        ) : (
          trashed.map((g) => (
            <div key={g.id} style={{ display: 'grid', gridTemplateColumns: '110px 1fr auto', gap: 10, alignItems: 'center', padding: '7px 8px', borderBottom: '1px solid var(--cv-line)' }}>
              <span className="mono">{g.date}</span>
              <span>
                <b>{g.city || g.name || '—'}</b>
                {g.venue && <span className="sub"> · {g.venue}</span>}
              </span>
              {isOwner && (
                <span style={{ display: 'flex', gap: 6 }}>
                  <button type="button" className="btn" onClick={() => void restore(g)}>
                    {fr ? 'Restaurer' : 'Restore'}
                  </button>
                  <button type="button" className="btn warn" onClick={() => { setArmed(g); setTyped(''); }}>
                    {fr ? 'Détruire…' : 'Destroy…'}
                  </button>
                </span>
              )}
            </div>
          ))
        )}
      </section>

      {/* Archive Section */}
      <section>
        <div className="sep">
          <span>{fr ? 'Archives' : 'Archive'}</span>
          <span className="mono">{archived.length}</span>
        </div>
        {archived.length === 0 ? (
          <p className="sub" style={{ padding: '8px 0', margin: 0 }}>
            {fr ? 'Aucune date archivée. Archiver retire une date de la liste sans rien effacer.' : 'No archived dates. Archiving hides a date without deleting anything.'}
          </p>
        ) : (
          archived.map((g) => (
            <div key={g.id} style={{ display: 'grid', gridTemplateColumns: '110px 1fr auto', gap: 10, alignItems: 'center', padding: '7px 8px', borderBottom: '1px solid var(--cv-line)' }}>
              <span className="mono">{g.date}</span>
              <span>
                <b>{g.city || g.name || '—'}</b>
                {g.venue && <span className="sub"> · {g.venue}</span>}
              </span>
              {isOwner && (
                <button type="button" className="btn" onClick={() => void unarchive(g)}>
                  {fr ? 'Désarchiver' : 'Unarchive'}
                </button>
              )}
            </div>
          ))
        )}
      </section>

      {/* Typed-Date Destroy Ritual Modal (exact prod safety check) */}
      {armed && (
        <div
          style={{ position: 'fixed', inset: 0, zIndex: 70, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
          onClick={() => setArmed(null)}
        >
          <div style={{ width: '100%', maxWidth: 420 }} onClick={(e) => e.stopPropagation()}>
            <div className="ytab">
              <button type="button" className="box" onClick={() => setArmed(null)} />
              <span>{fr ? `Détruire définitivement ${armed.city || armed.name} ?` : `Permanently delete ${armed.city || armed.name}?`}</span>
            </div>
            <div className="win" style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
              <p style={{ margin: 0 }}>
                {fr
                  ? `Cette action efface définitivement la fiche, les horaires, les voyages et les liens. Saisissez ${shortDate(armed.date)} (ou ${armed.date}) pour confirmer.`
                  : `This permanently deletes the sheet, schedule, travel, and links. Type ${shortDate(armed.date)} (or ${armed.date}) to confirm.`}
              </p>
              <input
                className="in mono"
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                placeholder={shortDate(armed.date)}
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && confirmMatches) void destroyConfirmed();
                  if (e.key === 'Escape') setArmed(null);
                }}
              />
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6 }}>
                <button type="button" className="btn" onClick={() => setArmed(null)}>
                  {fr ? 'Annuler' : 'Cancel'}
                </button>
                <button type="button" className="btn warn" disabled={!confirmMatches} onClick={() => void destroyConfirmed()}>
                  {fr ? 'Détruire' : 'Destroy'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
