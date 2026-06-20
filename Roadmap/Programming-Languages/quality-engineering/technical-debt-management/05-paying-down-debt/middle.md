# Paying Down Debt — Middle Level

> **Roadmap:** [Technical Debt Management](../README.md) → Paying Down Debt
> *The junior page said "leave it cleaner than you found it." This page turns that instinct into a portfolio of paydown strategies — and the harder skill of choosing between them: when a boy-scout edit is enough, when you owe the code a real refactor, when you strangle a module out of existence, and the rare, dangerous case where a rewrite is actually the right call.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [The Menu of Paydown Strategies](#the-menu-of-paydown-strategies)
4. [Continuous vs Fix-on-Touch vs Dedicated vs Big-Bang](#continuous-vs-fix-on-touch-vs-dedicated-vs-big-bang)
5. [Refactor vs Rewrite vs Leave](#refactor-vs-rewrite-vs-leave)
6. [The Safety Net — Characterization Tests First](#the-safety-net--characterization-tests-first)
7. [Tidy First — Separating Tidyings from Behaviour](#tidy-first--separating-tidyings-from-behaviour)
8. [The Strangler Fig — Replacing a Module Without a Big-Bang](#the-strangler-fig--replacing-a-module-without-a-big-bang)
9. [Measuring That Paydown Actually Helped](#measuring-that-paydown-actually-helped)
10. [Worked Example — Strangling a Pricing Module](#worked-example--strangling-a-pricing-module)
11. [Mental Models](#mental-models)
12. [Common Mistakes](#common-mistakes)
13. [Test Yourself](#test-yourself)
14. [Cheat Sheet](#cheat-sheet)
15. [Summary](#summary)
16. [Further Reading](#further-reading)
17. [Related Topics](#related-topics)

---

## Introduction

> Focus: **What are the ways to actually pay debt down, and how do I pick the right one for this debt?**

At the junior level, paying down debt is one move: see something messy while you're in there, clean it up, move on. That move — the boy-scout rule — is genuinely the most important one, and most debt should die exactly that way. But "always clean as you go" can't answer the questions that consume a senior engineer's judgement: *this* tangled 4,000-line module won't yield to incremental edits — do I refactor it in place, replace it piece by piece, or rewrite it from scratch? Where do I find the budget? How do I touch code with no tests without breaking production? And after I've spent two sprints on it, how do I prove it was worth it?

This page is the menu and the decision procedure. Paydown is not one strategy; it's at least four, ranging from low-risk-by-default (continuous, fix-on-touch) to high-risk-rarely-justified (big-bang refactor, full rewrite). Choosing wrong is expensive in both directions: a rewrite where a refactor would have done burns a year and often fails outright; a timid boy-scout edit on a module that needs structural surgery just smears lipstick on the problem. The skill is matching the strategy to the debt's size, value, and condition — and then doing it *safely*, behind a test net, in commits a reviewer can actually trust.

---

## Prerequisites

- **Required:** You've read [junior.md](junior.md) and can state the boy-scout rule and why small, scoped cleanups beat heroic ones.
- **Required:** You've read [04 — Tracking & Prioritizing](../04-tracking-and-prioritizing/middle.md) and can decide *which* debt is worth paying before deciding *how*.
- **Helpful:** You've worked in a codebase with a module everyone fears to touch.
- **Helpful:** Basic comfort with a testing framework and with reading a diff for behaviour changes.

---

## The Menu of Paydown Strategies

Before the decision procedure, here's the full menu, ordered by how much they cost and how much risk they carry. Most teams reach for the dramatic options far too early and the quiet ones far too rarely.

| Strategy | What it is | Risk | When it fits |
|---|---|---|---|
| **Continuous / boy-scout** | Tiny improvements whenever you're already in the code | Lowest | The default. Renames, extractions, a missing test |
| **Fix-on-touch** | Pay the debt *in the code a feature is already changing* | Low | Debt that sits in the path of active work |
| **Dedicated paydown** | Reserved capacity — a fixed % tax, or "fix-it" days/weeks | Medium | Debt too big for a side-edit but too small to be a project |
| **Big-bang refactor** | Stop features, restructure a large area in one push | High | Rarely. Only when incremental is genuinely impossible |
| **Rewrite** | Throw the code away, build it again | Highest | Almost never (see [refactor vs rewrite](#refactor-vs-rewrite-vs-leave)) |

> **Key insight:** These are not ranked by virtue — they're ranked by *blast radius*. The right default is the lowest-risk option that can actually close the gap. You escalate up the menu only when the cheaper strategy provably can't get there, never because the bigger move feels more decisive. "We're going to do a big refactor" should be a conclusion you were forced into, not an opening move.

---

## Continuous vs Fix-on-Touch vs Dedicated vs Big-Bang

The first three options differ mainly in *where the time comes from*, and that distinction drives most of the politics of paydown.

**Continuous (boy-scout)** spends no separately-budgeted time. The cost is folded into normal work — you renamed a confusing variable while fixing an adjacent bug. Because each edit is tiny and lives inside a change you were making anyway, it needs no permission and carries almost no risk. This should be the bulk of all debt repayment, and a healthy team's debt level is held down mostly by this invisible, continuous force rather than by any grand initiative.

**Fix-on-touch** is the boy-scout rule pointed deliberately at high-value targets. The principle: *pay debt in the code your feature is already changing.* You're adding a field to the checkout flow anyway — so the awful 200-line method you have to edit to do it gets extracted and tested *as part of that story*, not as separate work. This is the single highest-leverage paydown discipline, because it concentrates effort exactly where the [04 — interest is highest](../04-tracking-and-prioritizing/middle.md): code that changes often is, by definition, code you keep paying interest on. Debt in code nobody touches gets left alone — there's no interest to save.

**Dedicated paydown** is reserved capacity, taken in one of two shapes:

- **A standing % tax** — e.g. "20% of every sprint goes to debt." Steady, predictable, easy to defend to a product manager as a fixed line item. The risk is that 20% with no target becomes 20% of busywork.
- **Fix-it days / weeks** — a concentrated burst (a "fix-it Friday," a hardening sprint) where the team pauses features to attack a backlog of debt. Good for clearing an accumulated pile and for morale; bad as a *substitute* for continuous paydown, because debt you only address in occasional bursts grows faster than the bursts can clear it.

**Big-bang refactor** stops feature work to restructure a large area at once. It is the strategy of last resort, because it has every property you want to avoid: a long branch that drifts from `main`, no shippable value until the end, and an all-or-nothing risk profile. Reserve it for the genuinely rare case where the area can't be improved incrementally *at all* — and even then, prefer the strangler fig (below), which gets you most of the benefit while staying incremental.

> **Key insight:** The argument over paydown is almost never about whether the debt is real — it's about *where the hours come from*. Continuous paydown hides the cost inside feature work (no one has to approve it); dedicated paydown makes the cost a visible line item (someone has to fund it). Knowing which framing a given piece of debt needs — invisible side-edit vs funded initiative — is half the battle of getting it paid at all.

---

## Refactor vs Rewrite vs Leave

For any sizeable chunk of bad code, there are exactly three responses, and picking among them is the highest-stakes decision on this page.

**Leave it.** The honest default for debt in stable code that rarely changes. If a module is ugly but works, isn't on the path of upcoming work, and isn't causing defects, the interest you're paying is *zero* — and zero-interest debt is not worth principal to repay. Leaving it is a *decision*, not neglect; record it (see [04](../04-tracking-and-prioritizing/middle.md)) and move on.

**Refactor.** Improve the structure *without changing behaviour*, in small safe steps, behind tests. This is the right answer for the overwhelming majority of debt worth acting on, because it's incremental, reversible, and keeps the software shippable the entire time. Almost everything you'd be tempted to rewrite can instead be refactored — often via the strangler fig — at a fraction of the risk.

**Rewrite.** Discard the code and rebuild it. This is the option engineers reach for emotionally and regret empirically. The bar is brutally high, and *both* conditions must hold:

1. **Refactoring genuinely can't get there.** Not "would be tedious" — *can't*. The architecture is so wrong that no sequence of behaviour-preserving steps reaches the target (e.g. a fundamentally different concurrency model or data model).
2. **The code is both high-value and beyond repair.** High-value enough to justify the spend, *and* in such condition that incremental improvement is hopeless.

Rewrites usually fail, for reasons worth internalising:

- **You throw away embedded knowledge.** That "ugly" code is ugly partly because it accumulated years of bug fixes for edge cases nobody remembers. The rewrite rediscovers each one — in production. (Joel Spolsky's classic argument: old code has been *tested*; new code has not.)
- **The moving target.** While you rewrite, the old system keeps shipping features. You're racing to reach parity with a system that won't hold still — and "parity" is a finish line that recedes.
- **The second-system effect.** (Fred Brooks.) The replacement, designed by people who now "know better," accretes every feature and abstraction that was cut from the first — arriving bloated, late, and over-engineered. The second system a team builds is the most dangerous one they'll ever build.

> **Key insight:** "Rewrite" feels like progress because a blank file has no bugs. But the bugs in the old code are *paid-for knowledge* — every edge case it handles is a lesson someone already learned the hard way. A rewrite volunteers to re-learn all of them. Choose rewrite only when refactoring is *impossible*, not merely unpleasant — and when you do, strangle the old system incrementally rather than flipping a big-bang switch.

---

## The Safety Net — Characterization Tests First

You cannot safely change code you don't understand and can't verify — and legacy code is, almost by definition, both. Michael Feathers' answer in *Working Effectively with Legacy Code* is the **characterization test**: a test that documents what the code *currently does*, right or wrong, so that any change which alters that behaviour fails loudly.

The point is subtle and worth getting exactly right: a characterization test does **not** assert what the code *should* do. It asserts what it *actually* does today. You're not writing a spec; you're casting a net. The technique:

1. Write a test that calls the legacy code and asserts something you *expect* to be wrong, e.g. `assertEquals(0, computeFee(order));`.
2. Run it; let it fail and *tell you the real value* — say, `expected 0 but was 47.5`.
3. Change the assertion to the value the code actually produced: `assertEquals(47.5, computeFee(order));`.
4. Repeat across enough inputs to pin the behaviour you're about to touch.

```python
# Characterization test: we DON'T know the "right" answer.
# We pin whatever the legacy code does so refactoring can't change it silently.
def test_compute_fee_characterization():
    order = make_order(items=3, total=200, region="EU", coupon="SAVE10")
    # First run failed with "expected 0 but was 47.5" — so we lock in 47.5.
    assert compute_fee(order) == 47.5   # documents CURRENT behaviour, bugs and all
```

Now the bizarre `47.5` is *frozen*. When you refactor `compute_fee` and the test still passes, you know — with evidence, not hope — that you preserved behaviour. If the value *was* a bug, that's a separate, deliberate change made later, under its own test, in its own commit.

> **Key insight:** Tests written *after* the fact, capturing current behaviour, are not "lower quality" than spec-first tests — for legacy code they're the only honest option, because the spec was lost long ago. The characterization net is what converts "I'm scared to touch this" into "I can refactor this freely; the net will catch any behaviour change." Without it, every refactor is a gamble; with it, refactoring becomes routine.

---

## Tidy First — Separating Tidyings from Behaviour

Kent Beck's *Tidy First?* sharpens the boy-scout rule into a discipline about **commits and sequencing**. The core rule: **never mix a tidying with a behaviour change in the same commit.**

A *tidying* is a tiny, safe, structural improvement — rename a variable, extract a well-named helper, add explaining parentheses, reorder methods, delete dead code. None of it changes what the program does. A *behaviour change* adds a feature or fixes a bug. Beck's insistence is that these go in **separate commits**, with the tidyings landing **first**, because:

- A reviewer can approve a pure tidying at a glance (diff is structural — no logic moved) and scrutinise the behaviour change in isolation. Mixed together, neither can be reviewed well: the real change hides inside a flurry of renames.
- If something breaks, `git bisect` and `git revert` can act on the behaviour commit *without* losing the cleanup — or vice versa.
- "Tidy *first*" makes the subsequent change easier: you clean up just enough that the real edit becomes obvious, *then* make it.

```text
# WRONG — one commit, reviewer can't tell cleanup from logic
commit: "fix discount + cleanup"
  - renamed `d` → `discountRate`        (tidying)
  - extracted `applyTiers()`            (tidying)
  - changed tier threshold 100 → 150    (BEHAVIOUR — buried)

# RIGHT — tidyings first, behaviour last, each reviewable alone
commit 1: "tidy: rename d → discountRate"          (no behaviour change)
commit 2: "tidy: extract applyTiers()"             (no behaviour change)
commit 3: "fix: raise tier threshold 100 → 150"    (the real change, tiny diff)
```

The third diff is now one line in a clearly-named method — trivial to review, trivial to revert, trivial to reason about. The "first?" in the title is a genuine question: tidy first only when it makes the coming change easier *and* the payoff is near. Tidying code you're not about to change is just speculative rework.

> **Key insight:** The unit of safe change is not "the edit" — it's "the *separated* edit." Structural changes and behavioural changes have completely different risk profiles (one provably preserves behaviour; one deliberately alters it), so splitting them into separate commits lets each be reviewed and reverted on its own terms. This is the boy-scout rule made rigorous enough to scale past one person.

---

## The Strangler Fig — Replacing a Module Without a Big-Bang

When a large module is genuinely beyond in-place refactoring but a big-bang rewrite is too risky, the **Strangler Fig** pattern (named by Martin Fowler, after the vine that grows around a tree and gradually replaces it) gives you incremental replacement with a shippable system at every step.

The shape: put a thin **routing layer** in front of the old module. Build the replacement one slice at a time. For each slice, flip the router to send that call to the new implementation; leave everything else on the old one. Over time, traffic migrates piece by piece until the old module handles nothing — and you delete it.

```text
         ┌──────────── façade / router ────────────┐
 call ──▶│  if feature in MIGRATED → new            │
         │  else                   → old (legacy)   │──▶ old module (shrinking)
         └──────────────────────────────────────────┘──▶ new module (growing)

 step 1:  MIGRATED = {}                  all traffic → old
 step 2:  MIGRATED = {computeTax}        tax → new, rest → old   (ship, observe)
 step 3:  MIGRATED = {computeTax, fees}  more → new              (ship, observe)
   ...
 step N:  MIGRATED = {everything}        old module is dead → delete it
```

Why this beats a big-bang:

- **The system ships the whole time.** Each slice is a small, reversible release; if the new path misbehaves you flip *that one route* back. Compare to a rewrite branch that delivers nothing until the final, terrifying cut-over.
- **Risk is sliced, not stacked.** You verify one slice in production before starting the next, so problems surface small and early instead of all at once at the end.
- **It composes with the safety net.** Run old and new in parallel and compare outputs (a "branch by abstraction" / parallel-run check) before trusting the new path — characterization tests on the old behaviour become the oracle for the new code.

The façade is the whole trick: it decouples *callers* from *which implementation answers*, so you can move the boundary one slice at a time without callers ever knowing.

> **Key insight:** The strangler fig dissolves the false choice between "refactor in place" (sometimes impossible) and "big-bang rewrite" (usually fatal). It is *incremental replacement* — you get the clean-slate benefit of new code without the all-or-nothing risk of the rewrite, because the routing façade lets old and new coexist while the boundary moves. When someone proposes a rewrite, this is almost always the better answer.

---

## Measuring That Paydown Actually Helped

Paydown that you can't show paid off is indistinguishable, to the people funding it, from gold-plating. Since the whole point of debt is the *interest* — the ongoing tax on working in an area — the measurement is: **did the tax go down?** Pick the metric *before* you start, on the *specific area* you touched.

- **Lead-time / cycle-time on changes to that area.** The most direct signal. If a module took, on average, 4 days to safely change before paydown and 1.5 days after, that delta *is* the interest you stopped paying. Track it per-area, not codebase-wide, or the signal drowns.
- **Defect / change-failure rate in that area.** Debt-heavy code breaks when touched. A drop in bugs-per-change or in changes-that-need-a-follow-up-fix after paydown is evidence the structure got safer, not just prettier.
- **Supporting (weaker) signals.** Reduced hotspot score ([02 — churn × complexity](../02-identifying-and-quantifying/middle.md) feeds this), fewer review cycles to merge a change there, less time-on-call for that subsystem.

The discipline is the *before/after on the touched area*. A SonarQube debt ratio that ticks down globally tells you little; "changes to the billing module now take a third of the time and break half as often" is an argument a product manager funds again. If you can't show movement in lead-time or defects, either the debt wasn't generating interest (you paid down zero-interest debt — see *Leave it*) or you measured the wrong area.

> **Key insight:** You don't justify paydown by how much cleaner the code looks — looks are unfalsifiable. You justify it by the interest you stopped paying: faster, safer changes in the *specific area* you fixed. Choosing that metric *up front* turns "we refactored billing" from an unprovable assertion into a measured before/after that earns the budget for the next one.

---

## Worked Example — Strangling a Pricing Module

A `PricingEngine` class has grown to 3,000 lines over five years. It's high-value (every order goes through it), changes constantly (so the interest is high), and is genuinely beyond in-place refactoring — global mutable state, no seams, no tests. A rewrite was proposed; here's the strangler-fig path instead.

**Step 0 — Cast the net.** Before touching anything, write characterization tests over real orders to pin current behaviour, bugs included:

```python
@pytest.mark.parametrize("order", load_real_orders(500))  # production samples
def test_pricing_characterization(order, golden):
    # golden[order.id] holds whatever the OLD engine produced — captured once.
    assert PricingEngine().price(order) == golden[order.id]
```

These 500 frozen outputs become the **oracle**: any new implementation must reproduce them exactly.

**Step 1 — Insert the façade.** Extract an interface and route everything through it; behaviour is unchanged, so this lands as pure *tidyings* (Tidy First — separate commits, no logic moved):

```python
class PricingFacade:
    def __init__(self):
        self._legacy = PricingEngine()
        self._migrated: set[str] = set()      # nothing migrated yet

    def price(self, order):
        if "tax" in self._migrated:
            return NewTax().compute(order)    # new path, one slice
        return self._legacy.price(order)      # everything still legacy
```

**Step 2 — Strangle one slice, verify in production.** Build `NewTax`, then *parallel-run* it: compute both, serve the legacy result, log any mismatch. Only after the mismatch rate is zero do you add `"tax"` to `_migrated`:

```python
def price(self, order):
    legacy = self._legacy.price(order)
    if FLAGS.shadow_tax:
        new = NewTax().compute(order)
        if new != legacy:
            log.warning("tax mismatch", order=order.id, legacy=legacy, new=new)
    return legacy            # still serving legacy until shadow is clean
```

**Step 3 — Repeat, shipping each slice.** Migrate `discounts`, then `fees`, then `currency`, each behind its own shadow-then-flip cycle. The system ships continuously; risk arrives one small slice at a time.

**Step N — Delete the tree.** When `_migrated` covers everything, `PricingEngine` is dead code. Delete it and the façade's legacy branch in a final commit.

**Step N+1 — Prove it paid off.** Compare the *six months before* vs *after*: lead-time for a pricing change dropped from ~5 days to ~1, and pricing-related production incidents fell from 6/quarter to 1. *That* is the report that funds the next strangler — not "the code is nicer now."

---

## Mental Models

- **Pay interest, not principal.** Debt only costs you when you keep touching the code (interest). Direct paydown at high-churn, high-value code via fix-on-touch; leave low-interest debt in peace. Repaying principal on debt you never touch is pure waste.

- **Climb the menu only when forced.** Boy-scout is the default; escalate to dedicated time, then strangler, then (almost never) rewrite *only* when the cheaper option provably can't close the gap. The bigger move is a last resort, not a first instinct.

- **A rewrite re-learns paid-for lessons.** The old code's ugliness encodes years of edge-case fixes. A blank file looks clean because it hasn't met production yet. Refactor or strangle; rewrite only when refactoring is *impossible*.

- **The net comes before the surgery.** You can't safely change what you can't verify. Characterization tests pin current behaviour so a refactor that changes it fails loudly. No net → every change is a gamble.

- **Separate the two kinds of change.** Structural (tidying) and behavioural changes have opposite risk profiles. Commit them apart, tidyings first — so each is reviewable and revertable on its own.

---

## Common Mistakes

1. **Rewriting when you could refactor.** The most expensive mistake on this page. A rewrite throws away embedded knowledge, chases a moving target, and invites the second-system effect. Reach for the strangler fig first; rewrite only when incremental change is genuinely impossible.

2. **Touching legacy code with no safety net.** Refactoring without characterization tests is editing-and-hoping. Pin the current behaviour *first*; then change with evidence that you preserved it.

3. **Mixing tidyings with behaviour changes.** A diff that renames five things *and* changes a threshold can't be reviewed or reverted cleanly — the real change hides in the noise. Split them: tidyings first, behaviour last, separate commits.

4. **Big-bang refactors on a long-lived branch.** Stopping features to restructure a large area in one push produces a branch that drifts from `main`, ships nothing until the end, and fails all-or-nothing. Slice it with a strangler fig instead.

5. **Paying down zero-interest debt.** Cleaning up ugly-but-stable code nobody touches feels productive and saves nothing. If the area isn't on the path of work and isn't causing defects, *leave it* — and spend the effort where the interest is.

6. **Declaring victory with no measurement.** "We refactored it" is unfalsifiable. Pick a metric — lead-time or defect rate on the *specific area* — before you start, and show the before/after. Otherwise paydown looks like gold-plating to whoever funds it.

---

## Test Yourself

1. Name the four main paydown strategies in order of blast radius, and give the default.
2. What's the difference between continuous (boy-scout) and fix-on-touch paydown, and why is fix-on-touch high-leverage?
3. State the two conditions that *both* must hold before a rewrite is justified, and name one reason rewrites usually fail.
4. What does a characterization test assert, and why isn't it "asserting the wrong thing" when it locks in a buggy value?
5. Why does Beck insist tidyings and behaviour changes go in separate commits, tidyings first?
6. Sketch how the strangler fig replaces a large module without a big-bang, and why that's lower-risk.
7. You paid down debt in the billing module. What single number best shows it worked, and on what scope?

<details>
<summary>Answers</summary>

1. Continuous/boy-scout (lowest) → fix-on-touch → dedicated paydown → big-bang refactor (highest, before rewrite). The default is continuous/boy-scout; escalate only when the cheaper option can't close the gap.
2. Continuous folds tiny cleanups into whatever you're already doing; fix-on-touch *deliberately* pays the debt in the code a feature is already changing. It's high-leverage because it concentrates effort on frequently-changed code — exactly where the interest (the repeated tax) is highest.
3. Both: (a) refactoring genuinely *can't* reach the target (not just tedious — impossible), and (b) the code is both high-value and beyond repair. Rewrites usually fail because they discard embedded edge-case knowledge / chase a moving target / fall to the second-system effect (any one).
4. It asserts what the code *currently does*, not what it should. Locking in a buggy value is correct because the goal is a net that catches *any* behaviour change during refactoring; fixing the bug is a separate, deliberate change made later under its own test.
5. Because structural and behavioural changes have opposite risk profiles. Separated, a reviewer can approve a pure tidying at a glance and scrutinise the behaviour change alone, and `git revert`/`bisect` can act on one without losing the other. Tidying first makes the real change smaller and obvious.
6. Put a routing façade in front of the old module; build the replacement one slice at a time; flip the router per slice (ideally after a shadow/parallel-run check) until the old module handles nothing, then delete it. Lower-risk because the system ships throughout and risk arrives one reversible slice at a time instead of all at once.
7. Lead-time (cycle-time) for a change *to the billing module specifically*, compared before vs after. Per-area, not codebase-wide — that's the interest you stopped paying. Defect/change-failure rate in that area is the strong secondary.

</details>

---

## Cheat Sheet

```
THE MENU (by blast radius — use the lowest that closes the gap)
  continuous/boy-scout  tiny cleanups inside work you're doing   DEFAULT, lowest risk
  fix-on-touch          pay debt in code a feature already edits  high-leverage
  dedicated             % tax  OR  fix-it days/weeks              medium, needs funding
  big-bang refactor     stop features, restructure at once        rare, high risk
  rewrite               throw it away, rebuild                     almost never

REFACTOR vs REWRITE vs LEAVE
  leave     ugly but stable, off the work path, no defects    → zero interest, don't pay
  refactor  improve structure in small safe steps, behind tests  → the usual answer
  rewrite   ONLY if refactor is impossible AND code high-value+beyond repair
            why rewrites fail: lose embedded knowledge / moving target / 2nd-system

SAFETY NET (Feathers)
  characterization test = pin what the code DOES now (not should)
  1) assert a guess  2) let it fail, read real value  3) lock that value in
  → now refactor freely; net fails loudly on any behaviour change

TIDY FIRST (Beck)
  never mix tidying + behaviour in one commit; tidyings FIRST, separate commits
  → each diff reviewable & revertable on its own

STRANGLER FIG (Fowler)
  façade routes callers → old | new ; migrate one slice at a time
  shadow/parallel-run each slice → flip → ship → repeat → delete old
  ships the whole time; risk sliced not stacked

MEASURE PAYOFF
  lead-time on THAT area (before vs after)   ← interest you stopped paying
  defect/change-failure rate in THAT area
  pick the metric up front, scope to the area you touched
```

---

## Summary

- Paydown is a **menu, not a move**: continuous/boy-scout (default), fix-on-touch, dedicated time (% tax or fix-it days), big-bang refactor (rare), rewrite (almost never). Pick the lowest-blast-radius option that can actually close the gap; the difference between the first three is mostly *where the hours come from*.
- **Fix-on-touch** is the highest-leverage discipline — pay debt in the code a feature is already changing, because that's where the interest is highest. Debt in code nobody touches is zero-interest; *leave it*.
- For a sizeable bad module the choice is **refactor / rewrite / leave**. Refactor is almost always right. Rewrite needs *both* "refactoring is impossible" and "high-value but beyond repair," and usually fails anyway — lost embedded knowledge, a moving target, the second-system effect.
- Touch legacy code only behind a **characterization-test net** (Feathers): pin what the code *does* now so any behaviour change fails loudly. Keep structural and behavioural edits in **separate commits, tidyings first** (Beck's *Tidy First?*), so each is reviewable and revertable.
- Replace a large bad module with the **Strangler Fig** (Fowler): a routing façade migrates one slice at a time, shadow-checked then flipped, shipping the whole way — the incremental alternative to a fatal big-bang.
- **Measure** the payoff as reduced lead-time and defect rate on the *specific area* you touched, chosen up front — that's the interest you stopped paying, and the argument that funds the next paydown.

---

## Further Reading

- *Working Effectively with Legacy Code* — Michael Feathers. The source for characterization tests, seams, and changing untested code safely.
- *Tidy First?* — Kent Beck. Small tidyings, separated from behaviour, in their own commits; the economics of when to tidy at all.
- *Refactoring* (2nd ed.) — Martin Fowler. The catalogue of behaviour-preserving transformations that "refactor" actually means.
- ["StranglerFigApplication"](https://martinfowler.com/bliki/StranglerFigApplication.html) and ["BranchByAbstraction"](https://martinfowler.com/bliki/BranchByAbstraction.html) — Fowler. The incremental-replacement patterns.
- ["Things You Should Never Do, Part I"](https://www.joelonsoftware.com/2000/04/06/things-you-should-never-do-part-i/) — Joel Spolsky. The canonical argument against the big rewrite.
- *The Mythical Man-Month* — Fred Brooks. The second-system effect, in the chapter of the same name.

---

## Related Topics

- [junior.md](junior.md) — the boy-scout rule and why small, scoped cleanups win.
- [senior.md](senior.md) — funding paydown at scale, fitness functions, and leading a strangler migration across teams.
- [04 — Tracking & Prioritizing](../04-tracking-and-prioritizing/middle.md) — deciding *which* debt is worth paying before deciding *how*.
- [06 — Preventing Accumulation](../06-preventing-accumulation/middle.md) — the gates and habits that keep paid-down debt from coming back.
- [Refactoring](../../../code-craft/refactoring/) — the mechanics of every behaviour-preserving transformation referenced here.
- [Clean Code](../../../code-craft/clean-code/) — the local-quality standards a tidying moves code toward.
