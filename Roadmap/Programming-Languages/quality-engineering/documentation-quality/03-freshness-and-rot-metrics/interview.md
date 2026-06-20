# Freshness & Rot Metrics — Interview Questions

> **Roadmap:** [Documentation Quality](../README.md) → Freshness & Rot Metrics
> *A docs-quality interview rarely asks "should docs be up to date." It asks "you've got a 5,000-page wiki nobody trusts — what do you actually do," and then watches whether you reach for a dashboard or for the root cause: that the doc is a hand-maintained copy of something that already exists in the code. This page is the question bank, with model answers and a note on what each question is really probing.*

---

## Table of Contents

1. [How to Use This Page](#how-to-use-this-page)
2. [Theme 1 — Doc Rot Basics](#theme-1--doc-rot-basics)
3. [Theme 2 — Freshness Signals and Metrics](#theme-2--freshness-signals-and-metrics)
4. [Theme 3 — Auto-Detecting Rot](#theme-3--auto-detecting-rot)
5. [Theme 4 — The Real Cure](#theme-4--the-real-cure)
6. [Theme 5 — Churn-Coupled Freshness](#theme-5--churn-coupled-freshness)
7. [Theme 6 — Scenario and Judgment](#theme-6--scenario-and-judgment)
8. [Theme 7 — Program and Ownership](#theme-7--program-and-ownership)
9. [Rapid-Fire Round](#rapid-fire-round)
10. [Red Flags and Green Flags](#red-flags-and-green-flags)
11. [Summary](#summary)
12. [Further Reading](#further-reading)
13. [Related Topics](#related-topics)

---

## How to Use This Page

Each question carries three things: **Q** (the prompt), **what the interviewer is really testing**, and **A** (a model answer at the depth a strong candidate gives). Don't memorize the answers — internalize the *distinctions* they keep returning to:

- **missing vs stale** (a gap you know about vs a lie you trust)
- **detection vs prevention** (catching rot after the fact vs making it structurally impossible)
- **freshness vs correctness** (recently touched vs actually true)
- **coupling strength** (how tightly a doc is bound to the thing it describes, from "generated from it" down to "a human promised to remember")

Nearly every question in this bank is one of those four distinctions wearing a costume. The candidates who do well are the ones who *name the distinction* before reaching for a metric or a tool — and who reach the conclusion that the durable fix is to stop maintaining a second copy of the truth, not to measure the copy's decay more precisely.

---

## Theme 1 — Doc Rot Basics

### Q1.1 — What is documentation rot, and why is it more dangerous than simply having no documentation?

> **Testing:** Whether you grasp the core asymmetry — that stale docs carry negative value, not just zero.

**A.** **Doc rot** is documentation that was once true and has silently diverged from the system it describes, because the system changed and the doc didn't. The danger is asymmetric. *Missing* documentation has roughly zero value: you know it's absent, so you go read the code, ask someone, or run the thing. *Stale* documentation has **negative** value: it reads as authoritative, you trust it, you act on it, and it's wrong. A reader who follows a stale runbook during an incident makes things worse with full confidence. So "no docs" costs you the time to find the truth elsewhere; "wrong docs" costs you that *plus* the cost of having been confidently misled. The whole field exists because stale is worse than missing.

### Q1.2 — Walk me through the "trust cost" of rot. Why does one bad page poison a whole wiki?

> **Testing:** Whether you understand rot as a *system-level trust* problem, not a per-page problem.

**A.** Trust in documentation is a single shared resource across the whole corpus, and it's destroyed faster than it's built. A reader can't tell, from looking at a page, whether it's current — pages don't wear their age on their face. So after being burned two or three times by stale pages, a rational reader stops trusting *all* pages, including the correct ones, and routes around the docs entirely ("just ask in Slack," "just read the source"). That's the trust cost: a small fraction of rotten pages drives the *effective* value of the entire corpus toward zero, because nobody can cheaply distinguish the good pages from the bad. This is why the goal isn't "100% of pages perfect" — it's *restoring the reader's ability to trust a page on sight*, which is a different and more tractable problem.

### Q1.3 — Someone says "we just need to write more docs." Why is that often the wrong instinct?

> **Testing:** Whether you see volume as a liability, not an asset, once maintenance enters the picture.

**A.** Because every page you write is a *liability you've signed up to maintain*, not a one-time asset. Documentation is the only artifact in engineering that decays purely through *other people's* changes — you can write a perfect page today and someone else's refactor next week makes it a lie, with no edit to the page itself. So adding pages without a plan to keep them true just enlarges the surface area that rots, accelerating the trust collapse. The mature instinct is the opposite: write *less*, keep *what you write* close to the thing it describes (ideally generated from it), and aggressively archive what you can't commit to maintaining. Volume is the enemy of trust.

### Q1.4 — Is rot a writing problem or an engineering problem?

> **Testing:** Whether you locate the cause structurally rather than blaming the authors.

**A.** It's an **engineering problem** wearing a writing costume. Rot isn't caused by bad writers; it's caused by *duplication* — the doc is a second, hand-maintained copy of a fact (an endpoint signature, a config key, a build step) that already lives authoritatively somewhere else, usually in code. The two copies drift because nothing forces them to stay in sync. Framing it as "people should remember to update the docs" guarantees failure, because relying on human memory across a large team is a control with a near-100% long-run failure rate. Framing it as "where is the source of truth and why do we have a copy of it" points at the actual fix. That structural lens — covered in [Theme 4](#theme-4--the-real-cure) — is what separates a senior answer from a junior one.

---

## Theme 2 — Freshness Signals and Metrics

### Q2.1 — You want a "freshness" metric for a docs corpus. What signals would you start with, and what does each actually tell you?

> **Testing:** Whether you can enumerate concrete, computable signals — and whether you know their limits.

**A.** I'd start with signals that are cheap to compute from data we already have:

- **Staleness age** — time since the page was last *meaningfully* edited, from `git log` on the file. Tells you "how long since a human touched this."
- **Review-by / next-review date** — an explicit expiry the author committed to (front-matter like `review_by: 2026-09-01`). Tells you "the owner promised this would be re-checked by date X."
- **Percent past review** — share of pages whose `review_by` has lapsed. A corpus-level health number.
- **Orphan rate** — pages with no inbound links and no traffic; nobody navigates to them.
- **Last-verified vs last-edited** — distinguishing "someone confirmed this is still true" from "someone fixed a typo."

The critical caveat I'd state up front: **every one of these measures activity, not truth.** A page edited yesterday can be wrong; a page untouched for two years (a stable CLI flag) can be perfectly correct. So these are *triage* signals — they tell you where to *look*, not what's *wrong*. I'd never report "freshness %" as if it were "correctness %."

### Q2.2 — Distinguish "last edited," "last reviewed," and "review-by." Why keep all three?

> **Testing:** The freshness-vs-correctness distinction, made precise.

**A.** They answer three different questions. **Last edited** (from git) is "when did the bytes change" — but a typo fix bumps it without verifying anything, so on its own it *overstates* freshness. **Last reviewed** is "when did a human last confirm this is still true," which is the signal that actually correlates with correctness — but it requires a deliberate act, so it's only as good as the discipline behind it. **Review-by** is the *forward* commitment: the date by which the owner has promised to re-verify, which is what lets you compute "past due" *before* anyone notices the page is wrong. Keeping all three lets you separate cosmetic activity from real verification, and lets the metric be *predictive* (past-due) rather than purely *reactive* (someone reported it's wrong). One date can't carry all three meanings.

### Q2.3 — How do you compute staleness age, and what's the trap in "last commit touched this file"?

> **Testing:** Whether you've actually thought about the git mechanics, not just the concept.

**A.** The naive version is `git log -1 --format=%cs -- path/to/doc.md` — the date of the last commit touching that file. The trap is that this is *noisy in both directions*. It **overcounts** freshness when the last commit was a bulk reformat, a license-header sweep, a lint autofix, or a find-and-replace rename — the file "changed" but nothing was *verified*, so the page looks fresh while being stale. It **undercounts** when content moved between files (a split or a `git mv`) and `--follow` isn't used, so a genuinely maintained page reads as ancient. The senior refinement: ignore commits whose diff is whitespace/formatting-only (so no-op churn doesn't reset the clock), follow renames, and — best of all — track *last-verified* explicitly rather than inferring truth from commit dates at all. The git date is a *proxy*, and a leaky one.

### Q2.4 — What's an orphan doc, how do you detect one, and why does it matter for freshness?

> **Testing:** Whether you connect reachability to maintenance probability.

**A.** An **orphan doc** is a page nothing links to and nobody navigates to — no inbound links in the corpus, no entry in any index or sidebar, and (if you have analytics) near-zero traffic. You detect it by building the internal link graph (parse every page's links, find nodes with in-degree zero) and intersecting with page-view data. It matters because orphans rot the worst: if nobody *reaches* a page, nobody *notices* it's wrong, so it drifts unbounded and forever. Orphans are also where trust quietly dies — a reader who finds one via search assumes it's as maintained as everything else. The freshness program should treat "high orphan rate" as a leading indicator of corpus decay, and orphans are prime candidates for *archival* (Theme 7), because a page worth keeping should be reachable.

### Q2.5 — Your director wants a single "documentation health score" on a dashboard. How do you respond?

> **Testing:** Whether you can satisfy the ask without letting the number become a lie.

**A.** I'd build it, but I'd be explicit about what it can and can't claim, because the failure mode of a single score is that it gets *gamed* and *over-trusted*. I'd compose it from a few orthogonal, hard-to-game signals — percent of *owned* pages past their `review_by`, orphan rate, broken-link rate, and (if available) the rate of docs-tagged support tickets — rather than from "last edited," which a formatting bot can move. I'd report it **per area with a named owner**, not one global number, so it drives action instead of anxiety. And I'd state plainly: this is a *freshness/trust* proxy, not a *correctness* measure — it tells us where decay is concentrated, not that the green areas are flawless. A score that's honest about being a proxy is useful; a score that pretends to measure truth invites exactly the no-op gaming we'll discuss in Theme 6.

---

## Theme 3 — Auto-Detecting Rot

### Q3.1 — What classes of rot can you catch *automatically* in CI, and which are the highest-value?

> **Testing:** Whether you know detection is a spectrum from cheap-and-certain to expensive-and-fuzzy.

**A.** Roughly in order of value-per-effort:

1. **Broken links** — internal and external link checking. Cheap, deterministic, and a broken link is *unambiguously* a defect. Highest ROI starting point.
2. **Executable examples** — extract code/command blocks from docs and actually *run* them in CI (doctest-style). If the example no longer compiles or returns what the doc claims, the build fails. This catches the most damaging rot: instructions that don't work.
3. **Deleted-symbol references** — grep docs for identifiers (function names, flags, env vars, endpoints) that no longer exist in the codebase. Catches "this references `--legacy-mode` which we removed."
4. **Prose/style linting (Vale)** — enforce terminology, banned phrases, and "do not say X" rules. Catches *consistency* rot, not *truth* rot.

The highest-value pair is **broken links + executable examples**, because they catch the two failures that most destroy trust: dead navigation and instructions that lie. Everything else is supporting.

### Q3.2 — How does running examples in CI change the freshness problem? What's the catch?

> **Testing:** The detection-vs-prevention boundary, and the limits of executable docs.

**A.** It converts a *documentation* problem into a *test failure* — and a failing test is something engineering already knows how to not-ignore. If a code sample is executed in CI and the API it calls changes, the build goes red *on the PR that made the change*, so the doc can't silently drift; the person breaking it is told immediately. That's a huge step up from periodic manual review. The catch is twofold: it only works for content that's *actually executable* (a code snippet, a `curl`, a CLI invocation) — it does nothing for prose like "our architecture favors eventual consistency"; and it has a maintenance cost of its own (the harness, fixtures, network flake). So executable docs are the strongest *detection* tool we have, but they cover a *subset* of docs, and detection is still second-best to not having a separate copy at all (Theme 4). This is the heart of [02 — Testable and Executable Docs](../02-testable-and-executable-docs/interview.md).

### Q3.3 — What is Vale, where does it fit, and what can't it do?

> **Testing:** Whether you can place a prose linter accurately — neither dismissing it nor overselling it.

**A.** **Vale** is a syntax-aware prose linter: you define rules (regex/term-based, or built on style packages like Microsoft's or Google's) and it flags violations in CI — banned terms, inconsistent capitalization, deprecated product names, passive voice if you care. It fits in the same slot as a code linter: fast, runs on every PR, enforces *consistency and house style* at scale across many authors. What it **can't** do is judge *truth* — Vale will happily pass a grammatically perfect, on-brand sentence that is factually wrong, because it has no model of the system the docs describe. So Vale is a *consistency* control, not a *freshness* control. Conflating the two ("we run Vale, so our docs are accurate") is a category error: it polices how you say things, not whether they're still true.

### Q3.4 — How would you detect docs that reference code that no longer exists?

> **Testing:** Whether you can design a concrete, low-false-positive linter.

**A.** Build a check that extracts *referenced identifiers* from docs and verifies they still exist in the codebase. Concretely: parse fenced code blocks and inline-code spans for things that look like symbols — function names, CLI flags, env-var names, config keys, API routes — then grep/AST-search the source tree for each. A reference with zero hits is a candidate "phantom symbol." The hard part is **false positives**: docs legitimately mention illustrative or third-party names, so I'd scope it tightly — only check identifiers in a known namespace/prefix, or only flag ones that *used to* exist (present in an older git revision, gone now), which is a strong signal of genuine rot rather than an example. I'd run it as a *warning that requires acknowledgement* before promoting it to a hard failure, to calibrate the noise. The principle: a detector nobody trusts because it cries wolf is worse than no detector.

### Q3.5 — Rank link-checking, executable examples, and Vale by how strongly each catches *actual* rot.

> **Testing:** Whether you understand each tool catches a different *kind* of defect.

**A.** They're not on one axis — they catch different defects — but ranked by "how strongly does a failure mean the docs are *actually wrong*":

1. **Executable examples** — strongest. A failed run means the documented behavior genuinely no longer holds. Near-zero false positives on truth.
2. **Link checking** — strong for *navigation* rot. A 404 is unambiguous, but it tells you a *pointer* is dead, not that the *content* is wrong.
3. **Vale** — weakest for truth. It catches *consistency* drift; a passing Vale run says nothing about correctness.

So if I could only have one, it's executable examples (it catches the most trust-destroying failure); if I could only have one *cheap* one, it's link-checking (deterministic, near-free). Vale earns its place at scale for many authors, but I'd never let it stand in for the other two.

---

## Theme 4 — The Real Cure

### Q4.1 — All this detection is reactive. What's the *actual* cure for doc rot?

> **Testing:** The central insight of the topic — single source of truth beats any amount of measurement.

**A.** The actual cure is to **stop maintaining a second copy of the truth**: have a *single source of truth* and *generate* the documentation from it, so the doc and the system can't drift because they're the *same artifact* rendered twice. If the API reference is generated from the handler signatures (or an OpenAPI spec that the server is validated against), then changing the endpoint changes the doc *by construction* — there's no separate page to forget. Detection (link checks, executable examples, review-by dates) is genuinely valuable, but it's **second-best**: it catches drift *after* it happens, and it only works for the slices you've instrumented. Generation eliminates the *possibility* of drift for everything it covers. The senior framing: rot is a duplication problem, so the fix is *deduplication*, not *better monitoring of the duplicate*.

### Q4.2 — You said detection is "second-best." If generation is so much better, why does detection exist at all?

> **Testing:** Whether you understand the limits of generation — that not everything can be generated.

**A.** Because **not everything has a machine-readable source of truth.** You can generate an API reference from signatures, a config reference from a schema, a CLI reference from the arg parser — anything where the truth already lives in a structured, code-level form. But you *can't* generate the conceptual material: "why we chose eventual consistency," "how to think about our permission model," the tutorial that onboards a new hire. That prose has no source but a human's understanding, so it *will* drift, and detection (review-by dates, executable examples embedded in the prose, link checks) is the best available control for it. So the strategy is layered: **generate everything generatable** to shrink the rot-prone surface to the irreducible minimum, then point your *detection* budget at what's left. Detection isn't wrong — it's what you do for the part you can't deduplicate.

### Q4.3 — Walk me through the "coupling strength" spectrum for keeping a doc in sync with code.

> **Testing:** Whether you can reason about sync mechanisms as a graded spectrum, not a binary.

**A.** Think of it as how *tightly* a doc is bound to the thing it describes — stronger coupling means drift is harder or impossible:

1. **Generated from source** (strongest) — the doc *is* the code, rendered. Doc comments → API reference, schema → config docs. Drift is structurally impossible.
2. **Tested against source** — the doc is separate but a CI check fails if it disagrees: executable examples, snapshot of `--help`, OpenAPI-vs-server contract test. Drift is *possible* but caught immediately.
3. **Co-located, change-coupled** — the doc lives next to the code (same PR, same folder) and review/CODEOWNERS nudges updating both. Drift is *likely caught* by a human reviewer.
4. **Linked with an expiry** — separate doc with a `review_by` date forcing periodic re-verification. Drift is caught *eventually*, on a timer.
5. **A human promised to remember** (weakest) — a wiki page in a different system with no link to the code. Drift is *certain* over time.

The whole discipline is about **moving each doc up this ladder** — pushing as much as possible to tiers 1–2 and minimizing what's stuck at tier 5. "Where on this spectrum does this doc sit, and can I move it up one rung" is the question I'd ask of every doc.

### Q4.4 — Give a concrete example of moving a specific doc up the coupling ladder.

> **Testing:** Whether the spectrum is real to you or just a list you memorized.

**A.** Take REST API docs that today are a hand-written wiki page (tier 5: a human promised to remember). The progression:

- **Tier 4:** add a `review_by` date and an owner, so it's at least re-checked quarterly. Cheap, weak.
- **Tier 3:** move the page into the service repo next to the handlers and add it to CODEOWNERS, so an endpoint change and the doc change land in the same PR and a reviewer sees the mismatch.
- **Tier 2:** write an OpenAPI spec, render the human docs from it, and add a contract test that fails CI if the running server diverges from the spec. Now drift is *caught on the PR that causes it*.
- **Tier 1:** generate the OpenAPI spec itself *from* the handler signatures/annotations, so there's no separate spec to maintain — the code is the single source and the docs are a view of it.

Each rung removes a class of drift. Tier 1 is the goal; tier 2 is often the pragmatic stopping point because tier 1 needs framework support you don't always have. The point is it's a *migration*, and you can bank value at each rung.

---

## Theme 5 — Churn-Coupled Freshness

### Q5.1 — Why should a high-churn file's docs be reviewed more often than a stable file's docs?

> **Testing:** Whether you can connect *rate of change* to *rate of rot*.

**A.** Because **rot rate tracks change rate.** A doc goes stale only when the thing it describes changes, so a doc attached to a file that's modified weekly is accumulating drift risk far faster than a doc attached to a file untouched for two years. A uniform review cadence — "review every page annually" — therefore *under-checks* the volatile docs (they rot between reviews) and *over-checks* the stable ones (wasting reviewer effort on pages that didn't change). The senior move is to make the **review cadence a function of the underlying code's churn**: high-churn code gets a short review cycle (or, better, gets pushed up the coupling ladder so it's generated/tested), stable code gets a long one. You're allocating a scarce resource — reviewer attention — proportional to where drift actually accrues.

### Q5.2 — How do you tie freshness review to code hotspots? What signal drives it?

> **Testing:** Whether you can operationalize churn into a concrete cadence, using hotspot analysis.

**A.** A **hotspot** is code that's both high-churn *and* high-complexity — the files that change constantly and are hard to get right. Those files' docs are the ones most likely to be both *wrong* and *consulted*, so they're where freshness effort pays off most. Operationally: compute churn from `git log` (commit count or lines-changed per file over a window), join it to each doc via the code it documents (same folder, or an explicit `documents:` front-matter pointer), and set the doc's `review_by` interval *inversely* to churn — a file in the top churn decile gets, say, a 30-day review cycle; a cold file gets a year. You can even auto-shorten a doc's review-by, or auto-flag it for review, whenever its associated source files cross a churn threshold in a release. This is the same hotspot lens used in refactoring and test-prioritization, applied to docs: spend the attention where the change is.

### Q5.3 — Isn't a constantly-changing doc a smell in itself? When is high doc churn good vs bad?

> **Testing:** Whether you can distinguish healthy upkeep from thrash.

**A.** It depends on *what's* changing. Doc churn is **healthy** when it tracks real, externally-visible system change — the API gained an endpoint, so the API doc grew; that's the doc doing its job, staying coupled. It's a **smell** when the same prose is rewritten repeatedly without the system underneath changing (bikeshedding, or a doc that's a brittle hand-copy of volatile internals it shouldn't be describing at all). High churn on a *generated* doc isn't even a question — the generation handles it for free. So the diagnostic is: *is the doc churning because its subject changed (good), or because it's a fragile manual mirror of something it shouldn't be mirroring (bad)?* The bad case is usually a signal to push that doc up the coupling ladder or to stop documenting that volatile internal at all.

### Q5.4 — Your hotspot analysis says module X is the highest-churn code in the repo, and its docs haven't been touched in a year. What's your read?

> **Testing:** Whether you can fuse two signals into a prioritized conclusion.

**A.** That's the **highest-priority rot in the corpus**, and I'd treat it as close to a known defect. The two signals compound: high churn means the code has almost certainly changed in ways the docs don't reflect (high *probability* of drift), and module X being a hotspot means it's both important and frequently consulted (high *impact* of drift). A year-stale doc on a year-stable file is fine; a year-stale doc on the most-changed file in the repo is a landmine. My move: flag it for immediate review, but more importantly ask *why* it's a hand-maintained doc on volatile code at all — that's exactly the doc that should be generated or executable-tested, because manual review will never keep pace with that churn rate. Fixing the *instance* is review; fixing the *class* is moving it up the coupling ladder.

---

## Theme 6 — Scenario and Judgment

### Q6.1 — You inherit a 5,000-page wiki nobody trusts. What do you actually do?

> **Testing:** Whether you fix the trust problem strategically instead of trying to boil the ocean.

**A.** I would *not* try to review 5,000 pages — that's a year of work that's stale again before it's done, and it doesn't fix the underlying trust collapse. The trust problem is "a reader can't tell a good page from a bad one," so I attack *that*:

1. **Measure, don't read.** Pull traffic and the link graph. The classic finding is that ~90% of pages get ~0 reads. That reframes the problem from "5,000 pages" to "the ~200 pages anyone actually uses."
2. **Triage by usage × ownership.** The high-traffic pages get an owner and a `review_by` date *now*. Everything in the long tail of zero-traffic, no-owner pages gets **archived** (moved out of the main corpus to a clearly-labeled "unmaintained archive"), not deleted — archiving is reversible and instantly shrinks the surface.
3. **Restore trust on the pages that matter.** Get the top pages verified and visibly stamped (owner + last-verified), so a reader sees they're maintained.
4. **Prevent re-rot on the survivors.** Push the high-value, high-churn ones up the coupling ladder (generate/execute), so they don't decay again.

The reframe is the whole answer: it's not a 5,000-page problem, it's a ~200-page *trust* problem plus a 4,800-page *archival* problem. Volume was the disease; shrinking the maintained surface is most of the cure.

### Q6.2 — How do you keep API documentation from drifting from the actual API?

> **Testing:** Whether you reach for generation immediately, since API docs are the canonical generatable case.

**A.** API docs are the *easiest* case to solve properly, so I wouldn't rely on review discipline at all — I'd **make drift structurally impossible** by deriving the docs from the same artifact the server enforces. Concretely: define the contract as a machine-readable spec (OpenAPI/Protobuf), *generate* the human-readable reference from it, and add a **contract test** that fails CI when the running server's actual behavior diverges from the spec. Better still, generate the spec itself *from* the handler signatures/annotations so there's a single source — the code — and both the server and the docs are views of it. Now an engineer who changes an endpoint either updates the source-of-truth (and the docs regenerate) or breaks the contract test (and CI stops them). The only thing left for humans to write is the *prose* — narrative guides, auth concepts — which gets the lighter-weight freshness controls. API reference drift is a solved problem; the solution is generation, not vigilance.

### Q6.3 — Your freshness metric is being gamed by no-op edits — bots and people bumping the "last updated" date without changing anything. How do you fix it?

> **Testing:** Goodhart's law in practice — whether you fix the *measure* or the *incentive*.

**A.** This is Goodhart's law: the metric became a target, so it stopped measuring what we cared about. The naive fix is to make the metric harder to game; the real fix is to **measure verification, not activity.** Concretely:

- **Stop trusting "last edited."** A commit date proves bytes moved, not that anything was checked. Switch the signal to an explicit **last-verified** act — a reviewer ticks "I confirmed this is still true," recorded separately from edits.
- **Ignore no-op diffs.** When computing staleness from git, discard commits whose diff is whitespace/formatting-only or a bulk rename, so a lint bot can't reset the clock.
- **Tie freshness to a stronger proxy.** Prefer signals that can't be faked by editing the doc — does the executable example still pass, does the contract test still hold, are there open docs-bug tickets. Those reflect *reality*, not edit activity.
- **Fix the incentive, not just the metric.** People game a number because the number is the goal. Make the *outcome* the goal — "are readers successfully using this doc" — and remove the perverse reward for cosmetic edits.

The lesson: any freshness metric based on "was it touched" is gameable by touching it. Base it on "was it *verified*" or, best, on coupling that makes the question moot (a generated doc has nothing to game).

### Q6.4 — A team proudly reports "100% of our docs were updated this quarter." Are you impressed?

> **Testing:** Whether you can see through an activity metric to ask about outcomes.

**A.** Not on its own — that's an *activity* number, and activity isn't correctness or value. "100% updated" could mean a script bumped every front-matter date, or every page got a real verification — those are wildly different, and the metric can't tell them apart (see the no-op gaming problem). The questions I'd ask: *updated how* — verified against the system, or just edited? Updated *which* pages — the high-traffic ones readers depend on, or 4,000 orphans nobody reads? And the real one: did it move any *outcome* — fewer docs-related support tickets, faster onboarding, higher reader trust? A team optimizing "percent updated" is at risk of doing maximal work for minimal value. I'd much rather hear "we archived 80% of the corpus and got the remaining high-traffic pages onto generated/tested sources" — that's a smaller number that means more.

### Q6.5 — Leadership wants to *delete* every doc not updated in a year. Good idea?

> **Testing:** Whether you can resist a blunt heuristic and propose a graded, reversible one.

**A.** The instinct (shrink the rot surface) is right; the mechanism (delete by age) is too blunt and is destructive. Age alone is a bad proxy: a stable, correct, high-traffic page (how to configure a CLI flag that hasn't changed) would be wrongly deleted, while a frequently-edited *wrong* page survives. And *deletion* is irreversible — if you're wrong, the knowledge is gone. I'd counter with a **graded, reversible** policy: combine age with *usage* and *ownership* — pages that are old **and** zero-traffic **and** unowned get **archived** (moved to a labeled, searchable "unmaintained" space), not deleted; anything old but high-traffic gets *flagged for review*, not removed; anything owned with a current `review_by` is left alone. Archiving captures ~all the trust benefit of deletion (it's out of the trusted corpus) at none of the risk. So: same goal, but use archival not deletion, and use age *plus* usage *plus* ownership, not age alone.

---

## Theme 7 — Program and Ownership

### Q7.1 — Why does every doc need a named owner and an SLA, and what does that SLA actually say?

> **Testing:** Whether you understand that unowned docs rot by default — accountability is the precondition for freshness.

**A.** Because a doc with no owner is a doc nobody is accountable for, and *anything* nobody is accountable for decays to its lowest-energy state — stale. Freshness is an *ongoing* commitment, and commitments need a name attached or they evaporate. The **owner** is a person or, better, a *team* (people leave; teams persist) responsible for the page's correctness. The **SLA** makes the commitment concrete and measurable: "this page will be re-verified at least every N days" (the `review_by` cadence), and often "docs-bug reports will be triaged within M days." That turns freshness from a vague aspiration into a tracked obligation you can dashboard and escalate on. The corollary: a doc nobody will *own* is a doc you should *archive*, because you've just admitted no one will keep it true — and an unowned page in the trusted corpus is a future broken promise.

### Q7.2 — How do you decide what to keep fresh versus what to archive?

> **Testing:** Whether you triage by value and maintainability instead of trying to keep everything alive.

**A.** You can't keep everything fresh — maintenance is finite — so you *triage*, and the two axes are **value** (does anyone rely on this) and **maintainability** (can we realistically keep it true). That gives four quadrants:

- **High value, maintainable** → *keep and invest*: assign an owner, set an SLA, push it up the coupling ladder. This is the core corpus.
- **High value, hard to maintain** → *re-engineer*: it's consulted but keeps rotting, so move it to generation/execution or simplify what it covers. The most important work.
- **Low value, any** → *archive*: nobody reads it, so don't spend a minute maintaining it; move it out of the trusted set.
- **High churn, low value** → *archive or delete the topic*: documenting a volatile internal nobody needs is pure liability.

Usage data drives the value axis; coupling-ladder position drives the maintainability axis. The discipline is *saying no* — explicitly declaring large parts of the corpus unmaintained (archived) so the part you *do* promise to keep fresh is small enough that the promise is credible. A smaller trusted corpus that's actually trustworthy beats a giant one that isn't.

### Q7.3 — Describe the incentive problem in doc freshness. Why is "remember to update the docs" doomed?

> **Testing:** Whether you see that freshness fails for structural/incentive reasons, not character reasons.

**A.** The incentive problem is that the person who *creates* the drift (the engineer changing the code) is usually not the person who *suffers* from it (a future reader, or the docs team), and updating the doc is *extra work with no immediate reward* for the person best positioned to do it. So "remember to update the docs" asks people to do unrewarded work to prevent a cost they won't personally bear — which is exactly the kind of control that fails reliably over a large team and a long time. It's not that engineers are lazy; it's that the incentives point the wrong way. The fixes all work by *changing the structure* rather than exhorting harder:

- **Make it automatic** (generation): no human action required, so incentives are irrelevant.
- **Make it blocking** (executable docs / contract tests in CI): the engineer who breaks the doc can't merge, so the cost lands on the person who caused it, immediately.
- **Make it owned with an SLA**: someone is accountable and measured on it.
- **Co-locate** (docs in the same PR/CODEOWNERS): updating both becomes the path of least resistance.

The throughline of this whole topic: never rely on memory or goodwill as a freshness control. Engineer the rot away, or make the failure loud and land it on the right person — exhortation is the control that's already failing in every wiki you've ever seen.

### Q7.4 — You're standing up a documentation-freshness program from scratch. What are your first three moves?

> **Testing:** Whether you can sequence a program for fast trust recovery, not boil-the-ocean perfection.

**A.** I'd sequence for *fastest trust recovery per unit effort*:

1. **Instrument and shrink.** Get usage analytics and the link graph, then *archive* the long tail of zero-traffic, unowned pages. This is the highest-leverage first move — it shrinks the surface I have to care about by an order of magnitude and immediately raises the average trustworthiness of what's left.
2. **Own the survivors.** Assign every remaining page a team owner and a `review_by` SLA, weighted by churn (Theme 5), so attention concentrates where rot accrues. Now there are no orphans in the trusted corpus.
3. **Make the worst offenders structurally rot-proof.** Take the high-traffic, high-churn pages — API references, config docs, CLI help — and move them up the coupling ladder to *generated* or *executable-tested*. This stops the most-consulted docs from re-rotting and converts the problem from perpetual manual review to a CI concern.

Only *after* those would I add corpus-wide detection (link-checking, Vale) as a backstop. The ordering matters: shrink and own *before* you measure, because measuring a giant unowned corpus just produces a depressing dashboard nobody can act on. The goal of the program isn't "all docs perfect" — it's *a trusted corpus a reader can rely on by default*, which is a smaller, owned, mostly-generated one.

---

## Rapid-Fire Round

> Short questions to check breadth. One or two sentences each.

- **Q: Why is stale worse than missing?** A: Missing has zero value (you go find the truth); stale has *negative* value — it's authoritative and wrong, so you act on a lie with confidence.
- **Q: What does "last edited" measure that "last verified" doesn't?** A: Activity, not truth — a typo fix bumps "last edited" without confirming anything is still correct.
- **Q: What's an orphan doc?** A: A page with no inbound links and no traffic; it rots worst because nobody reaches it to notice it's wrong.
- **Q: Single best automated rot check?** A: Executable examples — a failed run means the documented behavior genuinely no longer holds.
- **Q: Cheapest high-value check?** A: Link-checking — deterministic, near-free, and a 404 is unambiguous.
- **Q: What is the actual cure for rot?** A: Single source of truth — generate docs from code so the two can't drift; detection is second-best.
- **Q: Where does Vale fit?** A: Consistency/house-style linting, not truth; it passes grammatically perfect lies.
- **Q: Top vs bottom of the coupling ladder?** A: Top = generated from source (drift impossible); bottom = a human promised to remember (drift certain).
- **Q: Why review high-churn docs more often?** A: Rot rate tracks change rate, so volatile code's docs accumulate drift faster and deserve a shorter review cycle.
- **Q: Archive or delete the unread long tail?** A: Archive — it captures the trust benefit of removal while staying reversible.
- **Q: How do no-op edits game freshness?** A: They bump "last updated" without verifying anything; fix by measuring *verification* and ignoring whitespace/rename diffs.
- **Q: Why is "remember to update the docs" doomed?** A: The person who causes the drift doesn't bear its cost, so the unrewarded work doesn't happen — engineer it away or make CI block it instead.
- **Q: What does a freshness SLA say?** A: This page will be re-verified at least every N days, by a named owning team.
- **Q: Why a team owner not a person?** A: People leave; teams persist, so the accountability survives turnover.

---

## Red Flags and Green Flags

> What interviewers infer from *how* you answer, not just whether you're right.

**Red flags:**
- Treating "more docs" as the goal — not seeing each page as a maintenance liability.
- Reporting a freshness/activity metric as if it were a correctness metric.
- Reaching for a dashboard before reaching for the root cause (duplication).
- Proposing to manually review a 5,000-page wiki, or to *delete* by age alone.
- "We run Vale, so our docs are accurate" — confusing consistency with truth.
- Relying on "remember to update the docs" as a freshness control.
- Trusting git "last edited" as the freshness signal, blind to no-op gaming.

**Green flags:**
- Naming the *distinction* (stale vs missing, detection vs prevention, freshness vs correctness, coupling strength) before reaching for a tool.
- Stating that single-source-of-truth / generation is the real cure and detection is second-best — unprompted.
- Reframing "5,000 pages" as a ~200-page trust problem plus a 4,800-page archival problem.
- Tying review cadence to code churn / hotspots.
- Spotting Goodhart's law in a gamed metric and fixing the *incentive*, not just the number.
- Choosing *archive over delete* for reversibility, and triaging by usage × ownership.
- Caveating metrics ("freshness is a proxy for trust, not a measure of correctness").

---

## Summary

- The bank reduces to four distinctions, repeated in costumes: **stale vs missing**, **detection vs prevention**, **freshness vs correctness**, and **coupling strength**. Name the distinction first; the tool follows.
- **Doc rot basics:** stale is worse than missing because it carries *negative* value — confidently wrong — and a few rotten pages destroy trust in the whole corpus. Rot is a *duplication* (engineering) problem, not a *writing* one.
- **Freshness signals** (staleness age from git, review-by dates, percent past review, orphan rate) measure *activity*, not *truth* — they're triage signals that tell you where to look, never what's wrong, and git "last edited" is a leaky proxy that no-op edits can game.
- **Auto-detection** spans cheap-and-certain to expensive-and-fuzzy: broken-link checks and executable examples catch the trust-destroying failures (dead navigation, instructions that lie); Vale catches *consistency*, not correctness.
- **The real cure** is single source of truth — generate docs from code so drift is structurally impossible; detection is second-best because it's reactive and partial, and it exists only for the prose that *can't* be generated. The **coupling-strength ladder** (generated → tested → co-located → expiry-dated → "a human promised") is the migration path: move every doc up a rung.
- **Churn-coupled freshness:** rot rate tracks change rate, so review cadence should be inverse to code churn, concentrated on hotspots; a year-stale doc on the highest-churn file is a landmine, and the class fix is to make that doc generated/executable.
- **Program and ownership:** every kept doc needs a team owner and an SLA; triage by value × maintainability and *archive* (reversibly) what you won't maintain; and never rely on "remember to update the docs" — the incentives point the wrong way, so engineer the rot away or make CI block it. A small trusted corpus beats a giant untrusted one.

---

## Further Reading

- *Docs for Developers* (Bhatti, Corleissen, et al.) — practical treatment of maintenance, ownership, and keeping docs alive over time.
- *Documenting APIs* (Tom Johnson) and the `docs-as-code` / `idratherbewriting.com` material — generation from source and treating docs like code.
- The [Diátaxis](https://diataxis.fr) framework — *why* different doc types (tutorial, how-to, reference, explanation) rot differently and which are generatable.
- The [junior](junior.md), [middle](middle.md), [senior](senior.md), and [professional](professional.md) pages of this topic — every answer here is grounded in those.
- Vale (`vale.sh`) and link-checkers (`lychee`, `linkchecker`) — primary sources for the detection tooling the answers reference.

---

## Related Topics

- [02 — Testable and Executable Docs](../02-testable-and-executable-docs/interview.md) — running examples in CI, the strongest *detection* control and a rung on the coupling ladder.
- [04 — Docs Coverage and Gaps](../04-docs-coverage-and-gaps/interview.md) — the *missing* half of the missing-vs-stale pair: what's undocumented at all.
- [Documentation Quality README](../README.md) — where freshness sits in the broader docs-quality landscape.
- [Quality Engineering README](../../README.md) — how freshness metrics relate to the wider quality program.
