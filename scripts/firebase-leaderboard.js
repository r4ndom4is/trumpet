import { initializeApp } from "firebase/app";
import {
  initializeAuth, browserLocalPersistence, setPersistence,
  connectAuthEmulator, signInAnonymously
} from "firebase/auth";
import {
  initializeFirestore, memoryLocalCache, connectFirestoreEmulator, doc,
  getDocFromServer, runTransaction, Timestamp, serverTimestamp
} from "firebase/firestore";
import { LIMIT, normalizeName, utcDay, emptyBoard, selectBoard, qualifies, insertScore } from "./global-scores-model.js";

const sdk = {
  initializeApp, initializeAuth, browserLocalPersistence, setPersistence,
  connectAuthEmulator, signInAnonymously, initializeFirestore, memoryLocalCache,
  connectFirestoreEmulator, doc, getDocFromServer, runTransaction, Timestamp, serverTimestamp
};
const KINDS = ["daily", "allTime"];
const CACHE_MS = 60_000;

function failure(code, message, cause) {
  return Object.assign(new Error(message), { code, ...(cause ? { cause } : {}) });
}

function explain(error) {
  if (error?.code?.startsWith("global/")) return error;
  const code = String(error?.code || "unknown").replace(/^firestore\//, "");
  if (code === "resource-exhausted" || code === "auth/quota-exceeded") {
    return failure("global/quota", "Global scores have reached their free service quota. Please try later.", error);
  }
  if (code === "permission-denied") {
    return failure("global/permission", "The score was not allowed. Check your device date and time; the leaderboard rules or setup may also need attention.", error);
  }
  if (["unavailable", "deadline-exceeded", "auth/network-request-failed"].includes(code)) {
    return failure("global/network", "Global scores could not reach the server. Check your connection and try later.", error);
  }
  if (["auth/operation-not-allowed", "auth/invalid-api-key", "auth/configuration-not-found"].includes(code)) {
    return failure("global/config", "Global scores are not configured correctly. Anonymous sign-in must be enabled.", error);
  }
  return failure(error?.code || "global/unavailable", "Global scores are unavailable. Your local score is still saved.", error);
}

export function decodeBoard(raw, kind, nowMs) {
  if (!raw) return emptyBoard(kind === "daily" ? utcDay(nowMs) : null);
  try {
    if (Object.keys(raw).sort().join(",") !== "day,entries,order") throw new Error("Unexpected board fields.");
    for (let index = 1; index < raw.order.length; index++) {
      if (compareRaw(raw.entries, raw.order[index - 1], raw.order[index]) > 0) throw new Error("Invalid server ranking.");
    }
    const entries = Object.fromEntries(Object.entries(raw.entries).map(([uid, entry]) => {
      if (Object.keys(entry).sort().join(",") !== "at,name,score" || !(entry.at instanceof Timestamp)) {
        throw new Error("Invalid entry fields or timestamp.");
      }
      return [uid, { name: entry.name, score: entry.score, at: entry.at.toMillis() }];
    }));
    // Number milliseconds can round two distinct nanosecond timestamps together.
    // Project a model-valid order; writes restore exact server timestamp ordering.
    const order = [...raw.order].sort((a, b) =>
      entries[b].score - entries[a].score || entries[a].at - entries[b].at || compareUid(a, b));
    return selectBoard({
      day: raw.day === null ? null : raw.day.toMillis(),
      entries,
      order
    }, kind, nowMs);
  } catch (error) {
    throw failure("global/invalid-board", "The global leaderboard could not be read. Check your device date and time, or try later.", error);
  }
}

function compareUid(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

function compareRaw(entries, a, b) {
  const left = entries[a], right = entries[b];
  return right.score - left.score ||
    left.at.seconds - right.at.seconds || left.at.nanoseconds - right.at.nanoseconds || compareUid(a, b);
}

export function encodeBoard(board, raw, uid, firebase = sdk) {
  const entries = Object.fromEntries(board.order.map(id => [
    id, id === uid
      ? { name: board.entries[id].name, score: board.entries[id].score, at: firebase.serverTimestamp() }
      : raw.entries[id]
  ]));
  return {
    day: board.day === null ? null : firebase.Timestamp.fromMillis(board.day),
    entries,
    order: [...board.order].sort((a, b) =>
      a === b ? 0 : board.entries[b].score - board.entries[a].score ||
      // The new server timestamp follows all previous commits, including when
      // the device clock is slightly behind the server.
      (a === uid ? 1 : b === uid ? -1 : compareRaw(raw.entries, a, b)))
  };
}

// Local storage is deliberate: unlike Firebase's persistence hierarchy it cannot
// silently replace an unavailable durable identity with an in-memory guest.
function assertStorage(environment) {
  try {
    const storage = environment.localStorage;
    const key = `trumpet:firebase-storage-check:${Math.random()}`;
    storage.setItem(key, key);
    const persisted = storage.getItem(key) === key;
    storage.removeItem(key);
    if (!persisted) throw new Error("Storage did not retain the test value.");
  } catch (error) {
    throw failure("global/persistence", "Publishing needs browser storage to keep your guest identity. Allow local storage, then reload; no replacement guest was created.", error);
  }
}

export function createLeaderboardClient({ environment = globalThis, firebase = sdk, now = Date.now, timeoutMs = 12_000 } = {}) {
  let runtimePromise, activeConfig, cache, reading, submitting, generation = 0;

  function configuration() {
    const config = environment.TRUMPET_FIREBASE;
    if (config?.enabled !== true) throw failure("global/disabled", "Global scores are not connected. Local scores still work.");
    if (environment.navigator?.onLine === false) throw failure("global/offline", "You are offline. Your score stays local until you choose to publish online.");
    let options;
    if (config.emulators === true) {
      if (!["localhost", "127.0.0.1", "[::1]", "::1"].includes(environment.location?.hostname) ||
          (config.projectId && config.projectId !== "demo-trumpet-flight") ||
          (config.apiKey && config.apiKey !== "demo-key")) {
        throw failure("global/config", "Firebase emulators require a loopback page and the demo-trumpet-flight project. No production connection was made.");
      }
      options = {
        projectId: "demo-trumpet-flight", apiKey: "demo-key",
        authDomain: "demo-trumpet-flight.firebaseapp.com", appId: config.appId || "demo-trumpet-flight"
      };
    } else {
      if (config.emulators !== false && config.emulators !== undefined) {
        throw failure("global/config", "Firebase emulators must be explicitly true or false.");
      }
      if (["apiKey", "authDomain", "projectId", "appId"].some(key => typeof config[key] !== "string" || !config[key].trim()) ||
          config.projectId.startsWith("demo-") || config.apiKey === "demo-key") {
        throw failure("global/config", "Global scores need a complete Firebase web configuration before connecting.");
      }
      options = Object.fromEntries(["apiKey", "authDomain", "projectId", "appId"].map(key => [key, config[key]]));
    }
    const fingerprint = JSON.stringify([options, config.emulators === true]);
    if (activeConfig && activeConfig !== fingerprint) {
      throw failure("global/config", "Firebase configuration changed. Reload before using global scores.");
    }
    return { options, fingerprint, emulators: config.emulators === true };
  }

  async function runtime() {
    const config = configuration();
    if (!runtimePromise) {
      activeConfig = config.fingerprint;
      runtimePromise = (async () => {
        const app = firebase.initializeApp(config.options, "trumpet-global-scores");
        let auth = null, persistenceError = null;
        try {
          assertStorage(environment);
          auth = firebase.initializeAuth(app, { persistence: firebase.browserLocalPersistence });
          if (config.emulators) firebase.connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
          await firebase.setPersistence(auth, firebase.browserLocalPersistence);
          await auth.authStateReady();
        } catch (error) {
          persistenceError = failure("global/persistence", "Your guest identity could not be restored safely. Allow browser storage and reload before publishing; no replacement guest was created.", error);
        }
        const db = firebase.initializeFirestore(app, { localCache: firebase.memoryLocalCache() });
        if (config.emulators) firebase.connectFirestoreEmulator(db, "127.0.0.1", 8080);
        return { db, auth, persistenceError, refs: KINDS.map(kind => firebase.doc(db, "leaderboards", kind)) };
      })();
    }
    return runtimePromise;
  }

  function effective(boards, nowMs = now()) {
    const copy = board => ({ day: board.day, entries: Object.fromEntries(
      Object.entries(board.entries).map(([uid, entry]) => [uid, { ...entry }])
    ), order: [...board.order] });
    return {
      ...boards,
      daily: copy(selectBoard(boards.daily, "daily", nowMs)),
      allTime: copy(selectBoard(boards.allTime, "allTime", nowMs))
    };
  }

  function deadline(operation, onTimeout, message, code = "global/timeout") {
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => {
        onTimeout();
        reject(failure(code, message));
      }, timeoutMs);
    });
    return Promise.race([operation, timeout]).finally(() => clearTimeout(timer));
  }

  function resultFrom(snapshots, auth, fetchedAt) {
    return {
      daily: decodeBoard(snapshots[0].exists() ? snapshots[0].data() : null, "daily", fetchedAt),
      allTime: decodeBoard(snapshots[1].exists() ? snapshots[1].data() : null, "allTime", fetchedAt),
      uid: auth?.currentUser?.uid || null,
      fetchedAt
    };
  }

  async function read({ force = false } = {}) {
    try {
      configuration();
      if (reading) return await reading;
      if (!force && cache && now() - cache.fetchedAt >= 0 && now() - cache.fetchedAt < CACHE_MS) {
        return effective(cache);
      }
      let expired = false;
      const readGeneration = generation;
      const operation = (async () => {
        const { refs, auth } = await runtime();
        if (expired) throw failure("global/timeout", "Global scores took too long to load.");
        const snapshots = await Promise.all(refs.map(ref => firebase.getDocFromServer(ref)));
        const result = resultFrom(snapshots, auth, now());
        if (!expired && readGeneration === generation) cache = result;
        return effective(result);
      })();
      reading = deadline(operation, () => { expired = true; },
        "Global scores took too long to load. Check your connection and try later.").finally(() => { reading = null; });
      return await reading;
    } catch (error) {
      throw explain(error);
    }
  }

  async function submit({ score, name, completedAt } = {}) {
    let normalized;
    try { normalized = normalizeName(name); } catch (error) {
      throw failure("global/invalid-name", error.message || "Enter a valid arcade name.", error);
    }
    if (!Number.isSafeInteger(score) || score <= 0) {
      throw failure("global/invalid-score", "Only a completed run with a positive whole-number score can be published.");
    }
    if (!Number.isSafeInteger(completedAt) || completedAt < 0 || completedAt > now()) {
      throw failure("global/invalid-run", "The completed run has an invalid time. Check your device clock and finish a new run.");
    }
    configuration();
    if (submitting) throw failure("global/submission-pending", "Your previous publication is still being confirmed. Please wait before publishing again.");
    generation++;
    cache = null;
    let expired = false, wrote = false, attemptedWrite = false;
    const operation = (async () => {
      const current = await runtime();
      if (expired) throw failure("global/timeout", "Publication was stopped before sending a score.");
      if (current.persistenceError) throw current.persistenceError;
      assertStorage(environment);
      if (!current.auth.currentUser) {
        try {
          await firebase.signInAnonymously(current.auth);
        } catch (error) {
          if (!String(error?.code).startsWith("auth/") || error.code === "auth/web-storage-unsupported") {
            current.persistenceError = failure("global/persistence",
              "Your guest identity could not be saved safely. Allow browser storage and reload before publishing.", error);
            throw current.persistenceError;
          }
          throw error;
        }
      }
      if (expired) throw failure("global/timeout", "Publication was stopped before sending a score.");
      const uid = current.auth.currentUser?.uid;
      if (!uid) throw failure("global/persistence", "A persistent guest identity could not be established. Reload before trying again.");
      assertStorage(environment);
      const transact = () => firebase.runTransaction(current.db, async transaction => {
        configuration();
        if (expired) throw failure("global/timeout", "Publication was stopped before sending a score.");
        const snapshots = await Promise.all(current.refs.map(ref => transaction.get(ref)));
        const timestamp = now();
        const boards = resultFrom(snapshots, current.auth, timestamp);
        const accepted = [];
        for (let index = 0; index < KINDS.length; index++) {
          const kind = KINDS[index];
          if (kind === "daily" && utcDay(completedAt) !== utcDay(timestamp)) continue;
          const board = boards[kind];
          const next = insertScore(board, uid, { name: normalized, score, at: timestamp });
          if (next === board) continue;
          const raw = snapshots[index].exists() ? snapshots[index].data() : null;
          if (!Object.hasOwn(board.entries, uid) && board.order.length === LIMIT) {
            const actualWorst = raw.order[raw.order.length - 1];
            const projectedWorst = board.order[board.order.length - 1];
            if (actualWorst !== projectedWorst) {
              next.entries[projectedWorst] = board.entries[projectedWorst];
              delete next.entries[actualWorst];
              next.order = Object.keys(next.entries);
            }
          }
          if (expired) throw failure("global/timeout", "Publication was stopped before sending a score.");
          attemptedWrite = true;
          transaction.set(current.refs[index], encodeBoard(next, raw, uid, firebase));
          accepted.push(kind);
        }
        return { ...boards, accepted };
      }, { maxAttempts: 3 });
      let transactionResult;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          transactionResult = await transact();
          break;
        } catch (error) {
          // A concurrent full-map update can fail rules before Firestore checks
          // its transaction precondition. Only a definite denial is safe to retry.
          const denied = ["permission-denied", "firestore/permission-denied"].includes(error?.code);
          if (!denied || expired || attempt === 2) throw error;
        }
      }
      wrote = transactionResult.accepted.length > 0;
      generation++;
      cache = null;
      if (!wrote) {
        const { accepted, ...boards } = transactionResult;
        cache = boards;
        return effective(transactionResult);
      }
      // Commit transforms use server time. Read the committed documents rather
      // than presenting the client's provisional timestamp as an acknowledged score.
      const snapshots = await Promise.all(current.refs.map(ref => firebase.getDocFromServer(ref)));
      cache = resultFrom(snapshots, current.auth, now());
      const result = { ...cache, accepted: transactionResult.accepted };
      return effective(result);
    })();
    submitting = operation;
    operation.finally(() => { submitting = null; }).catch(() => {});
    try {
      return await deadline(operation, () => { expired = true; cache = null; },
        "Publication is not confirmed yet and may still complete. Refresh the global boards before trying again; your local score is safe.",
        "global/submission-unconfirmed");
    } catch (error) {
      cache = null;
      if (wrote) throw failure("global/submission-unconfirmed", "Your score was sent, but the updated boards could not be loaded. Refresh the boards before publishing again.", error);
      const explained = explain(error);
      if (attemptedWrite && ["global/network", "global/unavailable"].includes(explained.code)) {
        throw failure("global/submission-unconfirmed", "The connection was lost while publishing; your score may have arrived. Refresh the boards before publishing again.", error);
      }
      throw explained;
    }
  }

  return Object.freeze({
    get enabled() { return environment.TRUMPET_FIREBASE?.enabled === true; },
    read, submit, effective, qualifies, utcDay, normalizeName
  });
}

if (typeof window !== "undefined") window.TRUMPET_GLOBAL_SCORES = createLeaderboardClient({ environment: window });
