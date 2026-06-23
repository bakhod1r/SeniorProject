# Tidy First — When and How — Senior Level

> **Source:** Kent Beck, *Tidy First?* (O'Reilly, 2023), Parts I–III. This level treats the *why* — separability, reviewability, risk, and the coupling/cohesion economics underneath the practice.

---

## Table of Contents

1. [Structure and behavior as separable changes](#structure-and-behavior-as-separable-changes)
2. [Why small reversible steps reduce risk](#why-small-reversible-steps-reduce-risk)
3. [Reviewability as a first-class property](#reviewability-as-a-first-class-property)
4. [The deep why: coupling and cohesion](#the-deep-why-coupling-and-cohesion)
5. [The WHEN decision: First / After / Later / Never](#the-when-decision-first--after--later--never)
6. [When tidying is premature](#when-tidying-is-premature)
7. [Tidying as optionality (bridge to economics)](#tidying-as-optionality-bridge-to-economics)
8. [Worked analysis: a coupling-driven tidying](#worked-analysis-a-coupling-driven-tidying)
9. [Diagrams](#diagrams)
10. [Related Topics](#related-topics)

---

## Structure and behavior as separable changes

The entire discipline rests on one claim: **a change to structure and a change to behavior are two different *kinds* of change, and they can — and should — be performed separately.**

This is not obvious. In the moment, "clean this up and add the feature" feels like one task. Beck's insight is that they have *different risk profiles, different verification methods, and different review needs*, so fusing them is a category error:

| Property | Structure change | Behavior change |
|---|---|---|
| **What changes** | The arrangement of code | The observable output / effect |
| **Verified by** | Existing tests passing *unchanged* | New or changed tests |
| **Risk** | Low and bounded | Unbounded — could be a production incident |
| **Review focus** | "Is it really behavior-preserving?" | "Is this the *right* behavior?" |
| **Reversibility** | Trivial | Often entangled with data/migrations |

Because verification differs, the *evidence* that a change is correct differs. For a structure change, the evidence is "the test suite is green and untouched." For a behavior change, the evidence is "a new test pins the new behavior." When you merge the two, you destroy both evidences: the green-and-untouched signal is gone (tests changed), and the new test is buried in noise.

> **Key idea:** Separability is the senior insight. Structure and behavior are *orthogonal axes* of change. Move along one axis at a time and each move stays cheap to verify, review, and reverse. Move diagonally and you forfeit all three.

A subtle consequence: the *order* along the structure axis is yours to choose freely, because each step is behavior-preserving. You can reorder, batch, or interleave tidyings however reads best, with no risk to behavior. That freedom is what makes "Tidy First" a *design* activity, not mere janitorial work — you are reshaping the code to make a future behavior change cheap.

---

## Why small reversible steps reduce risk

Risk in software change is roughly **probability of defect × cost of recovery**. Small, reversible, structure-only steps attack both factors.

**They lower probability.** A change you can hold entirely in your head, often performed by an IDE's mechanical refactoring, has a vanishing defect rate. The error surface of "rename `x` to `total` via Extract Variable" is essentially zero. Contrast a 400-line hand-edit where behavior and structure intermingle — the defect probability climbs with every line a human typed.

**They lower recovery cost.** Reversibility is the property that a change can be undone cheaply. A small structure commit with no test changes and no migration can be `git revert`-ed with confidence, in seconds, with no collateral. Large or mixed commits lose this: reverting them also reverts the feature, or the schema change, or three other things that have since shipped.

A useful way to see the asymmetry: defect probability tends to grow *faster than linearly* with change size, because the number of interactions between edited lines grows combinatorially. Splitting a change of size *S* into *k* steps of size *S/k* doesn't just divide the risk by *k* — it divides it by something closer to *k²*, because each small step has far fewer internal interactions to get wrong. That superlinear payoff is the quantitative core of "small steps."

There's a compounding effect. A sequence of *N* tiny reversible steps is far safer than one big step covering the same ground, because:

- At every step the system is **green and shippable**. You can stop, ship, or hand off at any boundary.
- A regression is **localized** to the last step, so `git bisect` pinpoints it precisely.
- Cognitive load stays **flat** — you reason about one move, not the cross-product of all moves at once.

```
  ONE BIG STEP:    [────────── 400 lines, mixed ──────────]   one all-or-nothing leap
                    risk ~ size², revert = catastrophe

  MANY TINY STEPS: [tidy][tidy][tidy][   feat   ]            ship-able at every │
                    each step verifiable, revert = surgical
```

> **Key idea:** Reversibility is the quiet superpower. The reason to keep steps small is not tidiness — it's that small reversible steps convert a risky leap into a series of safe, individually-checkpointed hops, each of which leaves the system shippable. (See [`../../refactoring/`](../../refactoring/) for the "always-green" mechanics.)

---

## Reviewability as a first-class property

Code review is the bottleneck for most teams' change throughput, and a structure/behavior tangle is its worst enemy. The senior reframing: **reviewability is a property you design *into* a change set, and separating structure from behavior is the primary lever.**

A reviewer of a mixed PR faces an impossible task — for every line they must answer *two* questions at once: "did this preserve behavior?" and "is the new behavior right?" They can't trust the test suite (it changed), so they must mentally simulate the old and new code. This is slow, error-prone, and exactly why big PRs sit for days and then get a perfunctory LGTM.

Split the same work and review becomes tractable:

- **Structure-only PR:** the reviewer's single question is "is this behavior-preserving?" Often they can answer it by noting *the tests are unchanged and green* plus *every change is a known refactoring*. Approve in under a minute.
- **Behavior PR (built on the tidied base):** small, because the runway is clear. The reviewer reads the genuinely new logic and its new test. Their attention lands where it matters.

The throughput math is real: two PRs that each review in 2 minutes beat one PR that reviews in 40 minutes and ships a week later. Separation is not bureaucracy — it's how you make review *fast*, which is how you make delivery fast.

> **Key idea:** You are not just writing code for the compiler; you are writing a *change* for a reviewer. The cheapest change to review is one that does exactly one kind of thing. Structure-only PRs are the cheapest review unit in software.

---

## The deep why: coupling and cohesion

Strip away the catalog and the workflow, and tidying is ultimately about two design forces Beck traces back to Larry Constantine and the structured-design tradition: **coupling** and **cohesion**.

- **Coupling** is the degree to which changing one element forces you to change another. High coupling means a change *cascades* — touch A and you must touch B, C, D.
- **Cohesion** is the degree to which the elements that change together *live together*. High cohesion means a change is *local* — everything you must touch is in one place.

Almost every tidying is a move that *reduces coupling* or *increases cohesion* — i.e., it lowers the cost of the *next* change:

| Tidying | Force it improves | Effect on the next change |
|---|---|---|
| **Explicit Parameters** | Reduces coupling to globals/singletons | The function can change/test without the hidden dependency |
| **Cohesion Order** | Increases cohesion | Related edits are co-located, not scattered |
| **Extract Helper** | Increases cohesion (names a concept) | The concept can change in one named place |
| **Guard Clauses** | Reduces *cognitive* coupling | Each path is independent; adding one doesn't perturb others |
| **New Interface, Old Impl** | Reduces coupling of callers to impl | Implementation can change behind a stable seam |
| **Normalize Symmetries** | Reduces accidental coupling of "looks different ⇒ is different" | Diffs in code reliably mean diffs in meaning |

Beck frames this in cost terms. The lifetime cost of software is dominated not by writing it once but by *changing* it many times:

```
  cost(software) ≈ cost(big-up-front) + Σ cost(change_i)
```

Coupling inflates every `cost(change_i)` because each change drags others along. Tidying is a *targeted investment* that lowers the coupling on the path you're about to walk, so the imminent change — and ones near it — get cheaper. This is why "tidy the code you're about to change" is not arbitrary: you're paying down coupling exactly where you're about to pay it.

> **Key idea:** Coupling is the cost driver of change; cohesion is its antidote. A tidying is a small, local rebalancing of coupling and cohesion aimed at the change you're about to make. The catalog is just the vocabulary; coupling and cohesion are the physics. (For the principle-level treatment of these forces, see [`../../design-principles/`](../../design-principles/).)

---

## The WHEN decision: First / After / Later / Never

Senior judgment is mostly about *when*, not *how*. Beck offers four options for any tidying you've spotted, and the skill is choosing among them honestly.

```
  Spotted a possible tidying.
            │
   Will tidying make the IMMEDIATE change easier?
        ┌───┴────────────────────────┐
       yes                           no
        │                             │
   Do you understand            Will you touch this
   the code well enough         code again soon?
   to tidy safely now?            ┌──┴───┐
     ┌──┴──┐                     yes     no
    yes    no                     │       │
     │      │                 TIDY LATER  NEVER
  TIDY    TIDY AFTER          (note it,   (leave it;
  FIRST   (change first,       backlog)    no payback)
          understand,
          then tidy)
```

**Tidy First** — Tidy *before* the behavior change, when the tidying directly removes an obstacle to that change and the payback is *immediate*. The shipping example at the middle level is canonical: flatten the nest, *then* the new case is a one-liner. Tidy first when the tidying earns its keep within the same task.

**Tidy After** — Make the behavior change first, *then* tidy. Two reasons: (1) you didn't understand the code well enough to tidy safely until you'd worked in it; (2) the act of changing it revealed the right shape. The risk: "I'll tidy after" often becomes "never" once the feature is green and the deadline looms. Treat tidy-after as a commitment, not a vague intention.

**Tidy Later** — You see a worthwhile tidying but *not on today's path*. You'll be back in this code soon, so it's worth doing — but not now, because it would balloon this PR. Capture it (a ticket, a `// TIDY:` note) and do it on the next visit. Tidy-later is a *scheduling* decision, not a quality judgment.

**Never** — The honest, frequently-correct answer. If you won't touch this code again, tidying it is pure cost with no return. Ugly-but-stable code that nobody reads is *fine*. The discipline of saying "never" is what keeps tidying from becoming compulsive gold-plating.

The three questions that drive the decision:

1. **Do you understand the code?** If not, you can't tidy it safely — change it first (Tidy After) or build characterization tests first (see [`../04-characterization-tests/`](../04-characterization-tests/)).
2. **Will you touch it again soon?** If yes, tidying compounds. If no, lean toward Never.
3. **Is the tidying coupled to the change?** If the tidying *enables* the change, Tidy First. If it's merely *adjacent*, it's Later or Never.

---

## When tidying is premature

Tidying has a failure mode: doing it where it doesn't pay. Premature tidying is structure work that consumes time and review attention without lowering any imminent change's cost. Watch for these signals:

- **No imminent change.** You're tidying code purely because it offends you, with no feature or fix headed for it. Aesthetics alone is a weak justification; the payoff is hypothetical.
- **Speculative generality.** You're adding a "New Interface, Old Implementation" or an Extract Helper to support a flexibility *no requirement asks for*. This is the YAGNI violation in tidying clothes.
- **Tidying you don't understand.** Reshaping code whose behavior you can't characterize. Without tests pinning behavior, your "structure-only" change might silently alter behavior. Pin first (characterization tests), tidy second.
- **Tidying that balloons the PR.** A "quick tidy" that touches 30 files turns a reviewable behavior PR into an unreviewable blob — defeating the very reviewability you tidy *for*.
- **Tidying on a throwaway.** Code slated for deletion or rewrite. Polishing the deck of a ship you're scuttling.

> **Key idea:** Premature tidying is the mirror image of premature optimization — effort spent improving a dimension that isn't on the critical path. The senior move is restraint: tidy where the payback is near and concrete, and consciously choose *Never* everywhere else.

---

## Tidying as optionality (bridge to economics)

The deepest framing — and the bridge to the next topic — is that **deciding whether to tidy is an economic decision about options, not a moral one about cleanliness.**

A tidying done today is a cost paid *now* for a benefit reaped *later* (cheaper future changes). Borrowing Beck's own framing from finance:

- Tidying is buying an **option**: you spend a little now to make a *possible* future change cheaper. If that change never comes, the option expires worthless — you wasted the premium.
- The **discount rate** matters: a benefit far in the future is worth less than one tomorrow. "Tidy First" wins when the payoff is *imminent* (you change this code in the same task); it loses when the payoff is distant or uncertain (you might touch this someday).
- **Reversibility lowers the cost of being wrong**, which is exactly why small reversible tidyings are cheap options: if the future doesn't materialize, you've risked little.

This reframes the four WHEN options as bets with different time horizons: **Tidy First** = the option pays off this turn; **Tidy After** = pay the premium once you've confirmed the bet; **Tidy Later** = defer the premium to when the payoff nears; **Never** = decline the bet.

This is only the bridge — the full cost-of-delay, time-value, and option-pricing treatment lives in [`../07-the-economics-of-tidying/`](../07-the-economics-of-tidying/). The senior takeaway is the *stance*: treat each tidying as a small, reversible investment whose justification is a *near and probable* reduction in the cost of change — never as a duty owed to tidiness for its own sake.

---

## Worked analysis: a coupling-driven tidying

Consider a reporting function coupled to a global clock and config — you've been asked to add a "report as of an arbitrary date" feature.

```python
# BEFORE — coupled to globals; the new feature is impossible without surgery
import datetime
TENANT_CONFIG = load_config()

def monthly_report(account_id):
    now = datetime.datetime.now()                    # hidden input: clock
    rate = TENANT_CONFIG["fx_rate"]                  # hidden input: global config
    txns = fetch(account_id, month=now.month)
    return summarize(txns, rate)
```

The requested feature — report *as of any date* — is blocked by coupling to `now`. The right **Tidy First** is **Explicit Parameters**: surface the hidden inputs. It's structure-only (callers pass today's values, behavior identical), verified by unchanged tests, and it *creates the seam* the feature needs.

```python
# AFTER (Tidy First, structure-only) — hidden inputs surfaced; tests unchanged
def monthly_report(account_id, as_of, fx_rate):
    txns = fetch(account_id, month=as_of.month)
    return summarize(txns, fx_rate)

# existing callers (behavior preserved):
# monthly_report(id, datetime.datetime.now(), TENANT_CONFIG["fx_rate"])
```

Now the behavior change is trivial and gets its own commit + test: callers may pass *any* `as_of`. The coupling that made the feature hard is gone, the change that was "surgery" became a parameter, and the history reads as `tidy: …` then `feat: …`. This is the whole topic in one example — separability, reduced coupling, a created seam, a near and concrete payback.

---

## Diagrams

The senior decision lattice, annotated with the driving force:

```
                        SPOTTED TIDYING
                              │
        ┌─────────────────────┼─────────────────────┐
   enables the change?   adjacent only?         throwaway?
        │                     │                      │
   understand it?        touch again soon?           │
     ┌──┴──┐               ┌──┴──┐                    │
   yes     no            yes     no                   │
    │       │             │       │                   │
 TIDY    TIDY AFTER    TIDY LATER  NEVER ◄────────── NEVER
 FIRST   (+characterize  (backlog)  (decline the option)
         if needed)
    │
 reduces coupling on the path you're about to walk → payback NOW
```

---

## Related Topics

- [`../01-what-is-legacy-code/`](../01-what-is-legacy-code/) — why legacy code resists change; tidying is the small-scale antidote.
- [`../04-characterization-tests/`](../04-characterization-tests/) — pin behavior *before* tidying code you don't fully understand.
- [`../05-dependency-breaking-techniques/`](../05-dependency-breaking-techniques/) — Explicit Parameters and New Interface are tidyings that create seams.
- [`../07-the-economics-of-tidying/`](../07-the-economics-of-tidying/) — the full time-value/optionality reasoning behind the WHEN decision.
- [`../../refactoring/`](../../refactoring/) — the complete catalog and mechanics; tidying is "refactoring in the small."
- [`../../design-principles/`](../../design-principles/) — coupling, cohesion, YAGNI, and the forces tidyings rebalance.
