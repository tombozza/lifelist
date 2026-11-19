// The ARCHIVE block of app.js (between the archive-core markers): Reopen and
// Delete on an archive row, and that both survive a sync with another device.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const core = src.slice(src.indexOf('// >>> archive-core'), src.indexOf('// <<< archive-core'));
const helpers = `
function getWeekStart(d) { const x = new Date(d + 'T12:00:00Z'); const k = (x.getUTCDay() + 6) % 7; x.setUTCDate(x.getUTCDate() - k); return x.toISOString().slice(0, 10); }
function addDays(d, n) { const x = new Date(d + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); }
`;
const A = new Function(helpers + core + '; return { compactArchive, archiveDone, mergeTombstones, applyTombstones, reopenArchived, deleteArchived, archivedCopy };')();
const COLS = ['backlog', 'live', 'waiting', 'blocked', 'ongoing'];
const clone = o => JSON.parse(JSON.stringify(o));

// The merge in pullFromCloud(), as pure steps
function merge(local, cloud, now) {
  const s = clone(local);
  s.deletedIds = A.mergeTombstones(s.deletedIds, cloud.deletedIds, now);
  const m = new Map(s.tasks.map(t => [t.id, t]));
  (cloud.tasks || []).forEach(rt => { const lt = m.get(rt.id); if (!lt || (rt.updatedAt || 0) > (lt.updatedAt || 0)) m.set(rt.id, rt); });
  const applied = A.applyTombstones([...m.values()], s.deletedIds);
  s.tasks = applied.tasks; s.deletedIds = applied.deletedIds;
  s.archive = A.compactArchive([...(s.archive || []), ...(cloud.archive || [])], s.deletedIds);
  A.archiveDone(s, '2026-11-19', now);
  return s;
}

function archivedState() {
  const s = { tasks: [{ id: 't1', title: 'Pay the bill', status: 'complete', kanbanColumn: 'complete', _prevKanban: 'waiting', completedDate: '2026-11-03', updatedAt: 1000 }], archive: [], deletedIds: [] };
  A.archiveDone(s, '2026-11-19', 2000);
  return s;
}
const live = s => s.tasks.map(t => t.id);
const inArchive = s => s.archive.flatMap(w => w.tasks.map(t => t.id));

test('reopen puts the task back in the column it was finished from', () => {
  const s = archivedState();
  assert.deepEqual(inArchive(s), ['t1']);
  const t = A.reopenArchived(s, 't1', 3000, COLS);
  assert.equal(t.status, 'active');
  assert.equal(t.kanbanColumn, 'waiting');
  assert.equal(t.completedDate, null);
  assert.deepEqual(live(s), ['t1']);
  assert.deepEqual(inArchive(s), []);
});

test('an old column id, or none, comes back as Live or Backlog', () => {
  const s = archivedState();
  s.archive[0].tasks[0]._prevKanban = 'in-progress';
  assert.equal(A.reopenArchived(s, 't1', 3000, COLS).kanbanColumn, 'live');
  const s2 = archivedState();
  delete s2.archive[0].tasks[0]._prevKanban;
  assert.equal(A.reopenArchived(s2, 't1', 3000, COLS).kanbanColumn, 'backlog');
});

test('a reopen survives a sync with a device that still has it archived', () => {
  const other = archivedState();
  const me = clone(other);
  A.reopenArchived(me, 't1', 3000, COLS);
  const cloud = merge(other, me, 3100);          // my push reaches the other device
  assert.deepEqual(live(cloud), ['t1']);
  assert.deepEqual(inArchive(cloud), []);
  const back = merge(me, other, 3200);           // and its stale copy comes back to me
  assert.deepEqual(live(back), ['t1']);
  assert.deepEqual(inArchive(back), []);
});

test('a reopened task finished again files into the archive again', () => {
  const s = archivedState();
  const t = A.reopenArchived(s, 't1', 3000, COLS);
  Object.assign(t, { status: 'complete', completedDate: '2026-11-10', updatedAt: 4000 });
  A.archiveDone(s, '2026-11-19', 4000);
  assert.deepEqual(inArchive(s), ['t1']);
  assert.equal(s.archive[0].weekStart, '2026-11-09');
  // and the other device, which still has the first archive copy, agrees
  const other = merge(archivedState(), s, 4100);
  assert.deepEqual(live(other), []);
  assert.deepEqual(inArchive(other), ['t1']);
});

test('delete takes it out of the archive on every device', () => {
  const other = archivedState();
  const me = clone(other);
  assert.equal(A.deleteArchived(me, 't1', 3000), true);
  assert.deepEqual(inArchive(me), []);
  const o2 = merge(other, me, 3100);
  assert.deepEqual(inArchive(o2), []);
  assert.deepEqual(live(o2), []);
  const back = merge(me, other, 3200);
  assert.deepEqual(inArchive(back), []);
});

test('reopening a repeat with its next one still dormant takes the schedule back', () => {
  const rec = { freq: 'weekly', onToday: true };
  const s = {
    tasks: [
      { id: 'r__2026-11-03', recurRoot: 'r', title: 'Bins', status: 'complete', kanbanColumn: 'complete', _prevKanban: 'live', completedDate: '2026-11-03', spawnedChildId: 'r__2026-11-24', recurring: null, updatedAt: 1000 },
      { id: 'r__2026-11-24', recurRoot: 'r', title: 'Bins', status: 'scheduled', scheduledFor: '2026-11-24', recurring: rec, updatedAt: 1000 },
    ], archive: [], deletedIds: [],
  };
  A.archiveDone(s, '2026-11-19', 2000);
  const t = A.reopenArchived(s, 'r__2026-11-03', 3000, COLS);
  assert.deepEqual(t.recurring, rec);
  assert.equal(t.spawnedChildId, undefined);
  assert.deepEqual(live(s), ['r__2026-11-03']);   // no second live Bins
  assert.ok(s.deletedIds.some(x => x.id === 'r__2026-11-24' && !x.archived));
});

test('reopening a repeat that has moved on gives a one-off, not a second repeat', () => {
  const rec = { freq: 'weekly' };
  const s = {
    tasks: [
      { id: 'r__2026-11-03', recurRoot: 'r', title: 'Bins', status: 'complete', kanbanColumn: 'complete', completedDate: '2026-11-03', spawnedChildId: 'r__2026-11-10', recurring: null, updatedAt: 1000 },
      { id: 'r__2026-11-10', recurRoot: 'r', title: 'Bins', status: 'active', kanbanColumn: 'backlog', recurring: rec, updatedAt: 1500 },
    ], archive: [], deletedIds: [],
  };
  A.archiveDone(s, '2026-11-19', 2000);
  const t = A.reopenArchived(s, 'r__2026-11-03', 3000, COLS);
  assert.equal(t.recurring, null);
  assert.equal(s.tasks.filter(x => x.recurring).length, 1);
  assert.equal(s.tasks.find(x => x.id === 'r__2026-11-10').status, 'active');
});
