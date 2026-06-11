# Strangler at the Code Level — Middle

> **Source:** Martin Fowler, "StranglerFigApplication", martinfowler.com/bliki/StranglerFigApplication.html

The junior page gave you the three moves — seam, divert, delete. At this level the question is not *whether* the strangler works but *where to cut*, *how big a slice to take*, and *how to prove parity without breaking production*. Get these wrong and you end up with the worst of both worlds: two implementations, neither trusted, and an old path that never dies.

---

## 1. Choosing the interception point

The whole pattern hinges on the seam. A good seam has three properties:

1. **Single choke point** — all calls to the old behavior pass through it. If they don't, your divert condition only catches *some* traffic and parity claims become meaningless.
2. **Stable signature** — the input/output contract at the seam won't change while you migrate. You are diverting *inside* a fixed boundary.
3. **Cheap to insert** — ideally a thin wrapper, not a redesign. If creating the seam is itself a major refactor, that work is the first thing the Mikado Method (sibling topic 03) should map out.

### Common seam types, from cheapest to richest

| Seam | What it is | Use when |
|---|---|---|
| **Facade** | A wrapper with the same API, forwarding to old code | Callers already converge on a small API surface |
| **Adapter** | A wrapper that translates between two different shapes | Old and new have different signatures |
| **Event interception** | Catch an event/message and dispatch to old or new | The system is event-driven and you can tap the dispatch |
| **Asset capture** | A wrapper that owns a resource (a table, a file) and routes reads/writes | The "old code" is really *data ownership* you're migrating |

Fowler names *event interception* and *asset capture* explicitly because at system scale you often can't insert a facade — but in-process, the facade/adapter is usually right there for the taking.

```java
// Adapter seam: old returns a primitive, new returns a rich type.
// The adapter keeps the OLD signature so callers don't change yet.
public class QuoteService {          // seam, old-shaped API
    private final LegacyQuoter legacy;
    private final NewQuoteEngine engine;

    public double quote(Request r) {                 // old signature kept
        if (flags.isOn("quoting.new-engine")) {
            Quote q = engine.produce(toModel(r));    // new, rich shape
            return q.amount();                        // adapt back to double
        }
        return legacy.quote(r);
    }
}
```

> **When NOT to (seam choice):** do not invent a seam where callers are already few and direct. If three callers reach the old code and you have good tests, route them to new code in three commits — no facade needed. A seam introduced only to be deleted later is waste.

### Pitfall: the seam in the wrong place

The most common mistake is choosing a seam that sits *above* or *below* where the variation actually lives. If your slice condition needs information that the seam doesn't have (it was thrown away one layer up, or isn't computed until one layer down), you'll smuggle context through globals, thread-locals, or extra parameters — and that leakage will bite you. Put the seam exactly at the layer where (a) all calls pass through and (b) you have the data your divert condition needs.

---

## 2. Slice selection

A slice is the smallest meaningful unit you migrate at once. Two axes:

- **Slice by data** — route specific *inputs* to new code (digital-goods orders, customers in region EU, requests over $10k). Good when the new behavior should be identical and you want to limit blast radius by population.
- **Slice by behavior** — route a specific *step* to new code (the tax calc, the discount rule), keeping the rest old. Good when you're rebuilding the internals one responsibility at a time.

### How to size a slice

A good slice is:

- **Independently verifiable** — you can write a parity test for just this slice.
- **Independently routable** — the seam can select it without depending on other slices.
- **Small enough to revert in one flag flip** — if it's wrong, you lose minutes, not days.

Order the slices by **risk × frequency**. Migrate a *low-risk, high-frequency* slice first — it exercises the new path hard and proves the seam plumbing works while the cost of a mistake is low. Save the gnarly, rarely-hit edge case for when you trust the machinery.

```java
// Slicing by data: start with the safest, most common population.
public Decision evaluate(Application app) {
    if (flags.isOn("scoring.new") && app.isStandardConsumer()) {  // common + simple
        return newScorer.score(app);
    }
    return legacyScorer.score(app);   // everything else, incl. edge cases
}
```

> **When NOT to (slicing):** if you cannot find a slice that is independently verifiable and routable, the behavior is not separable, and the strangler doesn't fit. Don't fake a slice boundary that the domain doesn't have — you'll spend your time fighting shared state (see senior page).

---

## 3. Parity and shadow testing

Parity is the contract: *for the migrated slice, new output equals old output.* You establish it in three escalating tiers.

### Tier 1 — Characterization tests (offline)

Before you trust the new code, pin the old code's behavior with tests that assert *what it currently does*, not what it should do.

```java
@ParameterizedTest
@MethodSource("productionSamples")     // real inputs beat invented ones
void newMatchesLegacy(Input in) {
    assertEquals(legacy.run(in), next.run(in), TOLERANCE);
}
```

### Tier 2 — Shadowing (online, read-only)

Run new alongside old in production, return only old, log diffs.

```java
public Result handle(Request req) {
    Result authoritative = legacy.handle(req);
    if (flags.isOn("strangler.shadow")) {
        shadowExecutor.submit(() -> {              // off the hot path
            try {
                Result candidate = next.handle(req);
                diffRecorder.record(req, authoritative, candidate);
            } catch (Exception e) {
                diffRecorder.recordError(req, e);
            }
        });
    }
    return authoritative;
}
```

Run shadowing off the request thread so it can't slow or fail the real response. Record diffs with enough context (the input) to reproduce offline.

### Tier 3 — Canary divert (online, authoritative for a slice)

Now the new path *is* the answer for a small, flagged slice. Watch business metrics and the diff rate. Ramp 1% → 10% → 100%.

The progression matters: characterization proves you understand the old behavior, shadowing finds the inputs your tests missed, canary proves the new path is safe to make authoritative.

> **When NOT to shadow:** new code with side effects can't be run "just to compare" — it will write, charge, or send for real. Either make the new path side-effect-free during shadowing (compute, don't commit) or skip straight to a tiny canary with real rollback.

---

## 4. Feature-flagged routing in practice

The divert condition belongs in a flag, not a literal. But flagging has its own discipline:

- **One flag per slice**, named for the slice (`pricing.new-tax`), so you can ramp and roll back independently.
- **Default to old.** The safe state is the existing behavior.
- **Make the flag observable** — emit which path served each request so dashboards can show the split (see professional page).
- **Plan the flag's death.** Write a ticket to remove the flag *and the old branch* the moment the slice hits 100% and stays there.

```java
String path = flags.isOn("pricing.new-tax") ? "new" : "legacy";
metrics.counter("pricing.path", "impl", path).increment();
return "new".equals(path) ? withNewTax(order) : legacy.calculate(order);
```

---

## 5. Pitfalls

### Orphaned old code

The slice hit 100% months ago, but nobody deleted the old branch or the flag. Now every reader wonders if the dead path is still live, and every refactor has to consider it. **The delete is part of the work, not a someday cleanup.** A strangle that never deletes is just permanent duplication.

### Seam in the wrong place

Covered in §1 — the seam lacks the data the divert needs, so you leak context through back channels. Fix by relocating the seam, not by adding a thread-local.

### Parity assumed, not verified

"I'm pretty sure it's the same" is how you ship a rounding difference that under-charges every order for a week. Parity must be *demonstrated* by diff tests and a quiet shadow log, never assumed.

### Slice too big

You diverted "all of pricing" in one flag. Now a diff appears and you have 400 lines of new code to bisect. Small slices localize blame.

### Two paths drift

While both are live, a bug fix lands in only one. Now they genuinely differ and parity tests fail for the *right* reason but the *wrong* cause. Freeze the old path to fixes-only, and apply every fix to both until the old one is gone.

---

## 6. When NOT to use the strangler (middle view)

- A clean cutover is cheap and well-tested → cut over.
- No stable choke point and creating one is the whole project → reconsider; maybe characterize-and-replace.
- The transition will outlive the team's patience and double-maintenance dominates → cut over or shrink scope.
- The slices aren't separable → the pattern doesn't apply.

---

## Next

- Sibling **Branch by Abstraction** (`../01-branch-by-abstraction/`) — when one seam and a swap beat parallel implementations.
- Sibling **The Mikado Method** (`../03-mikado-method/`) — mapping the prerequisites for inserting a hard seam.
- The seam as Facade/Adapter: [Refactoring to Patterns: Structural](../../03-refactoring-to-patterns/03-structural/junior.md), and patterns [Facade](../../../design-patterns/02-structural/05-facade/junior.md) / [Adapter](../../../design-patterns/02-structural/01-adapter/junior.md).
- Carving behavior slices out of a class: [Moving Features Between Objects](../../02-refactoring-techniques/02-moving-features/junior.md).
- Continue to [senior.md](senior.md) for strangling a large subsystem and handling shared state.
