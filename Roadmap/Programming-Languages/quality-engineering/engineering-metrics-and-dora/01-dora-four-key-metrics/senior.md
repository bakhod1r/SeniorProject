# The DORA Four Keys — Senior Level

> **Roadmap:** [Engineering Metrics & DORA](../README.md) → The DORA Four Keys
> *The middle page taught you to compute the four numbers and read the Elite-to-Low bands. This page is about what the numbers actually are: outputs of a peer-reviewed research program, predictors (not just correlates) of organizational performance, and — most importantly — outcomes you cannot move by aiming at them directly. The lever is the 24 capabilities underneath. Miss that and you will optimize the dashboard while the system rots.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [The Research — What *Accelerate* Actually Did](#the-research--what-accelerate-actually-did)
4. [The Throughput–Stability Finding — Not a Trade-Off](#the-throughputstability-finding--not-a-trade-off)
5. [Outcomes vs Levers — The 24 Capabilities That Drive the Keys](#outcomes-vs-levers--the-24-capabilities-that-drive-the-keys)
6. [Statistical Rigor — Heavy Tails and the Definitional Trap](#statistical-rigor--heavy-tails-and-the-definitional-trap)
7. [The Reliability "Fifth Key"](#the-reliability-fifth-key)
8. [The System View — Why One Key Moves at Another's Expense](#the-system-view--why-one-key-moves-at-anothers-expense)
9. [Criticisms and Limits — What the Four Keys Don't Measure](#criticisms-and-limits--what-the-four-keys-dont-measure)
10. [Mental Models](#mental-models)
11. [Common Mistakes](#common-mistakes)
12. [Test Yourself](#test-yourself)
13. [Cheat Sheet](#cheat-sheet)
14. [Summary](#summary)
15. [Further Reading](#further-reading)
16. [Related Topics](#related-topics)

---

## Introduction

> Focus: **The research, the causal model, and the subtleties a senior engineer must hold to use the four keys without being used by them.**

By the middle level you can instrument a pipeline, compute deployment frequency, lead time for changes, change failure rate, and time to restore service, and place a team in the Elite/High/Medium/Low bands. That makes you useful in a metrics review. The senior jump is epistemic: you now understand *where these numbers come from*, *what claim is being made about them*, and *what they are and are not capable of telling you*.

Three facts separate someone who recites the four keys from someone who can wield them. First, the four keys are **outcomes** produced by a research program that found 24 underlying **capabilities** as the levers — and the single most common organizational failure is targeting the outcome instead of the lever. Second, the throughput and stability metrics are **not a trade-off**: the headline finding of the research is that high performers are fast *and* stable, which means a dashboard where speed climbs while failure rate climbs is not "going faster," it is breaking. Third, the keys are statistically **heavy-tailed and definitionally fragile** — which makes cross-organization comparison nearly meaningless and makes them powerful only as a *trend for your own system*. This page is those three facts and their consequences.

---

## Prerequisites

- **Required:** You've internalized [middle.md](middle.md) — the precise definition of each of the four keys, how to instrument them from VCS/CI/CD/incident data, and the Elite-to-Low performance bands.
- **Required:** You can read a distribution: you know why a long-tailed dataset has a median far below its mean, and what a p75/p90 tells you that an average hides.
- **Helpful:** You've sat in at least one "engineering productivity" review where a number was used as a target, and watched the behavior it produced.
- **Helpful:** A working sense of [Goodhart's law](../06-metrics-anti-patterns-and-goodhart/senior.md) — that a measure used as a target stops being a good measure.

---

## The Research — What *Accelerate* Actually Did

The four keys are not a framework someone invented in a blog post. They are the published output of a multi-year, survey-based research program — the **State of DevOps reports** (2014 onward) and the book *Accelerate: The Science of Lean Software and DevOps* (2018) by **Nicole Forsgren, Jez Humble, and Gene Kim**. Understanding the *method* is what lets you defend (and bound) the conclusions.

The methodology, in the terms a senior should be able to articulate:

1. **Survey-based, cross-sectional data.** The program collected tens of thousands of responses from engineers and managers across thousands of organizations, worldwide, across industries and company sizes. The unit of measurement is the *team's delivery system*, captured via self-report.
2. **Latent constructs measured by Likert scales.** You cannot ask "how good is your continuous delivery?" and get a number. The research instead measured each construct (e.g., "continuous delivery," "trunk-based development," "culture") with *multiple* survey questions and used **psychometric techniques** — Cronbach's alpha for reliability, discriminant and convergent validity tests — to confirm those questions actually measure one coherent latent thing. This is the part most popularizations omit, and it's what raises the work above opinion.
3. **Cluster analysis to find the performance groups.** The Elite / High / Medium / Low bands were not chosen by the authors as round numbers. They emerged from **cluster analysis** on the four delivery metrics: the data *naturally* separated into groups of teams whose throughput and stability profiles clumped together. The bands are an empirical artifact of the dataset, re-derived each year (which is why the numeric thresholds *move year to year* — and why quoting a specific threshold from one year as gospel is a mistake).
4. **Inferential models that test for prediction, not just correlation.** The central, frequently-misquoted claim is that software delivery performance **predicts organizational performance** — profitability, productivity, market share, and broader goals — using structural equation modeling (SEM). SEM lets the researchers posit a directed model (capabilities → delivery performance → organizational outcomes) and test whether the data is consistent with that *directional* structure, rather than merely noting two columns move together.

> **Key insight:** The four keys earn their authority from *psychometrics and inferential statistics on a large cross-org dataset*, not from intuition. That is also exactly where their limits live: it is survey self-report, it is cross-sectional (a snapshot, not a controlled longitudinal experiment), and "predicts" is a statistical-model claim about populations — not a guarantee that improving your team's deploy frequency will raise your company's stock price. Hold both halves: the rigor is real *and* bounded.

A precise word on "predicts." In everyday speech "predict" implies cause. In the research it means a *statistical* relationship: in the modeled structure, delivery performance has a significant directed path to organizational performance, controlling for other factors. SEM strengthens the *case* for a causal direction (the model is hypothesis-driven and the path is directional) but, like all observational work, cannot *prove* causation the way a randomized experiment could. A senior cites the finding accurately: "the research found delivery performance is a statistically significant predictor of organizational performance" — not "deploying more makes you more profitable."

---

## The Throughput–Stability Finding — Not a Trade-Off

The most important *single result* in the entire body of work — the one that reframes how you read your own dashboard — is this: **throughput and stability are not in tension. High performers do both.**

Map the four keys onto two axes:

| Axis | Keys | What it captures |
|---|---|---|
| **Throughput** | Deployment Frequency, Lead Time for Changes | How fast change reaches production |
| **Stability** | Change Failure Rate, Time to Restore Service | How safely change reaches production |

The folk theory of software — held by most engineering leaders before this research — is that these axes *trade off*: "we could ship faster, but we'd break more; we're slow because we're careful." The data contradicts it. Across the dataset, the teams with the *highest* throughput also had the *lowest* change failure rate and the *fastest* recovery. Speed and safety are **positively correlated**, not negatively. Elite performers are not making a brave bet on speed at the cost of stability; they have built a system in which the same practices produce both.

The mechanism is intuitive once stated. The practices that make deployment fast — small batches, automated testing, continuous integration, automated deployment, fast rollback — are *the same practices* that make deployment safe. Small changes are easier to review, easier to test, and easier to revert; a robust deployment pipeline catches failures before users see them and recovers quickly when one slips through. You don't trade speed for safety; you invest in capabilities that buy you both, or you forgo both. The slow team is usually *also* the unstable team, because its large, infrequent, manually-tested releases are both slow to ship and likely to fail.

> **Key insight:** Because throughput and stability move *together* in healthy systems, a dashboard where deployment frequency rises **while** change failure rate also rises is not an improvement — it is a regression that a naive reading mistakes for progress. "We ship 3× more often now" is only good news if the failure rate held or fell. Always read the throughput pair and the stability pair *together*; a gain on one bought by a loss on the other means you found a faster way to break production.

This is why the four keys are designed as a **balanced set**, two-and-two. Any one of them, optimized alone, is gameable and misleading. Together, the pairs are a guardrail on each other: lead time without change failure rate rewards reckless shipping; change failure rate without deployment frequency rewards shipping nothing.

---

## Outcomes vs Levers — The 24 Capabilities That Drive the Keys

Here is the distinction that separates senior practitioners from dashboard-watchers, and the source of the most expensive metrics mistakes in the industry.

**The four keys are outcomes. They are not the things you do.** They are the *measured result* of doing other things well. The research identified roughly **24 capabilities** — concrete, adoptable engineering and management practices — that *drive* the four keys. The capabilities are the levers; the keys are the readouts. You move the keys by improving capabilities, never by aiming at the keys.

The 24 capabilities cluster into five categories. A representative (not exhaustive) sampling:

| Category | Capabilities (selected) |
|---|---|
| **Continuous Delivery** | Version control for *all* artifacts; deployment automation; **continuous integration**; **trunk-based development**; test automation; test data management; shift-left on security; continuous delivery as a discipline |
| **Architecture** | **Loosely coupled architecture** (teams can deploy independently without coordinating); empowered teams that choose their own tools |
| **Product & Process** | Working in small batches; making the flow of work visible; gathering and implementing customer feedback; team experimentation |
| **Lean Management & Monitoring** | Lightweight change-approval (peer review over heavyweight CABs); **monitoring and observability**; proactive notification; WIP limits; visualizing work |
| **Culture** | **Generative (Westrum) culture**; supporting learning; collaboration among teams; job satisfaction; transformational leadership |

Two of these deserve a senior's special attention because they are the highest-leverage and most counter-intuitive:

- **Trunk-based development.** The research found that teams practicing trunk-based development (short-lived branches, merging to mainline at least daily, no long-lived feature branches) had higher delivery performance. This is a *capability* — adopt it and your lead time and deploy frequency improve as a consequence. It is one of the strongest predictors and one of the hardest cultural sells.
- **Loosely coupled architecture.** The single best predictor of being able to deploy frequently and independently is an architecture (and an org) where a team can test and deploy its service *on demand, without orchestrating with other teams*. This is why "should we adopt microservices?" is really an architecture-capability question, and why deploy frequency cannot be fixed by a CI tool if the architecture forces twelve teams to release together. (See [Technical Debt Management](../../technical-debt-management/) — coupling is the debt that caps your delivery throughput.)

> **Key insight:** The four keys are a **thermometer, not a treatment.** You do not lower a fever by holding ice to the thermometer. The catastrophic-and-common mistake is to set a key as a target — "every team will deploy daily by Q3" — which produces gaming (split one deploy into ten, redefine "deployment") rather than the capabilities that *cause* healthy deploy frequency. The correct move is always: *measure the key as a signal, then invest in the capability the research links to it.* Targets go on capabilities and the experiments to adopt them; the keys are how you check whether the investment is working.

This outcome-vs-lever structure is also why "improve our DORA metrics" is not, by itself, a coherent objective. The coherent objective is "adopt trunk-based development and shrink batch size," with the keys as the *instrument that tells you whether it worked.* Aim at the lever; watch the outcome.

---

## Statistical Rigor — Heavy Tails and the Definitional Trap

The four keys are *distributions*, not points, and treating them as points is how teams lie to themselves with their own data. Two statistical realities govern honest measurement.

### Heavy-tailed distributions: use medians and percentiles, never means

Lead time, time to restore, and the intervals between deployments are all **heavy-tailed** (right-skewed). Most changes flow through quickly; a small number get stuck — a gnarly review, a flaky environment, a change blocked on an external dependency — and sit for days. The mean is dragged upward by those few extreme values and describes *no actual change*.

Consider ten changes with lead times (in hours): `2, 3, 3, 4, 4, 5, 6, 8, 10, 200`. The **mean is 24.5h**; the **median is 4.5h**. The mean is a fiction — no change took ~24 hours, and reporting it makes a fast pipeline look broken (or, if the outlier is removed, makes a broken pipeline look fast). Honest reporting uses:

- The **median (p50)** for the typical experience.
- The **p75/p90/p95** to see the tail — the changes that get stuck. The *gap* between p50 and p90 is itself the signal: a small gap means a predictable pipeline; a large gap means most changes are fine but a meaningful slice gets badly stuck, which is where you should look.

> **Key insight:** Report the four keys as a **median plus a high percentile (p90/p95)**, never a mean. The mean of a heavy-tailed delivery metric is a number that describes nothing real and that any single stuck change can swing wildly. The distance between p50 and p90 tells you about *predictability* — often more actionable than the central value, because the tail is where the pain and the variance live.

### Definitional sensitivity: why cross-org comparison is nearly meaningless

Here is the trap that invalidates most "we're Elite / they're Medium" claims. Every one of the four keys hinges on a *definition your organization chooses*, and small definitional differences swing the numbers enormously:

- **"What is a deployment?"** A push to production users? A deploy to staging? A release behind a feature flag (deployed but not released)? A library publish? If Team A counts every flag-gated push and Team B counts only customer-visible releases, A's deployment frequency can be 50× B's with *identical underlying behavior*.
- **"What is a failure?"** A rollback? A `Sev1` page? Any hotfix? A bug filed within 24 hours? A change that *degraded* a metric without an incident? Change failure rate is "the percentage of deployments causing a failure in production requiring remediation" — but the threshold for "failure" and "remediation" is a local judgment call. Tighten it and your CFR drops; loosen it and it spikes — with no change in reality.
- **"When does the clock start for lead time?"** At first commit? At the *first* commit of the change, or PR-open, or ticket-creation? "Lead time for changes" is specifically *commit-to-production*, but teams routinely conflate it with the broader "concept-to-customer" lead time, producing numbers an order of magnitude apart.
- **"What counts as restored?"** Time to restore service ends when... the page clears? The fix deploys? The root cause is fixed? Full vs partial restoration changes MTTR materially.

Because each definition is a local choice, **comparing two organizations' raw four-key numbers is comparing two different measurements that happen to share a name.** The benchmark bands are useful for rough orientation — am I in the ballpark of "deploy weekly" or "deploy hourly"? — but a leaderboard ranking teams by raw DORA numbers is measuring definitional choices, not delivery capability.

> **Key insight:** The four keys are a **trend instrument for your own system, not a cross-org ranking tool.** Their value is *longitudinal*: hold your definitions fixed and watch whether *your* median lead time falls and *your* CFR holds quarter over quarter. The instant they are used to compare teams or organizations — or worse, to rank individuals — the definitional ambiguity converts them from signal into a politics generator. Pin your definitions, write them down, and compare yourself only to your past self.

---

## The Reliability "Fifth Key"

The original four keys measure **delivery** — getting change to production fast and safely. They are silent on a different question: *once it's there, does it actually work for users?* You can have elite delivery metrics and a product that is slow, flaky, or down — you'd just be reliably and frequently shipping an unreliable service.

The **2021 State of DevOps report** addressed this gap by adding a **fifth key: operational performance / reliability.** Rather than a single hard metric, it is the team's *ability to meet or exceed its reliability targets* — framed in the language of SRE: availability, latency, performance, and **service level objectives (SLOs)** with **error budgets**. The research found that teams who excelled at the *delivery* four keys *and* prioritized reliability outperformed on organizational outcomes — and, notably, that focusing on reliability is what lets high-throughput teams *sustain* their speed rather than burn it on firefighting.

The fifth key closes a real loophole in the original four:

- The delivery four keys can be "elite" for a service nobody can rely on. Reliability re-anchors the set to the *user's* experience of the running system.
- It connects the delivery world (DORA) to the operations world (SRE/SLOs), making explicit that **delivery performance is only valuable in service of a reliable product.**

> **Key insight:** The four keys measure *the act of delivering*; the fifth key asks *whether what you delivered is actually serving users well.* A senior treats the delivery four as "how good is our pipeline" and the fifth as "and is the thing at the end of it reliable" — and never lets elite delivery numbers stand in for a healthy service. The deep treatment of CFR, MTTR, availability, SLOs, and error budgets lives in [Quality & Reliability Metrics](../05-quality-and-reliability-metrics/senior.md).

---

## The System View — Why One Key Moves at Another's Expense

The four keys form a **system**, and the defining property of a system metric is that you cannot move one component in isolation without risking another. A senior reads the four keys the way a control engineer reads coupled gauges: never one at a time.

The canonical failure mode, restated as a system dynamic: a leadership directive to "increase deployment frequency" is given to a team whose *underlying capabilities have not changed* (still large batches, weak test automation, tight coupling). The team complies with the metric. Deployment frequency goes up. But because the capability that would make frequent deployment *safe* is absent, **change failure rate climbs in lockstep.** The dashboard now shows "shipping faster" — and a careful reader sees the truth: *shipping faster and breaking more.* You haven't improved the system; you've moved load from one gauge to another.

The symmetric failures are just as real:

- Drive **change failure rate to zero** by adding gates, approvals, and freezes → **lead time and deployment frequency collapse.** A team with a 0% failure rate that deploys quarterly hasn't won; it has stopped delivering. (Zero failures usually means "not shipping," not "shipping perfectly.")
- Drive **lead time down** by skipping review and test → **change failure rate spikes.**
- Drive **time to restore down** by always rolling back instead of fixing forward → masks a rising defect-injection rate; the *fix* is fast because you're not actually fixing anything.

This is why the set is deliberately **balanced into a throughput pair and a stability pair that constrain each other.** The pairs are *designed* to make gaming one visible in the other. The senior practice is to evaluate them as a vector and ask the systems question: *did the whole vector improve, or did one component improve by stealing from another?* A real improvement moves throughput up while stability holds or improves — which only happens when you changed an underlying capability, not when you pushed on a gauge.

> **Key insight:** Optimizing any single key in isolation will, in a system without improved capabilities, **degrade its paired key** — that is the system's way of telling you that you pulled a lever that isn't connected to the engine. Genuine improvement shows up as the *whole balanced set* moving the right way at once, and that signature is the fingerprint of a real capability change (small batches, test automation, decoupling) rather than a metric-gaming maneuver.

---

## Criticisms and Limits — What the Four Keys Don't Measure

A senior who can only sell the four keys is a salesperson; one who can also state their limits is an engineer. The serious criticisms, and how to hold them:

**1. Survey self-report bias.** The foundational research is survey-based. Respondents self-report their team's practices and performance, which introduces well-known biases: social desirability (people rate their own org generously), recall error, and selection (the kind of org that responds to a DevOps survey may not be representative). The *system-level* findings hold up across a large sample, but any individual claim carries the caveat that it is correlational, observational, and self-reported — not a controlled experiment. (Note: when *you* instrument the four keys from your own VCS/CI/incident data, you escape self-report — but you inherit the *definitional* problem from the previous section instead.)

**2. They measure delivery, not value.** This is the deepest limitation. The four keys measure *the speed and safety of delivering change* — they say **nothing about whether the change was worth delivering.** A team can be elite on all four keys while shipping features no one uses, building the wrong product flawlessly. Fast, safe delivery of low-value work is still low-value work. The four keys are *necessary but radically insufficient* for "are we building the right thing" — that question belongs to product outcome metrics, flow distribution, and customer feedback, not DORA. Treating elite DORA scores as proof of a healthy engineering org commits exactly the [McNamara fallacy](../06-metrics-anti-patterns-and-goodhart/senior.md) the discipline warns against: mistaking what is easy to measure for what matters.

**3. Gaming risk when used as targets.** Because each key has a manipulable definition (see [statistical rigor](#statistical-rigor--heavy-tails-and-the-definitional-trap)), the moment they become targets — tied to performance reviews, bonuses, or team rankings — **Goodhart's law activates.** Teams redefine "deployment" to inflate frequency, narrow "failure" to suppress CFR, and start the lead-time clock late. The metric improves; the system doesn't. This is not a flaw you can engineer away; it is a property of using any measure as a target. The only defense is *governance*: keep the keys as improvement signals owned by the team, never as judgment instruments wielded over it.

**4. Limited applicability outside continuous-delivery contexts.** The four keys assume a world where "deployment" is a frequent, meaningful, software-delivery event. They translate poorly to: firmware and embedded systems with annual release cycles; safety-critical/regulated software where deployment frequency is *intentionally* low and high deploy frequency would be a *defect*; data/ML pipelines where "deployment" and "failure" mean something different; and hardware. Forcing the four keys onto a context where shipping monthly is correct and safe produces a misleading "Low performer" verdict on a team doing exactly the right thing. The keys are a *strong default for CD-style software delivery* and a *poor fit elsewhere* — know which world you're in.

**5. They are team/system metrics, never individual metrics.** Every one of the four keys is a property of a *delivery system*, not a person. Attempting to attribute deploy frequency or CFR to an individual is a category error that the research, the SPACE authors, and Goodhart all explicitly warn against — it destroys the collaboration the metrics depend on. (Full treatment in [Metrics Anti-Patterns & Goodhart](../06-metrics-anti-patterns-and-goodhart/senior.md).)

> **Key insight:** The four keys are the **best-validated measure of software *delivery* performance we have — and delivery is only one face of engineering value.** A senior states the boundary out loud: DORA tells you how *well your delivery system runs*, not whether you're building the right thing, not how individuals perform, and not much at all outside a continuous-delivery context. Used as a humble, team-owned trend instrument for *delivery*, they are excellent. Used as a universal scorecard for "engineering productivity," they overreach into exactly the failure modes the research itself cautions against.

---

## Mental Models

- **Thermometer, not treatment.** The four keys *read out* the health of your delivery system; the 24 capabilities are the *treatment*. You cannot lower a fever by chilling the thermometer, and you cannot improve delivery by setting a target on a key. Aim at the capability; watch the key.

- **Two gauges per axis, and they're wired together.** Throughput (deploy frequency, lead time) and stability (CFR, time to restore) are a *positively correlated* pair, not a trade-off. Read them together; a gain on one bought by a loss on the other is a regression wearing a progress costume.

- **A distribution, not a point.** Every key is heavy-tailed. The mean is a lie the tail tells; the median is the typical experience and the p90 is where the pain hides. The *gap* between them is the predictability signal.

- **A mirror, not a ruler.** The definitional ambiguity makes the keys a precise instrument for measuring *yourself over time* (fix definitions, watch the trend) and a near-useless one for *ranking others* (different definitions, same names). Compare yourself to your past self.

- **Delivery, not value.** The four keys measure how fast and safely you ship — never whether what you shipped mattered. Elite DORA + wrong product = flawless delivery of waste. The keys are a floor, not a ceiling, on engineering health.

---

## Common Mistakes

1. **Setting a key as a target.** "Every team deploys daily by Q3" triggers Goodhart instantly — teams split deploys, redefine "deployment," and game the number instead of building the capability. Put targets on capabilities (trunk-based development, batch size) and use the key to verify they worked.

2. **Reading throughput without stability (or vice versa).** Celebrating "3× more deploys" while change failure rate also tripled is mistaking a regression for progress. The keys are a balanced set *because* either pair is gameable alone; always read both pairs together.

3. **Reporting means instead of medians/percentiles.** Lead time and time-to-restore are heavy-tailed; the mean is dragged by a few stuck changes and describes nothing real. Report p50 + p90 and watch the gap.

4. **Comparing raw numbers across teams or orgs.** "We're Elite, they're Medium" usually compares two *different definitions* of "deployment" and "failure," not two delivery capabilities. Use the keys as your own longitudinal trend; pin and document your definitions.

5. **Treating elite delivery metrics as proof of a healthy org.** The four keys measure *delivery*, not *value*. Flawlessly shipping features no one uses scores elite. Pair DORA with product-outcome and flow metrics before claiming engineering health.

6. **Forcing the keys onto a non-CD context.** Embedded, safety-critical, regulated, or hardware-adjacent work often has *intentionally* low deploy frequency. Branding such a team "Low performer" misapplies a CD-shaped instrument. Know which world you're in.

7. **Attributing keys to individuals.** Every key is a system property. Ranking engineers by deploy frequency or CFR is a category error that corrodes the collaboration the metrics measure — the one use the research most explicitly forbids.

8. **Quoting a year's benchmark thresholds as permanent law.** The bands come from cluster analysis *re-run each year*; the numeric thresholds move. Use them for rough orientation, not as fixed pass/fail lines.

---

## Test Yourself

1. The four keys are described as *outcomes*. What are the *levers*, and what is the single most common mistake organizations make about this distinction?
2. State the throughput–stability finding precisely. Why does it mean a rising deploy frequency *with* a rising change failure rate is bad news, not good?
3. The research claims delivery performance "predicts" organizational performance. What does "predict" actually mean here, and what can it *not* establish?
4. Why are means the wrong statistic for lead time and time-to-restore? What should you report instead, and what does the p50–p90 gap tell you?
5. Why is comparing two organizations' raw four-key numbers nearly meaningless? Give two specific definitional choices that swing the numbers.
6. What gap in the original four keys does the 2021 "fifth key" close, and in whose vocabulary is it framed?
7. Name three serious limitations of the four keys and the contexts in which each bites.

<details>
<summary>Answers</summary>

1. The levers are the **~24 capabilities** the research identified (continuous integration, **trunk-based development**, **loosely coupled architecture**, deployment automation, test automation, generative culture, etc.). The four keys are the *measured outcome* of practicing those capabilities well. The most common mistake is **targeting the outcome metric directly** — e.g., mandating a deploy-frequency number — instead of investing in the capability that *causes* healthy deploy frequency. You move the keys by improving capabilities, never by aiming at the keys.

2. **Throughput (deploy frequency, lead time) and stability (CFR, time to restore) are positively correlated — high performers do both; they are not a trade-off.** The practices that make delivery fast (small batches, test automation, robust pipelines, fast rollback) are the same practices that make it safe. So if deploy frequency rises while CFR *also* rises, the underlying capability didn't improve — you found a faster way to break production. A real improvement raises throughput while stability holds or improves.

3. "Predict" is a **statistical-model claim**: using structural equation modeling on cross-sectional survey data, delivery performance has a *significant directed path* to organizational outcomes (profitability, productivity, market share) in a hypothesis-driven model. It strengthens the case for a causal direction but, being observational and self-reported, **cannot prove causation** the way a randomized experiment could — it is a population-level association in a directional model, not a guarantee that your team deploying more will raise your company's profit.

4. Lead time and time-to-restore are **heavy-tailed (right-skewed)**: a few stuck changes drag the mean far above any real value, so the mean describes nothing actual and swings on a single outlier. Report the **median (p50)** for the typical experience and a **high percentile (p90/p95)** for the tail. The **p50–p90 gap measures predictability** — a small gap means a consistent pipeline; a large gap means most changes are fine but a meaningful slice gets badly stuck (where you should investigate).

5. Because every key depends on a **locally chosen definition**, two orgs sharing the metric names are running two *different measurements*. Examples: **"what is a deployment"** (every flag-gated push vs only customer-visible releases — can differ 50× with identical behavior) and **"what is a failure"** (any rollback/hotfix vs only a Sev1 requiring remediation — tightening or loosening the threshold swings CFR with no change in reality). The keys are a *longitudinal* instrument for your own system with fixed definitions, not a cross-org ranking.

6. The original four measure **delivery** (getting change to production fast and safely) but say nothing about whether the running service actually **works for users**. The **2021 fifth key — operational performance / reliability** — closes that loophole, framed in **SRE vocabulary**: availability, latency, performance, **SLOs and error budgets**. It re-anchors the set to the user's experience and connects DORA to operations.

7. Any three of: **(a) survey self-report bias** — observational, correlational, self-rated data with social-desirability and selection effects (bites for the *foundational research claims*); **(b) measures delivery, not value** — elite keys are fully compatible with shipping the wrong product (bites whenever DORA is treated as proof of org health); **(c) gaming when used as targets** — Goodhart activates via the manipulable definitions (bites when keys are tied to reviews/bonuses/rankings); **(d) poor fit outside CD** — embedded/safety-critical/regulated/hardware with intentionally low deploy cadence get a misleading "Low" verdict; **(e) team metrics, not individual** — attributing them to people is a category error that corrodes collaboration.

</details>

---

## Cheat Sheet

```
THE FOUR KEYS — TWO AXES, A BALANCED SET
  THROUGHPUT   Deployment Frequency      how often you ship to prod
               Lead Time for Changes     commit → production (NOT concept→customer)
  STABILITY    Change Failure Rate       % of deploys causing a failure needing remediation
               Time to Restore Service   incident start → service restored
  + 5th key (2021)  Reliability / operational performance — meeting SLOs (SRE framing)

THE BIG FINDINGS
  Throughput & stability are POSITIVELY correlated — high performers do BOTH (no trade-off)
  Delivery performance PREDICTS org performance (SEM on survey data — association, not proof)
  Bands (Elite/High/Medium/Low) come from CLUSTER ANALYSIS, re-derived yearly (thresholds move)

OUTCOMES vs LEVERS
  Keys = OUTCOMES (thermometer)   |   24 CAPABILITIES = LEVERS (treatment)
  capabilities: CI, trunk-based dev, loosely coupled architecture, deploy + test automation,
                small batches, lightweight change approval, monitoring, generative culture...
  RULE: target the CAPABILITY, never the key. Aiming at the key → gaming (Goodhart).

STATISTICS — DO
  median (p50) + p90/p95  (heavy-tailed; NEVER report the mean)
  p50→p90 gap = predictability signal
  pin & document YOUR definitions of "deployment" / "failure" / clock start

STATISTICS — DON'T
  no means          (one stuck change wrecks them)
  no cross-org raw comparison   (different definitions, same names → meaningless)
  no per-individual attribution (every key is a SYSTEM property)

SYSTEM VIEW
  read the pairs TOGETHER — a gain on one bought by a loss on its pair = regression
  freq↑ + CFR↑  = shipping faster AND breaking more (NOT progress)
  CFR→0 via gates = lead time/freq collapse (you stopped shipping, not perfected it)

LIMITS
  measures DELIVERY, not VALUE   |   survey self-report bias   |   gameable as targets
  poor fit for non-CD (embedded/safety-critical/regulated/hardware)   |   team, not individual
```

---

## Summary

- The four keys are the **published output of a survey-based research program** (*Accelerate*; Forsgren, Humble, Kim; the State of DevOps reports) that used **psychometrics** to validate constructs, **cluster analysis** to derive the Elite-to-Low bands, and **structural equation modeling** to find that delivery performance is a *statistically significant predictor* of organizational performance. The rigor is real; "predict" is a model claim, not proof of cause.
- The headline finding is that **throughput and stability are not a trade-off** — high performers are fast *and* stable, because the same capabilities (small batches, automation, decoupling, fast rollback) buy both. A dashboard where deploy frequency rises while change failure rate also rises is a regression, not progress.
- The four keys are **outcomes**; the **~24 capabilities** (CI, trunk-based development, loosely coupled architecture, test automation, lightweight approvals, generative culture…) are the **levers**. The defining organizational mistake is targeting the outcome — which produces gaming — instead of investing in the capability the research links to it.
- Each key is **heavy-tailed**: report **median + p90/p95**, never the mean, and read the p50–p90 gap as a predictability signal. Each key is also **definitionally fragile** ("what is a deployment / a failure / the clock start?"), which makes cross-org comparison nearly meaningless and makes the keys a **longitudinal trend instrument for your own system** with pinned definitions.
- The **2021 reliability "fifth key"** closes the delivery-vs-running-service gap in SRE language (SLOs, error budgets) — elite delivery of an unreliable service is still failure.
- The keys form a **system**: optimizing one in isolation degrades its pair. And they have hard **limits** — they measure *delivery, not value*, carry self-report bias, are gameable as targets, fit CD contexts poorly elsewhere, and are *team*, never individual, metrics.

You now reason about the four keys as a research-grounded, balanced, definition-sensitive *signal of delivery health* — and about the 24 capabilities as the actual levers. The next layer — [professional.md](professional.md) — is about operating this measurement across an organization: instrumenting it honestly, governing it against gaming, and driving capability change at scale.

---

## Further Reading

- *Accelerate: The Science of Lean Software and DevOps* — Nicole Forsgren, Jez Humble, Gene Kim (2018). The book that consolidates the research: the methodology, the four keys, the 24 capabilities, and the throughput–stability finding. Part II is the methods chapter every senior should read at least once.
- **The annual State of DevOps / DORA reports** (2014–present). The living dataset — the bands, the capabilities, and the year the reliability fifth key was added (2021). Each year re-derives the clusters, which is why thresholds move.
- *The Science of Lean Software and DevOps* methodology appendices (in *Accelerate*) — Cronbach's alpha, construct validity, and why latent constructs require multiple survey items.
- [Google Cloud's DORA site and Quick Check](https://dora.dev) — the capabilities catalog, the research summaries, and a self-assessment that reflects the outcome-vs-capability structure.
- Martin Fowler, *cannotMeasureProductivity* — the essential counterweight: why delivery throughput is not the same as productivity or value.
- Charity Majors / SRE literature on **SLOs and error budgets** — the vocabulary the fifth key adopts (and the bridge to [Quality & Reliability Metrics](../05-quality-and-reliability-metrics/senior.md)).

---

## Related Topics

- [junior.md](junior.md) — the four keys defined in plain terms and why each one matters.
- [middle.md](middle.md) — computing each key from VCS/CI/CD/incident data and reading the Elite-to-Low bands.
- [professional.md](professional.md) — operating the four keys across an org: honest instrumentation, governance against gaming, and driving capability change.
- [05 — Quality & Reliability Metrics](../05-quality-and-reliability-metrics/senior.md) — CFR, MTTR, availability, SLOs, error budgets, and the reliability fifth key in depth.
- [06 — Metrics Anti-Patterns & Goodhart](../06-metrics-anti-patterns-and-goodhart/senior.md) — why targeting the keys backfires, the McNamara fallacy, and the prohibition on individual metrics.
- [Technical Debt Management](../../technical-debt-management/) — architectural coupling is the debt that caps delivery throughput; the capability "loosely coupled architecture" lives here in practice.
