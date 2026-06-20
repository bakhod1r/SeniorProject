# The Debt Quadrant — Senior Level

> **Roadmap:** [Technical Debt Management](../README.md) → The Debt Quadrant
> *The middle page taught you to place a piece of debt in Fowler's 2×2. This page is about what the placement is **for**: classification is the input to strategy. The cell a debt lands in tells you what to change in your engineering process, what to fix at the root after an incident, which debt to tolerate, and which to gate against — and the cell can migrate underneath you while you look away.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Classification Is the Input to Strategy, Not the Output](#classification-is-the-input-to-strategy-not-the-output)
4. [What Each Cell Tells You to Change in Your Process](#what-each-cell-tells-you-to-change-in-your-process)
5. [The Quadrant as a Forensic Tool](#the-quadrant-as-a-forensic-tool)
6. [Beyond Fowler — The SEI/Kruchten Debt Landscape](#beyond-fowler--the-seikruchten-debt-landscape)
7. [McConnell's Taxonomy and Where Contagious Debt Sits](#mcconnells-taxonomy-and-where-contagious-debt-sits)
8. [Debt That Migrates Cells — The Quadrant Is About Follow-Through](#debt-that-migrates-cells--the-quadrant-is-about-follow-through)
9. [Classifying Honestly Against Hindsight Bias and Self-Serving Attribution](#classifying-honestly-against-hindsight-bias-and-self-serving-attribution)
10. [Setting Different Policies Per Cell — Tolerate, Track, Gate](#setting-different-policies-per-cell--tolerate-track-gate)
11. [Mental Models](#mental-models)
12. [Common Mistakes](#common-mistakes)
13. [Test Yourself](#test-yourself)
14. [Cheat Sheet](#cheat-sheet)
15. [Summary](#summary)
16. [Further Reading](#further-reading)
17. [Related Topics](#related-topics)

---

## Introduction

> Focus: **Using classification to drive different engineering responses — process changes, root-cause analysis, tolerance and gating policy — and reading the richer debt models a senior reasons in.**

By the middle level you can take any messy decision and place it on Fowler's grid: was it **deliberate or inadvertent**, **prudent or reckless**? That is genuine skill — most engineers still use "technical debt" as a synonym for "code I dislike," and the quadrant cures that. But knowing the cell is the *beginning* of the work, not the end. A classification you don't act on differently is a label, and labels don't change codebases.

The senior jump is this: the cell is a **diagnosis that prescribes a treatment**, and the treatments are different per cell — and most of them are *not* "go fix the code." A reckless-inadvertent cluster is almost never solved file by file; it's a signal about your hiring, onboarding, and review process. A prudent-deliberate item that's still around two years later has *migrated* into something worse, and the thing that moved it was your follow-through, not anyone's keystrokes. Used backward — after an incident or a quarter where everything slowed down — the quadrant becomes a forensic instrument: classify the debt that caused the pain and the root cause is usually a *cell*, a systemic pattern, not a line of code.

This page also pushes past the 2×2, which Fowler himself offered as a conversation-starter, not a complete model. Real debt has a *visibility* dimension (you can't classify what you can't see), lives at different *layers* (a reckless one-liner is cheap; reckless *architecture* can be fatal), and some of it is **contagious** — it spreads by being copied or built upon. The SEI/Kruchten landscape and McConnell's taxonomy give you the vocabulary the boardroom-adjacent conversation needs. The throughline: classification earns its keep only when it changes what you *do*.

---

## Prerequisites

- **Required:** You've internalized [middle.md](middle.md) — you can place any concrete decision in Fowler's deliberate/inadvertent × prudent/reckless grid and defend the placement.
- **Required:** You're fluent in [what technical debt actually is](../01-what-is-technical-debt/senior.md) — principal vs interest, debt vs bug vs cruft, and why misusing the term launders incompetence into a decision.
- **Helpful:** You've run or sat in a blameless postmortem and felt the pull toward "the engineer should have known better" — the exact instinct this page asks you to resist.
- **Helpful:** You own (or co-own) a process lever — a Definition of Done, a review policy, a quality gate, a debt budget — because the payoff of this page is changing those, not just annotating tickets.

---

## Classification Is the Input to Strategy, Not the Output

The most common failure with the quadrant is treating the classification as a *deliverable*. A team holds a workshop, sorts twenty debt items into four buckets, takes a satisfying photo of the whiteboard, and ships nothing different on Monday. The grid was used as a taxonomy when its only value is as a **decision function**: cell → response.

Make the dependency explicit. Each axis carries information that maps to a *different lever*:

- The **prudent / reckless** axis is about **competence and conditions** — did we make a sound judgment given what we knew and the constraints we faced? It points at *process*: review, skills, time pressure, standards.
- The **deliberate / inadvertent** axis is about **awareness** — did we know we were taking on debt at the moment we did it? It points at *visibility and tracking*: whether the debt is recorded, whether the team can even see it.

So the two axes answer two different management questions, and that is why the cell prescribes a treatment:

```
                    DELIBERATE                         INADVERTENT
              (we knew we were                    (we found out later)
               incurring debt)

  PRUDENT     "Ship now, refactor             "Now we know how we
 (sound        next sprint — the                should have done it."
  judgment)    deadline is real."
              ─────────────────────          ─────────────────────
              LEVER: follow-through.          LEVER: learning capture.
              The risk is the promise          The work was competent
              decays. TRACK it with an         for the knowledge of
              expiry, or it migrates.          the time; harvest the
                                               lesson, schedule the fix.

  RECKLESS    "We don't have time             "What's layering?"
 (unsound      for design."
  judgment)   ─────────────────────          ─────────────────────
              LEVER: conditions.               LEVER: capability.
              People who know better           A skills/standards gap.
              are skipping design under         No amount of ticket-
              pressure. Fix the pressure        tracking fixes not
              and the incentives, not           knowing the pattern.
              the one artifact.                 Fix onboarding & review.
```

Read the four levers across the bottom of each cell. **Track. Learn. Fix conditions. Build capability.** Not one of them is "open the file and clean it up" — that is the *refactoring* response, and it's appropriate only after you've decided, via the cell, that the item is worth the change. The cell tells you whether the real problem is the code or the system that produced it.

> **Key insight:** The quadrant is a function, not a label. If your classification doesn't change what you do next — a different lever pulled per cell — you've done taxonomy theatre. The output of classifying is a *decision about which process to change*, and only sometimes a decision to touch the code.

This reframing also explains why classification at the level of a *single ticket* is often the wrong altitude. One reckless-inadvertent function is a curiosity. *Forty* reckless-inadvertent functions, all from the same three contributors, all in the last quarter, is a hiring or onboarding finding. The cell is most useful when you classify the *cluster*, because the lever it points at — conditions, capability — is a property of the system, not the line.

---

## What Each Cell Tells You to Change in Your Process

Walk the cells as a senior would, asking of each: *if this cell is full, what in my engineering process is producing it, and what do I change?*

**Reckless–Inadvertent — "What's layering?"** This is the most important cell to read correctly, because the naive response is the most wrong. The naive response is "those functions are bad, rewrite them." But the cell's defining feature is that the author *didn't know* the better way and *no sound judgment was applied* — which means rewriting the artifacts treats the symptom and leaves the generator intact. A full reckless-inadvertent cell is, almost by definition, one of three systemic causes:

- A **skills gap** — the team genuinely doesn't know the pattern (layering, dependency inversion, bounded contexts). Fix: deliberate skill-building, pairing seniors with the contributors, reference architectures, not a one-off cleanup.
- A **missing review** — someone on the team *did* know better but never saw the change. Fix: the review process, ownership boundaries, who reviews what — a process change, not a code change.
- A **standards vacuum** — there was no agreed "how we do this here," so each engineer invented one. Fix: written conventions, lint rules, templates, an architecture you can point at.

You diagnose which by looking at the *spread*. Concentrated in new hires → onboarding. Spread across the team including seniors → standards. Present in code that *was* reviewed → the review process is rubber-stamping. The artifacts are evidence; the fix is upstream.

**Reckless–Deliberate — "We don't have time for design."** People who *could* design well are choosing not to, knowingly. This is the most dangerous cell culturally, because it normalizes: once "no time for design" is an acceptable answer, it becomes the *default* answer. The artifact is almost never the real problem — the **conditions and incentives** are. Senior response: trace the pressure. Are deadlines set without engineering input? Are estimates padded out by management? Is "shipped" rewarded and "maintainable" invisible? You fix the cell by fixing what makes competent people cut corners — capacity, planning, what gets celebrated — not by cleaning the one corner they cut. A single reckless-deliberate decision under a genuine one-time crunch is fine; a *pattern* of them is a management defect wearing an engineering costume.

**Prudent–Deliberate — "Ship now, refactor next sprint."** Cunningham's original, healthy debt: a sound trade-off to ship and learn faster. The process risk here is subtle — it's not the decision, it's the **decay of the promise.** "Refactor next sprint" is a commitment, and commitments without a tracking mechanism evaporate. The process change this cell demands is a *debt register with teeth*: the item is recorded with an explicit trigger or expiry ("revisit when we add the second payment provider," "delete by Q3 or escalate"). Without that, this cell silently migrates to reckless (see §8). The lever is **follow-through infrastructure**, covered in depth in [04 — Tracking & Prioritizing](../04-tracking-and-prioritizing/senior.md).

**Prudent–Inadvertent — "Now we know how we should have done it."** The most overlooked cell, and the healthiest signal in the grid. The team did competent work *for the knowledge it had*, and *learned* something in the doing — the classic "we didn't understand the domain until we'd built it once." This is not a failure; it's how design knowledge is actually acquired. The process change is **learning capture**: a lightweight mechanism (an ADR, a "what we'd do differently" note, a brown-bag) so the lesson outlives the ticket and informs the next design. A team with an empty prudent-inadvertent cell isn't debt-free — it's *not learning*, or not honest enough to admit what it now knows better.

Putting it together as a process map:

```
CELL                     SYSTEMIC CAUSE              WHAT YOU CHANGE
─────────────────────────────────────────────────────────────────────────
Reckless–Inadvertent     skills / review / standards onboarding, review policy,
                         gap                          written conventions, lint
Reckless–Deliberate      pressure / incentives /      capacity planning, what
                         normalized corner-cutting    you reward, deadline input
Prudent–Deliberate       the promise decays           debt register + expiry,
                                                       paydown scheduling
Prudent–Inadvertent      knowledge was acquired       learning capture (ADRs,
                         in the building              retros), feed-forward
```

> **Key insight:** Reckless cells expose *systemic* causes — pressure, missing review, skills gaps — that you fix at the process level, not file by file. Cleaning the artifacts in a full reckless cell without changing what produced them is bailing a boat without finding the hole; the cell refills next quarter.

---

## The Quadrant as a Forensic Tool

You've met the quadrant as a *forward* instrument: classify a decision as you make it, choose a response. It is at least as powerful run *backward* — as a **forensic and retrospective** instrument applied to debt that has already cost you.

The trigger is a specific kind of pain: a production incident whose root cause was a known shortcut, or a *slow quarter* — a stretch where features that should have taken days took weeks and nobody can point at a single villain. In both cases you have an outcome (the cost) and you want the cause. The move is to take the specific debt that produced the pain and **classify it after the fact** — and the discipline of doing so reliably surfaces that the root cause is a *cell*, a systemic pattern, not a line of code.

A worked scenario. A payment service has a 90-minute outage: a config flag that was supposed to be temporary, controlling which of two pricing engines runs, was read in a hot path with no fallback, and a stale value routed live traffic to a decommissioned engine. The shallow postmortem says: "missing fallback on the flag — add a default." True, and you should. But classify the debt:

- **Was it deliberate?** Yes — the flag was *explicitly* meant to be temporary ("we'll remove it once the migration's done"). So it entered as **prudent-deliberate**.
- **Was it still prudent at the time of the incident?** No. The migration finished eight months ago. The flag should have been deleted; the "we'll remove it" never happened. By the incident, the item had **migrated to reckless** (§8) — it was now an unowned, undocumented landmine that everyone had forgotten was load-bearing.

That reclassification is the whole insight. The incident's root cause is not "missing fallback" — that's the proximate, line-level cause. The *systemic* cause is that **prudent-deliberate debt in this org has no expiry and no owner, so it rots into reckless debt unnoticed.** The fix that prevents the *next* such incident isn't "add a default to this flag"; it's "temporary flags must carry an expiry date and an owner, and a job flags them when they expire." You found a process hole by classifying forensically.

Now the slow-quarter version, which is harder because there's no single incident. Over a quarter, the team's lead time crept from three days to nine. No outage, no fire — just sand in the gears. Run the forensic quadrant over the *changes that were slow*: pull the tickets, ask for each "what debt made this slow, and what cell was it in?" A pattern emerges — most of the slow changes touched the same two modules, and the debt in those modules was overwhelmingly **reckless-inadvertent**: a junior-heavy squad had built them fast without the layering the rest of the system uses, and nobody senior had reviewed the structure. The root cause isn't twenty slow tickets; it's a **single full cell** — a review-and-skills gap in one squad — that the quadrant made visible by aggregation.

```
FORENSIC QUADRANT (after an incident or a slow quarter)

   1. Take the debt that demonstrably caused the cost.
   2. Classify it AS IT WAS AT THE MOMENT OF PAIN (not at birth).
   3. Aggregate: are many costly items landing in ONE cell?
                         │
                         ▼
        ┌────────────────────────────────────┐
        │  A FULL CELL = a systemic cause      │
        │                                      │
        │  Reckless–Inadvertent cluster        │
        │     → review / skills / standards    │
        │  Reckless–Deliberate cluster         │
        │     → pressure / incentives          │
        │  "migrated to reckless" cluster      │
        │     → no expiry / no ownership        │
        └────────────────────────────────────┘
                         │
                         ▼
   4. Fix the CELL (the process), not just the line.
```

This is also the antidote to the shallow postmortem. "Add a null check," "the engineer will be more careful," "we'll do better next time" are all *line-level* or *person-level* corrections that leave the generator running. Forcing the question "*what cell, and is that cell full?*" pushes the analysis up to the system, which is the only level at which you can actually stop the bleeding. It connects directly to [06 — Preventing Accumulation](../06-preventing-accumulation/senior.md): the forensic quadrant *finds* the process hole; prevention is what *plugs* it.

> **Key insight:** After an incident or a slow quarter, classify the debt that caused it — and classify it *as it was at the moment of pain*, not at birth. The root cause is almost always a cell (a systemic pattern), not a line. A shallow postmortem fixes the line; the forensic quadrant fixes the generator.

---

## Beyond Fowler — The SEI/Kruchten Debt Landscape

Fowler offered the 2×2 explicitly as a way to *talk* about the intent behind debt — a conversation-starter, not a taxonomy of debt itself. It deliberately says nothing about *what* the debt is, *where* it lives, or whether you can even *see* it. For senior conversations — especially with architects and leadership — you need a richer model. The most useful is the **technical-debt landscape** from Kruchten, Nord, and Ozkaya's *Managing Technical Debt* (the SEI line of work).

Their first contribution is a **visibility** axis that Fowler's grid lacks entirely:

```
THE SEI TECHNICAL-DEBT LANDSCAPE (Kruchten, Nord, Ozkaya)

         VISIBLE                          MOSTLY INVISIBLE
   ┌──────────────────────┐        ┌──────────────────────────┐
   │  Low internal quality │        │  Architectural debt       │
   │  • code smells        │        │  • wrong/eroded structure │
   │  • known defects      │        │  • bad technology choices │
   │  • low test coverage  │        │  • coupling, dependency   │
   │  • documentation gaps │        │    cycles, layering breaks│
   └──────────────────────┘        │  • structural decay       │
        evolvability                └──────────────────────────┘
        issues (felt at                  the dangerous half:
        the code surface)                invisible until it's
                                         expensive to reverse
```

The landscape's central claim is that debt sits on a spectrum from **visible** (code smells, defects, missing tests — the stuff a linter or a code review surfaces) to **mostly invisible** (architectural and structural debt — the wrong decomposition, the dependency cycle, the database that was the right choice at 1,000 users and the wrong one at 10 million). The crucial, sobering point: **the invisible half is the expensive half.** Visible code-level debt is annoying but local and cheap to fix; you can see it, scope it, and refactor it. Architectural debt is invisible *precisely because* it's diffuse — it's a property of how the whole system is arranged, not of any one file — and by the time it's visible (everything is slow to change, every feature touches everything) it is enormously expensive to reverse.

They further separate three *kinds* by where the debt lives, which maps onto how you detect and pay it:

| Debt type | Where it lives | How you find it | How you pay it |
|---|---|---|---|
| **Code debt** | Inside modules/functions | Linters, reviews, smells | Refactoring (local, cheap) |
| **Architectural debt** | In the structure between modules | Architecture reviews, dependency analysis, fitness functions | Restructuring (global, expensive, risky) |
| **Production / infrastructure debt** | In build, deploy, ops, environments | Incident patterns, toil metrics, slow pipelines | Tooling, automation, platform work |

That third category — **production/infrastructure debt** — is the one engineers most often forget is debt at all: the flaky deploy script everyone works around, the environment that only one person can provision, the monitoring you keep meaning to add. It's real debt by Cunningham's definition (a shortcut that accrues interest as toil and risk), it's frequently *invisible* to the code-focused, and it tends to be **deliberate-but-unowned** — exactly the kind that migrates to reckless.

The senior move is to layer Fowler *onto* the landscape: take an architectural-debt item and *also* ask "deliberate or inadvertent, prudent or reckless?" An architectural choice that was **prudent-deliberate** (we chose a monolith on purpose to move fast at the start) is a completely different management problem from one that was **reckless-inadvertent** (we ended up with a distributed monolith because nobody owned the boundaries). Same landscape cell, opposite treatments — which is exactly why you need both models.

> **Key insight:** Fowler's grid classifies the *intent* behind debt; the SEI landscape classifies its *nature and visibility*. The two are orthogonal and complementary — and the landscape's hardest lesson is that the dangerous debt (architectural, structural) is invisible by construction and ruinously expensive once it surfaces. Combine them: "prudent-deliberate architectural debt" and "reckless-inadvertent architectural debt" demand opposite responses.

---

## McConnell's Taxonomy and Where Contagious Debt Sits

Steve McConnell's taxonomy approaches the same territory from the *intent* angle but cuts it more finely than Fowler, and it's the model that maps most cleanly onto budgeting. He splits debt first into two top-level kinds:

- **Type I — Unintentional debt.** Debt incurred non-strategically, through mistakes, low skill, or just learning-as-you-go. This is McConnell's bucket for Fowler's *inadvertent* row, and like Fowler he's clear that the unintentional/reckless corner is the one that signals a capability problem rather than a trade-off.
- **Type II — Intentional debt.** Debt incurred deliberately as a strategic tool, which he subdivides by *time horizon*:
  - **Short-term debt** — taken on tactically to hit a near deadline, expected to be paid back soon ("we'll fix it right after launch"). This is the *focused, reactive* debt you take consciously and track tightly.
  - **Long-term debt** — taken on strategically and *expected to be carried for a long time*, even indefinitely ("we'll target only x86 for the next two years"). This is debt you *choose to live with*, and the management question is not "when do we pay it" but "is the ongoing interest still worth it?"

That short-term vs long-term split is the part Fowler doesn't give you and that budgeting *needs*. Short-term intentional debt belongs on a paydown schedule with an expiry. Long-term intentional debt belongs in a periodic *review* — you don't schedule its repayment, you schedule a recurring "is this still the right bet?" check. Conflating the two is a classic error: teams either obsessively try to "pay off" debt they deliberately chose to carry forever, or they let genuinely short-term debt drift into the long-term mental bucket and never repay it.

Now, **where does contagious / architectural debt sit** across all three models? This is the crux, because contagious debt is the most expensive and the worst-served by the simple 2×2. Contagious debt is debt that **spreads** — through two mechanisms:

1. **By imitation.** A bad pattern, once in the codebase, becomes the template. The next engineer copies the nearest example; a single reckless shortcut reproduces itself across dozens of call sites. (This is why the *first* instance of a pattern matters far more than its cost suggests — you're not adding one unit of debt, you're seeding a strain.)
2. **By foundation.** Architectural debt is contagious because everything *built on top of it* inherits its constraints. A wrong boundary or a leaky abstraction isn't a localized defect; it shapes every feature that crosses it, so the debt compounds as the system grows on the bad foundation.

Locating contagious debt across the models:

```
                Fowler             SEI landscape        McConnell
              ─────────────       ─────────────────    ─────────────
Contagious /  usually starts      ARCHITECTURAL +       often Type II
architectural prudent-deliberate  INVISIBLE             long-term... that
debt          (a reasonable       (structural, diffuse, was never reviewed
              early choice)        spreads by           and curdled into
              → MIGRATES to        foundation)           Type I-grade rot
              reckless as it
              spreads & nobody
              owns the boundary
```

Read across that row and the danger is clear: contagious debt typically *enters* as a defensible prudent-deliberate choice (Fowler), lives in the **invisible, architectural** half of the SEI landscape, and is frequently a McConnell **long-term** bet that nobody ever revisits — so it quietly **migrates to reckless** (next section) while spreading. It is the worst combination the models can describe: expensive, invisible, self-propagating, and unowned. That is exactly why architectural review and fitness functions exist — they're the only instruments that make the invisible, contagious half *visible* before it's irreversible (see [06 — Preventing Accumulation](../06-preventing-accumulation/senior.md)).

> **Key insight:** McConnell's short-term vs long-term split is the one budgeting needs: short-term intentional debt gets a *paydown schedule*; long-term intentional debt gets a *recurring "is this still the right bet?" review*. Contagious/architectural debt is the cross-model nightmare — it enters as prudent-deliberate, hides in the invisible architectural half, is usually an un-reviewed long-term bet, and spreads by imitation and foundation, so it migrates to reckless while you aren't watching.

---

## Debt That Migrates Cells — The Quadrant Is About Follow-Through

Here is the idea that separates a senior's use of the quadrant from a textbook one. A classification is usually taught as a snapshot of the *moment of creation* — "we deliberately and prudently took this on." But debt is not static, and **the cell can migrate over time without anyone touching the code.** The most important migration is the one nobody decides and everybody causes:

> **Prudent-deliberate debt becomes reckless when the "we'll fix it" never happens.**

Sit with why this is true. What made the original decision *prudent* was not the shortcut itself — it was the shortcut **plus the credible intention and plan to pay it back.** Cunningham's healthy debt is healthy *because the rewrite is coming*. Strip away the rewrite and you're left with just the shortcut, indefinitely, and that is the definition of reckless: carrying a structural compromise with no sound plan to address it. The decision didn't change; *time* changed it. The flag meant to live for a sprint that's still there after a year is no longer a prudent trade-off — it's a reckless landmine, and the only thing that moved it across the grid was the failure to follow through.

```
THE MIGRATION (no code changes — only time + neglect)

  PRUDENT-DELIBERATE                        RECKLESS-(DELIBERATE→INADVERTENT)
  ┌────────────────────┐                    ┌──────────────────────────────┐
  │ "Ship now, fix next │   ── time ──▶      │ Still here a year later. The  │
  │  sprint." + a real  │   the promise      │ author left. The plan is lost.│
  │  plan to repay.     │   decays           │ Nobody remembers it's load-   │
  │                     │                    │ bearing. No sound plan exists.│
  └────────────────────┘                    └──────────────────────────────┘
   healthy: rewrite is                        unhealthy: the rewrite never
   coming                                     came → it's now reckless, and
                                              as knowledge of it is lost it
                                              even drifts toward INADVERTENT
```

Note the *second* drift in that diagram: as the deliberate debt ages, the people who knew it was deliberate leave or forget, and to the team that inherits it the debt is effectively **inadvertent** — they don't know it was a choice, they just find a weird shortcut. So unmanaged prudent-deliberate debt can migrate *twice*: first to reckless (the plan died), then toward inadvertent (the memory died). What began as the healthiest cell ends in the most dangerous one, purely through neglect.

This reframes what the quadrant *measures*. For deliberate debt especially, **the cell is a verdict on your follow-through, not on the moment of creation.** A team that takes on prudent-deliberate debt and *actually pays it down on schedule* keeps it prudent forever. A team that takes on the identical debt and lets it rot has *manufactured* reckless debt without a single reckless decision. The quadrant, watched over time, is therefore a mirror for organizational discipline: a drawer full of aged "temporary" items that were all "prudent-deliberate" at birth is hard evidence that your follow-through mechanism is broken — which is the precise problem [04 — Tracking & Prioritizing](../04-tracking-and-prioritizing/senior.md) exists to solve with registers, expiries, and triggers.

The senior practice that falls out of this:

- **Every prudent-deliberate item gets an expiry condition at birth** — a date, or better, a *trigger* ("when we add the second tenant," "when this exceeds 10k rows"). An item with no expiry is pre-migrated; you've already lost.
- **Re-classify periodically.** A debt review isn't just "what's new" — it's "what *moved*." Anything that was prudent-deliberate last quarter and has blown its expiry has migrated to reckless and should be re-prioritized as such.
- **Treat "temporary" as a claim that must be falsifiable.** If you can't state the condition under which the temporary thing gets removed, it isn't temporary, and you should classify and budget it as permanent (McConnell long-term) *now*, eyes open.

> **Key insight:** The cell isn't about the moment of creation — for deliberate debt it's about your follow-through. Prudent-deliberate debt with no expiry *is already on its way to reckless*; the only thing that keeps it prudent is actually paying it back. Re-classify over time, because a debt's cell *moves* even when its code doesn't.

---

## Classifying Honestly Against Hindsight Bias and Self-Serving Attribution

Every model in this page assumes you can classify *honestly*. You mostly can't, not by default — two cognitive biases systematically corrupt the placement, and a senior names them out loud so the team can correct for them.

**Hindsight bias** corrupts the *prudent / reckless* axis. After an outcome is known, the decision that led to it looks far more obviously good or bad than it was at the time. A shortcut that happened to blow up gets remembered as "reckless — we should have known," even if it was a perfectly sound bet given the information available. The reverse also happens: a reckless gamble that *didn't* blow up gets relabeled "prudent — it worked, didn't it?" Both are wrong, because **prudence is a property of the decision in its original information state, not of the outcome.** A bet with 90% good odds is prudent even on the 10% it loses; a bet with 10% odds is reckless even on the 90% it wins. The correction is a discipline: when classifying after the fact, *reconstruct what was known at the time* — what the deadline was, what the team understood, what alternatives existed — and judge the decision against *that*, not against what you now know happened. Pulling the original ticket, the original Slack thread, the original ADR is not bureaucracy; it's the only defense against grading a decision on its luck.

**Self-serving attribution** corrupts both axes, asymmetrically and in your own favor. People classify *their own* debt as prudent-deliberate ("a smart trade-off under pressure") and *others'* debt — especially debt they inherited — as reckless-inadvertent ("they didn't know what they were doing"). The same shortcut gets a charitable cell when it's yours and a damning one when it's theirs. This is corrosive in two directions: it inflates your team's competence in the record, *and* it poisons cross-team relationships ("the platform team's code is all reckless garbage") while letting your own reckless patterns hide under generous self-classification. The tell is statistical: if your team's debt is overwhelmingly in the prudent cells and inherited/other-team debt is overwhelmingly reckless, you are not observing reality — you are observing your own bias.

Corrections a senior can actually operationalize:

- **Classify blamelessly, and say so.** The point of the cell is to fix the *system*, not to indict a person — and people will only classify their own work as reckless if doing so isn't career-damaging. A reckless-inadvertent cluster is a *process* finding; frame it that way, every time, or the data goes dishonest.
- **Reconstruct the original information state before judging prudence.** Make "what did we know then?" a required question in any retrospective classification. No outcome-based grading.
- **Classify someone else's debt with the most charitable plausible reading,** then check whether you'd accept that reading for your own. The asymmetry is the bug; force symmetry.
- **Watch the distribution.** If the cells are suspiciously kind to you and harsh to everyone else, the bias is the finding. Honest classification produces uncomfortable cells about your own work.

> **Key insight:** Prudence is a property of the decision *in its original information state*, not of the outcome — hindsight bias makes lucky recklessness look prudent and unlucky prudence look reckless. And self-serving attribution makes your debt "smart trade-offs" and their debt "garbage." Classify blamelessly, reconstruct what was known then, and treat a distribution that flatters you as evidence of bias, not excellence.

---

## Setting Different Policies Per Cell — Tolerate, Track, Gate

The final senior use of the quadrant is the most concrete: it lets you set **differentiated policy** — explicit, written rules for *how the organization treats debt depending on its cell*. The naive policy is uniform: "no technical debt" (impossible and counterproductive) or "track all debt" (drowns you in noise). The senior policy is *graduated*, and the cell is the discriminator. There are three policy responses, and each cell gets a deliberate assignment:

- **Tolerate** — accept it, don't even track it. Some debt is genuinely fine and tracking it costs more than carrying it.
- **Track** — record it, attach a trigger/expiry, surface it in reviews. The debt is acceptable *for now* but must stay visible so it doesn't migrate.
- **Gate** — actively prevent it from landing. A quality gate, a review rule, an architectural fitness function that *fails the build* (or the PR) when this kind of debt appears.

Mapping policy to cells:

```
                    DELIBERATE                    INADVERTENT

  PRUDENT      ┌──────────────────┐          ┌──────────────────┐
               │  TRACK           │          │  TOLERATE → LEARN │
               │  Acceptable, but │          │  This is healthy. │
               │  must carry an   │          │  Don't gate it —  │
               │  expiry/trigger  │          │  you can't gate   │
               │  so it doesn't   │          │  "learning." Just │
               │  migrate.        │          │  capture & feed   │
               │                  │          │  it forward.      │
               └──────────────────┘          └──────────────────┘

  RECKLESS     ┌──────────────────┐          ┌──────────────────┐
               │  GATE (policy)   │          │  GATE (automated) │
               │  Hard to stop in │          │  THIS is what     │
               │  code; stop it in│          │  gates are best   │
               │  process: review │          │  at. Linters,     │
               │  must reject; no │          │  fitness funcs,   │
               │  "ship without   │          │  coverage floors  │
               │  design" as a    │          │  catch the gap    │
               │  norm.           │          │  mechanically.    │
               └──────────────────┘          └──────────────────┘
```

The asymmetry is the point. You **tolerate** prudent-inadvertent debt because it's the residue of learning and gating it is incoherent — you cannot build a CI check for "you should have understood the domain better the first time," and trying would punish the team for the normal way knowledge is acquired. You **track** prudent-deliberate debt because it's acceptable now but *will migrate* without a visible expiry. And you **gate** both reckless cells — but with *different instruments*, which is the subtlety most teams miss:

- **Reckless-inadvertent** is the cell automated gates are *best* at, because the debt comes from not-knowing, and tools encode knowing. A linter that forbids the anti-pattern, an architectural fitness function that fails on a forbidden dependency, a coverage floor that blocks the merge — these catch the skills/standards gap *mechanically*, which is exactly right because the human didn't have the knowledge to catch it themselves. This is the highest-ROI gating you can build.
- **Reckless-deliberate** is the cell automation is *worst* at, because the engineer *knew* and chose anyway — a person who'll knowingly skip design will knowingly route around a lint rule. The effective gate here is *human and cultural*: a review process that rejects "no time for design" as an answer, a norm that "shipped but unmaintainable" is not done, leadership that doesn't reward the corner-cutting. You gate this cell with policy and culture, not CI.

This per-cell policy is also how you keep the term *technical debt* from collapsing back into "code I dislike." When the organization has written rules — *this cell we tolerate, this we track with an expiry, this we gate in CI, this we gate in review* — every classification has a consequence, which forces classifications to be honest and specific. Policy gives the quadrant teeth. It plugs directly into the gating and prevention machinery: the gates themselves are designed in [06 — Preventing Accumulation](../06-preventing-accumulation/senior.md), and what you choose to *track* (rather than gate or tolerate) becomes the input to the register and prioritization in [04 — Tracking & Prioritizing](../04-tracking-and-prioritizing/senior.md).

> **Key insight:** Set graduated policy by cell: **tolerate** prudent-inadvertent (it's learning — you can't gate it), **track** prudent-deliberate (it migrates without an expiry), and **gate** both reckless cells — but gate reckless-*inadvertent* with *automation* (tools encode the knowledge the author lacked) and reckless-*deliberate* with *culture and review* (a person who knowingly skips design will route around a lint rule).

---

## Mental Models

- **The cell is a prescription, not a label.** Reading the cell tells you which *lever* to pull — track, learn, fix conditions, build capability — and only sometimes "refactor." A classification you don't act on differently is taxonomy theatre.

- **Reckless cells are systemic findings.** A full reckless cell is rarely a code problem; it's a *generator* problem — pressure, missing review, a skills gap. Cleaning the artifacts without fixing the generator just lets the cell refill. Classify the *cluster*, not the line.

- **Run the quadrant backward to find root causes.** After an incident or a slow quarter, classify the debt that caused the cost *as it was at the moment of pain*. The root cause is almost always a full cell (a process hole), not a line — which is what the shallow postmortem always misses.

- **Visibility is a hidden axis, and the invisible half is the expensive half.** The SEI landscape adds what Fowler omits: architectural/structural debt is invisible by construction and ruinous once it surfaces. Layer Fowler's *intent* onto the landscape's *nature*; they're orthogonal.

- **The cell migrates; the code doesn't have to.** Prudent-deliberate debt becomes reckless the day the "we'll fix it" dies, and drifts toward inadvertent as the memory dies. For deliberate debt, the cell is a verdict on your *follow-through*, not the moment of creation. Re-classify over time.

- **Prudence is about the decision, not the outcome.** Hindsight bias grades shortcuts on their luck; self-serving attribution grades your debt as smart and theirs as garbage. Reconstruct the original information state, classify blamelessly, and treat a flattering distribution as a bias signal.

- **Different cells deserve different policy.** Tolerate, track, gate — and gate the two reckless cells with *different instruments* (automation for inadvertent, culture for deliberate). Uniform policy ("no debt" / "track everything") is always wrong.

---

## Common Mistakes

1. **Treating classification as the deliverable.** Sorting debt into four buckets and then doing nothing different is the single most common failure. The cell's only value is the *different response* it prescribes; if Monday looks the same, you wasted the workshop.

2. **Responding to a full reckless cell by cleaning the code.** Rewriting reckless-inadvertent artifacts without fixing the skills/review/standards gap that produced them bails the boat without plugging the hole — the cell refills next quarter. The fix is upstream, in the process.

3. **Classifying only at the line/ticket level.** One reckless function is noise; a *cluster* of them from the same source is a hiring or onboarding finding. The systemic lever the cell points at is a property of the system, so classify the aggregate.

4. **Snapshotting the cell at creation and never re-checking.** Prudent-deliberate debt *migrates* to reckless when the promised fix never lands. A debt review that only asks "what's new" and never "what *moved*" misses the most dangerous transitions entirely.

5. **Grading prudence on the outcome.** "It blew up, so it was reckless" / "it worked, so it was prudent" is hindsight bias. Prudence is a property of the decision in its original information state — reconstruct what was known *then* before you judge.

6. **Letting self-serving attribution stand.** Classifying your team's debt as prudent and inherited/other-team debt as reckless isn't observation, it's bias. The tell is the distribution; honest classification produces uncomfortable cells about your own work.

7. **Treating Fowler's 2×2 as the whole model.** It classifies *intent* and says nothing about *nature* or *visibility*. Missing the SEI landscape's architectural/invisible debt — the expensive half — and McConnell's short-term/long-term split (which budgeting needs) leaves you blind to the debt that actually sinks systems.

8. **Gating the reckless cells with the same instrument.** Automation catches reckless-*inadvertent* (tools encode the missing knowledge) but a person who *knowingly* skips design will route around a lint rule — reckless-*deliberate* needs culture and review, not CI. Same cell color, different gate.

---

## Test Yourself

1. A team holds a quadrant workshop, sorts twenty debt items into four cells, and ships nothing different the next week. What did they get wrong about what the quadrant is *for*?
2. Your reckless-inadvertent cell is full — forty messy functions, no layering. Why is "rewrite them" usually the wrong first move, and what are the three systemic causes you'd investigate instead?
3. A config flag meant to be temporary causes a 90-minute outage eight months after the migration it supported finished. Classify it *at birth* and *at the moment of the incident*. What does the difference tell you about the real root cause?
4. Name the axis the SEI/Kruchten landscape adds that Fowler's grid lacks, and state its hardest lesson about which debt is most expensive.
5. McConnell splits *intentional* debt two ways. What's the split, and why does budgeting need it — i.e., what do you *do* differently with each half?
6. Explain how prudent-deliberate debt can migrate to reckless — and then toward inadvertent — without anyone changing a line of code. What single practice prevents the first migration?
7. After a known-shortcut outage, a colleague says "it was reckless, we should have known better." It worked fine for eight months before failing. Which bias is in play, and how do you correct the classification?
8. You're writing debt policy. Assign **tolerate / track / gate** to all four Fowler cells, and explain why the two reckless cells need *different* gating instruments.

<details>
<summary>Answers</summary>

1. They treated classification as a **deliverable** instead of a **decision function**. The cell's only value is the *different response* it prescribes (track / learn / fix conditions / build capability) — if nothing downstream changes, it's taxonomy theatre. Output of classifying is a decision about which *process* to change.

2. Reckless-inadvertent means the authors *didn't know better* and *no sound judgment was applied* — so the artifacts are symptoms; rewriting them leaves the generator intact and the cell refills. Investigate: (a) a **skills gap** (team doesn't know the pattern → deliberate skill-building, pairing); (b) **missing review** (someone knew better but never saw it → fix review/ownership); (c) a **standards vacuum** (no agreed "how we do this" → written conventions, lint). Diagnose by the *spread*.

3. **At birth: prudent-deliberate** — explicitly meant to be temporary, a sound trade-off to ship the migration. **At the incident: migrated to reckless** — the migration finished eight months ago, the flag should have been deleted, the "we'll remove it" never happened; it's now an unowned, forgotten landmine. The difference reveals the real root cause isn't "missing fallback" (the line) but that **temporary debt in this org has no expiry and no owner**, so it rots into reckless — fix: expiries + owners + an expiry-flagging job.

4. It adds a **visibility** axis (visible ↔ mostly invisible). Hardest lesson: the **invisible half is the expensive half** — architectural/structural debt is invisible *by construction* (diffuse, a property of the whole arrangement) and ruinously expensive to reverse by the time it becomes visible. Code-level visible debt is annoying but local and cheap.

5. **Short-term** intentional debt (tactical, near-deadline, repay soon) vs **long-term** intentional debt (strategic, carried indefinitely). Budgeting needs it because you treat them oppositely: short-term gets a **paydown schedule with an expiry**; long-term gets a **recurring "is this still the right bet?" review** — you don't schedule its repayment, you schedule re-evaluation of the ongoing interest.

6. What made it *prudent* was the shortcut **plus a credible plan to repay**. When the "we'll fix it" never happens, only the shortcut remains, carried indefinitely with no sound plan — the definition of **reckless**. Time, not code, moved it. Then as the people who knew it was deliberate leave/forget, the inheriting team experiences it as **inadvertent** (they don't know it was a choice). Prevention of the first migration: **attach an expiry/trigger to every prudent-deliberate item at birth** (and re-classify periodically).

7. **Hindsight bias** — the colleague is grading the decision on its *outcome* (it failed) rather than its original information state. Prudence is a property of the decision *when made*: a sound bet is prudent even on the fraction it loses. Correct it by **reconstructing what was known at the time** (original ticket/ADR/deadline/alternatives) and judging the decision against that — it may well have been prudent-deliberate at birth and only *migrated* to reckless via neglect.

8. **Prudent-inadvertent → tolerate** (it's the residue of learning; you can't build a CI check for "should've understood the domain sooner" — capture and feed forward instead). **Prudent-deliberate → track** (acceptable now, but migrates without a visible expiry). **Both reckless cells → gate**, but: reckless-*inadvertent* → **automated** gates (linters, fitness functions, coverage floors — tools encode the knowledge the author lacked; highest-ROI gating). Reckless-*deliberate* → **culture/review** gates (a person who knowingly skips design will route around a lint rule; you need a review that rejects "no time for design" and leadership that doesn't reward corner-cutting).

</details>

---

## Cheat Sheet

```
THE FOUR CELLS → THE LEVER (classification is a decision function)
  Reckless–Inadvertent   skills/review/standards gap → onboarding, review, conventions, lint
  Reckless–Deliberate    pressure/incentives        → capacity, what you reward, deadline input
  Prudent–Deliberate     the promise decays          → debt register + EXPIRY, paydown schedule
  Prudent–Inadvertent    knowledge was acquired      → learning capture (ADRs, retros)
  (none of the levers is "just clean the code" — that's the refactoring response, decided AFTER)

FORENSIC USE (run it backward after an incident / slow quarter)
  1. take the debt that caused the cost
  2. classify it AS IT WAS AT THE MOMENT OF PAIN (not at birth)
  3. aggregate → a FULL cell = a systemic cause (a process hole), not a line
  4. fix the cell (the generator), not the line  → shallow postmortems fix only the line

RICHER MODELS
  SEI / Kruchten landscape:  VISIBLE (code smells, defects, low coverage)
                             ↔ MOSTLY INVISIBLE (architectural/structural)  ← the expensive half
     kinds: code debt (local, cheap) | architectural (global, expensive) | production/infra (toil)
  McConnell taxonomy:  Type I unintentional  |  Type II intentional → SHORT-TERM (schedule paydown)
                                                                    → LONG-TERM (recurring review)
  Contagious/architectural debt: enters prudent-deliberate, lives INVISIBLE/architectural,
     is an un-reviewed long-term bet, spreads by IMITATION + FOUNDATION → migrates to reckless

MIGRATION (cell moves even when code doesn't)
  prudent-deliberate --(promise dies)--> reckless --(memory dies)--> inadvertent
  the cell is a verdict on FOLLOW-THROUGH; every prudent-deliberate item needs an EXPIRY at birth
  debt review asks "what MOVED?", not just "what's new?"

HONEST CLASSIFICATION
  hindsight bias  → corrupts prudent/reckless: don't grade on OUTCOME; rebuild the info-state at the time
  self-serving    → "my debt = prudent, their debt = reckless"; the tell is the DISTRIBUTION
  always classify BLAMELESSLY (reckless cluster = process finding, not a person)

POLICY PER CELL
  prudent-inadvertent → TOLERATE (can't gate learning)
  prudent-deliberate  → TRACK (with expiry, or it migrates)
  reckless-inadvertent→ GATE w/ AUTOMATION (linters/fitness funcs encode missing knowledge)
  reckless-deliberate → GATE w/ CULTURE+REVIEW (knowers route around CI)
```

---

## Summary

- **Classification is the input to strategy, not the output.** The cell is a decision function: it prescribes a *lever* — track, learn, fix conditions, build capability — and most levers are not "clean the code." A classification you don't act on differently is taxonomy theatre.
- **Reckless cells expose systemic causes** — pressure, missing review, skills gaps — that you fix at the *process* level, not file by file. Cleaning the artifacts without fixing the generator just refills the cell. Classify the *cluster*, because the lever is a system property.
- **Run the quadrant backward as a forensic tool.** After an incident or a slow quarter, classify the debt that caused the cost *as it was at the moment of pain* and aggregate; the root cause is almost always a *full cell* (a process hole), which is exactly what shallow postmortems miss.
- **Go beyond Fowler.** The **SEI/Kruchten landscape** adds a visibility axis and separates code / architectural / production-infrastructure debt — with the hard lesson that the invisible (architectural) half is the expensive half. **McConnell's** short-term vs long-term split is what budgeting needs. **Contagious/architectural** debt is the cross-model nightmare: it enters prudent-deliberate, hides in the invisible half, is an un-reviewed long-term bet, and spreads by imitation and foundation.
- **The cell migrates.** Prudent-deliberate debt becomes reckless when the "we'll fix it" dies, then drifts toward inadvertent as the memory dies — no code change required. For deliberate debt the cell is a verdict on your *follow-through*; every such item needs an expiry at birth, and reviews must ask "what *moved*?"
- **Classify honestly.** Hindsight bias grades prudence on the *outcome* (reconstruct the original information state instead); self-serving attribution grades your debt charitably and theirs harshly (the tell is the distribution). Classify blamelessly or the data goes dishonest.
- **Set graduated policy per cell.** Tolerate prudent-inadvertent (you can't gate learning), track prudent-deliberate (or it migrates), and gate both reckless cells — with *automation* for the inadvertent one (tools encode the missing knowledge) and *culture/review* for the deliberate one (knowers route around CI).

You now use the quadrant the way a senior does: not to *label* debt but to *route* it — into a process change, a root-cause fix, a tracking register, or a gate. The next pages turn that routing into machinery: [04 — Tracking & Prioritizing](../04-tracking-and-prioritizing/senior.md) for what you choose to *track*, and [06 — Preventing Accumulation](../06-preventing-accumulation/senior.md) for the *gates* the reckless cells demand.

---

## Further Reading

- **Martin Fowler — "Technical Debt Quadrant"** (martinfowler.com, 2009). The source 2×2, and Fowler's own framing of it as a tool for *talking about intent*, not a complete taxonomy — worth reading for how modest a claim he actually made.
- **Ward Cunningham — the 2009 "Debt Metaphor" video.** The clarification that *prudent-deliberate* (ship to learn, then refactor) was the only debt he ever meant — directly underpins why unmanaged prudent debt *migrating* is the core failure.
- **Kruchten, Nord & Ozkaya — *Managing Technical Debt* (SEI, Addison-Wesley).** The technical-debt landscape, the visible/invisible spectrum, and the code/architectural/production split. The definitive senior-level treatment of debt as an architectural concern.
- **Steve McConnell — "Managing Technical Debt"** (Construx white paper / talk). Type I vs Type II and the short-term/long-term subdivision of intentional debt — the taxonomy that maps onto budgeting.
- **Adam Tornhill — *Software Design X-Rays***. Behavioral hotspots (churn × complexity) — how to make the *invisible*, architectural half of the landscape *visible* with data, which is the prerequisite for classifying it at all.
- **Philippe Kruchten — "What Colour Is Your Backlog?"** A practical model for separating visible features from invisible architectural and debt work in one backlog — the policy/tracking consequence of the landscape.

---

## Related Topics

- [01 — What Is Technical Debt](../01-what-is-technical-debt/senior.md) — principal vs interest, debt vs bug vs cruft; the definitional discipline that keeps "reckless-inadvertent" from laundering plain incompetence.
- [04 — Tracking & Prioritizing](../04-tracking-and-prioritizing/senior.md) — the register, expiries, and cost-of-delay/WSJF that operationalize *tracking* the cells you don't gate, and that stop prudent-deliberate debt from migrating.
- [06 — Preventing Accumulation](../06-preventing-accumulation/senior.md) — the Definition of Done, review, quality gates, and fitness functions that *implement* the gating the reckless cells demand.
- [junior.md](junior.md) · [middle.md](middle.md) · [professional.md](professional.md) — the rest of this topic's tier set: the grid itself (junior), placing real decisions on it (middle), and operating quadrant-driven policy across an organization (professional).
