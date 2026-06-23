# Async Misuse Anti-Patterns — Exercises

> **Category:** [Async Anti-Patterns](../README.md) → **Misuse** — *hands-on practice removing async machinery applied where it doesn't help.*
> **Covers (collectively):** Promise Constructor Anti-Pattern · `async` Without `await`

---

These are **fix-it** exercises, not recognition quizzes. Each one gives you a problem statement, a starting snippet (mostly **JavaScript/TypeScript**, some **Python `asyncio`** — the language varies on purpose), acceptance criteria with hints, and a collapsible solution. The job is to *make the change*: unwrap a needless `new Promise`, plug an error leak, drop a pointless `async`, and — the part that separates copy-paste from understanding — recognize the **legitimate** cases where `new Promise` and a no-`await` `async` are exactly right.

> **How to use this file.** Read the problem, write the fix in your editor *before* opening the solution, then compare. The "why it's better" note under each solution carries the real lesson: in async code the difference between two snippets is rarely lines saved — it is *whether an error can still reach a `catch`*. Refer back to [`junior.md`](junior.md) for the shapes and [`middle.md`](middle.md) for the cures.

> **The two anti-patterns in one sentence each.** The **Promise Constructor anti-pattern** (a.k.a. the *explicit-construction* or *deferred* anti-pattern) is wrapping something that is *already a Promise* in `new Promise(...)`, which adds a layer that silently drops errors. **`async` without `await`** is marking a function `async` when its body never suspends, paying a microtask hop and an extra `Promise` wrapper for nothing. Both are "async theater": ceremony that looks asynchronous but buys you no concurrency and often *loses* error fidelity.

---

## Table of Contents

| # | Exercise | Anti-pattern(s) | Lang | Difficulty |
|---|---|---|---|---|
| 1 | [Unwrap the needless `new Promise`](#exercise-1--unwrap-the-needless-new-promise) | Promise Constructor | JS | ★ easy |
| 2 | [Drop the pointless `async`](#exercise-2--drop-the-pointless-async) | `async` w/o `await` | TS | ★ easy |
| 3 | [Plug the error leak](#exercise-3--plug-the-error-leak) | Promise Constructor | JS | ★ easy |
| 4 | [Stop double-wrapping `fetch`](#exercise-4--stop-double-wrapping-fetch) | Promise Constructor | JS | ★ easy |
| 5 | [The legitimate `new Promise` — bridge `setTimeout`](#exercise-5--the-legitimate-new-promise--bridge-settimeout) | (correct use) | JS | ★★ medium |
| 6 | [Bridge a Node-style callback — `promisify` by hand](#exercise-6--bridge-a-node-style-callback--promisify-by-hand) | (correct use) | JS | ★★ medium |
| 7 | [Fix the `async` Promise executor](#exercise-7--fix-the-async-promise-executor) | Promise Constructor + async | JS | ★★ medium |
| 8 | [Keep the `async` — normalize a sometimes-sync API](#exercise-8--keep-the-async--normalize-a-sometimes-sync-api) | `async` w/o `await` (justified) | TS | ★★ medium |
| 9 | [Bridge a one-shot event with cleanup](#exercise-9--bridge-a-one-shot-event-with-cleanup) | (correct use) | JS | ★★ medium |
| 10 | [Write a timeout wrapper](#exercise-10--write-a-timeout-wrapper) | (correct use) | TS | ★★★ hard |
| 11 | [Add cancellation with `AbortSignal`](#exercise-11--add-cancellation-with-abortsignal) | (correct use) | TS | ★★★ hard |
| 12 | [Python: stop wrapping a coroutine in a Future](#exercise-12--python-stop-wrapping-a-coroutine-in-a-future) | Promise Constructor (asyncio) | Python | ★★ medium |
| 13 | [Python: the no-`await` `async def`](#exercise-13--python-the-no-await-async-def) | `async` w/o `await` | Python | ★★ medium |
| 14 | [Mini-project: clean up the `Downloader`](#exercise-14--mini-project-clean-up-the-downloader) | both | TS | ★★★★ project |
| 15 | [Write a misuse review checklist + lint config](#exercise-15--write-a-misuse-review-checklist--lint-config) | meta | — | ★★ medium |

---

## Exercise 1 — Unwrap the needless `new Promise`

**Anti-pattern:** Promise Constructor · **Language:** JavaScript · **Difficulty:** ★ easy

`getUser` already returns a Promise. Someone wrapped it in another. Unwrap it.

```js
function getUser(id) {
  return new Promise((resolve) => {
    db.query("SELECT * FROM users WHERE id = ?", [id]).then((rows) => {
      resolve(rows[0]);
    });
  });
}
```

**Acceptance criteria**
- No `new Promise` remains.
- The function still resolves to `rows[0]`.
- A rejection from `db.query` now propagates to the caller's `.catch` (the original silently lost it).

**Hint:** `db.query(...).then(...)` is *already* a Promise. Return it; transform the value in the `.then`.

<details>
<summary>Solution</summary>

```js
function getUser(id) {
  return db.query("SELECT * FROM users WHERE id = ?", [id]).then((rows) => rows[0]);
}
```

Or, more readably, with `async`/`await` (here the `await` is real, so `async` is justified):

```js
async function getUser(id) {
  const rows = await db.query("SELECT * FROM users WHERE id = ?", [id]);
  return rows[0];
}
```

**Why it's better.** The original built a brand-new Promise whose *only* job was to mirror the one `db.query` already returns — pure overhead. Worse, the executor only called `resolve`; it never registered a rejection handler, so **if `db.query` rejected, that rejection vanished**: the outer Promise would hang forever (it is never resolved or rejected), and you would see an unhandled-rejection warning with a stack trace pointing nowhere useful. Returning the inner Promise (or `await`ing it) makes errors flow to the caller's `.catch`/`try` automatically, because `.then` propagates rejection by default. The rule: *never wrap a Promise in `new Promise` — you already have one.*

</details>

---

## Exercise 2 — Drop the pointless `async`

**Anti-pattern:** `async` without `await` · **Language:** TypeScript · **Difficulty:** ★ easy

This function is marked `async` but never awaits anything. Decide whether the `async` earns its keep, and if not, remove it.

```ts
async function fullName(user: { first: string; last: string }): Promise<string> {
  return `${user.first} ${user.last}`;
}
```

**Acceptance criteria**
- The function's body does only synchronous string work, so the `async` is removed.
- The return type reflects the synchronous nature.
- Callers that did `await fullName(u)` still compile (because `await` on a plain value is legal).

**Hint:** `await` on a non-Promise is a no-op that *still* costs a microtask tick. A function with no real `await` should not be `async`.

<details>
<summary>Solution</summary>

```ts
function fullName(user: { first: string; last: string }): string {
  return `${user.first} ${user.last}`;
}
```

**Why it's better.** `async` forces the return value to be wrapped in a `Promise` and forces every call to resolve on the **microtask queue** — one event-loop hop — even though there is nothing to wait for. The `Promise<string>` return type is also a lie: it tells callers "this may take time / may reject" when it cannot do either. Dropping `async` makes the value available *synchronously*, removes a needless allocation, and lets a caller use the result inline (`fullName(u).toUpperCase()`) without an `await`. Existing `await fullName(u)` call sites keep working because `await` of a non-thenable simply returns it after one tick — but you should clean those up too, since the wait is now meaningless. Reach for `async` only when the body contains a real `await` (or you deliberately want the *normalization* behavior from Exercise 8).

</details>

---

## Exercise 3 — Plug the error leak

**Anti-pattern:** Promise Constructor (lost rejection) · **Language:** JavaScript · **Difficulty:** ★ easy

This wrapper *does* handle errors — into a black hole. A failed `loadConfig` leaves the returned Promise pending forever. Fix it two ways: the quick unwrap, and (for the sake of the drill) the minimal correct executor.

```js
function getConfig() {
  return new Promise((resolve) => {
    loadConfig()
      .then((cfg) => resolve(cfg))
      .catch((err) => {
        console.error("config failed", err); // logged, then swallowed
        // no reject(err), no resolve — the outer Promise hangs
      });
  });
}
```

**Acceptance criteria**
- A failure in `loadConfig` rejects the returned Promise (it must not hang).
- The preferred fix removes `new Promise` entirely.
- If you keep the executor (only as an exercise), it must call `reject` on failure.

**Hint:** the bug is a Promise that is neither resolved nor rejected on the error path — the worst failure mode, because it produces *no* signal at all, just a hung await.

<details>
<summary>Solution</summary>

**Preferred — unwrap it.** The wrapper adds nothing; return the inner Promise and let rejection flow:

```js
function getConfig() {
  return loadConfig(); // errors propagate to the caller's .catch automatically
}
```

If you genuinely want to log *and* re-throw (so the failure is observed but still propagates):

```js
function getConfig() {
  return loadConfig().catch((err) => {
    console.error("config failed", err);
    throw err; // re-throw so the caller still sees the rejection
  });
}
```

**Minimal correct executor (only if you insist on `new Promise`):**

```js
function getConfig() {
  return new Promise((resolve, reject) => {
    loadConfig().then(resolve, reject); // forward BOTH outcomes
  });
}
```

**Why it's better.** The original logged the error and then did nothing — the outer Promise stayed **pending forever**, so any `await getConfig()` would hang silently with no timeout and no rejection. That is strictly worse than a thrown error, which at least surfaces. The unwrapped version is correct *and* shorter: a Promise's rejection already propagates through `return`. The "log and re-throw" form keeps the side effect while preserving propagation — note the `throw err`, without which `.catch` would *recover* the chain and resolve with `undefined`. The executor form (`loadConfig().then(resolve, reject)`) shows the rule: if you ever build a `new Promise`, you must wire *both* `resolve` and `reject`, or one branch leaks.

</details>

---

## Exercise 4 — Stop double-wrapping `fetch`

**Anti-pattern:** Promise Constructor · **Language:** JavaScript · **Difficulty:** ★ easy

A helper wraps `fetch` to return JSON. It rebuilds the Promise machinery `fetch` already provides, and loses network errors in the process.

```js
function getJSON(url) {
  return new Promise((resolve, reject) => {
    fetch(url).then((res) => {
      res.json().then((data) => resolve(data));
    });
    // fetch can reject (network down) — nothing catches it here
  });
}
```

**Acceptance criteria**
- No `new Promise`.
- A network failure (`fetch` rejects) and a malformed-body failure (`res.json()` rejects) both propagate.
- A non-2xx HTTP status is surfaced as an error (since `fetch` does *not* reject on 4xx/5xx).

**Hint:** chain the two Promises and return the chain. Add an explicit `res.ok` check, because `fetch` resolves even on a 404.

<details>
<summary>Solution</summary>

```js
async function getJSON(url) {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} for ${url}`);
  }
  return res.json();
}
```

Equivalent without `async` (the `.then` chain is itself a Promise — no `new Promise` needed):

```js
function getJSON(url) {
  return fetch(url).then((res) => {
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    return res.json();
  });
}
```

**Why it's better.** The original `new Promise` wrapper registered no rejection handler on either inner Promise, so a dropped connection or a body that is not valid JSON would leave the outer Promise pending forever. The chained version lets both failures propagate naturally. It also fixes a *semantic* bug the wrapper hid: `fetch` only rejects on network-level failure, **not** on a 4xx/5xx response — so without the `res.ok` guard, a 500 error page would be parsed as "successful" JSON (or throw a confusing parse error). The rewrite makes "this is an error" explicit. Here `async` is justified because there is a real `await`; the non-`async` form is equally correct.

</details>

---

## Exercise 5 — The legitimate `new Promise` — bridge `setTimeout`

**Anti-pattern:** *(none — this is the correct use of `new Promise`)* · **Language:** JavaScript · **Difficulty:** ★★ medium

`new Promise` is the wrong tool when you already have a Promise — but it is the *right* tool to bridge a **callback / timer / event** API that predates Promises. Write a `delay(ms)` that resolves after `ms` milliseconds, supporting optional cancellation.

```js
// Goal: const t = delay(1000); await t;   // resolves after 1s
// Stretch: delay should be cancelable so a hung test can't wait forever.
function delay(ms) {
  // TODO: bridge setTimeout, which is callback-based, into a Promise
}
```

**Acceptance criteria**
- Uses `new Promise` legitimately (there is no existing Promise to return — `setTimeout` is callback-based).
- Resolves exactly once after `ms`.
- Bonus: returns a way to cancel the pending timer (and the canceled Promise neither resolves nor leaks the timer).

**Hint:** this is the canonical *legitimate* `new Promise`. The executor wraps `setTimeout` and calls `resolve` from the callback. For cancellation, `clearTimeout` and reject (or resolve) deliberately.

<details>
<summary>Solution</summary>

```js
function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
```

With cancellation, returning both the Promise and a `cancel` function, cleaning up the timer:

```js
function delay(ms) {
  let timer;
  const promise = new Promise((resolve, reject) => {
    timer = setTimeout(resolve, ms);
    // expose a cancel that clears the timer AND settles the Promise
    promise.cancel = () => {
      clearTimeout(timer);
      reject(new Error("delay canceled"));
    };
  });
  return promise;
}

// usage:
// const d = delay(1000);
// d.cancel();          // clears the timer, rejects with "delay canceled"
// await d;             // throws if canceled
```

**Why it's better — and why this `new Promise` is correct.** Here there is **no pre-existing Promise** to return: `setTimeout` is a callback-based API from before Promises existed. `new Promise` is the *only* way to convert it, so this is the legitimate use the anti-pattern explicitly excludes. The executor resolves exactly once (`setTimeout` fires once). The cancellation variant matters because a timer that is never cleared keeps the event loop alive and can prevent a Node process from exiting; `clearTimeout(timer)` in `cancel` releases it, and rejecting settles the Promise so an `await` does not hang. The contrast with Exercises 1–4 is the whole point: wrap a *callback*, never wrap a *Promise*.

</details>

---

## Exercise 6 — Bridge a Node-style callback — `promisify` by hand

**Anti-pattern:** *(none — correct use; also relates to "Mixing Callbacks and Promises")* · **Language:** JavaScript · **Difficulty:** ★★ medium

You have an old Node-style API: a function whose last argument is a `(err, result)` callback. Promisify it correctly by hand (then note the standard-library shortcut). This is a legitimate `new Promise`.

```js
// fs.readFile(path, encoding, (err, data) => ...) — error-first callback.
// Goal: const text = await readFileP("a.txt", "utf8");
function readFileP(path, encoding) {
  // TODO: wrap fs.readFile so err -> reject, data -> resolve
}
```

**Acceptance criteria**
- `err` (the first callback argument) rejects the Promise.
- `data` (the second) resolves it.
- The callback fires exactly once; the Promise settles exactly once.
- Note the production shortcut.

**Hint:** error-first convention: `(err, data) => err ? reject(err) : resolve(data)`. In real code, prefer `util.promisify` or `fs.promises`.

<details>
<summary>Solution</summary>

```js
const fs = require("node:fs");

function readFileP(path, encoding) {
  return new Promise((resolve, reject) => {
    fs.readFile(path, encoding, (err, data) => {
      if (err) reject(err);
      else resolve(data);
    });
  });
}
```

A reusable promisifier for *any* error-first function:

```js
function promisify(fn) {
  return (...args) =>
    new Promise((resolve, reject) => {
      fn(...args, (err, result) => (err ? reject(err) : resolve(result)));
    });
}

const readFileP = promisify(fs.readFile);
```

**In production, don't hand-roll it:**

```js
const { promisify } = require("node:util");
const readFileP = promisify(fs.readFile);
// or simply:
const { readFile } = require("node:fs/promises");
```

**Why it's better — and why this `new Promise` is correct.** Like the timer in Exercise 5, an error-first callback is **not** a Promise, so `new Promise` is the right (and only) bridge. The critical detail is wiring **both** branches: `err → reject`, `data → resolve`. A common bug is forgetting the `err` branch, which turns every failure into a permanently-pending Promise (the Exercise 3 failure mode). The standard-library forms (`util.promisify`, `fs/promises`) exist precisely so you never hand-write this — they handle multi-argument callbacks and edge cases correctly. Use them; the hand-rolled version is here only so you understand what they do and can recognize a *botched* hand-rolled one in review.

</details>

---

## Exercise 7 — Fix the `async` Promise executor

**Anti-pattern:** Promise Constructor + `async` executor · **Language:** JavaScript · **Difficulty:** ★★ medium

This code passes an `async` function as the Promise executor. That is a known footgun: errors thrown inside the `async` executor become unhandled rejections of the *executor's own* Promise, not the one being constructed — so `reject` never fires.

```js
function loadAll(ids) {
  return new Promise(async (resolve, reject) => {
    const results = [];
    for (const id of ids) {
      const item = await fetchItem(id); // if this rejects, it does NOT reject the outer Promise
      results.push(item);
    }
    resolve(results);
  });
}
```

**Acceptance criteria**
- No `async` executor passed to `new Promise`.
- A rejection from any `fetchItem(id)` rejects the returned Promise.
- Prefer the form with no `new Promise` at all.

**Hint:** if you have `await`, you don't need `new Promise` — just write an `async` function. The whole construct collapses.

<details>
<summary>Solution</summary>

```js
async function loadAll(ids) {
  const results = [];
  for (const id of ids) {
    results.push(await fetchItem(id));
  }
  return results;
}
```

If the items are independent, fetch them in parallel instead of serially:

```js
function loadAll(ids) {
  return Promise.all(ids.map(fetchItem));
}
```

**Why it's better.** The `new Promise(async ...)` pattern is doubly wrong. First, it is redundant: an `async` function *already* returns a Promise, so wrapping it in `new Promise` is the constructor anti-pattern. Second, it is a **silent error leak**: when the `async` executor throws (e.g. `fetchItem` rejects), that error rejects the *invisible* Promise that the `async` executor itself returns — which nobody holds a reference to — so it becomes an unhandled rejection while the outer Promise stays **pending forever**. `reject` is never reached. Dropping `new Promise` and writing a plain `async` function fixes both: a throw inside an `async` function rejects *that function's* returned Promise, which is exactly the one the caller awaits. The `Promise.all` variant additionally fixes an [`await`-in-a-loop](../README.md) serialization that the original buried. Most linters flag `no-async-promise-executor` for this exact reason.

</details>

---

## Exercise 8 — Keep the `async` — normalize a sometimes-sync API

**Anti-pattern:** `async` without `await` *(justified — do not remove it here)* · **Language:** TypeScript · **Difficulty:** ★★ medium

Not every no-`await` `async` is wrong. A cache lookup returns synchronously on a hit and asynchronously on a miss. The `async` keyword *normalizes* both into a Promise so callers have one shape. Decide what to do — and justify keeping `async`.

```ts
const cache = new Map<string, User>();

// Looks like an "async without await" smell on the hit path... is it?
async function getUser(id: string): Promise<User> {
  const cached = cache.get(id);
  if (cached) {
    return cached; // synchronous hit — no await
  }
  const user = await fetchUser(id); // async miss — real await
  cache.set(id, user);
  return user;
}
```

**Acceptance criteria**
- Recognize that this function *does* contain a real `await` (the miss path), so it is **not** the anti-pattern.
- Keep the `async` and explain why a "uniform Promise return" is the goal.
- As a contrast, show the *bad* alternative (returning a raw value on hit, a Promise on miss) and why it breaks callers.

<details>
<summary>Solution</summary>

**Keep it exactly as written.** It already contains a real `await` on the miss path, so it is not "`async` without `await`." Even on the synchronous hit path, `async` is doing useful work: it guarantees a **single return type** — `Promise<User>` — so every caller writes `const u = await getUser(id)` regardless of hit or miss.

The anti-pattern would be a function that returns **two different shapes** depending on the path — the dreaded "sometimes sync, sometimes async" API (a *Zalgo* function):

```ts
// BAD: union return type — callers can't tell whether to await.
function getUserBad(id: string): User | Promise<User> {
  const cached = cache.get(id);
  if (cached) return cached;          // a User
  return fetchUser(id).then((u) => {  // a Promise<User>
    cache.set(id, u);
    return u;
  });
}
// Caller can't write uniform code:
//   const u = getUserBad(id);   // is u a User or a Promise<User>? depends on cache!
//   u.name;                     // works on hit, fails on miss
```

**Why keeping `async` is right.** The `async` keyword auto-wraps the synchronous `return cached` into a resolved Promise, so the hit and miss paths produce the *same* type. That uniformity is the entire point: a caller should never have to ask "do I need to await this?" — the answer is always yes. The microtask hop on a cache hit is a genuine cost, but it buys **API consistency and predictable ordering** (a function that is *sometimes* synchronous is far more dangerous — it makes call order non-deterministic, the classic "release Zalgo" hazard). So: remove `async` when the body is *purely* synchronous (Exercise 2); **keep** it when one branch is async and you want a single Promise shape (here). The deciding question: *does any code path await?* If yes, `async` is earning its keep.

</details>

---

## Exercise 9 — Bridge a one-shot event with cleanup

**Anti-pattern:** *(none — correct use of `new Promise`)* · **Language:** JavaScript · **Difficulty:** ★★ medium

Turn a one-shot event into a Promise. The trap: if you only register the success listener, an error event leaves the Promise pending forever, and listeners that never fire leak memory. Wire both, and clean up.

```js
// An EventEmitter that emits "open" once on success, "error" once on failure.
function waitForOpen(socket) {
  return new Promise((resolve) => {
    socket.on("open", resolve); // only half the story — and never removed
  });
}
```

**Acceptance criteria**
- Resolve on `"open"`, reject on `"error"`.
- Use `once` (or remove listeners) so neither listener leaks after the Promise settles.
- Removing the *other* listener on settle prevents both a leak and a late double-settle.

**Hint:** register both listeners; on whichever fires first, remove *both* before settling. Node's `once`/`removeListener` (or `events.once`) handle this.

<details>
<summary>Solution</summary>

```js
function waitForOpen(socket) {
  return new Promise((resolve, reject) => {
    const onOpen = () => {
      cleanup();
      resolve();
    };
    const onError = (err) => {
      cleanup();
      reject(err);
    };
    const cleanup = () => {
      socket.removeListener("open", onOpen);
      socket.removeListener("error", onError);
    };
    socket.once("open", onOpen);
    socket.once("error", onError);
  });
}
```

In modern Node, the standard library does the cleanup for you:

```js
const { once } = require("node:events");
// resolves with the event args on "open"; rejects if "error" is emitted first
async function waitForOpen(socket) {
  await once(socket, "open");
}
```

**Why it's better — and why this `new Promise` is correct.** An `EventEmitter` is not a Promise, so `new Promise` is the right bridge. The original wired only `"open"`, so a connection that emitted `"error"` left the Promise **pending forever** (the Exercise 3 hazard again) — and because the listener was added with `on` and never removed, every call leaked a listener, eventually tripping Node's `MaxListenersExceededWarning`. The fixed version: (1) handles **both** terminal events so the Promise always settles; (2) removes **both** listeners on settle, so neither leaks and a stray late event cannot try to settle an already-settled Promise (settling twice is a silent no-op, but the leaked listener still holds memory). `events.once` packages exactly this contract — prefer it.

</details>

---

## Exercise 10 — Write a timeout wrapper

**Anti-pattern:** *(none — correct use of `new Promise`; composing with `Promise.race`)* · **Language:** TypeScript · **Difficulty:** ★★★ hard

Wrap any Promise so it rejects if it does not settle within `ms`. The subtle parts: clear the timer when the work wins (or you leak it), and make the timeout reject (not resolve) so callers can distinguish.

```ts
// Goal: await withTimeout(fetchUser(id), 2000) -> rejects "timeout" if fetch is too slow.
function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  // TODO
}
```

**Acceptance criteria**
- Rejects with a clear timeout error if `work` does not settle within `ms`.
- If `work` settles first, the timer is cleared (no dangling `setTimeout`).
- The original `work` Promise is returned/raced, not re-wrapped needlessly.

**Hint:** `Promise.race([work, timeout])`. The timeout is a *legitimate* `new Promise` over `setTimeout`. Use `finally` to `clearTimeout` regardless of which side wins.

<details>
<summary>Solution</summary>

```ts
function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms);
  });
  // Race the real work against the timeout; clear the timer whichever wins.
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}
```

**Why it's better.** Note what is and is not a `new Promise` here. We do **not** wrap `work` — it is already a Promise, so it goes straight into `Promise.race`. We **do** use `new Promise` for the timeout, because `setTimeout` is a callback API with no Promise of its own (the legitimate case). The timeout side resolves *never* and rejects on fire, typed `Promise<never>` so `Promise.race` infers `Promise<T>` cleanly. Two correctness details: (1) the timeout **rejects** rather than resolving, so a caller's `catch` can tell "too slow" from a real value — resolving with a sentinel would force every caller to test for it; (2) `.finally(() => clearTimeout(timer))` runs whether `work` wins, `work` rejects, or the timeout fires, so a fast success does not leave a dangling timer keeping the event loop (or process) alive. The one thing `withTimeout` cannot do is *stop* the underlying work — `work` keeps running after the race is lost. For true cancellation, you need `AbortSignal`: Exercise 11.

</details>

---

## Exercise 11 — Add cancellation with `AbortSignal`

**Anti-pattern:** *(none — correct use; the modern alternative to a hand-rolled cancel)* · **Language:** TypeScript · **Difficulty:** ★★★ hard

`withTimeout` (Exercise 10) leaves the work running. The modern, composable answer is `AbortController`/`AbortSignal`, which `fetch` and many APIs accept natively. Build a `fetchWithTimeout` that *actually aborts* the request on timeout, with no leaked timer.

```ts
// Goal: a fetch that aborts the underlying request after `ms` and cleans up.
async function fetchWithTimeout(url: string, ms: number): Promise<Response> {
  // TODO: use AbortController so the request itself is canceled, not just abandoned
}
```

**Acceptance criteria**
- On timeout, the underlying `fetch` is *aborted* (the request stops), not merely ignored.
- The timer is cleared if the fetch completes first.
- The thrown error distinguishes a timeout abort from other failures.

**Hint:** `AbortController` + `controller.abort()` from a `setTimeout`. Pass `controller.signal` to `fetch`. Clear the timer in `finally`. `AbortSignal.timeout(ms)` is the one-liner standard-library version.

<details>
<summary>Solution</summary>

```ts
async function fetchWithTimeout(url: string, ms: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { signal: controller.signal });
  } catch (err) {
    if (controller.signal.aborted) {
      throw new Error(`fetch to ${url} timed out after ${ms}ms`);
    }
    throw err; // a non-abort failure (network, DNS) propagates unchanged
  } finally {
    clearTimeout(timer); // cleared whether we succeeded, timed out, or errored
  }
}
```

The modern standard-library shortcut — no manual controller or timer at all:

```ts
async function fetchWithTimeout(url: string, ms: number): Promise<Response> {
  return fetch(url, { signal: AbortSignal.timeout(ms) });
  // AbortSignal.timeout creates a signal that aborts itself after `ms`.
}
```

**Why it's better.** Unlike `Promise.race` (Exercise 10), this *actually cancels the work*: `controller.abort()` causes `fetch` to reject and the browser/runtime to tear down the connection, so you do not pay for a response nobody will read. The `try/catch/finally` shape is doing three correct things at once — translating an abort into a clear timeout message, re-throwing genuine failures untouched (so a DNS error is not mislabeled "timeout"), and clearing the timer in `finally` so a fast success leaves nothing dangling. The `AbortSignal.timeout(ms)` form shows that the platform has absorbed this pattern entirely; reach for it first. `AbortSignal` composes — you can also pass a user-initiated signal via `AbortSignal.any([userSignal, AbortSignal.timeout(ms)])` so either a timeout *or* a cancel button aborts the same request.

</details>

---

## Exercise 12 — Python: stop wrapping a coroutine in a Future

**Anti-pattern:** Promise Constructor (asyncio equivalent) · **Language:** Python `asyncio` · **Difficulty:** ★★ medium

The Python analogue of `new Promise(r => existing.then(r))` is manually creating a `Future`, scheduling a task to copy the coroutine's result into it, and returning the `Future`. It is pure overhead and drops exceptions. Unwrap it.

```python
import asyncio

def get_user(user_id):
    loop = asyncio.get_event_loop()
    fut = loop.create_future()

    async def runner():
        rows = await db.query("SELECT * FROM users WHERE id = $1", user_id)
        fut.set_result(rows[0])  # if db.query raises, the exception is never set on fut

    asyncio.ensure_future(runner())
    return fut
```

**Acceptance criteria**
- No manual `create_future` / `set_result`.
- `get_user` becomes an ordinary coroutine awaited by callers.
- An exception from `db.query` propagates to the awaiter (the original lost it).

**Hint:** you already have a coroutine — just `await` it. The hand-rolled `Future` is `asyncio`'s version of the Promise-constructor anti-pattern.

<details>
<summary>Solution</summary>

```python
async def get_user(user_id):
    rows = await db.query("SELECT * FROM users WHERE id = $1", user_id)
    return rows[0]
```

**Why it's better.** The original is the `asyncio` mirror of Exercise 1: a coroutine's result is *already* awaitable, so creating a separate `Future` and copying the value across is redundant machinery. And it leaks errors exactly like the JS version — `runner` only calls `fut.set_result(...)` on success; if `db.query` raises, the exception propagates out of the orphaned `runner` task (surfacing as a *"Task exception was never retrieved"* warning), while `fut` is **never resolved**, so `await get_user(id)` hangs forever. Writing a plain `async def` and `await`ing the query lets the exception flow to the caller's `try/except` naturally. The hand-rolled `Future` (and the bare `ensure_future` that orphans the task) is a code smell in `asyncio`: you almost never need `create_future` outside of bridging a genuinely callback-based, non-coroutine API (e.g. `loop.call_soon`, a protocol callback) — the direct analogue of the legitimate `new Promise` cases above.

</details>

---

## Exercise 13 — Python: the no-`await` `async def`

**Anti-pattern:** `async` without `await` · **Language:** Python `asyncio` · **Difficulty:** ★★ medium

This function is declared `async def` but never awaits. Callers must `await` it for no reason, and forgetting the `await` is a silent bug. Decide whether to keep `async def`.

```python
async def slugify(title: str) -> str:
    return title.strip().lower().replace(" ", "-")
```

**Acceptance criteria**
- The body is purely synchronous, so `async def` is removed.
- Callers call it directly (no `await`).
- Explain the specific Python hazard of a no-`await` `async def` that JS does not have.

<details>
<summary>Solution</summary>

```python
def slugify(title: str) -> str:
    return title.strip().lower().replace(" ", "-")
```

**Why it's better.** As in Exercise 2, `async` here buys nothing — there is no I/O to await. But Python's hazard is sharper than JavaScript's. Calling an `async def` does **not run it**: it returns a *coroutine object*. So `slug = slugify(title)` (forgetting `await`) does not raise — `slug` is a coroutine, the string transformation never runs, and you get a bug like `TypeError: sequence item 0: expected str instance, coroutine found` far downstream, or a *"coroutine was never awaited"* `RuntimeWarning` with no obvious cause. JavaScript's `async` function at least *executes* synchronously up to the first `await`; Python's does not execute *at all* until awaited. Making `slugify` an ordinary `def` removes the trap entirely: it runs when called, returns a `str`, and cannot be accidentally left unawaited. Keep `async def` only when the body actually `await`s something (or implements an `async` protocol method the interface requires).

</details>

---

## Exercise 14 — Mini-project: clean up the `Downloader`

**Anti-pattern:** both, in one small realistic module · **Language:** TypeScript · **Difficulty:** ★★★★ project

This `Downloader` manages to commit **both** misuse anti-patterns plus their error leaks: a needless `new Promise` around a `fetch` chain, an `async` Promise executor, a pointless `async` on a pure helper, and a missing timeout/cancellation. Refactor it into correct, idiomatic code. Work in steps; keep it working after each.

```ts
class Downloader {
  // (1) pointless async — no await, pure string work
  async buildUrl(base: string, id: string): Promise<string> {
    return `${base}/items/${id}`;
  }

  // (2) needless new Promise wrapping a fetch chain; loses network errors
  fetchItem(url: string): Promise<unknown> {
    return new Promise((resolve) => {
      fetch(url).then((res) => res.json()).then((data) => resolve(data));
    });
  }

  // (3) async Promise executor — rejections never reject the outer Promise
  fetchMany(urls: string[]): Promise<unknown[]> {
    return new Promise(async (resolve, reject) => {
      const out: unknown[] = [];
      for (const url of urls) {
        out.push(await this.fetchItem(url)); // serial, and a reject is lost
      }
      resolve(out);
    });
  }
}
```

**Acceptance criteria**
- **`async` without `await`:** `buildUrl` becomes synchronous.
- **Promise Constructor:** `fetchItem` returns the `fetch` chain directly (no `new Promise`), checks `res.ok`, and propagates errors.
- **`async` executor:** `fetchMany` is a plain `async` function (or `Promise.all`), and a rejection from any item rejects the result.
- Add a real `new Promise` *only* where one belongs: a `withTimeout` over `setTimeout` (the legitimate case).
- Each unit is independently testable.

**Hint:** fix one method at a time. `buildUrl` → drop `async`. `fetchItem` → return the chain + `res.ok`. `fetchMany` → `Promise.all`. Then layer a legitimate-`new Promise` timeout.

<details>
<summary>Solution</summary>

```ts
class Downloader {
  // (1) FIXED: pure synchronous helper — no async, no Promise.
  buildUrl(base: string, id: string): string {
    return `${base}/items/${id}`;
  }

  // (2) FIXED: return the fetch chain directly; check status; errors propagate.
  async fetchItem(url: string): Promise<unknown> {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    return res.json();
  }

  // (3) FIXED: plain async, parallel, and a single rejection rejects the whole.
  fetchMany(urls: string[]): Promise<unknown[]> {
    return Promise.all(urls.map((url) => this.fetchItem(url)));
  }
}

// The ONE legitimate new Promise: bridging setTimeout for a timeout.
function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms);
  });
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}

// usage:
// const d = new Downloader();
// const url = d.buildUrl("https://api.co", "42");   // sync, no await
// const item = await withTimeout(d.fetchItem(url), 2000);
// const all = await withTimeout(d.fetchMany([url1, url2]), 5000);
```

**What happened to each anti-pattern:**

- **`async` without `await` →** `buildUrl` is now an ordinary synchronous method returning `string`. No microtask hop, no `Promise<string>` lie; callers use it inline.
- **Promise Constructor (`fetchItem`) →** the `new Promise` wrapper is gone. `fetchItem` returns the `await`ed chain, so a dropped connection or a non-2xx status (now checked via `res.ok`) propagates to the caller instead of hanging.
- **`async` Promise executor (`fetchMany`) →** replaced with `Promise.all`, which (a) removes the redundant `new Promise`, (b) makes any single rejection reject the result (the executor swallowed it), and (c) fixes the accidental *serialization* — the requests now run in parallel.
- **Legitimate `new Promise` →** introduced *deliberately* in `withTimeout`, the one place a Promise must be hand-built because `setTimeout` is callback-based. This is the distinction the whole chapter turns on: never wrap a Promise, always be willing to wrap a callback.

**Why it's better.** Every error path that previously led to a permanently-pending Promise now settles: failures propagate, timeouts reject, and the only surviving `new Promise` is the one that genuinely bridges a non-Promise API. The refactor was done method-by-method — drop `async`, unwrap `fetchItem`, collapse `fetchMany`, then add the timeout — never as a big-bang rewrite, so behavior stayed observable at each step.

</details>

---

## Exercise 15 — Write a misuse review checklist + lint config

**Anti-pattern:** meta (prevention) · **Difficulty:** ★★ medium

Misuse is cheapest to stop in review and cheaper still in the linter. Write (a) a concise reviewer checklist for these two anti-patterns, phrased as questions with a clear "if yes, push back" trigger, and (b) the lint rules that catch them automatically so humans don't have to.

**Acceptance criteria**
- Concrete, answerable questions — not "is this clean?"
- Each question names the failure mode and the fix.
- Real lint rule names (ESLint / TypeScript / Python) that mechanize the checks.

<details>
<summary>Solution</summary>

**Async-misuse PR review checklist**

| # | Question | If the answer is… | Then |
|---|---|---|---|
| 1 | Does a `new Promise(...)` wrap something that is *already* a Promise (a `.then`, an `async` call, a `fetch`)? | "Yes" | Push back: return the inner Promise / `await` it. **Promise Constructor anti-pattern** — and check for a lost rejection. |
| 2 | In any `new Promise(resolve, reject)`, is `reject` actually called on every failure path? | "No" / "only `resolve`" | Push back: a failure leaves the Promise pending forever. Wire `reject` (or unwrap). |
| 3 | Is an `async` function passed as a Promise executor (`new Promise(async ...)`)? | "Yes" | Push back: rejections are lost. Make it a plain `async` function; drop the `new Promise`. |
| 4 | Does an `async` function contain **no** `await` (and no `for await`)? | "Yes, and the body is purely synchronous" | Push back: drop `async`. *(Exception: it normalizes a sometimes-sync API — see #5.)* |
| 5 | If a no-`await` `async` is kept, is there a *stated* reason (uniform Promise return, interface contract)? | "No reason given" | Ask for the justification or remove `async`. |
| 6 | When a `new Promise` *is* justified (timer/event/callback), are listeners/timers cleaned up on settle? | "No" | Push back: leaked timer/listener; clear/remove on settle. |

**Lint rules that mechanize this (so review doesn't have to):**

```jsonc
// .eslintrc — flags most of the above automatically
{
  "rules": {
    "no-async-promise-executor": "error",   // #3: async function as executor
    "no-promise-executor-return": "error",  // returning a value from an executor (a smell)
    "require-await": "error",               // #4: async with no await
    "@typescript-eslint/require-await": "error",
    "@typescript-eslint/no-floating-promises": "error", // catches dropped Promises generally
    "@typescript-eslint/promise-function-async": "off"  // do NOT force async on Promise-returning fns
  }
}
```

- **Python:** `flake8-async` / `ruff` rules (e.g. `RUF006`, `ASYNC`-prefixed checks) flag orphaned tasks and bare `ensure_future`; `pylint` warns on a coroutine that is never awaited. Type-checkers (`mypy`, `pyright`) flag a coroutine used where a value is expected (the Exercise 13 hazard).
- **TypeScript in general:** the type system is your best defense — `Promise<T>` does not assign to `T`, so a forgotten `await` is often a compile error.

**Why this is better than "review for async correctness."** Each row has a *trigger* and a *fix*, so two reviewers reach the same verdict, and rows #1–#4 are exactly the anti-patterns this file teaches. But the real win is mechanization: `no-async-promise-executor` and `require-await` turn the two named anti-patterns into build failures, so they never reach a human reviewer at all. The checklist then covers only the judgment calls (#5, #6) that a linter cannot make — keeping the human attention where it is actually needed.

</details>

---

## Summary

- The two misuse anti-patterns share a root: **async ceremony that buys no concurrency**. The Promise Constructor anti-pattern wraps something already asynchronous; `async` without `await` marks something that never suspends. Both add cost, and the first routinely *loses errors*.
- **Never wrap a Promise in `new Promise`.** A `.then` chain, an `async` call, a `fetch` — these are already Promises. Return them (or `await` them) and rejections propagate for free. Wrapping them re-implements Promise machinery *and*, if you forget `reject`, leaves the Promise pending forever — the worst failure mode, because it produces no signal at all.
- **`new Promise` is the right tool for exactly one job:** bridging a **callback / timer / event** API that has no Promise of its own (`setTimeout`, error-first callbacks, `EventEmitter`). When you do, wire **both** `resolve` and `reject`, and **clean up** the timer/listener on settle. Exercises 5, 6, 9, 10, 11 are the legitimate cases — internalize the contrast with 1–4.
- **Drop `async` when the body never awaits** — except when `async` deliberately *normalizes* a sometimes-sync API into a single `Promise` shape (Exercise 8). The deciding question is always: *does any code path await?*
- **The `async` Promise executor (`new Promise(async ...)`) is doubly wrong** — redundant *and* an error leak — and collapses to a plain `async` function every time.
- **Mechanize the cure.** `no-async-promise-executor` and `require-await` turn both anti-patterns into build failures; leave the linter the rote checks and the reviewer the judgment calls.

---

## Related Topics

- [`junior.md`](junior.md) — the two shapes and how to recognize them on sight.
- [`middle.md`](middle.md) — why the constructor wrapper loses errors, and the cures applied here.
- [`find-bug.md`](find-bug.md) — spot-the-misuse snippets (critical reading practice).
- [`optimize.md`](optimize.md) — more flawed implementations to make correct and idiomatic.
- [`interview.md`](interview.md) — Q&A across all levels for job prep.
- [Async Anti-Patterns overview](../README.md) — the chapter and the other two categories (Error Handling, Execution Shape).
- [Error Handling category](../01-error-handling/README.md) — Swallowed Rejection and Floating Promise, the failures these misuses cause.
- [Execution Shape category](../02-execution-shape/README.md) — `await`-in-a-loop and Mixing Callbacks and Promises, near neighbors of these exercises.
- [Concurrency Anti-Patterns](../../03-concurrency/README.md) — the multi-thread sibling chapter (different failure modes).
- [Functional Programming → Async](../../../functional-programming/README.md) — composing Promises without re-wrapping them.
