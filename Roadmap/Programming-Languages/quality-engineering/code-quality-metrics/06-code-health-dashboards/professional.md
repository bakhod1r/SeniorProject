# Code Health Dashboards — Professional Level

> **Roadmap:** [Code Quality Metrics](../README.md) → Code Health Dashboards
> *The senior page taught you which numbers a dashboard should aggregate and how to read a trend. This page is about rolling that dashboard out across an org and keeping it alive — where the hard problems are no longer statistical but political: getting teams to open it, stopping leadership from turning it into a leaderboard, making an "A" mean the same thing in twelve repos, and proving the whole thing moved a real outcome and not just a score.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [The Adoption Path — Advisory, Then Gate, Then Ritual](#the-adoption-path--advisory-then-gate-then-ritual)
4. [Making a Dashboard Teams Use vs Ignore](#making-a-dashboard-teams-use-vs-ignore)
5. [The Politics — Goodhart at Org Scale](#the-politics--goodhart-at-org-scale)
6. [Standardizing Across a Polyglot Org](#standardizing-across-a-polyglot-org)
7. [Choosing the Platform and Total Cost](#choosing-the-platform-and-total-cost)
8. [Driving Real Outcomes, Not Score Improvement](#driving-real-outcomes-not-score-improvement)
9. [The Executive Conversation](#the-executive-conversation)
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

> Focus: **Rolling out and governing a code-health dashboard across an org — adoption, anti-gaming governance, polyglot standardization, build-vs-buy, and tying it to real outcomes.**

The senior page was about the artifact: which metrics to aggregate, why trends beat absolutes, how to risk-weight by churn. This page is about everything that happens *after* you stand the thing up. A dashboard is trivial to deploy and astonishingly easy to render worthless. The failure modes are organizational, not technical: a beautiful portal nobody opens; a "quality gate" so noisy teams route around it; a leadership chart that turned the maintainability rating into a performance-review input and quietly trained every team to game it; twelve repos where "Rating A" means twelve different things because nobody standardized the config.

None of these are new *metrics* problems — they're the metric pitfalls from the earlier tiers (Goodhart, the comparability trap, vanity numbers) now multiplied by org politics, budget, and a roadmap of teams who did not ask for this. The skill at the professional level is judgment about *adoption and governance*: knowing that a dashboard becomes a weapon the instant it enters a perf review, that an "A" is only comparable if the config is identical, that the only defensible justification for the spend is a moved outcome — defect rate, lead time — not a moved score. This is the pragmatic, battle-tested layer: how to make the dashboard a tool teams reach for, and keep it from becoming a stick that destroys its own data.

---

## Prerequisites

- **Required:** [senior.md](senior.md) — aggregation, ratings, trends-over-absolutes, risk-weighting by churn, the vanity-panel problem.
- **Required:** You've felt Goodhart's law in practice — watched a number get gamed once someone's incentive attached to it.
- **Helpful:** You've owned a tool rollout across more than one team, and seen the gap between "deployed" and "adopted."
- **Helpful:** You've sat in a budget conversation where you had to justify a recurring license against an outcome.

---

## The Adoption Path — Advisory, Then Gate, Then Ritual

The single most common rollout mistake is starting with enforcement: flip on a quality gate org-wide on day one, fail everyone's pipeline against a baseline they didn't set, and watch trust evaporate before the dashboard has shown a single team any value. Adoption is a sequence, and the order is not negotiable.

**Stage 1 — Advisory (weeks, not days).** The dashboard reports, blocks nothing. It posts findings on the PR as a comment or a non-blocking check. The goal is purely to let teams *see their own code* in the tool and confirm the findings are real and relevant before anything depends on them. This stage exists to earn the right to gate later — and to surface false positives while they cost nothing. Teams that meet the gate as a surprise treat it as an obstacle; teams that watched the advisory numbers for a month treat it as a baseline they already understand.

**Stage 2 — New-code gate (the only gate that works).** Gate on the *diff*, never the whole repo. The rule is "don't make it worse": new or changed code in this PR must meet the bar (no new code smells above severity X, coverage on new lines ≥ Y, no new complexity hotspots), while the mountain of legacy debt is explicitly *out of scope* for the gate. This is the **clean-as-you-code** model and it is the difference between a gate teams accept and one they revolt against. A whole-repo gate on a legacy codebase fails the first PR that touches a bad file for reasons that PR did not cause — so people disable the gate, exempt the repo, or learn to hate the tool. A new-code gate is always passable by definition: it only asks you not to add new problems.

**Stage 3 — Trend reviews (the ritual that makes it stick).** Once gating is normal, the dashboard's recurring value is the *trend conversation*, not the daily red/green. A standing review — monthly per team, quarterly for hotspots at the org level — looks at direction: is new-code quality holding, are the worst hotspots shrinking, did last quarter's refactor actually move the curve. This is what converts a dashboard from a CI gate (easy to ignore once green) into a decision-making instrument (a thing leadership and teams *consult*).

> **The professional reality:** the adoption path is advisory → new-code gate → trend reviews, and skipping a stage is how rollouts die. Day-one enforcement on legacy code is the canonical own-goal: it fails honest PRs, trains people to route around the tool, and burns the trust you need for the gate to mean anything. Earn the gate; then earn the ritual.

---

## Making a Dashboard Teams Use vs Ignore

A dashboard nobody opens has a measurable quality score and zero effect on quality. The line between "tool teams reach for" and "portal that rots" comes down to four properties, every one of which the default install gets wrong.

**It shows the team their own code, scoped to them.** A single org-wide page where a team has to filter to find their service is a page they won't open. Each team needs a view that is *theirs* on landing — their repos, their trend, their hotspots — with no filtering tax. If finding "my code's health" takes more than one click, the dashboard has already lost to the backlog.

**Every finding has an actionable next step.** "Maintainability: C" is a grade, not an action; it tells a team they're bad without telling them what to do, which is exactly the framing that breeds resentment and gaming. The useful unit is *this function, this line, this duplication block, here's the issue, here's roughly the fix.* A finding a developer can act on in the next twenty minutes drives behavior; a letter grade on a panel drives eye-rolls. The dashboard's job is to point at a specific place to go look, never to issue a report card.

**It lives in the workflow, not in a separate portal.** This is the one that decides everything. A dashboard that is a *destination* — a URL you have to remember to visit — competes with the entire backlog for attention and loses. A dashboard that is *in the PR* — a check, an inline comment, a one-line summary on the diff — meets developers where the work already is and requires no behavior change at all. The most-used "dashboard" in a healthy org is usually the PR decoration; the web portal is where you go for the quarterly trend, not the daily signal. Integrate into code review first; the portal is secondary.

**It is honest about noise.** A gate or comment that fires on false positives or pre-existing debt teaches developers to ignore it wholesale — and once they've learned to dismiss it, they dismiss the true positives too. New-code scope (above) is the primary noise filter; tuning out low-value rules is the second. A quiet, mostly-right signal beats a loud, often-wrong one every time, because attention is the scarce resource you're actually managing.

> **The litmus test:** if you turned the dashboard off for a month, would anyone notice? If the answer is "only the people who built it," you've shipped a portal, not a tool. The fix is almost never more metrics or a prettier UI — it's moving the signal into the PR, scoping it to new code, and making each finding point somewhere specific.

---

## The Politics — Goodhart at Org Scale

> *"When a measure becomes a target, it ceases to be a good measure."* — Goodhart's law, in the form that will define your rollout.

The earlier tiers taught Goodhart as a property of individual metrics. At org scale it becomes a property of *incentive structures*, and it has one dominant failure mode: **the moment leadership turns the dashboard into a team leaderboard or a performance-review input, the data dies.** This is not a risk to manage carefully; it is a line not to cross.

The mechanism is precise and fast. The instant a team's maintainability rating, coverage number, or hotspot count affects how they're ranked, funded, or reviewed, the rational move stops being "improve the code" and becomes "improve the number" — and the number is far cheaper to move than the code. Coverage gets padded with assertion-free tests that execute lines without checking anything. Complexity drops because functions get split into artificial pieces that are individually simple and collectively incomprehensible. Smells vanish via `// NOSONAR` and blanket suppressions. Files get deleted or excluded from scanning. None of this improves the software; all of it improves the score; and now the dashboard is actively lying to the very leaders who weaponized it. You have spent budget to build an instrument and then trained your org to feed it noise.

The comparison trap compounds it. Cross-team leaderboards punish teams working in inherently harder domains — a team on a gnarly legacy billing core will always "lose" to a team on a greenfield CRUD service, regardless of skill or effort, because the metric measures the *terrain*, not the *climbing*. Ranking on it is both unfair and uninformative, and everyone subject to it knows that, which is precisely why they game it without guilt.

**Keeping it a tool, not a weapon:**

- **State the non-use explicitly, in writing, from leadership.** "These metrics are diagnostic; they will never appear in performance reviews or be used to rank teams." Said once and meant, this is what makes honest numbers possible. Unsaid, every team assumes the worst and pre-games.
- **Give teams their numbers; give leadership the aggregate trend.** Teams see their own detail to act on. Leadership sees org-level direction (is new-code quality improving, are critical hotspots shrinking) — never a sortable per-team table. Withholding the leaderboard view is a feature, not an omission.
- **Reward the behavior, not the score.** Celebrate "team X ran a hotspot review and cut incidents in that module," not "team X has the highest rating." The first is an outcome; the second is a target waiting to be gamed.
- **When a number looks great, get suspicious.** A sudden jump in coverage or drop in complexity is more often gaming than genius. Investigate good news, not just bad.

> **The professional reality:** the fastest way to destroy a code-health program is for an executive to put one of its numbers on a slide that ranks teams. It feels like accountability; it is actually the starting gun for org-wide gaming, after which the dashboard measures compliance theater instead of quality. Protecting the dashboard *from its own sponsors* is part of owning it.

---

## Standardizing Across a Polyglot Org

A rating is a promise of comparability: an "A" should mean the same thing whether it's on a Go service, a Java monolith, or a Python data pipeline. The default state of a fresh rollout breaks that promise immediately, and a rating you can't trust across repos is worse than no rating — it invites exactly the cross-team comparisons that aren't valid.

The problem is **configuration drift**. Each repo onboards with slightly different rule sets, severity thresholds, coverage exclusions, and gate definitions — often because each team tuned its own. Now "Rating A" in repo X required 80% coverage and a strict rule set, while "Rating A" in repo Y required 50% and a permissive one. The grades are not on the same scale, but the dashboard renders them in the same column with the same letter, and a manager glances across and draws a false conclusion. This is the **comparability trap** the [maintainability-index](../02-maintainability-index/professional.md) topic warns about, now playing out at the dashboard level: a single composite letter, presented as comparable, computed under incompatible rules.

The fix is a **shared, version-controlled quality profile**:

- **One canonical rule set and gate definition per language**, owned centrally, applied by inheritance — not copy-pasted per repo where it drifts. Teams *inherit* the org profile; local overrides are explicit, reviewed, and rare. (SonarQube calls these Quality Profiles and Quality Gates; the principle is platform-agnostic.)
- **Identical gate thresholds across repos** so a green gate means the same bar everywhere. If billing genuinely needs a stricter bar than an internal tool, that's a deliberate, documented tier — not accidental drift.
- **Accept that cross-language numbers are only roughly comparable even when configured identically.** Cyclomatic complexity, duplication detection, and idiomatic patterns differ enough between, say, Go and Scala that a Go "A" and a Scala "A" are *similar*, not *equal*. Standardize aggressively to make them comparable; then still resist ranking on the residual difference.

> **The principle:** an unstandardized rating is a number dressed up as a comparison. If you let each repo define its own profile, you haven't built one dashboard — you've built N dashboards sharing a logo, and the moment anyone compares across them they're comparing different scales. Centralize the profile, inherit it everywhere, and treat any per-repo override as a reviewed exception with a reason.

---

## Choosing the Platform and Total Cost

The build-vs-buy and which-tool decisions are where money meets value, and the failure mode is buying the most capable tool, paying per-seat for the whole org, and discovering a year later that nobody opens it. The platform matters far less than the rollout — but the platform has a price tag and an owner, and both need a deliberate decision.

The honest landscape:

| Option | Strength | Watch out for |
|---|---|---|
| **SonarQube** (self-hosted) | Mature, polyglot, clean-as-you-code gate, deep PR integration; you control data and rules | You run and upgrade the server; license tiers gate branch/PR analysis and some languages |
| **SonarCloud** (hosted) | Same engine, no server to run; easy CI/PR wiring | Recurring per-LOC/seat cost; data leaves your perimeter |
| **CodeScene** | Behavioral analysis — churn × complexity hotspots, change coupling, team-knowledge maps; outcome-oriented by design | Different mental model; cost; its strength (hotspots) overlaps but doesn't replace a smells/coverage gate |
| **Code Climate** (Quality) | Fast setup, good GitHub flow, maintainability + coverage | Less depth than Sonar/CodeScene for large polyglot estates |
| **Build-your-own** (linters + coverage + a churn script → a panel) | Free of license, exactly your rules, no data egress | *You* are now the vendor: maintenance, upgrades, on-call, and the feature backlog are yours forever |

The total cost is never just the license. Account for all four:

1. **License / subscription** — per-LOC, per-seat, or self-host tier. The sticker price.
2. **Operations** — for self-hosted, someone patches, upgrades, and keeps it up; that's real headcount time, not zero.
3. **Integration and maintenance** — wiring it into every pipeline and PR, maintaining the shared profile, onboarding new repos. Ongoing, not one-time.
4. **The adoption cost** — the time spent driving the advisory → gate → ritual path. *The most expensive line item is the one teams skip*: a fully-paid tool with zero adoption is 100% waste, which is why an expensive tool nobody opens is the worst outcome of all.

**Who owns it** is not an afterthought — it's the variable that most predicts success. An unowned dashboard rots: rules go stale, the server lags versions, new repos never onboard, false positives never get tuned, and the trend review never happens because no one's job it is. A platform/DevEx team (or a named owner) must own the profile, the integration, and the *trend ritual*. Build-vs-buy reduces to a staffing question: buy when you lack the team to run and evolve a tool indefinitely (almost always); build only when your rules are genuinely unusual *and* you have a team that will own the result like a product.

> **The professional reality:** the dashboard's value is set by adoption, not by the tool's feature list — so the expensive mistake is optimizing the *purchase* (most features, biggest license) while under-investing the *rollout* (advisory path, PR integration, named owner). A cheaper tool that's woven into every PR and owned by someone beats a best-in-class platform that nobody opens, every time.

---

## Driving Real Outcomes, Not Score Improvement

The only defensible justification for a code-health program is that it moved a *real* outcome. "We raised the org maintainability rating from B to A" is not an outcome — it's the score improving, which (post-Goodhart) might mean the code got better or might mean the org got better at gaming. The outcomes that matter live one layer out, in delivery and reliability.

**Tie dashboard action to delivery and defect metrics, not to the dashboard's own numbers.** The chain you're actually claiming is: *bad code health → more defects and slower changes → fix the worst of it → fewer defects, faster changes.* So measure the *ends*, not the *means*: when a team refactors a hotspot, did the **defect rate** in that module fall and did **lead time / change failure rate** for changes touching it improve? Those are [DORA-style delivery metrics](../../engineering-metrics-and-dora/) and they're the language that proves the program works. A rising rating with no movement in defects or lead time is a vanity result — possibly even a gamed one.

**Run quarterly hotspot reviews as the engine.** The recurring, high-leverage ritual is reviewing the **churn × complexity hotspots** (the [code-churn-and-hotspots](../04-code-churn-and-hotspots/professional.md) signal) every quarter and deliberately picking one or two to invest in — because hotspots are where complex code meets frequent change, i.e. where defects and delivery drag actually concentrate. This focuses finite refactoring budget on the small set of files that dominate the pain, instead of spreading effort to "raise the average." It's the one ritual that reliably converts dashboard data into a reduced-incident outcome, and it feeds straight into [technical-debt management](../../technical-debt-management/) for prioritization.

**Sunset vanity panels ruthlessly.** Most dashboards accrete charts nobody acts on — a gauge of total lines, a pie of language breakdown, a number that's been flat and ignored for a year. Every panel that doesn't drive a decision is attention-debt: it dilutes the signals that do matter and makes the dashboard feel like noise. Audit panels periodically and ask of each one: *what decision did this change in the last quarter?* If the answer is "none," delete it. A dashboard with five panels that drive action beats one with thirty that decorate.

> **The hard-won lesson:** the score is the means; the outcome is the end. A program that can show "we reviewed hotspots, refactored the worst, and incidents in those modules dropped while lead time held" has earned its budget and its trust. A program that can only show "the rating went up" has, at best, proven nothing and, at worst, documented its own gaming.

---

## The Executive Conversation

Sooner or later you stand in front of leadership and explain what this program buys. Getting this conversation right protects the dashboard from the two ways executives unintentionally kill it: turning it into a leaderboard (covered above) and expecting it to promise things it can't. Set expectations precisely.

**What the dashboard *can* promise:**

- **Visibility into where risk concentrates** — which modules are hotspots, where new code is degrading, where debt is densest. A map of where to look.
- **A guardrail against decay** — the new-code gate keeps things from getting *worse* on every PR, which is the realistic win: arresting the slide, not magically reversing decades of debt.
- **A prioritization input** — data to decide *which* debt to pay down first, defensible against "just ship features."
- **Trend direction over time** — whether the org's code health is improving, holding, or sliding, at a level useful for planning.

**What it *cannot* promise:**

- **It is not a quality score for the org or a productivity measure for teams.** It measures properties of code, not the value, correctness, or business impact of the software — and it absolutely does not measure how good a team is. Presented as either, it becomes the leaderboard that gets gamed.
- **A high rating does not mean bug-free or well-architected.** The metrics catch *local* complexity and decay; they miss architecture-level problems, wrong abstractions, and domain bugs entirely. An "A" is "no obvious local rot," not "this is good software."
- **It won't pay down debt on its own.** The dashboard points; humans fix. Without allocated time for the hotspot work it surfaces, it's a very precise description of problems no one is funded to solve.
- **The numbers aren't precise to the decimal.** A rating moving B→A is a weak signal worth a look, not a measured fact worth a target. Treat ranges and directions, not point values.

> **The framing that survives contact with leadership:** "This tells us *where to look* and stops things getting *worse*; it does not grade teams, and it doesn't fix anything by itself — that needs allocated time." An exec who hears that gets a useful instrument. An exec who hears "this is our quality score, higher is better, let's compare teams" gets a gamed leaderboard within two quarters. The conversation is where you either protect the tool or hand someone the means to break it.

---

## War Stories

**The leaderboard that triggered gaming and got killed.** A VP, wanting "data-driven accountability," put a sortable per-team table of maintainability ratings and coverage into the monthly business review. Within one quarter coverage numbers climbed across every team — and incidents didn't move at all. Investigation found the rise was assertion-free tests written purely to execute lines, plus a wave of `// NOSONAR` suppressions and a few files quietly excluded from scanning. The dashboard now measured how well teams gamed it. The fix was blunt: leadership killed the leaderboard, issued a written statement that the metrics would never appear in reviews or rankings again, and switched to reporting only an org-level aggregate trend. Honest numbers slowly returned — but it took quarters to rebuild the trust one slide had destroyed. The lesson: the leaderboard *was* the bug.

**The hotspot ritual that actually cut incidents.** A platform team stopped chasing the org-wide average and started a quarterly hotspot review: rank files by churn × complexity, pick the top two, fund a focused refactor, then watch the *defect rate and lead time* for changes touching those modules — not the rating. Quarter over quarter, incidents in the reviewed hotspots fell and changes to them got faster. They could show leadership a real outcome — fewer pages, shorter lead time — tied to specific, deliberate work. That outcome, not the dashboard's color, is what kept the program funded. The ritual, not the tool, did the work.

**The expensive tool nobody opened.** An org bought the most capable platform on the market, paid per-seat for every engineer, and ran a launch announcement — then did nothing else. No advisory period, no PR integration, no named owner, no trend ritual. A year later the renewal came up and someone pulled usage: a handful of logins a month, almost all from the team that bought it. The findings lived in a portal disconnected from where anyone worked, so the work never reached anyone's flow. They had paid full price for a dashboard with effectively zero adoption — the purest form of waste. They didn't renew; they bought a cheaper option, wired it into every PR, and named an owner. The lesson: they had optimized the purchase and skipped the rollout, and the rollout was the entire job.

**The twelve A's that meant twelve things.** A polyglot org let every repo onboard with its own rule set and coverage exclusions. The dashboard showed a tidy column of ratings; a director glanced across, concluded two teams were "behind," and reallocated headcount. But the ratings weren't on the same scale — one team's "B" came from an 80% coverage bar and a strict profile, another's "A" from a 50% bar and a permissive one. A decision got made on a comparison that was never valid. The fix was a single centrally-owned quality profile inherited by every repo, with per-repo overrides as reviewed exceptions — after which an "A" finally meant roughly the same thing everywhere.

---

## Decision Frameworks

**Where on the adoption path should this rollout be? Ask:**
- Have teams seen their own code in the tool and confirmed findings are real? → if no, stay **advisory**; don't gate yet.
- Is the gate scoped to *new code only* (the diff), not the whole legacy repo? → if no, fix that *before* gating, or the gate gets disabled.
- Is gating normal and uncontroversial? → add the **trend-review ritual** (monthly per team, quarterly hotspots).

**Should this metric go in front of leadership? Ask:**
- Will it be shown as a per-team ranking or feed a perf review? → **stop.** That's the line; it triggers gaming and kills the data.
- Is it an org-level aggregate trend, or a team-owned detail? → leadership gets the **aggregate trend**; teams get their own detail.
- Am I rewarding the *score* or the *behavior/outcome*? → reward the hotspot review and the dropped incident count, never the rating.

**Is this rating comparable across repos? Ask:**
- Do all repos inherit one centrally-owned quality profile and gate? → if no, the ratings are on different scales; don't compare them.
- Is any per-repo override a reviewed, documented exception? → if overrides are ad-hoc drift, the "A" is a false comparison.

**Build or buy? Ask:**
- Do I have a team that will own a tool like a product (upgrades, profile, integration, trend ritual) indefinitely? → if no, **buy**.
- Are my rules genuinely unusual *and* worth a permanent maintenance burden? → only then consider **build**.
- Have I budgeted the *adoption* cost, not just the license? → if not, you're about to buy shelfware.

**Is the program working? Default to measuring:**
- **Defect rate and lead time** for changes touching reviewed hotspots — *not* the dashboard's own rating. A moved outcome justifies the spend; a moved score does not.

---

## Mental Models

- **A dashboard's value equals its adoption, not its feature list.** A measured score that nobody acts on changes nothing. The whole game is getting the signal into the PR and into a recurring ritual — the tool is the easy part.

- **The adoption path is one-directional: advisory → new-code gate → trend reviews.** Skip the advisory and the gate is a surprise teams route around; skip the new-code scope and the gate fails honest PRs. Earn each stage.

- **The instant a metric enters a perf review or a leaderboard, it stops measuring quality and starts measuring gaming.** Goodhart isn't a tendency here; it's a switch. Protecting the dashboard from its own sponsors is part of owning it.

- **An "A" is a comparison, and a comparison needs one scale.** Unstandardized profiles make N dashboards wearing one logo. Centralize the profile or stop comparing across repos.

- **The score is the means; the outcome is the end.** Tie action to defect rate and lead time, never to the rating. "The number went up" proves nothing — possibly less than nothing.

- **Every panel that drives no decision is attention-debt.** Vanity charts dilute the signals that matter. Audit and delete; five acted-on panels beat thirty decorative ones.

---

## Common Mistakes

1. **Day-one enforcement on legacy code.** A whole-repo gate fails the first honest PR for problems it didn't cause, and teams disable or route around it. Go advisory first; gate on *new code only*. The new-code gate is the only one that survives contact with a legacy estate.

2. **Shipping a portal instead of a PR signal.** A destination URL competes with the backlog and loses. Put findings *in the PR* — a check, an inline comment, a one-line summary. The portal is for the quarterly trend, not the daily signal.

3. **Letting leadership build a leaderboard.** A per-team ranking or a perf-review input is the starting gun for org-wide gaming. Give teams their detail and leadership the aggregate trend; state the non-use in writing. This is the mistake that kills programs.

4. **Letting each repo define its own profile.** Config drift makes "Rating A" mean different things in different repos — the comparability trap at dashboard scale. Centralize one quality profile per language, inherit it everywhere, treat overrides as reviewed exceptions.

5. **Optimizing the purchase and skipping the rollout.** The most capable, most expensive tool with zero adoption is 100% waste. Budget the advisory→gate→ritual path and name an owner *before* you sign the license. Adoption is the line item that actually buys the outcome.

6. **Reporting score improvement as the outcome.** "Rating went B→A" is the means, and post-Goodhart it might be gaming. Prove the program with defect rate and lead time on reviewed hotspots — the delivery outcomes one layer out.

7. **No owner, so the dashboard rots.** Stale rules, a lagging server, un-onboarded repos, untuned false positives, a trend review that never happens. An unowned dashboard decays into noise. Name a team that owns the profile, the integration, and the ritual.

8. **Hoarding vanity panels.** Total-LOC gauges and language pie charts that drive no decision dilute the real signal. Audit every panel against "what did this change last quarter?" and delete the ones that answer "nothing."

---

## Test Yourself

1. Your org wants to roll out a code-health dashboard across 40 repos. Lay out the adoption path and explain why starting with an org-wide quality gate is the canonical mistake.
2. Why does a *new-code* gate get accepted while a *whole-repo* gate on a legacy codebase gets disabled? What's the principle that makes the new-code gate always passable?
3. A VP puts a sortable per-team table of maintainability ratings into the monthly review "for accountability." Predict what happens over the next two quarters and explain the mechanism. What's the fix?
4. Twelve repos all show "Rating A," and a director reallocates headcount based on the two showing "B." What's wrong with that decision, and what's the structural fix?
5. Leadership asks you to justify the dashboard's recurring license. What outcome do you measure to prove it works, and why is "we raised the rating from B to A" not an acceptable answer?
6. Walk through the build-vs-buy decision. What's the single variable that most predicts success, and what is the most expensive line item people forget?
7. State two things a code-health dashboard *can* promise leadership and two it *cannot*. Why does getting this conversation right protect the tool?

<details>
<summary>Answers</summary>

1. **Path:** advisory (reports, blocks nothing — teams see their own code, false positives surface while they're free) → **new-code gate** (gate the diff, "don't make it worse," legacy out of scope) → **trend reviews** (monthly per team, quarterly hotspots — the ritual that makes it a decision tool). **Why day-one gating fails:** it fails honest PRs against a baseline teams didn't set and didn't get to clean up, so trust evaporates and people disable or route around the gate before the dashboard has shown any value. You must earn the gate.
2. A whole-repo gate fails the first PR that *touches* a bad legacy file, for problems that PR did not cause — so it punishes honest work and gets disabled. A new-code gate only evaluates the *diff* ("no new smells/complexity, coverage on new lines"), so it's **always passable by definition**: it only asks you not to *add* new problems, leaving the legacy mountain explicitly out of scope. That's the clean-as-you-code principle.
3. Over two quarters the ranked numbers climb (coverage up, smells down) while **incidents don't move** — because the rational response to a metric tied to ranking is to move the *number*, which is cheaper than moving the code: assertion-free tests, `// NOSONAR` suppressions, excluded files, artificially split functions. The dashboard now measures gaming. **Mechanism:** Goodhart — a measure tied to an incentive stops being a good measure. **Fix:** kill the leaderboard, state in writing that the metrics won't be used for ranking or reviews, and report only an org-level aggregate trend; rebuild trust over time.
4. The ratings aren't on the same scale — each repo onboarded with its own rule set, coverage bar, and exclusions, so one team's "B" (strict profile, 80% bar) can reflect better code than another's "A" (permissive profile, 50% bar). It's the **comparability trap**: a composite letter presented as comparable but computed under incompatible rules. **Fix:** one centrally-owned quality profile and gate per language, inherited by every repo, with per-repo overrides only as reviewed, documented exceptions.
5. Measure **defect rate and lead time (DORA-style delivery metrics) for changes touching the hotspots you reviewed and refactored** — the real outcomes one layer out from the score. "Rating B→A" is unacceptable because it's the *means*, not the *end*: post-Goodhart it might mean the code improved or might mean the org got better at gaming, so on its own it proves nothing. The defensible claim is "we refactored the worst hotspots and incidents there dropped while lead time held."
6. **Decision:** buy when you lack a team to own a tool like a product (upgrades, shared profile, PR integration, trend ritual) indefinitely — which is almost always; build only when your rules are genuinely unusual *and* you'll staff the result permanently. **Single variable that predicts success:** a named **owner** for the profile, integration, and ritual — unowned dashboards rot. **Forgotten line item:** the **adoption cost** (driving advisory→gate→ritual and PR integration); a fully-paid tool with no adoption is 100% waste.
7. **Can:** show *where risk concentrates* (hotspots, degrading new code); act as a *guardrail against getting worse* (new-code gate); provide a *prioritization input*; show *trend direction*. **Cannot:** be a *quality/productivity score for teams* (it measures code properties, not team skill or software value); *guarantee good architecture or bug-freedom* (it catches local rot, misses design-level and domain problems); *pay down debt itself* (needs allocated time). Getting it right protects the tool because the two ways execs kill a dashboard are turning it into a leaderboard and expecting promises it can't keep — precise expectations defuse both.

</details>

---

## Cheat Sheet

```
ADOPTION PATH (one-directional — don't skip a stage)
  1. ADVISORY      reports, blocks nothing; teams see own code; tune false positives
  2. NEW-CODE GATE gate the DIFF only ("don't make it worse"); legacy out of scope
  3. TREND REVIEWS monthly per team, quarterly hotspots; the ritual that makes it stick
  RULE: day-one whole-repo gate = canonical own-goal (fails honest PRs, kills trust)

USE vs IGNORE
  team's OWN code on landing (no filter tax)   each finding → actionable next step
  IN the PR (check/comment), not a portal       honest about noise (new-code scope)
  litmus: turn it off a month — would anyone notice?

POLITICS (Goodhart at org scale)
  leaderboard / perf-review input = the data dies (gaming starts immediately)
  → coverage padded, NOSONAR, files excluded, functions split for the metric
  KEEP IT A TOOL:
    teams get their detail; leadership gets the AGGREGATE TREND (no sortable table)
    state non-use in writing; reward behavior/outcome, not score; investigate good news

STANDARDIZE (polyglot)
  one central quality PROFILE + GATE per language, inherited (not copy-pasted)
  identical thresholds → green means the same bar everywhere
  overrides = reviewed exceptions; cross-language A's are ~similar, not equal
  unstandardized rating = N dashboards sharing a logo (comparability trap)

BUILD vs BUY (total cost = 4 lines)
  1 license  2 ops (self-host upgrades)  3 integration/maint  4 ADOPTION (the big one)
  buy unless rules are unusual AND you'll own it like a product forever
  NAME AN OWNER (profile + integration + ritual) or it rots

OUTCOMES, NOT SCORE
  tie action to DEFECT RATE + LEAD TIME on reviewed hotspots — NOT the rating
  quarterly hotspot review (churn × complexity) = the engine
  sunset vanity panels: "what decision did this change last quarter?" → none = delete

EXEC CONVERSATION
  CAN: where to look · guardrail against worse · prioritization input · trend direction
  CANNOT: team score · architecture/bug guarantee · fix debt itself · decimal precision
```

---

## Summary

- **Adoption is a one-directional path: advisory → new-code gate → trend reviews.** Day-one enforcement on legacy code is the canonical own-goal — it fails honest PRs and burns the trust the gate needs. Earn the gate, then earn the ritual.
- **A dashboard's value equals its adoption, not its features.** Show each team their own code, make every finding an actionable next step, and put the signal *in the PR* — not a separate portal nobody opens. If turning it off for a month would go unnoticed, you shipped a portal, not a tool.
- **The instant leadership turns it into a leaderboard or a perf-review input, the data dies** — Goodhart at org scale, and it's a switch, not a tendency. Give teams their detail and leadership the aggregate trend; state the non-use in writing; reward the *behavior*, not the score. Protecting the dashboard from its own sponsors is part of owning it.
- **An "A" is only comparable on one scale.** Centralize one quality profile per language and inherit it everywhere, or you've built N dashboards sharing a logo — the [comparability trap](../02-maintainability-index/professional.md) at dashboard scale.
- **Build-vs-buy is a staffing question, and total cost is four lines** (license, ops, integration, *adoption*). Buy unless your rules are unusual and you'll own it like a product. The expensive tool nobody opens is the worst outcome; name an owner or it rots.
- **Tie action to real outcomes** — defect rate and lead time on reviewed [hotspots](../04-code-churn-and-hotspots/professional.md), never the score itself. Run quarterly hotspot reviews, sunset vanity panels, and feed prioritization into [technical-debt management](../../technical-debt-management/). "The rating went up" proves nothing; a dropped incident count justifies the spend.

You can now roll out and govern a code-health dashboard as an org-level program, not just stand one up. The remaining tier — [interview.md](interview.md) — consolidates the topic into the questions that probe whether someone actually understands adoption, governance, and outcomes versus just naming the tools.

---

## Further Reading

- Adam Tornhill, *Software Design X-Rays* and *Your Code as a Crime Scene* — the behavioral-hotspot and churn × complexity model that powers the quarterly hotspot review (and CodeScene's design philosophy).
- The clean-as-you-code model (SonarSource) — the principle behind the new-code gate that makes rollouts to legacy estates survivable.
- *Accelerate* (Forsgren, Humble, Kim) — the DORA delivery metrics (lead time, change failure rate) you tie dashboard action to, instead of the score.
- Marilyn Strathern's formulation of Goodhart's law ("when a measure becomes a target…") — the one-sentence model for why leaderboards destroy the data they rank.
- Your platform's quality-profile / quality-gate documentation (SonarQube, CodeScene, Code Climate) — the mechanics of centralizing and inheriting a standardized config.

---

## Related Topics

- [04 — Code Churn & Hotspots](../04-code-churn-and-hotspots/professional.md) — the churn × complexity signal that drives the quarterly hotspot review, the dashboard's highest-leverage ritual.
- [02 — Maintainability Index](../02-maintainability-index/professional.md) — the comparability trap behind composite ratings, which the dashboard inherits and multiplies across repos.
- [junior.md](junior.md) · [senior.md](senior.md) · [interview.md](interview.md) — the rest of this topic's tier set.
- [Engineering Metrics & DORA](../../engineering-metrics-and-dora/) — the delivery outcomes (lead time, defect/change-failure rate) you tie dashboard action to, instead of the score.
- [Technical Debt Management](../../technical-debt-management/) — where the hotspot reviews feed prioritization: deciding which surfaced debt to pay down, when, and how to justify it.
