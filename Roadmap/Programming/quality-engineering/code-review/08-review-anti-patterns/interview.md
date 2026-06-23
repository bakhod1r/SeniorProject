# Review Anti-patterns — Interview Level

> **Roadmap:** [Code Review](../README.md) → Review Anti-patterns
> *A code-review interview rarely asks "is bikeshedding bad." It asks "every PR is approved in two minutes — what's wrong and how do you fix it," and then watches whether you treat the anti-pattern as a symptom or chase it as the disease. This page is the question bank, with model answers and a note on what each question is really probing.*

---

## Table of Contents

1. [How to Use This Page](#how-to-use-this-page)
2. [Prerequisites](#prerequisites)
3. [Introduction](#introduction)
4. [The Catalog](#the-catalog)
5. [Root Causes](#root-causes)
6. [Review Theatre](#review-theatre)
7. [Metrics-Driven Anti-patterns](#metrics-driven-anti-patterns)
8. [Diagnosis & Scenarios](#diagnosis--scenarios)
9. [Rapid-Fire](#rapid-fire)
10. [Red Flags / Green Flags](#red-flags--green-flags)
11. [Cheat Sheet](#cheat-sheet)
12. [Summary](#summary)
13. [Further Reading](#further-reading)
14. [Related Topics](#related-topics)

---

## How to Use This Page

This is the section capstone: the other seven topics taught you *how to review well*; this one quizzes you on *how review goes wrong, why, and how to fix it at the system level*. Each question carries three things: **Q** (the prompt), **what the interviewer is really testing**, and **A** (a model answer at the depth a strong candidate gives).

Don't memorize the catalog of names — internalize the *one move* that separates senior answers from junior ones:

- **symptom vs cause** (the visible anti-pattern vs the systemic condition that produces it)
- **the person vs the system** (coaching one reviewer vs changing the defaults so the behavior stops being rational)
- **assurance vs verification** (review that *feels* safe vs review that actually catches defects)

Nearly every question here is one of those three moves wearing a costume. The candidate who does well names bikeshedding *and then* says "so I'd automate the style," not "so I'd tell people to stop."

---

## Prerequisites

You should be fluent in the rest of this section before this page lands. Specifically:

- **What review is for and in what order to look** — [01 — What to Look For & In What Order](../01-what-to-look-for-and-order/interview.md). Half the anti-patterns are an *inverted priority order* (style before correctness).
- **Giving and receiving feedback** — [05 — Feedback Giving & Receiving](../05-feedback-giving-and-receiving/interview.md). Ego comments, blocking-on-preference, and nitpick pile-on are feedback failures.
- **Metrics and tempo** — [07 — Review Metrics & Tempo](../07-review-metrics-and-tempo/interview.md). Ghosting, slow reviews, and metric-gaming all live here.
- **Goodhart's Law** — once a measure becomes a target, it stops measuring. The engine behind every metrics-driven anti-pattern.

If "automate the style guide," "shrink the PR," and "set a review SLA" aren't already reflexes, read those three pages first.

---

## Introduction

A review anti-pattern is a *recurring, locally-rational behavior that degrades review's purpose* — catching defects and spreading knowledge — while often looking like diligence. That last clause is the trap. Rubber-stamping looks like throughput. Nitpick pile-on looks like rigor. Gatekeeping looks like standards. The behaviors persist precisely because they're rewarded by the local incentives, even as they hollow out the practice.

The interview signal is whether you can do three things in sequence: **name** the anti-pattern, **trace it to a systemic root cause**, and **prescribe a fix that changes the system, not the person**. Juniors stop at naming. Mid-levels name and trace. Staff candidates trace to root cause, prescribe in priority order, and know which fixes are cheap (automate style) versus which are slow culture work (raise psychological safety) — and they sequence accordingly.

---

## The Catalog

### Q: Name the core code-review anti-patterns and, for each, the one-line fix.

> **Testing:** Breadth, and whether your "fix" targets the behavior or the system that causes it.

**A.** The recurring ones, each with the fix that actually sticks:

| Anti-pattern | What it looks like | Systemic fix (not "tell them to stop") |
|---|---|---|
| **Bikeshedding** | Long thread on naming/formatting, silence on the actual logic | Automate style (formatter + linter in CI) so it's *not reviewable* |
| **Rubber-stamping / LGTM-without-reading** | Instant approval, zero comments, on a 600-line diff | Shrink PRs; sample-audit approvals; make "I read X, looks good" the norm |
| **Blocking on personal preference** | "Change this" where a guide says nothing; it's just taste | A written style guide; "blocking requires a cited rule or a real defect" |
| **Nitpick pile-on** | Twelve trivial comments, none material | Mark nits as non-blocking (`nit:`); cap blocking comments to what matters |
| **Ego / adversarial comments** | "Did you even test this?"; reviewing the author, not the code | Norms + psychological safety; comment on the code, ask don't accuse |
| **Scope creep** | "While you're here, also refactor…" | Defer to a follow-up issue; review the diff that exists |
| **Ghost / slow reviewer** | PR sits 3 days; author is blocked and context-switches | A review SLA + WIP limits; treat review as first-class work, not interrupt |
| **Gatekeeping** | One person must approve everything; uses it as power | Spread review load; codify standards so they're objective, not personal |
| **Design feedback too late** | "This whole approach is wrong" on a finished 800-line PR | Design review / RFC *before* implementation; early draft PRs |
| **The giant PR** | 1,500 lines, 40 files, one commit | Stacked/incremental PRs; a size budget; reject "too big to review" |
| **The no-context PR** | Empty description, author never self-reviewed | Require a "why" in the description; author self-reviews first |

The pattern across the fix column is the whole topic: **almost none of the fixes are "coach the individual."** They're "remove the thing being argued about" (automate style), "remove the cause of fatigue" (shrink PRs), or "remove the perverse incentive" (fix the SLA, fix the metric).

### Q: Two of these — the giant PR and the no-context PR — are *author* anti-patterns, not reviewer ones. Why do they matter most?

> **Testing:** Whether you see that review quality is bounded by PR quality.

**A.** Because they're *upstream* — they cap how good any reviewer can be. A 1,500-line PR cannot be reviewed well by anyone; the reviewer's working memory runs out around a few hundred lines, so a giant PR *forces* rubber-stamping. Reviewer studies show defect-detection collapses past roughly 200–400 lines: beyond that, find-rate per line drops toward zero. So the giant PR doesn't just risk a bad review — it *manufactures* the rubber-stamp. Likewise, a PR with no description and no self-review makes the reviewer reconstruct intent from the diff, which is slow and error-prone, so they shortcut. The lesson for the interview: **you fix reviewer anti-patterns by fixing author behavior first** — shrink the PR and demand context, and half the reviewer anti-patterns lose their fuel. This is the through-line to [01 — What to Look For](../01-what-to-look-for-and-order/interview.md): a reviewable PR is the precondition for review at all.

### Q: Distinguish a *nit* from blocking feedback. Why does conflating them cause harm?

> **Testing:** Whether you understand that not all feedback is equal, and that signaling severity is part of the reviewer's job.

**A.** A **nit** is feedback whose value is below the cost of a round-trip: a variable name you'd have chosen differently, an optional simplification, a stylistic lean. **Blocking** feedback is a correctness, security, or design problem that *must* be resolved before merge. Conflating them — delivering nits with the same weight as defects, or making them block — does two harms: it **buries the signal** (the one real bug hides in a wall of twelve trivia), and it **trains the author to discount you** (if everything is "change this," nothing is). The fix is to label: prefix optional comments `nit:` and explicitly state they're non-blocking, so the author can take them or skip them and merge. The discipline of *severity-tagging your own comments* is one of the clearest green flags a reviewer can show — see [05 — Feedback](../05-feedback-giving-and-receiving/interview.md).

---

## Root Causes

### Q: This is the differentiator question. Pick three anti-patterns and name the *systemic* cause of each, not the behavior.

> **Testing:** Whether you treat anti-patterns as symptoms of a system, which is the entire senior thesis.

**A.** Each visible anti-pattern is a symptom; the disease is upstream:

- **Bikeshedding** → the **style guide isn't automated**. People argue about formatting and naming *because those things are still reviewable by humans*. The moment a formatter and linter run in CI and block merge, there is nothing left to bikeshed — the law of triviality has no surface to attach to. The cause isn't "people are petty"; it's "the system left a trivial decision open to opinion."
- **Rubber-stamping** → **PRs are too big** (and reviewers are overloaded). A reviewer facing a 900-line diff and four other pending reviews *rationally* skims and approves, because thorough review is infeasible in the time available. The cause is PR size and load, not laziness. Shrinking PRs and capping concurrent reviews removes the rationality of the shortcut.
- **Ghosting / slow reviews** → **no SLA and no load management**. If review is an unscheduled interrupt with no expectation attached and no protected time, it loses every prioritization contest against the reviewer's own committed work. The cause is the absence of a norm and a WIP limit, not individual flakiness.

Two more for completeness: **blocking-on-preference** is caused by *the absence of written norms* (with no guide, every disagreement collapses to "my taste vs yours"); **gatekeeping** is caused by *low psychological safety plus concentrated authority* (when standards are personal rather than codified, the gate is a person, and the person can wield it).

> The unifying claim: **anti-patterns are rational responses to a broken system.** Punishing the individual moves the symptom; fixing the system removes it. If your answer to bikeshedding is "tell engineers to be less petty," you've diagnosed a character flaw where there's a missing CI job.

### Q: Why is "fix the system, not the symptom" more than a slogan? What goes wrong if you coach individuals instead?

> **Testing:** Whether you can articulate the mechanism by which person-level fixes fail.

**A.** Coaching the individual fails for three concrete reasons. First, it **doesn't scale and doesn't persist**: you coach one reviewer out of rubber-stamping, but the next hire faces the same 900-line PRs and makes the same rational choice — you're playing whack-a-mole against an incentive. Second, it **misattributes cause**, which damages trust: telling someone to "be less nitpicky" when the real problem is that style isn't automated reads as blaming them for a system failure, and lowers the psychological safety you need. Third, it **leaves the incentive intact**, so even a coached individual drifts back — behavior follows incentives, not pep talks. The systemic fix (a CI formatter, a PR size budget, a review SLA) changes the *default* so the desired behavior is the path of least resistance and the anti-pattern becomes impossible or pointless. The senior instinct: when you see the same anti-pattern from multiple people, stop looking at the people — *the consistency is the tell that it's structural.*

### Q: Give the remediation order. If a team's reviews are broadly unhealthy, what do you fix first, and why that order?

> **Testing:** Staff-level prioritization — sequencing fixes by cost and dependency.

**A.** Cheapest and most mechanical first, slowest and most cultural last, because the early fixes *remove whole classes of problem* and buy trust for the later work:

1. **Automate style.** Formatter + linter in CI. Kills bikeshedding and most nits overnight. Hours of work, immediate payoff, uncontroversial.
2. **Shrink PRs.** Size budget, stacked PRs, draft-early. Removes the fuel for rubber-stamping and fatigue. The single highest-leverage change for *find-rate*.
3. **Fix load and tempo.** Review SLA, WIP limits, protected review time. Kills ghosting and slow reviews; see [07 — Metrics & Tempo](../07-review-metrics-and-tempo/interview.md).
4. **Write the norms.** A style guide and a "what blocks a merge" policy. Kills blocking-on-preference by making "is this a real rule?" answerable.
5. **Fix the metrics.** Stop measuring comment-count / approval-speed as goals (more below). Removes metric-driven gaming.
6. **Raise the culture.** Psychological safety, "code review reviews the code not the author," making good reviewing *valued in promotion*. Kills gatekeeping and ego — and it's last because it's the slowest and is *enabled* by the structural fixes above.

The reasoning behind the order: steps 1–3 are mechanical and remove ~70% of the visible noise, which makes the team *willing* to invest in the harder cultural work. Trying to fix culture first, while engineers still drown in giant PRs and argue about commas, fails — you're asking for behavior change against a system that punishes it.

---

## Review Theatre

### Q: What is "review theatre," and why is it the most dangerous anti-pattern of all?

> **Testing:** Whether you grasp that *false assurance is worse than no assurance*.

**A.** **Review theatre** is code review that performs the *ritual* — every PR gets an approval, the process box is ticked, the audit trail looks complete — while catching essentially nothing. Uniform two-minute approvals, near-zero comments, a defect find-rate indistinguishable from no review at all. It is the most dangerous anti-pattern because it produces **false assurance**: the organization *believes* it has a quality gate and a second set of eyes, and makes decisions (skipping other safeguards, trusting the merge) on that belief, when the gate is hollow. No review is honestly risky and people compensate; *theatrical* review is invisibly risky — it tells everyone they're safe while the defects sail through. A broken smoke alarm is worse than no alarm, because you stop checking for smoke. That's review theatre.

### Q: How do you *detect* review theatre? It approves everything, so the process looks healthy.

> **Testing:** Whether you can find the signal in metrics that look fine on the surface.

**A.** You look at the *distribution and outcomes*, not the throughput, because theatre's whole disguise is that throughput looks great. The signals:

- **Uniform, implausibly fast approval time** — if nearly every PR, regardless of size, is approved within a couple of minutes, no one is reading 400-line diffs in that window. A flat approval-time distribution that ignores PR size is the tell.
- **Near-zero comment density** — approvals with almost no comments, *especially on large or risky changes*. Real review of a non-trivial change produces *some* discussion.
- **Find-rate decoupled from defects** — review catches ~nothing, yet defects keep reaching production / are caught only by QA or incidents. If escaped-defect rate is the same with and without review, review isn't doing anything.
- **No correlation between reviewer and quality** — changing who reviews has no effect on defect rates.

> The honest test: *if you turned review off, would anything measurably change?* If find-rate is near zero and escaped defects are flat, the review was already off — it was theatre.

The caveat a strong candidate adds: fast approvals are not *automatically* theatre. A genuinely small, mechanical, well-tested PR *should* be approved fast — that's healthy tempo, not theatre. Theatre is fast approval **uniformly, including on changes that demand real attention**. The diagnosis is about the *correlation with size and risk*, never the raw speed.

### Q: What is "normalization of deviance" and how does it relate to review theatre?

> **Testing:** Senior-level understanding of how theatre becomes the stable, accepted state.

**A.** Normalization of deviance (Diane Vaughan, from the Challenger investigation) is the process by which a cut corner, once it doesn't immediately blow up, becomes the *accepted standard* — each skipped step that "was fine last time" lowers the bar for next time, until the deviant practice is the norm and no one remembers it was a deviation. In review, it's the slide from "I'll quickly approve this one, I'm busy" to a *culture* where quick-approve-without-reading is simply how the team operates — and because the rubber-stamps haven't *yet* caused a visible disaster, everyone takes that as evidence the practice is safe. That's exactly how theatre becomes stable: the absence of caught fires is misread as the absence of fire. Breaking it requires making the deviance *visible again* — surfacing find-rate, occasionally pairing on a review to show what a thorough one catches, and re-establishing the explicit norm that approval means "I read this."

### Q: How do you kill review theatre once you've detected it?

> **Testing:** Whether your remedy attacks the root cause, not the surface.

**A.** You don't fix theatre by demanding "review harder" — that's symptom-coaching against the same broken system. You attack what *makes* thorough review infeasible or unvalued:

1. **Make PRs reviewable** (shrink them) — theatre is often rational surrender to un-reviewable diffs.
2. **Fix reviewer load** — theatre is what overload looks like; protect review time, cap concurrent reviews.
3. **Re-establish what approval *means*** — an explicit norm: "approve = I read this and I stand behind it," and normalize "I read the data layer, looks correct" comments as evidence of actual reading.
4. **Make good reviewing visible and valued** — surface (carefully, not as a leaderboard) that review is catching things; recognize thorough reviewers in promotion. If reviewing well earns nothing and slows you down, theatre is the rational equilibrium.
5. **Re-normalize the deviance** — name it. "We've drifted into rubber-stamping; here's what we're changing." Making the silent norm explicit is half the fix.

The framing that lands in an interview: *theatre is a system producing exactly what it rewards — fast approvals at zero cost. Change what's rewarded and measured, and the theatre has no reason to exist.*

---

## Metrics-Driven Anti-patterns

### Q: How do gamed review metrics *breed* anti-patterns? Name the law and the mechanism.

> **Testing:** Goodhart's Law applied to review, with concrete failure modes.

**A.** **Goodhart's Law**: *when a measure becomes a target, it ceases to be a good measure.* Review metrics are proxies for "review is working"; the moment you reward the proxy, people optimize the proxy and abandon the goal. The classic three:

- **Comment count as a target** → reviewers manufacture **nitpick pile-on**. Told that "good reviewers leave comments," they leave *trivial* comments to hit the number. The metric goes up; review quality goes down; the author drowns in noise. The proxy ("engagement") got gamed into its own anti-pattern.
- **Approval speed / fast turnaround as a target** → **rubber-stamping**. Reward "time-to-approve" and you reward *not reading* — the fastest way to a fast approval is LGTM-without-reading. You will have *optimized the team into theatre.*
- **PRs-reviewed count as a target** → **breadth without depth**. Reward volume and reviewers spread thin across many shallow reviews, approving fast to keep the count up — again, rubber-stamping, now incentivized.

The mechanism is identical each time: the metric is a *proxy*, gaming the proxy is easier than achieving the goal, and the easiest way to game it *is* an anti-pattern. So bad metrics don't just *fail* to measure health — they **actively manufacture the unhealthy behavior**. This is the direct link to [07 — Metrics & Tempo](../07-review-metrics-and-tempo/interview.md), and to engineering-metrics' treatment of Goodhart generally.

### Q: So should you measure review at all? If every metric gets gamed, what do you do?

> **Testing:** Whether you over-rotate into "metrics are evil," or land the nuanced position.

**A.** Yes, but for **diagnosis, not as targets** — and you watch *distributions and trends*, never individual scoreboards. The distinction:

- **Use metrics as health *signals* for the system**, looked at in aggregate: time-to-first-review and review latency trends (is the team ghosting?), PR size distribution (are PRs reviewable?), approval-time vs PR-size correlation (theatre detector), escaped-defect rate (is review catching things?). These tell *you, the lead,* where the system is sick.
- **Never make them individual targets or rewards.** The instant "comment count" or "approval speed" becomes something an engineer is rated on, Goodhart converts it into an anti-pattern. No per-person leaderboards.
- **Pair every quantitative signal with a qualitative read** — actually read some reviews. Numbers tell you *where* to look; reading tells you *what's wrong*.

The crisp formulation: **measure the system to find problems; never measure the individual to assign blame** — the first is diagnosis, the second is a Goodhart machine. A metric you'd be comfortable putting on a dashboard for the team to *learn* from is fine; a metric you'd put in someone's performance review is a trap.

### Q: A manager says "let's rank reviewers by number of bugs they catch." What's your response?

> **Testing:** Whether you can articulate, on the spot, why a plausible-sounding metric backfires.

**A.** I'd push back, because it backfires three ways. First, **Goodhart**: rank on bugs-caught and you incentivize *finding* bugs, which means reviewers favor PRs likely to contain bugs and *inflate* trivial issues into "bugs" to score — and you've discouraged the highest-value review outcome, which is a *clean* PR that needed nothing. Second, it **punishes the author-reviewer collaboration**: it pits reviewer against author (more author bugs = more reviewer points), corroding the "we're on the same side" relationship that good review depends on — straight toward adversarial/ego comments. Third, **bugs caught is unmeasurable honestly** — most valuable review feedback is design and clarity, not countable "bugs," and a defect prevented by a good earlier design review never shows up as a "catch." What I'd measure instead, for the *team*: escaped-defect rate (did review reduce what reaches prod?) as a trend, never attributed to individuals. The goal is *fewer defects reaching production*, and the way to wreck that goal is to make individuals compete on a proxy for it.

---

## Diagnosis & Scenarios

### Q: Every PR on this team is approved in two minutes. What's wrong, and how do you fix it?

> **Testing:** The flagship scenario — can you diagnose root cause and remediate, not just name the symptom.

**A.** Two-minute approvals across the board mean **no one is reading the code** — this is rubber-stamping, and if it's *uniform regardless of PR size*, it's review theatre. But "they're lazy" is the junior diagnosis. I'd find the **systemic cause** first, because the fix depends on it:

1. **Check PR size.** If PRs are huge, the two-minute approval is *rational surrender* — they're un-reviewable, so people stamp. Fix: PR size budget, stacked PRs. (Most likely cause.)
2. **Check reviewer load.** If reviewers each have a dozen pending reviews and their own deadlines, they stamp to clear the queue. Fix: WIP limits, protected review time, an SLA that's *achievable*.
3. **Check the incentives/metrics.** If the team is (explicitly or culturally) rewarded for fast turnaround, you've *optimized them into* theatre. Fix: stop rewarding speed; reward caught issues and clean merges at the team level.
4. **Check what's automated.** If nothing else, confirm style is automated so the human review isn't being wasted on formatting (a different failure, but worth ruling in).

Then I'd **re-establish what approval means** — "approve = I read this" — and confirm by *outcome*: is review catching anything, or are defects all caught downstream? If find-rate is ~zero and escaped defects are flat, that confirms theatre and I sequence the fixes above (shrink PRs → fix load → fix incentives). The thing I would *not* do is send a "please review more carefully" message — that coaches the individual against a system that's making rubber-stamping rational.

### Q: Reviews are full of style nitpicks, but bugs still ship to production. Diagnose.

> **Testing:** Inverted-priority diagnosis — the team is reviewing the wrong layer.

**A.** This is the classic **inverted review priority**: attention is going to the *cheapest, least valuable* layer (style) while the *most valuable* layer (correctness) gets none — exactly the order [01 — What to Look For](../01-what-to-look-for-and-order/interview.md) warns against. Two root causes, usually together:

- **Style isn't automated.** As long as formatting and naming are human-reviewable, they attract attention — they're easy to spot and feel productive (bikeshedding's law of triviality: people contribute most on the decisions they understand most cheaply). Fix: **automate style into CI** so it's *off the table*, which forces human attention onto logic.
- **The team doesn't know how to review for correctness, or the PRs make it impossible.** Reviewing logic is *hard* — you have to understand intent, trace edge cases, think about failure modes. Reviewing whitespace is easy. People default to the easy thing. Fix: a review checklist / priority order (correctness → tests → design → readability → style), reviewable PR sizes so logic is *traceable*, and explicit norms that an approval means "I considered whether this is correct," not "the formatting is fine."

The tell that confirms the diagnosis: **bugs ship despite reviews happening.** That means review effort is real but *misdirected*. The fix is to redirect it — remove the trivial sink (automate style) and make the valuable target reachable (small PRs, a priority order). I'd also check that tests are part of review at all; "are there tests for the new behavior, and do they cover the edges" catches a huge share of what nitpicks miss.

### Q: A senior engineer gatekeeps — every change must go through them, and they block on personal preference. How do you handle it?

> **Testing:** Handling a *people* anti-pattern with concentrated power and ego, without making it worse.

**A.** Two distinct problems here, handled differently. The **gatekeeping** (single mandatory approver) is *structural* and I fix it structurally: spread review authority to more people via CODEOWNERS / a reviewer rotation, so no single person is the gate. Concentrated review power is a bus-factor and velocity risk regardless of intent, so distributing it is justified on its own merits — which also means I'm not framing it as "you're a problem," I'm framing it as "we're de-risking the bottleneck."

The **blocking-on-preference** is the harder, *normative* part. The fix is to make the standard **objective** so "block or not" stops being one person's taste:

- **Establish the rule that blocking requires a citable reason** — a real defect (correctness/security/design) or a written standard. If a guide doesn't say it, it's a `nit:`, not a blocker.
- **Automate what can be automated** (style) so the most common preference fights simply vanish.
- **Have the direct, private conversation** — not "stop gatekeeping" (an accusation that triggers defensiveness) but "I want to make sure blocking feedback is anchored to our standards so it's consistent for everyone; can we agree preference-level comments are non-blocking?" Frame it as *fairness and consistency*, which a senior can't easily argue against.

If it persists after norms are written and authority is distributed, it's escalated as a *behavioral* issue (it's now affecting team throughput and morale), with the metrics to show it (this person's reviews have far longer latency / far more blocking comments than peers, as a *factual* observation, not a leaderboard). The order matters: **fix the structure and the norms first**, so that what remains is unambiguously a personal-conduct issue and not a system the person was rationally exploiting. This sits at the boundary with [Soft-Skills → Code Review](../../../../Soft-Skills/code-review/) — the *interpersonal* handling is as important as the structural fix.

### Q: How do you tell whether your team's code review is *actually working*?

> **Testing:** The capstone synthesis — what "healthy review" means in outcomes, not activity.

**A.** I judge it on **outcomes and signals, not activity** — "reviews happen" is theatre's disguise. The questions I'd answer:

- **Is it catching defects?** Find-rate above ~zero, and — the real test — **escaped-defect rate is *lower* with review than without** (fewer defects reaching prod / QA / incidents than the un-reviewed baseline). If review changes nothing about what escapes, it's theatre.
- **Is feedback proportionate and well-targeted?** Comments cluster on correctness/design (not just style — if style dominates, automation is missing). Blocking comments are real defects; nits are tagged and non-blocking.
- **Is tempo healthy?** Time-to-first-review is short and *consistent* (no ghosting); PRs are small enough to review well; approval time *correlates with PR size and risk* (the anti-theatre signal — small PRs fast, big/risky PRs slower).
- **Is it spreading knowledge?** More than one person understands each area over time; review is teaching, not just gating.
- **Is the *relationship* healthy?** Authors don't dread review; feedback is on the code not the person; people *learn* from it. Low psychological safety quietly produces gatekeeping and ego comments.
- **Is good reviewing valued?** Reviewing well is recognized (in promotion, in norms), not pure overhead — otherwise the rational equilibrium drifts to theatre.

The one-line synthesis I'd give: **healthy review is measured by defects it prevents and knowledge it spreads, delivered at a tempo that doesn't block delivery, in a relationship that's safe — not by approvals issued or comments left.** And the sharpest single diagnostic: *if we turned review off, would defects measurably increase?* If yes, it's working. If the honest answer is "probably not," every "approved" is theatre, and I'd run the remediation order — automate style, shrink PRs, fix load, write norms, fix metrics, then culture.

---

## Rapid-Fire

> Short questions to check breadth. One or two sentences each.

- **Q: What is bikeshedding?** A: Disproportionate attention to a trivial, easy-to-grasp detail (naming, formatting) while the substantive logic goes unreviewed; fix by automating the trivial thing away.
- **Q: Root cause of bikeshedding in one phrase?** A: Style isn't automated, so trivia is still human-reviewable.
- **Q: Root cause of rubber-stamping?** A: PRs too big plus reviewers overloaded — skimming becomes rational.
- **Q: Fastest, cheapest fix to the most anti-patterns?** A: Automate style in CI — kills bikeshedding and most nits in an afternoon.
- **Q: Single highest-leverage fix for *find-rate*?** A: Shrink PRs; defect detection collapses past a few hundred lines.
- **Q: What is review theatre?** A: Review that ticks the box and catches nothing — false assurance, the most dangerous failure.
- **Q: One signal that screams theatre?** A: Uniform fast approvals *regardless of PR size*, with near-zero find-rate.
- **Q: Why is theatre worse than no review?** A: It produces false assurance — people stop compensating because they believe they're safe.
- **Q: Goodhart's Law in one line?** A: When a measure becomes a target, it stops being a good measure.
- **Q: "Reward comment count" produces which anti-pattern?** A: Nitpick pile-on — reviewers manufacture trivia to hit the number.
- **Q: "Reward approval speed" produces which anti-pattern?** A: Rubber-stamping / theatre — fastest path to a fast approval is not reading.
- **Q: A `nit:` prefix means?** A: Optional, non-blocking — take it or leave it and merge.
- **Q: Should you measure review?** A: Yes, for system diagnosis in aggregate; never as an individual target.
- **Q: Fix for ghosting/slow reviews?** A: An achievable SLA, WIP limits, and protected review time — make review first-class work.
- **Q: Fix for gatekeeping?** A: Distribute review authority (CODEOWNERS/rotation) and codify standards so the gate isn't a person.
- **Q: Design-feedback-too-late — prevention?** A: Design review / RFC *before* implementation, and draft PRs early.
- **Q: The two author-side anti-patterns?** A: The giant PR and the no-context, un-self-reviewed PR — they cap reviewer quality.
- **Q: Normalization of deviance, one line?** A: A cut corner that didn't blow up becomes the accepted standard.
- **Q: Remediation order, abbreviated?** A: Automate style → shrink PRs → fix load → write norms → fix metrics → culture.
- **Q: The single best "is review working" test?** A: If you turned review off, would escaped defects measurably rise?

---

## Red Flags / Green Flags

> What interviewers infer from *how* you answer, not just whether you're right.

**Red flags:**

- Naming anti-patterns but prescribing *only* person-level fixes ("tell them to stop bikeshedding," "ask them to review more carefully") — missing that they're systemic.
- Treating fast approvals as automatically good (throughput tunnel-vision) — not seeing theatre.
- Proposing comment-count / approval-speed / bugs-caught as *individual* metrics — walking straight into Goodhart.
- "Just enforce the process harder" — more theatre, not less.
- No notion that PR size and author behavior *cap* reviewer quality.
- Believing "reviews happen" equals "review works."
- Reaching for individual blame before checking the system that made the behavior rational.

**Green flags:**

- Reflexively asking "what *system* produces this behavior?" before judging the person.
- Naming Goodhart unprompted when metrics come up, and distinguishing *diagnosis* metrics from *target* metrics.
- Giving the remediation in *priority order* (automate style → shrink PRs → fix load → norms → metrics → culture) with the reasoning for the order.
- Calling review theatre the *most dangerous* anti-pattern and explaining false assurance.
- The anti-theatre diagnostic: "does approval time correlate with PR size and risk?"
- The capstone test: "if we turned review off, would defects measurably increase?"
- Distinguishing nits from blocking feedback and tagging severity.
- Recognizing that the cultural fixes are real but *slowest*, and are enabled by the structural ones.

---

## Cheat Sheet

| Anti-pattern | Systemic root cause | Fix (system, not person) |
|---|---|---|
| Bikeshedding | Style not automated | Formatter + linter in CI |
| Rubber-stamping / LGTM | PRs too big + overload | Shrink PRs; achievable load; audit |
| Blocking on preference | No written norms | Style guide; "block needs a cited rule or defect" |
| Nitpick pile-on | No severity signal; gamed comment-count | `nit:` non-blocking; don't reward comment volume |
| Ego / adversarial | Low psychological safety | Norms; review the code not the author |
| Scope creep | No deferral habit | Follow-up issue; review the diff that exists |
| Ghost / slow reviewer | No SLA; no load mgmt | Review SLA; WIP limits; protected time |
| Gatekeeping | Concentrated power + personal standards | Distribute authority; codify standards |
| Design feedback too late | No early design step | RFC/design review *before* code; draft PRs |
| Giant PR | No size budget | Size budget; stacked PRs |
| No-context PR | No expectations on authors | Require "why"; author self-review first |
| **Review theatre** (meta) | Big PRs + overload + bad incentives | Make PRs reviewable; fix load; fix what's rewarded; re-normalize |

**Goodhart cheat:** reward *comment count* → nitpick pile-on · reward *approval speed* → rubber-stamping · reward *PRs-reviewed* → shallow breadth · reward *bugs-caught per person* → adversarial + inflated "bugs."

**Remediation order:** automate style → shrink PRs → fix load/tempo → write norms → fix metrics → raise culture. *(Cheap & mechanical first; cultural & slow last.)*

**The one test:** *If review were turned off, would escaped defects measurably rise?* No ⇒ it's theatre.

---

## Summary

- An anti-pattern is a **recurring, locally-rational behavior that degrades review's purpose while looking like diligence** — rubber-stamping looks like throughput, nitpick pile-on looks like rigor, gatekeeping looks like standards.
- The senior move is **symptom → root cause → systemic fix**: bikeshedding is *style not automated*, rubber-stamping is *PRs too big + overload*, ghosting is *no SLA*, gatekeeping is *concentrated power + personal standards*. Fix the system; the symptom dissolves. Coaching the individual is whack-a-mole against an incentive.
- **Review theatre** — ritual review that catches nothing — is the most dangerous because it produces **false assurance**; detect it via uniform fast approvals *regardless of size* plus near-zero find-rate, and kill it by making PRs reviewable, fixing load, and changing what's rewarded. **Normalization of deviance** is how it becomes the stable norm.
- **Goodhart's Law** is the engine of metrics-driven anti-patterns: rewarding comment-count breeds nitpicking, rewarding approval-speed breeds rubber-stamping. Measure the *system* for diagnosis; never make a metric an *individual* target.
- The **remediation order** is cheap-and-mechanical first: automate style → shrink PRs → fix load → write norms → fix metrics → raise culture — and the structural fixes *enable* the cultural ones.
- The capstone diagnostic for the whole section: **healthy review is measured by defects prevented and knowledge spread, at a tempo that doesn't block delivery, in a relationship that's safe** — not by approvals issued. *If turning review off wouldn't raise escaped defects, every "approved" was theatre.*

---

## Further Reading

- *Software Engineering at Google* — Chapter 9, "Code Review." The canonical treatment of review at scale, the small-CL discipline, and why review is about more than catching bugs.
- Google's [*Code Review Developer Guide*](https://google.github.io/eng-practices/review/) — the standard, practical articulation of reviewer/author norms; the antidote to most anti-patterns here.
- *Code That Fits in Your Head* — Mark Seemann — on small changes and reviewability as the precondition for everything else.
- Diane Vaughan, *The Challenger Launch Decision* — the origin of "normalization of deviance," directly applicable to review theatre.
- The [junior.md](junior.md) and [senior.md](senior.md) pages of this topic — junior grounds the catalog and the fixes; senior goes deep on diagnosis at scale, the remediation playbook, and making good reviewing valued.

---

## Related Topics

- [01 — What to Look For & In What Order](../01-what-to-look-for-and-order/interview.md) — the priority order whose *inversion* is half these anti-patterns (style before correctness).
- [05 — Giving & Receiving Feedback](../05-feedback-giving-and-receiving/interview.md) — ego comments, blocking-on-preference, and nit-tagging are feedback failures.
- [07 — Review Metrics & Tempo](../07-review-metrics-and-tempo/interview.md) — ghosting, slow reviews, and the metrics that breed gaming.
- [Quality Gates](../../quality-gates/) — where review sits among the other gates, and why a theatrical gate is worse than none.
- [Soft-Skills → Code Review](../../../../Soft-Skills/code-review/) — the interpersonal half of handling gatekeeping, ego, and adversarial reviewers.
