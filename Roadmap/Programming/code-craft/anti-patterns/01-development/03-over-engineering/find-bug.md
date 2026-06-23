# Over-Engineering Anti-Patterns — Find the Bug

> **Category:** [Development Anti-Patterns](../README.md) → **Over-Engineering** — *effort spent solving problems you don't have.*
> **Covers (collectively):** Premature Optimization · Speculative Generality · Gold Plating · Yo-yo Problem · Lasagna Code · Accidental Complexity · Soft Coding · Bikeshedding

---

This file is **critical-reading practice**. Each snippet below is a plausible chunk of real-world code in Go, Java, or Python. Read it the way a sharp reviewer does and answer three questions:

> **What over-engineering anti-pattern(s) are present? What's the cost — or what bug does the over-engineering cause? How would you simplify or fix it?**

Over-engineering is mostly *"spot what's unnecessary"* — flexibility, layers, and tuning the problem never asked for. But it is not harmless aesthetics. **Over-engineering hides and causes real functional bugs**, and several snippets here contain one: the hand-tuned "fast" loop is subtly *wrong*; the speculative abstraction's unused branch is broken; the soft-coded rule engine silently does the wrong thing; a fragile base class breaks a subclass; a Lasagna layer drops data on a hop. The clever version is often the buggy version, precisely because nobody can read it.

One snippet is a deliberate **trap**: code that *looks* over-engineered but whose abstraction is genuinely justified. Reflexively deleting abstraction is its own anti-pattern. The skill is judgment, not allergy.

> **How to use this file:** read each snippet and write your own answer *before* expanding the collapsible. The skill you're training is noticing the shape — and resisting the easy "delete it all" reflex — not recalling the name.

---

## Table of Contents

1. [The fast even-sum that lost a number](#snippet-1--the-fast-even-sum-that-lost-a-number)
2. [A notifier ready for everything](#snippet-2--a-notifier-ready-for-everything)
3. [The discount rules that moved to JSON](#snippet-3--the-discount-rules-that-moved-to-json)
4. [The price calculator chain](#snippet-4--the-price-calculator-chain)
5. [The report exporter that grew options](#snippet-5--the-report-exporter-that-grew-options)
6. [The account hierarchy and one small base change](#snippet-6--the-account-hierarchy-and-one-small-base-change)
7. [The clock you can inject](#snippet-7--the-clock-you-can-inject)
8. [A cached total that drifts](#snippet-8--a-cached-total-that-drifts)
9. [The generic repository with a flexible filter](#snippet-9--the-generic-repository-with-a-flexible-filter)
10. [Turning a map into a framework](#snippet-10--turning-a-map-into-a-framework)
11. [The rounding that got clever](#snippet-11--the-rounding-that-got-clever)
12. [The plugin system for one plugin](#snippet-12--the-plugin-system-for-one-plugin)
13. [The validation rule engine](#snippet-13--the-validation-rule-engine)
14. [The PR that polished the wrong thing](#snippet-14--the-pr-that-polished-the-wrong-thing)

---

## Snippet 1 — The fast even-sum that lost a number

```go
// Go — someone "optimized" a hot loop by unrolling it four-wide.
// A benchmark exists; it's 6% faster. Ship it?
func sumEven(nums []int) int {
    s, i, n := 0, 0, len(nums)
    for ; i < n-3; i += 4 { // process 4 per iteration
        if nums[i]&1 == 0 {
            s += nums[i]
        }
        if nums[i+1]&1 == 0 {
            s += nums[i+1]
        }
        if nums[i+2]&1 == 0 {
            s += nums[i+2]
        }
        if nums[i+3]&1 == 0 {
            s += nums[i+3]
        }
    }
    // remainder loop
    for ; i <= n; i++ { // <-- handle the leftover elements
        if nums[i]&1 == 0 {
            s += nums[i]
        }
    }
    return s
}
```

> What over-engineering anti-pattern(s) are here? What's the cost / what bug does it cause? How would you simplify/fix it?

<details>
<summary>Answer</summary>

**Premature Optimization — and the clever version is outright broken.**

Manual loop unrolling on a CPU-bound integer loop is exactly the micro-tuning Knuth warned about: the bottleneck in real services is almost never integer arithmetic, the 6% benchmark is on synthetic data, and the Go compiler/CPU already pipeline a simple range loop well. You've traded clarity for a speed-up that won't matter end-to-end.

**The actual bug:** the remainder loop reads `for ; i <= n; i++` — note `<= n`, not `< n`. On the final iteration `i == n == len(nums)`, so `nums[i]` is an **out-of-bounds index → panic**. Unrolling is precisely where off-by-one bugs in the remainder loop breed, because the boundary between the unrolled block and the cleanup is fiddly and rarely covered by tests (a slice whose length isn't a multiple of 4 triggers it). The "optimization" introduced a crash that the simple loop could never have.

**Fix — write the obvious loop; it's correct, readable, and fast enough until a profile says otherwise:**

```go
func sumEven(nums []int) int {
    s := 0
    for _, n := range nums {
        if n%2 == 0 {
            s += n
        }
    }
    return s
}
```

If a *real* profile later shows this is hot, revisit with a benchmark — but the bug above is the recurring tax of hand-unrolling.

</details>

---

## Snippet 2 — A notifier ready for everything

```java
// Java — the requirement was: "email the user when their order ships."
public interface NotificationChannel {
    void send(User u, Message m);
}
public interface MessageFormatter {
    Message format(String template, Map<String, Object> vars);
}
public interface ChannelSelector {
    NotificationChannel choose(User u, NotificationType type);
}

public class NotificationEngine {
    private final Map<NotificationType, ChannelSelector> selectors;
    private final Map<String, MessageFormatter> formatters;
    private final RetryPolicy retry;
    private final RateLimiter limiter;

    public void notify(User u, NotificationType type, String tmpl,
                       Map<String, Object> vars, String formatterKey) {
        NotificationChannel ch = selectors.get(type).choose(u, type);
        Message m = formatters.get(formatterKey).format(tmpl, vars);
        limiter.acquire(u.id());
        retry.run(() -> ch.send(u, m));
    }
}
// Only one call site in the whole codebase:
engine.notify(user, NotificationType.ORDER_SHIPPED,
              "Your order {{id}} shipped", vars, "default");
```

> What over-engineering anti-pattern(s) are here? What's the cost / what bug does it cause? How would you simplify/fix it?

<details>
<summary>Answer</summary>

**Speculative Generality** (the dominant pattern) **+ Accidental Complexity**, with a touch of **Gold Plating** (rate limiting and retry nobody asked for).

The ticket was "email the user on ship." What got built is a pluggable engine with channel selectors, a formatter registry, a retry policy, and a rate limiter — five abstractions, four of them with exactly one possible value, all driven by a single call site that always passes `"default"` and `ORDER_SHIPPED`. Every interface is a bet on an imagined future (SMS! push! per-user channel preferences!) that has no present requirement.

**The cost:** four indirections to follow one email. New developers must learn the whole framework to add a second notification. Worse, the flexibility creates **latent failure surface**: `selectors.get(type)` and `formatters.get(formatterKey)` return `null` for any unregistered key, and `notify` immediately dereferences it → NPE the moment someone calls with a type/formatter that "the framework supports" but nobody registered. Speculative generality doesn't just sit there; its unused branches are untested paths waiting to throw.

**Fix — write the concrete thing the requirement needs:**

```java
public class ShipmentNotifier {
    private final EmailClient email;
    ShipmentNotifier(EmailClient email) { this.email = email; }

    public void orderShipped(User u, Order o) {
        email.send(u.email(), "Your order " + o.id() + " shipped");
    }
}
```

When a *second, real* channel arrives (Rule of Three), introduce the seam then — designed against two real cases, not one guess.

</details>

---

## Snippet 3 — The discount rules that moved to JSON

```python
# Python — "so the business team can edit discounts without a deploy,"
# pricing logic was moved into a JSON rule engine loaded at startup.
RULES = json.load(open("discount_rules.json"))
# [
#   {"if": {"field": "tier", "op": "eq",  "val": "gold"},  "discount": 0.10},
#   {"if": {"field": "total","op": "gte", "val": 100},      "discount": 0.05},
#   {"if": {"field": "coupon","op": "eq", "val": "SAVE20"}, "discount": 0.20}
# ]

OPS = {
    "eq":  lambda a, b: a == b,
    "gte": lambda a, b: a >= b,
    "lte": lambda a, b: a <= b,
}

def discount_for(order):
    best = 0.0
    for rule in RULES:
        cond = rule["if"]
        op = OPS[cond["op"]]
        if op(order.get(cond["field"]), cond["val"]):
            best = max(best, rule["discount"])
    return best
```

> What over-engineering anti-pattern(s) are here? What's the cost / what bug does it cause? How would you simplify/fix it?

<details>
<summary>Answer</summary>

**Soft Coding** (business logic relocated into data) **+ Accidental Complexity** — and it silently does the wrong thing on the edges.

Business rules — *which* discount applies and how they combine — now live in JSON interpreted by a hand-rolled mini-language (`OPS`). You've built a worse programming language inside a config file: no types, no tests, no debugger, no review of the *logic* (only of the data, which non-engineers will edit).

**The actual bugs the soft-coding hides:**
1. **Malformed/unknown operator** → `OPS[cond["op"]]` raises `KeyError` and the *entire* pricing path crashes for *all* orders the moment someone fat-fingers `"=="` instead of `"eq"` in the JSON. A typo in a config file becomes a production outage with no compile-time or test safety net.
2. **Silent type coercion / missing field** → `order.get(cond["field"])` returns `None` when a field is absent (or a typo in `"field"`), and `op(None, 100)` with `gte` raises `TypeError` in Python 3 — again crashing pricing, this time on a rule that "looks fine" in the JSON.
3. **Semantics are invisible:** is the policy "take the single best discount" or "stack them"? The code says `max(...)`, but a business editor reading the JSON has no way to know — and no way to express "stack" without an engineer changing `discount_for`. The supposed self-service is a fiction.

**Fix — keep the logic in tested code; configure only the genuinely-varying *values*:**

```python
GOLD_RATE, BIG_ORDER_RATE, COUPON_RATE = 0.10, 0.05, 0.20  # tunable constants

def discount_for(order):
    candidates = [0.0]
    if order.tier == "gold":           candidates.append(GOLD_RATE)
    if order.total >= 100:             candidates.append(BIG_ORDER_RATE)
    if order.coupon == "SAVE20":       candidates.append(COUPON_RATE)
    return max(candidates)             # "best discount" — explicit, testable
```

Now the policy is readable, type-checked, unit-tested, and a bad value can't take down checkout. If business truly needs self-serve rules, that's a deliberate, *validated*, tested feature — not a reflexive JSON `if/then` tree.

</details>

---

## Snippet 4 — The price calculator chain

```python
# Python — "clean layered architecture" for computing a line-item price.
class PriceController:
    def __init__(self, service): self.service = service
    def get_price(self, item_id, qty):
        return self.service.get_price(item_id, qty)

class PriceService:
    def __init__(self, manager): self.manager = manager
    def get_price(self, item_id, qty):
        return self.manager.compute(item_id, qty)

class PriceManager:
    def __init__(self, calc): self.calc = calc
    def compute(self, item_id, quantity):       # note: renamed qty -> quantity
        return self.calc.calculate(item_id, quantity)

class PriceCalculator:
    def __init__(self, repo): self.repo = repo
    def calculate(self, item_id, qty):
        unit = self.repo.unit_price(item_id)
        return unit * qty                       # the one line that does work
```

> What over-engineering anti-pattern(s) are here? What's the cost / what bug does it cause? How would you simplify/fix it?

<details>
<summary>Answer</summary>

**Lasagna Code** — four classes (`Controller → Service → Manager → Calculator`) where three of them only forward the call and rename arguments. None validates, maps, owns a transaction, or enforces a boundary; they exist "because the layered pattern has these layers." The only line of actual work is `unit * qty` in the bottom class.

**The cost:** to understand or change pricing you open four files for one multiplication. Every signature change ripples through all four. These are *shallow modules* in Ousterhout's sense — interface without hidden implementation — stacked into pure overhead.

**The bug the layering invites:** look at the argument names across hops — `qty → qty → quantity → qty`. They're passed positionally so it works *today*, but the moment someone "tidies up" `PriceManager.compute` to call `self.calc.calculate(item_id, quantity=quantity)` while another layer keeps `qty=`, or reorders parameters in one layer only, the mismatch surfaces as a silent wrong price or a `TypeError`. Pass-through layers that rename arguments are exactly where a parameter gets dropped or swapped on a hop — the more hops, the more chances. Fewer layers, fewer seams to misalign.

**Fix — collapse the pass-throughs; keep only layers with a real job:**

```python
class PriceCalculator:
    def __init__(self, repo): self.repo = repo
    def price(self, item_id, qty):
        return self.repo.unit_price(item_id) * qty
```

The controller can call this directly (or one thin layer remains *if* it adds validation/auth). Two meaningful layers beat four empty ones.

</details>

---

## Snippet 5 — The report exporter that grew options

```python
# Ticket: "Export the user's transaction list to CSV."
# What landed in the PR:
def export_transactions(txns, path, *, fmt="csv", delimiter=",",
                        compress=False, encrypt=False, password=None,
                        email_to=None, watermark=None, columns=None,
                        locale="en_US", currency_symbol="$",
                        include_pending=True, sort_by="date", desc=False):
    rows = txns
    if not include_pending:
        rows = [t for t in rows if not t.pending]
    rows = sorted(rows, key=lambda t: getattr(t, sort_by), reverse=desc)
    if fmt == "csv":
        data = to_csv(rows, delimiter, columns, locale, currency_symbol)
    elif fmt == "xlsx":
        data = to_xlsx(rows, watermark)            # nobody asked for xlsx
    elif fmt == "pdf":
        data = to_pdf(rows, watermark)             # nobody asked for pdf
    if compress:
        data = gzip.compress(data)
    if encrypt:
        data = aes_encrypt(data, password)         # password may be None
    if email_to:
        send_email(email_to, data)
    else:
        Path(path).write_bytes(data)
```

> What over-engineering anti-pattern(s) are here? What's the cost / what bug does it cause? How would you simplify/fix it?

<details>
<summary>Answer</summary>

**Gold Plating** (the dominant pattern) **+ Accidental Complexity**, sliding toward **Soft Coding** (behavior driven by a pile of flags).

The ticket asked for *CSV export*. The author shipped XLSX, PDF, gzip, AES encryption, emailing, watermarks, locales, currency symbols, column selection, and sorting — fourteen parameters of capability nobody requested. This is the textbook "while I'm in here" gold plate: fun to build, pure liability to maintain, and it delayed a one-day task.

**The bugs the extra surface hides:**
- `encrypt=True` with `password=None` (an easy, untested combination) calls `aes_encrypt(data, None)` → crash or, worse, a broken cipher.
- If `fmt` is anything but the three handled values, `data` is **never assigned** → `UnboundLocalError` — a latent path that exists only because the function pretends to support open-ended formats.
- The pending/sort/encrypt/email combinations are a combinatorial space (2^n flags) that no test covers, so most paths are dead-on-arrival the day someone uses them.

Gold plating's real cost isn't just wasted effort — it's that the unrequested features are unexercised and therefore broken, but they *look* supported.

**Fix — build exactly the ticket; propose the rest as separate backlog items:**

```python
def export_transactions_csv(txns, path):
    Path(path).write_text(to_csv(txns))
```

If PDF export becomes a real, prioritized requirement later, build it then — scoped, tested, and reviewed on its own.

</details>

---

## Snippet 6 — The account hierarchy and one small base change

```java
// Java — a deep account hierarchy. A "small" base-class tweak was just merged.
abstract class Account {
    protected BigDecimal balance = BigDecimal.ZERO;
    void deposit(BigDecimal amt) { balance = balance.add(applyFee(amt)); }
    // NEW: base now skims a 1% processing fee on every deposit
    protected BigDecimal applyFee(BigDecimal amt) {
        return amt.multiply(new BigDecimal("0.99"));
    }
}
class SavingsAccount extends Account {
    void deposit(BigDecimal amt) { super.deposit(amt); accrueInterest(); }
    void accrueInterest() { balance = balance.multiply(rate()); /* ... */ }
}
class PromoSavingsAccount extends SavingsAccount {
    // promo accounts were always advertised as "0% fees, ever"
    @Override
    protected BigDecimal applyFee(BigDecimal amt) { return amt; } // override fee
    void deposit(BigDecimal amt) {
        balance = balance.add(amt);   // <-- bypasses super.deposit, adds raw amt
        accrueInterest();
    }
}
```

> What over-engineering anti-pattern(s) are here? What's the cost / what bug does it cause? How would you simplify/fix it?

<details>
<summary>Answer</summary>

**Yo-yo Problem** (deep inheritance: `PromoSavingsAccount → SavingsAccount → Account`) **+ the fragile base class problem** — and the structure just produced a real money bug.

To answer "what does `promoAccount.deposit(100)` do?", you yo-yo through three classes. The promo subclass tried to honor "0% fees" *two* ways: it overrode `applyFee` to be a no-op, *and* its own `deposit` bypasses `super.deposit` to add the raw amount. Redundant, but it limped along.

**The actual bug introduced by the base change:** the new base `deposit` skims 1% via `applyFee`. `SavingsAccount.deposit` calls `super.deposit`, so savings accounts now correctly get the fee. But `PromoSavingsAccount.deposit` **overrides `deposit` and never calls `super`**, so it adds the raw amount — correct for the "0% fee" promise *by accident*. Now flip it: a future maintainer, told to "stop the duplicate logic," deletes `PromoSavingsAccount.deposit` to "inherit the savings behavior." Suddenly promo deposits route through `super.deposit` → `applyFee`, and because `applyFee` *is* overridden to a no-op, it still looks 0%... unless someone *also* removes the now-"redundant" `applyFee` override. The behavior depends on which of two overrides survive, scattered across three files — a change in the base silently alters subclasses, and no single file tells you the deposit rule. That's the fragile base class hazard: the base class can't change a method without potentially breaking every descendant that did, or didn't, override it.

**Fix — flatten with composition; make the fee policy an explicit collaborator that lives in one place:**

```java
interface FeePolicy { BigDecimal net(BigDecimal amt); }
final class StandardFee implements FeePolicy {
    public BigDecimal net(BigDecimal a) { return a.multiply(new BigDecimal("0.99")); }
}
final class NoFee implements FeePolicy {
    public BigDecimal net(BigDecimal a) { return a; }
}

final class Account {
    private BigDecimal balance = BigDecimal.ZERO;
    private final FeePolicy fee;
    Account(FeePolicy fee) { this.fee = fee; }
    void deposit(BigDecimal amt) { balance = balance.add(fee.net(amt)); }
}
// Promo account = new Account(new NoFee()); the fee rule is data, not depth.
```

Now the fee behavior is one line, in one place, impossible to half-override.

</details>

---

## Snippet 7 — The clock you can inject

```go
// Go — a token-expiry check. A reviewer flagged "this Clock interface is
// over-engineering — just call time.Now()." Are they right?
type Clock interface {
    Now() time.Time
}
type realClock struct{}
func (realClock) Now() time.Time { return time.Now() }

type TokenValidator struct {
    clock Clock
}
func (v TokenValidator) Valid(t Token) bool {
    return v.clock.Now().Before(t.ExpiresAt)
}

// production wiring:
validator := TokenValidator{clock: realClock{}}

// in tests:
func TestExpiredToken(t *testing.T) {
    fixed := fakeClock{at: time.Date(2030, 1, 1, 0, 0, 0, 0, time.UTC)}
    v := TokenValidator{clock: fixed}
    tok := Token{ExpiresAt: time.Date(2020, 1, 1, 0, 0, 0, 0, time.UTC)}
    if v.Valid(tok) {
        t.Fatal("expected expired token to be invalid")
    }
}
```

> What over-engineering anti-pattern(s) are here? What's the cost / what bug does it cause? How would you simplify/fix it?

<details>
<summary>Answer</summary>

**Trap snippet: this is NOT over-engineering.** The reviewer is wrong, and the discipline being trained here is *not* deleting justified abstraction.

A one-method `Clock` interface with a single production implementation *looks* like Speculative Generality — but it serves a **real, present need today**: time is a dependency you cannot otherwise control in a test. Without the seam, the only way to test "is this token expired?" is to manipulate the system clock or sleep — both flaky and slow. The `fakeClock` in the test is a *second implementation that exists now*, used now. That is precisely the "test double" justification `middle.md` lists for a legitimate seam.

**What would make the reviewer right:** if there were no test injecting a fake, no test of time-dependent behavior, and `Now()` were called inline everywhere else anyway — then the interface would be ceremony and you'd inline `time.Now()`. The diagnostic isn't the *shape* ("interface + one prod impl"); it's *"does this abstraction do real work today?"* Here it enables fast, deterministic time-travel tests, so the answer is yes.

**Lesson for critical reading:** don't pattern-match "interface → over-engineering." Count the *actual* consumers, **including tests**. A seam justified by today's testing reality is design; the same shape with no consumer is speculation. Reflexively stripping abstraction is its own anti-pattern — under-engineering.

> Watch the *width*, not the existence: if `Clock` grew `Sleep`, `Tick`, `AfterFunc` with no callers, trim those — but `Now()` earns its place.

</details>

---

## Snippet 8 — A cached total that drifts

```java
// Java — someone added a running-total cache "for performance" on a cart
// that holds at most ~20 items. No profile was taken.
public class Cart {
    private final List<Item> items = new ArrayList<>();
    private BigDecimal cachedTotal = BigDecimal.ZERO;   // perf optimization

    public void add(Item i) {
        items.add(i);
        cachedTotal = cachedTotal.add(i.price().multiply(qty(i)));
    }
    public void remove(Item i) {
        items.remove(i);
        cachedTotal = cachedTotal.subtract(i.price().multiply(qty(i)));
    }
    public void applyDiscount(BigDecimal pct) {
        for (Item i : items) {
            i.setPrice(i.price().multiply(BigDecimal.ONE.subtract(pct)));
        }
        // (cachedTotal not updated)
    }
    public BigDecimal total() { return cachedTotal; }
    private BigDecimal qty(Item i) { return new BigDecimal(i.quantity()); }
}
```

> What over-engineering anti-pattern(s) are here? What's the cost / what bug does it cause? How would you simplify/fix it?

<details>
<summary>Answer</summary>

**Premature Optimization** — a cache added with no measurement, on a collection of ~20 items where a fresh sum is instant — **and the cache silently drifts from the truth.**

There is no plausible world where iterating 20 `BigDecimal`s is a bottleneck. The `cachedTotal` field buys nothing measurable and, like every cache, adds the one liability caches always add: an invariant ("cache mirrors items") that some method will forget to maintain.

**The actual bug:** `add` and `remove` keep the cache in sync, but `applyDiscount` mutates every item's price *without* updating `cachedTotal`. After a discount, `total()` returns the **pre-discount** sum — the customer is charged the wrong amount. The optimization didn't make anything faster; it created a correctness bug whose surface is exactly the third mutator the author forgot. (And `remove` has its own latent issue: `items.remove(i)` removes only the first equal element, while the cache subtracts as if it succeeded.) A reviewer reading `applyDiscount` alone sees a fine-looking loop — the bug lives in the *consistency obligation* the cache introduced.

**Fix — delete the cache; compute on read. It's correct by construction and plenty fast:**

```java
public class Cart {
    private final List<Item> items = new ArrayList<>();
    public void add(Item i)    { items.add(i); }
    public void remove(Item i) { items.remove(i); }
    public void applyDiscount(BigDecimal pct) {
        for (Item i : items)
            i.setPrice(i.price().multiply(BigDecimal.ONE.subtract(pct)));
    }
    public BigDecimal total() {           // one source of truth, can't drift
        return items.stream()
            .map(i -> i.price().multiply(new BigDecimal(i.quantity())))
            .reduce(BigDecimal.ZERO, BigDecimal::add);
    }
}
```

Re-introduce a cache **only** if a profiler proves `total()` is hot — and then with invalidation tested across *every* mutator.

</details>

---

## Snippet 9 — The generic repository with a flexible filter

```java
// Java — a "future-proof" data layer so any query can be expressed generically.
public class GenericRepository<T> {
    public List<T> find(Class<T> type, Map<String, Object> criteria,
                        String orderBy, Integer limit, Boolean distinct,
                        List<String> joins, String having) {
        StringBuilder sql = new StringBuilder("SELECT ");
        sql.append(distinct != null && distinct ? "DISTINCT " : "");
        sql.append("* FROM ").append(table(type));
        for (String j : joins) sql.append(" JOIN ").append(j);
        if (!criteria.isEmpty()) {
            sql.append(" WHERE ");
            List<String> clauses = new ArrayList<>();
            for (Map.Entry<String, Object> e : criteria.entrySet()) {
                clauses.add(e.getKey() + " = '" + e.getValue() + "'"); // build WHERE
            }
            sql.append(String.join(" AND ", clauses));
        }
        if (having != null) sql.append(" HAVING ").append(having);
        if (orderBy != null) sql.append(" ORDER BY ").append(orderBy);
        if (limit != null)   sql.append(" LIMIT ").append(limit);
        return jdbc.query(sql.toString(), rowMapper(type));
    }
}
// The entire app uses it exactly two ways:
repo.find(User.class, Map.of("email", email), null, null, null, List.of(), null);
repo.find(Order.class, Map.of("userId", id), "createdAt", 50, null, List.of(), null);
```

> What over-engineering anti-pattern(s) are here? What's the cost / what bug does it cause? How would you simplify/fix it?

<details>
<summary>Answer</summary>

**Speculative Generality + Accidental Complexity** — and the open-ended flexibility opens a **SQL-injection hole** plus an invalid-state path.

The repository is built to express *any* query — joins, `HAVING`, `DISTINCT`, dynamic ordering — but the whole application uses two fixed query shapes. Seven parameters of generality exist for queries nobody writes. That's the speculative bet: "someday we'll need arbitrary queries," paid for now in a query builder that's harder to read than the two SQL statements it replaces.

**The bugs the generality causes:**
1. **SQL injection.** Building `WHERE` by string-concatenating `e.getValue()` (and accepting raw `orderBy`/`having`/`joins` strings) means any caller value flows into SQL unescaped. The flexibility *is* the vulnerability — a concrete, parameterized query for each real use case would have used bind variables and closed the hole.
2. **Reachable invalid states.** Because callers can mix any parameters, a caller can pass `having` without an aggregate, or a `limit` with a `distinct` and `joins` combination that produces malformed SQL — states the type system can't forbid, surfacing as runtime SQL errors. Generality removed the compiler's ability to reject illegal queries.

**Fix — concrete, named, parameterized methods for the two real queries (Rule of Three: you have two, write them):**

```java
public class UserRepository {
    public Optional<User> findByEmail(String email) {
        return jdbc.query("SELECT * FROM users WHERE email = ?",  // bound param
                          rowMapper(User.class), email).stream().findFirst();
    }
}
public class OrderRepository {
    public List<Order> recentForUser(long userId, int limit) {
        return jdbc.query(
            "SELECT * FROM orders WHERE user_id = ? ORDER BY created_at LIMIT ?",
            rowMapper(Order.class), userId, limit);
    }
}
```

Each query is readable, injection-safe, and impossible to call into an invalid shape. Generalize only if a third and fourth genuinely-distinct query shape appears.

</details>

---

## Snippet 10 — Turning a map into a framework

```python
# Python — the task: "uppercase each tag and drop blanks." One comprehension.
# What was committed: a configurable, extensible transformation pipeline.
from abc import ABC, abstractmethod

class Step(ABC):
    @abstractmethod
    def apply(self, data): ...

class UpperStep(Step):
    def apply(self, data): return [x.upper() for x in data]

class DropBlankStep(Step):
    def apply(self, data): return [x for x in data if x.strip()]

class Pipeline:
    def __init__(self, steps=None):
        self.steps = steps or []
    def register(self, step): self.steps.append(step); return self
    def run(self, data):
        for s in self.steps:
            data = s.apply(data)
        return data

def normalize_tags(tags):
    return (Pipeline()
            .register(UpperStep())
            .register(DropBlankStep())
            .run(tags))
```

> What over-engineering anti-pattern(s) are here? What's the cost / what bug does it cause? How would you simplify/fix it?

<details>
<summary>Answer</summary>

**Accidental Complexity + Speculative Generality** — a "pipeline framework" (abstract base class, step registry, fluent builder) wrapped around what is, in essence, a two-line `map`/`filter`.

Describe the problem in plain words: *"uppercase each tag, drop blanks."* Now compare that sentence to the code — abstract `Step`, two concrete steps, a `Pipeline` with `register` and `run`. The gap between the sentence and the machinery is pure accidental complexity, and the extensibility (`register` more steps!) is speculative: there is one caller with two fixed steps.

**The latent bug the abstraction hides:** order matters, and the framework makes it invisible. `UpperStep` runs before `DropBlankStep`, so a tag that is `"   "` (whitespace) survives `UpperStep` unchanged and is then dropped — fine. But a tag like `None` (a real possibility from upstream data) hits `x.upper()` in `UpperStep` and throws `AttributeError` *before* any blank-dropping could protect it. In a flat comprehension the author would see both operations at once and naturally guard; spread across two `Step` classes in run-order set by a builder elsewhere, the interaction is easy to get wrong and impossible to see in one place. Generality dispersed the logic and with it the bug.

**Fix — the essential problem, directly:**

```python
def normalize_tags(tags):
    return [t.upper() for t in tags if t and t.strip()]
```

One line, one place, the `None`/blank guard right next to the `.upper()`. A pipeline framework is justified when you have many, varying, reorderable steps reused across call sites — not for a fixed two-step transform.

</details>

---

## Snippet 11 — The rounding that got clever

```python
# Python — "fast" currency rounding to 2 decimals, hand-written to avoid
# the "slow" Decimal library. No benchmark was run.
def round_money(amount):
    # multiply, add 0.5 for rounding, truncate, divide — classic trick
    return int(amount * 100 + 0.5) / 100

# used everywhere money is displayed or stored:
total = round_money(price * quantity * (1 - discount))
```

> What over-engineering anti-pattern(s) are here? What's the cost / what bug does it cause? How would you simplify/fix it?

<details>
<summary>Answer</summary>

**Premature Optimization** — replacing a correct, well-understood library (`Decimal`) with a hand-rolled float trick "for speed," with no measurement — **and the fast version is silently wrong about money.**

Rounding is never the bottleneck in a system that also does database I/O and network calls; the `Decimal` "slowness" is imaginary here. But the real damage is correctness:

**The actual bug:** `int(amount * 100 + 0.5) / 100` rounds via binary floating point, which cannot represent most decimal fractions exactly.
- `round_money(2.675)` → `2.675 * 100` is `267.49999999999994` in IEEE-754, `+ 0.5` → `267.999...`, `int(...)` → `267`, result `2.67` — **not** `2.68`. The "round half up" trick rounds *down* on values that look like they should round up, because the input was never exactly `2.675`.
- Negative amounts (refunds) break worse: `round_money(-2.675)` adds `0.5` then truncates *toward zero*, giving the wrong-direction rounding for negatives entirely.

These are off-by-a-cent errors scattered through every price in the system — the precise failure mode money code must never have, introduced by "optimizing" away the library built to prevent it.

**Fix — use the decimal type designed for this; correctness first, and it's fast enough:**

```python
from decimal import Decimal, ROUND_HALF_UP

def round_money(amount: Decimal) -> Decimal:
    return amount.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
```

Keep money as `Decimal` end-to-end (never `float`). If rounding ever shows up in a profile — it won't — revisit then.

</details>

---

## Snippet 12 — The plugin system for one plugin

```go
// Go — a "plugin architecture" for image processing. There is one processor.
type Processor interface {
    Name() string
    Process(img Image, opts map[string]interface{}) (Image, error)
}

var registry = map[string]Processor{}

func Register(p Processor) { registry[p.Name()] = p }

func Run(name string, img Image, opts map[string]interface{}) (Image, error) {
    p := registry[name]
    return p.Process(img, opts) // look up by name, then process
}

// the only processor ever registered:
type Resizer struct{}
func (Resizer) Name() string { return "resize" }
func (Resizer) Process(img Image, opts map[string]interface{}) (Image, error) {
    w := opts["width"].(int)   // type assertion on an untyped map
    h := opts["height"].(int)
    return resize(img, w, h), nil
}

func init() { Register(Resizer{}) }

// caller:
out, _ := Run("resize", img, map[string]interface{}{"width": 800, "height": 600})
```

> What over-engineering anti-pattern(s) are here? What's the cost / what bug does it cause? How would you simplify/fix it?

<details>
<summary>Answer</summary>

**Speculative Generality (a plugin registry for one plugin) + Accidental Complexity (the `map[string]interface{}` "options" bag)** — and both create real bugs.

The plugin architecture — interface, global registry, name-based dispatch, `init()` registration — exists so the system can support *many* processors. It has one. Every piece of that machinery is a bet on processors that don't exist, and meanwhile it has discarded the type system:

**The bugs the generality causes:**
1. **`p := registry[name]` returns the zero value (`nil`) for an unknown name**, and `Run` immediately calls `p.Process(...)` → nil-interface panic. The string-keyed dispatch replaced a compile-time function call (which can't be misspelled) with a runtime lookup that fails on a typo like `Run("reize", ...)`.
2. **`opts["width"].(int)` panics** if the key is missing, or if the caller passed a `float64` (e.g. from decoded JSON, where all numbers are `float64`) instead of `int` — the untyped bag defeats the compiler and turns a wrong call into a runtime crash deep inside `Process`.

A direct, typed function call has none of these failure modes. The flexibility *is* the bug surface.

**Fix — one processor, one typed function:**

```go
func Resize(img Image, width, height int) Image {
    return resize(img, width, height)
}
// caller:
out := Resize(img, 800, 600)   // compiler checks the name and the types
```

If a *second* processor genuinely arrives with a real need for runtime selection (e.g. a user-chosen filter), introduce a small interface *then* — with typed parameters, not a `map[string]interface{}`.

</details>

---

## Snippet 13 — The validation rule engine

```java
// Java — form validation, "made data-driven so rules live in config."
public class RuleEngine {
    // rules loaded from YAML: field, type, min, max, required, pattern
    private final List<Rule> rules;

    public List<String> validate(Map<String, String> form) {
        List<String> errors = new ArrayList<>();
        for (Rule r : rules) {
            String v = form.get(r.field);
            if (r.required && v == null) {
                errors.add(r.field + " is required");
                continue;
            }
            if (v == null) continue;
            switch (r.type) {
                case "int":
                    int n = Integer.parseInt(v);          // throws on bad input
                    if (n < r.min || n > r.max) errors.add(r.field + " out of range");
                    break;
                case "string":
                    if (!v.matches(r.pattern)) errors.add(r.field + " invalid");
                    break;
                // no default case
            }
        }
        return errors;
    }
}
```

> What over-engineering anti-pattern(s) are here? What's the cost / what bug does it cause? How would you simplify/fix it?

<details>
<summary>Answer</summary>

**Soft Coding** (validation logic relocated into YAML, interpreted by a hand-rolled engine) **+ Accidental Complexity** — and the engine silently does the wrong thing on malformed or edge rules.

Validation *is* logic — it has types, ranges, branches. Pushing it into config and writing a `RuleEngine` to interpret it rebuilds a validation framework that the language and mature libraries already provide, minus the type-checking and tests.

**The bugs the soft-coding hides:**
1. **Malformed input crashes instead of reporting an error.** For an `int` rule, `Integer.parseInt(v)` throws `NumberFormatException` on `"abc"` — so a user typing letters into a number field gets a *500 error*, not a clean "field invalid" message. The engine's job is to validate, but it crashes on the exact bad input it exists to catch.
2. **Unknown rule type silently passes.** The `switch` has no `default`, so a typo in the YAML (`type: integer` instead of `int`) means the field is **never validated** and every value sails through. A config typo silently disables validation — the dangerous direction (fail-open) for a security/integrity control, with no compiler or test to catch it.
3. **`r.min`/`r.max`/`r.pattern` are unvalidated config**: a `string` rule with a `null` pattern → `v.matches(null)` → NPE; an `int` rule missing `min` → default `0`, silently rejecting valid negatives.

**Fix — keep validation in typed, tested code (or a real validation library), where the compiler and unit tests have your back:**

```java
public List<String> validate(SignupForm f) {
    List<String> errors = new ArrayList<>();
    if (f.email() == null || !EMAIL.matcher(f.email()).matches())
        errors.add("email invalid");
    if (f.age() < 13 || f.age() > 120)        // age is a typed int, parsed once at the edge
        errors.add("age out of range");
    return errors;
}
```

Each rule is a line of real code: type-checked, unit-testable, debuggable, and fail-closed. (In Java, prefer Bean Validation annotations — a *validated* framework — over a homemade YAML interpreter.)

</details>

---

## Snippet 14 — The PR that polished the wrong thing

```python
# A PR titled "Improve user search." The diff:
#  +180 lines: a configurable, weighted, fuzzy-match scoring engine with
#              tunable weights per field, Levenshtein distance, and a
#              pluggable tokenizer — for a search box over ~500 users.
#  PR thread: 38 comments debating the default weight for the "email" field
#             (0.3 vs 0.35?), whether to call it `tokenizer` or `lexer`,
#             and 2-space vs 4-space indent in the new module.
#  Also in the diff (0 comments): the search query interpolates user input:
def search(term):
    q = f"SELECT * FROM users WHERE name LIKE '%{term}%'"   # <-- injection
    return db.execute(q)
```

> What over-engineering anti-pattern(s) are here? What's the cost / what bug does it cause? How would you simplify/fix it?

<details>
<summary>Answer</summary>

**Three reinforcing patterns** — a gravity well of over-engineering.

1. **Gold Plating + Speculative Generality + Premature Optimization:** the ticket was "improve user search," and the author shipped a 180-line weighted fuzzy-match engine with tunable per-field weights, Levenshtein scoring, and a pluggable tokenizer — for **500 users**, where a plain substring filter is instantaneous and a `LIKE` query is overkill, let alone a tunable relevance engine. Nobody asked for fuzzy matching; the flexibility (configurable weights, pluggable tokenizer) is speculative; the relevance scoring is optimization for a scale that doesn't exist.
2. **Bikeshedding:** 38 comments on the *trivia* — a default weight of 0.3 vs 0.35, `tokenizer` vs `lexer`, indentation — because everyone has an opinion on bike-shed colors. The review energy went entirely to the accessible, low-stakes decisions.
3. **The real bug got zero comments:** the actual `search` builds SQL by f-string-interpolating `term` → a textbook **SQL injection**. `'; DROP TABLE users; --` in the search box is catastrophic. The bikeshedding *caused* the miss: finite reviewer attention was spent on weights and naming while the one line that carries real risk sailed through unreviewed.

This is the meta-lesson of the whole family: over-engineering doesn't just waste effort, it *steals attention from real risk*. The shed got 38 comments; the reactor got none.

**Fix — scope to the requirement, and spend the attention where the risk is:**

```python
def search(term):
    return db.execute(
        "SELECT * FROM users WHERE name LIKE ?",   # parameterized — no injection
        (f"%{term}%",),
    )
```

A parameterized substring search is the right size for 500 users. Delete the scoring engine (capture "fuzzy search" as a backlog item if it's ever genuinely needed); automate the indent/naming debates with a formatter and linter so review attention is free to land on the injection.

</details>

---

## Summary — how to spot it without over-correcting

You don't spot over-engineering by recognizing one bad line — you spot it by comparing the code to the *problem*, and by asking what each abstraction, layer, or optimization actually *earns*. The repeatable moves from these fourteen snippets:

- **Compare the code to a plain-English description of the problem.** "Uppercase the tags and drop blanks" should not need an abstract `Step` class and a pipeline builder (Snippets 10, 4). The gap between the sentence and the machinery is **Accidental Complexity** — and it's removable.
- **Demand a measurement before any optimization.** Loop unrolling, hand-rolled rounding, and a running-total cache all appeared with *no profile* — and all three were not just pointless but **wrong** (out-of-bounds panic, off-by-a-cent money errors, a total that drifts after a discount). The "fast" version is the buggy version precisely because nobody can read it (Snippets 1, 8, 11).
- **Count the real consumers of every abstraction — including tests.** One plugin behind a registry, one notifier behind an engine, one query shape behind a generic repository: **Speculative Generality** whose unused branches are untested crash paths (Snippets 2, 9, 12). But one production impl behind an interface that a *test* injects is a **justified seam** — not over-engineering (Snippet 7). The diagnostic is *purpose*, not shape.
- **Watch business logic migrating into data.** Discount rules and validation rules pushed into JSON/YAML lose types, tests, and a debugger — and a config typo becomes a crash or a silent fail-open (Snippets 3, 13). Keep logic in code; configure only what genuinely varies per environment.
- **Trace data and control across hops and inheritance levels.** Lasagna layers that rename arguments drop or swap a parameter on a hop (Snippet 4); a deep hierarchy lets a base-class change silently break a subclass — the **fragile base class / Yo-yo** failure (Snippet 6).
- **Match review attention to risk.** When a PR is buried in comments about naming and default weights while a SQL injection goes unread, that's **Bikeshedding** stealing the attention the real bug needed (Snippet 14). Automate the trivia; aim human scrutiny at blast radius.

The meta-lesson cuts both ways. **Over-engineering causes bugs, not just bloat** — a plugin registry panics on a typo, a generic query builder opens an injection hole, a clever round drops cents. But the cure is *judgment, not allergy*: the same instinct that deletes a speculative interface will, applied blindly, delete the `Clock` seam your tests depend on. Ask "what real need does this serve *today*, and how expensive is it to add *later*?" — then keep what earns its place and cut what only insures an imagined future.

---

## Related Topics

- [`junior.md`](junior.md) — what each of the eight patterns looks like and why it's bad (YAGNI, KISS).
- [`middle.md`](middle.md) — when over-engineering creeps in, the Rule of Three, and justified seams vs speculation.
- [`tasks.md`](tasks.md) — exercises that build the same muscles from the writing side.
- [`optimize.md`](optimize.md) — over-engineered implementations to simplify end-to-end.
- [`interview.md`](interview.md) — Q&A across all levels.
- [Bad Structure → find-bug](../01-bad-structure/find-bug.md) and [Bad Shortcuts → find-bug](../02-bad-shortcuts/find-bug.md) — the sibling find-bug files (Lasagna is the inverse of Spaghetti; Soft Coding the over-correction of Hard Coding).
- [Clean Code → Classes](../../../clean-code/09-classes/README.md) — composition over inheritance, the cure for Yo-yo.
- [Refactoring → Code Smells](../../../refactoring/01-code-smells/README.md) — Speculative Generality and Middle Man (Lasagna) at the smell level.
- [Refactoring → Techniques](../../../refactoring/02-refactoring-techniques/README.md) — Remove Speculative Generality, Collapse Hierarchy, Inline Class, Replace Subclass with Delegate.