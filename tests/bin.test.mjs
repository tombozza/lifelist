// Recently deleted (app.js, between the archive-core markers): a delete goes into
// the bin, and a restore or a delete-for-good sticks on every device after a sync.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const core = src.slice(src.indexOf('// >>> archive-core'), src.indexOf('// <<< archive-core'));
const helpers = `
function getWeekStart(d) { const x = new Date(d + 'T12:00:00Z'); const k = (x.getUTCDay() + 6) % 7; x.setUTCDate(x.getUTCDate() - k); return x.toISOString().slice(0, 10); }
function addDays(d, n) { const x = new Date(d + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); }
`;
const A = new Function(helpers + core + '; return { mergeTombstones, applyTombstones, binDelete, binRestore, binForget, binList, mergeBin };')();
const clone = o => JSON.parse(JSON.stringify(o));
const NOW = Date.parse('2026-11-25T12:00:00Z');

// pullFromCloud()'s merge, as pure steps
function merge(local, cloud, now) {
  const s = clone(local);
  s.deletedIds = A.mergeTombstones(s.deletedIds, cloud.deletedIds, now);
  const m = new Map(s.tasks.map(t => [t.id, t]));
  (cloud.tasks || []).forEach(rt => { const lt = m.get(rt.id); if (!lt || (rt.updatedAt || 0) > (lt.updatedAt || 0)) m.set(rt.id, rt); });
  const applied = A.applyTombstones([...m.values()], s.deletedIds);
  s.tasks = applied.tasks; s.deletedIds = applied.deletedIds;
  s.bin = A.mergeBin(s.bin, cloud.bin, s.deletedIds, now);
  return s;
}
const board = () => ({ tasks: [{ id: 't1', title: 'Ring the bank', updatedAt: 100 }, { id: 't2', title: 'Buy milk', updatedAt: 100 }], deletedIds: [], bin: [] });
const ids = s => s.tasks.map(t => t.id).sort();

test('a delete leaves the board and shows in the bin', () => {
  const s = board();
  A.binDelete(s, s.tasks[0], NOW, 'e1');
  assert.deepEqual(ids(s), ['t2']);
  assert.deepEqual(A.binList(s, NOW).map(e => e.label), ['Ring the bank']);
});

test('a restore sticks on a device that still has the delete', () => {
  const phone = board();
  A.binDelete(phone, phone.tasks[0], NOW, 'e1');
  const mac = merge(board(), phone, NOW);          // the Mac hears about the delete
  assert.deepEqual(ids(mac), ['t2']);
  A.binRestore(phone, 'e1', NOW + 1000);           // restored on the phone
  const mac2 = merge(mac, phone, NOW + 2000);
  assert.deepEqual(ids(mac2), ['t1', 't2']);
  assert.deepEqual(A.binList(mac2, NOW + 2000), []);
  const phone2 = merge(phone, mac, NOW + 3000);    // and the Mac's older delete doesn't undo it
  assert.deepEqual(ids(phone2), ['t1', 't2']);
});

test('deleting a restored task again deletes it everywhere', () => {
  const s = board();
  A.binDelete(s, s.tasks[0], NOW, 'e1');
  A.binRestore(s, 'e1', NOW + 1000);
  const other = merge(board(), s, NOW + 1500);
  A.binDelete(s, s.tasks.find(t => t.id === 't1'), NOW + 2000, 'e2');
  const other2 = merge(other, s, NOW + 3000);
  assert.deepEqual(ids(other2), ['t2']);
  assert.deepEqual(A.binList(other2, NOW + 3000).map(e => e.id), ['e2']);
});

test('delete for good takes it out of every bin, and the task stays deleted', () => {
  const s = board();
  A.binDelete(s, s.tasks[0], NOW, 'e1');
  const other = merge(board(), s, NOW + 500);
  A.binForget(s, 'e1', NOW + 1000);
  const other2 = merge(other, s, NOW + 2000);
  assert.deepEqual(A.binList(other2, NOW + 2000), []);
  assert.deepEqual(ids(other2), ['t2']);
  assert.deepEqual(merge(s, other, NOW + 3000).bin, []);   // the other device's old entry doesn't come back
});

test('entries go after 30 days', () => {
  const s = board();
  A.binDelete(s, s.tasks[0], NOW, 'e1');
  assert.equal(A.binList(s, NOW + 29 * 864e5).length, 1);
  assert.equal(A.binList(s, NOW + 31 * 864e5).length, 0);
  assert.deepEqual(A.mergeBin(s.bin, [], s.deletedIds, NOW + 31 * 864e5), []);
});
