export type Locale = 'fr' | 'en';
export type SkinPref = 'auto' | 'day' | 'night';
export type Role = 'owner' | 'editor' | 'viewer';

export type GigStatus =
  | 'hold'
  | 'pending'
  | 'confirmed'
  | 'announced'
  | 'advancing'
  | 'show_day'
  | 'played'
  | 'cancelled';

export type ItemCollection =
  | 'flights'
  | 'transport'
  | 'hotels'
  | 'schedule'
  | 'timetable'
  | 'crew'
  | 'contacts'
  | 'guests'
  | 'setlist'
  | 'rider'
  | 'perdiem'
  | 'files'
  | 'links'
  | 'notes_list'
  | 'events'
  | 'promo'
  | 'marketing';

export interface Project {
  id: string;
  name: string;
  color: string;
  notes?: string;
  archived?: boolean;
  created_at?: string;
}

export interface User {
  id: string;
  name: string;
  email?: string | null;
  role: Role;
  artist_ids?: string[];
  travel_person_id?: string | null;
  revoked?: boolean;
  has_login_key?: boolean;
  has_mcp_key?: boolean;
  last_seen_at?: string | null;
}

export interface GigItem {
  id: string;
  gig_id: string;
  collection: ItemCollection;
  data: Record<string, unknown>;
  person_ids: string[];
  deleted: boolean;
  version: number;
  updated_at: string;
  added_by?: string | null;
  added_by_name?: string | null;
  added_channel?: 'web' | 'mcp' | 'intake' | 'migration' | 'cron';
  batch_id?: string | null;
}

export interface Gig {
  id: string;
  artist_id?: string | null;
  name: string;
  date: string;
  venue: string;
  city: string;
  country: string;
  timezone?: string | null;
  venue_address?: string | null;
  venue_capacity?: string | null;
  doors_time?: string | null;
  soundcheck_time?: string | null;
  set_time: string;
  set_end?: string | null;
  set_day_offset?: number | null;
  status: GigStatus;
  ticket_url?: string | null;
  promoter?: string | null;
  fee?: number | null;
  currency: string;
  deal_type?: string | null;
  notes: string;
  archived: boolean;
  deleted_at?: string | null;
  version: number;
  updated_at: string;
  items_updated_at: string;
  items?: GigItem[];
}

export interface PersonLoyalty {
  kind: 'airline' | 'hotel';
  program: string;
  number: string;
}

export interface PersonProfile {
  visa?: string;
  health?: string;
  preferences?: string;
  aliases?: string[];
}

export interface Person {
  id: string;
  name: string;
  person_kind?: 'equipe' | 'promoteur' | 'hote' | 'chauffeur' | 'client' | 'autre' | null;
  role?: string | null;
  company?: string | null;
  phone?: string | null;
  email?: string | null;
  notes?: string | null;
  loyalty?: PersonLoyalty[];
  profile?: PersonProfile;
  permanent: boolean;
  version: number;
  updated_at: string;
}

export interface FileRecord {
  id: string;
  object_id: string;
  gig_id?: string | null;
  person_id?: string | null;
  name: string;
  mime: string;
  size: number;
  doc_kind?: string | null;
  doc_country?: string | null;
  doc_expires?: string | null;
  scope?: 'crew' | 'private';
  pinned: boolean;
  added_at: string;
}

export interface HistoryEvent {
  id: string;
  gig_id: string;
  at: string;
  actor_id?: string | null;
  actor_name?: string | null;
  channel: string;
  action: string;
  summary: string;
  batch_id?: string | null;
  item_ids: string[];
}

export interface ShareLink {
  key: string;
  scope: 'person' | 'gig_master' | 'gig_crew';
  gig_id?: string | null;
  person_id?: string | null;
  label: string;
  enabled: boolean;
  last_seen?: string | null;
}

export interface OutboxEntry {
  id?: number;
  created_at: string;
  kind: 'update_gig' | 'add_item' | 'update_item' | 'remove_item' | 'upsert_person';
  gig_id?: string;
  item_id?: string;
  person_id?: string;
  expected_version?: number;
  payload: Record<string, unknown>;
  status: 'pending' | 'conflict' | 'failed';
  conflict_current?: Record<string, unknown>;
  error?: string;
}
