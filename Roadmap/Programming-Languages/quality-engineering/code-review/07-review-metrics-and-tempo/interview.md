# Review Metrics & Tempo — Interview Level

> **Roadmap:** [Code Review](../README.md) → Review Metrics & Tempo
> *A review-metrics interview rarely asks "what is cycle time." It asks "your team's review latency is two days — diagnose it," and then watches whether you reach for the queue or for a leaderboard. This page is the question bank, with model answers and a note on what each question is really probing.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [How to Use This Page](#how-to-use-this-page)
4. [Fundamentals](#fundamentals)
5. [The Flow Model](#the-flow-model)
6. [Reviewer Load](#reviewer-load)
7. [Goodhart & Counter-Metrics](#goodhart--counter-metrics)
8. [Scale & Scenarios](#scale--scenarios)
9. [Rapid-Fire](#rapid-fire)
10. [Red Flags / Green Flags](#red-flags--green-flags)
11. [Cheat Sheet](#cheat-sheet)
12. [Summary](#summary)
13. [Further Reading](#further-reading)
14. [Related Topics](#related-topics)

---

## Introduction

Review-metrics questions look like measurement questions but are really *judgment* questions. Anyone can recite "track cycle time." The interview is probing whether you understand **why review latency dominates flow**, whether you can tell a *system* metric from an *individual* one, and whether you'll notice the moment a metric starts corrupting the behavior it was meant to improve. The strong candidates treat code review as a **queue** and treat every metric as a **proxy that can be gamed** — and they say so before anyone asks.

This page is organized by theme: the fundamentals (what the metrics are and why latency hurts), the flow model (the queue / Little's Law differentiator), reviewer load (finite attention), Goodhart (the core trap), and scale/scenarios (what you say when leadership wants a leaderboard). Each question carries the model answer and what the interviewer is really testing.

---

## Prerequisites

You'll get more from this page if you're comfortable with:

- **Basic flow vocabulary** — work-in-progress (WIP), cycle time, throughput, lead time. The flow section leans on these. See [Engineering Metrics & DORA](../../engineering-metrics-and-dora/).
- **The PR-size discussion** — small PRs are the lever behind most of the tempo answers. See [02 — PR Scope & Size](../02-pr-scope-and-size/interview.md).
- **Goodhart's Law** in one line: *when a measure becomes a target, it ceases to be a good measure.* Most of the hard answers here are corollaries of it.
- **Little's Law** in one line: in a stable queue, `WIP = arrival_rate × cycle_time`. You don't need the proof, just the intuition.

---

## How to Use This Page

Each question carries three things: **Q** (the prompt), **what the interviewer is really testing**, and **A** (a model answer at the depth a strong candidate gives). Don't memorize the answers — internalize the *distinctions* they keep returning to:

- **wait vs work** (a PR sits in a queue far longer than anyone spends reviewing it)
- **system vs individual** (measure the pipeline, not the person)
- **metric vs target** (the moment you reward a number, you deform the behavior under it)
- **flow vs activity** (faster delivery vs more comments/approvals/PRs-touched)

Nearly every question in this bank is one of those four distinctions wearing a costume. The candidates who do well are the ones who *name the distinction* before reaching for a number.

---

## Fundamentals

### Q: What are the core code-review metrics, and which one matters most?

> **Testing:** Whether you know the metric set *and* can rank it, rather than listing everything flatly.

**A.** The core set is small:

- **Time-to-first-review (TTFR)** — open → first substantive review. How long the author waits before *anything* happens.
- **Review cycle time** — open → merge (or approve). The total wall-clock of the review.
- **Review iterations** — how many back-and-forth rounds before approval.
- **PR size** — lines/files changed; the upstream variable that drives all the others.
- **Reviewer load** — how many open reviews a person is responsible for at once.

If I had to pick one, **TTFR** — because in almost every team the review is *waiting* far more than it's being *worked*. Cycle time is mostly queue time, and TTFR is the front of that queue. It's also the metric the author *feels*: a PR with fast first-touch keeps them in context; a PR that sits two days forces a context-switch and invites merge conflicts. Fix TTFR and most of cycle time follows.

### Q: Why does review latency actually cost anything? It's "just waiting."

> **Testing:** Whether you can connect latency to concrete engineering costs, not just "it's annoying."

**A.** Latency is expensive for four compounding reasons:

1. **Context-switch tax.** While the PR waits, the author starts something else. When review comes back, they pay reload cost to re-enter the old change — and the reviewer pays it too, reconstructing intent for a diff that's now cold.
2. **WIP accumulates.** A slow review queue means more PRs in flight simultaneously (this is just Little's Law). High WIP means more half-finished work, more cognitive juggling, more things that can rot.
3. **Merge conflicts and rebases.** The longer a branch sits, the more `main` moves underneath it. Latency literally manufactures rework.
4. **Blocked author / blocked dependents.** Downstream work waiting on this PR stalls too, so the cost isn't one person-day, it's the fan-out.

So "just waiting" is the most expensive state in the system, because nothing is progressing *and* the cost of resuming is rising the whole time.

### Q: Explain the small-PR / fast-review virtuous cycle and its opposite.

> **Testing:** The single most important dynamic in the topic — whether you see it as a *loop*, not two separate facts.

**A.** They're two self-reinforcing loops running in opposite directions.

**Virtuous cycle:** small PR → cheap to review → reviewer says "yes, I'll take this now" → fast first-review → quick merge → author stays in flow and keeps shipping small. Small begets fast begets small.

**Doom loop:** slow reviews → author thinks "if I have to wait two days anyway, I'll batch more into one PR so I only pay the wait once" → PRs get bigger → big PRs are intimidating and expensive to review → reviewers procrastinate → reviews get *slower* → author batches even more. Slow begets big begets slow.

```
  VIRTUOUS                          DOOM
  small PR ──► fast review          slow review ──► bigger PRs
     ▲             │                    ▲              │
     └─────────────┘                    └──────────────┘
   (stays small)                     (gets worse)
```

The practical insight: you can't fix tempo by exhorting reviewers to "be faster." You break the loop at *two* points simultaneously — drive TTFR down (so the wait stops justifying batching) **and** drive PR size down (so reviews are cheap enough to do now). Attack one without the other and the loop re-forms.

### Q: What's the difference between TTFR and cycle time, and why track both?

> **Testing:** Whether you understand they measure different segments and can be diagnosed independently.

**A.** **TTFR** is open → first review; **cycle time** is open → merge. TTFR is a *prefix* of cycle time. Tracking both lets you localize the bottleneck:

- High TTFR, low remaining time → the problem is the **queue front**: nobody picks reviews up. Fix with assignment/rotation, SLAs, smaller PRs.
- Low TTFR, high cycle time → first-touch is fast but the PR gets stuck in **iteration**: many rounds, slow re-reviews, or design disagreement surfacing late. Fix with smaller scope, earlier design alignment, faster re-review turnaround.

One number alone is ambiguous — "cycle time is 3 days" doesn't tell you whether to fix pickup or iteration. The two together do.

---

## The Flow Model

### Q: Model code review as a queue. What does Little's Law tell you?

> **Testing:** The differentiator — whether you can apply queueing theory rather than just feel that "slow is bad."

**A.** Treat each reviewer (or the review stage as a whole) as a server with a queue of PRs. In a stable system, **Little's Law** holds:

```
WIP = arrival_rate × cycle_time
   (PRs in flight) = (PRs opened per day) × (avg days open)
```

Three consequences fall straight out:

1. **Cycle time and WIP are tied.** If arrival rate is roughly constant, then cycle time and WIP move together — you can't cut cycle time without cutting WIP, and capping WIP *forces* cycle time down. That's the theoretical basis for WIP limits.
2. **An overloaded queue blows up cycle time non-linearly.** As utilization approaches 100%, queue time grows toward infinity (the classic `1/(1−ρ)` curve). A reviewer at 95% "busy" has wildly worse and more *variable* latency than one at 70%. You want slack in the review system, not maximal utilization.
3. **Smaller arrivals (smaller PRs) lower cycle time** even at the same throughput, because service time per item drops and variance drops. Small batches are a flow optimization, not just a readability one.

The reframe this buys you: review latency is a **property of the queue**, not a property of lazy reviewers. You fix queues by reducing batch size, capping WIP, and adding slack — not by telling the server to spin faster.

### Q: People say "reviews are slow because reviewers are slow." Why is that usually wrong?

> **Testing:** The wait-vs-work distinction — the heart of the flow model.

**A.** Because **wait time dwarfs work time.** Measure it and you'll typically find a PR spends hours-to-days *sitting in the queue* and minutes-to-an-hour actually being read. If first-review takes a day but the review itself takes 30 minutes, then ~95%+ of cycle time is queue, not effort. "Reviewers are slow" attacks the 5%; the leverage is in the 95%.

This is the same lesson as any flow system (a feature ticket spends most of its life in "waiting," not "in progress"). So the fix is structural — reduce what's queued (smaller/fewer PRs in flight), make pickup faster (assignment, rotation, SLAs), and reduce variance — not "ask humans to read faster," which mostly produces rubber-stamping. Whenever someone blames the server, suspect the queue.

### Q: Why does TTFR specifically dominate cycle time?

> **Testing:** Whether you can locate *where* the wait lives, not just that it exists.

**A.** Because the first-touch wait is the largest, most variable chunk of the queue, and it gates everything downstream. Nothing can iterate until the first review happens, so TTFR is pure dead time with no progress at all. Subsequent rounds at least alternate with author work; the initial wait is one-sided. Empirically (and in Google's own analysis of their review system) the dominant lever on overall review speed is getting *someone to look promptly* — once a human is engaged, things move. So TTFR is both the biggest slice and the one with the highest ROI to attack first. Drive it down and the rest of cycle time compresses around it.

### Q: How would you break a team out of the slow-review / big-PR doom loop?

> **Testing:** Whether you intervene at the loop's *two* leverage points, not just one.

**A.** You have to hit both arms of the loop at once, or it re-forms:

1. **Attack TTFR** so the wait stops justifying batching:
   - **Review assignment**, not "whoever volunteers" — a round-robin / load-balanced auto-assigner removes the bystander effect.
   - A **team norm/SLA** like "first review within N business hours" — *as a team default, never a per-person KPI* (more on that in the Goodhart section).
   - Make review a *scheduled* activity (e.g., reviews first thing after standup) rather than an interrupt people defer.
2. **Attack PR size** so reviews are cheap enough to pick up now:
   - Coach toward stacked/incremental PRs and feature flags so changes ship in small slices.
   - Make "this PR is too big, please split" a normal, blameless review outcome.

Then **measure the loop** to confirm it's turning the right way — watch TTFR and PR-size *distributions* (medians and p75/p90, not means) trend down together. If you cut TTFR but PRs stay huge, reviewers will still procrastinate; if you shrink PRs but pickup stays slow, authors will re-batch. Both, simultaneously.

### Q: What's "cost of delay," and how does it relate to WIP limits and review SLAs?

> **Testing:** Senior-level flow economics — Reinertsen territory.

**A.** **Cost of delay** is the economic cost of a unit of work *not* being done yet — the value you forgo per unit time it's stuck. Review latency is pure cost of delay: the feature's value is realized only after merge, so every day in review is value deferred (plus the rework and context-switch costs above).

- **WIP limits** are a blunt but effective control: cap how many PRs a person/team has open, which by Little's Law forces cycle time down and creates pressure to *finish* (review) before *starting* (open new PRs). The trade-off is they can feel artificial and can stall people if the cap is set wrong or if blockers aren't cleared.
- **SLAs** (e.g., "first review within 4 hours") directly target TTFR. The trade-off: a hard SLA can induce rubber-stamping under deadline pressure ("I must respond, so I'll just approve"), which is Goodhart again — so an SLA needs a quality counter-metric (escaped-defect / change-failure rate) watching alongside it, and should be framed as a team commitment, not an individual's scorecard.

The senior framing: these are *flow controls*, and every flow control has a failure mode if you optimize it in isolation. You tune them against cost of delay and pair speed levers with quality guards.

---

## Reviewer Load

### Q: Is there a ceiling on how much a person can effectively review? What happens past it?

> **Testing:** Whether you know review quality is attention-bound, with a real, citable limit.

**A.** Yes — review is bounded by **finite human attention**, and the well-known guidance is roughly **≤400 lines of code per review session** and **≤60 minutes** before defect-detection effectiveness falls off a cliff (the SmartBear/Cisco study is the usual citation). Past that ceiling two things happen:

1. **Defect-finding collapses.** Beyond ~400 LOC, reviewers find proportionally fewer issues — they skim. The big PR doesn't get *more* scrutiny for being big; it gets *less per line*.
2. **Overload → rubber-stamping.** A reviewer drowning in open reviews (or in one giant diff) stops reasoning and starts approving. The throughput looks fine; the review value is near zero.

So reviewer load isn't just a scheduling concern — past the ceiling, the *output is fake*. A "reviewed and approved" PR from an overloaded reviewer carries almost none of the assurance the label implies. This is exactly why PR size and reviewer load have to be managed *together*: they're the two ways you blow past the attention budget.

### Q: How do you manage reviewer load across a team?

> **Testing:** Practical load-balancing and bus-factor awareness.

**A.** Three levers:

1. **Load-balanced assignment / rotation.** Auto-assign reviews round-robin weighted by current open-review count, so no one silently becomes the bottleneck. Tools like CODEOWNERS plus an auto-assigner, or a review-rotation bot, do this.
2. **Spread the knowledge (bus-factor).** If one person reviews everything in a subsystem, they're a single point of failure *and* a latency bottleneck. Deliberately route some reviews to others to build redundancy, even at a short-term speed cost.
3. **Cap concurrent reviews / protect focus time.** Treat "open reviews assigned to X" as a WIP-limited queue. If someone's at their cap, route elsewhere; protect maker-time so review doesn't become death-by-interrupt.

The thing to *watch* is **reviewer concentration** — what fraction of reviews flow through the top one or two people. A healthy team has review load distributed; a team where 80% of reviews hit two people has both a bus-factor risk and a guaranteed latency bottleneck, and those two are usually the same problem.

### Q: A senior engineer reviews 70% of the team's PRs. Is that good or bad?

> **Testing:** Whether you see concentration as a risk even when it "works."

**A.** It's a **risk dressed as efficiency**. It often *feels* good — the senior is fast and catches a lot — but it creates three problems: (1) a **latency bottleneck**, because everything queues behind one person who is necessarily sometimes on PTO, in meetings, or heads-down; (2) a **bus-factor / knowledge-concentration** risk, because review knowledge isn't spreading; and (3) it **starves others of growth**, since reviewing is how engineers learn the codebase and develop judgment. I'd treat 70% as a signal to *deliberately redistribute* — pair the senior as a second reviewer rather than sole reviewer, route first-pass reviews to others, and use it as a mentoring opportunity. The goal is to convert one strong reviewer into several, trading a little present speed for resilience and a higher review ceiling overall.

---

## Goodhart & Counter-Metrics

### Q: Why is it dangerous to measure *individuals* on review metrics?

> **Testing:** The core of the topic — Goodhart's Law applied to review.

**A.** Because **the moment you target an individual metric, people optimize the metric instead of the goal** (Goodhart's Law), and review metrics are unusually easy to game. Concretely:

- Reward **comment count** → you get *nitpicking*: a flood of trivial style comments to look thorough, drowning the substantive ones.
- Reward **approval speed / TTFR per person** → you get *rubber-stamps*: "LGTM" in 90 seconds without reading, because the number rewards speed, not scrutiny.
- Reward **PRs reviewed** → you get people **cherry-picking tiny PRs** and avoiding the big, important, hard ones — the reviews that matter most are the ones the metric punishes.

This is **surrogation**: the metric (comments, speed, count) *replaces* the actual goal (good code, fast flow, shared understanding) in people's minds, and they optimize the proxy at the expense of the thing it stood for. And because it's individual and visible, it poisons collaboration — review becomes performance for the dashboard instead of a shared quality activity. The right level to measure is the **team/system**, where individual gaming doesn't pay off the same way.

### Q: What is a counter-metric, and why pair every speed metric with one?

> **Testing:** The single most important *discipline* — whether you reach for the guardrail unprompted.

**A.** A **counter-metric** (or guardrail) is a metric you watch *alongside* a target specifically to detect when optimizing the target is harming something else. The discipline: **never ship a speed metric without a quality counter-metric.**

- Target **TTFR / review speed** → pair with **escaped-defect rate / change-failure rate** (DORA's CFR). If speed goes up while CFR goes up, you're buying tempo with rubber-stamps — the counter-metric catches it.
- Target **throughput / PRs merged** → pair with **rework rate / revert rate**.
- Target **fewer review iterations** → pair with **post-merge defect / incident rate**, so "fewer rounds" doesn't just mean "stopped reviewing."

The reasoning is direct: any single metric can be gamed by sacrificing what it *doesn't* measure. A pair makes the sacrifice visible — you can't game both in the same direction without it showing up. The DORA model is the canonical example: it deliberately pairs **velocity** (deploy frequency, lead time) with **stability** (CFR, MTTR) so you can't claim "fast" while quietly getting fragile.

### Q: Fowler says you can't measure developer productivity. So why measure review at all?

> **Testing:** Whether you can hold "metrics are useful" and "metrics can't rank people" at the same time.

**A.** Both are true and they're not in tension. Fowler's point (and the SPACE framework's) is that **individual productivity isn't a single measurable scalar** — output isn't lines or commits or PRs, and any one number you pick becomes a Goodhart target that distorts behavior. So you *don't* measure review to rank or rate people.

But you absolutely measure review to **find and fix bottlenecks in the system**. "Our median TTFR is two days" is a diagnostic about the *pipeline*, not a verdict on a *person*. The distinction is **system metrics for improvement vs individual metrics for evaluation**: the former is healthy, the latter is the trap. SPACE makes this concrete by insisting you look at *multiple* dimensions (Satisfaction, Performance, Activity, Communication, Efficiency) and at the *team* level, precisely so no single activity count gets weaponized against individuals. So: measure the system to improve flow; never reduce a human to a review number.

### Q: Leadership says "comments per review is low, reviews must be shallow." What do you say?

> **Testing:** Whether you can debunk a vanity/activity metric on the spot.

**A.** I'd push back on the inference. **Comment count is an activity metric, not a quality metric**, and it's ambiguous in *both* directions:

- **Low comments can mean great code** (small, clean PRs from strong authors need little feedback) — or shallow review. You can't tell from the count.
- **High comments can mean thorough review** — or nitpicking, or a PR so large/messy it generated noise, or a design that should have been discussed *before* coding.

So comments-per-review measures *volume of writing*, not *value of review*. Worse, if we *target* it, we'll manufacture nitpicks to hit the number (Goodhart). What I'd actually look at: are defects being **caught in review vs escaping to production** (review effectiveness / escaped-defect rate)? Is **rework after merge** low? Are authors *learning* (qualitative)? Those tell us if review is doing its job. I'd offer to track *those* instead — and to treat comment counts as, at most, a curiosity, never a target.

### Q: How do you stop a metrics program from being gamed?

> **Testing:** Whether your defenses are structural, not wishful.

**A.** Five structural defenses, not "ask people not to game it":

1. **Measure systems, not individuals.** Team/flow metrics remove most of the incentive to game personally.
2. **Pair every metric with a counter-metric** so one-sided gaming shows up immediately.
3. **Don't tie metrics to performance reviews or rewards.** The instant a number affects pay/promotion, it gets gamed — keep improvement metrics firewalled from evaluation.
4. **Prefer distributions to averages, and watch trends, not absolutes.** Medians and p90 resist the manipulation that means/totals invite; a single absolute number begs to be hit.
5. **Rotate and retire metrics.** A metric that's served its purpose (surfaced a bottleneck) can be put down before it ossifies into a target. Use metrics to ask questions, then act on the answer.

The meta-point: gaming is a *predictable response to incentives*, so you design the program so that gaming doesn't pay — you don't rely on virtue.

---

## Scale & Scenarios

### Q: Your team's review latency is two days. Diagnose and fix it.

> **Testing:** Whether you triage with the flow model instead of jumping to a fix.

**A.** I'd diagnose before prescribing — "two days of *what*?"

1. **Decompose the two days.** Split cycle time into **TTFR** vs **iteration time**. Pull the distribution (median and p90), not just the mean — a few giant PRs can drag a mean while the median is fine.
2. **Locate the bottleneck:**
   - *High TTFR* → queue-front problem: nobody's picking reviews up (no assignment, bystander effect, reviews treated as interrupts to defer).
   - *Low TTFR, high iteration* → PRs too big, or design disagreement surfacing late in review.
   - *Concentration* → check reviewer load; if most reviews funnel through one or two people, that's your bottleneck.
3. **Fix to match:**
   - For TTFR: **auto-assign reviewers** (load-balanced), set a **team SLA** for first-review (as a default, not a personal KPI), make review a scheduled ritual.
   - For iteration/size: coach toward **smaller, stacked PRs**, feature flags, earlier design alignment.
   - For concentration: **redistribute load**, add second reviewers, build bus-factor.
4. **Add a counter-metric.** As I push latency down, watch **change-failure / escaped-defect rate** so I don't trade speed for rubber-stamping.

The key tell is that I *measure where the two days go* before acting, and I attack TTFR + PR size together. I don't say "tell reviewers to be faster."

### Q: Leadership wants to rank engineers by review activity (comments, approvals, PRs reviewed). What do you say?

> **Testing:** The judgment question — pushing back constructively without just saying "no."

**A.** I'd say I understand the goal — they want healthy, fast, high-quality review — and that **ranking individuals by activity will actively undermine it**, then offer what does work.

The problem: activity counts are **Goodhart bait**. Rank on comments → nitpicking. Rank on approval speed → rubber-stamps. Rank on PRs reviewed → people cherry-pick trivial PRs and dodge the hard, important ones. We'd be **paying for the appearance of review while degrading the substance**, and poisoning collaboration (review becomes dashboard theater). It also misreads the data: low comments can mean *excellent* code; the count can't distinguish.

What I'd propose instead:

- Measure the **system, not the person** — team TTFR, cycle time, PR size, paired with **change-failure rate** as a guardrail. Use them to *find bottlenecks*, not to rank.
- For individuals, evaluate review **qualitatively** (does their feedback help? do they mentor? do they catch real issues?) via normal manager judgment, *not* a leaderboard.
- If leadership wants engagement, make review **fast and low-friction** (assignment, SLAs, small PRs); people review more when it's easy, not when it's scored.

So: not "no, you're wrong," but "here's the failure mode, and here's the version that gets you what you actually want."

### Q: How would you measure whether code review is *healthy*?

> **Testing:** Whether you assemble a balanced, multi-dimensional picture instead of one number.

**A.** No single number — I'd use a small **balanced set** spanning speed, quality, and load, at the team level:

| Dimension | Metric | Healthy signal |
|---|---|---|
| **Speed** | TTFR, review cycle time | Low and *low-variance*; fast first-touch |
| **Batch** | PR size distribution | Mostly small; few giant PRs |
| **Quality (counter)** | Escaped-defect / change-failure rate | Low *and not rising as speed rises* |
| **Load** | Reviewer concentration, open-review WIP | Distributed; no single bottleneck/bus-factor |
| **Iteration** | Rounds to approval, post-merge rework | Few rounds; little rework after merge |
| **Human** | Author/reviewer satisfaction (SPACE) | People find review useful, not a tax |

The discipline is *balance*: speed paired with a quality counter-metric (so "fast" can't hide "fragile"), and a human/qualitative dimension (SPACE) so I'm not reducing a collaborative practice to throughput. And I'd read **distributions and trends**, not absolutes — "is p90 TTFR trending down while CFR stays flat?" is a healthy-review question; "is engineer X's comment count up?" is not.

### Q: TTFR looks great but bugs are escaping to production. What's happening?

> **Testing:** The classic Goodhart catch — recognizing that the good number is *causing* the bad outcome.

**A.** This is the textbook sign that **a speed metric got optimized at the expense of its missing counter-metric**. Fast TTFR with rising escaped defects almost always means **rubber-stamping**: reviews are *happening* quickly because reviewers are approving without genuinely reading — the number says "reviewed," the behavior says otherwise.

Likely drivers:

- **TTFR was made a target** (especially an *individual* one or a hard SLA), so the rational response under load is "respond fast = approve fast."
- **Reviewer overload / oversized PRs** — past the ~400-LOC / 60-min ceiling, reviewers skim and approve; the diff is too big to actually reason about, so "fast approval" is the only feasible behavior.
- **No quality guardrail** was watched, so the degradation ran invisibly.

How I'd confirm and fix: correlate fast approvals with **revert/defect rate** and look at **approval-to-size ratio** (huge PRs approved in two minutes are the smoking gun). Then: re-frame TTFR as a *team* signal with a **change-failure-rate counter-metric** beside it; cut PR size so reviews fit the attention budget; rebalance reviewer load; and stop rewarding speed in isolation. The headline: **the great TTFR isn't a success, it's the symptom** — speed and quality have to be read *together* or fast just means careless.

### Q: When is it legitimate to look at an individual's review data at all?

> **Testing:** Nuance — that the rule is "don't *evaluate* on it," not "never look."

**A.** It's legitimate as **diagnostic input for support and coaching**, never as an **evaluation scorecard**. Examples: a manager noticing one person is *drowning* in assigned reviews and rebalancing the load; spotting that someone's PRs consistently take many rounds and offering coaching on scoping; seeing that a new hire reviews almost nothing and pairing them up to build confidence. In all of those, the data prompts a *human conversation aimed at helping*. The line it must not cross: feeding those numbers into ratings, stack-ranking, or rewards — the moment it affects pay/promotion, it becomes a Goodhart target and gets gamed, and trust in the whole metrics program collapses. So: look, to *help the system and the person*; don't tally, to *judge them*.

---

## Rapid-Fire

> Short questions to check breadth. One or two sentences each.

- **Q: What does TTFR stand for, and why care?** A: Time-to-first-review (open → first review); it's the front of the queue and usually the biggest, most variable chunk of cycle time.
- **Q: One-line Little's Law for review?** A: `WIP = arrival_rate × cycle_time` — cap WIP and cycle time falls; cut batch size and both fall.
- **Q: Wait time or work time — which dominates review latency?** A: Wait. A PR sits in the queue far longer than anyone spends reading it.
- **Q: The reviewer attention ceiling?** A: Roughly ≤400 LOC and ≤60 minutes before defect-detection collapses (SmartBear/Cisco).
- **Q: Game "comments per review."** A: Flood trivial nitpicks to inflate the count; substance drops, number rises.
- **Q: Game "approval speed."** A: Rubber-stamp "LGTM" without reading.
- **Q: Game "PRs reviewed."** A: Cherry-pick tiny PRs, dodge the big important ones.
- **Q: What's a counter-metric?** A: A guardrail watched alongside a target to catch when optimizing the target harms something else.
- **Q: Pair TTFR with what?** A: Change-failure / escaped-defect rate.
- **Q: One word for "the proxy replaces the goal in people's minds"?** A: Surrogation.
- **Q: System or individual metrics for code review?** A: System, for improvement; never individual, for evaluation.
- **Q: Mean or median for review metrics?** A: Median (and p90) — means hide skew and are easier to game.
- **Q: What's reviewer concentration?** A: The share of reviews flowing through the top one or two people — a latency bottleneck and bus-factor risk.
- **Q: Why do slow reviews create big PRs?** A: Authors batch more to pay the wait once, which makes reviews slower — the doom loop.
- **Q: DORA's velocity-vs-stability pairing — relevance?** A: It's the canonical counter-metric design: you can't claim "fast" while quietly getting fragile.

---

## Red Flags / Green Flags

> What interviewers infer from *how* you answer, not just whether you're right.

**Red flags:**

- "Reviews are slow because reviewers are lazy" — attacks the 5% (work) and misses the 95% (queue).
- Proposing to **rank engineers** by comments / approvals / PRs reviewed.
- Naming a speed metric (TTFR, throughput) with **no quality counter-metric**.
- Treating **comment count** as a quality measure.
- Reporting **means/totals** and ignoring distributions and gaming.
- Saying "just set an SLA" with no awareness it can induce rubber-stamping.
- Seeing "TTFR is great" as unambiguous success without checking escaped defects.
- No mention of **PR size** when discussing review tempo.

**Green flags:**

- Modeling review as a **queue** and invoking **Little's Law** / wait-vs-work unprompted.
- Distinguishing **system metrics (improve)** from **individual metrics (evaluate)** before being pushed.
- Reaching for a **counter-metric** automatically when naming any speed target.
- Citing the **~400-LOC / 60-min** reviewer-attention ceiling.
- Attacking **TTFR and PR size together** to break the doom loop.
- Pushing back on a leaderboard request *constructively* — naming the Goodhart failure and offering what works.
- Reading "great TTFR + escaping bugs" instantly as **rubber-stamping**.
- Preferring **distributions and trends** to absolutes; firewalling metrics from performance reviews.

---

## Cheat Sheet

| Concept | One-liner |
|---|---|
| **TTFR** | Open → first review; biggest, most variable slice of cycle time. |
| **Cycle time** | Open → merge; mostly queue, not work. |
| **Little's Law** | `WIP = arrival × cycle_time`; cap WIP → cycle time falls. |
| **Wait vs work** | A PR waits far more than it's worked; fix the queue, not the server. |
| **Doom loop** | Slow review → bigger PRs → slower review; break at TTFR *and* size. |
| **Attention ceiling** | ~400 LOC / 60 min before defect-finding collapses. |
| **Reviewer concentration** | Reviews funneled through 1–2 people = bottleneck + bus-factor. |
| **Goodhart** | Target a metric → it deforms behavior (nitpicks, rubber-stamps, gaming). |
| **Surrogation** | The proxy metric mentally *replaces* the real goal. |
| **Counter-metric** | Guardrail beside a target (TTFR ↔ change-failure rate). |
| **System not individual** | Measure the pipeline to improve; never rank people. |
| **DORA pairing** | Velocity (lead time, deploy freq) paired with stability (CFR, MTTR). |
| **SPACE** | Productivity is multi-dimensional and team-level, not one scalar. |
| **Leaderboard request** | Name the gaming failure; offer system metrics + qualitative judgment. |

---

## Summary

- The bank reduces to four distinctions in costumes: **wait vs work**, **system vs individual**, **metric vs target**, **flow vs activity**. Name the distinction first; the number follows.
- **Fundamentals:** the core metrics are TTFR, cycle time, iterations, PR size, reviewer load — and **TTFR dominates** because review is mostly queue. Small PRs and fast reviews form a virtuous cycle; slow reviews and big PRs form the doom loop. Break it at *both* points.
- **Flow model:** review is a **queue**; **Little's Law** ties cycle time to WIP, so cap WIP and shrink batches rather than exhorting reviewers. Wait time dwarfs work time, so blaming "slow reviewers" attacks the wrong 5%. Cost of delay, WIP limits, and SLAs are flow controls — each with a failure mode if optimized alone.
- **Reviewer load:** attention is finite (~400 LOC / 60 min); past the ceiling you get **rubber-stamping** and *fake* approvals. Distribute load, watch **concentration** for bottleneck and bus-factor.
- **Goodhart (the core):** individual review metrics corrupt behavior — comments → nitpicks, speed → rubber-stamps, count → cherry-picking — via **surrogation**. The discipline is **counter-metrics** (pair every speed metric with a quality one, à la DORA) and measuring **systems, not people** (SPACE; Fowler).
- **Scale/judgment:** measure the system to *find bottlenecks*, never to *rank engineers*; respond to leaderboard requests by naming the failure and offering what works; read "great TTFR + escaping bugs" as the textbook rubber-stamp symptom. Prefer distributions and trends; firewall metrics from evaluation.

---

## Further Reading

- *Accelerate* (Forsgren, Humble, Kim) and the **DORA** reports — the canonical velocity-paired-with-stability metric model that grounds the counter-metric discipline.
- **The SPACE of Developer Productivity** (Forsgren et al., 2021) — why productivity is multi-dimensional and team-level, and why activity counts mislead.
- *The Principles of Product Development Flow* (Donald Reinertsen) — cost of delay, queue theory, WIP limits, and small batches as economics.
- **Google Engineering Practices — "Speed of Code Reviews"** — the practical case that fast first-review is the dominant lever, and why.
- Martin Fowler, *"Cannot Measure Productivity"* — the argument against single-number individual productivity, and what to do instead.
- The [junior.md](junior.md) and [senior.md](senior.md) pages of this topic — every answer here is grounded in those.

---

## Related Topics

- [02 — PR Scope & Size](../02-pr-scope-and-size/interview.md) — the upstream lever behind every tempo answer; small PRs power the virtuous cycle.
- [05 — Giving & Receiving Feedback](../05-feedback-giving-and-receiving/interview.md) — what *good* review comments look like, beyond their count.
- [08 — Review Anti-patterns](../08-review-anti-patterns/interview.md) — rubber-stamping, nitpicking, and the behaviors bad metrics induce.
- [Engineering Metrics & DORA](../../engineering-metrics-and-dora/) — the broader velocity/stability model and counter-metric design.
- [Quality Gates](../../quality-gates/) — where review SLAs and merge controls sit in the delivery pipeline.
