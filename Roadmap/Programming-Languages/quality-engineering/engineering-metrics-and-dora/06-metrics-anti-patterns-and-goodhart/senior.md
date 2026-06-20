# Metrics Anti-Patterns & Goodhart — Senior Level

> **Roadmap:** [Engineering Metrics & DORA](../README.md) → Metrics Anti-Patterns & Goodhart
> *The middle page gave you the catalogue of bad metrics — LOC, velocity, individual leaderboards — and the rules of thumb to avoid them. This page is about the theory underneath the catalogue: why measurement dysfunction is a law, not an accident; the cognitive mechanism by which a number quietly replaces the thing you cared about; and how to design a metric **system** that resists gaming instead of inviting it.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [The Law Family — Goodhart, Campbell, Lucas](#the-law-family--goodhart-campbell-lucas)
4. [Surrogation — The Cognitive Mechanism](#surrogation--the-cognitive-mechanism)
5. [Why Software Productivity Is Especially Unmeasurable](#why-software-productivity-is-especially-unmeasurable)
6. [The McNamara Fallacy and DeMarco's Recantation](#the-mcnamara-fallacy-and-demarcos-recantation)
7. [Designing Measurement That Resists Gaming](#designing-measurement-that-resists-gaming)
8. [The Limits of Resistance](#the-limits-of-resistance)
9. [Statistical Literacy as a Defense](#statistical-literacy-as-a-defense)
10. [Applying This Across the Whole QE Metric Set](#applying-this-across-the-whole-qe-metric-set)
11. [Mental Models](#mental-models)
12. [Common Mistakes](#common-mistakes)
13. [Test Yourself](#test-yourself)
14. [Cheat Sheet](#cheat-sheet)
15. [Summary](#summary)
16. [Further Reading](#further-reading)
17. [Related Topics](#related-topics)

---

## Introduction

> Focus: **The theory of measurement dysfunction, and how to architect a metric system whose structure makes it hard to corrupt — because individual discipline never survives contact with incentives.**

By the middle level you can recognize a bad metric on sight: you know not to count lines of code, not to rank engineers by commits, not to turn velocity into a quota. That is necessary and it is not enough. The reason it is not enough is that *avoiding the known-bad metrics does not make your good metrics safe.* DORA's four keys, SPACE, coverage, complexity — every one of them degrades in exactly the same way the moment it is wired to a high-stakes target. The failure is not in the choice of metric. The failure is in the *system* around it: who owns it, what decisions ride on it, whether anyone's promotion depends on its value.

The senior jump is from *picking metrics* to *designing measurement systems*, and that requires understanding the failure mechanically. There is a family of laws — **Goodhart**, **Campbell**, **Lucas** — that say, with increasing precision, that a measure used for control stops measuring. There is a cognitive mechanism — **surrogation** — that explains *why* humans let a proxy silently replace the construct it stood for. And there is a specific reason software is worse than most domains: productivity is value over effort, and the **value** of software is genuinely, irreducibly hard to quantify. Once you hold all three, the design principles stop being a list of "best practices" and become *derivations* — each one is a structural countermeasure against a specific failure mode. This page builds that chain.

---

## Prerequisites

- **Required:** You've internalized [middle.md](middle.md) — the catalogue of anti-patterns (LOC, velocity-as-target, commit counts, individual metrics, vanity and weaponized metrics) and the basic "measure to improve, not to judge" stance.
- **Required:** Working familiarity with the constructive metric sets this page critiques: the [DORA four keys](../01-dora-four-key-metrics/senior.md) and the [SPACE framework](../03-space-framework/senior.md).
- **Helpful:** You've personally watched a metric get gamed — a team that hit its coverage number by testing getters, a queue that "improved" because tickets were reclassified, a velocity that rose because estimates inflated.
- **Helpful:** Enough statistics to be uncomfortable with the word "average" — you know that a mean hides a distribution and that small samples lie.

---

## The Law Family — Goodhart, Campbell, Lucas

Three independent observations, from three fields, converge on the same conclusion: a measure built to *describe* a system breaks when you use it to *control* the system. Naming them precisely matters, because each draws the boundary of the failure differently, and the differences are load-bearing.

**Goodhart's law — the original statement.** Charles Goodhart, a monetary economist, wrote in a 1975 paper (published 1984) about UK monetary policy: *"Any observed statistical regularity will tend to collapse once pressure is placed upon it for control purposes."* Read it carefully — Goodhart's original claim is narrower and sharper than the popular version. He is not merely saying "people game targets." He is saying that the *statistical relationship itself* — the historical correlation between the proxy and the thing you cared about — **dissolves** under control pressure. The correlation existed because nobody was optimizing the proxy; the moment you optimize it, the conditions that produced the correlation no longer hold.

**Strathern's popular form.** The version everyone quotes — *"When a measure becomes a target, it ceases to be a good measure"* — is not Goodhart's wording. It was coined by anthropologist **Marilyn Strathern** in a 1997 paper ("'Improving ratings': audit in the British University system"), as a generalization of Goodhart. It is more memorable and more general, and it is worth knowing that it is a *paraphrase* — when you cite "Goodhart's law" in this snappy form, you are really citing Strathern's restatement. The distinction guards you against a subtle error: Strathern's form sounds like it is about human cheating, but Goodhart's original is about *the breakdown of a statistical regularity*, which happens even with perfectly honest actors who simply respond rationally to the new incentive.

**Campbell's law — the social-science twin.** Donald T. Campbell, a psychologist, published essentially the same law independently in 1979: *"The more any quantitative social indicator is used for social decision-making, the more subject it will be to corruption pressures and the more apt it will be to distort and corrupt the social processes it is intended to monitor."* Campbell adds two things Goodhart's terse version leaves implicit: a **dose-response relationship** ("the more ... used ... the more ... subject"), and an explicit naming of *two distinct harms* — the indicator gets corrupted (the number lies) **and** the underlying process gets distorted (the reality degrades). Campbell's canonical example is standardized testing: high-stakes tests don't just produce inflated scores, they cause teaching-to-the-test, which damages the education the score was meant to track. In software, the parallel is exact: a coverage target doesn't just inflate the coverage number, it changes what tests get written — toward the cheap-to-cover and away from the hard-and-valuable.

**The Lucas critique — the deepest cut.** Robert Lucas's 1976 critique of macroeconomic policy is the most rigorous member of the family, and the one engineers most often miss. Lucas argued that the historical relationships in an economic model are not structural constants — they are the *aggregated equilibrium behavior of agents responding to the policy regime that existed when the data was collected.* Change the policy, and you change the agents' behavior, which changes the very relationships your model was built on. **The model that predicted the outcome is invalidated by acting on it.** Translated to metrics: any baseline correlation you measured — "teams with higher coverage have fewer defects," "shorter PRs get reviewed faster" — was produced under a regime where *nobody was being managed on that number.* Start managing on it and you've changed the regime; the correlation you're relying on may no longer exist. Lucas is the reason "we validated that this metric correlates with quality, so it's safe to target" is a fallacy: you validated it in the no-incentive regime, and targeting it *is* the regime change that can break it.

> **Key insight:** These are not four ways of saying "people cheat." Goodhart says the *statistical regularity* collapses; Campbell says there's a *dose-response* and *two* harms (corrupted number, distorted reality); Lucas says the *correlation you validated was an artifact of the regime you're about to change.* Together they prove something stronger than "metrics can be gamed": they prove that **using a proxy for control predictably destroys the proxy's validity, even among honest actors** — because the destruction is a property of the incentive, not the morality.

---

## Surrogation — The Cognitive Mechanism

The law family tells you *that* proxies fail under control pressure. It does not tell you *why people stop noticing* — why an organization will defend a corrupted metric long after it has stopped tracking reality. The mechanism comes from management accounting research, and its name is **surrogation**.

**Surrogation is the cognitive tendency to lose sight of the abstract construct a measure is meant to represent, and to treat the measure *as* the construct.** The strategic goal (say, "customer satisfaction") is abstract and hard to hold in mind; its metric (a Net Promoter Score, a CSAT survey) is concrete and on the dashboard. Over time, people stop optimizing satisfaction-the-construct and start optimizing NPS-the-number — not cynically, but because the number has *psychologically substituted* for the goal. The map has eaten the territory.

This is well-documented experimentally. Choi, Hecht, and Tayler (2012, 2013, in *The Accounting Review* and related work) showed that surrogation is stronger when (a) people are compensated on the measure, (b) the measure is presented *alone* rather than alongside the strategic construct it represents, and (c) people had no hand in choosing the measure. Those three findings are not trivia — they are *direct design inputs*, and the resistance principles later in this page are essentially their inverse.

Why surrogation is the dangerous half of the story:

- **It explains the persistence.** Goodhart explains why the metric *breaks*; surrogation explains why nobody *fixes* it. Once the number has become the goal in people's heads, optimizing the number *feels* like succeeding, so the corruption is invisible from the inside. A team gaming its coverage metric does not experience itself as gaming — it experiences itself as "improving coverage," which has become a terminal value.
- **It is a perception failure, not an ethics failure.** Surrogation happens to honest, well-meaning people, which is why "hire better people" and "tell them not to game it" do not work. You cannot moralize your way out of a cognitive bias.
- **It is contagious upward.** Executives surrogate hardest, because they are furthest from the construct and closest to the dashboard. "Velocity is up 20%" substitutes for "we are delivering more value" at exactly the altitude where the substitution is least checkable.

> **Key insight:** Surrogation is the bridge between "metrics get gamed" and "organizations don't notice." Goodhart is the disease; surrogation is the anosognosia — the brain's failure to perceive its own deficit. Every design principle that says *show the metric next to the goal*, *let the team choose the metric*, and *never compensate on the metric directly* is a countermeasure aimed squarely at one of the three experimentally-confirmed amplifiers of surrogation.

---

## Why Software Productivity Is Especially Unmeasurable

Every domain has a Goodhart problem. Software has a *prior* problem that makes it worse: even before any gaming, the thing executives want to measure — "developer productivity" — may not be a measurable quantity at all. Martin Fowler's essay **`cannotMeasureProductivity`** (2003, and unchanged in its conclusion since) lays out the argument that a senior engineer should be able to reconstruct from first principles.

Productivity, in any rigorous sense, is **output value per unit of input effort** — value divided by effort. To measure productivity you must measure both the numerator and the denominator. Software defeats you on the numerator:

- **The value of software is genuinely hard to quantify.** The output of software development is not the code; it is the *value the code delivers* — and that value is realized downstream, over time, by users and the business, mediated by markets, timing, and decisions no engineer controls. A thousand lines of perfectly crafted code for a feature nobody uses has *negative* value (it must be maintained); a one-line config change can be worth millions. There is no units-of-output you can count at the engineering boundary that tracks value, because value is not produced *at* that boundary.
- **The denominator is the only measurable part — which is the trap.** Effort (hours, cost, head-count) is measurable. So when you cannot measure value/effort, the gravitational pull is to measure effort *alone* and call it productivity — or worse, to measure *output volume* (LOC, commits, story points, PRs) as a stand-in for value, which is precisely counting the thing that is not value. Fowler's point lands here: we measure activity because we can, not because it is productivity, and the substitution is invisible (it is surrogation again — the measurable proxy replacing the unmeasurable construct).
- **There is no agreed unit of "software output."** Function points, story points, LOC — none is a unit of *value*; each is at best a unit of *size*, and size is not value. Two functionally identical features can differ 10x in LOC; the smaller is usually better. Any metric whose units increase when the work gets *worse* is not a productivity metric.

Fowler's conclusion is not "give up on metrics." It is the sharper claim that **you cannot directly measure productivity, so any number presented as 'developer productivity' is necessarily a proxy for something else — and you must be ruthlessly honest about what.** This is the foundation under SPACE: SPACE exists precisely *because* productivity is not one measurable number, so it deliberately spreads measurement across multiple dimensions (perceptual, system, workflow) and refuses to roll them into a single score. SPACE is, in a real sense, the engineering response to `cannotMeasureProductivity` — see [03 — SPACE](../03-space-framework/senior.md).

> **Key insight:** Software's measurement problem is two layers deep. Layer one (everyone's problem): any proxy you target gets gamed (Goodhart). Layer two (software's special problem): the construct itself — value-per-effort — is **unmeasurable at the engineering boundary** because value is realized downstream and has no unit. That is why software metric programs fail even harder than testing or policing: in those domains the thing being measured (test scores, crime) is at least *directly* observable. "Productivity" is not.

---

## The McNamara Fallacy and DeMarco's Recantation

Two pieces of intellectual history make the abstract concrete, and a senior should be able to cite both, because they are the two poles of how the field learned this.

**The McNamara fallacy.** Robert McNamara, US Secretary of Defense during the Vietnam War, ran the war by metrics — most infamously the *body count* as a measure of progress. The fallacy named after him is the four-step slide, as the sociologist Daniel Yankelovich articulated it:

1. Measure whatever can be easily measured.
2. Disregard what can't be measured, or assign it an arbitrary number.
3. Presume that what can't be measured easily isn't important.
4. Conclude that what can't be measured doesn't exist.

Step 3 is the heart of it, and it is the inversion that defines the whole anti-pattern: **the McNamara fallacy makes the *measurable* important, rather than making the *important* measurable.** The body count was measurable; whether you were winning was not; so the war was run on body counts, and the easily-counted number became the goal precisely because it could be counted — while the unmeasurable-but-decisive factors (legitimacy, morale, political will) were treated as not existing. The direct software analogue: an org tracks deployment frequency and PR count because they are countable, lets "are we building the right thing" fall off the table because it isn't, and concludes — implicitly, by what it puts on the dashboard — that velocity *is* success. That is the McNamara fallacy in a standup.

**DeMarco's recantation — the field correcting itself in public.** Tom DeMarco's 1982 book *Controlling Software Projects* contained the line that became metric culture's founding scripture: *"You can't control what you can't measure."* For a generation it justified measuring everything. Then, in a remarkable 2009 *IEEE Software* essay ("Software Engineering: An Idea Whose Time Has Come and Gone?"), DeMarco **publicly recanted it.** His revised position, in his own words: *"You can't control what you can't measure"* is a statement that "is not really true" — control is "not the most important aspect" of software projects, and the projects with the highest *value* are precisely the ones where strict measurement and control matter *least*, because their value comes from doing something genuinely new and uncertain. He reframed: metrics are worth their (high) cost only when the thing measured has a real impact on decisions, and for the highest-value, most innovative work, the cost of measuring usually exceeds the benefit.

The recantation matters because it is the single clearest example of *the McNamara fallacy being named and rejected by the very person who gave the field its pro-measurement slogan.* The arc — DeMarco 1982 ("measure to control") to DeMarco 2009 ("control was never the point; measure only what changes a decision and accept that the best work resists it") — *is* the lesson of this entire topic, told as one person's change of mind.

> **Key insight:** Put McNamara and DeMarco together and you get the governing rule of the whole field: **make the important measurable, never make the measurable important — and accept that the most valuable software work is the work that measures worst.** A metric program that quietly redefines "important" to mean "what we happened to instrument" has already failed, no matter how clean its dashboards are.

---

## Designing Measurement That Resists Gaming

Here the page turns from diagnosis to design. None of these principles makes a metric *un*-gameable — the next section is blunt about that ceiling. What they do is *raise the cost of gaming relative to the cost of doing the real work*, and *remove the experimentally-confirmed amplifiers of surrogation*. Each is a derivation, not a slogan: I name the failure mode it counters.

**1. Measure outcomes, not outputs.** An *output* is something engineering produces directly (lines, commits, PRs, deploys, story points); an *outcome* is a change in the world the work was for (a reduced lead time that lets the business respond faster, a dropped change-failure rate that means fewer incidents, a satisfaction signal). Outputs are trivially gameable because they are *under direct local control* — you can always produce more commits. Outcomes are harder to game because gaming them requires actually moving the world. *Counters:* the McNamara fallacy (outputs are the easily-measured; outcomes are the important) and the LOC/commit-count anti-patterns directly.

**2. Measure the system and the team, never the individual.** The single highest-leverage structural decision. Individual metrics are catastrophic for three compounding reasons: software is collaborative so individual attribution is mostly noise; ranking individuals creates a zero-sum game that destroys the collaboration the work depends on (the strongest engineers stop helping others, because helping doesn't show up on *their* number); and individual high-stakes metrics produce the most aggressive gaming because the personal stakes are highest. DORA and SPACE are *defined* at the team/system level for exactly this reason. *Counters:* the individual-metrics anti-pattern, and it pre-empts the worst gaming by removing the personal high-stakes target that section 8 identifies as the unrecoverable case.

**3. Use balanced / paired metrics where gaming one surfaces in another.** This is the most *mechanically* clever defense, and it is why DORA's design is good. Pair a **throughput** metric with a **stability** metric so that the cheap way to game one *degrades the other* and shows up immediately:

| If you push only... | ...you can cheat it by... | ...but the paired metric catches it: |
|---|---|---|
| Deployment frequency / lead time (speed) | shipping reckless, untested changes | change failure rate and time-to-restore spike |
| Change failure rate (stability) | shipping almost nothing, gold-plating | deployment frequency and lead time crater |
| Code coverage | testing trivial getters/setters | mutation score (real defect-catching) stays flat |
| Velocity (story points) | inflating estimates | lead time and outcome metrics don't move |

The principle: **never look at a metric that can be improved by doing something bad without simultaneously looking at the metric that the bad thing degrades.** A single metric is a target; a *tension* between two metrics is a system that has to be balanced honestly. This is the structural reason the four DORA keys are presented *together* and never as a single composite — see [01 — DORA](../01-dora-four-key-metrics/senior.md). *Counters:* Goodhart directly — it makes the locally-optimal cheat globally visible.

**4. Treat metrics as signals that feed a human conversation, never as automated targets or reward functions.** The instant a number is wired to a reward (a bonus, a ranking, a promo packet) or an automated gate, you have applied "pressure for control purposes" — Goodhart's exact trigger — and you have added the strongest surrogation amplifier (compensation on the measure). A metric should *prompt a question* ("our lead time jumped this sprint — what happened?"), and the answer should come from humans with context, who may legitimately conclude the number is fine and the metric is wrong. The metric *opens* the conversation; it does not *close* it. *Counters:* Goodhart's "control pressure" and surrogation amplifier (a) — compensation.

**5. Transparency and team ownership — the measured own the measure.** The team being measured should *choose, define, and have access to* its own metrics. This counters the surrogation amplifier (c) — surrogation is worst when people had no hand in choosing the measure — and it changes the politics: a metric imposed from above is something to defeat; a metric the team adopted to understand its own work is a tool it wants to keep honest. Transparency (everyone sees the same numbers and how they're computed) also makes gaming socially visible, which is a far better deterrent than any rule. *Counters:* surrogation amplifier (c), and weaponized/top-down metrics.

**6. Show the metric next to the construct it represents.** A dashboard that shows "NPS: 42" surrogates; one that shows "Customer satisfaction (proxied by NPS): 42" resists, because it keeps the abstract goal in view. This is the cheapest, most overlooked countermeasure — it directly attacks surrogation amplifier (b), measure-presented-alone — and it costs one label. *Counters:* surrogation amplifier (b).

**7. Give metrics a short half-life — retire them once they've served.** Metrics are instruments for a *current* improvement question, not permanent fixtures. A metric that has done its job (the team fixed its review bottleneck; review time is no longer the constraint) should be *retired*, because a metric kept past its usefulness becomes a target by inertia — still watched, still reported, no longer informative, and now only gameable. The longer a metric lives as a KPI, the more Goodhart erosion and surrogation accumulate against it (recall Campbell's dose-response: harm grows *with use*). Rotating metrics as the bottleneck moves also keeps the org's attention on the *current* constraint rather than on a number that mattered two years ago. *Counters:* Campbell's dose-response — bounded exposure bounds the corruption.

> **Key insight:** Read the seven principles as a unified strategy and the shape is clear: **lower the metric's stakes (4, 2), raise the cost of cheating it (1, 3), and remove every confirmed amplifier of surrogation (5, 6, 7, and 2/4 again).** You are not trying to build an honest metric — there is no such thing under pressure. You are building a *system* whose structure makes honesty the path of least resistance and gaming both expensive and visible.

---

## The Limits of Resistance

Every principle above is real and every principle above has a ceiling, and a senior who oversells these techniques does as much damage as one who ignores them. State the ceiling plainly:

**Any metric used for high-stakes individual evaluation will eventually be gamed. Full stop.** Paired metrics, outcome focus, team ownership, short half-lives — these *slow* corruption and make it *visible*; they do not *prevent* it, because Goodhart is a law, not a tendency. Given enough pressure and enough time, agents will find the cheapest path to the number, and the cheapest path is almost never the path you intended. The four DORA keys can be gamed *as a set* (ship many trivial deploys, classify real failures as "planned maintenance," restore by rolling back instead of fixing, keep changes microscopic). Balanced metrics raise the bar; they do not close the door.

This leads to the one defense that actually holds:

> **Key insight:** The only reliable defense against Goodhart is **not to use metrics for high-stakes individual decisions at all.** Every technique in the previous section is a way of *reducing* gaming pressure; this is the way of *removing* it. Use metrics to *learn about and improve a system* — a use that creates almost no incentive to cheat, because no one is harmed or rewarded by the number — and refuse to use them as the *basis* for promotions, rankings, bonuses, stack-ranking, or firing. The DORA program's own framing — *"measure to learn and improve, not to judge and reward"* — is not a nicety; it is the *only* configuration in which the metrics keep working, because it is the only configuration that doesn't apply Goodhart's trigger.

The corollary is uncomfortable for organizations that want metrics to *do* the hard managerial work of evaluation: **metrics cannot replace judgment in high-stakes people decisions.** They can *inform* a human who is accountable for the decision and has context, but the moment the number *is* the decision, you have built the McNamara machine. The mature posture is to keep the two uses rigorously separate: a rich, transparent, team-owned metric system for improvement, and an entirely human (necessarily messier, necessarily judgment-laden) process for evaluation — with a firewall between them, because the instant the improvement metrics leak into the evaluation process, the team learns it and the improvement metrics die.

---

## Statistical Literacy as a Defense

There is an anti-pattern that has nothing to do with gaming and everything to do with *misreading*, and it is endemic: **mistaking noise for signal.** A metric system run by people who are not statistically literate will generate dysfunction even if no one games anything, because it will *react to randomness as though it were meaning.* This is its own measurement anti-pattern and a senior must guard against it as deliberately as against Goodhart.

**Variation and noise.** Every process metric varies sprint to sprint for reasons that are pure common-cause noise — who was on vacation, which features happened to be hard, normal randomness. W. Edwards Deming's foundational lesson (the basis of statistical process control) is that **tampering** — reacting to common-cause variation as if it were a special cause — *makes the process worse*, not better. The manager who congratulates the team when lead time dips and interrogates it when lead time rises, with neither move warranted by a real change in the system, is injecting variance and teaching the team to fear the metric. The discipline: distinguish a *trend* (sustained, beyond the bounds of normal variation) from *noise* (this sprint was a bit higher), and only act on trends. A control chart, or at minimum a run of several periods, is the tool; a single sprint-over-sprint delta is almost always noise.

**Small samples lie loudly.** Most engineering-metric denominators are tiny. A team that deploys 8 times a sprint and has 1 failure has a 12.5% change-failure rate; the next sprint, 0 failures out of 7 is 0%. Reported as "change failure rate dropped from 12.5% to 0% — a huge improvement!" this is *noise dressed as a result.* With n in single digits, the confidence interval is enormous and almost any period-over-period comparison is meaningless. The senior reflex: *what is n?* — and if n is small, suppress the urge to interpret the delta at all. This is why DORA reports cluster performance into broad bands (Elite/High/Medium/Low) rather than fetishizing precise values: the bands are robust to the noise that precise numbers are not.

**Distribution, not mean.** Reducing a metric to its average is itself an anti-pattern, because the average hides the shape, and the shape is usually where the truth and the pain live. Lead time and cycle time are notoriously **right-skewed** — a long tail of stuck items drags the mean far above the typical experience, so a "mean lead time of 4 days" can describe a world where half of items ship in 1 day and a miserable tail takes 30. *Always look at percentiles* (p50, p75, p90) rather than the mean: the p50 tells you the typical case, the gap between p50 and p90 tells you the *consistency*, and the p90 tail is usually the actual problem to fix. A team optimizing its *mean* lead time can make the typical case worse while the tail improves, or vice versa, and never know it. This is treated directly in [04 — Lead Time & Cycle Time](../04-lead-time-and-cycle-time/senior.md), and it is the statistical sibling of every point in this section: **the mean is a proxy for the distribution, and like every proxy it can be gamed and it can mislead.**

> **Key insight:** Statistical illiteracy is the *quiet* metrics anti-pattern — no one is gaming anything, yet the org lurches around reacting to randomness, rewarding lucky sprints, and punishing unlucky ones, which is just as corrosive to trust as overt gaming and which *teaches* the team to game (if you'll be punished for noise, you'll learn to hide variance). The defenses are three reflexes: ask *what is n?*; distinguish *trend from noise* before acting; and read the *distribution, not the mean.* Without them, even a perfectly-designed, ungameable metric system produces dysfunction.

---

## Applying This Across the Whole QE Metric Set

The reason this topic sits where it does — as the capstone of the Engineering Metrics roadmap, and a sibling to the code-level metric roadmaps — is that **every metric in Quality Engineering shares this exact failure mode.** The theory is not specific to delivery metrics; it is specific to *measurement under incentive.* A senior should be able to apply the whole chain (Goodhart → surrogation → resist-then-limit → statistical literacy) to any QE metric on sight. The pattern is identical; only the proxy changes:

- **Code coverage** (see [Code Coverage](../../code-coverage/)). The construct is "the code is well-tested / defects will be caught." The proxy is "% of lines executed by the test suite." Targeted (e.g., "90% or the build fails"), it surrogates instantly: teams hit the number by testing trivial code and asserting nothing, and the coverage number rises while *defect-catching power* — the actual construct — stays flat or falls. The paired metric that catches the cheat is **mutation score** (do the tests actually fail when the code is broken?). Coverage is a *floor diagnostic*, never a target. Goodhart, exactly.
- **Code quality metrics** (see [Code Quality Metrics](../../code-quality-metrics/)). Cyclomatic complexity, coupling, duplication, maintainability indices. The construct is "the code is maintainable." Targeted, each is trivially gamed: a hard complexity ceiling per function is satisfied by *fragmenting* one coherent function into several worse ones that pass the threshold while making the code harder to follow — the metric improves as maintainability *degrades* (Campbell's "distort the process it monitors," verbatim). These belong in a *human conversation* about a *trend across the codebase*, never as a per-function automated gate.
- **Documentation metrics.** "Doc coverage" or pages-published counts the existence of docs, not whether anyone can *use* them — the construct (findable, correct, current documentation) is exactly the unmeasurable-value problem from section 5, scaled down. Counting doc pages is the McNamara fallacy in miniature: the measurable (page count) substitutes for the important (usefulness).
- **DORA and SPACE themselves** (see [01](../01-dora-four-key-metrics/senior.md), [03](../03-space-framework/senior.md)). The most important application, because it is the most counter-intuitive: *the good, research-backed metrics are not exempt.* DORA's four keys are excellent **system-improvement signals** and become poison the instant they are made **individual or team targets with stakes.** SPACE was *designed* with this topic in mind — multi-dimensional precisely so no single dimension can be gamed without the tension showing elsewhere, and explicitly framed as *not* a productivity score. The lesson is not "use better metrics so Goodhart won't apply"; Goodhart applies to *every* metric. The lesson is "use any metric only in the configuration — system-level, team-owned, conversation-feeding, evaluation-firewalled — where Goodhart's trigger is never pulled."

> **Key insight:** There is no metric — not coverage, not complexity, not the four keys, not SPACE — that is "safe to target." Safety is never a property of *which metric*; it is a property of *how you use it.* The entire Quality Engineering metric corpus collapses into one rule: **measure to understand and improve a system; never wire a number to a high-stakes individual outcome; always read the distribution, not the mean.** Get the *use* right and a crude metric is useful; get the use wrong and the best metric in the literature becomes a teacher of dysfunction.

---

## Mental Models

- **A measure used for control stops measuring.** Goodhart is a law, not a risk. The correlation between proxy and construct existed *because* nobody was optimizing the proxy; optimizing it dissolves the conditions that produced the correlation. Don't ask "will this metric be gamed?" — ask "what is the cheapest way to move this number, and is it the thing I wanted?"

- **The proxy eats the construct (surrogation).** The reason corrupted metrics persist is that the number psychologically *becomes* the goal. Goodhart breaks the metric; surrogation hides the breakage. Every "show the goal next to the number / let the team own it / don't pay on it" rule is an anti-surrogation move.

- **Make the important measurable, not the measurable important.** The McNamara fallacy is the inversion of that sentence. Software's value lives downstream and has no unit, so the gravitational pull is always toward measuring the countable (output, effort) and quietly redefining it as the goal. Resist by naming, every time, what construct the number is a proxy *for.*

- **A single metric is a target; a tension between metrics is a system.** One number invites gaming; a pair (speed × stability, coverage × mutation) where cheating one degrades the other makes the cheat visible. Never show a gameable metric without its counterweight.

- **The only Goodhart-proof move is not to use the metric for high-stakes individual decisions.** Everything else slows corruption; this removes the trigger. Separate, with a firewall, the *improvement* metric system from the *evaluation* process — and accept that evaluation stays human and messy.

- **Most metric movement is noise.** Ask *what is n?*, act on *trends not deltas*, and read the *distribution not the mean.* A statistically-illiterate metric program is dysfunctional even with perfect, ungameable metrics, because it reacts to randomness — and teaches the team to hide variance.

---

## Common Mistakes

1. **Believing "good" metrics are immune to Goodhart.** DORA, SPACE, coverage, complexity — all degrade identically under high-stakes targeting. Safety is a property of *use* (system-level, team-owned, no stakes), never of *which metric.* The research-backed ones are not exempt.

2. **Validating a correlation, then targeting the metric.** "We confirmed coverage correlates with fewer defects, so let's mandate 90%." The Lucas critique: you validated it in the no-incentive regime, and *mandating it is the regime change that can break the correlation.* The validation does not transfer to the targeted world.

3. **Wiring any metric to compensation, ranking, or an automated gate.** This applies Goodhart's exact trigger (control pressure) and the strongest surrogation amplifier (pay on the measure). A metric should *prompt a human question*, not *close a decision.*

4. **Measuring individuals.** Software is collaborative, so individual attribution is mostly noise; ranking individuals destroys the collaboration the work depends on and triggers the most aggressive gaming. Measure the team and the system. This is the single highest-leverage structural fix.

5. **Showing a metric with no counterweight.** A lone speed metric invites recklessness; a lone stability metric invites gold-plating. Always pair metrics so the cheap cheat for one degrades the other and surfaces immediately.

6. **Letting metrics live forever.** A metric kept past its usefulness becomes a target by inertia — watched, reported, no longer informative, now only gameable. Give metrics a short half-life; retire them when the bottleneck moves (Campbell's dose-response: corruption grows with use).

7. **Reacting to noise as if it were signal.** Congratulating a lucky sprint, interrogating an unlucky one, reporting "12.5% → 0%" on n=8 as an improvement, optimizing the *mean* of a right-skewed lead-time distribution. This is dysfunction without gaming — and it teaches the team to game by punishing them for randomness.

8. **Counting outputs and calling it productivity.** LOC, commits, story points, PR counts are units of *size or activity*, not *value* — and software value is unmeasurable at the engineering boundary anyway. Any metric whose units go *up* when the work gets *worse* (more code for the same feature) is not a productivity metric.

---

## Test Yourself

1. State Goodhart's *original* claim and contrast it with Strathern's popular paraphrase. Why does the difference matter — what does Goodhart's version say happens even among perfectly honest actors?
2. What does the Lucas critique add to Goodhart, and why does it invalidate the argument "we validated this metric correlates with quality, so it's safe to target"?
3. Define surrogation. Name the three experimentally-confirmed conditions that *amplify* it, and map each to a specific resistance principle that counters it.
4. Reconstruct Fowler's `cannotMeasureProductivity` argument from the definition of productivity. Which half of value/effort defeats measurement in software, and why? How does SPACE respond?
5. State the McNamara fallacy's inversion in one sentence. Then explain why DeMarco's 2009 recantation of "you can't control what you can't measure" is the same lesson told as a change of mind.
6. You're given a single metric to "improve deployment frequency." Design the paired-metric structure that makes the obvious cheat self-defeating, and name the cheat each metric in the pair catches.
7. What is the *only* defense that actually stops Goodhart (as opposed to slowing it), and what does it cost an organization that wanted metrics to do its evaluation work?
8. A team's change-failure rate "improved from 12.5% to 0%." Before celebrating, what is the first question to ask, and what three statistical reflexes guard against this whole class of error?

<details>
<summary>Answers</summary>

1. Goodhart's original (1975): *"Any observed statistical regularity will tend to collapse once pressure is placed upon it for control purposes"* — the *statistical relationship itself* dissolves. Strathern's paraphrase (1997): *"When a measure becomes a target, it ceases to be a good measure"* — more general, more memorable, but sounds like it's about cheating. The difference matters because Goodhart's version applies *even among perfectly honest actors*: they rationally respond to the new incentive, which changes the conditions that produced the original correlation. The corruption is a property of the incentive, not of anyone's morality.

2. Lucas (1976): historical correlations are artifacts of the *regime* under which the data was collected (agents' equilibrium responses to the then-current policy). Targeting a metric *is* a regime change, so the correlation you validated — measured when nobody was managed on the number — may no longer hold once you manage on it. "We validated it, so it's safe to target" fails because the act of targeting is precisely what can break the validated relationship.

3. Surrogation: the cognitive tendency to lose sight of the abstract construct and treat the *measure* as the construct (the proxy psychologically replaces the goal). Amplified by (a) being compensated on the measure → counter with *never wire metrics to reward* (principle 4); (b) the measure shown *alone* without the construct → counter with *show the metric next to the construct it proxies* (principle 6); (c) people had *no hand in choosing* the measure → counter with *team ownership; the measured own the measure* (principle 5).

4. Productivity = output value / input effort. In software the *numerator (value)* defeats measurement: software's value is realized downstream over time by users/markets, has no unit at the engineering boundary, and a thousand lines for an unused feature is negative value while a one-line fix can be worth millions. Effort (the denominator) *is* measurable, which is the trap — we measure effort or output volume and call it productivity (surrogation). Fowler's conclusion: any number labeled "developer productivity" is necessarily a proxy; be ruthlessly honest about what for. SPACE responds by *refusing the single number* — spreading measurement across Satisfaction/Performance/Activity/Communication/Efficiency and never rolling them into one score.

5. The McNamara fallacy makes *the measurable important* rather than *the important measurable.* DeMarco's 2009 recantation is the same lesson as autobiography: in 1982 he wrote "you can't control what you can't measure" (justifying measure-everything); in 2009 he said it "is not really true," that control was never the point, and that the *highest-value* software work is precisely where measurement/control matter *least* — measure only what changes a decision. The arc from his 1982 slogan to his 2009 reversal *is* "make the important measurable, not the measurable important," told as one person changing his mind.

6. Pair the **throughput** metric (deployment frequency / lead time) with **stability** metrics (change failure rate + time-to-restore), shown together, never composited. Cheat on frequency by shipping reckless untested changes → change-failure-rate and time-to-restore spike and catch it. Cheat on stability by shipping almost nothing / gold-plating → frequency and lead time crater and catch it. The *tension* between the pair forces honest balancing; either single metric alone is just a target.

7. The only defense that *stops* (not merely slows) Goodhart: **don't use the metric for high-stakes individual decisions at all** — use it to learn about and improve a *system*, where no one is rewarded or harmed by the number, so the gaming incentive never exists ("measure to learn and improve, not to judge and reward"). Cost: the organization must keep evaluation an *entirely human, judgment-laden* process behind a firewall from the improvement metrics — metrics can *inform* a human who owns the decision, but cannot *be* the decision. Orgs that wanted metrics to do the hard work of evaluation don't get to.

8. First question: **what is n?** Here n=8 then n=7 — single digits, so "12.5% → 0%" is almost certainly noise, not improvement. Three reflexes: (i) ask *what is n?* and suppress interpretation of small-sample deltas; (ii) distinguish *trend from noise* — act only on sustained movement beyond normal variation, never on a single period-over-period delta (Deming: tampering with common-cause variation makes things worse); (iii) read the *distribution, not the mean* — use percentiles (p50/p90), since process metrics are right-skewed and the mean hides the tail.

</details>

---

## Cheat Sheet

```
THE LAW FAMILY (cite precisely)
  Goodhart (1975, orig)   "Any observed statistical regularity collapses
                           once pressure is placed on it for control."
                           → the CORRELATION dissolves, even with honest actors
  Strathern (1997)        "When a measure becomes a target it ceases to be
                           a good measure."  ← the popular PARAPHRASE of Goodhart
  Campbell (1979)         dose-response ("the more used, the more corrupt")
                           + TWO harms: number lies AND reality distorts
  Lucas (1976)            validated correlations are artifacts of the regime;
                           targeting = regime change → may break the correlation

SURROGATION (Choi/Hecht/Tayler) — why corruption PERSISTS
  proxy psychologically REPLACES the construct (map eats territory)
  amplified by:  (a) pay on the measure   (b) measure shown ALONE
                 (c) team had no say in choosing it
  → it's a PERCEPTION failure, not ethics; can't moralize/hire your way out

SOFTWARE IS SPECIAL (Fowler, cannotMeasureProductivity)
  productivity = VALUE / effort ; software VALUE is unmeasurable at the
  engineering boundary (realized downstream, no unit) → only effort/output
  is measurable → measuring output = surrogation. SPACE = refuse one number.

McNAMARA FALLACY  → makes the MEASURABLE important, not the IMPORTANT measurable
  DeMarco: 1982 "can't control what you can't measure" → 2009 RECANTED
  ("not really true; best work resists measurement"). The arc IS the lesson.

DESIGN TO RESIST (each counters a named failure)
  1 outcomes not outputs        (McNamara; LOC/commit anti-patterns)
  2 system/team not individual   (kills worst gaming + collaboration loss)
  3 paired metrics               (Goodhart: cheat one → degrades the other)
       speed × stability | coverage × mutation | velocity × lead time
  4 signals → human conversation, never auto-target/reward  (Goodhart trigger; amp a)
  5 team owns the metric         (surrogation amp c)
  6 show metric NEXT TO construct (surrogation amp b)
  7 short half-life; retire it    (Campbell dose-response)

THE CEILING
  any metric for HIGH-STAKES INDIVIDUAL eval WILL be gamed (Goodhart = law)
  only real defense: DON'T use metrics for high-stakes individual decisions
  → "measure to learn and improve, not to judge and reward"
  firewall the improvement-metric system from the evaluation process

STATISTICAL LITERACY (dysfunction WITHOUT gaming)
  ask WHAT IS n?  small samples lie ("12.5%→0%" on n=8 = noise)
  TREND not delta  (Deming: tampering w/ common-cause variation = worse)
  DISTRIBUTION not mean  → p50/p90; lead time is right-skewed, tail is the problem
```

---

## Summary

- **The law family is rigorous and distinct.** Goodhart's *original* (1975): the statistical regularity *collapses* under control pressure — even among honest actors. Strathern's "when a measure becomes a target..." (1997) is the popular *paraphrase*. Campbell (1979) adds a *dose-response* and *two* harms (the number lies; the process distorts). Lucas (1976) is the deepest: a validated correlation is an artifact of the regime, so *targeting it can break it* — which kills "we validated it, so it's safe to target."
- **Surrogation is the cognitive mechanism** — the proxy psychologically *replaces* the construct, which is why corrupted metrics persist and why it's a perception failure, not an ethics one. It is amplified by paying on the measure, showing it alone, and giving the team no say — three amplifiers the design principles directly invert.
- **Software is doubly cursed.** Beyond universal Goodhart, productivity = value/effort and software's *value* is unmeasurable at the engineering boundary (Fowler, `cannotMeasureProductivity`) — so output volume gets substituted for value. SPACE is the engineering answer: refuse the single number.
- **The McNamara fallacy** makes the *measurable* important instead of the *important* measurable; **DeMarco's 2009 recantation** of his own "you can't control what you can't measure" is that exact lesson told as a change of mind.
- **You can design for resistance** — outcomes over outputs, system/team over individual, paired metrics, signals-feeding-conversation over targets, team ownership, metric-next-to-construct, short half-lives — but **resistance has a ceiling:** any metric used for high-stakes individual evaluation *will* be gamed, so the only real defense is *not using metrics for high-stakes individual decisions* — "measure to learn and improve, not to judge and reward," with a firewall to evaluation.
- **Statistical illiteracy is its own anti-pattern:** ask *what is n?*, act on *trends not deltas*, read the *distribution not the mean* — or a perfectly ungameable system still lurches around reacting to noise and teaching the team to hide variance.
- **This applies to the entire QE metric set** — coverage, code quality, docs, DORA, SPACE all share the failure mode. Safety is never *which metric*; it is *how you use it.*

You now reason about metrics as a *systems-design* problem with a known adversary (the incentive itself), not as a shopping list of good and bad numbers. The next layer — [professional.md](professional.md) — is about running this in a real organization: the politics of an executive who wants a single productivity number, building the firewall between improvement and evaluation in practice, and surviving the quarter when leadership demands you rank the engineers.

---

## Further Reading

- Charles Goodhart, *"Problems of Monetary Management: The U.K. Experience"* (1975; reprinted 1984) — the original statement, in its actual monetary-policy context.
- Marilyn Strathern, *"'Improving ratings': audit in the British University system"* (*European Review*, 1997) — the source of the popular "when a measure becomes a target" phrasing.
- Donald T. Campbell, *"Assessing the Impact of Planned Social Change"* (1979) — Campbell's law, the dose-response, and the standardized-testing case.
- Robert E. Lucas, *"Econometric Policy Evaluation: A Critique"* (1976) — the Lucas critique; the rigorous core of why targeting changes the relationship.
- Choi, Hecht & Tayler, *"Lost in Translation: The Effects of Incentive Compensation on Strategy Surrogation"* (*The Accounting Review*, 2012) and follow-ups — the experimental evidence for surrogation and its amplifiers.
- Martin Fowler, *cannotMeasureProductivity* (martinfowler.com, 2003) — the value/effort argument and why software's numerator is unmeasurable.
- Tom DeMarco, *"Software Engineering: An Idea Whose Time Has Come and Gone?"* (*IEEE Software*, 2009) — the public recantation of "you can't control what you can't measure."
- W. Edwards Deming, *Out of the Crisis* — common- vs special-cause variation and why *tampering* makes processes worse (the statistical-literacy foundation).
- Forsgren, Storey, Maddila, Zimmermann, Butler & Houck, *The SPACE of Developer Productivity* (2021) — the multi-dimensional, anti-single-number design that this topic motivates.

---

## Related Topics

- [01 — The DORA Four Keys](../01-dora-four-key-metrics/senior.md) — why the four keys are presented *together* (paired throughput × stability) and never as one composite, and how they're gamed as a set.
- [03 — The SPACE Framework](../03-space-framework/senior.md) — the framework designed *because* productivity isn't one measurable number; the engineering response to `cannotMeasureProductivity`.
- [04 — Lead Time & Cycle Time](../04-lead-time-and-cycle-time/senior.md) — percentiles-not-means in practice, where the distribution-not-mean reflex pays off directly.
- [Code Quality Metrics](../../code-quality-metrics/) — complexity/coupling/duplication, each gameable as a per-unit gate; the same Goodhart logic at the source-code level.
- [Code Coverage](../../code-coverage/) — the canonical "floor diagnostic, never a target" metric; coverage × mutation score as the paired-metric defense.
- [junior.md](junior.md) · [middle.md](middle.md) · [professional.md](professional.md) — the rest of this topic's tier set.
