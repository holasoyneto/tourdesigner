import { useEffect, useState } from 'react';
import { api } from '../api/client';
import type { TourSyncState } from '../offline/sync';
import type { Gig, HistoryEvent, Locale, User } from '../types';

interface Props {
  gigs: Gig[];
  initialGigId?: string;
  user: User;
  locale: Locale;
  sync: TourSyncState;
  onOpenGig: (id: string) => void;
}

export function SyncPage({ gigs, initialGigId, user, locale, sync, onOpenGig }: Props) {
  const fr = locale === 'fr';
  const isOwner = user.role === 'owner';
  const activeGigs = gigs.filter((g) => !g.deleted_at).slice().sort((a, b) => a.date.localeCompare(b.date));
  const [selectedGigId, setSelectedGigId] = useState(initialGigId || activeGigs[0]?.id || '');
  const [history, setHistory] = useState<HistoryEvent[]>([]);
  const [loadingHist, setLoadingHist] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const conflicts = sync.outbox.filter((o) => o.status === 'conflict');
  const pending = sync.outbox.filter((o) => o.status !== 'conflict');

  useEffect(() => {
    if (!selectedGigId) return;
    setLoadingHist(true);
    api
      .gigHistory(selectedGigId, 40)
      .then((r) => setHistory(r.events))
      .catch(() => setHistory([]))
      .finally(() => setLoadingHist(false));
  }, [selectedGigId]);

  async function undoBatch(batchId: string) {
    if (!selectedGigId) return;
    const res = await api.undoBatch(selectedGigId, batchId);
    setNotice(
      fr
        ? `Lot annulé : ${res.removed.length} supprimé(s), ${res.kept.length} conservé(s)`
        : `Batch undone: ${res.removed.length} removed, ${res.kept.length} kept`,
    );
    await sync.refreshFull();
    const h = await api.gigHistory(selectedGigId, 40).catch(() => ({ events: [] }));
    setHistory(h.events);
  }

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: 14, display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* Sync Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
        <div>
          <strong>{fr ? 'Enregistrement & Hors ligne' : 'Saving & Offline Sync'}</strong>
          <div className="sub">
            {sync.online ? (fr ? 'En ligne' : 'Online') : fr ? 'Hors ligne' : 'Offline'} · {pending.length}{' '}
            {fr ? 'à envoyer' : 'pending'} · {conflicts.length} {fr ? 'conflit(s)' : 'conflict(s)'}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <button type="button" className="btn" disabled={pending.length === 0} onClick={() => void sync.flushOutbox()}>
            {fr ? 'Renvoyer maintenant' : 'Flush queue'}
          </button>
          <button type="button" className="btn btn--def" onClick={() => void sync.refreshFull()}>
            {fr ? 'Synchroniser le tour' : 'Sync full tour'}
          </button>
        </div>
      </div>

      {notice && <div style={{ padding: '6px 10px', background: 'var(--cv-sepbg)', border: '1px solid var(--cv-sel)' }}>{notice}</div>}

      {/* Conflicts */}
      {conflicts.length > 0 && (
        <section>
          <div className="sep">
            <span>{fr ? 'Conflits à résoudre' : 'Conflicts to resolve'}</span>
            <span className="mono">{conflicts.length}</span>
          </div>
          {conflicts.map((c) => (
            <div key={c.id} style={{ padding: 10, border: '1px solid var(--cv-warn)', background: 'var(--cv-paper2)', marginTop: 6 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
                <strong className="warn">{c.kind} · {c.gig_id || c.person_id}</strong>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button type="button" className="btn" onClick={() => c.id && void sync.resolveConflict(c.id, 'server')}>
                    {fr ? 'Utiliser la version en ligne' : 'Use server version'}
                  </button>
                  <button type="button" className="btn btn--def" onClick={() => c.id && void sync.resolveConflict(c.id, 'mine')}>
                    {fr ? 'Garder ma modification' : 'Keep my change'}
                  </button>
                </div>
              </div>
              <pre className="mono" style={{ margin: '6px 0 0', fontSize: 11, whiteSpace: 'pre-wrap' }}>
                {JSON.stringify(c.payload, null, 2)}
              </pre>
            </div>
          ))}
        </section>
      )}

      {/* Pending Outbox */}
      <section>
        <div className="sep">
          <span>{fr ? 'File d’envoi locale (IndexedDB)' : 'Local Outbox Queue (IndexedDB)'}</span>
          <span className="mono">{pending.length}</span>
        </div>
        {pending.length === 0 ? (
          <p className="sub" style={{ padding: '8px 0', margin: 0 }}>
            {fr ? 'Tout est enregistré. Copie hors ligne prête sur cet appareil.' : 'Everything is saved. Offline copy ready on this device.'}
          </p>
        ) : (
          pending.map((entry) => (
            <div key={entry.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 8px', borderBottom: '1px solid var(--cv-line)' }}>
              <span>
                <b>{entry.kind}</b> <span className="sub mono">{entry.created_at.slice(11, 19)}</span>
              </span>
              <span className={entry.status === 'failed' ? 'warn' : 'sub'}>{entry.status}</span>
            </div>
          ))
        )}
      </section>

      {/* Per-Gig History & Undo Batches */}
      <section>
        <div className="sep">
          <span>{fr ? 'Historique d’une fiche (Revenir en arrière)' : 'Sheet History & Batch Undo'}</span>
          <span className="mono">{history.length}</span>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', margin: '8px 0' }}>
          <span className="lab">{fr ? 'Date' : 'Date'}</span>
          <select className="in" style={{ width: 'auto', minWidth: 240 }} value={selectedGigId} onChange={(e) => setSelectedGigId(e.target.value)}>
            {activeGigs.map((g) => (
              <option key={g.id} value={g.id}>
                {g.date} · {g.city || g.name}
              </option>
            ))}
          </select>
          {selectedGigId && (
            <button type="button" className="btn" onClick={() => onOpenGig(selectedGigId)}>
              {fr ? 'Ouvrir la fiche' : 'Open sheet'}
            </button>
          )}
        </div>

        {loadingHist ? (
          <p className="sub">{fr ? 'Chargement…' : 'Loading…'}</p>
        ) : history.length === 0 ? (
          <p className="sub">{fr ? 'Aucun historique pour cette date.' : 'No history checkpoints for this date.'}</p>
        ) : (
          <div style={{ border: '1px solid var(--cv-line2)' }}>
            {history.map((ev) => (
              <div
                key={ev.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '6px 10px',
                  borderBottom: '1px solid var(--cv-line)',
                  background: 'var(--cv-paper)',
                }}
              >
                <span className="mono sub" style={{ minWidth: 130, fontSize: 11 }}>
                  {ev.at.slice(0, 16).replace('T', ' ')}
                </span>
                <span className="lab" style={{ minWidth: 55 }}>{ev.channel}</span>
                <span style={{ flex: 1 }}>
                  <b>{ev.actor_name || 'system'}</b> · {ev.summary || ev.action}
                </span>
                {isOwner && ev.batch_id && ev.action === 'add_items' && (
                  <button type="button" className="btn" onClick={() => void undoBatch(ev.batch_id!)}>
                    {fr ? 'Annuler ce lot' : 'Undo batch'}
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
