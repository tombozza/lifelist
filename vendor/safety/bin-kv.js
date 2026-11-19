/* COPY of sites/_shared/safety/bin-kv.js — edit the source there and run node _shared/sync.mjs */
// Recently deleted for a KV app (Workers and Pages Functions): one KV key holds the bin, a JSON list of
// bin.js entries. The entry's data is whatever the app needs to put the thing back (usually the object
// itself). Restoring is the app's job (it knows where the thing lives); binTake hands the entry over and
// removes it.
//
//   import { kvBinAdd, kvBinList, kvBinTake } from '../vendor/safety/bin-kv.js';
//   await kvBinAdd(env.LIB, 'bin', { kind: 'album', label: 'Blue Lines', data: album });
//   const entry = await kvBinTake(env.LIB, 'bin', id);   // then put entry.data back yourself
//
// KV is last-write-wins: two deletes in the same second from two devices can lose one bin entry, never the
// app's data. Fine for a family-scale app.

import { binEntry, pruneBin } from './bin.js';

const MAX = 300;          // keep the value small; the oldest go first
const read = async (kv, key) => { try { return JSON.parse((await kv.get(key)) ?? '[]'); } catch { return []; } };

export async function kvBinAdd(kv, key, { kind, label, data }) {
  const e = binEntry(kind, label, data);
  const list = pruneBin([e, ...(await read(kv, key))]).slice(0, MAX);
  await kv.put(key, JSON.stringify(list));
  return e.id;
}

/** Entries, newest first, without their data. */
export async function kvBinList(kv, key) {
  return pruneBin(await read(kv, key)).map(({ data, ...rest }) => rest);
}

/** Take an entry out (to restore it). null if it's gone. */
export async function kvBinTake(kv, key, id) {
  const list = pruneBin(await read(kv, key));
  const e = list.find(x => x.id === id);
  if (!e) return null;
  await kv.put(key, JSON.stringify(list.filter(x => x.id !== id)));
  return e;
}

export async function kvBinForget(kv, key, id) {
  const list = pruneBin(await read(kv, key));
  await kv.put(key, JSON.stringify(list.filter(x => x.id !== id)));
  return { ok: true };
}
