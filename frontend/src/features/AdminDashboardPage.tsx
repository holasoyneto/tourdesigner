import { Mail, RefreshCw, RotateCcw, Search, Shield, ShieldAlert, ShieldCheck, Sparkles, Users } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, type PlatformAdminOverview, type PlatformTenantRecord } from '../api/client';
import type { Locale } from '../types';

interface Props {
  locale: Locale;
}

type FilterMode = 'all' | 'active7d' | 'near_quota' | 'mcp' | 'suspended';

function pct(used: number, max: number): number {
  if (!max || max <= 0) return 0;
  return Math.min(100, Math.round((used / max) * 100));
}

function fmtShortDate(iso: string): string {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
    return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch {
    return iso.slice(0, 10);
  }
}

function UsageBar({ used, max, unit = '' }: { used: number; max: number; unit?: string }) {
  const p = pct(used, max);
  const color = p >= 90 ? 'var(--cv-warn)' : p >= 70 ? 'var(--cv-y1)' : 'var(--cv-online)';
  return (
    <div style={{ minWidth: 96 }}>
      <div className="mono" style={{ fontSize: 11, display: 'flex', justifyContent: 'space-between', gap: 6 }}>
        <span>{used}{unit}</span>
        <span className="sub">{max > 0 ? `/ ${max}${unit}` : '∞'}</span>
      </div>
      <div style={{ height: 4, background: 'var(--cv-line)', marginTop: 3, overflow: 'hidden' }}>
        <div style={{ width: `${p}%`, height: '100%', background: color, transition: 'width 180ms ease' }} />
      </div>
    </div>
  );
}

export function AdminDashboardPage({ locale }: Props) {
  const fr = locale === 'fr';
  const [data, setData] = useState<PlatformAdminOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<FilterMode>('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Support editor state for selected tenant
  const [planInput, setPlanInput] = useState('');
  const [aiLimitInput, setAiLimitInput] = useState('');
  const [maxGigsInput, setMaxGigsInput] = useState('');
  const [maxMbInput, setMaxMbInput] = useState('');
  const [notesInput, setNotesInput] = useState('');
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const flash = useCallback((msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast((cur) => (cur === msg ? null : cur)), 2800);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.platformAdminOverview();
      setData(res);
      setSelectedId((cur) => cur || res.tenants[0]?.tenant_id || null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load admin overview');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const selected = useMemo<PlatformTenantRecord | null>(() => {
    if (!data || !selectedId) return null;
    return data.tenants.find((t) => t.tenant_id === selectedId) || null;
  }, [data, selectedId]);

  useEffect(() => {
    if (!selected) return;
    setPlanInput(selected.overrides.plan ?? selected.plan ?? '');
    setAiLimitInput(selected.overrides.ai_daily_limit != null ? String(selected.overrides.ai_daily_limit) : '');
    setMaxGigsInput(selected.overrides.max_gigs != null ? String(selected.overrides.max_gigs) : '');
    setMaxMbInput(selected.overrides.max_files_mb != null ? String(selected.overrides.max_files_mb) : '');
    setNotesInput(selected.admin_notes || '');
  }, [selected]);

  const filteredTenants = useMemo(() => {
    if (!data) return [];
    const q = query.trim().toLowerCase();
    const cutoff7d = Date.now() - 7 * 24 * 3600 * 1000;
    return data.tenants.filter((t) => {
      if (q) {
        const hay = `${t.name} ${t.email} ${t.tenant_id} ${t.plan} ${t.admin_notes}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      if (filter === 'active7d') {
        const ts = t.last_login_at ? new Date(t.last_login_at).getTime() : 0;
        return ts >= cutoff7d;
      }
      if (filter === 'near_quota') {
        return (
          pct(t.usage.ai_used_today, t.usage.ai_daily_limit) >= 70 ||
          pct(t.usage.gigs_count, t.usage.max_gigs) >= 70 ||
          pct(t.usage.storage_mb, t.usage.max_files_mb) >= 70
        );
      }
      if (filter === 'mcp') return t.usage.mcp_active;
      if (filter === 'suspended') return t.suspended;
      return true;
    });
  }, [data, query, filter]);

  function replaceTenant(updated: PlatformTenantRecord) {
    setData((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        tenants: prev.tenants.map((t) => (t.tenant_id === updated.tenant_id ? updated : t)),
      };
    });
  }

  async function saveSelected() {
    if (!selected || saving) return;
    setSaving(true);
    try {
      const res = await api.platformAdminUpdateTenant(selected.tenant_id, {
        plan: planInput.trim(),
        ai_daily_limit: aiLimitInput.trim() === '' ? null : Number(aiLimitInput),
        max_gigs: maxGigsInput.trim() === '' ? null : Number(maxGigsInput),
        max_files_mb: maxMbInput.trim() === '' ? null : Number(maxMbInput),
        admin_notes: notesInput,
      });
      replaceTenant(res.tenant);
      flash(fr ? 'Quotas & notes enregistrés ✓' : 'Quotas & support notes saved ✓');
    } catch (e) {
      flash(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  async function handleResetAi() {
    if (!selected || saving) return;
    setSaving(true);
    try {
      const res = await api.platformAdminResetAi(selected.tenant_id);
      replaceTenant(res.tenant);
      flash(fr ? 'Compteur IA du jour réinitialisé ✓' : 'Daily AI counter reset to 0 ✓');
    } catch (e) {
      flash(e instanceof Error ? e.message : 'Reset failed');
    } finally {
      setSaving(false);
    }
  }

  async function handleToggleSuspend() {
    if (!selected || saving) return;
    setSaving(true);
    try {
      const res = await api.platformAdminUpdateTenant(selected.tenant_id, {
        suspended: !selected.suspended,
      });
      replaceTenant(res.tenant);
      flash(
        res.tenant.suspended
          ? fr ? 'Espace suspendu' : 'Workspace suspended'
          : fr ? 'Espace rétabli ✓' : 'Workspace restored ✓',
      );
    } catch (e) {
      flash(e instanceof Error ? e.message : 'Update failed');
    } finally {
      setSaving(false);
    }
  }

  const s = data?.summary;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Top Operator Bar */}
      <div className="dk-datebar">
        <Shield className="h-4 w-4 shrink-0" style={{ color: 'var(--cv-y1)' }} />
        <strong>{fr ? 'Admin Plateforme' : 'Platform Admin'}</strong>
        {s && (
          <span className="mono sub">
            · {s.tenancy_mode.toUpperCase()} · {s.defaults.plan}
          </span>
        )}
        {toast && (
          <span className="mono" style={{ fontSize: 11.5, color: 'var(--cv-online)', fontWeight: 700, marginLeft: 8 }}>
            {toast}
          </span>
        )}
        <div className="dk-datebar__acts">
          <button type="button" className="btn" disabled={loading} onClick={() => void load()}>
            <RefreshCw className={`h-3.5 w-3.5${loading ? ' animate-spin' : ''}`} />
            {fr ? 'Actualiser' : 'Refresh'}
          </button>
        </div>
      </div>

      {error && (
        <div className="p-4 text-xs" style={{ color: 'var(--cv-warn)', background: 'var(--cv-paper2)', borderBottom: '1px solid var(--cv-line)' }}>
          {error}
        </div>
      )}

      <div className="flex-1 overflow-y-auto bg-[var(--cv-paper)]">
        {/* KPI Analytics Strip */}
        {s && (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
              gap: 1,
              background: 'var(--cv-line)',
              borderBottom: '1px solid var(--cv-line2)',
            }}
          >
            {[
              {
                lab: fr ? 'ESPACES' : 'WORKSPACES',
                val: String(s.total_tenants),
                sub: `${s.active_24h} ${fr ? '24h' : '24h'} · ${s.active_7d} ${fr ? '7j' : '7d'}`,
                accent: 'var(--cv-ink)',
              },
              {
                lab: fr ? 'DATES CRÉÉES' : 'TOTAL SHOWS',
                val: String(s.total_gigs),
                sub: `${s.total_people} ${fr ? 'contacts' : 'contacts'}`,
                accent: 'var(--cv-y1)',
              },
              {
                lab: fr ? 'COFFRE-FORT' : 'VAULT STORAGE',
                val: `${s.total_storage_mb} MB`,
                sub: `${s.total_files} ${fr ? 'fichiers' : 'files'}`,
                accent: 'var(--cv-ink)',
              },
              {
                lab: fr ? 'APPELS IA' : 'AI METERING',
                val: `${s.ai_used_today} ${fr ? 'auj.' : 'today'}`,
                sub: `${s.ai_total} ${fr ? 'total cumulé' : 'lifetime total'}`,
                accent: 'var(--cv-online)',
              },
              {
                lab: 'MCP AGENTS',
                val: String(s.mcp_enabled_tenants),
                sub: fr ? 'connectés' : 'connected workspaces',
                accent: 'var(--cv-ink)',
              },
              {
                lab: fr ? 'DEMANDES PRO' : 'AGENCY LEADS',
                val: String(s.leads_count),
                sub: s.suspended_count > 0 ? `${s.suspended_count} suspended` : fr ? 'actives' : 'inquiries',
                accent: s.leads_count > 0 ? 'var(--cv-y1)' : 'var(--cv-ink)',
              },
            ].map((k) => (
              <div key={k.lab} style={{ background: 'var(--cv-paper2)', padding: '10px 12px' }}>
                <div className="mono sub" style={{ fontSize: 10, letterSpacing: '0.07em' }}>
                  {k.lab}
                </div>
                <div className="mono" style={{ fontSize: 20, fontWeight: 700, color: k.accent, lineHeight: 1.2, marginTop: 2 }}>
                  {k.val}
                </div>
                <div className="sub" style={{ fontSize: 11, marginTop: 2 }}>
                  {k.sub}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Filter & Search Bar */}
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            gap: 8,
            padding: '8px 12px',
            borderBottom: '1px solid var(--cv-line)',
            background: 'var(--cv-chrome2)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: '1 1 220px', maxWidth: 360, background: 'var(--cv-paper)', border: '1px solid var(--cv-line2)', padding: '4px 8px' }}>
            <Search className="h-3.5 w-3.5 sub shrink-0" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={fr ? 'Filtrer par nom, email ou tenant…' : 'Search user, email, or tenant ID…'}
              style={{ flex: 1, border: 0, outline: 'none', background: 'transparent', color: 'var(--cv-ink)', fontSize: 12.5 }}
            />
          </div>
          <div className="segs">
            {(
              [
                ['all', fr ? 'Tous' : 'All'],
                ['active7d', fr ? 'Actifs 7j' : 'Active 7d'],
                ['near_quota', fr ? 'Proche quota' : 'Near quota'],
                ['mcp', 'MCP'],
                ['suspended', fr ? 'Suspendus' : 'Suspended'],
              ] as Array<[FilterMode, string]>
            ).map(([k, lab]) => (
              <button key={k} type="button" className={`seg${filter === k ? ' seg--on' : ''}`} onClick={() => setFilter(k)}>
                {lab}
              </button>
            ))}
          </div>
          <span className="mono sub" style={{ fontSize: 11, marginLeft: 'auto' }}>
            {filteredTenants.length} / {data?.tenants.length ?? 0}
          </span>
        </div>

        {/* Main Two-Pane Operator Desk: Usage Table + Support Inspector */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: selected ? 'minmax(0, 1.45fr) minmax(300px, 0.95fr)' : '1fr',
            borderBottom: '1px solid var(--cv-line2)',
          }}
        >
          {/* Workspaces Usage List */}
          <div style={{ overflowX: 'auto', borderRight: selected ? '1px solid var(--cv-line2)' : undefined }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
              <thead>
                <tr style={{ background: 'var(--cv-paper2)', borderBottom: '1px solid var(--cv-line2)', textAlign: 'left' }}>
                  <th className="mono sub" style={{ padding: '7px 10px', fontSize: 10.5, fontWeight: 700 }}>{fr ? 'UTILISATEUR' : 'WORKSPACE'}</th>
                  <th className="mono sub" style={{ padding: '7px 8px', fontSize: 10.5, fontWeight: 700 }}>{fr ? 'PLAN' : 'PLAN'}</th>
                  <th className="mono sub" style={{ padding: '7px 8px', fontSize: 10.5, fontWeight: 700 }}>{fr ? 'DATES' : 'SHOWS'}</th>
                  <th className="mono sub" style={{ padding: '7px 8px', fontSize: 10.5, fontWeight: 700 }}>{fr ? 'VAULT' : 'VAULT'}</th>
                  <th className="mono sub" style={{ padding: '7px 8px', fontSize: 10.5, fontWeight: 700 }}>{fr ? 'IA (AUJ.)' : 'AI TODAY'}</th>
                  <th className="mono sub" style={{ padding: '7px 10px', fontSize: 10.5, fontWeight: 700 }}>{fr ? 'DERN. ACCÈS' : 'LAST SEEN'}</th>
                </tr>
              </thead>
              <tbody>
                {filteredTenants.length === 0 && (
                  <tr>
                    <td colSpan={6} className="sub" style={{ padding: 20, textAlign: 'center' }}>
                      {loading ? (fr ? 'Chargement…' : 'Loading workspaces…') : fr ? 'Aucun espace trouvé.' : 'No matching workspaces.'}
                    </td>
                  </tr>
                )}
                {filteredTenants.map((t) => {
                  const isSel = selected?.tenant_id === t.tenant_id;
                  return (
                    <tr
                      key={t.tenant_id}
                      onClick={() => setSelectedId(t.tenant_id)}
                      style={{
                        cursor: 'pointer',
                        borderBottom: '1px solid var(--cv-line)',
                        background: isSel ? 'var(--cv-next)' : undefined,
                      }}
                    >
                      <td style={{ padding: '8px 10px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <strong style={{ color: 'var(--cv-ink)' }}>{t.name}</strong>
                          {t.usage.mcp_active && (
                            <span className="mono" style={{ fontSize: 9.5, padding: '1px 4px', border: '1px solid var(--cv-sel)', color: 'var(--cv-sel)' }}>
                              MCP
                            </span>
                          )}
                          {t.suspended && (
                            <span className="mono" style={{ fontSize: 9.5, padding: '1px 4px', background: 'var(--cv-warn)', color: '#fff' }}>
                              SUSPENDED
                            </span>
                          )}
                        </div>
                        <div className="mono sub" style={{ fontSize: 11 }}>
                          {t.email || t.tenant_id}
                        </div>
                      </td>
                      <td style={{ padding: '8px 8px', whiteSpace: 'nowrap' }}>
                        <span
                          className="mono"
                          style={{
                            fontSize: 11,
                            fontWeight: 700,
                            padding: '2px 6px',
                            border: '1px solid var(--cv-line2)',
                            background: 'var(--cv-paper2)',
                            color: t.plan.toLowerCase().includes('pro') || t.plan.toLowerCase().includes('vip') ? 'var(--cv-y1)' : 'var(--cv-ink)',
                          }}
                        >
                          {t.plan}
                        </span>
                      </td>
                      <td style={{ padding: '8px 8px' }}>
                        <UsageBar used={t.usage.gigs_count} max={t.usage.max_gigs} />
                      </td>
                      <td style={{ padding: '8px 8px' }}>
                        <UsageBar used={t.usage.storage_mb} max={t.usage.max_files_mb} unit="M" />
                      </td>
                      <td style={{ padding: '8px 8px' }}>
                        <UsageBar used={t.usage.ai_used_today} max={t.usage.ai_daily_limit} />
                      </td>
                      <td className="mono sub" style={{ padding: '8px 10px', fontSize: 11, whiteSpace: 'nowrap' }}>
                        {fmtShortDate(t.last_login_at)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Right Support & Quota Inspector */}
          {selected && (
            <div style={{ padding: 14, background: 'var(--cv-paper2)', display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Users className="h-4 w-4" style={{ color: 'var(--cv-y1)' }} />
                    <strong style={{ fontSize: 14 }}>{selected.name}</strong>
                  </div>
                  <div className="mono sub" style={{ fontSize: 11.5, marginTop: 2 }}>
                    {selected.email || '—'}
                  </div>
                  <div className="mono sub" style={{ fontSize: 10.5, marginTop: 2 }}>
                    {selected.tenant_id} · {selected.auth_provider} · {selected.usage.team_count} {fr ? 'membre(s)' : 'member(s)'} · {selected.usage.ai_total} AI total
                  </div>
                </div>
                {selected.email && (
                  <a
                    href={`mailto:${selected.email}?subject=${encodeURIComponent('Tour Designer Support')}`}
                    className="btn"
                    style={{ textDecoration: 'none', whiteSpace: 'nowrap' }}
                  >
                    <Mail className="h-3.5 w-3.5" />
                    {fr ? 'Écrire' : 'Email'}
                  </a>
                )}
              </div>

              <div className="border-t border-[var(--cv-line)] pt-3 space-y-2.5 text-xs">
                <div className="mono sub" style={{ fontSize: 10.5, letterSpacing: '0.06em' }}>
                  {fr ? 'QUOTAS & PLAN PERSONNALISÉS' : 'CUSTOM PLAN & QUOTA OVERRIDES'}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  <label className="space-y-1">
                    <span className="sub">{fr ? 'Plan' : 'Plan label'}</span>
                    <input
                      className="w-full"
                      value={planInput}
                      onChange={(e) => setPlanInput(e.target.value)}
                      placeholder={s?.defaults.plan || 'Free Beta'}
                      style={{ padding: '5px 8px', background: 'var(--cv-paper)', border: '1px solid var(--cv-line2)', color: 'var(--cv-ink)' }}
                    />
                  </label>
                  <label className="space-y-1">
                    <span className="sub">{fr ? 'IA / jour (vide = défaut)' : 'AI / day (blank = default)'}</span>
                    <input
                      type="number"
                      min={0}
                      className="w-full mono"
                      value={aiLimitInput}
                      onChange={(e) => setAiLimitInput(e.target.value)}
                      placeholder={String(s?.defaults.ai_daily_limit ?? 20)}
                      style={{ padding: '5px 8px', background: 'var(--cv-paper)', border: '1px solid var(--cv-line2)', color: 'var(--cv-ink)' }}
                    />
                  </label>
                  <label className="space-y-1">
                    <span className="sub">{fr ? 'Max dates' : 'Max shows'}</span>
                    <input
                      type="number"
                      min={0}
                      className="w-full mono"
                      value={maxGigsInput}
                      onChange={(e) => setMaxGigsInput(e.target.value)}
                      placeholder={String(s?.defaults.max_gigs ?? 200)}
                      style={{ padding: '5px 8px', background: 'var(--cv-paper)', border: '1px solid var(--cv-line2)', color: 'var(--cv-ink)' }}
                    />
                  </label>
                  <label className="space-y-1">
                    <span className="sub">{fr ? 'Max Vault (Mo)' : 'Max vault (MB)'}</span>
                    <input
                      type="number"
                      min={0}
                      className="w-full mono"
                      value={maxMbInput}
                      onChange={(e) => setMaxMbInput(e.target.value)}
                      placeholder={String(s?.defaults.max_files_mb ?? 250)}
                      style={{ padding: '5px 8px', background: 'var(--cv-paper)', border: '1px solid var(--cv-line2)', color: 'var(--cv-ink)' }}
                    />
                  </label>
                </div>

                <label className="block space-y-1">
                  <span className="sub">{fr ? 'Notes support (privées admin)' : 'Support notes (admin-only)'}</span>
                  <textarea
                    rows={3}
                    value={notesInput}
                    onChange={(e) => setNotesInput(e.target.value)}
                    placeholder={fr ? 'Ex: Aider sur import CSV tournée Europe…' : 'e.g. Helped import Europe routing CSV, upgraded for festival run…'}
                    style={{ width: '100%', padding: '6px 8px', background: 'var(--cv-paper)', border: '1px solid var(--cv-line2)', color: 'var(--cv-ink)', resize: 'vertical' }}
                  />
                </label>

                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, paddingTop: 2 }}>
                  <button type="button" className="btn btn--def" disabled={saving} onClick={() => void saveSelected()}>
                    <Sparkles className="h-3.5 w-3.5" />
                    {fr ? 'Enregistrer quotas' : 'Save quotas'}
                  </button>
                  <button type="button" className="btn" disabled={saving} onClick={() => void handleResetAi()}>
                    <RotateCcw className="h-3.5 w-3.5" />
                    {fr ? 'Reset IA du jour' : 'Reset AI today'}
                  </button>
                  <button
                    type="button"
                    className="btn"
                    disabled={saving}
                    style={{ color: selected.suspended ? 'var(--cv-online)' : 'var(--cv-warn)', marginLeft: 'auto' }}
                    onClick={() => void handleToggleSuspend()}
                  >
                    {selected.suspended ? <ShieldCheck className="h-3.5 w-3.5" /> : <ShieldAlert className="h-3.5 w-3.5" />}
                    {selected.suspended ? (fr ? 'Rétablir' : 'Restore') : fr ? 'Suspendre' : 'Suspend'}
                  </button>
                </div>
              </div>

              <div className="sub border-t border-[var(--cv-line)] pt-2" style={{ fontSize: 10.5 }}>
                {fr
                  ? 'Confidentialité : seuls les compteurs d’usage et quotas sont visibles ici — jamais les cachets, passeports ni fichiers privés.'
                  : 'Privacy guardrail: only aggregate usage counters and quotas are shown here — never private deals, passports, or vault files.'}
              </div>
            </div>
          )}
        </div>

        {/* Agency / Management Inquiries */}
        <div className="sep">
          {fr ? 'Demandes agences & management' : 'Agency & management inquiries'} ({data?.leads.length ?? 0})
        </div>
        {!data?.leads.length ? (
          <div className="sub p-4 text-xs">
            {fr ? 'Aucune demande reçue pour le moment.' : 'No agency inquiries submitted yet.'}
          </div>
        ) : (
          <div className="divide-y divide-[var(--cv-line)]">
            {data.leads.map((lead, idx) => (
              <div key={lead.id || idx} className="person-row" style={{ alignItems: 'flex-start', gap: 12 }}>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <strong>{lead.name || '—'}</strong>
                    {lead.org && <span className="sub">· {lead.org}</span>}
                    {lead.roster_size && (
                      <span className="mono" style={{ fontSize: 10.5, padding: '1px 5px', border: '1px solid var(--cv-line2)' }}>
                        {lead.roster_size}
                      </span>
                    )}
                    {lead.at && <span className="mono sub" style={{ fontSize: 10.5 }}>{fmtShortDate(lead.at)}</span>}
                  </div>
                  <div className="mono sub" style={{ fontSize: 11.5 }}>{lead.email}</div>
                  {lead.message && <div className="sub" style={{ fontSize: 12, marginTop: 3 }}>{lead.message}</div>}
                </div>
                {lead.email && (
                  <a
                    href={`mailto:${lead.email}?subject=${encodeURIComponent('Tour Designer — Management / Agency')}`}
                    className="btn shrink-0"
                    style={{ textDecoration: 'none' }}
                  >
                    <Mail className="h-3.5 w-3.5" />
                    {fr ? 'Répondre' : 'Reply'}
                  </a>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
