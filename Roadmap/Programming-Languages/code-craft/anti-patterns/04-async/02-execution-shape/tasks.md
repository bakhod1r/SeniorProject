# Execution-Shape Anti-Patterns — Exercises

> **Category:** [Async Anti-Patterns](../README.md) → **Execution Shape** — *hands-on practice making async control flow run the way it reads.*
> **Covers (collectively):** `await` in a Loop · Promise Chain Hell / Callback Pyramid · Mixing Callbacks and Promises

---

These are **fix-it** exercises, not recognition quizzes. Each one gives you a problem statement, a starting snippet (mostly **JavaScript/TypeScript**, some **Python asyncio**), acceptance criteria with hints, and a collapsible solution containing correct, idiomatic code plus a note on *why it is faster or clearer* — including the **latency change**, because for execution-shape bugs the cost is almost always wall-clock time.

> **How to use this file.** Read the problem, write the fix in your editor *before* opening the solution, then compare. The "why it's better" note matters more than the diff: the goal is to internalize *when* serial is correct, *when* to fan out, and *when* fan-out must be bounded. Refer back to [`junior.md`](junior.md) for the shapes and [`middle.md`](middle.md) for the countermoves.
>
> **One rule before you start:** parallelizing dependent work is a *bug*, not a speedup. Several exercises below are traps where the correct answer is "keep it sequential." Read the data flow first.

---

## Table of Contents

| # | Exercise | Anti-pattern(s) | Lang | Difficulty |
|---|---|---|---|---|
| 1 | [Parallelize the independent fetches](#exercise-1--parallelize-the-independent-fetches) | `await` in a Loop | JS | ★ easy |
| 2 | [Keep the dependent loop sequential](#exercise-2--keep-the-dependent-loop-sequential) | `await` in a Loop (trap) | JS | ★ easy |
| 3 | [Flatten the `.then` pyramid](#exercise-3--flatten-the-then-pyramid) | Promise Chain Hell | JS | ★ easy |
| 4 | [Promisify a Node-style callback](#exercise-4--promisify-a-node-style-callback) | Mixing Callbacks & Promises | JS | ★ easy |
| 5 | [Bound the concurrency with a semaphore](#exercise-5--bound-the-concurrency-with-a-semaphore) | `await` in a Loop + overload | JS | ★★ medium |
| 6 | [Fix the function that returns *and* calls back](#exercise-6--fix-the-function-that-returns-and-calls-back) | Mixing Callbacks & Promises | JS | ★★ medium |
| 7 | [Escape the callback pyramid](#exercise-7--escape-the-callback-pyramid) | Callback Pyramid | JS | ★★ medium |
| 8 | [Batch the N+1 async query (DataLoader-style)](#exercise-8--batch-the-n1-async-query-dataloader-style) | `await` in a Loop (N+1) | JS | ★★ medium |
| 9 | [Parallelize with `asyncio.gather`](#exercise-9--parallelize-with-asynciogather) | `await` in a Loop | Python | ★★ medium |
| 10 | [Bound concurrency with an asyncio Semaphore](#exercise-10--bound-concurrency-with-an-asyncio-semaphore) | `await` in a Loop + overload | Python | ★★★ hard |
| 11 | [Stream with `for await...of` instead of buffering](#exercise-11--stream-with-for-awaitof-instead-of-buffering) | Execution shape (memory) | JS | ★★★ hard |
| 12 | [Settle all, don't fail-fast](#exercise-12--settle-all-dont-fail-fast) | `await` in a Loop + error shape | JS | ★★ medium |
| 13 | [Mini-project: fix the whole report pipeline](#exercise-13--mini-project-fix-the-whole-report-pipeline) | All three | TS | ★★★★ project |
| 14 | [Write an execution-shape review checklist](#exercise-14--write-an-execution-shape-review-checklist) | meta | — | ★★ medium |

---

## Exercise 1 — Parallelize the independent fetches

**Anti-pattern:** `await` in a Loop · **Language:** JavaScript · **Difficulty:** ★ easy

Each fetch is independent — none depends on the previous one's result — yet they run one after another. The function takes as long as the *sum* of all requests.

```js
// Each userId is fetched in series: total time ≈ N × per-request latency.
async function loadUsers(userIds) {
  const users = [];
  for (const id of userIds) {
    const res = await fetch(`/api/users/${id}`);
    users.push(await res.json());
  }
  return users;
}
```

**Acceptance criteria**
- All requests are in flight concurrently; total time ≈ the *slowest* request, not the sum.
- The returned array preserves input order (`users[i]` corresponds to `userIds[i]`).
- A rejection in any request still rejects the returned Promise (do not silently drop failures here).

**Hint:** `map` the ids to Promises and `await Promise.all(...)`. `Promise.all` preserves array order regardless of completion order.

<details>
<summary>Solution</summary>

```js
async function loadUsers(userIds) {
  return Promise.all(
    userIds.map(async (id) => {
      const res = await fetch(`/api/users/${id}`);
      return res.json();
    })
  );
}
```

**Why it's faster.** The loop *serialized* work that has no ordering dependency: with 10 ids at 100 ms each, the original took ~1000 ms. `Promise.all` starts all 10 requests in the same tick, so total time drops to ~100 ms — the latency of the slowest single request. That is a 10× wall-clock win for free. `Promise.all` also preserves order: the result array is keyed by input position, not by which response arrived first, so the ordering guarantee the loop gave you is not lost.

> **Caveat (foreshadowing Exercise 5):** `Promise.all(ids.map(...))` is *unbounded* fan-out. With 10 ids it is perfect; with 10,000 ids it fires 10,000 sockets at once and will exhaust file descriptors or get you rate-limited. Use this when N is small and known; bound it otherwise.

</details>

---

## Exercise 2 — Keep the dependent loop sequential

**Anti-pattern:** `await` in a Loop — *the trap* · **Language:** JavaScript · **Difficulty:** ★ easy

A teammate saw "`await` in a loop" and "fixed" it with `Promise.all`. But each step depends on the previous step's output. Decide whether the parallel version is correct; if not, restore the correct shape.

```js
// "Optimized" version — but is it correct?
async function applyMigrations(migrations, db) {
  await Promise.all(migrations.map((m) => db.run(m.sql)));
}

// Original:
// for (const m of migrations) { await db.run(m.sql); }
```

The migrations must run **in order** — migration 3 alters a column that migration 2 creates.

**Acceptance criteria**
- Steps execute strictly in array order; step `i+1` does not start before step `i` resolves.
- Explain *why* `Promise.all` is wrong here, not just that it is.

**Hint:** parallelism is only valid for *independent* work. Ordered, dependent steps must stay serial. The `await`-in-a-loop is the **correct** shape here.

<details>
<summary>Solution</summary>

```js
async function applyMigrations(migrations, db) {
  for (const m of migrations) {
    await db.run(m.sql); // sequential is REQUIRED — each migration depends on the last
  }
}
```

**Why the loop is correct.** `Promise.all(migrations.map(...))` dispatches every `db.run` in the same tick, so the database receives migration 3 before migration 2 has committed its column. The result is non-deterministic failure — sometimes the ordering happens to work, sometimes "column does not exist" — which is far worse than a reliable slowdown. The `await`-in-a-loop here is not an anti-pattern; it is the **only correct shape**, because the work has a hard happens-before dependency.

**The judgment that matters:** "`await` in a loop" is a *smell*, not a *bug*. Before parallelizing, ask: *does step N read anything step N−1 wrote?* If yes — DB migrations, paginated cursors, accumulators, rate-limited token refresh — keep it serial. The latency cost is the price of correctness. Only fan out when the iterations are genuinely independent (Exercise 1).

</details>

---

## Exercise 3 — Flatten the `.then` pyramid

**Anti-pattern:** Promise Chain Hell · **Language:** JavaScript · **Difficulty:** ★ easy

Each `.then` nests inside the previous one to keep earlier variables in scope. The result drifts rightward and the error handling is unclear.

```js
function getOrderTotal(orderId) {
  return fetchOrder(orderId).then((order) => {
    return fetchCustomer(order.customerId).then((customer) => {
      return fetchDiscount(customer.tier).then((discount) => {
        return applyTax(order.subtotal * (1 - discount)).then((total) => {
          return { order, customer, total };
        });
      });
    });
  });
}
```

**Acceptance criteria**
- No nested `.then` callbacks; the steps read top-to-bottom.
- All four intermediate values (`order`, `customer`, `discount`, `total`) are reachable where needed.
- Errors propagate to a single place (the caller's `catch` or a `try/catch`).

**Hint:** `async/await` lets every intermediate stay in scope as an ordinary `const`, so the nesting that existed only to preserve scope disappears.

<details>
<summary>Solution</summary>

```js
async function getOrderTotal(orderId) {
  const order = await fetchOrder(orderId);
  const customer = await fetchCustomer(order.customerId);
  const discount = await fetchDiscount(customer.tier);
  const total = await applyTax(order.subtotal * (1 - discount));
  return { order, customer, total };
}
```

**Why it's better.** The pyramid existed purely so each callback could close over the previous result. With `await`, every value is a plain `const` in one flat scope, so the nesting reason evaporates. Reading order now matches execution order, top to bottom. Errors no longer need a `.catch` per level — any rejection throws out of the `async` function and lands in the caller's single `try/catch`, so there is exactly one error path instead of four implicit ones.

**Latency note:** this refactor does **not** change speed — these four calls are genuinely dependent (`fetchCustomer` needs `order.customerId`), so they *must* be serial. This is a readability and error-handling fix, not a performance one. (Contrast with Exercise 13, where some steps in a similar-looking chain are actually independent and *can* be parallelized.)

</details>

---

## Exercise 4 — Promisify a Node-style callback

**Anti-pattern:** Mixing Callbacks & Promises · **Language:** JavaScript (Node) · **Difficulty:** ★ easy

You want to `await` a legacy function that uses the Node error-first callback convention `(err, result) => ...`. Wrap it as a Promise — correctly.

```js
// Legacy API you cannot change:
// db.lookup(key, (err, value) => { ... })

// A teammate's hand-rolled wrapper — find what's wrong, then do it right.
function lookup(key) {
  return new Promise((resolve) => {
    db.lookup(key, (err, value) => {
      resolve(value); // err is dropped on the floor!
    });
  });
}
```

**Acceptance criteria**
- An error from `db.lookup` *rejects* the Promise; it is never silently swallowed.
- A success *resolves* with the value.
- `resolve`/`reject` are each called at most once.
- Prefer the standard-library tool over hand-rolling where one exists.

**Hint:** Node ships `util.promisify` for exactly this convention. If you must hand-roll, the callback must branch on `err`.

<details>
<summary>Solution</summary>

**Preferred — use the standard library:**

```js
const { promisify } = require("node:util");

// Binds the conversion once; the result is an awaitable function.
const lookup = promisify(db.lookup.bind(db));

// usage:
const value = await lookup(key); // rejects automatically if err is truthy
```

**If you must hand-roll it, branch on `err`:**

```js
function lookup(key) {
  return new Promise((resolve, reject) => {
    db.lookup(key, (err, value) => {
      if (err) reject(err);
      else resolve(value);
    });
  });
}
```

**Why it's better.** The broken wrapper called `resolve(value)` unconditionally, so a failed lookup resolved with `undefined` — a swallowed error that surfaces as a confusing `Cannot read property of undefined` three calls downstream. The fix routes `err` to `reject`, so failures propagate to the caller's `try/catch` like any other async error. `util.promisify` is the right default: it implements this exact error-first contract correctly (including the once-only guarantee), so you do not re-derive a subtle wrapper at every call site. This is the *clean boundary* between the two worlds — wrap the callback API **once**, at the edge, and let the rest of the code be pure Promises.

</details>

---

## Exercise 5 — Bound the concurrency with a semaphore

**Anti-pattern:** `await` in a Loop *over-corrected* into unbounded fan-out · **Language:** JavaScript · **Difficulty:** ★★ medium

You have 5,000 image URLs to download. The serial loop is too slow; `Promise.all(urls.map(download))` opens 5,000 sockets at once and the process dies with `EMFILE` (too many open files) or the upstream rate-limits you. You need **bounded** concurrency: at most K requests in flight.

```js
// Too slow (serial):
async function downloadAll(urls) {
  const out = [];
  for (const url of urls) out.push(await download(url));
  return out;
}

// Too aggressive (unbounded — crashes at 5,000):
// return Promise.all(urls.map(download));
```

**Acceptance criteria**
- At most `K` downloads run concurrently (e.g. `K = 8`).
- All URLs are eventually downloaded; results preserve input order.
- A single rejection rejects the whole operation (fail-fast is acceptable here).
- Solve it with a small hand-rolled limiter *and* note the library equivalent.

**Hint:** spawn `K` "workers" that pull from a shared cursor/queue, or use `p-limit`. The shared index is the simplest correct approach.

<details>
<summary>Solution</summary>

**Hand-rolled worker-pool (no dependencies):**

```js
async function downloadAll(urls, concurrency = 8) {
  const results = new Array(urls.length);
  let next = 0; // shared cursor — JS is single-threaded, so no lock needed

  async function worker() {
    while (next < urls.length) {
      const i = next++;           // claim an index atomically (single-threaded)
      results[i] = await download(urls[i]);
    }
  }

  // Start K workers; each loops until the queue is drained.
  const workers = Array.from({ length: Math.min(concurrency, urls.length) }, worker);
  await Promise.all(workers);
  return results;
}
```

**Library equivalent (`p-limit`):**

```js
import pLimit from "p-limit";

async function downloadAll(urls, concurrency = 8) {
  const limit = pLimit(concurrency);
  return Promise.all(urls.map((url) => limit(() => download(url))));
}
```

**Why it's better.** Bounded concurrency captures the win of parallelism without the blast radius. With 5,000 URLs at 200 ms each: serial ≈ 1,000 s; unbounded ≈ 200 ms *if it didn't crash* (it does — 5,000 sockets exhaust the FD limit and trip rate limits); bounded at K=8 ≈ `5000 / 8 × 200 ms ≈ 125 s` while never holding more than 8 connections. The worker-pool is correct because JavaScript is single-threaded: `next++` is a read-modify-write that cannot interleave between two workers, so no lock is needed — each worker claims a distinct index. `p-limit` packages the same idea; reach for it in production so the limiter is battle-tested. The right concurrency K is a tuning knob driven by the *downstream's* capacity (connection pool size, rate limit), not your CPU.

</details>

---

## Exercise 6 — Fix the function that returns *and* calls back

**Anti-pattern:** Mixing Callbacks & Promises · **Language:** JavaScript · **Difficulty:** ★★ medium

This function accepts a callback **and** returns a Promise. Callers can't tell which to use; some get the result twice, some get errors on neither path.

```js
// Hybrid API — half callback, half Promise. A footgun for every caller.
function loadConfig(path, callback) {
  return readFile(path) // returns a Promise
    .then((raw) => {
      const cfg = JSON.parse(raw);
      callback(null, cfg);   // also calls back
      return cfg;            // ...and resolves
    })
    .catch((err) => {
      callback(err);         // calls back with error
      // but the Promise still resolves here (no rethrow) — error swallowed on the Promise path!
    });
}
```

**Acceptance criteria**
- The function exposes **exactly one** async model. Pick Promise-based (the modern default).
- Errors propagate on that one path; nothing is delivered twice.
- If backward compatibility with old callback callers is genuinely required, show how to support both *without* the double-delivery bug.

**Hint:** pick one model. The cleanest fix is Promise-only and delete the callback parameter. The `.catch` that doesn't rethrow is also swallowing the error on the Promise path.

<details>
<summary>Solution</summary>

**Preferred — Promise-only, one path:**

```js
async function loadConfig(path) {
  const raw = await readFile(path);
  return JSON.parse(raw); // a JSON.parse throw rejects the Promise — single error path
}
```

**If a legacy callback contract must survive (adapter, not hybrid):**

```js
// Core stays Promise-only. The callback is a thin, separate shim.
async function loadConfig(path) {
  const raw = await readFile(path);
  return JSON.parse(raw);
}

function loadConfigCb(path, callback) {
  loadConfig(path).then((cfg) => callback(null, cfg), (err) => callback(err));
}
```

**Why it's better.** The hybrid version delivered every result *twice* (once via `callback`, once via the resolved Promise) and — worse — its `.catch` handled the error by calling `callback(err)` but never rethrew, so a caller using `await loadConfig(...)` saw the Promise **resolve with `undefined`** on failure: a swallowed rejection. Picking one model removes the ambiguity entirely. The Promise-only core has a single error path: a `readFile` rejection or a `JSON.parse` throw both reject the returned Promise. When a legacy callback caller truly cannot be migrated, the adapter keeps the core clean and isolates the conversion in one tiny function — the same "wrap at the boundary, once" discipline as Exercise 4. Never let one function speak both protocols.

</details>

---

## Exercise 7 — Escape the callback pyramid

**Anti-pattern:** Callback Pyramid (a.k.a. "callback hell") · **Language:** JavaScript (Node) · **Difficulty:** ★★ medium

Classic error-first callbacks nested four deep. Each level repeats the same `if (err) return cb(err)` boilerplate, and the success path marches off the right edge of the screen.

```js
function processUpload(file, cb) {
  validate(file, (err, ok) => {
    if (err) return cb(err);
    resize(file, (err, resized) => {
      if (err) return cb(err);
      upload(resized, (err, url) => {
        if (err) return cb(err);
        saveRecord(url, (err, record) => {
          if (err) return cb(err);
          cb(null, record);
        });
      });
    });
  });
}
```

**Acceptance criteria**
- The flow reads as a flat top-to-bottom sequence.
- Error handling is centralized, not repeated at every level.
- Behavior is identical: any step's error aborts the rest and surfaces once.

**Hint:** promisify each callback API (Exercise 4), then chain them with `await` inside one `try/catch`.

<details>
<summary>Solution</summary>

```js
const { promisify } = require("node:util");

const validateP = promisify(validate);
const resizeP = promisify(resize);
const uploadP = promisify(upload);
const saveRecordP = promisify(saveRecord);

async function processUpload(file) {
  await validateP(file);
  const resized = await resizeP(file);
  const url = await uploadP(resized);
  return saveRecordP(url);
}
```

**Why it's better.** The pyramid's rightward drift and its four copies of `if (err) return cb(err)` both vanish. With `await`, the success path is a flat sequence of four lines, and error handling is *implicit and centralized*: any rejection short-circuits the rest and propagates to the caller's `try/catch` — exactly the abort-on-first-error behavior the manual `return cb(err)` lines were laboriously reproducing. Promisifying each callback API at the top (per Exercise 4) is the bridge: convert at the boundary, then write ordinary sequential async code. **Latency is unchanged** — these steps are dependent (`resize` then `upload` then `saveRecord`) and stay serial; this is purely a clarity and correctness win.

</details>

---

## Exercise 8 — Batch the N+1 async query (DataLoader-style)

**Anti-pattern:** `await` in a Loop producing an N+1 query storm · **Language:** JavaScript · **Difficulty:** ★★ medium

Rendering 100 posts triggers 100 separate author lookups — one query per post. This is the async cousin of the N+1 problem: a loop of awaited single-key fetches.

```js
// 1 query for posts + 1 query PER post for its author = N+1 round trips.
async function postsWithAuthors() {
  const posts = await db.query("SELECT * FROM posts LIMIT 100");
  for (const post of posts) {
    post.author = await db.query("SELECT * FROM users WHERE id = ?", [post.authorId]);
  }
  return posts;
}
```

**Acceptance criteria**
- The author data is fetched in **one** batched query (or a small constant number), not one per post.
- Each post ends up with its correct author.
- Duplicate author ids are not fetched twice.

**Hint:** collect the unique `authorId`s, fetch them all with a single `WHERE id IN (...)`, build an id→author map, then assign. This is the core idea behind Facebook's DataLoader.

<details>
<summary>Solution</summary>

```js
async function postsWithAuthors() {
  const posts = await db.query("SELECT * FROM posts LIMIT 100");

  // 1. Collect the distinct keys.
  const ids = [...new Set(posts.map((p) => p.authorId))];

  // 2. ONE batched query instead of N.
  const authors = await db.query("SELECT * FROM users WHERE id IN (?)", [ids]);

  // 3. Index by id for O(1) assignment.
  const byId = new Map(authors.map((a) => [a.id, a]));

  // 4. Stitch — purely in-memory, no awaits.
  for (const post of posts) {
    post.author = byId.get(post.authorId);
  }
  return posts;
}
```

**Why it's faster.** The original made `1 + 100 = 101` sequential round trips; at 5 ms of network+query latency each that is ~505 ms, and the database does 100 trivial point-lookups. The batched version makes exactly **2** round trips (~10 ms) regardless of post count, and the `Set` dedup means shared authors are fetched once. The final stitch loop has *no awaits* — it is plain in-memory `Map` lookups — so it is microseconds. This is the engine inside DataLoader/`graphql` resolvers: collapse per-item fetches into one batched fetch keyed by a map. The shape lesson: a loop that awaits a single-key fetch each iteration is almost always an N+1 in disguise; hoist the fetch out of the loop and batch it.

</details>

---

## Exercise 9 — Parallelize with `asyncio.gather`

**Anti-pattern:** `await` in a Loop · **Language:** Python (asyncio) · **Difficulty:** ★★ medium

The Python equivalent of Exercise 1: independent coroutines awaited one at a time. `await` inside the `for` serializes them.

```python
import aiohttp

async def fetch_all(session, urls):
    results = []
    for url in urls:
        async with session.get(url) as resp:   # each awaited before the next starts
            results.append(await resp.json())
    return results
```

**Acceptance criteria**
- All requests run concurrently; total time ≈ the slowest request.
- Results preserve input order.
- A failing request propagates (do not silence it here).

**Hint:** wrap each request in a coroutine and pass them all to `asyncio.gather(*coros)`. `gather` preserves argument order in its result list. Note that simply building a list of coroutine *objects* does not start them — `gather` (or `create_task`) schedules them.

<details>
<summary>Solution</summary>

```python
import asyncio
import aiohttp

async def fetch_one(session, url):
    async with session.get(url) as resp:
        return await resp.json()

async def fetch_all(session, urls):
    # gather schedules all coroutines concurrently and returns results IN ORDER.
    return await asyncio.gather(*(fetch_one(session, url) for url in urls))
```

**Why it's faster.** The `for ... await` loop is Python's `await`-in-a-loop: each `session.get` fully completes before the next begins, so 10 URLs at 100 ms each take ~1000 ms. `asyncio.gather` schedules all ten coroutines on the event loop together, so total time collapses to ~100 ms — the slowest single request. `gather` returns results in the order of its arguments, not completion order, so the ordering guarantee is preserved. One subtlety unique to Python: a coroutine object does *nothing* until it is awaited or scheduled — `[fetch_one(s, u) for u in urls]` by itself just creates inert objects; it is `gather` (internally wrapping each in a Task) that actually runs them concurrently.

> By default `gather` is **fail-fast**: the first exception propagates and the rest keep running but their results are discarded. Pass `return_exceptions=True` to collect every outcome instead (the asyncio analog of `Promise.allSettled` — see Exercise 12).

</details>

---

## Exercise 10 — Bound concurrency with an asyncio Semaphore

**Anti-pattern:** `await` in a Loop over-corrected into unbounded fan-out · **Language:** Python (asyncio) · **Difficulty:** ★★★ hard

The Python version of Exercise 5. `gather` over 5,000 coroutines opens 5,000 connections at once and exhausts the system. Limit it to K concurrent requests with an `asyncio.Semaphore`.

```python
import asyncio
import aiohttp

# Too aggressive — 5,000 concurrent connections:
async def fetch_all(session, urls):
    async def fetch_one(url):
        async with session.get(url) as resp:
            return await resp.json()
    return await asyncio.gather(*(fetch_one(u) for u in urls))
```

**Acceptance criteria**
- At most `K` requests are in flight at any moment.
- All URLs are fetched; results preserve input order.
- The semaphore is released even if a request raises.

**Hint:** wrap each request's body in `async with semaphore:`. The `async with` guarantees release on exception. `gather` still preserves order.

<details>
<summary>Solution</summary>

```python
import asyncio
import aiohttp

async def fetch_all(session, urls, concurrency=8):
    sem = asyncio.Semaphore(concurrency)

    async def fetch_one(url):
        async with sem:                       # blocks once K are in flight; auto-released
            async with session.get(url) as resp:
                return await resp.json()

    # gather still preserves order; the semaphore caps concurrency inside each coroutine.
    return await asyncio.gather(*(fetch_one(u) for u in urls))
```

**Why it's better.** `asyncio.Semaphore(K)` is a counter of K permits: `async with sem` acquires one on entry and releases it on exit — including when an exception unwinds, because `async with` runs `__aexit__` on the error path. So although `gather` *schedules* all 5,000 coroutines immediately, only K of them can be past the `async with sem` line and actually hitting the network at any instant; the rest are parked, cheaply, on the semaphore. With 5,000 URLs at 200 ms and K=8: ~`5000/8 × 200 ms ≈ 125 s`, never more than 8 live connections — versus the unbounded version that crashes. As in Exercise 5, K is dictated by the downstream's capacity (server rate limit, connection pool), not your machine. This is the idiomatic asyncio bounded-fan-out and the structured-concurrency-friendly way to throttle.

</details>

---

## Exercise 11 — Stream with `for await...of` instead of buffering

**Anti-pattern:** wrong execution shape for unbounded data (buffer-the-world) · **Language:** JavaScript · **Difficulty:** ★★★ hard

This function pulls *every* page of a paginated API into memory before returning. For a large dataset it blows up memory and the caller waits for the last page before seeing the first row. Turn it into an async iterator that yields rows as they arrive.

```js
// Buffers ALL pages in memory, returns only after the final page.
async function fetchAllRows(api) {
  const all = [];
  let cursor = null;
  do {
    const page = await api.getPage(cursor); // { rows, nextCursor }
    all.push(...page.rows);
    cursor = page.nextCursor;
  } while (cursor);
  return all; // caller blocks until everything is loaded
}
```

**Acceptance criteria**
- Expose an async iterator (`async function*`) the caller consumes with `for await...of`.
- Memory holds at most one page at a time, not the whole dataset.
- The caller can start processing the first page before the last is fetched, and can `break` early.

**Hint:** `async function*` + `yield` turns the pull loop into a stream. The page fetch stays sequential (you need each `nextCursor` from the previous page — a genuine dependency, as in Exercise 2), but consumption is now incremental.

<details>
<summary>Solution</summary>

```js
async function* fetchRows(api) {
  let cursor = null;
  do {
    const page = await api.getPage(cursor);
    yield* page.rows;          // stream this page's rows out one at a time
    cursor = page.nextCursor;
  } while (cursor);
}

// Caller — processes incrementally, holds one page max, can stop early:
for await (const row of fetchRows(api)) {
  process(row);
  if (shouldStop(row)) break;  // generator's finally/return stops further fetching
}
```

**Why it's better.** The original held the entire dataset in `all` — for a million-row export that is a memory blow-up and an OOM crash. The async generator yields rows as each page arrives, so heap usage is bounded to a single page regardless of total size. Latency-to-first-row drops from "time to fetch *all* pages" to "time to fetch the *first* page," which matters for responsiveness and for pipelines that can begin work immediately. Crucially, `break` in the `for await...of` triggers the generator's cleanup and *stops fetching further pages* — the buffer-everything version had already paid for all of them. The page fetch itself stays sequential because each request depends on the previous `nextCursor` (the correct call from Exercise 2's judgment); only the *consumption* shape changed, from "buffer then return" to "stream as you go."

</details>

---

## Exercise 12 — Settle all, don't fail-fast

**Anti-pattern:** `await` in a Loop with the wrong error shape · **Language:** JavaScript · **Difficulty:** ★★ medium

You sync 50 accounts. The current serial loop stops at the first failure, leaving the rest unsynced — and you want them all attempted, with a report of which failed. The naive `Promise.all` fix is *also* wrong: it rejects on the first failure and discards the successful results.

```js
// Stops at the first error; accounts after the failure never sync.
async function syncAll(accounts) {
  for (const acc of accounts) {
    await syncOne(acc); // one throw aborts the whole batch
  }
}
```

**Acceptance criteria**
- Every account is attempted regardless of others failing.
- The result reports, per account, whether it succeeded (and with what) or failed (and why).
- Successes are not thrown away because a sibling failed.

**Hint:** `Promise.all` is fail-fast — wrong here. `Promise.allSettled` runs everything and returns a `{status, value | reason}` per input. Combine with `map` for concurrency.

<details>
<summary>Solution</summary>

```js
async function syncAll(accounts) {
  const settled = await Promise.allSettled(accounts.map((acc) => syncOne(acc)));

  return settled.map((result, i) => ({
    account: accounts[i].id,
    ok: result.status === "fulfilled",
    value: result.status === "fulfilled" ? result.value : undefined,
    error: result.status === "rejected" ? result.reason.message : undefined,
  }));
}
```

**Why it's better.** Two bugs are fixed at once. The serial loop was fail-fast *and* slow: one bad account aborted the remaining 49, and they ran in series (~50× one sync). `Promise.all` would parallelize but is *also* fail-fast — the first rejection abandons every other result, even the ones that already succeeded. `Promise.allSettled` is the right shape for "attempt everything, report each outcome": it never rejects, it waits for all inputs, and it returns a discriminated `{status: "fulfilled", value}` / `{status: "rejected", reason}` per input. You get full parallelism (~1× the slowest sync) *and* a complete per-account report, so a partial outage downgrades to "47 synced, 3 failed with reasons" instead of "everything stopped at account 4." Choose the combinator by the error semantics you need: `all` for all-or-nothing, `allSettled` for best-effort-with-report, `race`/`any` for first-wins.

</details>

---

## Exercise 13 — Mini-project: fix the whole report pipeline

**Anti-pattern:** all three, in one realistic handler · **Language:** TypeScript · **Difficulty:** ★★★★ project

Below is a report endpoint that manages to combine **every** execution-shape anti-pattern: a `.then` pyramid, a serial loop over independent fetches, an N+1 query, *and* a hand-rolled callback wrapper that swallows errors. Refactor it into clean, correctly-shaped async code. Work in steps; keep behavior identical at each one.

```ts
// Legacy callback API for the audit log:
// auditLog.record(event, (err) => { ... })

function buildReport(orgId: string, cb: (err: Error | null, report?: Report) => void) {
  fetchOrg(orgId).then((org) => {
    fetchTeams(org.id).then(async (teams) => {
      // serial loop over INDEPENDENT team-stats fetches
      const stats = [];
      for (const team of teams) {
        stats.push(await fetchStats(team.id));
      }
      // N+1: one member lookup per team
      for (const team of teams) {
        team.members = await fetchMembers(team.id); // single-key fetch in a loop
      }
      // hand-rolled callback wrapper that drops the error
      auditLog.record({ type: "report", orgId }, () => {
        cb(null, { org, teams, stats });
      });
    });
  });
  // note: no .catch anywhere — fetchOrg/fetchTeams rejections vanish
}
```

Assume `fetchStats(teamId)` and `fetchMembers(teamId)` are independent across teams, and `fetchMembers` supports a batched `fetchMembersBatch(teamIds[])`.

**Acceptance criteria**
- **Promise Chain Hell:** the `.then` pyramid becomes flat `async/await`.
- **`await` in a Loop:** the independent `fetchStats` calls run concurrently (bounded if the team count can be large).
- **N+1:** the per-team member lookups collapse into one batched `fetchMembersBatch`.
- **Mixing callbacks & Promises:** the function exposes one model (Promise) and the audit-log callback is promisified at the boundary; its error is no longer swallowed.
- Errors from any step propagate (no missing `.catch`).

**Hint:** fix one anti-pattern per step — flatten the chain, promisify the audit log, batch the members, parallelize the stats — keeping it green after each.

<details>
<summary>Solution</summary>

```ts
import { promisify } from "node:util";

// 1. Promisify the callback API ONCE, at the boundary (Exercises 4 & 6).
const recordAudit = promisify(auditLog.record.bind(auditLog));

// 2. Promise-only signature — no callback parameter, single error path.
async function buildReport(orgId: string): Promise<Report> {
  // 3. Flat async/await replaces the .then pyramid (Exercise 3).
  const org = await fetchOrg(orgId);
  const teams = await fetchTeams(org.id);

  // 4. Independent per-team stats run concurrently, not serially (Exercise 1).
  //    For a small, known team count, unbounded Promise.all is fine;
  //    bound it (Exercise 5) if a team count can be large.
  const statsPromise = Promise.all(teams.map((t) => fetchStats(t.id)));

  // 5. N+1 member lookups collapse into one batched query (Exercise 8).
  const teamIds = teams.map((t) => t.id);
  const membersByTeam = await fetchMembersBatch(teamIds); // Map<teamId, Member[]>

  const stats = await statsPromise; // started above; now collect

  for (const team of teams) {
    team.members = membersByTeam.get(team.id) ?? []; // in-memory stitch, no awaits
  }

  // 6. Audit error is no longer swallowed — a rejection propagates out.
  await recordAudit({ type: "report", orgId });

  return { org, teams, stats };
}
```

**What happened to each anti-pattern:**

- **Promise Chain Hell →** the nested `.then(org => .then(teams => ...))` is a flat sequence of `await`s; `org` and `teams` are plain `const`s.
- **`await` in a Loop →** `fetchStats` over independent teams became `Promise.all(teams.map(...))`. Even better, `statsPromise` is *kicked off before* the member batch and awaited after, so stats and members fetch overlap.
- **N+1 →** the per-team `fetchMembers` loop became one `fetchMembersBatch(teamIds)` plus an in-memory `Map` stitch with no awaits.
- **Mixing callbacks & Promises →** the function dropped its `cb` parameter for a `Promise<Report>` return; the audit-log callback is promisified once at the boundary and its error now propagates (the original ignored it).
- **Missing error handling →** there is no longer a silent gap: any rejection (`fetchOrg`, `fetchTeams`, stats, members, or audit) rejects the returned Promise and reaches the caller's `try/catch`.

**Latency note.** Suppose 20 teams, each fetch ~50 ms. Original: `fetchOrg (50) + fetchTeams (50) + 20×fetchStats serial (1000) + 20×fetchMembers serial (1000) + audit (50) ≈ 2150 ms`. Refactored: `fetchOrg (50) + fetchTeams (50) + max(stats parallel ≈ 50, membersBatch ≈ 50) + audit (50) ≈ 200 ms` — a ~10× improvement, driven mostly by killing the N+1 and parallelizing the independent stats. The dependent steps (`org → teams`) correctly stay serial.

</details>

---

## Exercise 14 — Write an execution-shape review checklist

**Anti-pattern:** meta (prevention) · **Difficulty:** ★★ medium

Execution-shape bugs are cheapest to catch in code review, because they are visible in the *shape* of the diff before they ever run. Write a concise, actionable reviewer checklist — phrased as questions with a clear "if yes, push back" trigger — that catches all three anti-patterns plus the over-correction traps.

**Acceptance criteria**
- One or more concrete, answerable questions per anti-pattern, including the "don't parallelize dependent work" and "don't fan out unbounded" traps.
- Each question has a failure trigger and a suggested action.
- Short enough to run on every PR.

<details>
<summary>Solution</summary>

**Execution-shape PR review checklist**

| # | Question | If the answer is… | Then |
|---|---|---|---|
| 1 | Is there an `await` inside a `for`/`while` loop? | "Yes" | Ask the next two questions before approving. **`await` in a Loop**. |
| 2 | Does iteration N depend on iteration N−1's result (cursor, accumulator, ordered writes)? | "Yes" | **Keep it serial** — the loop is correct. Do not "fix" it. (Exercise 2.) |
| 3 | …if independent, are the iterations parallelized? | "No, still serial" | Push back: `Promise.all` / `asyncio.gather`. Note the latency win. (Exercises 1, 9.) |
| 4 | Is a fan-out (`Promise.all` / `gather`) over a list whose size is unbounded or user-controlled? | "Yes" | Push back: bound it with `p-limit` / `Semaphore`. (Exercises 5, 10.) |
| 5 | Does a loop `await` a *single-key* fetch each iteration (one query per item)? | "Yes" | Push back: batch it (`WHERE id IN (...)` / DataLoader). **N+1**. (Exercise 8.) |
| 6 | Are `.then` callbacks nested more than one level to keep earlier vars in scope? | "Yes" | Push back: flatten to `async/await`. **Promise Chain Hell**. (Exercise 3.) |
| 7 | Does a function both take a callback **and** return a Promise/`await`? | "Yes" | Push back: pick one model; promisify at the boundary. **Mixing**. (Exercises 4, 6.) |
| 8 | Does a hand-rolled `new Promise(...)` callback wrapper branch on `err` and call settle once? | "No / not sure" | Push back: use `util.promisify`, or add the `if (err) reject`. (Exercise 4.) |
| 9 | If a batch should attempt all items and report failures, does it use `all` (fail-fast)? | "Yes" | Push back: `Promise.allSettled` / `gather(return_exceptions=True)`. (Exercise 12.) |
| 10 | Does a function buffer an unbounded/paginated dataset fully into an array before returning? | "Yes" | Consider an async iterator (`for await...of`) to stream. (Exercise 11.) |

**Why this beats "review for async correctness."** Each row has a *trigger* and an *action*, and questions 1→3 encode the single most important judgment in this whole category: an `await` in a loop is a *prompt to check dependency*, not an automatic bug. The checklist forces the reviewer to ask "independent or dependent?" before either parallelizing (and breaking ordering) or leaving an easy 10× win on the table — and questions 4 and 9 stop the two classic over-corrections (unbounded fan-out, fail-fast where best-effort was wanted).

</details>

---

## Summary

- **`await` in a loop is a smell, not a verdict.** The first question is always *independent or dependent?* Independent iterations should fan out (`Promise.all`, `asyncio.gather`) for an order-of-magnitude latency win; dependent ones (migrations, cursors, accumulators) must stay serial — parallelizing them is a correctness bug, not a speedup (Exercises 1, 2, 9, 11).
- **Fan-out must usually be bounded.** Unbounded `Promise.all`/`gather` over a large or user-controlled list exhausts sockets and trips rate limits. A worker-pool, `p-limit`, or `asyncio.Semaphore` caps concurrency at K — driven by the *downstream's* capacity, not your CPU (Exercises 5, 10).
- **Batch the N+1.** A loop that awaits a single-key fetch each iteration is an N+1 in disguise; hoist it into one batched query and stitch in memory with a `Map` (Exercises 8, 13).
- **Flatten chains and pick one async model.** `.then` pyramids and callback hell both collapse into flat `async/await`; a function must never speak both callback and Promise — promisify the legacy API once, at the boundary, and never swallow the `err` (Exercises 3, 4, 6, 7).
- **Choose the combinator by error semantics.** `all` for all-or-nothing, `allSettled`/`gather(return_exceptions=True)` for attempt-all-and-report, streaming iterators for unbounded data (Exercises 11, 12).
- The three shapes travel together — a real handler (Exercise 13) shows all of them at once. Read the data flow first; the correct shape follows from the dependencies.

---

## Related Topics

- [`junior.md`](junior.md) — the three execution-shape anti-patterns and how to recognize them on sight.
- [`middle.md`](middle.md) — the forces behind accidental serialization and the countermoves used here.
- [`find-bug.md`](find-bug.md) — spot-the-async-bug snippets (critical reading practice).
- [`optimize.md`](optimize.md) — more implementations to make correct *and* parallel.
- [`interview.md`](interview.md) — Q&A across all levels for job prep.
- [Error Handling Anti-Patterns](../01-error-handling/junior.md) — the sibling category: swallowed rejections, floating Promises, forgotten `await`.
- [Async Anti-Patterns (chapter)](../README.md) — the Misuse category (Promise constructor anti-pattern, `async` without `await`) lives here too.
- [Concurrency Anti-Patterns](../../03-concurrency/README.md) — the multi-thread sibling chapter (locks, races, deadlocks).
- [Refactoring → Refactoring Techniques](../../../refactoring/02-refactoring-techniques/README.md) — replacing callbacks with composable async steps.
