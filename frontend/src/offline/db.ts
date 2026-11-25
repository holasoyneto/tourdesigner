/**
 * Dexie (IndexedDB) offline-first store.
 * Keeps the authorized tour snapshot (phones, PNRs, hotel confirmations, notes) on device,
 * scoped to the signed-in account, with a durable row-level outbox carrying `expected_version`.
 */

import Dexie, { type Table } from 'dexie';
import type { Gig, GigItem, OutboxEntry, Person } from '../types';

export interface MetaRow {
  key: string;
  value: unknown;
}

class TourDesignerDB extends Dexie {
  gigs!: Table<Gig, string>;
  items!: Table<GigItem, string>;
  people!: Table<Person, string>;
  outbox!: Table<OutboxEntry, number>;
  meta!: Table<MetaRow, string>;

  constructor() {
    super('tour_designer_v2');
    this.version(1).stores({
      gigs: 'id, date, archived, updated_at',
      items: 'id, gig_id, collection, [gig_id+collection], batch_id',
      people: 'id, name, person_kind',
      outbox: '++id, status, gig_id, item_id',
      meta: 'key',
    });
  }
}

export const db = new TourDesignerDB();

export async function getMeta<T>(key: string): Promise<T | undefined> {
  const row = await db.meta.get(key);
  return row?.value as T | undefined;
}

export async function setMeta(key: string, value: unknown): Promise<void> {
  await db.meta.put({ key, value });
}

export async function purgeOfflineCopy(): Promise<void> {
  await db.transaction('rw', db.gigs, db.items, db.people, db.outbox, db.meta, async () => {
    await db.gigs.clear();
    await db.items.clear();
    await db.people.clear();
    await db.outbox.clear();
    await db.meta.clear();
  });
}

export async function saveFullSnapshot(userId: string, gigs: Gig[], people: Person[], cursor: string): Promise<void> {
  const prevOwner = await getMeta<string>('user_id');
  if (prevOwner && prevOwner !== userId) {
    await purgeOfflineCopy();
  }
  await db.transaction('rw', db.gigs, db.items, db.people, db.meta, async () => {
    const cleanGigs: Gig[] = [];
    const allItems: GigItem[] = [];
    for (const g of gigs) {
      const { items, ...header } = g;
      cleanGigs.push(header);
      if (items) allItems.push(...items);
    }
    await db.gigs.clear();
    await db.gigs.bulkPut(cleanGigs);
    await db.items.clear();
    await db.items.bulkPut(allItems);
    await db.people.clear();
    await db.people.bulkPut(people);
    await db.meta.bulkPut([
      { key: 'user_id', value: userId },
      { key: 'cursor', value: cursor },
      { key: 'synced_at', value: new Date().toISOString() },
    ]);
  });
}

export async function saveSingleGig(gig: Gig): Promise<void> {
  const { items, ...header } = gig;
  await db.transaction('rw', db.gigs, db.items, async () => {
    await db.gigs.put(header);
    if (items) {
      await db.items.where('gig_id').equals(gig.id).delete();
      await db.items.bulkPut(items);
    }
  });
}
