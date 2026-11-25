/**
 * Offline-first sync engine with single-flight FIFO outbox flushing.
 * - Boots immediately from Dexie IndexedDB
 * - Optimistically writes locally and enqueues row-versioned mutations
 * - Serializes outbox flushes so rapid edits never race or duplicate
 * - Surfaces 409 conflicts without blocking unrelated edits
 * - 10s delta pulse sync pulls teammate and MCP updates automatically
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../api/client';
import type { FileRecord, Gig, GigItem, ItemCollection, OutboxEntry, Person, User } from '../types';
import { db, getMeta, saveFullSnapshot, saveSingleGig, setMeta } from './db';

export interface TourSyncState {
  gigs: Gig[];
  itemsByGig: Record<string, GigItem[]>;
  people: Person[];
  files: FileRecord[];
  outbox: OutboxEntry[];
  online: boolean;
  syncing: boolean;
  lastSyncedAt: string | null;
  hydrateFromIDB: () => Promise<void>;
  refreshFull: () => Promise<void>;
  flushOutbox: () => Promise<void>;
  updateGigHeader: (gigId: string, patch: Record<string, unknown>) => Promise<void>;
  addGigItem: (gigId: string, collection: ItemCollection, data: Record<string, unknown>, personIds?: string[]) => Promise<string>;
  updateGigItem: (gigId: string, itemId: string, data: Record<string, unknown>, personIds?: string[]) => Promise<void>;
  removeGigItem: (gigId: string, itemId: string) => Promise<void>;
  resolveConflict: (entryId: number, choice: 'mine' | 'server') => Promise<void>;
}

export function useTourSync(user: User | null): TourSyncState {
  const [gigs, setGigs] = useState<Gig[]>([]);
  const [itemsByGig, setItemsByGig] = useState<Record<string, GigItem[]>>({});
  const [people, setPeople] = useState<Person[]>([]);
  const [files, setFiles] = useState<FileRecord[]>([]);
  const [outbox, setOutbox] = useState<OutboxEntry[]>([]);
  const [online, setOnline] = useState<boolean>(typeof navigator !== 'undefined' ? navigator.onLine : true);
  const [syncing, setSyncing] = useState(false);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const flushingRef = useRef(false);
  const flushQueuedRef = useRef(false);

  const hydrateFromIDB = useCallback(async () => {
    const [gs, its, ps, ob, ts] = await Promise.all([
      db.gigs.orderBy('date').toArray(),
      db.items.toArray(),
      db.people.orderBy('name').toArray(),
      db.outbox.toArray(),
      getMeta<string>('synced_at'),
    ]);
    const grouped: Record<string, GigItem[]> = {};
    for (const it of its) {
      if (it.deleted) continue;
      (grouped[it.gig_id] ||= []).push(it);
    }
    setGigs(gs);
    setItemsByGig(grouped);
    setPeople(ps);
    setOutbox(ob);
    setLastSyncedAt(ts || null);
  }, []);

  const flushOutbox = useCallback(async () => {
    if (!navigator.onLine || !user) return;
    if (flushingRef.current) {
      flushQueuedRef.current = true;
      return;
    }
    flushingRef.current = true;
    try {
      do {
        flushQueuedRef.current = false;
        const entries = await db.outbox.where('status').equals('pending').sortBy('id');
        if (!entries.length) break;
        for (const entry of entries) {
          try {
            if (entry.kind === 'update_gig' && entry.gig_id) {
              const res = await api.updateGig(entry.gig_id, entry.payload, entry.expected_version);
              await db.gigs.put(res.gig);
            } else if (entry.kind === 'add_item' && entry.gig_id) {
              const res = await api.addItems(entry.gig_id, [
                entry.payload as { id?: string; collection: string; data: Record<string, unknown>; person_ids?: string[] },
              ]);
              if (res.items[0]) await db.items.put(res.items[0]);
            } else if (entry.kind === 'update_item' && entry.gig_id && entry.item_id) {
              const res = await api.updateItem(
                entry.gig_id,
                entry.item_id,
                (entry.payload.data as Record<string, unknown>) || {},
                entry.expected_version,
                entry.payload.person_ids as string[] | undefined,
              );
              await db.items.put(res.item);
            } else if (entry.kind === 'remove_item' && entry.gig_id && entry.item_id) {
              await api.removeItem(entry.gig_id, entry.item_id, entry.expected_version);
              await db.items.delete(entry.item_id);
            }
            if (entry.id !== undefined) await db.outbox.delete(entry.id);
          } catch (e) {
            if (e instanceof ApiError && e.status === 409 && entry.id !== undefined) {
              await db.outbox.update(entry.id, { status: 'conflict', conflict_current: e.current, error: e.code });
            } else if (e instanceof ApiError && e.status >= 400 && e.status < 500 && entry.id !== undefined) {
              await db.outbox.update(entry.id, { status: 'failed', error: e.code });
            } else {
              // Network offline or transient 5xx: stop loop and keep pending for retry
              flushQueuedRef.current = false;
              break;
            }
          }
        }
        await hydrateFromIDB();
      } while (flushQueuedRef.current);
    } finally {
      flushingRef.current = false;
    }
  }, [hydrateFromIDB, user]);

  const refreshFull = useCallback(async () => {
    if (!user || !navigator.onLine) return;
    setSyncing(true);
    try {
      await flushOutbox();
      const [{ gigs: fetchedGigs }, peopleRes, filesRes, changeRes] = await Promise.all([
        api.listGigs(true),
        user.role === 'viewer' ? Promise.resolve({ people: [] as Person[] }) : api.listPeople(),
        user.role === 'viewer' ? Promise.resolve({ files: [] as FileRecord[] }) : api.listFiles().catch(() => ({ files: [] as FileRecord[] })),
        api.changesSince(),
      ]);
      setFiles(filesRes.files);
      await saveFullSnapshot(user.id, fetchedGigs, peopleRes.people, changeRes.cursor);
      await hydrateFromIDB();
    } catch {
      // Stay cleanly on cached Dexie copy
    } finally {
      setSyncing(false);
    }
  }, [flushOutbox, hydrateFromIDB, user]);

  const pollDelta = useCallback(async () => {
    if (!user || !navigator.onLine || document.visibilityState !== 'visible') return;
    const pendingCount = await db.outbox.count();
    if (pendingCount > 0) {
      await flushOutbox();
      return;
    }
    try {
      const cursor = await getMeta<string>('cursor');
      const delta = await api.changesSince(cursor);
      if (delta.changed_gig_ids.length || delta.changed_people_ids.length) {
        await Promise.all(
          delta.changed_gig_ids.map(async (gid) => {
            try {
              const { gig } = await api.getGig(gid);
              await saveSingleGig(gig);
            } catch {
              await db.gigs.delete(gid);
            }
          }),
        );
        if (delta.changed_people_ids.length && user.role !== 'viewer') {
          const { people: freshPeople } = await api.listPeople();
          await db.people.clear();
          await db.people.bulkPut(freshPeople);
        }
        await setMeta('synced_at', new Date().toISOString());
        await hydrateFromIDB();
      }
      await setMeta('cursor', delta.cursor);
    } catch {
      // Silent pulse failure never kicks user offline
    }
  }, [flushOutbox, hydrateFromIDB, user]);

  // Boot from IDB immediately, then sync online
  useEffect(() => {
    if (!user) return;
    void hydrateFromIDB().then(() => refreshFull());
  }, [user, hydrateFromIDB, refreshFull]);

  // Network listeners + 10s delta pulse
  useEffect(() => {
    const onOnline = () => {
      setOnline(true);
      void refreshFull();
    };
    const onOffline = () => setOnline(false);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    const timer = window.setInterval(() => void pollDelta(), 10_000);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      window.clearInterval(timer);
    };
  }, [pollDelta, refreshFull]);

  const updateGigHeader = useCallback(
    async (gigId: string, patch: Record<string, unknown>) => {
      const current = await db.gigs.get(gigId);
      if (!current) return;
      const optimistic: Gig = { ...current, ...patch, updated_at: new Date().toISOString() } as Gig;
      await db.gigs.put(optimistic);
      await db.outbox.add({
        created_at: new Date().toISOString(),
        kind: 'update_gig',
        gig_id: gigId,
        expected_version: current.version,
        payload: patch,
        status: 'pending',
      });
      await hydrateFromIDB();
      await flushOutbox();
    },
    [flushOutbox, hydrateFromIDB],
  );

  const addGigItem = useCallback(
    async (gigId: string, collection: ItemCollection, data: Record<string, unknown>, personIds: string[] = []) => {
      const id = `it_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
      const optimistic: GigItem = {
        id,
        gig_id: gigId,
        collection,
        data,
        person_ids: personIds,
        deleted: false,
        version: 1,
        updated_at: new Date().toISOString(),
        added_by: user?.id,
        added_by_name: user?.name,
        added_channel: 'web',
      };
      await db.items.put(optimistic);
      await db.outbox.add({
        created_at: new Date().toISOString(),
        kind: 'add_item',
        gig_id: gigId,
        item_id: id,
        payload: { id, collection, data, person_ids: personIds },
        status: 'pending',
      });
      await hydrateFromIDB();
      void flushOutbox();
      return id;
    },
    [flushOutbox, hydrateFromIDB, user],
  );

  const updateGigItem = useCallback(
    async (gigId: string, itemId: string, data: Record<string, unknown>, personIds?: string[]) => {
      const current = await db.items.get(itemId);
      if (!current) return;
      const optimistic: GigItem = {
        ...current,
        data: { ...current.data, ...data },
        person_ids: personIds ?? current.person_ids,
        updated_at: new Date().toISOString(),
      };
      await db.items.put(optimistic);
      await db.outbox.add({
        created_at: new Date().toISOString(),
        kind: 'update_item',
        gig_id: gigId,
        item_id: itemId,
        expected_version: current.version,
        payload: { data, ...(personIds ? { person_ids: personIds } : {}) },
        status: 'pending',
      });
      await hydrateFromIDB();
      await flushOutbox();
    },
    [flushOutbox, hydrateFromIDB],
  );

  const removeGigItem = useCallback(
    async (gigId: string, itemId: string) => {
      const current = await db.items.get(itemId);
      if (!current) return;
      await db.items.update(itemId, { deleted: true });
      await db.outbox.add({
        created_at: new Date().toISOString(),
        kind: 'remove_item',
        gig_id: gigId,
        item_id: itemId,
        expected_version: current.version,
        payload: {},
        status: 'pending',
      });
      await hydrateFromIDB();
      await flushOutbox();
    },
    [flushOutbox, hydrateFromIDB],
  );

  const resolveConflict = useCallback(
    async (entryId: number, choice: 'mine' | 'server') => {
      const entry = await db.outbox.get(entryId);
      if (!entry) return;
      if (choice === 'server') {
        if (entry.conflict_current) {
          if (entry.kind === 'update_gig') await db.gigs.put(entry.conflict_current as unknown as Gig);
          else await db.items.put(entry.conflict_current as unknown as GigItem);
        }
        await db.outbox.delete(entryId);
      } else {
        const latestVersion = Number((entry.conflict_current as { version?: number } | undefined)?.version ?? entry.expected_version);
        await db.outbox.update(entryId, { status: 'pending', expected_version: latestVersion, conflict_current: undefined, error: undefined });
      }
      await hydrateFromIDB();
      await flushOutbox();
    },
    [flushOutbox, hydrateFromIDB],
  );

  return {
    gigs,
    itemsByGig,
    people,
    files,
    outbox,
    online,
    syncing,
    lastSyncedAt,
    hydrateFromIDB,
    refreshFull,
    flushOutbox,
    updateGigHeader,
    addGigItem,
    updateGigItem,
    removeGigItem,
    resolveConflict,
  };
}
