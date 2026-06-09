# Async Error-Handling Anti-Patterns — Find the Bug

> **Category:** [Async Anti-Patterns](../README.md) → **Error Handling** — *errors that fall on the floor instead of propagating.*
> **Covers (collectively):** Swallowed Promise Rejection · Floating Promise · Fire and Forget (Without Logging) · Forgotten `await`

---

This file is **critical-reading practice**. Each snippet below is a plausible chunk of real-world async code — mostly JavaScript/TypeScript, some Python `asyncio`. Your job is to read it the way a careful reviewer does and answer three questions:

> **What's the async bug? What's the user-visible impact? How do you fix it?**

These are *error-handling* anti-patterns, so the failure rarely looks like a crash on line one. It looks like code that **returns successfully while the work it promised never finished, or finished and failed with nobody listening.** A forgotten `await` turns a `Promise<User>` into a truthy object and silently defeats an authorization check. A missing `.catch()` turns a failed database write into a process-wide unhandled rejection — or worse, into silent data loss. A fire-and-forget audit log that throws disappears without a trace. The compiler is happy; the linter (if you don't have the right rule on) is happy; production is not.

> **How to use this file:** read each snippet and write your own answer *before* expanding the collapsible. The skill you're training is noticing that *the function returned but the work didn't happen* — not recalling the anti-pattern's name. One snippet is a deliberate trap: code that **looks** like a floating promise but is correctly fire-and-forget. Don't get fooled into "fixing" it.

A quick mental model you'll use repeatedly below:

- An `async` function **always** returns a `Promise`, even for `if (x)` style checks. A `Promise` object is **always truthy** — so `if (somePromise)` is `if (true)`.
- A rejected `Promise` with no `.catch()` (and no `await` inside a `try`) becomes an **unhandled rejection**. In Node ≥15 that **crashes the process** by default; in browsers it fires `unhandledrejection`; in either case the *originating* request usually already returned "200 OK."
- `Promise.all` is **fail-fast**: the first rejection rejects the whole thing, and the other promises keep running with their results (and their *errors*) discarded.
- `[].forEach(async ...)` ignores the returned promises entirely — the loop finishes before any iteration's `await` resolves.

---

## Table of Contents

1. [The admin check that always passes](#snippet-1--the-admin-check-that-always-passes)
2. [The save that reports success](#snippet-2--the-save-that-reports-success)
3. [The welcome email nobody sent](#snippet-3--the-welcome-email-nobody-sent)
4. [The handler that crashes the server later](#snippet-4--the-handler-that-crashes-the-server-later)
5. [Loading the dashboard, all or nothing](#snippet-5--loading-the-dashboard-all-or-nothing)
6. [Deleting the files one by one](#snippet-6--deleting-the-files-one-by-one)
7. [The Python audit log that ran nowhere](#snippet-7--the-python-audit-log-that-ran-nowhere)
8. [The price check that trusts a Promise](#snippet-8--the-price-check-that-trusts-a-promise)
9. [The retry that swallowed its own failure](#snippet-9--the-retry-that-swallowed-its-own-failure)
10. [The cache warmer that looks reckless](#snippet-10--the-cache-warmer-that-looks-reckless)
11. [The Python gather that lost a writer](#snippet-11--the-python-gather-that-lost-a-writer)
12. [The total that was never summed](#snippet-12--the-total-that-was-never-summed)
13. [The two-step checkout](#snippet-13--the-two-step-checkout)
14. [The metrics flush on shutdown](#snippet-14--the-metrics-flush-on-shutdown)

---

## Snippet 1 — The admin check that always passes

```ts
// TypeScript — Express route guard for an admin-only endpoint
async function getUser(id: string): Promise<User> {
  const row = await db.query("SELECT * FROM users WHERE id = $1", [id]);
  return mapUser(row);
}

export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  const user = getUser(req.session.userId);   // note: no await
  if (user.isAdmin) {
    return next();                              // proceed to admin handler
  }
  return res.status(403).json({ error: "forbidden" });
}
```

> What's the async bug? What's the user-visible impact? How do you fix it?

<details>
<summary>Answer</summary>

**Forgotten `await`** — and it's a **privilege-escalation security bug**.

`getUser` is `async`, so it returns `Promise<User>`, not `User`. The line `const user = getUser(...)` assigns a *Promise* to `user`. A Promise object has no `isAdmin` property, so `user.isAdmin` is `undefined` — but the `if` doesn't test `isAdmin`'s *value* the way you think. Re-read it: `if (user.isAdmin)` where `user` is a Promise evaluates `undefined`, which is falsy, so this particular shape would *deny everyone*. The truly dangerous variant — and the one this anti-pattern is named for — is the common refactor where the guard tests the object itself:

```ts
if (user) { return next(); }   // user is a Promise → ALWAYS truthy → everyone is "admin"
```

Either way the check is meaningless because `user` is a Promise, not a `User`. In the `user.isAdmin` form you get a silent *deny-all* (an availability bug); in the `if (user)` form you get **everyone passes the admin gate** (a security breach). Both come from the same root cause: dereferencing a Promise as if it were the resolved value.

**Why TypeScript didn't save you:** `req.session.userId` is often typed `any`, and member access on a `Promise<User>` (`.isAdmin`) is a type error only if the Promise type is preserved — many real codebases launder it through `any`/`as`. The reliable guard is the lint rule, not types alone.

**User-visible impact:** depending on the variant, either no admin can ever reach an admin route, or **any authenticated user reaches every admin route.** The latter is a CVE-class authorization bypass.

**Fix — `await` the call and make the guard async:**

```ts
export async function requireAdmin(req, res, next) {
  const user = await getUser(req.session.userId);   // now a real User
  if (!user?.isAdmin) {
    return res.status(403).json({ error: "forbidden" });
  }
  return next();
}
```

Turn on `@typescript-eslint/no-floating-promises` and `no-misused-promises` — the latter flags exactly "a Promise used in a boolean position."

</details>

---

## Snippet 2 — The save that reports success

```js
// JavaScript — a service method behind POST /profile
async function updateProfile(userId, patch) {
  const updated = { ...patch, updatedAt: Date.now() };

  db.users.update(userId, updated).catch(() => {});   // "be resilient"

  return { ok: true, profile: updated };
}
```

> What's the async bug? What's the user-visible impact? How do you fix it?

<details>
<summary>Answer</summary>

**Swallowed Promise Rejection** — causing **silent data loss**.

`db.users.update(...)` returns a Promise. The code attaches `.catch(() => {})`, which does two harmful things at once: it (a) **doesn't `await`** the write, so `updateProfile` returns *before* the database confirms anything, and (b) **swallows any rejection** into an empty function. If the write fails — constraint violation, deadlock, connection drop — the error is consumed and discarded. The function still returns `{ ok: true }`.

**User-visible impact:** the user sees "Profile saved!", closes the tab, and the change is gone. Support gets "I updated my email three times and it keeps reverting." There is **no log line, no metric, no alert** — the empty `catch` guaranteed that. This is the worst kind of bug: invisible to monitoring, visible only to confused users.

**The trap:** `.catch(() => {})` is sometimes written deliberately to "make the endpoint resilient." But resilience means *handling* the failure (retry, surface an error, compensate), not *erasing* it. An empty catch is the canonical Swallowed Rejection.

**Fix — `await`, and let failure be a failure:**

```js
async function updateProfile(userId, patch) {
  const updated = { ...patch, updatedAt: Date.now() };
  await db.users.update(userId, updated);   // throws on failure → 500, logged
  return { ok: true, profile: updated };
}
```

If you genuinely want to tolerate the failure, you must still record it:

```js
try {
  await db.users.update(userId, updated);
} catch (err) {
  logger.error({ err, userId }, "profile update failed");
  return { ok: false, error: "could not save" };   // honest response
}
```

</details>

---

## Snippet 3 — The welcome email nobody sent

```ts
// TypeScript — signup flow
async function signup(input: SignupInput): Promise<{ id: string }> {
  const user = await db.users.create(input);

  sendWelcomeEmail(user.email);     // kick off the welcome email
  trackSignup(user.id);             // analytics

  return { id: user.id };
}

async function sendWelcomeEmail(to: string) {
  const template = await loadTemplate("welcome");   // can throw: file missing
  await mailer.send({ to, subject: "Welcome!", html: template(/* ... */) });
}
```

> What's the async bug? What's the user-visible impact? How do you fix it?

<details>
<summary>Answer</summary>

**Floating Promise** *and* **Fire-and-Forget Without Logging** — combined.

`sendWelcomeEmail(user.email)` and `trackSignup(user.id)` return Promises that are neither `await`ed nor `.catch()`ed. They *float*: the work starts, but `signup` returns immediately and nothing observes the outcome.

Two distinct failure modes hide here:

1. **If `sendWelcomeEmail` rejects** (template missing, SMTP down) the rejection is unhandled. In Node ≥15 an unhandled rejection **crashes the process by default** — so a flaky mail server can take down your API after a successful signup. (See Snippet 4 for the timing of this crash.)
2. **Even if it doesn't crash**, this is fire-and-forget *without logging*: when the email silently fails, there is no record. Users complain "I never got my welcome email / verification link," and you have nothing to grep for. Analytics (`trackSignup`) silently undercounts.

**User-visible impact:** missing welcome/verification emails (sometimes blocking the user entirely if it carried a confirmation link), undercounted signup metrics, and intermittent process crashes correlated with mail-server hiccups — a brutal combination to debug because the crash happens *after* the response was sent.

**Fix — decide explicitly: is this critical or best-effort?**

If the email is part of the contract (verification link), `await` it inside the transaction's success path so failure is surfaced:

```ts
const user = await db.users.create(input);
await sendWelcomeEmail(user.email);   // failure → signup fails loudly, can retry
```

If it's genuinely best-effort, *capture* the promise and *log* the failure (and ideally hand it to a job queue/supervisor so it can retry):

```ts
const user = await db.users.create(input);
void sendWelcomeEmail(user.email).catch(err =>
  logger.error({ err, userId: user.id }, "welcome email failed"));
void trackSignup(user.id).catch(err =>
  logger.warn({ err }, "signup tracking failed"));
return { id: user.id };
```

The `void` + `.catch(log)` makes "I deliberately am not awaiting this, and I will not lose the error" explicit and lint-clean. Best of all: push the email onto a durable queue and let a worker retry — fire-and-forget in-process is never as reliable as a real job system.

</details>

---

## Snippet 4 — The handler that crashes the server later

```js
// JavaScript — Express handler; the server has run fine for months
app.post("/orders/:id/ship", async (req, res) => {
  const order = await db.orders.find(req.params.id);

  warehouse.dispatch(order);            // tell the warehouse to ship

  res.json({ status: "shipping" });     // respond to the client
});

// warehouse.dispatch is async and can reject if the warehouse API is down
async function dispatch(order) { /* await fetch(warehouseUrl, ...) */ }
```

> What's the async bug? What's the user-visible impact? How do you fix it?

<details>
<summary>Answer</summary>

**Floating Promise in a request handler** — the textbook "works for months, then takes down production."

`warehouse.dispatch(order)` is an async call whose Promise is dropped on the floor. On the happy path nothing is wrong: dispatch succeeds, the client already got `{ status: "shipping" }`, everyone's happy. That's *why it survived code review and months of traffic.*

**The latent bug:** the day the warehouse API has an outage, `dispatch` rejects. There is no `await`, no `.catch()` — it's an **unhandled promise rejection**. The response was already sent, so the *user* sees success, but the **rejection surfaces on the event loop after the handler returned**. In Node ≥15 the default `unhandledRejection` behavior **terminates the process**. One bad downstream call doesn't fail one request — it **crashes the whole server**, dropping every in-flight request on that instance. Under a sustained warehouse outage your instances crash-loop.

**User-visible impact:** orders silently not dispatched (the user was told "shipping"), *and* a site-wide outage triggered by a dependency outage. The blast radius is wildly out of proportion to the cause.

**Fix — `await` it (so the failure becomes this request's 5xx) or capture-and-log if truly async:**

```js
app.post("/orders/:id/ship", async (req, res, next) => {
  try {
    const order = await db.orders.find(req.params.id);
    await warehouse.dispatch(order);          // failure → caught → proper 502
    res.json({ status: "shipping" });
  } catch (err) {
    next(err);                                // error middleware, no process crash
  }
});
```

If dispatch genuinely shouldn't block the response, enqueue it on a durable queue and return — never leave a bare async call in a handler. As a *backstop* (not a fix), register `process.on("unhandledRejection", ...)` to log rather than crash — but the real fix is to never float the promise.

</details>

---

## Snippet 5 — Loading the dashboard, all or nothing

```ts
// TypeScript — assembling a dashboard from independent widgets
async function loadDashboard(userId: string) {
  const [profile, billing, recommendations, activity] = await Promise.all([
    fetchProfile(userId),
    fetchBilling(userId),
    fetchRecommendations(userId),   // ML service, occasionally slow/down
    fetchActivity(userId),
  ]);

  return { profile, billing, recommendations, activity };
}
```

> What's the async bug? What's the user-visible impact? How do you fix it?

<details>
<summary>Answer</summary>

**`Promise.all` fail-fast losing otherwise-good results** — a swallowed-results variant.

`Promise.all` rejects the moment *any* input rejects, and the returned aggregate gives you **nothing** — not the three widgets that succeeded. If the flaky recommendations service is down, `loadDashboard` throws, and the user's profile, billing, and activity (which all loaded fine) are thrown away with it.

Note the subtlety: the other fetches don't *stop* — they keep running to completion, but their results (and any of *their* errors) are discarded by the time `Promise.all` has already rejected. So you also can't see, in this code, whether billing *also* failed.

**User-visible impact:** one non-critical, flaky dependency makes the **entire dashboard fail to load** (white screen / error page) even though most of it was ready. The reliability of the whole page is the reliability of its *weakest* widget — multiplied, not isolated.

**Fix — use `Promise.allSettled` and degrade gracefully per-widget:**

```ts
async function loadDashboard(userId: string) {
  const [profile, billing, recommendations, activity] = await Promise.allSettled([
    fetchProfile(userId),
    fetchBilling(userId),
    fetchRecommendations(userId),
    fetchActivity(userId),
  ]);

  return {
    profile: unwrap(profile),                       // critical: rethrow if needed
    billing: unwrap(billing),
    recommendations: ok(recommendations) ?? null,   // optional: null on failure
    activity: ok(activity) ?? [],
  };
}
```

Each widget now fails (or degrades) on its own. Use `Promise.all` only when the results are genuinely **all-or-nothing**; use `allSettled` when partial success is acceptable — and *always* inspect the rejected entries so failures are logged, not silently turned into `null`.

</details>

---

## Snippet 6 — Deleting the files one by one

```js
// JavaScript — cleaning up a user's uploaded files on account deletion
async function deleteUserFiles(fileIds) {
  fileIds.forEach(async (id) => {
    await storage.delete(id);          // S3 delete
  });

  console.log(`Deleted ${fileIds.length} files`);
  return { deleted: fileIds.length };
}
```

> What's the async bug? What's the user-visible impact? How do you fix it?

<details>
<summary>Answer</summary>

**`await` inside `forEach` that doesn't actually wait** — a forgotten-await / floating-promise hybrid that `forEach` makes especially deceptive.

`Array.prototype.forEach` **ignores the return value** of its callback. Each `async (id) => { await ... }` callback returns a Promise, and `forEach` throws every one of them away. So:

- `forEach` returns *synchronously* the instant it has *launched* all the deletes — it does **not** wait for them.
- `console.log("Deleted N files")` runs and `deleteUserFiles` returns `{ deleted: N }` while the actual S3 deletes are **still in flight**.
- Any `storage.delete` that **rejects** becomes an unhandled rejection (no `await` in an awaited context, no `.catch`) → silent failure or a process crash, *after* the function already reported success.

**User-visible impact:** the account-deletion endpoint reports "deleted N files," but some (or all) deletes may still be running or may have failed. Files the user (or GDPR) expects gone are **still present** — a compliance and privacy problem — and the caller has no way to know, because the function lied about completion. If a delete throws, you may also crash the worker after the "success" response.

**Fix — `for...of` to serialize with real awaiting, or `Promise.all`/`allSettled` to parallelize safely:**

```js
// Parallel, fails loudly, actually waits:
async function deleteUserFiles(fileIds) {
  await Promise.all(fileIds.map((id) => storage.delete(id)));
  return { deleted: fileIds.length };
}

// If you need bounded concurrency, use p-limit / a semaphore; if you must
// tolerate partial failure, use allSettled and report which deletes failed.
```

`map(async)` + `Promise.all` works because `map` *keeps* the returned promises; `forEach` discards them. That single difference is the whole bug.

</details>

---

## Snippet 7 — The Python audit log that ran nowhere

```python
# Python (asyncio) — FastAPI-style handler recording a sensitive action
import asyncio

async def write_audit(actor_id: str, action: str) -> None:
    await audit_db.insert(actor_id=actor_id, action=action)   # can raise

async def transfer_funds(actor_id: str, amount: int) -> dict:
    await ledger.move(actor_id, amount)

    write_audit(actor_id, f"transfer:{amount}")   # record who did it

    return {"status": "ok"}
```

> What's the async bug? What's the user-visible impact? How do you fix it?

<details>
<summary>Answer</summary>

**Forgotten `await` in Python `asyncio` → Fire-and-Forget that never even started.**

This is the Python flavor and it's even sneakier than the JS version. In `asyncio`, calling a coroutine function `write_audit(...)` does **not run it** — it just **constructs a coroutine object** and returns it. Without `await` (or `asyncio.create_task`), the coroutine is *never scheduled on the event loop at all.* The audit insert **never happens.**

Python *may* eventually warn `RuntimeWarning: coroutine 'write_audit' was never awaited`, but only when the object is garbage-collected, often far from the bug, and easily lost in log noise.

**User-visible impact:** a financial transfer succeeds, but the **audit record is never written** — not "written and failed," literally never executed. You discover this during a security investigation or compliance audit, when the trail you depended on simply isn't there. For a `transfer_funds`-style action, a missing audit log is a serious controls failure.

Contrast with the JS floating-promise case: there the work *runs* but its error is dropped. In Python the work doesn't run *at all*. Both are "fire-and-forget," but the Python forgotten-await is more total.

**Fix — `await` it (audit is part of the operation):**

```python
async def transfer_funds(actor_id: str, amount: int) -> dict:
    await ledger.move(actor_id, amount)
    await write_audit(actor_id, f"transfer:{amount}")   # actually runs, raises on failure
    return {"status": "ok"}
```

If you truly want it concurrent, you must both **schedule** it and **retain a reference** and attach error handling — otherwise an orphaned task can be garbage-collected mid-flight:

```python
task = asyncio.create_task(write_audit(actor_id, f"transfer:{amount}"))
task.add_done_callback(lambda t: t.exception() and log.error("audit failed", exc_info=t.exception()))
_background.add(task); task.add_done_callback(_background.discard)   # keep a strong ref
```

For audit specifically, prefer `await` — losing it silently is unacceptable. Enable `asyncio` debug mode (`PYTHONASYNCIODEBUG=1`) in CI to surface never-awaited coroutines.

</details>

---

## Snippet 8 — The price check that trusts a Promise

```ts
// TypeScript — checkout server validating the price the client sent
async function getCurrentPrice(sku: string): Promise<number> {
  const p = await pricing.lookup(sku);
  return p.amountCents;
}

async function checkout(req: CheckoutRequest): Promise<CheckoutResult> {
  const expected = getCurrentPrice(req.sku);   // no await

  if (req.clientPriceCents === expected) {      // client-supplied price vs "server" price
    return charge(req);
  }
  throw new PriceMismatchError();
}
```

> What's the async bug? What's the user-visible impact? How do you fix it?

<details>
<summary>Answer</summary>

**Forgotten `await` defeating a server-side price check — a money/security bug.**

`getCurrentPrice` is `async`, so `expected` is a `Promise<number>`, not a number. The comparison `req.clientPriceCents === expected` compares a number to a *Promise object*. That is **never** `===` (a number is never strictly equal to an object), so the condition is **always false**, and `checkout` **always throws `PriceMismatchError`** — every legitimate checkout is rejected. That's the bug as written: a total denial-of-service on purchases.

But trace the *likely "fix" a panicked dev applies*: they flip the logic or loosen the comparison. A common bad patch is `if (expected)` ("is there a price?") — and since `expected` is a Promise, that's **always truthy**, so the price check is bypassed and `charge(req)` runs with the **client-supplied price unvalidated.** Now a malicious client sends `clientPriceCents: 1` for a $500 item and gets charged a cent. The forgotten `await` either blocks all sales or, after a careless patch, lets clients set their own prices.

**User-visible impact:** as written, no one can check out (revenue → 0). After the typical bad patch, **clients control the price they pay** — direct financial loss and fraud.

**Fix — `await` the price and compare numbers to numbers:**

```ts
async function checkout(req: CheckoutRequest): Promise<CheckoutResult> {
  const expected = await getCurrentPrice(req.sku);   // real number
  if (req.clientPriceCents !== expected) {
    throw new PriceMismatchError();
  }
  return charge(req);
}
```

General rule: never trust a client-supplied price/total — recompute server-side — and `no-misused-promises` would have flagged the Promise in the `===` / `if` position immediately.

</details>

---

## Snippet 9 — The retry that swallowed its own failure

```js
// JavaScript — a retry helper used to harden flaky downstream calls
async function withRetry(fn, attempts = 3) {
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      // transient — try again
    }
  }
}

// usage:
const result = await withRetry(() => paymentApi.charge(order));
processPayment(result);
```

> What's the async bug? What's the user-visible impact? How do you fix it?

<details>
<summary>Answer</summary>

**Swallowed Promise Rejection inside a retry loop** — the error is caught, ignored, and then *lost on the last attempt.*

The `catch` block comments "transient — try again" but does nothing — no logging, no rethrow. That's tolerable for attempts 1 and 2. The bug is the **final attempt**: when `i === attempts - 1` and `fn()` rejects, the loop catches the error, swallows it, the `for` loop ends, and the function **falls off the end returning `undefined`** — *as if it had succeeded.*

So `withRetry` resolves with `undefined` after all retries fail. The caller does `processPayment(undefined)` with no idea anything went wrong. The original error — the actual reason the payment failed — was eaten in the empty `catch` and is gone.

**User-visible impact:** payments that fail after 3 attempts are reported to downstream code as *success-with-no-result*. `processPayment(undefined)` may throw a confusing `Cannot read properties of undefined`, or worse, mark an order paid that was never charged. The real failure (card declined, gateway down) never reaches logs or the user — the most damning property of a swallowed rejection: **it converts a known failure into a silent, mislabeled one.**

**Fix — rethrow the last error; log retries; never let the loop fall through silently:**

```js
async function withRetry(fn, attempts = 3) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      logger.warn({ err, attempt: i + 1 }, "retrying");
      await delay(backoff(i));        // and back off between attempts
    }
  }
  throw lastErr;                      // exhausted retries → propagate the real cause
}
```

A retry helper that can return `undefined` on exhaustion is broken by construction — either return the result or throw; never silently both-and-neither.

</details>

---

## Snippet 10 — The cache warmer that looks reckless

```ts
// TypeScript — on startup, kick off a background cache warm-up.
// A reviewer flagged this as a "floating promise". Are they right?
function startServer() {
  app.listen(3000);

  // Fire-and-forget: warm the cache in the background; do NOT block startup.
  void warmCache().catch((err) => {
    logger.error({ err }, "cache warm-up failed; serving cold");
    metrics.increment("cache.warmup.failed");
  });
}

async function warmCache(): Promise<void> {
  const hot = await db.topProducts(100);
  for (const p of hot) cache.set(p.id, p);   // idempotent: re-runs harmlessly
}
```

> What's the async bug? What's the user-visible impact? How do you fix it?

<details>
<summary>Answer</summary>

**Trap snippet: this is NOT a bug.** This is *correct* fire-and-forget, and "fixing" it would be wrong.

Walk the checklist that distinguishes a floating-promise *bug* from intentional background work:

1. **Is the promise dropped on the floor?** No. It's explicitly marked with `void` (so `no-floating-promises` is satisfied and the intent "I am deliberately not awaiting this" is documented) and it has a real `.catch`.
2. **Is the failure observable?** Yes. The `.catch` **logs with context and emits a metric** — this is fire-and-forget *with* logging, the opposite of Snippet 3's silent version.
3. **Is it safe not to await?** Yes, by design: the comment and the code say cache warm-up must not block `app.listen`; serving with a cold cache is an acceptable degraded mode, not a correctness failure.
4. **Is re-running / partial completion safe?** Yes. `cache.set` is **idempotent** — a failed or partial warm-up just means some entries are cold, which `warmCache` (or normal lazy population) can fix later. No data is corrupted, nothing is half-committed.

Because the outcome is non-critical, the promise is captured, *and* its failure is logged + measured, this is exactly how intentional background work should look. The `void` keyword is the tell: it signals to readers and linters "this floating-looking promise is on purpose."

**The lesson for critical reading:** don't pattern-match on "async call not awaited = bug." A floating promise is a bug when the result is needed, when failure is silent, or when re-running is unsafe. Here none of those hold. The diagnostic isn't the *shape* (`xAsync().catch(...)`) — it's the three questions: *do we need the result, is the failure observed, is it safe to not finish?*

> If you wanted to harden it further you might add a timeout or track the task for graceful shutdown — but as written it is correct, and "awaiting it to be safe" would needlessly delay accepting traffic.

</details>

---

## Snippet 11 — The Python gather that lost a writer

```python
# Python (asyncio) — fan out writes to three regional replicas
import asyncio

async def replicate(record: dict) -> None:
    await asyncio.gather(
        write_region("us-east", record),
        write_region("eu-west", record),
        write_region("ap-south", record),
    )
    metrics.incr("replicated")

async def write_region(region: str, record: dict) -> None:
    await regional_db[region].put(record)   # can raise on a regional outage
```

> What's the async bug? What's the user-visible impact? How do you fix it?

<details>
<summary>Answer</summary>

**`asyncio.gather` fail-fast + swallowed sibling errors** — the Python sibling of Snippet 5, with an extra trap.

By default `asyncio.gather(*aws)` (i.e. `return_exceptions=False`) is **fail-fast**: the first coroutine to raise propagates that exception out of `gather` immediately. Two problems follow:

1. **The other regions' results and errors are discarded.** If `eu-west` raises first, you never learn whether `ap-south` also failed — and crucially, **the still-pending coroutines are *not cancelled* by `gather`**; they keep running, and if *they* later raise, those exceptions are swallowed (logged only as "Task exception was never retrieved" at GC time, if at all). So you can have `us-east` succeed, `eu-west` raise, and `ap-south` *also* fail silently.
2. **`metrics.incr("replicated")` is skipped** on any failure (it's after the `await`), so a partial replication isn't even counted as attempted.

**User-visible impact:** a single regional outage makes `replicate` raise, the caller likely treats the *entire* write as failed (and may retry, double-writing to the regions that already succeeded), while a *second* region's failure is completely invisible. You think you lost one replica; you actually lost two — and you can't tell from logs.

**Fix — collect every outcome with `return_exceptions=True`, then decide explicitly:**

```python
async def replicate(record: dict) -> None:
    results = await asyncio.gather(
        write_region("us-east", record),
        write_region("eu-west", record),
        write_region("ap-south", record),
        return_exceptions=True,
    )
    failures = [r for r in results if isinstance(r, Exception)]
    for err in failures:
        log.error("replica write failed", exc_info=err)
    metrics.incr("replicated", len(results) - len(failures))
    if len(failures) == len(results):
        raise ReplicationError("all replicas failed")   # your own quorum policy
```

Now every region's outcome is visible, you log each failure, and you apply an explicit policy (all-must-succeed, quorum, best-effort) instead of inheriting `gather`'s fail-fast-and-forget default. For true structured cancellation on first error, Python 3.11+ `asyncio.TaskGroup` cancels siblings cleanly — choose based on whether you want to *cancel* or *collect* the rest.

</details>

---

## Snippet 12 — The total that was never summed

```ts
// TypeScript — computing an order total from line items
async function lineItemTotal(item: LineItem): Promise<number> {
  const price = await pricing.lookup(item.sku);
  return price.amountCents * item.qty;
}

async function orderTotal(items: LineItem[]): Promise<number> {
  let total = 0;
  items.forEach(async (item) => {
    total += await lineItemTotal(item);
  });
  return total;                       // <-- returned here
}
```

> What's the async bug? What's the user-visible impact? How do you fix it?

<details>
<summary>Answer</summary>

**`await` inside `forEach` (forgotten-await variant) producing a wrong, premature result.**

Same root cause as Snippet 6, but here it corrupts a *value* rather than just losing background work. `forEach` does not await its async callback, so:

- The callbacks are *launched* but `forEach` returns immediately.
- `return total` executes **before any `await lineItemTotal(...)` has resolved**, so `total` is still `0`.
- The `total += ...` mutations land *later*, after `orderTotal` has already returned `0` — they mutate a variable nobody is reading anymore.

`orderTotal` therefore resolves to **`0`** (or some racy partial value) regardless of the items.

**User-visible impact:** every order totals **\$0.00** (or an unpredictable partial sum). Either customers are charged nothing — direct revenue loss — or a downstream invariant ("total > 0") throws and checkout breaks. And because the writes *do* eventually happen to a dead variable, debugging is maddening: adding a `console.log(total)` *after a delay* shows the "right" number, masking the bug.

**Fix — compute the per-item promises and `Promise.all`, then sum:**

```ts
async function orderTotal(items: LineItem[]): Promise<number> {
  const amounts = await Promise.all(items.map(lineItemTotal));   // map keeps the promises
  return amounts.reduce((sum, n) => sum + n, 0);
}
```

Or, if you need strict sequencing, a `for...of` loop awaits correctly:

```ts
let total = 0;
for (const item of items) total += await lineItemTotal(item);   // each await actually waits
return total;
```

The rule from Snippet 6 holds: `forEach(async …)` silently discards the promises; `map` + `Promise.all` (parallel) or `for...of` (serial) both actually wait.

</details>

---

## Snippet 13 — The two-step checkout

```js
// JavaScript — reserve inventory, then charge. Both are async.
async function placeOrder(order) {
  const reservation = reserveInventory(order);   // (1)
  const charge = await chargeCard(order);         // (2)

  if (charge.ok) {
    await confirmReservation(reservation);        // (3) pass the reservation along
    return { status: "confirmed" };
  }
  return { status: "declined" };
}
```

> What's the async bug? What's the user-visible impact? How do you fix it?

<details>
<summary>Answer</summary>

**Forgotten `await` on the reservation (1)** — combined with **a swallowed rejection**, producing oversells and orphaned charges.

Line (1) drops the `await`: `reservation` is a `Promise`, not a reservation. Two consequences:

- **It floats.** If `reserveInventory` *rejects* (item out of stock, inventory service down), that rejection is unhandled — there's no `await`, no `.catch`. The code happily proceeds to charge the card. So you can **charge a customer for an item you never reserved** (and have no stock for). The rejection later surfaces as an unhandled rejection (possible process crash per Snippet 4) *after* the card was charged.
- **`confirmReservation(reservation)` at (3) receives a Promise**, not a reservation id. If `confirmReservation` does `reservation.id` it gets `undefined`; the confirmation targets nothing or throws — leaving inventory in limbo while the charge stands.

So the ordering is exactly backwards from what's safe: the side effect that can fail "for free" (charge) is awaited, while the resource acquisition you depend on (reservation) is not.

**User-visible impact:** customers charged for items that were never actually reserved → oversells, manual refunds, support load, and an inconsistent system (money moved, inventory didn't). The worst real-money outcome in this whole file.

**Fix — `await` the reservation first, handle its failure, and only charge once you hold the resource:**

```js
async function placeOrder(order) {
  const reservation = await reserveInventory(order);   // hold stock first; throws if unavailable
  try {
    const charge = await chargeCard(order);
    if (!charge.ok) {
      await releaseReservation(reservation);           // give the stock back
      return { status: "declined" };
    }
    await confirmReservation(reservation);             // real reservation object
    return { status: "confirmed" };
  } catch (err) {
    await releaseReservation(reservation);             // compensate on any failure
    throw err;
  }
}
```

Acquire the scarce resource before the irreversible side effect, await every step, and add explicit compensation. The forgotten `await` didn't just read wrong — it inverted the safety ordering of the whole transaction.

</details>

---

## Snippet 14 — The metrics flush on shutdown

```ts
// TypeScript — graceful shutdown hook
process.on("SIGTERM", () => {
  server.close();

  metrics.flush();         // push buffered metrics to the collector (async)
  logger.flush();          // flush buffered logs (async)

  process.exit(0);         // exit
});
```

> What's the async bug? What's the user-visible impact? How do you fix it?

<details>
<summary>Answer</summary>

**Floating promises in a shutdown path** — and `process.exit(0)` runs **before** they finish, so the work is *guaranteed* lost.

`metrics.flush()` and `logger.flush()` return Promises that aren't awaited (the handler isn't even `async`). Worse than a normal floating promise: `process.exit(0)` on the *next line* terminates the process **synchronously**, killing the event loop immediately. The flush Promises have queued their I/O but it never gets a chance to run. There's no unhandled-rejection drama here — the process is simply gone before the microtasks fire.

`server.close()` has the same problem: it's asynchronous (it stops accepting new connections and calls back when existing ones drain), but nothing waits for its callback either, so in-flight requests can be cut off.

**User-visible impact:** on every deploy/scale-down (which is when `SIGTERM` arrives — i.e. *constantly* in a Kubernetes/autoscaling world) you **lose the last buffered metrics and logs**, and you sever in-flight requests. Your dashboards have gaps exactly around deploys, and the diagnostic logs you'd most want (the ones right before shutdown) are the ones that vanish. It "works" in local testing because there's little buffered, then silently drops data in production.

**Fix — make the handler async and `await` each step (with a timeout so a stuck flush can't hang shutdown):**

```ts
process.on("SIGTERM", async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));   // drain connections
  await Promise.allSettled([
    withTimeout(metrics.flush(), 5_000),
    withTimeout(logger.flush(), 5_000),
  ]);
  process.exit(0);                                                       // only now
});
```

`allSettled` ensures one flush failing doesn't skip the other; the timeout guarantees a hung collector can't block the pod's termination grace period forever. The principle: **anything async in a shutdown path must be awaited before `exit`, or it didn't happen.**

</details>

---

## Summary — patterns of spotting

You don't catch async error-handling bugs by spotting a bad line — you catch them by asking, at every async call site: **did the work actually finish, and would I hear about it if it failed?** The repeatable moves from these fourteen snippets:

- **Treat every `async` result as suspect until it's awaited or explicitly handled.** A `Promise` is a *promise*, not a value: it's truthy in an `if`, never `===` a number, has none of the resolved object's fields. The auth bug (Snippet 1), the price bypass (Snippet 8), the $0 total (Snippet 12), and the orphaned charge (Snippet 13) are all the same root cause — a `Promise` dereferenced as if it were `T`. This is the **Forgotten `await`**.
- **An empty `catch` is a data-loss generator.** `.catch(() => {})` and a `catch {}` that neither logs nor rethrows convert a known failure into a silent, mislabeled "success" (Snippets 2, 9). If you catch, you must *do something*: rethrow, log, retry, or compensate. **Swallowed Rejection** thrives wherever a `catch` block is empty or a retry loop falls through.
- **A bare async call in a request handler or shutdown hook is a time bomb.** It works until the dependency has a bad day, then the unhandled rejection crashes the process *after the response was sent* (Snippets 4, 13) — or the process exits before the flush runs (Snippet 14). The blast radius is wildly larger than the cause. This is the **Floating Promise**.
- **Fire-and-forget is only acceptable with logging *and* idempotency.** Background work whose failure isn't logged + measured is invisible until users complain (Snippets 3, 7). Python is sharper: a forgotten `await` means the coroutine **never runs at all**. Contrast with the *correct* version (Snippet 10): `void` + `.catch(log+metric)` + idempotent + non-critical = fine. This is **Fire-and-Forget Without Logging**.
- **`forEach(async …)` does not wait — ever.** `forEach` discards the promises its callback returns, so the loop "finishes" before any `await` resolves (Snippets 6, 12). Use `map` + `Promise.all` to parallelize, or `for...of` to serialize. Both keep the promises; `forEach` throws them away.
- **`Promise.all` / `asyncio.gather` are fail-fast and lose the siblings.** The first rejection discards every other result — including *other* failures, which then become silent unhandled rejections (Snippets 5, 11). Use `allSettled` / `gather(return_exceptions=True)` / `TaskGroup` and apply an explicit policy when partial success is acceptable.

The meta-lesson: **async errors don't fall on the floor loudly — they fall silently, after the response was already sent.** The function returned `{ ok: true }`; the write failed. The endpoint said "shipping"; the dispatch crashed the server a tick later. The audit "ran"; the coroutine was never scheduled. When you read async code, don't ask "does this look right?" — ask "if this Promise rejects at 3 a.m., who finds out, and when?"

---

## Related Topics

- [`tasks.md`](tasks.md) — broken async programs to fix from the writing side (same four anti-patterns).
- [`optimize.md`](optimize.md) — implementations to make correct *and* properly parallel.
- [Execution-Shape find-bug](../02-execution-shape/find-bug.md) — `await`-in-loop, Promise-chain hell, mixing callbacks and promises.
- [Misuse find-bug](../03-misuse/find-bug.md) — Promise-constructor anti-pattern and `async` without `await`.
- [Concurrency Anti-Patterns](../../03-concurrency/README.md) — the multi-thread sibling: locks, races, deadlocks.
- [Error Handling (Clean Code)](../../../clean-code/06-error-handling/README.md) — the positive patterns for propagating failures.
- [Backend / Distributed Systems](../../../../../Backend/distributed-systems/README.md) — fan-out, retry, timeout, and saga compensation at the network layer.
