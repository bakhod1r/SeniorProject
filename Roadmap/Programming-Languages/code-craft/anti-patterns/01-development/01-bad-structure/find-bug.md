# Bad Structure Anti-Patterns — Find the Bug

> **Category:** [Development Anti-Patterns](../README.md) → **Bad Structure** — *code that has grown into a shape that resists change.*
> **Covers (collectively):** God Object · Spaghetti Code · Lava Flow · Boat Anchor · Arrow Anti-Pattern

---

This file is **critical-reading practice**. Each snippet below is a plausible chunk of real-world code in Go, Java, or Python. Your job is to read it the way a good reviewer does and answer three questions:

> **What anti-pattern(s) are present? What concrete problem(s) does it cause? How would you fix it?**

These are *structural* anti-patterns, so the "bug" is usually not a crash on line one — it's a latent flaw in the *shape* of the code that makes it expensive to change. But structure isn't only aesthetic: bad shape **hides and causes real functional bugs**, and several snippets here contain one. Some snippets are deliberately innocent-looking — code that would sail through a casual review. Read slowly, then open the answer.

> **How to use this file:** read each snippet and write your own answer *before* expanding the collapsible. The skill you're training is noticing the shape, not recalling the name.

---

## Table of Contents

1. [The dispatcher that grew a tail](#snippet-1--the-dispatcher-that-grew-a-tail)
2. [A reasonable-looking order service](#snippet-2--a-reasonable-looking-order-service)
3. [Three steps and a dictionary](#snippet-3--three-steps-and-a-dictionary)
4. [The validator pyramid](#snippet-4--the-validator-pyramid)
5. [The exporter nobody calls](#snippet-5--the-exporter-nobody-calls)
6. [The comment that guards the code](#snippet-6--the-comment-that-guards-the-code)
7. [A cache with a helpful method](#snippet-7--a-cache-with-a-helpful-method)
8. [The discount calculator](#snippet-8--the-discount-calculator)
9. [The interface with one implementation](#snippet-9--the-interface-with-one-implementation)
10. [The retry loop that learned to flag](#snippet-10--the-retry-loop-that-learned-to-flag)
11. [The report builder](#snippet-11--the-report-builder)
12. [Two ways to compute the same total](#snippet-12--two-ways-to-compute-the-same-total)
13. [The settings singleton](#snippet-13--the-settings-singleton)
14. [The nested permission check](#snippet-14--the-nested-permission-check)

---

## Snippet 1 — The dispatcher that grew a tail

```python
# Python — an event handler in a long-lived service
def handle_event(event, ctx):
    if event["type"] == "order.created":
        if event["payload"].get("items"):
            if ctx.user.is_active:
                order = build_order(event["payload"])
                if order.total > 0:
                    if charge(ctx.user, order.total):
                        save(order)
                        send_email(ctx.user, "order_confirmed", order)
                        return {"ok": True}
                    else:
                        return {"ok": False, "reason": "charge_failed"}
                else:
                    return {"ok": False, "reason": "empty_total"}
            else:
                return {"ok": False, "reason": "inactive_user"}
        else:
            return {"ok": False, "reason": "no_items"}
    elif event["type"] == "order.cancelled":
        # ... another 30 lines, same shape ...
        pass
```

> What anti-pattern(s) are present? What concrete problem(s) does it cause? How would you fix it?

<details>
<summary>Answer</summary>

**Arrow Anti-Pattern** (and the seed of **Spaghetti Code** as more `event["type"]` branches accrete).

The success path — `build → charge → save → email` — is buried five indents deep, surrounded by gatekeeping `else` branches. Every new precondition pushes the real work further right, and every new event type duplicates the whole pyramid. The cognitive load is high: to read the happy path you must hold five open conditions in your head, and it's easy to attach a new `else` to the wrong `if`.

**Concrete risk:** when someone adds a sixth precondition, the failure-reason `else` clauses get misaligned and the wrong reason is returned — a real bug that the shape makes likely.

**Fix — guard clauses for the validation, a handler map for the dispatch:**

```python
HANDLERS = {"order.created": _on_created, "order.cancelled": _on_cancelled}

def handle_event(event, ctx):
    handler = HANDLERS.get(event["type"])
    if handler is None:
        return {"ok": False, "reason": "unknown_event"}
    return handler(event["payload"], ctx)

def _on_created(payload, ctx):
    if not payload.get("items"):   return {"ok": False, "reason": "no_items"}
    if not ctx.user.is_active:     return {"ok": False, "reason": "inactive_user"}
    order = build_order(payload)
    if order.total <= 0:           return {"ok": False, "reason": "empty_total"}
    if not charge(ctx.user, order.total):
        return {"ok": False, "reason": "charge_failed"}
    save(order)
    send_email(ctx.user, "order_confirmed", order)
    return {"ok": True}
```

The happy path is now flat and last; each event type is a small, separately-testable function.

</details>

---

## Snippet 2 — A reasonable-looking order service

```java
// Java — looks like a normal service class; would pass a casual review
public class OrderService {
    private final Database db;
    private final SmtpClient smtp;
    private final PaymentGateway gateway;
    private final PdfRenderer pdf;
    private final S3Client s3;
    private final SlackClient slack;
    private final InventoryApi inventory;
    private final TaxApi tax;

    public Order create(OrderRequest r) { /* validate, price, persist */ }
    public void charge(Order o)         { /* gateway.charge(...) */ }
    public void refund(Order o)         { /* gateway.refund(...) */ }
    public byte[] invoicePdf(Order o)   { /* pdf.render(...) */ }
    public void emailInvoice(Order o)   { /* smtp.send(...) */ }
    public void archiveInvoice(Order o) { /* s3.put(...) */ }
    public void notifyOps(Order o)      { /* slack.post(...) */ }
    public boolean inStock(Order o)     { /* inventory.check(...) */ }
    public BigDecimal taxFor(Order o)   { /* tax.compute(...) */ }
    public void exportDailyCsv()        { /* db + file I/O */ }
}
```

> What anti-pattern(s) are present? What concrete problem(s) does it cause? How would you fix it?

<details>
<summary>Answer</summary>

**God Object.** The class is short *per method*, which is exactly why it passes a casual review — but look at the **constructor dependencies**: database, SMTP, payments, PDF, S3, Slack, inventory, and tax. That's eight collaborators, which means eight unrelated reasons to change. Pricing, emailing, archiving, ops-notification, and reporting all live in one place.

**Concrete problems:**
- **Untestable in isolation.** To unit-test `create`, you must construct (or mock) all eight dependencies, even though `create` uses maybe two.
- **Change magnet.** The payments team, the reporting team, and the ops team all edit this file → merge conflicts and accidental breakage.
- **Hidden coupling.** A change to the Slack client signature forces a recompile/redeploy of the order-creation path.

**Smell test from `junior.md`:** describe it and you need *"and"* repeatedly — "it creates **and** charges **and** renders PDFs **and** posts to Slack **and** computes tax."

**Fix:** split by responsibility and let a thin coordinator orchestrate. Count the constructor args as a first-order God-Object detector.

```java
class OrderCreation { OrderCreation(Database db, PricingService p) {...} }
class Billing       { Billing(PaymentGateway g) {...} }   // charge, refund
class Invoicing     { Invoicing(PdfRenderer pdf, SmtpClient s, S3Client s3) {...} }
class OpsNotifier   { OpsNotifier(SlackClient slack) {...} }
// OrderService (if it survives) just wires these together for one use case.
```

</details>

---

## Snippet 3 — Three steps and a dictionary

```python
# Python — an import job split across three functions
_ctx = {}

def load(path):
    _ctx["rows"] = read_csv(path)
    _ctx["loaded"] = True

def transform():
    rows = _ctx["rows"]                      # KeyError if load() didn't run
    _ctx["clean"] = [normalize(r) for r in rows]

def store():
    if _ctx.get("loaded"):
        db.bulk_insert(_ctx["clean"])        # KeyError if transform() didn't run
        _ctx.clear()

def run_import(path):
    load(path)
    store()                                  # <-- note the call order
    transform()
```

> What anti-pattern(s) are present? What concrete problem(s) does it cause? How would you fix it?

<details>
<summary>Answer</summary>

**Spaghetti Code** — *and it contains a real functional bug that the structure hides.*

The three functions communicate through a shared module-level dict `_ctx` and are silently **order-dependent**. The "program" is the implicit call sequence, not anything visible in a single function.

**The actual bug:** `run_import` calls `store()` *before* `transform()`. `store` guards on `_ctx.get("loaded")` (which is `True` after `load`), so it proceeds — but `_ctx["clean"]` doesn't exist yet, so it raises `KeyError`. Even if you reorder it correctly, the design is fragile: the `loaded` flag guards `store` but the data `store` actually needs (`clean`) is produced by `transform`, so the guard checks the *wrong* precondition. A reviewer skimming for "does each function look right?" misses it because each function looks fine in isolation — the bug lives in the *coupling*.

**Fix — make data flow explicit; pass values in, return values out:**

```python
def run_import(path):
    rows  = read_csv(path)
    clean = [normalize(r) for r in rows]
    db.bulk_insert(clean)
```

No shared state, no flags, no order-dependence — the sequence is encoded in the code, and the `KeyError`-by-reordering bug becomes impossible.

</details>

---

## Snippet 4 — The validator pyramid

```go
// Go — request validation in an HTTP handler
func validate(req *Request) (*Account, error) {
    if req != nil {
        if req.Token != "" {
            acct, err := lookup(req.Token)
            if err == nil {
                if acct != nil {
                    if acct.Verified {
                        if req.Amount > 0 {
                            if req.Amount <= acct.Balance {
                                return acct, nil
                            } else {
                                return nil, errors.New("insufficient funds")
                            }
                        } else {
                            return nil, errors.New("amount must be positive")
                        }
                    } else {
                        return nil, errors.New("account not verified")
                    }
                }
            }
        }
    }
    return nil, errors.New("invalid request")
}
```

> What anti-pattern(s) are present? What concrete problem(s) does it cause? How would you fix it?

<details>
<summary>Answer</summary>

**Arrow Anti-Pattern** — *with a swallowed error that becomes a misleading bug.*

The pyramid hides a defect: when `lookup` returns a non-nil `err`, **none** of the inner branches run and execution falls through to the catch-all `return nil, errors.New("invalid request")`. A real database error (timeout, connection failure) is silently relabeled as "invalid request." The caller — and the user — sees a 400-style "your request is invalid" when the truth is a 500-style infrastructure failure. The structure caused the bug: the `err` from `lookup` has nowhere to go in this shape, so it's discarded.

**Fix — guard clauses surface every failure on its own line, error included:**

```go
func validate(req *Request) (*Account, error) {
    if req == nil || req.Token == "" {
        return nil, errors.New("invalid request")
    }
    acct, err := lookup(req.Token)
    if err != nil {
        return nil, fmt.Errorf("lookup failed: %w", err)   // no longer swallowed
    }
    if acct == nil {
        return nil, errors.New("account not found")
    }
    if !acct.Verified {
        return nil, errors.New("account not verified")
    }
    if req.Amount <= 0 {
        return nil, errors.New("amount must be positive")
    }
    if req.Amount > acct.Balance {
        return nil, errors.New("insufficient funds")
    }
    return acct, nil
}
```

</details>

---

## Snippet 5 — The exporter nobody calls

```go
// Go — an export package in a 4-year-old codebase
type Exporter interface {
    CSV(r Report) ([]byte, error)
    JSON(r Report) ([]byte, error)
    XML(r Report) ([]byte, error)
    XLSX(r Report) ([]byte, error)
    Parquet(r Report) ([]byte, error)
}

type exporter struct{ /* ... */ }

func (e *exporter) CSV(r Report) ([]byte, error)     { /* used everywhere */ }
func (e *exporter) JSON(r Report) ([]byte, error)    { /* used by one endpoint */ }
func (e *exporter) XML(r Report) ([]byte, error)     { /* 120 lines; zero call sites */ }
func (e *exporter) XLSX(r Report) ([]byte, error)    { /* 200 lines; zero call sites */ }
func (e *exporter) Parquet(r Report) ([]byte, error) { /* 90 lines; zero call sites */ }
```

> What anti-pattern(s) are present? What concrete problem(s) does it cause? How would you fix it?

<details>
<summary>Answer</summary>

**Boat Anchor** (the unused `XML`/`XLSX`/`Parquet` formats), riding on a **fat interface** (an Interface Segregation problem).

These three formats were built "so we're ready for any customer request." That request never came. The 410 lines of unused code still compile, get refactored "for consistency," appear in every grep, and — worst — are **never exercised by tests or traffic**, so they rot. The day someone finally wires up `Parquet`, it'll be subtly broken and nobody will know.

The fat interface compounds it: any *real* alternative implementation (say, a test fake) must stub all five methods including the three nobody uses.

**Fix:** delete the unused methods (git keeps them). Shrink the interface to what callers actually need. Rebuild a format *when a real requirement arrives* — it'll be cheaper and better-designed against a concrete need (YAGNI).

```go
type Exporter interface {
    CSV(r Report) ([]byte, error)
    JSON(r Report) ([]byte, error)
}
```

> **Distinction:** this is a Boat Anchor (kept for an *imagined future*), not Lava Flow (kept out of *fear/ignorance*). The cure is the same — delete — but the diagnosis differs.

</details>

---

## Snippet 6 — The comment that guards the code

```python
# Python — pricing logic in a checkout module
def final_price(cart, user):
    subtotal = sum(i.price * i.qty for i in cart.items)

    # ---- DO NOT REMOVE ----
    # Legacy promo adjustment. Breaks the EU tax report if deleted (2021).
    # Nobody is sure why. Ask Dmitri (left the company). Keep it.
    legacy = 0
    if user.country in ("DE", "FR", "IT"):
        legacy = round(subtotal * 0.0)        # multiplies by zero
        subtotal = subtotal - legacy
    # ------------------------

    discount = apply_coupons(cart, user)
    return subtotal - discount
```

> What anti-pattern(s) are present? What concrete problem(s) does it cause? How would you fix it?

<details>
<summary>Answer</summary>

**Lava Flow.** The "DO NOT REMOVE / nobody is sure why / ask the person who left" comment is the textbook Lava Flow marker — fossilized code preserved by fear rather than understanding.

Read what it actually *does*: `legacy = round(subtotal * 0.0)` is always `0`, so `subtotal = subtotal - 0` is a no-op. The entire guarded block has **zero runtime effect**. It survives only because a scary comment told everyone to leave it alone.

**Concrete cost:** every reader of `final_price` stops, reads the warning, and reasons about EU tax behavior that doesn't exist — wasting attention and *misleading* them into thinking country-specific pricing is happening here. New EU-pricing requirements may be (wrongly) bolted onto this dead block.

**Fix — replace fear with evidence, then delete.** `git log -p`/`git blame` the block: it likely shows the multiplier was changed from a real rate to `0.0` in some past hotfix and never cleaned up. With the multiply-by-zero proving it's inert, delete the whole block in its own commit:

```python
def final_price(cart, user):
    subtotal = sum(i.price * i.qty for i in cart.items)
    discount = apply_coupons(cart, user)
    return subtotal - discount
```

If real country-specific pricing is ever needed, build it deliberately — don't resurrect a fossil.

</details>

---

## Snippet 7 — A cache with a helpful method

```java
// Java — an in-memory cache shared across request threads
public class UserCache {
    private final Map<Long, User> map = new HashMap<>();

    public User get(long id) {
        User u = map.get(id);
        if (u == null) {
            u = db.load(id);          // expensive
            map.put(id, u);
        }
        return u;
    }

    // "Convenience" method added later by another team
    public int getAndIncrementVisits(long id) {
        User u = get(id);
        u.visits = u.visits + 1;      // mutates the shared cached object
        return u.visits;
    }
}
```

> What anti-pattern(s) are present? What concrete problem(s) does it cause? How would you fix it?

<details>
<summary>Answer</summary>

**God Object growth → a real concurrency bug.** `UserCache` started with one job (cache reads). Then another team bolted on `getAndIncrementVisits`, mixing in **state mutation** and **business logic** (visit counting) — responsibilities that don't belong in a cache.

**The actual bug, caused by the structure:** `get` uses a plain `HashMap` with no synchronization, and `getAndIncrementVisits` does a non-atomic read-modify-write (`u.visits + 1`) on an object **shared across threads**. Under concurrent requests:
- The `HashMap` itself can corrupt or infinite-loop on concurrent `put` (classic Java `HashMap` resize hazard).
- `visits++` loses updates — two threads read 5, both write 6.

A pure cache wouldn't expose mutable shared state to this misuse; the God-Object accretion *created the surface* for the race. A reviewer who only checks "does the increment look right?" misses it — the bug is the interaction of caching + mutation + threads.

**Fix:** keep the cache doing one job and move visit counting out, with proper atomicity.

```java
public class UserCache {                       // one responsibility: caching
    private final ConcurrentMap<Long, User> map = new ConcurrentHashMap<>();
    public User get(long id) { return map.computeIfAbsent(id, db::load); }
}

public class VisitCounter {                    // separate, thread-safe concern
    private final ConcurrentMap<Long, AtomicInteger> visits = new ConcurrentHashMap<>();
    public int increment(long id) {
        return visits.computeIfAbsent(id, k -> new AtomicInteger()).incrementAndGet();
    }
}
```

</details>

---

## Snippet 8 — The discount calculator

```python
# Python — discount engine reused across many call sites over the years
def calc_discount(price, customer, *, is_holiday=False, is_clearance=False,
                  is_employee=False, stack=False, legacy_mode=False):
    d = 0
    if legacy_mode:
        d = price * 0.05
    else:
        if is_employee:
            d = price * 0.30
            if stack and is_holiday:
                d = d + price * 0.10
        elif is_holiday:
            d = price * 0.15
            if is_clearance:
                if stack:
                    d = d + price * 0.20
                else:
                    d = price * 0.20      # replaces, not adds
        elif is_clearance:
            d = price * 0.25
    if customer.tier == "gold" and not legacy_mode:
        d = d + price * 0.05
    return min(d, price)
```

> What anti-pattern(s) are present? What concrete problem(s) does it cause? How would you fix it?

<details>
<summary>Answer</summary>

**Spaghetti Code via flag arguments** + **Arrow Anti-Pattern**, with a latent **correctness bug** in the combinatorics.

Five boolean flags (`is_holiday`, `is_clearance`, `is_employee`, `stack`, `legacy_mode`) mean up to 32 input combinations crammed into one body, with nested `if`s deciding whether each discount *adds* (`d = d + ...`) or *replaces* (`d = ...`). Callers can't tell which combinations are valid, and the maintainer can't reason about all 32 paths.

**The hidden bug:** in the `is_holiday + is_clearance + not stack` branch, `d = price * 0.20` *overwrites* the holiday discount (`d = price * 0.15`) computed two lines above — so a holiday-clearance item without stacking gets a *smaller* discount (20%) than a plain clearance item (25%) in the `elif is_clearance` branch. Almost certainly unintended, and effectively invisible inside the pyramid of flags. This is the classic way flag-driven spaghetti births revenue bugs.

**Fix:** model discounts as a list of rules and compose them explicitly. Each rule is independently testable; "add vs replace" becomes a property of the rule, not a buried line.

```python
def calc_discount(price, customer):
    rules = active_discount_rules(customer)        # returns list of Rule objects
    total = sum(r.amount(price) for r in rules if r.applies(customer))
    return min(total, price)
```

Eliminating the flags eliminates the 32-path explosion *and* the overwrite bug.

</details>

---

## Snippet 9 — The interface with one implementation

```go
// Go — a "clean architecture" repository layer
type UserRepository interface {
    FindByID(id int64) (*User, error)
    FindByEmail(email string) (*User, error)
    Save(u *User) error
    Delete(id int64) error
}

type postgresUserRepository struct{ db *sql.DB }   // the only implementation

func (r *postgresUserRepository) FindByID(id int64) (*User, error) { /* ... */ }
func (r *postgresUserRepository) FindByEmail(e string) (*User, error) { /* ... */ }
func (r *postgresUserRepository) Save(u *User) error { /* ... */ }
func (r *postgresUserRepository) Delete(id int64) error { /* ... */ }

// In tests:
func TestSignup(t *testing.T) {
    repo := &mockUserRepository{}   // a second implementation, used by tests
    ...
}
```

> What anti-pattern(s) are present? What concrete problem(s) does it cause? How would you fix it?

<details>
<summary>Answer</summary>

**Trick snippet: this is NOT a Boat Anchor.** This is the kind of code that *looks* like over-abstraction but earns its keep.

An interface with one production implementation is a Boat Anchor **only if it exists for a hypothetical future**. Here the interface serves a real need *today*: the tests inject `mockUserRepository`, so the abstraction is a genuine **test seam** — exactly the justified case `middle.md` calls out (mock injection, published contract, or confirmed near-term second impl).

**What would make it a Boat Anchor:** if there were no `mockUserRepository`, no second impl planned, and tests hit a real database anyway — then the interface would be pure ceremony and you'd inline it. The diagnostic question is *"does this abstraction do work today?"* Here the answer is yes (it enables fast, isolated tests).

**The lesson for critical reading:** don't pattern-match on "interface + one impl = bad." Count the *actual* consumers, including tests. Abstractions are Boat Anchors by **purpose**, not by shape.

> If anything, watch the interface's *width*: if `Delete` and `FindByEmail` have no callers, trim them (that part *would* be Boat-Anchor ballast), but the seam itself is sound.

</details>

---

## Snippet 10 — The retry loop that learned to flag

```java
// Java — an HTTP client wrapper, evolved over several tickets
public Response call(Request req, boolean retry, boolean cache,
                     boolean async, boolean logBody) {
    if (cache) {
        Response cached = CACHE.get(req.key());
        if (cached != null) {
            if (logBody) { LOG.info(cached.body()); }
            return cached;
        }
    }
    Response resp = null;
    int attempts = retry ? 3 : 1;
    for (int i = 0; i < attempts; i++) {
        try {
            resp = transport.send(req, async);
            if (resp.code() < 500) { break; }
        } catch (IOException e) {
            if (i == attempts - 1) { throw new RuntimeException(e); }
        }
    }
    if (cache && resp != null) { CACHE.put(req.key(), resp); }
    if (logBody && resp != null) { LOG.info(resp.body()); }
    return resp;
}
```

> What anti-pattern(s) are present? What concrete problem(s) does it cause? How would you fix it?

<details>
<summary>Answer</summary>

**Spaghetti via flag arguments**, with a **latent NPE bug** the flags hide.

Four booleans (`retry`, `cache`, `async`, `logBody`) braid four orthogonal concerns — caching, retrying, transport mode, logging — into one method. Each ticket added a flag instead of a new abstraction, so the body is a maze where the valid combinations are unknowable from the signature.

**The hidden bug:** if `retry` is `false` (`attempts == 1`) and the single `transport.send` throws `IOException`, the `catch` block's guard `if (i == attempts - 1)` *does* rethrow — okay. But if `transport.send` returns a `resp` with `code() >= 500` on the only attempt, the loop ends with `resp` non-null and we return a 500 response silently. Worse: if `attempts > 0` but every attempt throws and `retry` is later refactored, the `resp != null` guards mean a *successful-looking* `return resp` of `null` can leak to a caller that immediately dereferences it. The flag soup makes these paths nearly impossible to enumerate in review.

**Fix:** separate the concerns. Caching and logging are cross-cutting → wrap them as decorators/middleware; retry is a policy → make it a strategy. The core call becomes flag-free.

```java
Response resp = retryPolicy.execute(() -> transport.send(req));   // retry isolated
// caching + logging applied by wrapping clients, not by booleans inside call()
```

> **Rule of thumb (`middle.md`):** more than ~2 boolean parameters is spaghetti forming. This has four.

</details>

---

## Snippet 11 — The report builder

```python
# Python — generates a weekly metrics report; called by a cron job
class ReportBuilder:
    def __init__(self, db, mailer, s3, pdf, slack, config, clock, cache):
        self.db, self.mailer, self.s3 = db, mailer, s3
        self.pdf, self.slack, self.config = pdf, slack, config
        self.clock, self.cache = clock, cache

    def build_and_send(self, team_id):
        data = self._query(team_id)
        if data:
            if self.config.get("pdf_enabled"):
                pdf_bytes = self._render_pdf(data)
                if self.config.get("archive_enabled"):
                    url = self._archive(pdf_bytes)
                    if self.config.get("notify_enabled"):
                        if self.config.get("use_slack"):
                            self._slack(team_id, url)
                        else:
                            self._email(team_id, pdf_bytes)
        # old XML path — superseded by PDF in 2022, kept "in case finance asks"
        # xml = self._render_xml(data); self.s3.put(...)   # commented out

    def _render_xml(self, data): ...   # 80 lines, only caller is commented out
```

> What anti-pattern(s) are present? What concrete problem(s) does it cause? How would you fix it?

<details>
<summary>Answer</summary>

**Three reinforcing anti-patterns at once** — this is a gravity well.

1. **God Object:** eight injected collaborators (db, mailer, s3, pdf, slack, config, clock, cache) — reporting, rendering, archiving, and notification all in one class. Untestable without mocking everything.
2. **Arrow Anti-Pattern:** `build_and_send` nests config-flag checks four deep, hiding the actual work (render → archive → notify) at the bottom of a pyramid driven by configuration booleans (a touch of [Soft Coding](../03-over-engineering/middle.md) too).
3. **Lava Flow / Boat Anchor:** `_render_xml` is 80 lines whose only caller is a commented-out line, preserved "in case finance asks." Dead code kept by hope.

**Concrete problems:** the config-flag nesting means certain combinations silently do nothing (e.g. `pdf_enabled` true, `archive_enabled` false → `notify` never runs even though a PDF exists, because notification is nested *inside* archiving — likely a bug). The dead XML code rots and misleads.

**Fix:**
- Split responsibilities: `MetricsQuery`, `PdfReport`, `Archiver`, `Notifier`.
- Flatten with guard clauses and lift notification out of the archiving branch so the intended logic is explicit.
- Delete `_render_xml` and the commented line; git remembers.

```python
def build_and_send(self, team_id):
    data = self.metrics.query(team_id)
    if not data:                       return
    if not self.config.pdf_enabled:    return
    pdf = self.report.render(data)
    if self.config.archive_enabled:    self.archiver.store(pdf)
    self.notifier.send(team_id, pdf)   # no longer trapped inside archiving
```

</details>

---

## Snippet 12 — Two ways to compute the same total

```java
// Java — an AccountManager that has accumulated everything about accounts
public class AccountManager {
    private List<Transaction> txns = new ArrayList<>();
    private BigDecimal cachedBalance = BigDecimal.ZERO;

    public void addTransaction(Transaction t) {
        txns.add(t);
        cachedBalance = cachedBalance.add(t.amount());   // keep cache in sync
    }

    public BigDecimal getBalance() {
        return cachedBalance;                            // fast path
    }

    public BigDecimal getStatementBalance() {            // used by the PDF statement
        BigDecimal sum = BigDecimal.ZERO;
        for (Transaction t : txns) {
            if (!t.isPending()) {                        // statements exclude pending
                sum = sum.add(t.amount());
            }
        }
        return sum;
    }

    public void removeTransaction(Transaction t) {
        txns.remove(t);                                  // forgot to update cachedBalance!
    }
    // ... 30 more methods: PDF, email, CSV export, audit log ...
}
```

> What anti-pattern(s) are present? What concrete problem(s) does it cause? How would you fix it?

<details>
<summary>Answer</summary>

**God Object** harboring **two divergent sources of truth** — and a concrete consistency **bug**.

`AccountManager` does everything about accounts (transactions, balance, statements, PDF, email, CSV, audit). Within that sprawl, two methods compute "the balance" two different ways: `getBalance()` returns a manually-maintained `cachedBalance`, while `getStatementBalance()` recomputes from `txns` (excluding pending). Because the God Object owns both, nothing forces them to agree.

**The actual bug:** `removeTransaction` updates `txns` but **forgets to update `cachedBalance`**. After a removal, `getBalance()` (cached) and a fresh sum diverge permanently — the customer sees one number in the app and a different one on their statement. This is a classic God-Object failure mode: too many methods touching the same fields, so an invariant ("cache mirrors txns") gets violated by one of them. A reviewer scanning `removeTransaction` alone sees a one-line method that "looks fine."

**Fix:** there should be **one** way to compute balance, owned by a small, cohesive type that can't get out of sync.

```java
class Ledger {                                  // one responsibility: the truth about money
    private final List<Transaction> txns = new ArrayList<>();
    void add(Transaction t)    { txns.add(t); }
    void remove(Transaction t) { txns.remove(t); }
    BigDecimal balance()           { return sum(txns, t -> true); }
    BigDecimal statementBalance()  { return sum(txns, t -> !t.isPending()); }
    // no cached field to fall out of sync; cache later only if profiling demands it
}
```

PDF/email/CSV/audit each move to their own classes. The invariant is now impossible to break because there's no second copy to forget.

</details>

---

## Snippet 13 — The settings singleton

```python
# Python — global settings used throughout the app
class Settings:
    _instance = None

    def __new__(cls):
        if cls._instance is None:
            cls._instance = super().__new__(cls)
        return cls._instance

    def __init__(self):
        self.db_url = os.environ["DB_URL"]
        self.timeout = 30
        self.feature_x = False

settings = Settings()

# elsewhere, in a request handler:
def handle(req):
    if req.beta_user:
        settings.feature_x = True        # flip the global flag for beta users
    result = run_pipeline(settings)
    return result
```

> What anti-pattern(s) are present? What concrete problem(s) does it cause? How would you fix it?

<details>
<summary>Answer</summary>

**God Object (a global "knows-everything" singleton)** producing a **shared-mutable-state bug** — the kind of Spaghetti where behavior depends on hidden global state set elsewhere.

`Settings` is a single global object every part of the app reaches into. That alone is a mild God Object. The real damage is the handler **mutating the shared global** (`settings.feature_x = True`) to customize behavior for one request.

**The actual bug:** `Settings` is a process-wide singleton. In a multi-threaded or async server, one beta user's request flips `feature_x` to `True` *for every concurrent request*, and it **never gets reset** — so non-beta users start hitting the beta path. Worse, two requests racing on this flag produce non-deterministic behavior. The flow is order- and timing-dependent through invisible global state: textbook spaghetti, enabled by the God-Object singleton.

**Fix:** make configuration immutable and pass per-request variation explicitly — never mutate shared globals to carry request-scoped data.

```python
@dataclass(frozen=True)
class Settings:                       # immutable, read-only
    db_url: str
    timeout: int = 30

def handle(req, settings):            # settings injected, not global
    ctx = RequestContext(feature_x=req.beta_user)   # per-request, not shared
    return run_pipeline(settings, ctx)
```

Per-request state lives in a per-request object; global config is immutable and safe to share.

</details>

---

## Snippet 14 — The nested permission check

```go
// Go — middleware-style authorization, would pass a quick review
func authorize(u *User, res *Resource, action string) bool {
    if u != nil {
        if !u.Banned {
            if u.Role == "admin" {
                return true
            } else {
                if res.OwnerID == u.ID {
                    if action == "read" || action == "write" {
                        return true
                    } else if action == "delete" {
                        if u.Role == "editor" {
                            return true
                        }
                    }
                } else {
                    if res.IsPublic {
                        if action == "read" {
                            return true
                        }
                    }
                }
            }
        }
    }
    return false
}
```

> What anti-pattern(s) are present? What concrete problem(s) does it cause? How would you fix it?

<details>
<summary>Answer</summary>

**Arrow Anti-Pattern** guarding **security logic** — and it hides a real **authorization bug**. This is the most dangerous combination: deep nesting in code where a wrong fall-through means a privilege escalation or an unintended denial.

Trace the owner-delete path carefully: an owner who is *not* an `editor` (say, `Role == "viewer"`) requesting `delete` matches `res.OwnerID == u.ID`, enters the `action == "delete"` branch, fails `u.Role == "editor"`, and falls through to `return false`. Fine. But notice an owner with `action == "delete"` who *is* an editor returns `true` — while an owner with **any other action** (e.g. `"share"`) silently falls through every inner branch to `return false`. That may or may not be intended, but it's *invisible* in the pyramid. The actual latent bug: the structure makes it trivial to add a new action and attach its `if` to the wrong nesting level, accidentally granting access. Security code with five-deep nesting is where "the wrong `else`" becomes a CVE.

**Fix:** flatten into guard clauses / explicit allow-rules so every grant is one readable line and the default is deny.

```go
func authorize(u *User, res *Resource, action string) bool {
    if u == nil || u.Banned { return false }   // deny by default, fail closed
    if u.Role == "admin"    { return true }

    if res.OwnerID == u.ID {
        switch action {
        case "read", "write": return true
        case "delete":        return u.Role == "editor"
        }
        return false
    }
    if res.IsPublic && action == "read" { return true }
    return false
}
```

Every authorization decision is now explicit and auditable; adding an action means adding one `case`, not threading a new `if` through a pyramid.

</details>

---

## Summary — patterns of spotting

You don't spot structural anti-patterns by recognizing a single bad line — you spot them by **shape and by the questions you ask**. The repeatable moves from these fourteen snippets:

- **Count the constructor arguments / injected collaborators.** Eight unrelated dependencies is a God Object regardless of how short each method is (Snippets 2, 11, 12). It's the fastest God-Object detector and survives casual review.
- **Count the boolean parameters.** More than ~2 flags braiding orthogonal concerns is Spaghetti forming, and the combinatorial paths reliably hide a bug (Snippets 8, 10).
- **Find the deepest indent and read the fall-through.** In Arrow code the real logic is deepest and the *default* `return` at the bottom is where swallowed errors and wrong decisions hide (Snippets 1, 4, 14). Security/money code nested this deep is a bug magnet.
- **Trace shared mutable state across functions/threads/requests.** Order-dependence (Snippet 3), concurrent mutation (Snippets 7, 13), and a forgotten cache update (Snippet 12) are bugs the *coupling* causes — each function "looks fine" alone.
- **Interrogate dead and unused code.** "DO NOT REMOVE, nobody's sure why" is Lava Flow (Snippet 6); a fully-built feature with zero call sites is a Boat Anchor (Snippets 5, 11). Both are deletable — git is the safety net.
- **Resist false positives.** An interface with one production impl is *justified* if tests (or a real contract) consume it — Boat Anchors are defined by *purpose*, not shape (Snippet 9). Count the real consumers, including tests, before crying "over-abstraction."

The meta-lesson: **bad structure isn't only aesthetic.** A God Object caused a lost-update race; an Arrow swallowed a 500 as a 400; flag-soup hid a discount-overwrite; a mutable singleton leaked a beta flag to every user. When the shape fights you, look hard — the latent functional bug is often hiding in exactly the place the structure made hard to read.

---

## Related Topics

- [`junior.md`](junior.md) — what each of the five shapes looks like and why it's bad.
- [`middle.md`](middle.md) — when these creep in and the small countermove that reverses them.
- [`tasks.md`](tasks.md) — exercises that build the same muscles from the writing side.
- [`optimize.md`](optimize.md) — flawed implementations to refactor end-to-end.
- [`interview.md`](interview.md) — Q&A across all levels.
- [Clean Code → Classes](../../../clean-code/09-classes/README.md) — the SRP cure for God Objects.
- [Clean Code → Functions](../../../clean-code/02-functions/README.md) — guard clauses and flag-argument removal.
- [Refactoring → Code Smells](../../../refactoring/01-code-smells/README.md) — Large Class, Long Method, the smell-level view.
- [Bad Shortcuts](../02-bad-shortcuts/find-bug.md) and [Over-Engineering](../03-over-engineering/find-bug.md) — the sibling find-bug files.
