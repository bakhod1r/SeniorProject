# What Makes Docs Good — Middle Level

> **Roadmap:** [Documentation Quality](../README.md) → What Makes Docs Good
> *The junior page argued that "good docs" is a real, defensible property. This page turns that conviction into a tool: an explicit set of quality attributes you can put on a checklist, a review comment, or — later — a dashboard. "Good" stops being a feeling and becomes a list of things you can check.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [A Quality-Attribute Model for Docs](#a-quality-attribute-model-for-docs)
4. [The Diátaxis Lens — Quality Is Per-Genre](#the-diátaxis-lens--quality-is-per-genre)
5. [Subjective "Nice" vs Objective Signals](#subjective-nice-vs-objective-signals)
6. [Reviewing Docs Like Code](#reviewing-docs-like-code)
7. [Style Guides as the Consistency Mechanism](#style-guides-as-the-consistency-mechanism)
8. [Worked Example — Grading a Real-ish Reference Page](#worked-example--grading-a-real-ish-reference-page)
9. [Mental Models](#mental-models)
10. [Common Mistakes](#common-mistakes)
11. [Test Yourself](#test-yourself)
12. [Cheat Sheet](#cheat-sheet)
13. [Summary](#summary)
14. [Further Reading](#further-reading)
15. [Related Topics](#related-topics)

---

## Introduction

> Focus: **What are the *checkable* properties of a good doc, and how do I review for them?**

At the junior level you learned that "good docs" is not a matter of taste — that there are real failure modes (a snippet that doesn't run, a tutorial that assumes knowledge it never gave you) that any competent reader would call defects. That's the right instinct, but it's still too coarse to *act* on. "This doc is bad" is not a review comment anyone can fix. "The first code example doesn't compile, and the page never states which version it's written for" is.

This page decomposes the vague whole — "good" — into a small set of named **quality attributes**, each defined so concretely that you could review for it, or measure it, or write a CI check against it. Then it does two things the junior page couldn't. First, it shows that the *same* attribute has different pass criteria for different *kinds* of doc — a reference and a tutorial fail in opposite ways — using the **Diátaxis** framework as the lens. Second, it operationalizes all of this into a **docs review checklist** you can drop into a pull request, so that documentation gets the same scrutiny as the code it ships beside.

Crucially, this is the *judging* half of documentation, not the *writing* half. How to actually write a clear reference entry or structure a runbook lives in **[Code Craft → Documentation](../../../code-craft/documentation/)**. Here we assume the doc exists and ask the quality-engineering question: *is it any good, and how would you prove it to a skeptic?*

---

## Prerequisites

- **Required:** You've read [junior.md](junior.md) and accept that doc quality is a real, non-arbitrary property.
- **Required:** You've reviewed a pull request — you know what a review comment and an approval gate are.
- **Helpful:** Passing familiarity with the four Diátaxis modes (tutorial, how-to, reference, explanation). If not, skim the [Diátaxis section in Code Craft](../../../code-craft/documentation/) first; this page uses it but does not re-teach it.
- **Helpful:** You've been burned at least once by a doc that was confidently, fluently *wrong*.

---

## A Quality-Attribute Model for Docs

The move that makes doc quality tractable is the same one that makes *software* quality tractable: stop talking about "good" as a monolith and decompose it into **quality attributes** — named, independently-assessable properties, each with its own definition and its own way of failing. Software has them (correctness, performance, security, maintainability); docs have them too. Here is a working set of eight. The discipline is that each one is phrased as *something you could put on a checklist or eventually measure* — not an adjective.

| Attribute | Plain question | How you'd check it (review) | Future signal (measure) |
|---|---|---|---|
| **Accuracy** | Is every claim *true of the current system*? | Run the examples; cross-check against code/behavior | Executable doctests pass in CI ([02](../02-testable-and-executable-docs/middle.md)) |
| **Completeness** | Is everything a reader needs *here*, with no silent gaps? | Walk the task end-to-end; look for "and then magic happens" steps | API/docstring coverage % ([04](../04-docs-coverage-and-gaps/middle.md)) |
| **Consistency** | Do terms, formatting, and tone match the rest of the docs? | One concept = one name; check heading/code conventions | Style-linter (Vale) violation count |
| **Findability** | Can the reader who needs this *locate* it? | Is it linked from where the need arises? Does search surface it? | Search-success rate, zero-result queries ([06](../06-measuring-docs-roi/middle.md)) |
| **Clarity / Readability** | Can the intended reader understand it on first pass? | Read aloud; flag unexplained jargon and 40-word sentences | Readability scores, *as a smell only* ([05](../05-readability-and-information-architecture/middle.md)) |
| **Currency** | Does it reflect the system *as of now*, not six releases ago? | Check last-reviewed date; diff against recent code changes | Staleness age, rot metrics ([03](../03-freshness-and-rot-metrics/middle.md)) |
| **Audience-fit** | Is it pitched at *who will actually read it*? | Is the assumed background stated and consistent? | (Mostly review-only; proxied by task success) |
| **Actionability** | Can the reader *do something* with it? | Is there a concrete next step / runnable command / clear decision? | Time-to-first-success ([06](../06-measuring-docs-roi/middle.md)) |

Two properties of this model matter more than the exact list.

**The attributes are independent — a doc can ace one and fail another.** A page can be beautifully *written* (clarity: A) and completely *wrong* (accuracy: F). It can be *accurate* and *complete* but unlinked from anywhere a reader would start, so nobody ever finds it (findability: F) — making its other virtues worthless. Treating "good" as one number hides exactly these trade-offs. A reviewer who only feels "this reads nicely" will wave through a fluent, confidently-wrong page; a reviewer with the attribute list checks *each axis* and catches the accuracy failure the prose was hiding.

**They split cleanly into review-time and measure-time.** Some attributes (audience-fit, actionability) are best judged by a human reading with intent — they resist automation. Others (accuracy via executable examples, currency via staleness age, consistency via a linter) can be turned into automated signals, which is what the rest of this roadmap is about. The "Future signal" column is a set of forward references: each is a later topic that takes one human-judged attribute and makes it a number a machine can watch.

> **Key insight:** "Good docs" is not one property — it's a *vector* of independent attributes, each with its own failure mode and its own check. The entire value of the model is that it lets you say *which axis* failed. A review comment that names the attribute ("accuracy: this flag was removed in v3") is actionable; "this feels off" is not.

---

## The Diátaxis Lens — Quality Is Per-Genre

Here is the trap the attribute table alone walks you into: it implies every doc should max out every attribute. It shouldn't — because **a document's quality is judged against the job its genre is supposed to do**, and the four genres have *different, partly opposing* jobs. This is the core insight of **Diátaxis** (Daniele Procida's framework), and it is the single most important idea on this page. The framework itself — how to *write* each mode — lives in [Code Craft → Documentation](../../../code-craft/documentation/); what concerns us here is using it as a *quality lens*: each mode has its own pass criteria, and applying the wrong criteria is itself a quality failure.

Diátaxis splits docs along two axes (study vs work; practical steps vs theoretical knowledge) into four modes. The pass criteria differ sharply:

| Mode | Serves | Passes when… | Fails when… (genre violation) |
|---|---|---|---|
| **Tutorial** | a *beginner learning by doing* | every step works verbatim; reader succeeds and feels capable; no unexplained leaps | it assumes prior knowledge; it explains theory mid-step; it offers choices ("you could also…") |
| **How-to guide** | a *competent user with a goal* | it gets the job done for a real task; it assumes baseline competence; it's a recipe | it teaches from scratch; it digresses into *why*; it's not goal-shaped |
| **Reference** | a *user looking something up* | it is accurate, exhaustive, consistent, and *boring*; structured for lookup, not reading | it's chatty; it's incomplete; it tries to *teach* or persuade |
| **Explanation** | a *reader who wants to understand* | it illuminates *why* — context, trade-offs, design rationale; it can be opinionated | it tries to be a step-by-step; it pretends to be exhaustive reference |

The payoff is a claim that sounds paradoxical until you internalize the framework: **a reference page that reads like a tutorial is a *bad reference*, even if the prose is excellent.** Friendly narration, "let's walk through this together," motivational asides — all virtues in a tutorial — are *defects* in a reference, because they bury the fact a user came to look up and slow the lookup down. Conversely, a tutorial that's terse and exhaustive like a reference is a *bad tutorial*: a beginner drowns. Quality is genre-relative.

This means a complete doc review has a step *before* the attribute checklist: **identify the genre, then judge against that genre's criteria.** Half of all "this doc is confusing" complaints are really genre confusion — a single page trying to be a tutorial *and* a reference *and* an explanation at once, succeeding at none. The first question of a docs review is not "is this good?" but "*what is this trying to be*, and is it allowed to be only that?"

> **Key insight:** There is no genre-free standard of doc quality. The right question is "good *as what*?" A reference and a tutorial fail in opposite directions — the reference by being chatty, the tutorial by being terse. Applying tutorial criteria to a reference (or vice versa) is the reviewer's mistake, not the writer's.

---

## Subjective "Nice" vs Objective Signals

A recurring failure of doc review is stopping at "this reads nicely." Pleasant prose is real, but it's the *weakest* and most easily-faked signal of quality — fluent text can be wrong, stale, unfindable, or aimed at the wrong reader, and "nice" catches none of that. The attribute model exists precisely to push past the vibe to checkable properties. It helps to sort signals by how objective they are:

- **Subjective (a human's impression):** "reads well," "feels thorough," "seems clear." Useful as a *starting* smell, useless as evidence. Two reviewers disagree; neither can defend a score.
- **Semi-objective (a human applying an explicit rubric):** "the audience is stated, the first example runs, every step is reachable from the previous one." This is what a *good checklist* converts impressions into — still human-judged, but now reproducible and arguable against specific criteria.
- **Objective (a machine measures it):** doctests pass / fail; 18% of public symbols are undocumented; this page hasn't been reviewed in 14 months; Vale reports 23 style violations; search returns zero results for "rate limit." These don't need a person and don't drift with mood.

The arc of this entire roadmap is **moving attributes leftward to rightward** — turning a human's "feels stale" into a measured *staleness age* ([03](../03-freshness-and-rot-metrics/middle.md)), a human's "is this even documented?" into a *coverage percentage* ([04](../04-docs-coverage-and-gaps/middle.md)), a human's "did this doc help anyone?" into *ticket deflection* and *time-to-first-success* ([06](../06-measuring-docs-roi/middle.md)). Two cautions travel with that arc, both developed later: not every attribute *can* be made objective (audience-fit largely resists it), and every objective metric is *gameable* the moment it becomes a target — 90% docstring coverage is as hollow as 90% test coverage if the docstrings just restate the function name. Objective signals are leverage, not truth. They tell you *where to look*; a human still decides if it's actually good.

> **Key insight:** "Nice" is the weakest evidence of quality and the easiest to fake. The maturity ladder runs *subjective impression → explicit rubric → automated metric* — but metrics are leverage, not truth, and a metric that becomes a target stops measuring quality.

---

## Reviewing Docs Like Code

The practical discipline that ties this together: **docs that ship with code get reviewed like code.** If your docs live in the repo (docs-as-code — see [Code Craft → Documentation](../../../code-craft/documentation/)), then a docs change *is* a pull request, and the same review that guards code quality should guard doc quality — in the *same* PR, by [Code Review](../../code-review/). Two anti-patterns to kill: rubber-stamping doc diffs ("it's just docs, LGTM") and reviewing docs in a separate, lower-stakes process that everyone skips. A wrong doc is a latent bug with a slow fuse; it deserves a real review.

What separates a docs review from a vibe check is a **checklist** — the artifact that converts the attribute model into something a reviewer actually runs. A usable one:

```markdown
## Docs Review Checklist

### Genre (ask first)
- [ ] It's clear which Diátaxis mode this is (tutorial / how-to / reference / explanation).
- [ ] It does ONE job — not secretly three genres in one page.

### Accuracy  (the non-negotiable)
- [ ] Every code example runs *as written* — I ran it, or CI does ([02]).
- [ ] Commands, flags, paths, and outputs match the current system.
- [ ] No claims contradicted by the code in this same PR.

### Audience-fit & Completeness
- [ ] The intended reader and assumed prior knowledge are clear (and consistent).
- [ ] The task can be completed end-to-end with no unstated "magic" steps.
- [ ] Prerequisites and required versions are stated.

### Findability
- [ ] It's linked from where a reader's need actually arises (not orphaned).
- [ ] Title and headings contain the words a reader would search for.

### Clarity & Consistency
- [ ] Terms are used consistently — one concept, one name.
- [ ] Formatting / heading / code-block conventions match the rest of the docs.
- [ ] Sentences and paragraphs are scannable; no needless jargon.

### Actionability & Currency
- [ ] The reader leaves with a concrete next step or a clear decision.
- [ ] A last-reviewed / review-by date is present where the house style requires it.
```

Notice the checklist's structure: **genre first, accuracy first within the rest.** Genre comes first because every later judgment depends on it (you can't assess "too chatty" without knowing it's meant to be a reference). Accuracy comes first among the attributes because it's the one defect that makes all the others moot — a beautifully clear, perfectly findable, *wrong* doc is worse than no doc, because it costs the reader time *and* trust. A reviewer who internalizes only one rule should internalize: **does the example actually run?**

> **Key insight:** A docs review without a checklist degrades into "reads nice → LGTM." The checklist is what forces every attribute to get looked at, and its ordering encodes priority: confirm the genre, then confirm accuracy, before spending a single word on prose.

---

## Style Guides as the Consistency Mechanism

Of the eight attributes, **consistency** is special: it's the one most cheaply enforced by *machine* rather than by reviewer attention, and the mechanism is a **style guide** plus a linter. Consistency matters because inconsistency taxes every reader — if "log in," "login," and "sign in" all appear, the reader wastes cycles wondering whether they're three different things. A style guide makes the thousand small decisions *once* so neither writer nor reviewer re-litigates them per PR.

There are two layers, and you want both:

1. **An industry style guide as the base.** The **[Google Developer Documentation Style Guide](https://developers.google.com/style)** is the de-facto standard for technical docs — it rules on voice (second person, active, present tense), tone, capitalization, how to format code and UI elements, inclusive language, and how to write the hard genres (procedures, error messages). Adopting it wholesale means you inherit thousands of resolved decisions instead of arguing them. (Microsoft and the older Chicago/Apple guides are alternatives; pick one and commit.)

2. **A house style for what's local to you.** No external guide knows your product's vocabulary — your canonical term for a "workspace" vs "project" vs "org," your supported version-string format, your one blessed spelling of the product name. The house style is a short overlay: "we follow Google's guide *except* and *additionally*…"

The reason this belongs in a *quality* roadmap and not just a writing one is the third layer: **mechanical enforcement with [Vale](https://vale.sh/).** Vale is a prose linter — `eslint` for docs. You encode the style guide as rules (there are ready-made Vale packages for the Google and Microsoft guides) and run it in CI on every docs PR. It flags passive voice, banned words, your project's term inconsistencies, weasel words, and heading-case violations *automatically*, so human reviewers never spend attention on "you wrote 'login' but our standard is 'log in'" — and can spend it on accuracy and genre-fit, which no linter can judge. This is the recurring quality-engineering pattern: **automate the objective, consistent, boring checks so humans are freed for the subjective, contextual ones.** Vale is to consistency what doctests ([02](../02-testable-and-executable-docs/middle.md)) are to accuracy.

> **Key insight:** A style guide makes consistency a *settled decision* instead of a per-review debate, and a prose linter like Vale makes it a *machine* decision. Spend a human reviewer's scarce attention on the attributes a machine can't judge — accuracy, audience-fit, genre — not on comma style.

---

## Worked Example — Grading a Real-ish Reference Page

Apply the model. Here is a documentation entry for an API function. It is *fluently written* — and a bad reference. Grade it on the attributes.

> ### `retry()`
>
> Ever had a flaky network call drive you up the wall? We've all been there! The `retry` helper is here to save your day. 🎉 Just wrap your function and let `retry` work its magic — it'll keep trying until things go your way. Super handy for those pesky timeouts. You'll probably want to give it a couple of attempts; three is usually a good number, but feel free to experiment and see what feels right for your use case!

Run it through the lens.

**Genre check (first):** This is published under "API Reference." So it's judged as a **reference** — a thing users *look up* to find the exact signature and behavior. Hold that standard.

| Attribute | Grade | Why |
|---|---|---|
| **Genre-fit** | **F** | Reads like a chatty tutorial/marketing blurb. A reference must be lookup-optimized and *boring*; this is the textbook genre violation. |
| **Completeness** | **F** | No signature. No parameter list, no types, no defaults. No return value. No description of what counts as a failure, or what it does when retries are exhausted. Unusable for the job a reference exists to do. |
| **Accuracy** | **?** | Unverifiable — there's no concrete claim (no flag, no default value) precise enough to be true *or* false. "Confidently vague" dodges accuracy review entirely, which is its own red flag. |
| **Actionability** | **D** | "Three is usually a good number, but experiment" pushes the decision back onto the reader instead of stating the default and the contract. A reference resolves questions; this defers them. |
| **Audience-fit** | **F** | A competent engineer reaching for a reference wants the contract, not encouragement. The tone is aimed at no one who'd actually be on this page. |
| **Clarity (prose)** | **B** | The *sentences* are perfectly readable — which is exactly the trap. Fluent prose masquerading as quality. |
| **Consistency** | **C** | Casual voice and emoji almost certainly violate the house/Google style; Vale would flag it instantly. |

The verdict the model forces: **this page scores well on the one attribute amateurs check (clarity of prose) and fails every attribute that defines a good reference.** That's the whole reason for the vector model — a single "is it good?" gut-check sails right past this, because it *reads* fine.

Here is the same entry rewritten to *pass as a reference*:

> ### `retry(fn, opts?) → Promise<T>`
>
> Calls `fn` repeatedly until it resolves or the attempt budget is exhausted. Re-invokes `fn` only when it throws or rejects; a resolved value is returned immediately.
>
> | Parameter | Type | Default | Description |
> |---|---|---|---|
> | `fn` | `() => Promise<T>` | — | The operation to attempt. Called at least once. |
> | `opts.attempts` | `number` | `3` | Maximum total calls, including the first. Must be ≥ 1. |
> | `opts.delayMs` | `number` | `0` | Delay between attempts. |
>
> **Returns** the resolved value of `fn`. **Throws** the *last* error if all attempts fail.
>
> ```js
> const data = await retry(() => fetch(url).then(r => r.json()), { attempts: 5, delayMs: 200 });
> ```

Run the checklist again: genre-fit (it's lookup-shaped — A); completeness (signature, every param, types, defaults, return, throw behavior — A); accuracy (now *falsifiable*, and the example is runnable, so [02](../02-testable-and-executable-docs/middle.md) can verify it in CI); actionability (the default is *stated*, not deferred — A). Same function, same author talent — but graded against the *right genre's* criteria and built from the attributes, it's now a good reference. The "before" wasn't badly *written*; it was the wrong *thing*.

---

## Mental Models

- **"Good docs" is a vector, not a scalar.** Eight independent dials (accuracy, completeness, consistency, findability, clarity, currency, audience-fit, actionability), each able to fail on its own. The value of the model is that it lets you name *which dial* is at zero — and a named axis is a fixable review comment.

- **Quality is genre-relative — "good *as what*?"** A reference and a tutorial fail in opposite directions. The same chattiness that makes a tutorial welcoming makes a reference defective. Always fix the genre before grading.

- **Accuracy is the load-bearing attribute.** A wrong doc is worse than no doc: it costs time *and* trust. Every other virtue is moot if the example doesn't run. On any checklist, "does it run?" comes first.

- **Fluent prose is the weakest signal and the easiest fake.** A confidently-written, wrong, stale, orphaned page reads *great*. The attribute model exists to stop you from approving on vibes.

- **Automate the objective, reserve humans for the contextual.** Linters and doctests handle consistency and accuracy-of-examples mechanically. Spend the scarce human attention on audience-fit and genre — the things no tool can judge.

---

## Common Mistakes

1. **Grading a doc as a monolith.** "Is it good?" lets a fluent-but-wrong page through. Grade each attribute separately; the failure is almost always on an axis the gut-check ignored.

2. **Applying one genre's criteria to another.** Calling a terse reference "unfriendly," or a focused tutorial "incomplete," is the *reviewer's* error. Establish the Diátaxis mode first, then judge against *that* mode's pass criteria.

3. **Stopping at "reads nicely."** Prose quality is one attribute among eight, and the most easily faked. A review that ends there has checked the least load-bearing thing.

4. **Treating coverage/readability numbers as the goal.** 90% docstring coverage and a great Flesch score are *signals*, not quality — and both are gameable the instant they're targets ([04](../04-docs-coverage-and-gaps/middle.md), [05](../05-readability-and-information-architecture/middle.md)). Use them to find where to look, not to declare victory.

5. **Reviewing docs more leniently than code.** "It's just docs, LGTM" ships latent bugs with slow fuses. Docs in the repo go through the same [code review](../../code-review/) gate, with a checklist.

6. **Re-litigating style in every PR.** Arguing "login" vs "log in" by hand wastes the reviewer's best asset — attention. Settle it once in a style guide and let [Vale](https://vale.sh/) enforce it in CI.

7. **Confusing "documented" with "good."** A symbol can have a docstring that adds nothing (`// gets the user` on `getUser()`). Presence is not quality; the attributes are what make it good.

---

## Test Yourself

1. Name the eight doc quality attributes and give a one-line *check* for each — something a reviewer could actually do or a tool could measure.
2. Why can a doc score A on clarity and F on accuracy at the same time? What does that prove about treating "good" as one number?
3. A page in the "API Reference" section is warm, narrative, and motivational. The prose is excellent. Is it a good doc? Defend your answer using Diátaxis.
4. Put these signals in order from weakest to strongest evidence of quality: "the doctest passes in CI," "it reads nicely," "the audience and prerequisites are stated." Name the category of each.
5. What are the *first two* questions on a docs review checklist, and why are they in that order?
6. Your team keeps arguing about terminology and tone in doc PRs. What two-layer mechanism settles it, and what tool enforces it automatically?

<details>
<summary>Answers</summary>

1. **Accuracy** — run the examples / cross-check against code. **Completeness** — walk the task for unstated steps. **Consistency** — one concept one name; run Vale. **Findability** — is it linked from where the need arises / does search surface it. **Clarity** — read aloud for jargon and overlong sentences (and *only as a smell*, a readability score). **Currency** — check the last-reviewed date / diff against recent code. **Audience-fit** — is the assumed background stated and consistent. **Actionability** — does the reader leave with a concrete next step or decision.
2. The attributes are *independent*. Prose can be flawless while every claim is false (the flag was removed, the default changed). It proves a single "good?" score hides which axis failed — and that the axis amateurs check (prose) is the one most easily faked.
3. **No — it's a bad reference**, despite the prose. A reference's job is fast, exhaustive lookup; warmth and narrative are *defects* there because they bury the fact a user came to find. Quality is genre-relative: the same chattiness would be a virtue in a tutorial.
4. Weakest → strongest: **"reads nicely"** (subjective impression) < **"audience and prerequisites are stated"** (semi-objective: a human applying an explicit rubric) < **"the doctest passes in CI"** (objective: a machine measures it). The whole roadmap is about moving leftward signals rightward.
5. (1) **What Diátaxis genre is this?** (2) **Does it do only that one genre?** They come first because every later judgment depends on the genre — you can't call something "too chatty" without first knowing it's meant to be a reference.
6. A **base industry style guide** (e.g., the Google Developer Documentation Style Guide) plus a short **house style** overlay for your own vocabulary; enforced automatically in CI by **Vale**, a prose linter, so humans never spend review attention on settled style.

</details>

---

## Cheat Sheet

```
THE EIGHT DOC QUALITY ATTRIBUTES  (good = a vector, not a scalar)
  Accuracy        every claim true of the CURRENT system   → run the examples
  Completeness    no silent gaps; task works end-to-end     → walk it through
  Consistency     one concept one name; uniform formatting  → Vale lints it
  Findability     reachable from where the need arises      → links + search
  Clarity         intended reader gets it first pass        → read aloud
  Currency        reflects the system AS OF NOW             → last-reviewed date
  Audience-fit    pitched at who actually reads it          → background stated?
  Actionability   reader leaves able to DO something        → concrete next step

  → Accuracy is load-bearing: a wrong doc is worse than no doc.

DIÁTAXIS QUALITY LENS  (judge "good AS WHAT?")
  Tutorial    learn-by-doing  → fails if it assumes knowledge / explains theory
  How-to      goal recipe     → fails if it teaches from scratch / digresses
  Reference   look it up       → fails if it's chatty / incomplete (← common!)
  Explanation understand why   → fails if it pretends to be steps/reference
  Rule: a reference that reads like a tutorial is BAD, however nice the prose.

SIGNAL STRENGTH  (weak → strong; the roadmap moves left → right)
  "reads nicely" (subjective) < explicit rubric (semi) < CI metric (objective)
  But: every metric is gameable once it's a target. Signals locate; humans judge.

DOCS REVIEW  (in this order)
  1. Genre?   2. One genre only?   3. Does the example RUN?   4. ...attributes
  Docs in the repo → same review gate as code, with a checklist.

CONSISTENCY MECHANISM
  Google dev-docs style guide (base) + house style (your vocabulary) + Vale (CI)
  Automate the objective/boring; reserve humans for accuracy, audience, genre.
```

---

## Summary

- "Good docs" decomposes into eight **independent quality attributes** — accuracy, completeness, consistency, findability, clarity, currency, audience-fit, actionability — each defined as something a reviewer can check or a tool can later measure. The value of the model is that it lets you name *which axis* failed, turning "this feels off" into an actionable comment.
- The attributes are **independent**: a doc can be beautifully written and completely wrong, or accurate but unfindable. **Accuracy is load-bearing** — a wrong doc costs time *and* trust, so "does the example run?" leads every checklist.
- Doc quality is **genre-relative**. The **Diátaxis** modes — tutorial, how-to, reference, explanation — have different, partly opposing pass criteria; a reference that reads like a tutorial is a *bad reference* however good the prose. A review's *first* question is "good *as what*?" The framework itself lives in [Code Craft → Documentation](../../../code-craft/documentation/); here it's a quality *lens*.
- Signals run from **subjective impression → explicit rubric → automated metric**. Later topics push attributes rightward (rot, coverage, readability, ROI), but metrics are **leverage, not truth** — and gameable the moment they're targets.
- Docs that ship with code get **reviewed like code**, in the same PR, via [Code Review](../../code-review/), against a **checklist** ordered genre-first, accuracy-first.
- **Consistency** is enforced cheapest by machine: a base **style guide** (Google's), a short **house style**, and **Vale** in CI — freeing scarce human attention for the attributes no tool can judge.

---

## Further Reading

- **Diátaxis** — [diataxis.fr](https://diataxis.fr/). Read it as a quality lens: the four modes and their distinct purposes are *the* tool for "good as what?"
- **Google Developer Documentation Style Guide** — [developers.google.com/style](https://developers.google.com/style). The de-facto base style guide; skim "Highlights" and "Voice and tone."
- **Vale** — [vale.sh](https://vale.sh/). The prose linter; note the ready-made Google/Microsoft style packages that turn a guide into CI rules.
- *Docs for Developers* (Bhatti, Corleissen, Lambourne, Nunez & Waters) — the chapter on reviewing and measuring docs maps directly onto the attribute model here.
- *Every Page Is Page One* (Mark Baker) — why findability and standalone context matter as much as the prose on the page.

---

## Related Topics

- [junior.md](junior.md) — why "good docs" is a real, defensible property and not a matter of taste.
- [senior.md](senior.md) — defending these attributes at scale: quality gates, doc SLAs, and the politics of measuring docs.
- [03 — Freshness & Rot Metrics](../03-freshness-and-rot-metrics/middle.md) — turning the *currency* attribute into a measured staleness signal.
- [05 — Readability & Information Architecture](../05-readability-and-information-architecture/middle.md) — turning *clarity* and *findability* into scores and structure (and their limits).
- [Code Craft → Documentation](../../../code-craft/documentation/) — the writing-craft sibling: *how* to write each Diátaxis genre, which this page judges but does not teach.
- [Code Review](../../code-review/) — the review gate and checklist discipline that docs ride on when they live in the repo.
