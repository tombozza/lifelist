// The RESTORE block of app.js (between the restore-core markers): Restore from a
// backup only adds what isn't here, and what it adds survives a sync with another device.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { restoreMissing } from '../vendor/safety/bin.js';

const src = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const block = (name) => src.slice(src.indexOf(`// >>> ${name}`), src.indexOf(`// <<< ${name}`));
const helpers = `
function getWeekStart(d) { const x = new Date(d + 'T12:00:00Z'); const k = (x.getUTCDay() + 6) % 7; x.setUTCDate(x.getUTCDate() - k); return x.toISOString().slice(0, 10); }
function addDays(d, n) { const x = new Date(d + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); }
`;
const A = new Function(helpers + block('archive-core') + block('restore-core') +
  '; return { compactArchive, archiveDone, mergeTombstones, applyTombstones, deleteArchived, restorePlan, applyRestore };')();
const clone = o => JSON.parse(JSON.stringify(o));
let n = 0;
const newId = () => 'new' + (++n);

// The merge in pullFromCloud(), as pure steps (as in archive.test.mjs), plus the wholesale fields
function merge(local, cloud, now) {
  const s = clone(local);
  s.deletedIds = A.mergeTombstones(s.deletedIds, cloud.deletedIds, now);
  const m = new Map(s.tasks.map(t => [t.id, t]));
  (cloud.tasks || []).forEach(rt => { const lt = m.get(rt.id); if (!lt || (rt.updatedAt || 0) > (lt.updatedAt || 0)) m.set(rt.id, rt); });
  const applied = A.applyTombstones([...m.values()], s.deletedIds);
  s.tasks = applied.tasks; s.deletedIds = applied.deletedIds;
  s.archive = A.compactArchive([...(s.archive || []), ...(cloud.archive || [])], s.deletedIds);
  if ((cloud.themesUpdatedAt || 0) > (s.themesUpdatedAt || 0)) { s.themes = cloud.themes; s.themesUpdatedAt = cloud.themesUpdatedAt; }
  if ((cloud.tagsUpdatedAt || 0) > (s.tagsUpdatedAt || 0) || !s.tagsUpdatedAt) { s.tagCategories = cloud.tagCategories; s.tagsUpdatedAt = cloud.tagsUpdatedAt; }
  return s;
}

const base = () => ({
  tasks: [{ id: 'a', title: 'Keep', status: 'active', kanbanColumn: 'backlog', updatedAt: 100 }],
  archive: [], deletedIds: [],
  themes: [{ id: 'th1', name: 'Home', subThemes: [] }], themesUpdatedAt: 50,
  tagCategories: [{ id: 'who', name: 'Who', tags: [{ id: 'who-1', name: 'Jim' }] }], tagsUpdatedAt: 50,
  smartNotes: [], smartNotesUpdatedAt: 0,
});
const ids = s => s.tasks.map(t => t.id).sort();
const archived = s => s.archive.flatMap(w => w.tasks.map(t => t.id)).sort();

test('only what is missing is added; what is here is left exactly as it is', () => {
  const s = base();
  s.tasks[0].title = 'Keep (edited since)';
  const backup = clone(base());
  backup.tasks[0].title = 'Keep';
  backup.tasks.push({ id: 'b', title: 'Lost', status: 'active', kanbanColumn: 'live', updatedAt: 90 });
  backup.themes.push({ id: 'th2', name: 'Work', subThemes: [] });
  backup.tagCategories[0].tags.push({ id: 'who-2', name: 'Mum' });
  backup.tagCategories.push({ id: 'where', name: 'Where', tags: [{ id: 'where-1', name: 'Shop' }] });
  backup.smartNotes = [{ id: 'n1', name: 'Shop', inc: {}, exc: {} }];
  backup.archive = [{ weekStart: '2026-11-02', tasks: [{ id: 'c', title: 'Done thing', status: 'complete', updatedAt: 80 }] }];
  const plan = A.restorePlan(s, backup, restoreMissing);
  assert.deepEqual(plan.tasks.add.map(t => t.id), ['b']);
  assert.equal(plan.tasks.already, 1);
  assert.deepEqual(plan.archive.add.map(e => e.task.id), ['c']);
  assert.deepEqual(plan.themes.add.map(t => t.id), ['th2']);
  assert.deepEqual(plan.tags.add.map(e => e.tag.id), ['who-2', 'where-1']);
  assert.deepEqual(plan.notes.add.map(x => x.id), ['n1']);
  A.applyRestore(s, plan, 5000, newId);
  assert.equal(s.tasks.find(t => t.id === 'a').title, 'Keep (edited since)');
  assert.equal(s.tasks.find(t => t.id === 'a').updatedAt, 100);
  assert.equal(s.tasks.find(t => t.id === 'b').updatedAt, 5000);
  assert.deepEqual(archived(s), ['c']);
  assert.equal(s.themesUpdatedAt, 5000);
  assert.deepEqual(s.tagCategories.find(c => c.id === 'who').tags.map(t => t.id), ['who-1', 'who-2']);
  assert.ok(s.tagCategories.find(c => c.id === 'where'));
  assert.equal(s.smartNotes.length, 1);
});

test('restored on one device, the other device keeps them after a sync (the old import lost them)', () => {
  const cloud = base();
  cloud.tasks.push({ id: 'b', title: 'Lost', status: 'active', updatedAt: 90 });
  const backup = clone(cloud);                       // taken while b existed
  // b is deleted, everywhere
  cloud.tasks = cloud.tasks.filter(t => t.id !== 'b');
  cloud.deletedIds.push({ id: 'b', ts: 200 });
  cloud.tasks[0].updatedAt = 300;                    // and newer work on a since
  const phone = clone(cloud), laptop = clone(cloud);
  const plan = A.restorePlan(phone, backup, restoreMissing);
  A.applyRestore(phone, plan, 5000, newId);
  const back = phone.tasks.find(t => t.title === 'Lost');
  assert.ok(back, 'restored');
  assert.notEqual(back.id, 'b', 'deleted for good here, so it comes back under a new id');
  // phone pulls the cloud (unchanged) then pushes: the cloud is now the phone's merge
  const pushed = merge(phone, cloud, 6000);
  assert.ok(pushed.tasks.some(t => t.title === 'Lost'), 'survives its own pull');
  // laptop reloads and pulls
  const after = merge(laptop, pushed, 7000);
  assert.ok(after.tasks.some(t => t.title === 'Lost'), 'on the other device');
  assert.equal(after.tasks.find(t => t.id === 'a').updatedAt, 300, 'newer work untouched');
  // and the laptop's own stale copy pushed back over it doesn't undo it
  const again = merge(pushed, laptop, 8000);
  assert.ok(again.tasks.some(t => t.title === 'Lost'));
});

test('an archived task deleted from the archive comes back into the archive, and sticks', () => {
  const s = base();
  s.tasks.push({ id: 'c', title: 'Done', status: 'complete', kanbanColumn: 'complete', completedDate: '2026-11-03', updatedAt: 100 });
  A.archiveDone(s, '2026-11-19', 200);
  const backup = clone(s);
  A.deleteArchived(s, 'c', 300);
  assert.deepEqual(archived(s), []);
  const cloud = clone(s);
  A.applyRestore(s, A.restorePlan(s, backup, restoreMissing), 5000, newId);
  assert.equal(archived(s).length, 1);
  const other = merge(cloud, s, 6000);
  assert.equal(other.archive.flatMap(w => w.tasks).filter(t => t.title === 'Done').length, 1);
});

test('a task archived here is already here; nothing is added twice', () => {
  const s = base();
  s.tasks.push({ id: 'c', title: 'Done', status: 'complete', completedDate: '2026-11-03', updatedAt: 100 });
  const backup = clone(s);
  A.archiveDone(s, '2026-11-19', 200);
  const plan = A.restorePlan(s, backup, restoreMissing);
  assert.equal(plan.tasks.add.length, 0);
  assert.equal(plan.tasks.already, 2);
});

test('a repeat still going here: dormant occurrences are skipped, an active one comes back a one-off', () => {
  const s = base();
  s.tasks.push({ id: 'r2', title: 'Bins', status: 'scheduled', recurring: { every: 'week' }, recurRoot: 'r1', updatedAt: 100 });
  const backup = clone(base());
  backup.tasks.push({ id: 'r1', title: 'Bins', status: 'active', recurring: { every: 'week' }, recurRoot: 'r1', spawnedChildId: 'r0', updatedAt: 50 });
  backup.tasks.push({ id: 'r0', title: 'Bins', status: 'scheduled', recurring: { every: 'week' }, recurRoot: 'r1', updatedAt: 50 });
  const plan = A.restorePlan(s, backup, restoreMissing);
  assert.deepEqual(plan.tasks.add.map(t => t.id), ['r1']);
  A.applyRestore(s, plan, 5000, newId);
  const r1 = s.tasks.find(t => t.id === 'r1');
  assert.equal(r1.recurring, null);
  assert.equal(r1.spawnedChildId, undefined);
});

test('a new id is carried onto its parent link and the step that points at it', () => {
  const s = base();
  s.deletedIds.push({ id: 'p', ts: 10 }, { id: 'k', ts: 10 });
  const backup = clone(base());
  backup.tasks.push({ id: 'p', title: 'Parent', status: 'active', subtasks: [{ id: 's1', title: 'Step', cardId: 'k' }], updatedAt: 5 });
  backup.tasks.push({ id: 'k', title: 'Step', status: 'active', parentId: 'p', updatedAt: 5 });
  A.applyRestore(s, A.restorePlan(s, backup, restoreMissing), 5000, newId);
  const p = s.tasks.find(t => t.title === 'Parent'), k = s.tasks.find(t => t.title === 'Step');
  assert.equal(k.parentId, p.id);
  assert.equal(p.subtasks[0].cardId, k.id);
});

test('a file that is not a Life Kanban backup is refused', () => {
  assert.throws(() => A.restorePlan(base(), { foo: 1 }, restoreMissing), /isn't a Life Kanban backup/);
});
