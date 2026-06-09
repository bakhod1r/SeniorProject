# Async Misuse Anti-Patterns — Refactoring Practice

> **Category:** [Async Anti-Patterns](../README.md) → **Misuse** — *async machinery bolted onto code that doesn't need it (and quietly loses errors when it does).*
> **Covers (collectively):** Promise Constructor Anti-Pattern · `async` Without `await`

---

These are not "spot the smell" puzzles — [`find-bug.md`](find-bug.md) does that. Here the code **works today** but misuses async primitives: it wraps an existing Promise in `new Promise` for no reason, marks functions `async` that never `await`, or hand-rolls a callback-to-Promise bridge that swallows errors on a corner. Your job is to **transform it into correct, idiomatic code without changing observable behavior** — with one non-negotiable extra constraint that plain refactoring doesn't have:

> **Errors MUST propagate.** The whole danger of these two anti-patterns is that they *look* fine on the happy path and silently drop rejections on the sad path. A refactor that "reads cleaner" but changes which errors reach the caller has changed behavior. The test you write first is an **error-path test** — it asserts the promise *rejects* with the right reason, or that a sync throw still surfaces.

The discipline is identical to structural refactoring, retargeted at async semantics:

1. **Pin behavior first — including the error path.** Write a characterization test that asserts *both* the resolved value *and* the rejection. `await expect(fn()).rejects.toThrow(...)` is as important as the success assertion.
2. **Take small, reversible steps.** One named move at a time (Return the Inner Promise, Drop `async`, Promisify the Callback), tests green after each.
3. **Know the legitimate cases.** `new Promise` is *correct* when bridging a non-Promise API (events, callbacks, timers). `async` is *correct* when you must normalize a sometimes-sync, sometimes-throwing API into "always a rejected/resolved Promise." Several exercises below are **counter-cases you KEEP** — recognizing them is half the skill.

> **How to use this file:** read the "Before," predict (a) what breaks on the error path and (b) the move sequence *yourself*, then expand the solution. The gap between your prediction and the worked answer is the lesson.

---

## Table of Contents

| # | Exercise | Anti-pattern | Lang | Key move |
|---|---|---|---|---|
| 1 | [Unwrap the needless `new Promise`](#exercise-1--unwrap-the-needless-new-promise) | Promise Constructor | JS | Return the Inner Promise |
| 2 | [Drop `async` from a pure function](#exercise-2--drop-async-from-a-pure-function) | `async` w/o `await` | TS | Remove `async` |
| 3 | [The wrapper that eats rejections](#exercise-3--the-wrapper-that-eats-rejections) | Promise Constructor | JS | Return the Inner Promise (prove rejection) |
| 4 | [Fix the `async` Promise executor](#exercise-4--fix-the-async-promise-executor) | Promise Constructor | JS | Remove `async` from the executor |
| 5 | [`async` with no `await`, but it `try/catch`es](#exercise-5--async-with-no-await-but-it-trycatches) | `async` w/o `await` | TS | Remove `async`, keep error semantics |
| 6 | [Promisify a Node callback by hand](#exercise-6--promisify-a-node-callback-by-hand) | Promise Constructor | JS | Replace with `util.promisify` |
| 7 | [KEEP the `new Promise` — event bridge](#exercise-7--keep-the-new-promise--event-bridge) | Counter-case | JS | Correct bridge: resolve + reject + cleanup |
| 8 | [KEEP `async` — normalize a sometimes-sync API](#exercise-8--keep-async--normalize-a-sometimes-sync-api) | Counter-case | TS | Keep `async` to coerce throws into rejections |
| 9 | [`Promise.resolve().then` ceremony](#exercise-9--promiseresolvethen-ceremony) | Promise Constructor | JS | Return the Inner Promise / drop ceremony |
| 10 | [Build a correct timeout wrapper](#exercise-10--build-a-correct-timeout-wrapper) | Promise Constructor (legit) | TS | Bridge timer correctly + clean up |
| 11 | [Build a cancellation wrapper (AbortSignal)](#exercise-11--build-a-cancellation-wrapper-abortsignal) | Promise Constructor (legit) | TS | Bridge signal + reject + unsubscribe |
| 12 | [Python: `async def` with no `await`](#exercise-12--python-async-def-with-no-await) | `async` w/o `await` | Python | Drop `async def` / keep for protocol |
| 13 | [Python: wrap an awaitable by hand](#exercise-13--python-wrap-an-awaitable-by-hand) | Promise Constructor analog | Python | Return / await the awaitable directly |

---

## Exercise 1 — Unwrap the needless `new Promise`

**Anti-pattern:** Promise Constructor. **Goal:** stop wrapping a Promise-returning call in `new Promise`. **Constraints:** same resolved value; **the rejection must still propagate** (it currently does not — that's the latent bug, so preserving behavior here means restoring the lost rejection while keeping the success path identical).

```js
// Before — fetchUser already returns a Promise; this wraps it for no reason.
function getUser(id) {
  return new Promise((resolve) => {
    fetchUser(id).then((user) => {
      resolve(user);
    });
  });
}
```

<details>
<summary>Refactored</summary>

**Move sequence**

1. **Characterize both paths.** The success test is easy; the *revealing* test is the error path:

   ```js
   test("getUser rejects when fetchUser rejects", async () => {
     fetchUser.mockRejectedValueOnce(new Error("boom"));
     await expect(getUser(1)).rejects.toThrow("boom");
   });
   ```

   Run it against the *Before* code. It **fails** (hangs to timeout): the executor only calls `resolve`; the inner rejection has no `.catch`, so the outer Promise never settles. That hang is concrete proof the wrapper is dropping errors.

2. **Return the Inner Promise.** The entire point of `new Promise` is to *create* a Promise from a non-Promise source. `fetchUser(id)` is already that Promise. Delete the wrapper and return it directly.

3. Re-run *both* tests: success unchanged, the error test now passes (the rejection flows straight through).

```js
// After — the inner Promise IS the result; errors propagate for free.
function getUser(id) {
  return fetchUser(id);
}
```

**What improved & how to verify.** One microtask hop and an entire failure mode (silently-lost rejection) are gone. **Verify** with the two-assertion test: `resolves` to the same user *and* `rejects.toThrow("boom")`. If a reviewer asks "is dropping the wrapper a behavior change?", the answer is precise: the success path is byte-identical, and the error path is corrected to what every caller already assumed.

</details>

---

## Exercise 2 — Drop `async` from a pure function

**Anti-pattern:** `async` Without `await`. **Goal:** remove `async` from a function that does only synchronous work. **Constraints:** callers `await` the result today and must keep working unchanged.

```ts
// Before — async, but there is no await anywhere; it's pure arithmetic.
async function computeDiscount(price: number, pct: number): Promise<number> {
  const factor = 1 - pct / 100;
  return Math.round(price * factor * 100) / 100;
}
```

<details>
<summary>Refactored</summary>

**Move sequence**

1. **Characterize.** A plain value test: `await computeDiscount(100, 10)` → `90`. Record the contract: callers `await` it.
2. **Decide the target signature.** Two valid options:
   - **Make it sync** (`: number`) and update callers to drop the `await`. Best when you control all call sites — it removes a needless microtask hop *and* the Promise allocation.
   - **Keep the return type `Promise<number>`** via `return Promise.resolve(...)`, dropping only the `async` keyword, when the signature is a published contract you can't break.
3. **Remove `async`.** Here we own the callers, so go fully sync.
4. Update call sites: `const d = computeDiscount(p, 10);` — `await` on a non-Promise is harmless but now misleading, so remove it.

```ts
// After (preferred — own the callers) — pure, synchronous, allocation-free.
function computeDiscount(price: number, pct: number): number {
  const factor = 1 - pct / 100;
  return Math.round(price * factor * 100) / 100;
}

// After (contract-preserving alternative — can't change the signature):
function computeDiscount(price: number, pct: number): Promise<number> {
  const factor = 1 - pct / 100;
  return Promise.resolve(Math.round(price * factor * 100) / 100);
}
```

**What improved & how to verify.** No microtask scheduling, no throwaway Promise, and the type now tells the truth (the value is available synchronously). **Verify** the value is identical for the characterized inputs. **Watch one semantic difference**: the sync version surfaces a throw *synchronously* (so callers would need `try/catch` around the call), whereas the `async` version turned throws into rejections. Since this function can't throw (pure arithmetic on numbers), the change is observationally inert here — but on a function that *can* throw, that distinction is the entire subject of Exercise 5 and the counter-case in Exercise 8.

</details>

---

## Exercise 3 — The wrapper that eats rejections

**Anti-pattern:** Promise Constructor. **Goal:** remove a wrapper that resolves but never rejects, then **prove error propagation is now correct**. **Constraints:** identical success value; rejections must reach the caller with the original reason.

```js
// Before — manual resolve, no reject handler, plus an accidental swallow.
function loadConfig(path) {
  return new Promise((resolve, reject) => {
    readFilePromise(path)
      .then((raw) => resolve(JSON.parse(raw)))
      .catch(() => resolve({}));  // "default to empty config on any error"
  });
}
```

<details>
<summary>Refactored</summary>

**Move sequence**

1. **Characterize — and disentangle two behaviors.** This wrapper does two things: (a) needlessly re-wraps a Promise, and (b) deliberately maps *every* error to `{}`. Are both intended? `git blame` the `.catch(() => resolve({}))`. Suppose the intent was *"missing file ⇒ empty config; malformed JSON ⇒ a real error."* The current code conflates them — a syntax error in the file silently yields `{}`. That's a bug hiding inside the anti-pattern.

   Error-path tests pin the *intended* contract:

   ```js
   test("missing file → empty config", async () => {
     readFilePromise.mockRejectedValueOnce(Object.assign(new Error("nope"), { code: "ENOENT" }));
     await expect(loadConfig("x")).resolves.toEqual({});
   });
   test("malformed JSON rejects", async () => {
     readFilePromise.mockResolvedValueOnce("{ not json");
     await expect(loadConfig("x")).rejects.toThrow(SyntaxError);
   });
   ```

   The second test **fails** against the *Before* code (the blanket `.catch` swallows the `SyntaxError` into `{}`).

2. **Return the Inner Promise**, dropping `new Promise`. Express the *intended* fallback narrowly with `async/await` so the JSON parse error is allowed to throw.

3. Re-run both tests; both green.

```js
// After — no wrapper; only ENOENT is defaulted, parse errors propagate.
async function loadConfig(path) {
  let raw;
  try {
    raw = await readFilePromise(path);
  } catch (err) {
    if (err.code === "ENOENT") return {};
    throw err;                       // any other read error propagates
  }
  return JSON.parse(raw);            // SyntaxError now reaches the caller
}
```

**What improved & how to verify.** The needless `new Promise` is gone *and* the error contract is honest: only a genuinely-missing file defaults to `{}`; everything else (permission error, malformed JSON) rejects. **Verify** with the two error-path tests plus a success test. This is the canonical lesson of the Promise Constructor anti-pattern: the wrapper is *where* blanket error swallowing hides, because the constructor's `reject` is optional and easy to forget. If `{}`-on-any-error was ever load-bearing for some caller, split "narrow the fallback" into its own reviewed commit — but the parse-error case is almost always an unintended swallow.

</details>

---

## Exercise 4 — Fix the `async` Promise executor

**Anti-pattern:** Promise Constructor (the `async` executor footgun). **Goal:** remove the `async` keyword from a `new Promise` executor that uses it. **Constraints:** same resolved value; a throw inside the executor's async work must reject the promise, not vanish into an unhandled rejection.

```js
// Before — executor is `async`; a throw before `resolve` is LOST.
function withSetup(task) {
  return new Promise(async (resolve, reject) => {
    await prepare();              // if this rejects, nobody catches it
    const result = await task();  // if task() rejects, the outer Promise hangs forever
    resolve(result);
  });
}
```

<details>
<summary>Refactored</summary>

**Move sequence**

1. **Understand the footgun.** The `Promise` constructor ignores the executor's return value. An `async` executor returns a Promise that the constructor *discards*. So if `prepare()` or `task()` rejects, that rejection becomes an **unhandled rejection** and the *outer* Promise never settles — it hangs. `reject` is in scope but never reached.

2. **Characterize the failure.** Error-path test that currently hangs:

   ```js
   test("rejects when task throws", async () => {
     await expect(withSetup(() => Promise.reject(new Error("x")))).rejects.toThrow("x");
   });
   ```

   It times out against the *Before* code — concrete proof the executor swallows rejections.

3. **The real fix: there is no reason for `new Promise` here at all.** `withSetup` is sequencing two Promises — exactly what an `async` *function* (not executor) does, with automatic throw-to-rejection. Replace the wrapper with a plain `async` function.

```js
// After — async function body; throws become rejections automatically.
async function withSetup(task) {
  await prepare();
  return task();      // task()'s rejection propagates; no manual resolve/reject
}
```

**What improved & how to verify.** The hang-on-error footgun is eliminated, the manual `resolve`/`reject` plumbing is gone, and the code reads as the two-step sequence it is. **Verify** with the rejection test (now passes immediately) plus a success test. **Rule to internalize:** *never make a Promise executor `async`.* If you reach for `async` inside `new Promise`, you almost always want an `async` function wrapping the body instead. The legitimate `new Promise` cases (Exercises 7, 10, 11) bridge *non-Promise* sources and keep the executor strictly synchronous, calling `reject` from a callback.

</details>

---

## Exercise 5 — `async` with no `await`, but it `try/catch`es

**Anti-pattern:** `async` Without `await`. **Goal:** remove `async` from a function with no `await` — **while preserving its error semantics**. **Constraints:** the caller relies on a *rejected Promise* (not a sync throw) when validation fails.

```ts
// Before — no await, but it throws; async turns the throw into a rejection.
async function parsePayload(json: string): Promise<Payload> {
  const obj = JSON.parse(json);          // can throw SyntaxError
  if (!obj.id) throw new Error("missing id");
  return obj as Payload;
}

// caller relies on rejection:
parsePayload(input).catch((e) => respond(400, e.message));
```

<details>
<summary>Refactored</summary>

**Move sequence**

1. **Characterize the error path — it's the crux.** The caller uses `.catch`, so a *rejection* is the contract:

   ```ts
   test("rejects on bad JSON", async () => {
     await expect(parsePayload("{ bad")).rejects.toThrow(SyntaxError);
   });
   test("rejects on missing id", async () => {
     await expect(parsePayload("{}")).rejects.toThrow("missing id");
   });
   ```

2. **Recognize the trap.** This *is* technically `async` Without `await` — there is no `await` in the body. But naïvely dropping `async` changes `JSON.parse` from "rejects the returned Promise" to "throws synchronously," which **breaks the `.catch()` caller**: the throw escapes the expression before any Promise exists, so `.catch` is never attached. Removing `async` here would be a behavior change.

3. **Pick a move that preserves the rejection contract.** Two clean options:
   - **Keep it `async`** and document *why* — the keyword's job here is precisely to coerce a synchronous throw into a rejection so the `.catch` caller works. This is a legitimate use of `async` without `await` (it borders on Exercise 8's counter-case). The lint rule `require-await` will flag it; suppress it with a one-line comment stating the intent.
   - **Drop `async` and make the contract sync**, updating the caller to `try/catch`. Choose this only if you can change every call site.

```ts
// After (option A — keep async to preserve the rejection contract):
// eslint-disable-next-line @typescript-eslint/require-await -- async coerces sync throw into rejection for .catch() callers
async function parsePayload(json: string): Promise<Payload> {
  const obj = JSON.parse(json);
  if (!obj.id) throw new Error("missing id");
  return obj as Payload;
}

// After (option B — sync contract; caller updated to try/catch):
function parsePayload(json: string): Payload {
  const obj = JSON.parse(json);
  if (!obj.id) throw new Error("missing id");
  return obj as Payload;
}
// caller:
try { respondWith(parsePayload(input)); }
catch (e) { respond(400, (e as Error).message); }
```

**What improved & how to verify.** Either way the error-path tests stay green, but the *reasoning* is now explicit instead of accidental. **Verify** by running both rejection/throw tests against the chosen option. The lesson: `async` Without `await` is not *always* an anti-pattern — when the function throws and a downstream `.catch` depends on getting a rejection, the keyword is doing real work. Strip it only after confirming no caller relies on the rejection behavior.

</details>

---

## Exercise 6 — Promisify a Node callback by hand

**Anti-pattern:** Promise Constructor (hand-rolled, subtly wrong). **Goal:** replace a hand-written `new Promise` callback bridge with `util.promisify`. **Constraints:** same resolved value on success; the callback's `err` must reject the Promise.

```js
// Before — hand-rolled bridge; works, but reinvents a standard utility
// and is easy to get subtly wrong (e.g. forgetting `return` after reject,
// or resolving with the wrong arg count).
const fs = require("fs");

function readFileP(path) {
  return new Promise((resolve, reject) => {
    fs.readFile(path, "utf8", (err, data) => {
      if (err) {
        reject(err);
      }
      resolve(data);          // BUG: runs even after reject (no early return)
    });
  });
}
```

<details>
<summary>Refactored</summary>

**Move sequence**

1. **Characterize both paths — and expose the latent bug.** On the error branch the code calls `reject(err)` *then falls through to* `resolve(data)`. The Promise is already settled, so the stray `resolve(undefined)` is a no-op *today* — but it's exactly the class of subtle mistake hand-rolled bridges invite. Tests:

   ```js
   test("resolves file contents", async () => {
     await expect(readFileP(realPath)).resolves.toContain("hello");
   });
   test("rejects on read error", async () => {
     await expect(readFileP("/no/such/file")).rejects.toThrow(/ENOENT/);
   });
   ```

2. **Replace with `util.promisify`.** Node's error-first callback convention (`(err, value)`) is exactly what `promisify` is built for — it handles the early-return, single-value resolution, and `this` binding correctly.

```js
// After — standard, correct, one line.
const fs = require("fs");
const { promisify } = require("util");

const readFileP = promisify(fs.readFile);
// usage unchanged: readFileP(path, "utf8")
```

```js
// Even better — fs already ships Promise versions; prefer them when available:
const fs = require("fs/promises");
// fs.readFile(path, "utf8") already returns a Promise
```

**What improved & how to verify.** The fall-through bug is impossible (you no longer write the resolve/reject logic), and the intent — "adapt an error-first callback to a Promise" — is named by a standard utility. **Verify** with the same two tests; values and rejections are identical. **When you can't use `promisify`** (an API that doesn't follow the error-first convention, or passes multiple result values), a hand-written `new Promise` bridge is legitimate — but then keep the executor synchronous and **always `return` after `reject`** (or use `if/else`), the exact discipline Exercise 7 demonstrates.

</details>

---

## Exercise 7 — KEEP the `new Promise` — event bridge

**Anti-pattern:** Counter-case (a *correct* `new Promise`). **Goal:** recognize that this `new Promise` is legitimate, and harden it rather than removing it. **Constraints:** resolve on `open`, reject on `error`; never leak listeners; settle exactly once.

```js
// Before — bridges an EventEmitter to a Promise. The bridge is NEEDED
// (events are not Promises) but it leaks listeners and can settle twice.
function waitForOpen(socket) {
  return new Promise((resolve, reject) => {
    socket.on("open", () => resolve(socket));
    socket.on("error", (err) => reject(err));
  });
}
```

<details>
<summary>Refactored</summary>

**Move sequence**

1. **Confirm it's a legitimate bridge, not the anti-pattern.** The anti-pattern is wrapping *an existing Promise*. Here the source is an `EventEmitter` — there is no Promise to return. `new Promise` is the *correct* tool. **Do not** remove it; **fix** its real defects.

2. **Characterize the defects with tests.**
   - Resolves with the socket on `open`.
   - Rejects with the error on `error`.
   - After settling, the listeners are removed (no leak): assert `socket.listenerCount("open") === 0`.

3. **Add cleanup + once-only semantics.** Use `once` (auto-removes after first fire) and a `cleanup()` that detaches *both* listeners on whichever event settles first — otherwise an `error` after `open` keeps a live `error` listener forever, and on a long-lived emitter that's a leak.

```js
// After — same shape, now leak-free and settle-once.
function waitForOpen(socket) {
  return new Promise((resolve, reject) => {
    const onOpen = () => { cleanup(); resolve(socket); };
    const onError = (err) => { cleanup(); reject(err); };
    function cleanup() {
      socket.off("open", onOpen);
      socket.off("error", onError);
    }
    socket.once("open", onOpen);
    socket.once("error", onError);
  });
}
```

**What improved & how to verify.** The bridge is preserved (correctly!), but it no longer leaks the *losing* listener and can't settle twice (a Promise ignores the second settle, but the dangling listener is the real cost). **Verify**: the resolve/reject tests pass *and* `listenerCount` is `0` for both events after settling. **The takeaway:** "don't use `new Promise`" is shorthand for "don't wrap a Promise in `new Promise`." Bridging events, timers, or callbacks is its legitimate, irreplaceable job — and the discipline that comes with it is *synchronous executor + reject on the error path + cleanup of every subscription*.

</details>

---

## Exercise 8 — KEEP `async` — normalize a sometimes-sync API

**Anti-pattern:** Counter-case (a *correct* `async` without `await`). **Goal:** recognize why `async` earns its keep on a function whose body may not `await` on every path. **Constraints:** the function must *always* return a Promise and *always* surface failures as rejections, regardless of which branch runs.

```ts
// Before — a cache layer: hits return synchronously, misses await a fetch.
// A reviewer flags "async without await on the hit path — drop it?"
async function getProfile(id: string): Promise<Profile> {
  const cached = cache.get(id);     // synchronous
  if (cached) return cached;        // <-- no await on this branch
  const fresh = await api.fetch(id);
  cache.set(id, fresh);
  return fresh;
}
```

<details>
<summary>Refactored</summary>

**Move sequence**

1. **Test the uniformity contract — both branches.** Callers `await getProfile(...)` unconditionally, so *every* path must return a Promise and reject on failure:

   ```ts
   test("cache hit resolves to cached value", async () => {
     cache.set("1", profileA);
     await expect(getProfile("1")).resolves.toBe(profileA);
   });
   test("cache miss fetches and resolves", async () => {
     api.fetch.mockResolvedValueOnce(profileB);
     await expect(getProfile("2")).resolves.toBe(profileB);
   });
   test("fetch failure rejects", async () => {
     api.fetch.mockRejectedValueOnce(new Error("down"));
     await expect(getProfile("3")).rejects.toThrow("down");
   });
   ```

2. **Why `async` stays.** Removing `async` would force you to hand-wrap the hit branch (`return Promise.resolve(cached)`) and the miss branch separately, *and* you'd lose automatic throw-to-rejection if `cache.get` ever threw. The `async` keyword guarantees a single uniform contract: **every** return is wrapped in a Promise, **every** throw becomes a rejection — even on the branch that happens to have no `await`. That uniformity is the function's entire value.

3. **Decision:** keep `async`. The function is not the anti-pattern. (The anti-pattern is `async` on a body that *always* runs synchronously and can never benefit — Exercise 2.)

```ts
// After — unchanged on purpose; the async keyword normalizes a mixed API.
async function getProfile(id: string): Promise<Profile> {
  const cached = cache.get(id);
  if (cached) return cached;        // wrapped in a resolved Promise by `async`
  const fresh = await api.fetch(id);
  cache.set(id, fresh);
  return fresh;
}
```

**What improved & how to verify.** Nothing changes in the code — the improvement is *correctly declining a bad refactor* and documenting why. **Verify** with all three tests, including the cache-hit path, to prove the hit branch still returns a thenable. **The rule:** `async` Without `await` is an anti-pattern only when *no* path can ever await or throw-into-a-rejection. A function with at least one `await` path, or one that must present a uniform "always a Promise / always rejects" interface, keeps `async` — even if some branch returns synchronously.

</details>

---

## Exercise 9 — `Promise.resolve().then` ceremony

**Anti-pattern:** Promise Constructor family (needless Promise ceremony). **Goal:** strip a `Promise.resolve(...).then(...)` chain that re-implements what `async/await` does natively, and stop dropping the rejection. **Constraints:** same resolved value; rejection from the inner call must propagate.

```js
// Before — needless ceremony; the .then re-wraps and the error is dropped.
function fetchAndTag(id) {
  return Promise.resolve()
    .then(() => loadRecord(id))      // loadRecord returns a Promise
    .then((rec) => {
      return { ...rec, fetchedAt: Date.now() };
    });
  // No .catch — and the leading Promise.resolve() adds a pointless tick.
}
```

<details>
<summary>Refactored</summary>

**Move sequence**

1. **Characterize.** Success returns the record with a `fetchedAt`; the error path must reject:

   ```js
   test("rejects when loadRecord rejects", async () => {
     loadRecord.mockRejectedValueOnce(new Error("missing"));
     await expect(fetchAndTag(1)).rejects.toThrow("missing");
   });
   ```

   (This particular chain *does* propagate the rejection — `.then` forwards it — so the test passes already. The defects are the pointless leading `Promise.resolve()` tick and the unreadable chaining, not a lost error. Confirming "the error already propagates" is part of the discipline: don't *assume* a bug, prove its presence or absence.)

2. **Convert the chain to `async/await`.** `Promise.resolve().then(fn)` is just "call `fn` on a future tick." Since `fn` itself returns a Promise, `await` it directly. The leading `Promise.resolve()` adds one needless microtask and disappears.

```js
// After — flat, readable, one fewer microtask hop; rejection still propagates.
async function fetchAndTag(id) {
  const rec = await loadRecord(id);
  return { ...rec, fetchedAt: Date.now() };
}
```

**What improved & how to verify.** The artificial first tick is gone and the data flow reads top-to-bottom. **Verify**: the success value matches (mock `Date.now` for determinism) and the rejection test still passes. **Note `Date.now()` timing:** in the *Before* code it ran one extra tick later than in the *After*; if any test asserts an exact timestamp, freeze `Date.now` so the structural change doesn't masquerade as a behavior change. This is the async cousin of "Promise Constructor": not literally `new Promise`, but the same instinct — manual Promise ceremony where the language already does it.

</details>

---

## Exercise 10 — Build a correct timeout wrapper

**Anti-pattern:** Promise Constructor (legitimate, must be built correctly). **Goal:** wrap any Promise so it rejects if it doesn't settle within `ms`. **Constraints:** resolve/reject with the original outcome if it's in time; reject with a `TimeoutError` otherwise; **never leak the timer**; settle exactly once.

```ts
// Before — a first attempt. It "works" but leaks the timer on success
// and reinvents Promise.race poorly.
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    setTimeout(() => reject(new Error("timeout")), ms);  // timer never cleared
    p.then(resolve, reject);
  });
}
```

<details>
<summary>Refactored</summary>

**Move sequence**

1. **Characterize all three outcomes.**

   ```ts
   test("resolves if in time", async () => {
     await expect(withTimeout(Promise.resolve(7), 50)).resolves.toBe(7);
   });
   test("rejects with original error if it fails in time", async () => {
     await expect(withTimeout(Promise.reject(new Error("boom")), 50)).rejects.toThrow("boom");
   });
   test("rejects with TimeoutError if too slow", async () => {
     const slow = new Promise((r) => setTimeout(r, 100));
     await expect(withTimeout(slow, 10)).rejects.toBeInstanceOf(TimeoutError);
   });
   ```

2. **Confirm `new Promise` is legitimate.** We're bridging `setTimeout` (a callback API) into a Promise and racing it — there is no existing Promise to "just return." Keep `new Promise`; fix its defects.

3. **Clear the timer on settle.** The original leaks a pending timer whenever `p` settles first — on a hot path that's thousands of dangling timers keeping the event loop alive. Capture the handle and `clearTimeout` in a `finally`-style cleanup that runs on *every* settle path. Use a distinct error type so callers can tell a timeout from a real failure.

```ts
// After — leak-free, single-settle, distinguishable error.
class TimeoutError extends Error {
  constructor(ms: number) { super(`timed out after ${ms}ms`); this.name = "TimeoutError"; }
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new TimeoutError(ms)), ms);
    p.then(
      (val) => { clearTimeout(timer); resolve(val); },
      (err) => { clearTimeout(timer); reject(err); },
    );
  });
}

// Idiomatic alternative when you don't need a custom error or cleanup symmetry:
// Promise.race([p, rejectAfter(ms)]) — but rejectAfter must ALSO clear its timer,
// so the explicit bridge above is often clearer about the cleanup.
```

**What improved & how to verify.** The timer is cleared on the success and the failure paths, so no handle outlives the race; the timeout is a typed `TimeoutError` distinct from the wrapped promise's own errors. **Verify** all three tests, and add a leak check if your runner supports it (`jest` `--detectOpenHandles`, or assert no pending timers). **This is the gold-standard legitimate `new Promise`:** a synchronous executor bridging a non-Promise source (`setTimeout`), with `reject` wired on the error path and cleanup on every settle.

</details>

---

## Exercise 11 — Build a cancellation wrapper (AbortSignal)

**Anti-pattern:** Promise Constructor (legitimate, must be built correctly). **Goal:** make a Promise reject promptly when an `AbortSignal` fires. **Constraints:** reject with an `AbortError` on abort; if already aborted, reject immediately; **remove the listener** when the promise settles or is aborted.

```ts
// Before — listens for abort but never unsubscribes, and ignores
// the already-aborted case (so a pre-aborted signal never rejects).
function abortable<T>(p: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    signal.addEventListener("abort", () => reject(new Error("aborted")));
    p.then(resolve, reject);
  });
}
```

<details>
<summary>Refactored</summary>

**Move sequence**

1. **Characterize abort, pre-abort, and clean-settle.**

   ```ts
   test("rejects when aborted mid-flight", async () => {
     const ac = new AbortController();
     const slow = new Promise((r) => setTimeout(r, 100));
     const wrapped = abortable(slow, ac.signal);
     ac.abort();
     await expect(wrapped).rejects.toMatchObject({ name: "AbortError" });
   });
   test("rejects immediately if already aborted", async () => {
     const ac = new AbortController();
     ac.abort();
     await expect(abortable(Promise.resolve(1), ac.signal)).rejects.toMatchObject({ name: "AbortError" });
   });
   test("removes the abort listener after settling", async () => {
     const ac = new AbortController();
     await abortable(Promise.resolve(1), ac.signal);
     // an internal handle/spy proves removeEventListener was called
   });
   ```

   The pre-abort test **fails** against the *Before* code — `addEventListener` only catches *future* aborts.

2. **Keep `new Promise`** (bridging an event target — legitimate), and fix three things: handle the already-aborted case up front, name the error `AbortError`, and `removeEventListener` on every settle path so the wrapped promise's success doesn't leave a live abort listener attached to a long-lived signal.

```ts
// After — handles pre-abort, names the error, unsubscribes on settle.
class AbortError extends Error {
  constructor() { super("aborted"); this.name = "AbortError"; }
}

function abortable<T>(p: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    if (signal.aborted) return reject(new AbortError());   // already-aborted case

    const onAbort = () => { cleanup(); reject(new AbortError()); };
    const cleanup = () => signal.removeEventListener("abort", onAbort);

    signal.addEventListener("abort", onAbort, { once: true });
    p.then(
      (val) => { cleanup(); resolve(val); },
      (err) => { cleanup(); reject(err); },
    );
  });
}
```

**What improved & how to verify.** A pre-aborted signal now rejects synchronously (well, on the next tick); the abort listener is removed whether the promise resolves, rejects, or aborts, so a shared/long-lived `AbortController` doesn't accumulate listeners; and callers can distinguish cancellation (`name === "AbortError"`) from real errors. **Verify** all three tests, especially listener removal. Together with Exercise 10 this is the complete legitimate-`new Promise` toolkit: *check the pre-settled state, reject on the error path, clean up every subscription.*

</details>

---

## Exercise 12 — Python: `async def` with no `await`

**Anti-pattern:** `async` Without `await`. **Goal:** decide whether an `async def` that never `await`s should drop `async`. **Constraints:** keep the function callable as it is used today; preserve error behavior.

```python
# Before — async def, but the body is pure and never awaits.
async def normalize_tag(tag: str) -> str:
    return tag.strip().lower().replace(" ", "-")

# call site:
slug = await normalize_tag(raw)
```

<details>
<summary>Refactored</summary>

**Move sequence**

1. **Characterize.** `await normalize_tag("  Hot News ")` → `"hot-news"`. Note the cost: in Python, calling an `async def` returns a *coroutine object*; you must `await` it (or schedule it) or it never runs and emits a `RuntimeWarning: coroutine was never awaited`. For pure string work that's pure overhead.

2. **Decide based on the caller and any protocol.**
   - **If `normalize_tag` is just a helper you control:** drop `async`, make it a plain function, and remove the `await` at call sites. No event-loop interaction is needed.
   - **Counter-case — keep `async` if it must satisfy an awaitable protocol.** If `normalize_tag` is one implementation of an interface where *other* implementations genuinely `await` (e.g. a `Normalizer` protocol with an async DB-backed variant), the signatures must match, so this sync-bodied one stays `async def` for polymorphism. That is the Python analog of Exercise 8.

```python
# After (helper you own — drop async):
def normalize_tag(tag: str) -> str:
    return tag.strip().lower().replace(" ", "-")
# call site:
slug = normalize_tag(raw)

# After (counter-case — keep async to satisfy a shared awaitable protocol):
class Normalizer(Protocol):
    async def normalize(self, tag: str) -> str: ...

class SimpleNormalizer:
    async def normalize(self, tag: str) -> str:        # no await, but must match protocol
        return tag.strip().lower().replace(" ", "-")
```

**What improved & how to verify.** Dropping `async` removes coroutine allocation and the "never awaited" footgun; keeping it (in the counter-case) preserves substitutability across implementations. **Verify** the slug value is identical, and — critically — that you updated *every* call site when you dropped `async` (a leftover `await normalize_tag(...)` on a now-sync function raises `TypeError: object str can't be used in 'await' expression`). Run the suite; Python surfaces the mismatch loudly, which is the safety net.

</details>

---

## Exercise 13 — Python: wrap an awaitable by hand

**Anti-pattern:** Promise Constructor analog (needless `Future`/`create_task` wrapping). **Goal:** stop wrapping an existing coroutine/awaitable in a hand-built `Future`, which loses the exception. **Constraints:** same resolved value; the inner exception must propagate to the awaiter.

```python
# Before — wraps a coroutine in a Future by hand; the error is dropped.
import asyncio

def fetch_user(uid: int) -> asyncio.Future:
    fut: asyncio.Future = asyncio.get_event_loop().create_future()

    async def runner():
        result = await db.get_user(uid)   # if this raises, nobody sets the exception
        fut.set_result(result)

    asyncio.ensure_future(runner())
    return fut
```

<details>
<summary>Refactored</summary>

**Move sequence**

1. **Characterize both paths — the error path is broken.** `runner()` calls `fut.set_result` on success but does nothing on exception, so a DB failure leaves `fut` *never resolved* and raises a "Task exception was never retrieved" warning instead of propagating. Test:

   ```python
   async def test_propagates_error():
       db.get_user = AsyncMock(side_effect=ValueError("no user"))
       with pytest.raises(ValueError, match="no user"):
           await fetch_user(1)        # hangs against the Before code
   ```

2. **Recognize the analog.** This is the Python form of the Promise Constructor anti-pattern: `db.get_user(uid)` is *already* an awaitable. Wrapping it in a manual `Future` + `create_future`/`set_result` adds a detached task, a possible orphan, and a dropped exception. The cure is identical: **return/await the inner awaitable directly.**

3. **Make it an `async def` that awaits the coroutine.** Exceptions then propagate to whoever awaits `fetch_user`.

```python
# After — just await the awaitable; exceptions propagate naturally.
async def fetch_user(uid: int) -> User:
    return await db.get_user(uid)
```

**What improved & how to verify.** The orphaned task, the manual `Future`, and the dropped-exception path all disappear; cancellation and exception semantics now behave correctly because there's a single awaitable in the chain. **Verify**: the success value matches *and* the error test now raises `ValueError` at the `await` (instead of hanging). **When is a manual `Future` legitimate?** Only when bridging a *non-awaitable* callback source — e.g. `loop.call_soon` / a C callback / `loop.run_in_executor`-style adapters — exactly mirroring the JS rule: build the future from a callback, set its *exception* on the failure path (`fut.set_exception(err)`), never wrap something that is already awaitable.

</details>

---

## Refactoring discipline (async) — the recap

The exercises run the same loop as structural refactoring, with one async-specific amendment baked in:

```text
pin BOTH paths (resolve + reject)  →  one named move  →  both paths green  →  commit  →  repeat
                                       (behavioral change, if any, gets its OWN commit)
```

- **Characterize the error path, not just the happy path.** The signature failure of both anti-patterns is a *lost rejection* on a branch nobody tested. `await expect(fn()).rejects.toThrow(...)` (JS) / `pytest.raises` under `await` (Python) is the seatbelt. A wrapper that hangs to timeout *is* your proof the rejection is being dropped.
- **Return the inner Promise/awaitable.** The Promise Constructor anti-pattern is, at root, "wrapping a thing that is already a Promise." The fix is almost always to delete the wrapper and `return` (or `await`) the inner promise — errors then propagate for free.
- **Never make a Promise executor `async`.** The constructor discards the executor's return value, so an async executor's rejection becomes an unhandled rejection and the outer Promise hangs. Use an `async` *function* instead.
- **Drop `async` only when no path benefits.** `async` Without `await` is an anti-pattern for purely-synchronous bodies (Exercise 2) — but it's *correct* when the keyword normalizes throws into rejections for `.catch` callers (Exercise 5) or presents a uniform "always a Promise" contract across mixed branches (Exercise 8). Confirm no caller relies on the rejection before stripping it.
- **Know the legitimate `new Promise`.** Bridging events, timers, callbacks, or signals into a Promise is its irreplaceable job (Exercises 7, 10, 11). The discipline that comes with it: *synchronous executor · pre-settled-state check · `reject` on the error path · clean up every subscription/timer on every settle.*
- **Prefer the standard tool.** `util.promisify` (or `fs/promises`) over a hand-rolled bridge; `async/await` over `Promise.resolve().then()` ceremony; `await db.get_user()` over a hand-built `asyncio.Future`.

| Move | Cures | Exercises |
|---|---|---|
| Return the Inner Promise / awaitable | Promise Constructor | 1, 3, 9, 13 |
| Remove `async` (make sync) | `async` w/o `await` | 2, 12 |
| Remove `async` from the executor (use an `async` function) | `async` executor footgun | 4 |
| Keep `async` to coerce throws into rejections / uniform contract | counter-case | 5, 8, 12 |
| Replace hand-rolled bridge with `util.promisify` | Promise Constructor | 6 |
| Correct `new Promise` bridge: reject + cleanup (event / timer / signal) | legitimate `new Promise` | 7, 10, 11 |

---

## Related Topics

- [`tasks.md`](tasks.md) — guided exercises building these moves from scratch.
- [`find-bug.md`](find-bug.md) — the *spotting* counterpart: identify the misuse, don't fix it.
- [Async Anti-Patterns](../README.md) — the chapter overview and the other two categories (Error Handling, Execution Shape).
- [Concurrency Anti-Patterns](../../03-concurrency/README.md) — the multi-thread sibling chapter (locks, races, deadlocks).
- [Refactoring → Refactoring Techniques](../../../refactoring/02-refactoring-techniques/README.md) — the mechanical catalog for the named moves above.
- [Refactoring → Code Smells](../../../refactoring/01-code-smells/README.md) — the smell-level view of needless wrappers and ceremony.
