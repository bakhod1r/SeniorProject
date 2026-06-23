# Strangler Fig & Seams — Practice Tasks

> **Category:** [Anti-Patterns at Scale](../README.md) → **Strangler Fig & Seams**
> **Covers (collectively):** Strangler Fig pattern · Seams · Branch by Abstraction · Characterization tests · Parallel-run / shadow & verification

---

These are **do-it** exercises, not recognition quizzes. Each gives you a problem statement, starting code (Go, Java, or Python — the language varies on purpose), acceptance criteria, and a collapsible solution. The skill being trained is the *process* of safe incremental replacement: introduce a seam, branch by abstraction, pin legacy behavior with a characterization test, route old/new behind a flag, and verify with a parallel-run harness.

> **How to use this file.** Read the problem, attempt it in your editor *before* opening the solution, then compare. The "why it works" note under each solution matters more than the diff — every step here is meant to be *shippable and reversible*, which is the whole point of strangling instead of rewriting. Refer back to [`senior.md`](senior.md) for the strategy these exercises drill.

---

## Table of Contents

| # | Exercise | Technique | Lang | Difficulty |
|---|---|---|---|---|
| 1 | [Introduce a seam, then branch by abstraction](#exercise-1--introduce-a-seam-then-branch-by-abstraction) | Seam + Branch by Abstraction | Go | ★★ medium |
| 2 | [Pin the messy legacy with a golden-master test](#exercise-2--pin-the-messy-legacy-with-a-golden-master-test) | Characterization test | Python | ★★ medium |
| 3 | [Design a routing facade that chooses old/new by flag](#exercise-3--design-a-routing-facade-that-chooses-oldnew-by-flag) | Routing facade + flag | Java | ★★ medium |
| 4 | [Build a parallel-run comparison harness](#exercise-4--build-a-parallel-run-comparison-harness) | Parallel-run / shadow | Go | ★★★ hard |
| 5 | [Sequence the whole strangler, end to end](#exercise-5--sequence-the-whole-strangler-end-to-end) | All five, in order | (process) | ★★★ hard |

---

## Exercise 1 — Introduce a seam, then branch by abstraction

**Technique:** Object seam + Branch by Abstraction · **Language:** Go · **Difficulty:** ★★ medium

Below, `Checkout` computes shipping cost inline with a hard-coded legacy formula. A new shipping engine is coming. Your job is to introduce a **seam** so the formula can be swapped from outside, then set up **branch by abstraction** so old and new can coexist — *without changing the production result yet*.

```go
// Before — the legacy formula is inlined and untestable in isolation.
type Checkout struct {
	taxRate float64
}

func (c *Checkout) Total(cart Cart) Money {
	subtotal := cart.Subtotal()
	// legacy shipping: $5 flat, free over $100, +$3 for express
	shipping := Money(500)
	if subtotal >= 10000 {
		shipping = 0
	}
	if cart.Express {
		shipping += 300
	}
	tax := Money(float64(subtotal) * c.taxRate)
	return subtotal + shipping + tax
}
```

**Acceptance criteria**
- Shipping computation lives behind an interface (`ShipPricer`) — an object seam.
- `Checkout` depends on the interface, not the inline formula; the legacy formula moves into a `legacyShipPricer` implementing it.
- The production result is **byte-for-byte identical** after the change (this step is behavior-preserving scaffolding, not a behavior change).
- A second implementation can be dropped in later without editing `Checkout`.

**Hint:** the seam is the *enabling point* — `Checkout`'s constructor. Extract the formula verbatim into the legacy implementation first; do not "improve" it.

<details>
<summary>Solution</summary>

```go
// Step 1: the abstraction (the seam). Captures how Checkout uses shipping.
type ShipPricer interface {
	Ship(cart Cart, subtotal Money) Money
}

// Step 2: the OLD formula, moved verbatim behind the seam. No changes.
type legacyShipPricer struct{}

func (legacyShipPricer) Ship(cart Cart, subtotal Money) Money {
	shipping := Money(500)
	if subtotal >= 10000 {
		shipping = 0
	}
	if cart.Express {
		shipping += 300
	}
	return shipping
}

// Step 3: Checkout now depends on the seam, injected via the constructor.
type Checkout struct {
	taxRate float64
	ship    ShipPricer
}

func NewCheckout(taxRate float64, ship ShipPricer) *Checkout {
	return &Checkout{taxRate: taxRate, ship: ship}
}

func (c *Checkout) Total(cart Cart) Money {
	subtotal := cart.Subtotal()
	shipping := c.ship.Ship(cart, subtotal) // ← swappable from outside
	tax := Money(float64(subtotal) * c.taxRate)
	return subtotal + shipping + tax
}

// Production wiring is unchanged in behavior:
//   c := NewCheckout(0.08, legacyShipPricer{})
//
// Later, the new engine drops in with zero edits to Checkout:
//   c := NewCheckout(0.08, newShipPricer{...})
```

**Why it works.** The interface is the **object seam**: `Checkout`'s constructor is the enabling point where you choose which `ShipPricer` runs. The legacy formula moved *verbatim* — same constants, same order — so the production result is identical and this commit is pure, reversible scaffolding you can ship on its own. With the seam in place, **branch by abstraction** is now trivial: build `newShipPricer` behind the same interface, and swap it in (eventually behind a flag — Exercise 3) without touching the caller. The hard work of decoupling the caller is done *before* any risky behavior change, exactly as the pattern prescribes.

</details>

---

## Exercise 2 — Pin the messy legacy with a golden-master test

**Technique:** Characterization (golden-master) test · **Language:** Python · **Difficulty:** ★★ medium

You must replace this legacy discount function, but there's no spec and it has *quirks* (note the order-dependent overwrite and the odd rounding). Before you touch it, **pin its current behavior** — bugs included — with a characterization test, so any change your replacement makes shows up as a failure.

```python
# Legacy. Nobody is sure all of this is intentional. You must NOT change it yet.
def legacy_discount(price, *, tier, holiday, clearance):
    d = 0.0
    if tier == "gold":
        d = price * 0.10
    if holiday:
        d = d + price * 0.05
    if clearance:
        d = price * 0.20          # NOTE: overwrites, doesn't add — a quirk
    return round(d - 0.001, 2)    # NOTE: the -0.001 nudge is weird but real
```

**Acceptance criteria**
- A test that records the function's *actual* output across a broad spread of inputs (all relevant combinations of `tier`, `holiday`, `clearance`, plus a few prices).
- The expected values are the **observed** ones, not what you think they *should* be — the clearance-overwrite quirk and the `-0.001` nudge must be captured as-is.
- The test fails if any future change alters behavior, including a "fix" of the quirks.
- Briefly note how you'd generate the golden values rather than hand-computing them.

**Hint:** drive the inputs as a matrix; capture outputs by *running the legacy code once* and snapshotting, not by reasoning about the formula.

<details>
<summary>Solution</summary>

```python
import itertools
import pytest

# Generate the input matrix: every flag combo across a few representative prices.
PRICES = [0, 49.99, 100, 10000]
TIERS = ["gold", "silver"]
CASES = [
    (price, tier, holiday, clearance)
    for price, tier, holiday, clearance in itertools.product(
        PRICES, TIERS, [False, True], [False, True]
    )
]

# The GOLDEN MASTER: produced by running the legacy code once and recording
# the actual output. Do NOT hand-compute these — capture what the code does.
#
#   for c in CASES: print(c, legacy_discount(c[0], tier=c[1],
#                                             holiday=c[2], clearance=c[3]))
#
# then paste the observed values here (or write them to a snapshot file).
GOLDEN = {
    (0,     "gold",   False, False): -0.0,
    (0,     "gold",   False, True):  -0.0,
    (49.99, "gold",   False, False): 5.0,
    (49.99, "gold",   True,  False): 7.5,
    (49.99, "silver", False, True):  10.0,   # clearance OVERWRITES (the quirk)
    (100,   "gold",   True,  True):  20.0,    # clearance overwrites gold+holiday
    (10000, "silver", False, False): -0.0,
    # ... one entry per case in CASES, all captured from the real run ...
}

@pytest.mark.parametrize("price,tier,holiday,clearance", CASES)
def test_characterizes_legacy_discount(price, tier, holiday, clearance):
    key = (price, tier, holiday, clearance)
    if key not in GOLDEN:
        pytest.skip("golden value not yet captured for this case")
    actual = legacy_discount(price, tier=tier, holiday=holiday, clearance=clearance)
    assert actual == GOLDEN[key], (
        f"behavior changed for {key}: was {GOLDEN[key]}, now {actual}"
    )
```

For larger output, prefer an **approval/snapshot** style — serialize all `(input, output)` pairs to a `discount.golden.json` checked into the repo, and have the test diff a fresh run against it. That scales past hand-pasted dicts and makes "behavior changed" a readable diff.

**Why it works.** The expected values are **whatever the legacy code actually returned**, captured by running it — including the `clearance`-overwrites-gold quirk and the `-0.001` rounding nudge. That's the entire point of a characterization test: it pins behavior *as-is* to detect *change*, not correctness. Now you can build the replacement, run it against this same matrix, and any divergence — even one that "fixes" a quirk — fails loudly. You reproduce the quirks faithfully during the migration; fixing them (if they're truly bugs) is a *separate*, later, independently-reviewed change. Generating golden values by execution (not by hand) is what keeps the test honest: if you compute the expected value yourself, you encode your *belief* about the formula, not the formula's actual behavior.

</details>

---

## Exercise 3 — Design a routing facade that chooses old/new by flag

**Technique:** Routing facade + feature flag · **Language:** Java · **Difficulty:** ★★ medium

Old and new pricing implementations now both exist behind a `Pricer` interface (from branch by abstraction). Build a **routing facade** that decides per call which to run, controlled by a feature flag with per-tenant targeting and an instant kill-switch — so you can ramp, target, and roll back *without a deploy*.

```java
public interface Pricer {
    Money price(Cart cart);
}

// Both exist; you must route between them.
class LegacyPricer implements Pricer { /* ... */ }
class NewPricer    implements Pricer { /* ... */ }

interface FlagStore {
    // returns true if the named flag is on for this tenant
    boolean enabled(String flag, String tenantId);
}
```

**Acceptance criteria**
- A `RoutingPricer implements Pricer` so callers are unaware which impl runs (they depend only on `Pricer`).
- The flag decides per call, with the tenant id available for targeting.
- A bad new path is recoverable by **flipping a flag, not deploying** — i.e. the routing reads the flag fresh each call.
- The facade is trivially deletable at the end of the migration (when new is at 100%).

**Hint:** the facade is itself a `Pricer`, so it nests cleanly. Read the flag *on every call* — caching it defeats the instant-rollback property.

<details>
<summary>Solution</summary>

```java
public final class RoutingPricer implements Pricer {
    private final Pricer legacy;
    private final Pricer next;        // the new implementation
    private final FlagStore flags;
    private static final String FLAG = "pricing.use_new";

    public RoutingPricer(Pricer legacy, Pricer next, FlagStore flags) {
        this.legacy = legacy;
        this.next = next;
        this.flags = flags;
    }

    @Override
    public Money price(Cart cart) {
        // Read the flag FRESH on every call: flipping it off is an instant,
        // deploy-free rollback. Per-tenant targeting enables a gradual ramp.
        if (flags.enabled(FLAG, cart.tenantId())) {
            return next.price(cart);
        }
        return legacy.price(cart);
    }
}

// Wiring — callers see only Pricer; they never learn which path ran:
//   Pricer pricer = new RoutingPricer(new LegacyPricer(), new NewPricer(), flagStore);
```

**Ramp and rollback, all without deploying:**

```text
flag OFF for all                 → 100% legacy   (start)
flag ON for tenant "internal"    → dogfood       (lowest blast radius)
flag ON for 10% of tenants       → canary        (watch metrics)
flag ON for all                  → 100% new      (bake window)
flag OFF (kill-switch)            → instant rollback on any bad signal
```

**End of migration:** once `pricing.use_new` is at 100% over the bake window with no incidents, delete `RoutingPricer`, the flag, and `LegacyPricer` *together*, and wire callers straight to `NewPricer`. The facade was scaffolding; leaving it (and a stuck-on flag) behind is the never-finishing-migration smell.

**Why it works.** `RoutingPricer` is itself a `Pricer`, so it slots in transparently — callers are fully decoupled from the choice. Reading the flag **on every call** is the load-bearing detail: it makes the new path's blast radius controllable (ramp by tenant/percentage) and, crucially, makes rollback a *flag flip* measured in seconds rather than a deploy measured in minutes. The per-tenant argument lets you sequence cutover by risk (internal → small tenants → everyone). And because the facade is a thin, self-contained class with one flag, it's *trivially deletable* when the migration finishes — which is the difference between strangling the legacy and merely accreting a permanent second code path.

</details>

---

## Exercise 4 — Build a parallel-run comparison harness

**Technique:** Parallel-run / shadow with verification · **Language:** Go · **Difficulty:** ★★★ hard

Before trusting `NewPricer`, you want to run it *alongside* `LegacyPricer` on real traffic and compare — but **without** adding latency to the request, **without** letting a shadow error affect the served result, and **without** running on 100% of traffic. Build the harness.

```go
type Pricer interface {
	Price(cart Cart) (Money, error)
}

type Mismatch struct {
	Cart   Cart
	Old    Money
	New    Money
	NewErr error
}

// You're given a sink to report mismatches and a sampler.
type MismatchSink interface{ Report(Mismatch) }
type Sampler interface{ ShouldSample() bool } // e.g. returns true ~5% of calls
```

**Acceptance criteria**
- The **old** result is always what's returned to the caller (old is still source of truth).
- The new path runs **off the request's critical path** — the caller never waits on it.
- The new path is run only on a **sampled fraction** of calls.
- A panic or error in the new path or the comparison **cannot** affect the served request.
- Mismatches are reported with enough context to triage.

**Hint:** return the old result immediately, then dispatch the shadow on a goroutine. Recover from panics in the shadow. Compare only when sampled.

<details>
<summary>Solution</summary>

```go
// ShadowPricer serves the old result and runs the new one off the hot path.
type ShadowPricer struct {
	old, new Pricer
	sink     MismatchSink
	sampler  Sampler
}

func NewShadowPricer(old, new Pricer, sink MismatchSink, s Sampler) *ShadowPricer {
	return &ShadowPricer{old: old, new: new, sink: sink, sampler: s}
}

func (s *ShadowPricer) Price(cart Cart) (Money, error) {
	// 1. The served result is ALWAYS the old path. Source of truth unchanged.
	oldVal, oldErr := s.old.Price(cart)

	// 2. Only shadow a sampled fraction — keeps added CPU/cost bounded.
	if s.sampler.ShouldSample() {
		// 3. Off the critical path: the caller does not wait on the new path.
		//    Snapshot the inputs the shadow needs so it can't race the caller.
		go s.shadow(cart, oldVal, oldErr)
	}

	// 4. Return immediately — latency is the OLD path's latency, nothing added.
	return oldVal, oldErr
}

func (s *ShadowPricer) shadow(cart Cart, oldVal Money, oldErr error) {
	// 5. The shadow must NEVER crash the process or leak into the request.
	defer func() {
		if r := recover(); r != nil {
			s.sink.Report(Mismatch{Cart: cart, Old: oldVal,
				NewErr: fmt.Errorf("shadow panic: %v", r)})
		}
	}()

	newVal, newErr := s.new.Price(cart)

	// 6. Compare. Treat "old errored" cases carefully — only compare when the
	//    old path produced a value; an old error is its own (uninteresting) case.
	if oldErr == nil && (newErr != nil || newVal != oldVal) {
		s.sink.Report(Mismatch{
			Cart: cart, Old: oldVal, New: newVal, NewErr: newErr,
		})
	}
}
```

**Critical caveat — side effects.** This harness assumes `NewPricer.Price` is a **pure computation** (no DB writes, no emails, no charges). If the new path has side effects, the shadow *must* run it with no-op / recording collaborators injected so it doesn't double-charge or double-send. Shadowing a side-effecting path without suppressing its effects is the single most dangerous mistake in this whole topic.

**Triage, not just rate.** A nonzero mismatch count isn't an automatic blocker. Bucket the reports: real new-path bugs (fix before cutover), the new path *correctly* fixing a legacy bug (document and accept), and comparison noise like timestamps or float jitter (fix the *comparator* — normalize before diffing). Cut over when every mismatch is *understood*, not merely when the rate is small.

**Why it works.** The served result is the old value, computed and returned synchronously, so **latency is unchanged** — the new path's cost is paid on a background goroutine the caller never blocks on. **Sampling** (`ShouldSample`) caps the extra CPU/cost to a few percent while still surfacing divergences over time. The `recover` makes the shadow **fail-open**: a panic or error in the new path or comparator is captured as a report, never propagated to the request. And the `Mismatch` carries the cart plus both results, so each divergence is triageable. This is the production-grade characterization test — real traffic is the input distribution your offline golden master (Exercise 2) could never enumerate. Contrast with the broken synchronous version in [`optimize.md`](optimize.md), which doubles p99 by running both paths inline before responding.

</details>

---

## Exercise 5 — Sequence the whole strangler, end to end

**Technique:** Strangler Fig — all five, in order · **Difficulty:** ★★★ hard · *(process exercise — no single code answer)*

You own a 6,000-line `LegacyBilling` class in active production. Leadership wants it replaced. You've talked them out of a big-bang rewrite. Now you must **write the migration plan**: the ordered sequence of shippable, reversible steps that strangles the *invoicing* responsibility out of it, using everything in this topic.

**Task.** Produce the step-by-step plan. For each step state: what you do, why it's safe, what you ship, and what evidence lets you proceed to the next step. Be specific about seams, branch by abstraction, characterization, flags, parallel-run, cutover, deletion, and the data concern.

**Acceptance criteria**
- Each step is independently shippable and reversible.
- Characterization happens *before* the first behavior-affecting change.
- The new path is verified by parallel-run *before* it serves traffic.
- The plan ends in **deletion** of the old path *and* the scaffolding (no never-finishing migration).
- Data coexistence is addressed, not hand-waved.

<details>
<summary>Solution</summary>

**Step 0 — Pick the seam, not the whole class.** Don't strangle 6,000 lines at once. Carve off *one cohesive responsibility* — invoicing — whose logic is identifiable. (Choosing *which* slice first is a hotspot question: pick the one that changes often and hurts.) *Ship:* nothing yet — this is the scoping decision.

**Step 1 — Introduce an object seam, in place.** Extract the invoicing logic into a private method/collaborator *inside* `LegacyBilling` (e.g. `invoiceLegacy(account, lines)`), and define an `Invoicer` interface it satisfies. The production path is unchanged. *Safe because:* pure behavior-preserving extraction. *Ship:* the seam. *Evidence to proceed:* existing tests green.

**Step 2 — Characterize the seam.** Write a golden-master test (Exercise 2) over representative accounts/line-items — capturing the legacy invoicing output *as-is*, quirks included. For behavior you can't reproduce offline, note it for the parallel-run later. *Safe because:* tests only; no production change. *Ship:* the characterization suite. *Evidence:* a broad, passing golden master pinning current behavior.

**Step 3 — Branch by abstraction: route callers through `Invoicer`.** Make `LegacyBilling` (and any external callers) depend on the `Invoicer` interface, still backed by `invoiceLegacy`. This is the patient, largest step — it discovers and severs every coupling to the old internals. *Safe because:* still the old implementation behind the interface; behavior identical. *Ship:* callers-on-abstraction. *Evidence:* golden master still green; grep confirms callers go through the interface.

**Step 4 — Build the new implementation behind the same interface.** Write `NewInvoicer implements Invoicer`. It's present but routes no traffic yet. *Safe because:* not wired in. *Ship:* the new code, dark. *Evidence:* the golden master, run against `NewInvoicer`, surfaces where it diverges from legacy — fix until it matches the captured behavior.

**Step 5 — Address data coexistence (do this before serving).** If `NewInvoicer` reads/writes invoice data in a new shape, evolve the schema **additively** (expand-contract): both shapes present, **dual-write** so new invoices land in both, **backfill** history, **dual-read + compare**. The old shape stays authoritative and both paths stay mutually readable, so a later rollback is data-safe. *Safe because:* additive only; nothing dropped; one source of truth. *Ship:* the expanded schema + dual-write. *Evidence:* dual-read comparison shows the stores agree.

**Step 6 — Parallel-run in production (shadow).** Put a `ShadowInvoicer` (Exercise 4) in front: serve the legacy result, run `NewInvoicer` async on a 5% sample, compare off-path, **suppress its side effects** (no real invoices emitted from the shadow). Triage mismatches until every one is understood. *Safe because:* new path serves nothing and writes nothing real. *Ship:* the shadow. *Evidence:* mismatch rate driven to zero-or-fully-explained over a window spanning a billing cycle.

**Step 7 — Route old/new behind a flag and ramp (Exercise 3).** Replace the shadow with a `RoutingInvoicer` reading a fresh flag per call. Ramp: internal → small tenants → 10% → 50% → 100%, watching error rate, latency, and reconciliation at each step, with the flag as an instant kill-switch. *Safe because:* per-call flag = deploy-free rollback; bounded blast radius. *Ship:* each ramp increment. *Evidence:* clean metrics at each step before widening.

**Step 8 — Strangle: delete the old path AND the scaffolding.** At 100% over the bake window, delete `invoiceLegacy`, the flag, and the routing/shadow facades; wire callers straight to `NewInvoicer`. Then **contract** the data: drop the old schema shape now that no code reads it. *Safe because:* nothing routes to the old path; data no longer read in the old shape. *Ship:* the deletion commits (each citing evidence). *Evidence:* grep/dead-code analysis confirms zero references; git holds the history.

**Step 9 — Repeat for the next responsibility.** Invoicing is strangled; the class is smaller. Pick the next cohesive slice and run the loop again until `LegacyBilling` is an empty shell, then delete it too.

**Why this plan works.** Every step is shippable and reversible, so you're never on a long-lived divergent branch and you can stop at any point with a working system. The risky behavior change (Step 7) happens *only after* you've pinned behavior offline (Step 2), matched it (Step 4), and proven the match on real traffic (Step 6) — three escalating safety nets. Data is handled with expand-contract so a code rollback is never blocked by un-rollback-able writes. And it **ends in deletion** (Step 8): the payoff — a simpler, single-implementation system — is only banked when the old path and the scaffolding are gone. A plan that stopped at Step 7 would pay all the coexistence cost and keep none of the benefit.

</details>

---

## Summary

- **Seams come first.** You can't redirect, test, or shadow anything you can't intercept. Prefer object seams (interface + injection at a constructor) and extract the legacy logic *verbatim* before changing anything (Exercise 1).
- **Characterize before you change.** A golden-master test captures the legacy's *actual* behavior — quirks and bugs included — by *running it*, so any divergence your replacement introduces fails loudly (Exercise 2).
- **Branch by abstraction, route by flag.** Both implementations live behind one interface; a routing facade reads a fresh flag per call so you can ramp by tenant/percentage and roll back instantly without a deploy (Exercise 3).
- **Verify on real traffic, off the hot path.** A parallel-run harness serves the old result, runs the new one async on a sample, suppresses its side effects, and reports triageable mismatches — the production-grade characterization test (Exercise 4).
- **Finish the job.** The migration is a sequence of shippable, reversible steps that *ends in deletion* of the old path, the flag, and the scaffolding — plus contracting the data shape. Stopping at "95% migrated" banks the cost and none of the benefit (Exercise 5).
- **Mind the data.** Code rolls back behind a flag; persistent shared data does not. Expand-contract and dual-write/dual-read keep old and new mutually readable so a rollback is always data-safe.

---

## Related Topics

- [`senior.md`](senior.md) — the strategy these exercises drill, applied across a real codebase.
- [`interview.md`](interview.md) — Q&A across the whole topic for job prep.
- [`find-bug.md`](find-bug.md) — broken strangler attempts to diagnose (critical reading).
- [`optimize.md`](optimize.md) — fix a synchronous parallel-run that doubles p99.
- [Expand-Contract Refactors](../06-expand-contract-refactors/junior.md) — the contract/data-evolution mechanics behind Step 5.
- [Hotspot Analysis](../03-hotspot-analysis/junior.md) — choosing which slice to strangle first.
- [Architecture Fitness Functions](../01-architecture-fitness-functions/junior.md) — keeping the strangled shape from drifting back.
- [Architecture → Anti-Patterns](../../../../../Architecture/anti-patterns/README.md) — the system-level siblings.
