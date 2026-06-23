# Lead Time & Cycle Time — Senior Level

> **Roadmap:** [Engineering Metrics & DORA](../README.md) → Lead Time & Cycle Time
> *The professional page taught you to decompose the pipeline and shave the wait states. This page is about the thing decomposition alone can't give you: cycle time is a **probability distribution**, not a number — and once you treat it as one, you can stop guessing dates. You forecast them, with a confidence interval, from data you already have.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Cycle Time Is a Distribution, Not a Number](#cycle-time-is-a-distribution-not-a-number)
4. [The Cycle-Time Scatterplot — Your Core Analytic](#the-cycle-time-scatterplot--your-core-analytic)
5. [Service-Level Expectations Instead of Estimates](#service-level-expectations-instead-of-estimates)
6. [Probabilistic Forecasting with Monte Carlo](#probabilistic-forecasting-with-monte-carlo)
7. [The Queueing Causes — Little's Law, WIP, and Utilization](#the-queueing-causes--littles-law-wip-and-utilization)
8. [Batch Size — The Other Multiplier](#batch-size--the-other-multiplier)
9. [Aging WIP and Flow Debt — The Leading Indicator](#aging-wip-and-flow-debt--the-leading-indicator)
10. [Control Charts and Special-Cause Variation](#control-charts-and-special-cause-variation)
11. [Lead Time Across a Multi-Team Value Stream](#lead-time-across-a-multi-team-value-stream)
12. [Mental Models](#mental-models)
13. [Common Mistakes](#common-mistakes)
14. [Test Yourself](#test-yourself)
15. [Cheat Sheet](#cheat-sheet)
16. [Summary](#summary)
17. [Further Reading](#further-reading)
18. [Related Topics](#related-topics)

---

## Introduction

> Focus: **The statistics of cycle time — and using them to forecast delivery and diagnose the queueing that makes lead time long.**

By the professional level you can draw the value stream, split coding / pickup / review / CI / deploy / wait, and attack whichever stage dominates. That makes you effective at *reducing* lead time. The senior jump is to treat the metric the way the data actually behaves: as a **right-skewed, heavy-tailed random variable**. The moment you do, three things change.

First, you stop reporting the mean — because the mean of a heavy-tailed distribution is unstable, dominated by the tail, and a number almost no item actually experiences. You report **percentiles** and the **shape**.

Second, you stop estimating dates by summing story points and start **forecasting** them — running a Monte Carlo simulation over your own historical cycle times or throughput to answer "when will these 30 items be done?" with a *probability distribution* of completion dates, not a single optimistic guess.

Third, you stop treating long lead time as a mystery and recognise it as **queueing physics**. Little's Law and the utilization curve are not metaphors here; they are the mechanism. High WIP, high utilization, and large batch sizes inflate cycle time *deterministically*, the same hockey-stick that governs a CPU run queue or an M/M/1 server. This page is the quantitative layer underneath everything the earlier tiers taught you to *do*.

---

## Prerequisites

- **Required:** You've internalised [professional.md](professional.md) — pipeline decomposition, the work-state model (active vs wait), and the start-of-clock definitions.
- **Required:** Flow basics from [Flow Metrics & Value Stream](../02-flow-metrics-and-value-stream/senior.md) — WIP, throughput, flow efficiency, and the value-stream view.
- **Required:** Comfort with the DORA framing of [lead time for changes](../01-dora-four-key-metrics/senior.md) as one engineered slice of the larger lead time.
- **Helpful:** A working intuition for distributions — median vs mean, percentiles, "right-skewed," and why an average can lie.
- **Helpful:** Having once promised a date by adding up estimates and watched reality laugh.

---

## Cycle Time Is a Distribution, Not a Number

Pull the cycle times of the last 200 completed items and plot a histogram. You will not get a bell curve. You get a **right-skewed, heavy-tailed** shape: a tall cluster of fast items near the left, a long thin tail of slow items stretching far to the right, and nothing below zero (cycle time is bounded at zero — time can't be negative). This shape is not an accident of your team; it is the near-universal signature of knowledge-work cycle time, observed across thousands of teams in the flow literature. It is approximately **log-normal** (or Weibull-ish) — the kind of distribution you get when delays *multiply* rather than add, and when a small fraction of items hit a blocking dependency, a rework loop, or a long queue.

The heavy tail has a brutal consequence: **the mean is misleading and unstable.**

- **It's not representative.** In a right-skewed distribution the mean sits well above the median, pulled up by the tail. A "mean cycle time of 9 days" can describe a system where *most* items finish in 4 days and a handful take 40. No typical item experiences 9 days; the mean is a number nobody lives.
- **It's unstable.** Because the tail dominates the mean, a single 60-day outlier can swing the monthly average dramatically. Track mean cycle time week over week and you'll see it jump around for reasons that have nothing to do with the system changing — you're watching tail noise, not signal.
- **It hides the thing you care about.** The risk in delivery lives in the *tail*. Averaging deletes exactly the information — "how bad does it get, and how often?" — that you need to make a commitment.

So senior practice abandons the mean and reports the **distribution** through its percentiles:

| Statistic | What it tells you | Use it for |
|---|---|---|
| **Median (p50)** | The typical item — half finish faster, half slower | "How fast are we, normally?" |
| **p85** | 85% of items finish within this | The default service-level expectation |
| **p95** | 95% finish within this — the near-worst case | Risk planning, dependency promises |
| **p99 / max** | The tail's reach | Understanding how bad an outlier can be |
| **Spread (p85 − p50)** | Predictability | A wide gap means low confidence even if the median is good |

> **Key insight:** A team with a 3-day median and a 5-day p85 is *more useful* than a team with a 2-day median and a 30-day p85, even though the second is "faster on average." Delivery is a promises business, and you can only promise against the **percentiles** — predictability (a tight distribution) beats raw speed (a low median with a fat tail). Report the shape, never a lone average.

A practical tell: if anyone hands you a single cycle-time number with no percentile attached, they have thrown away the distribution and you cannot reason about risk from it. Ask "p50 or p85?" every single time.

---

## The Cycle-Time Scatterplot — Your Core Analytic

The single most important chart in this entire topic is the **cycle-time scatterplot**. Build it once and most of the other questions answer themselves.

- **X axis:** completion date (when each item finished).
- **Y axis:** that item's cycle time in days.
- **One dot per completed item.**
- **Horizontal lines** drawn at the p50, p85, and p95 of the historical data.

```
cycle
time   95p ──────────────────────────────────────  (e.g. 21 days)
(days)              •
        •                      •
       85p ─────•──────────────────────────•─────   (e.g. 9 days)
            •        •     •         •
       50p ──•───•──────•────•───•──────•──•─────    (e.g. 4 days)
          • •  •    • •   •  •  •    • •  •   •  •
          └────────────────────────────────────►  completion date
```

What you read off it:

- **The percentile lines *are* your service-level expectations.** The p85 line says, literally and visually, "historically 85% of our items finished at or below this." That is a forecast you can quote for a single item with no estimation at all (see the next section).
- **Dots above the p95 line are your tail** — the items worth investigating. Each one is a story: what blocked it, which dependency, which rework loop. Outliers on a scatterplot are *individually inspectable*, unlike a mean, which dissolves them.
- **Trend over time is visible.** Are the dots drifting up (cycle time degrading) or down (improving)? Are the percentile lines moving? You see the *direction* of the system, not a single snapshot.
- **Clusters and patterns jump out.** A vertical stack of dots on one date = a batch released together (a batch-size smell). A widening band over time = growing unpredictability. A sudden run of high dots = a special cause (a reorg, a freeze, a key person leaving).

The scatterplot is superior to a cycle-time *line chart of the average* for the same reason the distribution beats the mean: it preserves every data point, so the tail and the outliers — the information you actually need — survive. A line chart of weekly mean cycle time is the chart to delete; the scatterplot is the chart to live in.

> **Key insight:** The scatterplot turns "estimate this item" into "look up the p85 line." You are not predicting from the *content* of the work (which you understand poorly until you've done it); you are predicting from the *behaviour of your system* (which the last 100 items measured precisely). For most items, the system's percentile is a better forecast than a human's point estimate — and it costs zero estimation effort.

---

## Service-Level Expectations Instead of Estimates

A **Service-Level Expectation (SLE)** is a forecast of how long a single item should take, expressed as a percentile-and-range pulled directly from the scatterplot:

> *"85% of our work items finish within **9 days** of being started."*

That sentence is doing real work. It is:

- **Probabilistic, not absolute.** It says 85%, not 100%. It bakes in the reality that some items will take longer — and tells you *how often* (15% of the time). Compare to "this will take a week," which is a point estimate that's silently a coin flip.
- **Derived from data, not opinion.** It's the p85 of your history. It updates automatically as the system changes. Nobody has to "estimate" anything.
- **Actionable as a commitment.** You can offer an SLE to a stakeholder honestly: "we expect to deliver within 9 days, with ~85% confidence; if it crosses 9 days we'll flag it as at-risk." That last clause is the operational payoff — the SLE *becomes the trigger* for the aging-WIP alarm (covered below).

Choosing the percentile is a risk decision, not a statistical one. p50 is a coin flip (use it only for internal pacing). p85 is the common default — confident but not paranoid. p95 is for promises with real consequences (a dependency another team is planning against, a customer-facing date). The higher the cost of being late, the higher the percentile you quote.

The deeper shift: SLEs replace **per-item estimation** for the large majority of work. Estimation is expensive (it consumes engineering time in planning poker), inaccurate (humans are notoriously bad at absolute duration estimates), and corrosive (estimates become deadlines become pressure become quality erosion). For *typical* items drawn from a stable system, the SLE is both cheaper and more accurate, because it measures the system rather than guessing the task. You still break work down — small items are good for flow regardless — but you stop turning the breakdown into hours.

> **Key insight:** "How long will this take?" has two answers. The estimation answer studies the *work* and is usually wrong. The flow answer studies the *system* — "items like this finish within N days 85% of the time" — and is usually closer, for free. Senior teams default to the second and reserve estimation for genuine outliers (the large, novel, or risky item the system hasn't seen before).

---

## Probabilistic Forecasting with Monte Carlo

The SLE forecasts *one* item. The harder, more valuable question is the multi-item one every roadmap meeting actually asks:

> *"When will these **30 items** be done?"* (a scope question), or
> *"How many items will we finish by **the end of the quarter**?"* (a date question).

The traditional answer sums story points and divides by velocity — and is wrong with depressing reliability, because it (a) treats estimates as accurate, (b) ignores variability entirely, and (c) produces a single date with false precision. The flow answer is **Monte Carlo simulation**, and it needs no estimates at all — only your historical throughput or cycle-time data.

The method, for the "when will 30 items be done?" question, is almost embarrassingly simple:

1. Take your historical **throughput** — items completed per day (or per week) — over a representative recent window (say the last 8–12 weeks).
2. Simulate one possible future: for each future day, randomly **draw a throughput value from the history** (sample with replacement), subtract it from the remaining scope, and count days until you've burned down all 30 items.
3. **Repeat 10,000 times.** Each run gives one possible completion date; the random sampling means each run plays out differently.
4. The 10,000 results form a **distribution of completion dates**. Read the percentiles off it.

```
"When will 30 items be done?"  —  10,000 Monte Carlo runs

  number of
  simulations
      │            ████
      │          ████████
      │        ████████████
      │      ████████████████
      │    ████████████████████████
      └───────┬──────┬──────┬───────►  completion date
            day 24  day 31  day 40
             (50%)   (85%)   (95%)
```

The output is the thing leadership actually needs:

- *"50% chance by day 24, 85% chance by day 31, 95% chance by day 40."*

That is an honest forecast with quantified uncertainty. You commit at the confidence level the situation demands — quote day 31 (85%) for a normal plan, day 40 (95%) when missing is costly — instead of pretending a single date is a fact.

The same engine runs the inverse, date-bounded question by sampling throughput forward to a fixed date across 10,000 runs and reading the distribution of *how many items got done*: "85% confident we'll finish at least 22 of the 30." It also handles scope growth (model new work arriving as a rate) and split rates (some items split into more during the work).

**Why this dominates story-point estimation:**

| | Story-point estimation | Monte Carlo forecast |
|---|---|---|
| Input | Human estimates per item | Historical throughput (already collected) |
| Variability | Ignored — single velocity number | Modelled directly — uses the full spread |
| Output | One date (false precision) | Distribution of dates with confidence levels |
| Effort | Hours of planning poker | Seconds of computation |
| Accuracy | Anchored to estimation bias | Anchored to measured reality |
| Updates | Re-estimate manually | Re-run on fresh data |

This is the core of Daniel Vacanti's *Actionable Agile Metrics for Predictability* and connects directly to Don Reinertsen's economic framing of flow: forecasting from system behaviour, with explicit uncertainty, instead of from estimates, with false certainty.

> **Key insight:** Monte Carlo doesn't make the future certain — it makes the **uncertainty explicit and quantified**. The deliverable of forecasting is not a date; it's a *probability distribution of dates*. A forecast without a confidence level is just a wish, and a single-date commitment is a 50/50 bet dressed up as a plan. Two preconditions matter: a reasonably **stable system** (the past must resemble the near future — a reorg invalidates the history) and **small, similarly-sized items** (so item count is a sane unit; one ten-month epic among thirty two-day stories breaks the model).

---

## The Queueing Causes — Little's Law, WIP, and Utilization

Why is lead time long in the first place? Not, usually, because the work is hard. Because it **waits in queues** — and queueing behaviour is governed by laws, not luck. This is where the flow metrics stop being descriptive and start being *predictive physics*.

**Little's Law** states, for a stable system:

```
                    average WIP (items in progress)
average Cycle Time = ───────────────────────────────
                    average Throughput (items / time)
```

Rearranged, it is the most actionable equation in flow: **for fixed throughput, cycle time is directly proportional to WIP.** Double the number of items in progress and you double the average time each one takes — *without doing anything else wrong*. The work isn't slower; it just spends twice as long waiting behind the other in-progress work. This is the quantitative justification for WIP limits: limiting WIP is, by Little's Law, the most direct lever on cycle time you have. (Caveats: the law assumes a stable system over the measurement window — arrivals ≈ departures, consistent definitions of "in progress" and "done." It's an *average* relationship, not a per-item guarantee. Honour those and it holds for any process, from a kanban board to a coffee shop.)

**Utilization** is the second law, and the more counter-intuitive one. The same hockey-stick curve you met for CPU run queues and M/M/1 servers governs people doing knowledge work. As a resource's utilization ρ approaches 100%, the queue length — and therefore the wait time — does not rise linearly; it **explodes hyperbolically**:

```
                 ρ
wait time  ∝  ───────         (the M/M/1 relationship; ρ = utilization, 0–1)
               1 − ρ

  wait
  time │                                    ╱
       │                                  ╱  ← lead time explodes
       │                               ╱
       │                          ╱
       │                  ╱
       │        ╱
       │ ─────
       └──────────────────────────────────►  utilization ρ
       0%        50%       70%   85%  95% 100%
```

Plug in numbers and the curve is visceral. At ρ = 0.5, the queue-driven wait multiplier is `0.5 / 0.5 = 1`. At ρ = 0.8 it's `0.8 / 0.2 = 4`. At ρ = 0.9 it's `0.9 / 0.1 = 9`. At ρ = 0.95 it's `0.95 / 0.05 = 19`. **Going from 90% to 95% busy roughly doubles the wait again.** The last few percent of utilization are catastrophically expensive in queueing time.

This is the quantitative refutation of "keep everyone 100% busy." A team driven to full utilization has, by the curve, an *exploding* lead time — every new item lands behind a maximal queue. The slack that managers instinctively want to eliminate is precisely what keeps the queue (and thus cycle time) finite. **Idle time on a person is not waste; it's the buffer that absorbs variability and keeps flow time low.** The waste is idle *work* (items sitting in queues), not idle *workers*.

> **Key insight:** High WIP and high utilization inflate cycle time through the *same* mechanism — queueing — and both follow laws, not vibes. Little's Law makes WIP a *linear* multiplier on cycle time; the utilization curve makes the last 10% of "busy" a *hyperbolic* one. This is why the highest-leverage lead-time intervention is almost always "lower WIP and stop maximising utilization," not "work harder." You are not fighting effort; you are draining queues.

---

## Batch Size — The Other Multiplier

Beyond WIP and utilization, **batch size** is the third queueing multiplier — and the one teams most often inflate without noticing. Reinertsen's *Principles of Product Development Flow* treats batch-size reduction as one of the highest-leverage moves in all of flow economics, and the mechanism is direct.

A large batch — a 2,000-line pull request, a quarterly "big bang" release, a feature held back until everything is "complete" — hurts cycle time several ways at once:

- **It inflates the cycle time of everything in the batch.** The first finished item in a batch can't ship until the *last* one is done; it sits and ages while its batch-mates catch up. Bundle ten changes into one release and the earliest change waits for the slowest. Small batches let fast items leave immediately.
- **It enlarges the queue downstream.** A 2,000-line PR is a single huge item in the review queue; it blocks the reviewer for hours and stalls everything behind it. Ten 200-line PRs flow through review in parallelizable, interruptible chunks.
- **It magnifies risk and rework — non-linearly.** A big batch fails review or integration as a unit; one problem rejects the whole thing, and the feedback arrives late, after far more work was built on the flawed foundation. Small batches fail small and fail early, so the rework loop (a major tail-inflating cause) is short.
- **It couples unrelated work.** Ten changes in one deploy means one bad change can block or roll back the other nine — and when something breaks, you have ten suspects, lengthening time-to-restore too.

The economic tension is real: large batches *feel* efficient because they amortise fixed transaction costs (the overhead of a review, a deploy, a test run). The senior move is to recognise that the answer to "large batches reduce per-batch overhead" is **reduce the overhead, not enlarge the batch** — automate the deploy, speed the CI, streamline review — so small batches become cheap. Cheap transactions enable small batches, and small batches are what keep cycle time low and predictable. This is the direct line from batch-size economics back to [DORA's deployment-frequency key](../01-dora-four-key-metrics/senior.md): elite teams deploy small and often *because* small batches flow faster and fail safer, and frequent deployment is simply small batch size made visible.

> **Key insight:** Batch size is a hidden multiplier on cycle time. Halving your PR size, your release size, and your story size compresses the distribution *and* shortens its tail, because the dominant tail-inflators — long review queues and late, large rework loops — both scale with batch size. When a team's cycle time is fat and unpredictable, look at batch size before you look at effort.

---

## Aging WIP and Flow Debt — The Leading Indicator

Everything so far measured *completed* work — the scatterplot, the percentiles, the SLE, the Monte Carlo history. All of it is **lagging**: it tells you how items did *after* they finished, which is too late to help the items in trouble *right now*. The senior shift to managing flow in real time is to watch **aging work in progress** — and it is the single most important leading indicator in this entire topic.

**Aging WIP** is, for every item *currently in progress*, the time elapsed since it was started — its cycle time *so far*, before it's done. Plot it against your SLE percentile lines (the **aging WIP chart** — the same Y axis as the scatterplot, but for unfinished items, positioned by current age):

```
age      95p ──────────────────────────────────────  (21d)
(days)
                        ◆ "Payments API" — 18d, alarm
         85p ───────────────────────────────────────  (9d)
                ◆ 11d, past SLE — at risk
         50p ──────────────────────────────────────   (4d)
           ◆ 3d   ◆ 5d
           └────────────────────────────────────────►
            (items currently in progress, by age)
```

The diagnostic power is that **an item crossing its SLE percentile is in trouble *while you can still act*.** An item that's already at 11 days when your p85 is 9 days is *telling you now*, mid-flight, that it's headed for the tail — long before it shows up as an ugly dot on the completed scatterplot. The lagging average will only confirm the bad news weeks later, after the damage is done and baked into the history. Aging WIP is the smoke alarm; the scatterplot is the post-fire report.

This reframes the daily-flow conversation completely. Instead of "what did you do yesterday?" (status theatre), the question becomes **"which in-progress items are aging past their SLE, and what's blocking them?"** — a conversation about *finishing what's started* rather than starting more. The oldest in-progress items get attention first, because age, not newness, predicts the tail.

**Flow debt** is the related pathology: the practice of making the *finished* numbers look good by *not finishing* the items that would look bad. If you let your hardest items sit in progress indefinitely — never completing them — your cycle-time scatterplot (which only plots completions) looks great, while a growing pile of ancient, aging work hides off the chart. You've borrowed against the future: the day those items finally complete, they land as a cluster of enormous tail dots, and the debt comes due all at once. Flow debt is why you cannot trust a completion-only metric in isolation; you must watch aging WIP *alongside* it to catch the work that's being quietly stranded to flatter the average.

> **Key insight:** Manage the *aging of in-progress work*, not the *average of finished work*. The average is a lagging confirmation of problems that have already happened; aging WIP against the SLE is a leading indicator you can still act on — and it's the only thing that catches flow debt, where good-looking completed numbers are propped up by hard items left deliberately unfinished. Senior flow management is fundamentally about *finishing the oldest thing*, not starting the newest.

---

## Control Charts and Special-Cause Variation

The scatterplot is, in spirit, a **control chart** for cycle time, and naming it that unlocks a precise statistical question: is a given data point part of the system's *normal* variation, or is it a *signal* that something specific changed?

Statistical process control (SPC) distinguishes two kinds of variation, and the distinction governs how you should respond:

- **Common-cause variation** is the inherent, expected scatter of a stable system — the everyday spread of dots between p50 and p95. It's *noise*. The correct response to a single common-cause point is **do nothing about that point**; if you want to improve, you change the *system* (lower WIP, shrink batches, fix the review bottleneck), which shifts the whole distribution. Reacting to individual common-cause points ("why did *this* item take 6 days?!") is the classic management error Deming called *tampering* — it adds variation, it doesn't remove it.
- **Special-cause variation** is a signal — a point or pattern that the stable system *would not* produce on its own. The correct response is to **investigate that specific cause**, because something identifiable happened.

The practical tells for special cause on a cycle-time scatterplot:

- A point **far beyond p95** — well outside the normal band — usually has a specific story (a blocking dependency, a production incident pulling the assignee away, a person leaving mid-task). Worth a root-cause look.
- A **run** — several consecutive points all above (or all below) the median — signals a sustained shift, not random scatter. A run of high dots after a reorg, a hiring freeze, or a new approval gate is the system *changing*, not noise.
- A sudden **widening of the band** (the percentile lines spreading apart over time) signals growing instability — the system is becoming less predictable, which directly degrades every forecast you make from it.

The senior skill is the *triage*: deciding whether a number deserves a reaction at all. Most teams over-react to common-cause noise (chasing every slow item, which is tampering) and under-react to special-cause signals (ignoring a clear upward run because "metrics are always noisy"). Inverting that — leave the noise alone, hunt the signals — is what separates using a metric to *understand a system* from using it to *flog individuals over normal variation*.

> **Key insight:** Before reacting to any cycle-time number, classify it. Common cause = noise = change the *system*, not the item. Special cause = signal = investigate the *specific* event. Reacting to common-cause variation as if it were special (tampering) actively makes the system *worse* — and it's the single most common way managers misuse this metric. The whole purpose of the control-chart lens is to keep you from mistaking noise for signal in *either* direction.

---

## Lead Time Across a Multi-Team Value Stream

Everything to this point measured one team's flow. Real delivery in a large org crosses **multiple teams and services**, and the most important fact about end-to-end lead time at that scale is brutally simple: **the handoff queues dominate everything.**

When a single piece of customer value flows API → mobile → backend → platform → ops, the *active work* in each team is often a small fraction of the total elapsed time. The clock is consumed by the **wait between teams** — the request sitting in another team's backlog until they pick it up, the dependency parked behind their current sprint, the change waiting on a separate team's release train. The flow-efficiency number (active time ÷ total time) that already looked bad for one team collapses across handoffs: a cross-team value stream commonly runs at *single-digit* flow efficiency, meaning 90%+ of lead time is pure waiting in inter-team queues.

This has direct quantitative consequences:

- **Optimising one team is nearly useless if the bottleneck is a handoff queue.** This is the Theory-of-Constraints point made concrete: shaving a team's internal cycle time from 5 days to 3 saves 2 days against a 40-day end-to-end lead time that is mostly inter-team wait. You must find and attack the dominant *queue*, which is almost always at a boundary, not inside a team. Local optimisation of a non-bottleneck moves the global number not at all.
- **Each handoff is a queue with its own utilization curve.** If the receiving team runs near 100% utilization (the common case), the requesting team's work lands behind a maximal, hyperbolically-inflated queue — the utilization explosion compounds at *every* boundary. End-to-end lead time is dominated by whichever boundary queue is worst.
- **Little's Law applies to the whole stream.** End-to-end cycle time = total in-flight WIP across all teams ÷ end-to-end throughput. The cross-team WIP — every request in flight anywhere in the value stream — is usually invisible to any single team and enormous in aggregate, which by Little's Law guarantees a long end-to-end cycle time regardless of how fast any individual team is.

The senior move is **value-stream-level measurement and a value-stream owner.** You instrument the whole flow (each handoff timestamped, so the inter-team queues become visible), measure the *boundaries* as first-class wait states, and give someone accountability for the *end-to-end* number rather than each team's local one. The structural fixes target the handoffs: reduce them (fewer teams in the path — Conway's Law in reverse: reshape teams around the value stream so a stream lives mostly inside one team), make cross-team requests pull-based with explicit WIP limits, or eliminate the dependency entirely (give the requesting team what they need to self-serve). This is the bridge to [DORA's lead-time-for-changes](../01-dora-four-key-metrics/senior.md): DORA measures one engineered slice (commit → production) precisely *because* it's controllable within a team's deployment pipeline; the larger idea-to-customer lead time is dominated by exactly these cross-team queues, which is why it's both far longer and far harder to move.

> **Key insight:** Across a multi-team value stream, handoff queues — not active work — own the lead time. Flow efficiency collapses at boundaries, the utilization explosion compounds at each one, and aggregate cross-team WIP guarantees a long end-to-end cycle time by Little's Law. Optimising inside one team is local optimisation; the leverage is at the boundaries. Measure the *stream*, own the *stream*, and attack the *queues between teams* — that is where the months hide.

---

## Mental Models

- **Cycle time is a distribution; the mean is a lie the tail tells.** Always think in percentiles (p50/p85/p95) and shape. Any single cycle-time number without a percentile attached has thrown away the only information you needed to reason about risk.

- **Predict from the system, not from the work.** The scatterplot's p85 line forecasts a single item better, and for free, than a human studying the task — because the system's last 100 items measured precisely what the human is guessing.

- **The deliverable of forecasting is a probability distribution of dates, not a date.** Monte Carlo over your throughput history answers "when will these be done?" with confidence levels. A single-date commitment is a 50/50 bet wearing a suit.

- **Long lead time is queueing physics, not effort.** Little's Law makes WIP a *linear* multiplier on cycle time; the utilization curve makes the last 10% of "busy" a *hyperbolic* one; batch size is a third multiplier. The fix is draining queues, not working harder.

- **Slack is the buffer, not the waste.** Idle *workers* keep queues finite; idle *work* (items waiting) is the real waste. Driving utilization to 100% explodes lead time by the M/M/1 curve.

- **Manage the aging of the unfinished, not the average of the finished.** Aging WIP against the SLE is the leading indicator you can still act on; the completed-item average is a lagging confirmation — and the only way to catch flow debt.

- **Classify before you react.** Common-cause noise → change the system, never the item (reacting is tampering, which makes things worse). Special-cause signal → investigate the specific event. Most metric misuse is confusing the two.

- **Across teams, the queues between them own the clock.** Handoffs, not active work, dominate end-to-end lead time. Optimise the stream and its boundaries, not the individual team.

---

## Common Mistakes

1. **Reporting mean cycle time.** The mean of a right-skewed distribution is unstable (a single outlier swings it) and unrepresentative (no typical item experiences it). Report p50/p85/p95 and the shape; treat any unlabelled cycle-time average as having discarded the distribution.

2. **Estimating dates by summing story points / velocity.** This ignores variability and produces false single-date precision. Run a **Monte Carlo** over historical throughput and quote completion *probabilities* (50%/85%/95%) instead.

3. **Quoting a forecast with no confidence level.** "Done by the 20th" is meaningless without "with X% confidence." A date without a probability is a wish; pick the percentile by the cost of being late.

4. **Driving toward 100% utilization to "maximise productivity."** The M/M/1 curve means the last few percent of busy explode the queue — wait at ρ=0.95 is ~19× the service-time multiplier, double that at ρ=0.9. High utilization *inflates* lead time. Idle worker time is the buffer that keeps flow fast.

5. **Letting WIP creep up.** By Little's Law, cycle time is directly proportional to WIP at fixed throughput — double the in-progress items and you double everyone's cycle time, having "done" nothing wrong. WIP limits are the most direct lever on cycle time.

6. **Reacting to common-cause variation (tampering).** Chasing every individual slow item as if it were special *adds* variation. If a point is within the normal band, change the system, not the item. Reserve investigation for points beyond p95 and for runs.

7. **Trusting a completion-only metric without watching aging WIP.** A great-looking scatterplot can hide **flow debt** — hard items left deliberately unfinished to flatter the average. Watch aging WIP alongside completions, and finish the oldest thing first.

8. **Optimising one team when the bottleneck is a handoff queue.** Across a value stream, inter-team wait dominates lead time. Shaving a non-bottleneck team's internal cycle time barely moves the end-to-end number. Find and drain the boundary queue.

9. **Forecasting from an unstable system or with wildly uneven item sizes.** Monte Carlo assumes the past resembles the near future (a reorg invalidates the history) and that item count is a sane unit (one ten-month epic among thirty two-day stories breaks it). Honour both preconditions.

---

## Test Yourself

1. You're handed "mean cycle time = 9 days." Why is that nearly useless on its own, and what would you ask for instead?
2. Describe the cycle-time scatterplot: axes, what the horizontal lines are, and three things you read off it.
3. What is a Service-Level Expectation, how do you derive one, and how does it replace per-item estimation?
4. Walk through a Monte Carlo forecast for "when will these 30 items be done?" What's the input, and what's the *shape* of the output?
5. State Little's Law and the M/M/1 utilization relationship. Use each to justify a concrete intervention on cycle time.
6. Why is full utilization ("keep everyone 100% busy") a cause of *long* lead time, quantitatively?
7. What is aging WIP, why is it a leading indicator where the scatterplot is lagging, and what is "flow debt"?
8. On a cycle-time control chart, how do you tell common-cause from special-cause variation, and why does the difference change your response?
9. Across a five-team value stream, where does the lead time actually go, and why is optimising one team usually the wrong move?

<details>
<summary>Answers</summary>

1. Cycle time is **right-skewed/heavy-tailed**, so the mean is pulled up by the tail — it's both *unrepresentative* (no typical item experiences 9 days; the median is lower) and *unstable* (one 60-day outlier swings it). Ask for the **percentiles and shape**: p50, p85, p95. Risk lives in the tail, which the mean deletes.
2. **X = completion date, Y = cycle time in days, one dot per finished item**, with horizontal lines at **p50/p85/p95**. You read off: (a) the percentile lines as service-level expectations ("85% finished within N days"); (b) the tail — dots above p95 are individually inspectable outliers; (c) the trend/patterns — drift up or down, batch clusters (vertical stacks), a widening band (growing unpredictability).
3. An **SLE** is a percentile-based forecast for a single item — "85% of items finish within 9 days" — derived as the **p85 of the historical scatterplot**. It replaces per-item estimation because it predicts from the *system's measured behaviour* rather than a human's guess about the *task*: cheaper (zero estimation), usually more accurate, and it doubles as the trigger for the aging-WIP alarm. Choose the percentile by the cost of being late.
4. Input: **historical throughput** (items/day over a recent window). Method: simulate one future by sampling throughput per day with replacement until the 30 items are burned down → one completion date; **repeat ~10,000 times**. Output: a **distribution of completion dates** — read percentiles ("50% by day 24, 85% by day 31, 95% by day 40"). The deliverable is a probability distribution with confidence levels, not a single date.
5. **Little's Law:** `Cycle Time = WIP / Throughput` → for fixed throughput, cycle time is *proportional to WIP*, so **limit WIP** to cut cycle time. **M/M/1:** `wait ∝ ρ/(1−ρ)` → wait explodes hyperbolically as utilization ρ → 100%, so **stop driving utilization to 100%** (preserve slack) to keep the queue and thus cycle time finite.
6. Because wait time `∝ ρ/(1−ρ)`: at ρ=0.5 the multiplier is 1, at 0.9 it's 9, at 0.95 it's 19 — the last few percent of "busy" inflate the queue catastrophically. A team driven to full utilization has every new item landing behind a maximal queue, so lead time *explodes*. The slack (idle worker time) is the buffer that absorbs variability and keeps flow fast.
7. **Aging WIP** = for each *in-progress* item, time elapsed since it started (its cycle time *so far*), plotted against the SLE percentile lines. It's **leading** because an item crossing p85 *while still in flight* warns you it's headed for the tail in time to act; the scatterplot only shows trouble *after* completion (lagging). **Flow debt** = making completed numbers look good by leaving hard items deliberately unfinished — only watching aging WIP catches it.
8. **Common cause** = normal scatter within the band → it's noise; respond by changing the *system* (WIP/batch/bottleneck), never the individual item — reacting to it is **tampering**, which adds variation. **Special cause** = a point far beyond p95, or a *run* of points one side of the median, or a widening band → a real signal; **investigate the specific event**. Misclassifying noise as signal makes the system worse; misclassifying signal as noise misses real changes.
9. Mostly into **handoff queues between teams** — the inter-team wait, not the active work; cross-team flow efficiency is often single-digit (90%+ waiting). Optimising one team is **local optimisation**: shaving its internal cycle time barely dents an end-to-end lead time dominated by boundary queues (Theory of Constraints). The leverage is finding and draining the dominant *handoff* queue, measuring the *stream*, and reducing/eliminating handoffs.

</details>

---

## Cheat Sheet

```
THE DISTRIBUTION (never report the mean)
  cycle time is RIGHT-SKEWED / HEAVY-TAILED (≈ log-normal/Weibull)
  mean = unstable (tail-dominated) + unrepresentative → report PERCENTILES
  p50 typical · p85 default SLE · p95 risk/promises · spread(p85−p50) = predictability
  predictability (tight tail) > raw speed (low median, fat tail)

THE SCATTERPLOT (your core chart)
  X = completion date · Y = cycle time · 1 dot/item · lines at p50/p85/p95
  percentile lines ARE the service-level expectations
  dots above p95 = inspectable tail · clusters = batch smell · band widening = instability

SLE (forecast one item, no estimate)
  "85% of items finish within N days"  ←  p85 of the scatterplot
  pick percentile by cost-of-late · also = the trigger for the aging-WIP alarm

MONTE CARLO (forecast many items, no estimate)
  input: historical THROUGHPUT (items/day)
  sample-with-replacement → burn down scope → 1 date; repeat 10,000×
  output: DISTRIBUTION of dates → "50% by d24, 85% by d31, 95% by d40"
  beats story points: models variability, gives confidence, ~zero effort
  needs: stable system + small similar-sized items

QUEUEING CAUSES (laws, not vibes)
  Little's Law:  CycleTime = WIP / Throughput   → WIP is a LINEAR multiplier
  M/M/1 wait  ∝  ρ / (1−ρ)   → ρ=.9→9×, ρ=.95→19×  (hyperbolic; last 10% explodes)
  batch size = 3rd multiplier (review queue + late/large rework)
  fix: lower WIP · don't max utilization (slack = buffer) · shrink batches

LEADING INDICATOR (act while you still can)
  AGING WIP = age of in-progress items vs SLE lines → crosses p85 = at risk NOW
  scatterplot is LAGGING (after done); aging WIP is LEADING (mid-flight)
  flow debt = good completed numbers hiding deliberately-unfinished hard items

CONTROL CHART (classify before reacting)
  common cause = noise → change the SYSTEM, not the item (reacting = TAMPERING)
  special cause = point beyond p95, a RUN one side of median, widening band → INVESTIGATE

MULTI-TEAM VALUE STREAM
  handoff QUEUES dominate (not active work); flow efficiency collapses at boundaries
  optimise one team = local optimisation → attack the boundary queue
  measure & own the STREAM; reduce/eliminate handoffs (Conway in reverse)
```

---

## Summary

- Cycle time is a **right-skewed, heavy-tailed distribution** (≈ log-normal/Weibull), so the **mean is misleading and unstable** — tail-dominated and unrepresentative. Report **p50/p85/p95** and the shape; predictability (a tight tail) beats raw speed (a low median with a fat tail).
- The **cycle-time scatterplot** with percentile lines is the core analytic: it preserves every point, makes the percentile *service-level expectations* visual, and keeps the tail and outliers individually inspectable. Delete the line-chart-of-the-mean; live in the scatterplot.
- **Service-Level Expectations** ("85% finish within N days") forecast a single item from the *system's* measured behaviour, replacing expensive, inaccurate per-item estimation for typical work — and doubling as the aging-WIP alarm trigger.
- **Monte Carlo simulation** over historical throughput answers "when will these N items be done?" with a **probability distribution of dates** and explicit confidence levels — beating story-point estimation on accuracy, honesty, and effort (Vacanti's *Actionable Agile Metrics*; Reinertsen's economics).
- Long lead time is **queueing physics**: Little's Law makes WIP a *linear* multiplier on cycle time, the utilization curve makes the last 10% of "busy" a *hyperbolic* one, and batch size is a third multiplier. The fix is draining queues — lower WIP, preserve slack, shrink batches — not working harder.
- **Aging WIP** against the SLE is the leading indicator the completed-item average can never be, and the only thing that catches **flow debt**. Manage the aging of the unfinished; finish the oldest thing first.
- The **control-chart lens** keeps you from mistaking noise for signal: common cause → change the system (reacting is tampering); special cause → investigate the event.
- Across a **multi-team value stream**, handoff queues — not active work — own the lead time. Optimising one team is local optimisation; measure and own the *stream*, and attack the boundary queues, which is also why DORA scopes lead-time-for-changes to the controllable commit-to-prod slice.

You now reason about lead time as a statistician and a queueing theorist, not a project manager with a Gantt chart. The next layer — [professional.md](professional.md) — is about operating these practices at organisational scale, and [interview.md](interview.md) drills the explanations under pressure.

---

## Further Reading

- *Actionable Agile Metrics for Predictability* — Daniel S. Vacanti. The definitive treatment of cycle-time scatterplots, SLEs, flow debt, and the case for measuring over estimating.
- *When Will It Be Done?* — Daniel S. Vacanti. Monte Carlo forecasting in depth, with the throughput-sampling method worked end to end.
- *The Principles of Product Development Flow* — Donald G. Reinertsen. The economic and queueing foundations: batch size, utilization, WIP, and the cost of queues — the *why* under all of it.
- *Making Work Visible* — Dominica DeGrandis. WIP, aging, and the "five thieves of time" — the practitioner's bridge from theory to the board.
- *Principles of Lean / Theory of Constraints* (Goldratt, *The Goal*) — why local optimisation of a non-bottleneck moves the global number not at all.
- The ActionableAgile / kanban-metrics literature and tooling — scatterplots, aging WIP, and Monte Carlo as a daily practice.

---

## Related Topics

- [Flow Metrics & Value Stream](../02-flow-metrics-and-value-stream/senior.md) — WIP, throughput, flow efficiency, and value-stream mapping; the descriptive layer this page makes predictive.
- [The DORA Four Keys](../01-dora-four-key-metrics/senior.md) — lead-time-for-changes as one engineered, controllable slice of the larger lead time, and why batch size drives deployment frequency.
- [junior.md](junior.md) · [middle.md](middle.md) · [professional.md](professional.md) — the rest of this topic's tier set (definitions, decomposition, and org-scale operation).
- [Performance → Latency & Throughput](../../performance/03-latency-and-throughput/) — the *runtime* version of the same percentile-and-queueing thinking: p99 latency, Little's Law, and the utilization curve applied to systems rather than teams.
