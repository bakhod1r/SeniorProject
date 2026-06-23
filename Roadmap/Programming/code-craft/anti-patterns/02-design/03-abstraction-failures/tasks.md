# Abstraction Failures Anti-Patterns — Exercises

> **Category:** [Design Anti-Patterns](../README.md) → **Abstraction Failures** — *hands-on practice fitting the abstraction to the problem instead of forcing the problem into the abstraction.*
> **Covers (collectively):** Golden Hammer · Inner-Platform Effect · Interface Bloat · Premature Abstraction

---

These are **fix-it** exercises, not recognition quizzes. Abstraction failures are the subtlest design mistakes because the offending code usually *works* — it compiles, it passes tests, it ships. The damage is in the wrong *shape*: a regex where a substring check belongs, a hand-rolled rule engine reimplementing `if`, an interface so wide no class can honestly implement it, a strategy pattern guarding a single concrete case. Each one trades clarity and performance for a generality nobody asked for.

> **How to use this file.** Read the problem, attempt the fix in your editor *before* opening the solution, then compare. The "why it's better" note matters more than the diff — the goal is to internalize the *judgment*, not memorize a rewrite. The hardest exercise here (Exercise 11) is the one where the right answer is **leave it alone**: not every interface is bloated, not every shared tool is a Golden Hammer, and over-correcting is its own anti-pattern. Refer back to [`junior.md`](junior.md) for the shapes and [`middle.md`](middle.md) for the countermoves.

---

## Table of Contents

| # | Exercise | Anti-pattern(s) | Lang | Difficulty |
|---|---|---|---|---|
| 1 | [Regex where a substring check belongs](#exercise-1--regex-where-a-substring-check-belongs) | Golden Hammer | Python | ★ easy |
| 2 | [HashMap where an array indexes itself](#exercise-2--hashmap-where-an-array-indexes-itself) | Golden Hammer | Go | ★ easy |
| 3 | [Inline the one-implementation interface](#exercise-3--inline-the-one-implementation-interface) | Premature Abstraction | Go | ★ easy |
| 4 | [Collapse the speculative factory](#exercise-4--collapse-the-speculative-factory) | Premature Abstraction | Java | ★★ medium |
| 5 | [ORM in a hot path → targeted query](#exercise-5--orm-in-a-hot-path--targeted-query) | Golden Hammer | Python | ★★ medium |
| 6 | [Segregate the bloated interface](#exercise-6--segregate-the-bloated-interface) | Interface Bloat | Java | ★★ medium |
| 7 | [Kill the `UnsupportedOperationException` implementer](#exercise-7--kill-the-unsupportedoperationexception-implementer) | Interface Bloat | Java | ★★ medium |
| 8 | [Dismantle the in-house JSON rule engine](#exercise-8--dismantle-the-in-house-json-rule-engine) | Inner-Platform Effect | Python | ★★★ hard |
| 9 | [Replace the in-DB config interpreter with a plugin seam](#exercise-9--replace-the-in-db-config-interpreter-with-a-plugin-seam) | Inner-Platform + Golden Hammer | Go | ★★★ hard |
| 10 | [Wait for the rule of three](#exercise-10--wait-for-the-rule-of-three) | Premature Abstraction | Python | ★★ medium |
| 11 | [Judgment: when to *leave it alone*](#exercise-11--judgment-when-to-leave-it-alone) | all four (judgment) | mixed | ★★★ hard |
| 12 | [Mini-project: untangle the `NotificationKit`](#exercise-12--mini-project-untangle-the-notificationkit) | all four | Python | ★★★★ project |
| 13 | [Write an abstraction-failure review checklist](#exercise-13--write-an-abstraction-failure-review-checklist) | meta | — | ★★ medium |

---

## Exercise 1 — Regex where a substring check belongs

**Anti-pattern:** Golden Hammer · **Language:** Python · **Difficulty:** ★ easy

Someone reaches for `re` reflexively. The task is a fixed-string membership test — no patterns, no groups, no alternation. The regex is slower, harder to read, and (here) subtly wrong.

```python
import re

def is_image_upload(filename: str) -> bool:
    # "validate" the extension with a regex
    return bool(re.match(r".*\.(jpg|jpeg|png|gif)", filename))

def mentions_error(log_line: str) -> bool:
    return bool(re.search(r"error", log_line))
```

**Acceptance criteria**
- Neither function uses `re`.
- `is_image_upload` matches only a real trailing extension (the regex above accepts `evil.png.exe` because it is unanchored).
- Behavior is at least as correct as the original, and clearer.

**Hint:** `str.endswith` accepts a tuple of suffixes. `in` tests substring membership. A regex earns its place only when you need *pattern* matching — classes, quantifiers, anchors, captures — not literal text.

<details>
<summary>Solution</summary>

```python
_IMAGE_EXTS = (".jpg", ".jpeg", ".png", ".gif")

def is_image_upload(filename: str) -> bool:
    return filename.lower().endswith(_IMAGE_EXTS)

def mentions_error(log_line: str) -> bool:
    return "error" in log_line
```

**Why it's better.** `endswith` and `in` say exactly what they mean — no parsing of a mini-language to figure out the intent. They are also faster (no regex compilation or backtracking) and, crucially, *more correct*: the original `re.match(r".*\.(jpg|jpeg|png|gif)", "evil.png.exe")` returns a match because the pattern is unanchored and `.*` is greedy, so the file `evil.png.exe` would be treated as an image. `endswith` cannot make that mistake. The regex was a Golden Hammer — a powerful tool applied to a problem that did not need it, and the extra power introduced a bug. Keep the regex for things that are genuinely patterns (e.g. `\d{4}-\d{2}-\d{2}`), not for literal suffix checks.

</details>

---

## Exercise 2 — HashMap where an array indexes itself

**Anti-pattern:** Golden Hammer · **Language:** Go · **Difficulty:** ★ easy

The keys are small, dense, contiguous integers (HTTP status codes grouped into classes, days of the week, board squares). A map is the author's default container, so a map is what they used — paying hashing, pointer chasing, and allocation for a lookup an array does in one instruction.

```go
// Count how many requests fell into each HTTP status class (1xx..5xx).
func tallyByClass(statuses []int) map[int]int {
	counts := map[int]int{}
	for _, s := range statuses {
		class := s / 100 // 1..5
		counts[class]++
	}
	return counts
}
```

**Acceptance criteria**
- The dense, bounded key space (classes 1–5) is stored in a fixed-size array, not a map.
- The function returns the same per-class counts.
- No hashing or heap allocation per lookup.

**Hint:** when keys are integers in a known small range, the array *is* the index. `var counts [6]int` covers classes 0–5; index by the class directly.

<details>
<summary>Solution</summary>

```go
// tallyByClass returns counts[c] = number of statuses whose class is c (1..5).
func tallyByClass(statuses []int) [6]int {
	var counts [6]int // index 0 unused; 1..5 are the HTTP classes
	for _, s := range statuses {
		class := s / 100
		if class >= 1 && class <= 5 {
			counts[class]++
		}
	}
	return counts
}
```

**Why it's better.** The key space is small, dense, and known at compile time, so the array index *is* the lookup — one bounds check and a direct memory offset, versus the map's hash, bucket walk, and pointer dereference. The array is stack-allocated and contiguous, so it is cache-friendly and triggers no GC pressure; a `map[int]int` allocates a header and buckets on the heap. The bounds guard (`class >= 1 && class <= 5`) also makes the "what about a garbage status like 999 or -1?" question explicit, where the map silently created a junk key. A map is the right tool for sparse, large, or unknown key sets — none of which describes five HTTP classes. Reach for the array when the keys are dense integers.

</details>

---

## Exercise 3 — Inline the one-implementation interface

**Anti-pattern:** Premature Abstraction · **Language:** Go · **Difficulty:** ★ easy

An interface was introduced "for flexibility." There is exactly one implementation, exactly one caller, and no test injects a fake. It is pure indirection: the reader has to jump through the interface to find the only behavior that exists.

```go
// pricing.go
type TaxCalculator interface {
	Calculate(amount float64) float64
}

type usTaxCalculator struct{ rate float64 }

func (c usTaxCalculator) Calculate(amount float64) float64 {
	return amount * c.rate
}

func NewTaxCalculator() TaxCalculator {
	return usTaxCalculator{rate: 0.08}
}

// the only call site:
func TotalWithTax(amount float64) float64 {
	calc := NewTaxCalculator()
	return amount + calc.Calculate(amount)
}
```

A grep shows: `TaxCalculator` has one implementer (`usTaxCalculator`), one constructor, and one caller (`TotalWithTax`). No test references the interface.

**Acceptance criteria**
- The interface and constructor are gone unless a *current* need justifies them.
- The single behavior is reachable directly, not through a factory.
- You can state the condition under which you *would* keep the interface.

**Hint:** an interface with one implementation and no test seam is not a seam — it is a hop. Collapse it to a function or a concrete value. The abstraction can come back the day a second tax regime actually arrives.

<details>
<summary>Solution</summary>

```go
// pricing.go
const taxRate = 0.08

func TotalWithTax(amount float64) float64 {
	return amount + amount*taxRate
}
```

The interface, the struct, and the factory are deleted. `TotalWithTax` now expresses the whole computation in one line.

**When you would keep an abstraction instead:** the moment there is a *real* second case — say a `caTaxCalculator` with a different rate and a different rule for tax-exempt items — extract an interface (or, more idiomatically in Go, pass the rate or a small strategy function). Or, if a test genuinely needs to inject a fake calculator to simulate a downstream pricing failure, a one-method seam earns its keep. The deciding question: *does this abstraction serve a need that exists today?* A guessed interface for an imagined future tax regime does not; it just guesses the shape wrong and forces every reader to pay the indirection tax now.

**Why it's better.** A single-implementation interface is a prediction about the future, and predictions made before the second case are almost always wrong — the real `caTaxCalculator` will need a parameter the guessed `Calculate(amount)` signature did not anticipate, so you would have changed the interface anyway. Until then, the interface only obscures: the reader follows `NewTaxCalculator` → `usTaxCalculator` → `Calculate` to find a single multiplication. Go's structural typing means the interface costs nothing to *re-add* later — extract it from the concrete code once the second implementation reveals the real shape. This is the **rule of three** in the negative: do not abstract on the first instance.

</details>

---

## Exercise 4 — Collapse the speculative factory

**Anti-pattern:** Premature Abstraction · **Language:** Java · **Difficulty:** ★★ medium

A Factory + Strategy hierarchy was built to "support multiple payment providers." Two years on there is still one provider. The architecture predicts a future that has not arrived, and every new developer must learn the ceremony to make one Stripe charge.

```java
public interface PaymentGateway {
    PaymentResult charge(Money amount, Card card);
}

public class StripeGateway implements PaymentGateway {
    public PaymentResult charge(Money amount, Card card) {
        // the only real implementation
        return stripeClient.createCharge(amount, card);
    }
}

public class PaymentGatewayFactory {
    public PaymentGateway create(String provider) {
        switch (provider) {
            case "stripe": return new StripeGateway();
            default: throw new IllegalArgumentException("unknown provider: " + provider);
        }
    }
}

// caller:
PaymentGateway gw = new PaymentGatewayFactory().create("stripe"); // "stripe" is hard-coded everywhere
PaymentResult r = gw.charge(amount, card);
```

There is no second provider on the roadmap, the string `"stripe"` is hard-coded at every call site, and the factory's `switch` has exactly one real case.

**Acceptance criteria**
- The factory and the stringly-typed `create("stripe")` dispatch are removed.
- The single real behavior (`StripeGateway.charge`) is reachable directly.
- You preserve a *test seam* if — and only if — tests need to fake the gateway.
- You can describe the cheap path back to a real abstraction when a second provider appears.

<details>
<summary>Solution</summary>

```java
// One concrete class. No factory, no string dispatch.
public class StripeGateway {
    private final StripeClient stripeClient;

    public StripeGateway(StripeClient stripeClient) {
        this.stripeClient = stripeClient;
    }

    public PaymentResult charge(Money amount, Card card) {
        return stripeClient.createCharge(amount, card);
    }
}

// caller — no factory, no magic string:
PaymentResult r = stripeGateway.charge(amount, card);
```

If, and only if, a test needs to charge against a fake (to assert retry behavior, simulate a decline, etc.), keep a *minimal* interface so the fake can be injected — but drop the factory either way:

```java
public interface PaymentGateway {
    PaymentResult charge(Money amount, Card card);
}
// StripeGateway implements PaymentGateway; tests inject a FakeGateway.
// The factory and create("stripe") still go away — the interface is for testing, not speculation.
```

**The path back to a real abstraction.** When a *second* provider (say Adyen) genuinely lands, you now have two concrete implementations to compare. *That* is when you extract the interface that fits both — and you will discover the real shape (idempotency keys? provider-specific error mapping? different `Money` rounding?) that the speculative `charge(Money, Card)` signature would have gotten wrong. Dispatch between two providers is a clean job for [dependency injection / a configured strategy](../../../design-patterns/01-creational/README.md), not a stringly-typed factory.

**Why it's better.** The factory existed to choose among implementations, but with one implementation it only added a layer of stringly-typed indirection and a `default` branch that could only ever throw. The hard-coded `"stripe"` at every call site is the tell: the "flexibility" was never used. Collapsing to a concrete class (with constructor injection for testability) makes the one real path obvious and removes a whole class plus an `enum`-shaped `switch`. The abstraction is not lost — it is *deferred* to the moment the second case can inform its shape, which is exactly when [strategy/factory patterns](../../../design-patterns/01-creational/README.md) earn their keep instead of merely costing.

</details>

---

## Exercise 5 — ORM in a hot path → targeted query

**Anti-pattern:** Golden Hammer · **Language:** Python · **Difficulty:** ★★ medium

The team's Golden Hammer is the ORM: every data access goes through it, including a per-request hot path that runs thousands of times a second. The ORM hydrates full objects and triggers an N+1 cascade where a single aggregate query would do. The ORM is fine almost everywhere — the mistake is using it *uncritically* in the one place it hurts.

```python
# Called on every dashboard load; orders table has millions of rows.
def total_spend(customer_id: int) -> Decimal:
    customer = Customer.objects.get(id=customer_id)   # 1 query
    total = Decimal("0")
    for order in customer.orders.all():               # 1 query, hydrates every Order object
        for line in order.lines.all():                # N queries — one per order (N+1)
            total += line.unit_price * line.quantity
    return total
```

For a customer with 400 orders this issues ~402 queries and instantiates thousands of ORM objects just to sum some numbers.

**Acceptance criteria**
- The result is computed in **one** database round-trip.
- No full-object hydration for a computation that only needs a sum.
- The rest of the codebase keeps using the ORM — you change only the proven hot path, and you say *why* this one is special.

**Hint:** push the aggregation into the database. The ORM still issues it (`aggregate`/`Sum`), or drop to a parameterized raw query for the hottest path. Either way the work happens in the engine, not in a Python loop over hydrated objects.

<details>
<summary>Solution</summary>

Option A — stay in the ORM but stop hydrating; let the database aggregate:

```python
from django.db.models import Sum, F

def total_spend(customer_id: int) -> Decimal:
    result = OrderLine.objects.filter(
        order__customer_id=customer_id
    ).aggregate(
        total=Sum(F("unit_price") * F("quantity"))
    )
    return result["total"] or Decimal("0")
```

Option B — the hottest path, dropping to a parameterized raw query:

```python
def total_spend(customer_id: int) -> Decimal:
    with connection.cursor() as cur:
        cur.execute(
            """
            SELECT COALESCE(SUM(l.unit_price * l.quantity), 0)
            FROM order_lines l
            JOIN orders o ON o.id = l.order_id
            WHERE o.customer_id = %s
            """,
            [customer_id],   # parameterized — not string-formatted (no SQL injection)
        )
        (total,) = cur.fetchone()
    return Decimal(total)
```

**Why it's better.** Both versions collapse ~402 queries and thousands of object instantiations into **one** aggregate query that the database — which is built for exactly this — answers in a single scan, often straight from an index. The N+1 cascade is gone, and so is the wasted hydration of full `Order`/`OrderLine` objects whose only purpose was to be summed and discarded. The key judgment is *scoped*: the ORM is a fine default for CRUD and for code where developer velocity matters more than microseconds. It becomes a Golden Hammer only when applied **uncritically to a measured hot path**, where its convenience costs real latency. So we surgically replace the one proven bottleneck (and document why — `# measured: 402 queries → 1; dashboard p99 dropped 180ms`) and leave the ORM in charge everywhere else. Note the raw query is *parameterized*, never string-formatted — see [SQL injection prevention](../../../../../Security/README.md).

</details>

---

## Exercise 6 — Segregate the bloated interface

**Anti-pattern:** Interface Bloat · **Language:** Java · **Difficulty:** ★★ medium

`DataStore` started small and accreted every method any consumer ever wanted. Now most implementers support only a slice of it, callers depend on far more than they use, and a change to the streaming methods recompiles the read-only cache. Split it into role interfaces.

```java
public interface DataStore {
    // basic CRUD
    Record get(String id);
    void put(String id, Record r);
    void delete(String id);
    // querying
    List<Record> query(Query q);
    long count(Query q);
    // streaming / bulk
    Stream<Record> scanAll();
    void bulkLoad(Path file);
    // admin
    void compact();
    Stats stats();
    void backup(Path target);
}
```

Reality: the request handler only does `get`/`put`. The reporting job only does `query`/`count`. The ops tooling does `compact`/`backup`/`stats`. The read-through cache implements only `get` and throws `UnsupportedOperationException` for everything else.

**Acceptance criteria**
- The fat interface is split into cohesive **role interfaces** that mirror how it is actually used.
- Each consumer depends only on the role it needs.
- An implementer can support one role without being forced to stub the rest.

**Hint:** group methods by the *caller's* role, not by your mental model of "a data store." Compose the roles for the implementer that genuinely does everything.

<details>
<summary>Solution</summary>

```java
// Role interfaces — each is what some specific caller actually needs.
public interface KeyValueStore {
    Record get(String id);
    void put(String id, Record r);
    void delete(String id);
}

public interface QueryableStore {
    List<Record> query(Query q);
    long count(Query q);
}

public interface BulkStore {
    Stream<Record> scanAll();
    void bulkLoad(Path file);
}

public interface MaintainableStore {
    void compact();
    Stats stats();
    void backup(Path target);
}

// The one implementer that genuinely does everything composes the roles:
public class PostgresStore
        implements KeyValueStore, QueryableStore, BulkStore, MaintainableStore {
    // ... full implementation ...
}

// Each consumer now declares only the role it uses:
class RequestHandler {
    private final KeyValueStore store;          // get/put only
    RequestHandler(KeyValueStore store) { this.store = store; }
}

class ReportJob {
    private final QueryableStore store;          // query/count only
    ReportJob(QueryableStore store) { this.store = store; }
}

// The read-through cache honestly implements just the role it supports:
class ReadThroughCache implements KeyValueStore {
    public Record get(String id) { /* real */ return null; }
    public void put(String id, Record r) { /* real */ }
    public void delete(String id) { /* real */ }
    // no query/scan/compact methods to stub or throw from
}
```

**Why it's better.** This is the [Interface Segregation Principle](../../../clean-code/09-classes/README.md) made concrete: "clients should not be forced to depend on methods they do not use." The `RequestHandler` now compiles against three methods, not eleven, so a change to `bulkLoad`'s signature cannot touch it and its test fake stubs three methods instead of throwing from eight. The `ReadThroughCache` implements exactly the role it can honestly fulfill — there is no longer a method on its type that exists only to throw `UnsupportedOperationException`. The implementer that really does support everything (`PostgresStore`) loses nothing; it simply declares all four roles. Wide interfaces couple unrelated consumers through a single type; role interfaces decouple them along the seams that already exist in how the system is used.

</details>

---

## Exercise 7 — Kill the `UnsupportedOperationException` implementer

**Anti-pattern:** Interface Bloat · **Language:** Java · **Difficulty:** ★★ medium

The smell of a bloated interface is an implementer that *throws* for half its methods. This `ReadOnlyList` claims to be a full `List` but rejects every mutator at runtime — the type system says "you can `add`," reality says "no you can't." Fix the lie.

```java
public class ReadOnlyList<T> implements List<T> {
    private final List<T> backing;
    public ReadOnlyList(List<T> backing) { this.backing = backing; }

    public T get(int i)       { return backing.get(i); }
    public int size()         { return backing.size(); }
    public Iterator<T> iterator() { return backing.iterator(); }

    // ...and a dozen mutators that all do this:
    public boolean add(T t)        { throw new UnsupportedOperationException(); }
    public T remove(int i)         { throw new UnsupportedOperationException(); }
    public void clear()            { throw new UnsupportedOperationException(); }
    public T set(int i, T t)       { throw new UnsupportedOperationException(); }
    // ... etc. for addAll, removeAll, retainAll, replaceAll, sort, ...
}
```

A caller holding a `List<T>` is told by the compiler that `add` is available, then crashes at runtime. The interface is too wide for what this implementer can honestly promise.

**Acceptance criteria**
- A consumer that only reads cannot even *call* a mutator (the impossibility is enforced by the type, not by a runtime throw).
- You do not hand-roll a dozen throwing stubs.
- Where a truly immutable view is needed, prefer the standard tool over a custom class.

**Hint:** Java already has the narrow role you want. Expose the *read* role at the type level; use `Collections.unmodifiableList` or `List.copyOf` for a defensive view instead of a custom throwing class.

<details>
<summary>Solution</summary>

Define (or reuse) a narrow read-only role and expose *that*, so mutators are not part of the contract at all:

```java
// A role interface that promises only reading — no mutators exist to misuse.
public interface ReadOnlyList<T> {
    T get(int i);
    int size();
    Iterator<T> iterator();
}

// Adapter over any List, exposing only the read role:
public final class ListView<T> implements ReadOnlyList<T> {
    private final List<T> backing;
    public ListView(List<T> backing) { this.backing = backing; }
    public T get(int i)           { return backing.get(i); }
    public int size()             { return backing.size(); }
    public Iterator<T> iterator() { return backing.iterator(); }
}
```

And for the common case — "I want to hand out a list nobody can mutate" — reach for the standard library instead of a custom class at all:

```java
List<T> view = Collections.unmodifiableList(backing); // throws on write, but at least it's the JDK's contract
List<T> snapshot = List.copyOf(backing);              // truly immutable copy; clearest intent
```

**Why it's better.** The original lied: its *type* (`List<T>`) advertised a dozen mutators that its *behavior* refused, so the only way to learn the truth was to call one and get an exception in production. Exposing a narrow `ReadOnlyList` role makes the read-only nature a compile-time fact — a consumer literally cannot type `view.add(x)` because `add` is not on the interface. That is [Interface Segregation](../../../clean-code/09-classes/README.md) again: when an implementer can only honestly support a slice of a wide interface, the slice should be its own type. And when the requirement is plain immutability, `List.copyOf` / `Collections.unmodifiableList` express it with zero custom code — the bloated throwing class was solving a problem the platform already solved. (See also [Immutability patterns](../../../clean-code/14-immutability/) for why a copy often beats a view.)

</details>

---

## Exercise 8 — Dismantle the in-house JSON rule engine

**Anti-pattern:** Inner-Platform Effect · **Language:** Python · **Difficulty:** ★★★ hard

To "let business users change discount rules without a deploy," someone built a rule engine that reads rules from JSON and interprets them. It has grown operators, nesting, and a tiny expression language. It is now a slower, buggier, untyped, untested reimplementation of Python's own `if` — the textbook Inner-Platform Effect. The rules have *never actually changed at runtime*; they are edited in a JSON file in the same repo and deployed like any other code.

```python
# rules.json (lives in the repo, edited by engineers, deployed with the app)
RULES = [
    {"if": {"field": "total", "op": ">", "value": 100},
     "then": {"discount": 0.10}},
    {"if": {"all": [
        {"field": "is_member", "op": "==", "value": True},
        {"field": "total", "op": ">", "value": 50}]},
     "then": {"discount": 0.15}},
]

OPS = {
    ">":  lambda a, b: a > b,
    "<":  lambda a, b: a < b,
    "==": lambda a, b: a == b,
}

def evaluate(cond: dict, ctx: dict) -> bool:
    if "all" in cond:
        return all(evaluate(c, ctx) for c in cond["all"])
    if "any" in cond:
        return any(evaluate(c, ctx) for c in cond["any"])
    # leaf
    return OPS[cond["op"]](ctx[cond["field"]], cond["value"])

def discount_for(ctx: dict) -> float:
    for rule in RULES:
        if evaluate(rule["if"], ctx):
            return rule["then"]["discount"]
    return 0.0
```

This interpreter has no type checking (`ctx["total"]` could be a string), no IDE support, no unit tests on individual rules, opaque stack traces, and reimplements `>`, `and`, `or` badly. Worst of all, the "runtime configurability" it was built for is never used.

**Acceptance criteria**
- The rules become plain, testable Python — using the language's own `if`, comparisons, and boolean operators.
- Each rule is an independently unit-testable function.
- You explicitly address: *if* genuine runtime extensibility were truly required, what is the right shape (not a homegrown DSL)?

<details>
<summary>Solution</summary>

The rules are code, edited by engineers, deployed with the app. So write them as code:

```python
from dataclasses import dataclass

@dataclass(frozen=True)
class Context:
    total: float
    is_member: bool

# Each rule is a named, typed, individually testable function.
# Order matters: first match wins, exactly like the original loop.
def _member_bonus(ctx: Context) -> float | None:
    if ctx.is_member and ctx.total > 50:
        return 0.15
    return None

def _big_order(ctx: Context) -> float | None:
    if ctx.total > 100:
        return 0.10
    return None

RULES = (_member_bonus, _big_order)

def discount_for(ctx: Context) -> float:
    for rule in RULES:
        result = rule(ctx)
        if result is not None:
            return result
    return 0.0
```

Now each rule is trivially testable:

```python
def test_member_over_50_gets_15pct():
    assert discount_for(Context(total=60, is_member=True)) == 0.15

def test_non_member_big_order_gets_10pct():
    assert discount_for(Context(total=150, is_member=False)) == 0.10
```

**If genuine runtime extensibility were truly required** — e.g. a non-engineer must add rules *without a deploy*, validated by real demand, not imagined — the answer is **a constrained plugin seam, not a homegrown DSL**:

- Expose a registration API where each rule is a real Python function vetted and registered at startup (`@register_rule`), so rules are first-class code with tests and type checks, merely *pluggable*.
- Or, if rules must come from outside the codebase, adopt an *existing, sandboxed* rules engine (e.g. a maintained library, or a real expression language like CEL) rather than growing your own interpreter. You inherit its parser, type checks, and security review instead of reinventing them — badly.

```python
_REGISTRY: list = []

def register_rule(fn):       # the plugin seam: extensibility without a DSL
    _REGISTRY.append(fn)
    return fn

@register_rule
def loyalty_tier(ctx: Context) -> float | None:
    return 0.20 if ctx.total > 500 else None
```

**Why it's better.** The JSON interpreter was the Inner-Platform Effect in full bloom: it reimplemented comparison and boolean logic that Python already provides, but stripped of type checking, tooling, tests, and readable stack traces — a strictly worse `if`. Expressing the rules as ordinary functions gives every one of those back for free: the type checker catches `total` being a string, the test runner exercises each rule in isolation, the debugger steps through real frames, and a new rule is a small function with a test rather than a hand-edited JSON blob the interpreter might misparse. The "configurable without a deploy" justification turned out to be fiction — the rules lived in the repo and shipped with the build. When real runtime extensibility *is* proven necessary, the right tool is a *constrained plugin* (registered real functions) or a *battle-tested* engine — never a bespoke DSL whose first feature request is "can it do `or`?" and whose tenth is "why is it so slow and buggy?"

</details>

---

## Exercise 9 — Replace the in-DB config interpreter with a plugin seam

**Anti-pattern:** Inner-Platform Effect + Golden Hammer · **Language:** Go · **Difficulty:** ★★★ hard

A service stores tiny imperative "scripts" in a database column and interprets them at runtime to decide how to route messages. It is an inner platform (a homemade scripting language living in a `TEXT` column) *and* a Golden Hammer (the DB, the team's favorite tool, pressed into service as a code store). Convert the open-ended interpreter into a closed set of real Go handlers selected by configuration.

```go
// routes table:  pattern TEXT, script TEXT
//   "orders.*"  ->  "set priority high; tag billing; forward queue=fast"
//   "logs.*"    ->  "drop"

type Route struct {
	Pattern string
	Script  string // a mini imperative language, parsed every message
}

// interp parses and executes the script for every single message — at message rate.
func interp(script string, msg *Message) {
	for _, stmt := range strings.Split(script, ";") {
		parts := strings.Fields(strings.TrimSpace(stmt))
		switch parts[0] {
		case "set":
			msg.SetField(parts[1], strings.Join(parts[2:], " ")) // "set priority high"
		case "tag":
			msg.AddTag(parts[1])
		case "forward":
			kv := strings.SplitN(parts[1], "=", 2) // "forward queue=fast"
			msg.Forward(kv[1])
		case "drop":
			msg.Drop()
		}
	}
}
```

The "language" has no validation (a typo like `frward` is silently ignored), is re-parsed on every message in a hot path, has no tests, and quietly does the wrong thing on malformed input. The behaviors it expresses are a *small, closed set*.

**Acceptance criteria**
- The set of possible actions is closed and expressed as real, compiled, tested Go — not parsed text.
- Routing config still selects *which* actions apply to *which* pattern, but config is *data choosing among code*, not code *stored as data*.
- Parsing no longer happens per message in the hot path.
- You note when a *closed enum of actions* is the right call versus when a real plugin system would be.

<details>
<summary>Solution</summary>

The actions are a small, closed set, so model them as typed config that selects compiled handlers — parsed *once* at load, not per message:

```go
// A closed set of real actions, validated at load time.
type Action struct {
	Kind  ActionKind
	Field string // for SetField
	Value string // for SetField / Forward / Tag
}

type ActionKind int

const (
	ActSetField ActionKind = iota
	ActTag
	ActForward
	ActDrop
)

type Route struct {
	Pattern string
	Actions []Action // parsed ONCE at config load, not per message
}

// apply is straight-line, compiled Go — no parsing in the hot path.
func (r Route) apply(msg *Message) {
	for _, a := range r.Actions {
		switch a.Kind {
		case ActSetField:
			msg.SetField(a.Field, a.Value)
		case ActTag:
			msg.AddTag(a.Value)
		case ActForward:
			msg.Forward(a.Value)
		case ActDrop:
			msg.Drop()
		}
	}
}
```

Config now selects among real actions (e.g. loaded from YAML/JSON and validated once at startup):

```yaml
routes:
  - pattern: "orders.*"
    actions:
      - { kind: set_field, field: priority, value: high }
      - { kind: tag, value: billing }
      - { kind: forward, value: fast }
  - pattern: "logs.*"
    actions:
      - { kind: drop }
```

Parsing this config into `[]Action` happens once at load. A typo like `frward` now fails *at startup* with a clear error, not silently per message. Each action is unit-testable: `Route{Actions: []Action{{Kind: ActTag, Value: "billing"}}}.apply(msg)`.

**When a closed enum is right vs. when you need a real plugin.** If the action vocabulary is small and changes only when engineers ship code (the case here), the closed `ActionKind` enum is exactly right — it is data *choosing among* compiled behavior. If third parties or non-engineers genuinely need to add *new kinds of behavior* at runtime (proven by real demand, not speculation), then expose a proper plugin interface (`type Action interface { Apply(*Message) error }` with registration), or embed a *real*, sandboxed scripting runtime (Lua, Starlark, CEL) — never a hand-rolled `strings.Split` interpreter.

**Why it's better.** Two anti-patterns die at once. The **Inner-Platform Effect** — a homemade imperative language in a `TEXT` column — is replaced by typed config selecting compiled Go, so the compiler, the test suite, and startup validation catch the errors the interpreter swallowed (`frward` is now a boot-time failure, not a silent no-op forever). The **Golden Hammer** — abusing the database as a code store because the DB is the team's reflexive tool — is corrected by recognizing that *behavior belongs in code*; the DB/config holds *which* behaviors apply, not the behaviors themselves. And the hot-path cost vanishes: the script is parsed once at load instead of re-tokenized for every message. The escape hatch is preserved honestly — when real extensibility is needed, a typed plugin interface or a sandboxed runtime is the tool, chosen deliberately rather than grown by accident from `strings.Split`.

</details>

---

## Exercise 10 — Wait for the rule of three

**Anti-pattern:** Premature Abstraction · **Language:** Python · **Difficulty:** ★★ medium

A developer sees two slightly-similar functions and immediately extracts a "flexible" generic exporter parameterized by callbacks. The abstraction is harder to read than the two functions it replaced, and it guessed the wrong axis of variation. This is the inverse skill of the others: recognizing that the right move is *not yet to abstract* — and knowing what to do when the third case finally arrives.

```python
# The "DRY" extraction someone reached for after seeing TWO similar functions:
def export(items, *, header_fn, row_fn, footer_fn, joiner, encoder, post_process):
    parts = [header_fn(items)]
    for it in items:
        parts.append(row_fn(it))
    parts.append(footer_fn(items))
    text = joiner.join(parts)
    text = post_process(text)
    return encoder(text)

# Calling it is now a puzzle:
csv_bytes = export(
    rows,
    header_fn=lambda _: "id,name",
    row_fn=lambda r: f"{r.id},{r.name}",
    footer_fn=lambda _: "",
    joiner="\n",
    encoder=lambda s: s.encode("utf-8"),
    post_process=lambda s: s.strip(),
)
```

The two original functions were a simple `to_csv` and `to_tsv` that differed by *one character* (the delimiter). The generic `export` has six parameters to cover variation that does not exist yet.

**Acceptance criteria**
- Replace the over-general abstraction with the two concrete functions it should have stayed as — or a single function parameterized only on the variation that *actually* differs.
- Show what you would do when a genuine *third* format (with real structural differences, e.g. JSON) arrives.
- Articulate the rule-of-three judgment.

<details>
<summary>Solution</summary>

The only real difference between the first two cases was the delimiter, so parameterize *that one thing* — nothing more:

```python
def to_delimited(items, sep: str) -> bytes:
    lines = ["id" + sep + "name"]
    lines += [f"{it.id}{sep}{it.name}" for it in items]
    return "\n".join(lines).encode("utf-8")

def to_csv(items) -> bytes:
    return to_delimited(items, ",")

def to_tsv(items) -> bytes:
    return to_delimited(items, "\t")
```

**When the third case arrives** — say JSON, which is *structurally* different (no header row, no line joining, real escaping) — do **not** bend `to_delimited` to fit it. The third case is the one that finally reveals the true axis of variation, so extract the abstraction *now*, informed by three real examples:

```python
from typing import Protocol

class Exporter(Protocol):
    def export(self, items) -> bytes: ...

class DelimitedExporter:
    def __init__(self, sep: str): self.sep = sep
    def export(self, items) -> bytes:
        return to_delimited(items, self.sep)

class JsonExporter:
    def export(self, items) -> bytes:
        import json
        return json.dumps([{"id": it.id, "name": it.name} for it in items]).encode("utf-8")
```

Three concrete cases (`CSV`, `TSV`, `JSON`) now show the real seam: *the whole serialization strategy* varies, not a delimiter and five lambdas. The `Exporter` protocol fits all three honestly because it was extracted *from* them.

**Why it's better.** The premature `export(header_fn, row_fn, footer_fn, joiner, encoder, post_process)` guessed six axes of variation after seeing only one real difference (the delimiter). Five of those six parameters were noise, and the call site became a puzzle harder to read than the two trivial functions it replaced — abstraction that *adds* cognitive load is a net loss. Keeping `to_csv`/`to_tsv` as thin wrappers over a one-parameter helper removes the duplication that actually existed and nothing more. Then the **rule of three** does its job: the *third* case (JSON) is structurally different enough to reveal that the real variation is the entire serialization strategy — knowledge the two-case version could not have had. Abstractions extracted from three concrete examples fit; abstractions guessed from one or two almost always pick the wrong axis. Compare with the [DRY principle](../../../clean-code/15-pure-functions/) done right: deduplicate the repetition you *have*, not the variation you *imagine*.

</details>

---

## Exercise 11 — Judgment: when to *leave it alone*

**Anti-pattern:** all four (judgment) · **Difficulty:** ★★★ hard · *(judgment exercise — the right answer is sometimes "do nothing")*

Over-correction is its own anti-pattern. An engineer who has just learned these four failures will start "fixing" abstractions that are not broken — splitting stable interfaces, replacing a sensibly standardized tool, re-introducing variety for its own sake. For each scenario below, decide whether to **change it** or **leave it**, and justify the call with the *same* judgment the cures rely on.

**Scenario A — "Golden Hammer?"**
A backend team uses PostgreSQL for everything: relational data, a job queue (`SELECT ... FOR UPDATE SKIP LOCKED`), and a small key-value cache. A new hire proposes adding RabbitMQ for the queue and Redis for the cache "because using one tool for everything is a Golden Hammer." Current scale: 200 jobs/minute, cache hit on a few thousand keys. The team is four people.

**Scenario B — "Interface Bloat?"**
A `Repository` interface has six methods: `find`, `findAll`, `save`, `delete`, `existsById`, `count`. Every implementer (there are three) supports all six honestly; every consumer uses three or four of them. Someone wants to split it into `ReadRepository` / `WriteRepository` / `CountRepository` "for Interface Segregation."

**Scenario C — "Premature Abstraction?"**
There is a `PaymentProvider` interface with two real implementations (Stripe, Adyen) already in production, plus a tested `FakeProvider` used in the suite. A reviewer says "interfaces with few implementations are premature abstraction — inline it."

**Task.** For each scenario, give a clear **change / leave** decision and the evidence-based reasoning. Name the trap the *over-correction* would fall into.

<details>
<summary>Solution</summary>

**Scenario A — LEAVE IT (for now).**
Standardizing on one well-understood tool is not automatically a Golden Hammer — it is a *legitimate* operational choice when the tool genuinely fits and the scale does not demand more. At 200 jobs/minute and a few thousand cache keys, Postgres handles the queue (`SKIP LOCKED` is a real, robust pattern) and the cache fine. Adding RabbitMQ and Redis would impose two more systems to deploy, monitor, back up, secure, and learn — on a four-person team — to solve a load problem that does not exist. **The over-correction's trap:** mistaking *consolidation* for the Golden Hammer. The Golden Hammer is using a tool *that does not fit*; using one tool that *does* fit, and that keeps operational surface small, is good engineering. *Revisit when evidence demands it* — when queue throughput or cache latency is measured to exceed what Postgres can serve, introduce the specialized tool against that real requirement. Decision driver: same as Exercise 5 — let the *measured* problem dictate the tool, in both directions.

**Scenario B — LEAVE IT.**
Interface Bloat is defined by implementers that *cannot honestly support* the interface (the `UnsupportedOperationException` tell from Exercise 7), or consumers coupled to methods that change for unrelated reasons. Here all three implementers support all six methods honestly, the methods are cohesive (they are the standard repository vocabulary), and no one is forced to throw. Splitting into three interfaces would triple the type count, complicate every implementer's declaration, and buy nothing — the consumers using "only four of six" are not harmed by the existence of two methods they ignore. **The over-correction's trap:** applying ISP mechanically by method count rather than by the principle's actual trigger ("clients forced to depend on methods they *cannot* use / that *change* for unrelated reasons"). A small, stable, cohesive interface that every implementer honors is not bloated. Six cohesive methods is fine; sixty incohesive ones throwing half the time is not.

**Scenario C — LEAVE IT.**
This is the [rule of three](../../../clean-code/15-pure-functions/) *satisfied*, not violated. There are **two real production implementations** plus a fake the test suite depends on — the abstraction is earning its keep right now: it lets two payment providers coexist and lets tests run without hitting a real gateway. The reviewer has over-rotated on "few implementations = premature," forgetting that *premature* means *before the second case exists*. Here the cases exist. **The over-correction's trap:** inlining a *justified, in-use* abstraction would force a choice between Stripe and Adyen at every call site and rip out the test seam — re-introducing exactly the coupling the interface correctly removes. The deciding question is unchanged from Exercise 3, and here the answer flips: *does this abstraction serve a need that exists today?* Yes — two providers and a fake. Keep it.

**The unifying judgment.** Every cure in this file is gated by the *same* question: **does this abstraction (or this tool choice) earn its keep against a need that exists today?** Exercises 3, 4, and 10 answered "no — defer it." This exercise shows the identical question answering "yes — leave it." The skill is not "always split interfaces / always inline single-implementation types / always diversify tools" — that is just a new Golden Hammer pointed at your own codebase. The skill is reading the *evidence* (honest implementers? real second case? measured scale?) and acting on it in whichever direction it points.

</details>

---

## Exercise 12 — Mini-project: untangle the `NotificationKit`

**Anti-pattern:** all four, in one small realistic module · **Language:** Python · **Difficulty:** ★★★★ project

Below is a notification module that manages to combine **every** abstraction failure: a homemade template "engine" interpreting a custom syntax (Inner-Platform Effect), a regex doing a literal check and a dict where a tuple of channels would do (Golden Hammer), a fat `Channel` interface most channels can't honestly implement (Interface Bloat), and a `ChannelFactory` + strategy hierarchy guarding a single real channel (Premature Abstraction). Refactor it into clean, fitting units. Work in steps; do not try to fix it all at once.

```python
import re

# --- Inner-Platform Effect: a homemade template language interpreted at runtime ---
def render(template: str, ctx: dict) -> str:
    # supports {{name}} and {{#if premium}}...{{/if}} — a worse, buggier Jinja
    out = template
    for m in re.findall(r"\{\{(\w+)\}\}", template):
        out = out.replace("{{%s}}" % m, str(ctx.get(m, "")))
    if "{{#if premium}}" in out:
        if ctx.get("premium"):
            out = out.replace("{{#if premium}}", "").replace("{{/if}}", "")
        else:
            out = re.sub(r"\{\{#if premium\}\}.*?\{\{/if\}\}", "", out, flags=re.S)
    return out

# --- Interface Bloat: every channel must implement all of this ---
class Channel:
    def send(self, to, body): raise NotImplementedError
    def send_bulk(self, recipients, body): raise NotImplementedError
    def schedule(self, to, body, at): raise NotImplementedError
    def supports_attachments(self): raise NotImplementedError
    def max_length(self): raise NotImplementedError

class EmailChannel(Channel):
    def send(self, to, body): ...                 # real
    def send_bulk(self, r, b): raise NotImplementedError   # not really supported
    def schedule(self, t, b, at): raise NotImplementedError # not supported
    def supports_attachments(self): return True
    def max_length(self): raise NotImplementedError         # n/a for email

# --- Premature Abstraction: a factory + strategy guarding ONE real channel ---
class ChannelFactory:
    def create(self, kind: str) -> Channel:
        if kind == "email":
            return EmailChannel()
        raise ValueError("unknown channel")

# --- Golden Hammer: regex for a literal check; dict for a fixed small set ---
def is_valid_recipient(addr: str) -> bool:
    return bool(re.match(r".*@.*", addr))   # not even close to real validation

ENABLED = {"email": True}  # a one-entry dict standing in for a constant
```

**Acceptance criteria**
- **Inner-Platform:** the homemade template interpreter is replaced (use the standard library / a real template engine, or plain f-strings if the cases are few).
- **Golden Hammer:** the literal regex check and the one-entry dict are replaced with the fitting tool.
- **Interface Bloat:** the fat `Channel` interface is segregated so `EmailChannel` no longer throws `NotImplementedError`.
- **Premature Abstraction:** the single-channel factory is collapsed; the abstraction returns only when a second channel does.
- Each remaining unit is testable in isolation, and you note the *cheap path back* to each abstraction when a real need appears.

<details>
<summary>Solution</summary>

Work in four small steps — one anti-pattern at a time, keeping the module working after each.

**Step 1 — replace the homemade template engine (Inner-Platform Effect).**
The cases are few and known, so plain f-strings via small functions are clearest; if templates must be authored by non-engineers, use a *real* engine (Jinja2), never a homemade one.

```python
def welcome_body(name: str, premium: bool) -> str:
    line = f"Hi {name}, welcome!"
    if premium:
        line += " Enjoy your premium benefits."
    return line
```

**Step 2 — fix the Golden Hammers.**

```python
# Substring/structural check, not a misleading regex. (Real email validation is
# a deep topic — at minimum, check structure honestly; ideally send a confirmation.)
def is_valid_recipient(addr: str) -> bool:
    return "@" in addr and "." in addr.split("@")[-1]

# A one-entry dict was a constant in disguise:
EMAIL_ENABLED = True
```

**Step 3 — segregate the bloated `Channel` interface.**
Define the narrow role email can honestly fulfill; capabilities email lacks simply are not on its type.

```python
from typing import Protocol

class Sender(Protocol):
    def send(self, to: str, body: str) -> None: ...

class EmailChannel:                 # implements only what it can honor
    def send(self, to: str, body: str) -> None:
        ...  # real SMTP send

# A channel that genuinely supports bulk declares that role too:
class BulkSender(Protocol):
    def send_bulk(self, recipients: list[str], body: str) -> None: ...
# EmailChannel does NOT implement BulkSender — and no longer lies by throwing.
```

**Step 4 — collapse the single-channel factory (Premature Abstraction).**

```python
# No factory, no string dispatch — there is one channel.
email = EmailChannel()

def notify(channel: Sender, to: str, body: str) -> None:
    if not is_valid_recipient(to):
        raise ValueError(f"invalid recipient {to!r}")
    channel.send(to, body)
```

Putting it together:

```python
def send_welcome(channel: Sender, to: str, name: str, premium: bool) -> None:
    notify(channel, to, welcome_body(name, premium))
```

**What happened to each anti-pattern, and the path back:**

- **Inner-Platform Effect →** the homemade `{{#if}}` interpreter is gone; templates are plain Python (or Jinja2 if non-engineers must author them). *Path back:* adopt Jinja2 the day real user-authored templates are a proven requirement — a maintained engine, not a regex.
- **Golden Hammer →** the literal `re.match(r".*@.*")` became an honest structural check; the one-entry `ENABLED` dict became a constant. *Path back:* a regex returns only for genuine *patterns*; a dict returns when the key set is actually sparse and dynamic.
- **Interface Bloat →** `Channel`'s five methods became a narrow `Sender` role (plus an optional `BulkSender` for channels that truly support it). `EmailChannel` no longer throws `NotImplementedError` for anything. *Path back:* add a role interface per capability as real channels need them.
- **Premature Abstraction →** the `ChannelFactory` + string dispatch collapsed to a single concrete `EmailChannel`, while `notify` still takes a `Sender` so a second channel (SMS) plugs in cleanly *when it exists*. *Path back:* the `Sender` protocol is already the seam — the second channel just implements it; no factory needed until you must *select* among channels by config.

**Why it's better.** Each fix replaced a wrong-shaped abstraction with one that fits the problem *as it exists today*. The template engine, regex, dict, fat interface, and factory all promised generality nobody was using and charged for it in readability, correctness, and (for the interpreter) performance and safety. The refactored module is plain, typed, and testable — `welcome_body`, `is_valid_recipient`, and `notify` each test with literals and a fake `Sender`, no SMTP server and no template-parser fixtures. Crucially, the work was done as four small green steps, each curing one anti-pattern while the module stayed working — never a big-bang rewrite — and each cure left a documented, cheap path back to the abstraction *for the day a real second case justifies it*.

</details>

---

## Exercise 13 — Write an abstraction-failure review checklist

**Anti-pattern:** meta (prevention) · **Difficulty:** ★★ medium

Abstraction failures are cheapest to stop in review, before the wrong shape calcifies and grows callers. Write a concise, *actionable* reviewer checklist — questions a reviewer asks of a diff — that catches all four failures **and** guards against the over-correction from Exercise 11. Aim for questions with a clear "if yes, push back" trigger, not vague advice like "is this well-abstracted?"

**Acceptance criteria**
- One or more concrete, answerable questions per anti-pattern.
- Each question has a clear failure trigger and a suggested action.
- At least one question that guards against *over-correction* (splitting/inlining when you shouldn't).
- Short enough that a reviewer would actually run it on every PR.

<details>
<summary>Solution</summary>

**Abstraction-Failure PR review checklist**

| # | Question | If the answer is… | Then |
|---|---|---|---|
| 1 | Does this PR add an interface/abstract class with only **one** implementation and no test seam? | "Yes" | Push back: inline it; abstract on the **second** real case. **Premature Abstraction**. |
| 2 | Does this PR add a factory/strategy whose dispatch has exactly one real branch? | "Yes" | Push back: collapse to the concrete type; defer the factory. **Premature Abstraction**. |
| 3 | Does any new implementer throw `UnsupportedOperationException` / `NotImplementedError` for interface methods? | "Yes" | Push back: split into role interfaces (ISP); the implementer should declare only what it honors. **Interface Bloat**. |
| 4 | Is a new tool/pattern used because it's the author's default, where a simpler primitive fits (regex for a literal, map for dense ints, ORM in a measured hot path)? | "Yes" | Push back: use the fitting primitive; show the measurement if performance is the claim. **Golden Hammer**. |
| 5 | Does this PR add a config/DB-stored mini-language, rule format, or interpreter? | "Yes" | Push back hard: is runtime extensibility *proven* needed? If not, write code. If yes, use a plugin seam or a real sandboxed engine, not a homemade DSL. **Inner-Platform Effect**. |
| 6 | (Over-correction guard) Does this PR **split** an interface every implementer honors, **inline** an abstraction with ≥2 real implementations, or **add** a tool to replace one that fits at current scale? | "Yes" | Ask for the evidence: a dishonest implementer, a real second case, a *measured* scale problem. No evidence → leave it. |
| 7 | Can each new/changed unit be tested in isolation with literals and a fake? | "No — needs the full engine/DB/network" | Ask whether the abstraction is fighting the problem. Hard-to-test shape is a smell across all four. |

**Author's pre-flight (mirrored):** before requesting review, run questions 1–7 on your own diff. For every abstraction you add, write the *current* need it serves in the PR description — if you can only name a future one, defer it.

**Why this is better than "review for good abstraction."** Each row has a *trigger* and an *action*, so two reviewers reach the same conclusion under time pressure. Row 6 is the load-bearing one: it stops the reviewer from becoming the new anti-pattern by demanding the *same* evidence (dishonest implementer, real second case, measured scale) that the cures themselves require — pointing the questions in both directions. The list catches wrong-shaped abstractions at their cheapest moment, a small diff, before they grow the callers and config that make them expensive to reshape later.

</details>

---

## Summary

- These exercises move you from *recognizing* abstraction failures to *fixing* them: swap a Golden Hammer for the primitive that fits (regex→substring, map→array, ORM→targeted query), dismantle an Inner-Platform interpreter back into plain tested code or a constrained plugin, segregate a bloated interface into honest role interfaces, and inline a premature abstraction until a real second case earns it back.
- **The single deciding question runs through every fix:** *does this abstraction (or tool choice) serve a need that exists today?* When the answer is "no, it's for the future," defer it (Exercises 3, 4, 10). When the answer is "yes, and the evidence proves it," keep it (Exercise 11).
- **Over-correction is its own anti-pattern.** Splitting stable interfaces, inlining in-use abstractions, or diversifying tools that fit is just a Golden Hammer pointed at your own codebase. Read the evidence — dishonest implementers, real second cases, *measured* scale — and act in whichever direction it points (Exercise 11).
- **The rule of three is the through-line for abstraction.** Extract the shape *from* concrete examples once the third reveals the true axis of variation; abstractions guessed from one or two cases almost always pick the wrong axis (Exercises 3, 4, 10).
- **Inner-Platform Effect has a specific cure:** when real runtime extensibility is *proven* necessary, reach for a constrained plugin seam (registered real functions) or a battle-tested sandboxed engine — never grow your own DSL one operator at a time (Exercises 8, 9).
- **Prevention scales better than cure.** The review checklist (Exercise 13) moves the fight upstream, catching the wrong shape while the diff is still small — and guarding against the reviewer's own urge to over-abstract.

---

## Related Topics

- [`junior.md`](junior.md) — the four shapes and how to recognize them on sight.
- [`middle.md`](middle.md) — the forces that create these shapes and the countermoves used here.
- [`find-bug.md`](find-bug.md) — spot-the-anti-pattern snippets (critical reading practice).
- [`optimize.md`](optimize.md) — more flawed designs to redesign.
- [`interview.md`](interview.md) — Q&A across all levels for job prep.
- [Clean Code → Classes](../../../clean-code/09-classes/README.md) — the Interface Segregation Principle, the cure for Interface Bloat.
- [Clean Code → Pure Functions](../../../clean-code/15-pure-functions/) — DRY done right; deduplicate what you have, not what you imagine.
- [Clean Code → Immutability](../../../clean-code/14-immutability/) — read-only views and copies over throwing wrappers.
- [Design Patterns → Creational](../../../design-patterns/01-creational/README.md) — Factory and Strategy done right, *after* the second case exists.
- [Refactoring → Refactoring Techniques](../../../refactoring/02-refactoring-techniques/README.md) — Inline Class, Collapse Hierarchy, Replace Conditional with Polymorphism.
- [OO Misuse](../01-oo-misuse/middle.md) — the sibling category; Constant Interface and Functional Decomposition rhyme with these failures.
