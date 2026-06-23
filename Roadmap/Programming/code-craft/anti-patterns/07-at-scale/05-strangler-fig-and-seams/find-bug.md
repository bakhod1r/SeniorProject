# Strangler Fig & Seams — Find the Bug

> **Category:** [Anti-Patterns at Scale](../README.md) → **Strangler Fig & Seams**
> **Covers (collectively):** Strangler Fig pattern · Seams · Branch by Abstraction · Characterization tests · Parallel-run / shadow & verification

---

This file is **critical-reading practice**. Each snippet below is a *plausible* attempt at incremental replacement — code or a plan that looks like a textbook strangler migration but contains a flaw that defeats its own safety guarantees. Your job is to read it the way a careful reviewer does and answer three questions:

> **What's wrong with this migration step? What concrete failure does it cause? How would you fix it?**

The "bug" here is rarely a crash on line one — it's a flaw in the *technique* that silently removes the safety net the strangler is supposed to provide: a parallel run that can't actually catch divergence, a "characterization" test that doesn't characterize, an abstraction that doesn't decouple, a cutover with no way back.

> **How to use this file:** read each snippet and write your own answer *before* expanding the collapsible. The skill you're training is noticing where the safety guarantee leaks, not recalling a name.

---

## Table of Contents

1. [The shared-state branch by abstraction](#snippet-1--the-shared-state-branch-by-abstraction)
2. [The characterization test that asserts the ideal](#snippet-2--the-characterization-test-that-asserts-the-ideal)
3. [The leaky abstraction](#snippet-3--the-leaky-abstraction)
4. [The routing layer with no way back](#snippet-4--the-routing-layer-with-no-way-back)
5. [The cutover that deletes too early](#snippet-5--the-cutover-that-deletes-too-early)
6. [The shadow that charges twice](#snippet-6--the-shadow-that-charges-twice)
7. [The comparison that always agrees](#snippet-7--the-comparison-that-always-agrees)

---

## Snippet 1 — The shared-state branch by abstraction

```go
// Go — branching the pricing engine by abstraction. Old and new behind one interface.
type Pricer interface {
	Price(cart *Cart) Money
}

// A shared accumulator the engine uses while pricing.
type engineState struct {
	runningTotal Money
	lineCount    int
}

var state = &engineState{} // shared by BOTH implementations

type legacyPricer struct{}

func (legacyPricer) Price(cart *Cart) Money {
	state.lineCount = len(cart.Items)
	for _, it := range cart.Items {
		state.runningTotal += it.Price * Money(it.Qty)
	}
	return state.runningTotal
}

type newPricer struct{}

func (newPricer) Price(cart *Cart) Money {
	state.runningTotal = 0 // "reset" before computing
	for _, it := range cart.Items {
		state.runningTotal += discounted(it)
	}
	return state.runningTotal
}
```

> What's wrong with this migration step? What concrete failure does it cause? How would you fix it?

<details>
<summary>Answer</summary>

**The two implementations share mutable state (`state`), so they are not independent — the whole point of branch by abstraction is broken.**

Branch by abstraction promises that old and new sit behind the interface *independently*, so you can run either one, swap them, or run both (for a parallel run) without interference. Here both `Price` methods read and mutate the same package-level `engineState`. The consequences:

- **The legacy path accumulates into `runningTotal` but never resets it**, so a second call returns the *sum of two carts*. It "worked" before only because no one called it twice in one process, or the global was re-created per request — a latent bug the shared state hides.
- **A parallel run is impossible.** If you run `legacyPricer` and `newPricer` on the same request to compare them, `newPricer`'s `state.runningTotal = 0` clobbers the legacy result mid-flight (and vice versa). The shadow can't compare two values that overwrite each other.
- **Concurrency corrupts everything.** Two requests pricing at once race on the global.

**Fix:** the state must be *local* to each computation, not shared between implementations. Pass it in or keep it on the stack:

```go
func (legacyPricer) Price(cart *Cart) Money {
	var total Money
	for _, it := range cart.Items {
		total += it.Price * Money(it.Qty)
	}
	return total
}

func (newPricer) Price(cart *Cart) Money {
	var total Money
	for _, it := range cart.Items {
		total += discounted(it)
	}
	return total
}
```

Now each implementation is a pure function of its input — independently runnable, safely comparable in a parallel run, and concurrency-safe. *Rule:* if old and new touch shared mutable state, you don't have a branch by abstraction; you have two tangled implementations wearing one interface.

</details>

---

## Snippet 2 — The characterization test that asserts the ideal

```python
# Python — "characterization" test written before replacing legacy tax logic.
def legacy_tax(amount, region):
    # legacy: EU is 20%, US is 8%, and (quirk) "food" region is hard-coded 0%,
    # AND a known bug: negative amounts are taxed as if positive.
    if region == "food":
        return 0.0
    rate = 0.20 if region == "EU" else 0.08
    return abs(amount) * rate          # the abs() is the legacy bug

def test_characterize_legacy_tax():
    # "Pinning" the behavior before we migrate.
    assert legacy_tax(100, "US") == 8.0
    assert legacy_tax(100, "EU") == 20.0
    assert legacy_tax(-100, "US") == -8.0   # what it SHOULD be (negative)
    assert legacy_tax(50, "food") == 0.0
```

> What's wrong with this migration step? What concrete failure does it cause? How would you fix it?

<details>
<summary>Answer</summary>

**The test asserts what the code *should* do, not what it *actually does* — so it isn't a characterization test, and it fails against the very code it's meant to pin.**

A characterization test captures *observed* behavior, bugs included, so that a faithful migration *passes* and a behavior-changing one *fails*. Here the line:

```python
assert legacy_tax(-100, "US") == -8.0
```

asserts the *ideal* (negative input → negative tax). But the legacy code has `abs(amount)`, so `legacy_tax(-100, "US")` actually returns `+8.0`. This test **fails against the legacy code right now** — and even if you "fixed" it to `== 8.0` by running it, the deeper trap is the *intent*: a characterization test that encodes the author's belief about correctness can't protect a migration. If the new implementation faithfully reproduces the `abs()` bug, an ideal-asserting test fails (false alarm); if the new implementation "fixes" the bug, the test that was written to the ideal *passes* — so it never warns you that behavior changed, even though downstream invoices that depended on the buggy positive tax just broke.

**Fix:** assert the *captured* output, produced by running the legacy code, including the quirk:

```python
def test_characterize_legacy_tax():
    # Captured by RUNNING legacy_tax — bugs and quirks included.
    assert legacy_tax(100, "US") == 8.0
    assert legacy_tax(100, "EU") == 20.0
    assert legacy_tax(-100, "US") == 8.0    # the abs() bug, PINNED as-is
    assert legacy_tax(50, "food") == 0.0    # the food=0% quirk, PINNED as-is
```

Now the new implementation must reproduce `8.0` for `-100`, and if you later decide the `abs()` is a real bug, you fix it as a *separate, reviewed behavioral change* — at which point this test fails *on purpose*, alerting you (and any downstream consumer) that behavior changed. The discipline: characterize the world as it *is*, migrate faithfully, fix bugs afterward.

</details>

---

## Snippet 3 — The leaky abstraction

```java
// Java — the abstraction for branch-by-abstraction over the storage layer.
public interface UserStore {
    LegacyResultSet query(String sql);   // exposes the legacy DB's own type
    LegacyConnection getConnection();     // ...and its connection type
}

class LegacyUserStore implements UserStore {
    public LegacyResultSet query(String sql) { return legacyDb.run(sql); }
    public LegacyConnection getConnection()  { return legacyDb.conn(); }
}

// callers:
LegacyResultSet rs = store.query("SELECT * FROM users WHERE id = " + id);
while (rs.legacyNext()) {
    User u = new User(rs.getLegacyColumn("name"), rs.getLegacyColumn("email"));
    ...
}
```

> What's wrong with this migration step? What concrete failure does it cause? How would you fix it?

<details>
<summary>Answer</summary>

**The abstraction leaks the legacy implementation's own types (`LegacyResultSet`, `LegacyConnection`, `legacyNext()`, `getLegacyColumn`), so callers are still coupled to the legacy internals — the abstraction decouples nothing.**

Branch by abstraction works only if the abstraction captures *what callers need* in implementation-neutral terms, so a *new* implementation can satisfy it. Here `UserStore` is shaped entirely around the legacy database: it returns the legacy result-set and connection types, and callers iterate with `legacyNext()` and pull `getLegacyColumn(...)`. To write a `NewUserStore` (say, backed by a different database or an ORM), you'd have to **reimplement the entire legacy `LegacyResultSet`/`LegacyConnection` API** — which means your "new" implementation is forever shackled to mimicking the old one's types. The abstraction is a legacy-shaped hole; only legacy fits it.

**Concrete failure:** when you try to drop in the new implementation, you discover it can't satisfy the interface without dragging the legacy types along, so either the migration stalls or you smear legacy types throughout the new code — defeating the replacement.

**Fix:** the abstraction must speak in *domain* terms, hiding both implementations' details:

```java
public interface UserStore {
    Optional<User> findById(long id);
    List<User> findByEmailDomain(String domain);
}

class LegacyUserStore implements UserStore {
    public Optional<User> findById(long id) {
        // legacy ResultSet handling stays HIDDEN behind the interface
        ...
    }
}
```

Now callers depend only on `User` and the domain methods. A `NewUserStore` (different DB, ORM, whatever) implements the same domain interface with *its own* internals, and the swap is real. *Rule:* if the abstraction's signatures mention the old implementation's types, callers can't swap implementations — push the legacy types behind the interface, not through it.

</details>

---

## Snippet 4 — The routing layer with no way back

```python
# Python — routing between old and new order processors during cutover.
NEW_PROCESSOR_ENABLED = True   # set at process start from an env var

def process_order(order):
    if NEW_PROCESSOR_ENABLED:
        return new_processor.process(order)
    return legacy_processor.process(order)

# Deploy config:
#   ORDER_PROCESSOR_NEW=true   # flipped on for the cutover
```

> What's wrong with this migration step? What concrete failure does it cause? How would you fix it?

<details>
<summary>Answer</summary>

**The routing decision is read *once at process start* into a module constant, so there is no runtime rollback — flipping it back requires a redeploy.**

The strangler's safety guarantee at cutover is *instant, deploy-free rollback*: if the new path starts erroring, you flip a flag and traffic returns to legacy in seconds. Here `NEW_PROCESSOR_ENABLED` is a module-level constant resolved from an env var when the process boots. Consequences:

- **No instant rollback.** When `new_processor` misbehaves in production, your only recourse is to change the env var and *redeploy/restart every instance* — minutes of continued damage while the bad path serves traffic, exactly when you need to stop the bleeding *now*.
- **No gradual ramp.** It's all-or-nothing per process — you can't send 1% or target one tenant, so the cutover is effectively a flag day, the thing the strangler exists to avoid.
- **Inconsistent fleet during deploy.** As instances restart, some run new and some old with no control over the mix.

**Fix:** read the flag *fresh on every call* from a runtime flag store that can be changed without deploying, and support targeting/ramp:

```python
def process_order(order):
    # Evaluated per call → instant rollback, gradual ramp, per-tenant targeting.
    if flags.enabled("order.use_new_processor", tenant=order.tenant_id):
        return new_processor.process(order)
    return legacy_processor.process(order)
```

Now flipping `order.use_new_processor` off in the flag system reverts traffic immediately, with no redeploy, and you can ramp by percentage or tenant. *Rule:* a strangler routing flag that's read once at startup is a deploy in disguise — read it per request so rollback is a flag flip, not a release.

</details>

---

## Snippet 5 — The cutover that deletes too early

```go
// Go — the cutover commit for the new shipping engine.
// PR description: "New engine is live behind the flag at 50%. Deleting the
// legacy path now to keep the codebase clean — git has the history if we
// ever need it back."

type ShipPricer interface {
	Ship(cart Cart) Money
}

// DELETED in this commit:
//   - legacyShipPricer (the old implementation)
//   - the routingShipPricer facade
//   - the "shipping.use_new" flag check
//
// After this commit, callers point straight at newShipPricer:
func NewCheckout() *Checkout {
	return &Checkout{ship: newShipPricer{}}
}
```

> What's wrong with this migration step? What concrete failure does it cause? How would you fix it?

<details>
<summary>Answer</summary>

**The old path, the routing facade, and the flag are deleted while the new path is only at 50% traffic and unproven — destroying the rollback capability at the exact moment it's most likely to be needed.**

You delete the old path *last*, only after the new one owns **100%** of traffic for a meaningful bake window with no incidents (and, for a careful migration, after a parallel run proved old == new). Here the new engine is at **50%** — meaning half of production hasn't even exercised the legacy path's replacement yet, and crucially the *other half is still relying on the legacy path you're about to delete*. The consequences:

- **You break 50% of traffic immediately:** the flag still routes half of requests to `legacyShipPricer`, which this commit deletes — so either it won't compile or those requests now hit the new engine unintentionally.
- **You've thrown away rollback** precisely when the new path is least proven. "Git has the history" is true but useless under fire: reverting a deletion, re-testing, and redeploying during an incident is far slower than flipping a flag, and the longer the migration ran, the harder the revert is to apply cleanly.
- **You conflated "the new path exists" with "the new path is trusted."** 50% is mid-ramp, not done.

**Fix:** sequence deletion as the *final* step, gated on evidence:

1. Ramp the flag to **100%** and hold for a bake window spanning the rare flows (e.g. a billing cycle).
2. Confirm clean metrics and (ideally) a zero-or-explained parallel-run divergence.
3. *Then* delete `legacyShipPricer`, the routing facade, and the flag together, in their own commit, citing the evidence — keeping rollback (the flag) alive right up until you're certain.

*Rule:* keep the old path and the flag until the new path is at 100% and proven; deletion is how you *finish*, not how you *cut over*.

</details>

---

## Snippet 6 — The shadow that charges twice

```python
# Python — a "scientist"-style parallel run to verify the new payment path.
def charge_order(order):
    old_result = legacy_charge(order)   # the served result

    if sampler.should_sample():
        # Shadow the new path to compare.
        new_result = new_charge(order)  # run new alongside old
        if new_result != old_result:
            mismatch_sink.report(order, old_result, new_result)

    return old_result

def new_charge(order):
    charge_id = stripe.charge(order.card, order.total_cents)   # REAL charge
    audit_log.write(order.id, charge_id)
    return charge_id
```

> What's wrong with this migration step? What concrete failure does it cause? How would you fix it?

<details>
<summary>Answer</summary>

**The shadowed new path performs *real* side effects — it actually charges the customer's card — so every sampled request double-charges and double-logs.**

A parallel run is supposed to be a *read-only* verification: the old path is the only one allowed to affect the world; the new path is run *only to compare its output*. Here `new_charge` calls `stripe.charge(...)` for real. So for every request the sampler selects, the customer is charged **twice** — once by `legacy_charge` (the served path) and once by the shadow — and gets two audit entries. This turns a safety mechanism into a production incident: the more you sample, the more customers you double-bill.

This is the single most dangerous parallel-run mistake. A pure-computation shadow (like a `Pricer` that just returns a number) is safe to run as-is; a *side-effecting* one is not.

**Fix:** suppress the new path's side effects during shadowing by injecting no-op / recording collaborators, and compare the *intended* effect rather than executing it:

```python
def charge_order(order):
    old_result = legacy_charge(order)

    if sampler.should_sample():
        # Run new with FAKE collaborators: it computes what it WOULD do,
        # but charges nothing and writes nothing real.
        shadow = NewCharger(gateway=RecordingGateway(), audit=NoopAudit())
        intended = shadow.charge(order)          # no real charge happens
        if intended.command != old_result.command:
            mismatch_sink.report(order, old_result, intended)

    return old_result
```

Now the shadow exercises the new path's *logic* (what amount, what card, what audit entry it would produce) and compares that to the legacy path — without touching Stripe. The old path remains the only thing that moves money. *Rule:* never shadow a side-effecting path without suppressing its effects; compare the intended action, not an executed one.

</details>

---

## Snippet 7 — The comparison that always agrees

```go
// Go — comparing old and new during the parallel run before cutover.
type Result struct {
	Total     Money
	Breakdown []LineCharge
	ComputedAt time.Time
}

func compare(old, new Result) bool {
	// Marshal both to JSON and compare the bytes — simple and thorough.
	oldJSON, _ := json.Marshal(old)
	newJSON, _ := json.Marshal(new)
	return bytes.Equal(oldJSON, newJSON)
}

// In the shadow:
if !compare(oldResult, newResult) {
	mismatchSink.Report(oldResult, newResult)
}
```

> What's wrong with this migration step? What concrete failure does it cause? How would you fix it?

<details>
<summary>Answer</summary>

**The comparison includes nondeterministic, irrelevant fields (`ComputedAt`, and unordered `Breakdown`), so it reports mismatches on *noise* — and the team, drowning in false positives, learns to ignore the mismatch sink entirely.**

The failure is subtle: the comparison is *too strict on the wrong things*. `Result` contains `ComputedAt time.Time`, which is *always* different between the old call and the new call (they run at different instants), so **every single comparison reports a mismatch**. Add to that `Breakdown []LineCharge` — if old and new build that slice in different orders, the JSON bytes differ even when the charges are identical. The consequences:

- **100% false-positive mismatch rate.** The sink fills with differences that are entirely the timestamp and ordering, not real divergence.
- **The signal is destroyed.** A parallel run's value is that a mismatch *means something*. When every comparison "fails," the team stops looking, and a *real* pricing divergence hides in the flood — so the migration cuts over on a verification that verified nothing.

A comparison that always disagrees is as useless as one that always agrees: either way it carries no information.

**Fix:** the comparator must *normalize away* fields that are legitimately nondeterministic or order-independent, and compare only what behavior actually means:

```go
func compare(old, new Result) bool {
	if old.Total != new.Total {
		return false
	}
	// Order-independent comparison of the breakdown; ignore ComputedAt entirely.
	return sameCharges(old.Breakdown, new.Breakdown)
}

func sameCharges(a, b []LineCharge) bool {
	if len(a) != len(b) {
		return false
	}
	sort.Slice(a, func(i, j int) bool { return a[i].SKU < a[j].SKU })
	sort.Slice(b, func(i, j int) bool { return b[i].SKU < b[j].SKU })
	return reflect.DeepEqual(a, b)
}
```

Now `ComputedAt` is excluded, `Breakdown` is compared as a *set*, and a reported mismatch is a *real* behavioral divergence worth triaging. *Rule:* a parallel-run comparator is only as good as its normalization — strip nondeterminism (time, randomness, map/slice ordering, float jitter) before diffing, or you'll either cry wolf on every call or, worse, paper over real differences.

</details>

---

## Summary — patterns of spotting

You don't catch a broken strangler by spotting a syntax error — you catch it by asking *which safety guarantee just leaked*. The repeatable checks from these seven snippets:

- **Are the two implementations actually independent?** If old and new share mutable state, you don't have a branch by abstraction — you can't run, swap, or compare them safely (Snippet 1).
- **Does the "characterization" test capture *actual* or *ideal* behavior?** A test asserting what the code *should* do can't protect a migration; it must pin what the code *does*, quirks and bugs included, captured by running it (Snippet 2).
- **Does the abstraction leak the old implementation's types?** If callers still touch legacy-shaped types through the interface, nothing is decoupled and the new implementation can't fit the hole (Snippet 3).
- **Is the routing flag read per call or once at startup?** A flag resolved at boot is a deploy in disguise — no instant rollback, no ramp, no targeting (Snippet 4).
- **Is deletion the final step, gated on 100% + evidence?** Deleting the old path or the flag mid-ramp throws away rollback exactly when it's most needed (Snippet 5).
- **Does the shadow have suppressed side effects?** Running a side-effecting new path "to compare" double-charges and double-writes — the most dangerous parallel-run mistake (Snippet 6).
- **Does the comparator normalize nondeterminism?** A comparison that always disagrees (on timestamps, ordering) destroys the signal as surely as one that always agrees (Snippet 7).

The meta-lesson: **the strangler's value is entirely in its safety nets** — independent implementations, behavior pinned as-is, real decoupling, instant rollback, side-effect-free verification, meaningful comparison, and finishing with deletion. Each snippet here keeps the *shape* of the technique while quietly cutting one of those nets. When you review a migration, don't check that the steps are present; check that each step still *guarantees what it's supposed to*.

---

## Related Topics

- [`tasks.md`](tasks.md) — build the correct versions of these mechanisms from scratch.
- [`optimize.md`](optimize.md) — fix a parallel-run that's correct but doubles p99.
- [`interview.md`](interview.md) — Q&A across the whole topic.
- [`senior.md`](senior.md) — running a strangler migration across a real codebase.
- [Expand-Contract Refactors](../06-expand-contract-refactors/find-bug.md) — the data-evolution sibling, where coexistence bugs also hide.
- [Hotspot Analysis](../03-hotspot-analysis/find-bug.md) — choosing the wrong thing to strangle is its own bug.
- [Architecture → Anti-Patterns](../../../../../Architecture/anti-patterns/README.md) — the system-level siblings.
