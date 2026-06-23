# Async Misuse Anti-Patterns — Find the Bug

> **Category:** [Async Anti-Patterns](../README.md) → **Misuse** — *async machinery applied where it doesn't help, or applied wrong.*
> **Covers (collectively):** Promise Constructor Anti-Pattern · `async` Without `await`

---

This file is **critical-reading practice**. Each snippet is a plausible chunk of real-world JavaScript / TypeScript or Python `asyncio` code. Your job is to read it the way a careful reviewer does and answer three questions:

> **What's the misuse? What's the concrete bug — lost error, hang, double-resolve, or just a pointless hop? How would you fix it?**

These two anti-patterns share a deceptive quality: the code usually *runs* and often *passes the happy-path test*. The damage shows up only when something rejects, throws, or fires twice — i.e. exactly when you most need the error to surface. A wrapped Promise that drops its rejection looks identical to a correct one until the inner call fails. An `async` Promise executor looks like defensive code until a `throw` turns into a hang that no `try/catch` can catch. A pointless `async` is harmless until a caller trusts the `await` to mean "the work finished."

> **How to use this file:** read each snippet, decide *lost error / hang / double-resolve / no-op*, and write your fix *before* expanding the answer. The skill is noticing the misuse, not recalling the name. **Not every snippet is guilty** — one is the correct, idiomatic way to bridge a callback API and only *looks* like the anti-pattern.

---

## Table of Contents

1. [The wrapper that forwards the value](#snippet-1--the-wrapper-that-forwards-the-value)
2. [Defensive async around an await](#snippet-2--defensive-async-around-an-await)
3. [Promisifying readFile by hand](#snippet-3--promisifying-readfile-by-hand)
4. [The validator that returns a Promise](#snippet-4--the-validator-that-returns-a-promise)
5. [A delay helper](#snippet-5--a-delay-helper)
6. [Fetch with a timeout](#snippet-6--fetch-with-a-timeout)
7. [Waiting for an image to load](#snippet-7--waiting-for-an-image-to-load)
8. [The cache that wraps a lookup](#snippet-8--the-cache-that-wraps-a-lookup)
9. [An asyncio coroutine that wraps a future](#snippet-9--an-asyncio-coroutine-that-wraps-a-future)
10. [The retry helper](#snippet-10--the-retry-helper)
11. [Config loader, now async](#snippet-11--config-loader-now-async)
12. [Draining a stream into a string](#snippet-12--draining-a-stream-into-a-string)
13. [The map that became async](#snippet-13--the-map-that-became-async)
14. [Bridging an EventEmitter once](#snippet-14--bridging-an-eventemitter-once)
15. [The Python sleep wrapper](#snippet-15--the-python-sleep-wrapper)

---

## Snippet 1 — The wrapper that forwards the value

```js
// JS — a thin wrapper added "to normalize the return shape"
function fetchUser(id) {
  return new Promise((resolve) => {
    api.get(`/users/${id}`).then((res) => {
      resolve(res.data);
    });
  });
}

// caller
try {
  const user = await fetchUser(42);
  render(user);
} catch (err) {
  showError(err);   // why does this never fire when the API 500s?
}
```

> What's the misuse? What's the concrete bug? How would you fix it?

<details>
<summary>Answer</summary>

**Promise Constructor Anti-Pattern, with a dropped rejection — a real correctness bug.**

`api.get(...)` already returns a Promise. Wrapping it in `new Promise((resolve) => ...)` adds nothing *and* introduces a defect: the executor only wires up `resolve`. There is **no `reject`**, and the inner `.then()` has **no `.catch()`**. When `api.get` rejects (network error, 500), the inner Promise rejects with nobody listening — but the **outer** Promise returned by `fetchUser` *never settles*. So `await fetchUser(42)` hangs forever, and the `catch (err)` block the caller wrote can never run. The error is lost and the request silently stalls.

(Depending on the runtime you also get an `unhandledRejection` event from the orphaned inner Promise — the only trace that anything went wrong.)

**Fix — return the Promise directly. The transform is just a `.then`:**

```js
function fetchUser(id) {
  return api.get(`/users/${id}`).then((res) => res.data);
}
// or, clearer:
async function fetchUser(id) {
  const res = await api.get(`/users/${id}`);
  return res.data;
}
```

Now a rejection propagates to the caller's `catch`, exactly as intended. **Rule:** never wrap an existing Promise in `new Promise`.

</details>

---

## Snippet 2 — Defensive async around an await

```js
// JS — "make sure we always settle, even on error" wrapper around a flaky DB call
function loadProfile(id) {
  return new Promise(async (resolve, reject) => {
    const conn = await pool.acquire();
    const row = await conn.query("SELECT * FROM profiles WHERE id = $1", [id]);
    if (!row) {
      throw new Error("profile not found");   // we expect this to reject the promise
    }
    resolve(row);
    pool.release(conn);
  });
}
```

> What's the misuse? What's the concrete bug? How would you fix it?

<details>
<summary>Answer</summary>

**The `async` Promise executor anti-pattern — the most dangerous form. It produces a hang on error and a connection leak.**

The executor passed to `new Promise` is declared `async`. That is almost always a mistake. The Promise constructor **ignores the value (and the rejection) returned by its executor**. So when the executor throws — here, the `throw new Error("profile not found")` — that error becomes the rejection of the *executor's own returned promise*, which `new Promise` discards. The outer `loadProfile` Promise is **never rejected and never resolved**: it hangs forever. The caller's `await` blocks indefinitely; no `try/catch` and no `.catch()` can ever see the "profile not found" error.

A second bug rides along: `pool.release(conn)` sits *after* `resolve(row)` and, more importantly, is skipped entirely on any throw (not found, query error, acquire error) — so the connection leaks. There is no `finally`.

A third subtlety: even `await pool.acquire()` rejecting would be silently swallowed the same way.

**Fix — never make the executor `async`. Use a plain `async` function with `try/finally`:**

```js
async function loadProfile(id) {
  const conn = await pool.acquire();
  try {
    const row = await conn.query("SELECT * FROM profiles WHERE id = $1", [id]);
    if (!row) throw new Error("profile not found");   // now correctly rejects
    return row;
  } finally {
    pool.release(conn);                                // always runs
  }
}
```

An `async` function *is* a Promise factory — throwing inside it rejects the returned Promise, which is precisely the behavior the original was (wrongly) reaching for. **Rule:** `new Promise(async ...)` is always wrong; `eslint`'s `no-async-promise-executor` flags it.

</details>

---

## Snippet 3 — Promisifying readFile by hand

```js
// JS — wrapping a Node callback API, no util.promisify available here
function readConfig(path) {
  return new Promise((resolve, reject) => {
    fs.readFile(path, "utf8", (err, data) => {
      if (err) reject(err);
      resolve(JSON.parse(data));
    });
  });
}
```

> What's the misuse? What's the concrete bug? How would you fix it?

<details>
<summary>Answer</summary>

**A hand-rolled callback→Promise wrapper that resolves *and* rejects on the error path — a double-settle / crash bug.** (The `new Promise` itself is *justified* here — see Snippet 14 — but the implementation is wrong.)

On error, the callback runs `reject(err)` and then **falls through** to `resolve(JSON.parse(data))`. `data` is `undefined` when `err` is set, so `JSON.parse(undefined)` throws `SyntaxError` *inside the callback*. Two things go wrong:

1. The missing `return` means the success line always executes after `reject`. (Settling twice is silently ignored by the Promise — the first settle wins — but the *code* after it still runs.)
2. `JSON.parse(undefined)` throwing synchronously in the callback is an exception with **no Promise boundary to catch it**: the callback is invoked by `fs` on a later tick, so the throw becomes an uncaught exception that can crash the process, *masking* the original `err` you tried to reject with.

So the genuine I/O error (file not found, permissions) gets eaten and replaced by a parse crash.

**Fix — `return` after `reject`, and guard the parse:**

```js
function readConfig(path) {
  return new Promise((resolve, reject) => {
    fs.readFile(path, "utf8", (err, data) => {
      if (err) return reject(err);          // return: don't fall through
      try {
        resolve(JSON.parse(data));          // parse errors reject, not crash
      } catch (e) {
        reject(e);
      }
    });
  });
}
```

Better still in modern Node: `const data = await fs.promises.readFile(path, "utf8"); return JSON.parse(data);` — let the standard library do the bridging.

</details>

---

## Snippet 4 — The validator that returns a Promise

```ts
// TS — input validation in a request pipeline
async function validateOrder(order: Order): Promise<void> {
  if (!order.items.length) throw new ValidationError("empty order");
  if (order.total <= 0) throw new ValidationError("non-positive total");
  if (order.items.some((i) => i.qty < 1)) throw new ValidationError("bad qty");
}

// caller
async function handle(req: Request) {
  validateOrder(req.order);          // throws if invalid... right?
  return submit(req.order);
}
```

> What's the misuse? What's the concrete bug? How would you fix it?

<details>
<summary>Answer</summary>

**`async` Without `await` — a pointless `async` that misleads the caller into a real bug.**

`validateOrder` contains no `await`: it is purely synchronous work. Marking it `async` doesn't make it "safer"; it changes the *contract*. Because it's `async`, every `throw` becomes a **rejected Promise** instead of a synchronous exception. The function now returns `Promise<void>`, not `void`.

The caller wrote `validateOrder(req.order);` with no `await` — treating it as a synchronous guard. But an `async` function never throws synchronously: the call returns a (rejected) Promise that is **immediately dropped on the floor** (a Floating Promise). So validation failures do **not** stop `handle`; it proceeds straight to `submit(req.order)` with an invalid order. The "validation" is a no-op for control flow, and the rejection surfaces later as an `unhandledRejection` far from `handle`.

**Fix — drop the needless `async` so it throws synchronously and the existing call site works:**

```ts
function validateOrder(order: Order): void {       // sync; throws synchronously
  if (!order.items.length) throw new ValidationError("empty order");
  if (order.total <= 0) throw new ValidationError("non-positive total");
  if (order.items.some((i) => i.qty < 1)) throw new ValidationError("bad qty");
}
```

Now `validateOrder(req.order);` actually halts `handle` on failure. *(If you must keep it async for interface reasons, the call site must `await validateOrder(...)`.)* **Lesson:** `async` is not a free decoration — it converts throws into rejections and lulls callers into forgetting `await`.

</details>

---

## Snippet 5 — A delay helper

```js
// JS — a sleep utility used across the codebase
function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

await delay(200);
```

> What's the misuse? What's the concrete bug? How would you fix it?

<details>
<summary>Answer</summary>

**Trick snippet: this is NOT the anti-pattern. It's the canonical, correct use of `new Promise`.**

`setTimeout` is a callback-based API with no Promise of its own. There is no existing Promise being wrapped, so this isn't the Promise Constructor anti-pattern — it's exactly what the constructor is *for*: building a Promise around a non-Promise (callback/timer/event) API. There's nothing to reject (a timer doesn't fail), so omitting `reject` is correct, not a dropped error.

**The diagnostic that distinguishes this from Snippet 1:** does the body wrap an **existing Promise** (anti-pattern) or a **callback/event/timer with no Promise** (legitimate)? Here it's a timer. Leave it alone.

> Worth knowing: modern Node offers `import { setTimeout } from "node:timers/promises";` so you can write `await setTimeout(200)` — but the hand-written `delay` above is perfectly idiomatic and correct.

</details>

---

## Snippet 6 — Fetch with a timeout

```js
// JS — add a timeout to a fetch by racing two promises
function fetchWithTimeout(url, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout")), ms);
    fetch(url).then((res) => {
      resolve(res);
    });
  });
}
```

> What's the misuse? What's the concrete bug? How would you fix it?

<details>
<summary>Answer</summary>

**Promise Constructor Anti-Pattern (wrapping `fetch`'s Promise) — with a dropped rejection *and* a leaked timer.**

`fetch(url)` already returns a Promise, so wrapping it in `new Promise` is the anti-pattern. The concrete bugs:

1. **Dropped rejection:** the inner `fetch(url).then(...)` has no `.catch`, and `reject` is never wired to fetch's failure. If `fetch` rejects (DNS failure, network down, CORS), the outer Promise never rejects on that path — the *only* way it ever rejects is the timeout. So a hard network failure looks identical to a slow response: you get a misleading `"timeout"` error after `ms`, or a hang if the timer was also mishandled. The real error is lost.
2. **Leaked timer:** on success, `resolve(res)` fires but `clearTimeout(timer)` is never called. The timer keeps the event loop alive for up to `ms` and then calls `reject` on an already-resolved Promise (harmless to the Promise, but wasteful and a symptom of the missing cleanup). In Node this can delay process exit.

**Fix — `Promise.race`, which composes the two existing Promises and propagates both outcomes, with cleanup:**

```js
function fetchWithTimeout(url, ms) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return fetch(url, { signal: controller.signal })
    .finally(() => clearTimeout(timer));   // cleanup on success AND failure
}
```

`AbortController` cancels the in-flight request (not just the wrapper), `fetch`'s own rejection now propagates, and `finally` guarantees the timer is cleared. No `new Promise` needed.

</details>

---

## Snippet 7 — Waiting for an image to load

```js
// JS — preload an image before rendering a canvas
function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = (e) => reject(e);
    img.src = src;
  });
}
```

> What's the misuse? What's the concrete bug? How would you fix it?

<details>
<summary>Answer</summary>

**Trick snippet: NOT the anti-pattern — this is the correct way to bridge an event-based API.**

`Image` signals completion through `onload`/`onerror` *events*, not a Promise. There is no existing Promise to wrap, so `new Promise` is the right tool, and this implementation gets the details right: both the success path (`onload → resolve`) **and** the failure path (`onerror → reject`) are wired up, so a 404 or decode error rejects properly rather than vanishing.

Contrast with Snippet 1 and Snippet 6, which wrapped a thing that *was already a Promise* and forgot the reject path. The presence of *both* an `onload` and an `onerror` handler is the tell that the author respected the failure path. This is exactly the shape `delay` (Snippet 5) and the *fixed* version of Snippet 3 take.

> Minor nit, not a bug: setting `img.src` after attaching handlers is correct (cached images can fire `load` synchronously in some engines, so handlers must be attached first). The author ordered it right.

Leave it as is.

</details>

---

## Snippet 8 — The cache that wraps a lookup

```ts
// TS — memoizing an async lookup behind a Promise wrapper
const cache = new Map<string, Promise<User>>();

function getUser(id: string): Promise<User> {
  if (cache.has(id)) return cache.get(id)!;
  const p = new Promise<User>((resolve) => {
    db.findUser(id).then((u) => resolve(u));
  });
  cache.set(id, p);
  return p;
}
```

> What's the misuse? What's the concrete bug? How would you fix it?

<details>
<summary>Answer</summary>

**Promise Constructor Anti-Pattern, and it poisons the cache permanently on failure.**

`db.findUser(id)` already returns a Promise, so the `new Promise` wrapper is the anti-pattern. The wrapper has only a `resolve` arm — no `reject`, no `.catch` — so a rejected `db.findUser` produces an outer Promise that **never settles**.

Now combine that with the cache: the *unsettled* Promise `p` is stored in `cache` **before** the lookup resolves. If `db.findUser(id)` ever rejects (transient DB blip), the cached Promise hangs forever — and because it's cached, **every future `getUser(id)` returns the same forever-pending Promise**. One transient failure permanently bricks that id until the process restarts. The structure turned a momentary error into permanent unavailability.

**Fix — cache the real Promise directly, and evict on failure so a retry is possible:**

```ts
function getUser(id: string): Promise<User> {
  const cached = cache.get(id);
  if (cached) return cached;
  const p = db.findUser(id).catch((err) => {
    cache.delete(id);     // don't cache the failure; allow a retry
    throw err;            // still reject this caller
  });
  cache.set(id, p);
  return p;
}
```

The rejection now propagates *and* the bad entry is evicted, so the next call retries instead of inheriting a dead Promise.

</details>

---

## Snippet 9 — An asyncio coroutine that wraps a future

```python
# Python asyncio — "adapt" a low-level future-returning API into a coroutine
async def fetch_row(pool, query):
    fut = pool.execute(query)       # returns an awaitable Future
    result = None

    def on_done(f):
        nonlocal result
        result = f.result()         # may raise if the query failed

    fut.add_done_callback(on_done)
    return result
```

> What's the misuse? What's the concrete bug? How would you fix it?

<details>
<summary>Answer</summary>

**The asyncio equivalent of the Promise Constructor anti-pattern: hand-wrapping an awaitable in callback plumbing instead of `await`-ing it — and it returns garbage while swallowing errors.**

`pool.execute(query)` returns an awaitable Future. The idiomatic move is `await fut`. Instead the code attaches a done-callback and **returns immediately** without awaiting. Concrete bugs:

1. **Returns `None` every time.** `return result` runs synchronously, *before* the future completes and *before* `on_done` ever fires. `result` is still `None`. The function never actually waits for the query.
2. **Errors vanish.** If the query fails, `f.result()` raises *inside the done-callback*, where the exception has nowhere to propagate — asyncio logs it as "exception in callback" at most. The caller of `fetch_row` sees a clean `None`, never the error.

So this is both a hang-class bug's cousin (the work isn't awaited) and a lost-error bug.

**Fix — just `await` the awaitable; let exceptions propagate:**

```python
async def fetch_row(pool, query):
    return await pool.execute(query)   # waits; raises on failure
```

If the API truly only gives you a plain callback (no awaitable), bridge it with `loop.create_future()` and wire **both** `set_result` and `set_exception` — the asyncio analogue of wiring both `resolve` and `reject` (Snippet 7). But when you already have an awaitable, `await` it.

</details>

---

## Snippet 10 — The retry helper

```ts
// TS — retry an async operation a few times
function withRetry<T>(op: () => Promise<T>, attempts: number): Promise<T> {
  return new Promise(async (resolve, reject) => {
    for (let i = 0; i < attempts; i++) {
      try {
        const result = await op();
        resolve(result);
        return;
      } catch (err) {
        if (i === attempts - 1) reject(err);
        await delay(2 ** i * 100);
      }
    }
  });
}
```

> What's the misuse? What's the concrete bug? How would you fix it?

<details>
<summary>Answer</summary>

**`async` Promise executor anti-pattern — plus a logic bug that makes the last attempt sleep needlessly and (in a variant) hang.**

The executor is `async`, which is the always-wrong form (see Snippet 2). Here it doesn't *immediately* hang because `resolve`/`reject` are wired, but it is fragile and contains real bugs the structure encourages:

1. **Pointless final delay / wrong control flow.** On the last failing attempt (`i === attempts - 1`) it calls `reject(err)` but does **not** `return`, so it falls through to `await delay(...)` and sleeps `2 ** (attempts-1) * 100` ms *after already rejecting*. The caller's `catch` runs at reject time, but the executor keeps running a dangling timer — and any exception that the post-reject code might throw is silently swallowed by the `async` executor.
2. **Latent hang.** If `op()` is written to *return* a rejected sentinel instead of throwing, or if someone later removes the `if (i === attempts - 1) reject(err)` guard, the loop ends with the Promise **never settled** — the classic `async`-executor hang, with no `try/catch` able to see it.
3. Any throw *outside* the inner `try` (e.g. from `delay`) rejects the executor's own promise, which `new Promise` discards.

**Fix — make the function itself `async` (no executor at all):**

```ts
async function withRetry<T>(op: () => Promise<T>, attempts: number): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await op();                 // returning resolves the promise
    } catch (err) {
      lastErr = err;
      if (i < attempts - 1) await delay(2 ** i * 100);   // no sleep after the last try
    }
  }
  throw lastErr;                         // throwing rejects the promise
}
```

The `async` function is the Promise factory; `return` resolves, `throw` rejects, and there is no executor to swallow anything or hang.

</details>

---

## Snippet 11 — Config loader, now async

```ts
// TS — config was synchronous; a teammate "made it async to be future-proof"
async function getConfig(): Promise<Config> {
  return {
    region: process.env.REGION ?? "us-east-1",
    retries: Number(process.env.RETRIES ?? 3),
    debug: process.env.DEBUG === "1",
  };
}

// hot path, called on every request
async function buildClient() {
  const cfg = await getConfig();
  return new ApiClient(cfg);
}
```

> What's the misuse? What's the concrete bug? How would you fix it?

<details>
<summary>Answer</summary>

**`async` Without `await` — no correctness bug, but a real cost and a contagious one.**

`getConfig` does only synchronous work (reads `process.env`, builds an object) yet is marked `async`. There is no I/O, no `await`, nothing asynchronous. The `async` keyword here buys nothing and costs:

1. **A microtask hop per call.** Every `await getConfig()` schedules a microtask and yields the call stack, even though the value is available synchronously. On a hot per-request path this is pure overhead — measurable under load, and it perturbs ordering (the continuation runs *after* the current synchronous run-to-completion finishes).
2. **Contagion.** Because `getConfig` returns a Promise, `buildClient` *must* become `async` and `await` it, which forces *its* callers to `await`, and so on. One needless `async` virally infects the call graph, turning code that could be a plain synchronous expression into an async chain.
3. **Misleading contract.** A reader sees `await getConfig()` and reasonably assumes config involves I/O (a file, a remote config service) — it doesn't. The signature lies about the cost model.

**Fix — drop the `async`; return the value synchronously:**

```ts
function getConfig(): Config {
  return {
    region: process.env.REGION ?? "us-east-1",
    retries: Number(process.env.RETRIES ?? 3),
    debug: process.env.DEBUG === "1",
  };
}

function buildClient() {
  return new ApiClient(getConfig());   // no await, no microtask hop, no contagion
}
```

If config *genuinely* becomes I/O-backed later, *that* is the moment to make it async — and the type change will correctly force callers to confront the new cost. "Future-proofing" by pre-emptively going async pays the cost now for a benefit that may never arrive.

</details>

---

## Snippet 12 — Draining a stream into a string

```js
// JS — collect a Node readable stream into a single string
function readStream(stream) {
  return new Promise((resolve, reject) => {
    let data = "";
    stream.on("data", (chunk) => {
      data += chunk;
    });
    stream.on("end", () => resolve(data));
  });
}
```

> What's the misuse? What's the concrete bug? How would you fix it?

<details>
<summary>Answer</summary>

**A *legitimate* `new Promise` (bridging the event-based stream API) but with a missing `error` handler — a dropped-rejection / hang bug.**

Unlike Snippets 1/6/8, this does **not** wrap an existing Promise: a Node `Readable` emits `data`/`end`/`error` *events*, so `new Promise` is the correct bridge (like Snippet 7). The implementation, however, only wires `data` and `end`. It omits the **`error`** event.

**The bug:** if the stream emits `'error'` (socket reset, file read failure, decompression error), there is no listener inside this Promise, so the outer Promise **never rejects and never resolves** — it hangs forever, and the unhandled `'error'` event may *also* crash the process (an `EventEmitter` with no `error` listener throws). Either way the caller's `await readStream(s)` never returns a clean rejection.

**Fix — handle the `error` event (and prefer the standard helper):**

```js
function readStream(stream) {
  return new Promise((resolve, reject) => {
    let data = "";
    stream.on("data", (chunk) => { data += chunk; });
    stream.on("end", () => resolve(data));
    stream.on("error", reject);          // the missing failure arm
  });
}
```

Better, let the standard library bridge it:

```js
import { text } from "node:stream/consumers";
const data = await text(stream);          // handles end AND error for you
```

**Pattern:** when bridging an event API by hand, every terminal event needs an arm — success *and* error — or you get the same hang/lost-error you'd get from a missing `reject`.

</details>

---

## Snippet 13 — The map that became async

```ts
// TS — transform a list of ids into display labels
async function toLabel(id: number): Promise<string> {
  const prefix = id < 1000 ? "SM" : "LG";    // pure, synchronous
  return `${prefix}-${id.toString().padStart(5, "0")}`;
}

function labelsFor(ids: number[]): Promise<string>[] {
  return ids.map(toLabel);
}

// caller
const labels = labelsFor([1, 2, 3]);
console.log(labels.join(", "));   // expected "SM-00001, ..." — prints something odd
```

> What's the misuse? What's the concrete bug? How would you fix it?

<details>
<summary>Answer</summary>

**`async` Without `await` — a needless `async` whose only effect is to wrap pure values in Promises, breaking the caller.**

`toLabel` is entirely synchronous: a comparison and a template string, no `await`. Marking it `async` forces its return type to `Promise<string>`. So `labelsFor` returns `Promise<string>[]` — an **array of Promises**, not strings.

**The bug at the call site:** `labels.join(", ")` calls `.join` on an array of `Promise` objects, producing `"[object Promise], [object Promise], [object Promise]"`. The `async` decoration silently changed the data type and corrupted the output. (And if any caller `await`s the array directly with `await labelsFor(...)`, they get the array unchanged — `await` on a non-thenable array is a no-op — so the Promises are *still* unresolved. They'd need `Promise.all`.)

**Fix — `toLabel` is pure; it should not be `async`:**

```ts
function toLabel(id: number): string {                 // sync, returns a string
  const prefix = id < 1000 ? "SM" : "LG";
  return `${prefix}-${id.toString().padStart(5, "0")}`;
}

function labelsFor(ids: number[]): string[] {
  return ids.map(toLabel);                             // string[], as expected
}

const labels = labelsFor([1, 2, 3]);
console.log(labels.join(", "));                        // "SM-00001, SM-00002, SM-00003"
```

**Lesson:** `async` on a pure function isn't harmless syntax — it changes the return type from `T` to `Promise<T>`, and downstream code that expected `T` breaks (here, silently and visibly wrong rather than crashing).

</details>

---

## Snippet 14 — Bridging an EventEmitter once

```js
// JS — resolve when a worker emits its first "ready" event, reject on "error"
function waitForReady(worker) {
  return new Promise((resolve, reject) => {
    worker.once("ready", resolve);
    worker.once("error", reject);
  });
}
```

> What's the misuse? What's the concrete bug? How would you fix it?

<details>
<summary>Answer</summary>

**Trick snippet: NOT the anti-pattern — and notably better than the naive bridge, though one subtle leak remains.**

An `EventEmitter` is an event API, not a Promise, so `new Promise` is the correct bridge. Both arms are wired — `ready → resolve`, `error → reject` — and `once` (not `on`) is used, so the listeners auto-remove after firing. This is the idiomatic shape and it is *not* a Promise Constructor anti-pattern (nothing Promise-shaped is being wrapped).

**The one real subtlety (a listener leak, not a correctness bug):** the Promise can only settle once, but the *other* listener is **not** removed when the first fires. If `ready` fires, the `error` listener stays attached; if the worker later emits `error`, that handler calls `reject` on an already-resolved Promise (harmless to the Promise) but the listener lingered on the emitter the whole time. Over many short-lived bridges this leaks listeners and can trip Node's `MaxListenersExceededWarning`.

**Tightened version — clean up the sibling listener:**

```js
function waitForReady(worker) {
  return new Promise((resolve, reject) => {
    const onReady = (v) => { worker.off("error", onError); resolve(v); };
    const onError = (e) => { worker.off("ready", onReady); reject(e); };
    worker.once("ready", onReady);
    worker.once("error", onError);
  });
}
// Or simply: const { once } = require("node:events"); await once(worker, "ready");
```

**Diagnosis:** the construct is correct; the gap is *cleanup of the losing listener*, which matters for long-lived emitters. Don't reflexively flag a hand-written event bridge as the anti-pattern — check whether it wraps a Promise (bad) or an event/callback (fine).

</details>

---

## Snippet 15 — The Python sleep wrapper

```python
# Python asyncio — "rate-limit" helper that pauses, then runs the work
async def throttled(work):
    def _pause():
        time.sleep(0.5)        # wait half a second before doing the work
    _pause()
    return await work()
```

> What's the misuse? What's the concrete bug? How would you fix it?

<details>
<summary>Answer</summary>

**A misuse adjacent to `async` Without `await`: an `async` function that does its "waiting" with a *blocking* synchronous call, defeating the entire point of async.**

The function is `async` and does `await work()` — so far reasonable. But the pause uses `time.sleep(0.5)`, a **blocking** call. In asyncio, the event loop is single-threaded and cooperative: `time.sleep` blocks the **whole loop** for half a second. Every other coroutine, timer, and I/O callback is frozen during that sleep. The `async` keyword promised concurrency; the blocking sleep delivers a stalled event loop. This is the inverse failure of "pointless async" — here the async is *real* but a synchronous blocking call inside it sabotages it.

(A secondary point: wrapping `time.sleep` in a nested non-async `_pause()` function hides the blocking call from a quick reading and from linters that look for `time.sleep` directly in coroutines.)

**Fix — use the non-blocking `asyncio.sleep`, which yields to the loop:**

```python
async def throttled(work):
    await asyncio.sleep(0.5)   # yields control; the loop keeps running
    return await work()
```

If you genuinely must call blocking code from a coroutine, push it off the loop with `await asyncio.to_thread(blocking_fn)` (or `loop.run_in_executor`). **Lesson:** an `async def` is only as concurrent as its *most blocking* line — a synchronous `time.sleep`, `requests.get`, or CPU-heavy loop inside a coroutine negates the async machinery just as surely as a needless `async` adds cost for none.

</details>

---

## Summary — patterns of spotting

These two anti-patterns are quiet: the code usually runs and passes the happy-path test. You catch them by asking a small, repeatable set of questions.

- **Is `new Promise` wrapping something that's *already* a Promise?** If yes, it's the **Promise Constructor anti-pattern** — return the inner Promise (or `await` it) instead. The danger is almost always a **dropped rejection**: a wrapper with `resolve` but no `reject`/`.catch` leaves the outer Promise **forever pending** on failure (Snippets 1, 6, 8). Caching that pending Promise makes one transient error permanent (Snippet 8).
- **Is the `new Promise` executor declared `async`?** That is **always** wrong (`no-async-promise-executor`). The constructor discards the executor's return *and* its rejection, so a `throw` inside it becomes a **hang the caller can never catch** (Snippets 2, 10). Use a plain `async` function instead — it's a Promise factory where `return` resolves and `throw` rejects.
- **Is the function `async` but contains no `await`?** Then `async` is doing nothing useful and three things harmful: a wasted **microtask hop** (Snippet 11), **type contagion** that forces callers to `await` and can corrupt data (`Promise<T>` where `T` was expected — Snippet 13), and a **misleading contract** that turns synchronous throws into dropped rejections so callers forget to `await` (Snippet 4). Drop the keyword.
- **When bridging a callback / event / timer API, did you wire *every* terminal arm?** A hand-rolled bridge needs success **and** error: a missing `reject`/`error`-event arm hangs on failure (Snippet 12), and falling through after `reject` double-settles or crashes (Snippet 3). And clean up the *losing* listener to avoid leaks (Snippet 14).
- **Resist false positives.** `new Promise` around a **timer** (Snippet 5), an **image's events** (Snippet 7), or an **EventEmitter** (Snippet 14) is the *correct, idiomatic* use — there's no Promise being wrapped. The diagnostic is always: *does this wrap an existing Promise (bad) or a non-Promise async source (fine)?*
- **An `async` function is only as concurrent as its most blocking line.** A synchronous `time.sleep`/`requests.get`/CPU loop inside a coroutine stalls the whole event loop (Snippet 15) — the mirror image of pointless async.

The meta-lesson: async misuse rarely crashes on line one. It converts errors into silence (lost rejection), liveness into deadlock (the `async`-executor hang), and types into surprises (`Promise<T>` where you wanted `T`). When a Promise "never settles" or an error "never fires," look first at whether someone wrapped a Promise in a Promise, made an executor `async`, or decorated pure code with `async`.

---

## Related Topics

- [`tasks.md`](tasks.md) — write-side exercises that build the same muscles: refactor the misuse out.
- [`optimize.md`](optimize.md) — flawed async implementations to make correct (and unwrap).
- [`junior.md`](junior.md) — what each misuse looks like and why it's wrong, from scratch.
- [`middle.md`](middle.md) — when these creep in and the small countermove that reverses them.
- [`senior.md`](senior.md) — instrumenting unhandled rejections and hangs at scale.
- [`interview.md`](interview.md) — Q&A across both anti-patterns.
- [Error Handling Async Anti-Patterns](../01-error-handling/find-bug.md) — swallowed rejections and floating Promises, the sibling failure modes.
- [Execution Shape Async Anti-Patterns](../02-execution-shape/find-bug.md) — `await` in loops, Promise chains, callback/Promise mixing.
- [Concurrency Anti-Patterns](../../03-concurrency/README.md) — the multi-thread sibling chapter.
- [Clean Code → Error Handling](../../../clean-code/06-error-handling/README.md) — propagate, don't swallow.
- [Clean Code → Concurrency](../../../clean-code/11-concurrency/README.md) — the positive patterns behind correct async.
