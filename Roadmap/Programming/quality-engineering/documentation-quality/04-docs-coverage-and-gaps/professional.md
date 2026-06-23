# Docs Coverage & Gaps — Professional Level

> **Roadmap:** [Documentation Quality](../README.md) → Docs Coverage & Gaps
> *The senior page taught you that "documented" ≠ "good" and that a docstring-coverage percentage is as gameable as line coverage. This page is about running coverage and gap analysis as an organizational program — where the question stops being "what's our coverage number?" and becomes "which missing docs are costing us the most tickets, and whose job is it to close them?"*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [A Sane Docs-Coverage Policy: Gate the Diff, Not the History](#a-sane-docs-coverage-policy-gate-the-diff-not-the-history)
4. [Demand-Driven Gap Programs — the Continuous Loop](#demand-driven-gap-programs--the-continuous-loop)
5. [The Diátaxis Coverage Matrix as a Planning Artifact](#the-diátaxis-coverage-matrix-as-a-planning-artifact)
6. [Error-Message and API-Edge Coverage — the Highest-ROI Empty Gap](#error-message-and-api-edge-coverage--the-highest-roi-empty-gap)
7. [Owning the Gaps — Triage and Accountability](#owning-the-gaps--triage-and-accountability)
8. [Avoiding the Vanity Trap — Report Demand-Weighted, Not Raw](#avoiding-the-vanity-trap--report-demand-weighted-not-raw)
9. [Build vs Buy for Doc Analytics](#build-vs-buy-for-doc-analytics)
10. [War Stories](#war-stories)
11. [Decision Frameworks](#decision-frameworks)
12. [Mental Models](#mental-models)
13. [Common Mistakes](#common-mistakes)
14. [Test Yourself](#test-yourself)
15. [Cheat Sheet](#cheat-sheet)
16. [Summary](#summary)
17. [Further Reading](#further-reading)
18. [Related Topics](#related-topics)

---

## Introduction

> Focus: **Running docs coverage and gap analysis as an org program — policy that gates the right thing, a demand-driven loop that finds the gaps that matter, and ownership so they actually get closed.**

The senior page gave you the conceptual ammunition: coverage tools measure *presence*, not *value*; a 100% docstring mandate produces `// the id` noise and gets gamed exactly like a 100% line-coverage rule. That's the right instinct. The professional problem is what you build *on top of* that instinct when you own documentation quality across dozens of teams, hundreds of public API surfaces, and a support org drowning in tickets that good docs would have deflected.

At this level the failure mode isn't "we have no coverage tooling." It's worse and quieter: you stood up `interrogate` in CI, it reports 94%, leadership sees green, and meanwhile the single undocumented error string in your auth flow is generating four hundred tickets a quarter. The coverage number is *true* and *useless*. The skill here is running a program that finds the gaps your readers actually hit, ranks them by demand, assigns them an owner, and proves — in deflected tickets, not in percentage points — that closing them paid off. This is the diff-coverage analog applied to docs, plus the demand signal that code coverage never had. This page is the pragmatic, battle-tested layer.

---

## Prerequisites

- **Required:** [senior.md](senior.md) — why "documented" ≠ "good," the coverage trap, docstring-coverage tools and their limits.
- **Required:** You've owned a documentation surface that real users depend on, and watched a metric get gamed.
- **Helpful:** You've run or sat next to a support function and seen the ticket queue.
- **Helpful:** You've defended a quality program's budget to leadership with numbers, and had the numbers questioned.

---

## A Sane Docs-Coverage Policy: Gate the Diff, Not the History

The single most important policy decision is *what the gate is measured against*. Get this wrong and every downstream effort is poisoned.

The instinct of a new docs-quality owner is to mandate a coverage *threshold on the whole codebase* — "every public symbol must have a docstring; CI fails below 100%." This is the exact mistake that [Code Coverage](../../code-coverage/) teaches you to avoid with line coverage, and it fails for the identical reasons:

- **It's retroactive debt dumped on whoever touches the file next.** A developer fixing a one-line bug in a 4,000-line legacy module suddenly owns documenting 300 undocumented functions. They will not. They'll either revert, carve out an exception, or write `// gets the user` 300 times.
- **It gets gamed instantly and the gaming is invisible.** The tools count *presence*, so the rational response to a presence gate is to manufacture presence. `// the id`, `@param name the name`, `Returns the result.` — every one of these passes the linter and lowers the signal-to-noise of the docs for every future reader. You have made the docs *worse* while making the number better.
- **The number stops meaning anything.** Once a population of docstrings exists only to satisfy the gate, "94% coverage" tells you nothing about whether the 94% is useful.

The correct policy is the **diff-coverage analog**: gate documentation only on *newly added or modified public API*. The rule is "you may not add a new exported function/endpoint/flag without documenting it" — never "you must retroactively document everything that already exists."

```yaml
# CI docs gate, conceptually: judge the diff, not the repo.
# Pass if every PUBLIC symbol ADDED or MODIFIED in this PR is documented.
# Pre-existing undocumented symbols are NOT this PR's problem.
docs-coverage:
  scope: changed-public-symbols-only      # the diff, like diff-cover for tests
  fail-on: new-public-symbol-without-doc
  ignore: pre-existing-gaps               # tracked separately, in the demand backlog
```

This works because it's enforceable at the moment of lowest cost (the author has the context *right now*), it doesn't punish unrelated work, and it stops the bleeding — the undocumented surface stops *growing* even before you start shrinking it. The existing backlog of undocumented symbols is then handled not by a blanket mandate but by the demand-driven program below, which fills the gaps *readers actually hit* rather than all of them indiscriminately.

> **The professional reality:** the question "what should our docs-coverage target be?" is the wrong question, the same way "what should our line-coverage target be?" is. There is no good answer in the form of a single percentage. The good answer is a *diff gate on new public surface* plus a *demand-ranked backlog* for the rest. A retroactive 100%-docstring mandate is not a quality program; it's a noise-generation program with a green dashboard.

---

## Demand-Driven Gap Programs — the Continuous Loop

A raw coverage tool produces an *undifferentiated* list of gaps: every undocumented symbol, every empty Diátaxis quadrant, ranked by nothing. That list is nearly useless for prioritization, because the gaps are not equal — a missing doc on an internal helper nobody calls is not the same as a missing doc on the most-searched error in your product. The professional discipline is to **rank gaps by reader demand** and fill from the top.

The program is a **continuous loop**, not a one-time audit:

```
   ┌──────────────────────────────────────────────────────────┐
   │                                                          │
   ▼                                                          │
[1] MINE DEMAND SIGNALS                                       │
    • Failed/zero-result searches in the docs site & support  │
    • Support tickets (tagged by topic; what do people ask?)  │
    • Sales / onboarding / solutions-eng feedback             │
    • "Edit this page" / feedback-widget submissions          │
    • Community Q&A (Stack Overflow, Discord, forum)          │
            │                                                 │
            ▼                                                 │
[2] RANK GAPS BY DEMAND  (frequency × cost-per-occurrence)    │
            │                                                 │
            ▼                                                 │
[3] FILL THE TOP N  (assign owners — see triage section)      │
            │                                                 │
            ▼                                                 │
[4] MEASURE DEFLECTION  (tickets/searches for that topic ↓?)  │
            │                                                 │
            └─────────────────► feed result back into ROI ────┘
                              (tie to ../06-measuring-docs-roi)
```

The pivotal move is step 1's **failed-search log**, which is the closest thing documentation has to a direct "what does the reader want that we don't have?" signal. Every zero-result query on your docs site is a reader telling you, in their own words, about a gap — and unlike a coverage tool, the search log is *demand-weighted by construction*: a query that appears 2,000 times a month is a 2,000-reader gap; a symbol no one searches for is, correctly, ranked near the bottom regardless of whether it has a docstring.

Step 2's ranking should be **frequency × cost-per-occurrence**, not frequency alone. A topic searched 50 times a month where each miss generates a support ticket (high cost) outranks a topic searched 500 times where readers self-recover (low cost). Cost is read off the support-ticket tags: gaps that *generate tickets* are expensive; gaps where people shrug and move on are cheap.

Step 4 is what separates a program from a guess. After you fill a top gap, you watch the same signal: did searches for that term start succeeding? Did tickets tagged with that topic drop? That delta is your **ticket deflection**, and it's the unit you report and the input to the [ROI model](../06-measuring-docs-roi/professional.md). A gap-filling effort that *doesn't* move the signal is feedback too — maybe the doc is unfindable (an information-architecture problem, not a coverage one), maybe the demand was misread.

> **Why this beats raw coverage:** a coverage tool answers "what's missing?" with a flat list. The demand loop answers "what's missing *that readers are actively hitting and paying for*?" — a ranked list where the top item is, by construction, the highest-leverage doc you could write this week. You will never run out of undocumented symbols; you *can* run out of undocumented symbols that anyone searches for, and that's the finish line that matters.

---

## The Diátaxis Coverage Matrix as a Planning Artifact

Symbol-level coverage tools see *reference* docs only — they count docstrings. They are structurally blind to the other three Diátaxis quadrants: you can have 100% docstring coverage and *zero* tutorials, how-to guides, or explanation, and every coverage tool will report you green. This is the largest blind spot in naive coverage programs, and the fix is a different artifact entirely.

Build a **doc-type coverage matrix**: products (or major features) on one axis, the four Diátaxis types on the other, each cell rated for coverage and quality. This is not a CI metric — it's a *planning and funding artifact* that leadership can read and allocate against.

| Product / Surface | Tutorial | How-To Guides | Reference | Explanation |
|---|---|---|---|---|
| Auth & Identity | ⚠️ thin | ✅ good | ✅ good | ❌ none |
| Billing API | ❌ none | ⚠️ partial | ✅ good | ❌ none |
| Webhooks | ✅ good | ✅ good | ⚠️ stale | ⚠️ thin |
| CLI | ✅ good | ⚠️ partial | ✅ good | ✅ good |
| SDKs (per lang) | ❌ none | ❌ none | ✅ auto-gen | ❌ none |

The matrix does three things a percentage can't:

- **It makes the *shape* of the gap visible.** "Billing has solid reference but no tutorial and no explanation" is an actionable, fundable statement. "Billing docs are 88% covered" is not — that number is computed only over the reference column and silently scores the three empty columns as if they didn't exist.
- **It surfaces the systemic pattern.** Reading down the columns, the example above screams *"we have no explanation docs anywhere and no SDK onboarding"* — an org-wide investment decision, not a per-product chore.
- **It's the funding pitch.** Leadership funds against pictures of *value and risk*, not against linter percentages. A red column labeled "Tutorial" across your three newest products is a roadmap line item. "Raise coverage from 88% to 92%" is not — and shouldn't be.

Refresh the matrix on a cadence (quarterly is typical) and treat each cell's rating as a deliberate, demand-informed judgment, not a tool output. The matrix is where coverage analysis stops being a linter score and becomes a strategy document.

---

## Error-Message and API-Edge Coverage — the Highest-ROI Empty Gap

If you do one thing from this page, do this: **make every error message a user can hit findable in your docs.** This is the highest-ROI gap in almost every documentation surface, and it is almost always completely empty, because no coverage tool measures it and no docstring mandate touches it.

The reasoning is mechanical. An error string is, by definition, a moment where a user is *stuck and actively searching* — the highest-intent, highest-cost reader state that exists. When someone pastes `Error: PERMISSION_DENIED: caller does not have permission` into your docs search or Google and gets zero results, the next thing they do is file a ticket or churn. Every error string is therefore a pre-identified, demand-validated documentation gap with a known, high cost-per-miss. You don't even need the search log to find these — the *list of error strings your software can emit* is the gap list, and it's enumerable from the source.

A practical error/edge coverage program:

- **Enumerate the error surface.** Grep the codebase for every error string, error code, and exception message a user can actually receive. This list *is* your coverage target — and unlike a docstring list, every item on it is something a stuck user might search verbatim.
- **Make each one findable, verbatim.** The doc page for an error should contain the *exact string the user sees*, so a copy-paste search hits it. Documenting `permission errors` in prose does not help the user who pasted `PERMISSION_DENIED`; the literal token must be on the page.
- **Cover the API *edges*, not just the happy path.** Rate limits, pagination boundaries, idempotency behavior, timeout/retry semantics, what happens on partial failure, every non-2xx status — these are the "I'm stuck" moments. Reference docs that describe only the success case have ~100% symbol coverage and a gaping edge-case hole.
- **Close the loop with telemetry.** If your errors carry codes, you can correlate error-code emission rates with doc-page hits and ticket tags — turning "which errors are most documented-against vs most-hit" into a directly measurable, rankable gap list.

> **Why this beats docstring coverage outright:** docstring coverage rewards documenting the function a developer is *reading*; error coverage documents the moment a user is *stuck*. The second is where tickets are born. A team with mediocre docstring coverage but complete, verbatim, findable error documentation will deflect far more tickets than a team with 100% docstrings and no error pages — because the docstrings serve readers who are already fine, and the error pages serve readers who are about to file a ticket.

---

## Owning the Gaps — Triage and Accountability

Here is the quiet reason most gap programs die: **a gap is, by default, nobody's job.** A missing test fails a build and blocks a merge — it has teeth. A missing doc fails nothing. It sits in the backlog, visible to all, owned by none, until the demand it represents shows up as tickets. Coverage tooling and demand loops are worthless if the output is an unowned list.

The fix is explicit ownership, and it has two halves:

**A tech-writer (or docs-owner) triages the demand backlog.** Just as an on-call engineer triages alerts, someone owns *triaging the gap backlog* — taking the ranked, demand-weighted list from the loop above and deciding, each cycle: which gaps get pulled in, who fills each one, and what "done" means (the doc exists, is findable, and the demand signal is being watched). Without a triager, the ranked list is just a longer version of the flat list — information no one acts on. This is a real, named role or rotation, not an aspiration.

**Each pulled-in gap gets an assigned owner with a deadline.** "The auth team should document this error" is not ownership; it's a hope addressed to a group. Ownership is a named person, a ticket, and a date. The triager's job is to convert demand-ranked gaps into *assigned, dated work items* and to chase them like any other deliverable. The author is usually the engineer with the context (the person who wrote the error, the endpoint, the flag — see the diff gate); the tech writer owns *that it happens*, reviews for quality, and ensures findability.

A few hard-won specifics:

- **Make the highest-demand gaps un-ignorable.** A gap generating hundreds of tickets shouldn't live in the same undifferentiated backlog as a typo. Promote top-demand gaps to the *team's* sprint board, not a separate docs board nobody reads.
- **Tie gap ownership to the surface owner.** Whoever owns the auth service owns the auth docs gaps. Documentation that's "the docs team's problem" detaches the people with the context from the obligation; the docs team owns *process, quality, and findability*, the surface team owns *content*.
- **The triager protects the program from the vanity trap below.** Because they work the *demand* backlog, not the raw-coverage list, they naturally prioritize value over percentage — which is exactly the discipline the next section demands.

---

## Avoiding the Vanity Trap — Report Demand-Weighted, Not Raw

A docstring-coverage percentage is a **vanity metric**: it goes up and to the right, it looks like progress on a slide, and it can be entirely decoupled from whether anyone's life got better. The professional discipline is to *refuse to report it as the headline* and to report demand-weighted outcomes instead.

The trap has a specific shape. Coverage rises from 88% to 95%. The slide is green. But the 7-point gain came from auto-generating stub docstrings, or from documenting low-traffic internal symbols, while the most-searched error in the product is still undocumented. You have optimized the number and not the readers. Worse, having reported the number as success, you've now *trained leadership to ask for the number*, locking in the wrong incentive — the exact mechanism by which a 100% line-coverage rule destroys a test suite.

What to report instead:

| Don't headline | Do headline |
|---|---|
| "Docstring coverage: 88% → 95%" | "Closed the top 12 demand-ranked gaps this quarter" |
| "Documented 400 symbols" | "Deflected ~600 tickets/qtr on the auth-error gaps we filled" |
| "0 undocumented public APIs" (diff gate) | "Failed-search rate on docs site: 31% → 12%" |
| "100% of endpoints have reference docs" | "Time-to-first-success on the onboarding tutorial: ↓ 40%" |

Raw coverage isn't *useless* — the diff gate genuinely keeps new debt out, and a near-zero coverage number is a real alarm. But coverage is a *guardrail and a hygiene check*, not a goal, and it belongs in the appendix, not the headline. The headline is **demand-weighted gaps filled and the deflection they produced**, which is the language of [ROI](../06-measuring-docs-roi/professional.md) and the only language that survives a skeptical budget review. If the only thing you can say about your docs program is that a percentage went up, you don't yet have a program — you have a linter.

> **The reframe:** "documented" is an input; "the reader succeeded" is the outcome. Coverage measures the input and is trivially gameable; demand-driven deflection measures the outcome and is not. Report the outcome. When someone asks for the coverage percentage, give it — then immediately pivot to the deflection numbers, because that's what the percentage was *supposed* to be a proxy for, and you have the real thing.

---

## Build vs Buy for Doc Analytics

The demand loop runs on signals — failed searches, ticket tags, feedback submissions — and those signals come from instrumentation you either build or buy. The decision matters because the program is only as good as its inputs, and the inputs have very different build-vs-buy economics.

**Search analytics.** The single highest-value signal, and the one most worth buying if your docs platform offers it. Hosted docs search (Algolia DocSearch, your CMS's analytics, or a docs platform with built-in search telemetry) gives you the failed-/zero-result query log essentially for free. *Build* only when you have an unusual search surface or strict data-residency constraints; the failed-search log is too valuable to not have, and rebuilding query-analytics infrastructure to save a subscription is rarely the right trade.

**Support-ticket tagging.** This is the demand signal that's almost always a *build* (or rather, a *process*) regardless of tooling, because the value is in the *taxonomy and the discipline of applying it*, not the software. Your helpdesk (Zendesk, Intercom, Jira Service Management) already stores tickets; what you need is a tagging scheme that maps tickets to doc topics and a team habit of applying it. Buying a fancier helpdesk doesn't create the taxonomy; agreeing on tags and enforcing them does. The integration work — correlating ticket-topic volume with doc gaps — is the build, and it's mostly glue and reporting.

**Docs feedback widgets.** The classic "Was this page helpful? 👍/👎 / Edit this page" control. Cheap to *buy* (most docs platforms include one) and cheap to *build*. The caveat is that thumbs-up/down is a *noisy, low-volume, biased* signal — people click it when annoyed, rarely when satisfied — so treat it as a tiebreaker and a qualitative prompt (the free-text "what was missing?" field is worth more than the thumb), never as a primary ranking input. Search logs and ticket tags carry far more signal.

The integrating principle: **buy the collection, own the loop.** Buy search analytics, buy the widget, use your existing helpdesk — but the *correlation* (which gaps drive which tickets), the *ranking*, and the *triage* are your program's core competency and should never be outsourced to a vendor's generic dashboard. A bought dashboard will happily show you page views; only your loop turns failed searches and ticket tags into a ranked, owned, deflection-measured gap backlog.

---

## War Stories

**The 100% docstring mandate that produced a noise factory.** A platform org, wanting "engineering rigor" in docs, set a CI gate: every public symbol must have a docstring, build fails below 100%, applied to the *entire* monorepo. Within two sprints coverage hit 100% and the docs were measurably *worse*. The codebase filled with `// the id`, `@return the result`, `// constructor`, and `Sets the value.` — thousands of docstrings written solely to pass the gate, drowning the genuinely useful ones. New reviewers couldn't tell signal from noise. The number was a perfect 100% and meant nothing. The fix was to scrap the retroactive mandate, replace it with a *diff gate on new public API only*, and mass-delete the noise docstrings — coverage "dropped" to 71% and the docs got better, which is the entire lesson in one sentence.

**The search-log mining that found the real gaps.** A docs-quality lead, instead of chasing the coverage percentage, pulled six months of the docs-site search log and sorted by *zero-result* queries. The top results were not what anyone expected: the most-failed search was a specific error string, followed by a billing-proration question, followed by a webhook-retry question — none of which corresponded to *missing docstrings*, all of which corresponded to missing *how-to and error* content that coverage tools were blind to. They filled the top 15 zero-result topics over a quarter. Searches for those terms went from zero-result to resolved, and tickets tagged with those topics dropped by roughly a third. The coverage percentage didn't move at all — proof that the percentage had been measuring the wrong thing the whole time.

**The one undocumented error that generated hundreds of tickets.** An auth service returned `PERMISSION_DENIED: caller does not have permission` for a half-dozen distinct underlying causes (wrong scope, expired token, wrong project, disabled account…), and *none* of them were documented — the string appeared nowhere in the docs. Users who hit it had no way to self-diagnose which cause applied, so nearly every occurrence became a support ticket; the topic was, by a wide margin, the single largest ticket driver in the product. Symbol coverage for the auth service was 100% — every function had a docstring. The fix was one page: the verbatim error string as a heading, the six causes, and the resolution for each. Tickets for that error fell off a cliff. The team had perfect docstring coverage and the most expensive documentation gap in the company, simultaneously — the two facts were unrelated, which is exactly why coverage percentage is the wrong headline.

---

## Decision Frameworks

**What should the docs-coverage gate measure? Ask:**
- Am I about to mandate a threshold on the *whole repo*? → stop; that's the gameable retroactive mandate. Gate the *diff* (new/modified public API) instead.
- Is the rule "you can't *add* an undocumented public symbol"? → good, that's the diff-coverage analog; enforceable at lowest cost.
- Where do pre-existing gaps go? → the demand backlog, ranked by reader demand — not a blanket "document everything" mandate.

**Which gap do I fill next? Ask:**
- What's it cost per occurrence? → frequency × cost; a low-frequency gap that *generates tickets* beats a high-frequency gap people self-recover from.
- Is it a verbatim error string a stuck user would search? → that's near-certain top priority; highest-intent, highest-cost reader state.
- Does the failed-search log or a ticket tag corroborate the demand? → if yes, it's real demand, not a guess. If no signal at all, deprioritize regardless of coverage.

**Is this a coverage gap or an architecture gap? Ask:**
- I filled the doc but the search still fails / tickets persist. → it's *findability* (information architecture), not coverage. See [05 — Readability & IA](../05-readability-and-information-architecture/professional.md).
- The doc exists but is wrong/stale. → that's *rot*, not a gap. See [03 — Freshness & Rot](../03-freshness-and-rot-metrics/professional.md).

**Build or buy this signal? Default to:**
- Search analytics → *buy* (or use the platform's); the failed-search log is too valuable to skip.
- Ticket→topic tagging → *build the taxonomy and the habit*; the value is the scheme, not the helpdesk.
- Feedback widget → *buy*; treat as a low-signal tiebreaker, mine the free-text, not the thumb.
- The correlation / ranking / triage loop → *always own it*; that's the program's core competency.

**What do I report to leadership? Default to:**
- Demand-weighted gaps filled + ticket deflection + failed-search-rate drop. Coverage percentage goes in the appendix as a guardrail, never the headline.

---

## Mental Models

- **Gate the diff, not the history.** A whole-repo docstring mandate is the 100%-line-coverage rule in disguise: retroactive debt, instantly gamed, number meaningless. Forbid *adding* undocumented public surface; route the existing gaps to a demand-ranked backlog.

- **A coverage tool answers "what's missing?"; the demand loop answers "what's missing that readers are paying for?"** You will never run out of undocumented symbols. You *can* run out of undocumented symbols anyone searches for — and that's the only finish line worth aiming at.

- **Every error string is a pre-identified, demand-validated gap.** It marks a stuck, high-intent user. The error surface is enumerable from the source, and documenting it verbatim deflects more tickets than any docstring push, because docstrings serve readers who are already fine.

- **Symbol coverage is blind to three of the four Diátaxis quadrants.** 100% docstrings with zero tutorials/how-tos/explanation scores green. Use a doc-type *matrix* as the planning artifact; the percentage only ever sees the reference column.

- **A gap is nobody's job until you make it someone's.** A missing test blocks a merge; a missing doc blocks nothing. Without a named triager working the demand backlog and named owners with dates, the ranked list is just a longer ignored list.

- **Coverage is a guardrail; deflection is the goal.** Report demand-weighted gaps filled and the tickets they deflected. The percentage was always meant to be a proxy for that — once you can measure the real thing, stop headlining the proxy.

---

## Common Mistakes

1. **Mandating retroactive 100% docstring coverage across the repo.** It dumps debt on the next person to touch a file, gets gamed into `// the id` noise instantly, and makes the number meaningless. Gate the *diff* — new/modified public API only — and route existing gaps to the demand backlog.

2. **Ranking gaps by nothing (or by coverage delta).** An undifferentiated list of undocumented symbols can't be prioritized. Rank by reader demand — frequency × cost-per-occurrence, read off failed searches and ticket tags — and fill from the top.

3. **Ignoring the failed-search log.** It's the most direct "what does the reader want that we don't have?" signal in existence, and it's demand-weighted by construction. Not mining it means flying blind on real demand while a coverage tool measures presence.

4. **Leaving error messages and API edges undocumented.** The highest-ROI gap, almost always empty, invisible to every coverage tool. Enumerate every user-visible error string from the source and make each findable *verbatim*; cover rate limits, pagination, retries, and every non-2xx.

5. **Treating coverage tools as the whole picture.** They see only the reference quadrant — 100% docstrings can coexist with zero tutorials and zero explanation, scored green. Maintain a Diátaxis coverage *matrix* as the planning and funding artifact.

6. **Leaving gaps unowned.** Coverage analysis and a demand loop produce nothing if the output is an unowned backlog. Assign a triager to the demand backlog and a named owner-with-a-date to each pulled-in gap; tie content ownership to the surface owner.

7. **Headlining the coverage percentage.** It's a vanity metric that decouples from reader outcomes and trains leadership to ask for the wrong number. Headline demand-weighted gaps filled and ticket deflection; keep coverage as an appendix guardrail.

---

## Test Yourself

1. A new docs-quality owner proposes a CI gate that fails the build if repo-wide docstring coverage drops below 100%. Explain why this fails, by analogy to a well-known code-coverage anti-pattern, and state the policy you'd put in its place.
2. You have a flat list of 1,200 undocumented public symbols. How do you decide which to document first, and what signal makes that ranking *demand-weighted* rather than a guess?
3. Why is documenting error messages typically higher-ROI than raising docstring coverage, and how do you find the error-coverage gap without even using the search log?
4. A team reports 100% reference-doc coverage on a product. What large class of documentation gap could still be completely empty, and what artifact would surface it?
5. Coverage rose from 88% to 95% this quarter but support-ticket volume on the relevant topics didn't budge. What probably happened, and what should you have reported instead of the percentage?
6. For each of search analytics, ticket-topic tagging, and the "was this helpful?" widget — build or buy, and why? What part of the system should you *never* outsource?
7. You filled a top-ranked gap with a clear, accurate doc, but searches for the term still fail and tickets persist. Is this a coverage problem? What is it, and where does it route?

<details>
<summary>Answers</summary>

1. It's the **100%-line-coverage anti-pattern** applied to docs: a retroactive whole-repo threshold dumps debt on whoever next touches a legacy file, and because the tools count *presence*, it's instantly gamed into meaningless `// the id` docstrings — making the docs worse while the number goes green. **Replace it with a diff gate:** forbid *adding/modifying* a public symbol without documenting it (the diff-coverage analog, enforceable at lowest cost), and route the pre-existing backlog to a demand-ranked program rather than a blanket mandate.
2. Rank by **reader demand = frequency × cost-per-occurrence**, not by coverage. The demand signal — **failed/zero-result searches and support-ticket tags** — is what makes it demand-weighted: a symbol no one searches for ranks at the bottom regardless of its docstring status, while a low-frequency gap that *generates tickets* (high cost) outranks a high-frequency one people self-recover from. Fill from the top, then measure deflection.
3. An error string marks a **stuck, high-intent user** about to file a ticket or churn — the highest cost-per-miss reader state — whereas a docstring serves a developer who's already reading and fine. You find the gap **without the search log by enumerating every user-visible error string/code from the source** (grep the codebase); that list *is* the coverage target, and each item is something a stuck user might paste verbatim. Document each one verbatim and findable.
4. The other **three Diátaxis quadrants — tutorials, how-to guides, and explanation** — can be entirely empty while reference (the only thing docstring tools see) is 100%. The artifact that surfaces it is a **doc-type coverage matrix** (products × the four doc types), which makes the empty columns visible as a fundable, org-wide pattern instead of hiding behind a reference-only percentage.
5. You **optimized the number, not the readers** — the 7 points likely came from stub docstrings or low-traffic internal symbols while the high-demand gaps stayed open; coverage is decoupled from outcomes and trivially gamed. You should have reported **demand-weighted gaps filled and the ticket deflection / failed-search-rate drop** they produced, keeping the coverage percentage as an appendix guardrail, never the headline.
6. **Search analytics → buy** (or use the platform's) — the failed-search log is too valuable to skip and rebuilding query infra rarely pays. **Ticket-topic tagging → build the taxonomy and habit** — the value is the scheme and discipline, not the helpdesk software. **Feedback widget → buy**, but treat thumbs as a noisy, biased tiebreaker and mine the free-text "what was missing?" field. **Never outsource the loop itself** — the correlation (which gaps drive which tickets), the ranking, and the triage are the program's core competency; a vendor dashboard shows page views, not a ranked owned deflection-measured backlog.
7. **No — it's not a coverage problem; the doc exists.** It's a **findability / information-architecture problem** (the reader can't reach the doc), which routes to [05 — Readability & IA](../05-readability-and-information-architecture/professional.md). (If the doc existed but were *wrong or stale*, that would be **rot**, routing to [03 — Freshness & Rot](../03-freshness-and-rot-metrics/professional.md).)

</details>

---

## Cheat Sheet

```
COVERAGE POLICY
  WRONG: repo-wide 100% docstring mandate
         → retroactive debt, gamed into `// the id`, number meaningless
  RIGHT: gate the DIFF — no new/modified public symbol without a doc
         → existing gaps go to the demand backlog, not a blanket mandate

DEMAND-DRIVEN GAP LOOP (continuous, not one-time)
  1 mine   failed searches + ticket tags + sales/onboarding + widget
  2 rank   frequency × cost-per-occurrence (NOT frequency alone)
  3 fill   top N, with an ASSIGNED owner + date
  4 measure deflection (searches succeed? tickets drop?) → feed ROI

HIGHEST-ROI GAP (almost always empty)
  error messages + API edges
  • enumerate every user-visible error string from source = the gap list
  • put the VERBATIM string on the page (copy-paste search must hit)
  • cover rate limits, pagination, retries, every non-2xx

DIÁTAXIS COVERAGE MATRIX (planning artifact, not a CI metric)
  products × {tutorial, how-to, reference, explanation}
  → coverage tools see ONLY the reference column
  → read columns for org-wide gaps; it's the funding pitch

OWNERSHIP
  a gap is nobody's job until you assign it
  • tech-writer triages the demand backlog (named role/rotation)
  • each pulled gap = named owner + date (not "the team should…")
  • content owner = surface owner; docs team owns process+findability

REPORTING (avoid the vanity trap)
  DON'T headline: "coverage 88% → 95%"
  DO headline:    gaps-filled (demand-ranked) + tickets deflected
                  + failed-search rate ↓ + time-to-first-success ↓
  coverage % = appendix guardrail, never the goal

BUILD vs BUY
  search analytics  → BUY (failed-search log is gold)
  ticket tagging    → BUILD the taxonomy + habit
  feedback widget   → BUY (low-signal tiebreaker; mine the free text)
  the loop/ranking  → ALWAYS OWN
```

---

## Summary

- **Gate the diff, not the history.** A retroactive whole-repo docstring mandate is the 100%-line-coverage anti-pattern in disguise — it dumps debt on the next editor, gets gamed into `// the id` noise, and renders the number meaningless. Forbid *adding* undocumented public API; route existing gaps to a demand-ranked backlog. This is the [diff-coverage](../../code-coverage/) analog for docs.
- **Run gap analysis as a demand-driven loop**, not a one-time audit: mine failed searches + ticket tags + sales/onboarding feedback → rank by *frequency × cost-per-occurrence* → fill the top → measure ticket deflection → feed the [ROI model](../06-measuring-docs-roi/professional.md). The failed-search log is the most direct, demand-weighted "what's missing?" signal you have.
- **Use a Diátaxis coverage matrix as the planning artifact.** Symbol coverage sees only the reference quadrant; 100% docstrings can coexist with zero tutorials, how-tos, and explanation. The matrix (products × doc types) makes the *shape* of the gap visible and fundable in a way no percentage can.
- **Error messages and API edges are the highest-ROI gap and almost always empty.** Every error string is a pre-identified, demand-validated gap marking a stuck user. Enumerate them from the source, document each *verbatim* and findable, and cover rate limits, pagination, retries, and every non-2xx.
- **Assign the gaps.** A missing doc blocks nothing, so it's nobody's job by default. A tech-writer triages the demand backlog; each pulled-in gap gets a named owner and a date; content ownership follows the surface owner.
- **Report demand-weighted outcomes, not raw coverage.** The percentage is a gameable vanity metric that trains leadership to ask for the wrong number. Headline gaps filled and tickets deflected; keep coverage as an appendix guardrail.

You can now run docs coverage and gap analysis as an organizational program that finds the gaps readers actually hit, assigns them, and proves the payoff in deflection rather than in percentage points. The remaining tier — [interview.md](interview.md) — consolidates the topic into the questions that probe whether someone understands why "documented" ≠ "valuable" and how to run the demand loop.

---

## Further Reading

- [Diátaxis](https://diataxis.fr/) (Daniele Procida) — the four-quadrant model your coverage *matrix* is built on, and why symbol coverage can't see three of the four.
- *Docs for Developers* (Bhatti, Corleissen, Lambourne, Nunez & Waters) — the chapters on measuring documentation, gap analysis, and reader feedback loops.
- Google's "[Measuring documentation quality](https://developers.google.com/tech-writing)" / developer-documentation work — outcome metrics (task success, deflection) over presence metrics.
- [Algolia DocSearch analytics](https://docsearch.algolia.com/) and your platform's search telemetry — operationalizing the failed-search log, the program's core signal.
- The [diff-cover](https://github.com/Bachmann1234/diff_cover) approach (from test coverage) — the conceptual template for "gate the diff, not the history," ported to docs.
- Support-ops literature on ticket deflection and self-service rate — the language and math behind tying filled gaps to ROI.

---

## Related Topics

- [06 — Measuring Docs ROI](../06-measuring-docs-roi/professional.md) — ticket deflection and self-service rate, the outcome the demand loop feeds and the only honest headline for a coverage program.
- [03 — Freshness & Rot Metrics](../03-freshness-and-rot-metrics/professional.md) — the sibling failure mode: a doc that *exists but is wrong*. Coverage is about absence; rot is about decay.
- [05 — Readability & Information Architecture](../05-readability-and-information-architecture/professional.md) — when a filled gap still doesn't get read, it's a findability problem, not a coverage one.
- [Code Coverage](../../code-coverage/) — the parent discipline this entire policy is analogized from: diff coverage, the 100%-target trap, and why presence ≠ value.
- [Engineering Metrics & DORA](../../engineering-metrics-and-dora/) — the broader practice of choosing outcome metrics over vanity metrics and not gaming the dashboard.
