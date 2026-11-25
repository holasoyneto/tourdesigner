import { useEffect, useState } from 'react';
import { api, type CommunityShareConfig, type HostedUsage } from '../api/client';
import type { CopyDict } from '../i18n/copy';
import { fullUrl, withBase } from '../lib/basePath';
import { purgeOfflineCopy } from '../offline/db';
import type { TourSyncState } from '../offline/sync';
import type { Gig, Locale, Project, SkinPref, User } from '../types';
import { McpConnectSection } from './McpConnectSection';

interface Props {
  user: User;
  locale: Locale;
  skin: SkinPref;
  uiScale: number;
  copy: CopyDict;
  sync: TourSyncState;
  projects: Project[];
  hostedUsage?: HostedUsage | null;
  community?: CommunityShareConfig | null;
  onOpenCommunityShare?: () => void;
  onMcpConnected?: () => void;
  onRefreshProjects: () => Promise<void>;
  onNavigate?: (path: string) => void;
  onLocale: (l: Locale) => void;
  onSkin: (s: SkinPref) => void;
  onScale: (s: number) => void;
  onLogout: () => Promise<void>;
}

type AiProvider = 'auto' | 'vertex' | 'gemini' | 'anthropic' | 'openai' | 'local';

interface AiSettingsState {
  provider: AiProvider;
  effective_provider: 'vertex' | 'gemini' | 'anthropic' | 'openai' | 'local';
  model: string;
  vertex_project: string;
  vertex_project_source: 'settings' | 'env' | 'none';
  vertex_location: string;
  gemini_api_key_configured: boolean;
  gemini_api_key_source: 'settings' | 'env' | 'none';
  gemini_api_key_hint: string;
  anthropic_api_key_configured?: boolean;
  anthropic_api_key_source?: 'settings' | 'env' | 'none';
  anthropic_api_key_hint?: string;
  openai_api_key_configured?: boolean;
  openai_api_key_source?: 'settings' | 'env' | 'none';
  openai_api_key_hint?: string;
  hosted_locked?: boolean;
  hosted_model?: string;
  hosted_thinking_level?: string;
  updated_at?: string | null;
}

interface AiModelAlert {
  model: string;
  reason: string;
  recommended_model?: string;
  status_code?: number | null;
  detected_at?: string;
}

interface GoogleModelOption {
  id: string;
  display_name: string;
  description?: string;
  recommended?: boolean;
  provider?: string;
}

const PROJECT_COLORS = ['#f3c64a', '#6ea8fe', '#5fd39f', '#ff7a7a', '#c084fc', '#f59e0b'];

export function SettingsPage({
  user,
  locale,
  skin,
  uiScale,
  copy,
  sync,
  projects,
  hostedUsage,
  community,
  onOpenCommunityShare,
  onMcpConnected,
  onRefreshProjects,
  onNavigate,
  onLocale,
  onSkin,
  onScale,
  onLogout,
}: Props) {
  const fr = locale === 'fr';
  const [exporting, setExporting] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState('');
  const [deletingAcct, setDeletingAcct] = useState(false);
  const [users, setUsers] = useState<User[]>([]);
  const [trash, setTrash] = useState<Gig[]>([]);
  const [audit, setAudit] = useState<
    Array<{ id: string; ts: string; actor_name?: string; channel: string; action: string; summary: string }>
  >([]);
  const [writesOnly, setWritesOnly] = useState(true);

  // Projects / Artist Agendas state
  const [newProjName, setNewProjName] = useState('');
  const [newProjColor, setNewProjColor] = useState(PROJECT_COLORS[0]);
  const [projErr, setProjErr] = useState<string | null>(null);

  // Team & Access state
  const [newName, setNewName] = useState('');
  const [newRole, setNewRole] = useState<'editor' | 'viewer'>('editor');
  const [newArtistIds, setNewArtistIds] = useState<string[]>([]);
  const [newTravelPersonId, setNewTravelPersonId] = useState('');
  const [issuedSecret, setIssuedSecret] = useState<{ label: string; login?: string; mcp?: string } | null>(null);
  const [copiedKey, setCopiedKey] = useState<'login' | 'mcp' | null>(null);

  // Dynamic multi-provider AI Intake settings state (Google / Anthropic / OpenAI / Local)
  const [aiCfg, setAiCfg] = useState<AiSettingsState | null>(null);
  const [aiAlert, setAiAlert] = useState<AiModelAlert | null>(null);
  const [aiProvider, setAiProvider] = useState<AiProvider>('auto');
  const [aiModel, setAiModel] = useState('gemini-4-hydrogen');
  const [aiVertexProject, setAiVertexProject] = useState('');
  const [aiVertexLocation, setAiVertexLocation] = useState('global');
  const [aiGeminiKeyInput, setAiGeminiKeyInput] = useState('');
  const [aiAnthropicKeyInput, setAiAnthropicKeyInput] = useState('');
  const [aiOpenaiKeyInput, setAiOpenaiKeyInput] = useState('');
  const [aiModels, setAiModels] = useState<GoogleModelOption[]>([]);
  const [aiCatalogSource, setAiCatalogSource] = useState<
    'live_google' | 'live_anthropic' | 'live_openai' | 'fallback_catalog' | 'hosted_locked'
  >('fallback_catalog');
  const [aiCatalogNote, setAiCatalogNote] = useState<string | null>(null);
  const [aiFetchedAt, setAiFetchedAt] = useState<string | null>(null);
  const [aiLoadingModels, setAiLoadingModels] = useState(false);
  const [aiSaving, setAiSaving] = useState(false);
  const [aiTesting, setAiTesting] = useState(false);
  const [aiFeedback, setAiFeedback] = useState<{ kind: 'ok' | 'warn'; text: string } | null>(null);

  async function copyIssued(kind: 'login' | 'mcp', value: string) {
    await navigator.clipboard.writeText(value).catch(() => undefined);
    setCopiedKey(kind);
    window.setTimeout(() => setCopiedKey((cur) => (cur === kind ? null : cur)), 1800);
  }

  function syncAiForm(cfg: AiSettingsState) {
    setAiCfg(cfg);
    setAiProvider(cfg.provider);
    setAiModel(cfg.model);
    setAiVertexProject(cfg.vertex_project || '');
    setAiVertexLocation(cfg.vertex_location || 'global');
  }

  async function refreshGoogleModels(providerOverride?: AiProvider, autoPickRecommended = false) {
    if (user.role !== 'owner') return;
    setAiLoadingModels(true);
    try {
      const res = await api.adminListAiModels(providerOverride);
      const list = res.models || [];
      setAiModels(list);
      setAiCatalogSource(res.source);
      setAiCatalogNote(res.note || null);
      setAiFetchedAt(res.fetched_at || null);
      if (autoPickRecommended && list.length > 0 && !res.hosted_locked) {
        const rec = list.find((m) => m.recommended) || list[0];
        if (rec?.id) setAiModel(rec.id);
      }
    } catch {
      setAiCatalogNote(fr ? 'Impossible de charger la liste des modèles.' : 'Unable to fetch live model catalog.');
    } finally {
      setAiLoadingModels(false);
    }
  }

  async function loadAdmin() {
    if (user.role !== 'owner') return;
    const [uRes, tRes, aRes, aiRes] = await Promise.all([
      api.adminUsers(),
      api.listTrash(),
      fetch(withBase(`/api/admin/audit?limit=30&writes=${writesOnly}`), { credentials: 'same-origin' })
        .then((r) => r.json())
        .catch(() => ({ events: [] })),
      api.adminGetAiSettings().catch(() => null),
    ]);
    setUsers(uRes.users);
    setTrash(tRes.gigs);
    setAudit(aRes.events || []);
    if (aiRes?.settings) {
      syncAiForm(aiRes.settings);
      setAiAlert(aiRes.alert || null);
    }
  }

  useEffect(() => {
    void loadAdmin();
  }, [user.role, writesOnly]);

  useEffect(() => {
    if (user.role === 'owner') {
      void refreshGoogleModels();
    }
  }, [user.role]);

  async function handleSaveAi(e: React.FormEvent) {
    e.preventDefault();
    setAiSaving(true);
    setAiFeedback(null);
    try {
      const hasNewKey = Boolean(
        aiGeminiKeyInput.trim() || aiAnthropicKeyInput.trim() || aiOpenaiKeyInput.trim(),
      );
      const isHostedLocked = Boolean(aiCfg?.hosted_locked) && !hasNewKey;
      const payload: Parameters<typeof api.adminUpdateAiSettings>[0] = {
        provider: isHostedLocked ? (aiProvider === 'local' ? 'local' : 'auto') : aiProvider,
      };
      if (!isHostedLocked) {
        if (aiModel.trim()) payload.model = aiModel.trim();
        if (!aiCfg?.hosted_model) {
          payload.vertex_project = aiVertexProject.trim();
          payload.vertex_location = aiVertexLocation.trim() || 'global';
        }
      }
      if (aiGeminiKeyInput.trim()) payload.gemini_api_key = aiGeminiKeyInput.trim();
      if (aiAnthropicKeyInput.trim()) payload.anthropic_api_key = aiAnthropicKeyInput.trim();
      if (aiOpenaiKeyInput.trim()) payload.openai_api_key = aiOpenaiKeyInput.trim();

      const res = await api.adminUpdateAiSettings(payload);
      syncAiForm(res.settings);
      setAiAlert(null);
      setAiGeminiKeyInput('');
      setAiAnthropicKeyInput('');
      setAiOpenaiKeyInput('');
      setAiFeedback({
        kind: 'ok',
        text: fr
          ? `Enregistré · ${res.settings.effective_provider === 'local' ? 'Local hors ligne' : `${res.settings.effective_provider.toUpperCase()} : ${res.settings.model}`}`
          : `Saved · ${res.settings.effective_provider === 'local' ? 'Local offline' : `${res.settings.effective_provider.toUpperCase()}: ${res.settings.model}`}`,
      });
      // Immediately fetch the live model list from the newly configured provider!
      await refreshGoogleModels(
        res.settings.effective_provider !== 'local' ? res.settings.effective_provider : res.settings.provider,
        hasNewKey,
      );
    } catch (err) {
      setAiFeedback({
        kind: 'warn',
        text: err instanceof Error ? err.message : fr ? 'Échec de l’enregistrement' : 'Save failed',
      });
    } finally {
      setAiSaving(false);
    }
  }

  async function handleClearProviderKey(which: 'gemini' | 'anthropic' | 'openai') {
    setAiSaving(true);
    setAiFeedback(null);
    try {
      const payload =
        which === 'gemini'
          ? { clear_gemini_api_key: true }
          : which === 'anthropic'
            ? { clear_anthropic_api_key: true }
            : { clear_openai_api_key: true };
      const res = await api.adminUpdateAiSettings(payload);
      syncAiForm(res.settings);
      if (which === 'gemini') setAiGeminiKeyInput('');
      if (which === 'anthropic') setAiAnthropicKeyInput('');
      if (which === 'openai') setAiOpenaiKeyInput('');
      setAiFeedback({
        kind: 'ok',
        text: fr ? 'Clé API supprimée des réglages.' : 'Stored API key cleared.',
      });
      await refreshGoogleModels(res.settings.provider);
    } finally {
      setAiSaving(false);
    }
  }

  async function handleTestAi() {
    setAiTesting(true);
    setAiFeedback(null);
    try {
      const res = await api.adminTestAi();
      const hasWarn = res.warnings && res.warnings.length > 0;
      setAiFeedback({
        kind: hasWarn ? 'warn' : 'ok',
        text: hasWarn
          ? `${res.engine} (${res.latency_ms}ms) · ${res.warnings.join(' · ')}`
          : fr
            ? `OK · ${res.engine} · ${res.items_count} élément(s) extraits en ${res.latency_ms}ms`
            : `OK · ${res.engine} · ${res.items_count} item(s) extracted in ${res.latency_ms}ms`,
      });
    } catch (err) {
      setAiFeedback({
        kind: 'warn',
        text: err instanceof Error ? err.message : fr ? 'Test échoué' : 'Test failed',
      });
    } finally {
      setAiTesting(false);
    }
  }

  async function handleAddProject(e: React.FormEvent) {
    e.preventDefault();
    if (!newProjName.trim()) return;
    setProjErr(null);
    try {
      await api.adminCreateProject({ name: newProjName.trim(), color: newProjColor });
      setNewProjName('');
      setNewProjColor(PROJECT_COLORS[(projects.length + 1) % PROJECT_COLORS.length]);
      await onRefreshProjects();
      await loadAdmin();
    } catch (err) {
      setProjErr(err instanceof Error ? err.message : 'project_create_failed');
    }
  }

  async function handleDeleteProject(p: Project) {
    setProjErr(null);
    try {
      await api.adminDeleteProject(p.id);
      await onRefreshProjects();
      await loadAdmin();
    } catch (err) {
      const code = err instanceof Error ? err.message : '';
      if (code === 'project_has_gigs') {
        setProjErr(
          fr
            ? `Impossible de supprimer « ${p.name} » : des dates y sont encore rattachées.`
            : `Cannot delete "${p.name}": dates are still assigned to this project.`,
        );
      } else if (code === 'project_has_scoped_users') {
        setProjErr(
          fr
            ? `Impossible de supprimer « ${p.name} » : un membre dépend uniquement de ce projet.`
            : `Cannot delete "${p.name}": a team member is scoped exclusively to this project.`,
        );
      } else {
        setProjErr(code || 'delete_failed');
      }
    }
  }

  async function handleAddUser(e: React.FormEvent) {
    e.preventDefault();
    if (!newName.trim()) return;
    const res = await api.adminCreateUser({
      name: newName.trim(),
      role: newRole,
      artist_ids: newArtistIds,
      travel_person_id: newTravelPersonId || null,
    });
    setIssuedSecret({
      label: res.user.name,
      login: fullUrl(`/login?key=${encodeURIComponent(res.login_key)}`),
      mcp: res.mcp_key ? fullUrl(`/mcp/${encodeURIComponent(res.mcp_key)}`) : undefined,
    });
    setNewName('');
    setNewArtistIds([]);
    setNewTravelPersonId('');
    await loadAdmin();
  }

  async function handleToggleUserRole(target: User, role: 'editor' | 'viewer') {
    if (target.role === role) return;
    await api.adminUpdateUser(target.id, { role });
    await loadAdmin();
  }

  async function handleToggleUserProject(target: User, projectId: string | 'all') {
    const current = target.artist_ids || [];
    let next: string[];
    if (projectId === 'all') {
      next = [];
    } else if (current.length === 0) {
      // Narrowing from All -> just this project
      next = [projectId];
    } else if (current.includes(projectId)) {
      // Removing the last explicit project reverts to All projects cleanly
      next = current.filter((id) => id !== projectId);
    } else {
      next = [...current, projectId];
    }
    await api.adminUpdateUser(target.id, { artist_ids: next });
    await loadAdmin();
  }

  async function handleSetUserPerson(target: User, personId: string) {
    await api.adminUpdateUser(target.id, { travel_person_id: personId || null });
    await loadAdmin();
  }

  const effectiveLabel = !aiCfg
    ? '…'
    : aiCfg.hosted_locked && aiCfg.effective_provider !== 'local'
      ? `${hostedUsage?.plan || 'Free Beta'} · ${aiCfg.model}`
      : aiCfg.effective_provider === 'vertex'
        ? `Vertex AI · ${aiCfg.model}`
        : aiCfg.effective_provider === 'gemini'
          ? `Gemini API · ${aiCfg.model}`
          : aiCfg.effective_provider === 'anthropic'
            ? `Anthropic · ${aiCfg.model}`
            : aiCfg.effective_provider === 'openai'
              ? `OpenAI · ${aiCfg.model}`
              : fr
                ? 'Local hors ligne (déterministe)'
                : 'Local offline (deterministic)';

  const isHostedWorkspace = Boolean(aiCfg?.hosted_locked || aiCfg?.hosted_model);
  const isHostedLocked = Boolean(aiCfg?.hosted_locked);
  const modelInList = aiModels.some((m) => m.id === aiModel);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="dk-datebar">
        <strong>{user.name}</strong>
        <span className="mono sub">· {user.role}</span>
        <div className="dk-datebar__acts">
          <button type="button" className="btn" onClick={() => void sync.refreshFull()}>
            {copy.syncNow}
          </button>
          <button type="button" className="btn" onClick={() => void onLogout()}>
            {copy.signOut}
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto bg-[var(--cv-paper)]">
        <div className="sep">{fr ? 'Affichage & langue' : 'Display & language'}</div>
        {community?.enabled && onOpenCommunityShare && (
          <div className="person-row">
            <div>
              <span>{fr ? 'Partager Tour Designer' : 'Share Tour Designer'}</span>
              <div className="sub" style={{ fontSize: 11 }}>
                {community.btc_address || community.lightning_address
                  ? fr
                    ? 'Invitez un DJ, artiste ou tour manager · ou soutenez le projet en Bitcoin'
                    : 'Invite a fellow DJ, artist, or tour manager · or drop an optional Bitcoin tip'
                  : fr
                    ? 'Invitez un DJ, artiste ou tour manager sur la bêta gratuite'
                    : 'Invite a fellow DJ, artist, or tour manager to the free beta'}
              </div>
            </div>
            <button type="button" className="btn" onClick={onOpenCommunityShare}>
              ✦ {fr ? 'Partager' : 'Share'}
              {community.btc_address || community.lightning_address ? ' · ₿' : ''}
            </button>
          </div>
        )}
        <div className="person-row">
          <span>{copy.language}</span>
          <div className="flex gap-1">
            {(['en', 'fr'] as Locale[]).map((l) => (
              <button key={l} type="button" className={`btn${locale === l ? ' dk-sect--on' : ''}`} onClick={() => onLocale(l)}>
                {l.toUpperCase()}
              </button>
            ))}
          </div>
        </div>
        <div className="person-row">
          <span>{copy.theme}</span>
          <div className="flex gap-1">
            {(['night', 'day', 'auto'] as SkinPref[]).map((s) => (
              <button key={s} type="button" className={`btn${skin === s ? ' dk-sect--on' : ''}`} onClick={() => onSkin(s)}>
                {copy[s]}
              </button>
            ))}
          </div>
        </div>
        <div className="person-row">
          <span>{fr ? 'Taille du texte' : 'Text size'}</span>
          <div className="flex gap-1">
            {[0.9, 1, 1.1, 1.25].map((sc) => (
              <button key={sc} type="button" className={`btn${uiScale === sc ? ' dk-sect--on' : ''}`} onClick={() => onScale(sc)}>
                {Math.round(sc * 100)}%
              </button>
            ))}
          </div>
        </div>
        <div className="person-row">
          <span>IndexedDB Offline</span>
          <span className="mono sub">
            {sync.gigs.length} {fr ? 'dates' : 'dates'} · {sync.people.length} contacts · {sync.outbox.length}{' '}
            {fr ? 'en attente' : 'pending'}
          </span>
        </div>

        {hostedUsage && (
          <>
            <div className="sep">
              <span>{fr ? 'Forfait hébergé & quotas' : 'Hosted plan & fair-use quotas'}</span>
              <span className="mono sub" style={{ fontSize: 11 }}>
                {hostedUsage.plan} · Cloud + Gemini AI
              </span>
            </div>
            <div className="person-row text-xs">
              <span>{fr ? 'Extractions Gemini AI aujourd’hui' : 'Hosted Gemini AI today'}</span>
              <span className="mono">
                {hostedUsage.ai_used_today} / {hostedUsage.ai_daily_limit || '∞'}
              </span>
            </div>
            <div className="person-row text-xs">
              <span>{fr ? 'Dates & stockage coffre-fort' : 'Dates & document vault'}</span>
              <span className="mono">
                {hostedUsage.gigs_count}/{hostedUsage.max_gigs || '∞'} {fr ? 'dates' : 'dates'} ·{' '}
                {hostedUsage.storage_mb}/{hostedUsage.max_files_mb || '∞'} MB
              </span>
            </div>
          </>
        )}

        <McpConnectSection user={user} locale={locale} onMcpConnected={onMcpConnected} />

        {user.role === 'owner' && (
          <>
            {/* Multi-Artist / Project Agendas */}
            <div className="sep">
              <span>{fr ? 'Projets / Agendas artistes' : 'Projects / Artist agendas'}</span>
              <span className="mono sub" style={{ fontSize: 11 }}>
                {projects.length} {fr ? 'projet(s)' : projects.length === 1 ? 'project' : 'projects'}
              </span>
            </div>
            <form onSubmit={handleAddProject} className="flex flex-wrap items-center gap-2 border-b border-[var(--cv-line)] p-2.5">
              <input
                className="in flex-1"
                style={{ minWidth: 180 }}
                placeholder={fr ? 'Nom du projet / artiste (ex: Kael, Nova Live)' : 'Artist / project name (e.g. Kael, Nova Live)'}
                value={newProjName}
                onChange={(e) => setNewProjName(e.target.value)}
              />
              <div className="flex items-center gap-1" aria-label={fr ? 'Couleur' : 'Color'}>
                {PROJECT_COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setNewProjColor(c)}
                    style={{
                      width: 18,
                      height: 18,
                      borderRadius: '50%',
                      background: c,
                      border: newProjColor === c ? '2px solid var(--cv-ink)' : '1px solid var(--cv-line)',
                      cursor: 'pointer',
                    }}
                    title={c}
                  />
                ))}
              </div>
              <button type="submit" className="btn btn--def" disabled={!newProjName.trim()}>
                {fr ? '+ Ajouter projet' : '+ Add project'}
              </button>
            </form>
            {projErr && (
              <div className="warn m-2.5" style={{ fontSize: 12 }}>
                {projErr}
              </div>
            )}
            {projects.map((p) => {
              const count = sync.gigs.filter((g) => !g.deleted_at && g.artist_id === p.id).length;
              return (
                <div key={p.id} className="person-row">
                  <span className="flex items-center gap-2">
                    <span style={{ width: 9, height: 9, borderRadius: '50%', background: p.color, flexShrink: 0 }} />
                    <b>{p.name}</b>
                    <span className="mono sub">
                      {count} {fr ? `date${count > 1 ? 's' : ''}` : `date${count !== 1 ? 's' : ''}`}
                    </span>
                  </span>
                  <div className="flex gap-1">
                    <button
                      type="button"
                      className="btn"
                      onClick={() => {
                        const renamed = window.prompt(fr ? 'Renommer le projet' : 'Rename project', p.name);
                        if (renamed && renamed.trim() && renamed.trim() !== p.name) {
                          void api.adminUpdateProject(p.id, { name: renamed.trim() }).then(() => onRefreshProjects());
                        }
                      }}
                    >
                      {fr ? 'Renommer' : 'Rename'}
                    </button>
                    <button type="button" className="btn" onClick={() => void handleDeleteProject(p)}>
                      ×
                    </button>
                  </div>
                </div>
              );
            })}

            {/* Team Access & Scoped Permissions */}
            <div className="sep">
              <span>{copy.teamAccess}</span>
              <span className="sub" style={{ fontSize: 11 }}>
                {fr
                  ? 'Basculez Lecteur / Éditeur et les projets accessibles en 1 clic'
                  : 'Flip Read-only / Editor and project agendas in 1 click'}
              </span>
            </div>
            <form onSubmit={handleAddUser} className="space-y-2 border-b border-[var(--cv-line)] p-3">
              <div className="flex flex-wrap items-center gap-2">
                <input
                  className="in flex-1"
                  style={{ minWidth: 180 }}
                  placeholder={fr ? 'Nom (ex: Road Manager, Artiste, VJ…)' : 'Name (e.g. Road Manager, Artist, VJ…)'}
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                />
                <div className="segs">
                  <button
                    type="button"
                    className={`seg${newRole === 'viewer' ? ' seg--on' : ''}`}
                    onClick={() => setNewRole('viewer')}
                  >
                    {fr ? 'Lecture seule' : 'Read-only'}
                  </button>
                  <button
                    type="button"
                    className={`seg${newRole === 'editor' ? ' seg--on' : ''}`}
                    onClick={() => setNewRole('editor')}
                  >
                    {fr ? 'Éditeur' : 'Editor'}
                  </button>
                </div>
                <button type="submit" className="btn btn--def" disabled={!newName.trim()}>
                  {fr ? 'Créer clés' : 'Create keys'}
                </button>
              </div>

              <div className="flex flex-wrap items-center gap-2 text-xs">
                {projects.length > 0 && (
                  <div className="flex flex-wrap items-center gap-1">
                    <span className="lab">{fr ? 'Agendas :' : 'Agendas:'}</span>
                    <button
                      type="button"
                      className={`btn${newArtistIds.length === 0 ? ' dk-sect--on' : ''}`}
                      style={{ minHeight: 22, padding: '0 8px', fontSize: 11 }}
                      onClick={() => setNewArtistIds([])}
                    >
                      {fr ? 'Tous' : 'All projects'}
                    </button>
                    {projects.map((p) => {
                      const active = newArtistIds.includes(p.id);
                      return (
                        <button
                          key={p.id}
                          type="button"
                          className={`btn${active ? ' dk-sect--on' : ''}`}
                          style={{ minHeight: 22, padding: '0 8px', fontSize: 11 }}
                          onClick={() =>
                            setNewArtistIds((cur) => (cur.includes(p.id) ? cur.filter((x) => x !== p.id) : [...cur, p.id]))
                          }
                        >
                          <span style={{ width: 7, height: 7, borderRadius: '50%', background: p.color, display: 'inline-block' }} />{' '}
                          {p.name}
                        </button>
                      );
                    })}
                  </div>
                )}

                {sync.people.length > 0 && (
                  <label className="flex items-center gap-1.5" style={{ marginLeft: 'auto' }}>
                    <span className="lab">{fr ? 'Personne liée :' : 'Linked person:'}</span>
                    <select
                      className="in"
                      style={{ width: 'auto', minWidth: 150, minHeight: 24, fontSize: 11.5 }}
                      value={newTravelPersonId}
                      onChange={(e) => setNewTravelPersonId(e.target.value)}
                    >
                      <option value="">{fr ? '— Toute l’équipe —' : '— Whole project —'}</option>
                      {sync.people.map((person) => (
                        <option key={person.id} value={person.id}>
                          {person.name}
                          {person.role ? ` (${person.role})` : ''}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
              </div>
            </form>

            {issuedSecret && (
              <div className="dk-next" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 6 }}>
                <div className="flex items-center justify-between gap-2">
                  <strong>
                    {fr
                      ? `Clés pour ${issuedSecret.label} (copier maintenant)`
                      : `Keys for ${issuedSecret.label} (copy now)`}
                  </strong>
                  <button
                    type="button"
                    className="btn"
                    style={{ minHeight: 22, padding: '0 8px', fontSize: 11 }}
                    onClick={() => setIssuedSecret(null)}
                  >
                    ×
                  </button>
                </div>
                {issuedSecret.login && (
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="mono sub break-all">Login: {issuedSecret.login}</span>
                    <button
                      type="button"
                      className="btn btn--def"
                      style={{ minHeight: 24, padding: '0 10px', fontSize: 11.5 }}
                      onClick={() => void copyIssued('login', issuedSecret.login!)}
                    >
                      {copiedKey === 'login' ? (fr ? 'Copié ✓' : 'Copied ✓') : fr ? 'Copier le lien' : 'Copy login link'}
                    </button>
                  </div>
                )}
                {issuedSecret.mcp && (
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="mono sub break-all">MCP: {issuedSecret.mcp}</span>
                    <button
                      type="button"
                      className="btn"
                      style={{ minHeight: 24, padding: '0 10px', fontSize: 11.5 }}
                      onClick={() => void copyIssued('mcp', issuedSecret.mcp!)}
                    >
                      {copiedKey === 'mcp' ? (fr ? 'Copié ✓' : 'Copied ✓') : fr ? 'Copier MCP' : 'Copy MCP URL'}
                    </button>
                  </div>
                )}
              </div>
            )}

            {users.map((u) => {
              const uArtists = u.artist_ids || [];
              return (
                <div key={u.id} className="space-y-1.5 border-b border-[var(--cv-line)] px-3 py-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <b>{u.name}</b>
                      <span className="mono sub" style={{ fontSize: 11 }}>
                        {u.role === 'owner'
                          ? fr
                            ? 'admin · tous projets'
                            : 'owner · all projects'
                          : u.revoked
                            ? fr
                              ? 'RÉVOQUÉ'
                              : 'REVOKED'
                            : uArtists.length === 0
                              ? fr
                                ? 'multi-projets'
                                : 'multi-project'
                              : `${uArtists.length} ${fr ? 'projet(s)' : uArtists.length === 1 ? 'project' : 'projects'}`}
                      </span>
                    </div>

                    {u.role !== 'owner' && (
                      <div className="flex flex-wrap items-center gap-1.5">
                        {/* Instant Read-only / Editor toggle switch */}
                        <div className="segs" role="group" aria-label={fr ? 'Permissions' : 'Permissions'}>
                          <button
                            type="button"
                            className={`seg${u.role === 'viewer' ? ' seg--on' : ''}`}
                            style={{ minHeight: 22, padding: '1px 8px', fontSize: 11 }}
                            onClick={() => void handleToggleUserRole(u, 'viewer')}
                          >
                            {fr ? 'Lecture seule' : 'Read-only'}
                          </button>
                          <button
                            type="button"
                            className={`seg${u.role === 'editor' ? ' seg--on' : ''}`}
                            style={{ minHeight: 22, padding: '1px 8px', fontSize: 11 }}
                            onClick={() => void handleToggleUserRole(u, 'editor')}
                          >
                            {fr ? 'Éditeur' : 'Editor'}
                          </button>
                        </div>

                        <button
                          type="button"
                          className="btn"
                          style={{ minHeight: 24, padding: '0 8px', fontSize: 11.5 }}
                          onClick={() =>
                            void api
                              .adminRotateKey(u.id, 'login')
                              .then((r) =>
                                setIssuedSecret({
                                  label: u.name,
                                  login: fullUrl(`/login?key=${encodeURIComponent(r.login_key || '')}`),
                                }),
                              )
                          }
                        >
                          {fr ? 'Lien login' : 'Login key'}
                        </button>
                        {u.role === 'editor' && (
                          <button
                            type="button"
                            className="btn"
                            style={{ minHeight: 24, padding: '0 8px', fontSize: 11.5 }}
                            onClick={() =>
                              void api
                                .adminRotateKey(u.id, 'mcp')
                                .then((r) =>
                                  setIssuedSecret({
                                    label: u.name,
                                    mcp: fullUrl(`/mcp/${encodeURIComponent(r.mcp_key || '')}`),
                                  }),
                                )
                            }
                          >
                            {fr ? 'Clé MCP' : 'MCP key'}
                          </button>
                        )}
                        <button
                          type="button"
                          className="btn"
                          style={{ minHeight: 24, padding: '0 8px', fontSize: 11.5 }}
                          onClick={() => void api.adminRevokeUser(u.id, !u.revoked).then(() => loadAdmin())}
                        >
                          {u.revoked ? (fr ? 'Rétablir' : 'Restore') : fr ? 'Révoquer' : 'Revoke'}
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Interactive Project Scope + Linked Traveler Row */}
                  {u.role !== 'owner' && (projects.length > 0 || sync.people.length > 0) && (
                    <div className="flex flex-wrap items-center gap-1.5 text-xs">
                      {projects.length > 0 && (
                        <>
                          <span className="sub" style={{ fontSize: 11 }}>
                            {fr ? 'Agendas :' : 'Agendas:'}
                          </span>
                          <button
                            type="button"
                            className={`btn${uArtists.length === 0 ? ' dk-sect--on' : ''}`}
                            style={{ minHeight: 20, padding: '0 7px', fontSize: 11 }}
                            onClick={() => void handleToggleUserProject(u, 'all')}
                          >
                            {fr ? 'Tous' : 'All'}
                          </button>
                          {projects.map((p) => {
                            const active = uArtists.includes(p.id);
                            return (
                              <button
                                key={p.id}
                                type="button"
                                className={`btn${active ? ' dk-sect--on' : ''}`}
                                style={{ minHeight: 20, padding: '0 7px', fontSize: 11 }}
                                onClick={() => void handleToggleUserProject(u, p.id)}
                              >
                                <span
                                  style={{
                                    width: 6,
                                    height: 6,
                                    borderRadius: '50%',
                                    background: p.color,
                                    display: 'inline-block',
                                  }}
                                />{' '}
                                {p.name}
                              </button>
                            );
                          })}
                        </>
                      )}

                      {sync.people.length > 0 && (
                        <select
                          className="in"
                          style={{ width: 'auto', minHeight: 22, fontSize: 11, marginLeft: 'auto' }}
                          aria-label={fr ? 'Personne liée' : 'Linked person'}
                          value={u.travel_person_id || ''}
                          onChange={(e) => void handleSetUserPerson(u, e.target.value)}
                        >
                          <option value="">{fr ? 'Périmètre : tout le projet' : 'Scope: full project'}</option>
                          {sync.people.map((person) => (
                            <option key={person.id} value={person.id}>
                              {fr ? `Voyageur : ${person.name}` : `Only: ${person.name}`}
                            </option>
                          ))}
                        </select>
                      )}
                    </div>
                  )}
                </div>
              );
            })}

            {/* Multi-Provider AI Intake: Hosted Free Beta (Gemini 4 Hydrogen) + Live BYOK (Google / Anthropic / OpenAI) */}
            <div className="sep">
              <span>{fr ? 'AI Intake · Gemini, Anthropic & OpenAI' : 'AI Intake · Gemini, Anthropic & OpenAI'}</span>
              <span className="mono sub" style={{ fontSize: 11 }}>
                {effectiveLabel}
              </span>
            </div>

            <form onSubmit={handleSaveAi} className="space-y-3 border-b border-[var(--cv-line)] p-3">
              {aiAlert && (
                <div className="warn flex flex-wrap items-center justify-between gap-2" style={{ fontSize: 12, padding: '8px 10px' }}>
                  <span>
                    <strong>{fr ? 'Modèle obsolète détecté :' : 'Model deprecation alert:'}</strong>{' '}
                    <span className="mono">{aiAlert.model}</span> — {aiAlert.reason}
                    {aiAlert.recommended_model && (
                      <>
                        {' · '}
                        {fr ? 'Recommandé :' : 'Recommended:'}{' '}
                        <span className="mono">{aiAlert.recommended_model}</span>
                      </>
                    )}
                  </span>
                  {aiAlert.recommended_model && !isHostedLocked && (
                    <button
                      type="button"
                      className="btn btn--def"
                      style={{ minHeight: 24, padding: '0 10px', fontSize: 11.5 }}
                      onClick={() => setAiModel(aiAlert.recommended_model!)}
                    >
                      {fr ? `Utiliser ${aiAlert.recommended_model}` : `Switch to ${aiAlert.recommended_model}`}
                    </button>
                  )}
                </div>
              )}

              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="lab">{fr ? 'Moteur AI Intake' : 'AI intake engine'}</div>
                  <div className="sub" style={{ fontSize: 11 }}>
                    {isHostedLocked
                      ? fr
                        ? `Inclus gratuitement (${aiCfg?.model}${aiCfg?.hosted_thinking_level ? ` · thinking: ${aiCfg.hosted_thinking_level}` : ''}). Ajoutez votre propre clé Gemini, Anthropic ou OpenAI ci-dessous pour débloquer tous les modèles en direct.`
                        : `Included free (${aiCfg?.model}${aiCfg?.hosted_thinking_level ? ` · thinking: ${aiCfg.hosted_thinking_level}` : ''}). Add your own Gemini, Anthropic, or OpenAI key below to unlock all live models & unlimited extractions.`
                      : fr
                        ? 'Liste mise à jour en direct dès qu’une clé est détectée · Sonnet 5.5+ recommandé (Anthropic), Astra+ (OpenAI), Gemini 4 (Google).'
                        : 'Live model list refreshes automatically once a key is detected · Gemini 4 (Google), Sonnet 5.5+ (Anthropic), Astra+ (OpenAI).'}
                  </div>
                </div>
                <div className="flex flex-wrap gap-1">
                  {(isHostedLocked
                    ? ([
                        ['auto', hostedUsage?.plan ? `${hostedUsage.plan}` : 'Hosted Beta'],
                        ['local', 'Local'],
                      ] as Array<[AiProvider, string]>)
                    : isHostedWorkspace
                      ? ([
                          ['gemini', 'Gemini API'],
                          ['anthropic', 'Anthropic'],
                          ['openai', 'OpenAI'],
                          ['local', 'Local'],
                        ] as Array<[AiProvider, string]>)
                      : ([
                          ['auto', 'Auto'],
                          ['vertex', 'Vertex AI'],
                          ['gemini', 'Gemini API'],
                          ['anthropic', 'Anthropic'],
                          ['openai', 'OpenAI'],
                          ['local', 'Local'],
                        ] as Array<[AiProvider, string]>)
                  ).map(([val, label]) => (
                    <button
                      key={val}
                      type="button"
                      className={`btn${aiProvider === val ? ' dk-sect--on' : ''}`}
                      onClick={() => {
                        setAiProvider(val);
                        if (!isHostedLocked && val !== 'local') {
                          void refreshGoogleModels(val, true);
                        }
                      }}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              {isHostedLocked ? (
                <div className="dk-next flex flex-wrap items-center justify-between gap-2" style={{ fontSize: 12, padding: '8px 10px' }}>
                  <span>
                    <strong className="mono">{aiCfg?.model || 'gemini-4-hydrogen'}</strong>
                    <span className="sub">
                      {' · '}
                      {fr ? 'Verrouillé Free Beta' : 'Locked Free Beta'}
                      {aiCfg?.hosted_thinking_level ? ` · thinking: ${aiCfg.hosted_thinking_level}` : ''}
                    </span>
                  </span>
                  <span className="mono sub" style={{ fontSize: 11 }}>
                    {hostedUsage?.ai_daily_limit
                      ? `${hostedUsage.ai_used_today}/${hostedUsage.ai_daily_limit} ${fr ? 'aujourd’hui' : 'today'}`
                      : fr
                        ? 'Inclus gratuitement'
                        : 'Included free'}
                  </span>
                </div>
              ) : (
                <div className="grid gap-2 sm:grid-cols-2">
                  <label className="space-y-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="lab">{fr ? 'Modèles disponibles en direct' : 'Available models (live)'}</span>
                      <span className="mono sub" style={{ fontSize: 10 }}>
                        {aiCatalogSource === 'live_google'
                          ? `Live Google · ${aiModels.length}`
                          : aiCatalogSource === 'live_anthropic'
                            ? `Live Anthropic · ${aiModels.length}`
                            : aiCatalogSource === 'live_openai'
                              ? `Live OpenAI · ${aiModels.length}`
                              : fr
                                ? 'Catalogue par défaut'
                                : 'Starter catalog'}
                        {aiFetchedAt ? ` · ${aiFetchedAt.slice(11, 16)}` : ''}
                      </span>
                    </div>
                    <div className="flex gap-1.5">
                      <select
                        className="in flex-1 mono"
                        value={modelInList ? aiModel : '__custom__'}
                        onChange={(e) => {
                          if (e.target.value !== '__custom__') setAiModel(e.target.value);
                        }}
                      >
                        {!modelInList && (
                          <option value="__custom__">
                            {fr ? `Personnalisé : ${aiModel || '—'}` : `Custom: ${aiModel || '—'}`}
                          </option>
                        )}
                        {aiModels.map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.recommended ? '★ ' : ''}
                            {m.display_name} ({m.id})
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        className="btn"
                        disabled={aiLoadingModels}
                        onClick={() => void refreshGoogleModels(aiProvider)}
                        title={fr ? 'Actualiser la liste des modèles en direct' : 'Fetch latest live models from provider'}
                      >
                        {aiLoadingModels ? '…' : fr ? '↻ Actualiser' : '↻ Refresh'}
                      </button>
                    </div>
                  </label>

                  <label className="space-y-1">
                    <span className="lab">{fr ? 'ID de modèle actif (évolutif / futur)' : 'Active model ID (future-proof)'}</span>
                    <input
                      className="in mono"
                      value={aiModel}
                      onChange={(e) => setAiModel(e.target.value)}
                      placeholder="gemini-4-hydrogen"
                      required
                    />
                  </label>
                </div>
              )}

              {!isHostedWorkspace && (
                <div className="grid gap-2 sm:grid-cols-2">
                  <label className="space-y-1">
                    <span className="lab">
                      Vertex Project (GCP)
                      {aiCfg?.vertex_project_source === 'env' ? ' · .env' : ''}
                    </span>
                    <input
                      className="in mono"
                      value={aiVertexProject}
                      onChange={(e) => setAiVertexProject(e.target.value)}
                      placeholder="my-workspace-gcp-project"
                    />
                  </label>
                  <label className="space-y-1">
                    <span className="lab">{fr ? 'Région Vertex' : 'Vertex region'}</span>
                    <input
                      className="in mono"
                      value={aiVertexLocation}
                      onChange={(e) => setAiVertexLocation(e.target.value)}
                      placeholder="global"
                      list="td-vertex-regions"
                    />
                    <datalist id="td-vertex-regions">
                      <option value="global" />
                      <option value="europe-west1" />
                      <option value="europe-west4" />
                      <option value="us-central1" />
                      <option value="asia-northeast1" />
                    </datalist>
                  </label>
                </div>
              )}

              <div className="grid gap-2 sm:grid-cols-3">
                <label className="space-y-1">
                  <div className="flex items-center justify-between gap-1">
                    <span className="lab">Gemini API Key</span>
                    {aiCfg?.gemini_api_key_configured && (
                      <span className="mono sub" style={{ fontSize: 10 }}>
                        {aiCfg.gemini_api_key_source === 'env' ? '.env · ' : ''}
                        {aiCfg.gemini_api_key_hint}
                      </span>
                    )}
                  </div>
                  <div className="flex gap-1">
                    <input
                      type="password"
                      className="in mono flex-1"
                      value={aiGeminiKeyInput}
                      onChange={(e) => setAiGeminiKeyInput(e.target.value)}
                      placeholder={
                        aiCfg?.gemini_api_key_configured
                          ? fr
                            ? 'Laisser vide pour conserver'
                            : 'Leave blank to keep'
                          : 'AIza… (BYOK)'
                      }
                      autoComplete="new-password"
                    />
                    {aiCfg?.gemini_api_key_source === 'settings' && (
                      <button
                        type="button"
                        className="btn"
                        disabled={aiSaving}
                        onClick={() => void handleClearProviderKey('gemini')}
                        title={fr ? 'Supprimer la clé Gemini' : 'Clear saved Gemini key'}
                      >
                        ×
                      </button>
                    )}
                  </div>
                </label>

                <label className="space-y-1">
                  <div className="flex items-center justify-between gap-1">
                    <span className="lab">Anthropic Key · Sonnet 5.5+</span>
                    {aiCfg?.anthropic_api_key_configured && (
                      <span className="mono sub" style={{ fontSize: 10 }}>
                        {aiCfg.anthropic_api_key_source === 'env' ? '.env · ' : ''}
                        {aiCfg.anthropic_api_key_hint}
                      </span>
                    )}
                  </div>
                  <div className="flex gap-1">
                    <input
                      type="password"
                      className="in mono flex-1"
                      value={aiAnthropicKeyInput}
                      onChange={(e) => setAiAnthropicKeyInput(e.target.value)}
                      placeholder={
                        aiCfg?.anthropic_api_key_configured
                          ? fr
                            ? 'Laisser vide pour conserver'
                            : 'Leave blank to keep'
                          : 'sk-ant-… (BYOK)'
                      }
                      autoComplete="new-password"
                    />
                    {aiCfg?.anthropic_api_key_source === 'settings' && (
                      <button
                        type="button"
                        className="btn"
                        disabled={aiSaving}
                        onClick={() => void handleClearProviderKey('anthropic')}
                        title={fr ? 'Supprimer la clé Anthropic' : 'Clear saved Anthropic key'}
                      >
                        ×
                      </button>
                    )}
                  </div>
                </label>

                <label className="space-y-1">
                  <div className="flex items-center justify-between gap-1">
                    <span className="lab">OpenAI Key · Astra+</span>
                    {aiCfg?.openai_api_key_configured && (
                      <span className="mono sub" style={{ fontSize: 10 }}>
                        {aiCfg.openai_api_key_source === 'env' ? '.env · ' : ''}
                        {aiCfg.openai_api_key_hint}
                      </span>
                    )}
                  </div>
                  <div className="flex gap-1">
                    <input
                      type="password"
                      className="in mono flex-1"
                      value={aiOpenaiKeyInput}
                      onChange={(e) => setAiOpenaiKeyInput(e.target.value)}
                      placeholder={
                        aiCfg?.openai_api_key_configured
                          ? fr
                            ? 'Laisser vide pour conserver'
                            : 'Leave blank to keep'
                          : 'sk-… (BYOK)'
                      }
                      autoComplete="new-password"
                    />
                    {aiCfg?.openai_api_key_source === 'settings' && (
                      <button
                        type="button"
                        className="btn"
                        disabled={aiSaving}
                        onClick={() => void handleClearProviderKey('openai')}
                        title={fr ? 'Supprimer la clé OpenAI' : 'Clear saved OpenAI key'}
                      >
                        ×
                      </button>
                    )}
                  </div>
                </label>
              </div>

              {aiCatalogNote && (
                <div className="sub" style={{ fontSize: 11 }}>
                  {aiCatalogNote}
                </div>
              )}

              {aiFeedback && (
                <div
                  className={aiFeedback.kind === 'warn' ? 'warn mono' : 'dk-next mono'}
                  style={{ fontSize: 12, padding: '6px 10px' }}
                >
                  {aiFeedback.text}
                </div>
              )}

              <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                <span className="sub" style={{ fontSize: 11 }}>
                  {fr
                    ? 'Effet immédiat sans redémarrage · repli local automatique hors ligne.'
                    : 'Applies immediately with zero restart · automatic offline fallback.'}
                </span>
                <div className="flex gap-1.5">
                  <button type="button" className="btn" disabled={aiTesting || aiSaving} onClick={() => void handleTestAi()}>
                    {aiTesting ? (fr ? 'Test…' : 'Testing…') : fr ? 'Tester l’IA' : 'Test AI'}
                  </button>
                  <button
                    type="submit"
                    className="btn btn--def"
                    disabled={aiSaving || (!isHostedLocked && !aiModel.trim())}
                  >
                    {aiSaving ? '…' : copy.save}
                  </button>
                </div>
              </div>
            </form>

            {/* Privacy, Data Export & Erasure (US CCPA/CPRA & Mexico LFPDPPP ARCO) */}
            <div className="sep">
              <span>{fr ? 'Confidentialité & droits sur vos données (ARCO / CCPA)' : 'Privacy, Data Export & Deletion (US CCPA & Mexico LFPDPPP)'}</span>
              {onNavigate && (
                <span className="flex gap-2 font-normal">
                  <button
                    type="button"
                    className="sub underline"
                    style={{ background: 'none', border: 0, padding: 0, cursor: 'pointer', fontSize: 11 }}
                    onClick={() => onNavigate('/legal/privacy')}
                  >
                    {fr ? 'Confidentialité' : 'Privacy Notice'}
                  </button>
                  <button
                    type="button"
                    className="sub underline"
                    style={{ background: 'none', border: 0, padding: 0, cursor: 'pointer', fontSize: 11 }}
                    onClick={() => onNavigate('/legal/terms')}
                  >
                    {fr ? 'Conditions' : 'Terms'}
                  </button>
                </span>
              )}
            </div>
            <div className="space-y-2 border-b border-[var(--cv-line)] p-3 text-xs">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="sub">
                  {fr
                    ? 'Exportez toutes vos données (JSON) ou supprimez définitivement votre espace.'
                    : 'Download a full JSON copy of your workspace or permanently erase all workspace data.'}
                </span>
                <div className="flex flex-wrap gap-1.5">
                  <button
                    type="button"
                    className="btn"
                    disabled={exporting}
                    onClick={async () => {
                      setExporting(true);
                      try {
                        const res = await api.accountExport();
                        const blob = new Blob([JSON.stringify(res.export, null, 2)], { type: 'application/json' });
                        const url = URL.createObjectURL(blob);
                        const a = document.createElement('a');
                        a.href = url;
                        a.download = `tour-designer-export-${new Date().toISOString().slice(0, 10)}.json`;
                        a.click();
                        URL.revokeObjectURL(url);
                      } finally {
                        setExporting(false);
                      }
                    }}
                  >
                    {exporting ? '…' : fr ? 'Exporter mes données (JSON)' : 'Download my data (JSON)'}
                  </button>
                  <button
                    type="button"
                    className="btn"
                    onClick={() => {
                      setDeleteOpen((v) => !v);
                      setDeleteConfirm('');
                    }}
                  >
                    {fr ? 'Supprimer mon espace' : 'Delete workspace'}
                  </button>
                </div>
              </div>

              {deleteOpen && (
                <div className="warn flex flex-wrap items-center gap-2 p-2">
                  <span>
                    {fr
                      ? 'Action irréversible. Tapez DELETE pour tout supprimer :'
                      : 'Permanent erasure. Type DELETE to wipe all dates, files, keys, and workspace data:'}
                  </span>
                  <input
                    className="in mono"
                    style={{ width: 120 }}
                    value={deleteConfirm}
                    onChange={(e) => setDeleteConfirm(e.target.value)}
                    placeholder="DELETE"
                  />
                  <button
                    type="button"
                    className="btn btn--def"
                    disabled={deletingAcct || deleteConfirm.trim().toUpperCase() !== 'DELETE'}
                    onClick={async () => {
                      setDeletingAcct(true);
                      try {
                        await api.accountDelete('DELETE');
                        await purgeOfflineCopy();
                        localStorage.removeItem('td_last_user');
                        window.location.assign(withBase('/login'));
                      } finally {
                        setDeletingAcct(false);
                      }
                    }}
                  >
                    {deletingAcct ? '…' : fr ? 'Confirmer la suppression' : 'Confirm permanent delete'}
                  </button>
                </div>
              )}
            </div>

            {/* Audit Log */}
            <div className="sep">
              <span>{fr ? `Journal d’audit (${audit.length})` : `Audit log (${audit.length})`}</span>
              <label className="inline-flex cursor-pointer items-center gap-1.5 font-normal">
                <input type="checkbox" checked={writesOnly} onChange={(e) => setWritesOnly(e.target.checked)} />
                {fr ? 'Écritures seules' : 'Writes only'}
              </label>
            </div>
            {audit.map((ev) => (
              <div key={ev.id} className="person-row text-xs">
                <span>
                  <b>{ev.actor_name || 'System'}</b> <span className="mono sub">[{ev.channel}]</span> · {ev.summary || ev.action}
                </span>
                <span className="mono sub">{ev.ts.slice(0, 16).replace('T', ' ')}</span>
              </div>
            ))}
          </>
        )}

        {user.role === 'owner' && trash.length > 0 && (
          <>
            <div className="sep">{fr ? `Corbeille (${trash.length})` : `Trash (${trash.length})`}</div>
            {trash.map((g) => (
              <div key={g.id} className="person-row">
                <span>
                  <span className="mono">{g.date}</span> · {g.city} {g.venue}
                </span>
                <div className="flex gap-1">
                  <button
                    type="button"
                    className="btn"
                    onClick={() => void api.restoreTrash(g.id).then(() => Promise.all([loadAdmin(), sync.refreshFull()]))}
                  >
                    {fr ? 'Restaurer' : 'Restore'}
                  </button>
                  <button
                    type="button"
                    className="btn"
                    onClick={() => {
                      if (!window.confirm(fr ? 'Supprimer définitivement ?' : 'Delete permanently?')) return;
                      void fetch(withBase(`/api/trash/${encodeURIComponent(g.id)}`), { method: 'DELETE', credentials: 'same-origin' }).then(() =>
                        loadAdmin(),
                      );
                    }}
                  >
                    {fr ? 'Détruire' : 'Destroy'}
                  </button>
                </div>
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
}
