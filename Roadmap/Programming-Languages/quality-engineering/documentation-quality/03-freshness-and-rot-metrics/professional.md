# Freshness & Rot Metrics — Professional Level

> **Roadmap:** [Documentation Quality](../README.md) → [Freshness & Rot Metrics](./) → Professional
> *The senior page taught you to measure rot on one corpus. This page is about running a freshness program across a whole org — where "is this doc stale?" stops being a script and becomes a question about ownership, incentives, leadership dashboards, and the uncomfortable politics of deleting thousands of pages nobody will admit are dead.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Ownership and Freshness SLAs at Scale](#ownership-and-freshness-slas-at-scale)
4. [The Doc Graveyard Problem, Org-Wide](#the-doc-graveyard-problem-org-wide)
5. [Making Rot Visible to Leadership Without Gaming It](#making-rot-visible-to-leadership-without-gaming-it)
6. [Embedding Freshness in the Workflow](#embedding-freshness-in-the-workflow)
7. [The Incentive Problem](#the-incentive-problem)
8. [Deciding What to Keep Fresh — Criticality Tiers](#deciding-what-to-keep-fresh--criticality-tiers)
9. [War Stories](#war-stories)
10. [Decision Frameworks](#decision-frameworks)
11. [Mental Models](#mental-models)
12. [Common Mistakes](#common-mistakes)
13. [Test Yourself](#test-yourself)
14. [Cheat Sheet](#cheat-sheet)
15. [Summary](#summary)
16. [Further Reading](#further-reading)
17. [Related Topics](#related-topics)

---

## Introduction

> Focus: **Running a doc-freshness program across a large org — ownership, SLAs, archiving, leadership dashboards, incentives, and anti-gaming — where the goal is "fewer, fresher" docs that people trust.**

The senior page gave you the instrumentation: staleness age, review-by dates, broken-link sweeps, snippet compilation, doc-vs-code divergence. You can point a script at a corpus and produce a rot report. That is necessary and nowhere near sufficient at org scale.

At the professional level the script is the easy 10%. The hard 90% is everything around it: getting five thousand wiki pages to *have* owners; setting a review cadence that doesn't collapse into ignored email; building bots that escalate and archive without becoming spam; showing leadership a rot number that drives action instead of becoming a vanity dial someone games with no-op edits; wiring freshness into the daily workflow so docs don't rot in the first place; and the deepest problem of all — *nobody is rewarded for updating docs*, which is the exact same root cause as technical debt.

The mental shift is this: a freshness program is not a measurement project, it's a **trust-restoration project**. A corpus where readers can't tell the good pages from the rotten ones has negative value — readers trust *none* of it and route around all of it. The job is to make trust legible again, and the counterintuitive lever is usually *deletion*, not authorship. This page is the pragmatic, battle-tested layer for the person who has to run that program and defend it in a leadership review.

---

## Prerequisites

- **Required:** [senior.md](senior.md) — staleness metrics, review-by dates, link/snippet/divergence checks, the half-life of a doc.
- **Required:** [02 — Testable & Executable Docs](../02-testable-and-executable-docs/professional.md) — the executable/tested signals you will tie freshness to, so "fresh" means *verified*, not *touched*.
- **Helpful:** You've owned a doc corpus (a team wiki, a product's docs site) and watched it rot.
- **Helpful:** You've tried to get a cross-team initiative adopted and felt the incentive gap firsthand.

---

## Ownership and Freshness SLAs at Scale

Every metric in the senior tier answers "*is* this doc stale?" The program-level question is "*who fixes it, and by when?*" — and that requires two things every doc must have: an **owner** and a **review cadence**. A doc with neither is, by definition, ungoverned: when it rots, no escalation path exists and no SLA can fire.

This is the model Google made famous internally and has written about publicly (in *Software Engineering at Google* and the developer-documentation guidance): **every important doc carries an explicit owner and a "last verified" date, and an automated system nags the owner when the date goes stale.** It is deliberately unglamorous — the entire mechanism is *owner + date + a bot that won't shut up* — and it works because it converts "the docs are rotting" (a diffuse, unactionable feeling) into "*your* doc is due for review" (a specific, assignable task).

The three pieces, concretely:

- **Owner.** A *person or a rotating role*, not a team name. "Owned by the Platform team" diffuses to nobody; "owned by the platform-docs on-call" assigns to exactly one person this week. Store it in machine-readable front matter, not prose:

  ```yaml
  ---
  title: Deploying the Billing Service
  owner: billing-oncall          # a role that always resolves to one human
  last_verified: 2026-04-12      # NOT last_edited — see the anti-gaming section
  review_cadence: 90d            # how long until this is "due"
  criticality: tier-1           # drives SLA severity (see criticality tiers)
  ---
  ```

- **Review cadence / SLA.** The cadence sets *when a review is due*; the SLA sets *what happens when it's overdue and by how long*. A reasonable shape:

  | State | Condition | Action |
  |---|---|---|
  | Fresh | `now - last_verified < cadence` | none |
  | Due | within the cadence window's tail | gentle reminder to owner |
  | Overdue | past cadence | escalate to owner + manager |
  | Abandoned | far past cadence *and* owner unresponsive | auto-archive (tier-dependent) |

- **The freshness bot.** Automation is non-negotiable at scale — no human re-reads five thousand pages on a calendar. The bot reads the front matter, computes state, and *acts*: opens a "review due" ticket assigned to the owner, escalates overdue ones to the owner's manager, reassigns when an owner has left the company (orphan detection against the org directory), and — for low-criticality docs — *archives* the abandoned ones automatically. The bot is the program; the SLA is just text without it.

> **The professional reality:** ownership is a *data-quality* problem before it's a process problem. The first time you run orphan detection against the directory, you'll find a third of your "owners" have left the company — pages owned by ghosts. Fixing that (reassign or archive) is usually the single highest-leverage week of the whole program, because an owner who doesn't exist guarantees the doc will never be reviewed.

---

## The Doc Graveyard Problem, Org-Wide

Here is the failure mode every large org reaches: a wiki with thousands of pages, most of them stale, and an organization-wide tacit agreement that *none of it can be trusted*. People stop reading the wiki and start asking in Slack — which is the market telling you, unambiguously, that your corpus has negative value.

The mechanism is worth stating precisely, because it's the entire justification for the deletion program that follows. **A reader cannot tell a good page from a rotten one by looking at it.** A confidently-written, well-formatted page that is silently two years out of date looks *exactly* like a confidently-written, well-formatted page that is correct. So the moment the stale fraction crosses some threshold, a rational reader stops trusting the *whole corpus* — not just the rotten pages, all of them — because the expected cost of acting on a wrong page exceeds the expected benefit of finding a right one. **Stale docs don't just fail to help; they poison the trust in the docs around them.** This is why "we have lots of documentation" is frequently *worse* than having little: a large rotting corpus is an active liability, not a dormant asset.

The counterintuitive consequence: **the highest-leverage documentation-quality move is often aggressive archiving, not writing.** Garbage-collecting the corpus — deleting or archiving the dead pages — *raises the trust* in everything that remains, because now "it's on the wiki and not archived" carries a credible signal. **"Fewer, fresher" beats "more, rotting"** is not an aesthetic preference; it's a direct consequence of how reader trust collapses.

Running the garbage collection without throwing away anything valuable:

- **Archive, don't hard-delete.** Move pages to a clearly-labeled, search-deprioritized archive (a banner: *"Archived 2026-05 — not maintained, may be wrong"*), not the void. This makes archiving *politically cheap* — you can always restore — which is what lets you be aggressive. Hard-deletion triggers loss-aversion fights; archiving sidesteps them.
- **Use signals, not vibes, to pick victims.** Combine *staleness* (last-verified age) with *traffic* (page views / search hits) and *links* (inbound references). The clearest archive candidates: old, unviewed, and unlinked. The dangerous quadrant is old *but* high-traffic — a stale page everyone reads is your most urgent *fix*, not an archive candidate (it's doing maximum damage).
- **Make "no decision" decay to archived.** The default for an abandoned low-criticality page should be *archival*, reached automatically by the bot if no owner acts. Requiring a human to actively choose deletion guarantees the graveyard grows forever, because deletion is nobody's job (the incentive problem, again).
- **Announce and provide a grace window.** "These N pages will be archived in two weeks unless an owner claims them" converts silence into consent and gives the rare genuinely-valuable orphan a chance to be rescued.

> **The hard truth:** the org will resist deletion far more than it resisted the rot — people equate page count with value and deletion with loss. The reframe that wins the argument: *you are not destroying information, you are restoring trust in the information that's left.* A wiki where everything not-archived is plausibly current is worth more than ten times the pages where nothing can be trusted.

---

## Making Rot Visible to Leadership Without Gaming It

Leadership funds what it can see. To get sustained investment in freshness you need a small set of numbers in a dashboard — and the moment you put a number on a dashboard, you've created a target someone can optimize. **Goodhart's law is the central hazard of this entire section: "when a measure becomes a target, it ceases to be a good measure."**

The metrics worth showing leadership are *rates and backlogs*, not raw counts:

- **% of critical docs fresh** — of your tier-1 docs, what fraction are within their review cadence. This is the headline number; scope it to *critical* docs so it's both meaningful and achievable.
- **Rot backlog** — count of overdue docs, ideally weighted by criticality. The "doc debt" equivalent of a bug backlog.
- **Rot rate** — how fast docs are *going* stale vs. being refreshed (an in/out flow, like defect arrival vs. close rate). A backlog that's flat but with a rising rot rate is a leading indicator of trouble.
- **Time-to-refresh** — once a doc goes overdue, how long until it's verified. Measures whether the SLA is real or theatre.

The trap is sharp and specific: **"freshness" measured as `last_verified` date is trivially gamed by a no-op edit.** Touching a doc to reset its timestamp — bumping a date, fixing a typo, running a bot that re-stamps everything — turns the metric green *without anyone verifying the doc is correct.* You get a 100%-fresh dashboard sitting on top of a corpus that's exactly as wrong as before. This is Goodhart in its purest form: the *proxy* (recent timestamp) got optimized, the *goal* (accurate docs) did not.

The defenses, in order of strength:

1. **Tie freshness to executable/tested signals, not to timestamps.** This is the strongest defense and the reason [02 — Testable & Executable Docs](../02-testable-and-executable-docs/professional.md) is a prerequisite. A doc whose code snippets *run in CI*, whose API reference is *generated from the spec*, whose commands are *smoke-tested* — that doc is fresh because it is *verified by a machine that can't be flattered by a date bump*. You cannot no-op-edit your way past a failing doctest. Wherever a doc *can* be made executable, freshness should mean "its tests pass," not "someone touched it."
2. **Make verification an explicit, attestable act.** `last_verified` should be set only by a deliberate "I re-read this and it's correct" action (a review checkbox, a signed PR, a bot-issued review ticket the owner closes) — *distinct from* `last_edited`. The two dates must be different fields; conflating them is what makes the metric gameable in the first place.
3. **Spot-audit the green.** Periodically sample "fresh" docs and actually check them. If audited-fresh docs are frequently wrong, your freshness metric is lying and you treat it as a *red* flag, not a green one. This is the human backstop that keeps the proxy honest.
4. **Report the metric's limits *to leadership, out loud.*** Tell them explicitly: "freshness measures *attention*, not *correctness*; we keep it honest by tying it to tests and spot-audits." A leader who understands the proxy won't push you to game it — and pre-empting the "why isn't this 100%?" question with "because 100% would mean we're gaming it" is how you protect the metric's integrity.

> **The Goodhart discipline:** the goal is *trustworthy docs*; the dashboard shows a *proxy*. The instant the proxy and the goal diverge — green dashboard, wrong docs — the program has failed *worse* than having no dashboard, because now leadership believes a lie. Anchor freshness to signals that *can't* be faked by attention alone (tests, generation, audits), and say the quiet part loud: a number that's easy to hit is a number that's easy to fake.

---

## Embedding Freshness in the Workflow

A freshness program that lives *outside* the daily workflow — a separate dashboard, a quarterly cleanup, a bot in a channel nobody reads — fights the rot *after* it happens and loses. The durable wins come from wiring freshness into the points where work already flows, so docs go stale less in the first place and staleness surfaces *at the moment of the change that caused it.* This is the documentation analogue of "shift left": catch the rot at the source, not in a downstream sweep.

The high-leverage integration points:

- **Docs in `CODEOWNERS`.** Put the docs directory (or specific doc paths) in your VCS's ownership file so doc changes route to the right reviewer automatically and the *owner* is the same machinery your code uses. This piggybacks doc ownership on a system engineers already respect, instead of inventing a parallel one they'll ignore.
- **The "you changed this API, its doc is now stale" PR check.** The single most effective workflow control. A CI check that detects when a PR touches code with an associated doc (the public API surface, a config schema, a CLI's flags) and *fails or warns* if the corresponding doc wasn't updated — or at least flags the doc's `last_verified` as now-suspect. It catches divergence *at the exact PR that introduced it*, when the author has the full context, instead of three months later when a reader hits the lie. Even a soft version ("⚠️ you changed `api/billing.go` but didn't touch `docs/billing.md` — is it still correct?") changes behavior.
- **Docs in the Definition of Done.** "Done" includes "docs updated *and* re-verified," enforced at PR review, not aspired to in a wiki page about process. If the DoD doesn't mention docs, docs are optional, and optional docs rot.
- **Generate what you can, so it can't drift.** The most reliable freshness control is *not maintaining the doc by hand at all*. API references generated from the spec/code, config docs generated from the schema, CLI help generated from the parser — these are structurally incapable of going stale relative to their source, because the source *is* the doc. Every doc you can generate is a doc you never have to nag an owner about.

> **The professional principle:** automation *prevents* rot; bots and dashboards only *detect* it. A `CODEOWNERS` entry plus a "you changed the API, check its doc" PR check stops a class of rot at the source; a quarterly cleanup just shovels it up afterward. Spend your first units of effort on the in-workflow controls — they have a far better ROI than any after-the-fact sweep, because not creating the rot beats finding it. (For the ROI lens on where to spend, see [06 — Measuring Docs ROI](../06-measuring-docs-roi/professional.md).)

---

## The Incentive Problem

Strip away the tooling and one root cause remains: **nobody is rewarded for updating docs.** Promotions cite shipped features, closed incidents, launched products — almost never "kept the deployment runbook accurate for two years." Updating a doc is pure cost to the individual (time, attention, no credit) and pure benefit to *others* (future readers, often on other teams). That is a textbook negative-externality / tragedy-of-the-commons structure, and it is **the exact same root cause as technical debt**: work that's globally valuable, locally unrewarded, and therefore chronically under-supplied. (This is why [Technical Debt Management](../../technical-debt-management/) is the closest sibling to this entire topic — same economics, same failure mode, often the same fixes.)

No amount of bot-nagging fixes an incentive gap; it just adds friction on top of it. The levers that actually move behavior:

- **Lower the cost of doing it.** The cheaper an update is, the more it happens. Docs-as-code (edit in the same PR as the code, in the same editor, reviewed by the same tooling) collapses the cost of a doc update from "context-switch to a separate wiki" to "add a paragraph to the diff." Generation drops the cost to *zero* for whatever it covers. Most "people won't update docs" problems are really "updating docs is annoying" problems.
- **Make the omission visible at review.** The "you changed the API, its doc is stale" PR check works *partly* as an incentive mechanism: it puts the doc gap in front of a reviewer, so skipping it becomes a visible choice rather than a silent default. Social visibility at review is a cheap, real incentive.
- **Reward it where rewards live.** If your org's promotion and performance machinery never credits docs, owners will rationally deprioritize them no matter how many bots email them. Getting "maintains critical docs" to *count* — in performance reviews, in team goals, in on-call rotation expectations — is the only lever that addresses the root cause rather than the symptom. It's also the hardest, because it requires management buy-in, not tooling.
- **Make it someone's *explicit* job, not everyone's diffuse hope.** A rotating "docs gardener" role, or folding doc-freshness into the on-call rotation's responsibilities, converts a diffuse commons (everyone's job = nobody's job) into an assigned duty with a name attached. Diffuse responsibility is how the graveyard got built.

> **The hard-won lesson:** treat doc rot as a *technical-debt* problem, because it *is* one — same incentive gap, same chronic under-investment, same fixes (make it cheap, make it visible, make it count, make it someone's job). A freshness program that's only tooling — bots, dashboards, SLAs — is treating the symptom. The bots make rot *visible*; only changing the incentive makes it *stop*.

---

## Deciding What to Keep Fresh — Criticality Tiers

The fantasy that sinks freshness programs is **"keep everything current."** You can't, and trying spreads finite reviewer attention so thin that *nothing* stays reliably fresh — including the docs that matter most. The professional move is the opposite of comprehensive: **tier docs by criticality, pour your freshness budget into the top tier, and let the bottom tier rot or auto-archive on purpose.** Deliberate, *triaged* rot at the bottom is what frees the budget to keep the top genuinely trustworthy.

A workable three-tier model (store the tier in front matter so the bot can set SLA severity from it):

| Tier | What's in it | Examples | Freshness policy |
|---|---|---|---|
| **Tier 1 — Critical** | Wrong-here-causes-an-incident-or-an-outage docs | Production runbooks, on-call playbooks, security/auth procedures, public API reference, the deploy guide | Short cadence (e.g. 30–90d), hard SLA, escalates to manager, *verified by tests where possible*, **never auto-archived** |
| **Tier 2 — Important** | Wrong-here-wastes-real-time docs | Architecture overviews, onboarding guides, internal service docs, design docs still in use | Moderate cadence (e.g. 6–12mo), soft escalation, reviewed-on-touch |
| **Tier 3 — Low-value / ephemeral** | Wrong-here-costs-little, or naturally transient | Old meeting notes, completed-project pages, brainstorms, superseded design docs | No active maintenance; **let it rot, auto-archive when abandoned** |

The criteria that place a doc in a tier:

- **Blast radius of being wrong.** A wrong runbook causes an outage at 3 a.m.; a wrong meeting note from 2023 costs nothing. *Cost-of-being-wrong*, not *cost-of-being-absent*, is the primary axis — it's what makes a runbook tier-1 even if it's read rarely.
- **Audience and traffic.** A page on the new-hire critical path or one many teams hit weekly earns a higher tier than a single-team backwater — but traffic is secondary to blast radius (a low-traffic runbook still outranks a high-traffic FAQ).
- **Half-life / volatility.** Docs about fast-moving surfaces (a churning API, current infra) need short cadences; docs about stable concepts (an architectural principle, a finished post-mortem) need long ones or none.

> **The professional stance:** *triaged* rot is a feature, not a failure. Explicitly deciding "tier-3 docs are allowed to go stale and auto-archive" is what makes "tier-1 docs are *always* fresh" actually achievable — finite reviewer attention, spent where being wrong is expensive. A program that refuses to let *anything* rot will, in practice, let *everything* rot equally, because it never concentrated its budget. Choose where the corpus is allowed to decay, so you can guarantee where it isn't.

---

## War Stories

**The 5,000-page wiki nobody trusted.** A mid-size company's internal wiki had grown to ~5,000 pages over a decade. Surveys and behavior agreed: engineers didn't trust *any* of it and defaulted to asking in Slack, because a stale page was indistinguishable from a current one and the stale fraction was clearly high. The fix was not a writing push — it was a deletion push. The team ran staleness × traffic × inbound-links, archived (with a restore-able banner, not hard-delete) everything old-unviewed-unlinked after a two-week "claim it or lose it" grace window, and ended up archiving roughly **70% of the corpus.** The remaining ~30% — now plausibly all current — got trusted again, and Slack-archaeology questions dropped. The lesson the whole org internalized: *the page count was the problem, not the asset.* "Fewer, fresher" beat "more, rotting" by a wide margin.

**The freshness metric gamed to green.** An org introduced a leadership dashboard with a single headline number: *% of docs updated in the last 90 days.* Within two quarters it was near 100% and leadership was delighted. Then an incident traced to a runbook that was *technically "fresh"* — last-edited inside the window — but the edit had been a one-line typo fix by a bot run that touched every page to "keep the metric healthy." The corpus was exactly as wrong as before; only the *timestamps* had moved. Goodhart, exactly: the proxy (recent edit) got optimized, the goal (correct docs) didn't. The fix was structural: split `last_edited` from `last_verified` (the latter set only by a deliberate review action), tie tier-1 freshness to *passing doctests* instead of dates, and spot-audit the green. The dashboard's number *dropped* — and for the first time it meant something.

**The doc-owner SLA that actually worked.** A platform team, drowning in stale docs and angry consumers, did the unglamorous thing: put an `owner` (a rotating on-call role, never a team name) and a `last_verified` date in every doc's front matter, tiered the docs, and ran a bot that opened a review ticket to the owner when a doc went past cadence, escalated to the manager when overdue, and auto-archived abandoned tier-3 pages. The first orphan-detection run was the revelation — about a third of "owners" had left the company; those pages were unmaintainable by construction. After reassigning the survivors and archiving the truly-orphaned, *% of tier-1 docs fresh* climbed and held above 90%, and — the real proof — consumer complaints about wrong platform docs fell sharply. Nothing clever; just owner + date + a bot that wouldn't quit, scoped to the docs that mattered.

---

## Decision Frameworks

**Should this doc have an owner + SLA, or be left alone? Ask:**
- Does being *wrong* here cause an incident or waste real time? → tier-1/2, owner + cadence + bot.
- Is it ephemeral or superseded (notes, finished projects)? → tier-3, no maintenance, let it auto-archive.
- Can no single human own it (it's "the team's")? → assign a *rotating role*, or it's effectively unowned.

**Archive this page, or fix it? Use staleness × traffic:**
- Old + unviewed + unlinked → **archive** (the clear graveyard quadrant).
- Old + *high-traffic* → **fix urgently** — it's doing maximum damage, never archive it.
- Fresh + unviewed → leave it; low cost either way.
- Default for *abandoned* low-criticality → **auto-archive** (no human decision required).

**Is my freshness metric trustworthy, or gameable? Ask:**
- Is `last_verified` distinct from `last_edited`, set only by a deliberate review? → if no, it's gameable today.
- Can the doc's freshness be tied to a *passing test* (doctest, generated reference)? → if yes, do that; it can't be faked by a date bump.
- When I spot-audit "fresh" docs, are they actually correct? → if no, treat the green as a *red flag*.

**Where do I spend the next unit of freshness effort? Prefer, in order:**
- Generate the doc (zero maintenance) > in-workflow PR check (catch rot at source) > owner+SLA+bot (manage rot) > quarterly cleanup (shovel rot afterward).

**What do I show leadership? Show:**
- *% of critical (tier-1) docs fresh*, rot backlog (criticality-weighted), rot rate (in vs out), time-to-refresh — *and* the explicit caveat that freshness measures attention, not correctness, kept honest by tests + audits.

---

## Mental Models

- **A freshness program is a trust-restoration project, not a measurement project.** The goal isn't a green dashboard; it's a corpus where "it's not archived" is a credible signal of "it's probably right." Measurement serves trust, not the reverse.

- **Stale docs poison the docs around them.** A reader can't tell a good page from a rotten one by looking, so past a threshold they trust *none* of the corpus. This is why a large rotting wiki is worse than a small one — and why deletion raises trust.

- **"Fewer, fresher" beats "more, rotting."** Page count is not an asset; *trustworthy* page count is. Aggressive archiving is a quality move, not vandalism — it restores the signal of everything that survives.

- **Freshness measures attention; correctness needs verification.** A recent timestamp means someone *touched* the doc, not that it's *right*. Tie freshness to tests/generation wherever you can, because a passing doctest can't be flattered by a date bump.

- **Doc rot is technical debt with a different file extension.** Same root cause — globally valuable, locally unrewarded work that's chronically under-supplied. The fixes are the same: make it cheap, make it visible, make it count, make it someone's job.

- **Automation prevents rot; bots only detect it.** A "you changed the API, check its doc" PR check stops rot at the source; a dashboard just reports the body count. Spend on the in-workflow controls first.

- **You can't keep everything fresh, so choose where it's allowed to rot.** Triaged rot at the bottom tier is what funds guaranteed freshness at the top. Refusing to let *anything* rot lets *everything* rot equally.

---

## Common Mistakes

1. **Owners that are team names or ghosts.** "Owned by Platform" assigns to nobody; an owner who left the company guarantees the doc is never reviewed. Use *rotating roles that resolve to one human*, and run orphan-detection against the directory on day one — you'll find a third of owners are gone.

2. **A freshness metric that's just `last_edited`.** Trivially gamed by a no-op edit; a bot that re-stamps every page turns it 100% green over a corpus that's exactly as wrong as before. Split `last_verified` (deliberate review only) from `last_edited`, and tie freshness to *tests* where possible.

3. **Refusing to delete.** Equating page count with value lets the graveyard grow forever, dragging trust in the whole corpus to zero. Archive (restore-ably, with a banner) aggressively; make *abandoned* the default path to archived. "Fewer, fresher" is the goal.

4. **Archiving the high-traffic stale page.** Old-but-heavily-read is your most *urgent fix*, not an archive candidate — it's doing maximum damage. Combine staleness *with traffic*; archive old-unviewed-unlinked, fix old-popular.

5. **Trying to keep everything fresh.** Finite reviewer attention spread across the whole corpus keeps *nothing* reliably fresh. Tier by criticality; concentrate the budget on tier-1; let tier-3 rot and auto-archive on purpose.

6. **A program that's all bots, no incentive.** Nagging an incentive gap just adds friction. Doc rot is technical debt — make updates cheap (docs-as-code, generation), visible (PR checks), and rewarded (performance/on-call), or it never stops.

7. **Detecting rot instead of preventing it.** A quarterly cleanup shovels up rot after the fact; a `CODEOWNERS` entry + "you changed the API, check its doc" PR check stops a class of it at the source. Prevention beats detection on ROI every time.

8. **Showing leadership a number without its caveat.** A green freshness dial that leadership believes means "correct" is worse than no dial — it's a lie they're funding. Report the limit out loud: freshness = attention, kept honest by tests + spot-audits.

---

## Test Yourself

1. Your org's 4,000-page wiki is universally distrusted; everyone asks in Slack instead. Explain *why* distrust spreads to the whole corpus (not just the stale pages), and what the highest-leverage fix is — and why it's counterintuitive.
2. A leadership dashboard shows "% of docs updated in the last 90 days" hitting ~100%, yet an incident traces to a stale-but-"fresh" runbook. Name the law at work and give three structural fixes that make the metric trustworthy again.
3. What two pieces of front-matter metadata must *every* governed doc carry for an SLA to be enforceable, and what's the classic data-quality problem you'll find the first time you validate the first one?
4. Why is `last_verified` necessarily a *different field* from `last_edited`? What goes wrong if you conflate them?
5. You have to choose between archiving an old page and fixing it. Give the two-signal rule, and name the one quadrant that must *never* be archived.
6. Doc rot and technical debt are described as having "the exact same root cause." State that root cause, and name two fixes that apply identically to both.
7. Defend the claim that *deliberately letting tier-3 docs rot* makes the freshness program *better*, not worse.
8. Name the single most effective in-workflow control for preventing doc rot, and explain why catching rot there beats catching it in a quarterly sweep.

<details>
<summary>Answers</summary>

1. A reader **can't distinguish a good page from a rotten one by looking** — a confident, well-formatted stale page looks identical to a correct one. So once the stale fraction crosses a threshold, the rational reader stops trusting the *entire* corpus (expected cost of acting on a wrong page exceeds the benefit of finding a right one). The counterintuitive fix is **aggressive archiving, not writing**: deleting/archiving the dead pages *raises* trust in everything that remains, because "not archived" becomes a credible signal. "Fewer, fresher" beats "more, rotting."

2. **Goodhart's law** — the proxy (recent edit) got optimized, the goal (correct docs) didn't; the metric was gamed by no-op edits/bot re-stamping. Fixes: (a) split `last_verified` (set only by a deliberate review/attestation) from `last_edited`; (b) **tie tier-1 freshness to passing tests** (doctests, generated references) that can't be faked by a date bump; (c) **spot-audit the green** — sample "fresh" docs and verify them; if they're wrong, treat green as a red flag. Plus: report the metric's limit to leadership out loud.

3. An **owner** (a person/rotating role, not a team name) and a **`last_verified` date** (plus a cadence). The classic data-quality problem: **orphaned docs** — the first orphan-detection run against the org directory typically finds ~a third of "owners" have left the company, so those docs are unmaintainable by construction. Fixing that (reassign or archive) is the highest-leverage early step.

4. `last_edited` records *any* touch (a typo, a date bump); `last_verified` records a *deliberate "I re-read this and it's correct"* act. If you conflate them, **any no-op edit silently marks the doc verified** — which is exactly the gaming hole that makes a freshness metric meaningless. They must be separate fields, and only a real review may set `last_verified`.

5. **Staleness × traffic.** Archive **old + unviewed + unlinked** (the clear graveyard quadrant). **Never archive old + high-traffic** — a stale page everyone reads is your most *urgent fix*, because it's doing maximum damage; archiving it would hide an active liability.

6. Root cause: **work that is globally valuable but locally unrewarded** (a negative externality / tragedy of the commons) — nobody gets credit for keeping docs (or code) clean, so it's chronically under-supplied. Identical fixes (any two): make it **cheap** (docs-as-code / lower-friction refactoring), make it **visible** (PR checks / debt dashboards), make it **count** (performance/promotion credit), make it **someone's explicit job** (a gardener role / debt rotation).

7. Reviewer attention is finite. If you try to keep *everything* fresh, you spread that attention so thin that *nothing* stays reliably fresh — including tier-1. **Deliberately letting tier-3 rot (and auto-archive) frees the budget to guarantee tier-1 is always fresh.** Triaged rot at the bottom is precisely what makes guaranteed freshness at the top achievable; a program that won't let anything rot lets everything rot equally.

8. The **"you changed this API, its doc is now stale" PR check** (a CI check that flags/fails when a PR touches code with an associated doc that wasn't updated/re-verified). It catches divergence **at the exact PR that introduced it**, when the author has full context — whereas a quarterly sweep finds it months later, after readers have already hit the lie, and with the original author long gone from the context. Prevention at the source beats detection after the fact on ROI.

</details>

---

## Cheat Sheet

```
THE PROGRAM IN ONE LINE
  owner + last_verified date + a bot that nags/escalates/archives
  (Google's documented practice; unglamorous on purpose; it works)

FRONT MATTER (machine-readable, drives the bot)
  owner: <rotating-role>        a role that resolves to ONE human, not a team name
  last_verified: <date>         set ONLY by a deliberate review (NOT last_edited)
  review_cadence: <30d|90d|1y>  when a review is due
  criticality: <tier-1|2|3>     drives SLA severity

SLA STATES (bot computes + acts)
  fresh    < cadence            none
  due      cadence tail         remind owner
  overdue  past cadence         escalate to owner + manager
  abandoned far past + silent   auto-archive (tier-3 only)

THE GRAVEYARD FIX (fewer, fresher > more, rotting)
  stale page ≈ correct page to a reader  →  past a threshold, trust the WHOLE corpus = 0
  archive (restore-able banner, NOT hard-delete) on staleness × traffic × links:
    old + unviewed + unlinked   → ARCHIVE
    old + HIGH-traffic          → FIX (never archive — max damage)
  default for abandoned         → auto-archive (no human decision)

ANTI-GAMING (Goodhart is the enemy)
  bad : freshness = last_edited        (no-op edit / bot re-stamp → fake green)
  good: last_verified ≠ last_edited    (deliberate review only)
  best: freshness = passing doctest / generated-from-source  (can't be date-bumped)
  +   : spot-audit the green; report the caveat to leadership out loud

LEADERSHIP DASHBOARD (rates + backlogs, not raw counts)
  % of tier-1 docs fresh   |  rot backlog (weighted)
  rot rate (in vs out)     |  time-to-refresh
  ALWAYS with caveat: "freshness = attention, not correctness"

IN-WORKFLOW CONTROLS (prevent > detect)
  docs in CODEOWNERS                      route changes to the owner
  "changed API, check its doc" PR check   catch divergence at the source PR
  docs in Definition of Done              "done" includes updated + verified
  GENERATE what you can                   can't drift from its own source

INCENTIVE (same root cause as tech debt)
  nobody is rewarded for updating docs → chronically under-supplied
  make it: cheap (docs-as-code/gen) · visible (PR check) · count (perf/on-call) · owned (role)

CRITICALITY TIERS (you can't keep everything fresh)
  T1 critical (wrong = incident)   short cadence, hard SLA, test-verified, NEVER auto-archive
  T2 important (wrong = wasted time) moderate cadence, reviewed-on-touch
  T3 low/ephemeral                  no maintenance, let it rot + auto-archive
  axis = COST OF BEING WRONG (blast radius) > traffic > volatility
```

---

## Summary

- **The program is owner + `last_verified` date + a bot** that nags, escalates, reassigns, and archives — Google's documented, deliberately-unglamorous practice. It works by turning "the docs are rotting" into "*your* doc is due." Owners must be *rotating roles that resolve to one human*, validated against the directory (the first orphan run finds a third of owners have left).
- **A large rotting corpus has negative value:** a reader can't tell a good page from a rotten one, so past a threshold they trust *none* of it. The highest-leverage fix is usually **aggressive archiving, not writing** — "fewer, fresher" beats "more, rotting" because deletion *restores trust* in what survives. Archive restore-ably, on staleness × traffic × links, with *abandoned* defaulting to archived.
- **Show leadership rates and backlogs** (% of tier-1 fresh, rot backlog, rot rate, time-to-refresh) — but **Goodhart is the central hazard.** Freshness-as-`last_edited` is gamed by no-op edits. Defend it by splitting `last_verified` from `last_edited`, **tying freshness to executable/tested signals from [02](../02-testable-and-executable-docs/professional.md)** (a passing doctest can't be date-bumped), spot-auditing the green, and stating the metric's limits out loud.
- **Embed freshness in the workflow** — docs in `CODEOWNERS`, a "you changed the API, check its doc" PR check, docs in the Definition of Done, and generation for anything that can be generated. **Automation prevents rot; bots only detect it** — spend on the in-workflow controls first.
- **The root problem is incentives:** nobody is rewarded for updating docs — the *same* root cause as technical debt. Tooling alone treats the symptom; the cure is making updates cheap, visible, rewarded, and someone's explicit job.
- **You can't keep everything fresh, so tier by criticality** and let the bottom tier rot/auto-archive on purpose. *Triaged* rot at tier-3 is what funds *guaranteed* freshness at tier-1. The placement axis is cost-of-being-wrong (blast radius), then traffic, then volatility.

You can now stand up and defend a freshness program across an org — ownership, SLAs, an archiving campaign, an anti-gaming dashboard, and a criticality model — without it collapsing into vanity metrics or a graveyard. The remaining tier — [interview.md](interview.md) — distills all of it into the questions that test whether someone has actually run one.

---

## Further Reading

- *Software Engineering at Google* (Winters, Manshreck, Wright), the documentation chapter — the public source for the owner + freshness-date + automated-nagging practice at scale.
- [Google Developer Documentation Style Guide](https://developers.google.com/style) and Google's "measuring documentation quality" writing — freshness as an operational property, not a vibe.
- *Docs for Developers* (Bhatti, Corleissen, Lambourne, Nunez & Waters) — maintaining, measuring, and deprecating docs across their lifecycle.
- Marty Cagan / Will Larson on **incentives and the commons** — the negative-externality framing that explains why docs (and tech debt) are chronically under-invested.
- The original framing of **Goodhart's law** ("when a measure becomes a target…") — the failure mode every freshness dashboard must defend against.
- The **Write the Docs** community resources on doc gardening, ownership, and aggressive archiving — practitioner accounts of "fewer, fresher" in the wild.

---

## Related Topics

- [junior.md](junior.md) — what doc rot is and the basic staleness/broken-link signals.
- [senior.md](senior.md) — the instrumentation: staleness age, review-by dates, snippet compilation, doc-vs-code divergence, the half-life of a doc.
- [interview.md](interview.md) — the freshness/rot questions that probe whether you've actually run a program.
- [02 — Testable & Executable Docs](../02-testable-and-executable-docs/professional.md) — the executable/tested signals that make freshness mean *verified*, not *touched* — the core anti-gaming defense.
- [06 — Measuring Docs ROI](../06-measuring-docs-roi/professional.md) — the ROI lens for deciding where freshness effort pays off, and the same not-gaming-the-metric discipline.
- [01 — What Makes Docs Good](../01-what-makes-docs-good/professional.md) — currency as one of the core quality attributes this topic operationalizes.
- [Technical Debt Management](../../technical-debt-management/) — the closest sibling: doc rot is technical debt with the same incentive economics and the same fixes.
- [Code Craft → Documentation](../../../code-craft/documentation/) — the writing-craft complement: *how* to write and maintain the docs whose freshness you're governing here.
