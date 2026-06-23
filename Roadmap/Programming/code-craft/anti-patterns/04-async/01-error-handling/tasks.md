# Async Error-Handling Anti-Patterns — Exercises

> **Category:** [Async Anti-Patterns](../README.md) → **Error Handling** — *hands-on practice making async failures impossible to lose.*
> **Covers (collectively):** Swallowed Promise Rejection · Floating Promise · Fire-and-Forget Without Logging · Forgotten `await`

---

These are **fix-it** exercises, not recognition quizzes. Each one gives you a problem statement, a starting snippet (mostly **JavaScript / TypeScript**, some **Python `asyncio`**), acceptance criteria with hints, and a collapsible solution carrying the idiomatic fix and a *why it's better* note. The four anti-patterns in this category share one disease — **a Promise that fails with nobody watching** — and they compound: a forgotten `await` *creates* a floating Promise, a floating Promise *becomes* a swallowed rejection, and fire-and-forget is a swallowed rejection you chose on purpose.

> **How to use this file.** Read the problem, try it in your editor *before* opening the solution, then compare. The note under each solution matters more than the diff: the goal is not "add a `.catch`" but "make sure every failure has exactly one owner." Refer back to [`junior.md`](junior.md) for what each anti-pattern looks like and [`middle.md`](middle.md) for the cures applied here.

---

## Table of Contents

| # | Exercise | Anti-pattern(s) | Lang | Difficulty |
|---|---|---|---|---|
| 1 | [Catch the swallowed rejection](#exercise-1--catch-the-swallowed-rejection) | Swallowed Rejection | JS | ★ easy |
| 2 | [Fix the forgotten `await`](#exercise-2--fix-the-forgotten-await) | Forgotten `await` | TS | ★ easy |
| 3 | [Anchor the floating Promise](#exercise-3--anchor-the-floating-promise) | Floating Promise | TS | ★ easy |
| 4 | [Stop swallowing in Python `asyncio`](#exercise-4--stop-swallowing-in-python-asyncio) | Swallowed Rejection | Python | ★ easy |
| 5 | [Make fire-and-forget observable](#exercise-5--make-fire-and-forget-observable) | Fire-and-Forget | TS | ★★ medium |
| 6 | [`Promise.all` → `allSettled` for partial results](#exercise-6--promiseall--allsettled-for-partial-results) | Swallowed Rejection (partial loss) | TS | ★★ medium |
| 7 | [The forgotten `await` that hides a `try/catch`](#exercise-7--the-forgotten-await-that-hides-a-trycatch) | Forgotten `await` + Swallowed | JS | ★★ medium |
| 8 | [Install a global `unhandledRejection` net](#exercise-8--install-a-global-unhandledrejection-net) | Swallowed Rejection (last line of defense) | Node | ★★ medium |
| 9 | [Capture the floating loop](#exercise-9--capture-the-floating-loop) | Floating Promise + Forgotten `await` | Python | ★★ medium |
| 10 | [Supervise the background task properly](#exercise-10--supervise-the-background-task-properly) | Fire-and-Forget | TS | ★★★ hard |
| 11 | [Move fire-and-forget to a durable queue](#exercise-11--move-fire-and-forget-to-a-durable-queue) | Fire-and-Forget (durability) | TS | ★★★ hard |
| 12 | [Configure TS + ESLint `no-floating-promises`](#exercise-12--configure-ts--eslint-no-floating-promises) | meta (prevention) | config | ★★ medium |
| 13 | [Judgment call: when fire-and-forget is acceptable](#exercise-13--judgment-call-when-fire-and-forget-is-acceptable) | Fire-and-Forget (the defensible case) | TS | ★★★ hard |
| 14 | [Mini-project: harden the notification service](#exercise-14--mini-project-harden-the-notification-service) | All four | TS | ★★★★ project |

---

## Exercise 1 — Catch the swallowed rejection

**Anti-pattern:** Swallowed Rejection · **Language:** JavaScript · **Difficulty:** ★ easy

This handler registers a success continuation but no failure one. If `saveProfile` rejects, the error becomes an unhandled rejection — invisible in most setups, a crashed process in strict ones.

```js
function updateProfile(req, res) {
  saveProfile(req.body).then((saved) => {
    res.json(saved);
  });
  // No .catch — if saveProfile rejects, res never responds and the
  // rejection floats off into the runtime. The client hangs until timeout.
}
```

**Acceptance criteria**
- Every rejection of `saveProfile` produces a response (don't leave the client hanging).
- The success path is unchanged.
- The error is logged with enough context to debug it.

**Hint:** the minimal fix is a `.catch`; the idiomatic fix is `async/await` with `try/catch`, which keeps the success and failure paths next to each other.

<details>
<summary>Solution</summary>

```js
async function updateProfile(req, res) {
  try {
    const saved = await saveProfile(req.body);
    res.json(saved);
  } catch (err) {
    logger.error("updateProfile failed", { userId: req.body.id, err });
    res.status(500).json({ error: "could not save profile" });
  }
}
```

Or, if you must stay in `.then` style, the rejection still needs an owner:

```js
function updateProfile(req, res) {
  saveProfile(req.body)
    .then((saved) => res.json(saved))
    .catch((err) => {
      logger.error("updateProfile failed", { userId: req.body.id, err });
      res.status(500).json({ error: "could not save profile" });
    });
}
```

**Why it's better.** Every outcome — success or failure — now ends in a response, so the client never hangs. The `async/await` form is preferable because the failure handler sits directly beside the code that can fail, instead of being a `.catch` you must remember to chain. The log line carries `userId` and the error, so an on-call engineer can find the offending request instead of seeing a context-free "UnhandledPromiseRejection" in the logs.

</details>

---

## Exercise 2 — Fix the forgotten `await`

**Anti-pattern:** Forgotten `await` · **Language:** TypeScript · **Difficulty:** ★ easy

This compiles and runs. It is also wrong: `getUser` returns a `Promise<User>`, not a `User`, and nobody waited for it.

```ts
async function greet(id: string): Promise<string> {
  const user = getUser(id);          // forgot await — user is Promise<User>
  return `Hello, ${user.name}`;      // user.name is undefined → "Hello, undefined"
}

declare function getUser(id: string): Promise<User>;
interface User { name: string }
```

**Acceptance criteria**
- `greet` returns a string built from the *resolved* user, not a Promise.
- Explain why TypeScript did not stop this (and what would have).

**Hint:** `await` the call. Then ask: under `strict` typing, should `user.name` have errored? It depends on how the field is accessed.

<details>
<summary>Solution</summary>

```ts
async function greet(id: string): Promise<string> {
  const user = await getUser(id);    // user: User
  return `Hello, ${user.name}`;
}
```

**Why TypeScript let the bug through.** `Promise<User>` has no `name` property, so `user.name` *should* be a type error — and in `greet` above it would be. The reason this class of bug survives in real code is subtler: the forgotten `await` often sits on a call whose result is *discarded* (e.g. `getUser(id);` on its own line, or passed to something typed `any`/`unknown`), where there is no property access to flag. That is exactly what the `@typescript-eslint/no-floating-promises` rule exists to catch (see [Exercise 12](#exercise-12--configure-ts--eslint-no-floating-promises)).

**Why it's better.** With `await`, `user` is a real `User`, the template literal interpolates a real name, and the function only resolves once the data is actually present. The async-ness is now visible at the line that pays for it.

</details>

---

## Exercise 3 — Anchor the floating Promise

**Anti-pattern:** Floating Promise · **Language:** TypeScript · **Difficulty:** ★ easy

The cache refresh is started and immediately abandoned. If it rejects, the rejection is unhandled; if it matters, the caller has no idea whether it finished.

```ts
async function handleRequest(req: Request): Promise<Response> {
  refreshCache(req.tenantId);   // floating — not awaited, no .catch
  return serve(req);
}
```

There are two legitimate intents here, and they need *different* fixes. Handle both.

**Acceptance criteria**
- **Case A — the refresh must finish before responding:** the response waits for it, and a failure propagates.
- **Case B — the refresh is genuinely background:** it is no longer *floating* (it has an error handler), even though it is not awaited.
- No bare, unobserved Promise remains in either case.

**Hint:** "floating" means *no `await` AND no `.catch`*. Case A removes the float by awaiting; Case B removes it by attaching a handler and marking the intent with `void`.

<details>
<summary>Solution</summary>

**Case A — refresh is part of serving the request:**

```ts
async function handleRequest(req: Request): Promise<Response> {
  await refreshCache(req.tenantId);   // now a failure rejects handleRequest
  return serve(req);
}
```

**Case B — refresh is fire-and-forget, but observed:**

```ts
async function handleRequest(req: Request): Promise<Response> {
  // `void` documents "intentionally not awaited"; the .catch makes it non-floating.
  void refreshCache(req.tenantId).catch((err) =>
    logger.warn("background cache refresh failed", { tenantId: req.tenantId, err }),
  );
  return serve(req);
}
```

**Why it's better.** The original code reads identically to both intents but commits to neither, so the bug is "which one did the author mean?" Case A makes the dependency explicit: the response cannot be served with a stale cache, and a refresh failure surfaces. Case B keeps the work in the background — but the `.catch` means a failure is logged instead of vanishing, and the `void` keyword tells the next reader (and the linter) "yes, this is deliberately unawaited." A bare `refreshCache(...)` says none of that. Note that Case B is the *start* of doing fire-and-forget right; [Exercise 5](#exercise-5--make-fire-and-forget-observable) and [Exercise 10](#exercise-10--supervise-the-background-task-properly) go further.

</details>

---

## Exercise 4 — Stop swallowing in Python `asyncio`

**Anti-pattern:** Swallowed Rejection · **Language:** Python (`asyncio`) · **Difficulty:** ★ easy

`asyncio.create_task` schedules a coroutine and returns immediately. If the task raises and nobody ever `await`s it (or its exception), the error is logged only when the task object is garbage-collected — long after the fact, with no context — or swallowed entirely.

```python
import asyncio

async def on_message(msg):
    asyncio.create_task(process(msg))   # task's exception is never observed
    return "queued"

async def process(msg):
    raise RuntimeError(f"bad message: {msg!r}")
```

**Acceptance criteria**
- A failure in `process` is logged at the moment it happens, with the message context.
- The endpoint still returns immediately (do not block `on_message` on `process`).
- The task is not garbage-collected while still running.

**Hint:** keep a reference to the task and attach a *done callback* that inspects `task.exception()`. The done-callback is the `asyncio` equivalent of `.catch`.

<details>
<summary>Solution</summary>

```python
import asyncio
import logging

log = logging.getLogger(__name__)
_background_tasks: set[asyncio.Task] = set()

def _supervise(task: asyncio.Task) -> None:
    _background_tasks.discard(task)
    if task.cancelled():
        return
    exc = task.exception()
    if exc is not None:
        log.error("background task failed", exc_info=exc)

async def on_message(msg):
    task = asyncio.create_task(process(msg))
    _background_tasks.add(task)            # keep a strong ref so it isn't GC'd mid-flight
    task.add_done_callback(_supervise)     # observe the result, log any exception
    return "queued"

async def process(msg):
    raise RuntimeError(f"bad message: {msg!r}")
```

**Why it's better.** `task.add_done_callback(_supervise)` guarantees the exception is *read* — calling `task.exception()` marks it retrieved and lets you log it with `exc_info` at the moment of failure, not whenever the GC happens to run. The `_background_tasks` set fixes a second, lesser-known `asyncio` footgun: the event loop only holds a *weak* reference to tasks, so a task with no other reference can be collected and silently cancelled mid-execution; pinning it in a set (and discarding on completion) keeps it alive. `on_message` still returns "queued" immediately. In modern code, prefer `asyncio.TaskGroup` (3.11+) when you can *await* the group — but for true fire-and-forget that outlives the handler, the supervised-task pattern above is the correct shape.

</details>

---

## Exercise 5 — Make fire-and-forget observable

**Anti-pattern:** Fire-and-Forget Without Logging · **Language:** TypeScript · **Difficulty:** ★★ medium

Sending the welcome email should not block signup — so it is fired and forgotten. But "forgotten" is literal here: if the mail provider is down, *every* welcome email silently fails and no graph ever moves.

```ts
async function signup(input: SignupInput): Promise<User> {
  const user = await createUser(input);
  sendWelcomeEmail(user.email);   // fire-and-forget: no await, no catch, no metric
  return user;
}
```

**Acceptance criteria**
- Signup latency is unaffected (the email is still not awaited).
- A failure is **logged** with context.
- A failure (and a success) is **counted** in a metric, so a provider outage is visible on a dashboard / alertable.
- Nothing floats: the Promise has an owner.

**Hint:** wrap the background call in a small helper that logs and increments a counter in both branches, then `void` it. "Observable" means *log + metric*, not just a `.catch` that logs.

<details>
<summary>Solution</summary>

```ts
// A reusable "fire, but watch it land" helper.
function runBackground(
  name: string,
  work: () => Promise<unknown>,
): void {
  void work()
    .then(() => metrics.increment("background_task_ok", { name }))
    .catch((err) => {
      metrics.increment("background_task_error", { name });
      logger.error("background task failed", { name, err });
    });
}

async function signup(input: SignupInput): Promise<User> {
  const user = await createUser(input);
  runBackground("welcome_email", () => sendWelcomeEmail(user.email));
  return user;
}
```

**Why it's better.** The email is still off the critical path, so signup is just as fast. But now a provider outage is *visible*: `background_task_error{name="welcome_email"}` climbs, an alert fires, and the log line tells you which user and which error. Compare that with the original, where the only signal of a total mail outage would be confused customer-support tickets days later. The `runBackground` helper also centralizes the pattern — every fire-and-forget in the codebase goes through one observable chokepoint instead of each call site inventing (or forgetting) its own handling. See [`senior.md`](senior.md) for instrumenting async failures at scale.

> This is "fire-and-forget done responsibly." If losing the work is unacceptable even with logging — e.g. the email is contractually required — logging is not enough; you need durability. That is [Exercise 11](#exercise-11--move-fire-and-forget-to-a-durable-queue).

</details>

---

## Exercise 6 — `Promise.all` → `allSettled` for partial results

**Anti-pattern:** Swallowed Rejection (partial-result loss) · **Language:** TypeScript · **Difficulty:** ★★ medium

This dashboard fans out to three independent services with `Promise.all`. The intent is "show whatever loads." The behavior is "if *any one* fails, throw away the other two and render nothing."

```ts
async function loadDashboard(userId: string): Promise<Dashboard> {
  const [profile, orders, recs] = await Promise.all([
    fetchProfile(userId),
    fetchOrders(userId),
    fetchRecommendations(userId),
  ]);
  return { profile, orders, recs };
}
```

`Promise.all` rejects on the *first* rejection and discards every other result — including ones that already resolved. A flaky recommendations service takes down the whole page.

**Acceptance criteria**
- A failure in one of the three does **not** discard the successful ones.
- The caller can tell which sections loaded and which failed (failures are not silently dropped — they are logged / surfaced as a degraded section).
- Sections that load are still rendered.

**Hint:** `Promise.allSettled` never rejects — it resolves with a `{status}` per input. Branch on `status` per section; do not just `?? null` the failures away, or you have swallowed the rejection a second time.

<details>
<summary>Solution</summary>

```ts
type Section<T> = { ok: true; value: T } | { ok: false };

async function loadDashboard(userId: string): Promise<{
  profile: Section<Profile>;
  orders: Section<Order[]>;
  recs: Section<Rec[]>;
}> {
  const [profile, orders, recs] = await Promise.allSettled([
    fetchProfile(userId),
    fetchOrders(userId),
    fetchRecommendations(userId),
  ]);

  const settle = <T>(r: PromiseSettledResult<T>, name: string): Section<T> => {
    if (r.status === "fulfilled") return { ok: true, value: r.value };
    logger.warn("dashboard section failed", { userId, section: name, err: r.reason });
    return { ok: false };
  };

  return {
    profile: settle(profile, "profile"),
    orders: settle(orders, "orders"),
    recs: settle(recs, "recs"),
  };
}
```

**Why it's better.** `allSettled` lets every request run to completion, so one flaky service degrades a single card instead of nuking the page. Crucially, the failure is *not* swallowed: the `settle` helper logs each rejection with its section name before returning `{ ok: false }`, so the UI can render "recommendations unavailable" *and* an engineer can see the cause in the logs. The naive `.catch(() => null)` "fix" people reach for would hide the failure entirely — trading a loud crash for a silent one, which is worse. Use `Promise.all` when the operations are a *unit* (all-or-nothing); use `allSettled` when they are *independent* and partial success is meaningful.

</details>

---

## Exercise 7 — The forgotten `await` that hides a `try/catch`

**Anti-pattern:** Forgotten `await` + Swallowed Rejection · **Language:** JavaScript · **Difficulty:** ★★ medium

This looks defensive — it has a `try/catch`! But the `await` is missing, so the `try` block exits *before* `charge` rejects. The rejection escapes the `catch` entirely and floats.

```js
async function checkout(cart) {
  try {
    const result = chargeCard(cart.total);   // missing await
    return { ok: true, id: result.txId };     // result is a Promise → txId undefined
  } catch (err) {
    // This never fires. The rejection happens AFTER the try block has returned.
    return { ok: false, reason: err.message };
  }
}
```

**Acceptance criteria**
- A rejection from `chargeCard` is actually caught by the `catch`.
- `result.txId` reads the resolved transaction id, not a property of a Promise.
- Explain *why* the original `catch` was dead.

**Hint:** a `try/catch` only catches a rejected Promise if you `await` it inside the `try`. Without `await`, the function returns a not-yet-settled Promise and the error surfaces later, with no `catch` on the stack.

<details>
<summary>Solution</summary>

```js
async function checkout(cart) {
  try {
    const result = await chargeCard(cart.total);   // await: now the catch can see a rejection
    return { ok: true, id: result.txId };
  } catch (err) {
    return { ok: false, reason: err.message };
  }
}
```

**Why the original `catch` was dead.** `try/catch` catches *synchronous* throws and the rejection of an *awaited* Promise. Without `await`, `chargeCard(cart.total)` synchronously returns a pending Promise — no throw happens inside the `try`, so the block completes and the function returns. When the Promise later rejects, the `try/catch` is long gone from the call stack; the rejection becomes an unhandled rejection. The missing `await` simultaneously broke the value (`result` was a Promise, so `result.txId` was `undefined`) and the error handling. This pairing — forgotten `await` *plus* a `try/catch` that gives false confidence — is one of the nastiest async bugs because the code *looks* correct.

**Why it's better.** One keyword fixes both halves: `await` makes `result` the real charge result, and it puts the rejection back inside the `try` where the `catch` can convert it into a clean `{ ok: false }` outcome.

</details>

---

## Exercise 8 — Install a global `unhandledRejection` net

**Anti-pattern:** Swallowed Rejection (last line of defense) · **Language:** Node.js · **Difficulty:** ★★ medium

Per-call `.catch` is the first line of defense; bugs slip through it. A process-level handler ensures that a rejection nobody caught is at least *loud*, and lets you decide the process's fate deliberately instead of relying on Node's changing defaults.

Starting point: an app with no global handler. Add one.

```js
// index.js — no safety net. A single forgotten .catch anywhere can
// either crash the process abruptly or (worse) be silently ignored,
// depending on Node version and flags.
startServer();
```

**Acceptance criteria**
- An otherwise-unhandled rejection is logged with the reason and a stack.
- The handler makes a *deliberate* decision about the process (crash-and-restart vs. continue), with a comment explaining the choice.
- Note explicitly that this is a *net*, not a substitute for local handling.

**Hint:** listen for `process.on("unhandledRejection", ...)`. The defensible default for a server behind a supervisor (systemd / Kubernetes) is to log, then exit non-zero so the orchestrator restarts a process now in unknown state.

<details>
<summary>Solution</summary>

```js
// index.js
process.on("unhandledRejection", (reason, promise) => {
  // A rejection reached the top of the stack — a real bug, not normal flow.
  logger.error("UNHANDLED REJECTION — crashing for a clean restart", {
    reason: reason instanceof Error ? { message: reason.message, stack: reason.stack } : reason,
  });
  // The process may now be in an inconsistent state (a transaction half-applied,
  // a lock unreleased). Crash and let the supervisor restart a fresh process,
  // rather than limp along corrupting more state. Give logs/metrics a moment to flush.
  setTimeout(() => process.exit(1), 100).unref();
});

// Symmetric net for the synchronous side.
process.on("uncaughtException", (err) => {
  logger.error("UNCAUGHT EXCEPTION — crashing", { message: err.message, stack: err.stack });
  setTimeout(() => process.exit(1), 100).unref();
});

startServer();
```

**Why it's better.** Before, a single missed `.catch` had an undefined fate (Node has, across versions, warned, done nothing, *and* hard-crashed by default). Now there is one explicit policy: log it loudly with a stack, then exit so a supervisor restarts a clean process. The comment is load-bearing — it explains *why* crashing is safer than continuing (the process may hold half-applied state), which is the non-obvious part. The `.unref()` timer lets buffered logs flush before exit without keeping the process alive on its own.

**This is a net, not a cure.** Reaching this handler means a `.catch` was missing somewhere upstream; the fix is still to find and handle that rejection at its source. A global handler that *swallows* (logs and continues for everything) just relocates the swallowing to one central place — equally bad. Treat every hit on this handler as a bug to be tracked down, ideally with the linter from [Exercise 12](#exercise-12--configure-ts--eslint-no-floating-promises) preventing it in the first place.

</details>

---

## Exercise 9 — Capture the floating loop

**Anti-pattern:** Floating Promise + Forgotten `await` · **Language:** Python (`asyncio`) · **Difficulty:** ★★ medium

This is meant to ping every host concurrently and report failures. It does neither: the coroutine is *called* but never awaited, so nothing actually runs, and any error is invisible.

```python
import asyncio

async def ping(host):
    # ... raises ConnectionError if the host is down ...
    ...

async def health_check(hosts):
    for host in hosts:
        ping(host)          # creates a coroutine object, never awaited — does nothing
    return "checked"        # lies: nothing was checked
```

Calling `ping(host)` without `await` produces a coroutine object that is discarded; Python even emits a `RuntimeWarning: coroutine 'ping' was never awaited` — but only sometimes, and only to stderr.

**Acceptance criteria**
- All hosts are actually pinged, **concurrently** (not one-at-a-time).
- A failure for one host does not abort the others, and every failure is collected/reported.
- No coroutine is created and dropped on the floor.

**Hint:** turn each coroutine into a task (or pass the coroutines to `asyncio.gather`), and use `return_exceptions=True` so one failure doesn't cancel the rest — the `gather` analogue of `Promise.allSettled`.

<details>
<summary>Solution</summary>

```python
import asyncio
import logging

log = logging.getLogger(__name__)

async def ping(host):
    ...  # raises ConnectionError if the host is down

async def health_check(hosts):
    results = await asyncio.gather(
        *(ping(h) for h in hosts),
        return_exceptions=True,        # one failure doesn't cancel the others
    )
    failures = {}
    for host, result in zip(hosts, results):
        if isinstance(result, Exception):
            log.warning("health check failed", extra={"host": host})
            failures[host] = result
    return {"checked": len(hosts), "failures": failures}
```

**Why it's better.** Each `ping(h)` coroutine is now handed to `asyncio.gather`, which schedules them all and awaits the set — so they run *concurrently* and are genuinely executed, not dropped. `return_exceptions=True` is the key: without it, `gather` would propagate the first `ConnectionError` and cancel the remaining pings (the `Promise.all` failure mode); with it, every host is probed and failures come back as values you can inspect. The function now returns honest data — how many were checked and exactly which failed — instead of a `"checked"` string that was never true. The `RuntimeWarning` disappears because no coroutine is left unawaited.

</details>

---

## Exercise 10 — Supervise the background task properly

**Anti-pattern:** Fire-and-Forget Without Logging · **Language:** TypeScript · **Difficulty:** ★★★ hard

A worker kicks off a long-running reconciliation on startup and forgets it. It is unobserved, un-cancellable, and if it throws, the process learns nothing. Turn it into a *supervised* task: tracked, logged, metered, and cancellable on shutdown.

```ts
class Worker {
  start() {
    this.reconcileForever();   // floating + fire-and-forget + un-cancellable
  }

  private async reconcileForever() {
    while (true) {
      await reconcile();
      await sleep(60_000);
    }
  }
}
```

**Acceptance criteria**
- The loop's failures are logged and counted (observable).
- A transient error in one iteration does not kill the whole loop forever; a fatal/unexpected one is surfaced loudly.
- On shutdown, the loop can be **cancelled** and `stop()` awaits it draining.
- The task is tracked (not a bare floating Promise).

**Hint:** hold the task Promise in a field; drive cancellation with an `AbortController`; wrap each iteration in `try/catch` so one bad cycle logs-and-continues rather than tearing down the supervisor.

<details>
<summary>Solution</summary>

```ts
class Worker {
  private task?: Promise<void>;
  private readonly abort = new AbortController();

  start(): void {
    // Tracked (held in `this.task`) and supervised: the .catch is the
    // top-level net for anything the inner loop fails to handle.
    this.task = this.reconcileForever().catch((err) => {
      metrics.increment("reconcile_loop_crashed");
      logger.error("reconcile loop crashed", { err });
    });
  }

  async stop(): Promise<void> {
    this.abort.abort();        // signal the loop to exit
    await this.task;           // drain: don't return until it has actually stopped
  }

  private async reconcileForever(): Promise<void> {
    while (!this.abort.signal.aborted) {
      try {
        await reconcile();
        metrics.increment("reconcile_ok");
      } catch (err) {
        // One bad cycle is transient: log, count, and keep the loop alive.
        metrics.increment("reconcile_error");
        logger.warn("reconcile iteration failed; retrying next cycle", { err });
      }
      await sleep(60_000, this.abort.signal);   // cancellable sleep
    }
  }
}
```

**Why it's better.** Four things changed, each closing a hole in the original:

1. **Tracked, not floating** — the task lives in `this.task`, so `stop()` can await it.
2. **Observable** — every iteration increments a success/error counter and logs failures, so a stuck or failing loop shows up on a dashboard instead of being invisible.
3. **Resilient** — the inner `try/catch` means a single transient `reconcile()` failure logs and the loop continues next cycle, rather than throwing out of the loop and ending reconciliation silently forever (the worst original behavior). The *outer* `.catch` is the supervisor: it only fires if something escapes the loop itself, and it makes that loud.
4. **Cancellable** — an `AbortController` lets `stop()` break the loop and the cancellable `sleep` so shutdown is clean and bounded, not a `kill -9`.

This is the structured-concurrency principle in practice: a spawned task has an owner who can observe and stop it. See [`professional.md`](professional.md) for the event-loop and structured-concurrency theory behind this shape.

</details>

---

## Exercise 11 — Move fire-and-forget to a durable queue

**Anti-pattern:** Fire-and-Forget (durability) · **Language:** TypeScript · **Difficulty:** ★★★ hard

The invoice email is contractually required — losing it is a compliance problem, not a UX wrinkle. It is currently fired-and-forgotten in-process, which means it is lost on *any* of: a rejection, a deploy, a crash, or a scale-down between firing and sending.

```ts
async function finalizeInvoice(invoice: Invoice): Promise<void> {
  await db.markFinalized(invoice.id);
  sendInvoiceEmail(invoice);   // in-process fire-and-forget — lost if this pod dies
}
```

Logging (Exercise 5) makes failures *visible*, but a visible-yet-lost legally-required email is still a lost email. When the work **must not be lost**, observability is not enough — you need durability.

**Acceptance criteria**
- The email work survives a process crash between "invoice finalized" and "email sent."
- `finalizeInvoice` does not block on actually sending the email.
- The enqueue is part of the same transactional boundary as the finalize, so you cannot finalize-without-enqueue or enqueue-without-finalize.
- Retries/backoff are the queue's job, not inline code.

**Hint:** persist the *intent to send* in the same database transaction that finalizes the invoice (the **transactional outbox** pattern), then let a separate worker deliver it with retries. The handoff is durable because it is a committed DB row, not an in-memory Promise.

<details>
<summary>Solution</summary>

```ts
// 1) Enqueue durably, in the SAME transaction as the state change.
async function finalizeInvoice(invoice: Invoice): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.markFinalized(invoice.id);
    // The "outbox" row is committed atomically with the finalize.
    // If the commit succeeds, the email WILL be attempted; if it rolls
    // back, neither happened. No window where one occurs without the other.
    await tx.insertOutbox({
      type: "invoice_email",
      payload: { invoiceId: invoice.id },
    });
  });
  // Return immediately — delivery is the worker's job.
}

// 2) A separate worker drains the outbox with retries/backoff and
//    at-least-once delivery. It is the only thing that touches the mail provider.
async function outboxWorker(): Promise<void> {
  for (;;) {
    const batch = await db.claimOutbox({ type: "invoice_email", limit: 50 });
    for (const row of batch) {
      try {
        await sendInvoiceEmail(row.payload.invoiceId);
        await db.markOutboxDone(row.id);
        metrics.increment("invoice_email_sent");
      } catch (err) {
        // Leave the row unclaimed/retryable; the queue handles backoff.
        metrics.increment("invoice_email_retry");
        logger.warn("invoice email delivery failed; will retry", { id: row.id, err });
      }
    }
    await sleep(1_000);
  }
}
```

(In production you would more often use a dedicated broker — SQS / RabbitMQ / a job system like BullMQ — but the *transactional outbox* shown here is what makes the enqueue atomic with the DB write; a broker enqueue done *outside* the transaction reintroduces the lost-work window.)

**Why it's better.** The in-process version had a fatal window: between `markFinalized` committing and `sendInvoiceEmail` finishing, a crash or deploy loses the email forever, and nothing in the system remembers it was owed. The outbox closes that window by making "we owe this email" a *committed database fact* in the same transaction as the finalize — so it is impossible to finalize without an enqueued email or vice versa. A separate worker then delivers with retries and at-least-once semantics; if the mail provider is down for an hour, the rows wait and are sent when it recovers, instead of being dropped. This is the line between "fire-and-forget done responsibly" (Exercise 5: visible, but in-memory) and "work that cannot be lost" (durable). Choose durability when *losing the work has a cost the business will not accept*. See [Background Jobs / Message Queues](../../../../../Backend/distributed-systems/README.md) for broker selection and delivery guarantees.

</details>

---

## Exercise 12 — Configure TS + ESLint `no-floating-promises`

**Anti-pattern:** meta (prevention) · **Language:** config (TypeScript + ESLint) · **Difficulty:** ★★ medium

Every exercise so far fixed a bug *after* it was written. Floating Promises and forgotten `await`s are mechanical mistakes — the right place to catch them is the linter, on every save and in CI, before they ever reach review. Configure it.

**Acceptance criteria**
- A floating Promise (`doAsync();` with no `await`/`.catch`/`void`) is a **lint error**, not a warning.
- A forgotten `await` whose result is used is caught by the type checker.
- The escape hatch for *intentional* fire-and-forget (`void promise.catch(...)`) is allowed without a lint suppression comment.
- Note why these rules require **type-aware** linting (and the cost that implies).

**Hint:** use `@typescript-eslint`'s `no-floating-promises` and `no-misused-promises`, which need `parserOptions.project` pointing at your `tsconfig.json` because they consult the type checker. Pair with `tsconfig` `strict` so `Promise<T>` never assigns to `T`.

<details>
<summary>Solution</summary>

**`tsconfig.json`** — strict typing is the foundation; it makes a forgotten `await` whose result is *used* a type error on its own (`Promise<User>` is not a `User`):

```jsonc
{
  "compilerOptions": {
    "strict": true,              // includes strictNullChecks, etc.
    "noImplicitAny": true,
    "target": "ES2022",
    "module": "NodeNext"
  },
  "include": ["src/**/*.ts"]
}
```

**`eslint.config.js`** (flat config, ESLint 9) — type-aware rules that catch the *discarded* floating Promise the type checker can't see:

```js
import tseslint from "typescript-eslint";

export default tseslint.config({
  files: ["src/**/*.ts"],
  languageOptions: {
    parserOptions: {
      // Required: these rules consult the type checker, so they need the program.
      projectService: true,
      tsconfigRootDir: import.meta.dirname,
    },
  },
  plugins: { "@typescript-eslint": tseslint.plugin },
  rules: {
    // A Promise that is neither awaited, returned, nor explicitly voided → ERROR.
    "@typescript-eslint/no-floating-promises": [
      "error",
      { ignoreVoid: true },   // `void p.catch(...)` is the sanctioned escape hatch
    ],
    // Catches a Promise passed where a sync value/void is expected
    // (e.g. an async function used as a non-async event handler).
    "@typescript-eslint/no-misused-promises": "error",
    // Optional: flag `async` functions with no `await` (the sibling "async without await").
    "@typescript-eslint/require-await": "warn",
  },
});
```

Now the offending code from earlier exercises fails CI:

```ts
refreshCache(tenantId);          // ✗ error: Promises must be awaited, .then'd, or voided
void refreshCache(tenantId).catch(log);   // ✓ allowed — intent is explicit
await refreshCache(tenantId);             // ✓ allowed
```

**Why type-aware, and the cost.** `no-floating-promises` cannot work from syntax alone — it must *know* that `refreshCache(...)` returns a `Promise`, which requires the type checker. That is why `parserOptions.projectService` (or `project`) is mandatory and why these rules make linting slower and tied to a successful type build. The payoff is decisive: the entire *class* of floating-Promise and forgotten-`await` bugs becomes uncheckable-in-by-default. The `ignoreVoid: true` option is what makes the `void p.catch(...)` idiom from [Exercise 3](#exercise-3--anchor-the-floating-promise) and [Exercise 5](#exercise-5--make-fire-and-forget-observable) the *blessed* way to say "intentionally unawaited" — no `// eslint-disable` litter, just a keyword that communicates intent to both the human and the linter.

**Why it's better.** Prevention beats cure at the cheapest possible moment. A reviewer no longer has to eyeball every async call for a missing `await`; the build does it mechanically and identically every time. This is the async equivalent of a fitness test — moving the fight upstream so the bug never merges.

</details>

---

## Exercise 13 — Judgment call: when fire-and-forget *is* acceptable

**Anti-pattern:** Fire-and-Forget (the defensible case) · **Language:** TypeScript · **Difficulty:** ★★★ hard

Not every un-awaited call is a bug. Dogma ("always await everything") is as wrong as negligence. Here is a call that is *deliberately* not awaited — and that is the correct decision. Your job is to **justify or refute** it, and state the conditions under which it stops being acceptable.

```ts
async function handlePageView(req: Request): Promise<Response> {
  const page = await renderPage(req);

  // Best-effort analytics: not awaited on purpose.
  void recordPageView(req.path).catch((err) =>
    logger.debug("analytics ping dropped", { path: req.path, err }),
  );

  return page;   // the user must not wait on, or be failed by, an analytics ping
}

// recordPageView is idempotent (dedup'd by request id server-side) and best-effort:
// a dropped ping costs us one fuzzy data point, nothing more.
```

**Acceptance criteria**
- State whether this is acceptable and *why*, in terms of consequences-of-loss.
- List the specific properties that make it acceptable.
- State what change to any of those properties would flip it back into an anti-pattern.

<details>
<summary>Solution</summary>

**Verdict: acceptable — and arguably the *correct* design here.** This is fire-and-forget done right, not the anti-pattern. The anti-pattern is fire-and-forget *without observability* and *where loss matters*; here neither condition holds.

**The properties that justify it:**

1. **Loss is cheap and bounded.** A dropped analytics ping costs one imprecise data point. Nobody is mis-billed, no state is corrupted, no obligation is unmet. The *cost of loss* is the deciding variable — and here it is near zero.
2. **It must not be on the critical path.** Awaiting analytics would couple page latency (and page *failures*) to a non-essential side service. If the analytics backend is slow or down, the user should still get their page instantly. Not awaiting is therefore not just acceptable but *required* for correctness of the user-facing behavior.
3. **It is observed, not silent.** The `.catch` logs the drop (at `debug` — proportional to its low severity). It is not *floating*; it has an owner. A spike in drops is still discoverable.
4. **It is idempotent and best-effort by design.** Server-side dedup means a retry (if there were one) wouldn't double-count, and the system is explicitly designed to tolerate gaps.
5. **Intent is explicit.** The `void` keyword and the comment tell the next reader and the linter "this is deliberate," so it won't be "fixed" into an `await` by someone pattern-matching on missing keywords.

**What flips it back into an anti-pattern:**

- **If loss starts to matter** — e.g. analytics becomes the source of truth for usage-based *billing*. The moment a dropped event has a financial or compliance cost, you need the durable outbox of [Exercise 11](#exercise-11--move-fire-and-forget-to-a-durable-queue), not a best-effort ping.
- **If you remove the `.catch`** — now it is floating, failures vanish, and you cannot even tell drops are happening. Back to the anti-pattern.
- **If it stops being idempotent** — if a retried or duplicated call corrupts data, "best effort" is no longer safe to drop *or* to retry.
- **If the volume of drops becomes the signal** — at scale, "1% of pings dropped" might indicate a real outage; then `debug` logging is too quiet and you need a metric/alert (promote it toward [Exercise 5](#exercise-5--make-fire-and-forget-observable)).

**Why this exercise matters.** The lesson is not "fire-and-forget is fine" — it is that the *right question* is **"what does it cost if this work is lost, and can I see when it is?"** Answer that, and the correct shape falls out: await it (on the critical path), supervise-and-log it (background, loss tolerable), or persist it durably (loss unacceptable). Engineering judgment is choosing the cheapest shape that the consequences-of-loss permit — not mechanically awaiting everything.

</details>

---

## Exercise 14 — Mini-project: harden the notification service

**Anti-pattern:** all four, in one realistic module · **Language:** TypeScript · **Difficulty:** ★★★★ project

Below is a compact notification service that commits **every** error-handling anti-pattern in this category: a swallowed rejection, a floating Promise, a fire-and-forget with no observability, and a forgotten `await`. Harden it. Work in steps; do not try to fix it all in one edit.

```ts
class NotificationService {
  async notifyAll(userIds: string[], message: string): Promise<string> {
    // Forgotten await: loadPrefs returns a Promise, treated as the value.
    const prefs = this.loadPrefs(userIds);

    for (const id of userIds) {
      // Floating promise: sent, abandoned. If it rejects → unhandled.
      this.sendOne(id, message);
    }

    // Fire-and-forget audit, no logging, no metric, no durability.
    this.recordAudit(userIds, message);

    return "sent";   // returns before anything has actually been sent
  }

  private async loadPrefs(ids: string[]): Promise<Map<string, Prefs>> { /* ... */ }
  private async sendOne(id: string, message: string): Promise<void> { /* may reject */ }
  private async recordAudit(ids: string[], message: string): Promise<void> { /* may reject */ }
}
```

**Acceptance criteria**
- **Forgotten `await`:** `prefs` is the resolved map, used to actually filter recipients.
- **Floating Promise / Swallowed Rejection:** every `sendOne` is awaited as part of a concurrent fan-out; partial failures are collected, not dropped or thrown-on-first.
- **Fire-and-Forget:** the audit is either properly observed (logged + metered) or made durable — pick and justify.
- The return value is honest about what happened.
- Each concern is testable in isolation.

**Hint:** fix one anti-pattern per step, keeping it compiling. Order: (1) add the `await`; (2) replace the floating loop with a concurrent `allSettled` fan-out that reports failures; (3) make the audit observable/durable; (4) make the return type honest.

<details>
<summary>Solution</summary>

```ts
interface SendReport {
  attempted: number;
  succeeded: number;
  failed: { id: string; reason: unknown }[];
}

class NotificationService {
  constructor(
    private readonly outbox: Outbox,   // injected: enables durable audit + testing
    private readonly logger: Logger,
    private readonly metrics: Metrics,
  ) {}

  async notifyAll(userIds: string[], message: string): Promise<SendReport> {
    // 1) Forgotten await → awaited; prefs is now a real Map and we use it.
    const prefs = await this.loadPrefs(userIds);
    const recipients = userIds.filter((id) => prefs.get(id)?.optedIn ?? false);

    // 2) Floating loop → concurrent fan-out that never loses a failure.
    const results = await Promise.allSettled(
      recipients.map((id) => this.sendOne(id, message)),
    );

    const report: SendReport = { attempted: recipients.length, succeeded: 0, failed: [] };
    results.forEach((r, i) => {
      if (r.status === "fulfilled") {
        report.succeeded++;
      } else {
        report.failed.push({ id: recipients[i], reason: r.reason });
        this.logger.warn("notification send failed", { id: recipients[i], err: r.reason });
        this.metrics.increment("notification_send_error");
      }
    });

    // 3) Audit → durable. Losing an audit record is a compliance problem,
    //    so it goes through a transactional outbox, not in-memory fire-and-forget.
    await this.outbox.enqueue("notification_audit", { userIds: recipients, message });

    // 4) Honest return value: the caller learns exactly what happened.
    return report;
  }

  private async loadPrefs(ids: string[]): Promise<Map<string, Prefs>> { /* ... */ }
  private async sendOne(id: string, message: string): Promise<void> { /* may reject */ }
}
```

**What happened to each anti-pattern:**

- **Forgotten `await` →** `await this.loadPrefs(...)` makes `prefs` a real `Map`, so `recipients` actually filters by preference instead of silently treating a Promise as truthy.
- **Floating Promise + Swallowed Rejection →** the bare loop became `Promise.allSettled(recipients.map(...))`: sends run *concurrently*, no `sendOne` Promise floats, and every rejection is captured into `report.failed` and logged/metered rather than becoming an unhandled rejection or aborting the batch on the first failure (which a `Promise.all` would have done).
- **Fire-and-Forget →** the audit is now *durable* via an injected outbox (the [Exercise 11](#exercise-11--move-fire-and-forget-to-a-durable-queue) pattern), justified because losing an audit record has a compliance cost. Had it been best-effort, the [Exercise 5](#exercise-5--make-fire-and-forget-observable) observable-background helper would have been the right call instead — the choice follows from consequences-of-loss ([Exercise 13](#exercise-13--judgment-call-when-fire-and-forget-is-acceptable)).
- **Honest return →** `notifyAll` returns a `SendReport` (attempted / succeeded / failed) instead of the string `"sent"` that lied about completion.

**Why it's better.** The original returned `"sent"` before anything was sent, lost every per-recipient failure, could crash the process via an unhandled rejection, and dropped the audit on the floor. The hardened version is *concurrent* (faster), *complete* (every recipient attempted, partial failures surfaced), *observable* (logs + metrics per failure), *durable* (the audit survives a crash), and *honest* (the return type reflects reality). Dependencies are injected, so a test can pass a fake outbox and assert the report without a real mail provider or database — exactly the seam that the original God-method denied. Note the discipline: this was reached in four small steps, each keeping the module compiling, never a big-bang rewrite.

</details>

---

## Summary

- The four error-handling anti-patterns are one disease — **a Promise that fails with nobody watching** — in four disguises. The cure is always the same shape: **give every async failure exactly one owner.**
- **`await` it, `.catch` it, or `void`-and-`.catch` it — but never leave it bare.** A floating Promise is just a swallowed rejection that hasn't failed *yet*, and a forgotten `await` is how floating Promises are born.
- **`Promise.all` is all-or-nothing; `Promise.allSettled` (and `asyncio.gather(return_exceptions=True)`) preserves partial results.** Use `all` for a unit of work, `allSettled` for independent work where partial success is meaningful — and never "fix" a flaky `all` by silently `?? null`-ing failures, which swallows the rejection a second time.
- **Fire-and-forget exists on a spectrum** keyed to *consequences-of-loss*: best-effort-and-logged (Exercise 5/13), supervised (Exercise 10), or durable (Exercise 11). Pick the cheapest shape the cost of loss permits — neither dogmatically `await` everything nor negligently drop it.
- **Prevention scales better than cure.** A process-level `unhandledRejection` net (Exercise 8) is the last line of defense; type-aware `no-floating-promises` linting (Exercise 12) is the *first* — it makes the entire bug class fail the build before it merges.
- The four anti-patterns travel together (Exercise 14 shows all four in one method), so fixing the one in front of you weakens the gravity that pulls in the rest.

---

## Related Topics

- [`junior.md`](junior.md) — what each of the four anti-patterns looks like on first sight.
- [`middle.md`](middle.md) — the forces that create swallowed/floating/forgotten failures and the countermoves used here.
- [`senior.md`](senior.md) — instrumenting async failures and supervising background work at scale.
- [`professional.md`](professional.md) — event-loop, microtask queue, and structured-concurrency internals behind these fixes.
- [`find-bug.md`](find-bug.md) — spot-the-async-bug snippets (critical reading practice).
- [`optimize.md`](optimize.md) — make flawed async implementations correct *and* parallel.
- [`interview.md`](interview.md) — Q&A across all levels for job prep.
- [Async Anti-Patterns chapter](../README.md) — the sibling categories: Execution Shape (`await` in a loop, Promise chain hell) and Misuse (Promise constructor, `async` without `await`).
- [Concurrency Anti-Patterns](../../03-concurrency/README.md) — the multi-thread sibling chapter (locks, races, deadlocks).
- [Backend / Distributed Systems](../../../../../Backend/distributed-systems/README.md) — retries, timeouts, durable queues, and failure handling at the network layer.
