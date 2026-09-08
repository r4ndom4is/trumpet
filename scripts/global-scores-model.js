export const LIMIT = 10;
const DAY_MS = 86_400_000;
const NAME = /^[A-Z0-9]{3}$/;
const own = (object, key) => Object.hasOwn(object, key);

function record(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function exactKeys(value, keys) {
  return record(value) && Reflect.ownKeys(value).length === keys.length && keys.every(key => own(value, key));
}

function timestamp(value, label) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 8_640_000_000_000_000) {
    throw new TypeError(`${label} must be a finite nonnegative timestamp in milliseconds.`);
  }
}

function scoreValue(score) {
  return Number.isSafeInteger(score) && score > 0;
}

function uidValue(uid) {
  return typeof uid === 'string' && uid.length > 0 && uid.length <= 128;
}

function dayValue(day) {
  if (day !== null) {
    timestamp(day, 'Board day');
    if (day % DAY_MS !== 0) throw new TypeError('Board day must be UTC midnight.');
  }
}

export function normalizeName(value) {
  if (typeof value !== 'string') throw new TypeError('Arcade name must be a string.');
  const name = value.trim().toUpperCase();
  if (!NAME.test(name)) throw new TypeError('Use exactly 3 characters: letters A–Z or digits 0–9.');
  return name;
}

export function utcDay(milliseconds) {
  timestamp(milliseconds, 'Current time');
  return Math.floor(milliseconds / DAY_MS) * DAY_MS;
}

export function emptyBoard(day) {
  dayValue(day);
  return { day, entries: {}, order: [] };
}

function compare(entries, left, right) {
  const a = entries[left];
  const b = entries[right];
  return b.score - a.score || a.at - b.at || (left < right ? -1 : left > right ? 1 : 0);
}

export function validateBoard(board) {
  if (!exactKeys(board, ['day', 'entries', 'order'])) throw new TypeError('Board must contain only day, entries and order.');
  dayValue(board.day);
  if (!record(board.entries) || !Array.isArray(board.order)) throw new TypeError('Board entries must be a map and order must be a list.');
  const keys = Reflect.ownKeys(board.entries);
  if (keys.length > LIMIT || keys.length !== board.order.length
      || new Set(board.order).size !== keys.length
      || !board.order.every(uid => uidValue(uid) && own(board.entries, uid))) {
    throw new TypeError('Board order must contain each entry UID exactly once, with at most 10 entries.');
  }
  for (const uid of board.order) {
    const entry = board.entries[uid];
    if (!exactKeys(entry, ['name', 'score', 'at'])) throw new TypeError(`Entry ${uid} must contain only name, score and at.`);
    if (typeof entry.name !== 'string' || !NAME.test(entry.name)) throw new TypeError(`Entry ${uid} has an invalid arcade name.`);
    if (!scoreValue(entry.score)) throw new TypeError(`Entry ${uid} score must be a positive safe integer.`);
    timestamp(entry.at, `Entry ${uid} time`);
  }
  for (let index = 1; index < board.order.length; index++) {
    if (compare(board.entries, board.order[index - 1], board.order[index]) > 0) {
      throw new TypeError('Board order must be score descending, time ascending, then UID ascending.');
    }
  }
  return board;
}

export function selectBoard(board, kind, nowMs) {
  if (kind !== 'daily' && kind !== 'allTime') throw new TypeError('Board kind must be daily or allTime.');
  const today = utcDay(nowMs);
  if (board === null || board === undefined) return emptyBoard(kind === 'daily' ? today : null);
  validateBoard(board);
  if (kind === 'allTime') {
    if (board.day !== null) throw new TypeError('All-time board day must be null.');
  } else {
    if (board.day === null || board.day > today) throw new TypeError('Daily board must have a UTC day no later than today.');
    if (board.day < today) return emptyBoard(today);
  }
  return board;
}

export function qualifies(board, uid, score) {
  validateBoard(board);
  if (!scoreValue(score) || (uid !== null && !uidValue(uid))) return false;
  if (uid !== null && own(board.entries, uid)) return score > board.entries[uid].score;
  return board.order.length < LIMIT || score > board.entries[board.order[LIMIT - 1]].score;
}

export function insertScore(board, uid, { name, score, at }) {
  if (!uidValue(uid)) {
    validateBoard(board);
    return board;
  }
  if (!qualifies(board, uid, score)) return board;
  const normalizedName = normalizeName(name);
  timestamp(at, 'Submission time');
  const entries = { ...board.entries, [uid]: { name: normalizedName, score, at } };
  if (!own(board.entries, uid) && board.order.length === LIMIT) delete entries[board.order[LIMIT - 1]];
  const order = Object.keys(entries).sort((left, right) => compare(entries, left, right));
  return { day: board.day, entries, order };
}
