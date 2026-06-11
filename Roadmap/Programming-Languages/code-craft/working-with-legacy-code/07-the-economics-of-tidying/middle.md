# The Economics of Tidying — Middle Level

> **Source:** Kent Beck, *Tidy First? — A Personal Exercise in Empirical Software Design* (O'Reilly, 2023), Part III: *Theory*.

---

## Table of Contents

1. [From "it's an investment" to mechanics](#from-its-an-investment-to-mechanics)
2. [Time value of money, applied to engineering hours](#time-value-of-money-applied-to-engineering-hours)
3. [A discount factor you can actually use](#a-discount-factor-you-can-actually-use)
4. [The cost of a change as a function of coupling and cohesion](#the-cost-of-a-change-as-a-function-of-coupling-and-cohesion)
5. [The break-even calculation: when does tidying pay back?](#the-break-even-calculation-when-does-tidying-pay-back)
6. [Worked numbers: three realistic scenarios](#worked-numbers-three-realistic-scenarios)
7. [Why "next change" beats "someday"](#why-next-change-beats-someday)
8. [Putting it together: a decision recipe](#putting-it-together-a-decision-recipe)
9. [Mini Glossary](#mini-glossary)
10. [Review questions](#review-questions)

---

## From "it's an investment" to mechanics

The junior file established the shape of the decision: tidying spends effort now to lower the cost of future changes, and it is worth doing only when the future saving outweighs the present cost. That is the *what*. This file is the *how much* — the mechanics that let you turn "feels worth it" into a number you could defend in a code review or a planning meeting.

Three machines do the work:

1. **Time value of money** — to compare hours spent now against hours saved later, you must discount the later hours. A future saving is worth less than a present cost of the same size.
2. **The cost-of-change model** — to estimate the future saving at all, you need to know what drives the cost of a change. The answer is coupling and cohesion.
3. **A break-even calculation** — to decide, you combine the two: discount the stream of future savings, compare it to the up-front cost, and tidy when the discounted savings win.

None of this requires a finance degree. We keep it light and practical, exactly as Beck does — the point is to *think clearly*, not to produce a spreadsheet auditors would accept.

---

## Time value of money, applied to engineering hours

The core finance fact: **a dollar today is worth more than a dollar tomorrow.** A dollar today can be invested, spent, or simply kept while the future stays uncertain. The same is true of an engineering hour and of an *hour saved*.

Why an hour saved later is worth less than an hour spent now:

- **It arrives later.** You could spend the equivalent effort on something valuable in the meantime.
- **It is less certain.** Plans change. The feature you expected may be cut. The module may be rewritten or deleted. The teammate who would have benefited may leave. Distance in time erodes the probability that the saving ever materializes.

This has a sharp consequence that surprises people: the time value of money argues **against** tidying whose payback is far away, and **for** tidying whose payback is on the very next change.

> **Key idea:** Earn sooner, spend later. Prefer tidyings that pay back immediately (the next change is cheaper) over tidyings that only pay back in a distant, uncertain future. Distance discounts the saving; uncertainty discounts it further.

Read that against the junior rule — *tidy the code you're about to change again and again*. The time value of money is the formal reason that rule is correct: near, repeated changes have the least-discounted, most-certain savings, so they justify the most tidying.

---

## A discount factor you can actually use

To compare a present hour with a future hour, multiply the future hour by a **discount factor** less than 1. If a saving of `S` hours arrives `n` changes from now, and `d` is a per-change discount, its present value is:

```text
PresentValue(S, n) = S × (1 - d)^n        # 0 < d < 1
```

You don't need a "true" `d`. You need a number that captures how uncertain and how distant the future is *in your situation*. Pick a `d` by feel:

| Situation | Suggested per-change discount `d` | Why |
| --- | --- | --- |
| Hot path, edited weekly by your team, on the roadmap | small, e.g. `0.05` | near, certain — barely discounted |
| Normal feature area, edited a few times a quarter | medium, e.g. `0.15` | moderately uncertain |
| Speculative ("might get features next year") | large, e.g. `0.4` | far and unlikely |
| Possibly-doomed module, rewrite rumored | very large, e.g. `0.7` | may never be touched again |

A worked discount, with `S = 30` minutes saved per change and `d = 0.15`:

```text
Change #1 (now):     30 × (0.85)^0 = 30.0 min
Change #2:           30 × (0.85)^1 = 25.5 min
Change #3:           30 × (0.85)^2 = 21.7 min
Change #4:           30 × (0.85)^3 = 18.4 min
----------------------------------------------
Discounted savings over 4 changes ≈ 95.6 min
```

Without discounting you'd have counted `4 × 30 = 120` minutes. Discounting trims it to ~96. The further out a change is, the less it contributes. Push `d` to `0.7` (doomed module) and the same four changes are worth only `30 + 9 + 2.7 + 0.8 ≈ 42` minutes — barely more than one undiscounted change. That collapse is exactly why you don't tidy code that's about to die: the future savings are discounted into nothing.

---

## The cost of a change as a function of coupling and cohesion

Discounting tells you how to *weigh* a saving. But where does the saving come from? It comes from lowering the cost of each future change. So you need a model of that cost. The junior split was:

```text
cost(change) ≈ cost(the change itself) + cost(navigating the surrounding code)
```

The second term — the navigation tax — is driven almost entirely by **coupling** and **cohesion**. Make that precise.

**Coupling drives how many places a change touches.** If element A is coupled to B, C, and D, then changing A means you must also change, or at least carefully check, B, C, and D. Beck's blunt formulation: *the cost of changing software is dominated by the cost of the coupling you must navigate to make the change.* A useful approximation:

```text
cost(change through code X) ≈ base_edit + Σ (cost of every coupling the change must traverse)
```

If a change must ripple through `k` coupled elements, its cost grows roughly with `k`. Cut the coupling so the change traverses 1 element instead of 5, and you've cut the dominant term by ~80%.

**Cohesion drives whether the thing you need to change is in one place.** High cohesion means a single concept lives in a single unit; you edit one place. Low cohesion means the concept is smeared across the codebase; you hunt down every fragment and risk missing one. Raising cohesion collapses a scattered, error-prone edit into a single, local one.

A small concrete illustration. Suppose a "tax rate" rule appears, slightly varied, in five modules (low cohesion + duplication). Changing the rule means five edits and a real chance of missing one:

```text
Low cohesion:   change tax rule → edit 5 sites, verify 5, risk of inconsistency
High cohesion:  change tax rule → edit 1 site (a TaxPolicy), 4 callers unaffected
```

The tidying that creates `TaxPolicy` (consolidating the five copies) is precisely an act of **raising cohesion and lowering coupling**. Its economic value is the per-change saving — four fewer edits, much lower error risk — multiplied across every future change to the tax rule, then discounted.

> **Key idea:** Coupling and cohesion are not aesthetic preferences. They are the *cost drivers*. The dollar value of a tidying equals the reduction in coupling/cohesion-driven cost on each future change, summed and discounted. The deep treatment lives in [`../../design-principles/`](../../design-principles/); here we use it as the engine of the economics.

---

## The break-even calculation: when does tidying pay back?

Now assemble the machine. Let:

- `T` = cost to do the tidying now (hours).
- `S` = saving per future change, from lower coupling / higher cohesion (hours).
- `n` = number of future changes you expect through this code.
- `d` = per-change discount factor.

Tidy when the discounted future savings exceed the up-front cost:

```text
Tidy if:   Σ_{i=1..n}  S × (1 - d)^(i-1)   >   T
```

For intuition, ignore discounting for a moment (`d = 0`). Then the rule collapses to a break-even on **how many changes** you need:

```text
Break-even change count  n*  =  T / S
```

If the tidying costs `T = 1` hour and saves `S = 0.5` hour per change, you break even after `n* = 2` changes; everything after that is profit. Re-introduce discounting and `n*` rises — you need a few *more* changes to pay back, because later ones count for less. That nudge upward is the time value of money doing its job: it makes you skeptical of payoffs that require many future changes to add up.

This single inequality is the whole topic in symbols. The rest is estimating `T`, `S`, `n`, and `d` honestly.

---

## Worked numbers: three realistic scenarios

Use the model on three cases. Estimates are deliberately rough — that's the point; you're making a decision, not auditing a bank.

**Scenario 1 — hot path, about to change again.**
A payment-validation function you edit roughly weekly. The tidying (extract a tangled condition into a named, single-responsibility helper) costs `T = 0.5 h`. Lower coupling saves `S = 0.4 h` per change. You'll plausibly change it `n = 8` more times this quarter. It's hot and on the roadmap, so `d = 0.05`.

```text
Discounted savings ≈ 0.4 × (1 + 0.95 + 0.95² + ... + 0.95⁷)
                   ≈ 0.4 × 6.62  ≈ 2.65 h
T = 0.5 h   →   2.65 ≫ 0.5   →   TIDY. Pays back after ~2 changes.
```

**Scenario 2 — normal area, occasional changes.**
A reporting module edited maybe twice a quarter. Tidying costs `T = 2 h`. Saving `S = 0.5 h` per change, `n = 4` expected changes over the horizon you can see, `d = 0.2`.

```text
Discounted savings ≈ 0.5 × (1 + 0.8 + 0.64 + 0.512) ≈ 0.5 × 2.95 ≈ 1.48 h
T = 2 h   →   1.48 < 2   →   DON'T tidy the whole thing now.
```

The verdict: as scoped, it doesn't pay. But notice the lever — shrink `T`. If you can do a *smaller* tidying for `T = 1 h` that still captures most of `S`, the inequality flips (`1.48 > 1`). **Small batches** aren't just safer; they change the economics by lowering the up-front cost on the left of the ledger.

**Scenario 3 — possibly-doomed module.**
A legacy importer rumored to be replaced next quarter. Tidying costs `T = 1.5 h`, would save `S = 0.6 h` per change, `n = 5` if it survives — but it probably won't, so `d = 0.7`.

```text
Discounted savings ≈ 0.6 × (1 + 0.3 + 0.09 + 0.027 + 0.0081) ≈ 0.6 × 1.43 ≈ 0.86 h
T = 1.5 h   →   0.86 < 1.5   →   DON'T. The discount kills the payback.
```

Same module, if instead the replacement is cancelled and it becomes long-lived (`d = 0.15`):

```text
Discounted savings ≈ 0.6 × (1 + 0.85 + 0.72 + 0.61 + 0.52) ≈ 0.6 × 3.70 ≈ 2.22 h
T = 1.5 h   →   2.22 > 1.5   →   TIDY.
```

The *only* thing that changed was `d`, the certainty of the future. That is the time value of money deciding the call — and it shows why "is this code about to be replaced?" is one of the highest-leverage questions you can ask before tidying.

---

## Why "next change" beats "someday"

The break-even inequality makes the junior slogan rigorous. Compare two tidyings of equal cost `T = 1 h` and equal per-change saving `S = 0.5 h`:

- **Tidying X** pays back on the **next** change: change #1 happens tomorrow.
- **Tidying Y** pays back only after **five** changes of waiting, because the area is cold.

With `d = 0.2`, the first saving from X is worth `0.5 × 0.8^0 = 0.5 h`; the first saving from Y doesn't even *start* until far out, and each instalment is heavily discounted by the time it arrives. X clears its `T = 1 h` cost in two near-term changes; Y may never clear it. Equal cost, equal per-change benefit, wildly different decisions — because of *when* the benefit lands.

> **Key idea:** Two tidyings can have identical costs and identical per-change savings yet opposite verdicts, purely because one pays back sooner. Always tie your tidying to a concrete, near-term change you are actually going to make.

This is also the formal answer to the seductive question "but it'll be cleaner — isn't that good?" Cleaner is only *economically* good when the discounted savings beat the cost. Cleanliness with no near, likely future change is a saving discounted to ~zero against a cost that is paid in full today.

---

## Putting it together: a decision recipe

A repeatable procedure you can run in under a minute at the keyboard:

1. **Anchor to a real change.** Are you about to change this code, or is this speculative? If speculative, stop — your `n` and certainty are already weak.
2. **Estimate `T`** — how long the tidying takes, including review and the small risk of a slip. Bias toward the *smallest* tidying that helps; smaller `T` makes more tidyings pay.
3. **Estimate `S`** — how much each future change gets cheaper. The honest source of `S` is reduced coupling and improved cohesion: *how many fewer places will I touch, how much less will I hold in my head?*
4. **Estimate `n` and `d`** — how often and how certainly this code will change. Hot + roadmapped → small `d`, larger `n`. Cold or doomed → large `d`, smaller effective `n`.
5. **Compare.** If `Σ S(1−d)^i > T`, tidy. If it's close, tidy only the cheap part and re-evaluate.
6. **Default for stable/doomed/untouched code: don't.** The "Never" answer (see [`../06-tidy-first-when-and-how/`](../06-tidy-first-when-and-how/)) is the correct one whenever the discounted savings can't clear the cost.

You will not literally compute this every time. With practice the inequality becomes a reflex: *cheap tidy + near, frequent, certain changes = yes; expensive tidy + far, rare, uncertain changes = no.* The numbers are training wheels for that judgment.

---

## Mini Glossary

| Term | Meaning |
| --- | --- |
| **Time value of money** | A saving (or cost) is worth more the sooner it occurs; later amounts are discounted because they're delayed and less certain. |
| **Discount factor `d`** | A per-change multiplier `(1−d)` applied to future savings; bigger `d` means a more uncertain/distant future. |
| **Present value** | The discounted, "today" worth of a future saving: `S × (1−d)^n`. |
| **Cost-of-change model** | `cost ≈ base edit + cost of the coupling the change must navigate`; the navigation term dominates for messy code. |
| **Coupling** | Dependency between code elements; drives *how many places* a change touches. The primary cost driver. |
| **Cohesion** | How well a unit's contents belong together; high cohesion keeps a change *in one place*. |
| **Saving per change `S`** | Hours a tidying removes from each future change, via lower coupling / higher cohesion. |
| **Break-even count `n\*`** | Roughly `T / S` (undiscounted) — how many future changes are needed before a tidying turns a profit. |
| **Small batches** | Doing tidyings in small pieces; lowers up-front cost `T` and risk, often flipping a marginal decision to "tidy." |

---

## Review questions

1. State the time-value-of-money rule in one sentence, and explain why it argues *against* tidying with distant payback.
2. Write the present-value formula for a saving `S` that arrives `n` changes from now, and compute it for `S = 40 min`, `n = 3`, `d = 0.2`.
3. The cost of a change has a "navigation tax" term. Which two design properties drive it, and how does each one drive it?
4. Derive the undiscounted break-even change count `n*` for `T = 1.5 h` and `S = 0.3 h`. After how many changes does the tidying turn a profit?
5. In Scenario 2 the tidying didn't pay at `T = 2 h` but did at `T = 1 h`. Which variable did you change, and what general lesson about batch size does this teach?
6. In Scenario 3 the *only* difference between "tidy" and "don't tidy" was `d`. What real-world fact does `d` encode here, and why is "is this code about to be replaced?" such a high-leverage question?
7. Two tidyings have the same `T` and the same `S` but opposite verdicts. What single property differs, and why is it decisive?
8. A colleague argues "cleaner code is always good, so we should always tidy." Rebut this using the break-even inequality.
9. Why does introducing discounting *raise* the break-even change count compared to the undiscounted version?
10. Walk through the six-step decision recipe for a concrete piece of code you've worked on, putting rough numbers on `T`, `S`, `n`, and `d`.
