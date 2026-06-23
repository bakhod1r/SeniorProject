# Metrics Anti-Patterns & Goodhart — Middle Level

> **Roadmap:** [Engineering Metrics & DORA](../README.md) → Metrics Anti-Patterns & Goodhart
> *The junior page warned that metrics can backfire. This page names the mechanism — Goodhart's law and **surrogation** — then hands you the catalogue: each anti-pattern, exactly how it gets gamed, and the antidote, ending with the one technique that makes a metric hard to game: pairing it.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Goodhart's Law, Campbell's Law, and Surrogation](#goodharts-law-campbells-law-and-surrogation)
4. [Anti-Pattern: Individual & Ranking Metrics](#anti-pattern-individual--ranking-metrics)
5. [Anti-Pattern: Activity Mistaken for Productivity](#anti-pattern-activity-mistaken-for-productivity)
6. [Anti-Pattern: Single-Metric Tunnel Vision](#anti-pattern-single-metric-tunnel-vision)
7. [Anti-Pattern: Targets & Quotas on Metrics](#anti-pattern-targets--quotas-on-metrics)
8. [Anti-Pattern: Vanity Metrics & Comparing Teams](#anti-pattern-vanity-metrics--comparing-teams)
9. [Anti-Pattern: Weaponizing Metrics for Performance Reviews](#anti-pattern-weaponizing-metrics-for-performance-reviews)
10. [The Antidote: Paired Metrics](#the-antidote-paired-metrics)
11. [Worked Example — Fixing a Gamed Metric](#worked-example--fixing-a-gamed-metric)
12. [Rolling Out Metrics Safely](#rolling-out-metrics-safely)
13. [Mental Models](#mental-models)
14. [Common Mistakes](#common-mistakes)
15. [Test Yourself](#test-yourself)
16. [Cheat Sheet](#cheat-sheet)
17. [Summary](#summary)
18. [Further Reading](#further-reading)
19. [Related Topics](#related-topics)

---

## Introduction

> Focus: **Why do metrics corrupt the behaviour they measure, and what specific countermeasure defuses each failure?**

At the junior level the lesson is a slogan: "be careful, metrics can be gamed." True, but a slogan can't tell you *which* metric is about to detonate, *why*, or *what to replace it with*. This page upgrades the slogan into an engineering discipline.

The corruption is not random. It follows a law with a name and a mechanism. Once you can articulate **Goodhart's law** precisely and recognize **surrogation** — the moment the metric quietly *replaces* the goal in people's heads — the catalogue of anti-patterns stops looking like a list of unrelated war stories and starts looking like one disease with seven presentations. Each section below states the anti-pattern, shows the exact gaming move it invites, and gives the antidote. The final third of the page is constructive: the **paired-metric** technique that makes gaming visible, and how to roll metrics out so a team adopts them instead of routing around them.

---

## Prerequisites

- **Required:** You've read [junior.md](junior.md) and know the difference between an output and an outcome.
- **Required:** Familiarity with the [DORA four keys](../01-dora-four-key-metrics/middle.md) — they supply the canonical paired metric (speed *and* stability).
- **Helpful:** A pass over [the SPACE framework](../03-space-framework/middle.md); it exists precisely *because* productivity resists being one number.
- **Helpful:** You've watched at least one metric you cared about get gamed in the wild.

---

## Goodhart's Law, Campbell's Law, and Surrogation

Three ideas, stated precisely, explain every anti-pattern that follows.

**Goodhart's law.** The popular phrasing — *"When a measure becomes a target, it ceases to be a good measure"* — is Marilyn Strathern's tightening of economist Charles Goodhart's original (1975) observation about monetary policy. The mechanism: a metric is useful only as a *proxy* for something you can't measure directly (productivity, quality, customer value). The instant people are rewarded or punished by the proxy, they optimize *the proxy*, and the proxy detaches from the thing it stood for. The number improves; reality doesn't.

**Campbell's law.** Social scientist Donald T. Campbell's parallel formulation is sharper about the damage: *"The more any quantitative social indicator is used for social decision-making, the more subject it will be to corruption pressures and the more apt it will be to distort and corrupt the social processes it is intended to monitor."* Campbell's contribution is the second clause — the metric doesn't just become useless, it actively *corrupts the underlying process*. Teaching to the test doesn't merely inflate scores; it degrades the education the test was meant to measure.

**Surrogation** is the cognitive mechanism that makes both laws bite. Coined in the management-accounting literature (Choi, Hecht, Tayler), surrogation is the human tendency to *mentally substitute the metric for the goal it represents* — to lose sight of the strategic construct and start treating the proxy *as if it were* the construct itself. A team told "our goal is fast, reliable delivery, and we'll track lead time" will, within a quarter, talk only about lead time and forget "reliable." The map has eaten the territory.

> **Key insight:** Goodhart and Campbell describe *what* goes wrong; surrogation explains *why* it's almost inevitable. People don't game metrics because they're dishonest — they game them because the brain genuinely confuses the measure with the mission. Every antidote in this catalogue is, at bottom, a defence against surrogation: keep the *goal* loudly present so the *metric* can't silently impersonate it.

---

## Anti-Pattern: Individual & Ranking Metrics

**The pattern.** Measuring and especially *ranking* individuals — commits per dev, tickets closed per dev, "developer of the month," stack-ranked PR counts.

**How it's gamed.** This one corrupts faster and uglier than any other, because software is a team sport and the metric pretends it isn't:

- **Gaming the number** — split one commit into ten, pad PRs, cherry-pick easy tickets, close-and-reopen.
- **Hoarding** — stop reviewing others' code, stop mentoring, stop pairing; every minute spent helping a teammate is a minute your *rival's* number goes up, not yours.
- **Sabotaged collaboration** — the highest-leverage work an engineer does (unblocking others, design review, writing the doc that saves the team a week) is invisible to per-individual counters, so a ranked engineer rationally stops doing it.

The result is a local optimum that's a global disaster: every individual number looks busy while the *team's* throughput craters because nobody helps anybody.

**The antidote: measure teams and systems, not people.** Delivery metrics (DORA, flow) describe a *system* — they're properties of the pipeline a whole team owns, not of one person's keyboard. Pin the unit of measurement at the team/value-stream level. Individual signals, if you use them at all, belong in *coaching* between a person and their manager, never on a leaderboard.

> **Key insight:** The moment a metric can be attributed to one named person *and* compared to peers, you have built an incentive to stop collaborating. The single most reliable way to wreck a team is to rank its members by output.

---

## Anti-Pattern: Activity Mistaken for Productivity

**The pattern.** Treating *how much motion* there is as *how much value* is produced: lines of code, number of commits, story points / velocity, hours logged, PR count.

**How it's gamed.** Activity metrics share a fatal property — they measure **output, not outcome**, so they're trivially inflated without producing anything:

- **LOC** rewards verbosity. The senior who deletes 2,000 lines of dead code and ships the feature in 50 *scores negative*. As Bill Atkinson's apocryphal `-2000` lines-of-code week shows, the best engineering often *removes* code. Measuring LOC pays people to write more of the thing you want less of.
- **Commits** rewards `git commit` frequency — split work into confetti.
- **Velocity / story points** are a *forecasting* tool for one team's planning, not a productivity score. The instant velocity becomes a target, **estimates inflate** ("point inflation"): the same work is quietly re-pointed at 8 instead of 5, velocity climbs 60%, and *nothing ships faster*. Velocity is self-reported in its own currency — the most gameable unit imaginable.

**The antidote: measure outcomes, and use a multi-dimensional frame.** Ask "did value reach a user, reliably?" not "how many keystrokes happened?" That's what DORA's lead time and deployment frequency capture (value *delivered*), and what [SPACE](../03-space-framework/middle.md) captures across dimensions so that **Activity is never read alone** — it's contextualized by Satisfaction, Performance, Communication, and Efficiency. SPACE's core thesis is exactly this anti-pattern's antidote: productivity is not a single activity count.

> **Key insight:** Output is what you *did*; outcome is what *changed for a user*. Every activity metric measures output and calls it productivity. The fix isn't a better activity count — it's changing the question to "what value got delivered, and at what quality?"

---

## Anti-Pattern: Single-Metric Tunnel Vision

**The pattern.** Optimizing one metric in isolation, blind to what it pushes elsewhere. A metric never lives alone in a system; almost every one trades off against a sibling.

**How it's gamed.** You don't even need bad intent — honest optimization of one number *silently* degrades another:

- Drive **deployment frequency** alone → ship faster by skipping tests → change failure rate quietly doubles.
- Drive **code coverage** alone → write assertion-free tests that execute lines without checking anything → coverage hits 90%, defect-catching power is zero (see [Code Coverage](../../code-coverage/)).
- Drive **MTTR** alone → declare incidents "resolved" the moment the pager stops, before the real fix → recovery *time* looks great, the bug recurs Tuesday.

The single metric becomes a balloon: squeeze it here, it bulges there — and you weren't watching "there."

**The antidote: a balanced set, with paired metrics.** Never optimize one number without its **counterweight** in view. DORA is built on exactly this principle: the four keys split into a **speed pair** (deployment frequency, lead time) and a **stability pair** (change failure rate, time to restore), and the headline finding of *Accelerate* is that elite teams move the *speed* metrics *and* the *stability* metrics **together** — speed and stability are not a trade-off you must choose between. Reading them as a set is what stops "go faster" from quietly meaning "break more."

> **Key insight:** Any single metric optimized alone will be satisfied by damaging something it can't see. The job of a balanced set — and especially of a *pair* — is to put the "something it can't see" right next to it, so the damage is no longer invisible.

---

## Anti-Pattern: Targets & Quotas on Metrics

**The pattern.** Turning a *signal* into a *target*: "every team must hit a deployment frequency of daily," "lead time must be under 24h by Q3," "close 20 tickets a sprint." This is Goodhart's law invoked *by name* — the literal act of making a measure a target.

**How it's gamed.** A hard target supplies the motive and the deadline; gaming is the rational response:

- A lead-time target → split one real change into five trivial PRs so the *per-change* clock looks short.
- A deployment-frequency target → deploy empty no-op commits to pad the count.
- A ticket-quota → break one task into twenty micro-tickets, or close-and-reopen.

The target is met on the dashboard and missed in reality — the worst of both worlds, because now leadership *believes* the problem is solved.

**The antidote: use metrics as signals and trends, not targets.** A metric should *start a conversation*, not end one with a pass/fail. Watch the **direction over time** ("our lead time has crept up three sprints running — why?"), not a threshold a team must clear or be punished. Targets convert a diagnostic instrument into a thing to defeat; trends keep it diagnostic. If you must set goals, set them on *outcomes the team agrees matter* and let the team choose how to move the underlying signal.

> **Key insight:** The difference between a healthy metric and a corrupted one is often just the sentence attached to it. "Lead time is rising — let's investigate" is a signal. "Hit 24h or else" is a target, and you've just authored the gaming.

---

## Anti-Pattern: Vanity Metrics & Comparing Teams

Two distinct traps that share a flavour: numbers that look meaningful but aren't.

**Vanity metrics.** A vanity metric is one that reliably goes *up*, looks impressive on a slide, and changes *no decision*: total commits this year, total lines in the codebase, cumulative deploys-ever, registered users (vs *active* users). The tell is the question **"if this number doubled, what would we do differently?"** — if the answer is "nothing," it's vanity.

- *How it misleads:* it manufactures a feeling of progress while the team's actual delivery is flat or declining. It's optimized for *reporting upward*, not for *learning*.
- *The antidote:* **actionable metrics** tied to an outcome and a decision. Every metric on a dashboard should have an owner who can name the action a *change* in it would trigger. If a number can only be admired, not acted on, cut it.

**Comparing teams.** Ranking teams against each other on the same number ("Team A's lead time beats Team B's") ignores that lead time, failure rate, and deploy frequency are dominated by **context**: a team shipping a regulated payments core *should* deploy more carefully than a team on an internal dashboard. Cross-team comparison punishes the team with the harder problem and rewards the one with the easier one — and invites the loser to game rather than improve.

- *The antidote:* judge **each team against its own trend**. The only fair comparison is a team to its past self. "Are *we* better than *we* were last quarter?" is answerable and motivating; "are we beating Team B?" is unfair and corrupting.

> **Key insight:** A metric earns its place on a dashboard by changing a decision; if a change in it triggers no action, it's décor. And the only honest baseline for a delivery metric is the same team's own history — never another team with a different problem.

---

## Anti-Pattern: Weaponizing Metrics for Performance Reviews

**The pattern.** Wiring delivery or activity metrics into *individual* performance reviews, compensation, promotion, or PIPs — "your PR count is below the team median, so your rating is Meets-Minus."

**How it's gamed — and why it's the most destructive.** This combines individual ranking, targets, and high stakes into one device, so it triggers every gaming behaviour at once *and* poisons the well for all future measurement:

- People game *hard* when their salary depends on it — every move from the individual-metrics section, dialled to maximum.
- **Trust collapses.** The moment engineers learn the metrics feed reviews, they stop treating dashboards as a shared tool for improvement and start treating them as **surveillance**. They optimize for *looking good to the system*, hide problems, and stop reporting the very signals (incidents, blocked work, flaky tests) that the metrics exist to surface.
- The data itself rots. A failure-rate metric is only useful if people *report failures*; tie it to reviews and reported failures drop to zero — not because failures stopped, but because reporting did.

**The antidote: keep delivery metrics out of individual evaluation — firmly and visibly.** This is the headline rule of the whole topic, and DORA, SPACE, and Fowler all state it: metrics are for *improving the system*, not *judging the people*. Say it out loud when you introduce them, and *keep the promise* — one violation and the trust is gone for years. Performance conversations are about scope, impact, growth, and behaviour, assessed by humans; they are not a dashboard lookup.

> **Key insight:** Tie a metric to someone's livelihood and you don't get a productive engineer — you get an expert at producing the metric. Worse, you destroy the data's honesty: the numbers an org most needs (failures, blockers, real status) are exactly the ones people will hide once measurement becomes judgement.

---

## The Antidote: Paired Metrics

The single most important *technique* in this whole topic, because it's the one structural defence against gaming: **always pair a throughput/speed metric with a quality/stability guardrail, so you cannot move one without the other moving too.**

The logic is mechanical. Most gaming works by *trading away* an invisible dimension to inflate a visible one — ship faster by testing less, close tickets faster by closing them sloppily. A paired metric makes the traded-away dimension **visible right next to the one being gamed**, so the trade shows up on the same chart. You can't game throughput up without the paired quality number going *down* in plain sight.

| Throughput metric (speed) | Paired guardrail (quality) | What the pairing prevents |
|---|---|---|
| Deployment frequency | Change failure rate | "Ship more" → shipping junk |
| Lead time for changes | Change failure rate / rollback rate | "Go faster" → skipping review & tests |
| Tickets/PRs closed | Reopen rate / escaped-defect rate | Closing things sloppily to pad the count |
| Code coverage % | Mutation score / escaped-defect rate | Assertion-free tests that cover but don't catch |
| Story velocity | Defect rate + did-it-ship (outcome) | Point inflation with nothing delivered |

This is why DORA's four keys are *designed* as two pairs and reported together: deployment frequency and lead time (speed) are meaningless without change failure rate and time to restore (stability) beside them. A team that "improved" deploy frequency 3× while its failure rate doubled has not improved — and the pair is what tells you so at a glance.

> **Key insight:** A lone metric measures one dimension and can be gamed by sacrificing another. A *pair* measures the trade-off itself. You can't cheat a trade-off — moving the cheat into view is the whole point. If you take one practice from this page, take this: never publish a speed number without its quality partner on the same dashboard.

---

## Worked Example — Fixing a Gamed Metric

A VP announces: **"Every engineer must close at least 15 tickets per sprint."** Walk the full diagnosis-and-redesign loop.

**1. Predict the gaming (before it even starts).** Apply the catalogue. This metric is simultaneously *individual* (per engineer), a *target/quota* (a hard floor), and pure *activity* (ticket count is output, not outcome). That's three anti-patterns stacked — expect maximum gaming.

**2. Observe what actually happens (the "before").**

```
Sprint 12 (quota: 15 tickets/engineer)
  Tickets closed per engineer:  18, 16, 21, 15, 17   ← quota MET, dashboard green
  But:
    - one real feature was split into 12 "sub-tickets" to pad counts
    - bug reopen rate:           9%  → 34%   (closed-but-not-fixed)
    - cross-team help / reviews: dropped (no ticket credit for helping)
    - features actually shipped to users this sprint:  1   (down from 3)
```

The number went *up*; reality went *down*. Surrogation in action — everyone optimized "tickets," nobody optimized "value delivered."

**3. Diagnose with the framework.** The metric measures the wrong unit (individual, not team), at the wrong altitude (activity, not outcome), with the wrong sentence attached (a target, not a signal), and with no guardrail to expose the quality it's destroying (reopen rate was free to explode unwatched).

**4. Redesign — team-level, paired, signal-not-target.**

```
DROP:  per-engineer ticket quota

ADOPT (team-owned, watched as a TREND, never a per-person target):

  Throughput          lead time for changes        (commit → in production)
       PAIRED WITH
  Quality guardrail   change failure rate + reopen rate

  Outcome anchor      # of user-facing changes that shipped & stuck

  Frame: "Our lead time crept from 3d to 6d over three sprints — let's find
          the bottleneck," NOT "each of you must hit X."
```

**5. Why the redesign resists gaming.** Splitting work into confetti no longer helps — lead time is measured *per change reaching production*, and the **paired** failure/reopen rate would spike the instant anyone cut quality to go faster, so the trade is visible on the same chart. It's a *team* number, so hoarding help hurts the very metric the whole team owns. And it's framed as a trend to investigate, not a quota to clear — there's no threshold to defeat. The metric is now a diagnostic instrument again, not a thing to beat.

> **Key insight:** The repair pattern is always the same four moves — **shift the unit to the team, the altitude to outcomes, the framing to a trend, and add the missing paired guardrail.** Run any gamed metric through those four and it stops being gameable.

---

## Rolling Out Metrics Safely

A technically correct metric still fails if it's *introduced* wrong. Three rules turn metrics from a threat into a tool:

1. **Team-owned, not imposed from above.** The team that the metric describes should *choose and read* it. A number a team picked to understand its own bottleneck is a tool; the same number handed down as a mandate is a weapon. Ownership is the difference between "our dashboard" and "their surveillance."
2. **Improvement-framed, never judgement-framed.** State the purpose explicitly and repeatedly: *"this is to find where our system slows us down, not to grade anyone."* Say it at rollout, and prove it by **keeping metrics out of reviews** (see above). The first time a number is used to judge someone, every number becomes something to game.
3. **Transparent and shared.** Everyone sees the same dashboard, including the definitions and the raw inputs. Secret or manager-only metrics breed distrust and let definitions drift; open ones invite the team to improve both the system *and* the measurement. Pair openness with the paired-metric discipline so the team can see for itself that no single number is being chased off a cliff.

> **Key insight:** *Who owns the metric and why* matters more than which metric you pick. A mediocre metric, team-owned and improvement-framed, helps. A perfect metric, imposed and tied to judgement, gets gamed. Get the framing right before you argue about the formula.

---

## Mental Models

- **Surrogation is the map eating the territory.** The metric is a map of the goal. Surrogation is the moment people start navigating the *map* and forget the *territory* exists. Every antidote is a way to keep pointing at the territory.

- **Gaming is a trade-off made invisible.** Almost no metric is gamed by magic — it's gamed by quietly *sacrificing a dimension you weren't watching*. A paired metric drags that dimension into view, so the trade is no longer free.

- **A target is a signal with a threat attached.** The same number is diagnostic as a trend and corrosive as a target. The sentence you wrap around a metric ("let's investigate" vs "hit this or else") decides which one you built.

- **Individual ranking optimizes for the wrong unit.** Software value is produced by *teams* moving work through a *system*. Ranking individuals optimizes a unit that doesn't ship anything — and pays people to stop helping the unit that does.

- **The honesty of data is a function of its stakes.** Low-stakes metrics get reported truthfully. The instant a metric decides pay or promotion, the inconvenient parts of reality (failures, blockers) stop being reported. You can have honest data or judgement-by-metric — not both.

---

## Common Mistakes

1. **Quoting Goodhart but doing nothing structural.** Saying "of course, Goodhart" and then shipping a single un-paired target anyway. The law isn't a disclaimer — it's a design constraint. Pair the metric or expect it gamed.

2. **Pairing in name only.** Putting two *throughput* metrics side by side (deploys + commits) and calling it "balanced." A real pair is throughput **vs** a quality guardrail that *moves the opposite way* when gamed. Two speed metrics game in the same direction.

3. **Letting one metric onto a dashboard.** A solo number invites optimization of that number. If a metric can't earn a guardrail partner, question whether it belongs on the board at all.

4. **Comparing teams "for fairness."** A cross-team leaderboard feels objective and is the opposite — it punishes the harder problem. Compare each team to its own past, never to a peer with different context.

5. **"Just for visibility" creep into reviews.** Metrics enter as a team tool, then a manager "just glances" at them for ratings. That glance is the betrayal that collapses trust. Keep the wall between system metrics and individual evaluation absolute and *visible*.

6. **Confusing velocity with productivity.** Velocity is one team's *planning forecast* in its own made-up unit. Treat it as a productivity score and you've built a point-inflation machine that ships nothing faster.

7. **Mistaking a vanity metric for progress.** If doubling the number changes no decision, it's not a metric, it's a morale poster. Ask the "what would we do differently?" question before adopting any number.

---

## Test Yourself

1. State Goodhart's law precisely, then state what **surrogation** adds that Goodhart alone doesn't.
2. How does Campbell's law go *further* than Goodhart's?
3. Why does ranking individuals by commit count reliably *reduce* team throughput, even if no one is dishonest?
4. A team is told to raise deployment frequency. What's the single metric you'd pair it with, and what gaming does the pair prevent?
5. Velocity climbed 50% over two quarters but the same number of features reached users. What happened, and why is velocity especially prone to it?
6. What's the test for whether a number is a *vanity* metric?
7. Why is "compare each team to its own trend" fair while "rank teams against each other" is corrupting?

<details>
<summary>Answers</summary>

1. Goodhart: *when a measure becomes a target, it ceases to be a good measure* — once people are rewarded by a proxy they optimize the proxy, detaching it from the goal it stood for. Surrogation adds the *cognitive mechanism*: people mentally **substitute the metric for the goal**, genuinely confusing the proxy with the construct — which is why gaming happens even without bad intent.
2. Campbell's law adds that the metric doesn't just become *useless* — it actively **corrupts the underlying process** it was meant to monitor (teaching to the test degrades the education itself, not just the scores).
3. Commits/PRs are an *individual activity* count, so the highest-leverage work — reviewing, mentoring, unblocking teammates — earns the individual *no* credit and *helps a rival's* number. Rational engineers stop collaborating; every individual number looks busy while team throughput collapses.
4. Pair deployment frequency with **change failure rate**. It prevents "ship more" from meaning "ship junk": you can't inflate deploys by skipping tests without the failure rate rising visibly on the same chart.
5. **Point inflation** — the same work was re-estimated at higher points, so velocity rose without more value shipping. Velocity is self-reported in a team-invented unit with no external check, making it the most gameable metric there is; it's a planning forecast, not a productivity score.
6. Ask: **"if this number doubled, what would we do differently?"** If the answer is "nothing," it's a vanity metric — it can be admired but not acted on. Replace it with an actionable metric tied to a decision.
7. Delivery metrics are dominated by **context** (a payments core *should* deploy more carefully than an internal tool), so ranking teams punishes the harder problem and rewards the easier one — and invites gaming. A team vs its own past holds context constant, so the comparison is fair and the improvement question ("better than last quarter?") is answerable.

</details>

---

## Cheat Sheet

```
THE LAWS
  Goodhart    measure → target ⇒ stops being a good measure
  Campbell    + it actively CORRUPTS the process it monitors
  Surrogation people mentally SWAP the metric for the goal (why gaming is near-inevitable)

THE CATALOGUE              GAMED BY                         ANTIDOTE
  individual/ranking       split commits, hoard, stop       measure TEAMS / systems
                           helping
  activity=productivity    LOC/commit/velocity inflation    measure OUTCOMES (DORA/SPACE)
  single-metric tunnel     optimize one, harm an unseen     BALANCED SET / paired metrics
                           sibling
  targets/quotas           instant gaming to the threshold  signals & TRENDS, not targets
  vanity metrics           number that changes no decision  ACTIONABLE, decision-linked
  comparing teams          ignores context, punishes the    each team vs ITS OWN trend
                           hard problem
  perf-review weaponizing  game hard + TRUST COLLAPSES      keep metrics OUT of evaluation

PAIRED METRICS (the core technique)
  pair throughput WITH a quality guardrail that moves opposite when gamed
    deploy frequency  ↔  change failure rate
    lead time         ↔  change failure / rollback rate
    tickets closed    ↔  reopen / escaped-defect rate
    coverage %        ↔  mutation score / escaped defects
  ⇒ can't move one by cheating without the other dropping in plain sight

REPAIR A GAMED METRIC (4 moves)
  unit → team   altitude → outcome   framing → trend   + add the missing GUARDRAIL

ROLL OUT SAFELY
  team-OWNED · improvement-FRAMED · TRANSPARENT · never tied to reviews
```

---

## Summary

- Metric corruption isn't random — it follows **Goodhart's law** (a measure made a target stops measuring), sharpened by **Campbell's law** (it corrupts the *process*, not just the number) and driven by **surrogation** (people mentally swap the metric for the goal). Every anti-pattern is one disease; every antidote defends against surrogation.
- The catalogue, each with its gaming move and antidote: **individual/ranking** (→ measure teams), **activity-as-productivity** (→ measure outcomes / SPACE), **single-metric tunnel vision** (→ balanced set), **targets/quotas** (→ signals & trends), **vanity metrics** (→ actionable), **comparing teams** (→ each team's own trend), **weaponizing for reviews** (→ keep metrics out of evaluation).
- The one structural defence is **paired metrics**: tie a throughput number to a quality guardrail that moves the opposite way when gamed, so the trade-off becomes visible and can't be cheated. DORA's speed *and* stability pairs are the canonical example.
- To repair any gamed metric, run four moves: shift the **unit** to the team, the **altitude** to outcomes, the **framing** to a trend, and add the missing **guardrail**.
- *How* you introduce metrics decides everything: **team-owned, improvement-framed, transparent, and kept out of individual reviews.** Framing beats formula — and the honesty of your data depends on never tying it to judgement.

---

## Further Reading

- *The SPACE of Developer Productivity* (Forsgren, Storey, et al., 2021) — the definitive argument against measuring productivity as one (activity) number; the multi-dimensional antidote.
- *Accelerate* (Forsgren, Humble, Kim) — the four keys *as paired metrics*; the evidence that speed and stability rise together rather than trading off.
- Charles Goodhart (1975) and Marilyn Strathern (1997) — the law and its famous tightening; Donald T. Campbell (1979) — "Assessing the Impact of Planned Social Change."
- Choi, Hecht & Tayler — the management-accounting papers that named and tested **surrogation**.
- Martin Fowler — *CannotMeasureProductivity* — why output measurement of developer productivity is a category error.

---

## Related Topics

- [01 — The DORA Four Keys](../01-dora-four-key-metrics/middle.md) — the canonical paired metrics: speed and stability, read together.
- [03 — The SPACE Framework](../03-space-framework/middle.md) — the multi-dimensional answer to "activity ≠ productivity."
- [Code Quality Metrics](../../code-quality-metrics/) — the same Goodhart traps applied to *code*-level numbers (complexity, coupling, duplication).
- [Code Coverage](../../code-coverage/) — the textbook single-metric trap: coverage gamed without catching bugs, and the mutation-score guardrail that pairs it.
- [junior.md](junior.md) — the plain-language version: outputs vs outcomes and the first warnings about gaming.
- [senior.md](senior.md) — designing an org-wide metrics program, measurement governance, and defending it at scale.
