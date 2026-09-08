import test from 'node:test';
import assert from 'node:assert/strict';
import { LIMIT, normalizeName, utcDay, emptyBoard, validateBoard, selectBoard, qualifies, insertScore } from '../scripts/global-scores-model.js';

const DAY = 86_400_000;
const today = Date.UTC(2026, 8, 8);
const row = (score, at = today, name = 'ACE') => ({ name, score, at });
const add = (board, uid, score, at = today) => insertScore(board, uid, row(score, at));
function full(day = null) {
  let board = emptyBoard(day);
  for (let i = 0; i < LIMIT; i++) board = add(board, `u${i}`, 100 - i);
  return board;
}

test('arcade names normalize and reject invalid strings', () => {
  assert.equal(normalizeName('  ace \t '), 'ACE');
  assert.equal(normalizeName('a09'), 'A09');
  assert.equal(normalizeName('123'), '123');
  for (const value of ['', '   ', 'A', 'AB', 'ABCD', 'A B', 'A\tB', 'A.B', 'A_B', 'A-B', '.ACE', 'É', '<SCRIPT>', 'ABCDEFGHIJKLM', 12, null]) {
    assert.throws(() => normalizeName(value), /name|characters/);
  }
});

test('UTC midnight is timezone independent and invalid times are rejected', () => {
  assert.equal(utcDay(Date.parse('2026-09-09T02:59:59.999+03:00')), today);
  assert.equal(utcDay(today + DAY), today + DAY);
  assert.equal(utcDay(today + 0.5), today);
  for (const value of [-1, NaN, Infinity, '0', 8_640_000_000_000_001]) assert.throws(() => utcDay(value));
  assert.throws(() => emptyBoard(today + 1), /midnight/);
});

test('absent boards and daily rollover are empty without mutating persisted data', () => {
  assert.deepEqual(selectBoard(null, 'daily', today), emptyBoard(today));
  assert.deepEqual(selectBoard(undefined, 'allTime', today), emptyBoard(null));
  const stale = full(today - DAY);
  assert.deepEqual(selectBoard(stale, 'daily', today), emptyBoard(today));
  assert.equal(stale.order.length, LIMIT);
  assert.equal(selectBoard(stale, 'daily', today - DAY), stale);
  const permanent = full();
  assert.equal(selectBoard(permanent, 'allTime', today + 1000 * DAY), permanent);
  assert.throws(() => selectBoard(emptyBoard(today + DAY), 'daily', today), /no later/);
  assert.throws(() => selectBoard(emptyBoard(null), 'daily', today));
  assert.throws(() => selectBoard(emptyBoard(today), 'allTime', today));
  assert.throws(() => selectBoard(null, 'archive', today));
});

test('ranking is immutable, descending, and has one best per UID', () => {
  const first = add(emptyBoard(null), 'a', 5);
  Object.freeze(first.entries.a);
  Object.freeze(first.entries);
  Object.freeze(first.order);
  Object.freeze(first);
  const second = add(first, 'b', 8);
  assert.deepEqual(second.order, ['b', 'a']);
  assert.equal(second.entries.a, first.entries.a);
  assert.equal(add(second, 'a', 5), second);
  assert.equal(add(second, 'a', 4), second);
  const improved = add(second, 'a', 9, today + 1);
  assert.deepEqual(improved.order, ['a', 'b']);
  assert.equal(improved.entries.a.at, today + 1);
  assert.equal(improved.order.length, 2);
  assert.deepEqual(first.order, ['a']);
});

test('ties retain earlier time and use stable lexical UID when timestamps match', () => {
  let board = add(emptyBoard(null), 'z', 9, today);
  board = add(board, 'a', 9, today + 1);
  board = add(board, 'b', 9, today);
  assert.deepEqual(board.order, ['b', 'z', 'a']);
  assert.equal(validateBoard(board), board);
  const fractional = add(add(emptyBoard(null), 'z', 1, today + 0.25), 'a', 1, today + 0.5);
  assert.deepEqual(fractional.order, ['z', 'a']);
  assert.equal(validateBoard(fractional), fractional);
});

test('full boards require strictly beating cutoff; only last place is evicted', () => {
  const board = full();
  assert.equal(board.order.length, 10);
  assert.equal(qualifies(board, 'new', 91), false);
  assert.equal(add(board, 'new', 91, today - 1), board);
  assert.equal(add(board, 'new', 90), board);
  const next = add(board, 'new', 92, today + 1);
  assert.equal(next.order.length, 10);
  assert.equal(Object.hasOwn(next.entries, 'u9'), false);
  assert.deepEqual(next.order.slice(-2), ['u8', 'new']);
  for (const uid of next.order.filter(uid => uid !== 'new')) assert.equal(next.entries[uid], board.entries[uid]);
  const improved = add(board, 'u9', 101, today + 1);
  assert.equal(improved.order[0], 'u9');
  assert.equal(improved.order.length, 10);
  assert.deepEqual(Object.keys(improved.entries).sort(), Object.keys(board.entries).sort());
});

test('invalid scores and identities do not qualify; unsafe metadata cannot enter', () => {
  const board = emptyBoard(null);
  for (const score of [0, -1, 1.5, NaN, Infinity, 9007199254740992, '42', null]) {
    assert.equal(qualifies(board, 'a', score), false);
    assert.equal(add(board, 'a', score), board);
  }
  for (const uid of ['', undefined, 12, 'x'.repeat(129)]) assert.equal(qualifies(board, uid, 1), false);
  assert.equal(add(board, 'a', Number.MAX_SAFE_INTEGER).entries.a.score, Number.MAX_SAFE_INTEGER);
  assert.throws(() => insertScore(board, 'a', row(1, -1)), /timestamp/);
  assert.throws(() => insertScore(board, 'a', row(1, today, '!!!')), /characters/);
  const special = add(board, '__proto__', 1);
  assert.deepEqual(special.order, ['__proto__']);
  assert.equal(validateBoard(special), special);
});

test('public pre-auth qualification treats null as a newcomer without allowing insertion', () => {
  const empty = emptyBoard(null);
  assert.equal(qualifies(empty, null, 1), true);
  assert.equal(qualifies(empty, null, 0), false);
  assert.equal(add(empty, null, 1), empty);
  assert.equal(add(empty, '', 1), empty);
  assert.equal(add(empty, undefined, 1), empty);
  const board = full();
  assert.equal(qualifies(board, null, 91), false);
  assert.equal(qualifies(board, null, 92), true);
  assert.equal(add(board, null, 200), board);
  const literalNullUid = add(empty, 'null', 500);
  assert.equal(qualifies(literalNullUid, null, 1), true);
  assert.equal(qualifies(literalNullUid, 'null', 1), false);
  assert.throws(() => qualifies({}, null, 1), /Board/);
  assert.throws(() => add({}, null, 1), /Board/);
});

test('corruption throws instead of masquerading as an empty successful read', () => {
  const valid = full(today);
  const bad = [
    {}, [], { ...valid, extra: 0 }, { ...valid, day: today + 1 },
    { ...valid, entries: [] }, { ...valid, order: 'u0' },
    { ...valid, order: [...valid.order].reverse() },
    { ...valid, order: valid.order.map(() => 'u0') },
    { ...valid, order: valid.order.slice(1) },
    { ...valid, entries: { ...valid.entries, outsider: row(1) } },
    ...[{ ...row(100), extra: 1 }, row(0), row('100'), row(100, '0'), row(100, today, 'lowercase'), null]
      .map(entry => ({ ...valid, entries: { ...valid.entries, u0: entry } })),
  ];
  for (const board of bad) {
    assert.throws(() => validateBoard(board));
    assert.throws(() => selectBoard(board, 'daily', today + DAY));
    assert.throws(() => qualifies(board, 'new', 1000));
  }
});

test('two independent boards retain at most twenty total records and no archives', () => {
  let daily = emptyBoard(today);
  let allTime = emptyBoard(null);
  for (let i = 0; i < 100; i++) {
    daily = add(daily, `daily${i}`, i + 1);
    allTime = add(allTime, `forever${i}`, i + 1);
  }
  assert.equal(daily.order.length + allTime.order.length, 20);
  assert.equal(selectBoard(daily, 'daily', today + DAY).order.length, 0);
  assert.equal(selectBoard(allTime, 'allTime', today + DAY).order.length, 10);
});
