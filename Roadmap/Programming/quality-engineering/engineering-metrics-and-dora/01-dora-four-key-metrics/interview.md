# The DORA Four Keys — Interview Questions

> **Roadmap:** [Engineering Metrics and DORA](../README.md) → DORA Four Key Metrics
> *A DORA interview rarely asks "list the four metrics" and stops there. It asks "your deploy frequency is climbing but so is your change-failure rate — what's going on?" and then watches whether you can separate **speed from stability**, **outcomes from capabilities**, and **measuring a team from ranking people**. This page is the question bank, with model answers and a note on what each question is really probing.*

---

## Table of Contents

1. [How to Use This Page](#how-to-use-this-page)
2. [Theme 1 — The Four Keys](#theme-1--the-four-keys)
3. [Theme 2 — Speed vs Stability](#theme-2--speed-vs-stability)
4. [Theme 3 — Measuring Them](#theme-3--measuring-them)
5. [Theme 4 — Capabilities vs Outcomes](#theme-4--capabilities-vs-outcomes)
6. [Theme 5 — Limits and Criticism](#theme-5--limits-and-criticism)
7. [Theme 6 — Scenario and Judgment](#theme-6--scenario-and-judgment)
8. [Theme 7 — Program Use](#theme-7--program-use)
9. [Rapid-Fire Round](#rapid-fire-round)
10. [Red Flags and Green Flags](#red-flags-and-green-flags)
11. [Summary](#summary)
12. [Further Reading](#further-reading)
13. [Related Topics](#related-topics)

---

## How to Use This Page

Each question carries three things: **Q** (the prompt), **what the interviewer is really testing**, and **A** (a model answer at the depth a strong candidate gives). Don't memorize the answers — internalize the *distinctions* they keep returning to:

- **speed vs stability** (you ship fast vs you stay up — and elite teams refuse to trade one for the other)
- **outcome vs capability** (the four keys are *results*; trunk-based development, CD, and the other levers are the *causes*)
- **measuring vs judging** (a metric that improves a team is a weapon when it ranks individuals)
- **delivery vs value** (DORA measures how well software *moves*, not whether it was the right software)

Nearly every question in this bank is one of those four distinctions wearing a costume. The candidates who do well are the ones who *name the distinction* before reaching for a number.

A note on naming: the program is the **DevOps Research and Assessment (DORA)** team, the metrics are the **Four Keys** (sometimes "the four key metrics"), and the research is published annually as the *State of DevOps* / *Accelerate State of DevOps* report. Saying "the DORA report" is fine; calling the metrics "the DORA score" is a tell that you've only seen them in a dashboard.

---

## Theme 1 — The Four Keys

### Q1.1 — Name the four key metrics and define each precisely.

> **Testing:** Do you actually know the definitions, including *where each clock starts and stops* — or just the four names?

**A.** Two measure **throughput**, two measure **stability**:

1. **Deployment Frequency** — how often the organization successfully releases code *to production* (or to end users). It's a rate: deploys per day/week. Elite is on-demand, multiple times per day; low is less than once per month.
2. **Lead Time for Changes** — the time from **code committed** to that code **running in production**. Note the precise boundaries: it starts at *commit*, not at idea or ticket creation, and ends at *deployed*, not at "merged." It measures the delivery pipeline, not the whole product cycle.
3. **Change Failure Rate (CFR)** — the percentage of deployments to production that cause a failure requiring remediation (a hotfix, rollback, patch, or forward-fix). It's failures *as a fraction of deployments*, not a raw count of incidents.
4. **Time to Restore Service** (also called **failed-deployment recovery time** / mean time to restore) — how long it takes to recover from a production failure: from the moment service is degraded to the moment it's healthy again.

The first two are **velocity/throughput**; the last two are **stability**. The whole point of the framework is that you read all four *together* — any one alone is misleading.

### Q1.2 — Why does Lead Time for Changes start at commit and not at the idea or ticket?

> **Testing:** Whether you understand DORA measures *delivery*, not the whole product development lifecycle — and why that boundary was chosen deliberately.

**A.** Because DORA is scoped to the part of the system engineering teams **control and can make deterministic**: the path from code to production. Everything before the commit — ideation, prioritization, design, the time a ticket sits in a backlog — is hugely variable, organization-specific, and dominated by product and business decisions, not delivery capability. Starting the clock at commit gives you a measurement that is comparable over time *for a team*, isolates the engineering delivery pipeline, and is mechanically derivable from version control plus CI/CD. The tradeoff — and a good candidate names it — is that this *deliberately excludes* the front half of the value stream, which is why DORA is "lead time for **changes**," not "lead time" in the full Lean sense. If you care about idea-to-customer, that's a broader **cycle-time / value-stream** measurement that DORA does not claim to cover.

### Q1.3 — What counts as a "deployment" and what counts as a "failure" for these metrics?

> **Testing:** Whether you realize the definitions are *organization-relative* and must be pinned down before any number means anything.

**A.** A **deployment** is a successful release of code to its production environment or end users — but the unit is yours to define, and you must define it *consistently*. For a web service it's a push to prod; for a mobile app it might be a store release; for a library it might be a published version. The trap is mixing units (counting feature-flag flips and full releases in the same number) so the metric drifts.

A **failure** is a deployment that *results in degraded service requiring remediation* — a rollback, a hotfix, a patch, or paging someone. The key discipline: failure is tied to **deployments causing user-facing impact that needs intervention**, not to every bug, every alert, or every incident from an unrelated cause (a cloud-provider outage isn't *your* change failure). Because both definitions are organization-relative, the only valid comparison is a team against *its own* history — which is the seed of why cross-team ranking is invalid (Theme 5).

### Q1.4 — Where did these four come from, and why these four specifically?

> **Testing:** Whether you know the metrics are *empirically derived*, not invented by committee — and what that buys them.

**A.** They come from the **DORA research program** (Nicole Forsgren, Jez Humble, Gene Kim), published in the annual *State of DevOps* reports and synthesized in the book *Accelerate*. They were chosen because, across years of survey data, these four together were found to **predict software delivery performance**, and that performance in turn correlated with **organizational outcomes** (profitability, productivity, market share). The reason it's *these* four: they pair throughput with stability so the framework can't be satisfied by being fast-and-broken or safe-and-frozen. (Recent reports add a fifth, **reliability** / operational performance, capturing whether the service meets its reliability targets in production — worth mentioning to show you track the current research, but the canonical set is four.)

---

## Theme 2 — Speed vs Stability

### Q2.1 — The four keys split into two groups. What are they, and why is that split the whole point?

> **Testing:** The central structural insight of the framework.

**A.** They split into **throughput/velocity** (Deployment Frequency, Lead Time for Changes) and **stability** (Change Failure Rate, Time to Restore). That split is the entire point because the conventional wisdom it was built to refute is that *speed and stability trade off* — that if you want to move fast you must accept more breakage, and if you want reliability you must slow down. By measuring both halves simultaneously, the framework makes that tradeoff *visible* and then tests whether it's real. Reading only one half tells you nothing: a team deploying 50 times a day is impressive until you learn half those deploys fail; a team with a 0% failure rate is suspicious if it ships once a quarter (it bought stability by not changing anything).

### Q2.2 — DORA's headline finding is that there's no trade-off between speed and stability. Explain it.

> **Testing:** Whether you understand the single most important and most counterintuitive result — and can state it correctly.

**A.** The finding is that speed and stability are **not opposing forces — they move together**. In the data, **elite performers do well on *all four* metrics at once**: they deploy more frequently, have shorter lead times, *and* have lower change-failure rates *and* faster restore times. The teams that are fastest are also the most stable. The mechanism is that the same engineering practices that make you fast — small batch sizes, continuous integration, automated testing, trunk-based development, deployment automation — are the *same* practices that make you stable. Small, frequent, automated changes are *easier* to test, *easier* to reason about, and *easier* to roll back than large, infrequent, manual ones. So you don't "balance" speed against stability on a slider; you invest in capabilities that raise both. The corollary: a team that thinks it's *choosing* stability by deploying rarely is usually getting the *worst* of both — big risky batches that are slow *and* failure-prone.

### Q2.3 — Why is it dangerous to watch only the speed metrics?

> **Testing:** Whether you grasp that the stability pair exists specifically as a *guardrail* against optimizing throughput into the ground.

**A.** Because throughput optimized in isolation has a trivial degenerate solution: **ship more, faster, regardless of quality**. If a leader fixates on Deployment Frequency and Lead Time alone, the rational team response is to cut corners — skip review, thin out tests, push half-finished work — which *will* move the speed numbers and *will* quietly wreck Change Failure Rate and Time to Restore. The two stability metrics exist as the **counterweight**: they're what stop "go faster" from meaning "break more." This is why the framework is only meaningful as a *set of four* — the stability pair is the guardrail that makes the velocity pair safe to pursue. Watching speed alone is how a metrics program causes the exact instability it was supposed to prevent.

### Q2.4 — A VP says "I just want the team to ship faster." How do you respond using the two groups?

> **Testing:** Whether you can translate the speed/stability structure into a leadership conversation without sounding obstructive.

**A.** I'd say: "Great — and the good news from the research is we don't have to trade stability to get it; the fastest teams are also the most reliable. So let's track *both* halves. We'll push Deployment Frequency and Lead Time *while* holding Change Failure Rate and Time to Restore flat or better. If speed goes up and stability holds, we've genuinely improved. If speed goes up and stability degrades, we didn't get faster — we just moved breakage downstream, and we'll feel it in incidents and rework." Framing it this way turns "ship faster" from a corner-cutting mandate into a capability investment, and it gives the VP a way to *know* whether the speed gain was real or borrowed against future outages.

---

## Theme 3 — Measuring Them

### Q3.1 — Walk me through where you get the raw signal for each of the four metrics.

> **Testing:** Whether you can actually instrument these from real systems, not just recite definitions.

**A.** Two data sources cover all four: **version control + CI/CD** for the throughput pair, and the **incident/on-call system** for the stability pair.

- **Deployment Frequency** — count successful production deploy events from the CI/CD system (pipeline "deploy to prod" job successes) or a deployment tracker.
- **Lead Time for Changes** — join two timestamps per change: the **commit time** (from git) and the **production-deploy time** (from CI/CD), and take the elapsed time. Doing this per change and aggregating is the honest way; approximating with "merge to deploy" understates it.
- **Change Failure Rate** — numerator from the incident system (deployments that triggered a rollback/hotfix/incident), denominator from the deploy count. Tagging incidents with the deploy that caused them is the hard part.
- **Time to Restore** — from the incident system: incident **start** (detection) to **resolved** timestamps.

The pragmatic version is to mine these from the tools you already run; the **Four Keys** open-source project (originally from Google Cloud) does exactly this, ingesting GitHub/GitLab and deploy events into a pipeline and computing the four. The instrumentation discipline matters more than the dashboard: garbage timestamps in, garbage metrics out.

### Q3.2 — Should you report these as means or medians? Why?

> **Testing:** Statistical literacy — whether you know these distributions are skewed and a mean lies.

**A.** **Medians (and percentiles), not means.** Lead Time and Time to Restore are heavily **right-skewed**: most changes flow through quickly, but a few pathological ones (a release that sat for weeks, an incident that took a day) sit way out in a long tail. A *mean* is dragged toward those outliers and reports a number that describes *no actual typical change*. The **median** answers the real question — "what's the experience of a typical change/incident?" — and is robust to the tail. Strong teams report the median *and* a high percentile (p90/p95), because the median tells you the common case and the tail tells you about your worst pain and your consistency. Reporting a single mean is a classic way to make a metric look reasonable while hiding that one change in ten takes ten times as long.

### Q3.3 — How do you handle attributing a failure to a specific deployment?

> **Testing:** Whether you appreciate that CFR's numerator is the genuinely hard measurement.

**A.** This is the messiest part of the whole framework. The clean approach is to **link incidents to deploys**: tag every production incident with the change/release that introduced it (via deploy markers, version stamps in telemetry, or a "caused by" field in the incident tool). Then CFR = (deploys linked to a failure) / (total deploys). The traps: failures with **no clean culprit deploy** (a slow memory leak, a config change outside the pipeline, a dependency that broke upstream), and the temptation to attribute *every* incident to a deploy even when the cause was external (a provider outage). The honest stance is to count **deployments that caused user-impacting failures requiring remediation**, accept that attribution is approximate, keep the *rule* consistent over time, and treat the trend as the signal rather than chasing decimal-point precision on any single period.

### Q3.4 — What's the minimum honest instrumentation, and what mistakes corrupt these numbers?

> **Testing:** Whether you can build a *credible* measurement and recognize the ways it silently goes wrong.

**A.** Minimum honest setup: deploy events emitted by CI/CD with a timestamp and environment; commit timestamps from git joined to those deploys; and incidents in one system with start/resolve times and a link to the offending deploy. Common corruptions:

- **Inconsistent "deployment" units** — mixing feature-flag flips, canary steps, and full releases in one count so frequency is meaningless.
- **Excluded environments** — counting only the easy services and quietly leaving out the painful legacy ones, flattering the aggregate.
- **Clock-start drift** — measuring "merge to deploy" and calling it lead time, hiding all the time work spends in review/branch.
- **Means over medians** — already covered; hides the tail.
- **Incident hygiene** — incidents opened late or closed late wreck Time to Restore; failures never linked to deploys zero out CFR.

The meta-point: these metrics are only as trustworthy as the *event hygiene* underneath them, and the failure mode is almost always "the data flatters us," not "the data is too harsh."

---

## Theme 4 — Capabilities vs Outcomes

### Q4.1 — Are the four keys things you *do* or things that *happen to you*? Explain the distinction.

> **Testing:** The second great structural insight — that the metrics are *outcomes*, downstream of practices.

**A.** They're **outcomes** — *results*, not actions. You cannot "do" a lead time; lead time is what *results* from how you build, test, and deploy. This is the crucial mental model: the four keys sit at the **end** of a causal chain. Upstream of them sit the **capabilities** — the concrete engineering and organizational practices DORA's research identifies as the *drivers* of delivery performance. The book *Accelerate* catalogs roughly **24 capabilities** across technical, process, measurement, and cultural categories: continuous integration, **trunk-based development**, continuous delivery, test automation, deployment automation, loosely coupled architecture, version control for everything, monitoring and observability, a blameless / generative culture, and so on. The capabilities are the **levers**; the four keys are the **dials that move** when you pull them.

### Q4.2 — So why not just set a target on the outcome — "everyone hit a lead time of one hour"?

> **Testing:** Whether you understand that targeting an outcome directly invites gaming and misses the actual work.

**A.** Because **an outcome isn't directly actionable, and targeting it directly invites measuring the dial instead of moving it.** "Hit one-hour lead time" doesn't tell a team *what to change* — and worse, it pressures them to make the *number* smaller by any means (redefine "deployment," shrink what counts as a change, game the timestamps) rather than to build the capability that *legitimately* produces a one-hour lead time. The metric is a **measurement of an outcome**, and the moment you turn a measurement into a target you trigger **Goodhart's Law**: "when a measure becomes a target, it ceases to be a good measure." The correct move is to target the *capabilities* — "let's get CI green and trunk-based" — and let the outcome metrics *confirm* that the capability investment paid off. You **steer by the levers and read the dials**; you don't grab the dial and force it.

### Q4.3 — Give a concrete example of a capability and the metric it moves.

> **Testing:** Whether the abstract lever/dial model is grounded in real cause-and-effect.

**A.** Take **trunk-based development with continuous integration**. The capability is: developers integrate small changes to a shared trunk frequently (at least daily), behind a fast automated test suite, instead of working on long-lived feature branches. The causal effects on the dials: integration friction collapses, so **Lead Time** drops; small batches are safe to ship continuously, so **Deployment Frequency** rises; each change is tiny and tested, so it's less likely to break prod (**Change Failure Rate** falls) and trivial to revert (**Time to Restore** falls). One capability, all four dials move *in the good direction at once* — which is *also* the mechanism behind the no-trade-off finding from Theme 2. That's the shape of every good DORA improvement: you find the capability, and the four outcomes follow.

### Q4.4 — If a team's metrics are bad, where do you look?

> **Testing:** Whether you instinctively diagnose *upstream at the capabilities*, not at the numbers.

**A.** **Upstream, at the capabilities — never at the dial itself.** Bad numbers are a *symptom*; the diagnosis is "which capability is missing or weak?" Slow lead time → look at branch lifetime, manual approval gates, slow CI, big batch sizes. High CFR → look at test coverage and the review/staging path. Slow restore → look at observability, rollback automation, and on-call readiness. The anti-pattern is "lead time is high, so let's pressure people to make lead time lower" — that treats the readout as the problem. The professional move is to treat the four keys as a **diagnostic that points at a capability gap**, then go fix the capability and watch the metric respond. Metrics tell you *where to look*; capabilities are *what you change*.

---

## Theme 5 — Limits and Criticism

### Q5.1 — What do the four keys *not* measure?

> **Testing:** Whether you understand the framework's scope honestly — the single biggest source of misuse is forgetting this.

**A.** They measure **delivery performance, not value.** They tell you how *well and how safely software flows to production* — they say nothing about whether it was the *right* software, whether customers wanted it, whether it made money, or whether the team built the wrong thing very efficiently. A team can be **elite on all four DORA metrics while shipping features nobody uses**: fast, stable delivery of the wrong roadmap. DORA is a measure of the **delivery engine**, not the **destination**. It also doesn't capture code quality, developer experience/burnout, security posture, or architectural health directly. The discipline is to treat DORA as *one instrument on the dashboard* — pair it with product/value metrics (adoption, business outcomes, customer satisfaction) and developer-experience signals — and never let "our DORA numbers are great" stand in for "we're building the right thing well."

### Q5.2 — Can you compare two organizations by their DORA numbers? Why or why not?

> **Testing:** Whether you understand *definitional incomparability* — that the same metric name means different things in different contexts.

**A.** **No, not validly** — at least not as a literal ranking. The metrics depend on definitions that are **organization- and context-relative**: what counts as a "deployment," what counts as a "failure," the unit of a "change," and the nature of the system (a stateless web service vs. embedded firmware vs. a regulated banking core have wildly different baselines for what's even possible). Team A's "deploy" and Team B's "deploy" may not be the same unit, so comparing their frequencies is comparing different things wearing the same label. DORA's *industry benchmarks* (elite/high/medium/low) are useful as a **rough orientation** — "are we in the right neighborhood?" — but they're built from a self-selected survey population and are explicitly meant for *self-assessment over time*, not for a literal cross-org or cross-team leaderboard. The valid comparison is **a team against its own trend**.

### Q5.3 — The DORA findings are survey-based. Why does that matter?

> **Testing:** Methodological literacy — whether you take the evidence seriously *and* understand its limits.

**A.** The headline research (the *State of DevOps* reports, *Accelerate*) is built largely on **self-reported survey data** from a **self-selected** respondent population, with **correlational** findings — "teams with practice X also report outcome Y" — analyzed to argue for **predictive** relationships. That matters in two directions. First, it's *more* rigorous than most industry advice: large samples, repeated annually, with real statistical method (the *Accelerate* appendix on methodology is worth knowing about). Second, the limits are real: self-selection means respondents skew toward people who care about DevOps; self-report means the numbers are perceptions, not always instrumented measurements; and correlation-argued-as-prediction means you should hold the causal claims with appropriate humility. The mature position: the findings are a *strong, well-supported signal* about what tends to work, not a physical law — useful as a prior, not as proof for any specific team.

### Q5.4 — How do these metrics get gamed, and what does that tell you about using them?

> **Testing:** Whether you've internalized Goodhart's Law as applied to DORA specifically.

**A.** Every one of them has a cheap gamed solution once it becomes a *target*:

- **Deployment Frequency** → split one release into many trivial deploys, or count no-op/flag deploys, to inflate the count.
- **Lead Time** → redefine the clock start (measure from merge, not commit) or shrink what counts as a "change."
- **Change Failure Rate** → stop *recording* incidents, reclassify failures as "planned maintenance," or quietly fix things without opening an incident.
- **Time to Restore** → close incidents early on paper, or declare "resolved" before it actually is.

What this tells you: the metrics are **excellent diagnostics and terrible targets**. The instant someone's bonus or stack-rank depends on a number, the cheapest way to move the number is to corrupt the *measurement*, not to improve the *system* — and CFR is especially fragile because the easiest way to lower your failure rate is to **stop admitting failures**, which destroys exactly the incident-learning culture DORA's research says you need. The defense is to use them for improvement, keep them off individual performance reviews, and watch for the tell-tale pattern of a metric improving while reality doesn't.

---

## Theme 6 — Scenario and Judgment

### Q6.1 — Your deploy frequency is high and rising, but your change-failure rate is also climbing. What's happening?

> **Testing:** Whether you can read the two groups *against each other* and diagnose, rather than celebrate one number.

**A.** This is the canonical **speed-bought-at-the-expense-of-stability** signature, and it's *exactly* why you never read the velocity pair alone. Rising frequency with rising CFR means the team is shipping more but a growing share of those ships break — they're going faster by **cutting the quality practices** that the no-trade-off finding says should accompany speed. The likely missing capabilities: test automation isn't keeping pace with deploy volume, review is being skipped under time pressure, or batches that *look* small are actually risky. Crucially, this is *not* the elite pattern (where frequency rises and CFR holds or falls); it's the warning pattern. The diagnosis: they didn't get faster, they **moved breakage downstream** — you'll see it next in Time to Restore and in rework. The fix is upstream at capabilities (shore up CI/test automation, look at what's actually in each batch), not "deploy less." I'd also sanity-check the *measurement* — a sudden CFR climb can be an artifact of finally recording incidents you used to ignore, which would actually be good hygiene, not a regression.

### Q6.2 — An executive wants to rank teams by their DORA metrics and reward the top performers. What do you say?

> **Testing:** The single most important judgment call in the whole topic — whether you'll push back on the most common and most damaging misuse.

**A.** I'd push back firmly and constructively, on two grounds. **First, the comparison is invalid:** the metrics are defined relative to each team's context — different "deployment" units, different system types (a stateless API vs. a mobile app vs. an embedded system have completely different achievable baselines), different risk profiles — so a leaderboard ranks *the difference in their contexts*, not the difference in their performance. **Second, and worse, ranking weaponizes the metrics and triggers Goodhart's Law:** the moment a team's reward depends on the number, the cheapest way to win is to **game the measurement** — and the most destructive version is teams *hiding failures* to protect their CFR, which kills the blameless incident-learning the whole framework depends on. What I'd offer instead: use DORA for **each team to track its own improvement over time** against its own baseline, share what high-performing teams *do* (the capabilities) so others can adopt them, and reward *improvement and capability adoption*, not absolute rank. "Let's help every team get better at all four" is the use the research supports; "let's rank them" is the use it warns against.

### Q6.3 — A team has a slow lead time for changes. How would you actually improve it?

> **Testing:** Whether you go to *capabilities* and find the real bottleneck, instead of declaring a target.

**A.** First, **measure where the time actually goes** — decompose lead time into stages: commit → PR open, PR open → merged (review/CI wait), merged → deployed (release cadence). The bottleneck is almost never uniform, and you fix the stage that dominates. Common culprits and their capability fixes:

- **Long-lived branches / big batches** → trunk-based development, smaller PRs (this usually dominates).
- **Slow or flaky CI** → speed up and stabilize the pipeline; parallelize tests; a 40-minute flaky suite poisons everything downstream.
- **Manual approval gates and release trains** → automate the path to prod, move toward continuous delivery so "merged" and "deployed" stop being far apart.
- **Heavy manual QA / staging steps** → shift testing left into automation.

The discipline is: I don't set a "lead time must be X" target and pressure people; I find the **dominant stage**, identify the **missing capability** behind it, fix that, and watch lead time fall as a *consequence*. And because these capabilities also improve the other three keys, a genuine lead-time fix usually improves stability too — if it doesn't, I'm probably just cutting corners.

### Q6.4 — Your Time to Restore is great but Change Failure Rate is high. Is that fine?

> **Testing:** Whether you can reason about the stability *pair* and avoid being lulled by one good number.

**A.** It's *better than the reverse*, but it's not "fine" — it's a signal worth investigating. Excellent restore time with high CFR means: "we break prod a lot, but we're very good at recovering fast." For some contexts (low blast-radius services with instant rollback and feature flags) that's a deliberate, healthy posture — you accept more small, instantly-reversible failures because recovery is trivial. But high CFR still means users are hitting failures more often than they should, and "we recover fast" can quietly mask a real quality problem upstream — you're spending effort *firefighting* that you could spend *preventing*. So I'd ask: are these failures low-impact and instantly reversible (then maybe acceptable), or are real users repeatedly affected (then the high CFR is a genuine quality gap to fix upstream with better testing/review)? Good restore time is a *real* strength, but it's a safety net, not a substitute for not falling.

---

## Theme 7 — Program Use

### Q7.1 — How should an organization actually *use* the four keys — improvement, or judgment?

> **Testing:** The governing principle of the entire topic.

**A.** **For improvement, not judgment.** The metrics are a **compass for a team to navigate its own trajectory** — "are the changes we're making to how we work actually paying off?" — not a **scoreboard for management to grade people or teams against each other.** Concretely: a team adopts a capability (trunk-based dev, better test automation), watches its four keys over the following weeks, and learns whether the investment worked. The metrics close a *learning loop*. The moment they flip from "how are we doing against our past selves" to "who's winning," they stop measuring performance and start measuring people's ability to game them. Everything else in this theme is a corollary of getting this one framing right.

### Q7.2 — Why must these never be tied to individual performance reviews?

> **Testing:** Whether you understand the metrics are *team/system-level* and that individualizing them is doubly broken.

**A.** Two reasons, both decisive. **First, they're system metrics, not individual ones** — lead time and CFR are properties of a *pipeline and a team's way of working*, the product of many people, the CI system, the architecture, and the release process. Attributing them to an individual is a category error, like grading one assembly-line worker on the whole factory's throughput. **Second, individualizing them maximizes the gaming incentive and poisons collaboration:** if my review depends on "my" CFR, I'm incentivized to avoid risky-but-valuable work, hide failures, and *not* help teammates (their failures might count against the shared number). It directly attacks the blameless, collaborative, generative culture that DORA's *own research* identifies as a top driver of performance. So you'd be using a metric in a way that *destroys the thing the metric says creates good metrics*. Team-level, for learning — never individual, never for ranking.

### Q7.3 — What should you pair the four keys with, and why isn't DORA enough on its own?

> **Testing:** Whether you remember Theme 5's scope limit and translate it into a balanced measurement program.

**A.** Pair them with **value/outcome metrics** and **developer-experience metrics**, because DORA only measures the **delivery engine, not the destination or the people**. The delivery pair tells you "we ship well"; it can't tell you "we shipped the *right* thing" — for that you need product and business signals (adoption, retention, revenue, customer satisfaction, whether the feature moved the metric it was meant to). And a team can hit elite DORA numbers while **burning out**, so you pair with developer-experience signals (DORA's research team also produced the **SPACE** framework — Satisfaction, Performance, Activity, Communication, Efficiency — precisely to capture the human/productivity dimensions DORA's four don't). The balanced view: DORA for *delivery health*, value metrics for *are we building the right thing*, SPACE/DevEx for *is the team healthy and effective*. Any one alone is a partial picture you can optimize into dysfunction.

### Q7.4 — How would you roll out a DORA program so it helps instead of backfiring?

> **Testing:** Whether you can operationalize every principle in this page into an actual rollout.

**A.** A few non-negotiables, each tracing back to a distinction from this page:

1. **Frame it as improvement from day one** — communicate explicitly that these are team-learning metrics, *not* a performance scoreboard, and *mean it* (don't put them in review packets).
2. **Instrument honestly** — pin down the definitions per team, mine commit/deploy/incident events, report **medians and percentiles**, keep the rules consistent so trends are real.
3. **Read all four together** — never celebrate a velocity gain without checking the stability pair; the *set* is the unit.
4. **Steer by capabilities** — set goals on the *levers* (CI, trunk-based dev, test automation), use the four keys to *confirm* the levers worked; don't target the outcomes directly.
5. **Compare against the team's own baseline**, not other teams; use industry benchmarks only for rough orientation.
6. **Pair with value and DevEx metrics** so "great delivery" can't hide "wrong product" or "burned-out team."

If I get those right, DORA is a genuine learning loop. Get the first one wrong — turn it into judgment — and every other safeguard erodes as teams start optimizing the dashboard instead of the system.

---

## Rapid-Fire Round

> Short questions to check breadth. One or two sentences each.

- **Q: Name the four keys.** A: Deployment Frequency, Lead Time for Changes, Change Failure Rate, Time to Restore Service.
- **Q: Which two are speed and which two are stability?** A: Speed = Deployment Frequency + Lead Time; stability = Change Failure Rate + Time to Restore.
- **Q: When does Lead Time for Changes start?** A: At **code commit** — not idea, ticket, or merge — and ends at running in production.
- **Q: Is CFR a count or a rate?** A: A rate — failed deployments as a *percentage* of deployments.
- **Q: Mean or median for lead time?** A: Median (plus a high percentile); the distribution is right-skewed and a mean is dragged by the tail.
- **Q: What's the headline DORA finding?** A: No trade-off — elite teams are fast *and* stable at the same time; the practices that make you fast also make you stable.
- **Q: Are the four keys capabilities or outcomes?** A: Outcomes — the ~24 capabilities (CD, trunk-based dev, test automation…) are the levers that move them.
- **Q: Why not target a metric directly?** A: Goodhart's Law — targeting the outcome invites gaming the measurement instead of building the capability.
- **Q: Can you rank teams by DORA?** A: No — definitions are context-relative; compare a team to its *own* trend, not to other teams.
- **Q: What do the four keys *not* measure?** A: Value — whether you built the *right* thing; DORA measures delivery, not the destination.
- **Q: What's the evidence base?** A: Annual *State of DevOps* surveys, synthesized in *Accelerate*; large but self-reported and self-selected.
- **Q: One thing to pair DORA with?** A: Value/outcome metrics (and DevEx/SPACE) — delivery health isn't product success or team health.
- **Q: Should DORA go on individual performance reviews?** A: Never — they're team/system metrics, and individualizing them maximizes gaming and kills collaboration.
- **Q: What's the fifth metric in recent reports?** A: Reliability / operational performance — whether the service meets its reliability targets.

---

## Red Flags and Green Flags

> What interviewers infer from *how* you answer, not just whether you're right.

**Red flags:**
- Listing the four metrics but fumbling the boundaries (where the lead-time clock starts, that CFR is a rate).
- Treating speed and stability as a trade-off — missing the central finding.
- Reading one metric in isolation ("deploy frequency is up, great!") without checking its pair.
- Calling the metrics things you "do" — confusing outcomes with capabilities.
- Endorsing cross-team ranking, or putting the metrics on individual reviews.
- Reporting means without flinching at the skew.
- Treating DORA as a measure of *value* or of overall engineering quality.
- Quoting "elite/high/medium/low" benchmarks as a literal cross-org scoreboard.

**Green flags:**
- Naming the *distinction* (speed/stability, outcome/capability, measure/judge) before reaching for a number.
- Stating the no-trade-off finding crisply and explaining *why* (same practices drive both).
- Reaching for *capabilities* when asked to *improve* a metric, not for a target.
- Insisting on medians/percentiles and consistent definitions unprompted.
- Refusing to rank teams or individualize the metrics, and explaining the Goodhart mechanism.
- Caveating scope ("DORA measures delivery, not whether we built the right thing — pair it with value metrics").
- Knowing the evidence is survey-based and holding the causal claims with appropriate humility.

---

## Summary

- The bank reduces to four distinctions, repeated in costumes: **speed vs stability**, **outcome vs capability**, **measuring vs judging**, **delivery vs value**. Name the distinction first; the number follows.
- **The four keys:** Deployment Frequency and Lead Time for Changes (throughput) + Change Failure Rate and Time to Restore Service (stability). Lead time starts at *commit*; CFR is a *rate*; failure and deployment are *organization-relative* and must be defined consistently.
- **Speed vs stability:** the headline finding is **no trade-off** — elite teams excel at *all four at once*, because the same capabilities (small batches, CI, trunk-based dev, automation) drive both. Watching speed alone is dangerous: the stability pair is the guardrail.
- **Measuring:** signal comes from version control + CI/CD (throughput) and the incident system (stability); report **medians and percentiles**, not means; the hard part is attributing failures to deploys, and the failure mode is always "the data flatters us."
- **Capabilities vs outcomes:** the four keys are *outcomes* at the end of a causal chain; the **~24 capabilities** are the *levers*. Don't target the outcome directly — that triggers Goodhart's Law; steer by the capabilities and let the dials confirm.
- **Limits:** DORA measures *delivery, not value*; numbers are *not comparable across organizations*; the evidence is *survey-based and correlational*; every metric is *gameable* once it becomes a target (CFR worst — the cheap fix is to stop admitting failures).
- **Program use:** for **improvement, not judgment**; **never** on individual reviews; compare a team to *its own* trend; **pair with value and DevEx/SPACE metrics**. Get the improvement-not-judgment framing right and DORA is a learning loop; get it wrong and teams optimize the dashboard instead of the system.

---

## Further Reading

- *Accelerate: The Science of Lean Software and DevOps* (Forsgren, Humble, Kim) — the foundational synthesis of the research, the four keys, and the 24 capabilities; read the methodology appendix to understand the evidence base.
- The annual **Accelerate State of DevOps Report** (DORA) — the primary source, updated yearly; where the benchmarks and the evolving fifth metric live.
- The **Four Keys** open-source project (originally Google Cloud) — a working reference for instrumenting the metrics from GitHub/GitLab and deploy events.
- The **SPACE** framework paper (Forsgren et al.) — the developer-productivity companion DORA's own team produced to cover what the four keys don't.
- The [junior](junior.md), [middle](middle.md), [senior](senior.md), and [professional](professional.md) pages of this topic — every answer here is grounded in those.

---

## Related Topics

- [04 — Lead Time and Cycle Time](../04-lead-time-and-cycle-time/interview.md) — the precise difference between DORA's commit-to-deploy lead time and the full value-stream cycle time.
- [06 — Metrics Anti-Patterns and Goodhart](../06-metrics-anti-patterns-and-goodhart/interview.md) — the deep treatment of gaming, vanity metrics, and why outcomes make terrible targets.
- [Engineering Metrics and DORA README](../README.md) — where the four keys sit in the broader metrics landscape.
