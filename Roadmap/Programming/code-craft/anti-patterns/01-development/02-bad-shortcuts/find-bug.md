# Bad Shortcuts Anti-Patterns — Find the Bug

> **Category:** [Development Anti-Patterns](../README.md) → **Bad Shortcuts** — *convenience taken now, paid back many times later.*
> **Covers (collectively):** Copy-Paste Programming · Magic Numbers / Strings · Hard Coding · Cargo Cult Programming · Pokémon Exception Handling · Stringly-Typed Programming

---

This file is **critical-reading practice**. Each snippet below is a plausible chunk of real-world code in Go, Java, or Python. Read it the way a sharp reviewer does and answer three questions:

> **What anti-pattern(s) are present? What concrete problem(s) does it cause? How would you fix it?**

Bad shortcuts are different from bad *structure*. A shortcut rarely makes the code ugly enough to fail review on sight — that's the danger. Worse, for this family the "bug" is frequently a **real functional or security defect** that the shortcut directly causes or hides: a fix applied to one copy-pasted twin but not the other; a swallowed exception that corrupts state in silence; a hard-coded secret committed to git; a magic number that's off by a digit; a stringly-typed comparison broken by one wrong character. Several snippets here contain a live bug — your job is to find it *and* name the shortcut that let it through.

A few snippets are deliberately innocent: code that *looks* like a shortcut but is actually the right call. Critical reading means resisting the reflex to pattern-match on shape. Read slowly, write your own answer, then open the collapsible.

> **How to use this file:** decide your verdict *before* expanding the answer. The skill is noticing the shortcut and tracing its consequence — not recalling the name.

---

## Table of Contents

1. [The two refund paths](#snippet-1--the-two-refund-paths)
2. [Session timeout](#snippet-2--session-timeout)
3. [Connecting to the database](#snippet-3--connecting-to-the-database)
4. [The role check](#snippet-4--the-role-check)
5. [The notebook that loads data](#snippet-5--the-notebook-that-loads-data)
6. [The order processor that never fails](#snippet-6--the-order-processor-that-never-fails)
7. [The webhook handler](#snippet-7--the-webhook-handler)
8. [Two validators that drifted apart](#snippet-8--two-validators-that-drifted-apart)
9. [The retry wrapper](#snippet-9--the-retry-wrapper)
10. [The state machine in strings](#snippet-10--the-state-machine-in-strings)
11. [The price formatter](#snippet-11--the-price-formatter)
12. [The config loader](#snippet-12--the-config-loader)
13. [The event tag field](#snippet-13--the-event-tag-field)
14. [The cache TTLs](#snippet-14--the-cache-ttls)

---

## Snippet 1 — The two refund paths

```python
# Python — two endpoints that both refund an order, written months apart
def refund_full(order):
    if order.status not in ("paid", "shipped"):
        raise ValueError("not refundable")
    amount = order.subtotal + order.tax + order.shipping        # refund everything
    gateway.refund(order.payment_id, amount)
    order.status = "refunded"
    db.save(order)

def refund_partial(order, amount):
    if order.status not in ("paid", "shipped"):
        raise ValueError("not refundable")
    # NOTE: copied from refund_full and adjusted for partial amount
    gateway.refund(order.payment_id, amount)
    order.status = "refunded"
    db.save(order)
```

> What anti-pattern(s) are present? What concrete problem(s) does it cause? How would you fix it?

<details>
<summary>Answer</summary>

**Copy-Paste Programming** — with a **divergence bug** that the copy created.

`refund_partial` was copied from `refund_full` (the comment even admits it). Both share the eligibility check and the gateway call, but the duplication has already produced a real defect: **a partial refund unconditionally sets `order.status = "refunded"`.** After a $5 partial refund on a $200 order, the order is marked fully refunded — so a second partial refund is now rejected (`status not in (...)`), and reporting treats a partially-refunded order as fully refunded. Revenue and reconciliation both go wrong.

This is the signature copy-paste failure mode: the shared part (eligibility, gateway call) is fine, but the *one line that should have differed* was carried over unchanged. The day someone fixes the status logic in `refund_full`, the twin keeps its bug.

**Fix — extract the shared knowledge; let the difference be a parameter, and compute status from facts:**

```python
def _refund(order, amount):
    if order.status not in ("paid", "shipped"):
        raise ValueError("not refundable")
    gateway.refund(order.payment_id, amount)
    order.refunded_total += amount
    order.status = "refunded" if order.refunded_total >= order.total else "partially_refunded"
    db.save(order)

def refund_full(order):           _refund(order, order.total)
def refund_partial(order, amt):   _refund(order, amt)
```

One home for the refund rule; the full-vs-partial difference is now the *only* thing that varies, and status is derived rather than copy-pasted.

</details>

---

## Snippet 2 — Session timeout

```java
// Java — session expiry check in an auth filter
public boolean isExpired(Session s) {
    long now = System.currentTimeMillis();
    long ageSeconds = (now - s.getCreatedAtMillis()) / 1000;
    return ageSeconds > 8640;   // expire after one day
}
```

> What anti-pattern(s) are present? What concrete problem(s) does it cause? How would you fix it?

<details>
<summary>Answer</summary>

**Magic Number** — concealing an **off-by-one-digit bug**.

The comment says "expire after one day," but `8640` seconds is **2.4 hours**, not a day. A day is `86400`. A trailing zero was dropped, and because the value is a bare literal with no name, nothing flags the mismatch — the code compiles, runs, and silently logs users out roughly ten times sooner than intended. Support tickets ("I keep getting logged out") will be blamed on everything *except* this line.

This is exactly why magic numbers are dangerous: `8640` and `86400` look almost identical, and a literal can't tell you it's wrong. A *named* constant would have made the intent checkable.

**Fix — name the value so the meaning and the math are both auditable:**

```java
static final long SECONDS_PER_DAY = 86_400L;
static final long SESSION_TTL_SECONDS = SECONDS_PER_DAY;   // one day

public boolean isExpired(Session s) {
    long ageSeconds = (System.currentTimeMillis() - s.getCreatedAtMillis()) / 1000;
    return ageSeconds > SESSION_TTL_SECONDS;
}
```

Now `SECONDS_PER_DAY = 86_400` is obviously correct (the underscore separator helps too), and a reviewer can verify "TTL = one day" at a glance. If the TTL varies by environment, it should be *configuration*, not even a constant.

</details>

---

## Snippet 3 — Connecting to the database

```go
// Go — service startup
package main

func newDB() (*sql.DB, error) {
    // TODO: move to config before launch
    dsn := "postgres://svc_user:Pr0d_P@ss_2023@db.internal.acme.com:5432/orders?sslmode=require"
    return sql.Open("postgres", dsn)
}

func newRedis() *redis.Client {
    return redis.NewClient(&redis.Options{Addr: "10.2.0.14:6379"})
}
```

> What anti-pattern(s) are present? What concrete problem(s) does it cause? How would you fix it?

<details>
<summary>Answer</summary>

**Hard Coding** — and the most serious kind: a **committed production credential** (a security incident), plus an environment-locked host.

Two distinct problems:

1. **Security bug.** The production database password `Pr0d_P@ss_2023` is now in source control. It is in git history *forever*, in every clone, on every developer laptop and CI runner, and likely in any mirror or backup of the repo. The `// TODO: move to config before launch` is the tell — it never got moved. **Removing it in a later commit does not fix this**; the secret must be *rotated*.
2. **Environment lock-in.** The hostnames `db.internal.acme.com` and `10.2.0.14` only exist in prod. The same binary can't run in dev, staging, or a test container without editing source and recompiling.

**Fix — read connection details from the environment; never let a secret touch source:**

```go
func newDB() (*sql.DB, error) {
    dsn := os.Getenv("DATABASE_URL")          // injected per environment
    if dsn == "" {
        return nil, errors.New("DATABASE_URL is required")
    }
    return sql.Open("postgres", dsn)
}

func newRedis() *redis.Client {
    return redis.NewClient(&redis.Options{Addr: os.Getenv("REDIS_ADDR")})
}
```

And operationally: **rotate the leaked password immediately**, then add a secret scanner (`gitleaks`, `git-secrets`) to pre-commit so the next one is caught before it ships. See [Secrets Management](../../../../../Architecture/system-design/README.md).

</details>

---

## Snippet 4 — The role check

```java
// Java — authorization helper used across the admin panel
public class Access {
    public static boolean canManageUsers(User user) {
        return user.getRole().equals("Admin");
    }
}

// elsewhere, when an account is created:
void createAccount(SignupForm form) {
    User u = new User();
    u.setRole(form.isAdminRequest() ? "admin" : "member");   // lower-case here
    repo.save(u);
}
```

> What anti-pattern(s) are present? What concrete problem(s) does it cause? How would you fix it?

<details>
<summary>Answer</summary>

**Stringly-Typed Programming** (compounded by **Magic Strings**) — producing a real **authorization bug from a case mismatch**.

The role is a free-form `String`. Account creation stores `"admin"` (lower-case); the access check compares against `"Admin"` (capital A). `"admin".equals("Admin")` is `false`, so **every admin account created through this path fails the `canManageUsers` check** — admins can't manage users. (Flip the casing and you'd get the opposite, scarier bug: an account that *shouldn't* be admin slipping through.) The compiler is blind to this because both sides are "valid" strings; nothing connects the producer and the consumer.

This is the defining stringly-typed failure: a typo or case drift that compiles cleanly and fails only at runtime, often in security-critical code.

**Fix — make the role a real type so the compiler enforces a single source of truth:**

```java
enum Role { ADMIN, MEMBER }

public static boolean canManageUsers(User user) {
    return user.getRole() == Role.ADMIN;
}

u.setRole(form.isAdminRequest() ? Role.ADMIN : Role.MEMBER);
```

Now there is exactly one `ADMIN` token; a typo (`Role.ADMNI`) won't compile, and case mismatches are impossible. The IDE also enumerates the valid roles. If roles must be persisted as strings, serialize the enum at the boundary only — never compare raw strings in business logic.

</details>

---

## Snippet 5 — The notebook that loads data

```python
# Python — a data-prep function, lifted from a Stack Overflow answer
import warnings
import pandas as pd

def load_dataset(path):
    warnings.filterwarnings("ignore")          # "to make the output clean"
    df = pd.read_csv(path)
    df = df.copy()                             # "avoids SettingWithCopyWarning"
    pd.set_option("mode.chained_assignment", None)   # silence the same warning
    df = df.fillna(0).fillna(0)                # run it twice "just to be safe"
    return df.reset_index(drop=True)
```

> What anti-pattern(s) are present? What concrete problem(s) does it cause? How would you fix it?

<details>
<summary>Answer</summary>

**Cargo Cult Programming** — borrowed lines kept without understanding, several of them harmful.

Walk the borrowed rituals:

- `warnings.filterwarnings("ignore")` and `pd.set_option("mode.chained_assignment", None)` don't fix anything — they **suppress the very warnings that would tell you something is wrong**. A `SettingWithCopyWarning` indicates a real bug (writing to a view, not the data); silencing it globally hides current *and future* bugs across the whole process, not just this function.
- `df = df.copy()` right after `read_csv` is pointless — `read_csv` already returns a fresh frame.
- `.fillna(0).fillna(0)` runs the same operation twice; the second call is a no-op. It was copied "to be safe" with no idea what it does.

None of these were understood; they were imitated because "the example had them." Worst case, the suppressed warning was masking a genuine data-corruption bug.

**Fix — keep only what you can justify; let warnings surface so they can be addressed:**

```python
def load_dataset(path):
    df = pd.read_csv(path)
    return df.fillna(0).reset_index(drop=True)
```

If a chained-assignment warning appears later, **fix the assignment** (use `.loc[...]`), don't globally mute the warning. Rule of thumb: if your honest answer to "why is this line here?" is *"the example had it"* or *"just to be safe,"* delete it or learn it.

</details>

---

## Snippet 6 — The order processor that never fails

```python
# Python — background worker that processes a queue of orders
def process_order(order_id):
    try:
        order = db.get(order_id)
        reserve_inventory(order)
        charge_customer(order)
        mark_paid(order)
        send_confirmation_email(order)
    except:                       # make sure one bad order never kills the worker
        pass

def worker_loop():
    for order_id in queue:
        process_order(order_id)
```

> What anti-pattern(s) are present? What concrete problem(s) does it cause? How would you fix it?

<details>
<summary>Answer</summary>

**Pokémon Exception Handling** ("gotta catch 'em all") — causing **silent state corruption and lost orders**.

The bare `except: pass` swallows *everything*, and the steps inside are not all-or-nothing. Consider the realistic failure: `reserve_inventory` and `charge_customer` succeed, then `mark_paid` raises (a DB blip). The exception is swallowed, the loop moves on, and now you have a **customer charged for an order that is not marked paid, with inventory reserved and no confirmation email** — corrupt state with zero trace. There is no log, no retry, no alert. The bug surfaces days later as a chargeback dispute, and you have nothing to debug with.

A bare `except` also swallows `KeyboardInterrupt` and `SystemExit`, so the worker can't even be shut down cleanly, and it hides real coding bugs (a `NameError` in `send_confirmation_email`) by silencing them alongside transient failures.

**Fix — catch narrowly, log with context, and don't continue past a partial failure that corrupts state:**

```python
def process_order(order_id):
    order = db.get(order_id)
    try:
        with db.transaction():            # money + state change atomically
            reserve_inventory(order)
            charge_customer(order)
            mark_paid(order)
    except PaymentDeclined as e:
        log.warning("payment declined", order_id=order_id, reason=e.reason)
        mark_failed(order, e.reason)      # explicit, recorded outcome
        return
    except TransientError as e:
        log.error("transient failure, will retry", order_id=order_id, exc_info=e)
        raise                              # let the queue retry; don't swallow
    send_confirmation_email(order)         # outside the txn; safe to retry separately
```

The money-and-state steps are now atomic; expected failures are recorded; transient ones propagate so the queue retries; and an actual bug crashes loudly instead of vanishing.

</details>

---

## Snippet 7 — The webhook handler

```go
// Go — receives payment webhooks from a third party
func handleWebhook(w http.ResponseWriter, r *http.Request) {
    body, _ := io.ReadAll(r.Body)
    var evt PaymentEvent
    json.Unmarshal(body, &evt)            // parse the event

    if evt.Type == "payment_succeeded" {
        markOrderPaid(evt.OrderID)
    }
    w.WriteHeader(200)
}
```

> What anti-pattern(s) are present? What concrete problem(s) does it cause? How would you fix it?

<details>
<summary>Answer</summary>

**Pokémon Exception Handling, the Go dialect** — discarded errors (`_`) plus an unchecked `Unmarshal` — causing a **silent data bug and a security hole**.

Two ignored errors, each with real consequences:

1. `body, _ := io.ReadAll(...)` — if the read fails or is truncated, `body` is partial and the error is thrown away.
2. `json.Unmarshal(body, &evt)` — the returned error is *not even captured*. On malformed JSON, `evt` stays zero-valued: `evt.Type == ""`, `evt.OrderID == ""`. The handler then returns `200 OK` to the sender, which marks the webhook **delivered** — so the real event is never retried. A legitimate payment can be lost forever.
3. **Security:** there's no signature verification at all. Anyone who can POST to this URL can forge `{"type":"payment_succeeded","order_id":"X"}` and `markOrderPaid` will run. Ignoring errors made it easy to also skip the auth step that errors would have forced you to think about.

Swallowing errors here doesn't just hide failures — it converts them into incorrect business outcomes and an open door.

**Fix — verify the signature, check every error, fail loudly with the right status:**

```go
func handleWebhook(w http.ResponseWriter, r *http.Request) {
    body, err := io.ReadAll(r.Body)
    if err != nil {
        http.Error(w, "read error", http.StatusBadRequest)
        return
    }
    if !verifySignature(r.Header.Get("X-Signature"), body, webhookSecret) {
        http.Error(w, "invalid signature", http.StatusUnauthorized)   // reject forgeries
        return
    }
    var evt PaymentEvent
    if err := json.Unmarshal(body, &evt); err != nil {
        http.Error(w, "bad payload", http.StatusBadRequest)           // 4xx → sender retries
        return
    }
    if evt.Type == "payment_succeeded" {
        if err := markOrderPaid(evt.OrderID); err != nil {
            http.Error(w, "processing error", http.StatusInternalServerError) // 5xx → retry
            return
        }
    }
    w.WriteHeader(http.StatusOK)
}
```

A non-2xx status tells the provider to retry; the signature check shuts the forgery hole.

</details>

---

## Snippet 8 — Two validators that drifted apart

```java
// Java — email validation, copy-pasted into two layers over time
class SignupController {
    boolean validEmail(String e) {
        return e != null && e.contains("@") && e.contains(".") && e.length() <= 254;
    }
}

class NewsletterService {
    boolean validEmail(String e) {
        // copied from SignupController, then a security fix was added HERE only
        if (e == null || e.length() > 254) return false;
        if (e.contains("\n") || e.contains("\r")) return false;   // block header injection
        return e.contains("@") && e.contains(".");
    }
}
```

> What anti-pattern(s) are present? What concrete problem(s) does it cause? How would you fix it?

<details>
<summary>Answer</summary>

**Copy-Paste Programming** — with a **security fix applied to one copy but not its twin** (the classic "fixed here, still broken there").

Someone discovered an **email header injection** vulnerability (a `\r`/`\n` in an address lets an attacker inject extra SMTP headers) and patched `NewsletterService.validEmail`. But the same validation was copy-pasted into `SignupController.validEmail`, which **was never patched**. The vulnerability is still live on the signup path. This is the single most expensive consequence of copy-paste: a bug — especially a security bug — gets fixed in the copy the author happened to be looking at, while every other copy silently stays vulnerable. There is no link between them, so the fix doesn't propagate.

**Fix — one authoritative validator that both layers call:**

```java
final class EmailRules {                    // single source of truth
    static boolean isValid(String e) {
        if (e == null || e.length() > 254) return false;
        if (e.contains("\n") || e.contains("\r")) return false;   // header injection guard
        return e.contains("@") && e.contains(".");
    }
}

// both call sites:
boolean validEmail(String e) { return EmailRules.isValid(e); }
```

Now a fix to the rule (the injection guard, or a real RFC-compliant check) applies everywhere at once. Duplicated *knowledge* — and email validation is knowledge — belongs in exactly one place.

</details>

---

## Snippet 9 — The retry wrapper

```python
# Python — wraps a flaky upstream call with retries
import time

def call_with_retry(fn):
    for attempt in range(3):
        try:
            return fn()
        except Exception as e:
            time.sleep(2 ** attempt)        # exponential backoff
            last = e
    raise last
```

> What anti-pattern(s) are present? What concrete problem(s) does it cause? How would you fix it?

<details>
<summary>Answer</summary>

**Pokémon Exception Handling (over-broad catch)** — retrying things that must *never* be retried, with a latent bug if `fn` succeeds-then-fails.

`except Exception` catches **everything**, so this wrapper happily retries failures that retrying cannot fix and should not touch:

- A `ValueError`/`TypeError` from a **bug in `fn`** gets retried 3× (wasting time) and then re-raised — the bug is now buried under retry noise and a 6-second delay.
- A **non-idempotent** call (e.g. "charge the customer") that fails *after* the side effect lands — say the charge succeeds but the response read times out — gets retried, **double-charging the customer**. Catching broadly hides the distinction between "safe to retry" and "already happened."
- A `KeyboardInterrupt`/`SystemExit` is also caught (they subclass `BaseException`, not `Exception`, so those two specifically escape — but any custom fatal error subclassing `Exception` would be swallowed and retried).

The shortcut — "catch everything and retry" — silently widens the blast radius far beyond transient I/O errors.

**Fix — retry only known-transient, retry-safe errors; let everything else propagate:**

```python
RETRIABLE = (ConnectionError, TimeoutError)      # transient, network-level only

def call_with_retry(fn, attempts=3):
    for attempt in range(attempts):
        try:
            return fn()
        except RETRIABLE as e:
            if attempt == attempts - 1:
                raise
            time.sleep(2 ** attempt)
        # ValueError, bugs, fatal errors: NOT caught — they surface immediately
```

And only wrap **idempotent** operations in a retry; a charge needs an idempotency key, not a blind retry loop.

</details>

---

## Snippet 10 — The state machine in strings

```python
# Python — order lifecycle managed via a string field
def advance(order):
    if order.state == "pending":
        order.state = "confirmed"
    elif order.state == "confirmed":
        order.state = "shipped"
    elif order.state == "shipped":
        order.state = "delivered"

def can_cancel(order):
    return order.state in ("pending", "confirmd")     # cancel before it ships

def is_active(order):
    return order.state != "Delivered"
```

> What anti-pattern(s) are present? What concrete problem(s) does it cause? How would you fix it?

<details>
<summary>Answer</summary>

**Stringly-Typed Programming** + **Magic Strings** — two distinct **typo bugs that compile fine and fail at runtime**.

The order state is a bare `String`, so every reference is an unchecked literal and the compiler/interpreter can't connect them. Two real bugs are hiding in plain sight:

1. `can_cancel` checks `"confirmd"` — missing the `e` in `"confirmed"`. So a confirmed order **can never be cancelled**, because no order ever has state `"confirmd"`. A customer who confirmed but hasn't shipped is wrongly told "cannot cancel."
2. `is_active` compares against `"Delivered"` (capital D), but `advance` sets `"delivered"` (lower-case). So delivered orders are **still considered active forever** — they never drop out of "active orders" dashboards, metrics, or cleanup jobs.

Both are one-character mistakes the type system is powerless to catch because every string is "valid."

**Fix — use an enum so the set of states is closed and typos won't compile:**

```python
from enum import Enum

class State(Enum):
    PENDING = "pending"
    CONFIRMED = "confirmed"
    SHIPPED = "shipped"
    DELIVERED = "delivered"

_NEXT = {State.PENDING: State.CONFIRMED, State.CONFIRMED: State.SHIPPED,
         State.SHIPPED: State.DELIVERED}

def advance(order):    order.state = _NEXT.get(order.state, order.state)
def can_cancel(order): return order.state in (State.PENDING, State.CONFIRMED)
def is_active(order):  return order.state is not State.DELIVERED
```

`State.CONFIRMD` raises `AttributeError` *immediately* (or fails a lint/type check), and there is exactly one spelling of each state. The bug class is eliminated, not just the two instances.

</details>

---

## Snippet 11 — The price formatter

```python
# Python — formats a money amount stored in cents for display
def format_price(cents):
    dollars = cents / 100          # cents → dollars
    return f"${dollars:.2f}"

def format_with_tax(cents):
    dollars = cents / 100
    return f"${dollars:.2f}"        # tax added elsewhere
```

> What anti-pattern(s) are present? What concrete problem(s) does it cause? How would you fix it?

<details>
<summary>Answer</summary>

**Trick snippet — the `/ 100` is NOT a bad magic number.** This is the deliberate trap: not every literal is a Magic Number anti-pattern.

`100` here is a **truly self-evident, universal conversion** (cents to dollars) used right where its meaning is obvious from the variable names and the inline comment. Naming it `CENTS_PER_DOLLAR = 100` is harmless but adds little — `100` cents per dollar is a fixed fact of the domain, not a tunable rule, an environment value, or a number whose meaning is unclear. The junior-level guidance explicitly exempts self-evident values like `0`, `1`, `2`, and obvious unit conversions. Crying "magic number!" here is a false positive.

**What *is* a real smell in this snippet** is the **Copy-Paste**: `format_with_tax` is a verbatim copy of `format_price` that doesn't actually add tax — the bodies are identical. Either it's dead duplication (delete it and call `format_price`) or it's an unfinished function with a latent bug (it's named `format_with_tax` but adds no tax). Float arithmetic on money (`cents / 100`) is also worth a side-eye for accumulation, though for a single display conversion it's acceptable.

**The lesson:** judge a literal by whether its *meaning is clear and stable*, not by the mere fact that it's a number. Spend your suspicion on the duplication, not the `100`.

```python
def format_price(cents):
    return f"${cents / 100:.2f}"       # clear, self-evident conversion — fine as-is

# format_with_tax should either be deleted (it duplicates format_price)
# or actually do its job:
def format_with_tax(cents, tax_rate):
    return format_price(round(cents * (1 + tax_rate)))
```

</details>

---

## Snippet 12 — The config loader

```python
# Python — application configuration
class Config:
    DEBUG = True                                   # turn off in prod
    UPLOAD_DIR = "/Users/maria/projects/app/tmp"   # where uploads go
    STRIPE_KEY = "bmREDACTED_not_a_real_key" # payment key
    MAX_UPLOAD_MB = 25
    DB_POOL_SIZE = 5

config = Config()
```

> What anti-pattern(s) are present? What concrete problem(s) does it cause? How would you fix it?

<details>
<summary>Answer</summary>

**Hard Coding stacked three deep** — a security bug, a portability bug, and an environment bug, all in five lines.

This `Config` class is named like configuration but is really hard-coded source. Going line by line:

- `STRIPE_KEY = "bm..."` — a **live payment secret committed to git** (note `bm`, not `sk_test_`). Anyone with repo access can charge or refund through your Stripe account. This is the catastrophic, irreversible shortcut: the key must be **rotated now**, not just deleted.
- `UPLOAD_DIR = "/Users/maria/projects/app/tmp"` — exists only on Maria's laptop. The app **crashes on every other machine** (CI, staging, prod, any teammate). A classic "works on my machine."
- `DEBUG = True` with a "turn off in prod" comment — relies on a human remembering to flip it. If it ships, prod runs in debug mode, leaking stack traces and internals to users (an information-disclosure bug).
- `DB_POOL_SIZE = 5` is an **environment-dependent value masquerading as a constant** — dev and prod want different pool sizes, so it's config wearing a constant's clothes.

`MAX_UPLOAD_MB = 25` is the *one* line that's arguably a fine constant (a fixed product rule), which is what makes the rest easy to miss.

**Fix — read environment-specific and secret values from the environment; keep only true product constants in code:**

```python
import os

class Config:
    MAX_UPLOAD_MB = 25                                    # product rule — OK as a constant
    DEBUG       = os.getenv("DEBUG", "false") == "true"  # default OFF; opt in per env
    UPLOAD_DIR  = os.environ["UPLOAD_DIR"]               # required, per-env
    STRIPE_KEY  = os.environ["STRIPE_KEY"]               # secret — never in source
    DB_POOL_SIZE = int(os.getenv("DB_POOL_SIZE", "5"))   # per-env tuning
```

`DEBUG` now defaults to safe (off) and must be explicitly enabled. Rotate the Stripe key and add a pre-commit secret scanner so the next one never lands.

</details>

---

## Snippet 13 — The event tag field

```go
// Go — analytics event with a free-form label
type Event struct {
    Name      string
    UserID    string
    Tags      map[string]string   // arbitrary key/value labels from callers
    Timestamp time.Time
}

func track(name, userID string, tags map[string]string) {
    sink.Write(Event{Name: name, UserID: userID, Tags: tags, Timestamp: time.Now()})
}

// caller:
track("checkout_completed", uid, map[string]string{
    "experiment": "blue_button_v3",
    "referrer":   "newsletter",
})
```

> What anti-pattern(s) are present? What concrete problem(s) does it cause? How would you fix it?

<details>
<summary>Answer</summary>

**Trick snippet — this is NOT Stringly-Typed abuse.** This is the justified case the middle level warns you not to over-correct.

It's tempting to flag `Tags map[string]string` and `Name string` and shout "stringly-typed! use enums!" — but that would be wrong here. **The set of tag keys/values is genuinely open and caller-defined**: experiments, referrers, and ad-hoc labels are added by product teams *without* a code change, and that's the whole point of an analytics tag system. Forcing this into an enum would mean **redeploying every time someone wants to track a new experiment** — the exact anti-pattern (enum-ifying an open set) `middle.md` calls out. A `map[string]string` is the correct, idiomatic model for an open, data-defined keyspace.

`Name string` is more debatable: if event names are a *fixed, code-known* set, a typed constant or enum-like set of `const` names would catch typos (`"checkout_completd"`) — a reasonable improvement. But if event names are also open (teams add new events freely), keeping it a string is defensible.

**The lesson for critical reading:** "uses strings" is not automatically the anti-pattern. Stringly-typed is bad when the value set is **fixed and code-known** (status, role) and the type system *could* enforce it. When the set is genuinely **open / data-defined**, a string (or a string map) is the right tool. Ask "is this set closed and known at compile time?" before reaching for an enum.

</details>

---

## Snippet 14 — The cache TTLs

```java
// Java — caching layer, TTLs sprinkled across the class
public class ProductCache {
    void cacheProduct(Product p)   { redis.setex(key(p.id()), 3600, serialize(p)); }
    void cachePrice(long id, Money m) { redis.setex("price:" + id, 3600, m.toString()); }
    void cacheInventory(long id, int n) { redis.setex("inv:" + id, 36000, String.valueOf(n)); }
    void cacheReviews(long id, String json) { redis.setex("rev:" + id, 3600, json); }
}
```

> What anti-pattern(s) are present? What concrete problem(s) does it cause? How would you fix it?

<details>
<summary>Answer</summary>

**Magic Numbers** + **Copy-Paste** — duplicated, *inconsistent* literals, with one of them almost certainly a typo bug.

The same TTL `3600` is repeated across three methods, and `cacheInventory` uses `36000`. There are two readings, both bad:

- If all four were *meant* to be one hour (`3600`), then `36000` (ten hours) is a **dropped/extra digit bug** — inventory is cached ten times longer than intended, so customers see stale stock counts ("in stock" when it sold out) for hours. The bare literal hid the discrepancy; nobody noticed `36000` ≠ `3600` in a wall of similar numbers.
- If `36000` was intentional (inventory legitimately caches longer), the code gives no way to know that — the *intent* is invisible, and the duplicated `3600`s mean changing "the default TTL" requires hunting down each copy and hoping you don't miss one (and don't accidentally change the deliberate `36000`).

Either way, the magic numbers + copy-paste combination is what made the bug possible and undiagnosable. Duplicated unexplained literals are the worst of both shortcuts at once.

**Fix — name each TTL by intent; the names make the difference deliberate and the values single-sourced:**

```java
public class ProductCache {
    private static final int TTL_DEFAULT_SECONDS   = 3_600;    // 1 hour
    private static final int TTL_INVENTORY_SECONDS = 600;      // 10 min — stock must be fresh

    void cacheProduct(Product p)        { redis.setex(key(p.id()), TTL_DEFAULT_SECONDS, serialize(p)); }
    void cachePrice(long id, Money m)   { redis.setex("price:" + id, TTL_DEFAULT_SECONDS, m.toString()); }
    void cacheInventory(long id, int n) { redis.setex("inv:" + id, TTL_INVENTORY_SECONDS, String.valueOf(n)); }
    void cacheReviews(long id, String json) { redis.setex("rev:" + id, TTL_DEFAULT_SECONDS, json); }
}
```

Now the inventory TTL's difference is *named and intentional* (and corrected — fresh stock data wants a *shorter* TTL, not a longer one), and changing the default touches exactly one line. If TTLs vary by environment, they belong in configuration.

</details>

---

## Summary — how to spot bad shortcuts

You rarely spot a bad shortcut by a line being *ugly* — these slip through casual review precisely because each one looks like a reasonable convenience. You spot them by **tracing the consequence** and by **asking a few sharp questions on every diff**:

- **For every duplicated block, find the line that should have differed.** Copy-paste bugs hide in the *one* spot the author forgot to change — a status set wrong (Snippet 1), a security fix applied to one twin but not the other (Snippet 8), a function that doesn't do what its name promises (Snippet 11). The fix-here-still-broken-there bug is the most expensive of the family.
- **Read every literal twice and check it against its comment/intent.** `8640` vs `86400` (Snippet 2), `36000` vs `3600` (Snippet 14) — off-by-a-digit bugs are invisible inside bare numbers and obvious once named. A literal that needs a comment needs a *name*; a literal that varies by environment needs *config*.
- **Treat any secret or environment value in source as a bug, not a style nit.** A committed `bm`/password is a security incident requiring **rotation**, not just deletion (Snippets 3, 12); a `/Users/maria/...` path or hard-coded host breaks every other machine. Run a secret scanner in pre-commit.
- **Hunt every swallowed error.** Empty `catch`, bare `except: pass`, `except Exception`, and Go's `_ =` discard convert failures into silent corruption, lost work, double-charges, or open security holes (Snippets 6, 7, 9). Catch *narrowly*, act meaningfully, and let bugs crash loudly.
- **For every `String`/`int` with a fixed value set, look for a typo or case drift.** Stringly-typed code fails at runtime on a one-character mistake the compiler could have caught — `"admin"` vs `"Admin"` (Snippet 4), `"confirmd"` and `"Delivered"` (Snippet 10). Reach for an enum or a domain type.
- **Resist the false positive.** Not every literal is a magic number (`/ 100` for cents, Snippet 11) and not every string is stringly-typed (an open, data-defined tag map, Snippet 13). The diagnostic is *purpose and clarity*, not shape: name a literal when its meaning is unclear or unstable; enum-ify a string only when the value set is **closed and code-known**. Over-correcting (enum-ifying open sets, over-configuring) is its own anti-pattern.

The meta-lesson: **bad shortcuts don't just make code harder to maintain — they manufacture concrete bugs and security holes.** A copy-paste lost a status update and left a vulnerability live; a magic number logged everyone out early; a swallowed error double-charged a customer and lost a payment; a case-mismatched string broke authorization. When you see a shortcut, don't stop at "that's not clean" — ask *"what does it break right now?"* The answer is often sitting one line away.

---

## Related Topics

- [`junior.md`](junior.md) — what each of the six shortcuts looks like and why it's bad.
- [`middle.md`](middle.md) — when these creep in under pressure, and the trap inside each "fix" (over-DRY, over-config, over-typing).
- [`tasks.md`](tasks.md) — exercises that build the same muscles from the writing side.
- [`optimize.md`](optimize.md) — flawed implementations to refactor end-to-end.
- [`interview.md`](interview.md) — Q&A across all levels.
- [Clean Code → Error Handling](../../../clean-code/06-error-handling/README.md) — the cure for Pokémon exception handling.
- [Clean Code → Meaningful Names](../../../clean-code/01-meaningful-names/README.md) — naming away magic values.
- [DRY Principle](../../../clean-code/README.md) — extracting copy-pasted knowledge (and its limits).
- [Secrets Management](../../../../../Architecture/system-design/README.md) — handling credentials so they never reach git.
- [Bad Structure](../01-bad-structure/find-bug.md) and [Over-Engineering](../03-over-engineering/find-bug.md) — the sibling find-bug files.