# Freshness & Rot Metrics — Senior Level

> **Roadmap:** [Documentation Quality](../README.md) → Freshness & Rot Metrics
> *The middle page gave you the detectors — link checkers, snippet compilers, staleness ages. This page is about the physics underneath them: why a doc rots at all, why the only true cure is to stop maintaining a second copy of the truth, and how to model rot as a decay process you can pin to the churn of the code each doc describes.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Why Docs Rot — The Copy Problem](#why-docs-rot--the-copy-problem)
4. [The Coupling Spectrum — From Can't-Rot to Angry-User](#the-coupling-spectrum--from-cant-rot-to-angry-user)
5. [Rot as Staleness Modeling — Decay Functions](#rot-as-staleness-modeling--decay-functions)
6. [Churn-Coupling — Pinning Freshness to the Code](#churn-coupling--pinning-freshness-to-the-code)
7. [Proximity and Transclusion — Making Desync Impossible](#proximity-and-transclusion--making-desync-impossible)
8. [Ownership at Scale — SLAs, Escalation, and the Doc Graveyard](#ownership-at-scale--slas-escalation-and-the-doc-graveyard)
9. [Measuring the Rot Backlog and the Rot Rate](#measuring-the-rot-backlog-and-the-rot-rate)
10. [Trust Dynamics — Rot Is Contagious](#trust-dynamics--rot-is-contagious)
11. [Mental Models](#mental-models)
12. [Common Mistakes](#common-mistakes)
13. [Test Yourself](#test-yourself)
14. [Cheat Sheet](#cheat-sheet)
15. [Summary](#summary)
16. [Further Reading](#further-reading)
17. [Related Topics](#related-topics)

---

## Introduction

> Focus: **The deep mechanisms for keeping docs provably in sync, and the theory of rot — why it happens, how fast, and which interventions actually stop it versus merely notice it.**

By the middle level you can stand up the detectors: a link checker in CI, a job that recompiles every code block, a "last reviewed" badge that turns red after ninety days. Those catch rot. They are necessary, and they are also a confession — every one of them exists because the doc is allowed to drift in the first place, and you have resorted to *watching* it drift.

The senior jump is to stop treating rot as a maintenance chore and start treating it as a property of an *architecture*. Rot is not random decay; it is the predictable consequence of storing the same knowledge in two places — the code and the prose — and then editing only one of them. Once you see docs as a *copy* of knowledge that also lives in the artifact, the whole field reorganizes: there is exactly one cure (eliminate the copy by generating from the artifact), and everything else is detection-after-the-fact, ranked by how fast it catches the drift. This page is that reorganization, plus the quantitative tools — decay functions, churn-coupling, rot-rate trends — that let you spend finite review effort where rot is actually happening.

---

## Prerequisites

- **Required:** You've internalized [middle.md](middle.md) — staleness age, review-by dates, link checking, snippet compilation, doc-vs-code divergence as concrete CI checks.
- **Required:** You've read [02 — Testable & Executable Docs](../02-testable-and-executable-docs/senior.md). The single-source-of-truth idea is developed there as a *technique*; here it is the *theory* that explains why everything else is second-best.
- **Helpful:** A working sense of code churn and hotspots — see [Code Quality Metrics](../../code-quality-metrics/). Churn is the independent variable that rot-rate depends on.
- **Helpful:** You've personally been burned by a doc that lied — and remember deciding never to trust that doc set again. That instinct is the subject of the final section, formalized.

---

## Why Docs Rot — The Copy Problem

Start from the root cause, because every technique on this page is an answer to it.

A document that describes how the system works contains knowledge. But that same knowledge also exists, authoritatively, somewhere else — in the source code, the schema, the config, the API definition. The doc is therefore a **copy**. And the fundamental law of copies is that *any copy of a mutable thing drifts from its original unless the two are mechanically coupled*. The code changes for a thousand reasons — a bug fix, a refactor, a renamed parameter — and each change updates the original. Nothing updates the copy unless a human remembers to, notices the relevance, has time, and cares. Multiply a low per-change probability of "remember to update the doc" across thousands of changes and drift is not a risk; it is a certainty with a half-life.

This reframes the entire problem. The question is never "how do we write docs that don't rot?" — prose that restates code *will* rot, full stop. The question is "how do we change the *relationship* between the doc and the code so that drift is either impossible or caught fast?" Three structural facts fall out:

- **Rot is a function of two variables, not one.** It depends on how fast the original changes (code churn) and how tightly the copy is coupled to it. A doc beside frozen code can be hand-maintained forever; a doc beside a hotspot rots almost as fast as you write it. You cannot reason about a doc's freshness without knowing the churn of what it describes — which is the entire argument of the [churn-coupling](#churn-coupling--pinning-freshness-to-the-code) section.
- **Detection is not prevention.** A link checker, a snippet compiler, a review-by date — these find rot that has *already happened*. They reduce the *duration* a reader is exposed to a stale doc; they do nothing to reduce the *rate* at which docs go stale. Confusing the two is the most common senior-level error in this space: teams add more detectors and wonder why the docs still feel rotten.
- **There is exactly one real cure, and it is structural.** Stop keeping a copy. If the doc is *generated from* the artifact, there is no second copy to drift — the doc is a *projection* of the truth, recomputed on every change. This is the single-source-of-truth solution developed in [topic 02](../02-testable-and-executable-docs/senior.md), and it is the only intervention that attacks the rate rather than the duration. Everything else on this page is what you do for the docs you *can't* generate.

> **Key insight:** Doc rot is not a writing problem or a discipline problem; it is a *duplication* problem. The prose duplicates knowledge that lives in the code, and duplicated knowledge diverges. This is the [DRY principle](../../../code-craft/design-principles/) applied across the code/doc boundary — and like all DRY violations, the fix is to have one source and derive the rest, not to diligently keep two copies in sync by hand.

---

## The Coupling Spectrum — From Can't-Rot to Angry-User

If rot is duplication plus drift, then the lever is **coupling strength**: how mechanically tied the doc is to the code it describes. Rank the available techniques by it and you get a spectrum that doubles as a decision framework — for any given doc, push it as far *up* this ladder as its nature allows.

| Coupling | Mechanism | When rot is caught | Residual rot |
|---|---|---|---|
| **Generated from code** | Doc is derived from the artifact (OpenAPI → reference, docstrings → API docs, types → schema) | Never happens — there is no copy | ~0 for what's generated; prose *around* it still rots |
| **Tested examples** | Snippets are real, executed code (doctests, Go examples, rustdoc tests) | In CI, the moment the code breaks the example | Behavior the example doesn't exercise |
| **Review-by dates** | Human re-verifies on a timer (TTL / freshness SLA) | On a clock — bounded staleness, not zero | Everything that rots faster than the TTL |
| **Nothing** | Prose maintained by goodwill and memory | When a user hits the lie and complains | Unbounded; discovered at the worst time |

Read the table as a ladder of *who or what notices the drift, and how fast*:

- **Generated-from-code can't rot** because there is no second copy. The OpenAPI reference *is* the spec rendered; the API docs *are* the docstrings extracted. Change the source and the doc changes in the same commit. This is the only rung where rot rate is genuinely zero — and the senior move is to expand the *fraction* of every doc that sits here. Even a hand-written tutorial can transclude a generated parameter table so the part most likely to drift can't.
- **Tested examples push detection into CI.** The example is not prose *about* the code; it *is* code that runs against the real system. When the API changes incompatibly, the example fails to compile or the assertion fails, and the build is red — rot caught in seconds, by a machine, before any reader sees it. This is one rung below generated because the *narrative* around the example can still drift, but the load-bearing, copy-pasteable part cannot lie.
- **Review-by dates catch rot on a timer.** When you can't generate or test a doc — an architecture overview, a conceptual explanation, an onboarding guide — you fall back to *bounded staleness*: a human re-verifies every N days. This never achieves zero rot; it caps the *age* of unverified claims. The whole art, covered next, is choosing N as a function of churn rather than a flat company-wide ninety days.
- **Nothing means the user is your monitoring.** With no coupling, the detector of last resort is a frustrated reader who tried the instructions and they didn't work. This is rot caught at maximum cost: late, by the person you most needed to help, and — per the [trust section](#trust-dynamics--rot-is-contagious) — at the price of their confidence in *every other doc you own*.

> **Key insight:** Every freshness technique is a choice about *who detects the drift and how fast*: the compiler at build time, CI at merge time, a human on a timer, or an angry user in production. Moving a doc up this ladder is the only way to reduce rot; everything below "generated" is a bet that you'll detect drift before a reader does, and the height of the rung is the odds of winning that bet.

---

## Rot as Staleness Modeling — Decay Functions

Here is the quantitative core. Treating every doc as equally fresh-or-stale is as crude as treating every line of code as equally risky. Docs decay, and they decay at *different rates*. Model it.

Think of a doc's **trustworthiness** as a value that starts at 1.0 the instant it is verified against reality and decays over time as the surrounding system changes underneath it. The shape of that decay — its **decay function** — is the thing to reason about:

- **Exponential decay** is the right default. Trust halves over some characteristic time — the doc's **half-life**. A doc with a 30-day half-life is ~50% likely to still be accurate after a month, ~25% after two, ~12% after three. Exponential because each independent change to the underlying system has some probability of invalidating the doc, and many small independent chances compound multiplicatively, not linearly.
- **The half-life is not a constant** — it is set by the churn of what the doc describes. A reference for a frozen, deprecated subsystem has a half-life of years. A "current architecture" page for a service three teams are actively rebuilding has a half-life of *weeks*. Same word — "documentation" — radically different decay constants. Pinning the right half-life per doc is the entire next section.
- **Step decay** models a different reality: some docs are perfectly accurate right up until one event (a major version bump, a re-platforming) instantly invalidates them. For these, time-based TTLs are the wrong instrument entirely — you want an *event* trigger (the release pipeline opens a "docs review" task), not a calendar.

The operational payoff is that **a freshness SLA is just a decay model made into policy**. If you've decided a doc's trust should not be allowed to fall below, say, 0.5 before re-verification, then the review interval is exactly its half-life. High-churn doc → short half-life → short review cycle. Low-churn doc → long half-life → long cycle. A single flat "review everything every 90 days" policy is a decay model that's catastrophically wrong for both ends: it lets your fastest-rotting docs sit stale for weeks past usefulness, while burning reviewer attention re-checking glacial reference pages that didn't need it. The flat policy is the metric-design failure of pretending one decay constant fits all content.

> **Key insight:** Freshness is not a binary (fresh/stale) and not a uniform clock; it is a *decay curve per doc*, whose half-life is dictated by the churn of the code it describes. The review interval that keeps a doc trustworthy is its half-life — so the right cadence is *computed per doc*, never a flat org-wide number. The most useful freshness metric is therefore not "% of docs reviewed in the last 90 days" but "% of docs whose review interval matches their decay rate."

---

## Churn-Coupling — Pinning Freshness to the Code

The previous section said half-life is set by churn. This one makes that mechanical, because it's where freshness metrics stop being hand-wavy and start being *derived* from data you already have.

You already measure code churn and hotspots — the files that change most often, the [hotspots](../../code-quality-metrics/) where change frequency and complexity intersect. That signal is the missing input to freshness. The doc that describes a hotspot is, by definition, describing code that changes constantly — so it has a short half-life and a high rot-risk, *whether or not anyone has noticed it's stale yet*. Proximity to a hotspot is a **leading indicator of rot**, available before any reader complains and before any link breaks.

Make the coupling concrete:

- **Map each doc to the code it describes** — by directory, module, ownership boundary, or an explicit `describes:` field in front-matter. This mapping is the join key between the docs world and the code-metrics world; without it, freshness and churn live in separate universes.
- **Set the freshness SLA from the churn of the mapped code, not from a global default.** A doc mapped to a file with commits every other day gets a two-week review cadence; a doc mapped to code untouched in a year gets a yearly one. The SLA is *derived*, and it auto-adjusts: when a quiet module suddenly becomes a hotspot (a rewrite starts), its docs' review cadence should tighten automatically because the input churn rose.
- **Flag the danger zone — fresh-looking docs next to hotspots.** A doc reviewed "recently" but sitting beside code that's been hammered *since* that review is high rot-risk masquerading as fresh. The most valuable single query in a doc-freshness system is: *which docs describe code that changed substantially after the doc's last verification?* That set is your real rot front line — not the docs with old timestamps, but the docs whose underlying code moved out from under them.

The deeper point is that **churn-coupling turns freshness from a lagging metric into a leading one.** Staleness age (days since review) is lagging — it tells you a doc *might* be stale because time passed. Churn-since-review is leading — it tells you a doc *is* probably stale because the thing it describes demonstrably changed. The first is a smoke alarm; the second is a thermal camera pointed at where the fire actually is.

> **Key insight:** A doc's rot-risk is the churn of the code it describes, integrated since its last verification — not the wall-clock age of the doc. Cross-link your doc inventory to your churn/hotspot data and freshness becomes *predictive*: you can point at the docs that are stale right now even though their timestamps look fine, because their code moved and they didn't.

---

## Proximity and Transclusion — Making Desync Impossible

If generation is the cure and churn-coupling is the diagnosis, **proximity and transclusion** are the structural tactics that move a doc up the coupling ladder without rewriting your whole pipeline.

**Docs-near-code** is the simplest, highest-leverage move: put the doc physically next to the code it describes — in the same repository, ideally the same directory, reviewed in the same pull request. This doesn't *prevent* drift mechanically, but it collapses the distance between the change and the doc to nearly zero. The engineer renaming the function sees the doc in the same diff; the reviewer who'd reject an undocumented API change can enforce the doc change in the same review. Distance is the enemy of freshness — a doc in a separate wiki, owned by a separate team, on a separate release cadence, is structurally guaranteed to lag, because the person making the change never even sees it. Co-location is the cheapest way to raise the *probability* that the copy gets updated when the original does.

**Transclusion** is the stronger move: instead of *copying* a snippet of source into a doc, *embed it by reference* so the doc renders the real, current file at build time. The doc contains a pointer — "include lines 10–25 of `client.go`" or "include the example function `ExampleClient_Get`" — and the rendering pipeline pulls the live content. Now an edit to the source *cannot* desync the doc, because the doc has no independent copy to fall out of date; it's a view onto the original.

```text
COPY (rots):                          TRANSCLUDE (can't desync):
  doc.md contains a literal            doc.md contains a reference:
  paste of client.go lines 10–25  →      {{ include "client.go" lines=10-25 }}
  source edited → doc now stale        source edited → doc re-renders with new content
```

Most static-site doc tools support some form of this — snippet includes, region markers (`// docs:start:auth` … `// docs:end:auth` in the source, referenced by name so line-number drift doesn't break it), or literate inclusion of tested example functions. The named-region form is strictly better than line ranges, which themselves rot the instant someone inserts a line above the range.

Transclusion is the bridge between the top two rungs of the ladder: it lets a *human-written* document (a tutorial, a guide) contain *generated-or-tested* fragments. The narrative stays prose; the load-bearing snippets become projections of real code. You get to keep the explanatory voice while removing the most rot-prone part — the literal code paste — from the set of things that can lie.

> **Key insight:** A copied snippet is a future lie with a timestamp; a transcluded snippet is a view that can't desync. Whenever a doc must contain code, embed it by reference (preferably to a *named region* of a *tested* file), not by paste — that single discipline removes the highest-frequency rot from documentation, because code snippets drift faster than any prose around them.

---

## Ownership at Scale — SLAs, Escalation, and the Doc Graveyard

Decay models and churn-coupling tell you *which* docs need attention and *how often*. None of it matters if no human is accountable for acting on the signal. At scale — thousands of pages, hundreds of authors — freshness is an **ownership and lifecycle** problem.

**Owner + freshness SLA per doc.** Every doc carries, in machine-readable front-matter, two facts: who owns it and how fresh it must be. The owner is a *team or rotation*, never an individual — individuals leave, and an orphaned doc is the seed of the graveyard. The SLA is the review interval, ideally derived from churn per the earlier section rather than typed by hand.

```yaml
---
owner: team-payments              # a team, never a person — people leave
describes: services/billing/      # the join key to churn/hotspot data
review_interval: 30d              # derived from churn of describes:, not a flat default
last_reviewed: 2026-05-02
---
```

**Automated escalation.** The SLA is inert without enforcement. A scheduled job computes, for every doc, `now - last_reviewed` against `review_interval`, and when a doc goes past due it *escalates on a ladder*, not with a single ignorable email: first a gentle nudge to the owning team's channel; then a tracked ticket in their backlog; then, if it stays unaddressed, the doc is automatically banner-flagged **"⚠ possibly stale — last verified N days ago"** to readers, and finally queued for the graveyard process below. The escalation must reach *readers*, not just owners — a visible staleness banner is honest, protects trust (the next section), and creates social pressure to fix what an unread ticket never will.

**The doc graveyard** is the accumulation of orphaned, abandoned, no-longer-true pages that no owner defends and no process ever retires. It is worse than missing documentation: a missing doc sends the reader to ask a human; a *wrong* doc sends them confidently in the wrong direction and — per the next section — poisons trust in the whole set. Garbage-collecting the graveyard is real lifecycle engineering, with three terminal states for any orphaned page:

- **Adopt** — the doc is still valuable and someone should own it. Assign an owner, set an SLA, re-verify, return it to the living set. This is the right outcome for genuinely useful orphans, and the escalation ladder's purpose is to surface them while adoption is still cheap.
- **Archive** — the doc has historical or occasional value but is no longer current truth. Move it to a clearly-marked archive (read-only, banner: *"archived, not maintained, may be inaccurate"*), out of the default search index so it can't masquerade as current. Archiving preserves the artifact without letting it lie to someone who stumbles in via search.
- **Delete** — the doc is wrong, redundant, or worthless, and keeping it only risks misleading someone. Delete it. The instinct to hoard docs "just in case" is exactly how the graveyard grows; a confidently-wrong page has *negative* value, so removing it is a net improvement, not a loss.

The decision among the three turns on two questions: *does anyone read it* (pull search/analytics data — a page with zero reads in a year is a deletion or archive candidate) and *is it still true* (the freshness signal). Useful-and-true → keep/adopt; useful-but-historical → archive; unread-or-untrue → delete. Removing the index entry for stale content is itself a freshness intervention: a doc that can't be found can't mislead.

> **Key insight:** At scale, freshness is governed by *ownership lifecycle*, not by writing effort. Every doc needs a team owner and a churn-derived SLA; past-due docs must escalate on a ladder that ends with a reader-visible staleness banner; and orphaned pages must be actively garbage-collected — adopt, archive, or delete — because an unmaintained doc set doesn't stay neutral, it rots into a graveyard that costs more trust than it ever saved.

---

## Measuring the Rot Backlog and the Rot Rate

You can't manage what you don't trend. Two numbers matter, and the difference between them is the difference between firefighting and engineering.

**The rot backlog** is a *stock*: how many docs are currently stale right now — past their freshness SLA, or with broken links, or with snippets that no longer compile, or (the leading-indicator version) describing code that changed since their last review. It's the standing inventory of debt. Useful, but a stock alone is a snapshot; it tells you the size of the mess, not whether you're winning.

**The rot rate** is a *flow*: how fast docs are *going* stale versus how fast you're refreshing them — new-stale-per-week minus refreshed-per-week. This is the number that actually predicts the future:

- **Rate > 0** (docs going stale faster than you fix them): the backlog grows without bound. You are losing, and no amount of heroic doc-fixing sprints will win, because you're treating a flow problem with a one-time stock intervention. The fix has to attack the *rate* — push docs up the coupling ladder (generate, test, transclude) so fewer go stale per unit time.
- **Rate < 0** (refreshing faster than docs rot): the backlog shrinks; you're catching up, and you can forecast when it hits zero.
- **Rate ≈ 0 with a large backlog**: stable but bad — you've stopped the bleeding but the debt sits there. You need a backlog burn-down *on top of* the steady-state work.

This stock-versus-flow distinction is the single most important quantitative idea in freshness measurement, because it explains why teams "do a docs cleanup" every year and the docs are rotten again by the next — they keep paying down the *stock* while ignoring the *flow*. A doc-quality dashboard that shows only "342 stale docs" is nearly useless; the same dashboard showing "+18 going stale/week, −11 refreshed/week, net +7" tells you that you are *losing ground* and that the lever is structural coupling, not another cleanup sprint. Trend the rate, segment it by team and by churn-bucket, and you can see exactly where rot is generated — almost always the high-churn corners where docs are still coupled at the bottom of the ladder.

> **Key insight:** The rot *backlog* (a stock — how many docs are stale) tells you how big the mess is; the rot *rate* (a flow — net docs going stale per week) tells you whether you're winning. A positive rate means the backlog grows forever no matter how many cleanup sprints you run — the only fix is to raise coupling so fewer docs rot per unit time. Trend the rate, not just the count.

---

## Trust Dynamics — Rot Is Contagious

The final mechanism is human, and it is the one that makes rot disproportionately expensive: **rot is contagious to reader trust, and trust is the entire value of a doc set.**

A document's worth is not its accuracy in isolation — it's whether a reader *believes* it enough to act without independently verifying. The whole point of docs is to let people *not* read the source. That only works on trust. And trust has a brutally asymmetric dynamic: it is **earned slowly and destroyed instantly**, and — the contagious part — **destroyed across the whole set by a single betrayal.**

Trace the reputation model from one reader's experience:

- A reader follows the docs, the instructions are stale, and it costs them an hour. They don't conclude "*this page* is stale." They conclude "*the docs* are unreliable." The damage generalizes from the one page they hit to the entire corpus, because a reader has no way to know which other pages are also lying — so the only safe inference is to distrust all of them.
- A distrusting reader stops using the docs as a *source of truth* and starts using them as, at best, a hint to be verified against the code or a human. The instant a reader has to verify the doc against the source, the doc has failed at its one job — saving them that verification. A doc you can't trust without checking is strictly worse than no doc, because it cost effort to produce *and* read and saved nothing.
- That reader becomes a *negative* multiplier: "don't bother with the wiki, just ask in the channel / read the code." One burned senior engineer telling the team to ignore the docs can abandon a doc set faster than any amount of rot — the social signal does the rest, and the corpus dies even though most of it was fine.

The non-obvious operational consequences:

- **A confidently-wrong doc is worse than a missing one** — not rhetorically, but in expected value. Missing → reader asks a human, mild cost, no false belief. Wrong-but-trusted → reader acts on a falsehood, large cost, *plus* a unit of trust-damage that taxes every future read. This is the precise justification for the graveyard's *delete* option and for reader-visible staleness banners: removing or visibly flagging a lie protects the trust that funds the rest of the corpus.
- **Honesty about uncertainty is trust-preserving.** A banner that says *"last verified 200 days ago, may be stale"* keeps trust *because it didn't lie* — it told the reader exactly how much to believe it. Counterintuitively, visibly admitting a doc *might* be stale is better for the reputation of the whole set than silently presenting it as current, because the one thing that detonates trust is being confidently wrong, and a hedge is never confidently wrong.
- **This is the real ROI case for freshness investment.** The cost of rot is not the hour the one reader lost; it's the *compounding abandonment* of an asset the org spent enormous effort building. Freshness work is reputation protection, and reputation is the only thing that makes documentation worth writing at all — which is exactly the argument that carries into [Measuring Docs ROI](../06-measuring-docs-roi/) and the gap analysis of [Docs Coverage & Gaps](../04-docs-coverage-and-gaps/senior.md).

> **Key insight:** Trust is the entire value of a doc set — it's what lets readers *not* re-verify against the source — and it is earned slowly, destroyed instantly, and destroyed *across the whole corpus* by one burned reader. That asymmetry makes a confidently-wrong doc worse than a missing one and makes visible honesty about staleness *trust-preserving*. Freshness is not hygiene; it is reputation management, and reputation is the asset that justifies the entire investment.

---

## Mental Models

- **A doc is a copy of knowledge that lives in the code.** Every copy of a mutable thing drifts unless mechanically coupled. So rot is not a discipline failure — it is the default physics of duplication, and the only true cure is to stop keeping the copy: generate from the artifact. Everything else just shortens how long the lie survives.

- **The coupling ladder ranks *who catches the drift, and how fast*.** Generated (the compiler, never) → tested (CI, at merge) → review-by date (a human, on a timer) → nothing (an angry user, in production). Push every doc as high as its nature allows; the rung is your odds of catching rot before a reader does.

- **Freshness is a decay curve, not a binary.** Trust starts at 1.0 and decays — usually exponentially, with a half-life set by churn. The right review interval *is* the half-life, so cadence is computed per doc, never a flat org-wide ninety days.

- **Rot-risk is churn integrated since last verification, not wall-clock age.** Cross-link docs to hotspot data and freshness becomes a *leading* indicator: you can name the docs that are stale right now even though their timestamps look fine, because the code moved out from under them.

- **A copied snippet is a future lie; a transcluded one is a view that can't desync.** Whenever a doc must contain code, embed it by reference to a named region of a tested file — that removes the single highest-frequency source of rot.

- **Manage the rate, not just the backlog.** The backlog is a stock; the rot rate is a flow. A positive rate means no cleanup sprint can ever win — only raising coupling reduces the rate. Trend the flow.

- **Rot is contagious to trust, and trust is the whole point.** One burned reader abandons the entire corpus. A confidently-wrong doc is worse than a missing one; visible honesty about staleness preserves trust. Freshness is reputation management.

---

## Common Mistakes

1. **Treating detection as a cure.** Adding more link checkers and staleness badges reduces how *long* a doc lies, never how *fast* docs go stale. If the rot rate is positive, detectors alone guarantee a forever-growing backlog. The rate only falls when you raise coupling — generate, test, transclude.

2. **One flat review cadence for everything.** "Review all docs every 90 days" is a single decay constant pretended to fit a frozen reference page and a hotspot's architecture doc alike. It lets the fast-rotting docs sit stale for weeks and burns reviewer attention on docs that didn't need it. Derive the interval from churn.

3. **Measuring staleness by timestamp instead of by churn-since-review.** A doc reviewed "recently" beside code hammered since that review is high rot-risk wearing a fresh badge. Age is lagging; churn-since-verification is leading. Join the doc inventory to hotspot data.

4. **Pasting code into docs instead of transcluding it.** A literal snippet is the highest-frequency rot in any doc set — it drifts the moment the source changes and nothing tells you. Embed by reference to a named region of a *tested* file so the doc can't desync.

5. **Assigning docs to individuals.** Owners must be teams or rotations. An individual owner who leaves creates an orphan, and orphans are the seed crystal of the doc graveyard. Ownership is a standing responsibility, not a person.

6. **Hoarding stale docs "just in case."** A confidently-wrong, unread page has negative value — it misleads readers and taxes trust. Garbage-collect the graveyard: adopt, archive (out of the search index), or delete. Keeping a lie is not caution; it's a cost.

7. **Reporting the backlog without the rate.** "342 stale docs" tells you the mess size, not whether you're winning. Without "+18/−11 net +7 per week" you can't tell a stable-but-bad state from a losing one, and you'll keep running cleanup sprints against a flow problem.

8. **Ignoring the trust blast radius.** Treating one stale page as a one-page problem misses that a single burned reader distrusts — and tells others to distrust — the *whole* corpus. Freshness underfunding isn't a local hour lost; it's the compounding abandonment of the entire asset.

---

## Test Yourself

1. State the fundamental reason docs rot, and explain why it implies there is only *one* true cure rather than many.
2. Rank the coupling spectrum from least to most rot, and for each rung name *who or what* detects the drift and *when*.
3. Why is a single flat "review every 90 days" policy wrong, in decay-model terms? What should set the review interval instead?
4. A doc's last-reviewed timestamp is recent, yet it's high rot-risk. How is that possible, and what signal reveals it?
5. Distinguish copying a snippet from transcluding it. Why does transclusion make desync impossible, and why is a named region better than a line range?
6. You inherit 4,000 orphaned wiki pages. Name the three terminal states for each and the two questions that decide between them.
7. Your dashboard shows 342 stale docs and you run a cleanup sprint every year, yet the docs are always rotten. What metric are you missing, and what does it tell you to do differently?
8. Argue, in expected-value terms, why a confidently-wrong doc is worse than a missing one — and what that implies for staleness banners.

<details>
<summary>Answers</summary>

1. Docs rot because a doc is a **copy** of knowledge that also lives authoritatively in the code, and any copy of a mutable thing **drifts from its original unless mechanically coupled** — the code is edited constantly, the copy only when a human remembers. This implies one true cure because the only way to eliminate drift is to eliminate the copy: **generate the doc from the artifact** so it's a projection, not a duplicate. Every other technique (link checks, review dates) detects drift after it happens; it doesn't prevent it.

2. Least → most rot: **Generated from code** — never rots; the compiler/build catches any mismatch because there's no separate copy. **Tested examples** — rot caught by **CI at merge time**, the moment the code breaks the example. **Review-by dates** — caught by **a human on a timer**, capping staleness age but never reaching zero. **Nothing** — caught by **an angry user in production**, at maximum cost and trust damage.

3. In decay terms, a flat 90-day policy assumes **one half-life for all docs**, but half-life is set by the churn of the code each doc describes. A hotspot's architecture doc has a half-life of weeks (flat policy lets it rot well past usefulness); a frozen reference page has a half-life of years (flat policy wastes reviewer effort re-checking it). The interval should be set to **each doc's half-life**, derived from the churn of the code it's mapped to.

4. The timestamp is **lagging** — it only says time passed, not that anything changed. The doc can be recently reviewed yet high-risk because the **code it describes churned heavily *since* that review** — it moved out from under the doc. The revealing signal is **churn-since-last-verification**: join the doc (via a `describes:` mapping) to hotspot/churn data and flag docs whose underlying code changed substantially after `last_reviewed`.

5. **Copying** pastes a literal, independent duplicate of source into the doc — a second copy that drifts the instant the source changes. **Transcluding** embeds the source *by reference*, so the doc renders the live file at build time and has **no independent copy to fall out of date** — desync is structurally impossible. A **named region** (`// docs:start:auth`) beats a **line range** because line numbers shift the moment anyone inserts a line above the range, silently re-pointing the include; a named marker moves with the code.

6. Three terminal states: **Adopt** (still useful → assign a team owner + churn-derived SLA, re-verify, return to living set); **Archive** (historical value → move to a read-only, clearly-banner-marked archive *out of the default search index*); **Delete** (wrong/redundant/unread → remove it, since a confidently-wrong page has negative value). The two deciding questions: **does anyone read it** (search/analytics — zero reads in a year → archive/delete) and **is it still true** (the freshness signal).

7. You're missing the **rot rate** (a flow: net docs going stale per week = new-stale minus refreshed) and only watching the **backlog** (a stock). A yearly cleanup pays down the stock while the flow keeps running, so if the rate is positive the backlog refills by the next year. The fix is to **attack the rate** — push docs up the coupling ladder (generate/test/transclude) so fewer rot per week — not to run another stock-clearing sprint.

8. Expected value: a **missing** doc sends the reader to ask a human — mild cost, *no false belief*. A **confidently-wrong** doc makes the reader act on a falsehood — large cost — **plus** a unit of trust damage that taxes every future read of the whole corpus (rot is contagious to trust). So wrong-but-trusted has strictly worse expected value than missing. The implication: **delete or visibly banner** stale docs — a *"last verified N days ago, may be stale"* banner is trust-*preserving* because it never lies about how much to believe it, whereas silent staleness is exactly the confident-wrongness that detonates trust.

</details>

---

## Cheat Sheet

```
ROOT CAUSE
  doc = a COPY of knowledge that also lives in code
  any copy of a mutable thing drifts unless mechanically coupled
  → one cure: generate from the artifact (no copy = no drift)
  → everything else only shortens how long the lie survives

COUPLING LADDER  (who catches drift / when)  — push every doc UP
  generated from code   compiler / build   never rots
  tested examples       CI / at merge      rot caught in seconds
  review-by date        human / on timer   bounded staleness, not zero
  nothing               angry user / prod  unbounded, worst-time, trust hit

DECAY MODEL
  trust starts 1.0, decays exponentially; HALF-LIFE set by code churn
  review interval = half-life   → cadence is PER DOC, never flat 90d
  step decay (version bump) → use an EVENT trigger, not a calendar

CHURN-COUPLING  (freshness as a LEADING indicator)
  map each doc → code it describes (describes: front-matter)
  freshness SLA derived from churn of mapped code, not a global default
  red flag: doc reviewed "recently" but code churned SINCE → real rot front line
  rot-risk = churn integrated since last verification, NOT wall-clock age

PROXIMITY / TRANSCLUSION
  docs-near-code: same repo/dir/PR → change & doc in one diff
  transclude, don't paste: embed source by reference → can't desync
  named region (// docs:start:x) > line range (line ranges rot on insert)

OWNERSHIP AT SCALE
  front-matter: owner (TEAM, never person) + review_interval + last_reviewed
  escalate on a LADDER: nudge → ticket → reader-visible "⚠ stale" banner → GC
  graveyard GC: ADOPT (useful) / ARCHIVE (historical, de-index) / DELETE (wrong/unread)

METRICS
  backlog = STOCK (how many stale now)         → size of the mess
  rot RATE = FLOW (net going stale per week)    → are you winning?
  rate > 0 → backlog grows forever; no sprint wins → raise coupling
  trend the RATE, segment by team & churn-bucket

TRUST
  trust = the whole value (lets readers NOT re-verify)
  earned slowly, destroyed instantly, destroyed ACROSS the set by 1 reader
  confidently-wrong doc  <  missing doc   (false belief + trust tax)
  visible "may be stale" banner = trust-PRESERVING (never confidently wrong)
```

---

## Summary

- Docs rot because a doc is a **copy** of knowledge that also lives in the code, and any copy of a mutable thing drifts unless mechanically coupled. The only true cure is to eliminate the copy — **generate from the artifact** (the single-source-of-truth solution of [topic 02](../02-testable-and-executable-docs/senior.md)); everything else is detection-after-the-fact that shortens how long the lie survives, not how often docs lie.
- The **coupling ladder** ranks techniques by *who catches the drift and how fast*: generated (compiler, never) → tested (CI, at merge) → review-by date (human, on a timer) → nothing (angry user, in prod). Push every doc as high as its nature allows.
- Freshness is a **decay curve**, not a binary: trust decays exponentially with a **half-life set by code churn**, and the right review interval *is* that half-life — so cadence is computed per doc, never a flat org-wide number.
- **Churn-coupling** makes freshness a *leading* indicator: map each doc to the code it describes, derive its SLA from that code's churn, and flag fresh-looking docs whose code moved since review — rot-risk is *churn since verification*, not wall-clock age. ([Code Quality Metrics](../../code-quality-metrics/) supplies the churn/hotspot signal.)
- **Proximity** (docs-near-code, same PR) and **transclusion** (embed source by reference, not by paste) move docs up the ladder structurally — a transcluded named region can't desync, removing the highest-frequency rot.
- At scale, freshness is **ownership lifecycle**: team owners, churn-derived SLAs, escalation ending in reader-visible staleness banners, and active garbage-collection of the **doc graveyard** (adopt / archive / delete).
- Manage the rot **rate** (a flow), not just the **backlog** (a stock) — a positive rate means no cleanup sprint can ever win. And remember that **rot is contagious to trust**: one burned reader abandons the whole corpus, a confidently-wrong doc is worse than a missing one, and visible honesty about staleness is trust-preserving. Freshness is reputation management.

The next layer — [professional.md](professional.md) — operates all of this across an organization: rolling out churn-derived SLAs, building the doc-to-code mapping at scale, running the escalation and graveyard processes as standing programs, and defending the freshness budget to people who'd rather ship features.

---

## Further Reading

- *Docs for Developers* (Bhatti, Corleissen, Lambourne, Nunez & Waters) — the maintenance and freshness chapters: ownership, review cadence, and retiring docs.
- **Diátaxis** ([diataxis.fr](https://diataxis.fr/)) — Daniele Procida. Why different doc *types* rot differently (reference is generable; explanation must be hand-maintained) — the decay-rate-per-genre intuition.
- **Write the Docs** ([writethedocs.org](https://www.writethedocs.org/)) — community practice on docs-as-code, transclusion/snippet-include tooling, and doc lifecycle.
- *Working Effectively with Legacy Code* (Michael Feathers) — not about docs, but the churn/hotspot intuition behind which code (and therefore which docs) is highest-risk.
- The single-source-of-truth and generated-docs treatment in [02 — Testable & Executable Docs](../02-testable-and-executable-docs/senior.md) — the cure this page keeps pointing at.

---

## Related Topics

- [02 — Testable & Executable Docs](../02-testable-and-executable-docs/senior.md) — the single-source-of-truth cure (generate-from-artifact, tested examples) that this page's theory ranks as the only true fix for rot.
- [04 — Docs Coverage & Gaps](../04-docs-coverage-and-gaps/senior.md) — the complementary axis: freshness asks *are the docs you have still true?*, coverage asks *which docs are missing?* — both feed the same quality picture.
- [Code Quality Metrics](../../code-quality-metrics/) — churn and hotspots, the independent variable that sets each doc's decay rate and turns freshness into a leading indicator.
- [Code Craft → Documentation](../../../code-craft/documentation/) — the writing-craft sibling: *how* to write docs-as-code, fight rot, and structure the genres this page measures the freshness of.
