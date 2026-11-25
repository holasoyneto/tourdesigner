import { api } from '../api/client';
import { registerDemoFileUrl } from '../lib/basePath';
import type { FileRecord, Gig, GigItem, Person, Project, ShareLink, User } from '../types';
import type { DemoTourSnapshot } from './demoTourData';

const DEMO_CITIES = [
  { city: 'London', country: 'United Kingdom', timezone: 'Europe/London' },
  { city: 'Ibiza', country: 'Spain', timezone: 'Europe/Madrid' },
  { city: 'Las Vegas', country: 'USA', timezone: 'America/Los_Angeles' },
  { city: 'Miami', country: 'USA', timezone: 'America/New_York' },
  { city: 'New York', country: 'USA', timezone: 'America/New_York' },
  { city: 'Los Angeles', country: 'USA', timezone: 'America/Los_Angeles' },
  { city: 'Mexico City', country: 'Mexico', timezone: 'America/Mexico_City' },
  { city: 'Tulum', country: 'Mexico', timezone: 'America/Cancun' },
  { city: 'Boom', country: 'Belgium', timezone: 'Europe/Brussels' },
  { city: 'Brussels', country: 'Belgium', timezone: 'Europe/Brussels' },
  { city: 'Berlin', country: 'Germany', timezone: 'Europe/Berlin' },
  { city: 'Paris', country: 'France', timezone: 'Europe/Paris' },
  { city: 'Amsterdam', country: 'Netherlands', timezone: 'Europe/Amsterdam' },
  { city: 'Madrid', country: 'Spain', timezone: 'Europe/Madrid' },
  { city: 'Tokyo', country: 'Japan', timezone: 'Asia/Tokyo' },
  { city: 'Phuket', country: 'Thailand', timezone: 'Asia/Bangkok' },
  { city: 'São Paulo', country: 'Brazil', timezone: 'America/Sao_Paulo' },
  { city: 'Buenos Aires', country: 'Argentina', timezone: 'America/Argentina/Buenos_Aires' },
  { city: 'Denver', country: 'USA', timezone: 'America/Denver' },
  { city: 'San Francisco', country: 'USA', timezone: 'America/Los_Angeles' },
];

export interface DemoStore {
  snap: DemoTourSnapshot;
  notify: () => void;
}

export const DEMO_USER: User = {
  id: 'usr_demo_tm',
  name: 'Marcus Vance (TM)',
  email: 'demo@tourdesigner.app',
  role: 'owner',
  artist_ids: [],
  permanent: true,
} as User;

let idCounter = 1000;
const nextId = (prefix: string) => `${prefix}_demo_${++idCounter}`;

export function installDemoApiSandbox(store: DemoStore): () => void {
  const originals = { ...api };
  const s = () => store.snap;
  const ts = () => new Date().toISOString();

  api.me = async () => ({
    authenticated: true,
    user: DEMO_USER,
    auth_enforced: false,
    tenancy_mode: 'multi',
    hosted_plan: 'Live Tour Sandbox',
    community: { enabled: true, milestone_gigs: 7, share_url: '', btc_address: '', lightning_address: '' },
  });

  api.listProjects = async () => ({ projects: [...s().projects] });
  api.adminCreateProject = async (payload) => {
    const p: Project = {
      id: nextId('proj'),
      name: payload.name,
      color: payload.color || '#f3c64a',
      notes: payload.notes || '',
      created_at: ts(),
    };
    s().projects = [...s().projects, p];
    store.notify();
    return { project: p };
  };

  api.listGigs = async () => ({
    gigs: s().gigs.map((g) => ({ ...g, items: s().itemsByGig[g.id] || [] })),
  });
  api.getGig = async (id) => {
    const g = s().gigs.find((x) => x.id === id);
    if (!g) throw new Error('not_found');
    return { gig: { ...g, items: s().itemsByGig[id] || [] } };
  };
  api.createGig = async (payload) => {
    const g: Gig = {
      id: nextId('gig'),
      artist_id: payload.artist_id || s().projects[0]?.id || null,
      name: payload.name || payload.city || payload.venue || 'New Show',
      date: payload.date || new Date().toISOString().slice(0, 10),
      venue: payload.venue || '',
      city: payload.city || 'TBD',
      country: payload.country || '',
      timezone: payload.timezone || 'UTC',
      venue_address: payload.venue_address || '',
      venue_capacity: payload.venue_capacity || '',
      doors_time: payload.doors_time || null,
      soundcheck_time: payload.soundcheck_time || null,
      set_time: payload.set_time || '01:00',
      set_end: payload.set_end || null,
      status: payload.status || 'hold',
      promoter: payload.promoter || '',
      fee: payload.fee ?? null,
      currency: payload.currency || 'USD',
      deal_type: payload.deal_type || '',
      notes: payload.notes || '',
      archived: false,
      deleted_at: null,
      version: 1,
      updated_at: ts(),
      items_updated_at: ts(),
    };
    s().gigs = [...s().gigs, g].sort((a, b) => a.date.localeCompare(b.date));
    s().itemsByGig[g.id] = [];
    store.notify();
    return { gig: g };
  };
  api.updateGig = async (id, patch) => {
    let updated: Gig | null = null;
    s().gigs = s().gigs.map((g) => {
      if (g.id !== id) return g;
      updated = { ...g, ...patch, version: g.version + 1, updated_at: ts() } as Gig;
      return updated;
    });
    if (!updated) throw new Error('not_found');
    store.notify();
    return { gig: updated };
  };
  api.deleteGig = async (id) => {
    s().gigs = s().gigs.map((g) => (g.id === id ? { ...g, deleted_at: ts() } : g));
    store.notify();
    return { ok: true };
  };

  api.addItems = async (gigId, items) => {
    const created: GigItem[] = items.map((it) => ({
      id: it.id || nextId('it'),
      gig_id: gigId,
      collection: it.collection as GigItem['collection'],
      data: it.data,
      person_ids: it.person_ids || [],
      deleted: false,
      version: 1,
      updated_at: ts(),
      added_by: DEMO_USER.id,
      added_by_name: DEMO_USER.name,
      added_channel: 'web',
    }));
    s().itemsByGig[gigId] = [...(s().itemsByGig[gigId] || []), ...created];
    store.notify();
    return { items: created };
  };
  api.updateItem = async (gigId, itemId, data, _v, personIds) => {
    let found: GigItem | null = null;
    s().itemsByGig[gigId] = (s().itemsByGig[gigId] || []).map((it) => {
      if (it.id !== itemId) return it;
      found = {
        ...it,
        data: { ...it.data, ...data },
        ...(personIds !== undefined ? { person_ids: personIds } : {}),
        version: it.version + 1,
        updated_at: ts(),
      };
      return found;
    });
    if (!found) throw new Error('not_found');
    store.notify();
    return { item: found };
  };
  api.removeItem = async (gigId, itemId) => {
    s().itemsByGig[gigId] = (s().itemsByGig[gigId] || []).filter((it) => it.id !== itemId);
    store.notify();
    return { ok: true };
  };

  api.listPeople = async () => ({ people: [...s().people] });
  api.createPerson = async (payload) => {
    const p: Person = {
      id: nextId('per'),
      name: payload.name || 'New Contact',
      person_kind: payload.person_kind || 'autre',
      role: payload.role || '',
      company: payload.company || '',
      phone: payload.phone || '',
      email: payload.email || '',
      notes: payload.notes || '',
      loyalty: payload.loyalty || [],
      profile: payload.profile || {},
      permanent: Boolean(payload.permanent),
      version: 1,
      updated_at: ts(),
    };
    s().people = [...s().people, p];
    store.notify();
    return { person: p };
  };
  api.updatePerson = async (id, patch) => {
    let updated: Person | null = null;
    s().people = s().people.map((p) => {
      if (p.id !== id) return p;
      updated = { ...p, ...patch, version: p.version + 1, updated_at: ts() } as Person;
      return updated;
    });
    if (!updated) throw new Error('not_found');
    store.notify();
    return { person: updated };
  };
  api.mergePeople = async (sourceId, targetId) => {
    const target = s().people.find((p) => p.id === targetId);
    if (!target) throw new Error('not_found');
    s().people = s().people.filter((p) => p.id !== sourceId);
    s().files = s().files.map((f) => (f.person_id === sourceId ? { ...f, person_id: targetId } : f));
    store.notify();
    return { person: target };
  };

  api.listFiles = async (gigId) => ({
    files: gigId ? s().files.filter((f) => f.gig_id === gigId) : [...s().files],
  });
  api.uploadFile = async (file, gigId, opts) => {
    const id = nextId('file');
    const url = typeof URL !== 'undefined' && URL.createObjectURL ? URL.createObjectURL(file) : '';
    if (url) registerDemoFileUrl(id, url);
    const rec: FileRecord = {
      id,
      object_id: nextId('obj'),
      gig_id: gigId || null,
      person_id: opts?.personId || null,
      name: file.name,
      mime: file.type || 'application/octet-stream',
      size: file.size,
      doc_kind: opts?.docKind || 'other',
      doc_expires: opts?.docExpires || null,
      scope: opts?.scope || 'crew',
      pinned: false,
      added_at: ts(),
    };
    s().files = [rec, ...s().files];
    store.notify();
    return rec;
  };
  api.updateFile = async (id, patch) => {
    let updated: FileRecord | null = null;
    s().files = s().files.map((f) => {
      if (f.id !== id) return f;
      updated = { ...f, ...patch } as FileRecord;
      return updated;
    });
    if (!updated) throw new Error('not_found');
    store.notify();
    return { file: updated };
  };
  api.deleteFile = async (id) => {
    s().files = s().files.filter((f) => f.id !== id);
    store.notify();
    return { ok: true };
  };

  api.listShares = async (gigId) => ({
    shares: gigId ? s().shares.filter((sh) => !sh.gig_id || sh.gig_id === gigId) : [...s().shares],
  });
  api.createShare = async (payload) => {
    const sh: ShareLink = {
      key: 'demo',
      scope: payload.scope || 'gig_crew',
      gig_id: payload.gig_id || null,
      person_id: payload.person_id || null,
      label: payload.label || 'Demo Role-Scrubbed Share',
      enabled: true,
    };
    s().shares = [sh, ...s().shares];
    store.notify();
    return { share: sh };
  };

  api.listTrash = async () => ({ gigs: s().gigs.filter((g) => Boolean(g.deleted_at) || g.archived) });
  api.restoreTrash = async (gigId) => {
    s().gigs = s().gigs.map((g) => (g.id === gigId ? { ...g, deleted_at: null, archived: false } : g));
    store.notify();
    return { ok: true };
  };
  api.destroyTrash = async (gigId) => {
    s().gigs = s().gigs.filter((g) => g.id !== gigId);
    delete s().itemsByGig[gigId];
    store.notify();
    return { ok: true };
  };

  api.gigHistory = async () => ({ events: [] });
  api.undoBatch = async () => ({ removed: [], kept: [] });
  api.searchCities = async (q) => {
    const ql = q.trim().toLowerCase();
    return {
      cities: DEMO_CITIES.filter((c) => c.city.toLowerCase().includes(ql) || c.country.toLowerCase().includes(ql)),
    };
  };
  api.lookupFlight = async (flightNo) => ({
    provider: 'demo',
    candidates: flightNo ? [{ flight_no: flightNo.toUpperCase(), airline: 'Sample Air', dep_iata: 'LHR', arr_iata: 'JFK', dep_time: '10:00', arr_time: '13:05' }] : [],
  });
  api.intakeStatus = async () => ({
    provider: 'demo-local',
    configured_provider: 'local',
    model: 'demo-offline-parser',
    google_connected: true,
    ai_connected: true,
    hosted_locked: false,
  });
  api.extractIntake = async (text) => {
    const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const multi_dates: Array<{ date: string; city: string; venue: string; status: string }> = [];
    const items: Array<{ collection: string; data: Record<string, unknown> }> = [];
    for (const line of lines) {
      const dm = line.match(/^(\d{4}-\d{2}-\d{2})[,\t;| ]+([^,\t;|]+)(?:[,\t;| ]+(.+))?$/);
      if (dm) {
        multi_dates.push({ date: dm[1], city: dm[2].trim(), venue: (dm[3] || 'Venue TBD').trim(), status: 'hold' });
        continue;
      }
      const tm = line.match(/^(\d{1,2}[:h]\d{2})\s+(.+)$/i);
      if (tm) {
        items.push({ collection: 'schedule', data: { time: tm[1].replace('h', ':').padStart(5, '0'), title: tm[2], label: tm[2] } });
      }
    }
    if (!items.length && !multi_dates.length && text.trim()) {
      items.push({ collection: 'notes_list', data: { title: 'Imported note', body: text.trim() } });
    }
    return {
      proposal: {
        engine: 'demo-local',
        gig_patch: multi_dates.length === 1 ? { date: multi_dates[0].date, city: multi_dates[0].city, venue: multi_dates[0].venue } : {},
        items,
        multi_dates: multi_dates.length >= 2 ? multi_dates : [],
        warnings: ['Demo sandbox extraction runs 100% locally in-memory without writing to any server.'],
      },
    };
  };
  api.applyIntake = async (gigId, proposal) => {
    if (proposal.gig_patch && Object.keys(proposal.gig_patch).length) {
      await api.updateGig(gigId, proposal.gig_patch);
    }
    const res = await api.addItems(gigId, proposal.items);
    return { batch_id: nextId('bat'), gig: s().gigs.find((g) => g.id === gigId)!, added: res.items };
  };

  return () => {
    Object.assign(api, originals);
  };
}
