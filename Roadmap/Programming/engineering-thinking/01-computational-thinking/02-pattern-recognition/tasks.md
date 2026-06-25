> Practice the *recognition* skill, not the solving. For each task: **name the pattern/class** the problem belongs to, **state the signal** that triggered the match, and — where asked — **name the distinguishing check** that rules out look-alikes or **flag a false pattern**. Don't write full solutions unless a task explicitly asks for code. Constraints: justify every match by pointing at a concrete signal in the problem (no "it feels like X"); for any pattern you propose, state its required precondition; and for at least three tasks, deliberately argue *why a tempting pattern does **not** fit.* Suggested time: 8–12 minutes per task. Self-check answers are at the bottom — try each before reading.

---

## Task 1 — Classify five problems by underlying pattern

For each, name the algorithmic pattern and the *one phrase* in the statement that signals it:

1. "Return the maximum sum of any 4 consecutive elements in an array."
2. "Given a sorted array, find two numbers that sum to a target."
3. "Find the shortest number of moves for a knight to reach a square on an empty board."
4. "List all valid combinations of `n` pairs of parentheses."
5. "Given coins of fixed denominations, count the ways to make amount `N`."

Write pattern + signal for each. Then note: which two share a *similar* signal but resolve to *different* patterns, and why?

## Task 2 — Map a messy ticket to a known class

Strip the domain nouns and name the underlying problem class for each ticket. Then name one known solution for that class.

1. "After a user changes their email, the old email still appears on the dashboard for a few minutes."
2. "Our nightly export times out when more than 40 customers schedule it at the same hour."
3. "Two admin tabs editing the same record silently overwrite each other."
4. "We call the pricing API once per line item; a 200-item cart makes 200 calls."

For each, write: *class* → *signal after removing the domain nouns* → *one standard solution.*

## Task 3 — Spot the false pattern (superstition vs. real pattern)

Each statement is a "rule" a team believes. For each, decide **real pattern** or **superstition**, and justify using mechanism / case-count / falsifiability.

1. "We never deploy on Fridays."
2. "Code that has no tests has more bugs in production."
3. "Restarting the payment service twice always fixes the timeout."
4. "We add a `try/catch` around the flaky call and it stops failing."
5. "PRs over 400 lines get reviewed less carefully, so we cap PR size."

For each: verdict + the specific check that decided it.

## Task 4 — Distinguish look-alike performance signatures

A service is slow. For each observed signature, name the likely class and the **cheapest distinguishing check** that confirms it versus a named look-alike whose fix is *opposite*.

1. "p50 is fine; p99 is 30× p50."
2. "As we add traffic, throughput stops rising and latency climbs."
3. "Memory grows steadily for hours, then the process is killed."
4. "First request after each deploy is slow; the rest are fast."

For each: class → distinguishing check → the look-alike it must be separated from.

## Task 5 — Detect the anti-pattern in code

```python
class OrderManager:
    def __init__(self, db, mailer, pdf, tax_api, audit, cache, ...):
        self.db = db; self.mailer = mailer; self.pdf = pdf
        self.tax_api = tax_api; self.audit = audit; self.cache = cache
    def create_order(self, ...): ...
    def email_receipt(self, ...): ...
    def render_invoice_pdf(self, ...): ...
    def calculate_tax(self, ...): ...
    def write_audit_log(self, ...): ...
    def refresh_cache(self, ...): ...
    def export_to_warehouse(self, ...): ...
    # ...22 more methods
```

Name the anti-pattern, state its signature, name the failed computational-thinking pillar it represents, and name the refactoring direction. Then: name a *second* anti-pattern that this code likely also harbors and why.

## Task 6 — Match the bug to its signature

For each symptom, name the bug *class* and the single observation that would confirm it:

1. "Code works in tests and locally; fails intermittently only in production under load."
2. "`IndexError` thrown only when the list has exactly one element."
3. "Errors began at 14:32; the deploy log shows a release at 14:32."
4. "Latency was fine for weeks, then degraded gradually as the table grew."

## Task 7 — Recognize the architectural pattern (and its required signal)

For each scenario, name the architectural pattern that fits, and the **precondition** that must hold for it to be the right choice (so you'd reject it if the precondition were absent):

1. "Orders are produced bursty; the fulfillment system processes them at a steady rate."
2. "A read-heavy product catalog where the source of truth is a slow upstream service."
3. "Migrating a legacy monolith to a new system without a big-bang rewrite."
4. "Multiple services need to react to 'order placed' without the order service knowing who they are."

## Task 8 — Catch the golden hammer

Each is a real design proposal. For each, identify whether it's a likely **golden hammer**, name the *missing signal* that should have been checked, and state the "boring/null pattern" alternative.

1. "Let's put a message queue between the web layer and the database for all writes."
2. "Every entity in the admin tool should be its own microservice."
3. "We'll use a graph database because users have followers."
4. "Wrap all configuration in a rules engine so non-engineers can change behavior."

## Task 9 — Decide between two competing patterns by forces

Each problem matches two valid patterns that prescribe different solutions. Name both, name the **force** that should decide, and pick one for the given context.

1. "Multi-step order workflow." Patterns: orchestration vs. choreography. Context: a small team that needs end-to-end visibility for debugging.
2. "Updating a frequently-read, rarely-written config." Patterns: cache-aside vs. write-through. Context: staleness up to 60s is acceptable; writes are rare.
3. "Concurrent edits to the same row." Patterns: pessimistic lock vs. optimistic concurrency. Context: conflicts are very rare.

## Task 10 — Recognize the *expired* pattern

Each is a decision that was once correct. Name the **forces** that originally justified it, and describe the change that would make it the *wrong* choice today (i.e., when it has expired).

1. "We hand-rolled our own JSON parser."
2. "Everything lives in one monolith."
3. "We cache every database read aggressively."
4. "We fully normalize all tables to third normal form."

## Task 11 — Recognition → abstraction (the rule of three)

Below are three call-sites. Decide whether they justify abstracting a shared helper, and if so, name the helper and the *exact* shared shape. If they don't, say why forcing an abstraction would be wrong.

```python
# A
for attempt in range(3):
    try: return charge(card); 
    except Transient: sleep(2**attempt)

# B
for attempt in range(3):
    try: return send_email(msg)
    except Transient: sleep(2**attempt)

# C  -- note the difference
try: return read_config()
except Missing: return DEFAULT_CONFIG
```

Which subset is a real pattern? What's the shared shape, and what would you name it? Why is C a *false* member of the group?

## Task 12 — Build a pattern card

Pick one pattern you use often (e.g., sliding window, cache-aside, circuit breaker). Write a one-page **pattern card** with these fields, to add to your personal library: **Name · Signal (what triggers recognition) · Required precondition · Standard solution · Context where it expires · A look-alike it's confused with · One real time you over- or under-applied it.** The goal is to externalize a chunk so it's reviewable and teachable.

---

## Self-check answers (try first)

**T1.** (1) sliding window — "consecutive elements". (2) two pointers — "sorted array, find two that sum". (3) BFS — "shortest moves, unweighted". (4) backtracking — "list all valid combinations". (5) DP — "count ways, fixed denominations, overlapping subproblems". Shared-signal pair: (4) and (5) both involve "combinations/ways," but (4) needs *every concrete arrangement* (enumerate → backtracking) while (5) needs only a *count* with overlapping subproblems (→ DP). The distinguishing signal is *enumerate-all* vs. *count-with-overlap.*

**T2.** (1) cache invalidation → "stale data after a write" → TTL/write-through/explicit eviction. (2) producer-consumer / backpressure → "demand spikes past steady processing rate" → queue + worker pool / rate limit. (3) concurrent write conflict → "two writers, last-write-wins" → optimistic concurrency (version check) or locking. (4) N+1 → "one call per item in a loop" → batch the call / cache.

**T3.** (1) Mostly a real pattern *with a real mechanism* (fewer people to fix weekend breakage) — but the rule, not the "Friday is cursed" framing, is what's real; verify via deploy-failure data. (2) Real — strong mechanism (untested paths) and supported by broad evidence; falsifiable and survives counting. (3) Superstition — no mechanism; "always" from a handful of cases; likely masking a real bug. (4) Superstition / dangerous — `try/catch` *hides* failures rather than fixing them; the error didn't stop, you stopped *seeing* it. (5) Real — mechanism (reviewer fatigue), measurable, falsifiable.

**T4.** (1) tail latency → look at the *distribution*/per-host breakdown; separate from "systemic slowness" (which would move p50 too). (2) contention → check if throughput *falls* as load rises; separate from **capacity** (where adding machines helps — here it hurts). (3) leak → check whether memory is *bounded*; separate from a large-but-bounded working set. (4) cold start / warm-up → check if it's per-deploy vs. per-request; separate from a genuine first-request-only data dependency.

**T5.** God object — signature: one class with many unrelated responsibilities and a huge constructor/method count. Failed pillar: **decomposition.** Refactor: split by responsibility (extract Mailer, InvoiceRenderer, TaxCalculator…), inject collaborators. Second likely anti-pattern: it probably also shows **feature envy / tight coupling** (it reaches into six subsystems), and its constructor signals an over-stuffed dependency list begging for separation.

**T6.** (1) concurrency / shared-state race — confirm with a stress/concurrency repro or a thread-sanitizer. (2) off-by-one / boundary — confirm by inspecting the loop bound at size 1. (3) bad deploy — confirm by rolling back and watching errors stop. (4) algorithmic complexity (O(n²) / missing index) — confirm via query plan / profiling against data size.

**T7.** (1) producer-consumer (queue) — precondition: producer and consumer rates genuinely differ *and* async is acceptable. (2) cache-aside / read replica — precondition: reads ≫ writes *and* staleness within the TTL is tolerable. (3) strangler fig — precondition: you can route traffic incrementally and run old+new side by side. (4) pub/sub — precondition: publisher should *not* need to know subscribers, and eventual delivery is acceptable.

**T8.** (1) Golden hammer — missing signal: do writes actually need async/buffering, or is sync fine? Null pattern: write straight to the DB. (2) Golden hammer — missing signal: independent scaling/deploy need and team to own ops; null pattern: a modular monolith. (3) Golden hammer — missing signal: are the queries actually graph-shaped (deep traversals), or just one foreign key? Null pattern: a relational table with an index. (4) Golden hammer (inner-platform risk) — missing signal: do non-engineers really change this often enough to justify a DSL? Null pattern: a config flag.

**T9.** (1) Force: need for central visibility/control vs. team autonomy → orchestration wins (small team, debuggability). (2) Force: staleness tolerance vs. write cost → cache-aside (staleness OK, writes rare). (3) Force: contention level → optimistic concurrency (conflicts rare; avoid lock overhead).

**T10.** (1) Justified when no good library existed / special format; expired once a battle-tested parser exists — hand-rolled is now a liability. (2) Justified for a small team with unknown boundaries; expired when the org grows and deploy contention dominates. (3) Justified when the DB was the bottleneck; expired once the DB is fast/cheap and the cache becomes the main source of staleness bugs. (4) Justified when storage was scarce and writes dominated; expired in a read-heavy, cheap-storage world → denormalize.

**T11.** A and B are a real pattern — shared shape: *retry a transient-failing operation up to N times with exponential backoff.* Name it `retry_with_backoff(op, retries, base)`. C is a **false member**: it's a *fallback-to-default on a non-transient "missing" condition*, not a retry — no loop, no backoff, different trigger. Folding C in would force the abstraction to grow a flag and corrupt the chunk; abstract A+B only.

**T12.** No single answer — the deliverable is a reusable card; grade yourself on whether the *signal* and *expiry context* are concrete enough that a teammate could apply and reject the pattern correctly.

---

### Related
[Decomposition](../01-decomposition/) · [Abstraction & generalization](../03-abstraction-and-generalization/) · [Algorithmic thinking](../04-algorithmic-thinking/) · [Modeling a problem in code](../05-modeling-a-problem-in-code/) · [Scientific & hypothesis-driven thinking](../../09-scientific-and-hypothesis-driven/) · [Analogical thinking](../../07-creative-and-lateral-thinking/03-analogical-thinking/) · [Section overview](../)
