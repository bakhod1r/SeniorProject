# What Is Technical Debt — Middle Level

> **Roadmap:** [Technical Debt Management](../README.md) → What Is Technical Debt
> *The junior page taught the metaphor. This page makes it precise: principal vs interest vs interest *rate*, a working taxonomy of the seven debt types, the sharp line between debt and the things people mislabel as debt, and what Cunningham actually meant — which is almost the opposite of "debt = sloppy code."*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Principal, Interest, and the Interest Rate](#principal-interest-and-the-interest-rate)
4. [A Working Taxonomy — The Seven Types of Debt](#a-working-taxonomy--the-seven-types-of-debt)
5. [Debt vs Its Impostors — Cruft, Bugs, Gold-Plating, Over-Engineering](#debt-vs-its-impostors--cruft-bugs-gold-plating-over-engineering)
6. [What Cunningham Actually Said](#what-cunningham-actually-said)
7. [Deliberate vs Accidental Debt](#deliberate-vs-accidental-debt)
8. [Cost of Delay — When the Shortcut Is the Cheap Option](#cost-of-delay--when-the-shortcut-is-the-cheap-option)
9. [Mental Models](#mental-models)
10. [Common Mistakes](#common-mistakes)
11. [Test Yourself](#test-yourself)
12. [Cheat Sheet](#cheat-sheet)
13. [Summary](#summary)
14. [Further Reading](#further-reading)
15. [Related Topics](#related-topics)

---

## Introduction

> Focus: **What precisely is debt, what are its kinds, and what is it *not*?**

At the junior level, technical debt is a vivid metaphor: take a shortcut now, pay it back later with interest. That model is correct but blunt. It can't yet explain *why* two pieces of "messy code" demand completely different responses, *why* a senior engineer will defend one shortcut as good judgment and condemn another as malpractice, or *why* the most expensive debt is often the code nobody is complaining about.

The precision comes from three moves this page makes. First, splitting the loan into **principal**, **interest**, and the **interest rate** — three different numbers that drive three different decisions. Second, a **taxonomy**: debt is not one thing but at least seven, each with its own smell, its own cost, and its own cure. Third, a **border patrol** — separating real debt from the bugs, cruft, and over-engineering that get dumped under the same word, because conflating them produces bad triage and worse conversations with the people who fund the work.

Get these right and "this code is gross" becomes "this is *design* debt with a high interest rate in the area we ship every sprint — here's the paydown case." That translation is the entire skill.

---

## Prerequisites

- **Required:** You've read [junior.md](junior.md) and can state the loan metaphor in one sentence.
- **Required:** You've personally hit a change that took far longer than it "should have" because of existing code.
- **Helpful:** Exposure to [Refactoring](../../../code-craft/refactoring/) — you know what the *cure* for debt looks like, even if not when to apply it.
- **Helpful:** A rough sense of code smells as *symptoms* (see [Anti-Patterns](../../../code-craft/anti-patterns/)).

---

## Principal, Interest, and the Interest Rate

The financial metaphor is usually quoted with two terms. Working with debt seriously needs three.

- **Principal** — the one-time cost to *fix the debt properly*: extract the abstraction, split the god class, write the missing tests. Pay the principal and the debt is gone. This is what a refactoring ticket estimates.
- **Interest** — the *recurring* extra cost you pay every time you work near the debt while it's still there: the slower change, the extra bug, the longer code review, the onboarding confusion. Interest is paid in installments whether or not you ever choose to clear the principal.
- **Interest rate** — *how much slower each future change becomes* because the debt is present. This is the term most people omit, and it's the one that should drive prioritization.

The distinction that matters: **principal is paid once and is roughly fixed; interest is paid forever and scales with how often you touch the code.** A pile of ugly code with a large principal but a *zero* interest rate — because nobody ever modifies it — costs you nothing to keep. The same principal in a file you edit twice a week bleeds you continuously.

```
Total cost of keeping the debt over a period
  = interest_rate × (number of changes you make near it)

Total cost of clearing it
  = principal  (paid once)

Pay down when:  interest_rate × expected_future_changes  >  principal
```

This is why "we have 400 hours of technical debt" (a pure principal number, which is all SonarQube's remediation estimate gives you — see [02 — Identifying & Quantifying](../02-identifying-and-quantifying/middle.md)) is a weak argument. Four hundred hours sitting in dead, untouched code is not worth one hour to fix. Forty hours sitting in your hottest file might be worth fixing *this week*. The rate, multiplied by churn, is the signal; the principal alone is noise.

> **Key insight:** The interest *rate* — the slowdown tax on each future change — is the number that decides whether debt is worth paying down. Debt in code you never touch has a near-zero rate and is effectively free to keep, however ugly. Debt in code you change constantly compounds fast. Prioritize by rate × churn, not by principal.

---

## A Working Taxonomy — The Seven Types of Debt

"Technical debt" used as a single label hides the fact that you treat each kind differently. A useful working taxonomy splits it into seven types. The point of naming them is operational: each has a distinct *symptom*, a distinct *cure*, and a distinct *owner*.

| Type | What it is | Concrete example | Primary cure |
|---|---|---|---|
| **Code-level** | Local mess inside a unit: duplication, bad names, long methods | A 300-line function with three copy-pasted validation blocks | Refactor in place; the boy-scout rule |
| **Design / architectural** | Wrong or eroded structure: bad boundaries, cyclic deps, leaky layers | The web controller talks straight to the SQL driver, so swapping the DB touches 40 files | Re-draw boundaries; strangler fig |
| **Test** | Missing, slow, or flaky tests; low coverage of risky paths | The payments module has no tests, so every change is hand-verified in staging | Characterization tests, then refactor |
| **Documentation** | Missing or stale docs: dead READMEs, no ADRs, tribal knowledge | The deploy runbook describes a server decommissioned last year | Docs-as-code; ADRs for decisions |
| **Infrastructure / build** | Brittle, slow, or non-reproducible build & deploy machinery | A 40-minute CI pipeline nobody can run locally, breaking weekly | Reproducible builds; pipeline rework |
| **Dependency / version** | Outdated, abandoned, or pinned libraries and runtimes | Stuck on a framework two majors behind; a CVE patch needs a risky upgrade | Steady upgrade cadence; renovate bots |
| **Knowledge** | Understanding that lives in one head, or is lost entirely | Only one engineer understands the billing state machine; she's on leave | Pairing, docs, bus-factor reduction |

A few of these deserve a sharper look.

**Design debt is the expensive one.** Code-level debt is bounded — a bad function costs you only when you edit *that function*. Design debt is *systemic*: a wrong boundary taxes every feature that crosses it. When people say "the rewrite," they almost always mean design debt that has compounded past the point where local refactoring can reach it.

**Knowledge debt is the invisible one.** It produces no failing test and no smell a linter can catch, yet its interest rate spikes catastrophically the moment the one person who understands the system leaves. A team can have a pristine codebase and still be one resignation away from a crisis. The metric here is **bus factor** — how many people can vanish before the project stalls.

**Dependency debt has a *deadline you don't control*.** Most debt accrues interest on your schedule; an unpatched dependency can convert to a forced, urgent, all-hands paydown the day a CVE drops or the version you're pinned to drops out of support. Its rate is low and flat until it isn't.

```
              interest rate over time
code-level     ▁▁▁▁▁▁▁▁  flat & low (local)
design         ▁▂▃▄▅▆▇█  compounds as the system grows around it
dependency     ▁▁▁▁▁▁█▁  flat, then a forced spike (CVE / EOL)
knowledge      ▁▁▁▁▁█▁▁  flat, then a spike (the expert leaves)
```

> **Key insight:** "Technical debt" is not one quantity. The seven types differ in *who* owns them, *how* their interest accrues over time, and *what* pays them down. A debt-paydown plan that lists only "refactor messy code" is blind to test, dependency, and knowledge debt — which are often the items with the steepest interest curves.

---

## Debt vs Its Impostors — Cruft, Bugs, Gold-Plating, Over-Engineering

The word "debt" gets stretched over a lot of things that aren't debt. The distinctions are not pedantic — each impostor wants a *different* response, and mislabeling it picks the wrong one.

**Cruft** is low-quality code with no upside — mess produced by carelessness or ignorance, not a trade-off anyone chose. The test: *was there ever a deliberate decision to defer quality in exchange for speed or learning?* Debt was borrowed on purpose to buy something; cruft is just damage. Calling cruft "debt" launders incompetence into a financial decision nobody made — it implies a benefit was once received. There wasn't one. (This doesn't change what you *do* — you may still clean both up — but it changes the honesty of the conversation and the lesson for next time.)

**Bugs** are *defects*: the code does the wrong thing against its own spec. Debt code is, by contrast, *correct but costly to change*. A function with three copy-pasted blocks that all compute the right answer is debt; one that returns the wrong total is a bug. They land in different queues: bugs are triaged by severity and impact on users *now*; debt is triaged by interest rate and impact on *future* work. Debt can *cause* bugs — that elevated defect rate is part of debt's interest — but the debt and the bug are not the same item.

**Gold-plating** is effort spent making something nicer than the requirement asked for: a beautifully abstracted, fully configurable widget for a one-off internal tool. It's the *opposite* of a debt shortcut — you over-invested instead of under-investing. It's waste, not debt; the fix is to *stop*, not to pay anything back.

**Over-engineering** is structure built for needs that never arrived: the pluggable strategy interface with exactly one implementation, the message bus for a monolith with one consumer. It often *looks* like good design — it has abstractions, layers, extension points. But unneeded flexibility is itself a cost: more code to read, more indirection to trace, more places for a change to ripple. Here is the trap that confuses everyone: **over-engineering can become design debt.** The speculative abstraction you built for a future that never came is now structure you must work *around*, and its interest rate is real. So the same artifact can start as gold-plating (waste) and age into design debt (a recurring tax).

> **Key insight:** Debt is a *deliberate trade-off you made to gain something* (speed, learning, an earlier ship date). Cruft is damage with no upside. Bugs are wrong behavior. Gold-plating and over-engineering are *over*-investment, the mirror image of a shortcut. They look alike on the screen and require opposite responses — so the first triage question is never "is this messy?" but "what decision produced this, and what did we get for it?"

---

## What Cunningham Actually Said

The metaphor is routinely cited to justify shipping bad code: "we'll take on some tech debt." Cunningham's own [2009 clarifying video](https://www.youtube.com/watch?v=pqeJFYwnkjE) says nearly the opposite. His words:

> *"I'm never in favor of writing code poorly, but I am in favor of writing code to reflect your current understanding of a problem even if that understanding is partial."*

And the line that reframes the whole thing:

> *"The debt is [not] something that occurs because you do something wrong… it's the fact that you make all the analyses to acquire the knowledge but you didn't put that knowledge into the program."*

Read carefully, the original metaphor was never about *sloppiness*. It was about **shipping software that reflects your current — necessarily incomplete — understanding of the domain, so you can learn from real use, and then folding what you learn back into the design.** The debt is the gap between *what you now understand* and *what the code expresses*. You "borrow" by shipping before your understanding is complete; you "repay" by **consolidating your understanding into the code** as it grows — which is exactly what refactoring is *for*.

This is why "debt = writing sloppy code on purpose" misreads him on two counts:

1. He explicitly disowns writing code *poorly*. The borrowed code in his telling was *clean and well-written*; it just encoded an *early, partial model* of the problem. Sloppy code is not the loan — it's not even the same financial product.
2. The interest in his metaphor is the cost of **operating with an out-of-date understanding** baked into the code — not the cost of stepping around ugliness. You pay it because the program no longer matches how you now think about the domain, and every change has to fight that mismatch.

There is a real tension worth naming: Fowler and McConnell later broadened "debt" to include the *messy-shortcut* sense most teams now use day to day — and that broader usage is legitimate and useful. The point isn't that the common usage is wrong; it's that quoting *Cunningham* to bless *deliberate sloppiness* invokes an authority who said the reverse. Know which definition you're using, and don't borrow Cunningham's name for a meaning he rejected.

> **Key insight:** Cunningham's debt is *unconsolidated understanding*, not *deliberate mess*. You borrow by encoding an early model of the problem and shipping to learn; you repay by feeding what you learned back into the design. The popular "shortcut" reading is a valid extension of the term — but it is not what Cunningham described, and citing him to excuse poor code inverts his actual point.

---

## Deliberate vs Accidental Debt

The single most useful first cut on any piece of debt is whether it was **deliberate** or **accidental** — because it determines both the *response* and the *lesson*.

- **Deliberate debt** is incurred knowingly: *"We'll hard-code the tax rates to make the demo Friday; we open a ticket to make them configurable next sprint."* The decision is conscious, the trade-off is understood, and — critically — it is *recorded*. This is debt in the truest sense: a loan taken with eyes open to buy something specific (a deadline, a faster learning loop).
- **Accidental debt** is discovered after the fact: nobody chose it. It comes from a model that turned out wrong, a library that aged badly, a requirement that shifted under the design, or simply not knowing a better pattern at the time. The code may have been the best anyone could do then; it's debt now because the world moved.

The trap is that accidental debt is the *larger* category for most teams, yet the metaphor's vocabulary — "borrow," "trade-off," "pay back" — is built for the deliberate kind. When a team says "we knew this would be a problem" about debt that nobody actually decided to take on, they are retrofitting agency onto an accident, which blocks the real lesson (the *design or process gap* that let it accrue unseen).

Crucially, **deliberate is not the same as good, and accidental is not the same as bad.** A deliberate shortcut can be reckless; an accidental gap can be entirely forgivable. That second axis — prudent vs reckless — is what turns this two-way split into Fowler's full four-box grid. We point forward to it: **[03 — The Debt Quadrant](../03-the-debt-quadrant/middle.md)** crosses *deliberate / accidental* with *prudent / reckless* to give four kinds of debt, each demanding a different response. For now, hold the simpler distinction: *did someone choose this, and is it written down?*

> **Key insight:** "Did we choose this debt, and did we record it?" is the highest-value first question. Deliberate-and-recorded debt is a managed loan — track it, schedule it. Accidental debt is a discovery — the lesson is usually about the *process* that let it accumulate unseen, not about blame. The cross with prudent/reckless completes the picture in [03](../03-the-debt-quadrant/middle.md).

---

## Cost of Delay — When the Shortcut Is the Cheap Option

It is tempting to read "debt is a tax" as "therefore always avoid it." That's wrong, and the reason is **cost of delay**: shipping later also has an interest rate, and sometimes it's the higher one.

Every feature carries a cost for *not having shipped it yet* — revenue not captured, a competitor reaching the market first, a customer churning, a learning loop you can't close until real users touch the thing. That is the interest on *delay*. The honest comparison is between two interest streams:

```
Take the shortcut:  pay  interest_on_debt   (slower future changes, maybe a refactor later)
Don't ship yet:     pay  interest_on_delay  (lost revenue / learning / market position now)

Borrow when:  interest_on_delay  >  interest_on_debt
```

A concrete case: a startup can hard-code support for a single payment provider to launch this month, or build a clean provider-abstraction and launch in three. If the clean version's three-month delay means a competitor captures the market — or the company never learns whether anyone *wants* the product — the interest on delay dwarfs the interest on the hard-coded shortcut. Taking the debt is the *correct* engineering decision. (Provided it's deliberate and recorded — the loan only stays cheap if someone tracks it and pays it down once the bet pays off.)

The mirror case keeps you honest: when the feature is core, long-lived, and central to everything you'll build next — your authentication system, your core data model — the interest on *that* debt compounds for years, while the delay to do it right is bounded. There, ship-it-clean wins decisively.

> **Key insight:** Debt is not always the expensive choice. The decision is *interest on the shortcut* versus *interest on the delay*. When time-to-market or time-to-learning dominates — early product bets, demos, throwaway experiments — the cheapest path is often to borrow deliberately and clean up after the bet resolves. Senior judgment is reading *which* interest stream is larger here, not reflexively avoiding all debt.

---

## Mental Models

- **Principal is a one-time bill; interest is a subscription.** You pay the principal once to be rid of the debt; you pay the interest every time you work near it, forever, until you do. A subscription on a service you never use (untouched code) is harmless; on one you use daily, it dominates the bill.

- **The interest *rate* is a slowdown tax, not a balance.** It's not "how much debt is there" but "how much slower is every change in this area." A small balance at a brutal rate (your hottest file) beats a huge balance at zero rate (dead code) for your attention.

- **Debt is a loan; cruft is damage.** The test for the word "debt" is whether a benefit was ever received in exchange. If yes, it's a loan and the metaphor's math applies. If no, it's just damage with a financial costume on.

- **Cunningham's debt is a stale map.** You drew the best map you could from what you'd explored; the territory is now better understood than the map shows. The "interest" is every wrong turn you take because you're navigating by the old map. You repay by updating the map — that's refactoring.

- **Over-engineering is debt with the sign flipped.** A shortcut under-builds and you pay later to add structure; over-engineering over-builds and you pay later to remove structure you must route *around*. Both end up as a tax on future change.

---

## Common Mistakes

1. **Quoting the principal and calling it the cost.** "We have 400 hours of debt" (SonarQube's remediation estimate) is a *principal* figure. Without the interest rate × churn, it can't tell you whether a single hour of paydown is justified. Untouched debt at high principal is cheap to keep.

2. **Filing every messy thing under "debt."** Cruft, bugs, gold-plating, and over-engineering get dumped under the same word and then mis-triaged. Ask *what decision produced this and what did it buy* before reaching for the loan metaphor.

3. **Citing Cunningham to justify sloppy code.** He explicitly opposed writing code poorly. His debt is *unconsolidated understanding*, not deliberate mess. Use Fowler's broader sense if you mean the shortcut kind — just don't attribute it to Cunningham.

4. **Treating "deliberate" as "good" and "accidental" as "bad."** Deliberate debt can be reckless; accidental debt can be forgivable. Whether it was *chosen* is a separate axis from whether it was *wise* — which is the whole point of [the quadrant](../03-the-debt-quadrant/middle.md).

5. **Assuming all debt should be avoided.** When cost of delay exceeds the interest on the shortcut — early bets, demos, market races — borrowing deliberately is the correct call. Reflexive debt-aversion ships the perfect product after the window closed.

6. **Ignoring the invisible types.** Test, dependency, and knowledge debt produce no smell a linter flags, yet often carry the steepest interest curves (a CVE, a key engineer's departure). A paydown plan that only sees "messy code" is blind to its biggest risks.

---

## Test Yourself

1. Distinguish *principal*, *interest*, and *interest rate*. Which one should drive prioritization, and why?
2. Why is "we have 400 hours of technical debt" a weak argument on its own?
3. Name four of the seven debt types and give a one-line example of each. Which type carries a deadline you don't control?
4. A copy-pasted function computes the *correct* answer but is duplicated in three places. Debt or bug? What about a function that returns the *wrong* total?
5. What did Cunningham mean by debt, and why is "debt = writing sloppy code on purpose" a misreading of him?
6. Give a concrete case where taking on debt is the *correct* decision. What makes it correct?

<details>
<summary>Answers</summary>

1. **Principal** = one-time cost to fix the debt properly. **Interest** = recurring extra cost paid each time you work near it. **Interest rate** = how much slower each future change becomes. The *rate* (× churn) drives prioritization, because it tells you whether paying the one-time principal is worth it: high rate in a hot file justifies paydown; zero rate in dead code never does.
2. It's a pure *principal* figure with no *rate*. Four hundred hours in untouched code costs nothing to keep; the same in your hottest file bleeds you continuously. Without rate × churn you can't tell which.
3. Any four of: code-level (duplicated validation block), design (controller calling the SQL driver directly), test (untested payments module), documentation (runbook for a dead server), infrastructure/build (un-runnable 40-min CI), dependency (framework two majors behind), knowledge (one person understands billing). **Dependency** debt carries an external deadline — a CVE or end-of-life forces an urgent paydown on someone else's schedule.
4. The duplicated-but-correct function is **debt** (correct, costly to change). The wrong-total function is a **bug** (wrong behavior against spec). Debt can *cause* bugs, but they're triaged in different queues.
5. Cunningham's debt is the gap between your *current understanding* of the problem and what the *code expresses* — shipping an early, clean-but-partial model to learn, then consolidating that learning back into the design. "Sloppy on purpose" misreads him because he explicitly opposed writing code poorly; the loan was clean code encoding a partial model, and the interest is operating with an out-of-date understanding baked in.
6. A startup hard-codes one payment provider to launch in one month instead of building a clean abstraction in three, because the cost of delay (a competitor wins the market, or they never learn if anyone wants it) exceeds the interest on the shortcut. It's correct *provided* the debt is deliberate, recorded, and paid down once the bet resolves.

</details>

---

## Cheat Sheet

```
THE THREE NUMBERS
  principal       one-time cost to fix it properly        (paid once)
  interest        recurring extra cost while it's there   (paid per change)
  interest RATE   how much slower each future change is   ← drives priority
  pay down when:  rate × expected_future_changes > principal

THE SEVEN TYPES
  code-level      local mess (dup, names, long methods)   → refactor in place
  design          wrong/eroded structure & boundaries     → strangler, re-draw  ← costliest
  test            missing/flaky/slow tests                → characterization tests
  documentation   stale/missing docs, no ADRs             → docs-as-code
  infra / build   brittle, slow, non-reproducible builds  → reproducible builds
  dependency      outdated/abandoned libs & runtimes      → upgrade cadence (deadline you don't own)
  knowledge       understanding in one head / lost        → pairing, docs (watch bus factor)

NOT DEBT (different cures)
  cruft           mess with NO upside (no trade made)     → it's damage, not a loan
  bug             wrong behavior vs spec                  → severity queue, not debt queue
  gold-plating    over-built beyond the requirement       → stop; it's waste
  over-engineer   structure for needs that never came     → can AGE into design debt

FIRST QUESTIONS (in order)
  1. What decision produced this, and what did it buy?    (debt vs impostor)
  2. Did someone CHOOSE it, and is it RECORDED?           (deliberate vs accidental)
  3. Was it prudent or reckless?                          → see the quadrant (03)
  4. Is interest_on_delay > interest_on_debt?             (sometimes borrow!)

CUNNINGHAM, CORRECTLY
  debt = gap between current understanding and what the code expresses
  NOT  = "writing sloppy code on purpose" (he opposed that explicitly)
  repay = consolidate understanding into the design  (= refactoring)
```

---

## Summary

- Debt has **three** numbers, not two: **principal** (one-time fix cost), **interest** (recurring cost while it's there), and the **interest rate** (how much slower each future change becomes). The *rate × churn* — not the principal — is what should drive paydown decisions; debt in untouched code is effectively free to keep.
- "Technical debt" is at least **seven types** — code-level, design, test, documentation, infrastructure/build, dependency, and knowledge — each with its own symptom, owner, interest curve, and cure. Design debt is the costliest because it's systemic; test, dependency, and knowledge debt are the invisible ones with the steepest spikes.
- Debt has **impostors**: cruft (damage with no upside), bugs (wrong behavior), gold-plating and over-engineering (over-investment). They look alike on screen but demand opposite responses; the first triage question is "what decision produced this and what did it buy," not "is it messy."
- **Cunningham's** debt is *unconsolidated understanding* — shipping a clean, partial model to learn and folding the lessons back in — *not* deliberate sloppiness, which he explicitly opposed. The popular "shortcut" sense is a valid extension (Fowler, McConnell), just not his.
- The highest-value first cut is **deliberate vs accidental** — did someone choose this, and is it recorded? Crossed with prudent vs reckless, this becomes [the debt quadrant](../03-the-debt-quadrant/middle.md).
- Debt is **not always wrong**: when **cost of delay** (lost revenue, learning, market position) exceeds the interest on the shortcut, borrowing deliberately is the correct engineering decision — provided it's recorded and paid down once the bet resolves.

---

## Further Reading

- *Ward Cunningham — Debt Metaphor* (2009 video) — the original author clarifying, in four minutes, that debt is about unconsolidated understanding, not bad code. Watch it before quoting him.
- *Technical Debt* — Martin Fowler (martinfowler.com) — the concise, authoritative modern treatment, and the source of the prudent/reckless × deliberate/inadvertent quadrant.
- *Managing Technical Debt* — Kruchten, Nord & Ozkaya (SEI) — the most rigorous book-length taxonomy and management framework.
- *Software Design X-Rays* — Adam Tornhill — where the "interest rate × churn" intuition becomes a measurable practice (behavioral hotspots).

---

## Related Topics

- [02 — Identifying & Quantifying](../02-identifying-and-quantifying/middle.md) — turning these definitions into numbers: hotspots, remediation cost, lead-time and defect signals.
- [03 — The Debt Quadrant](../03-the-debt-quadrant/middle.md) — crossing deliberate/accidental with prudent/reckless to classify debt and respond to each kind correctly.
- [05 — Paying Down Debt](../05-paying-down-debt/middle.md) — once you've named and classified it, how to actually clear it (boy-scout rule, strangler fig, refactor vs rewrite).
- [Refactoring](../../../code-craft/refactoring/) — the *mechanics* of paying down code-level and design debt safely.
- [Anti-Patterns](../../../code-craft/anti-patterns/) — the recurring shapes that debt and cruft take in real codebases.
- [senior.md](senior.md) — debt as a portfolio: modeling interest curves, framing paydown in cost-of-delay terms leadership will fund.
