# Flow Metrics & Value Stream — Interview Questions

> **Roadmap:** [Engineering Metrics & DORA](../README.md) → Flow Metrics & Value Stream
> *A flow interview rarely asks "what is velocity." It asks "a feature took six weeks but only four days of work — explain that," and then watches whether you reach for "the team is slow" or for **flow efficiency**, **Little's Law**, and **the bottleneck**. This page is the question bank, with model answers and a note on what each question is really probing.*

---

## Table of Contents

1. [How to Use This Page](#how-to-use-this-page)
2. [Theme 1 — Value Stream and Flow Basics](#theme-1--value-stream-and-flow-basics)
3. [Theme 2 — The Flow Framework Metrics](#theme-2--the-flow-framework-metrics)
4. [Theme 3 — Little's Law and WIP](#theme-3--littles-law-and-wip)
5. [Theme 4 — Theory of Constraints](#theme-4--theory-of-constraints)
6. [Theme 5 — Forecasting](#theme-5--forecasting)
7. [Theme 6 — Scenario and Judgment](#theme-6--scenario-and-judgment)
8. [Theme 7 — Pitfalls](#theme-7--pitfalls)
9. [Rapid-Fire Round](#rapid-fire-round)
10. [Red Flags and Green Flags](#red-flags-and-green-flags)
11. [Summary](#summary)
12. [Further Reading](#further-reading)
13. [Related Topics](#related-topics)

---

## How to Use This Page

Each question carries three things: **Q** (the prompt), **what the interviewer is really testing**, and **A** (a model answer at the depth a strong candidate gives). Don't memorize the answers — internalize the *distinctions* they keep returning to:

- **work vs wait** (touch time vs the time work sits in a queue — and which one dominates)
- **flow vs activity** (the system's throughput vs how busy any one person looks)
- **the constraint vs everything else** (one resource governs throughput; improving the rest is motion without progress)
- **distribution vs average** (a single number lies; the *shape* of the data carries the answer)

Nearly every question in this bank is one of those four distinctions wearing a costume. The candidates who do well are the ones who *name the distinction* before reaching for a metric. A weak answer optimizes the worker; a strong answer optimizes the flow.

---

## Theme 1 — Value Stream and Flow Basics

### Q1.1 — What is a value stream, and where does it actually start and end?

> **Testing:** Whether you draw the boundary at "code" or at "value."

**A.** A value stream is the **end-to-end sequence of steps that turns a customer request into delivered value** — from the moment a need is articulated to the moment the customer can use the result and you've learned from it. The trap is drawing it as "first commit → merge," which is the *developer's* slice. The real stream usually starts at *idea accepted / committed to* and ends at *running in production and validated*, spanning discovery, design, review, build, test, deploy, and feedback. Why the boundary matters: most delay lives **outside** the coding step — in backlog wait, in "ready for review," in "waiting for QA," in release trains. If you measure only the part you can see (coding), you optimize the 15% and ignore the 85%. Mapping the *whole* stream is the prerequisite to improving it, which is the entire point of a **value stream map**.

### Q1.2 — Define flow time. How is it different from "how long did the work take"?

> **Testing:** The work-vs-wait distinction, which is the core of the whole topic.

**A.** **Flow time** is the *total elapsed wall-clock time* a work item spends in the value stream, from when it enters to when it's done — including every minute it sat in a queue. "How long did the work take" is **touch time** (active/work time): the hands-on-keyboard effort. These are wildly different numbers. A feature with two days of actual engineering can have a flow time of three weeks because it spent the rest of the time *waiting* — waiting to be picked up, waiting for review, waiting for a deploy window. Flow time is what the *customer* experiences; touch time is what shows up in a developer's calendar. The gap between them is the most important quantity in flow metrics, because that gap is pure delay you can attack without anyone working harder.

### Q1.3 — "Most of the time, work isn't being worked on, it's waiting." Is that true, and why does it matter?

> **Testing:** Whether you've internalized the empirical reality of knowledge work.

**A.** It's true, and it's the central insight of flow thinking. In most software value streams, an item is *actively worked on* for a small fraction of its flow time and *waiting in a queue* for the rest — flow efficiencies of **5–15% are typical**, meaning 85–95% of an item's life is dead time. It matters because it reframes the improvement target: if you believe work is mostly *being worked on*, you push people to go faster (hire, overtime, pressure) and get tiny returns, because you're squeezing the 15%. If you understand work is mostly *waiting*, you attack the **queues** — reduce WIP, remove handoff delays, batch less — and get large returns, because you're draining the 85%. The waits are where the time is, so the waits are where the leverage is.

### Q1.4 — What is flow efficiency, how do you compute it, and what's a realistic number?

> **Testing:** Whether you can define the ratio correctly and calibrate expectations.

**A.** **Flow efficiency = active (work) time ÷ flow time × 100%** — the fraction of an item's total elapsed time during which it was actually being worked on. If a story has 8 hours of active work and a flow time of 80 hours, that's 10% efficiency. A *realistic* number in knowledge work is **5–15%**; reaching 25–40% is excellent. The naïve expectation is that it should be near 100% ("people are working all day"), but that conflates a *person* being busy with an *item* flowing — a developer can be 100% utilized while every item sits in a queue waiting for them. The metric is deliberately about the **item's** journey, not the worker's busyness. Low flow efficiency isn't a sign of lazy people; it's a sign of too many queues and too much WIP, which is good news — those are structural and fixable.

---

## Theme 2 — The Flow Framework Metrics

### Q2.1 — Name the five Flow Framework metrics and define each.

> **Testing:** Breadth and precision on Mik Kersten's *Flow* model.

**A.** The Flow Framework tracks five **flow metrics** over *flow items* (features, defects, risks, and debt — the four "flow items"):

1. **Flow Velocity** — the *number* of flow items completed in a period (throughput). "How much are we finishing?"
2. **Flow Time** — elapsed time from when an item enters *active* work to when it's released. "How long does it take?"
3. **Flow Efficiency** — active time ÷ flow time. "How much of that time was real work vs waiting?"
4. **Flow Load** — the number of items *in progress* (WIP) in the stream. "How much are we trying to do at once?"
5. **Flow Distribution** — the *proportion* of capacity spent across the four item types (features vs defects vs risk vs debt). "What mix of work are we doing?"

The set is deliberately a *system* — velocity without efficiency hides waiting; velocity without distribution hides that you're shipping features by starving debt. You read them together, against business outcomes, not in isolation.

### Q2.2 — Why is Flow Distribution the metric that matters most for technical debt?

> **Testing:** Whether you grasp that debt is a *budgeting* problem, not a moralizing one.

**A.** Because **debt loses every argument it isn't given a budget for.** Flow Distribution makes the allocation *explicit and visible*: it shows, say, "82% features, 14% defects, 3% risk, 1% debt" as a measured fact rather than a feeling. Debt, security/risk, and architectural work are perpetually deprioritized because each individual feature looks more urgent than each individual paydown — so without a *reserved share*, debt asymptotically approaches zero attention while the codebase rots and velocity quietly decays. Distribution lets leadership make a *deliberate* call ("we'll run 70/15/10/5 this quarter") and then *hold to it*, instead of discovering after the fact that they spent the whole year on features and now nothing can ship. It converts "we should really do something about tech debt" — which never wins — into a line item that's protected by policy. That's why it's the debt metric: it's the only one that turns intention into committed capacity.

### Q2.3 — A team's Flow Velocity is flat but Flow Time is rising. What's your read?

> **Testing:** Reading two metrics *together* rather than reacting to one.

**A.** Finishing roughly the same *number* of items per period, but each one is taking *longer end-to-end* — a classic signature of **rising WIP / Flow Load**. By Little's Law, if throughput (velocity) is constant and flow time is climbing, the amount of work-in-progress must be growing: more items are open simultaneously, so each spends more time waiting behind the others. Other candidates: growing item size, or a queue/bottleneck forming somewhere downstream (review, QA, deploy). My first move is to pull **Flow Load** — if WIP is up, the fix is to *stop starting and start finishing* (impose WIP limits), not to push for more output. Two metrics moving in this relationship tell you something one metric alone can't: the *system* is congesting even though *throughput* looks fine.

### Q2.4 — How are the Flow Framework metrics different from "developer productivity" metrics like lines of code or story points?

> **Testing:** Whether you distinguish flow (system, outcome) from activity (individual, output).

**A.** Flow metrics measure the **system's** ability to deliver *value items end-to-end*; activity metrics like LOC, commits, or even raw story points measure an *individual's output of motion*. The difference is decisive: you can have soaring commit counts and LOC while *flow time gets worse* (more code, more rework, more WIP). Flow metrics are deliberately scoped to **flow items the business recognizes** (a feature, a fixed defect), measured across the whole stream and tied to outcomes — so they resist the gaming and local-optimization that plague output counts. The Flow Framework's explicit thesis is to connect engineering activity to *business results*, which is why it tracks completed value and its distribution, not how busy anyone looked. Output metrics answer "are people typing?"; flow metrics answer "is value reaching customers, and what's in its way?"

---

## Theme 3 — Little's Law and WIP

### Q3.1 — State Little's Law and explain each term in delivery terms.

> **Testing:** The single most important formula in the topic — stated correctly.

**A.** **L = λ × W**, or in flow terms: **WIP = Throughput × Flow Time**.
- **WIP** (L) — the average number of items *in the system* at once (Flow Load).
- **Throughput** (λ) — the average *completion rate*, items finished per unit time (Flow Velocity).
- **Flow Time** (W) — the average *time an item spends in the system*.

Rearranged, the operationally useful form is **Flow Time = WIP ÷ Throughput**. It's a *conservation law*, not a heuristic — it holds for any stable system regardless of process, scheduling discipline, or variability, as long as the system is roughly in steady state (arrivals ≈ departures over the window, nothing accumulating or draining without bound). That generality is exactly why it's powerful: it links the three numbers every delivery team already has, and it tells you that you cannot independently choose all three.

### Q3.2 — Use Little's Law to explain *why* cutting WIP reduces flow time.

> **Testing:** Whether you can *reason from* the law, not just recite it.

**A.** Rearrange to **Flow Time = WIP ÷ Throughput**. If throughput is roughly fixed (your team finishes about the same number of items per week regardless of how many are open — true once you're capacity-bound), then flow time is *directly proportional to WIP*. Halve the WIP and you roughly **halve the flow time** — items get done in half the elapsed time — *without anyone working faster*. Mechanically: fewer concurrent items means each one waits behind fewer others in every queue, and people context-switch less (so throughput may even *rise*, improving flow time further). This is the rigorous justification for WIP limits and "stop starting, start finishing": it's not a productivity slogan, it's arithmetic. The counterintuitive part for managers is that *starting less work makes work finish sooner* — which is exactly what the law predicts.

### Q3.3 — A manager says "everyone is 100% utilized, so we're maximally efficient." What's wrong?

> **Testing:** The utilization-vs-flow-time relationship — the deepest idea here.

**A.** High *utilization* and good *flow time* are in tension, not alignment. Queueing theory shows that as a resource approaches 100% utilization, **wait time rises non-linearly toward infinity** — the classic curve where going from 80% to 95% busy multiplies queue time several-fold, and the last few points toward 100% explode it. The intuition: a fully-loaded system has *no slack to absorb variability*, so any arrival waits behind a full queue. So "100% utilized" doesn't mean maximally efficient *delivery* — it means maximally *congested*, with the longest possible flow times. A highway at 100% capacity is a traffic jam, not peak throughput. The mature target is to run the constraint hot but **leave slack elsewhere** (often cited around 70–85% utilization for knowledge work), trading a little idle time for dramatically shorter, more predictable flow. Pushing for 100% utilization optimizes the *worker's* busyness at the direct expense of the *item's* speed — the exact inversion flow metrics exist to correct.

### Q3.4 — What conditions must hold for Little's Law to apply, and how do people misuse it?

> **Testing:** Whether your understanding is rigorous or cargo-culted.

**A.** It requires a **stable system over the measurement window** — average arrival rate ≈ average departure rate, the queue neither growing without bound nor draining to zero, and consistent definitions of "in the system" (when an item enters and exits). It's an *averages over a period* law, not a per-item guarantee. Common misuses: applying it to a window where WIP is exploding (a sprint where you keep starting work and finish little — arrivals ≫ departures, so the law's steady-state assumption is violated and the numbers mislead); changing the definition of "done" or "started" mid-measurement; or treating the *average* flow time it yields as a *commitment* for any single item (the distribution is what you forecast with — see Theme 5). Used correctly, it's a sanity check and a lever: if measured WIP, throughput, and flow time don't satisfy WIP ≈ Throughput × Flow Time, your system isn't stable or your measurements are inconsistent — and either is worth knowing.

---

## Theme 4 — Theory of Constraints

### Q4.1 — State the core claim of the Theory of Constraints as it applies to a delivery pipeline.

> **Testing:** Whether you understand that *one* resource governs the whole.

**A.** **The throughput of the entire system is determined by its single biggest constraint (bottleneck) — nothing else.** Goldratt's framing: a chain is only as strong as its weakest link, and a delivery pipeline is a chain of steps (analysis → dev → review → test → deploy). Whichever step has the least capacity *relative to demand* sets the pace for everything; work can only exit the system as fast as it clears that one stage. The practical consequence is stark: improvements *anywhere except the constraint* do **not** increase system throughput — they just pile inventory in front of the bottleneck or create idle time after it. So before optimizing anything, you find the constraint, because it's the only place where local improvement equals global improvement.

### Q4.2 — Why is optimizing a non-bottleneck step "waste"?

> **Testing:** The most counterintuitive — and most tested — ToC idea.

**A.** Because **the non-bottleneck has spare capacity by definition**, so making it faster doesn't help — and often *hurts*. Goldratt's line: "an hour lost at the bottleneck is an hour lost for the whole system; an hour saved at a non-bottleneck is a mirage." If your developers (non-constraint) get 2× faster but code review (the constraint) is unchanged, you've merely *increased the rate at which work arrives at the bottleneck* — building a bigger pile of WIP in front of review, which by Little's Law makes flow time *worse*, not better. System throughput is still capped by review. So the effort, tooling spend, and the new WIP it generated are pure waste relative to the goal: zero throughput gain, longer queues, more inventory. This is why "let's make the engineers more productive" is the wrong instinct when the constraint is downstream — you're optimizing a step that wasn't limiting anything.

### Q4.3 — Walk through Goldratt's five focusing steps.

> **Testing:** Whether you know the actual method, not just the slogan.

**A.** The **five focusing steps**, applied to a pipeline:

1. **Identify** the constraint — find the step where work piles up in front and starves behind it (the longest queue / the stage with the most aging WIP).
2. **Exploit** the constraint — wring maximum throughput from it *as-is*, cheaply: stop it idling, stop feeding it defects and rework, protect it from interruptions, make sure it never waits for trivial reasons.
3. **Subordinate** everything else to the constraint — make non-bottleneck steps serve it: don't overproduce upstream (cap WIP so you don't flood it), and align downstream to never block it. The whole system is paced to the constraint, deliberately leaving non-constraints with idle time.
4. **Elevate** the constraint — *now* invest real money/capacity to raise its throughput (add reviewers, automate the tests, add deploy capacity) — only after exploit and subordinate are exhausted.
5. **Repeat** — once this constraint is broken, a *new* one emerges elsewhere; go back to step 1. And critically: don't let *inertia* become the constraint — re-check, because the bottleneck moves.

The ordering is the lesson: you *exploit and subordinate* (free) before you *elevate* (expensive). Most teams skip straight to "hire more people," which is step 4 done before steps 2 and 3 — usually premature and wasteful.

### Q4.4 — How does the Theory of Constraints connect to Little's Law and WIP limits?

> **Testing:** Whether you see the two frameworks as one coherent picture.

**A.** They're the same story from two angles. ToC says throughput is governed by the constraint; Little's Law (Flow Time = WIP ÷ Throughput) says that with throughput capped by the constraint, *adding WIP only inflates flow time*. **WIP limits are the mechanism that "subordinates" the system to the constraint** (ToC step 3): by capping how much work can be open at each stage, you stop upstream steps from overproducing and burying the bottleneck in inventory. A Kanban board with column WIP limits is literally a ToC drum-buffer-rope implementation — the constraint is the "drum" setting the beat, the WIP limit is the "rope" that stops new work from being released faster than the constraint can absorb. So "find the bottleneck" (ToC) and "limit WIP" (Little's Law / Kanban) aren't two ideas — limiting WIP is *how you act on* the bottleneck, and Little's Law is *why* it works.

---

## Theme 5 — Forecasting

### Q5.1 — How would you forecast a delivery date *without* story-point estimation?

> **Testing:** Whether you know the probabilistic, data-driven alternative.

**A.** Use the team's **historical cycle-time and throughput data** and run a **Monte Carlo simulation**. Instead of asking humans to estimate each item, you take the *empirical distribution* of how long past items actually took (or how many items the team completes per week) and *sample from it thousands of times* to simulate "how long will these N items take" or "how many items can we finish by date D." The output isn't a single date — it's a **probability distribution**: "85% chance of finishing by March 14, 95% by March 21." This beats estimation because it uses *measured reality* rather than optimistic human guesses (which are systematically biased and don't capture queue/wait time at all), it requires no estimation effort, and it honestly expresses uncertainty as a percentage rather than a false-precision single number. You need only two inputs the team already generates: when items started and when they finished.

### Q5.2 — Why forecast with percentiles instead of the average cycle time?

> **Testing:** The distribution-vs-average distinction — central to honest forecasting.

**A.** Because **cycle-time distributions are right-skewed (long-tailed), so the average is a number almost nothing actually hits.** A typical distribution has most items finishing quickly and a long tail of items that took much longer; the *mean* gets dragged rightward by the tail and sits well above the *median*, yet still understates the risk in the tail. If you commit to the average, you'll be late roughly half the time *at best*, and badly late whenever you hit the tail. Percentiles describe the shape honestly: the **50th** (median — coin-flip), **85th**, and **95th** percentiles tell a stakeholder "most items finish within X, but to be safe assume Y." You make *commitments* at a high percentile (85th/95th) to absorb the tail, and you *plan* with the median. A single average throws away the variability that *is* the forecast — the spread is the information, and percentiles preserve it while the mean destroys it.

### Q5.3 — What is a Cumulative Flow Diagram, and what do you read from it?

> **Testing:** Whether you can extract WIP, throughput, and flow time from one chart.

**A.** A **CFD** stacks the count of items in each workflow state (To Do, In Progress, In Review, Done…) over time, as colored bands. It's powerful because *all three* of Little's Law's quantities are visible on it geometrically:
- **WIP** = the *vertical* distance between the top of "Done" and the entry line at any moment (the thickness of the in-progress bands) — a band that's *widening* means WIP is growing.
- **Throughput** = the *slope* of the "Done" band — steeper is faster completion; a flattening Done line means delivery is stalling.
- **Approximate Flow Time** = the *horizontal* distance across the bands at a given level (how long the average item takes to cross from entry to done).

You read it for *trouble shapes*: a band that keeps thickening is a stage accumulating work — a forming **bottleneck**; flat bands with a steady-sloped Done line is a healthy, balanced system. The CFD turns the abstract law into a picture you can diagnose at a glance.

### Q5.4 — What is "aging WIP" and why is it more actionable than average cycle time?

> **Testing:** Whether you understand *leading* vs *lagging* flow signals.

**A.** **Aging WIP** is the *age of each item currently in progress* — how long it's been open *so far*, right now, before it's finished. Average cycle time is a **lagging** indicator: it tells you about items that already *completed*, so by the time a problem shows up in it, the damage is done. Aging WIP is a **leading** indicator: it shows in-flight items that are *getting old in real time*, while you can still act. An aging chart plots each open item's current age against your cycle-time percentiles, so an item that's already past the 85th percentile and *still not done* lights up as a risk *today* — you can swarm it, unblock it, or escalate before it becomes a multi-week tail event. The discipline shift is from "let's review last month's cycle time in retro" (autopsy) to "which open item is aging dangerously *now*" (intervention). Managing the work in flight beats analyzing the work that's already finished.

---

## Theme 6 — Scenario and Judgment

### Q6.1 — A feature took six weeks to deliver, but engineers say it was only about four days of actual work. Explain what happened and how you'd fix it.

> **Testing:** Whether you reach for flow efficiency and queues, or blame the engineers.

**A.** This is a **flow efficiency** problem, not a "slow engineers" problem. Four days of touch time inside six weeks of flow time is roughly **13% flow efficiency** — entirely normal, which tells you the other ~87% of the calendar was **wait time**, not work. The feature spent the time *in queues*: waiting in the backlog to be started, waiting in "ready for review," waiting for QA, waiting for a deploy window, waiting on a dependency or an answer. The fix targets the *waits*, not the work:
1. **Map the value stream** and timestamp each state transition to *locate where the weeks went* — almost always a specific queue or handoff dominates.
2. **Reduce WIP** so items don't sit behind each other (Little's Law: less WIP → shorter flow time).
3. **Attack the biggest queue** directly — if "waiting for review" is the killer, set review SLAs / WIP-limit the review column; if it's deploys, increase deploy frequency.

The reframe is everything: telling engineers to "work faster" would compress the four days, maybe saving a day; draining the queues attacks the six weeks. You don't have a *working*-speed problem, you have a *waiting* problem — and that's far better, because waits are structural and cheap to fix.

### Q6.2 — How would you find the bottleneck in your delivery pipeline?

> **Testing:** A concrete, data-driven method — not a guess.

**A.** I'd find the stage where **work piles up in front and starves behind** — the constraint shows itself as a queue. Concretely:
1. **Break flow time into per-stage times** (how long items sit in each workflow state). The stage with the largest *wait* time relative to its work time is the prime suspect.
2. **Look at a CFD** — the band that's *continuously widening* is the stage accumulating WIP; that's the bottleneck visualized.
3. **Check aging WIP per column** — items going stale concentrate *in front of* the constraint.
4. **Confirm with the starvation test** — the step *downstream* of the true bottleneck is often *idle/waiting* for input, which corroborates where the constraint is.

I'd be careful not to confuse *busy* with *bottleneck*: the constraint isn't necessarily where people feel most rushed — it's where *work waits longest*. Once identified, I apply the five focusing steps: exploit it (stop it idling, stop feeding it rework), subordinate the rest (WIP-limit upstream so it isn't flooded), *then* consider elevating it (add capacity). The whole method rests on measuring per-stage wait, because the bottleneck is defined by the queue it creates.

### Q6.3 — A stakeholder asks "should we add people to ship faster?" How do you answer?

> **Testing:** Whether you apply ToC and Little's Law instead of reflexively saying yes.

**A.** "It depends entirely on *where* the constraint is — adding people anywhere except the bottleneck won't make us faster, and may make us slower." I'd reason it out loud:
- **If the constraint is a specific stage** (say, code review or QA), adding *generalist developers* increases *upstream* output, which just **floods the bottleneck with more WIP** — by Little's Law that *lengthens* flow time. The right move is to add capacity *at the constraint* (more reviewers, more test automation) or exploit it first.
- **Adding people has its own cost**: onboarding load (often *on* the senior people who may *be* the constraint), more communication paths, and more concurrent WIP — Brooks's Law ("adding people to a late project makes it later") is the classic warning.
- **Cheaper levers usually come first**: reduce WIP, kill handoff delays, automate the constraint step — these often buy more speed than headcount, at no hiring cost.

So my answer is: *let's find the constraint first.* If it's genuinely a capacity limit *at the bottleneck* and we've already exploited and subordinated, then yes, add people *there* (ToC step 4, elevate). Otherwise, more people is motion, not throughput — and possibly negative throughput. I'd never answer "yes, hire" without identifying the constraint, because that's exactly the premature "elevate" that ToC warns against.

### Q6.4 — Two teams ask you to compare their velocities to decide who's performing better. What do you do?

> **Testing:** Whether you refuse an invalid comparison and redirect to flow.

**A.** I'd decline to compare their velocities directly, and explain why it's meaningless: **velocity (and story points) are team-relative and unitless** — each team calibrates points differently, so Team A's 40 and Team B's 25 aren't the same currency. Comparing them incentivizes **point inflation** (the team that estimates more generously "wins") and tells you nothing about value delivered. What I *would* look at, carefully and *not* as a leaderboard:
- **Flow Time** trends (are items getting to customers faster *over time within each team*?),
- **Flow efficiency** (how much waiting each team carries),
- **Throughput stability** and **Flow Distribution** (is one team drowning in defects/debt?),
- and ultimately **outcomes** — did the work move a business metric?

Even those I'd use as a *conversation starter per team over time*, never to rank teams against each other, because team context (codebase age, domain complexity, dependencies) dominates. The honest answer to "who's better" is "that's the wrong question — let's ask whether each team's *flow is improving and delivering outcomes*." Ranking teams by velocity is the canonical metrics anti-pattern; I'd steer the stakeholder away from it explicitly.

---

## Theme 7 — Pitfalls

### Q7.1 — How does velocity get gamed, and why is that easy?

> **Testing:** Whether you understand Goodhart's Law applied to points.

**A.** Velocity is trivially gamed because **the unit (story points) is defined by the people being measured.** If velocity becomes a target, the team simply **inflates estimates** — yesterday's 3-point story becomes a 5 — and velocity "rises" with zero change in delivered value. Other tactics: splitting work to count more items, padding to ensure the sprint commitment is always met, or counting near-done work as done. This is **Goodhart's Law** ("when a measure becomes a target, it ceases to be a good measure") in its purest form: because points are subjective and self-reported, there's no external anchor to prevent drift. The deeper problem is that velocity was *designed* as a team's internal *planning* aid — capacity calibration for *that team's* next sprint — and it works fine for that. It breaks the moment it's used as a *performance* metric or compared across teams, because then there's an incentive to move the number rather than the outcome. The defense is to never tie velocity to evaluation and to watch *flow time / outcomes* instead, which are harder to fake because they're anchored in real calendar time and real value.

### Q7.2 — Why is comparing flow metrics across teams dangerous, and what's the right unit of comparison?

> **Testing:** Whether you understand context-dependence and the correct baseline.

**A.** Cross-team comparison is dangerous because **flow numbers are dominated by context the metric doesn't capture**: codebase age and quality, domain complexity, regulatory load, dependency entanglement, team size and seniority. A team maintaining a 15-year-old monolith *will* have longer flow times than a greenfield team, and that says nothing about competence — punishing it for the number drives **gaming and demoralization**, and rewards teams who picked easy work. The correct unit of comparison is **a team against its own past** — *trend over time within the same team* — and against *outcomes*, not against other teams. "Is our flow time improving quarter over quarter, and is delivery moving business metrics?" is answerable and honest; "is Team A faster than Team B" conflates a dozen confounds. Metrics are a **mirror for a team to improve itself**, not a **yardstick to rank teams** — using them as the latter is the single most common way metrics programs turn toxic.

### Q7.3 — A team's flow efficiency suddenly jumped from 12% to 70%. The data shows shrinking "active time." What's your suspicion?

> **Testing:** Whether you can smell fudged/manipulated active-time data.

**A.** My first suspicion is **measurement gaming, not a real improvement** — specifically, **fudged active time**. Flow efficiency = active ÷ flow time, so it spikes if *active time* is being *under-recorded* (or flow time inflated). A jump from 12% to 70% — far above the realistic 5–40% range — is a red flag that someone changed *how active time is logged*: e.g., only counting "pure coding" and excluding investigation, meetings, and context-switching, or starting the clock late and stopping it early, or manually setting statuses to look efficient. Real flow-efficiency gains come from *draining queues* (which shows up as **shorter flow time**), not from *active time shrinking* while flow time holds. So I'd check: did *flow time* actually drop (real) or is only the *active* component falling (suspect)? Did the *definition* or *tooling* for "active" change at the same moment? Self-reported active time is the softest input in flow metrics — it's an estimate of an estimate — which is exactly why I trust *flow time* (anchored in objective state-change timestamps) over *flow efficiency* when they disagree. A too-good number that came from the fuzziest input is almost always an artifact.

### Q7.4 — What's the general principle behind all these gaming pitfalls, and how do you defend against it?

> **Testing:** Whether you can generalize beyond individual tricks.

**A.** The general principle is **Goodhart's Law**: any metric tied to incentives or evaluation will be optimized *directly* — people move the *number* instead of the *thing the number was supposed to represent*. The softer and more self-reported the metric (story points, manually-logged active time), the easier it is to move without doing real work. Defenses:
1. **Use metrics for learning, not judgment** — flow metrics are for a team to *diagnose and improve itself*, never an input to performance reviews or stack-ranking. The instant they're evaluative, they're gamed.
2. **Prefer objective, timestamp-anchored signals** (flow time from real state changes) over subjective ones (points, self-logged active time).
3. **Look at metrics in *sets* and against *outcomes*** — gaming one metric usually distorts another (inflating velocity doesn't improve flow time or move a business KPI), so a balanced set with an outcome anchor resists single-number manipulation.
4. **Watch trends within a team, never rank across teams** — removing the competitive frame removes most of the incentive to cheat.

The throughline: metrics are a *mirror*, and the moment you turn the mirror into a *target with consequences*, you've created the incentive to fake the reflection. Keep them diagnostic and tied to real customer value, and the gaming pressure largely evaporates.

---

## Rapid-Fire Round

> Short questions to check breadth. One or two sentences each.

- **Q: Flow time vs touch time?** A: Flow time is total elapsed wall-clock time including waiting; touch time is hands-on-keyboard active work — and the gap between them is mostly queue.
- **Q: Little's Law in one line?** A: WIP = Throughput × Flow Time — so Flow Time = WIP ÷ Throughput.
- **Q: Why do WIP limits reduce flow time?** A: With throughput roughly fixed, flow time is proportional to WIP, so cutting WIP cuts flow time — no one works faster.
- **Q: Typical flow efficiency in knowledge work?** A: 5–15%; 25–40% is excellent. Near-100% is a fantasy.
- **Q: The five Flow Framework metrics?** A: Velocity, Time, Efficiency, Load (WIP), Distribution.
- **Q: Which flow metric protects tech debt?** A: Flow Distribution — it reserves an explicit, measured share of capacity for debt.
- **Q: What governs system throughput per ToC?** A: The single biggest constraint (bottleneck); nothing else.
- **Q: Why optimize the bottleneck, not the busy step?** A: Gains anywhere but the constraint don't raise system throughput — they just grow WIP in front of it.
- **Q: Order of the five focusing steps?** A: Identify, Exploit, Subordinate, Elevate, Repeat — exploit (free) before elevate (expensive).
- **Q: Forecast with average or percentiles?** A: Percentiles — cycle-time distributions are right-skewed, so the average is a number you rarely hit.
- **Q: What is Monte Carlo forecasting?** A: Sampling from historical cycle-time/throughput data thousands of times to produce a *probability* of finishing by a date.
- **Q: What does a widening band on a CFD mean?** A: A stage is accumulating WIP — a forming bottleneck.
- **Q: Leading vs lagging flow signal?** A: Aging WIP (in-flight items getting old now) is leading; average cycle time (completed items) is lagging.
- **Q: Why not compare two teams' velocities?** A: Points are team-relative and unitless; comparison just rewards inflation and ignores context.
- **Q: What happens to wait time as utilization nears 100%?** A: It rises non-linearly toward infinity — full utilization means maximum congestion, not maximum efficiency.

---

## Red Flags and Green Flags

> What interviewers infer from *how* you answer, not just whether you're right.

**Red flags:**
- Explaining a long flow time as "the engineers are slow" — missing the work-vs-wait distinction.
- Stating Little's Law wrong, or treating its *average* output as a per-item commitment.
- Wanting to optimize the busiest step instead of the *constraint*.
- Forecasting or committing with an *average* cycle time.
- Comparing teams by velocity, or treating velocity as a productivity metric.
- Answering "should we hire?" with "yes" before locating the bottleneck.
- Claiming a flow-efficiency jump is real when only *active time* shrank.

**Green flags:**
- Naming the *distinction* (work/wait, flow/activity, constraint/non-constraint, distribution/average) before reaching for a metric.
- Reasoning *from* Little's Law ("throughput's fixed, so flow time ∝ WIP") rather than reciting it.
- Reaching for the *constraint* and the five focusing steps, in order (exploit before elevate).
- Forecasting with percentiles / Monte Carlo and expressing uncertainty as a probability.
- Trusting timestamp-anchored flow time over self-reported active time when they conflict.
- Treating metrics as a *mirror for a team*, never a *yardstick across teams* — and invoking Goodhart unprompted.

---

## Summary

- The bank reduces to four distinctions, repeated in costumes: **work vs wait**, **flow vs activity**, **the constraint vs everything else**, **distribution vs average**. Name the distinction first; the metric follows.
- **Value stream & flow basics:** the stream runs idea → validated-in-production, not first-commit → merge. **Flow time** (elapsed, including queues) ≫ **touch time** (active work); knowledge work is **5–15% flow-efficient**, so the time — and the leverage — is in the *waits*.
- **The Flow Framework:** Velocity, Time, Efficiency, Load, Distribution — read as a *set*. **Distribution** is the debt metric because it reserves explicit capacity that debt otherwise never wins.
- **Little's Law** (WIP = Throughput × Flow Time) is a conservation law: with throughput fixed, **flow time ∝ WIP**, so cutting WIP cuts flow time without working faster — and utilization near 100% sends wait time toward infinity.
- **Theory of Constraints:** the bottleneck governs system throughput; optimizing non-constraints is waste that just grows WIP. Apply the **five focusing steps** in order — *exploit and subordinate (free) before elevate (expensive)* — and WIP limits are how you subordinate.
- **Forecasting:** use historical cycle-time distributions + **Monte Carlo**, commit at **percentiles** (85th/95th) not averages, read **CFDs** for WIP/throughput/flow-time at a glance, and manage **aging WIP** (leading) over average cycle time (lagging).
- **Pitfalls:** velocity is gamed via point inflation (Goodhart); cross-team comparison is dominated by context; fudged active time fakes flow efficiency. Defense: metrics as a *learning mirror*, anchored in objective timestamps and outcomes — never an evaluative yardstick.

---

## Further Reading

- *Project to Product* — Mik Kersten. The Flow Framework and the five flow metrics (velocity, time, efficiency, load, distribution) in full.
- *The Goal* — Eliyahu Goldratt. The Theory of Constraints and the five focusing steps, as a novel.
- *Actionable Agile Metrics for Predictability* — Daniel Vacanti. Cycle-time distributions, CFDs, aging WIP, and Monte Carlo forecasting.
- *Principles of Product Development Flow* — Donald Reinertsen. The economics of queues, WIP, and why utilization kills flow time.
- The [junior](junior.md), [middle](middle.md), [senior](senior.md), and [professional](professional.md) pages of this topic — every answer here is grounded in those.

---

## Related Topics

- [04 — Lead Time and Cycle Time](../04-lead-time-and-cycle-time/interview.md) — the precise time definitions and percentile forecasting these flow answers build on.
- [01 — DORA Four Key Metrics](../01-dora-four-key-metrics/interview.md) — how lead time for changes and the other DORA metrics relate to flow.
- [Engineering Metrics & DORA README](../README.md) — where flow metrics sit in the broader measurement landscape.
