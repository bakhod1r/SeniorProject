# Tracking & Prioritizing — Middle Level

> **Roadmap:** [Technical Debt Management](../README.md) → Tracking & Prioritizing
> *The junior page made the case that debt should be written down somewhere. This page is about the somewhere — the trade-offs between an issue label, a debt register, and an in-code marker — and the prioritization math that decides which item on that list you actually pay first. The default is "the loudest debt"; the answer is "the highest-interest debt in the code you're about to touch anyway."*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Where Debt Lives — and Why Naked TODOs Fail](#where-debt-lives--and-why-naked-todos-fail)
4. [Anatomy of a Good Debt Ticket](#anatomy-of-a-good-debt-ticket)
5. [Prioritization Frameworks, Applied to Debt](#prioritization-frameworks-applied-to-debt)
6. [Cost of Delay and WSJF — the Math](#cost-of-delay-and-wsjf--the-math)
7. [The Interest-Rate Rule — Pay High-Churn Debt First](#the-interest-rate-rule--pay-high-churn-debt-first)
8. [Tie Debt to the Work That Touches It](#tie-debt-to-the-work-that-touches-it)
9. [Worked Example — Ranking Four Debts by WSJF](#worked-example--ranking-four-debts-by-wsjf)
10. [Mental Models](#mental-models)
11. [Common Mistakes](#common-mistakes)
12. [Test Yourself](#test-yourself)
13. [Cheat Sheet](#cheat-sheet)
14. [Summary](#summary)
15. [Further Reading](#further-reading)
16. [Related Topics](#related-topics)

---

## Introduction

> Focus: **How do I run a debt-tracking and prioritization practice that actually changes what gets worked on?**

At the junior level, the message was simple: don't carry debt in your head, write it down. True, but incomplete. *Where* you write it down decides whether it's ever seen again, and *what order* you work the list in decides whether you're paying down the debt that's hurting you or just the debt that's easiest to describe.

Two failure modes dominate teams that "track their debt." The first is the **graveyard register** — a spreadsheet or a `tech-debt` label with 340 items, none touched in a year, that everyone has quietly stopped reading. The second is **priority by volume**: the debt that gets fixed is whichever a senior engineer complained about loudest in standup, not the debt charging the highest interest. This page gives you the mechanics to avoid both: a tracking scheme matched to the *kind* of debt, a ticket template that captures the economics (not just "this is ugly"), and a prioritization model — impact×effort, Cost of Delay, **WSJF**, and the interest-rate rule — that produces a defensible order. The throughline: the cheapest debt to pay is the debt in code you're *already opening for another reason*, so the best "tracking" links debt to the feature work that will pass through it.

---

## Prerequisites

- **Required:** You've read [junior.md](junior.md) and can explain principal vs interest.
- **Required:** You can read a hotspot — churn × complexity — from [02 — Identifying & Quantifying](../02-identifying-and-quantifying/middle.md). Interest-rate prioritization is built on it.
- **Helpful:** You've felt a debt register go stale, or watched a `// TODO` survive three years and four owners.
- **Helpful:** A working sense of your team's backlog tool (Jira, Linear, GitHub Issues) and how items get scheduled into a sprint.

---

## Where Debt Lives — and Why Naked TODOs Fail

There is no single right home for debt. Different *kinds* of debt want different homes, and the trade-off is always the same axis: **proximity to the code** (so it's found when relevant) versus **visibility to planning** (so it competes for time). Here are the four real options and what each is good and bad at.

| Home | Good at | Bad at | Use for |
|---|---|---|---|
| **Issue tracker + `tech-debt` label** | Competes in the same backlog as features; planning can see it | Drifts far from the code; goes stale; label becomes a junk drawer | Debt big enough to schedule as its own work |
| **Dedicated debt register / backlog** | One curated, rankable view of all debt; survives sprint churn | Yet another list to maintain; invisible to people who live in the issue tracker | Portfolio-level debt you triage periodically |
| **ADR (architecture decision record)** | Captures *design* debt with the reasoning and the trade-off accepted | Wrong tool for small, local debt; not a work queue | "We chose X knowing it won't scale past Y" — deliberate design debt |
| **In-code marker that links out** | Right next to the code; impossible to miss when you touch it | Invisible to planning unless it links to a ticket | Local debt you'll fix when you next open the file |

The in-code marker deserves special attention because it's the most abused. A **naked TODO** — `// TODO: clean this up` — fails for structural reasons, not laziness:

- **No owner.** Nobody is accountable, so nobody acts. Git blame finds who *wrote* it, not who *owns* it.
- **No context.** "Clean this up" doesn't say what's wrong, what it costs, or what "clean" looks like. The next reader can't act without re-deriving the whole problem.
- **No external handle.** It can't be searched, counted, prioritized, or scheduled by anyone not reading this exact line. It's invisible to planning by construction.
- **No expiry.** It has no trigger and no deadline, so the default outcome is *forever*. Studies of large codebases routinely find TODOs years old, outliving the person and often the feature.

The fix is the **linked marker** — a TODO that names an owner and points to a real ticket:

```go
// TODO(byashin, DEBT-412): O(n²) lookup; fine at <1k rows, see ticket for the
// hash-index fix. Pay when this path gets hot — current p99 is 40ms at 600 rows.
```

This pattern works because it satisfies both ends of the axis at once: it sits *in the code* (found when you touch it) **and** carries a ticket ID (visible to planning, searchable, countable). `grep -rn "TODO(" .` gives you an instant census; a CI rule can fail the build on a `TODO(` with no ticket reference. The marker is the breadcrumb; the ticket is the record.

> **Key insight:** A TODO and a ticket are not competitors — they're two ends of one link. The TODO's only job is to be *unmissable when you're in the code*; the ticket's job is to be *schedulable when you're in planning*. A naked TODO breaks because it does the first job and silently drops the second, so the debt never reaches anyone with the authority to fund fixing it.

---

## Anatomy of a Good Debt Ticket

Most debt tickets are useless because they record a *feeling* ("the auth module is a mess") instead of a *decision input*. A ticket that will actually get prioritized has to answer the questions a triage will ask. Five fields are non-negotiable.

1. **Location** — exactly where the debt lives: file, module, service, the function. Precise enough that someone can open it in thirty seconds. Vague location is the #1 reason debt tickets are never picked up.
2. **The interest it charges** — the *ongoing* cost of leaving it. Not "it's ugly" but "every change here takes ~2× longer and needs a senior reviewer because the control flow is untestable." This is the field that justifies paying down principal; without it the ticket is a complaint.
3. **Trigger** — the condition under which this becomes worth fixing. Most often "**fix when you next touch `X`**," sometimes "when this endpoint exceeds N rps" or "before we add the next payment provider." The trigger is what stops the ticket rotting in a backlog: it ties the fix to an event that will actually occur.
4. **Estimated remediation** — a rough size of the fix (hours, days, or t-shirt size). It doesn't need to be precise; it needs to exist, because every prioritization model divides value by effort. An unestimated ticket can't be ranked.
5. **Risk if ignored** — what happens if you *never* pay it. "Nothing, it just stays slightly slow" is a legitimate and useful answer — it tells you to deprioritize. "An outage when traffic doubles" is a different ticket entirely. This separates debt you can carry indefinitely from debt with a fuse.

Here is the template. Keep it short — a ticket nobody fills in is worse than no template.

```markdown
## Debt: [one-line summary]

**Location:**  payments/refund_service.go → applyRefund(), lines ~80–140
**Interest:**  Every refund-rule change touches a 60-line if/else; ~2× dev time,
               always needs senior review, no unit tests possible as written.
**Trigger:**   Fix when we add the next refund rule (Q3 partial-refunds epic).
**Remediation:** ~2 days — extract a rule table + strategy per rule type.
**Risk if ignored:** Medium — each new rule raises regression risk; one bad
               edit already caused INC-204. Not urgent; compounds slowly.
**Hotspot?**  Yes — top-10 by churn last 90 days (see hotspot report).
**Links:**    TODO(byashin, DEBT-412) in refund_service.go; relates to DEBT-388.
```

The optional **Hotspot?** line is the bridge to the interest-rate rule below: a debt sitting in high-churn code charges far more interest than the same debt in code nobody edits, and you want that fact on the ticket where the prioritizer will see it.

> **Key insight:** The fields that make a debt ticket *good* are exactly the inputs a prioritization model *needs* — interest is value-per-unit-time, remediation is job size, risk is the tail. Writing a complete ticket and ranking it are the same act done at two different times. A ticket you can't rank is a ticket that wasn't finished.

---

## Prioritization Frameworks, Applied to Debt

Once debt is captured, the question is order. Four frameworks scale from a sticky-note triage to a defensible number, in increasing rigor.

**1. Impact × Effort matrix.** The fastest triage: plot each item on two axes — *impact* (how much it hurts) and *effort* (how much to fix) — into four quadrants.

```
            LOW EFFORT          HIGH EFFORT
HIGH    ┌──────────────────┬──────────────────┐
IMPACT  │   QUICK WINS     │   BIG BETS        │
        │   do first       │   plan & schedule │
        ├──────────────────┼──────────────────┤
LOW     │   FILL-INS       │   MONEY PITS      │
IMPACT  │   if idle        │   avoid / drop    │
        └──────────────────┴──────────────────┘
```

Do **quick wins** now, **schedule big bets**, do **fill-ins** opportunistically, and explicitly *decide not to do* the money pits — high effort for low return is debt you should consciously carry, not silently feel guilty about. The matrix is great for a fast group sort and useless for fine-grained ranking — two items in the same quadrant are unordered.

**2. Cost of Delay (CoD).** The economic core of every model below: *how much value do we lose, per unit time, by not doing this yet?* Debt's CoD is mostly the **interest** — the recurring drag it imposes on every change passing through it, plus any risk cost. Reframing "this is ugly" as "this costs us roughly two engineer-days a month in slowed changes" is the single most powerful move in this whole topic, because it converts an aesthetic argument into a number a product manager can weigh against a feature.

**3. WSJF (Weighted Shortest Job First).** Cost of Delay divided by job size. It answers the real scheduling question — not "what's most valuable?" but "what gives the most value *per unit of effort*, so we do short high-value work before long high-value work." This is the workhorse; the next section does the math.

**4. The interest-rate rule.** A debt-specific heuristic that *feeds* the models above: when estimating a debt's CoD, weight it by the **churn** of the code it lives in. High-interest debt is debt in code you change constantly; that's where the interest actually compounds. Covered in its own section.

> **Key insight:** These aren't four competing choices — they're one idea at four resolutions. Impact×effort is CoD-over-effort eyeballed into quadrants; WSJF is the same ratio computed; the interest-rate rule is how you *estimate the CoD numerator* for debt specifically. Pick the resolution that matches the stakes: a sticky note for a quick triage, a WSJF table when you're defending the order to someone who controls the roadmap.

---

## Cost of Delay and WSJF — the Math

WSJF comes from SAFe but the arithmetic is provider-neutral and exactly right for debt. The formula:

```
              Cost of Delay
WSJF  =  ─────────────────────
               Job Size
```

You rank by WSJF descending — highest first. The intuition is a queue: if you must serialize work, doing the **shortest, highest-cost-of-delay** item first minimizes total value lost, the same logic as shortest-job-first scheduling. A cheap fix that stops a big ongoing bleed should jump ahead of an expensive fix that stops a small one.

To make CoD estimable without false precision, SAFe decomposes it into three components, each scored on a *relative* scale (commonly a Fibonacci-ish 1–10, where you only need the items to be comparable to each other, not absolute):

- **User/business value** — what's gained (or stops being lost) by doing it. For debt: faster delivery, fewer incidents, less risk.
- **Time criticality** — how the value decays if you wait. Debt with a deadline ("before the next provider integration") or accelerating interest scores high; debt that's stable scores low.
- **Risk reduction / opportunity enablement (RR|OE)** — does fixing it remove a hazard or unblock future work? Debt blocking a whole roadmap line scores high here even if its direct value is modest.

```
Cost of Delay  =  Value  +  Time-criticality  +  Risk-reduction/Opportunity
```

Then divide by **Job Size** (relative effort — your story points or a 1–10 size). Two rules keep this honest:

1. **Score relatively, in one sitting, as a group.** WSJF's numbers are meaningless in isolation; their *only* purpose is to order items against each other. Score a whole batch together so a "5" means the same thing across the list.
2. **Never hide effort in the numerator.** Effort belongs in the denominator. If you let "it's hard" lower the value score *and* raise the size, you double-count and the cheap-but-valuable items stop surfacing — which defeats the entire point of the "shortest job" in WSJF.

A worked CoD for one debt item, scoring 1–10:

```
Debt: untestable refund logic (DEBT-412)
  Value (faster, safer refund changes) ......... 6
  Time-criticality (Q3 epic needs it) .......... 7
  Risk reduction (stop INC-204-class bugs) ..... 5
  ────────────────────────────────────────────────
  Cost of Delay = 6 + 7 + 5 = 18
  Job Size = 4
  WSJF = 18 / 4 = 4.5
```

That 4.5 means nothing alone. It means everything next to the other three items' WSJF — which is the next section.

---

## The Interest-Rate Rule — Pay High-Interest Debt First

A loan's damage is *principal × interest rate × time*. Debt is the same: the cost isn't the size of the mess (principal), it's how *often* you pay interest on it. **You pay interest on a piece of debt every time you read or change the code around it.** So the rate is, almost exactly, the code's **churn** — how frequently it's modified.

This yields the sharpest single heuristic in debt prioritization:

> **Pay down the highest-interest debt first = the messiest code in the files you change most often.**

Consider two debts of identical ugliness:

- **Debt A:** a tangled, untested module in `payments/` that's edited in 40% of all PRs. Every one of those PRs pays the interest — slower changes, extra review, regression risk.
- **Debt B:** an equally tangled module in `legacy/reporting/` that hasn't been touched in 18 months and isn't on any roadmap.

Same principal. Wildly different cost. Debt A compounds with every sprint; Debt B's interest is effectively *zero* because nobody ever opens the file to pay it. Fixing B feels productive — the diff is just as big, the code just as improved — but it changes *nothing* about your delivery speed, because you weren't paying interest on it anyway.

This is why **hotspots** (churn × complexity, from [02 — Identifying & Quantifying](../02-identifying-and-quantifying/middle.md)) are the backbone of debt prioritization, not just detection. Complexity alone says "this is hard"; churn × complexity says "this is hard *and you keep touching it*" — which is precisely *high principal × high rate*, the debt actually draining you. In WSJF terms, the interest-rate rule is how you set the **value** and **time-criticality** of the CoD numerator: high-churn debt scores high on both because the savings recur on every change and compound over time.

> **Key insight:** Improving code you rarely touch is a refactoring with no economic return — you paid principal to retire a debt that was charging ~0% interest. The highest-leverage debt is almost never the *ugliest* code; it's the *ugliest code in your highest-churn files*. Sort your debt by the churn of where it lives before you sort it by anything else.

---

## Tie Debt to the Work That Touches It

Here is the uncomfortable empirical fact about standalone debt tickets: **most never get scheduled.** They lose every sprint-planning fight to features, because a feature has a visible customer asking and a date, while "refactor the refund service" has neither. The register grows; the work doesn't happen. This is the graveyard from the introduction, and no amount of better ticket-writing fixes it — the problem is *structural*, not *descriptive*.

The structural fix is to **attach debt paydown to the feature work that already passes through that code.** When a story requires opening `refund_service.go`, the linked debt (`DEBT-412`, found via its `TODO(`) gets folded into that story's scope — "while we're in here, extract the rule table." This is the **boy-scout rule** at the planning level (the full treatment is [05 — Paying Down Debt](../05-paying-down-debt/middle.md)), and it dominates standalone tickets for two compounding reasons:

1. **The expensive part is already paid.** Most of a refactor's cost is *getting into the code* — loading the context, re-understanding the design, setting up to test safely. A feature touching that code has *already* paid that cost. Bolting the cleanup on is marginal effort; doing it standalone re-pays the whole entry cost from cold.
2. **It targets interest automatically.** Code that gets feature work *is*, by definition, high-churn code — which is exactly the high-interest debt you wanted to prioritize. "Fix it while you're in there" is the interest-rate rule enforced by workflow instead of by discipline. The debt you naturally encounter is the debt worth fixing.

This reframes what tracking is *for*. The debt register's job is not to be a work queue you drain top-down; it's a **lookup table keyed by location** — so that when a story opens a file, you can instantly find "what debt lives here, and is now the cheap moment to pay it?" That's why the linked `TODO(owner, ticket)` marker is so powerful: it puts the debt record exactly where the feature developer will trip over it, at the one moment paying it is cheapest.

Standalone debt tickets aren't useless — they're the right tool for **big bets**: debt too large to absorb into a feature, that genuinely needs its own scheduled slot and a champion. But for the long tail of local debt, the winning move is to let it ride along with the work that was going to touch it anyway, and to keep a small explicit budget (e.g. a fixed %-of-capacity) for the high-interest items no feature happens to pass through.

---

## Worked Example — Ranking Four Debts by WSJF

A team triages four debt items in one sitting. They score CoD components and job size on a relative 1–10 scale, then compute WSJF = CoD ÷ size. Crucially, they've already pulled the **churn** of each item's location, because that drives the value and time-criticality scores (the interest-rate rule).

| ID | Debt | Churn (rate) | Value | Time-crit | RR/OE | **CoD** | Size | **WSJF** |
|---|---|---|---|---|---|---|---|---|
| D1 | Untested refund logic (high-churn `payments/`) | High | 6 | 7 | 5 | **18** | 4 | **4.5** |
| D2 | Duplicated validation across 3 services | Med | 5 | 3 | 6 | **14** | 8 | **1.75** |
| D3 | Tangled module in dormant `legacy/reporting/` | ~Zero | 2 | 1 | 2 | **5** | 5 | **1.0** |
| D4 | Flaky config loader hit on every deploy | High | 7 | 8 | 6 | **21** | 3 | **7.0** |

Rank by WSJF descending: **D4 (7.0) → D1 (4.5) → D2 (1.75) → D3 (1.0)**.

Read what the math captured:

- **D4 wins decisively** — high cost of delay (it bites on *every* deploy, so high churn → high value and time-criticality) and a *small* job. Highest interest, cheapest fix: the textbook WSJF winner. Do it first.
- **D1 is second**, even though it's the debt the team *complains* about most. Real, high-churn, worth doing — but a bigger job than D4, so it yields less value-per-day. WSJF correctly puts the cheaper high-interest fix ahead of the pricier one.
- **D2 sinks** despite touching three services. Its value is real but its **size (8)** is large and its churn is only medium, so its per-unit return is low. This is the kind of item that *feels* important (it's everywhere) but shouldn't jump the queue.
- **D3 is last, and that's the lesson.** It's genuinely tangled code — but it lives in a **dormant** module (~zero churn), so it charges almost no interest. Its low value and time-criticality scores fall straight out of the interest-rate rule. Fixing it would feel productive and change nothing about delivery. WSJF says: leave it.

Now overlay the *tie-it-to-the-work* lens. Suppose a feature this sprint already opens the refund service. D1's entry cost is now sunk — so D1 may jump to "do it now, in this story," even though its standalone WSJF is below D4's. **WSJF orders the standalone queue; proximity to current work overrides that order when the expensive entry cost is already paid.** Both rules are in play: WSJF for what to *schedule deliberately*, "fix it while you're in there" for what to *absorb opportunistically*.

---

## Mental Models

- **A TODO is a breadcrumb; a ticket is the map.** The marker's job is to be unmissable in the code; the ticket's job is to be schedulable in planning. A naked TODO is a breadcrumb with no map — found, but leading nowhere fundable.

- **Interest is paid per touch, so the rate is churn.** You don't pay interest on debt by *having* it; you pay it every time you change the code around it. Debt in code you never open charges ~0% — improving it is principal spent for no return.

- **WSJF is shortest-job-first for value.** When work must be serialized, do the shortest highest-cost-of-delay item first to minimize total value lost. A small fix that stops a big bleed beats a big fix that stops a small one.

- **The cheapest moment to pay debt is when you're already in the code.** Most of a refactor's cost is getting into the code at all. A feature touching that file has pre-paid the entry cost — so attached cleanup is marginal, and standalone cleanup is full price.

- **The register is a lookup table, not a queue.** Stop trying to drain it top-down (you'll lose to features forever). Key it by location so that when work enters a file, you can ask "what debt is here, and is now the cheap time to pay it?"

---

## Common Mistakes

1. **Leaving naked TODOs.** `// TODO: fix this` has no owner, no context, no ticket, no expiry — so its default lifespan is *forever*. Use `TODO(owner, TICKET)` with a one-line why, and CI-fail any `TODO(` lacking a ticket reference.

2. **Treating the register as a work queue.** A top-down debt backlog loses every sprint to features and rots into a graveyard. Tie the long tail to the work that touches it; reserve standalone scheduling for big bets only.

3. **Prioritizing by complexity instead of churn × complexity.** The ugliest code isn't the costliest — the ugliest code *you keep editing* is. Sort by hotspot (interest), not by raw mess (principal), or you'll lavish effort on dormant modules.

4. **Hiding effort in the value score.** In WSJF, effort goes in the denominator only. Let "it's hard" also drag down the value score and you double-count it — and the cheap-but-valuable quick wins stop surfacing, defeating the whole "shortest job" idea.

5. **Scoring WSJF items in isolation.** The numbers only mean something relative to each other. A WSJF of 4.5 computed alone is noise; score the whole batch in one sitting so the scale is consistent, then rank.

6. **Writing debt tickets that record a feeling.** "The auth code is gross" can't be prioritized. Capture location, the *interest it charges*, the trigger, the remediation estimate, and the risk if ignored — the exact inputs a prioritization model consumes.

---

## Test Yourself

1. Why does a naked `// TODO: clean up` reliably fail, and what minimal change fixes it?
2. Name the five fields a debt ticket needs to be *prioritizable*, and say which one most teams omit.
3. Write the WSJF formula and explain why job size is in the denominator.
4. Two debts are equally tangled; one is in code edited weekly, the other in a module untouched for a year. Which has the higher interest rate, and what does that imply for ordering?
5. Why do standalone debt tickets so often go unscheduled, and what structurally fixes it (not "write better tickets")?
6. Debt D has CoD = 16 and size = 2; debt E has CoD = 20 and size = 8. Which do you do first, and why might that flip in practice?

<details>
<summary>Answers</summary>

1. It has no owner (nobody's accountable), no context (can't act without re-deriving the problem), no external handle (invisible to planning/search), and no expiry (default lifespan = forever). Fix: `TODO(owner, TICKET)` plus a one-line *why*, linking out to a real ticket.
2. **Location, the interest it charges, trigger, estimated remediation, risk if ignored.** Most teams omit the *interest* — they describe the mess but not its ongoing cost, leaving nothing to justify paydown.
3. `WSJF = Cost of Delay ÷ Job Size`. Job size is in the denominator so you get value *per unit of effort* — shortest-job-first for value — surfacing cheap high-value work ahead of expensive high-value work. Folding effort into the numerator double-counts it.
4. The weekly-edited one — interest is paid *per touch*, so the rate ≈ churn. Implication: pay the high-churn debt first; the dormant one charges ~0% interest, so fixing it returns nothing despite an equally large, satisfying diff.
5. They lose every planning fight to features (which have a customer and a date). The structural fix is to attach paydown to the feature work that already passes through the code ("fix it while you're in there"), so the expensive entry cost is already paid — not to write more persuasive tickets.
6. **D first:** WSJF(D) = 16/2 = 8 vs WSJF(E) = 20/8 = 2.5. It flips if a feature this sprint already opens E's code — E's entry cost is sunk, so absorbing it opportunistically can beat scheduling D standalone. WSJF orders the deliberate queue; proximity overrides it for opportunistic work.

</details>

---

## Cheat Sheet

```
WHERE TO TRACK (proximity-to-code  ↔  visibility-to-planning)
  issue + tech-debt label   schedulable debt that competes with features
  dedicated register        portfolio view you triage periodically
  ADR                       deliberate DESIGN debt + the trade-off accepted
  TODO(owner, TICKET)       local debt — unmissable in code, links to a ticket
  naked // TODO             ✗ no owner/context/handle/expiry → lives forever

DEBT TICKET — 5 REQUIRED FIELDS
  Location          file/func, openable in 30s
  Interest          the ONGOING cost (×dev-time, review, risk) — not "ugly"
  Trigger           "fix when you next touch X" / threshold / before next Y
  Remediation       rough size (needed — every model divides by effort)
  Risk if ignored   the tail; "nothing" is a valid, useful answer

PRIORITIZE (one idea, four resolutions)
  impact × effort   quick triage → quick wins / big bets / fill-ins / money pits
  Cost of Delay     value lost per unit time waiting (debt's CoD ≈ interest)
  WSJF = CoD ÷ Job Size                rank DESC; shortest-job-first for value
    CoD = Value + Time-criticality + Risk-reduction/Opportunity   (relative 1–10)
  interest-rate rule  weight CoD by CHURN → pay high-churn debt first

GOLDEN RULES
  interest is paid PER TOUCH  → rate ≈ churn → sort by hotspot, not by mess
  effort goes in the DENOMINATOR only (never hide it in value)
  score WSJF as a batch, one sitting (numbers only mean order)
  cheapest fix = code you're ALREADY in → tie debt to the work that touches it
```

---

## Summary

- **Where** debt lives is a trade-off between proximity to the code and visibility to planning: issue label (schedulable), register (portfolio triage), ADR (design debt), and the in-code `TODO(owner, ticket)` marker (local, unmissable). **Naked TODOs fail** because they have no owner, context, external handle, or expiry — so they live forever and never reach planning.
- A **good debt ticket** records a decision input, not a feeling: location, the *interest it charges*, a trigger ("fix when you next touch X"), an estimated remediation, and the risk if ignored. Those five fields are exactly what a prioritization model consumes.
- Prioritization is **one idea at four resolutions**: impact×effort (fast triage), Cost of Delay (value lost per unit time), **WSJF = CoD ÷ Job Size** (rank descending — shortest-job-first for value), and the **interest-rate rule** that feeds the CoD numerator.
- The **interest-rate rule**: interest is paid every time you touch the code, so the rate ≈ **churn**. Pay the highest-interest debt first — the messiest code in your highest-churn files (hotspots) — not merely the ugliest code, which may be charging ~0% in a dormant module.
- The structural fix for stale registers: **tie debt to the work that touches it.** Standalone tickets lose to features forever; "fix it while you're in there" pre-pays the expensive entry cost and automatically targets high-churn (high-interest) code. The register is a lookup table keyed by location, not a queue to drain.

---

## Further Reading

- *Software Design X-Rays* — Adam Tornhill. The empirical case for churn × complexity hotspots as the prioritization signal; the data behind the interest-rate rule.
- *SAFe — WSJF* (scaledagileframework.com, "WSJF" article) — the canonical decomposition of Cost of Delay and the job-size division, with worked examples.
- *The Principles of Product Development Flow* — Donald Reinertsen. The deep treatment of Cost of Delay and why economic sequencing beats intuition.
- *Tidy First?* — Kent Beck. On small, opportunistic cleanups tied to the work in front of you — the "fix it while you're in there" discipline at the code level.

---

## Related Topics

- [02 — Identifying & Quantifying](../02-identifying-and-quantifying/middle.md) — hotspots (churn × complexity) and remediation cost: the raw inputs the interest-rate rule and WSJF consume.
- [03 — The Debt Quadrant](../03-the-debt-quadrant/middle.md) — classifying debt by deliberate/inadvertent × prudent/reckless, which shapes how you triage and prioritize it.
- [05 — Paying Down Debt](../05-paying-down-debt/middle.md) — once it's ranked, *how* you actually pay it: boy-scout rule, strangler fig, %-capacity vs dedicated paydown.
- [junior.md](junior.md) — principal vs interest and the case for writing debt down at all.
- [senior.md](senior.md) — debt portfolios, budgets, and prioritizing across teams and an org-wide roadmap.
