import { withBase } from '../lib/basePath';
import type { FileRecord, Gig, GigItem, HistoryEvent, Person, Project, ShareLink, User } from '../types';

export interface HostedUsage {
  plan: string;
  ai_used_today: number;
  ai_daily_limit: number;
  gigs_count: number;
  max_gigs: number;
  storage_mb: number;
  max_files_mb: number;
}

export interface CommunityShareConfig {
  enabled: boolean;
  milestone_gigs: number;
  share_url: string;
  btc_address: string;
  lightning_address: string;
}

export interface AuthMeResponse {
  authenticated: boolean;
  user: User | null;
  auth_enforced: boolean;
  tenancy_mode?: 'single' | 'multi';
  base_path?: string;
  google_oauth_enabled?: boolean;
  email_password_enabled?: boolean;
  password_login_enabled?: boolean;
  hosted_plan?: string | null;
  hosted_usage?: HostedUsage | null;
  landing_video_url?: string;
  share_footer_branding?: boolean;
  community?: CommunityShareConfig | null;
  tenant_id?: string | null;
  is_platform_admin?: boolean;
  reason?: string | null;
  legal?: {
    operator_name: string;
    contact_email: string;
    operator_address: string;
    effective_date: string;
  };
}

export class ApiError extends Error {
  status: number;
  code: string;
  current?: Record<string, unknown>;

  constructor(status: number, code: string, current?: Record<string, unknown>) {
    super(code);
    this.status = status;
    this.code = code;
    this.current = current;
  }
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(withBase(path), {
    credentials: 'same-origin',
    cache: 'no-store',
    ...init,
    headers: {
      ...(init?.body && !(init.body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}),
      ...(init?.headers || {}),
    },
  });
  const body = await res.json().catch(() => ({ ok: false, error: `http_${res.status}` }));
  if (!res.ok || body.ok === false) {
    throw new ApiError(res.status, body.error || `http_${res.status}`, body.current);
  }
  return body as T;
}

export const api = {
  me: () => req<AuthMeResponse>('/api/auth/me'),
  legalInfo: () =>
    req<{
      operator_name: string;
      contact_email: string;
      operator_address: string;
      effective_date: string;
      tenancy_mode: string;
      hosted_plan: string;
      hosted_ai_daily_limit: number;
      hosted_max_gigs: number;
      hosted_max_files_mb: number;
    }>('/api/legal/info'),
  accountExport: () => req<{ export: Record<string, unknown> }>('/api/account/export'),
  accountDelete: (confirm: string) =>
    req<{ deleted: boolean }>('/api/account/delete', { method: 'POST', body: JSON.stringify({ confirm }) }),
  ownerLogin: (password: string) =>
    req<{ user: User }>('/api/auth/owner-login', { method: 'POST', body: JSON.stringify({ password }) }),
  registerAccount: (payload: { name?: string; email: string; password: string; consent: boolean }) =>
    req<{ user: User; tenant_id: string }>('/api/auth/register', { method: 'POST', body: JSON.stringify(payload) }),
  passwordLogin: (payload: { email: string; password: string }) =>
    req<{ user: User; tenant_id: string }>('/api/auth/password-login', { method: 'POST', body: JSON.stringify(payload) }),
  keyLogin: (key: string, device = false) =>
    req<{ user: User }>('/api/auth/key-login', { method: 'POST', body: JSON.stringify({ key, device }) }),
  logout: () => req('/api/auth/logout', { method: 'POST' }),
  issueMyMcpKey: () =>
    req<{ mcp_key: string; mcp_url: string; bearer_endpoint: string; user: User }>('/api/auth/my-mcp-key', {
      method: 'POST',
    }),
  revokeMyMcpKey: () => req<{ user: User }>('/api/auth/my-mcp-key', { method: 'DELETE' }),

  listGigs: (includeItems = true) => req<{ gigs: Gig[] }>(`/api/gigs?include_items=${includeItems}`),
  getGig: (id: string) => req<{ gig: Gig }>(`/api/gigs/${encodeURIComponent(id)}`),
  changesSince: (since?: string | null) =>
    req<{ cursor: string; full: boolean; changed_gig_ids: string[]; changed_people_ids: string[] }>(
      `/api/gigs/changes${since ? `?since=${encodeURIComponent(since)}` : ''}`,
    ),
  createGig: (payload: Partial<Gig>) =>
    req<{ gig: Gig }>('/api/gigs', { method: 'POST', body: JSON.stringify(payload) }),
  updateGig: (id: string, patch: Record<string, unknown>, expectedVersion?: number) =>
    req<{ gig: Gig }>(`/api/gigs/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify({ ...patch, ...(expectedVersion !== undefined ? { expected_version: expectedVersion } : {}) }),
    }),
  deleteGig: (id: string) => req(`/api/gigs/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  addItems: (gigId: string, items: Array<{ id?: string; collection: string; data: Record<string, unknown>; person_ids?: string[] }>) =>
    req<{ items: GigItem[] }>(`/api/gigs/${encodeURIComponent(gigId)}/items`, {
      method: 'POST',
      body: JSON.stringify({ items }),
    }),
  updateItem: (gigId: string, itemId: string, data: Record<string, unknown>, expectedVersion?: number, personIds?: string[]) =>
    req<{ item: GigItem }>(`/api/gigs/${encodeURIComponent(gigId)}/items/${encodeURIComponent(itemId)}`, {
      method: 'PATCH',
      body: JSON.stringify({
        data,
        ...(expectedVersion !== undefined ? { expected_version: expectedVersion } : {}),
        ...(personIds !== undefined ? { person_ids: personIds } : {}),
      }),
    }),
  removeItem: (gigId: string, itemId: string, expectedVersion?: number) =>
    req(`/api/gigs/${encodeURIComponent(gigId)}/items/${encodeURIComponent(itemId)}${expectedVersion !== undefined ? `?expected_version=${expectedVersion}` : ''}`, {
      method: 'DELETE',
    }),
  gigHistory: (gigId: string, limit = 50) =>
    req<{ events: HistoryEvent[] }>(`/api/gigs/${encodeURIComponent(gigId)}/history?limit=${limit}`),
  undoBatch: (gigId: string, batchId: string) =>
    req<{ removed: string[]; kept: string[] }>(`/api/gigs/${encodeURIComponent(gigId)}/history/${encodeURIComponent(batchId)}/undo`, {
      method: 'POST',
    }),

  listPeople: () => req<{ people: Person[] }>('/api/people'),
  createPerson: (payload: Partial<Person>) =>
    req<{ person: Person }>('/api/people', { method: 'POST', body: JSON.stringify(payload) }),
  updatePerson: (id: string, patch: Partial<Person>, expectedVersion?: number) =>
    req<{ person: Person }>(`/api/people/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify({ ...patch, ...(expectedVersion !== undefined ? { expected_version: expectedVersion } : {}) }),
    }),
  mergePeople: (sourceId: string, targetId: string) =>
    req<{ person: Person }>('/api/people/merge', {
      method: 'POST',
      body: JSON.stringify({ source_id: sourceId, target_id: targetId }),
    }),

  listFiles: (gigId?: string) => req<{ files: FileRecord[] }>(`/api/files${gigId ? `?gig_id=${encodeURIComponent(gigId)}` : ''}`),
  uploadFile: async (
    file: File,
    gigId?: string,
    opts?: { personId?: string; docKind?: string; docExpires?: string; scope?: 'crew' | 'private' },
  ): Promise<FileRecord> => {
    const signed = await req<{ mode: string; object_id: string; gcs_key: string; upload_url: string }>('/api/files/sign-upload', {
      method: 'POST',
      body: JSON.stringify({ name: file.name, mime: file.type || 'application/octet-stream' }),
    });
    if (signed.mode === 'gcs_signed_put') {
      const putRes = await fetch(signed.upload_url, {
        method: 'PUT',
        headers: { 'Content-Type': file.type || 'application/octet-stream' },
        body: file,
      });
      if (!putRes.ok) throw new ApiError(putRes.status, 'gcs_upload_failed');
      const confirmed = await req<{ file: FileRecord }>('/api/files/confirm', {
        method: 'POST',
        body: JSON.stringify({
          object_id: signed.object_id,
          gcs_key: signed.gcs_key,
          gig_id: gigId,
          person_id: opts?.personId,
          doc_kind: opts?.docKind,
          doc_expires: opts?.docExpires,
          scope: opts?.scope || 'crew',
          name: file.name,
          mime: file.type || 'application/octet-stream',
          size: file.size,
        }),
      });
      return confirmed.file;
    }
    const fd = new FormData();
    fd.append('file', file);
    if (gigId) fd.append('gig_id', gigId);
    if (opts?.personId) fd.append('person_id', opts.personId);
    if (opts?.docKind) fd.append('doc_kind', opts.docKind);
    if (opts?.docExpires) fd.append('doc_expires', opts.docExpires);
    if (opts?.scope) fd.append('scope', opts.scope);
    const res = await req<{ file: FileRecord }>('/api/files/upload', { method: 'POST', body: fd });
    return res.file;
  },
  updateFile: (id: string, patch: Partial<Pick<FileRecord, 'name' | 'pinned' | 'gig_id' | 'person_id' | 'doc_kind' | 'doc_country' | 'doc_expires' | 'scope'>>) =>
    req<{ file: FileRecord }>(`/api/files/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  deleteFile: (id: string) => req(`/api/files/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  listShares: (gigId?: string) => req<{ shares: ShareLink[] }>(`/api/shares${gigId ? `?gig_id=${encodeURIComponent(gigId)}` : ''}`),
  createShare: (payload: Partial<ShareLink>) =>
    req<{ share: ShareLink }>('/api/shares', { method: 'POST', body: JSON.stringify(payload) }),
  resolveShare: (key: string) =>
    req<{
      scope: string;
      label: string;
      person?: { id: string; name: string; role?: string } | null;
      gigs: Gig[];
      show_footer?: boolean;
      launch_url?: string;
    }>(`/api/share/resolve/${encodeURIComponent(key)}`),

  submitInterest: (payload: { name?: string; email: string; org?: string; roster_size?: string; notes?: string }) =>
    req<{ id: string; received: boolean }>('/api/public/interest', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  extractIntake: (text: string, gigId?: string) =>
    req<{
      proposal: {
        engine: string;
        provider?: string;
        model?: string;
        gig_patch: Record<string, unknown>;
        items: Array<{ collection: string; data: Record<string, unknown> }>;
        multi_dates?: Array<{
          date: string;
          city: string;
          venue: string;
          country?: string;
          status?: string;
          set_time?: string;
          promoter?: string;
        }>;
        warnings: string[];
      };
    }>('/api/intake/extract', { method: 'POST', body: JSON.stringify({ text, gig_id: gigId }) }),
  intakeStatus: () =>
    req<{
      provider: string;
      configured_provider: string;
      model: string;
      google_connected: boolean;
      ai_connected?: boolean;
      hosted_locked?: boolean;
    }>('/api/intake/status'),
  adminGetAiSettings: () =>
    req<{
      settings: {
        provider: 'auto' | 'vertex' | 'gemini' | 'anthropic' | 'openai' | 'local';
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
      };
      alert?: {
        model: string;
        reason: string;
        recommended_model?: string;
        status_code?: number | null;
        detected_at?: string;
      } | null;
    }>('/api/admin/ai-settings'),
  adminUpdateAiSettings: (payload: {
    provider?: 'auto' | 'vertex' | 'gemini' | 'anthropic' | 'openai' | 'local';
    model?: string;
    vertex_project?: string;
    vertex_location?: string;
    gemini_api_key?: string;
    clear_gemini_api_key?: boolean;
    anthropic_api_key?: string;
    clear_anthropic_api_key?: boolean;
    openai_api_key?: string;
    clear_openai_api_key?: boolean;
  }) =>
    req<{
      settings: {
        provider: 'auto' | 'vertex' | 'gemini' | 'anthropic' | 'openai' | 'local';
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
      };
    }>('/api/admin/ai-settings', { method: 'PUT', body: JSON.stringify(payload) }),
  adminListAiModels: (provider?: string) =>
    req<{
      models: Array<{
        id: string;
        display_name: string;
        description?: string;
        recommended?: boolean;
        provider?: string;
        input_token_limit?: number | null;
        output_token_limit?: number | null;
      }>;
      source: 'live_google' | 'live_anthropic' | 'live_openai' | 'fallback_catalog' | 'hosted_locked';
      provider_queried: string;
      active_model: string;
      effective_provider: string;
      hosted_locked?: boolean;
      fetched_at: string;
      note?: string | null;
    }>(`/api/admin/ai-models${provider ? `?provider=${encodeURIComponent(provider)}` : ''}`),
  adminTestAi: (text?: string) =>
    req<{
      latency_ms: number;
      engine: string;
      provider: string;
      model: string;
      configured_model: string;
      items_count: number;
      warnings: string[];
    }>('/api/admin/ai-test', { method: 'POST', body: JSON.stringify(text ? { text } : {}) }),
  applyIntake: (gigId: string, proposal: { gig_patch?: Record<string, unknown>; items: Array<{ collection: string; data: Record<string, unknown> }> }) =>
    req<{ batch_id: string; gig: Gig; added: GigItem[] }>('/api/intake/apply', {
      method: 'POST',
      body: JSON.stringify({ gig_id: gigId, ...proposal }),
    }),

  searchCities: (q: string) =>
    req<{ cities: Array<{ city: string; country: string; timezone: string }> }>(
      `/api/places/cities?q=${encodeURIComponent(q)}`,
    ),
  lookupFlight: (flightNo: string) =>
    req<{ candidates: Array<Record<string, unknown>>; provider: string }>(`/api/flights/lookup?flight_no=${encodeURIComponent(flightNo)}`),

  listProjects: () => req<{ projects: Project[] }>('/api/projects'),
  adminCreateProject: (payload: { name: string; color?: string; notes?: string }) =>
    req<{ project: Project }>('/api/admin/projects', { method: 'POST', body: JSON.stringify(payload) }),
  adminUpdateProject: (projectId: string, patch: { name?: string; color?: string; notes?: string; archived?: boolean }) =>
    req<{ project: Project }>(`/api/admin/projects/${encodeURIComponent(projectId)}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),
  adminDeleteProject: (projectId: string) =>
    req<{ project_id: string }>(`/api/admin/projects/${encodeURIComponent(projectId)}`, { method: 'DELETE' }),

  adminUsers: () => req<{ users: User[] }>('/api/admin/users'),
  adminCreateUser: (payload: {
    name: string;
    email?: string;
    role: string;
    artist_ids?: string[];
    travel_person_id?: string | null;
  }) =>
    req<{ user: User; login_key: string; mcp_key?: string | null }>('/api/admin/users', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  adminUpdateUser: (
    userId: string,
    patch: { name?: string; role?: 'editor' | 'viewer'; artist_ids?: string[]; travel_person_id?: string | null },
  ) =>
    req<{ user: User }>(`/api/admin/users/${encodeURIComponent(userId)}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),
  adminRotateKey: (userId: string, kind: 'login' | 'mcp') =>
    req<{ user: User; login_key?: string; mcp_key?: string }>(`/api/admin/users/${encodeURIComponent(userId)}/rotate-key`, {
      method: 'POST',
      body: JSON.stringify({ kind }),
    }),
  adminRevokeUser: (userId: string, revoked: boolean) =>
    req<{ user: User }>(`/api/admin/users/${encodeURIComponent(userId)}/revoke`, {
      method: 'POST',
      body: JSON.stringify({ revoked }),
    }),
  listTrash: () => req<{ gigs: Gig[] }>('/api/trash'),
  restoreTrash: (gigId: string) => req(`/api/trash/${encodeURIComponent(gigId)}/restore`, { method: 'POST' }),
  destroyTrash: (gigId: string) => req(`/api/trash/${encodeURIComponent(gigId)}`, { method: 'DELETE' }),
  adminAudit: (limit = 60, writes = false) =>
    req<{ events: Array<{ id: string; at: string; actor_name?: string; channel?: string; action: string; target?: string; summary: string }> }>(
      `/api/admin/audit?limit=${limit}&writes=${writes}`,
    ),
  checkUpdate: (force = false) =>
    req<UpdateCheckStatus>(`/api/system/update-check${force ? '?force=true' : ''}`),
  platformAdminOverview: () =>
    req<PlatformAdminOverview>('/api/platform-admin/overview'),
  platformAdminUpdateTenant: (
    tenantId: string,
    patch: {
      plan?: string;
      ai_daily_limit?: number | null;
      max_gigs?: number | null;
      max_files_mb?: number | null;
      suspended?: boolean;
      admin_notes?: string;
    },
  ) =>
    req<{ tenant: PlatformTenantRecord }>(`/api/platform-admin/tenants/${encodeURIComponent(tenantId)}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),
  platformAdminResetAi: (tenantId: string) =>
    req<{ tenant: PlatformTenantRecord }>(`/api/platform-admin/tenants/${encodeURIComponent(tenantId)}/reset-ai`, {
      method: 'POST',
    }),
};

export interface PlatformTenantRecord {
  tenant_id: string;
  name: string;
  email: string;
  auth_provider: 'google' | 'email';
  plan: string;
  created_at: string;
  last_login_at: string;
  suspended: boolean;
  admin_notes: string;
  usage: {
    gigs_count: number;
    max_gigs: number;
    people_count: number;
    files_count: number;
    storage_mb: number;
    max_files_mb: number;
    ai_used_today: number;
    ai_daily_limit: number;
    ai_total: number;
    team_count: number;
    mcp_active: boolean;
  };
  overrides: {
    plan?: string | null;
    ai_daily_limit?: number | null;
    max_gigs?: number | null;
    max_files_mb?: number | null;
  };
}

export interface PlatformAdminOverview {
  summary: {
    tenancy_mode: 'single' | 'multi';
    total_tenants: number;
    active_24h: number;
    active_7d: number;
    suspended_count: number;
    total_gigs: number;
    total_people: number;
    total_files: number;
    total_storage_mb: number;
    ai_used_today: number;
    ai_total: number;
    mcp_enabled_tenants: number;
    leads_count: number;
    defaults: {
      plan: string;
      ai_daily_limit: number;
      max_gigs: number;
      max_files_mb: number;
    };
  };
  tenants: PlatformTenantRecord[];
  leads: Array<{
    id?: string;
    at?: string;
    name?: string;
    email?: string;
    org?: string;
    roster_size?: string;
    message?: string;
  }>;
}

export interface UpdateCheckStatus {
  enabled: boolean;
  repo: string;
  current_sha: string;
  latest_sha: string;
  latest_message: string;
  latest_date: string;
  update_available: boolean;
  compare_url: string;
  update_command: string;
  offline: boolean;
}
