# When to Refactor to Patterns — Professional Level

> **Source:** Joshua Kerievsky, *Refactoring to Patterns* (Addison-Wesley, 2004); [refactoring.guru/design-patterns](https://refactoring.guru/design-patterns)

The professional question is not "is this a good refactoring?" but "does this refactoring earn its cost *to the business*, can I prove it, and can I get it done given the deadline, the reviewer, and the tech-debt backlog I'm carrying?" This file treats refactoring-to-patterns as an *economic* decision with measurable inputs and outputs.

---

## The most expensive line in this whole section

> **"Duplication is far cheaper than the wrong abstraction."** — Sandi Metz

Internalize this, because it overrides the catalog. The default failure mode of pattern-literate engineers isn't too little abstraction — it's the *wrong* one, extracted too early, that then becomes load-bearing and metastasizes.

The economics: removing duplication has a *known, bounded* cost (you can always re-duplicate). Removing a wrong abstraction has an *unknown, often unbounded* cost, because once an abstraction exists, callers grow around it, special-case it with flags, and bend it to accommodate cases it was never shaped for. Metz's full lifecycle:

```
1. Programmer A sees duplication.
2. A extracts an abstraction, names it. (Feels great.)
3. A new requirement *almost* fits. Programmer B adds a parameter/flag.
4. Repeat 3 several times. The abstraction is now a parameterized monster.
5. Nobody dares delete it; everyone routes around it.
   ── This is more expensive than the duplication ever was. ──
```

The professional rule that falls out: **when you're unsure whether the abstraction is right, prefer the duplication and wait.** Duplication is *information* — it shows you the true shape of the variation. Extract only when the shape has stopped wobbling. This is the rule of three with a price tag attached.

> **The symmetric error:** "duplication is cheap" is *not* license to leave genuinely duplicated, *churning* dispatch unrefactored forever. Metz's point is about *premature* abstraction. Once the abstraction is *proven* by three real, stable instances, refusing to extract it is its own (under-engineering) cost.

---

## Measuring before and after

"Trust me, it's cleaner" doesn't survive a skeptical reviewer or a deadline. Where you can, attach numbers to the trade.

**Leading indicators (predict the smell):**
- **Churn × complexity.** Files that are both *frequently changed* and *highly complex* are where patterns pay. Tools like `code-maat` or a simple `git log` + cyclomatic-complexity pass surface these. Low-churn complex code: leave it. High-churn complex code: refactor it.
- **Number of call sites editing the same conditional.** Three or more branching on the same type code is concrete, countable justification for Strategy/polymorphism.

**Outcome metrics (prove the refactoring worked):**
- **Cyclomatic / cognitive complexity** of the touched methods — should drop after Replace Conditional with Polymorphism.
- **"Files touched per feature."** Track it before and after. If introducing the pattern *reduced* the average diff footprint for adding a new variant (from "edit 4 files" to "add 1 file"), the pattern paid. If it didn't move, you may have over-engineered.
- **Lead time for the next similar change.** The ultimate proof: did the *next* "add a shipping method" actually become trivial? If yes, the Strategy was right. If the next one *still* required edits in three places, the abstraction was wrong.

> **Don't weaponize metrics.** Complexity dropping while *file count triples* can be a net loss in comprehensibility. Metrics inform the judgment; they don't replace it. A reviewer who says "this is technically simpler per-method but I can no longer follow a request end-to-end" has a valid, unmeasured objection.

---

## Refactoring under deadline pressure

You will almost always be asked to add a feature, not to refactor. The professional move is to fold the refactoring into the feature's *critical path* only when it makes the feature *cheaper to land*:

- **"Make the change easy, then make the easy change."** If the current shape fights the feature, the refactoring-to-pattern *is* the cheapest way to ship the feature, not a detour from it. Frame it that way to your lead: "Refactoring `Shipping` to Strategy is how I add Overnight without touching five files."
- **Don't gold-plate under pressure.** If the feature can land with an Extract Method and a small `switch`, do that and *log the smell* for later (see tech-debt framing below). Reaching for the full pattern *because you're already in there* is how speculative generality sneaks in under deadline.
- **Refactor *toward*, ship, finish later.** Partial refactoring is a legitimate response to time pressure: get to "duplication removed," ship, and complete the journey to full Strategy in a follow-up when there's room. Just don't ship a *visibly half-built* pattern (interface with one implementor) — that's worse than either endpoint.
- **Never refactor untested code under deadline.** If there are no tests, the safe move under pressure is *add characterization tests, make the minimal change, defer the refactoring*. Refactoring untested critical code at 5pm before a release is how outages happen.

```
Deadline decision tree:
  Does the feature need the refactoring to land cleanly?
    NO  → minimal change now, log the smell, refactor later
    YES → is the code tested?
            NO  → characterization tests → minimal change → defer pattern
            YES → refactor toward the pattern (tiny steps) → ship → finish later
```

---

## Getting buy-in

Refactoring-to-patterns competes for time against features. Winning that competition is a communication skill:

- **Translate the smell into business cost.** Not "this violates OCP" but "every new payment method takes us three days and touches five files because the logic is duplicated; after this refactor it's a half-day and one file." Decision-makers buy *cycle-time and risk reduction*, not pattern names.
- **Separate refactoring PRs from feature PRs.** A behavior-preserving refactor with green tests is *low-risk* and reviewable in minutes; a feature mixed with a refactor is high-risk and slow. Keeping them apart is how you get refactors approved at all.
- **Show the next change is now trivial.** The most persuasive artifact is a tiny follow-up PR: "and here's adding Overnight — one file, ten lines." That *demonstrates* the payoff the abstraction was bought for.
- **Quantify when you can, narrate when you can't.** Lead-time and files-touched are quantifiable. "Three different engineers got this `switch` wrong last quarter" is a narrative that lands just as hard.

---

## Tech-debt framing

Refactoring-to-patterns is the *repayment* mechanism for a specific class of debt: **structural debt** — code whose *shape* makes change expensive. Frame it accordingly:

- **A logged smell is a debt ticket.** When you defer a pattern under deadline, write it down with the *interest rate*: "Shipping `switch` duplicated in 3 places; each new method costs ~3 files. Refactor to Strategy when we add the 4th method." That's a debt entry with a trigger condition.
- **Pay debt when you're in the neighborhood.** The cheapest time to refactor a module to a pattern is when you're already changing it for a feature — the context is loaded, the tests are running. "Boy Scout rule": leave it cleaner than you found it, *in proportion to* what the change justifies.
- **Beware debt you're *adding* by over-engineering.** A premature pattern is *also* tech debt — the wrong-abstraction kind, which is the expensive kind. Adding a Strategy "to be future-proof" isn't paying debt; it's borrowing at a high rate. (See [abstraction-failures](../../../anti-patterns/02-design/03-abstraction-failures/professional.md).)
- **Refactoring *away* is debt repayment too.** Removing a pattern that carries no variation reduces structural debt. Budget for it; don't only ever add. (See [Refactoring Away From Patterns](../05-refactoring-away-from-patterns/professional.md).)

> **When NOT to repay structural debt:** code that is stable, low-churn, and scheduled for deletion or replacement. Refactoring a module to a beautiful Strategy two sprints before it's decommissioned is negative ROI. Apply the [optimize-for-deletion](../../../design-principles/01-generic/06-optimize-for-deletion/junior.md) lens — sometimes the right "refactoring" is to leave the smell and delete the whole thing later.

---

## The professional's one-paragraph summary

Patterns are an investment with a real cost (indirection, learning tax, the risk of the wrong abstraction) and a real return (cheaper future change). You pull the trigger when the *return is proven* by recurring change — not predicted — and when you can *demonstrate* the payoff to whoever's paying for your time. Under deadline you refactor *toward* the pattern only as far as the feature needs, log the rest as debt with a trigger, and you refuse to refactor untested critical code. And you hold Metz's rule above the entire catalog: when in doubt, duplicate and wait, because the wrong abstraction costs more than any amount of duplication.

---

## Next

- [junior.md](junior.md) — the core idea, the smell→pattern table, the three directions.
- [middle.md](middle.md) — pulling the trigger: cost/benefit, the rule of three, partial refactoring.
- [senior.md](senior.md) — judgment at scale: pattern density, sequencing, deeper design problems.
- [interview.md](interview.md) — interview questions and model answers.
- [tasks.md](tasks.md) — decide *if* and *which* pattern for real snippets.
- [find-bug.md](find-bug.md) — spot patterns applied too early or wrongly.
- [optimize.md](optimize.md) — propose the right refactoring-to-pattern.
