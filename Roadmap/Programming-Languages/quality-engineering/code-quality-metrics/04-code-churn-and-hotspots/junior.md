# Code Churn & Hotspots — Junior Level

> **Roadmap:** [Code Quality Metrics](../README.md) → Code Churn & Hotspots
> *Every metric so far reads the code as it sits today, frozen. But your code has a history — who touched what, how often, how violently — and that history is sitting in your `.git` folder right now, quietly pointing at exactly where the bugs live.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concept 1 — What Churn Is](#core-concept-1--what-churn-is)
5. [Core Concept 2 — Why Churn Matters](#core-concept-2--why-churn-matters)
6. [Core Concept 3 — The Hotspot: Churn × Complexity](#core-concept-3--the-hotspot-churn--complexity)
7. [Core Concept 4 — Finding Churn With Git](#core-concept-4--finding-churn-with-git)
8. [Core Concept 5 — What to Do With a Hotspot](#core-concept-5--what-to-do-with-a-hotspot)
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

> Focus: **Your git history is a quality signal — learn to read it.**

Most code-quality metrics take a photograph. They look at one version of one file and measure something about it: how many branches it has, how tangled its dependencies are, how long its functions run. Useful — but blind to *time*. A photograph can't tell you that one file has been edited 200 times this year while the file next to it hasn't changed since 2019.

That difference is enormous, and it's the whole subject of this page. The single most reliable predictor of where the next bug will appear is not how complex a file looks — it's **how much that file changes**. This is not folklore; it is one of the most replicated findings in empirical software engineering (Nagappan and Ball at Microsoft Research showed code churn predicts defect density better than most static measures). The files developers keep going back to, again and again, are where effort concentrates, where merge conflicts erupt, and where bugs breed.

The good news: you already have this data. Every `git commit` you've ever made recorded *which files changed* and *by how much*. You don't need a fancy tool to start — a one-line `git log` command will rank your files by how often they're touched. This page teaches you to read that signal, and to combine it with complexity to find **hotspots**: the files that are both heavily changed *and* complicated — the single best "go look here first" list you can produce about any codebase.

> **The mindset shift:** stop asking only "is this code complex?" Start asking "is this code complex *and* does anyone keep changing it?" A complex file nobody touches is a fossil — leave it alone. A complex file everyone edits is a bonfire. Your git history already knows which is which; you just have to ask it.

---

## Prerequisites

- **Required:** You've used **git** — you can `git add`, `git commit`, and you know what a commit is.
- **Required:** You're comfortable running commands in a terminal and piping output (`|`).
- **Helpful:** You've seen the words "cyclomatic complexity" or "complexity score" before. (If not, [01 — Cyclomatic & Cognitive Complexity](../01-cyclomatic-and-cognitive-complexity/junior.md) is the companion to this page — complexity is one half of a hotspot.)
- **Helpful:** You've worked on a codebase long enough to have a gut feeling that "*this* file is always the one breaking." You're about to confirm that gut feeling with data.

---

## Glossary

| Term | Plain-English meaning |
|---|---|
| **Churn** | How much a file changes over time — measured by how many commits touch it, or how many lines it gains and loses. |
| **Change frequency** | The simplest churn measure: the *count* of commits that modified a file. The headline number for this page. |
| **Lines churned** | Lines added + lines removed over a period. A finer-grained churn measure than commit count. |
| **Complexity** | How hard a file is to understand — branches, nesting, length. Measured by tools like cyclomatic complexity. The *other* axis of a hotspot. |
| **Hotspot** | A file that is **both high-churn and high-complexity** — changed a lot *and* hard to understand. The danger zone. |
| **Revision history** | The full record of commits git keeps — the raw material every measure on this page comes from. |
| **Static snapshot** | Any metric computed from one version of the code, ignoring history (e.g. plain complexity). The opposite of a churn-based metric. |

---

## Core Concept 1 — What Churn Is

**Churn** is a measure of *change over time*. Not the state of the code — the *movement* of it. There are two everyday ways to quantify it, and as a beginner you should start with the first:

**1. Change frequency (commit count).** How many commits touched this file? This is the simplest, most robust churn measure. A file with 180 commits and a file with 3 commits are telling you two very different stories, and the count alone captures most of the signal.

**2. Lines churned (added + removed).** Over some window — say the last 90 days — how many lines did this file gain and lose? This is finer-grained: it distinguishes a file that got one-line tweaks 50 times from one that got rewritten wholesale twice. Both matter; commit count is just the easiest place to begin.

A picture of the difference between a static snapshot and churn:

```
STATIC SNAPSHOT (one version)        CHURN (across history)
  payment.go: 400 lines                payment.go: touched in 180 commits,
              complexity 35                        +4,200 / −3,900 lines this year
  (a photograph — no sense of time)    (a movie — change is the whole point)
```

The key word is *time*. Complexity asks "what does this file look like now?" Churn asks "how restless has this file been?" They are independent questions — and a file can score high on one and low on the other, which is exactly what makes the combination (the next concept) so useful.

> **Key insight:** churn is the one quality signal you get *for free* and *retroactively*. You didn't have to instrument anything; git recorded it automatically with every commit since the project began. The history is already there — churn is just the act of finally reading it.

---

## Core Concept 2 — Why Churn Matters

Why would *how often a file changes* predict *where bugs are*? Three plain reasons, each one something you've probably felt without naming it:

**1. Change is where bugs are introduced.** A file that never changes can't gain a new bug — its behavior is settled. Every edit, by contrast, is a fresh chance to get something wrong. The more a file is edited, the more shots at introducing a defect it has taken. Defects don't appear in stable code; they ride in on changes.

**2. High churn signals an unsettled design.** A file touched 180 times in a year is usually not "actively maintained" in a healthy sense — it's a file the team can't stop coming back to. That often means the abstraction is wrong: responsibilities are smeared across it, so almost every feature has to poke it. The churn is a *symptom* of a design that hasn't found its shape.

**3. High churn means high contention.** Files everyone edits are where merge conflicts happen, where two developers' changes collide, where a refactor by one person breaks another's work-in-progress. Churn is a proxy for "how many people's hands are in this file," and many hands means coordination cost and coordination bugs.

Put together: **the files that change the most are where bugs and effort concentrate.** This is why a history-aware view beats a static snapshot — the snapshot sees a tidy-looking file and gives it a clean bill of health, while the history reveals that the same file has been a revolving door of fixes. The code looks fine; its track record says otherwise.

> **Key insight:** churn measures *risk you've already been paying*, not risk you might pay. A high-churn file isn't a prediction that trouble *could* come — it's a record that trouble *has been* coming, repeatedly. History is a better witness than appearance.

---

## Core Concept 3 — The Hotspot: Churn × Complexity

Churn alone is a strong signal, but it has a blind spot. A trivial config file or a constants list might change constantly and be perfectly safe — there's nothing to get wrong in a list of feature flags. High churn, low danger. So churn by itself over-flags the harmless busy files.

The fix is to combine churn with **complexity**. A **hotspot** is a file that scores high on *both* axes:

```
                 high complexity
                       │
      FOSSIL           │        HOTSPOT  ← go here first
  (complex, but        │     (complex AND
   nobody touches it   │      changed a lot —
   — leave it alone)   │      bugs & effort live here)
                       │
 ──────────────────────┼──────────────────────  high churn →
                       │
      CALM             │        BUSY-BUT-SIMPLE
  (simple, rarely      │     (changed a lot but
   touched — ignore)   │      trivial — usually fine)
                       │
```

Read the quadrants:

- **Bottom-left (low churn, low complexity):** calm, simple code. Ignore it.
- **Top-left (high complexity, low churn):** a complex file nobody touches. It's intimidating, but it's a *fossil* — nobody's changing it, so it's not actively producing bugs. **Do not waste your refactoring energy here.** This is the most counter-intuitive part for juniors: the scary-looking file isn't the dangerous one if it sits untouched.
- **Bottom-right (high churn, low complexity):** the busy config file. Changes a lot, but there's nothing to get wrong. Usually fine.
- **Top-right (high churn, high complexity):** the **hotspot**. Hard to understand *and* constantly being changed — so every change is a hard change made in a risky place, by possibly several people at once. This is where bugs and effort genuinely concentrate.

> **Key insight:** complexity tells you a file is *hard to change safely*; churn tells you it's *being changed anyway, a lot*. Neither is dangerous alone — a hard file left untouched is fine, an easy file edited constantly is fine. It's the **multiplication** that's lethal: hard × often = the place your next bug is most likely hiding. The hotspot is the single highest-value "go look here" signal a codebase can give you, because it ranks files by *risk you're actively running*, not risk in the abstract.

This is why hotspots top almost every prioritization list. (Turning a ranked hotspot list into *which debt to pay down and when* is a separate discipline — see [Technical Debt Management](../../technical-debt-management/) — this page is only about producing the signal, not deciding the budget.)

---

## Core Concept 4 — Finding Churn With Git

You don't need a tool to see churn. Git already recorded it. Here is the one command to remember — it ranks every file by how many commits touched it (its change frequency):

```bash
git log --pretty=format: --name-only | sort | uniq -c | sort -rg | head -20
```

Read it left to right as a little pipeline, the same way you'd read a build:

```
git log --pretty=format: --name-only   # list every file touched, one per line, no commit noise
  | sort                               # group identical filenames together
  | uniq -c                            # collapse each group → "<count> filename"
  | sort -rg                           # sort by that count, biggest first (-r reverse, -g numeric)
  | head -20                           # show the top 20
```

The output looks like this — the left column is the number of commits that touched the file:

```
   182 src/payment/checkout.go
   147 src/auth/session.go
    98 src/api/handlers.go
    61 internal/db/migrations.go
    ...
```

That top line — `182 src/payment/checkout.go` — is your most-churned file. It's the first file you should be suspicious of. (`--pretty=format:` with an empty format strips the commit headers so only filenames remain; `uniq -c` only collapses *adjacent* duplicates, which is exactly why the `sort` before it is required.)

Two refinements worth knowing now:

**Limit the window.** Ancient history can mislead — a file churned heavily in 2021 but quiet since isn't your problem today. Scope to recent activity:

```bash
git log --since="6 months ago" --pretty=format: --name-only | sort | uniq -c | sort -rg | head -20
```

**See lines added/removed, not just commit count,** for a finer measure of how violently a file churns:

```bash
git log --since="6 months ago" --numstat --pretty=format: \
  | awk 'NF==3 { add[$3]+=$1; del[$3]+=$2 } END { for (f in add) print add[f]+del[f], f }' \
  | sort -rg | head -20
```

`--numstat` prints `<added> <removed> <filename>` per file per commit; the `awk` sums added + removed lines per file. Start with the first, simple command — graduate to this when commit counts aren't telling you enough.

> **Key insight:** the headline command is just `git log` piped through standard Unix counting tools — `sort | uniq -c | sort -rg`. There is no proprietary magic here. Every churn dashboard you'll ever see (CodeScene, Code Climate) is, at its core, this same query dressed up with a UI. Run it on any repo today and you have the raw signal in three seconds.

---

## Core Concept 5 — What to Do With a Hotspot

Finding a hotspot is the easy part. Here's the sober part: a hotspot is **a question, not a verdict.** It says "this file carries the most risk in the codebase" — it does *not* say "this file is bad" or "drop everything and rewrite it." Your job is to investigate, in roughly this order:

**1. Look at it.** Actually open the top-ranked file and read it. Often the diagnosis is immediate — a 600-line "god" file doing five unrelated jobs, or one function the whole team keeps patching. The metric pointed; your eyes confirm.

**2. Ask *why* it churns.** Different causes need different cures:
   - *It's the natural center of the feature* (the checkout file in a payments app) — high churn may be unavoidable; focus on making it *safer to change* (tests, smaller functions).
   - *It's a dumping ground* — unrelated responsibilities piled into one file, so every feature has to touch it. The cure is to **split it** so changes land in separate, focused files.
   - *It's missing tests*, so every change is risky and spawns follow-up fix commits (which inflate the churn further). The cure is **tests first**, refactor second.

**3. Reduce the *complexity* half, not the churn.** You usually can't (and shouldn't) stop a file from changing — the business keeps needing changes there. What you *can* do is move it **down** the complexity axis: break the big file into smaller ones, extract tangled functions, add the tests that make each change safe. Same churn, far less danger — you've walked the file out of the top-right quadrant.

**4. Re-run the command later.** Churn is a *trend*. After you split a hotspot, the changes start landing in the new, smaller files; the old monster's churn falls. Re-running `git log` next month shows whether your fix actually moved the needle. A metric you can watch improve is worth ten metrics you only measured once.

> **Key insight:** never treat a hotspot ranking as a score to optimize. The moment "lower the churn number" becomes the goal, people game it — they stop committing to the file, or split it cosmetically without untangling anything. The hotspot is a **flashlight**, not a grade. It tells you *where to point your attention*; what you do once you look is an engineering judgment, not a number to minimize. (Goodhart's law in miniature: a measure that becomes a target stops being a good measure.)

---

## Real-World Examples

**1. The file the whole team feared — confirmed by one command.** A new engineer joins a payments team and keeps hearing "be careful with `checkout.go`." They run the churn one-liner and there it is at the top: 182 commits in a year, more than double the next file. It's also 600 lines with deeply nested branches — a textbook hotspot, high on both axes. The team's folklore was right; the command turned a vague fear into a ranked, defensible target. They split it into `pricing.go`, `tax.go`, and `payment_gateway.go`, and watched the original's churn drain away over the following months.

**2. The scary file that was actually safe.** A junior, eager to improve things, finds a gnarly 900-line `legacy_report_generator.go` and proposes a big rewrite. A senior runs the churn command: the file has **3 commits in three years**. It's a fossil — complex, yes, but in the *top-left* quadrant, not the hotspot quadrant. Nobody touches it, so it's not producing bugs. The senior redirects the effort to the genuine top-right hotspot instead. Lesson: complexity *alone* would have sent the junior to rewrite the wrong file; adding the churn axis saved a week.

**3. The busy file that didn't matter.** A churn-only ranking puts `feature_flags.go` near the top — it changes almost daily. But it's a flat list of boolean constants: trivial, nothing to get wrong. It's *bottom-right* — high churn, near-zero complexity. The team correctly ignores it. This is exactly why churn needs the complexity axis: churn alone would have wasted attention on a harmless file.

---

## Mental Models

- **Churn is a movie; static metrics are a photograph.** Cyclomatic complexity snaps one frame and judges the code's pose. Churn plays the whole reel and shows you which file can't sit still. Bugs ride in on *motion*, and only the movie shows motion.

- **The hotspot quadrant — the "go look here" map.** Two axes: churn (how often it changes) and complexity (how hard it is). The top-right corner — changed-a-lot *and* hard — is where your attention is worth the most. Memorize the four corners: fossil (top-left, leave it), hotspot (top-right, look first), calm (bottom-left, ignore), busy-but-simple (bottom-right, usually fine).

- **A complex fossil vs a complex bonfire.** Two files, both intimidatingly complex. One hasn't been touched in two years (fossil — cold, harmless). One is edited every week (bonfire — actively throwing sparks). Identical on a static metric; opposite in danger. Churn is what tells them apart.

- **The hotspot is a flashlight, not a grade.** It doesn't tell you the code is "bad" or assign a score to beat. It points: *look here first*. What you find when you look — and what you do about it — is engineering judgment. The instant you try to optimize the number directly, you've broken the flashlight.

---

## Common Mistakes

1. **Judging risk by complexity alone, ignoring history.** The scariest-looking file might be a fossil nobody touches — genuinely harmless. Without the churn axis you'll pour refactoring effort into code that wasn't producing any bugs. Always ask *and how often does it change?*

2. **Treating churn alone as the danger signal.** A config file or constants list can be the most-changed file in the repo and completely safe. Churn over-flags trivial-but-busy files. You need churn *times* complexity — that's what a hotspot is.

3. **Forgetting to scope the time window.** `git log` with no `--since` counts a file's *entire* history, including a churn spike from three years ago that's irrelevant now. Hotspots are about *current* risk — scope to the last 3–6 months for a picture of where trouble lives *today*.

4. **Letting renames and moves fool the count.** When a file is renamed, git may treat the new path as a brand-new file, resetting its churn to near zero — so a heavily-churned file can "disappear" from your ranking right after a move. Be aware the simple one-liner doesn't follow renames; treat a suspiciously fresh-looking file with caution.

5. **Turning the hotspot list into a target.** The moment "get the churn number down" becomes the goal, people stop committing to the file or split it cosmetically — gaming the metric without fixing anything. Hotspots guide attention; they are not a score to optimize.

6. **Trying to *eliminate* churn instead of reducing complexity.** You usually can't stop a file from changing — the business needs those changes. The lever you actually control is the complexity half: split, extract, test. Walk the file out of the danger quadrant; don't try to freeze it.

---

## Test Yourself

1. In one sentence each, define **churn** and a **hotspot**, and state how they differ.
2. You have two complex files. File A was changed in 120 commits this year; file B in 2. Which deserves your attention first, and why?
3. Why isn't churn *alone* a reliable danger signal? Give a concrete example of a high-churn file that's perfectly safe.
4. Write (or recall) the git one-liner that ranks files by how many commits touched them. What does the leftmost number in the output mean?
5. You've identified a genuine hotspot. You can't stop the business from needing changes there. Which axis do you actually work on, and name two concrete things you'd do.
6. Why is scoping the churn command with `--since="6 months ago"` usually better than counting all history?

<details>
<summary>Answers</summary>

1. **Churn** = how much a file changes over time (commits touching it, or lines added/removed). A **hotspot** = a file that is *both* high-churn *and* high-complexity. They differ in that churn is one axis (change), while a hotspot is the *combination* of that axis with complexity — churn alone isn't a hotspot.
2. **File A** (120 commits). A complex file that's heavily changed is a hotspot — bugs and effort concentrate there. File B is complex but a *fossil*: nobody touches it, so it isn't actively producing bugs. Complexity alone would mislead you; the churn axis is what separates them.
3. Because high churn with *low* complexity is usually harmless — there's nothing to get wrong. Example: a `feature_flags.go` of boolean constants that changes daily. Lots of churn, near-zero risk. You need churn × complexity, not churn alone.
4. `git log --pretty=format: --name-only | sort | uniq -c | sort -rg | head -20`. The leftmost number is the **count of commits that touched that file** — its change frequency.
5. Work on the **complexity** axis (you can't realistically stop the churn). Concretely: (a) split the file into smaller, focused files so changes land separately; (b) add tests so each change is safe — and/or extract tangled functions to lower cyclomatic complexity. Same churn, far less danger.
6. Because hotspots are about *current* risk. All-history counts include churn spikes from years ago that are no longer relevant, which can promote a file that's been quiet for ages. A recent window shows where trouble is concentrating *now*.

</details>

---

## Cheat Sheet

```
THE CORE IDEA
  churn      = how much a file CHANGES over time (commits touching it, or lines ±)
  complexity = how HARD a file is to understand (branches, nesting, length)
  HOTSPOT    = high churn  ×  high complexity   ← changed a lot AND hard = go here first

THE QUADRANTS (churn → across, complexity → up)
  top-left  : complex, untouched      = FOSSIL          → leave it alone
  top-right : complex, churned a lot   = HOTSPOT         → investigate FIRST
  btm-left  : simple, untouched        = CALM            → ignore
  btm-right : simple, churned a lot     = BUSY-BUT-SIMPLE → usually fine

RANK FILES BY CHANGE FREQUENCY (the one to memorize)
  git log --pretty=format: --name-only | sort | uniq -c | sort -rg | head -20
  # leftmost column = number of commits that touched the file

SCOPE TO RECENT RISK (preferred for hotspots)
  git log --since="6 months ago" --pretty=format: --name-only | sort | uniq -c | sort -rg | head -20

LINES CHURNED instead of commit count (finer-grained)
  git log --since="6 months ago" --numstat --pretty=format: \
    | awk 'NF==3 { c[$3]+=$1+$2 } END { for (f in c) print c[f], f }' \
    | sort -rg | head -20

WHAT TO DO WITH A HOTSPOT
  1. open it and read it      (the metric points; your eyes confirm)
  2. ask WHY it churns        (natural center? dumping ground? no tests?)
  3. reduce COMPLEXITY        (split / extract / test — you can't stop the churn)
  4. re-run later             (churn is a trend — watch it fall)

REMEMBER
  hotspot = FLASHLIGHT, not a grade. Never optimize the number directly — it gets gamed.
```

---

## Summary

- **Churn** measures *change over time* — how many commits touch a file (change frequency) or how many lines it gains and loses. It's the one quality signal you get for free and retroactively, because git recorded it with every commit.
- **Churn predicts defects** because change is where bugs are introduced, high churn signals an unsettled design, and busy files are where developers collide. The files that change most are where bugs and effort concentrate — a finding backed by real research, not folklore.
- A **hotspot** is the lethal combination: **high churn × high complexity**. Neither is dangerous alone — a complex *fossil* nobody touches is fine; a busy-but-*simple* file is fine. It's hard *and* often-changed that marks the danger quadrant.
- **You find churn with plain git**: `git log --pretty=format: --name-only | sort | uniq -c | sort -rg | head -20` ranks files by how many commits touched them. Scope it with `--since` for *current* risk; use `--numstat` for lines.
- A hotspot is a **flashlight, not a grade**. It tells you *where to look first*; you investigate, reduce the *complexity* half (split, extract, test — you can't stop the churn), and re-run later to confirm the trend improved. Never optimize the number directly — it gets gamed.

You now have a history-aware lens to set beside the static ones. Complexity, coupling, and the rest photograph the code as it stands; churn plays the reel and shows you which files won't sit still. Put the two together and you have the most actionable list in all of code metrics: *the files most worth your attention, right now.*

---

## Further Reading

- *Your Code as a Crime Scene* — Adam Tornhill. The book that popularized treating version history as forensic evidence; the hotspot quadrant comes straight from here. Start with the early chapters.
- *Software Design X-Rays* — Adam Tornhill. The sequel: hotspots, change coupling, and reading history at scale. The senior-level treatment of this page.
- "Use of Relative Code Churn Measures to Predict System Defect Density" — Nagappan & Ball (Microsoft Research, 2005). The empirical paper showing churn predicts defects. Skim the abstract and conclusions.
- The [middle.md](middle.md) of this topic, which formalizes churn measures, introduces change/temporal coupling, and shows how to weight hotspots properly.

---

## Related Topics

- [01 — Cyclomatic & Cognitive Complexity](../01-cyclomatic-and-cognitive-complexity/junior.md) — the *other* axis of a hotspot; churn needs complexity to find the real danger.
- [03 — Coupling & Cohesion Metrics](../03-coupling-and-cohesion-metrics/junior.md) — *change coupling* (files that always change together) is the history-based cousin of static coupling.
- [middle.md](middle.md) · [senior.md](senior.md) — the deeper tiers: temporal coupling, knowledge maps, and hotspot weighting at scale.
- [Technical Debt Management](../../technical-debt-management/) — once hotspots tell you *where* the risk is, this is how you decide *what to pay down and when*.
