# The Debt Quadrant — Junior Level

> **Roadmap:** [Technical Debt Management](../README.md) → The Debt Quadrant
> *Two teams ship the same shortcut. One did it on purpose, knowing exactly what it would cost; the other did it because they'd never heard of the better way. Same messy code, completely different problem — and that difference decides what you should do about it.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concept 1 — Why One Word Hides Four Different Problems](#core-concept-1--why-one-word-hides-four-different-problems)
5. [Core Concept 2 — Axis One: Deliberate vs Inadvertent](#core-concept-2--axis-one-deliberate-vs-inadvertent)
6. [Core Concept 3 — Axis Two: Prudent vs Reckless](#core-concept-3--axis-two-prudent-vs-reckless)
7. [Core Concept 4 — The Four Cells](#core-concept-4--the-four-cells)
8. [Core Concept 5 — Why the Quadrant Changes What You Do](#core-concept-5--why-the-quadrant-changes-what-you-do)
9. [Real-World Examples](#real-world-examples)
10. [Mental Models](#mental-models)
11. [Common Mistakes](#common-mistakes)
12. [Test Yourself](#test-yourself)
13. [Cheat Sheet](#cheat-sheet)
14. [Summary](#summary)
15. [Further Reading](#further-reading)
16. [Related Topics](#related-topics)

---

## Introduction

> Focus: **Not "is there debt?" but "what *kind* of debt?"**

You've heard "that's technical debt" a hundred times. It gets said about a clever shortcut taken under a real deadline, *and* about a tangled mess written by someone who didn't know any better. Those are not the same thing — but the one word makes them sound identical, and that's a problem, because they call for completely different responses.

In 2009, **Martin Fowler** drew a tiny 2×2 grid that fixed this. He noticed that "technical debt" actually mixes two separate questions. First: *did we know we were taking on debt?* Sometimes a team consciously decides to cut a corner; other times they don't even realize they're cutting one. Second: *was it a smart trade-off, or just carelessness?* A corner cut for a good reason, with a plan, is very different from a corner cut out of laziness or ignorance.

Cross those two questions and you get four boxes. Fowler called it the **Technical Debt Quadrant**, and once you've seen it you can't un-see it. The shortcut your team took last sprint and the spaghetti you inherited from a contractor land in *different boxes* — and that's the whole point. One is normal, healthy engineering. The other is a sign something in your process or skills needs attention.

This page teaches you the grid: the two axes, the four cells, a plain example for each, and — most importantly — why the box a piece of debt lands in should change how you react to it.

> **The mindset shift:** stop asking *"is there debt here?"* (the answer is almost always yes, everywhere). Start asking *"what KIND of debt is this?"* Because the kind tells you whether to shrug and move on, schedule a cleanup, capture a lesson, or fix a hole in how your team works.

---

## Prerequisites

- **Required:** You understand the basic technical-debt metaphor — that cutting a corner now creates a "debt" you pay "interest" on later. If not, read [01 — What Is Technical Debt](../01-what-is-technical-debt/junior.md) first; this page builds directly on it.
- **Required:** You've written code under a deadline and made a choice you weren't fully proud of. (Everyone has — that lived experience is most of what you need here.)
- **Helpful:** You've inherited code from someone else and thought "why on earth is it like this?" That feeling is one of the four cells, and you'll learn to name it.
- **Helpful:** You've heard a teammate call something "technical debt" in a way that felt wrong or lazy. You'll learn exactly *why* it felt wrong.

---

## Glossary

| Term | Plain-English meaning |
|---|---|
| **Technical debt** | The gap between the code you have and the code the problem now needs — a shortcut you "pay interest" on later. |
| **The debt quadrant** | Fowler's 2×2 grid that sorts debt by *two* questions, giving four kinds. |
| **Deliberate debt** | Debt you took on **knowingly** — you saw the trade-off and chose it. |
| **Inadvertent debt** | Debt you took on **without realizing it** — you only see it in hindsight. |
| **Prudent debt** | A **sensible** decision given what you knew — a reasonable bet, often with a plan to pay it back. |
| **Reckless debt** | A **careless** decision — skipping good practice out of haste, ignorance, or "we don't have time." |
| **Trade-off** | Giving up one thing (clean code, more time) to get another (a faster ship, learning sooner). |
| **Principal** | The original shortcut itself — the "wrong" thing you'd have to fix. |
| **Interest** | The ongoing extra cost the shortcut imposes every time you work near it. |
| **Layering** | Organizing code into separated responsibilities (e.g. UI / logic / data) instead of one tangled blob — a basic design skill. |

---

## Core Concept 1 — Why One Word Hides Four Different Problems

Here are two real situations, both of which someone on the team will call "technical debt":

**Situation A.** A startup has a demo for an investor on Friday. To make the deadline, they hardcode the pricing logic instead of building the flexible system they know they'll eventually need. The lead says out loud in the standup: *"We're cutting this corner on purpose. After the demo, the very first thing we do is rip it out and do it properly. I'm writing a ticket right now."*

**Situation B.** A new developer, three months into their first job, builds a feature by jamming database queries, business rules, and HTML generation all into one 600-line function — because they've never learned that those should be separated. They genuinely think this is how code is written. Nobody on the team reviews it closely. It ships.

Both produce imperfect code. Both create future cost. But notice how *differently* you'd react if you were their manager:

- For **A**, you'd nod. That's a pro making a conscious bet under pressure, with a payback plan. Nothing is wrong with the *team*. This is just engineering.
- For **B**, the code is the *symptom*; the real issue is that a junior didn't know a fundamental design idea and **no review caught it**. The fix isn't only "clean up the function" — it's "this person needs mentoring, and our review process has a hole."

If you only have one label — "technical debt" — these two collapse into the same bucket and you'll treat them the same. You might scold team A for "writing debt" (unfair — they did the smart thing) or shrug at team B's problem as "just debt, we all have it" (dangerous — it's a skills-and-process gap that will keep producing more).

The quadrant exists so you stop collapsing them. It pulls "technical debt" apart along the *two* dimensions that actually distinguish A from B.

> **Key insight:** The danger of the word "technical debt" is that it makes *every* messy piece of code sound like a deliberate financial decision someone made on purpose. A lot of bad code wasn't a *decision* at all — nobody chose it; it just happened. The quadrant's job is to separate the debt someone *chose* from the debt that *accumulated*, and the *smart* choices from the *careless* ones.

---

## Core Concept 2 — Axis One: Deliberate vs Inadvertent

The first axis asks one question:

> **Did we KNOW we were taking on debt?**

**Deliberate** debt is debt you took on *with your eyes open*. At the moment you wrote the code, you were aware there was a better way, and you chose not to do it (yet) — usually for a reason like a deadline. The key signal: **someone could have said the words "I know this isn't ideal, but…" out loud at the time.** The awareness existed.

- *"I know we should validate every field, but the demo only needs the happy path. Skipping the rest for now."*
- *"There's a cleaner architecture here, but it'd take two weeks we don't have. We're going with the quick version on purpose."*

**Inadvertent** debt is debt you took on *without realizing it*. At the moment you wrote the code, you did **not** know it was a shortcut — you thought you were doing it right, or you simply didn't know a better approach existed. You only discover the debt *later*, in hindsight. The key signal: **the realization comes with a "oh… *now* I see" or "I didn't know you could do that."** The awareness arrives *after* the fact.

- *"I built the whole thing around this data structure, and only now — six months in — do I understand it should have been modeled completely differently."*
- *"I had no idea there was a standard pattern for this. I reinvented it badly because I didn't know it existed."*

The line between them is **awareness at the time of the decision**, nothing else. Deliberate = you knew then. Inadvertent = you found out later. It is *not* about whether the debt is bad — plenty of inadvertent debt comes from doing your honest best with what you knew, and plenty of deliberate debt is perfectly sensible.

> **Key insight:** This axis is about *knowledge*, not *quality*. Don't read "deliberate" as good and "inadvertent" as bad. A deliberate choice can be reckless, and an inadvertent slip can be the natural result of learning. All this axis asks is: at the moment of the decision, *did you see the trade-off coming?*

---

## Core Concept 3 — Axis Two: Prudent vs Reckless

The second axis asks a different question:

> **Was it a SMART trade-off, or just carelessness?**

**Prudent** debt is the result of *good judgment*. Even though the code isn't perfect, the decision behind it was reasonable given the situation. A prudent shortcut typically has at least one of these features: there was a **real reason** (a genuine deadline, a need to learn fast, a market window), the team **understood the cost** they were accepting, and — ideally — there's some **awareness of how to pay it back**. Prudent debt is *engineering*, not failure. Skilled teams take on prudent debt all the time, on purpose.

- *"Shipping the simple version now lets us learn whether customers even want this feature before we invest two weeks in the robust version. Smart bet."*

**Reckless** debt is the result of *carelessness* — haste, laziness, or not bothering. There's no good reason, no clear understanding of the cost, and no plan. It's the shortcut you take because thinking is hard and the deadline is loud, or because you skipped the practices (testing, review, design thought) that a professional doesn't skip.

- *"We don't have time for design. Just start coding and we'll figure out the structure as we go."* (No design at all, no plan to add one — just diving in carelessly.)

The line between them is **the quality of the decision**, not the quality of the code. Was it a thoughtful trade-off, or a careless one? Did you weigh the cost, or just barrel ahead?

> **Key insight:** "Prudent" does not mean "no debt" and "reckless" does not mean "lots of debt." You can take on a *large* amount of debt prudently (a big, conscious bet with a payback plan) and a *tiny* amount of debt recklessly (one careless skip with no thought). This axis grades the *thinking*, not the *amount*.

---

## Core Concept 4 — The Four Cells

Cross the two axes and you get Fowler's grid. Down the side: did we know (deliberate) or not (inadvertent)? Across the top: was it smart (prudent) or careless (reckless)?

```
                         RECKLESS                          PRUDENT
                  (careless decision)               (smart trade-off)
              +----------------------------+----------------------------+
              |                            |                            |
  DELIBERATE  |  "We don't have time       |  "We must ship now and     |
  (we KNEW)   |   for design."             |   deal with the            |
              |                            |   consequences."           |
              |  Knew better, skipped      |  A conscious, sensible     |
              |  it anyway. The bad one.   |  bet. Normal engineering.  |
              |                            |                            |
              +----------------------------+----------------------------+
              |                            |                            |
 INADVERTENT  |  "What's layering?"        |  "Now we know how we       |
  (we DIDN'T  |                            |   should have done it."    |
   know)      |  Debt from not knowing     |                            |
              |  better. A skills gap.     |  Learned the right design  |
              |                            |  by building the wrong one.|
              |                            |                            |
              +----------------------------+----------------------------+
```

Fowler gave each cell a one-line quote. Learn these four lines — they *are* the model:

**Deliberate + Prudent — *"We must ship now and deal with the consequences."***
You knew there was a better design, you understood the cost of skipping it, and you chose to ship anyway because shipping now was worth it. This is a *conscious, sensible bet*. The startup hardcoding pricing for Friday's demo, with a ticket already written to fix it, lives here. **This is normal, healthy engineering.** Good teams do this on purpose, all the time.

**Deliberate + Reckless — *"We don't have time for design."***
You knew the better way (or at least knew that *some* design thought was needed), and you skipped it anyway — not for a smart reason, but out of haste. No plan, no weighing of cost, just "no time, go." You *chose* this, and the choice was careless. **This is the dangerous one** — you had the knowledge and threw it away.

**Inadvertent + Prudent — *"Now we know how we should have done it."***
You did your honest best with what you knew. Only *after* building it — after living with the system — did you understand the design it really wanted. You couldn't have known earlier; the knowledge only existed *on the other side* of building the wrong version first. This debt is the **natural by-product of learning**. It isn't a failure; it's how understanding is earned. (This is often called "good" inadvertent debt for exactly this reason.)

**Inadvertent + Reckless — *"What's layering?"***
You didn't know a fundamental thing — a basic design idea, a standard pattern — and so you wrote code that violates it, without ever realizing. This isn't a *bet* you made; it's a *gap* you have. The junior who jams everything into one 600-line function because they've never heard of separating responsibilities lives here. **This is a skills problem** (and usually a process problem too, because review should have caught it).

> **Key insight:** Notice the *story* each cell tells. Deliberate+Prudent and Inadvertent+Prudent are stories of competent people doing reasonable things — one bet knowingly, one learned along the way. Deliberate+Reckless and Inadvertent+Reckless are stories of something *broken* — one threw away knowledge it had, the other never had the knowledge at all. The prudent column is normal; the reckless column is a warning light.

---

## Core Concept 5 — Why the Quadrant Changes What You Do

Here's the payoff, and the reason the quadrant matters more than any other single idea in this roadmap: **the cell a piece of debt lands in tells you what to actually do about it.** The same messy code calls for four different responses depending on its box.

**If it's Deliberate + Prudent:** Relax — and make sure it's *tracked*. This is a real, conscious bet. The only failure mode is *forgetting* you took it on, so the bet quietly becomes permanent. The right action is to record it (a ticket, a note, a debt register — see [04 — Tracking & Prioritizing](../04-tracking-and-prioritizing/junior.md)) and pay it back when the reason that justified it expires. No blame. This is engineering working as intended.

**If it's Inadvertent + Prudent:** *Capture the lesson.* The valuable thing here isn't the code — it's the understanding you just earned. Write down what you learned about the better design. Maybe refactor toward it now, maybe later, but above all make sure the team *keeps* the insight so the next system starts smarter. This is learning; treat it as a win.

**If it's Deliberate + Reckless:** Look at your *process and pressure*. Someone knew better and skipped it carelessly. Why? Usually the answer is unrelenting deadline pressure, or a culture where "just ship it" overrides judgment. The fix isn't (only) cleaning the code — it's asking why a person who knew the right thing didn't do it. That's a question about how the team is run.

**If it's Inadvertent + Reckless:** Address *skills and review*. Someone didn't know a fundamental thing. The code is a symptom; the cause is a knowledge gap plus a review process that didn't catch it. The fix is **mentoring, learning, and a real review step** — see [06 — Preventing Accumulation](../06-preventing-accumulation/junior.md). Cleaning this one instance without fixing the gap just guarantees more of it next sprint.

See the pattern? **The prudent column (top-right and bottom-right) is normal engineering — you respond with tracking and lessons.** **The reckless column (top-left and bottom-left) is a signal that something in your team is broken — you respond by fixing the process or the skills, not just the code.**

> **Key insight:** This is the single most useful sentence in the whole topic: *reckless debt is a process or skills problem; prudent debt is normal engineering.* When you find reckless debt, don't just clean it — ask *why it happened*, because the cause will keep producing more until you fix it. When you find prudent debt, don't panic and don't moralize — just track it and pay it back on schedule.

---

## Real-World Examples

**1. The launch-week hardcode (Deliberate + Prudent).** A team has a hard, externally-fixed launch date — a partner is announcing them on stage. Their payment retry logic should be configurable, but building that properly is three days they don't have. In planning, the tech lead says: *"We hardcode the retry count to 3 for launch. I'm filing TECH-412 to make it configurable, and we'll do it in the first sprint after launch."* They ship the shortcut **on purpose**, **understood the cost**, and **wrote down the payback**. This is textbook Deliberate+Prudent: a conscious bet, tracked. The right reaction from everyone is a calm nod, not concern.

**2. The contractor's mystery module (Inadvertent + Reckless).** Six months ago a short-term contractor built the reporting module. There were no code reviews on their work. Today, every change to reports takes days because business logic, SQL, and formatting are fused into giant functions with no separation — classic *"what's layering?"* code. Nobody *chose* this design; the contractor simply didn't apply (or didn't know) basic separation, and **no review caught it**. This is Inadvertent+Reckless. Cleaning up the module helps — but the real lesson is that *unreviewed work from people outside your standards is where this debt comes from*, which is a process fix, not just a code fix.

**3. The data model you only understood after building it (Inadvertent + Prudent).** A developer modeled "users" and "accounts" as one table because, at the start, every user had exactly one account and it seemed obviously fine. A year later the product grows to support shared accounts and multiple users per account, and it's now clear the two should always have been separate. Here's the thing: **they could not have known that a year ago** — the requirement didn't exist yet, and the cleaner model only became obvious *after* living with the simple one. This is Inadvertent+Prudent: debt as the honest by-product of learning. The right move is to capture the insight and plan the migration — *not* to feel bad about a decision that was perfectly reasonable when it was made.

---

## Mental Models

- **Two questions, not one.** Every time someone says "technical debt," run it through two questions: *Did we know?* (deliberate / inadvertent) and *Was it smart?* (prudent / reckless). The intersection is the box. You can't pick a response until you've placed it.

- **The "could they have said it out loud?" test for the first axis.** Deliberate debt comes with words someone *could have spoken at the time*: "I know this isn't ideal, but…" If the awareness existed in the moment, it's deliberate. If the realization only arrives later ("oh, *now* I see"), it's inadvertent.

- **The "was there a reason and a plan?" test for the second axis.** Prudent debt has a *reason* (deadline, learning, market window) and ideally a *plan* to pay it back. Reckless debt has neither — just haste or a gap. Ask "why did we do this, and what's the plan?" Silence on both means reckless.

- **The reckless column is a smoke alarm.** Prudent debt is the normal cost of building software — expected, even healthy. Reckless debt is an *alarm*: it says either "we knew better and the pressure crushed our judgment" (deliberate+reckless) or "someone didn't know better and nobody caught it" (inadvertent+reckless). Both point at the *team*, not just the code.

- **Inadvertent+Prudent is a graduation, not a failure.** Building the wrong version is sometimes the *only* way to learn the right one. When you hit "now I know how I should have done it," that's understanding you didn't have before and couldn't have bought. Capture it and move on — don't punish yourself for not being psychic.

---

## Common Mistakes

1. **Treating all debt the same.** The whole point of the quadrant is that the *response* depends on the box. Reacting to a junior's skills-gap code the same way you react to a deliberate launch-week bet means you'll either over-blame the bet or under-fix the gap. Place it first, then respond.

2. **Reading "deliberate" as "bad" and "inadvertent" as "good" (or vice versa).** The first axis is about *knowledge*, full stop. Deliberate debt can be the smartest move on the board (Deliberate+Prudent) *or* the most careless (Deliberate+Reckless). Don't moralize the axis — it just records whether you saw the trade-off coming.

3. **Calling careless, ignorant messes "technical debt" with a straight face.** Real Cunningham-style debt was a *deliberate, understood trade-off*. Using "it's just tech debt" to describe Inadvertent+Reckless code launders incompetence into a financial decision nobody actually made. Name it honestly: that's not a bet, it's a skills-and-process gap.

4. **Confusing the amount of debt with the recklessness of it.** A big, well-reasoned, tracked bet is *prudent* even though it's a lot of debt. A tiny careless skip with no thought is *reckless* even though it's almost nothing. The prudent/reckless axis grades the *decision*, not the size of the mess.

5. **Finding reckless debt and only cleaning the code.** If you fix the tangled module but never ask *why* it got that way — no review, a missing skill, crushing deadlines — you'll be cleaning the same kind of mess again next month. Reckless debt is a signal; treat the cause, not just the symptom.

6. **Feeling guilty about Inadvertent+Prudent debt.** "I should have designed it right the first time" — no, you often couldn't have, because the knowledge only existed after you built it. Beating yourself up over learned-in-hindsight debt is wasted energy. Capture the lesson; that's the win.

---

## Test Yourself

1. What are the two questions (the two axes) the debt quadrant asks? State each as a plain question.
2. What single thing distinguishes *deliberate* from *inadvertent* debt? (Hint: it's about a moment in time.)
3. What single thing distinguishes *prudent* from *reckless* debt?
4. Write out Fowler's four one-line quotes and name the cell each belongs to.
5. Which two cells are "normal engineering" and which two are "a warning that something's broken"? Why?
6. **Classify this scenario:** A senior engineer, facing a real launch deadline, says in standup *"We'll skip the caching layer for now and add it after launch — I've filed a ticket."* Which cell? What should the team do?
7. **Classify this scenario:** A developer builds an entire feature with every concern (UI, logic, database) mashed into one function because they've never learned to separate them, and no one reviews it. Which cell? What's the *real* fix — and why isn't it just "clean up the function"?

<details>
<summary>Answers</summary>

1. **Axis one:** *Did we know we were taking on debt?* (deliberate vs inadvertent). **Axis two:** *Was it a smart trade-off, or just carelessness?* (prudent vs reckless).
2. **Awareness at the time of the decision.** Deliberate = you knew there was a better way *when you wrote the code*. Inadvertent = you only realized it *later*, in hindsight.
3. **The quality of the decision** — whether it was a thoughtful trade-off (a reason, ideally a plan) or careless (haste, laziness, or a gap). Not the quality or amount of the resulting code.
4. **"We must ship now and deal with the consequences"** = Deliberate + Prudent. **"We don't have time for design"** = Deliberate + Reckless. **"Now we know how we should have done it"** = Inadvertent + Prudent. **"What's layering?"** = Inadvertent + Reckless.
5. **Normal engineering:** the two *prudent* cells (Deliberate+Prudent — a conscious bet; Inadvertent+Prudent — debt learned along the way). **Warning signs:** the two *reckless* cells (Deliberate+Reckless — knew better, skipped it; Inadvertent+Reckless — didn't know better, nobody caught it). Reckless debt points at a process or skills problem; prudent debt is the normal cost of building software.
6. **Deliberate + Prudent.** Knew the better way, understood the cost, chose to ship for a real reason, *and* tracked the payback with a ticket. The team should: nod, keep the ticket visible, and pay it back when the launch pressure passes. No blame — this is engineering working correctly.
7. **Inadvertent + Reckless.** The developer didn't *choose* this design; they lacked a fundamental skill (separating responsibilities / layering), and review didn't catch it. The real fix is **mentoring the developer and adding a real code-review step** — *not* just cleaning the one function — because the skills-and-process gap that produced it will keep producing more code exactly like it until the gap is closed.

</details>

---

## Cheat Sheet

```
FOWLER'S TECHNICAL DEBT QUADRANT

                      RECKLESS                      PRUDENT
                (careless decision)           (smart trade-off)
            +------------------------+------------------------+
 DELIBERATE | "We don't have time    | "We must ship now and  |
 (we KNEW)  |  for design."          |  deal with the         |
            |                        |  consequences."        |
            | knew better, skipped   | conscious sensible bet |
            | -> WARNING: process    | -> NORMAL: track it    |
            +------------------------+------------------------+
INADVERTENT | "What's layering?"     | "Now we know how we    |
 (we DIDN'T |                        |  should have done it." |
  know)     | gap in knowledge       | learned by building    |
            | -> WARNING: skills     | -> NORMAL: capture it  |
            +------------------------+------------------------+

THE TWO QUESTIONS
  Axis 1  Did we KNOW?      -> deliberate (knew then) / inadvertent (saw later)
  Axis 2  Was it SMART?     -> prudent (reason + plan) / reckless (haste / gap)

QUICK TESTS
  Deliberate?  Could someone have said "I know this isn't ideal, but..." AT THE TIME?
  Prudent?     Was there a real reason AND some plan to pay it back?

WHAT TO DO
  Deliberate + Prudent    -> track it, pay back when the reason expires (no blame)
  Inadvertent + Prudent   -> capture the lesson; it's learning, treat as a win
  Deliberate + Reckless   -> fix the PROCESS / pressure that crushed judgment
  Inadvertent + Reckless  -> fix SKILLS + add review; clean code alone won't help

THE ONE-LINER
  Reckless debt = a process/skills problem.   Prudent debt = normal engineering.
```

---

## Summary

- "Technical debt" is **one word for four different problems**. Said about a deliberate launch-week bet *and* a junior's skills-gap mess, it collapses two situations that demand opposite responses.
- Fowler's quadrant splits debt along **two axes**. Axis one: *did we know we were taking on debt?* (**deliberate** = knew then / **inadvertent** = realized later). Axis two: *was it a smart trade-off?* (**prudent** = reason + plan / **reckless** = haste or a gap).
- The **four cells** each have a one-line quote: Deliberate+Prudent *"we must ship now and deal with the consequences"* (a conscious bet — normal); Deliberate+Reckless *"we don't have time for design"* (knew better, skipped it — dangerous); Inadvertent+Prudent *"now we know how we should have done it"* (learning, the good by-product); Inadvertent+Reckless *"what's layering?"* (a skills gap).
- The box **determines the response**. Prudent debt (both cells) is **normal engineering** — you track it and pay it back, or capture the lesson. Reckless debt (both cells) is a **warning light** — it points at a broken process or a skills gap, and cleaning the code without fixing that cause just produces more.
- The sentence to remember: **reckless debt is a process or skills problem; prudent debt is normal engineering.** When you meet debt, place it in the grid *first* — only then do you know what to actually do.

You can now do something most engineers can't: hear "that's technical debt" and immediately ask the two questions that turn a vague complaint into a clear, actionable diagnosis. The next steps — [tracking and prioritizing](../04-tracking-and-prioritizing/junior.md) what you've classified, and [preventing](../06-preventing-accumulation/junior.md) the reckless kind from accumulating — both start from getting this classification right.

---

## Further Reading

- [Martin Fowler — *Technical Debt Quadrant*](https://martinfowler.com/bliki/TechnicalDebtQuadrant.html) — the original 2009 post that defined the grid. Two minutes; read the source.
- [Ward Cunningham — *Debt Metaphor* (video, 2009)](https://www.youtube.com/watch?v=pqeJFYwnkjE) — the man who coined "technical debt" explaining what he actually meant (and what he didn't).
- [Martin Fowler — *Technical Debt*](https://martinfowler.com/bliki/TechnicalDebt.html) — the companion piece on the metaphor as a whole; pairs directly with the quadrant.
- The [middle.md](middle.md) of this topic, which turns the quadrant into a working tool — how to *classify real debt in practice*, where the cells blur, and how the classification feeds prioritization.

---

## Related Topics

- [01 — What Is Technical Debt](../01-what-is-technical-debt/junior.md) — the metaphor this page classifies: principal, interest, and when debt is rational.
- [04 — Tracking & Prioritizing](../04-tracking-and-prioritizing/junior.md) — once you've placed debt in a cell, how to record it and decide what to pay down first.
- [06 — Preventing Accumulation](../06-preventing-accumulation/junior.md) — how reviews, a Definition of Done, and culture stop the *reckless* cells from filling up.
- [middle.md](middle.md) · [senior.md](senior.md) — the same quadrant for practitioners and for those making the org-level call on how a team responds to each kind of debt.
