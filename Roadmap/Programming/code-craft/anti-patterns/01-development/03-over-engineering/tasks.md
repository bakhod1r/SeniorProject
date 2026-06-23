# Over-Engineering Anti-Patterns — Exercises

> **Category:** [Development Anti-Patterns](../README.md) → **Over-Engineering** — *hands-on practice removing effort spent on problems you don't have.*
> **Covers (collectively):** Premature Optimization · Speculative Generality · Gold Plating · Yo-yo Problem · Lasagna Code · Accidental Complexity · Soft Coding · Bikeshedding

---

These are **simplification** exercises, not recognition quizzes. Every one of the structure exercises in [Bad Structure](../01-bad-structure/tasks.md) was about *adding* the right shape; this file is the mirror image — the dominant move here is **removal**. You will inline speculative abstractions, collapse empty layers, replace clever code with clear code, strip features nobody asked for, and drag soft-coded logic back into code. Less code that does the same job is the win condition.

For each exercise you get a problem statement, starting code (in Go, Java, or Python — the language varies on purpose), acceptance criteria, and a collapsible solution. Try it in your editor *before* opening the solution, then compare.

> **Two cautions that run through the whole file.** (1) Simplification must **preserve behavior**. Where the change touches a hot path, the right answer includes "I'd benchmark before and after to confirm no real regression" — removal is not free of risk just because it's removal. (2) **Not every abstraction is over-engineering.** One exercise deliberately gives you a justified seam and the correct answer is *keep it*. The skill is judgment, not a reflex to delete. Refer back to [`junior.md`](junior.md) for the patterns and [`middle.md`](middle.md) for the reversibility lens.

---

## Table of Contents

| # | Exercise | Anti-pattern(s) | Lang | Difficulty |
|---|---|---|---|---|
| 1 | [Un-optimize the clever loop](#exercise-1--un-optimize-the-clever-loop) | Premature Optimization | Go | ★ easy |
| 2 | [Inline the one-implementation strategy](#exercise-2--inline-the-one-implementation-strategy) | Speculative Generality | Java | ★ easy |
| 3 | [Trim the gold-plated function](#exercise-3--trim-the-gold-plated-function) | Gold Plating | Python | ★ easy |
| 4 | [Delete the abstraction — or keep it?](#exercise-4--delete-the-abstraction--or-keep-it) | Speculative Generality (judgment) | Go | ★★ medium |
| 5 | [Reduce accidental complexity](#exercise-5--reduce-accidental-complexity) | Accidental Complexity | Python | ★★ medium |
| 6 | [Flatten the yo-yo hierarchy](#exercise-6--flatten-the-yo-yo-hierarchy) | Yo-yo Problem | Java | ★★ medium |
| 7 | [Collapse the lasagna layers](#exercise-7--collapse-the-lasagna-layers) | Lasagna Code | Go | ★★ medium |
| 8 | [Move the soft-coded rule engine back to code](#exercise-8--move-the-soft-coded-rule-engine-back-to-code) | Soft Coding | Python | ★★ medium |
| 9 | [Right-size the premature cache](#exercise-9--right-size-the-premature-cache) | Premature Optimization + Accidental Complexity | Go | ★★★ hard |
| 10 | [Replace the bit-twiddling with a benchmark](#exercise-10--replace-the-bit-twiddling-with-a-benchmark) | Premature Optimization | Go | ★★★ hard |
| 11 | [Kill the speculative plugin framework](#exercise-11--kill-the-speculative-plugin-framework) | Speculative Generality + Gold Plating | Java | ★★★ hard |
| 12 | [Mini-project: simplify the `NotificationPlatform`](#exercise-12--mini-project-simplify-the-notificationplatform) | All eight | Python | ★★★★ project |
| 13 | [Judgment: which design is right-sized?](#exercise-13--judgment-which-design-is-right-sized) | meta (reversibility) | — | ★★★ hard |
| 14 | [Defuse the bikeshed](#exercise-14--defuse-the-bikeshed) | Bikeshedding | (process) | ★★ medium |

---

## Exercise 1 — Un-optimize the clever loop

**Anti-pattern:** Premature Optimization · **Language:** Go · **Difficulty:** ★ easy

Someone hand-unrolled a loop and inlined the parity test with a bit trick "for speed." There is no benchmark in the repo and this function runs once per request on a list of at most a few dozen items. Restore clarity.

```go
// countActive: how many users have an even-numbered tier and are not suspended.
func countActive(users []User) int {
	c, i, n := 0, 0, len(users)
	for ; i < n-3; i += 4 { // manual 4x unroll
		if users[i].Tier&1 == 0 && users[i].State != 2 {
			c++
		}
		if users[i+1].Tier&1 == 0 && users[i+1].State != 2 {
			c++
		}
		if users[i+2].Tier&1 == 0 && users[i+2].State != 2 {
			c++
		}
		if users[i+3].Tier&1 == 0 && users[i+3].State != 2 {
			c++
		}
	}
	for ; i < n; i++ { // remainder
		if users[i].Tier&1 == 0 && users[i].State != 2 {
			c++
		}
	}
	return c
}
```

**Acceptance criteria**
- The function is a single clear loop with no unrolling and no remainder tail.
- Behavior is byte-for-byte identical for every input.
- `State != 2` and `Tier&1 == 0` are expressed by readable names, not magic numbers and bit tricks.
- You state how you would confirm there is no meaningful performance regression.

**Hint:** `Tier&1 == 0` is just `Tier%2 == 0`. The unrolling buys nothing the Go compiler and CPU branch predictor don't already handle on a tiny slice; let `range` do the work.

<details>
<summary>Solution</summary>

```go
const stateSuspended = 2 // was the magic 2

func (u User) isActive() bool {
	return u.Tier%2 == 0 && u.State != stateSuspended
}

func countActive(users []User) int {
	c := 0
	for _, u := range users {
		if u.isActive() {
			c++
		}
	}
	return c
}
```

**Why it's better.** The clever version traded readability for a speed-up nobody measured, on a slice too small to matter. The plain `range` loop is obviously correct — there is no off-by-one risk in the unroll boundary (`n-3`), no duplicated predicate to keep in sync across four copies, and the suspended-state and parity checks now read as English. Extracting `isActive` means the rule lives in one place and is unit-testable on its own.

**Confirming no regression.** Because this *is* a performance claim in reverse, I'd close it the same way I'd justify an optimization: write a `Benchmark` over a realistic slice and run `go test -bench=. -benchmem`, comparing old vs new with `benchstat`. On a few-dozen-element slice the two will be statistically indistinguishable; the unroll only ever pays off in tight, profiled, million-iteration hot loops — which this is not. If the benchmark ever *did* show this on a hot path, the right next step is the right data structure, not a hand-unroll.

</details>

---

## Exercise 2 — Inline the one-implementation strategy

**Anti-pattern:** Speculative Generality · **Language:** Java · **Difficulty:** ★ easy

A "pluggable" slug generator was built with a strategy interface and a factory "in case we need different slug algorithms later." Two years on there is exactly one implementation, one caller, and no test ever swaps it. Collapse it to the concrete function it always was.

```java
interface SlugStrategy {
    String toSlug(String title);
}

class DefaultSlugStrategy implements SlugStrategy {
    public String toSlug(String title) {
        return title.trim().toLowerCase().replaceAll("[^a-z0-9]+", "-").replaceAll("^-|-$", "");
    }
}

class SlugStrategyFactory {
    static SlugStrategy create() {
        return new DefaultSlugStrategy(); // only ever returns this
    }
}

// the only caller:
String slug = SlugStrategyFactory.create().toSlug(article.getTitle());
```

**Acceptance criteria**
- The interface, the factory, and the strategy class are gone.
- The slug logic survives unchanged in one place.
- The call site is a single direct call.
- You can state the condition under which you *would* re-introduce the interface.

**Hint:** an interface with one implementation, one caller, and no test seam is indirection, not abstraction. A `static` method on a small utility is the honest shape.

<details>
<summary>Solution</summary>

```java
final class Slugs {
    private Slugs() {}

    static String of(String title) {
        return title.trim()
                    .toLowerCase()
                    .replaceAll("[^a-z0-9]+", "-")
                    .replaceAll("^-|-$", "");
    }
}

// caller:
String slug = Slugs.of(article.getTitle());
```

**Why it's better.** Three types and a factory dissolved into one pure function with the identical behavior. There is nothing to "configure," nothing to wire, and the reader sees the algorithm at the call site instead of chasing `create()` to discover it always returns the same thing. This is *Remove Speculative Generality* and *Inline Class* from Fowler.

**When you'd add the interface back.** The moment a *real* second algorithm exists — say marketing needs a transliterating slug for non-Latin titles — you introduce the seam then, designed against two concrete cases you can actually see (the Rule of Three is forming). Abstraction justified by today's reality is design; abstraction justified only by "we might" is speculation. Inlining now does not burn that bridge: re-extracting an interface from a single function is a five-minute refactor when the real need arrives.

</details>

---

## Exercise 3 — Trim the gold-plated function

**Anti-pattern:** Gold Plating · **Language:** Python · **Difficulty:** ★ easy

The ticket said: *"Save the generated invoice to a file."* What got built grew compression, encryption, an email option, watermarking, and a retry loop — none of it requested, none of it tested, all of it now load-bearing-looking. Cut it back to the requirement.

```python
def save_invoice(invoice, path, *, fmt="pdf", compress=False, encrypt=False,
                 password=None, email_to=None, watermark=None, retries=3,
                 backup_dir=None):
    data = invoice.render(fmt)
    if watermark:
        data = _apply_watermark(data, watermark)
    if compress:
        data = gzip.compress(data)
    if encrypt:
        if not password:
            raise ValueError("password required for encryption")
        data = _encrypt(data, password)
    last_err = None
    for _ in range(retries):
        try:
            with open(path, "wb") as f:
                f.write(data)
            if backup_dir:
                shutil.copy(path, backup_dir)
            if email_to:
                _send_email(email_to, path)
            return
        except OSError as e:
            last_err = e
    raise last_err
```

**Acceptance criteria**
- The function does exactly what the ticket asked: render the invoice and write it to `path`.
- Every unrequested option (compress, encrypt, email, watermark, retries, backup) is removed.
- You note how the genuinely-good ideas should re-enter the project, if at all.

**Hint:** read the ticket, not the code. Anything the ticket didn't ask for is scope you added on your own initiative — that's the definition of gold plating.

<details>
<summary>Solution</summary>

```python
def save_invoice(invoice, path):
    path.write_bytes(invoice.render("pdf"))
```

**Why it's better.** The requirement was two operations — render, write — and that is now exactly what the code is. Every removed option was untested surface area: a place for bugs, a thing to document, a parameter combination (`encrypt=True, password=None`) that could blow up in production for a feature nobody requested. The retry loop silently swallowed and re-raised `OSError` in a way no caller asked for. Eight parameters collapsed to two.

**What happens to the good ideas.** Encryption and retries might be genuinely valuable — but "valuable" is the team's call, not a smuggled-in diff. Each becomes a backlog item with its own ticket, acceptance criteria, and tests, prioritized against everything else. If retries turn out to be needed, they belong in the storage layer (which can apply them uniformly), not bolted onto one save function. Shipping the right small thing today beats shipping a bigger thing nobody asked for.

</details>

---

## Exercise 4 — Delete the abstraction — or keep it?

**Anti-pattern:** Speculative Generality (judgment exercise) · **Language:** Go · **Difficulty:** ★★ medium

This is the **counter-exercise**: not every interface is over-engineering. Below is a `Charger` that depends on a `PaymentGateway` interface with a single production implementation. The reflexive move is "one impl → inline it." Resist the reflex and decide correctly.

```go
type PaymentGateway interface {
	Charge(amount int, token string) (txID string, err error)
}

// the only production implementation
type StripeGateway struct{ client *stripe.Client }

func (s *StripeGateway) Charge(amount int, token string) (string, error) {
	// ... real network call to Stripe ...
}

type Charger struct {
	gw PaymentGateway
}

func NewCharger(gw PaymentGateway) *Charger { return &Charger{gw: gw} }

func (c *Charger) ChargeOrder(o Order) error {
	if o.Total <= 0 {
		return errors.New("non-positive total")
	}
	txID, err := c.gw.Charge(o.Total, o.CardToken)
	if err != nil {
		return fmt.Errorf("charge order %s: %w", o.ID, err)
	}
	o.RecordTransaction(txID)
	return nil
}
```

There is one implementation (`StripeGateway`). The `Charger` tests, however, inject a fake gateway to exercise the success path, the decline path, and the network-error path *without hitting Stripe*.

**Acceptance criteria**
- A clear keep/delete decision, justified by the reversibility and test-seam lenses from [`middle.md`](middle.md).
- If "keep," name the *present-day* reason (not a future one).
- Contrast this with Exercise 2, where the answer was "delete."

<details>
<summary>Solution</summary>

**Decision: keep the interface.** Do not inline it.

This looks structurally identical to the slug strategy in Exercise 2 — one implementation, dependency injected — but the deciding question is *"does this abstraction earn its keep **today**?"* and the answers diverge:

| | Ex. 2 `SlugStrategy` | Ex. 4 `PaymentGateway` |
|---|---|---|
| Implementations | 1 | 1 |
| Is it mocked in a test? | No | **Yes — three test paths** |
| Cost of calling the real thing in a test | Zero (pure function) | High (real money, network, non-determinism) |
| Verdict | Speculative → **delete** | Justified seam → **keep** |

The `PaymentGateway` interface is a **test double seam**, which `middle.md` lists as one of the four *justified* reasons for an abstraction (alongside published API, confirmed imminent second impl, and volatile external dependency). The seam is paying for itself *right now*: it lets the decline and network-error paths be tested deterministically and for free. There is also a second present-day justification — Stripe is a **volatile external dependency**, exactly the kind you isolate behind a thin port so a future provider swap doesn't ripple through your order logic.

If you inlined `StripeGateway` directly into `Charger`, every test of `ChargeOrder` would need a live Stripe connection (or a brittle network mock), and you couldn't simulate a decline at all. That's *under*-engineering — removing structure the problem genuinely needs.

**The lesson:** "one implementation" is not the test. *"Is the abstraction serving a real need today — a test seam, a contract, a volatile dependency?"* is the test. Delete speculation; keep justified seams.

</details>

---

## Exercise 5 — Reduce accidental complexity

**Anti-pattern:** Accidental Complexity · **Language:** Python · **Difficulty:** ★★ medium

The essential problem is one sentence: *"Group orders by customer and sum each customer's total."* Someone built a generic, configurable "aggregation pipeline framework" to do it. Strip the machinery; solve the actual problem directly.

```python
from abc import ABC, abstractmethod

class AggregationStep(ABC):
    @abstractmethod
    def apply(self, ctx: dict) -> dict: ...

class GroupByStep(AggregationStep):
    def __init__(self, key_fn): self.key_fn = key_fn
    def apply(self, ctx):
        groups = {}
        for item in ctx["data"]:
            groups.setdefault(self.key_fn(item), []).append(item)
        ctx["groups"] = groups
        return ctx

class SumStep(AggregationStep):
    def __init__(self, value_fn): self.value_fn = value_fn
    def apply(self, ctx):
        ctx["result"] = {k: sum(self.value_fn(i) for i in v)
                         for k, v in ctx["groups"].items()}
        return ctx

class Pipeline:
    def __init__(self, steps): self.steps = steps
    def run(self, data):
        ctx = {"data": data}
        for s in self.steps:
            ctx = s.apply(ctx)
        return ctx["result"]

# usage:
totals = Pipeline([
    GroupByStep(lambda o: o.customer_id),
    SumStep(lambda o: o.total),
]).run(orders)
```

**Acceptance criteria**
- The result is identical: `{customer_id: total}`.
- No `Pipeline`, no `AggregationStep`, no shared `ctx` dict.
- The solution is recognizably "group and sum," readable top to bottom.

**Hint:** the "framework" is a `for` loop wearing a costume. The standard library already has the grouping primitive.

<details>
<summary>Solution</summary>

```python
from collections import defaultdict

def sum_totals_by_customer(orders):
    totals = defaultdict(float)
    for o in orders:
        totals[o.customer_id] += o.total
    return dict(totals)

totals = sum_totals_by_customer(orders)
```

**Why it's better.** The framework added an abstract base class, two step classes, a `Pipeline` runner, and a mutable `ctx` dict threaded through everything — all to express a five-line loop. None of that machinery hides any *essential* difficulty; it is pure accidental complexity, the kind that "accrues a little at a time" (Ousterhout). The direct version reads exactly like the problem statement: walk the orders, add each total into its customer's bucket. It's also faster (no per-step dict copying, no virtual dispatch), though speed isn't the point — legibility is.

**The tell:** the `Pipeline` abstraction would only earn its keep if you had many *runtime-configured* aggregations composed from genuinely interchangeable steps. With two hard-coded steps used once, it's a generic solution to a specific problem — the signature shape of accidental complexity.

</details>

---

## Exercise 6 — Flatten the yo-yo hierarchy

**Anti-pattern:** Yo-yo Problem · **Language:** Java · **Difficulty:** ★★ medium

To answer "what does `PremiumExportJob.run()` actually do?" you have to bounce up and down four classes, each calling `super` and overriding fragments. Replace the inheritance tower with composition.

```java
abstract class Job {
    final void run() { setup(); execute(); teardown(); }
    protected void setup()    { log("setup"); }
    protected abstract void execute();
    protected void teardown() { log("teardown"); }
}

abstract class ScheduledJob extends Job {
    protected void setup() { super.setup(); acquireLock(); }
    protected void teardown() { releaseLock(); super.teardown(); }
}

class ExportJob extends ScheduledJob {
    protected void execute() { writeCsv(loadRows()); }
}

class PremiumExportJob extends ExportJob {
    protected void setup() { super.setup(); loadPremiumConfig(); }
    protected void execute() { super.execute(); attachBranding(); }
}
```

Tracing one `run()` means reading four files and mentally interleaving four `setup`/`execute`/`teardown` fragments — the fragile-base-class trap, where a tweak to `Job.setup()` silently changes every subclass.

**Acceptance criteria**
- The run sequence for a premium export is visible in **one** place.
- Cross-cutting concerns (locking, logging) are composed in, not inherited.
- Adding a new job type does not require subclassing a tower.
- Behavior (order of operations) is preserved.

**Hint:** the `run()` template is really a sequence of steps + some wrappers. Model the work as a small `Task` and the wrappers (lock, log) as decorators or explicit composition, so the order lives in one readable method.

<details>
<summary>Solution</summary>

```java
@FunctionalInterface
interface Task {
    void execute();
}

final class JobRunner {
    private final Lock lock;       // injected; a no-op lock for unscheduled jobs
    private final Logger log;

    JobRunner(Lock lock, Logger log) { this.lock = lock; this.log = log; }

    void run(Task task) {
        log.info("setup");
        lock.lock();
        try {
            task.execute();
        } finally {
            lock.unlock();
            log.info("teardown");
        }
    }
}

// A premium export is now ONE readable composition — no climbing:
Task premiumExport = () -> {
    var rows = loadRows();
    var config = loadPremiumConfig();
    writeCsv(rows);
    attachBranding(config);
};

new JobRunner(scheduleLock, logger).run(premiumExport);
```

**Why it's better.** The entire lifecycle of a premium export is readable in one place: the `JobRunner.run` wrapper (setup → lock → work → unlock → teardown) plus the `premiumExport` lambda (the actual steps). No more yo-yo — you never climb a four-class chain to assemble the behavior in your head. Locking and logging are *composed* (the runner holds a `Lock` and `Logger`), so an unscheduled job just passes a no-op lock instead of inheriting from a different base. The fragile-base-class risk is gone: changing the wrapper changes it in exactly one visible spot, not silently across every subclass. Adding a job type means writing a new `Task` lambda, not extending a hierarchy. This is *Replace Subclass with Delegate / Replace Inheritance with Delegation*.

</details>

---

## Exercise 7 — Collapse the lasagna layers

**Anti-pattern:** Lasagna Code · **Language:** Go · **Difficulty:** ★★ medium

Fetching one user traverses six layers, four of which only forward the call and rename a variable. Keep the layers that carry a real responsibility; inline the rest.

```go
type UserController struct{ svc *UserService }
func (c *UserController) Get(id int) (*User, error) { return c.svc.GetUser(id) }

type UserService struct{ mgr *UserManager }
func (s *UserService) GetUser(id int) (*User, error) { return s.mgr.FetchUser(id) }

type UserManager struct{ h *UserHandler }
func (m *UserManager) FetchUser(id int) (*User, error) { return m.h.HandleGet(id) }

type UserHandler struct{ repo *UserRepository }
func (h *UserHandler) HandleGet(id int) (*User, error) { return h.repo.Find(id) }

type UserRepository struct{ db *sql.DB }
func (r *UserRepository) Find(id int) (*User, error) {
	if id <= 0 {
		return nil, errors.New("invalid id") // a real responsibility: validation
	}
	row := r.db.QueryRow("SELECT id, email FROM users WHERE id=$1", id)
	var u User
	if err := row.Scan(&u.ID, &u.Email); err != nil {
		return nil, err
	}
	return &u, nil
}
```

`Service`, `Manager`, and `Handler` each do nothing but call the next layer with a renamed method. Only the controller (HTTP boundary) and the repository (data access + validation) carry a job.

**Acceptance criteria**
- Every pass-through layer that adds no responsibility is removed.
- The layers that remain each have a distinct, nameable job.
- The call path from controller to query is short and direct.

**Hint:** a layer earns its place only if it validates, maps representations, owns a transaction, or enforces a boundary. "Renames the argument and forwards" is not a responsibility.

<details>
<summary>Solution</summary>

```go
// The HTTP boundary — a real responsibility (request/response, status codes).
type UserController struct{ repo *UserRepository }

func (c *UserController) Get(id int) (*User, error) {
	return c.repo.Find(id)
}

// Data access + input validation — a real responsibility.
type UserRepository struct{ db *sql.DB }

func (r *UserRepository) Find(id int) (*User, error) {
	if id <= 0 {
		return nil, errors.New("invalid id")
	}
	row := r.db.QueryRow("SELECT id, email FROM users WHERE id=$1", id)
	var u User
	if err := row.Scan(&u.ID, &u.Email); err != nil {
		return nil, err
	}
	return &u, nil
}
```

**Why it's better.** Three pass-through layers (`Service`, `Manager`, `Handler`) vanished — they did nothing but forward the call and rename `Get`→`GetUser`→`FetchUser`→`HandleGet`, pure overhead to read and a ripple-point on every change. What remains are two **deep modules** (Ousterhout): a thin interface (`Get`, `Find`) over a real job (HTTP boundary, validated data access). Following a request is now two hops, not six. Crucially this is *not* "always have two layers" — if a genuine service-layer concern appears later (orchestrating a transaction across repositories, enforcing authorization), you add *that* layer because it has a responsibility, not for symmetry. Layers are justified by jobs, never by patterns.

</details>

---

## Exercise 8 — Move the soft-coded rule engine back to code

**Anti-pattern:** Soft Coding · **Language:** Python · **Difficulty:** ★★ medium

Discount logic was pushed into a JSON "rules engine" so "the business team can change it without a deploy." The business team has never edited it; engineers do, by hand-writing JSON that no type checker, test, or debugger can see into. Bring the logic back into code.

```python
RULES = [
    {"if": {"field": "tier", "op": "==", "val": "vip"},
     "and": {"field": "subtotal", "op": ">=", "val": 100},
     "then": {"discount_pct": 15}},
    {"if": {"field": "tier", "op": "==", "val": "vip"},
     "then": {"discount_pct": 10}},
    {"if": {"field": "subtotal", "op": ">=", "val": 200},
     "then": {"discount_pct": 5}},
]

def evaluate(rules, ctx):
    for rule in rules:
        if not _match(rule["if"], ctx):
            continue
        if "and" in rule and not _match(rule["and"], ctx):
            continue
        return rule["then"]["discount_pct"]
    return 0

def _match(cond, ctx):
    actual, op, val = ctx[cond["field"]], cond["op"], cond["val"]
    if op == "==": return actual == val
    if op == ">=": return actual >= val
    if op == "<=": return actual <= val
    raise ValueError(f"unknown op {op}")

discount = evaluate(RULES, {"tier": order.tier, "subtotal": order.subtotal})
```

The config has grown operators (`==`, `>=`, `and`) — a tell-tale sign you've written a worse programming language inside JSON.

**Acceptance criteria**
- The discount rules live in plain, tested Python with the identical precedence (VIP+≥100 → 15%, VIP → 10%, ≥200 → 5%, else 0%).
- No `_match`, no `op` dispatch, no rule-tree interpreter.
- The behavior is type-checked and unit-testable directly.

<details>
<summary>Solution</summary>

```python
def discount_pct(tier: str, subtotal: float) -> int:
    """Discount precedence, highest-priority first."""
    if tier == "vip" and subtotal >= 100:
        return 15
    if tier == "vip":
        return 10
    if subtotal >= 200:
        return 5
    return 0

discount = discount_pct(order.tier, order.subtotal)
```

A test reads as plainly as the rule:

```python
def test_discount():
    assert discount_pct("vip", 150) == 15
    assert discount_pct("vip", 50)  == 10
    assert discount_pct("std", 250) == 5
    assert discount_pct("std", 50)  == 0
```

**Why it's better.** The JSON interpreter and its `_match`/`op` dispatch are gone — that machinery existed only to re-implement `if`, `and`, and `>=`, which Python already has, with type checking, a debugger, and tests the JSON could never get. The rules now read as exactly what they are, in priority order, and a stray typo (`">="` → `"=>"`) becomes a syntax error at edit time instead of a `ValueError` in production. A change still goes through code review and a deploy — which for a *business rule* is a feature, not a bug: rules deserve tests and review.

**The legitimate version, if it were truly needed.** Soft-coding is justified *only* if non-developers genuinely edit rules frequently — and even then the answer is a **narrow, validated, tested** feature (a constrained schema with a real validator and a test suite over the interpreter), never a reflexive `if/then` JSON tree. Verify the "business team will edit it" assumption *before* building the machinery; here it was never true.

</details>

---

## Exercise 9 — Right-size the premature cache

**Anti-pattern:** Premature Optimization + Accidental Complexity · **Language:** Go · **Difficulty:** ★★★ hard

A config lookup was wrapped in a hand-rolled, mutex-guarded, TTL-expiring cache "because config reads are hot." The underlying read is a single in-memory map access. The cache adds locking, a goroutine-unsafe expiry sweep, and a subtle staleness bug — to optimize something that was already O(1) in memory.

```go
type cachedConfig struct {
	mu      sync.Mutex
	entries map[string]cacheEntry
	source  map[string]string // the actual config, already in memory
	ttl     time.Duration
}

type cacheEntry struct {
	value   string
	expires time.Time
}

func (c *cachedConfig) Get(key string) string {
	c.mu.Lock()
	defer c.mu.Unlock()
	if e, ok := c.entries[key]; ok && time.Now().Before(e.expires) {
		return e.value
	}
	v := c.source[key] // <-- the "expensive" operation: a map read
	c.entries[key] = cacheEntry{value: v, expires: time.Now().Add(c.ttl)}
	return v
}
```

The "source" is `map[string]string` already resident in memory. Caching a map read behind a mutex makes it *slower* (lock contention) and *buggier* (TTL means a config update may not be seen for `ttl`).

**Acceptance criteria**
- The pointless cache layer is removed.
- Reads are still safe for concurrent use if the config can be replaced at runtime.
- You state how you'd confirm the simpler version is no slower (it will be faster).

**Hint:** you can't cache your way to faster-than-a-map-read. If concurrent *replacement* of the whole config is the only mutation, an `atomic.Pointer` to an immutable map beats a per-key mutex.

<details>
<summary>Solution</summary>

If the config is never mutated after load, it's just a map:

```go
type Config struct {
	values map[string]string // immutable after construction
}

func (c *Config) Get(key string) string { return c.values[key] }
```

If the whole config can be hot-swapped at runtime (the only realistic reason for any synchronization), publish it atomically — no per-read lock, no TTL, no staleness:

```go
type Config struct {
	current atomic.Pointer[map[string]string]
}

func NewConfig(initial map[string]string) *Config {
	c := &Config{}
	c.current.Store(&initial)
	return c
}

func (c *Config) Get(key string) string {
	return (*c.current.Load())[key]
}

// Atomic swap of the entire config on reload — readers never block, never see a torn map.
func (c *Config) Replace(next map[string]string) {
	c.current.Store(&next)
}
```

**Why it's better.** The cache was negative-value engineering: it added a mutex (serializing every read), a TTL (introducing staleness the original didn't have), and ~20 lines of accidental complexity — all to "speed up" a map lookup that was already the fastest thing in the program. The immutable/`atomic.Pointer` version is lock-free on the read path, always fresh, and correct under concurrent reload. A config update is visible immediately, not after `ttl`.

**Confirming it's faster, not just simpler.** Benchmark both under read contention:

```go
func BenchmarkConfigGet(b *testing.B) {
	cfg := NewConfig(map[string]string{"k": "v"})
	b.RunParallel(func(pb *testing.PB) {
		for pb.Next() {
			_ = cfg.Get("k")
		}
	})
}
```

Run with `-cpu=1,2,4,8`. The mutex version's throughput *collapses* as cores increase (lock contention); the `atomic.Pointer` version scales flat. This is the rare case where removing the "optimization" is itself the optimization — and the benchmark proves it rather than asserting it.

</details>

---

## Exercise 10 — Replace the bit-twiddling with a benchmark

**Anti-pattern:** Premature Optimization · **Language:** Go · **Difficulty:** ★★★ hard

A `isPowerOfTwo`-style hot-path check was written with an obscure bit trick *and* a lookup table *and* a comment claiming it's "3x faster." There is no benchmark backing the claim. Your job is twofold: restore the clear version, and write the benchmark that decides the matter on evidence instead of folklore.

```go
// "Optimized" rounding-up to the next power of two. Claims 3x but never measured.
var dimReturnForBits = [...]uint{1, 2, 4, 8, 16, 32, 64, 128, 256, 512}

func nextPow2(n uint32) uint32 {
	if n < 10 {
		return uint32(dimReturnForBits[bits.Len32(n)]) // table for small n
	}
	n--
	n |= n >> 1
	n |= n >> 2
	n |= n >> 4
	n |= n >> 8
	n |= n >> 16
	n++
	return n
}
```

The lookup-table branch for `n < 10` is not even correct (it conflates "bit length" with "next power of two": `nextPow2(3)` should be `4`, but `dimReturnForBits[bits.Len32(3)] = dimReturnForBits[2] = 4` only works by accident, and `nextPow2(0)` returns `1` while the bit-trick path would return `0`). The cleverness has *hidden a bug*.

**Acceptance criteria**
- One clear, correct implementation that handles edge cases (`0`, `1`, exact powers).
- A benchmark comparing it against the original, so the "3x" claim is tested not trusted.
- A statement of what you'd do if the benchmark *did* show a real, needed win.

**Hint:** Go's standard library already has this: `bits.Len`. The clear version is one expression. Then let `go test -bench` arbitrate.

<details>
<summary>Solution</summary>

```go
import "math/bits"

// nextPow2 returns the smallest power of two >= n. nextPow2(0) == 1.
func nextPow2(n uint32) uint32 {
	if n <= 1 {
		return 1
	}
	return 1 << bits.Len32(n-1)
}
```

The benchmark that settles the argument:

```go
func BenchmarkNextPow2(b *testing.B) {
	inputs := []uint32{0, 1, 3, 7, 16, 17, 1000, 1 << 20}
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_ = nextPow2(inputs[i%len(inputs)])
	}
}
```

Run `go test -bench=NextPow2 -benchmem` against both implementations and compare with `benchstat old.txt new.txt`.

**Why it's better.** `1 << bits.Len32(n-1)` is one line, provably correct (it compiles to a single `LZCNT`/`BSR` instruction plus a shift — the standard library already *is* the optimization), and it fixes the edge-case bug the table branch was hiding. The original mixed two strategies, hand-maintained a magic table, and shipped a latent off-by-one — all in service of an unverified "3x."

**If the benchmark showed a real win.** Suppose this genuinely sat in a profiled hot loop and `benchstat` showed the bit-twiddle version meaningfully faster on representative data. *Then* the optimization stops being premature — but you'd keep the clear version as the reference, gate the fast version behind a benchmark that proves the delta, add a property-based test asserting `fast(n) == clear(n)` for all `n` (so the cleverness can never silently drift from correctness again), and document *why* with the benchmark numbers in the comment. Optimization earns its complexity only with a measurement and a guardrail; here it had neither.

</details>

---

## Exercise 11 — Kill the speculative plugin framework

**Anti-pattern:** Speculative Generality + Gold Plating · **Language:** Java · **Difficulty:** ★★★ hard

A team needed to send a Slack message when a build fails. They built a generic, reflection-driven "notification plugin platform" with a registry, a lifecycle interface, priority ordering, and dynamic discovery — to support the one notifier that exists. Collapse the platform to the requirement, and separate what (if anything) is worth keeping.

```java
interface NotificationPlugin {
    String id();
    int priority();
    void onRegister(PluginContext ctx);
    boolean supports(EventType type);
    void handle(Event event);
    void onShutdown();
}

class PluginRegistry {
    private final List<NotificationPlugin> plugins = new ArrayList<>();

    void discoverAndRegister() {
        // reflection scan of the classpath for @Plugin-annotated classes
        for (Class<?> c : ClasspathScanner.scan("@Plugin")) {
            try {
                NotificationPlugin p = (NotificationPlugin) c.getDeclaredConstructor().newInstance();
                p.onRegister(new PluginContext(this));
                plugins.add(p);
            } catch (ReflectiveOperationException e) {
                throw new RuntimeException(e);
            }
        }
        plugins.sort(Comparator.comparingInt(NotificationPlugin::priority));
    }

    void dispatch(Event event) {
        for (NotificationPlugin p : plugins) {
            if (p.supports(event.type())) p.handle(event);
        }
    }
}

@Plugin
class SlackPlugin implements NotificationPlugin {
    public String id() { return "slack"; }
    public int priority() { return 0; }
    public void onRegister(PluginContext ctx) {}
    public boolean supports(EventType type) { return type == EventType.BUILD_FAILED; }
    public void handle(Event event) { SlackClient.post("#builds", event.message()); }
    public void onShutdown() {}
}

// usage:
PluginRegistry reg = new PluginRegistry();
reg.discoverAndRegister();
reg.dispatch(new Event(EventType.BUILD_FAILED, "build #42 failed"));
```

The requirement is one sentence: *post to Slack when a build fails.* The platform delivers reflection, a lifecycle, priority sorting, and dynamic discovery — none of it requested, all of it now a maintenance burden and a security surface (classpath scanning).

**Acceptance criteria**
- The plugin interface, registry, reflection scanning, and lifecycle are removed.
- A build failure still posts to Slack.
- You note the *real* condition under which a registry would become justified — and what its minimal form would be.

<details>
<summary>Solution</summary>

```java
final class BuildNotifier {
    void onBuildFailed(String message) {
        SlackClient.post("#builds", message);
    }
}

// usage:
new BuildNotifier().onBuildFailed("build #42 failed");
```

**Why it's better.** A six-method interface, a reflection-scanning registry, priority sorting, and a plugin lifecycle — roughly 60 lines of framework — collapsed into a three-line class that does precisely what was asked. The reflective classpath scan is gone, which also removes a real cost: it was slow at startup, opaque to "find usages," and an attack surface (loading arbitrary annotated classes). Everything that platform provided (multiple notifiers, ordering, discovery) was speculative — there was one notifier, one event type, one channel.

**When a registry *would* be justified, and its minimal form.** The honest trigger is the **Rule of Three**: when you actually have a third real notifier (Slack, email, PagerDuty) being selected at runtime, a small explicit registry — *not* reflection — earns its place:

```java
// Justified only once 3+ real notifiers exist and dispatch is dynamic.
Map<EventType, List<Consumer<String>>> handlers = Map.of(
    EventType.BUILD_FAILED, List.of(slack::post, pagerDuty::page)
);
handlers.getOrDefault(event.type(), List.of())
        .forEach(h -> h.accept(event.message()));
```

Even then it's an explicit map you can read, not a reflection framework. The point isn't "registries are bad" — it's that you build the registry *against three real cases you can see*, designed from reality, not as a speculative platform for an imagined plugin ecosystem that never materializes. Gold plating (the lifecycle, priority, discovery nobody asked for) bred the speculative generality (the plugin interface); removing the gold plate dissolves most of the speculation with it.

</details>

---

## Exercise 12 — Mini-project: simplify the `NotificationPlatform`

**Anti-pattern:** all eight, in one small realistic module · **Language:** Python · **Difficulty:** ★★★★ project

Below is a compact module whose job is one sentence: *send a welcome email to a new user.* It manages to combine **every** over-engineering anti-pattern at once. Simplify it to the requirement, in steps — do not try to fix it in one edit.

```python
import json, time
from abc import ABC, abstractmethod

# --- Soft Coding: behavior encoded as a JSON rule tree ---
ROUTING_RULES = """
[
  {"if": {"channel": "email", "enabled": true}, "then": {"use": "SmtpSender"}},
  {"if": {"channel": "sms", "enabled": false}, "then": {"use": "TwilioSender"}}
]
"""

# --- Speculative Generality: a strategy interface with one real impl ---
class SenderStrategy(ABC):
    @abstractmethod
    def send(self, to, body): ...

class SmtpSender(SenderStrategy):
    def send(self, to, body):
        # ... real SMTP ...
        ...

# --- Yo-yo: deep inheritance to assemble a message ---
class BaseMessage:
    def render(self): return self._body()
    def _body(self): return ""

class GreetingMessage(BaseMessage):
    def _body(self): return "Welcome"

class PersonalizedMessage(GreetingMessage):
    def __init__(self, name): self.name = name
    def _body(self): return super()._body() + f", {self.name}"

class BrandedPersonalizedMessage(PersonalizedMessage):
    def _body(self): return super()._body() + "! — The Team"

# --- Lasagna + Accidental Complexity: forwarding layers + a generic dispatcher ---
class NotificationController:
    def __init__(self, svc): self.svc = svc
    def notify(self, user): return self.svc.process(user)

class NotificationService:
    def __init__(self, mgr): self.mgr = mgr
    def process(self, user): return self.mgr.handle(user)

class NotificationManager:
    def __init__(self, sender): self.sender = sender
    def handle(self, user):
        rules = json.loads(ROUTING_RULES)
        # Premature Optimization: a "fast" hand-built index nobody profiled
        idx = {r["if"]["channel"]: r for r in rules}
        rule = idx.get("email")
        if rule and rule["if"]["enabled"]:
            # Gold Plating: retries + timing nobody asked for
            for attempt in range(3):
                start = time.perf_counter_ns()
                msg = BrandedPersonalizedMessage(user.name).render()
                self.sender.send(user.email, msg)
                _ = time.perf_counter_ns() - start  # measured, never used
                return
```

(And the team spent the standup arguing whether the channel key should be `"email"` or `"EMAIL"` — **Bikeshedding** — while none of the above got questioned.)

**Acceptance criteria**
- **Soft Coding:** the JSON routing tree is gone; "send email" is in code.
- **Speculative Generality:** the one-impl `SenderStrategy` is inlined.
- **Yo-yo:** the four-class message hierarchy collapses to a function.
- **Lasagna:** the controller→service→manager forwarding chain collapses.
- **Accidental Complexity / Premature Optimization / Gold Plating:** the dispatcher, the unprofiled index, and the unrequested retries/timing are removed.
- The result sends a welcome email to a new user — and nothing more.

**Hint:** start from the one-sentence requirement and ask of every class, layer, and config blob: *what real difficulty does this hide?* If the answer is "none," remove it. Work in small green steps (collapse the message hierarchy, inline the sender, drop the layers, delete the JSON), keeping behavior intact after each.

<details>
<summary>Solution</summary>

```python
def welcome_body(name: str) -> str:
    return f"Welcome, {name}! — The Team"

def send_welcome_email(user, smtp) -> None:
    smtp.send(user.email, welcome_body(user.name))
```

That is the whole module. Wiring at the call site:

```python
send_welcome_email(new_user, smtp_client)
```

**What happened to each of the eight:**

- **Soft Coding →** the `ROUTING_RULES` JSON and its `json.loads`/index lookup are deleted. "Send the welcome via email" is a plain function call; there is no rule tree to interpret. If a second channel is ever truly needed, it's a code branch with tests, not JSON.
- **Speculative Generality →** `SenderStrategy` (one impl, never mocked here) is inlined; `smtp` is passed in directly. (If a test needed to fake it, an injected object still suffices — no abstract base class required, and Python's duck typing means even that is implicit.)
- **Yo-yo →** the four-class message tower (`BaseMessage → GreetingMessage → PersonalizedMessage → BrandedPersonalizedMessage`) collapses to one `welcome_body` function whose entire output is visible in one line — no `super()` climbing.
- **Lasagna →** `Controller → Service → Manager` (three pass-through layers) collapse; none added validation, mapping, a transaction, or a boundary.
- **Accidental Complexity →** the generic dispatcher disappears; the essential problem (format a string, send it) is expressed directly.
- **Premature Optimization →** the hand-built `idx` over a two-element list — never profiled, optimizing a linear scan of two items — is gone.
- **Gold Plating →** the retry loop and `perf_counter_ns` timing nobody requested (and never used) are removed. If retries are genuinely needed, they belong in the SMTP client and arrive via their own ticket.
- **Bikeshedding →** moot. There is no channel key to argue about because there is no routing config; the standup energy goes to something that matters.

**Why it's better.** ~70 lines of framework, hierarchy, config, and ceremony became two functions that do exactly the one thing the requirement asked. You can test `welcome_body("Sam")` with no SMTP and `send_welcome_email` with a fake `smtp` object. Every removed piece was solving a problem the project did not have — multiple channels, swappable senders, message variants, layered architecture, fast lookups, retries. **YAGNI + KISS**, applied eight times in one module. As in the [Bad Structure mini-project](../01-bad-structure/tasks.md), the work was a sequence of small green simplifications, never a big-bang rewrite.

</details>

---

## Exercise 13 — Judgment: which design is right-sized?

**Anti-pattern:** meta (over- vs. under-engineering, reversibility lens) · **Difficulty:** ★★★ hard · *(judgment exercise — no single code answer)*

You're reviewing four design proposals for the same small feature: *store a user's preferred theme ("light" or "dark") and read it back.* For each, decide whether it is **over-engineered**, **under-engineered**, or **appropriately engineered**, and justify your call using the **reversibility lens** from [`middle.md`](middle.md) (cheap-to-change + no present need → keep simple; expensive/irreversible + clearly coming → invest now).

> **A.** A `ThemeStrategyFactory` producing `ThemeProvider` implementations behind an interface, configured by a YAML file with a rule engine, "so we can support per-tenant theming, A/B tests, and future themes."

> **B.** A single column `users.theme TEXT` plus `getTheme(userId)` / `setTheme(userId, theme)`, with `theme` validated against `{"light","dark"}` in code.

> **C.** Storing the theme in a public REST response field `GET /users/{id}` as `"theme": "dark"`, with no thought given to how the field is named or whether it should be nested — shipped as the first thing that worked.

> **D.** A free-text `theme` column with no validation and no enum, "we'll figure out the allowed values later," writing whatever the client sends straight to the database.

**Acceptance criteria**
- A verdict per design with a reversibility-based justification.
- Identify which over-engineering anti-patterns A exhibits and which under-engineering risk D carries.
- Note why C is subtle (the *content* may be fine but one aspect is expensive to change).

<details>
<summary>Solution</summary>

**A — Over-engineered.** A factory, an interface, and a YAML *rule engine* to store one of two string values. Present need: none (no per-tenant theming, no A/B test exists today). Reversibility: storing a string is *trivially* cheap to change later — if per-tenant theming ever becomes real, you migrate then, against the actual requirement. So this is **Speculative Generality** (interface + factory for one case) layered with **Soft Coding** (rules in YAML) and a dash of **Gold Plating** (A/B testing nobody asked for). The reversibility lens is decisive: no present need + cheap to change → do the simple thing.

**B — Appropriately engineered.** A column, two functions, validation against the two legal values in code. It solves exactly today's problem, is cheap to extend (adding `"sepia"` is a one-line enum/constant change plus a migration), and keeps the validation where it's testable. This is the right altitude — neither speculative flexibility nor a missing guard.

**C — Subtle: the value is fine, but one decision is *not* cheaply reversible.** Storing the theme is fine; the trap is the **public REST API field**. `middle.md` calls out that *most* code is cheap to change (defer it), but **published API surfaces, data schemas, and wire formats are expensive/irreversible** — external consumers depend on them. Shipping `"theme": "dark"` as "the first thing that worked" without deciding the field name/shape is **under-engineering the one part that matters**. The fix isn't more abstraction; it's *thinking once* about the contract (name, nesting, nullability) before it's public, because changing it later breaks clients. Right-sizing means investing effort exactly where reversibility is low — and C skipped it on the only low-reversibility part of the feature.

**D — Under-engineered.** A free-text column with no validation writes whatever the client sends. Present, clearly-foreseeable need: the set of legal themes is known *now* (`light`/`dark`), and bad data is expensive to clean up after the fact (a data-quality problem you can see coming). The reversibility lens cuts the other way here: it's *cheap now* to add the validation/enum and *expensive later* to retrofit constraints onto dirty production data. Skipping the guard isn't YAGNI — it's ignoring a future you can clearly see, which is the definition of under-engineering.

**The unifying lesson.** Over- and under-engineering are symmetric failures around the same axis. The master variable is **reversibility**: A over-invested in cheap-to-change internals; D under-invested in a cheap-now/expensive-later guard; C under-invested in the one genuinely irreversible decision (the public contract) while the rest was fine. Only B matched effort to reversibility. "Simple" never means "skip the validation or the API design that's expensive to change" — it means "don't build flexibility for a future you're only guessing at."

</details>

---

## Exercise 14 — Defuse the bikeshed

**Anti-pattern:** Bikeshedding · **Difficulty:** ★★ medium · *(process exercise)*

A pull request that fixes a genuine race condition in a payment retry has attracted **41 comments**: 35 about tab-vs-space, whether the variable should be `i` or `idx`, and whether a one-line comment is "necessary"; **6** about the actual locking. The PR has been open nine days. As the senior reviewer, defuse the bikeshed and redirect attention — and prevent the recurrence.

**Acceptance criteria**
- Concrete, in-the-moment moves to end the trivial debate without bruising the team.
- A structural fix so this *class* of debate cannot recur.
- A way to redirect scrutiny to the part that carries real risk (the concurrency).

<details>
<summary>Solution</summary>

**In the moment — end the trivial debate.**
- **Defer style to a tool, immediately.** "Let's not hand-debate formatting — I'm adding the formatter/linter config; whatever it outputs is the convention. Resolving all style threads." A `gofmt`/`Prettier`/`Black` + lint config makes tabs-vs-spaces and `i`-vs-`idx` *not a human decision* anymore.
- **Name it gently.** "This feels like bikeshedding — the formatting is auto-fixable, but the retry locking is the part with real blast radius. Can we move the energy there?" Naming it without blame gives everyone permission to stop.
- **Time-box and decide.** For any genuinely subjective non-automatable nit, pick one and move on: "Going with `idx`, not worth more cycles."

**Redirect to the real risk.**
- **Ask the high-leverage questions on the locking:** "What happens if `retry()` is called concurrently for the same payment — can it double-charge? Is the lock held across the network call? What's the behavior on lock-acquire timeout?" These are the comments that should number 35, not 6.
- **Match scrutiny to blast radius.** A payment race can move money twice; a variable name cannot. Reviewer attention is finite — spend it proportional to risk.

**Prevent recurrence (the structural fix).**
- **Automate trivia out of existence.** Land formatter + linter in CI so style is enforced by the build, leaving nothing to argue. This is the single highest-value move — it removes the *accessible* problem permanently.
- **Write a one-line review norm:** "Formatting is the linter's job; reviews are for correctness, security, and design." Put it in `CONTRIBUTING.md`.
- **Set conventions ahead of time** (style guide, lint config, ADRs for the big calls) so trivial choices are pre-decided and only consequential ones reach a human.

**Why this works.** Bikeshedding thrives on *accessible* problems — everyone has an opinion on variable names; few can reason about a lock held across a network boundary. The cure is to **remove the accessible problems with automation** and consciously redirect the freed attention to the inaccessible, important ones. The nine-day-old PR shipping a race condition is the real cost: trivia didn't just waste time, it *starved the risky part of review*.

</details>

---

## Summary

- These exercises move you from *recognizing* over-engineering to *removing* it: un-optimize clever code, inline speculative interfaces, trim gold-plated options, flatten yo-yo hierarchies, collapse lasagna layers, drag soft-coded logic back to code, delete accidental machinery, and right-size premature caches. **The dominant move is removal** — less code that does the same job.
- **Simplification must preserve behavior, and on hot paths that means measuring.** Exercises 1, 9, and 10 close the loop with a benchmark: the discipline that justifies an optimization (a measurement) is the same discipline that justifies *removing* one. Removal is not automatically safe just because it's removal.
- **Not every abstraction is over-engineering.** Exercise 4 is the deliberate counter-case — a one-implementation interface that is a *justified test seam and a volatile-dependency port*, where the correct answer is **keep it**. "One implementation" is never the test; "does it serve a real need today?" is.
- **The master variable is reversibility** (Exercise 13). Cheap-to-change + no present need → keep it simple (YAGNI). Expensive/irreversible + clearly coming → invest now, or you've under-engineered the API/schema/wire format. Over- and under-engineering are symmetric failures around this one axis.
- **Simplify in small green steps.** The mini-project (Exercise 12) is a sequence — collapse the hierarchy, inline the sender, drop the layers, delete the config — never a big-bang rewrite, exactly the discipline from [`middle.md`](middle.md).
- The eight anti-patterns travel together (gold plating breeds speculative generality; soft coding, lasagna, and premature optimization all feed accidental complexity), so a real module (Exercise 12) shows several at once. Remove the one in front of you and the gravity pulling in the others weakens.

---

## Related Topics

- [`junior.md`](junior.md) — the eight patterns and how to recognize them on sight; YAGNI and KISS.
- [`middle.md`](middle.md) — the reversibility lens, the Rule of Three, justified seams, and over- vs. under-engineering.
- [find-bug.md](find-bug.md) — spot-the-anti-pattern snippets (critical reading practice).
- [optimize.md](optimize.md) — more over-built implementations to simplify.
- [interview.md](interview.md) — Q&A across all levels for job prep.
- [Bad Structure → Exercises](../01-bad-structure/tasks.md) — the sibling category; Lasagna is the inverse of Spaghetti, Boat Anchor neighbors Speculative Generality.
- [Bad Shortcuts → middle](../02-bad-shortcuts/middle.md) — the Rule of Three and the wrong-abstraction trap; Soft Coding as the over-correction of Hard Coding.
- [Refactoring → Techniques](../../../refactoring/02-refactoring-techniques/README.md) — Inline Class, Remove Speculative Generality, Collapse Hierarchy, Replace Subclass with Delegate.
- [Clean Code → Classes](../../../clean-code/09-classes/README.md) — composition over inheritance; deep vs. shallow modules.
</content>
</invoke>
