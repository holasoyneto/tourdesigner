import { useEffect, useState } from 'react';
import { api } from '../api/client';
import type { Gig, Locale } from '../types';

interface Props {
  gigs: Gig[];
  initialGigId?: string;
  initialText?: string;
  initialFiles?: File[];
  locale: Locale;
  onClose: () => void;
  onApplied: (gigId: string) => Promise<void>;
}

interface ProposalItem {
  collection: string;
  data: Record<string, unknown>;
}

export function PasteWindow({ gigs, initialGigId, initialText = '', initialFiles = [], locale, onClose, onApplied }: Props) {
  const fr = locale === 'fr';
  const activeGigs = gigs.filter((g) => !g.deleted_at && !g.archived).slice().sort((a, b) => a.date.localeCompare(b.date));

  const [targetGigId, setTargetGigId] = useState(initialGigId || activeGigs[0]?.id || '__new__');
  const [text, setText] = useState(initialText);
  const [files, setFiles] = useState<File[]>(initialFiles);
  const [analyzing, setAnalyzing] = useState(false);
  const [applying, setApplying] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [proposal, setProposal] = useState<{
    engine: string;
    gig_patch: Record<string, unknown>;
    items: ProposalItem[];
    warnings: string[];
    multi_dates?: Array<{ date: string; city: string; venue?: string; name?: string; status?: string }>;
  } | null>(null);
  const [checked, setChecked] = useState<Set<number>>(() => new Set());
  const [multiChecked, setMultiChecked] = useState<Set<number>>(() => new Set());
  const [createdBatchIds, setCreatedBatchIds] = useState<string[]>([]);
  const [aiStatus, setAiStatus] = useState<{
    provider: string;
    model: string;
    google_connected: boolean;
    ai_connected?: boolean;
  } | null>(null);

  // New date fields when targetGigId === '__new__'
  const [newDate, setNewDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [newCity, setNewCity] = useState('');
  const [newVenue, setNewVenue] = useState('');

  useEffect(() => {
    void api.intakeStatus().then(setAiStatus).catch(() => undefined);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function analyze() {
    if (!text.trim() && !files.length) return;
    setAnalyzing(true);
    setErr(null);
    try {
      const sourceText = [text.trim(), ...files.map((f) => `Attached file: ${f.name}`)].filter(Boolean).join('\n');
      const res = await api.extractIntake(sourceText, targetGigId === '__new__' ? undefined : targetGigId);
      setProposal(res.proposal);
      setChecked(new Set(res.proposal.items.map((_, i) => i)));
      setMultiChecked(new Set((res.proposal.multi_dates || []).map((_, i) => i)));
      setCreatedBatchIds([]);
      if (targetGigId === '__new__' && res.proposal.gig_patch) {
        const gp = res.proposal.gig_patch;
        if (gp.date) setNewDate(String(gp.date));
        if (gp.city) setNewCity(String(gp.city));
        if (gp.venue) setNewVenue(String(gp.venue));
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'extract_failed');
    } finally {
      setAnalyzing(false);
    }
  }

  async function apply() {
    setApplying(true);
    setErr(null);
    try {
      let gid = targetGigId;
      if (gid === '__new__') {
        const created = await api.createGig({
          date: newDate,
          city: newCity || 'TBD',
          venue: newVenue,
          name: newCity || newVenue || newDate,
          status: 'hold',
        });
        gid = created.gig.id;
      }

      if (proposal) {
        const selectedItems = proposal.items.filter((_, i) => checked.has(i));
        if (selectedItems.length || Object.keys(proposal.gig_patch || {}).length) {
          await api.applyIntake(gid, {
            gig_patch: proposal.gig_patch,
            items: selectedItems,
          });
        }
      }

      for (const f of files) {
        await api.uploadFile(f, gid);
      }

      await onApplied(gid);
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'apply_failed');
    } finally {
      setApplying(false);
    }
  }

  async function batchApplyMultiDates() {
    const rows = proposal?.multi_dates || [];
    const selected = rows.filter((_, i) => multiChecked.has(i));
    if (!selected.length) return;
    setApplying(true);
    setErr(null);
    const ids: string[] = [];
    try {
      for (const row of selected) {
        const created = await api.createGig({
          date: row.date,
          city: row.city || 'TBD',
          venue: row.venue || '',
          name: row.name || row.city || row.venue || row.date,
          status: (row.status as 'hold' | 'confirmed' | 'cancelled') || 'hold',
        });
        ids.push(created.gig.id);
      }
      setCreatedBatchIds(ids);
      if (ids[0]) await onApplied(ids[0]);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'batch_create_failed');
    } finally {
      setApplying(false);
    }
  }

  async function undoBatchCreate() {
    if (!createdBatchIds.length) return;
    setApplying(true);
    setErr(null);
    try {
      for (const id of createdBatchIds) {
        await api.deleteGig(id);
      }
      setCreatedBatchIds([]);
      await onApplied('');
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'undo_failed');
    } finally {
      setApplying(false);
    }
  }

  const summarizeItem = (it: ProposalItem) =>
    Object.entries(it.data)
      .filter(([, v]) => v !== null && v !== undefined && v !== '')
      .map(([k, v]) => `${k}: ${String(v)}`)
      .join(' · ');

  return (
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 65, background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
      onClick={onClose}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('Files')) e.preventDefault();
      }}
      onDrop={(e) => {
        if (!e.dataTransfer.files.length) return;
        e.preventDefault();
        setFiles((prev) => [...prev, ...Array.from(e.dataTransfer.files)]);
      }}
    >
      <div style={{ width: '100%', maxWidth: 920, maxHeight: '86vh', display: 'flex', flexDirection: 'column' }} onClick={(e) => e.stopPropagation()}>
        <div className="ytab" style={{ margin: '0 0 -1px 0' }}>
          <button type="button" className="box" onClick={onClose} title="Fermer" />
          <span>{fr ? 'Coller / Importer dans le tour (AI Intake)' : 'Paste / Import into tour (AI Intake)'}</span>
        </div>

        <div className="win" style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
          {/* Destination selector bar */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', padding: '8px 12px', background: 'var(--cv-chrome2)', borderBottom: '1px solid var(--cv-line2)' }}>
            <span className="lab">{fr ? 'Destination' : 'Target date'}</span>
            <select className="in" style={{ width: 'auto', minWidth: 220 }} value={targetGigId} onChange={(e) => setTargetGigId(e.target.value)}>
              <option value="__new__">+ {fr ? 'Créer une nouvelle date' : 'Create new date'}</option>
              {activeGigs.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.date} · {g.city || g.name} {g.venue ? `(${g.venue})` : ''}
                </option>
              ))}
            </select>
            {targetGigId === '__new__' && (
              <>
                <input className="in mono" type="date" style={{ width: 135 }} value={newDate} onChange={(e) => setNewDate(e.target.value)} />
                <input className="in" style={{ width: 140 }} value={newCity} onChange={(e) => setNewCity(e.target.value)} placeholder={fr ? 'Ville' : 'City'} />
                <input className="in" style={{ width: 150 }} value={newVenue} onChange={(e) => setNewVenue(e.target.value)} placeholder={fr ? 'Salle' : 'Venue'} />
              </>
            )}
            {aiStatus && (
              <span
                className="mono sub"
                style={{
                  marginLeft: 'auto',
                  fontSize: 11,
                  padding: '2px 7px',
                  border: '1px solid var(--cv-line2)',
                  background: 'var(--cv-paper)',
                }}
                title={fr ? 'Configurable en direct dans Réglages' : 'Configurable live in Settings'}
              >
                {aiStatus.ai_connected || aiStatus.google_connected
                  ? `✨ ${aiStatus.provider === 'anthropic' ? 'Anthropic' : aiStatus.provider === 'openai' ? 'OpenAI' : 'Google'} · ${aiStatus.model}`
                  : fr
                    ? '⚡ Local (réglable dans Réglages)'
                    : '⚡ Local (configure in Settings)'}
              </span>
            )}
          </div>

          {/* Split Body: Source (Left) + Extracted Proposals (Right) */}
          <div style={{ flex: 1, minHeight: 0, display: 'grid', gridTemplateColumns: 'minmax(260px, 1fr) minmax(300px, 1.3fr)' }}>
            <section style={{ padding: 12, borderRight: '1px solid var(--cv-edge)', display: 'flex', flexDirection: 'column', gap: 8, minHeight: 0 }}>
              <span className="lab">{fr ? 'Texte collé (email, billet, WhatsApp, voucher…)' : 'Pasted text (email, ticket, WhatsApp, voucher…)'}</span>
              <textarea
                className="in"
                style={{ flex: 1, minHeight: 160, resize: 'none', fontFamily: 'var(--cv-mono)', fontSize: 12 }}
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder={fr ? 'Collez ici un vol (AF1234 CDG-BER 11:20-13:05), hôtel, horaire, contact…' : 'Paste flight, hotel voucher, schedule, promoter email…'}
                autoFocus
              />
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <label className="btn" style={{ cursor: 'pointer' }}>
                  + {fr ? 'Joindre fichiers (PDF / images)' : 'Attach files (PDF / images)'}
                  <input
                    type="file"
                    multiple
                    style={{ display: 'none' }}
                    onChange={(e) => {
                      setFiles((prev) => [...prev, ...Array.from(e.target.files || [])]);
                      e.target.value = '';
                    }}
                  />
                </label>
                <span className="sub">{files.length ? `${files.length} ${fr ? 'fichier(s)' : 'file(s)'}` : fr ? 'ou glissez-déposez' : 'or drag & drop'}</span>
              </div>
              {files.length > 0 && (
                <div style={{ maxHeight: 90, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 3 }}>
                  {files.map((f, idx) => (
                    <div key={`${f.name}-${idx}`} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
                      <span className="mono truncate" style={{ flex: 1 }}>{f.name}</span>
                      <button type="button" className="btn" onClick={() => setFiles((prev) => prev.filter((_, i) => i !== idx))}>
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 8, minHeight: 0, overflowY: 'auto', background: 'var(--cv-paper)' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span className="lab">{fr ? 'Propositions extraites' : 'Extracted proposals'}</span>
                {proposal && proposal.items.length > 0 && (
                  <span style={{ display: 'flex', gap: 4 }}>
                    <button type="button" className="btn" onClick={() => setChecked(new Set(proposal.items.map((_, i) => i)))}>
                      {fr ? 'Tout' : 'All'}
                    </button>
                    <button type="button" className="btn" onClick={() => setChecked(new Set())}>
                      {fr ? 'Aucun' : 'None'}
                    </button>
                  </span>
                )}
              </div>

              {err && <div className="warn">{err}</div>}

              {!proposal ? (
                <p className="sub" style={{ margin: '12px 0' }}>
                  {fr
                    ? 'Collez un message ou joignez des documents, puis cliquez sur « Analyser ». Rien n’est enregistré avant votre validation.'
                    : 'Paste text or drop files, then click "Analyze". Nothing is written until you approve.'}
                </p>
              ) : (
                <>
                  <div className="sub mono" style={{ fontSize: 11 }}>
                    engine: {proposal.engine} · {proposal.items.length} {fr ? 'élément(s)' : 'item(s)'}
                  </div>
                  {proposal.warnings?.length > 0 && (
                    <div className="warn" style={{ fontSize: 12 }}>
                      {proposal.warnings.join(' · ')}
                    </div>
                  )}
                  {createdBatchIds.length > 0 && (
                    <div style={{ padding: 8, background: 'var(--cv-paper2)', border: '1px solid var(--cv-ink)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                      <span className="mono" style={{ fontSize: 12 }}>
                        {fr ? `${createdBatchIds.length} dates créées.` : `Created ${createdBatchIds.length} gigs.`}
                      </span>
                      <span style={{ display: 'flex', gap: 6 }}>
                        <button type="button" className="btn" disabled={applying} onClick={() => void undoBatchCreate()}>
                          {fr ? 'Annuler le lot' : 'Undo batch'}
                        </button>
                        <button type="button" className="btn btn--def" onClick={onClose}>
                          {fr ? 'Terminer' : 'Done'}
                        </button>
                      </span>
                    </div>
                  )}
                  {(proposal.multi_dates?.length ?? 0) >= 2 && createdBatchIds.length === 0 && (
                    <div style={{ padding: 8, background: 'var(--cv-paper2)', border: '1px solid var(--cv-line2)', display: 'flex', flexDirection: 'column', gap: 6 }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                        <span className="lab">
                          {fr ? `Import multi-dates (${proposal.multi_dates!.length})` : `Multi-date import (${proposal.multi_dates!.length})`}
                        </span>
                        <button
                          type="button"
                          className="btn btn--def"
                          disabled={applying || multiChecked.size === 0}
                          onClick={() => void batchApplyMultiDates()}
                        >
                          {applying
                            ? '…'
                            : fr
                              ? `Créer ${multiChecked.size} dates`
                              : `Batch-create ${multiChecked.size} dates`}
                        </button>
                      </div>
                      {proposal.multi_dates!.map((row, idx) => {
                        const on = multiChecked.has(idx);
                        return (
                          <label
                            key={`${row.date}-${row.city}-${idx}`}
                            className={`item${on ? ' item--on' : ''}`}
                            style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 6px', cursor: 'pointer', border: '1px solid var(--cv-line)' }}
                          >
                            <input
                              type="checkbox"
                              checked={on}
                              onChange={() =>
                                setMultiChecked((prev) => {
                                  const next = new Set(prev);
                                  if (next.has(idx)) next.delete(idx);
                                  else next.add(idx);
                                  return next;
                                })
                              }
                            />
                            <span className="mono" style={{ fontSize: 12 }}>
                              {row.date} · {row.city}{row.venue ? ` · ${row.venue}` : ''}
                            </span>
                          </label>
                        );
                      })}
                    </div>
                  )}
                  {Object.keys(proposal.gig_patch || {}).length > 0 && (
                    <div style={{ padding: 8, background: 'var(--cv-paper2)', border: '1px solid var(--cv-line2)' }}>
                      <div className="lab">{fr ? 'Infos de la date' : 'Date header updates'}</div>
                      <div className="mono" style={{ fontSize: 12 }}>
                        {Object.entries(proposal.gig_patch)
                          .map(([k, v]) => `${k}: ${String(v)}`)
                          .join(' · ')}
                      </div>
                    </div>
                  )}
                  {proposal.items.length === 0 ? (
                    <p className="sub">{fr ? 'Aucun élément structuré détecté dans le texte.' : 'No structured rows detected in text.'}</p>
                  ) : (
                    proposal.items.map((it, idx) => {
                      const on = checked.has(idx);
                      return (
                        <label
                          key={idx}
                          className={`item${on ? ' item--on' : ''}`}
                          style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '6px 8px', cursor: 'pointer', border: '1px solid var(--cv-line)' }}
                        >
                          <input
                            type="checkbox"
                            checked={on}
                            onChange={() =>
                              setChecked((prev) => {
                                const next = new Set(prev);
                                if (next.has(idx)) next.delete(idx);
                                else next.add(idx);
                                return next;
                              })
                            }
                          />
                          <span style={{ flex: 1, minWidth: 0 }}>
                            <span className="lab" style={{ marginRight: 6 }}>{it.collection}</span>
                            <span>{summarizeItem(it)}</span>
                          </span>
                        </label>
                      );
                    })
                  )}
                </>
              )}
            </section>
          </div>

          {/* Footer Buttons */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 12px', background: 'var(--cv-chrome2)', borderTop: '1px solid var(--cv-edge)' }}>
            <span className="sub">{fr ? 'Esc pour fermer' : 'Esc to close'}</span>
            <div style={{ display: 'flex', gap: 6 }}>
              <button type="button" className="btn" onClick={onClose}>
                {fr ? 'Annuler' : 'Cancel'}
              </button>
              <button type="button" className="btn" disabled={analyzing || (!text.trim() && !files.length)} onClick={() => void analyze()}>
                {analyzing ? (fr ? 'Analyse…' : 'Analyzing…') : fr ? 'Analyser' : 'Analyze'}
              </button>
              <button
                type="button"
                className="btn btn--def"
                disabled={applying || (!proposal && !files.length)}
                onClick={() => void apply()}
              >
                {applying
                  ? '…'
                  : fr
                    ? `Appliquer${checked.size || files.length ? ` (${checked.size + files.length})` : ''}`
                    : `Apply${checked.size || files.length ? ` (${checked.size + files.length})` : ''}`}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
