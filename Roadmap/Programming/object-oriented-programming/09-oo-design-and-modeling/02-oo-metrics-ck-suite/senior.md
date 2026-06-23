# OO Metrics — the CK Suite — Senior

> **What?** The senior view of metrics is mostly a study of their *failure modes*: where the 1994 definitions break down, what the empirical literature actually established (less than people claim), why thresholds are folklore, and how Goodhart's law turns a measurement program into a deception program. A senior engineer uses metrics, but never trusts them naively and never lets them become contracts.
> **How?** We dissect each metric's blind spots, review what the validation studies really found, examine the statistical traps (skewed distributions, threshold derivation, multicollinearity among CK metrics), and lay out the judgement calls that separate "metrics inform design" from "metrics dictate design".

---

## 1. The original paper's status — and its critics

Chidamber & Kemerer's *A Metrics Suite for Object Oriented Design* (IEEE TSE, 1994) was the first theoretically-motivated OO metric set, grounded in Wand & Weber's ontology and Bunge's measurement theory. Its lasting value is **conceptual**: it named six dimensions of OO structure and argued each tied to an external quality (defects, maintainability, reuse).

But the paper was attacked almost immediately, most famously by **Churcher & Shepperd (1995)**, who showed the *definitions are ambiguous* — "method", "coupling", and especially the LCOM counting rules admit multiple readings that produce different numbers on the same code. **Hitz & Montazeri (1996)** demonstrated LCOM1's pathologies (it can't distinguish a 2-component class from a 5-component one above its floor) and proposed the connected-components LCOM4. **Basili, Briand & Melo (1996)** ran the most-cited empirical validation: on student C++ projects, several CK metrics (notably WMC, CBO, RFC, DIT) correlated with fault-proneness — but the effect sizes were modest and the population was students, not production code.

The honest senior summary: **CK metrics are weakly-to-moderately predictive of defects, the definitions require pinning down per-tool, and no study established them as a fault *oracle*.** They're a flashlight, not an X-ray.

---

## 2. Each metric's blind spot

**WMC.** Method count and CC ignore *what the methods do*. Ten trivial getters score the same WMC as ten genuinely complex algorithms (unweighted), and CC misses data complexity entirely — a method with no branches but a 12-field calculation has CC 1 and is still hard. WMC also can't see *duplication*: ten copy-pasted methods inflate WMC honestly, but the real problem (DRY) is invisible.

**DIT.** Counts depth but not *quality*. A clean 5-deep Liskov-respecting hierarchy and a 5-deep refused-bequest mess score identically. DIT also can't see *interface* depth in tools that count classes only, and it treats framework-imposed depth (your class extends a 4-deep Spring base) as your sin.

**NOC.** A high NOC base can be excellent factoring *or* a switch-statement-in-disguise. NOC says nothing about whether the children honour the base contract — that's a Liskov question no metric answers.

**CBO.** Counts *number* of couplings, not *strength* (a single field read vs deep `Demeter`-violating chains score the same per coupled class) and not *direction* unless you split into fan-in/out. It also over-counts coupling to value types and stable abstractions, which are cheap, while under-emphasizing coupling to volatile concretes, which is expensive. **Connascence** (Page-Jones) captures the strength dimension CBO misses.

**RFC.** Conflates *the class's own size* with *its callees*, and the "one level deep" rule is arbitrary — a method calling a façade that fans out to 50 methods scores RFC small while a method calling 5 leaf methods scores higher, inverting the real complexity.

**LCOM.** Even LCOM4 is fooled by a single "god field" (a `context` or `state` object every method touches → one component → LCOM4 = 1 → "cohesive") and by methods that share state *transitively* through accessors rather than direct field access. Pure delegation classes (every method forwards to a collaborator, touching no field) score as maximally incohesive while being perfectly fine.

> The unifying blind spot: **every CK metric is syntactic.** It counts tokens and edges. Design quality is semantic — does the structure match the domain? No counter can see that.

---

## 3. Multicollinearity — the metrics aren't independent

The CK suite is sold as six orthogonal dimensions, but empirically WMC, RFC, and CBO are **strongly correlated** on real code (a big class tends to be big on all three). El Emam and others found that once you control for class size, much of CK's apparent predictive power evaporates — **size is a confound**. A senior implication: don't treat "this class is high on four metrics" as four independent pieces of evidence. It's often *one* fact (the class is large) measured four ways. The size-adjusted question — "is it *more* coupled/complex than its size predicts?" — is the discriminating one, and few dashboards ask it.

---

## 4. Where thresholds come from (mostly nowhere)

The numbers you see ("CBO < 10", "CC < 10", "DIT < 5") are **folklore with a thin empirical veneer**. McCabe's CC ≤ 10 was a recommendation in his 1976 paper, explicitly hedged ("the particular upper bound that has been used... is 10, although some have been as high as 15"). Most CK thresholds come from **percentile analysis of large corpora** (e.g. "the 90th percentile of CBO across these 100 projects is 14, so flag above 14") — which makes them *relative to the corpus*, not absolute truths. Some come from nothing but repetition.

The defensible way to set a threshold is **on your own codebase's distribution**: compute the metric across all classes, take a high percentile (90th–95th) as the "investigate" line, and re-derive it quarterly. A threshold imported from a blog post is calibrated to someone else's code.

---

## 5. Skewed distributions — why means lie

Metric distributions across a codebase are **heavily right-skewed**: most classes are small/low-coupling, a long tail is extreme. Consequences:

- **The mean is uninformative.** "Average CBO is 4.2" tells you nothing; the tail is where the bugs live. Report **percentiles and the top-N**, never the mean.
- **Thresholds should track percentiles, not fixed numbers**, precisely because the distribution shape differs by project (a UI-heavy project has structurally higher coupling than a library).
- **Aggregating up a tree distorts.** Summing class metrics to a package or module level lets a few monsters dominate and hides healthy classes. Look at distributions per level, not roll-up sums.

A senior reading of a metrics dashboard ignores the averages and goes straight to the worst-20 list and the *trend* of the worst-20.

---

## 6. Goodhart's law and the perverse-incentive failure mode

> **When a measure becomes a target, it ceases to be a good measure.** — Goodhart (via Strathern's formulation)

This is the dominant failure mode of metrics *programs* (as opposed to metrics *tools*). The mechanism is always the same: a gate is set, engineers optimize the gate, the gate is satisfied, the underlying quality is unchanged or worse.

Concrete perverse responses, each real:

| Gate                  | Perverse "fix"                                                        |
| --------------------- | -------------------------------------------------------------------- |
| LCOM must be low      | add a field every method touches; cohesion number drops, design same |
| CC per method ≤ 10    | extract branches into 1-line helper methods → CC moves, total complexity worse, RFC up |
| Class length ≤ 300    | split one class into three coupled fragments → CBO up, design worse  |
| Coverage ≥ 80%        | write assertion-free tests that execute lines                        |
| CBO ≤ 10              | bundle dependencies into a god "context" object → coupling hidden, not removed |

The pattern: **the metric is local and syntactic; the quality is global and semantic; optimizing the former at gunpoint degrades the latter.** The senior defense is to use metrics for *discovery and conversation*, never as *acceptance criteria*. A metric that can fail a build is a metric someone will game.

---

## 7. Connascence — the dimension CBO can't see

Page-Jones's **connascence** is the senior's mental model for coupling *strength*, which CBO (a count) ignores. Two components are connascent if changing one requires changing the other. Ordered weak→strong:

1. **Name** — agree on a name (rename both). Weakest.
2. **Type** — agree on a type.
3. **Meaning** — agree on a convention (0 = error).
4. **Position** — agree on argument order.
5. **Algorithm** — agree on an algorithm (hash both sides).
6. **Execution order** — must call in order.
7. **Timing** — must call within a time window.
8. **Value** — values must change together.
9. **Identity** — must reference the same instance. Strongest.

Two classes with **CBO 1** can be coupled by connascence of *identity* (catastrophic) or of *name* (trivial). CBO scores them identically. When CBO flags a class, connascence tells you whether the coupling is cheap or lethal — and whether to keep it local (strong connascence inside one module is fine; across modules it's a fire). This is why CBO is a *pointer*, never a verdict.

---

## 8. The instability/abstractness math has its own traps

Martin's `D = |A + I − 1|` is elegant but brittle:

- **Tiny packages** swing wildly. A package of 2 classes has A ∈ {0, 0.5, 1} only — `D` is quantized and noisy. Don't trust `D` below ~5 classes per package.
- **Generated and DTO packages** distort A (all concrete, A = 0) and I (often high Ca from being imported everywhere) and land in the zone of pain *by construction*, not by fault. Exclude or annotate them.
- **`A` counts abstract *types*, not abstract *surface*.** A package with one tiny interface and ten fat concrete classes can score A = 0.5 while being effectively concrete in everything that matters.
- **Cyclic dependencies** between packages (which the Acyclic Dependencies Principle forbids) make Ca/Ce mutually inflate; fix cycles before reading instability.

`D` is best used **comparatively and over time** on packages of meaningful size, not as an absolute pass/fail.

---

## 9. When metrics genuinely earn their keep

For all the skepticism, metrics have three uses where they're hard to beat:

1. **Triage at scale.** Ranking 10,000 classes to find the worst 20 is something no human can do and a tool does in seconds. This is the killer use.
2. **Trend detection.** A class whose CBO climbs steadily over releases is decaying; the *slope* is meaningful even when the absolute value isn't. Track deltas.
3. **Objectifying review disputes.** "It feels too coupled" → "CBO went 6 → 19 on this PR" turns a taste argument into a data point. Not a verdict, but a better conversation.

The thread through all three: metrics are best at **comparison** (this vs that, now vs then, top vs rest), worst at **absolute judgement** (is 12 too much?). Use them where comparison is the question.

---

## 10. Judgement calls a senior makes

- **Never gate a build on a single metric.** Gate on *direction* (no regression beyond a ratchet) at most, and even then with override.
- **Adjust for size before alarming.** "High CBO for its size" beats "high CBO".
- **Treat framework-imposed metrics as exempt** (DIT from Spring, CBO from JPA entity graphs).
- **Read combinations, never singles** — god class = WMC+CBO+RFC+LCOM together (see [`find-bug.md`](find-bug.md)).
- **Use connascence to weight CBO** — is the coupling name-level or identity-level?
- **Re-derive thresholds from your own distribution**, quarterly.
- **When a metric and your reading of the code disagree, the code wins.** The metric is the question; the code is the answer.

---

## 11. What's next

| Topic                                                  | File               |
| ------------------------------------------------------ | ------------------ |
| CI gates, ratchets, review scripts that don't backfire | `professional.md`  |
| Canonical sources and the empirical literature         | `specification.md` |
| Reading smells from real reports                        | `find-bug.md`      |
| Refactoring toward the main sequence                    | `optimize.md`      |

---

**Memorize this:** CK metrics are syntactic, weakly-to-moderately predictive, mutually correlated (size is the confound), and threshold-folklore-ridden. Their definitions need pinning per tool; their distributions are right-skewed so means lie and you read percentiles and trends. Their fatal program-level risk is Goodhart's law — any gateable metric gets gamed, degrading the quality it was meant to protect. CBO can't see coupling *strength* (use connascence for that); `D` is noisy on small packages. Use metrics for triage, trend, and objectifying disputes — comparison, not absolute judgement — and when metric and code disagree, the code wins.
