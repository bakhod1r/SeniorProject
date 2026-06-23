# The Debt Quadrant — Middle Level

> **Roadmap:** [Technical Debt Management](../README.md) → The Debt Quadrant
> *The junior page drew the four boxes. This page turns them into a working tool: a different, concrete response for each cell — and an honest account of where the grid stops being a grid and becomes a continuum you have to argue about.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [The Two Axes, Precisely](#the-two-axes-precisely)
4. [A Response Per Cell — the Whole Point of the Grid](#a-response-per-cell--the-whole-point-of-the-grid)
5. [Cunningham's Original Debt Was Inadvertent + Prudent](#cunninghams-original-debt-was-inadvertent--prudent)
6. [Classifying Real Debt — Worked Examples](#classifying-real-debt--worked-examples)
7. [Where the Quadrant Breaks Down](#where-the-quadrant-breaks-down)
8. [Other Taxonomies, Briefly](#other-taxonomies-briefly)
9. [Mental Models](#mental-models)
10. [Common Mistakes](#common-mistakes)
11. [Test Yourself](#test-yourself)
12. [Cheat Sheet](#cheat-sheet)
13. [Summary](#summary)
14. [Further Reading](#further-reading)
15. [Related Topics](#related-topics)

---

## Introduction

> Focus: **How do I use the quadrant to decide what to actually *do* about a piece of debt?**

At the junior level the debt quadrant is a 2×2 picture you can recognize: deliberate vs inadvertent down one side, prudent vs reckless across the top, four boxes, done. That picture is correct but inert. It classifies, but classification with no consequence is just vocabulary.

The quadrant earns its place only when each cell points to a *different action*. Deliberate-and-prudent debt and inadvertent-and-reckless debt are not "two kinds of bad code to clean up later" — one is a sign your team is healthy and the other is a sign your *process* is broken, and they call for completely different interventions (a schedule versus a training budget). Fowler's whole reason for adding the second axis was to separate "we knew and chose this" from "we shipped this in good conscience but were wrong" — because **you respond to a *judgment* problem differently than you respond to a *knowledge* problem.**

This page does three things: gives each cell a concrete response, recovers what Cunningham *actually* meant (which is not the cell most people assume), and is honest about the quadrant's limits — because a senior engineer who wields it as if the four boxes were real loses arguments to anyone who has noticed they aren't.

---

## Prerequisites

- **Required:** You've read [junior.md](junior.md) and can name all four cells of the quadrant.
- **Required:** You understand principal vs interest from [01 — What Is Technical Debt](../01-what-is-technical-debt/middle.md).
- **Helpful:** You've personally shipped a deliberate shortcut under a deadline *and* later discovered a design decision was wrong only after the system taught you something.
- **Helpful:** You've sat in a retro where "that's just tech debt" ended a conversation that should have continued.

---

## The Two Axes, Precisely

Fowler's grid has two axes, and most misuse comes from blurring what each one measures.

The **vertical axis — deliberate vs inadvertent — is about *intent*.** Did you *know*, at the moment of the decision, that you were taking on debt? Deliberate means there was a fork in the road and you consciously took the cheaper-now branch. Inadvertent means there was no perceived fork — you did what looked right and only later learned it was a shortcut.

The **horizontal axis — prudent vs reckless — is about *judgment*.** Given what you knew (or could reasonably have known) at the time, was the decision *defensible*? Prudent means a competent engineer, with the same information, would plausibly have done the same. Reckless means the decision violated knowledge that was available and cheap to apply — you cut a corner you had no business cutting, or you didn't know something you were professionally obligated to know.

Hold these apart, because they answer different questions and demand different fixes:

| Axis | Question it answers | A bad value points to a problem in… |
|---|---|---|
| **Deliberate ↔ Inadvertent** | *Did we know we were doing it?* | nothing by itself — both can be fine |
| **Prudent ↔ Reckless** | *Was it a defensible call given what we knew?* | judgment, skill, or process |

> **Key insight:** Intent (deliberate/inadvertent) is morally and managerially *neutral* — both ends are normal in healthy engineering. It's the *judgment* axis (prudent/reckless) that carries the alarm. The most common analytical error is treating "deliberate" as the bad word and "inadvertent" as the excuse. It's the reverse: *reckless* is the word that should make you act, regardless of intent.

---

## A Response Per Cell — the Whole Point of the Grid

Here is the grid with the only thing that makes it useful: a distinct response per cell. Read each cell as "what does this debt *tell me*, and what do I *do*."

|  | **Prudent** | **Reckless** |
|---|---|---|
| **Deliberate** | *"We must ship now and deal with the consequences."* → **This is healthy.** Record it, make the interest visible, schedule paydown. | *"We don't have time for design."* → **A pressure/planning failure.** Escalate; fix the conditions, not just the code. |
| **Inadvertent** | *"Now we know how we should have done it."* → **This is normal growth.** Capture the learning, refactor toward the new understanding. | *"What's layering?"* → **A skills / review-process gap.** Invest in training, mentoring, and review — not a one-off cleanup. |

Now the responses in depth.

**Deliberate + Prudent — track it, schedule paydown, it's a sign of health.**
This is debt taken the way the metaphor intends: a conscious, defensible trade to ship and learn faster. *"We'll hard-code the single payment provider to hit the launch; we know we'll need an abstraction when the second one lands."* The response is **not** to feel guilty and **not** to fix it immediately. It's to make the debt *legible*: write it down in the debt register ([04 — Tracking & Prioritizing](../04-tracking-and-prioritizing/middle.md)), note the *interest* (what slows down while it exists) and the *trigger* (the event that makes paydown urgent — here, the second provider), and put it where it can be prioritized against everything else. A team that produces a steady stream of well-tracked deliberate-prudent debt is *working correctly*; the failure mode is not taking it, it's taking it and then forgetting it.

**Deliberate + Reckless — escalate; this is a planning or pressure problem, not a code problem.**
*"We don't have time for design — just make it pass the demo."* The decision was conscious *and* indefensible: the team knew a better path, had the skill to take it, and chose the corner anyway. The code is the *symptom*; the *disease* is upstream — unrealistic deadlines, a culture that punishes slowness, a manager who treats design as optional. **Cleaning the code without fixing the conditions guarantees the same debt next sprint.** So the response is to *escalate the conditions*: name the trade-off explicitly to whoever owns the schedule, surface the accumulated interest in their language (lead time, defect rate, on-call pain — see [02 — Identifying & Quantifying](../02-identifying-and-quantifying/middle.md)), and negotiate either time to do it right or an *explicit, recorded* decision to accept the debt (which, once recorded and chosen with eyes open, has just moved toward deliberate-prudent).

**Inadvertent + Prudent — capture the learning and refactor toward it; this is healthy growth.**
*"Now we know how we should have done it."* You designed reasonably, the system ran, and *running it taught you something you couldn't have known up front* — the domain had a wrinkle, the load pattern wasn't what you guessed, the abstraction you chose strained at exactly the seam you couldn't foresee. There is **nothing to apologize for**; this is the engine of good design. The response is to *consolidate the new understanding* (Cunningham's exact phrase) into the code: capture the insight (a short ADR, a comment, a ticket explaining the gap between the old model and the new), then refactor the design toward what you now understand. This is the cell where "refactor toward the new understanding" is the literal correct move — and where suppressing the refactor (shipping over the old model forever because "it works") is how inadvertent-prudent debt quietly rots.

**Inadvertent + Reckless — invest in skills and review; this is a process gap, not a cleanup task.**
*"What's layering?"* The team didn't know they were taking on debt *and* the ignorance was not excusable — these are mistakes a competent engineer in this role shouldn't be making, and which should have been caught. The danger is responding to it as if it were the code's fault: you can refactor this one tangle, but **the same gap will reproduce it next week**, because the cause is *capability and process*, not this particular file. The response targets the system that produced it: **training and mentoring** to close the knowledge gap, and a **code-review / pairing** practice strong enough that this class of mistake gets caught before it lands ([06 — Preventing Accumulation](../06-preventing-accumulation/middle.md)). The cleanup is necessary but secondary; the investment is in the people and the gate.

> **Key insight:** The two *reckless* cells share a tell — the right fix is almost never "refactor this code." It's "change the system that produced this code." Deliberate-reckless → fix the *planning/pressure*. Inadvertent-reckless → fix the *skills/review*. Treating reckless debt as a cleanup ticket is treating a fever by icing the thermometer.

---

## Cunningham's Original Debt Was Inadvertent + Prudent

Here is the part almost everyone gets backwards. When Ward Cunningham coined "technical debt" — explaining the WyCash financial system to his managers at OOPSLA in 1992 — he was **not** describing the deliberate corner-cutting most people now mean by the term. Read his own 2009 clarification:

> *"I'm never in favor of writing code poorly, but I am in favor of writing code to reflect your current understanding of a problem even if that understanding is partial. … As you learned things about that domain you would repay that loan by refactoring the program to reflect your improved understanding."* — Ward Cunningham

Cunningham's debt is the gap between the code's design and your *current* understanding of the domain — a gap created not by sloppiness but by the simple fact that **you understand a problem better after you've built software for it.** You ship your best current model, the work teaches you a better one, and the distance between the two *is* the debt. That is, in Fowler's later vocabulary, the **inadvertent + prudent** cell: you didn't knowingly cut a corner (inadvertent), and your decision was entirely defensible given what you knew (prudent). The repayment is *refactoring to consolidate your understanding* — exactly the response that cell prescribes.

The popular reading — debt as a *deliberate* "ship fast and clean up later" loan — is the **deliberate + prudent** cell. It's a legitimate and useful idea (it's how most people now use the word, and Fowler's grid explicitly includes it), but it is *not what Cunningham was talking about*, and he said so pointedly: he was "wary" of people using his metaphor to defend deliberately writing bad code.

> **Key insight:** Cunningham's debt is *epistemic* — it's owed to the limits of what you knew when you wrote the code, and you repay it by learning and refactoring. The popular debt is *strategic* — knowingly borrowed to go faster. Both are real; the quadrant's gift is that it holds *both* meanings without collapsing them, so you stop arguing about which one is "real" technical debt. (For the full untangling of the metaphor, see [01 — What Is Technical Debt](../01-what-is-technical-debt/middle.md).)

---

## Classifying Real Debt — Worked Examples

Classification is a skill, and the only way to build it is to do it on concrete cases. For each, ask the two questions in order — *did we know?* then *was it defensible?* — and let the answers pick the cell and the response.

**1. "We skipped tests on the billing module to hit the contractual launch date; we logged a ticket to add them next sprint."**
Knew? Yes — conscious decision. Defensible? Yes, given a hard external deadline *and* a recorded plan to repay. → **Deliberate + Prudent.** Response: it's already tracked; make sure the interest (risk of an undetected billing bug) is visible and the paydown is actually scheduled, not just ticketed-and-forgotten.

**2. "The whole service shares one 4,000-line `utils.js` because no one ever decided on module boundaries."**
Knew? No — there was no decision, it accreted. Defensible? No — "don't pile everything into one god-module" is basic, known, cheap. → **Inadvertent + Reckless.** Response: refactoring `utils.js` once won't help; the team needs design guidance and a review practice that flags this, or it'll grow back.

**3. "We modeled `Order` and `Shipment` as one entity. Six months of real fulfillment data showed they have completely different lifecycles; splitting them is now a big change."**
Knew? No — the conflation looked right at design time. Defensible? Yes — you couldn't have known the lifecycles diverged until you ran the business. → **Inadvertent + Prudent.** This is *Cunningham's* debt exactly. Response: write down the new understanding, then refactor `Order`/`Shipment` apart to consolidate it. Normal, healthy growth — not a failure.

**4. "The lead said 'we don't do design docs here, just code,' so a junior built the new pricing engine with no abstraction and it's already unmaintainable."**
Knew? Yes — the *lead* knowingly waived design. Defensible? No — for a pricing engine, that's reckless. → **Deliberate + Reckless.** Response: the file is the symptom; escalate the *practice*. The fix is upstream of the junior — the team's stance that design is optional.

**5. "We picked Postgres and it's been fine, but we now realize a document store would've fit our deeply-nested data better."**
Be careful — is this even *debt*? If Postgres still meets requirements and the "regret" is mild preference, this may be no debt at all, just hindsight. If nested-JSON gymnastics are genuinely slowing every feature, then: knew? No. Defensible? Yes — a reasonable call with the information you had. → **Inadvertent + Prudent**, *if* the interest is real. Response: capture the learning; only act if the interest justifies a migration's cost ([04 — Tracking & Prioritizing](../04-tracking-and-prioritizing/middle.md)).

Notice what the exercise reveals: the *intent* axis is usually easy to answer honestly; the *judgment* axis is where the real argument lives, because "was it defensible?" depends on what was reasonably knowable — and people are strongly motivated to remember their own past decisions as prudent.

---

## Where the Quadrant Breaks Down

A senior engineer uses the quadrant *and* knows its seams. Wield it as if the four boxes were physically real and you'll lose to anyone who's noticed they aren't.

**It's a continuum, not four boxes.** Both axes are spectra dressed up as binaries. "Deliberate" runs from a fully-reasoned trade-off to a half-aware "eh, good enough"; "reckless" runs from a tiny defensible shortcut to gross negligence. Real debt lands in the *fog between* cells far more often than dead-center in one. The grid is a thinking aid, not a taxonomy with crisp membership.

**Debt drifts cells over time.** A given piece of debt does not sit still. Deliberate-prudent debt that you *track and ignore for two years* has effectively become reckless — you knew, you could have acted, you didn't. Inadvertent-prudent debt becomes reckless the moment you *learn* the better design and keep shipping over the old one anyway — the new knowledge converts "couldn't have known" into "chose not to act." **The classification is a snapshot; the interest is what's running, and running interest pushes everything rightward toward reckless.**

**Honest classification after the fact is genuinely hard.** Hindsight corrupts both axes. *Intent* gets rewritten — a corner cut in a panic gets remembered as "a deliberate strategic decision" because that sounds better. *Judgment* gets distorted by outcome — if the shortcut later hurt, we call it reckless; if it didn't, we call it prudent, even when the *decision* was identical. Defensibility must be judged on **what was knowable at the time**, not on how it turned out, and humans are bad at that. The quadrant can quietly become a tool for *post-hoc self-justification* — "obviously deliberate and prudent" — unless someone in the room is allowed to challenge the placement.

**Classification is not the goal — response is.** The grid is worthless if naming the cell ends the conversation ("it's inadvertent-prudent, moving on"). Its only value is routing you to the *right response*. If your team spends more energy debating which box a tangle goes in than acting on it, the tool has become the very thing it was meant to prevent.

> **Key insight:** The quadrant's value is *diagnostic, not classificatory*. It's a set of questions ("did we know? was it defensible? what does that imply we should do?") wearing the costume of a taxonomy. Use the questions; hold the boxes loosely. The moment the argument is about which box rather than which action, you've lost the plot.

---

## Other Taxonomies, Briefly

The quadrant is the dominant lens, but it's not the only one, and knowing the alternatives keeps you from thinking in exactly two axes.

**McConnell's intentional vs unintentional.** Steve McConnell splits debt into **intentional** (taken on purpose — itself sub-split into *short-term* tactical debt you'll repay soon and *long-term* strategic debt you carry deliberately for years) and **unintentional** (the result of poor work or design, discovered after the fact). This maps loosely onto Fowler's *deliberate/inadvertent* axis, but McConnell's extra contribution is the **short-term vs long-term** split *within* intentional debt — a distinction the quadrant doesn't capture and that matters for *paydown scheduling* (tactical debt wants a near-term trigger; strategic debt is a standing line item). It's a useful complement, not a competitor.

**Kruchten, Nord & Ozkaya's three faces.** The SEI's *Managing Technical Debt* widens the lens beyond *code* to **architecture debt** (structural decisions that resist change), **code debt** (the local mess), and **production-infrastructure debt** (build, deploy, environments). Their point: architecture debt is the expensive, slow-compounding kind, and the quadrant — which says nothing about *where* the debt lives — won't surface that. Use the quadrant to classify *how* a debt arose; use this taxonomy to remember *what layer* it lives in.

> **Key insight:** These taxonomies aren't rivals; they classify on different axes — *how it arose* (Fowler), *was it on purpose and for how long* (McConnell), *what layer it lives in* (SEI). A debt has a value on all three at once: an inadvertent-prudent, long-term-strategic, architecture-level debt is a fully coherent and very common thing. One grid never tells the whole story.

---

## Mental Models

- **Intent is the neutral axis; judgment is the alarm.** Deliberate vs inadvertent tells you *nothing* about whether to worry — both are normal. Prudent vs reckless is the needle that should move you to act. People instinctively flip this and treat "deliberate" as the dirty word.

- **Reckless debt is a system bug, not a code bug.** Both reckless cells say the same thing: the fix isn't in the file, it's in the process that produced the file. Deliberate-reckless → fix the pressure. Inadvertent-reckless → fix the skills and review. Refactoring alone just regrows it.

- **Cunningham's debt is the tax on learning.** His original metaphor is the gap between your code and your *latest* understanding — debt you incur simply by understanding the problem better after building it. You repay it by refactoring to consolidate what you learned. This is the inadvertent-prudent cell, and it's *healthy*.

- **The boxes are buoys, not walls.** The cells mark regions in a two-dimensional fog; debt floats between them and drifts rightward (toward reckless) as its interest runs unpaid. Classify to find the *response*, then stop classifying.

---

## Common Mistakes

1. **Treating "deliberate" as the bad cell and "inadvertent" as the excuse.** It's backwards. *Reckless* is the word that triggers action; deliberate-prudent debt is a sign of a healthy team. Don't shame people for taking conscious, tracked trade-offs.

2. **Responding to reckless debt with a refactoring ticket.** Reckless debt is produced by a broken system — pressure (deliberate) or a skills/review gap (inadvertent). Clean the code without fixing the system and you'll be back next sprint. The response is escalation or training, not a cleanup task.

3. **Citing Cunningham to justify deliberate corner-cutting.** Cunningham's debt was inadvertent-prudent — refactoring toward improved understanding. He explicitly warned against using the metaphor to excuse writing bad code on purpose. Quoting him to defend a reckless shortcut inverts his point.

4. **Classifying on outcome instead of on what was knowable.** A shortcut that later hurt isn't *therefore* reckless; a shortcut that got lucky isn't *therefore* prudent. Judge the *decision* against the information available at the time, not against how it turned out.

5. **Letting the classification end the conversation.** "It's inadvertent-prudent" is not a conclusion — it's a pointer to "so capture the learning and refactor." If naming the cell closes the ticket, the quadrant has failed at its only job.

6. **Forgetting that debt drifts.** Tracked-but-ignored deliberate-prudent debt becomes reckless over time; inadvertent-prudent debt becomes reckless once you've *learned* the better way and still don't act. The grid is a snapshot; revisit it.

---

## Test Yourself

1. Which axis of the quadrant is morally neutral, and which one should actually make you act? Why?
2. Which cell did Ward Cunningham's *original* technical-debt metaphor describe, and what is the prescribed response for that cell?
3. The two *reckless* cells call for different responses. What are they, and why is "refactor the code" wrong for both?
4. Classify: *"We knew the cache invalidation was naïve but shipped it to hit the date, and we filed a ticket to fix it before traffic ramps."* Cell? Response?
5. Classify: *"A new hire wrote the auth flow storing passwords in plaintext because they didn't know about hashing, and no one reviewed it."* Cell? Response?
6. Give one concrete way a piece of debt can *drift* from a prudent cell into a reckless one over time.
7. What does McConnell's taxonomy add that Fowler's quadrant doesn't?

<details>
<summary>Answers</summary>

1. **Intent (deliberate ↔ inadvertent) is neutral** — both ends are normal in healthy engineering. **Judgment (prudent ↔ reckless) is the alarm** — *reckless* means the decision violated cheaply-available knowledge, and that's what signals a real problem regardless of whether it was on purpose.
2. **Inadvertent + Prudent.** Cunningham's debt is the gap between your code and your *current, improved* understanding of the domain — created by learning, not sloppiness. Response: **consolidate the new understanding by refactoring** the design toward it.
3. **Deliberate + Reckless → fix the planning/pressure** (escalate the conditions that forced the corner). **Inadvertent + Reckless → invest in training and code review** (close the skills/process gap). "Refactor the code" is wrong because in both cells the *cause is upstream of the file* — fix only the file and the broken system regenerates the debt.
4. **Deliberate + Prudent** — conscious, defensible (hard date), and already tracked with a trigger ("before traffic ramps"). Response: ensure the interest is visible and the paydown actually happens before the trigger, not just sits as a ticket.
5. **Inadvertent + Reckless** — they didn't know (inadvertent) but plaintext passwords violate basic, mandatory knowledge, and the missing review let it land (reckless). Response: fix it now *and* address the system — onboarding/training on security basics and a review gate that would have caught it. (It's also a security incident, not merely debt.)
6. Examples: deliberate-prudent debt that you *track but never act on for years* becomes reckless (you knew, could have acted, didn't); inadvertent-prudent debt becomes reckless the moment you *learn* the better design and keep shipping over the old model anyway.
7. The **short-term (tactical) vs long-term (strategic)** split *within* intentional debt — a time-horizon distinction the quadrant doesn't capture, and one that drives *how you schedule paydown* (tactical wants a near-term trigger; strategic is a standing line item).

</details>

---

## Cheat Sheet

```
THE TWO AXES
  deliberate ↔ inadvertent   = INTENT     (did we KNOW?)        → neutral
  prudent    ↔ reckless      = JUDGMENT   (was it DEFENSIBLE?)  → the ALARM

RESPONSE PER CELL
  Deliberate + Prudent   "must ship now"      → HEALTHY: track it, schedule paydown
  Deliberate + Reckless  "no time for design" → ESCALATE: fix the pressure/planning
  Inadvertent + Prudent  "now we know better" → GROWTH: capture learning, refactor toward it
  Inadvertent + Reckless "what's layering?"   → GAP: invest in training + code review

  reckless cells → the fix is in the SYSTEM, not the file

CUNNINGHAM vs POPULAR READING
  original  = Inadvertent + Prudent  → debt to your improving understanding;
                                        repay by refactoring to consolidate it
  popular   = Deliberate + Prudent   → "ship fast, clean up later" (also valid)
  he warned AGAINST using the metaphor to excuse deliberately-bad code

LIMITS (use the grid, don't worship it)
  - continuum, not 4 crisp boxes
  - debt DRIFTS rightward (toward reckless) as unpaid interest runs
  - hindsight corrupts both axes — judge on what was KNOWABLE at the time
  - classification is a means; the RESPONSE is the point

OTHER LENSES
  McConnell  intentional (short-term / long-term) vs unintentional
  SEI        architecture / code / production-infrastructure debt
```

---

## Summary

- The quadrant has two axes that answer different questions: **deliberate/inadvertent = intent** (did we know?) and **prudent/reckless = judgment** (was it defensible?). Intent is neutral; **reckless** is the word that should make you act.
- The grid is only useful because **each cell has a distinct response.** Deliberate-prudent → *track and schedule* (healthy). Deliberate-reckless → *escalate the pressure/planning*. Inadvertent-prudent → *capture the learning and refactor toward it* (normal growth). Inadvertent-reckless → *invest in training and review* (a process gap).
- Both **reckless** cells share a tell: the real fix is in the *system that produced the code*, not the code. Refactoring alone regrows the debt.
- **Cunningham's original debt was inadvertent + prudent** — the gap between your code and your improving understanding, repaid by refactoring to *consolidate that understanding*. The popular "ship fast, clean up later" reading is the *deliberate + prudent* cell — valid, but not what he meant, and he warned against using his metaphor to excuse bad code.
- The quadrant is a **continuum, not four boxes**; debt **drifts toward reckless** as unpaid interest runs; and **honest after-the-fact classification is hard** because hindsight corrupts both axes. Judge defensibility on what was knowable *at the time*.
- It's not the only lens. **McConnell** adds the short-/long-term split within intentional debt; the **SEI** taxonomy adds *where* the debt lives (architecture/code/infrastructure). A real debt has a value on all of these at once.

---

## Further Reading

- *TechnicalDebtQuadrant* — Martin Fowler (martinfowler.com, 2009). The two-page article that introduced the grid; the primary source, and short.
- *Debt Metaphor* — Ward Cunningham (2009 video, ~5 min). Cunningham clarifying, in his own words, that his debt was about reflecting current understanding — not deliberately writing poor code.
- *Managing Technical Debt* — Kruchten, Nord & Ozkaya (SEI). The architecture/code/infrastructure taxonomy and a rigorous treatment of debt as an engineering-economics problem.
- *Technical Debt* — Steve McConnell (Construx white paper). The intentional/unintentional and short-/long-term taxonomy in full.

---

## Related Topics

- [01 — What Is Technical Debt](../01-what-is-technical-debt/middle.md) — principal vs interest, and the full untangling of Cunningham's metaphor from its popular misreadings.
- [04 — Tracking & Prioritizing](../04-tracking-and-prioritizing/middle.md) — where deliberate-prudent debt goes to be recorded, given a trigger, and paid in interest order.
- [06 — Preventing Accumulation](../06-preventing-accumulation/middle.md) — the reviews, gates, and Definition of Done that stop reckless debt landing in the first place.
- [junior.md](junior.md) — the four cells, named and recognized, before adding responses.
- [senior.md](senior.md) — wielding the quadrant in architecture decisions and portfolio-level debt strategy.
