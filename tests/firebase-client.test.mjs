import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { chromium } from "playwright";
import { Timestamp } from "firebase/firestore";
import { createLeaderboardClient, decodeBoard, encodeBoard } from "../scripts/firebase-leaderboard.js";
import { bundleFirebase } from "../scripts/build-firebase.mjs";
import { utcDay } from "../scripts/global-scores-model.js";

const NOW = Date.UTC(2026, 8, 8, 12);
const DAY = 86_400_000;
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};

function fixture({ timestamp = NOW, timeoutMs = 1000, documents = {} } = {}) {
  let time = timestamp;
  const storage = new Map();
  const calls = { app: 0, auth: 0, signIn: 0, reads: 0, transactions: 0, writes: [], steps: [] };
  const auth = { currentUser: null, authStateReady: async () => {} };
  const environment = {
    TRUMPET_FIREBASE: { enabled: true, emulators: true, projectId: "demo-trumpet-flight", apiKey: "demo-key" },
    location: { hostname: "127.0.0.1" },
    navigator: { onLine: true },
    localStorage: {
      setItem: (key, value) => storage.set(key, value),
      getItem: key => storage.get(key) ?? null,
      removeItem: key => storage.delete(key)
    }
  };
  const snapshot = ref => ({ exists: () => !!documents[ref], data: () => documents[ref] });
  const transform = Symbol("serverTimestamp");
  const firebase = {
    Timestamp,
    initializeApp: () => { calls.app++; return {}; },
    initializeAuth: () => { calls.auth++; return auth; },
    browserLocalPersistence: {},
    setPersistence: async () => {},
    connectAuthEmulator: () => {},
    initializeFirestore: () => ({}),
    memoryLocalCache: () => ({}),
    connectFirestoreEmulator: () => {},
    doc: (_, collection, kind) => { assert.equal(collection, "leaderboards"); return kind; },
    signInAnonymously: async () => {
      calls.signIn++;
      auth.currentUser = { uid: "guest" };
      return { user: auth.currentUser };
    },
    serverTimestamp: () => transform,
    getDocFromServer: async ref => { calls.reads++; return snapshot(ref); },
    runTransaction: async (_, callback) => {
      calls.transactions++;
      const writes = [];
      const result = await callback({
        get: async ref => { calls.steps.push(`get:${ref}`); return snapshot(ref); },
        set: (ref, value) => { calls.steps.push(`set:${ref}`); writes.push([ref, value]); }
      });
      for (const [ref, board] of writes) {
        calls.writes.push([ref, board]);
        documents[ref] = {
          ...board,
          entries: Object.fromEntries(Object.entries(board.entries).map(([uid, row]) => [
            uid, row.at === transform ? { ...row, at: new Timestamp(Math.floor(time / 1000), 123456789) } : row
          ]))
        };
      }
      return result;
    }
  };
  return {
    client: createLeaderboardClient({ environment, firebase, now: () => time, timeoutMs }),
    environment, firebase, auth, calls, documents, snapshot,
    setTime: value => { time = value; }
  };
}

function board(day, entries) {
  return { day: day === null ? null : Timestamp.fromMillis(day), entries, order: Object.keys(entries) };
}

test("Disabled adapter and bundled SDK are inert, inline-safe and contain the public API", async () => {
  const source = await bundleFirebase();
  const config = await readFile(new URL("../scripts/firebase-config.js", import.meta.url), "utf8");
  let requests = 0;
  const window = { fetch: () => { requests++; throw new Error("Unexpected network"); } };
  vm.runInNewContext(`${config}\n${source}`, { window, console, setTimeout, clearTimeout });
  assert.equal(window.TRUMPET_GLOBAL_SCORES.enabled, false);
  assert.equal(requests, 0);
  assert.doesNotMatch(source, /<\/script/i);
  assert.match(source, /@license/);
  await assert.rejects(window.TRUMPET_GLOBAL_SCORES.read(), { code: "global/disabled" });
  assert.equal(requests, 0);
});

test("Configuration, emulator origin and offline guards never initialize the SDK", async () => {
  for (const setup of [
    f => { f.environment.TRUMPET_FIREBASE.enabled = false; },
    f => { f.environment.navigator.onLine = false; },
    f => { f.environment.location.hostname = "example.com"; },
    f => { f.environment.TRUMPET_FIREBASE.projectId = "production"; },
    f => { f.environment.TRUMPET_FIREBASE.emulators = false; }
  ]) {
    const f = fixture();
    setup(f);
    await assert.rejects(f.client.read(), error => /^global\//.test(error.code));
    assert.equal(f.calls.app, 0);
  }
});

test("Public server reads share requests, cache for 60 seconds and never sign in", async () => {
  const f = fixture();
  const waiting = deferred();
  f.firebase.getDocFromServer = async ref => { f.calls.reads++; await waiting.promise; return f.snapshot(ref); };
  const first = f.client.read(), second = f.client.read({ force: true });
  waiting.resolve();
  const [a, b] = await Promise.all([first, second]);
  assert.deepEqual(a, b);
  assert.equal(a.uid, null);
  assert.equal(f.calls.reads, 2);
  await f.client.read();
  assert.equal(f.calls.reads, 2);
  await f.client.read({ force: true });
  assert.equal(f.calls.reads, 4);
  f.setTime(NOW + 60_001);
  await f.client.read();
  assert.equal(f.calls.reads, 6);
  assert.equal(f.calls.signIn, 0);
});

test("Pre-auth qualification previews accept an empty identity without signing in", async () => {
  const f = fixture();
  const empty = { day: null, entries: {}, order: [] };
  assert.equal(f.client.qualifies(empty, null, 12), true);
  assert.equal(f.client.qualifies(empty, null, 0), false);
  assert.equal(f.calls.app, 0);
  f.documents.allTime = board(null, Object.fromEntries(Array.from({ length: 10 }, (_, index) => [
    `u${index}`, { name: "ACE", score: 10, at: Timestamp.fromMillis(NOW - 1000) }
  ])));
  const publicBoards = await f.client.read();
  assert.equal(publicBoards.uid, null);
  assert.equal(f.client.qualifies(publicBoards.allTime, publicBoards.uid, 11), true);
  assert.equal(f.client.qualifies(publicBoards.allTime, publicBoards.uid, 10), false);
  assert.equal(f.client.qualifies(publicBoards.allTime, publicBoards.uid, 9), false);
  assert.equal(f.calls.signIn, 0);
  assert.equal(f.calls.writes.length, 0);
});

test("Cached daily board expires at UTC midnight without another request", async () => {
  const start = utcDay(NOW) + DAY - 1000;
  const f = fixture({ timestamp: start, documents: {
    daily: board(utcDay(start), { old: { name: "OLD", score: 5, at: Timestamp.fromMillis(start - 1000) } })
  } });
  const initial = await f.client.read();
  initial.daily.entries.old.score = 999;
  assert.equal((await f.client.read()).daily.entries.old.score, 5, "Callers cannot mutate the cache.");
  f.setTime(start + 2000);
  const current = await f.client.read();
  assert.deepEqual(current.daily.order, []);
  assert.equal(current.daily.day, utcDay(start + 2000));
  assert.equal(f.calls.reads, 2);
});

test("Errors are actionable failures, not empty successful boards", async () => {
  for (const [code, expected] of [
    ["resource-exhausted", "global/quota"], ["permission-denied", "global/permission"],
    ["unavailable", "global/network"]
  ]) {
    const f = fixture();
    f.firebase.getDocFromServer = async () => { throw Object.assign(new Error("test"), { code }); };
    await assert.rejects(f.client.read(), { code: expected });
  }
  const f = fixture({ timeoutMs: 10 });
  f.firebase.getDocFromServer = () => new Promise(() => {});
  await assert.rejects(f.client.read(), { code: "global/timeout" });
});

test("Invalid submissions fail before initialization or anonymous signup", async () => {
  const f = fixture();
  for (const invalid of [
    { name: "!" }, { score: 0 }, { score: 1.5 }, { score: Number.MAX_SAFE_INTEGER + 1 },
    { completedAt: NOW + 1 }, { completedAt: undefined }
  ]) {
    await assert.rejects(f.client.submit({ name: "ACE", score: 10, completedAt: NOW, ...invalid }));
  }
  assert.equal(f.calls.app, 0);
  assert.equal(f.calls.signIn, 0);
});

test("Classic arcade tags normalize to exactly three ASCII letters or digits", async () => {
  const f = fixture();
  assert.equal(f.client.normalizeName(" a1z "), "A1Z");
  assert.equal(f.client.normalizeName("123"), "123");
  for (const name of ["", "A", "AB", "ABCD", "LONGNAME", "A B", "A-1", "A_1", "A.1", "ÅBC", "１２３", "💨AB"]) {
    assert.throws(() => f.client.normalizeName(name));
    await assert.rejects(f.client.submit({ score: 10, name, completedAt: NOW }), { code: "global/invalid-name" });
  }
  assert.equal(f.calls.app, 0);
  assert.equal(f.calls.signIn, 0);
  const published = await f.client.submit({ score: 10, name: " a1z ", completedAt: NOW });
  assert.equal(published.daily.entries[published.uid].name, "A1Z");
  assert.equal(published.allTime.entries[published.uid].name, "A1Z");
});

test("Unavailable durable storage allows public reads but never creates a transient guest", async () => {
  const f = fixture();
  f.environment.localStorage.setItem = () => { throw new Error("Storage blocked"); };
  assert.deepEqual((await f.client.read()).allTime.order, []);
  await assert.rejects(f.client.submit({ score: 10, name: "ACE", completedAt: NOW }), { code: "global/persistence" });
  assert.equal(f.calls.signIn, 0);
  assert.equal(f.calls.transactions, 0);
});

test("Firebase persistence restoration failure blocks signup instead of replacing identity", async () => {
  const f = fixture();
  f.firebase.setPersistence = async () => { throw new Error("Persistence failed"); };
  await assert.rejects(f.client.submit({ score: 10, name: "ACE", completedAt: NOW }), { code: "global/persistence" });
  assert.equal(f.calls.signIn, 0);
});

test("A failed identity write cannot be retried using an unpersisted in-memory guest", async () => {
  const f = fixture();
  f.firebase.signInAnonymously = async () => {
    f.calls.signIn++;
    f.auth.currentUser = { uid: "not-saved" };
    throw new Error("Browser storage write failed");
  };
  for (let attempt = 0; attempt < 2; attempt++) {
    await assert.rejects(f.client.submit({ score: 10, name: "ACE", completedAt: NOW }), { code: "global/persistence" });
  }
  assert.equal(f.calls.signIn, 1);
  assert.equal(f.calls.transactions, 0);
});

test("Explicit publication reads both docs first and returns acknowledged server timestamps", async () => {
  const f = fixture();
  const result = await f.client.submit({ score: 12, name: "ace", completedAt: NOW });
  assert.deepEqual(result.accepted, ["daily", "allTime"]);
  assert.deepEqual(f.calls.steps, ["get:daily", "get:allTime", "set:daily", "set:allTime"]);
  assert.equal(result.uid, "guest");
  assert.equal(result.daily.entries.guest.name, "ACE");
  assert.equal(result.daily.entries.guest.at, f.documents.daily.entries.guest.at.toMillis());
  assert.equal(f.calls.signIn, 1);
  const lower = await f.client.submit({ score: 11, name: "ALT", completedAt: NOW });
  assert.deepEqual(lower.accepted, []);
  assert.equal(f.calls.writes.length, 2);
  assert.equal(lower.allTime.entries.guest.name, "ACE");
  assert.equal(f.calls.signIn, 1);
});

test("Remembered completed runs can qualify all-time but never today's daily board", async () => {
  const f = fixture();
  const result = await f.client.submit({ score: 12, name: "ACE", completedAt: NOW - DAY });
  assert.deepEqual(result.accepted, ["allTime"]);
  assert.deepEqual(result.daily.order, []);
  assert.equal(f.documents.daily, undefined);
});

test("Unchanged rows preserve every server nanosecond and new ties follow existing commits", () => {
  const raw = board(null, {
    z: { name: "ZZZ", score: 20, at: new Timestamp(Math.floor(NOW / 1000), 1) },
    a: { name: "AAA", score: 20, at: new Timestamp(Math.floor(NOW / 1000), 2) }
  });
  const numeric = decodeBoard(raw, "allTime", NOW);
  assert.deepEqual(numeric.order, ["a", "z"], "Numeric projection resolves indistinguishable times by UID.");
  numeric.entries.guest = { name: "ACE", score: 20, at: NOW - 1000 };
  numeric.order.push("guest");
  const encoded = encodeBoard(numeric, raw, "guest");
  assert.deepEqual(encoded.order, ["z", "a", "guest"]);
  assert.strictEqual(encoded.entries.z, raw.entries.z);
  assert.strictEqual(encoded.entries.a.at, raw.entries.a.at);
});

test("Full boards evict the exact raw bottom entry even when numeric timestamps collapse", async () => {
  const entries = Object.fromEntries(Array.from({ length: 10 }, (_, index) => [
    `u${9 - index}`, { name: "ACE", score: 10, at: new Timestamp(Math.floor(NOW / 1000), index + 1) }
  ]));
  const f = fixture({ documents: { allTime: board(null, entries) } });
  const result = await f.client.submit({ score: 11, name: "NEW", completedAt: NOW - DAY });
  assert.deepEqual(result.accepted, ["allTime"]);
  assert.equal(f.documents.allTime.order.length, 10);
  assert.equal(f.documents.allTime.entries.u0, undefined);
  assert.ok(f.documents.allTime.entries.u9);
  assert.strictEqual(f.documents.allTime.entries.u9, entries.u9);
});

test("A timed-out transaction remains locked until resolved, with no automatic publication retry", async () => {
  const f = fixture({ timeoutMs: 10 });
  const pending = deferred();
  const original = f.firebase.runTransaction;
  f.firebase.runTransaction = async (...args) => {
    const result = await original(...args);
    await pending.promise;
    return result;
  };
  await assert.rejects(f.client.submit({ score: 12, name: "ACE", completedAt: NOW }), { code: "global/submission-unconfirmed" });
  await assert.rejects(f.client.submit({ score: 12, name: "ACE", completedAt: NOW }), { code: "global/submission-pending" });
  assert.equal(f.calls.signIn, 1);
  assert.equal(f.calls.transactions, 1);
  pending.resolve();
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal((await f.client.read()).allTime.entries.guest.score, 12);
});

test("A failed post-commit read is explicitly unconfirmed instead of success-shaped", async () => {
  const f = fixture();
  f.firebase.getDocFromServer = async () => { throw new Error("Network stopped"); };
  await assert.rejects(f.client.submit({ score: 12, name: "ACE", completedAt: NOW }), { code: "global/submission-unconfirmed" });
  assert.equal(f.calls.writes.length, 2);
});

test("Uncertain commit failures warn that publication might already have arrived", async () => {
  const f = fixture();
  const original = f.firebase.runTransaction;
  f.firebase.runTransaction = async (...args) => {
    await original(...args);
    throw Object.assign(new Error("Commit response lost"), { code: "unavailable" });
  };
  await assert.rejects(f.client.submit({ score: 12, name: "ACE", completedAt: NOW }), {
    code: "global/submission-unconfirmed"
  });
  assert.equal(f.calls.transactions, 1);
});

test("Qualification is checked in the transaction rather than trusting a cached board", async () => {
  const f = fixture();
  await f.client.read();
  f.auth.currentUser = { uid: "guest" };
  const existing = { guest: { name: "TOP", score: 40, at: Timestamp.fromMillis(NOW - 1000) } };
  f.documents.daily = board(utcDay(NOW), existing);
  f.documents.allTime = board(null, existing);
  const result = await f.client.submit({ score: 12, name: "ACE", completedAt: NOW });
  assert.deepEqual(result.accepted, []);
  assert.equal(f.calls.writes.length, 0);
  assert.equal(result.allTime.entries.guest.score, 40);
});

test("A stale-map permission denial retries fresh documents without losing a concurrent score", async () => {
  const f = fixture();
  const original = f.firebase.runTransaction;
  let attempts = 0;
  const concurrent = { name: "TOP", score: 40, at: Timestamp.fromMillis(NOW - 1000) };
  f.firebase.runTransaction = async (database, callback, options) => {
    attempts++;
    if (attempts === 1) {
      await callback({ get: async ref => f.snapshot(ref), set: () => {} });
      f.documents.allTime = board(null, { other: concurrent });
      throw Object.assign(new Error("Stale full map denied"), { code: "permission-denied" });
    }
    return original(database, callback, options);
  };
  const result = await f.client.submit({ score: 12, name: "ACE", completedAt: NOW });
  assert.deepEqual(result.accepted, ["daily", "allTime"]);
  assert.deepEqual(result.allTime.order, ["other", "guest"]);
  assert.strictEqual(f.documents.allTime.entries.other, concurrent);
  assert.equal(attempts, 2);
  assert.equal(f.calls.signIn, 1);
});

test("Definite permission-denied retries are bounded and retain the actionable final error", async () => {
  const f = fixture();
  let attempts = 0;
  f.firebase.runTransaction = async () => {
    attempts++;
    throw Object.assign(new Error("Rules deny this submission"), { code: "permission-denied" });
  };
  await assert.rejects(f.client.submit({ score: 12, name: "ACE", completedAt: NOW }), error => {
    assert.equal(error.code, "global/permission");
    assert.match(error.message, /device date and time/);
    return true;
  });
  assert.equal(attempts, 3);
  assert.equal(f.calls.signIn, 1);
  assert.equal(f.calls.writes.length, 0);
});

test("Configuration changes after initialization require reload instead of targeting another project", async () => {
  const f = fixture();
  await f.client.read();
  f.environment.TRUMPET_FIREBASE.appId = "different-app";
  await assert.rejects(f.client.read(), { code: "global/config" });
  assert.equal(f.calls.app, 1);
});

test("Real browser adapter persists one guest and publishes only eligible boards against local emulators", {
  skip: !process.env.FIRESTORE_EMULATOR_HOST,
  timeout: 90_000
}, async () => {
  const emulator = new URL(`http://${process.env.FIRESTORE_EMULATOR_HOST}`);
  assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(emulator.hostname));
  assert.equal(emulator.port, "8080", "The adapter intentionally uses the documented local emulator ports.");
  const cleared = await fetch(`${emulator.origin}/emulator/v1/projects/demo-trumpet-flight/databases/(default)/documents`, {
    method: "DELETE"
  });
  assert.ok(cleared.ok);
  const bundle = await bundleFirebase();
  const html = `<!doctype html><meta charset="utf-8"><script>
    window.TRUMPET_FIREBASE = {enabled:true,emulators:true,projectId:"demo-trumpet-flight",apiKey:"demo-key"};
    ${bundle}</script>`;
  const server = createServer((request, response) => {
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    response.end(html);
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  let browser;
  try {
    browser = await chromium.launch();
    const context = await browser.newContext({ serviceWorkers: "block" });
    const external = [], signup = [], errors = [];
    await context.route("**/*", async route => {
      const url = new URL(route.request().url());
      if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) {
        external.push(url.href);
        return route.abort();
      }
      if (url.pathname.includes("accounts:signUp")) signup.push(url.href);
      return route.continue();
    });
    const page = await context.newPage();
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    const empty = await page.evaluate(() => window.TRUMPET_GLOBAL_SCORES.read());
    assert.equal(empty.uid, null);
    assert.deepEqual(empty.daily.order, []);
    assert.equal(signup.length, 0);
    const result = await page.evaluate(() => window.TRUMPET_GLOBAL_SCORES.submit({
      name: "ace", score: 12, completedAt: Date.now()
    }));
    assert.deepEqual(result.accepted, ["daily", "allTime"]);
    assert.equal(result.daily.entries[result.uid].name, "ACE");
    assert.equal(signup.length, 1);
    await page.reload();
    const restored = await page.evaluate(() => window.TRUMPET_GLOBAL_SCORES.read());
    assert.equal(restored.uid, result.uid);
    const older = await page.evaluate(() => window.TRUMPET_GLOBAL_SCORES.submit({
      name: "ACE", score: 20, completedAt: Date.now() - 86_400_000
    }));
    assert.deepEqual(older.accepted, ["allTime"]);
    assert.equal(older.daily.entries[result.uid].score, 12);
    assert.equal(older.allTime.entries[result.uid].score, 20);
    assert.equal(signup.length, 1);
    await context.setOffline(true);
    const offline = await page.evaluate(() => window.TRUMPET_GLOBAL_SCORES.read().catch(error => error.code));
    assert.equal(offline, "global/offline");
    assert.deepEqual(external, []);
    assert.deepEqual(errors, []);
    await context.close();
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
});
