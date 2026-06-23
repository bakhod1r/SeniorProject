# Strangler Fig & Seams — Interview Questions

> **Category:** [Anti-Patterns at Scale](../README.md) → **Strangler Fig & Seams**
> **Covers (collectively):** Strangler Fig pattern · Seams · Branch by Abstraction · Characterization tests · Parallel-run / shadow & verification

A bank of 30+ interview questions and answers on replacing legacy code *incrementally* — without a rewrite and without a flag day. Each answer models the reasoning a strong staff-level candidate gives, including the trade-offs and the failure modes. Use the `<details>` toggles to self-quiz: read the question, answer out loud, then expand.

---

## Table of Contents

1. [Fundamentals](#fundamentals)
2. [Seams](#seams)
3. [Branch by Abstraction](#branch-by-abstraction)
4. [Characterization Tests](#characterization-tests)
5. [Parallel-Run, Shadow & Verification](#parallel-run-shadow--verification)
6. [Cutover, Flags & Cleanup](#cutover-flags--cleanup)
7. [Data Coexistence](#data-coexistence)
8. [Curveballs](#curveballs)
9. [Rapid-Fire](#rapid-fire)
10. [How to Talk About This in Interviews](#how-to-talk-about-this-in-interviews)
11. [Summary](#summary)
12. [Related Topics](#related-topics)

---

## Fundamentals

> The pattern, the metaphor, and why the alternative fails.

**Q1. What is the Strangler Fig pattern, and where does the name come from?**

<details><summary>Answer</summary>

The Strangler Fig pattern (named by Martin Fowler in 2004) replaces a legacy system *incrementally*: you grow the new implementation around the edges of the old one, redirect call sites or traffic to the new code piece by piece, and only delete the old code once nothing routes to it anymore. At every step the system is shippable and serving traffic — there is no "big bang" switchover.

The name comes from the strangler fig vine, which germinates in the canopy, sends roots down *around* a host tree, and gradually envelops it until the host dies and rots away, leaving the fig standing in its place. The metaphor is precise: the new system uses the old one as scaffolding while it grows, and the old one is removed only after it's fully encircled and load-bearing nowhere.
</details>

**Q2. Why do big-bang rewrites fail so often?**

<details><summary>Answer</summary>

Several compounding reasons:

- **No revenue during the rewrite.** You spend months building a replacement that, on day one, does *less* than the system it replaces, while the old system keeps accruing the very changes you're trying to escape — so you're chasing a moving target.
- **Hidden behavior is the actual spec.** Legacy systems encode years of undocumented edge cases, regulatory carve-outs, and "we did this because customer X complained" rules. A rewrite from the *visible* requirements silently drops them, and you discover each one as a production incident.
- **The cutover is one enormous, irreversible step.** All risk is concentrated at a single flag day; if anything is wrong you can't ship half of it, and rollback means throwing away months.
- **It never finishes.** Scope grows, the team gets reassigned to fight fires in the old system, and you end up maintaining *two* systems indefinitely.

Joel Spolsky's "Things You Should Never Do" is the canonical warning; the strangler fig is the disciplined alternative — many tiny reversible cutovers instead of one huge one.
</details>

**Q3. Strangler Fig vs. big-bang rewrite — what does each optimize for, and when (if ever) is big-bang right?**

<details><summary>Answer</summary>

Strangler Fig optimizes for **continuous value and bounded risk**: every increment ships, each cutover is small and reversible, and you can stop at any point with a working system. Its cost is *overhead* — you maintain a routing layer, run old and new in parallel for a while, and the migration takes longer in wall-clock time.

Big-bang optimizes for **a clean break** — no coexistence machinery, no dual maintenance, a single coherent new design. Its cost is *concentrated, irreversible risk*.

Big-bang is defensible only when the system is **small enough to rebuild in a sprint or two**, **disposable** (no users / easy to re-run), or **already being shut off** (you're decommissioning, not migrating live traffic). For anything large, long-lived, and revenue-bearing, strangler fig wins because the failure mode of big-bang — months of work that can't ship — is catastrophic, while strangler fig's failure mode is "this one increment didn't work, revert it."
</details>

**Q4. What is the relationship between Strangler Fig, Seams, and Branch by Abstraction?**

<details><summary>Answer</summary>

They operate at different scales but compose into one technique:

- **Seam** (Feathers) is the *smallest* unit — a place where you can swap behavior without editing the code in place. It's the enabling primitive: you can't redirect anything you can't intercept.
- **Branch by Abstraction** is the *mechanism* for swapping one *implementation* for another behind a seam, incrementally, on the mainline (no long-lived branch).
- **Strangler Fig** is the *strategy* — the overall plan of replacing a whole system by repeatedly applying seams + branch-by-abstraction (or HTTP-level routing) until the old system is dead.

In one sentence: you find a **seam**, use **branch by abstraction** to grow the replacement behind it, and repeat across the system until you've **strangled** the legacy.
</details>

**Q5. What roles do characterization tests and parallel-run play in a strangler migration?**

<details><summary>Answer</summary>

They're the two safety nets, used at different stages.

- **Characterization tests** pin the *current* behavior (bugs and all) *before* you touch anything, so any divergence your refactor introduces fails a test. They work when you can exercise the code in a test harness.
- **Parallel-run (shadow)** is the *production-grade* characterization test for behavior you can't fully reproduce offline: you run old and new on real traffic, compare outputs, and only cut over once they agree over a meaningful window. It catches the edge cases your offline tests never imagined.

Both answer the same question — "does the new code do what the old code did?" — one in CI, one in production.
</details>

---

## Seams

> Feathers' enabling primitive for swapping behavior.

**Q6. Define a "seam" precisely. What's the key property?**

<details><summary>Answer</summary>

Michael Feathers (*Working Effectively with Legacy Code*) defines a seam as **a place where you can alter behavior in your program without editing in that place**. The key property is the *enabling point*: somewhere — a constructor argument, a config flag, a link-time symbol — you can choose which behavior runs, without modifying the code at the seam itself.

The practical value: legacy code resists testing and replacement because it constructs its own dependencies inline. A seam lets you substitute a fake (to test) or a new implementation (to migrate) *from the outside*, which is the prerequisite for both characterization tests and branch by abstraction.
</details>

**Q7. Name the three seam types Feathers describes and give an example of each.**

<details><summary>Answer</summary>

- **Object seam** — you swap behavior by substituting an object, typically via an interface and dependency injection or method override. *Example:* `OrderService` takes a `Mailer` interface; in tests you pass a fake, in the migration you pass the new implementation. This is the most flexible and the one you should prefer in modern code.
- **Link seam** — you swap behavior at link/build time by providing a different binary, library, or symbol with the same name. *Example:* a test build links a stub `libpayments.so`; a Go build tag or a Python module shadowed via `PYTHONPATH`; swapping a JAR on the classpath. The enabling point is the build configuration, not the source.
- **Preprocessing seam** — you swap behavior before compilation, via macros or text substitution. *Example:* `#ifdef TEST` in C/C++ that redefines a symbol, or a macro that replaces `time()` with a test double. Rare outside C-family languages and generally a last resort.

The hierarchy of preference is object → link → preprocessing: object seams are visible, testable, and don't require touching the build or a preprocessor.
</details>

**Q8. You inherit a function that calls `time.Now()` and a real database inline. How do you introduce a seam without rewriting it?**

<details><summary>Answer</summary>

Introduce **object seams** by extracting the hard-coded dependencies into injected interfaces — the smallest possible change first.

```go
type Clock interface{ Now() time.Time }
type Store interface{ Save(r Record) error }

type Service struct {
    clock Clock
    store Store
}
```

The function now reads `s.clock.Now()` and `s.store.Save(...)` instead of `time.Now()` and a literal `sql.DB`. The enabling point is `Service`'s constructor: production wires the real clock and store; tests wire a `fixedClock` and an in-memory store. Crucially, this is a *behavior-preserving* change — the production path is identical — so it's safe to ship on its own before you characterize or migrate. If you can't even change the constructor (e.g. a static call buried deep), a link or preprocessing seam is the fallback, but reach for the object seam first.
</details>

**Q9. Why prefer an object seam over a link or preprocessing seam?**

<details><summary>Answer</summary>

Object seams are **visible in the source, type-checked, and require no special build**. A reader sees the interface and the injection and understands the substitution point. Link seams hide the swap in build configuration — easy to get wrong, invisible to someone reading the code, and they make "why is this different in CI?" a debugging session. Preprocessing seams (macros) are worse still: they fork the source the compiler actually sees, so the code you test isn't the code that ships, and they're a fertile source of "works on my machine."

You use link/preprocessing seams only when you *can't* introduce an object seam — typically legacy C/C++ or a static call you cannot route around without a larger refactor. In a language with interfaces and DI, the object seam is almost always reachable.
</details>

---

## Branch by Abstraction

> Replacing an implementation behind a seam, on the mainline.

**Q10. What is Branch by Abstraction, and why is it called that when you don't create a branch?**

<details><summary>Answer</summary>

Branch by Abstraction is a technique for replacing one implementation of something with another *gradually, on the mainline*, by introducing an abstraction layer that both the old and new implementations sit behind. You migrate callers to the abstraction, build the new implementation behind it, flip the abstraction to the new one, and remove the old.

The "branch" is a metaphor: the abstraction creates a *logical* fork (old impl vs. new impl) that lives in the code via the abstraction layer, not in version control via a long-lived feature branch. That's the whole point — it lets large changes happen on `main` with continuous integration, avoiding the merge hell and integration cliff of a months-long feature branch.
</details>

**Q11. Walk through the steps of Branch by Abstraction in order.**

<details><summary>Answer</summary>

1. **Introduce an abstraction** over the thing you want to replace — an interface that captures how callers currently use the legacy implementation.
2. **Route the existing callers through the abstraction**, still backed by the *old* implementation. Ship this; behavior is unchanged. (This is the patient, often-largest step.)
3. **Build the new implementation behind the same abstraction**, in parallel. The old one is still the one running.
4. **Swap callers to the new implementation** — often behind a flag, often a few at a time, with verification (tests, then parallel-run) at each move.
5. **Remove the old implementation** once nothing routes to it.
6. **Remove the abstraction itself** *if* it was only scaffolding and no longer earns its keep (sometimes it stays as a genuine seam).

The discipline: every step is independently shippable and reversible, and `main` is always releasable.
</details>

**Q12. In Branch by Abstraction, why is "move all callers onto the abstraction" usually the hardest and most valuable step?**

<details><summary>Answer</summary>

Because it's where the legacy *coupling* actually lives. The old implementation is rarely called through one clean entry point — callers reach into its internals, depend on its concrete types, pass its objects around, and rely on quirks of its API. Routing them all through a narrow abstraction forces you to discover and sever every one of those tendrils, which is tedious and surprising (you find call sites nobody knew existed).

It's the most valuable step because once it's done, the swap in step 4 is trivial — flip one wiring point — and *reversible*. All the risk and discovery is front-loaded into a behavior-preserving step you can ship and verify incrementally. If you skip straight to building the new implementation, you discover the missed couplings at cutover, which is exactly when you don't want surprises.
</details>

**Q13. How does Branch by Abstraction differ from a feature flag, and how do they combine?**

<details><summary>Answer</summary>

They're orthogonal and usually used together. **Branch by Abstraction** is the *structural* technique — the interface that lets two implementations coexist behind one calling convention. A **feature flag** is the *runtime switch* that decides, per request or per environment, *which* implementation the abstraction resolves to.

The abstraction makes the swap *possible* (both impls present, callers decoupled); the flag makes the swap *controllable and reversible at runtime* (ramp 1% → 50% → 100%, flip back instantly on a bad metric, run new for some tenants and old for others). Without the abstraction the flag has nothing clean to switch between; without the flag the abstraction can only be swapped by a redeploy. Together you get incremental structure plus incremental rollout.
</details>

**Q14. Show a minimal Branch-by-Abstraction skeleton with a flag in code.**

<details><summary>Answer</summary>

```go
// Step 1: the abstraction both implementations satisfy.
type Pricer interface {
    Price(cart Cart) Money
}

type legacyPricer struct{ /* wraps the old in-place logic */ }
type newPricer struct{ /* the replacement */ }

// Step 4: route through the abstraction; a flag picks the impl.
type routingPricer struct {
    old, new Pricer
    flags    FlagStore
}

func (r routingPricer) Price(cart Cart) Money {
    if r.flags.Enabled("new_pricer", cart.TenantID) {
        return r.new.Price(cart)
    }
    return r.old.Price(cart)
}
```

Callers depend only on `Pricer`. The flag controls the ramp; flipping it off is an instant rollback with no deploy. Once `new_pricer` is at 100% with zero incidents over the bake window, you delete `legacyPricer`, the flag, and `routingPricer`, leaving callers pointed straight at `newPricer`.
</details>

---

## Characterization Tests

> Pinning what the code *does*, not what it *should* do.

**Q15. What is a characterization test, and how does it differ from a specification test?**

<details><summary>Answer</summary>

A **characterization test** asserts what the code *currently does* — its observed behavior, including bugs and quirks — captured by running it and recording the actual output. A **specification test** asserts what the code *should do* per the requirements.

The difference matters because of *intent*. A spec test that fails means the code is wrong. A characterization test that fails means the *behavior changed* — which, during a refactor or migration, is exactly the alarm you want, because your goal is to *not* change behavior. You write characterization tests precisely when you *don't have* a trustworthy spec for legacy code and need a safety net before you touch it. They freeze the current behavior so the strangler migration can prove it preserved it.
</details>

**Q16. Why might a characterization test assert a behavior you believe is a bug?**

<details><summary>Answer</summary>

Because the test's job is to detect *change*, not to bless *correctness*. If the legacy system rounds a particular tax calculation "wrong," real consumers may already depend on that exact number — downstream reports reconcile to it, customers have been invoiced with it. If your characterization test asserts the "correct" value instead of the actual one, it won't fail when your new code reproduces the legacy bug, and it *will* fail (misleadingly) when your new code is faithful — so it can't protect the migration.

You pin the quirk *as it is*, migrate faithfully, and only *then* — as a separate, deliberate, separately-reviewed behavioral change — fix the bug. Fixing it during the migration conflates two changes and destroys the test's signal.
</details>

**Q17. How do you write a characterization (golden-master) test for messy code you don't fully understand?**

<details><summary>Answer</summary>

1. **Find or create a seam** so you can call the code in isolation and capture its output.
2. **Generate a wide spread of inputs** — realistic ones (sampled or replayed from production) plus boundary and adversarial values — because you don't know which paths matter, so you cover broadly.
3. **Run the legacy code and record the output** — the "golden master." For complex output, serialize it (JSON/snapshot) rather than hand-writing expected values.
4. **Assert future runs match the golden master.** Now any change of behavior — yours or anyone's — fails loudly.
5. **Iterate coverage:** use a coverage tool to find branches the golden inputs miss, and add inputs until the important paths are exercised.

The technique is sometimes called *golden master* or *approval testing*. You're not trying to understand the code first — you're building a net so you can change it *safely* and *then* understand it.
</details>

**Q18. What are the limits of characterization tests, and what do you reach for when you hit them?**

<details><summary>Answer</summary>

Their limits: they only pin behavior you actually *exercise*, so they can't cover input combinations you never generate — and for legacy code with vast or stateful input spaces, offline tests will always miss real-world edge cases. They also struggle with nondeterminism (time, randomness, external services) unless you've introduced seams to control it, and with side effects that are hard to capture (a fire-and-forget email).

When you hit those limits you escalate to **parallel-run / shadow in production**: real traffic *is* the input distribution you couldn't enumerate, and comparing old vs. new on live requests catches the cases your golden master never imagined. Characterization tests are the cheap first net; parallel-run is the expensive, comprehensive one you graduate to before cutover.
</details>

---

## Parallel-Run, Shadow & Verification

> Comparing old and new on real traffic before you trust the new path.

**Q19. What is a parallel run (a.k.a. shadow), and what does it prove?**

<details><summary>Answer</summary>

A parallel run executes **both** the old and the new implementation for the same input — typically the old one's result is *served* to the user (it's still the source of truth) while the new one runs *alongside* and its result is *compared and logged but not used*. Over a window of real traffic you accumulate evidence about how often, where, and how the two diverge.

It proves the thing offline tests can't: that the new implementation reproduces the old one's behavior across the *actual* production input distribution, including the long tail of edge cases nobody documented. Zero (or fully-understood) divergence over a meaningful window is the green light to cut over. GitHub's `Scientist` library is the canonical packaging of this idea.
</details>

**Q20. What's the difference between shadowing (mirroring) and a "scientist"-style parallel run?**

<details><summary>Answer</summary>

Both run the new path without trusting it, but they differ in *where* and *what they compare*.

- **Traffic shadowing / mirroring** is usually done at the infrastructure layer (load balancer, service mesh, or a sidecar): a copy of each request is sent to the new service, whose response is discarded. It's great for load/perf validation and smoke-testing the new service end-to-end, but the mirror often can't easily *compare* responses or guarantee the same side effects are suppressed.
- **A "scientist"-style parallel run** is in-process: you call `old()` and `new()` from the same code, with the old result returned and the new result *compared field-by-field* against it, mismatches reported with context. It gives precise correctness comparison but requires the new code to be callable in-process and side-effect-safe.

Use mirroring for whole-service shadowing and load; use scientist-style for fine-grained correctness verification of a unit you're stranglerig.
</details>

**Q21. A parallel run will double the work done per request. How do you keep it from wrecking latency and cost?**

<details><summary>Answer</summary>

The cardinal rule: **the shadow must not be on the critical path.**

- **Run the new path asynchronously / off the hot path.** Return the old result immediately; dispatch the comparison to a background goroutine, thread pool, or queue so the user never waits on the new code.
- **Sample.** You rarely need 100% of traffic to gain confidence — compare 1–5% (more for rare code paths), which slashes the added CPU and cost while still surfacing divergences.
- **Bound and isolate it.** Time-out and rate-limit the shadow, run it on separate capacity if it's heavy, and make it *fail open* — a shadow error must never affect the served request.
- **Compare cheaply.** Hash or diff outputs off-path; only persist mismatches, not every comparison.

If you instead call old *and* new synchronously inline and compare before responding, you've added the new path's latency to every request and doubled its blast radius for failures — which is exactly the anti-pattern this topic's `optimize.md` dismantles.
</details>

**Q22. How do you handle side effects (writes, emails, charges) during a parallel run?**

<details><summary>Answer</summary>

You must **suppress the new path's side effects** while it's shadowing, or you'll double-charge cards and double-send emails. Techniques:

- **Inject no-op / recording collaborators** into the new implementation so its "send email" and "save row" go to a fake that records what *would* have happened, which you then compare against the old path's intended effects.
- **Run the new path in a transaction that's always rolled back** for database writes, so you exercise the real query path without persisting.
- **Compare the *intended* effect, not the executed one** — capture the command the new code would issue and diff it against the old code's command.

The old path remains the only one allowed to actually mutate the world. Getting this wrong is the most dangerous failure mode of shadowing, because it turns a read-only verification into real, duplicated production actions.
</details>

**Q23. The parallel run reports a 0.3% mismatch rate. How do you decide whether you're safe to cut over?**

<details><summary>Answer</summary>

A nonzero mismatch rate isn't automatically a blocker — you have to *classify* the mismatches:

- **Triage by cause.** Bucket mismatches and inspect samples. Are they (a) genuine bugs in the new path, (b) the new path *correctly* fixing a legacy bug, (c) nondeterminism the comparison should ignore (timestamps, map ordering, floating-point noise), or (d) flaky inputs (the old path itself is nondeterministic)?
- **Fix or whitelist.** Real bugs (a) block cutover until fixed. Intentional improvements (b) are documented and accepted. Noise (c) means your *comparator* is wrong — normalize it. Flakiness (d) means the behavior was never deterministic, which you note.
- **Re-measure.** After fixing/normalizing, the residual unexplained mismatch rate should approach zero, or every remaining case should be explained.

You cut over when **every mismatch is understood**, not merely when the rate is "low." An unexplained 0.3% is 0.3% of users getting surprised in production; an explained-and-accepted 0.3% is a decision.
</details>

---

## Cutover, Flags & Cleanup

> Flipping traffic, and the discipline of finishing.

**Q24. What role do feature flags play across the strangler lifecycle?**

<details><summary>Answer</summary>

Feature flags are the **runtime control plane** for the migration. They let you: ramp traffic to the new path gradually (1% → 10% → 100%) instead of an all-at-once flip; target subsets (per-tenant, per-region, internal-users-first); roll back *instantly* without a deploy when a metric goes bad; and run the new path in *shadow* (compute it, don't serve it) before ever serving it.

The crucial discipline: a strangler flag is *temporary scaffolding*, not a permanent config knob. It exists to de-risk the cutover and is meant to be deleted — together with the old code path — the moment the new path owns 100% of traffic with confidence. (See Q31.)
</details>

**Q25. When is it safe to delete the old code path?**

<details><summary>Answer</summary>

When you have *evidence* it is no longer used and no longer needed, not just a belief:

1. **100% of traffic on the new path** for a meaningful bake window — long enough to span the rare flows (monthly/quarterly jobs, regional peaks, that one customer's batch on the 1st).
2. **Parallel-run divergence understood and resolved**, so you know new == old (or differs only intentionally).
3. **No code routes to the old path** — the flag is fully on and nothing else references the old implementation (grep, dead-code analysis).
4. **Rollback no longer needed** — you've decided the new path is committed, and you're past the window where you'd want to flip back.

Then delete the old implementation, the routing/flag, and the now-dead scaffolding *together*, in their own commit, citing the evidence. Git keeps the history if you ever need it.
</details>

**Q26. Why is deleting the old path *and the flag* a required step, not an optional cleanup?**

<details><summary>Answer</summary>

Because a strangler migration that stops at "new path is at 100%, flag left on, old code still present" hasn't actually *finished* — it's left the codebase in a permanently worse state: two implementations to read and maintain, a flag that suggests the old path is still reachable (so people keep it working), and the old code fossilizing into **Lava Flow** (dead code nobody dares delete) behind a stuck-on flag.

The payoff of the whole exercise — a simpler, single-implementation system — is only realized at deletion. Stopping short means you paid all the cost of coexistence (routing, dual maintenance, shadow infra) and banked *none* of the benefit. Mature teams treat a stale migration flag and an unremoved old path as a tracked bug, not an acceptable end state.
</details>

**Q27. What is the "never-finishing migration" risk, and how do you defend against it?**

<details><summary>Answer</summary>

The risk: the migration reaches "good enough" — the new path handles 95% of cases, the team is reassigned to features, and the last 5% (the gnarly edge cases that were the *reason* the old system was hard) never get migrated. The flag stays half-on forever, both systems live indefinitely, and you've *added* complexity rather than removed it. This is the most common way strangler migrations fail — not with a bang but by stalling.

Defenses: **track the migration to completion as a first-class deliverable** (a burndown of remaining call sites / traffic %, owned by someone); **make the old path increasingly painful to keep** (don't let new features build on it; let the routing/shadow infra add visible cost); **set a deletion deadline with the flag**; and **front-load the hard cases** — migrate the gnarly 5% *early* while motivation and context are high, not last. "We strangled 95%" is not done; the value is in the final deletion.
</details>

**Q28. How do you sequence cutover across many call sites or tenants to minimize blast radius?**

<details><summary>Answer</summary>

Order by *risk and reversibility*, smallest blast radius first:

1. **Internal / synthetic traffic first** — dogfood with no customer exposure.
2. **Lowest-stakes real traffic next** — a small, tolerant tenant or a non-critical endpoint, so a problem affects few and is loud.
3. **Ramp by percentage** within each cohort (1% → 10% → 50% → 100%), watching error rate, latency, and business metrics at each step with automatic rollback on regression.
4. **Riskiest / highest-value cohorts last**, once the new path has proven itself on everyone else.

Each step is a flag change you can reverse in seconds. The principle is the same as a canary deploy: expose the new path to *more* traffic only after it's earned trust on *less*, so the maximum number of users any single mistake can affect stays bounded.
</details>

---

## Data Coexistence

> When old and new must share state, not just behavior.

**Q29. Behavior is one thing — but what makes *data* coexistence the hard part of a strangler migration?**

<details><summary>Answer</summary>

Code can be swapped behind an abstraction and rolled back instantly; **data persists and is shared**. While old and new code coexist, they often read and write the *same* underlying state, and you must keep that state consistent across two code paths that may model it differently. The hard problems:

- **Dual writes.** If both paths write, an update through one must be visible to the other, and a crash between two writes can leave them inconsistent.
- **Schema drift.** The new path may want a new schema; the old path expects the old one. They have to agree during coexistence.
- **No instant rollback for data.** You can flip a flag back to the old code in a second, but data the new path already wrote in the new shape doesn't un-write itself. Rollback safety requires the data to remain readable by *both* paths.

This is why data migrations use **expand-contract / parallel change** (see [`../06-expand-contract-refactors/`](../06-expand-contract-refactors/junior.md)): evolve the schema additively so both old and new read/write it, migrate the data, and only remove the old shape after the old code is gone.
</details>

**Q30. How do dual-write and dual-read help old and new coexist on shared data?**

<details><summary>Answer</summary>

They're the data analogue of running old and new code in parallel.

- **Dual-write:** during coexistence, writes go to *both* the old store/shape and the new one (ideally transactionally, or with reconciliation if not), so whichever code path reads, the data is there. This lets you backfill and keep the new store current while the old is still authoritative.
- **Dual-read with comparison:** reads fetch from both and compare (the data-layer shadow), surfacing divergence between the stores before you trust the new one — exactly the parallel-run idea applied to persistence.

The sequence: expand the schema additively → dual-write so new data lands in both shapes → backfill historical data → dual-read/compare to verify → flip reads to the new shape → stop dual-writing → contract (drop the old shape) once the old code is gone. Each step is reversible because both shapes remain readable until the final contract.
</details>

**Q31. What's the danger of dual-write, and how do you make it safe?**

<details><summary>Answer</summary>

The danger is **partial failure**: you write the old store successfully, then the write to the new store fails (or the process crashes between them), leaving the two permanently inconsistent — and now you have data corruption that's worse than the legacy you were escaping.

Making it safe:

- **Designate one store as the source of truth** during coexistence (usually the old one), so on conflict there's an unambiguous winner.
- **Make the second write idempotent and reconcilable** — log intended writes and run a background reconciler that detects and repairs drift, rather than relying on both writes always succeeding atomically.
- **Prefer a single transaction** if both shapes live in the same database (the easy case); use the outbox pattern or change-data-capture if they don't, so the second write is derived from a durable record of the first rather than a best-effort second call.
- **Continuously compare** (dual-read) and alert on divergence, so inconsistency is caught in hours, not discovered during the final cutover.

The goal is that a failure leaves you *recoverable*, never silently split-brained.
</details>

---

## Curveballs

> The questions designed to catch glib answers.

**Q32. "We'll just rewrite it cleanly and switch over a weekend." What's your response?**

<details><summary>Answer</summary>

Agree with the *desire* (a clean system) and push back on the *plan* (the weekend flag day). The risks: the rewrite has to reproduce years of undocumented behavior you'll only discover in production; for the whole rewrite period you ship no value while the old system keeps changing; and the cutover concentrates all risk into one irreversible step with no partial rollback. If anything's wrong Monday morning, you can't ship 80% of it — you're either fully on the broken new system or fully reverted to wasted months.

Counter-proposal: strangler fig. Find a seam, branch by abstraction, characterize behavior, run old and new in parallel on real traffic, ramp with a flag, and cut over a slice at a time — each step shippable and reversible. It takes longer in wall-clock but the *risk-adjusted* delivery is far better, and you can stop at any point with a working system. The weekend rewrite optimizes for a clean break and bets the company on a single switch.
</details>

**Q33. Isn't all this coexistence machinery — routing layer, flags, parallel run — itself added complexity and risk?**

<details><summary>Answer</summary>

Yes, and that's the honest trade-off: strangler fig *temporarily* adds complexity (a routing/abstraction layer, flags, shadow infrastructure, dual maintenance) to *avoid* the concentrated risk of a big-bang cutover. The key word is **temporary** — that scaffolding is meant to be deleted at the end, and a migration that fails to remove it banks the cost without the benefit (Q26, Q27).

So the technique is right when the system is large/long-lived enough that big-bang's concentrated risk dominates the coexistence overhead — which is most production systems. For a tiny, disposable system it's over-engineering: just rewrite it. The mature answer names the cost rather than pretending the strangler is free, and ties the choice to the size and risk of the specific system.
</details>

**Q34. The new implementation matches the old one on the parallel run *except* it fixes a real bug. Do you ship that difference?**

<details><summary>Answer</summary>

Not as part of the migration. The strangler's contract is *behavior preservation*, and the parallel run's job is to prove new == old. If you let the new path also fix a bug, you've bundled two changes: now a mismatch could mean "the migration broke something" *or* "the bug fix is acting up," and you've lost the clean signal that makes cutover safe. Worse, downstream consumers may depend on the buggy output, so the "fix" could break reconciliation elsewhere.

Ship the migration first, faithfully reproducing the bug (the characterization test pins it). Then, as a *separate, independently reviewed, independently rolled-out* behavioral change, fix the bug — now with the new code as the single clean place to do it, and its own verification. Separate structural from behavioral change, always.
</details>

**Q35. When is the *right* call to NOT strangle, and instead leave the legacy alone?**

<details><summary>Answer</summary>

When the migration's cost exceeds its benefit. Concretely: the legacy component is **stable and rarely changed** (its change-cost is near zero, so there's nothing to gain), it's **slated for decommission** anyway, or you **can't establish any safety net** (no seam, no characterization, no way to parallel-run) and the system is too critical to touch blind. Also when there's **no clear first seam** — if you can't carve off a cohesive slice, you're not ready, and forcing it produces a worse tangle.

The strangler is for code that *changes often*, *actively impedes the roadmap*, and *can be migrated safely in slices*. Reflexively strangling everything is its own anti-pattern; prioritize by change-frequency × pain (see [`../03-hotspot-analysis/`](../03-hotspot-analysis/junior.md)).
</details>

---

## Rapid-Fire

> Crisp answers; what an interviewer wants in one or two sentences.

**Q36. Strangler Fig in one sentence?**

<details><summary>Answer</summary>

Replace a legacy system incrementally by growing the new one around it and redirecting traffic piece by piece, deleting the old only once nothing routes to it.
</details>

**Q37. Seam in one sentence?**

<details><summary>Answer</summary>

A place where you can change behavior without editing the code there — the enabling point (constructor, link, or macro) that lets you substitute an implementation from outside.
</details>

**Q38. The three seam types?**

<details><summary>Answer</summary>

Object (swap via interface/injection), link (swap at build/link time), preprocessing (swap via macro before compile). Prefer object.
</details>

**Q39. Characterization test vs. spec test?**

<details><summary>Answer</summary>

Characterization pins what the code *does* now (bugs included) to detect *change*; spec asserts what it *should* do to detect *wrongness*.
</details>

**Q40. The single rule for parallel-run latency?**

<details><summary>Answer</summary>

Keep the shadow off the critical path — run new async, sample a fraction, compare off-path, suppress its side effects.
</details>

**Q41. The most common way strangler migrations fail?**

<details><summary>Answer</summary>

They never finish — the new path handles 95%, the team moves on, the flag stays half-on, and both systems live forever. The value is in the final deletion.
</details>

**Q42. Why is data coexistence harder than code coexistence?**

<details><summary>Answer</summary>

Code rolls back instantly behind a flag; data persists and is shared, so a flip-back can't un-write what the new path already stored — both paths must keep the data mutually readable (expand-contract, dual-write/read).
</details>

---

## How to Talk About This in Interviews

A few habits separate a strong answer from a recital:

- **Lead with the failure mode you're avoiding.** Don't just say "strangler fig." Say *why* — "a big-bang rewrite concentrates all risk into one irreversible cutover and ships no value for months; strangler fig trades that for many tiny reversible cutovers." Interviewers want the reasoning.
- **Name the safety net at each stage.** Characterization tests in CI, parallel-run in production, flags for instant rollback. This proves you've done it for real, not read about it.
- **Always name the cost.** Coexistence machinery is real added complexity; the technique is right *because* the alternative's risk is worse, and the scaffolding must be deleted at the end. "It depends on the system's size and churn" beats absolutism.
- **Insist on finishing.** Mention the never-finishing risk unprompted and how you'd track the migration to deletion. Knowing that the value is in the final cleanup is a strong staff-level signal.
- **Separate structural from behavioral.** Migrate faithfully (reproduce bugs and all), then fix bugs as a separate change. Mixing them destroys the parallel-run signal.
- **Go to the data layer when pushed.** Behavior coexistence is the easy half; dual-write/dual-read, expand-contract, and partial-failure recovery are where senior depth shows.
- **Use a concrete example.** "We strangled a 4k-line `BillingEngine` over a quarter — extracted the tax seam, branch-by-abstraction behind a flag, scientist-style parallel run at 5% sampling, ramped, deleted the old path" lands far harder than definitions.

---

## Summary

- **Strangler Fig** replaces legacy *incrementally* — grow the new around the old, redirect piece by piece, delete the old once nothing routes to it — avoiding the concentrated, irreversible risk of a big-bang rewrite.
- **Seams** (object > link > preprocessing) are the enabling primitive that lets you substitute behavior from outside; **Branch by Abstraction** uses a seam to grow a replacement on the mainline (abstraction → move callers → new impl → swap → remove old → remove abstraction).
- **Characterization tests** pin current behavior (bugs and all) in CI to detect *change*; **parallel-run / shadow** is the production-grade version that compares old vs. new on real traffic before cutover — kept off the critical path, sampled, with side effects suppressed.
- **Feature flags** are the runtime control plane for ramping and instant rollback; the discipline is to **finish** — delete the old path *and* the flag together, or you bank the coexistence cost with none of the benefit (the never-finishing-migration risk).
- **Data coexistence** is the hard half: shared, persistent state can't roll back like code, so old and new must keep it mutually readable via expand-contract and dual-write/dual-read, with partial-failure recovery designed in.
- The strongest answers lead with the failure mode avoided, name the safety net at each stage, acknowledge the temporary complexity cost, and insist the migration is only done at the final deletion.

---

## Related Topics

- [`senior.md`](senior.md) — running a strangler migration across a real codebase.
- [`tasks.md`](tasks.md) · [`find-bug.md`](find-bug.md) · [`optimize.md`](optimize.md) — practice the seams, the verification, and the cleanup.
- [Expand-Contract Refactors](../06-expand-contract-refactors/junior.md) — the contract/data-evolution mechanics underneath safe coexistence.
- [Hotspot Analysis](../03-hotspot-analysis/junior.md) — choosing *which* legacy to strangle first (change-frequency × pain).
- [Architecture Fitness Functions](../01-architecture-fitness-functions/junior.md) — keeping the new shape from drifting back after you've strangled the old.
- [Architecture → Anti-Patterns](../../../../../Architecture/anti-patterns/README.md) — the system-level siblings (Big Ball of Mud, Distributed Monolith).
