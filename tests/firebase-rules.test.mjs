import { before, beforeEach, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import {
  collection, deleteDoc, doc, getDoc, getDocs, runTransaction, serverTimestamp,
  setDoc, Timestamp, writeBatch, setLogLevel,
} from 'firebase/firestore';
import { emptyBoard, insertScore, selectBoard, utcDay } from '../scripts/global-scores-model.js';

const PROJECT = 'demo-trumpet-flight';
const DAY = 86_400_000;
let env;
const db = uid => uid ? env.authenticatedContext(uid).firestore() : env.unauthenticatedContext().firestore();
const ref = (uid, kind = 'allTime') => doc(db(uid), 'leaderboards', kind);
const nowDay = () => utcDay(Date.now());
const entry = (score = 100, at = serverTimestamp(), name = 'ACE') => ({ name, score, at });
const single = (uid = 'alice', kind = 'allTime', score = 100) => ({
  day: kind === 'daily' ? Timestamp.fromMillis(nowDay()) : null,
  entries: { [uid]: entry(score) }, order: [uid],
});
const read = async (kind = 'allTime') => (await getDoc(ref(null, kind))).data();
const clone = board => ({ ...board, entries: { ...board.entries }, order: [...board.order] });
function full(kind = 'allTime', count = 10) {
  const board = { day: kind === 'daily' ? Timestamp.fromMillis(nowDay()) : null, entries: {}, order: [] };
  for (let i = 0; i < count; i++) {
    const uid = `u${i}`;
    board.entries[uid] = entry(100 - i, Timestamp.fromMillis(nowDay() + i), `AC${i}`);
    board.order.push(uid);
  }
  return board;
}
async function seed(board, kind = 'allTime') {
  await env.withSecurityRulesDisabled(context => setDoc(doc(context.firestore(), 'leaderboards', kind), board));
}
function withNew(board, uid, score) {
  const next = clone(board);
  next.entries[uid] = entry(score);
  if (!Object.hasOwn(board.entries, uid) && next.order.length === 10) delete next.entries[next.order.pop()];
  next.order = Object.keys(next.entries).sort((a, b) => next.entries[b].score - next.entries[a].score
    || (a === uid ? 1 : b === uid ? -1 : next.entries[a].at.toMillis() - next.entries[b].at.toMillis())
    || (a < b ? -1 : a > b ? 1 : 0));
  return next;
}

before(async () => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error('Run through firebase emulators:exec --only firestore --project demo-trumpet-flight.');
  setLogLevel('silent');
  env = await initializeTestEnvironment({
    projectId: PROJECT,
    firestore: { rules: await readFile(new URL('../firestore.rules', import.meta.url), 'utf8') },
  });
});
beforeEach(async () => env.clearFirestore());
after(async () => env?.cleanup());

test('public individual gets only; all lists, other paths, archives and deletes denied', async () => {
  await assertSucceeds(getDoc(ref(null)));
  await assertSucceeds(getDoc(ref(null, 'daily')));
  await assertFails(getDocs(collection(db(), 'leaderboards')));
  await assertFails(getDocs(collection(db('alice'), 'leaderboards')));
  for (const path of ['leaderboards/yesterday', 'players/alice', 'leaderboards/daily/archive/today']) {
    await assertFails(getDoc(doc(db(), path)));
    await assertFails(setDoc(doc(db('alice'), path), single()));
  }
  await assertSucceeds(setDoc(ref('alice'), single()));
  await assertFails(deleteDoc(ref('alice')));
});

test('authenticated caller can create only their singleton with server timestamp', async () => {
  await assertFails(setDoc(ref(null), single()));
  await assertFails(setDoc(ref('bob'), single()));
  await assertFails(setDoc(ref('alice'), emptyBoard(null)));
  const extra = single();
  extra.entries.bob = entry(1);
  extra.order.push('bob');
  await assertFails(setDoc(ref('alice'), extra));
  await assertSucceeds(setDoc(ref('alice'), single()));
  assert.equal((await read()).entries.alice.at instanceof Timestamp, true);
  await assertSucceeds(setDoc(ref('alice', 'daily'), single('alice', 'daily')));
});

test('schema, names, scores, types, dates and metadata are strictly checked', async () => {
  const bad = [
    { ...single(), extra: 1 }, { entries: single().entries, order: ['alice'] },
    { ...single(), day: Timestamp.fromMillis(nowDay()) },
    { ...single(), entries: [] }, { ...single(), order: 'alice' },
    { ...single(), order: ['alice', 'alice'] }, { ...single(), order: [1] },
    { ...single(), order: ['bob'] },
  ];
  for (const score of [0, -1, 1.5, 9007199254740992, NaN, Infinity, '42', null]) {
    bad.push({ ...single(), entries: { alice: entry(score) } });
  }
  for (const name of ['', ' ', 'A', 'AB', 'ABCD', 'ace', 'A B', 'A.B', 'A_B', 'A-B', ' ACE', 'ACE ', '.ACE', 'É', '<X>', 'ABCDEFGHIJKLM', 'ACE\n', 7, null]) {
    bad.push({ ...single(), entries: { alice: entry(1, serverTimestamp(), name) } });
  }
  for (const at of [0, null, 'today', Timestamp.fromMillis(0), Timestamp.fromMillis(Date.now() + DAY)]) {
    bad.push({ ...single(), entries: { alice: entry(1, at) } });
  }
  bad.push({ ...single(), entries: { alice: { ...entry(), extra: true } } });
  bad.push({ ...single(), entries: { alice: { name: 'ACE', score: 1 } } });
  for (const board of bad) await assertFails(setDoc(ref('alice'), board));
  await assertSucceeds(setDoc(ref('alice'), single('alice', 'allTime', Number.MAX_SAFE_INTEGER)));
  const numericTag = single('alice', 'daily');
  numericTag.entries.alice.name = '123';
  await assertSucceeds(setDoc(ref('alice', 'daily'), numericTag));
});

test('daily uses server UTC day, not client dates or local time', async () => {
  for (const day of [null, 0, 'today', nowDay() - DAY, nowDay() + DAY, nowDay() + 1]) {
    const data = single('alice', 'daily');
    data.day = typeof day === 'number' ? Timestamp.fromMillis(day) : day;
    await assertFails(setDoc(ref('alice', 'daily'), data));
  }
  await assertSucceeds(setDoc(ref('alice', 'daily'), single('alice', 'daily')));
  const today = await read('daily');
  await assertFails(setDoc(ref('bob', 'daily'), single('bob', 'daily')));
  const yesterday = { ...today, day: Timestamp.fromMillis(nowDay() - DAY) };
  await seed(yesterday, 'daily');
  const carryForward = withNew({ ...yesterday, day: Timestamp.fromMillis(nowDay()) }, 'bob', 200);
  await assertFails(setDoc(ref('bob', 'daily'), carryForward));
  await assertSucceeds(setDoc(ref('bob', 'daily'), single('bob', 'daily', 1)));
  assert.deepEqual((await read('daily')).order, ['bob']);
  await seed({ ...today, day: Timestamp.fromMillis(nowDay() + DAY) }, 'daily');
  await assertFails(setDoc(ref('alice', 'daily'), single('alice', 'daily', 200)));
});

test('own best only upgrades score and preserves all other records byte-for-byte', async () => {
  await assertSucceeds(setDoc(ref('alice'), single()));
  let board = await read();
  await assertSucceeds(setDoc(ref('bob'), withNew(board, 'bob', 90)));
  board = await read();
  for (const score of [99, 100]) await assertFails(setDoc(ref('alice'), withNew(board, 'alice', score)));
  const rename = clone(board);
  rename.entries.alice = { ...board.entries.alice, name: 'NEW', at: serverTimestamp() };
  await assertFails(setDoc(ref('alice'), rename));
  const stolen = withNew(board, 'alice', 200);
  stolen.entries.bob = { ...board.entries.bob, name: 'BAD' };
  await assertFails(setDoc(ref('alice'), stolen));
  stolen.entries.bob = { ...board.entries.bob, at: serverTimestamp() };
  await assertFails(setDoc(ref('alice'), stolen));
  const spoof = withNew(board, 'alice', 200);
  spoof.entries.alice.at = board.entries.alice.at;
  await assertFails(setDoc(ref('alice'), spoof));
  const improved = withNew(board, 'alice', 200);
  improved.entries.alice.name = 'A09';
  await assertSucceeds(setDoc(ref('alice'), improved));
  assert.equal((await read()).entries.alice.name, 'A09');
  assert.deepEqual((await read()).entries.bob, board.entries.bob);
});

test('full ten-player board admits eleventh qualifier and evicts only last place', async () => {
  const board = full();
  await seed(board);
  await assertFails(setDoc(ref('new'), withNew(board, 'new', 91)));
  await assertFails(setDoc(ref('new'), withNew(board, 'new', 90)));
  const tooMany = withNew(board, 'new', 200);
  tooMany.entries.u9 = board.entries.u9;
  tooMany.order.push('u9');
  await assertFails(setDoc(ref('new'), tooMany));
  const wrongEviction = withNew(board, 'new', 200);
  delete wrongEviction.entries.u8;
  wrongEviction.entries.u9 = board.entries.u9;
  wrongEviction.order = wrongEviction.order.filter(uid => uid !== 'u8').concat('u9');
  await assertFails(setDoc(ref('new'), wrongEviction));
  const extraEviction = withNew(board, 'new', 200);
  delete extraEviction.entries.u8;
  extraEviction.order = extraEviction.order.filter(uid => uid !== 'u8');
  await assertFails(setDoc(ref('new'), extraEviction));
  await assertSucceeds(setDoc(ref('new'), withNew(board, 'new', 200)));
  const next = await read();
  assert.equal(next.order.length, 10);
  assert.equal(next.order[0], 'new');
  assert.equal(Object.hasOwn(next.entries, 'u9'), false);
  for (const uid of board.order.slice(0, 9)) assert.deepEqual(next.entries[uid], board.entries[uid]);
});

test('own full-board upgrade cannot evict anyone; nonfull insertion cannot gratuitously delete', async () => {
  const board = full();
  await seed(board);
  const bad = withNew(board, 'u9', 200);
  delete bad.entries.u8;
  bad.order = bad.order.filter(uid => uid !== 'u8');
  await assertFails(setDoc(ref('u9'), bad));
  await assertSucceeds(setDoc(ref('u9'), withNew(board, 'u9', 200)));
  const smaller = full('allTime', 3);
  await seed(smaller);
  const deletion = withNew(smaller, 'new', 200);
  delete deletion.entries.u2;
  deletion.order = deletion.order.filter(uid => uid !== 'u2');
  await assertFails(setDoc(ref('new'), deletion));
  await assertFails(setDoc(ref('u0'), single('u0', 'allTime', 200)));
});

test('full-board sorting, duplicate identity, foreign insertion and tie order are enforced', async () => {
  const board = full();
  await seed(board);
  for (let i = 0; i < 9; i++) {
    const unsorted = withNew(board, 'new', 200);
    [unsorted.order[i], unsorted.order[i + 1]] = [unsorted.order[i + 1], unsorted.order[i]];
    await assertFails(setDoc(ref('new'), unsorted));
  }
  const duplicate = withNew(board, 'new', 200);
  duplicate.order[9] = duplicate.order[0];
  await assertFails(setDoc(ref('new'), duplicate));
  await assertFails(setDoc(ref('new'), withNew(board, 'imposter', 200)));
  const tied = withNew(board, 'new', 92);
  assert.deepEqual(tied.order.slice(-2), ['u8', 'new']);
  const backwards = clone(tied);
  backwards.order.splice(8, 2, 'new', 'u8');
  await assertFails(setDoc(ref('new'), backwards));
  await assertSucceeds(setDoc(ref('new'), tied));
});

test('same timestamp ties use lexical UID, including full-board expression budget', async () => {
  const board = full();
  for (const uid of board.order) board.entries[uid] = entry(100, Timestamp.fromMillis(nowDay()));
  await seed(board);
  const next = withNew(board, 'u9', 101);
  await assertSucceeds(setDoc(ref('u9'), next));
  const malformed = clone(next);
  [malformed.order[1], malformed.order[2]] = [malformed.order[2], malformed.order[1]];
  malformed.entries.u9 = entry(102);
  await assertFails(setDoc(ref('u9'), malformed));
});

test('daily reset and all-time update may commit atomically with at most twenty rows', async () => {
  await seed(full());
  await seed({ ...full('daily'), day: Timestamp.fromMillis(nowDay() - DAY) }, 'daily');
  const firestore = db('new');
  const batch = writeBatch(firestore);
  batch.set(doc(firestore, 'leaderboards', 'daily'), single('new', 'daily', 200));
  batch.set(doc(firestore, 'leaderboards', 'allTime'), withNew(await read(), 'new', 200));
  await assertSucceeds(batch.commit());
  assert.equal((await read('daily')).order.length, 1);
  assert.equal((await read()).order.length, 10);
  await seed(full('daily'), 'daily');
  assert.equal((await read('daily')).order.length + (await read()).order.length, 20);
});

test('simultaneous transaction contenders preserve both upgrades and bounded ordering', async () => {
  await seed(full());
  const submit = async (uid, score) => {
    const firestore = db(uid);
    return runTransaction(firestore, async transaction => {
      const document = doc(firestore, 'leaderboards', 'allTime');
      const snapshot = await transaction.get(document);
      const data = snapshot.data();
      const numeric = {
        day: null,
        entries: Object.fromEntries(Object.entries(data.entries).map(([id, value]) => [id, { ...value, at: value.at.toMillis() }])),
        order: data.order,
      };
      const current = selectBoard(numeric, 'allTime', Date.now());
      const next = insertScore(current, uid, { name: 'ACE', score, at: Date.now() });
      if (next === current) return;
      transaction.set(document, {
        day: null,
        entries: Object.fromEntries(next.order.map(id => [id, id === uid ? entry(score) : data.entries[id]])),
        order: next.order,
      });
    });
  };
  // A stale whole-map transaction can hit rules before Firestore checks its
  // version precondition. Retry by rereading, never by replaying a stale write.
  const retrySubmission = async (uid, score) => {
    for (let attempt = 0; ; attempt++) {
      try {
        return await submit(uid, score);
      } catch (error) {
        if (error.code !== 'permission-denied' || attempt === 3) throw error;
      }
    }
  };
  await Promise.all([retrySubmission('contenderA', 201), retrySubmission('contenderB', 202)]);
  const board = await read();
  assert.equal(board.order.length, 10);
  assert.deepEqual(board.order.slice(0, 2), ['contenderB', 'contenderA']);
  assert.equal(Object.hasOwn(board.entries, 'u8'), false);
  assert.equal(Object.hasOwn(board.entries, 'u9'), false);
});
