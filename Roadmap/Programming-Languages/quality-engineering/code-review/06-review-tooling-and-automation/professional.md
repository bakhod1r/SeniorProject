# Review Tooling & Automation — Professional Level

> **Roadmap:** [Code Review](../README.md) → Review Tooling & Automation
> *The senior page taught you which tools exist and how to wire them into one repo. This page is about owning the review-automation platform for a whole org — where the question stops being "which linter?" and becomes "which of the forty bots that now comment on every PR are earning their place, and which ones taught three hundred engineers to ignore the comment box entirely."*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concept 1 — The Leverage Thesis: Drive the Mechanical to Tooling](#core-concept-1--the-leverage-thesis-drive-the-mechanical-to-tooling)
5. [Core Concept 2 — Signal/Noise Governance: The Central Problem at Scale](#core-concept-2--signalnoise-governance-the-central-problem-at-scale)
6. [Core Concept 3 — The Paved Road: Make the Good Path the Default](#core-concept-3--the-paved-road-make-the-good-path-the-default)
7. [Core Concept 4 — CODEOWNERS as Routing Infrastructure](#core-concept-4--codeowners-as-routing-infrastructure)
8. [Core Concept 5 — AI Review as an Org Rollout](#core-concept-5--ai-review-as-an-org-rollout)
9. [Core Concept 6 — Measuring the Platform](#core-concept-6--measuring-the-platform)
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

> Focus: **Building and curating the review-automation platform across an org, where the scarce resource is human reviewer attention and the central failure mode is automated noise.**

The senior page framed tooling as a per-repo concern: pick a formatter, configure a linter, gate the merge on CI, set up CODEOWNERS. At the professional level the same components show up in a different job. You are the platform team, and your customers are every engineer in the org. The decisions look like this: a security team wants their scanner to comment on every PR; a well-meaning staff engineer ships a bot that flags TODO comments; a VP read a blog post and wants an AI reviewer rolled out by Q3; a repo's reviews have stalled because CODEOWNERS routes everything to one person who left for parental leave.

None of these are new *concepts* — formatters, linters, CI gates, CODEOWNERS, bots, and AI assistants are all known. The professional skill is **judgment at scale**: knowing that every check you add spends from a finite attention budget, that an analysis tool nobody acts on is worse than no tool because it trains people to tune out *all* tooling, that an AI reviewer is a triage layer and not an approver, and that the single highest-leverage thing a platform team does is make the well-tooled review path the *default* so every repo inherits it for free. This page is the pragmatic, battle-tested layer of running review automation as an org-wide system, not a repo-local config.

---

## Prerequisites

- **Required:** [senior.md](senior.md) — formatters, linters, CI integration, CODEOWNERS, the bot landscape, and AI-review tools at the single-repo level.
- **Required:** You've configured CI and at least one static-analysis tool, and watched a noisy check get ignored.
- **Helpful:** You've operated a platform/DevEx function, or been the person other teams ask to "just add our check to the default."
- **Helpful:** You've measured review tempo or developer-experience metrics and had to act on what they showed.

---

## Glossary

- **Signal/noise ratio (review):** the fraction of automated comments on a PR that a human acts on (fixes, suppresses with reason, or genuinely considers) versus those ignored or dismissed. The governing health metric of a review-automation platform.
- **Action rate / fix rate:** of the findings a bot or check surfaces, the percentage that result in a code change or an explicit suppression. The Tricorder team's primary keep/kill criterion.
- **Paved road (golden path):** the supported, well-tooled default configuration the platform team maintains, which repos adopt to get formatting, lint, CI, CODEOWNERS, and curated bots without bespoke setup.
- **Severity budget:** a cap on how many comments (or how many of each severity) a given bot is allowed to post on one PR, used to prevent any single tool from dominating the review surface.
- **False-positive SLA:** a commitment by a check's owner to investigate and resolve reported false positives within a bound, or have the check demoted/removed.
- **CODEOWNERS:** the file mapping path globs to required reviewers/teams, used by the forge (GitHub/GitLab) to auto-request review and enforce approval on protected branches.
- **Quality gate:** a blocking CI condition (coverage threshold, no new criticals, no policy violations) that must pass before merge — distinct from a bot *comment*, which is advisory.
- **Triage (AI review):** using an AI reviewer to summarize, label, and surface candidate issues for the author/human reviewer — not to approve or block.
- **Tricorder:** Google's program-analysis platform; the source of the canonical "only surface analysis with a high fix rate, and give a *not useful* feedback loop" lesson.

---

## Core Concept 1 — The Leverage Thesis: Drive the Mechanical to Tooling

The entire strategy of a review-automation platform rests on one thesis: **human reviewer attention is the scarce, expensive, non-scalable resource, and every mechanical thing a human checks by hand is leverage left on the table.** A staff engineer reading a diff to flag a missing trailing comma, an inconsistent import order, an unhandled error return, or a known-bad API call is burning the most valuable review capacity in the org on work a machine does perfectly and for free.

So the platform team's first job is to **push the mechanical down to tooling at org scale**, freeing humans to do what only humans can: judge design, correctness, naming, and whether the change should exist at all. Concretely, the mechanical layer is:

- **Formatters as a non-negotiable default** (`gofmt`/`goimports`, `prettier`, `black`/`ruff format`, `rustfmt`, `clang-format`). Style is not reviewed; it's *applied*. This single move ends the most corrosive class of review comment.
- **Linters and static analysis wired into CI as quality gates** — not as advisory noise, but as blocking checks for the high-confidence, high-value rules. This is where the platform connects to [Static Analysis & Linting](../../static-analysis/) and [Quality Gates](../../quality-gates/): the analysis runs, and a curated subset *blocks*, while the rest stays quiet.
- **CI as the mechanical reviewer** — tests, build, type-check, security scan — so a human never has to manually verify "does it compile / do tests pass."

```yaml
# A paved-road PR check: the machine handles the mechanical, gated.
name: pr-checks
on: pull_request
jobs:
  mechanical:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: make fmt-check        # formatter: fails if not formatted (no human comment needed)
      - run: make lint             # curated lint set, blocking
      - run: make test             # CI is the mechanical reviewer
      - run: make typecheck
```

> **The leverage math:** if a formatter and a tuned linter eliminate even three low-value comments per PR across an org doing thousands of PRs a week, you've returned thousands of reviewer-minutes to design and correctness work — every week, forever. That is the highest-ROI move a platform team makes, and it costs almost nothing once it's the default. The goal isn't "more automation"; it's *more human attention on the things that need a human.*

---

## Core Concept 2 — Signal/Noise Governance: The Central Problem at Scale

Here is the problem that defines the job, and the one most platform teams discover too late. Automation that helps in one repo becomes a liability across fifty repos, because **every team wants to add their bot, their check, their scanner — and left ungoverned, the PR comment surface fills with low-value automated chatter until humans tune out *all* of it.** The failure isn't any single noisy bot; it's the *aggregate*, and its cost is catastrophic: once engineers learn the comment box is mostly noise, they stop reading it — including the one comment in a hundred that was a real bug or a real security finding.

This is the central professional issue, and the canonical treatment is Google's **Tricorder** experience. Their hard-won rules, which you should adopt wholesale:

- **Only surface analysis with a high fix rate.** If engineers don't act on a check's findings, the check is noise by definition. Tricorder's bar was roughly that a meaningful fraction of findings get fixed; analyses below the bar are not shown.
- **Give every comment a "not useful" feedback loop.** A one-click "Please fix" / "Not useful" on each automated comment turns signal/noise from an opinion into a *measured* number, per check.
- **Fix or suppress — never just warn.** A finding the author can't act on is worthless. Every comment must point to an action.
- **Kill checks that aren't actioned.** A check with a low fix rate and high "not useful" rate gets demoted to non-blocking, then removed. This is the part teams flinch at and must not.

The platform team's governance toolkit:

| Lever | What it does |
|---|---|
| **Curated allowlist of commenting bots** | Only bots the platform has vetted may post on PRs. New bots apply; they don't self-onboard. |
| **Severity budgets** | A per-bot cap on comments per PR (e.g., "at most 3, and only ≥ high severity inline"). Prevents any one tool from dominating. |
| **False-positive SLAs** | Each check's owner commits to resolving reported false positives within a bound, or the check is demoted. |
| **Action-rate dashboards** | Per-bot fix/dismiss rates, reviewed quarterly. The data that justifies a kill. |
| **Default-quiet, opt-in-loud** | New analyses start advisory/collapsed; they earn the right to comment inline or block by demonstrating a high fix rate. |

```text
The governance loop (run this continuously):
  measure  → per-check action rate + "not useful" rate
  triage   → high fix rate? promote / keep.  low fix rate? tune.  still low? kill.
  enforce  → severity budget + FP SLA per bot
  defend   → no new commenting bot without passing the bar
```

> **The non-negotiable discipline:** a platform team's job is not to *add* checks; it's to *curate* them. Adding is easy and locally rewarding; the courage is in killing the check a team is proud of because nobody acts on it. The moment your engineers describe PR comments as "mostly noise I scroll past," you have already lost the security finding you haven't noticed yet. Signal/noise is not a nice-to-have metric — it is the survival metric of the entire platform.

---

## Core Concept 3 — The Paved Road: Make the Good Path the Default

The leverage thesis and signal/noise governance only pay off if teams actually adopt them — and you cannot win adoption by writing a wiki page and asking nicely. The mechanism that works is the **paved road**: a supported, opinionated default that gives a repo formatting + lint + CI + CODEOWNERS + the *good* bots for free, so that the well-tooled path is the path of least resistance. Adoption happens because the paved road is *easier* than rolling your own, not because of a mandate.

Concretely, a paved road is a template plus shared, versioned config the platform owns:

```text
org-paved-road/
├── .github/
│   ├── workflows/pr-checks.yml      # fmt-check, lint, test, typecheck, security scan
│   └── CODEOWNERS                    # sane defaults, team-scoped
├── .pre-commit-config.yaml          # formatter + fast linters, shared, pinned
├── renovate.json                    # one curated dependency bot, configured
└── lint/                            # the org's curated, versioned lint ruleset
```

The platform owns these as **versioned, centrally-updated artifacts** (a reusable workflow, a shared pre-commit repo, a published lint config). When the platform tunes a rule or culls a bot, every repo on the paved road inherits the change — that's the leverage. A new repo created from the template is born hardened, formatted, gated, and routed, with zero bespoke setup.

The crucial design tension — **standardize vs. team autonomy** — is resolved by *org defaults + opt-in extensions*: a small, mandatory core (formatter, the blocking lint/security set, CODEOWNERS) that is the same everywhere and ends a thousand style debates, plus an *extension* mechanism where a team can add their own non-blocking checks within the governance rules (severity budget, FP SLA). You standardize the floor; you let teams raise their own ceiling.

> **Why the paved road beats the mandate:** mandates get worked around, generate resentment, and rot the moment the platform team isn't policing them. A paved road that's genuinely the easiest option gets adopted *and stays current*, because teams want the free upgrades. The platform team's product is not a policy document; it's a default so good that opting out feels like extra work.

---

## Core Concept 4 — CODEOWNERS as Routing Infrastructure

At the repo level CODEOWNERS is "who reviews what." At org scale it is **routing infrastructure** — and like any routing layer, it fails in production in specific, expensive ways. A bad CODEOWNERS entry doesn't error; it *silently stalls reviews* by sending them somewhere they'll never be answered.

The platform-level concerns:

- **Route to teams, not individuals.** `@org/payments-team` survives a person leaving, going on leave, or being overloaded; `@alice` becomes a single point of failure the day Alice is out. Individual owners are the most common cause of stalled reviews.
- **Specificity and order matter.** Later matching patterns win in GitHub CODEOWNERS; a too-broad catch-all at the bottom can swallow paths you meant to route precisely. Audit that the *intended* owner actually matches.
- **Stale-owner detection.** Ownership rots: teams reorg, code moves, owners leave. The platform should detect entries pointing at archived teams, empty teams, or owners with no recent activity, and flag them — a stale owner is an invisible review-stall generator.
- **Load awareness.** A single team owning a huge surface becomes a bottleneck. CODEOWNERS plus auto-assignment (round-robin within a team, load-balanced) keeps any one reviewer from drowning — which connects directly to review-load distribution as a metric (Concept 6 and [07 — Review Metrics & Tempo](../07-review-metrics-and-tempo/professional.md)).

```text
# CODEOWNERS — routing rules, ordered (later wins in GitHub)
*                         @org/eng-leads          # fallback, deliberately broad
/services/payments/       @org/payments-team       # team, not a person
/services/payments/pci/   @org/payments-security   # more specific path → narrower owner
/infra/                   @org/platform-team
# anti-pattern lurking: a single individual here = a stall waiting to happen
```

> **The routing-infra mindset:** treat CODEOWNERS like a load balancer config, not a contact list. It should route to *teams* with healthy capacity, be audited for stale targets, and be load-aware. The failure mode is invisible — reviews don't error, they just sit — so the platform must *actively* detect stale and overloaded owners rather than wait for someone to complain that their PR has been open for a week.

---

## Core Concept 5 — AI Review as an Org Rollout

AI code review (CodeRabbit, GitHub Copilot review, Graphite, in-house LLM reviewers) is the highest-variance addition to a review platform: rolled out well it returns real reviewer time; rolled out badly it is the single fastest way to destroy the signal/noise governance you spent years building. The professional decisions are policy, measurement, and risk — not "which tool."

**Build vs. buy.** Buying (CodeRabbit / Copilot review / Graphite) gets you a maintained product, fast; you accept their model behavior, their pricing, and — critically — that *your code leaves your org* to a third party. Building in-house gives you control over prompts, policy, and data residency, but you now own a product with an LLM bill, latency, prompt-injection surface, and a maintenance burden most orgs underestimate. For the overwhelming majority, **buy and scope tightly** beats build; build only with a strong data-residency or differentiation reason and a team to own it.

**The cardinal policy: AI is triage and author-first-pass, NOT an approver.** The AI reviewer summarizes the diff, surfaces candidate issues, and gives the *author* a first pass to clean up before a human looks — so humans review better, pre-triaged diffs. It does **not** approve, and its presence does **not** reduce the human reviewer's ownership of the decision. The instant an AI "approval" can satisfy a required review, you have built a rubber-stamp machine.

**Measuring its value — the only question that matters:** *did it reduce human review load, or just add noise?* You measure exactly like any other bot (Concept 2): comment **action rate**, "not useful" rate, and whether time-to-first-*human*-review and human comment volume went *down* after rollout. An AI reviewer that posts twenty nits per PR at a 5% action rate is not an asset; it's the most expensive noise source you've ever deployed, and it's training people to ignore the comment box at scale.

**The risks the platform team owns:**

- **Security / privacy review.** Code leaving the org to a vendor is a data-governance decision: review the vendor's retention, training-use, and access controls; check license/IP exposure; involve security/legal *before* rollout, not after.
- **Over-trust / rubber-stamping.** "The bot approved it" is a real, documented failure (see War Stories). Policy and UI must make clear the AI is advisory; the human still owns the call.
- **Deskilling.** Junior engineers who lean on AI for first-pass review may not build the reviewing muscle. The AI should *augment* learning (explain *why*), not replace the human-review apprenticeship.
- **Cost.** Per-PR LLM cost across thousands of PRs is a real line item; track cost-per-actioned-comment, not just raw spend.

> **The scoping rule that saves the rollout:** start AI review as **summary + author-self-review only**, behind an opt-in, with action-rate measurement from day one. Earn the right to post inline comments by demonstrating a high action rate, exactly as you'd gate any bot. The teams that flooded PRs with AI nits and tanked trust skipped this and went straight to "comment on everything." AI review is not exempt from signal/noise governance — it is the *biggest test of it*.

---

## Core Concept 6 — Measuring the Platform

You cannot govern what you don't measure, and a review-automation platform lives or dies on a small set of numbers that tell you whether automation is helping humans or burying them. These tie directly into [Engineering Metrics & DORA](../../engineering-metrics-and-dora/) and [07 — Review Metrics & Tempo](../07-review-metrics-and-tempo/professional.md); the platform-specific cuts are:

| Metric | What it tells you | Watch for |
|---|---|---|
| **Time-to-first-review** | Is the routing (CODEOWNERS) and capacity healthy? | Spikes localize to stale/overloaded owners. |
| **Bot-comment action rate** (per bot) | Is each automated source signal or noise? | < ~10–25% sustained → tune or kill that bot. |
| **Automated-vs-human catch ratio** | Is the mechanical layer doing its job? | Humans catching mechanical issues → a gate is missing. |
| **Review-load distribution** | Is any team/person a bottleneck? | Long tail on one owner → rebalance CODEOWNERS. |
| **"Not useful" rate** (per bot) | Direct human verdict on each check | Rising → erosion of trust in the whole surface. |

Two cautions a staff/principal owner must hold:

1. **Goodhart's law applies hard here.** "Time-to-first-review" optimized naively produces fast, useless rubber-stamp reviews. Pair every velocity metric with a quality counter-metric (e.g., escaped-defect or change-failure rate from [DORA](../../engineering-metrics-and-dora/)). Never ship a metric to a leaderboard.
2. **Measure the platform, not the people.** These numbers exist to find *which bot to kill* and *which owner is overloaded* — system problems — not to rank engineers by review speed. The moment they're used to evaluate individuals, you get gaming and the data goes dark.

> **The one dashboard that matters:** per-bot action rate, sorted ascending. The bottom of that list is your kill list. If you build only one piece of platform measurement, build that — it operationalizes the entire signal/noise discipline and turns "this feels noisy" into "this bot has a 6% action rate; it's gone next sprint."

---

## War Stories

**The eight-bot repo that buried a real security finding.** A busy service repo had accreted eight commenting bots over two years — a linter mirror, a TODO-flagger, a license checker, two overlapping security scanners, a complexity warner, a spell-checker, and a "did you update the changelog?" nagger. Every PR opened with twenty-plus automated comments, and engineers had universally learned to collapse the whole thread and scroll to the human review. Then one of the security scanners flagged a genuine injection risk — and it sat, unread, in the noise, until it shipped and surfaced in a pentest. The platform team culled the eight to **two high-precision checks** (one security scanner with a tuned ruleset, one dependency bot), put the rest behind a non-blocking, collapsed summary, and the security scanner's findings started getting *read and fixed*. The lesson burned in: the danger of noise isn't annoyance, it's that real signal dies in it.

**The AI reviewer that tanked trust in a week.** A team rolled out a bought AI reviewer with the default "comment on everything" config to look modern. It posted ten to thirty comments per PR — style nits the formatter already handled, speculative "consider extracting this," and confident-but-wrong claims about code it had misread. Within a week engineers were dismissing every AI comment unread, and the *action rate sat near 4%*. Worse, the noise bled onto the human reviewers' comments, which now also got skimmed. The platform team yanked it back to **summary + author-self-review only**, no inline comments, measured action rate, and only re-enabled narrow inline categories that cleared a 25% action-rate bar. Same tool, opposite outcome — the difference was scoping and measurement, not the vendor.

**The CODEOWNERS that auto-routed into a black hole.** A repo's `/services/billing/` was owned by `@maria` — fine for a year, until Maria went on three-month parental leave. Every billing PR auto-requested her, sat with no other required reviewer, and stalled; authors didn't notice because the PR *looked* correctly routed (it had a reviewer assigned, just an absent one). Cycle time for billing changes silently doubled before anyone connected it to the leave. The fix was structural, not personal: the platform mandated **team owners, not individuals**, in the paved-road CODEOWNERS, and added stale-owner detection that flags any entry pointing at a single person or an inactive account.

**The formatter rollout that ended a million style debates.** Before the platform standardized formatters org-wide, code review threads were *full* of style: brace placement, import order, line length, quote style — endless, unwinnable, morale-sapping. The platform team made `prettier`/`gofmt`/`black` the non-negotiable paved-road default, applied in pre-commit and gated in CI, and explicitly declared style *not reviewable*. The volume of style comments dropped to essentially zero overnight, reviewers redirected that attention to design and correctness, and the recurring "whose style is right" arguments simply ended. The highest-ROI, lowest-controversy move the team made all year — and the one engineers thanked them for most.

**The over-trust incident: "the bot approved it."** An org's AI reviewer was (against policy) configured so its sign-off showed up prominently as a green check next to the human review slot. On a Friday-evening PR, a tired reviewer saw the AI's confident "looks good, no issues" and approved with a quick skim. The change had a subtle concurrency bug the AI hadn't understood and the human hadn't looked for *because the bot said it was fine*. It caused an incident. The post-mortem's finding wasn't "the AI was wrong" — AIs are wrong sometimes — it was that the **tooling had positioned the AI as an approver**, inviting humans to defer. The fix: AI output relabeled as advisory triage, visually separated from approvals, and never counted toward required reviews. Over-trust is a *design* failure of the platform, not a discipline failure of the reviewer.

---

## Decision Frameworks

**What to automate vs. leave to humans:**

| Concern | Automate (tooling/CI) | Leave to humans |
|---|---|---|
| Formatting / style | ✅ Formatter, applied not reviewed | ❌ Never a human comment |
| Mechanical correctness (compiles, tests pass, types) | ✅ CI gate | — |
| Known-bad patterns, high-confidence lint | ✅ Blocking lint subset | — |
| Security/dependency vulns (high precision) | ✅ Curated scanner, gated | Human triages ambiguous findings |
| Design, architecture, "should this exist?" | ❌ | ✅ Humans own this |
| Naming, readability, intent | Assist (AI triage) | ✅ Human judgment decides |
| Domain correctness, edge cases | AI may *surface* candidates | ✅ Human verifies and owns |

**Bot ecosystem curation — keep / tune / kill:**

| Signal | Keep | Tune | Kill |
|---|---|---|---|
| Action rate | High (acted on) | Medium, fixable | Low + sustained |
| "Not useful" rate | Low | Moderate | High |
| False positives | Rare, owner has FP SLA | Frequent but fixable | Frequent, no owner / no SLA |
| Overlap with another check | Unique value | Partial overlap → merge | Fully redundant |
| Severity respected | Within budget | Over budget → cap | Spams regardless |

**AI review — where to use / where not / how to measure:**

| Use AI review for | Do NOT use AI review for | Measure with |
|---|---|---|
| Diff summaries / context | Approving or blocking merges | Comment action rate |
| Author-first-pass cleanup | Counting toward required reviews | "Not useful" rate |
| Surfacing candidate issues (triage) | Final correctness/design sign-off | Δ time-to-first-*human*-review |
| Explaining unfamiliar code | Anything where IP/data can't leave org | Human comment volume (should drop) |
| Catching obvious omissions | Replacing the human-review apprenticeship | Cost per actioned comment |

**Build vs. buy review tooling:**

| Factor | Buy (CodeRabbit / Copilot / Graphite) | Build in-house |
|---|---|---|
| Time to value | Fast | Slow |
| Data residency / IP | Code leaves org — vet vendor | Stays in-house |
| Control over policy/prompts | Limited | Full |
| Ongoing cost | Subscription + per-seat/PR | LLM bill + a team to own it |
| Maintenance burden | Vendor's | Yours (often underestimated) |
| **Default choice** | **Most orgs: buy, scope tight** | Only with strong residency/differentiation reason |

**Async vs. sync vs. pair by change type:**

| Change type | Default mode | Why |
|---|---|---|
| Small, mechanical, well-covered by CI | Async PR | Tooling does the work; human glance suffices |
| Routine feature, moderate size | Async PR | The standard paved-road path |
| Large refactor / architectural | Sync walkthrough or design pre-review | Async drowns; align before the diff exists |
| High-risk (security, payments, data-loss) | Sync + extra required reviewer | Human judgment is the point; don't rush it |
| Novel/exploratory or onboarding | Pair / mob | Real-time knowledge transfer beats async comments |

---

## Mental Models

- **Human attention is the budget; every check spends from it.** Automation isn't free even when it's free to run — each comment costs reviewer attention. A platform team's job is to *spend that budget well*, which means saying no to most proposed checks.

- **An unactioned check is worse than no check.** It doesn't just fail to help; it trains people to ignore the comment surface, killing the signal of the checks that *do* work — and eventually the real bug or security finding dies in the noise.

- **The paved road beats the mandate.** Make the well-tooled path the easiest path and adoption is automatic and self-maintaining. Mandate it and people route around you. Your product is a default, not a policy.

- **CODEOWNERS is a load balancer, not a contact list.** Route to teams with capacity, audit for stale targets, balance load. Its failures are invisible (reviews stall, not error), so you must detect them actively.

- **AI is a triage layer, never an approver.** It pre-digests the diff so humans review better; it does not own the decision. The moment the tooling lets "the bot approved" satisfy a review, you've built a rubber-stamp machine and an incident generator.

- **Per-bot action rate is the heartbeat.** Sorted ascending, the bottom of that list is your kill list. It turns "this feels noisy" into a number you can act on.

---

## Common Mistakes

1. **Reviewing what a formatter should apply.** Style comments are pure waste and corrosive to morale. Make a formatter the non-negotiable default, gate it in CI, and declare style *not reviewable*.

2. **Letting any team self-onboard a commenting bot.** Ungoverned, the comment surface fills with low-value chatter and humans tune out everything. Gate new commenting bots behind a vetting bar (action rate, FP SLA, severity budget).

3. **Adding checks but never killing them.** Platform teams love to add; the courage is in removing the check nobody acts on. No action-rate dashboard and no kill process = inevitable noise creep.

4. **Rolling out AI review as "comment on everything."** This floods PRs and tanks trust in a week. Start as summary + author-self-review, measure action rate, and earn inline comments category by category.

5. **Treating AI sign-off as an approval.** "The bot approved it" causes rubber-stamping and incidents. AI is advisory triage, visually separated from approvals, never counted toward required reviews.

6. **CODEOWNERS pointing at individuals.** A single owner is a stall waiting for a vacation. Route to *teams*, detect stale/overloaded owners, and load-balance assignment.

7. **Mandating instead of paving.** A wiki page and a policy get worked around and rot. Ship a template + versioned shared config so the good path is the easy path and upgrades propagate for free.

8. **Putting platform metrics on a leaderboard.** Velocity metrics gamed to individuals produce fast rubber-stamps and dark data. Measure the *system* (which bot to kill, which owner is overloaded), pair velocity with a quality counter-metric, and never rank people.

---

## Test Yourself

1. Why is an automated check that nobody acts on described as *worse* than no check at all? What is the second-order cost?
2. State the core Tricorder lessons a platform team should adopt for governing which analyses may comment on PRs.
3. A VP wants an AI reviewer rolled out org-wide by next quarter. Give the policy you'd ship it under and the one question that decides whether it's earning its place.
4. Explain why a paved road beats a mandate for getting teams onto good review tooling, and what the platform actually ships to make it work.
5. A team's billing PRs have silently doubled in cycle time. CODEOWNERS "looks correct." What's the likely cause and the structural fix?
6. Name the single most useful platform measurement for governing the bot ecosystem, and how you'd use it.
7. You're deciding build vs. buy for AI review. What's the default recommendation for most orgs, and the two factors that would flip it to build?

<details>
<summary>Answers</summary>

1. An unactioned check trains engineers to ignore the automated-comment surface. The second-order cost is that they then ignore *all* automated comments — including the high-value checks and the occasional real bug or security finding — so the noise actively destroys the signal of everything around it. (See the eight-bot war story: a real injection finding shipped because it died in the noise.)
2. **Only surface analysis with a high fix/action rate**; **give every comment a "not useful" feedback loop** so signal/noise is measured, not guessed; **fix-or-suppress — every finding must point to an action**; **demote then kill checks with low action and high "not useful" rates.** Plus enforcement: curated allowlist, severity budgets, false-positive SLAs.
3. **Policy:** AI is *triage and author-first-pass, not an approver* — it summarizes and surfaces candidates, the human still owns the decision, and its output never counts toward required reviews; start as summary + self-review, opt-in, and earn inline comments via action rate; security/privacy review of code leaving the org before rollout. **Deciding question:** did it *reduce human review load* (lower time-to-first-human-review, fewer human comments, high comment action rate) or just add noise?
4. A paved road makes the well-tooled path (formatting + lint + CI + CODEOWNERS + curated bots) the *easiest* path, so adoption is voluntary and self-maintaining and central tuning propagates for free; a mandate gets worked around, breeds resentment, and rots without policing. The platform ships **versioned shared artifacts**: a reusable CI workflow, a shared pre-commit config, a published lint ruleset, and a repo template with sane CODEOWNERS.
5. The path is almost certainly owned by an **individual** (e.g., `@maria`) who is out/overloaded; the PR *looks* routed because a reviewer is assigned — just an absent one — so the stall is invisible. **Structural fix:** route to **teams, not individuals** in the paved-road CODEOWNERS, plus stale-owner detection that flags single-person or inactive-account owners.
6. **Per-bot comment action rate, sorted ascending.** The bottom of that list is the kill list: bots with sustained low action (and high "not useful") rates get tuned, demoted to non-blocking, then removed. It operationalizes signal/noise governance as a number instead of a vibe.
7. **Default: buy and scope tightly** — faster time-to-value and no obligation to own an LLM product. Flip to **build** only with (a) a hard **data-residency / IP** constraint that forbids code leaving the org, or (b) a genuine **differentiation** need plus a team committed to owning the prompts, cost, latency, and maintenance.

</details>

---

## Cheat Sheet

```text
LEVERAGE THESIS
  human attention = scarce, expensive, non-scalable
  → push the MECHANICAL to tooling: formatter (applied, not reviewed),
    curated lint + CI as gates, tests/build/typecheck as the mechanical reviewer
  → humans do design / correctness / "should this exist?"

SIGNAL/NOISE GOVERNANCE  (the central job)
  Tricorder rules:
    only surface high fix-rate analysis
    every comment gets a "not useful" feedback loop  (measure it)
    fix-or-suppress — never just warn
    kill checks that aren't actioned
  enforce: curated bot allowlist · severity budgets · false-positive SLAs
  THE DASHBOARD: per-bot action rate, sorted ascending = your kill list

PAVED ROAD  (adoption mechanism)
  versioned shared: reusable CI workflow + pre-commit + lint ruleset + repo template
  org defaults (mandatory floor) + opt-in extensions (within governance)
  good path = easy path → adoption + free upgrades.  Pave, don't mandate.

CODEOWNERS = ROUTING INFRA  (load balancer, not contact list)
  route to TEAMS not individuals      (individual = stall on vacation)
  later pattern wins (GitHub) — audit intended owner matches
  detect stale/inactive/overloaded owners; load-balance assignment

AI REVIEW  (highest variance)
  POLICY: triage + author-first-pass, NEVER an approver / required review
  rollout: summary + self-review first → earn inline by action rate (≥~25%)
  measure: action rate, "not useful" rate, Δ human review load, $/actioned comment
  risks: code leaves org (sec/privacy review) · over-trust ("bot approved") · deskilling · cost
  build vs buy: MOST ORGS BUY + scope tight; build only for data-residency/differentiation

MEASURE THE PLATFORM (not the people)
  time-to-first-review · per-bot action rate · automated-vs-human catch ratio
  · review-load distribution · "not useful" rate
  Goodhart: pair velocity with a quality counter-metric; never a leaderboard
```

---

## Summary

- **The leverage thesis is the whole strategy:** human reviewer attention is the scarce resource, so the platform team's first job is to push the **mechanical** (style, compile, tests, high-confidence lint, vuln scans) down to formatters + CI gates org-wide — connecting [static analysis](../../static-analysis/) and [quality gates](../../quality-gates/) — freeing humans for design and correctness.
- **Signal/noise governance is the central professional problem.** Every team wants to add a bot; ungoverned, the PR comment surface fills with low-value chatter and humans tune out *all* of it — including real findings. Adopt the **Tricorder** discipline: only surface high-fix-rate analysis, give every comment a "not useful" loop, fix-or-suppress, and **kill** checks nobody acts on. Enforce with curated allowlists, severity budgets, and false-positive SLAs.
- **The paved road beats the mandate:** ship versioned shared config (reusable workflow, pre-commit, lint ruleset, repo template) so the well-tooled path is the *easy* path; standardize a mandatory floor, allow opt-in extensions, and propagate upgrades for free.
- **CODEOWNERS is routing infrastructure** — route to teams not individuals, audit for stale/overloaded owners, and load-balance, because its failures are invisible stalls, not errors.
- **AI review is an org rollout, not a feature toggle:** the cardinal policy is **triage and author-first-pass, never an approver**; roll out as summary + self-review and earn inline comments by action rate; measure whether it *reduced human load*; and own the risks — code leaving the org, over-trust ("the bot approved it"), deskilling, and cost. For most orgs, **buy and scope tight** over build.
- **Measure the platform, not the people:** time-to-first-review, per-bot action rate (your kill list), automated-vs-human catch ratio, and review-load distribution — paired with a quality counter-metric per [Engineering Metrics & DORA](../../engineering-metrics-and-dora/) and never put on a leaderboard.

You can now run review automation as an org-wide system: maximizing human leverage through tooling, governing the bot ecosystem so signal survives, paving the default path, and rolling out AI review without lighting your signal/noise discipline on fire. The remaining tier — [interview.md](interview.md) — consolidates the topic into the questions that probe whether someone can actually own a review platform.

---

## Further Reading

- [Google, "Lessons from Building Static Analysis Tools at Google" (Tricorder)](https://research.google/pubs/lessons-from-building-static-analysis-tools-at-google/) — the canonical source for the high-fix-rate bar, the "not useful" feedback loop, and fix-or-suppress; the foundation of signal/noise governance.
- A balanced, data-driven evaluation of AI code review (look for vendor-neutral studies measuring comment action/acceptance rates, not marketing) — for grounding the "did it reduce load or add noise?" question before rollout.
- [GitHub docs — CODEOWNERS, protected branches, and required reviews](https://docs.github.com/en/repositories/managing-your-repos-settings-and-features/customizing-your-repository/about-code-owners) — the routing-infrastructure mechanics and pattern precedence.
- [GitHub docs — required status checks and merge protections](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches) — wiring quality gates as blocking checks on the paved road.
- *Software Engineering at Google* (Winters, Manshreck, Wright), code-review and tooling chapters — the org-scale leverage and standardization argument in depth.
- [interview.md](interview.md) — the full topic distilled into interview questions on owning a review-automation platform.

---

## Related Topics

- [01 — What to Look For & In What Order](../01-what-to-look-for-and-order/professional.md) — what humans should spend their freed-up attention on once tooling owns the mechanical.
- [07 — Review Metrics & Tempo](../07-review-metrics-and-tempo/professional.md) — time-to-first-review, load distribution, and the velocity/quality metric pairing.
- [Static Analysis & Linting](../../static-analysis/) — the analysis layer the platform curates into gates and (sparingly) comments.
- [Quality Gates](../../quality-gates/) — turning curated, high-confidence checks into blocking merge conditions.
- [Engineering Metrics & DORA](../../engineering-metrics-and-dora/) — the org-level outcome metrics that keep review-platform velocity honest.
