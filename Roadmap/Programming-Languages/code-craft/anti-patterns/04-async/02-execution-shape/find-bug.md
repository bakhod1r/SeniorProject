# Async Execution-Shape Anti-Patterns — Find the Bug

> **Category:** [Async Anti-Patterns](../README.md) → **Execution Shape** — *async control flow that runs differently than the code reads.*
> **Covers (collectively):** `await` in a Loop · Promise Chain Hell / Callback Pyramid · Mixing Callbacks and Promises

---

This file is **critical-reading practice**. Each snippet below is a plausible chunk of real-world async code in JavaScript, TypeScript, or Python (`asyncio`). Read it the way a careful reviewer does and answer three questions:

> **What's the execution-shape problem? Is the impact performance or correctness? How would you fix it?**

Execution-shape bugs are insidious because the code *reads* fine line by line. The defect is in the **shape of the control flow** — work that serializes when it could parallelize (a perf bug that quietly makes an endpoint 50× slower), or work the caller *thinks* it awaited but didn't (a correctness bug that ships incomplete data). Some snippets here crash; most don't. The dangerous ones return a plausible-looking result that is wrong, or return *before* the work is done.

One snippet is a **trap**: it looks like a needlessly serial loop you should "fix" with `Promise.all`, but it is correctly sequential and parallelizing it would break it. Spotting *that* is the same skill in reverse — read what the code depends on, not just its shape.

> **How to use this file:** read each snippet and write your own diagnosis *before* expanding the collapsible. The skill you're training is seeing the execution shape, not recalling the name.

---

## Table of Contents

1. [The dashboard that got slow](#snippet-1--the-dashboard-that-got-slow)
2. [Sending the welcome emails](#snippet-2--sending-the-welcome-emails)
3. [Mapping users to profiles](#snippet-3--mapping-users-to-profiles)
4. [Importing the whole catalog](#snippet-4--importing-the-whole-catalog)
5. [The retry wrapper that fires twice](#snippet-5--the-retry-wrapper-that-fires-twice)
6. [The order pipeline](#snippet-6--the-order-pipeline)
7. [Validating the migration, one row at a time](#snippet-7--validating-the-migration-one-row-at-a-time)
8. [The cache loader](#snippet-8--the-cache-loader)
9. [Fanning out the asyncio gather](#snippet-9--fanning-out-the-asyncio-gather)
10. [The chained transform](#snippet-10--the-chained-transform)
11. [The file processor that returns early](#snippet-11--the-file-processor-that-returns-early)
12. [Promisifying the database driver](#snippet-12--promisifying-the-database-driver)
13. [The pagination crawler](#snippet-13--the-pagination-crawler)
14. [The reduce that lost its order](#snippet-14--the-reduce-that-lost-its-order)

---

## Snippet 1 — The dashboard that got slow

```javascript
// JS — builds a dashboard payload; an HTTP handler under a 2s SLA
async function buildDashboard(userId) {
  const profile  = await getProfile(userId);        // ~120ms
  const orders   = await getRecentOrders(userId);   // ~140ms
  const messages = await getUnreadMessages(userId);  // ~110ms
  const billing  = await getBillingSummary(userId);  // ~160ms
  const feed     = await getActivityFeed(userId);    // ~200ms

  return { profile, orders, messages, billing, feed };
}
```

> What's the execution-shape problem? Perf or correctness? How would you fix it?

<details>
<summary>Answer</summary>

**`await` in a Loop** in its straight-line form — sequential `await`s of **independent** work. (It isn't a literal loop, but it's the same anti-pattern: each `await` parks the function until the prior call resolves.)

**Impact — performance.** None of the five calls depends on another, yet they run strictly one after the other: total latency ≈ 120 + 140 + 110 + 160 + 200 = **~730ms**. Run concurrently, the wall-clock time is the *slowest* call, **~200ms** — roughly 3.5× faster here, and on endpoints with eight or ten such fetches it routinely becomes the difference between 80ms and 2s. This is the single most common reason an async endpoint is "mysteriously slow."

**Fix — start all the independent work, then await it together:**

```javascript
async function buildDashboard(userId) {
  const [profile, orders, messages, billing, feed] = await Promise.all([
    getProfile(userId),
    getRecentOrders(userId),
    getUnreadMessages(userId),
    getBillingSummary(userId),
    getActivityFeed(userId),
  ]);
  return { profile, orders, messages, billing, feed };
}
```

The calls are *kicked off* before any `await`, so they overlap. Use `Promise.all` when one failure should fail the whole request; use `Promise.allSettled` if you want partial results (e.g. render the dashboard with the feed missing).

</details>

---

## Snippet 2 — Sending the welcome emails

```javascript
// JS — onboard a batch of newly-imported users
async function onboard(users) {
  users.forEach(async (user) => {
    await createAccount(user);
    await sendWelcomeEmail(user);
  });

  console.log(`Onboarded ${users.length} users`);
  return { onboarded: users.length };
}
```

> What's the execution-shape problem? Perf or correctness? How would you fix it?

<details>
<summary>Answer</summary>

**`forEach` with an `async` callback — a fire-and-forget shape disguised as a loop. This is a *correctness* bug, not a perf one.**

`Array.prototype.forEach` **ignores the return value** of its callback. The callback is `async`, so each invocation returns a `Promise` — and `forEach` throws all of them on the floor. The consequence: `forEach` returns *immediately*, before any `createAccount`/`sendWelcomeEmail` has finished. The function then logs "Onboarded N users" and returns `{ onboarded: N }` while the actual work is still pending in the background.

**Concrete impact:**
- The caller (and the HTTP response) reports success before the accounts exist — downstream code that assumes the users are onboarded races against work that hasn't run.
- Any rejection inside the callback becomes an **unhandled promise rejection** with no `try/catch` to catch it — it can crash the Node process (or vanish silently, depending on runtime config).
- In a serverless/Lambda context the function returns and the runtime may freeze or kill the container *mid-send*, so some emails never go out.

**Fix — use a real loop (`for...of`) so `await` actually pauses, or `Promise.all` to run concurrently:**

```javascript
// Concurrent — fastest, if the downstream can take the load:
async function onboard(users) {
  await Promise.all(users.map(async (user) => {
    await createAccount(user);
    await sendWelcomeEmail(user);
  }));
  console.log(`Onboarded ${users.length} users`);
  return { onboarded: users.length };
}

// Sequential — if order or rate-limiting matters:
//   for (const user of users) { await createAccount(user); await sendWelcomeEmail(user); }
```

`map` returns the promises (unlike `forEach`), so `Promise.all` can await them. **Rule:** `forEach` + `async` is almost always a bug — there is no way to await it.

</details>

---

## Snippet 3 — Mapping users to profiles

```typescript
// TS — assemble enriched profiles for a list of ids
async function enrich(ids: string[]): Promise<Profile[]> {
  const profiles = ids.map(async (id) => {
    const user = await getUser(id);
    const prefs = await getPrefs(id);
    return { ...user, prefs };
  });

  return profiles;   // TS: this returns Promise<Profile>[], not Profile[]
}

// caller:
const profiles = await enrich(ids);
console.log(profiles[0].prefs.theme);   // undefined — .prefs is on a Promise
```

> What's the execution-shape problem? Perf or correctness? How would you fix it?

<details>
<summary>Answer</summary>

**`.map(async …)` without `await Promise.all` — returning an array of *pending Promises*. A correctness bug** (the function's declared return type is even a lie).

`ids.map(async …)` produces a `Promise<Profile>[]` — an array of five promises, *not* five profiles. `enrich` returns that array directly, so `await enrich(ids)` awaits the **array** (a non-thenable, so `await` returns it unchanged) — `profiles[0]` is a `Promise`, and `profiles[0].prefs` is `undefined`. In plain JS this fails silently at runtime; the only reason TS doesn't catch it here is the implicit-`any`-ish flow — if the return type is honestly annotated `Promise<Profile[]>`, the compiler *does* flag `Promise<Profile>[]`.

**Impact:** the caller gets an array of the right *length* full of the wrong *thing*. Every field access yields `undefined`, often surfacing far from `enrich` as a confusing "theme is undefined" much later.

**Fix — wrap the mapped promises in `Promise.all` so you await them into values:**

```typescript
async function enrich(ids: string[]): Promise<Profile[]> {
  return Promise.all(
    ids.map(async (id) => {
      const [user, prefs] = await Promise.all([getUser(id), getPrefs(id)]);
      return { ...user, prefs };
    }),
  );
}
```

Two fixes in one: `Promise.all` resolves the outer array to real `Profile`s, and the inner `Promise.all` parallelizes the independent `getUser`/`getPrefs` pair (Snippet 1's lesson applied per element). **Heuristic:** any time you see `.map(async …)` and the result is *used*, there must be an `await Promise.all` (or `for await`) around it.

</details>

---

## Snippet 4 — Importing the whole catalog

```javascript
// JS — nightly job: re-index every product into the search engine
async function reindexAll() {
  const ids = await db.allProductIds();   // ~2,000,000 ids
  await Promise.all(
    ids.map((id) => indexProduct(id)),    // each does a DB read + an HTTP PUT
  );
  console.log("Reindex complete");
}
```

> What's the execution-shape problem? Perf or correctness? How would you fix it?

<details>
<summary>Answer</summary>

**Unbounded `Promise.all` over a huge list.** This is the *opposite* failure from Snippet 1: too much concurrency, not too little. It's both a performance and a stability bug — usually a crash.

`ids.map(indexProduct)` calls `indexProduct` for **all two million ids synchronously, right now**, before a single one resolves. That means: two million in-flight DB connections and two million pending HTTP sockets, all at once. What actually happens in production:
- **Out-of-memory** — two million pending promises plus their closures and buffered request/response bodies exhaust the heap; the process is OOM-killed.
- **Connection-pool exhaustion / `EMFILE`** — the DB pool and the OS file-descriptor limit are blown instantly; most calls error with "too many connections."
- **Downstream meltdown** — the search engine receives a two-million-request thundering herd and falls over, taking out unrelated traffic.

`Promise.all` does not throttle; it awaits whatever you hand it, and you handed it everything.

**Fix — bound the concurrency.** Use a pool/semaphore (`p-limit`) or batch the work:

```javascript
import pLimit from "p-limit";

async function reindexAll() {
  const ids = await db.allProductIds();
  const limit = pLimit(20);   // at most 20 in flight at once
  await Promise.all(ids.map((id) => limit(() => indexProduct(id))));
  console.log("Reindex complete");
}
```

Now at most 20 `indexProduct` calls run concurrently; the other ~1,999,980 wait their turn. Pick the bound from the *downstream* capacity (pool size, rate limit), not from the input size. For truly large jobs, also stream the ids rather than loading two million into memory at once.

</details>

---

## Snippet 5 — The retry wrapper that fires twice

```javascript
// JS — wrap a Node-style callback API in a Promise, with one retry
function fetchWithRetry(key, callback) {
  store.get(key, (err, value) => {
    if (err) {
      store.get(key, (err2, value2) => {       // retry once
        if (err2) callback(err2);
        callback(null, value2);                // <-- no return
      });
    }
    callback(null, value);                     // <-- runs even on the error path
  });
}

// caller:
fetchWithRetry("config", (err, value) => {
  if (err) return console.error(err);
  applyConfig(value);                          // sometimes applied twice
});
```

> What's the execution-shape problem? Perf or correctness? How would you fix it?

<details>
<summary>Answer</summary>

**Mixing callbacks and Promises (here, hand-rolled callback control flow) with missing `return`s — the callback fires *twice* (and sometimes with both an error *and* a value). A correctness bug, severe.**

Trace the error path. `store.get` errors → we enter the `if (err)` block and issue the retry. But there is **no `return`** after the retry call, so execution *continues* to the bottom line `callback(null, value)` — which runs immediately with the (undefined) `value`. Then later, when the retry resolves, *its* callback runs `callback(null, value2)` **a second time**. So on the error-then-success path, the caller's callback is invoked twice. On the error-then-error path it's invoked with `err2` *and* then with `null, value`.

Worse, the synchronous-vs-async timing is inconsistent ("releasing Zalgo"): on the happy path the callback fires once, asynchronously; on the error path it fires twice with different timing. Callers that assume "my callback runs exactly once" — nearly all of them — double-apply config, double-count metrics, or double-resolve a wrapping Promise.

**Fix — pick one model. Promisify the API once, then express retry with `async/await`, where you *cannot* accidentally continue:**

```javascript
import { promisify } from "node:util";
const getAsync = promisify(store.get.bind(store));

async function fetchWithRetry(key) {
  try {
    return await getAsync(key);
  } catch {
    return await getAsync(key);   // exactly one retry; a single return path
  }
}
```

`async/await` makes "run the callback once" structural: a `return`/`throw` exits, and there is no second code path to fall through into. **Rule:** never interleave manual callbacks and control flow by hand — promisify at the boundary and stay in one model.

</details>

---

## Snippet 6 — The order pipeline

```javascript
// JS — process an order through validation, payment, fulfilment, receipt
function processOrder(order) {
  return validate(order)
    .then((valid) => {
      return charge(valid.customer, valid.total)
        .then((payment) => {
          return fulfil(valid.items)
            .then((shipment) => {
              return sendReceipt(valid.customer, payment, shipment)
                .then(() => {
                  return { orderId: valid.id, shipped: shipment.tracking };
                });
            });
        });
    });
}
```

> What's the execution-shape problem? Perf or correctness? How would you fix it?

<details>
<summary>Answer</summary>

**Promise Chain Hell / the callback pyramid reborn as nested `.then`s.** Here it's primarily a *readability and maintainability* problem — but the nesting is exactly the shape that *hides* the correctness bugs in other snippets, so it earns its place.

Each `.then` nests inside the previous one purely to keep earlier variables (`valid`, `payment`, `shipment`) in scope. The result is the rightward-marching pyramid that `async/await` was designed to kill. Concrete costs:
- **No `.catch()` anywhere** — every rejection is swallowed into an unhandled rejection (a latent error-handling bug riding along).
- **Scope coupling** — `sendReceipt` needs `payment` *and* `shipment`, so they must stay nested; you can't flatten the chain into a sequence of `.then(step)` without losing the variables. That coupling is what tempts people to nest instead of chain.
- **Brittle to change** — inserting a step means re-indenting the whole tail.

**Fix — `async/await` flattens the pyramid and keeps all locals in one scope:**

```javascript
async function processOrder(order) {
  const valid    = await validate(order);
  const payment  = await charge(valid.customer, valid.total);
  const shipment = await fulfil(valid.items);
  await sendReceipt(valid.customer, payment, shipment);
  return { orderId: valid.id, shipped: shipment.tracking };
}
```

Linear, every variable in scope, and a single `try/catch` (or a caller-level handler) now covers every step. Note these steps are *genuinely* sequential — each depends on the previous — so this is not a missed-parallelism case; it's purely a shape fix.

</details>

---

## Snippet 7 — Validating the migration, one row at a time

```python
# Python (asyncio) — verify each migrated record against the legacy system,
# stopping at the first mismatch so we can resume from there.
import asyncio

async def verify_migration(record_ids):
    last_verified = None
    for record_id in record_ids:                      # ids are in commit order
        new = await fetch_from_new_db(record_id)
        old = await fetch_from_legacy(record_id)
        if not records_match(new, old):
            raise MismatchError(record_id, last_verified)
        await mark_verified(record_id)                # persists a resume checkpoint
        last_verified = record_id
    return last_verified
```

> What's the execution-shape problem? Perf or correctness? How would you fix it?

<details>
<summary>Answer</summary>

**Trap snippet — this `await`-in-a-loop is *correct*, and "fixing" it with `asyncio.gather` would break it.** The training value is resisting the reflex.

At a glance this is Snippet 1 again: a `for` loop with sequential `await`s, "obviously" should be a `gather`. But read the *dependencies and intent*:
- **Ordered fail-fast.** The loop must stop at the **first** mismatch in commit order and report `last_verified` so the job can resume. `gather` runs everything concurrently and resolves/raises in a way that loses "which was the first failure, and what came before it."
- **Sequential checkpointing.** `mark_verified` persists a resume point. Its correctness depends on the **invariant** that every earlier record already verified successfully. If you parallelize, record 50 might be marked verified before record 10's mismatch is even detected — corrupting the resume checkpoint.
- The independent pair *within* one iteration (`fetch_from_new_db` + `fetch_from_legacy`) *can* be parallelized safely — but the loop itself must stay sequential.

**Verdict:** leave the loop sequential. The only safe optimization is the per-iteration fetch:

```python
async def verify_migration(record_ids):
    last_verified = None
    for record_id in record_ids:
        new, old = await asyncio.gather(           # safe: independent within the row
            fetch_from_new_db(record_id),
            fetch_from_legacy(record_id),
        )
        if not records_match(new, old):
            raise MismatchError(record_id, last_verified)
        await mark_verified(record_id)
        last_verified = record_id
    return last_verified
```

**Lesson:** `await`-in-a-loop is an anti-pattern *only when the iterations are independent*. When each step depends on the previous, or order/fail-fast/rate-limiting is part of the contract, sequential is the **correct** shape — parallelizing it is the bug. Always ask "do these iterations depend on each other?" before reaching for `gather`/`Promise.all`.

</details>

---

## Snippet 8 — The cache loader

```typescript
// TS — lazily load and cache a config blob; mixes a Promise and a callback
class ConfigLoader {
  private cached?: Config;

  load(onReady: (cfg: Config) => void): Promise<Config> {
    if (this.cached) {
      onReady(this.cached);                 // sync callback
      return Promise.resolve(this.cached);
    }
    return fetchConfig().then((cfg) => {
      this.cached = cfg;
      onReady(cfg);                         // async callback
      return cfg;
    });
  }
}

// caller:
loader.load((cfg) => initFeatures(cfg));    // also: const c = await loader.load(...)
```

> What's the execution-shape problem? Perf or correctness? How would you fix it?

<details>
<summary>Answer</summary>

**Mixing callbacks and Promises in one API — *and* releasing Zalgo (the callback fires synchronously on a cache hit, asynchronously on a miss). A correctness bug.**

`load` does two contradictory things at once: it takes a callback (`onReady`) *and* returns a Promise. Two problems:

1. **Two ways to consume one result.** Callers can `await load(...)`, pass `onReady`, or both — so the same value can be delivered twice, or a caller awaits the Promise *and* another path already handled it via the callback. The API has no single source of truth for "the config is ready."
2. **Zalgo — inconsistent sync/async timing.** On a cache **hit**, `onReady(this.cached)` runs **synchronously**, before `load` even returns. On a cache **miss**, `onReady(cfg)` runs **later**, in a microtask. So `initFeatures` sometimes runs before the line after `load(...)` and sometimes after. Any caller with code like `load(cb); doNextThing();` gets a different ordering depending on cache state — the classic Zalgo bug, which surfaces as "works on the second call but not the first."

**Fix — one model: return a Promise, drop the callback. The cached value is still delivered asynchronously, consistently.**

```typescript
class ConfigLoader {
  private cached?: Promise<Config>;

  load(): Promise<Config> {
    if (!this.cached) {
      this.cached = fetchConfig();   // cache the *promise* — also dedupes concurrent loads
    }
    return this.cached;              // always async, always one delivery channel
  }
}

// caller: const cfg = await loader.load(); initFeatures(cfg);
```

Caching the *promise* (not the resolved value) guarantees the result is always delivered through `await`/`.then` — never synchronously — so timing is consistent, and concurrent callers share one in-flight fetch instead of racing.

</details>

---

## Snippet 9 — Fanning out the asyncio gather

```python
# Python (asyncio) — scrape a list of URLs and return successful bodies
import asyncio, aiohttp

async def scrape_all(urls, session):
    tasks = [fetch(session, url) for url in urls]
    results = await asyncio.gather(*tasks)        # one bad URL kills the batch
    return [r for r in results if r is not None]

async def fetch(session, url):
    async with session.get(url) as resp:
        return await resp.text()
```

> What's the execution-shape problem? Perf or correctness? How would you fix it?

<details>
<summary>Answer</summary>

**Two execution-shape problems at once: unbounded fan-out *and* `gather`'s default all-or-nothing error behaviour. Mostly correctness, with a stability angle.**

1. **Unbounded concurrency (the Python twin of Snippet 4).** `[fetch(session, url) for url in urls]` schedules a task per URL. For a few dozen URLs that's fine; for tens of thousands it opens tens of thousands of sockets at once — `aiohttp` connection limits, OS fd limits, and remote-host rate limits all blow at once.
2. **`gather` fails the whole batch on the first exception.** With the default `return_exceptions=False`, the *first* `fetch` that raises (a 500, a DNS failure, a timeout) causes `gather` to propagate that exception immediately — so a single bad URL discards every *other* result, including ones that already succeeded. The `if r is not None` filter implies the author *expected* failures to come back as `None`, but they don't; they raise. So the function doesn't degrade gracefully — it throws and loses everything.

**Fix — bound concurrency with a semaphore, and either capture per-task exceptions or return them explicitly:**

```python
async def scrape_all(urls, session, concurrency=20):
    sem = asyncio.Semaphore(concurrency)

    async def guarded(url):
        async with sem:                               # at most `concurrency` in flight
            try:
                return await fetch(session, url)
            except Exception:                         # degrade: skip the bad URL
                return None

    results = await asyncio.gather(*(guarded(u) for u in urls))
    return [r for r in results if r is not None]
```

The semaphore caps in-flight requests; wrapping each task in `try/except` (or passing `return_exceptions=True` to `gather` and filtering exceptions afterward) makes one failure local instead of fatal. Now the `if r is not None` filter actually does what it was written to do.

</details>

---

## Snippet 10 — The chained transform

```javascript
// JS — fetch a record, transform it, save it; "modernised" from callbacks
function updateRecord(id, patch) {
  return load(id)
    .then((record) => {
      applyPatch(record, patch);        // mutates record, returns void
    })
    .then((record) => {
      return save(record);              // record is undefined here
    })
    .then(() => "ok");
}
```

> What's the execution-shape problem? Perf or correctness? How would you fix it?

<details>
<summary>Answer</summary>

**Promise Chain Hell with a *broken return value* — the chain swallows the value between steps. A correctness bug.**

The defect is subtle and lives in *what each `.then` returns*:
- The first `.then((record) => { applyPatch(record, patch); })` calls `applyPatch` but **returns nothing** (the arrow has a block body with no `return`). So the promise resolves to `undefined`.
- The next `.then((record) => …)` receives that `undefined` as its `record` argument — the parameter name `record` is misleadingly reused but it's bound to `undefined`, not the loaded record.
- `save(undefined)` runs. Depending on `save`, this either throws, or — worse — **persists an empty/garbage record**, silently corrupting data while the chain still resolves to `"ok"`.

The shape caused it: in a flat `async` function the bug is glaring; threaded through `.then` callbacks where each step's output is the next step's input, forgetting to `return` the value is easy and invisible. `applyPatch` mutating in place rather than returning compounds the trap.

**Fix — `async/await` keeps the value in one variable; no inter-step plumbing to drop:**

```javascript
async function updateRecord(id, patch) {
  const record = await load(id);
  applyPatch(record, patch);   // mutation is fine when the variable persists
  await save(record);          // saves the real, patched record
  return "ok";
}
```

If you must stay in `.then`, every callback that feeds the next step must explicitly `return` the value (`.then(record => { applyPatch(record, patch); return record; })`). **Rule:** in a `.then` chain, the *return value* is your only channel between steps — drop it and the next step gets `undefined`.

</details>

---

## Snippet 11 — The file processor that returns early

```typescript
// TS — process every uploaded file, then report how many bytes were written
async function processUploads(files: File[]): Promise<number> {
  let totalBytes = 0;

  files.map(async (file) => {
    const data = await readFile(file);
    const out = await transform(data);
    await writeOutput(file.name, out);
    totalBytes += out.byteLength;        // accumulates "later"
  });

  return totalBytes;                     // returns 0
}
```

> What's the execution-shape problem? Perf or correctness? How would you fix it?

<details>
<summary>Answer</summary>

**`.map(async …)` with the result discarded (a fire-and-forget loop) *plus* an accumulator that's read before the work finishes. A correctness bug — the function returns `0` every time.**

This combines Snippet 2's and Snippet 3's failure modes:
- `files.map(async …)` builds an array of promises but **nobody awaits it** (the array is discarded), so `processUploads` runs to the `return` line *immediately*, before any `readFile`/`transform`/`writeOutput` has even started its async work.
- `totalBytes` is therefore still `0` at the `return`. The actual writes happen *after* the function has already returned `0` — and `totalBytes += …` mutates a variable whose value nobody will ever read.

So the caller is told "0 bytes written" while files are still being written in the background. The reported count is always wrong, and the function gives no signal of when (or whether) the writes completed. As in Snippet 2, a thrown error inside the callback is an unhandled rejection.

**Fix — `await Promise.all` over the mapped promises, then sum the results returned from each (don't mutate a shared accumulator):**

```typescript
async function processUploads(files: File[]): Promise<number> {
  const sizes = await Promise.all(
    files.map(async (file) => {
      const data = await readFile(file);
      const out = await transform(data);
      await writeOutput(file.name, out);
      return out.byteLength;        // return the value, don't mutate outer state
    }),
  );
  return sizes.reduce((a, b) => a + b, 0);   // summed only after all complete
}
```

Now the `await` guarantees every write finished before the sum is computed, and returning the per-file size (rather than `+=` into a closure variable) sidesteps the "accumulate later" timing trap entirely.

</details>

---

## Snippet 12 — Promisifying the database driver

```javascript
// JS — wrap a callback-based query API as a Promise, by hand
function query(sql, params) {
  return new Promise((resolve, reject) => {
    db.query(sql, params, (err, rows) => {
      if (err) reject(err);
      resolve(rows);                 // runs even after reject
    });
  });
}

// usage:
const rows = await query("SELECT * FROM users WHERE id = ?", [id]);
```

> What's the execution-shape problem? Perf or correctness? How would you fix it?

<details>
<summary>Answer</summary>

**Mixing callbacks and Promises via a hand-rolled wrapper, with a missing `return` on the error branch. A correctness bug — though the symptom is easy to miss because a settled Promise *looks* fine.**

On the error path: `db.query` calls back with `err` → `reject(err)` runs → but there's **no `return`**, so execution continues to `resolve(rows)`. Now both `reject` and `resolve` have been called on the same Promise. A Promise can only settle **once**, so the second call is a silent no-op — *which one wins depends on order*. Here `reject` runs first, so the Promise rejects (good, by luck). But:
- The intent is fragile: swap the two lines, or add logging between them, and you'd `resolve` first, making the error **vanish** — `await query(...)` would return `undefined` rows on a failed query, and the caller proceeds as if it succeeded.
- Hand-promisifying is error-prone exactly here: forgetting `return reject(...)` is the single most common bug in manual wrappers.

**Fix — don't hand-roll it; use `util.promisify`, which gets the once-only semantics right:**

```javascript
import { promisify } from "node:util";
const query = promisify(db.query.bind(db));

const rows = await query("SELECT * FROM users WHERE id = ?", [id]);
```

If you *must* wrap by hand, `return` on settle so the function cannot fall through: `if (err) return reject(err); return resolve(rows);`. **Rule:** every `resolve`/`reject` inside a `new Promise` executor should be guarded so exactly one runs — and prefer the standard promisify over writing your own.

</details>

---

## Snippet 13 — The pagination crawler

```python
# Python (asyncio) — pull every page of a paginated API into one list
import asyncio

async def fetch_all_pages(client, endpoint):
    pages = []
    cursor = None
    while True:
        resp = await client.get(endpoint, cursor=cursor)   # serial: each needs prev cursor
        pages.extend(resp.items)
        cursor = resp.next_cursor
        if cursor is None:
            break
    return pages
```

> What's the execution-shape problem? Perf or correctness? How would you fix it?

<details>
<summary>Answer</summary>

**Second trap snippet — this serial `await`-in-a-loop is *correct and unavoidable*; there is no parallel version.** The lesson, again: read the dependency, not the shape.

This looks like Snippet 1 (sequential awaits, "should parallelize"), but cursor pagination is **inherently sequential**: you cannot request page *N+1* until page *N*'s response gives you `next_cursor`. Each iteration's input (`cursor`) is the previous iteration's output. There is no list of pages to `gather` over — you don't even know how many pages exist until you reach the last one. Trying to parallelize is impossible, not merely unwise.

So the loop is the right shape. The only legitimate optimizations are orthogonal to concurrency:
- **Prefetch depth** *if* the API also exposes offset/limit access (then you could fan out by offset) — but with opaque cursors you can't.
- **Stream instead of accumulate** — if the caller can process pages incrementally, yield them so you don't hold every page in memory at once:

```python
async def iter_pages(client, endpoint):
    cursor = None
    while True:
        resp = await client.get(endpoint, cursor=cursor)
        yield resp.items                 # caller consumes as it goes
        cursor = resp.next_cursor
        if cursor is None:
            break
```

**Lesson:** cursor/continuation-token loops, dependent multi-step workflows, and "use the previous result to compute the next request" are all legitimately sequential. The serial `await` is the *only* correct shape — flag it as a perf problem and you'd be wrong. (Contrast with Snippet 1, where the calls were truly independent.)

</details>

---

## Snippet 14 — The reduce that lost its order

```javascript
// JS — apply a sequence of async migrations to a document, in order
async function migrate(doc, steps) {
  const results = steps.map((step) => step.apply(doc));   // kicks them all off now
  const applied = await Promise.all(results);
  return applied[applied.length - 1];                     // "the final state"
}
// each step.apply mutates and returns the doc; steps MUST run in declared order
```

> What's the execution-shape problem? Perf or correctness? How would you fix it?

<details>
<summary>Answer</summary>

**`Promise.all` used to parallelize work that must be *sequential* — order-dependent steps run concurrently and race. A correctness bug, and a nasty one because `Promise.all` *preserves result order* even though it does **not** preserve *execution* order.**

The comment is the key: each `step.apply(doc)` **mutates the shared `doc`** and the steps **must run in declared order** (migration 2 assumes migration 1 already ran). But `steps.map((step) => step.apply(doc))` invokes every step **synchronously, right now** — all of them start before any awaits — and `Promise.all` lets them interleave on the event loop in whatever order their internal awaits resolve. They all mutate the same `doc` concurrently, so:
- Migrations race: step 3 may observe `doc` before step 1's async mutation lands, producing a corrupted final state.
- The trap: `Promise.all([p0, p1, p2])` resolves to results **in array order**, so `applied[last]` *looks* like "the last step's result" — but the actual mutations happened in a nondeterministic order. The ordered *result array* masks the unordered *execution*.

This is the inverse of the perf anti-pattern: here the iterations are **dependent**, so parallelizing them is the bug (cf. the traps in Snippets 7 and 13).

**Fix — run dependent steps sequentially. A `for...of` loop or an awaited reduce expresses "each step sees the previous step's result":**

```javascript
async function migrate(doc, steps) {
  let state = doc;
  for (const step of steps) {
    state = await step.apply(state);   // step N+1 starts only after step N resolves
  }
  return state;
}
```

Each `await` enforces the ordering the migrations require. **Rule:** `Promise.all` is for *independent* work; the moment one item depends on another's completed side effect, you need a sequential loop — the ordered result array of `Promise.all` will otherwise lull you into thinking it ran in order.

</details>

---

## Summary — reading the execution shape

Execution-shape bugs don't announce themselves on a single line; you catch them by asking the right question about the *shape* of the async flow:

- **"Are these iterations independent?"** — the master question. If yes and they run sequentially (`await` in a loop / straight-line awaits), it's a **perf bug**: serialize → parallelize with `Promise.all` / `asyncio.gather` (Snippets 1, 3). If **no** — each step needs the previous result, or order/fail-fast/rate-limiting is part of the contract — sequential is **correct**, and parallelizing it is the bug (the traps: Snippets 7, 13, 14).
- **"Did anything actually `await` this loop?"** — `array.forEach(async …)` and a discarded `array.map(async …)` are **fire-and-forget in disguise**: the function returns before the work finishes, reporting success/zero while writes are still pending, and rejections become unhandled (Snippets 2, 11). `forEach` + `async` is essentially always a bug.
- **"Is this `.map(async …)` result used?"** — if so, there must be an `await Promise.all` around it, or you've returned an array of *pending Promises* and every field access is `undefined` (Snippet 3).
- **"Is this `Promise.all` / `gather` bounded?"** — fanning out over a huge list opens unbounded connections and OOMs or exhausts the pool; bound it with `p-limit`/a semaphore sized to the *downstream* capacity. Also remember `gather`/`Promise.all` is **all-or-nothing** on the first rejection unless you opt into `return_exceptions` / `allSettled` (Snippets 4, 9).
- **"Does the callback fire exactly once?"** — hand-rolled callback control flow and hand-promisified APIs leak missing `return`s, so the callback (or `resolve`/`reject`) runs **twice, or never, or with both an error and a value**. Promisify once at the boundary and stay in one model (Snippets 5, 12).
- **"Does this API speak one async dialect?"** — an API that takes a callback *and* returns a Promise, or that calls back synchronously on a cache hit and asynchronously on a miss (**Zalgo**), forces callers into inconsistent timing. Cache the *promise*, return one channel (Snippet 8).
- **"Does each `.then` return the value the next step needs?"** — in a Promise chain the return value is the only channel between steps; a block-bodied `.then` that forgets to `return` feeds `undefined` downstream and may persist garbage (Snippets 6, 10). `async/await` removes the plumbing — and the bug class — entirely.

The meta-lesson mirrors the structural file's: **the shape lies.** Code that reads parallel can run serial (slow), code that reads sequential can run concurrent (racy), and a loop that *looks* like a careless serial fetch may be the only correct ordering there is. Reach for `Promise.all` when iterations are independent; reach for a `for...of` loop when they aren't — and let the question, not the visual shape, decide.

---

## Related Topics

- [`tasks.md`](tasks.md) — async programs to fix, building the same muscle from the writing side.
- [Error-Handling Async Anti-Patterns](../01-error-handling/find-bug.md) — swallowed rejections and floating promises, the sibling find-bug file (the missing `.catch()` several snippets here also exhibit).
- [Misuse Async Anti-Patterns](../03-misuse/find-bug.md) — `async` without `await`, the Promise constructor anti-pattern.
- [Concurrency Anti-Patterns](../../03-concurrency/README.md) — the multi-thread sibling chapter: real memory races vs. these event-loop shapes.
- [Clean Code → Functions](../../../clean-code/02-functions/README.md) — small, single-purpose functions that make async shape obvious.
- [Refactoring → Code Smells](../../../refactoring/01-code-smells/README.md) — the smell-level view of nested and tangled flow.
- [Backend / Distributed Systems](../../../../../Backend/distributed-systems/README.md) — fan-out, retry, and timeout patterns at the network layer (the positive side of bounded concurrency).
