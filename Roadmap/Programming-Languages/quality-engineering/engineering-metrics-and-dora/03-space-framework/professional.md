# The SPACE Framework — Professional Level

> **Roadmap:** [Engineering Metrics & DORA](../README.md) → The SPACE Framework
> *The senior page taught you what the five dimensions are and why no single number captures productivity. This page is about running a SPACE-based measurement program for a whole org — a developer-experience survey plus a few system signals, fed into improvement work — under the one constraint that breaks every such program: the moment a productivity number becomes an individual performance input, it is gamed and the trust you need to measure anything at all collapses.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Building the Program — Survey + Signals, Not a Dashboard](#building-the-program--survey--signals-not-a-dashboard)
4. [Cadence, Anonymity, and the Architecture of Trust](#cadence-anonymity-and-the-architecture-of-trust)
5. [Combining SPACE with DORA and Flow](#combining-space-with-dora-and-flow)
6. [Tooling — DX/GetDX, Jellyfish, or DIY](#tooling--dxgetdx-jellyfish-or-diy)
7. [The Political Reality — When Measurement Becomes Surveillance](#the-political-reality--when-measurement-becomes-surveillance)
8. [Using the Data to Act](#using-the-data-to-act)
9. [The Executive Conversation — DevEx in Business Terms](#the-executive-conversation--devex-in-business-terms)
10. [The McNamara Fallacy — Don't Discard the Soft Signal](#the-mcnamara-fallacy--dont-discard-the-soft-signal)
11. [War Stories](#war-stories)
12. [Decision Frameworks](#decision-frameworks)
13. [Mental Models](#mental-models)
14. [Common Mistakes](#common-mistakes)
15. [Test Yourself](#test-yourself)
16. [Cheat Sheet](#cheat-sheet)
17. [Summary](#summary)
18. [Further Reading](#further-reading)
19. [Related Topics](#related-topics)

---

## Introduction

> Focus: **Running a developer-productivity/DevEx measurement program at org scale — building it, defending it from misuse, and converting its findings into system fixes and an executive narrative.**

The senior page framed SPACE as a thinking tool: pick a few metrics across Satisfaction, Performance, Activity, Communication, and Efficiency, and never report one alone. At the professional level you're not picking metrics for a slide — you're standing up a *program*: a recurring developer-experience survey of a few hundred or few thousand engineers, a handful of automated system signals, a quarterly review cadence, and a backlog of system improvements that the data justifies. And you're doing it inside an organization where a VP will, within the first quarter, ask you to "show me which teams are underperforming" or "put the Activity number in the perf-review packet."

That request is the whole game. SPACE is explicitly a **team- and system-level** framework, and the instant any of its numbers becomes an individual performance or stack-ranking input, two things happen at once: the number gets gamed (commits inflate, PRs get split, the survey gets answered strategically), and the trust that lets people answer a satisfaction question honestly evaporates. A productivity-measurement program lives or dies not on the quality of its metrics but on whether the people being measured believe the data will be used *for* their work, not *against* them.

So this page is two skills braided together. One is mechanical: how to build the survey, choose the cadence, wire up the system signals, pair them with DORA, and pick between DX/GetDX, Jellyfish, and a DIY stack. The other is political and far harder: how to keep the program team-level, protect the survey from becoming surveillance, act visibly on what it surfaces, and translate "developer experience" into the language — retention cost, delivery speed, the price of a burned-out senior walking out the door — that gets the friction-fixing work funded. Get the mechanics right and the politics wrong, and you'll have a beautifully instrumented program that everyone has learned to lie to.

---

## Prerequisites

- **Required:** [senior.md](senior.md) — the five SPACE dimensions, perceptual vs system vs workflow signals, why activity ≠ productivity, balancing metrics so one can't be gamed in isolation.
- **Required:** Working familiarity with [DORA](../01-dora-four-key-metrics/professional.md) and [flow metrics](../02-flow-metrics-and-value-stream/professional.md) — SPACE is most useful *combined* with delivery and flow data, not standalone.
- **Required:** A grounding in [metrics anti-patterns and Goodhart's law](../06-metrics-anti-patterns-and-goodhart/professional.md) — the entire failure surface of this page is Goodhart in practice.
- **Helpful:** You've run or been surveyed by an engagement/eNPS survey and seen what happens to response rates when results lead to blame.
- **Helpful:** You've had to justify an infrastructure or tooling investment to a non-engineering executive.

---

## Building the Program — Survey + Signals, Not a Dashboard

The most common way to start a SPACE program is the wrong one: stand up a dashboard of everything the Git provider and CI system already emit — commits, PR counts, deploy frequency, cycle time — call it "developer productivity," and ship it. That gives you a wall of **Activity** with no **Satisfaction**, no **Performance**, and no idea *why* any number is what it is. It is the easiest data to collect and the least useful, and it's the seed of every failure mode later on this page.

A real program has two legs:

**Leg 1 — a periodic developer-experience survey (the perceptual signal).** This is the part you cannot get any other way. Tools measure what developers *do*; only a survey measures what they *experience* — whether the build is fast enough, whether they can get a review in a reasonable time, whether they have focus time, whether the on-call burden is sustainable, whether they'd recommend the team to a friend. The survey is the load-bearing half of SPACE because it's the only source for the Satisfaction dimension and the most reliable source for perceived Efficiency and Communication. A good survey is short (10–20 questions, answerable in under five minutes), uses consistent Likert scales you can trend over time, mixes a few standard benchmarkable items (so you can compare to industry) with a few questions specific to your known pain points, and always leaves one free-text box — the free text is where the real diagnosis hides.

**Leg 2 — selected system and workflow metrics (the behavioral signal).** A deliberately small set, chosen to corroborate or contradict the survey, not to replace it: lead time and its decomposition, review latency (time-to-first-review, time-to-merge), build and CI duration, deployment frequency, change failure rate. These come from your existing DORA/flow instrumentation. The point of pairing them is triangulation: if the survey says "reviews are slow" *and* time-to-first-review is 14 hours at p75, you have a confirmed, fundable problem. If the survey says reviews are slow but the data says p75 is 40 minutes, you've learned something subtler — maybe it's *re-review* latency, or a few painful outliers dominating perception, and you go ask.

The architecture is a loop, not a screen:

```
  SURVEY (perceptual)          SYSTEM SIGNALS (behavioral)
  satisfaction, focus,  ◄──►   lead time, review latency,
  perceived friction           build time, CFR, deploy freq
        │                              │
        └──────────► TRIANGULATE ◄─────┘
                         │
                  TOP FRICTION (ranked)
                         │
              SYSTEM FIX (you change the system)
                         │
              RE-MEASURE next cycle (did it move?)
```

> **The professional reality:** the dashboard is the trap and the survey is the asset. Anyone can buy or build an activity dashboard in a week; the hard, valuable thing is a trusted survey with a high response rate whose results visibly change how the org spends its engineering time. If your program is 90% dashboard and 10% survey, you've built the easy, dangerous half and skipped the hard, useful half.

---

## Cadence, Anonymity, and the Architecture of Trust

Two design decisions determine whether your survey produces honest data or theater: how often you ask, and how strongly you protect the answers.

**Cadence.** The two viable models are *quarterly deep* and *continuous light*. A quarterly survey (the most common starting point) is long enough to cover all five dimensions and infrequent enough not to fatigue people, and it aligns naturally with planning cycles so the results land when teams are deciding what to work on next. A continuous-sampling model (a couple of questions to a rotating slice of engineers every week, à la some commercial platforms) trades depth for a constantly-fresh trend line and lower per-response burden. The anti-patterns at both ends are real: survey monthly with a long instrument and your response rate craters into self-selection (only the angry and the delighted answer); survey once a year and the data is stale before you can act and you can't tell whether a fix worked. Start quarterly, move to continuous-light only once the program has earned trust and you've automated the plumbing.

**Anonymity is the load-bearing wall.** This is not a nicety; it is the precondition for the data being real. The rules that hold a program together:

- **Report only at team or aggregate level, never individual.** A SPACE survey is designed to characterize a *system*, not a person. Results below a minimum group size (commonly **n ≥ 5**, often n ≥ 8–10 for sensitive items) are suppressed, because a "team of 3" result plus an org chart de-anonymizes everyone in it.
- **Decouple identity from response.** Either collect truly anonymously, or hold the identity↔response mapping behind a wall the people who make staffing decisions cannot reach. Engineers are not naive; if they suspect their manager can read their individual answers, they answer the way they think is safe, and you've spent budget to collect a politically-filtered fiction.
- **Never cross the streams into performance.** The survey results, and any individual-attributable system metric, must be structurally barred from performance reviews, promotion packets, and stack ranking. This isn't only an ethics position — it's what keeps the data honest, because the first time someone is dinged in a review over a metric, every future answer is strategic.
- **Say what you'll do with it, then do that.** State the purpose ("to find and fix the top friction in how we build software") up front, publish the results back to the people who filled it out, and show the actions taken. A survey whose results disappear into management trains people to stop answering.

> **The political reality:** the difference between a survey people answer honestly and one they game is entirely a function of whether they believe the answers can hurt them. Anonymity, aggregation, and a hard wall against performance use aren't bureaucratic overhead — they're the engineering that makes the instrument produce signal instead of noise. The moment that wall is breached once, visibly, the response rate and the honesty both collapse, and they do not come back for a long time.

---

## Combining SPACE with DORA and Flow

SPACE, DORA, and flow metrics answer different questions, and a mature program uses all three as one instrument rather than three competing scorecards.

- **DORA** answers *how fast and how safely does change reach production?* — the four keys: deployment frequency, lead time for changes, change failure rate, time to restore.
- **Flow** answers *where does work spend its time and wait?* — flow time, efficiency, load, and the wait states between stages.
- **SPACE** answers *how is the system experienced by the people inside it, and is it sustainable?* — and crucially supplies the perceptual and wellbeing signal the other two lack entirely.

The combination is powerful because each covers the others' blind spots. DORA can look elite while the team is being ground into burnout to keep it there — the deploy frequency is high, the lead time is low, and the senior engineers are quietly interviewing elsewhere. DORA cannot see that; the SPACE Satisfaction dimension can. Conversely, the survey might surface "deploys feel risky and slow" and DORA's change-failure-rate and lead-time numbers tell you whether that perception matches reality and where in the pipeline to look. Flow tells you the work is piling up in code review; the survey tells you *why* it feels bad (reviewers are overloaded, context is missing, the PRs are too big); DORA tells you whether fixing it actually moved lead time.

A clean way to structure the combined view, mapped to SPACE's dimensions:

| SPACE dimension | Perceptual (survey) | Behavioral (system / DORA / flow) |
|---|---|---|
| **S**atisfaction & wellbeing | eNPS, burnout risk, "I have the tools to do my job" | retention/attrition, on-call hours |
| **P**erformance | "we ship work we're proud of," quality perception | change failure rate, escaped defects, reliability/SLOs |
| **A**ctivity | (rarely surveyed) | deploy frequency, PR throughput — *context only* |
| **C**ommunication & collaboration | "reviews are timely and useful," meeting load | time-to-first-review, PR size, review depth |
| **E**fficiency & flow | "I can get into flow," "the build is fast enough" | lead time, flow efficiency, build/CI duration, wait states |

> **The synthesis:** DORA and flow tell you *what* the delivery system is doing; SPACE tells you *how it's experienced and whether it's sustainable*. Reporting them together — never DORA alone, never the survey alone — is what stops the two classic distortions: optimizing delivery numbers into a burnout machine, and chasing a "happiness" number with no link to whether you actually ship.

---

## Tooling — DX/GetDX, Jellyfish, or DIY

You have three broad options, and the right one depends on org size, how much you want to build, and how much you trust a vendor with your engineering data.

**Commercial DevEx platforms (DX/GetDX).** Purpose-built for exactly this: a research-backed survey instrument (the DX team includes SPACE/DevEx authors), industry benchmarks so you can see whether your numbers are normal, continuous and periodic survey modes, and the plumbing to combine perceptual data with system signals. The value is the validated survey and the benchmark — you skip the hard part of designing questions that actually measure what you think and getting a baseline to compare against. The cost is per-seat licensing and trusting a third party with sensitive engineering sentiment.

**Engineering-intelligence / SDLC-analytics platforms (Jellyfish, LinearB, Code Climate Velocity, Pluralsight Flow).** These lead with *system* metrics mined from Git, the issue tracker, and CI — cycle time, allocation, throughput, DORA dashboards — and increasingly bolt on survey capability. They're strong on the behavioral leg and on the "where does engineering time go" allocation question executives love. The risk is that they make the activity-dashboard failure mode *very* easy: the tool surfaces individual-attributable Git activity by default, and an inexperienced leader will reach straight for the per-developer commit chart. The tool isn't the problem; the governance you put around it is.

**DIY (survey tool + your existing data warehouse).** A survey platform (even a well-designed Google Form, Culture Amp, or Qualtrics) for the perceptual leg, plus your existing DORA/flow pipeline for the behavioral leg, joined in whatever you already use for analytics. The upside is total control over questions, anonymity guarantees, and where the data lives — which matters precisely because this data is sensitive. The downside is you own instrument design and benchmarking, and a badly-worded survey produces confident, wrong conclusions. DIY is the right call when you have a strong internal owner and want maximum control of the trust architecture; buy when you want a validated instrument and a benchmark fast.

| | DX/GetDX | Jellyfish / LinearB | DIY |
|---|---|---|---|
| Strength | Validated survey + benchmark | System metrics + allocation | Total control of questions & data |
| Perceptual leg | First-class | Bolted on | You design it |
| Surveillance risk | Lower (team-level by design) | **Higher** (per-dev activity is default) | Whatever you build |
| Setup cost | License | License | Engineering time |
| Best when | Want a validated survey fast | Want delivery analytics | Strong internal owner, sensitive data |

> **The selection principle:** choose the tool that makes the *right* thing easy and the *wrong* thing hard. A platform that puts a per-developer commit leaderboard on the landing page is optimizing for the exact failure this whole page is about — no matter how good its other features are, you'll spend your political capital fighting its defaults. Whatever you pick, the survey leg and the team-level guarantee are non-negotiable; everything else is convenience.

---

## The Political Reality — When Measurement Becomes Surveillance

Here is the central, uncomfortable truth of running this program: **the instant any productivity metric becomes an individual performance or stack-ranking input, it is gamed and trust collapses.** This is not a risk to manage; it is a near-certainty to design against, and it is the reason SPACE is *explicitly* defined at the team and system level.

The mechanism is Goodhart's law operating on humans who are not stupid. Tie compensation, promotion, or job security to a number, and people optimize the number rather than the thing it was a proxy for. Make commits a performance metric and you get more, smaller, emptier commits. Make PR count matter and big changes get sliced into reviewable-looking confetti. Make lines of code count and code gets verbose, copy-pasted, never deleted — the most valuable PR an engineer ever writes, the one that deletes ten thousand lines of dead code, scores *negative*. Make the survey results reflect on a manager's standing and the manager leans on the team to answer positively, and now the one honest signal you had is corrupted too.

Surveillance is the same dynamic applied to the perceptual leg. The survey works only because people answer honestly, and they answer honestly only while they believe the answers can't be traced to them and used against them. The failure mode is rarely a dramatic policy change; it's quieter — a manager asks "who on my team rated on-call so low?", or results get sliced to a team of three and everyone can infer who said what, or someone's lukewarm survey answers surface in a calibration meeting. Each of these is a one-way door. The first time the wall is breached visibly, every future answer becomes strategic, and you can never fully un-ring that bell.

Protecting the program is therefore a *design and governance* task, not a values statement:

- **Separate the two audiences structurally.** Improvement data (team-level, for the team and its leadership to act on) and any individual data (which should barely exist) live in different places with different access. The people who make staffing decisions cannot reach individual survey responses.
- **Refuse the "show me the underperformers" request — and have the reframe ready.** When a VP asks for an individual leaderboard, the answer is "SPACE measures systems, not people; here's what's slowing *every* team down and what it'll cost to fix" (see the executive conversation below). You will field this request repeatedly; treat it as part of the job, not an aberration.
- **Make the metrics deliberately hard to game by balancing them.** No single number stands alone; you report a basket across dimensions precisely so that gaming one (more commits) shows up as damage in another (worse quality, lower satisfaction). This is the senior-page lesson applied as a defense.
- **Be transparent about what's measured and why.** Secret measurement *is* surveillance, and people can tell. Publishing the questions, the aggregation rules, and the actions taken is what converts "they're watching us" into "they're trying to fix our problems."

> **The hard-won lesson:** the technical quality of your metrics is almost irrelevant compared to whether the people being measured trust the program. A mediocre survey that people answer honestly because they trust it beats a brilliant one they've learned to game. Protect the trust first; optimize the instrument second. Trust is the actual asset, and it is destroyed far faster than it is built.

---

## Using the Data to Act

A measurement program that doesn't change anything is worse than no program — it costs people time and goodwill and teaches them their input is ignored. The entire justification for collecting the data is the action it drives, and the action SPACE makes possible is *fixing the system*, not nudging individuals.

The survey's superpower is that it **ranks the friction**. Engineers will tell you, in aggregate and often in the free text, exactly what is slowing them down — and it is reliably a small number of system problems: builds are too slow, tests are flaky so nobody trusts CI, code review takes days, there are too many meetings to get into flow, the local dev environment takes an hour to set up, deploys are scary. These are *system* properties. No amount of telling individuals to "be more productive" touches them; you fix the system and everyone gets faster at once.

The act-on-it loop:

1. **Rank the friction.** From the survey (perceptual) corroborated by system signals (behavioral), produce a ranked list of the top few drags. Slow builds and flaky tests almost always rank near the top when present, because they tax *every* engineer on *every* change.
2. **Pick one or two, fund them as real work.** Put the fix in the actual backlog with an owner and capacity — not a "do it in your spare time" aspiration. "Cut p75 CI time from 22 to 8 minutes" is a project, not a wish.
3. **Tie it to a flow/DORA outcome.** A friction fix should move a hard number: faster builds and reliable tests shorten lead time and lift deploy frequency; faster reviews cut the wait state flow metrics expose; a stable test suite lowers change failure rate. This is how you prove the soft survey signal produced hard delivery improvement.
4. **Re-measure next cycle.** Did the survey item move? Did the system metric move? If both, you have a closed loop and a story. If the metric moved but the perception didn't, the fix wasn't the real friction — go back to the free text.

This loop is also the strongest argument for the program's existence and the answer to "why invest in developer experience?" DevEx is the lever for both **retention** and **delivery**. The same friction that makes the survey numbers bad — the slow builds, the flaky tests, the death-by-meetings, the unsustainable on-call — is what burns people out and makes them leave, *and* what slows delivery. Fixing it improves both at once. That dual payoff is exactly the bridge to the executive conversation.

> **The principle:** the survey doesn't tell you who to manage; it tells you what to fix. Treat every cycle's output as a prioritized list of *system* repairs, fund the top one or two as first-class work, and prove the fix with a moved DORA/flow number. A program that visibly fixes the #1 friction every quarter earns the trust (and response rate) that makes the *next* quarter's data even better — a virtuous loop that mirrors the vicious one surveillance creates.

---

## The Executive Conversation — DevEx in Business Terms

"Developer experience" means nothing to a CFO, and "developer satisfaction is at 6.2" means less. To get friction-fixing work funded and to fend off the individual-leaderboard request, you have to translate the program's findings into the only language the executive layer prices: **money, speed, and risk.** The translation is not spin — the business effects are real and large — it's a matter of stating them in the right units.

The three translations that land:

- **Retention cost.** Attrition has a hard price tag: replacing a senior engineer typically runs **6–12+ months of their salary** once you count recruiting, ramp-up, lost institutional knowledge, and the productivity dip of the team absorbing the gap — often well into six figures per departure. When the survey shows burnout risk rising or satisfaction falling in a team, that is a *leading indicator of attrition*, and attrition is a budget line. "Two senior engineers on this team are at high burnout risk; if they leave, that's roughly a year of replacement cost each plus a quarter of delivery slippage" is a sentence a CFO understands. Soft survey signal, hard dollar consequence.
- **Delivery speed.** Friction is slower delivery, and slower delivery is delayed revenue and slower response to competitors and incidents. "Engineers spend ~30% of their time waiting on builds and reviews; cutting that frees the equivalent of N engineers of capacity without hiring" reframes a tooling investment as a capacity investment with an ROI. Tie it to the DORA lead-time number to make it concrete and defensible.
- **The cost of a burned-out senior leaving.** This is the sharpest version of the retention point and worth isolating, because a senior departure is not a linear loss. It's the replacement cost *plus* the knowledge that walks out the door, *plus* the morale hit to the people left behind (which often triggers further departures), *plus* the months before a replacement is net-positive. One burned-out staff engineer leaving can cost more and hurt delivery longer than several junior departures combined. Framing DevEx investment as *insurance against that specific, expensive event* makes the case viscerally.

The structural move in every one of these is the same: connect a *perceptual* SPACE signal to a *business* outcome via a believable mechanism. Satisfaction → retention → replacement cost and lost delivery. Efficiency/flow → wait time → capacity and time-to-market. You are not asking the executive to care about engineer happiness for its own sake (though they should); you're showing that the survey is an early-warning system for expensive business events, and that the friction-fixing work is a positive-ROI investment in capacity and a hedge against costly attrition.

> **The executive reality:** the program survives budget season only if it speaks the business's language. "Satisfaction is down" gets nodded at and forgotten; "we're at elevated risk of losing two seniors, that's ~$600K and a delayed roadmap, and here's the $80K of platform work that addresses the root cause" gets funded. Learn to make that translation fluently — it's the difference between a program that fixes things and one that quietly gets defunded as a nice-to-have.

---

## The McNamara Fallacy — Don't Discard the Soft Signal

The **McNamara fallacy** is the error of making the measurable important instead of making the important measurable: you focus on the numbers that are easy to quantify, downgrade the things that are hard to quantify, and eventually behave as if the hard-to-quantify things don't exist at all. It's named for Robert McNamara's Vietnam-era reliance on body counts — a precise, measurable, and disastrously incomplete picture of the war.

It is the most seductive failure mode in a metrics program staffed by engineers, because engineers love hard numbers and distrust soft ones. Deploy frequency, lead time, build duration — these are crisp, automatable, and feel objective. Satisfaction, wellbeing, "do you feel you can get into flow," "is the on-call burden sustainable" — these are squishy, survey-derived, and feel unscientific. The fallacy is to therefore quietly drop the soft dimension and run the program on the hard numbers alone. That's how you end up with the elite-DORA-burnout-machine: every measurable delivery number is green, the unmeasured human cost is invisible, and you find out it was real when the seniors resign.

SPACE was *designed* as a direct corrective to this. The **Satisfaction and wellbeing dimension is deliberately first**, and it's perceptual on purpose — because the most important property of a sustainable engineering org (are the people okay, is this pace survivable, do they have what they need) cannot be read off a Git log. The soft signal is not lesser data; it's the *only* data for the thing that ultimately determines whether your delivery numbers are durable or borrowed against the team's future.

The discipline this demands:

- **Keep the unmeasurable in the conversation even though it's soft.** Burnout, morale, and sustainability are real whether or not they reduce to a clean number. Report the survey's satisfaction signal alongside the hard metrics, every time, and resist the pull to drop it because it's "just a survey."
- **Don't let "we can't measure it precisely" become "it doesn't count."** A noisy, perceptual signal about wellbeing beats a precise number about commits for predicting whether your best people stay. Imprecise data about the right thing outranks precise data about the wrong thing.
- **Use the soft signal as the early warning the hard signals can't be.** Satisfaction and burnout-risk are *leading* indicators; attrition and a collapse in delivery are the *lagging* ones. By the time the hard numbers show the damage, the seniors have already left. The whole value of the soft dimension is that it moves first.

> **The synthesis:** the hard numbers and the soft signal are not rivals to be ranked — they're complements, and the soft one is load-bearing precisely because it covers what the hard ones structurally can't. The McNamara fallacy is the slow drift toward running on the easy data alone; SPACE's first dimension exists to stop that drift. Keep the satisfaction signal in the room even when — especially when — it's the only thing flashing yellow.

---

## War Stories

**The activity leaderboard that tanked morale.** A platform team rolled out an engineering-intelligence tool and, with good intentions, surfaced its default view: a per-developer leaderboard of commits, PRs merged, and lines changed, visible to managers and to the whole org. Within two sprints the behavior changed exactly as Goodhart predicts — engineers split work into tiny commits, padded PR counts, and avoided the high-value, low-line-count work (deleting dead code, careful design, mentoring a junior, the gnarly bug that takes three days and one line) because none of it scored. The best engineer on the team, who spent her time unblocking others and doing the hard invisible work, ranked near the bottom and was visibly demoralized. Trust in "metrics" collapsed; the next developer-experience survey saw a double-digit drop in response rate and a spike in cynical free-text. The leaderboard was killed, but the trust took a year to rebuild. The lesson: an individual activity metric doesn't just fail to measure productivity — it actively destroys the thing it claims to measure and poisons every adjacent signal.

**The DevEx survey that found flaky tests were the #1 drag — and fixing them lifted everything.** A 400-engineer org ran its first quarterly DevEx survey expecting the top complaint to be something org-political. Instead, both the ranked questions and the free-text overwhelmingly pointed at one thing: the test suite was flaky, so nobody trusted CI, so people re-ran builds repeatedly, merged on red "because it's probably the flake," and lost hours to phantom failures. The system signals confirmed it — a large share of CI runs failed non-deterministically and median time-to-merge was inflated by re-runs. They funded it as real work: quarantined and fixed the flakiest tests, added retry-with-isolation and flake detection, and made green mean green. The next survey's efficiency and satisfaction items jumped, *and* the hard numbers moved with them — lead time dropped, deploy frequency rose, change failure rate fell because people stopped merging on red. One system fix, surfaced by the survey and validated by DORA, lifted the whole org. The lesson: the survey's job is to *rank the friction*, and the top item is often a single concrete system problem that, once fixed, pays off across every metric at once.

**The satisfaction metric that predicted attrition.** A team's DORA numbers were excellent — top-quartile deploy frequency and lead time — and leadership held it up as a model. The only warning sign was the SPACE survey: the satisfaction and burnout-risk items for that team had been sliding for two cycles, and the free-text mentioned unsustainable on-call and no slack to breathe. Because the program reported the soft signal alongside the hard one, the eng director took it seriously and flagged retention risk — but the broader org, trusting the green delivery dashboard, didn't move fast enough. Over the next two quarters three senior engineers left, on-call collapsed onto the remaining people, and the once-elite delivery numbers cratered as the team spent two more quarters rebuilding. The satisfaction signal had called it two quarters early; the hard numbers only confirmed the damage after it was done. The lesson: the soft, perceptual wellbeing signal is a *leading* indicator of attrition that the hard delivery metrics structurally cannot be — discard it as "just a survey" and you find out the expensive way.

---

## Decision Frameworks

**Survey, system signals, or both? Ask:**
- Do I need to know what developers *experience* (satisfaction, perceived friction)? → you need the **survey**; no system metric substitutes for it.
- Do I need to corroborate perception with behavior, or measure delivery speed/quality? → add **system signals** (DORA/flow).
- Do I want to fix the right thing with confidence? → **both, triangulated** — perception ranks the friction, system data confirms and quantifies it.

**Buy (DX/Jellyfish) or build (DIY)? Ask:**
- Do I want a validated survey instrument and an industry benchmark fast, with little instrument-design risk? → **buy** (DX/GetDX for the survey leg).
- Do I want delivery/allocation analytics and DORA dashboards primarily? → an engineering-intelligence platform — *with governance against its per-developer defaults*.
- Do I have a strong internal owner and need maximum control over questions, anonymity, and where sensitive data lives? → **DIY**.
- Whatever I pick: does it make team-level easy and individual-leaderboard hard? → if not, expect to spend political capital fighting its defaults.

**What cadence? Ask:**
- Just starting / want full-dimension depth aligned to planning? → **quarterly deep**.
- Program is trusted, plumbing automated, want a fresh trend line? → **continuous-light** sampling.
- Tempted by monthly long-form? → don't; response rate craters into self-selection.

**Can this metric become an individual input? Ask (and the answer is almost always no):**
- Could it be tied to comp, promotion, or stack ranking? → then it *will* be gamed and trust *will* collapse — keep it strictly team/system level.
- Is the survey result attributable to a person at this group size? → suppress below n ≥ 5 (more for sensitive items).

**How do I get the fix funded? Ask:**
- What business outcome does this friction map to? → **retention cost** (satisfaction → attrition → replacement $), **delivery speed** (efficiency → wait time → capacity/time-to-market), or **risk** (a burned-out senior leaving).
- Can I state it in money, speed, or risk units? → if not, it won't survive budget season.

---

## Mental Models

- **The survey is the asset; the dashboard is the trap.** Anyone can build an activity dashboard in a week. The hard, valuable thing is a trusted survey whose results visibly change how the org spends engineering time. Don't build the easy half and skip the useful one.

- **Trust is the actual instrument.** A mediocre survey people answer honestly beats a brilliant one they've learned to game. Anonymity, aggregation, and a hard wall against performance use are the engineering that makes the data real. Trust is destroyed far faster than it's built.

- **The moment a metric becomes an individual input, it stops measuring and starts being gamed.** This is Goodhart's law on humans who aren't stupid. SPACE is team/system level *by design* for exactly this reason.

- **The survey ranks the friction; you fix the system.** It doesn't tell you who to manage — it tells you what's slowing *everyone* down (slow builds, flaky tests, review latency, too many meetings). Fix the system and everyone gets faster at once.

- **DORA tells you what the delivery system does; SPACE tells you how it's experienced and whether it's sustainable.** Report them together — elite delivery numbers can be a burnout machine, and only the soft signal sees it.

- **The soft signal is the early warning the hard signals can't be.** Satisfaction and burnout-risk lead; attrition and a delivery collapse lag. By the time the Git log shows the damage, the seniors have already resigned.

- **Translate to money, speed, or risk or it won't get funded.** "Satisfaction is down" gets forgotten; "we're at risk of losing two seniors — ~$600K and a delayed roadmap" gets funded.

---

## Common Mistakes

1. **Shipping an activity dashboard and calling it a productivity program.** A wall of commits and PR counts is the easiest data to collect, the least useful, and the seed of every later failure. You need the *survey* — the perceptual leg — and you need to act on it.

2. **Letting any metric become an individual performance input.** The instant it touches comp, promotion, or stack ranking, it's gamed and trust collapses — including the survey, which gets answered strategically. Keep everything team/system level. This is the single most damaging mistake on this page.

3. **Breaching survey anonymity, even once.** Slicing results to a team of three, a manager asking "who rated this low," answers surfacing in calibration — each is a one-way door. Suppress below n ≥ 5, decouple identity from response, and bar it from performance use.

4. **Collecting the data and not acting on it.** A survey whose results vanish into management trains people to stop answering. Fund the top friction as real work every cycle and show the actions taken — visible action is what sustains the response rate.

5. **Reporting SPACE or DORA in isolation.** DORA alone hides burnout; the survey alone has no link to delivery. Report them together so you catch both the burnout machine and the disconnected-happiness number.

6. **The McNamara fallacy — dropping the soft dimension because it's soft.** Engineers gravitate to crisp Git numbers and quietly discard satisfaction as "just a survey." That's how you build an elite-delivery burnout machine and learn the cost when the seniors leave. Keep the wellbeing signal in the room.

7. **Pitching DevEx to executives in DevEx terms.** "Developer satisfaction is at 6.2" means nothing to a CFO. Translate to retention cost, delivery capacity, and the price of a burned-out senior leaving, or the friction-fixing work won't get funded.

8. **Buying a tool whose defaults fight you.** A platform that leads with a per-developer commit leaderboard optimizes for the exact failure you're trying to prevent. Pick tools that make team-level easy and individual-leaderboard hard.

---

## Test Yourself

1. A VP asks you to "show me which engineers are underperforming" using your SPACE data. Explain why this request is the core danger of the whole program, what specifically goes wrong if you comply, and how you reframe it.
2. Why is the survey — not the system-metrics dashboard — the load-bearing half of a SPACE program? What dimension can *only* come from the survey?
3. List four design rules that protect a developer-experience survey from becoming surveillance, and explain why each one keeps the *data* honest (not just why it's ethical).
4. Your DORA numbers for a team are elite, but the SPACE satisfaction and burnout-risk items have slid for two cycles. What does this combination most likely predict, and why can't the DORA numbers see it?
5. The survey's #1 ranked friction is "flaky tests / I don't trust CI." Walk through the act-on-it loop: how do you confirm it, fund it, tie it to a hard metric, and prove the fix worked?
6. Translate "developer satisfaction is declining on the payments team" into three sentences a CFO would act on. Name the business units (money/speed/risk) you're converting into.
7. Define the McNamara fallacy and explain how SPACE's design directly counters it. Why is the satisfaction signal a *leading* indicator while attrition is a *lagging* one?

<details>
<summary>Answers</summary>

1. The request would make a SPACE number an **individual performance input**, which triggers Goodhart's law: people optimize the metric instead of the work (more, emptier commits; sliced PRs; strategically-answered surveys), and the trust that lets them answer honestly collapses — corrupting the *one* signal (the survey) you can't get any other way. SPACE is team/system level *by design*. **Reframe:** "SPACE measures systems, not people; here's what's slowing *every* team down — slow builds, review latency — and what it'll cost to fix," then convert to retention/delivery/risk for the exec.
2. The dashboard measures what developers *do* (activity, behavior), which the Git/CI systems already emit; only the survey measures what developers *experience*. The **Satisfaction and wellbeing dimension can come *only* from the survey** — there is no Git log for "is the on-call burden sustainable" or "can I get into flow" — and it's the most reliable source for perceived efficiency and communication too.
3. (a) **Report only at team/aggregate level (suppress below n ≥ 5)** — a small-group result plus the org chart de-anonymizes people, so they answer strategically; aggregation keeps answers safe and therefore honest. (b) **Decouple identity from response / hold it behind a wall staffing-decision-makers can't reach** — if people suspect their manager can read individual answers, they answer "safe," producing a politically-filtered fiction. (c) **Bar it structurally from performance reviews/promotion/stack ranking** — the first time someone's dinged over a metric, every future answer becomes strategic. (d) **State the purpose and publish results + actions** — secret measurement is surveillance and people can tell; visible action converts "they're watching us" into "they're fixing our problems," sustaining honest participation.
4. It predicts **imminent attrition / burnout** — an "elite-DORA-but-burnout-machine": the delivery numbers are green because the team is being ground to keep them there. DORA measures only delivery *throughput and stability* (deploy freq, lead time, CFR, restore time); it has **no perceptual or wellbeing dimension**, so it structurally cannot see that the people producing those numbers are about to leave. The satisfaction signal is the leading indicator the hard numbers can't be.
5. **Confirm:** corroborate the survey ranking with system signals (share of non-deterministic CI failures, re-run rate, time-to-merge inflation). **Fund:** put it in the real backlog with an owner and capacity — quarantine/fix the flakiest tests, add flake detection, make green mean green — not a spare-time wish. **Tie to a hard metric:** reliable tests should shorten lead time, raise deploy frequency, and lower change failure rate (people stop merging on red). **Prove it:** re-measure next cycle — did the survey's efficiency/satisfaction item move *and* did the DORA numbers move? Both moving = a closed loop and a fundable story.
6. e.g.: "Satisfaction and burnout-risk on payments have slid two quarters, which is our earliest signal of senior attrition." / "If the two at-risk seniors leave, that's roughly a year of salary each to replace plus a quarter-plus of roadmap slippage — well into six figures." / "An $80K platform investment in the build/review friction they're citing addresses the root cause and frees capacity now." Units converted: **risk** (attrition early-warning), **money** (replacement cost), **speed/money** (delivery capacity).
7. The **McNamara fallacy** is making the measurable important rather than making the important measurable — focusing on easy-to-quantify numbers and behaving as if the hard-to-quantify things don't exist (named for body counts in Vietnam). SPACE counters it by making **Satisfaction/wellbeing the deliberately-first, perceptual dimension** — forcing the soft-but-critical signal (sustainability, morale) to stay in the conversation alongside the crisp Git numbers. Satisfaction is **leading** because it reflects how people feel *before* they act on it; attrition and delivery collapse are **lagging** because they're the downstream consequence — by the time the hard numbers show damage, the seniors have already gone.

</details>

---

## Cheat Sheet

```
THE TWO LEGS OF A SPACE PROGRAM
  SURVEY (perceptual)   ← the ASSET; only source of Satisfaction; 10-20 Q, <5 min, free-text box
  SYSTEM SIGNALS (behav)← from DORA/flow; small set; corroborate, don't replace
  → TRIANGULATE → rank friction → FIX SYSTEM → re-measure

THE ONE RULE THAT BREAKS EVERYTHING IF VIOLATED
  metric becomes individual perf/stack-rank input → gamed + trust collapses
  SPACE is TEAM/SYSTEM level BY DESIGN. No exceptions.

ANONYMITY = THE LOAD-BEARING WALL
  report team/aggregate only; suppress below n >= 5 (more for sensitive)
  decouple identity from response; bar from perf reviews/promo
  state purpose, publish results + ACTIONS taken
  breach it ONCE (visibly) → response rate + honesty collapse, don't recover fast

CADENCE
  quarterly deep   ← start here; full dimensions, aligns to planning
  continuous-light ← once trusted + automated; fresh trend line
  monthly long-form → DON'T; response rate craters into self-selection

SPACE + DORA + FLOW
  DORA  = what the delivery system DOES (speed + safety)
  FLOW  = where work waits
  SPACE = how it's EXPERIENCED + is it sustainable (the perceptual/wellbeing leg)
  report TOGETHER → catches the elite-but-burnout-machine

TOOLING
  DX/GetDX     validated survey + benchmark (lower surveillance risk)
  Jellyfish/LinearB  system metrics + allocation (HIGH surveillance risk: per-dev default)
  DIY          total control of Qs + data (you own instrument design)
  RULE: pick the tool that makes team-level EASY, leaderboard HARD

ACT ON IT
  survey RANKS friction (slow builds, flaky tests, review latency, meetings)
  fund top 1-2 as REAL work → tie to DORA/flow number → prove it moved
  DevEx = lever for RETENTION + DELIVERY (same friction burns people AND slows ship)

EXEC TRANSLATION (or it won't get funded)
  satisfaction ↓ → attrition → REPLACEMENT COST (senior = 6-12+ mo salary)
  efficiency ↓   → wait time → CAPACITY / time-to-market
  burned-out senior leaving → MONEY + lost knowledge + morale hit + slow ramp
  speak money / speed / risk — never "satisfaction is 6.2"

McNAMARA FALLACY
  making the measurable important > making the important measurable
  don't drop the soft signal because it's soft — it's the LEADING indicator
  attrition/collapse = LAGGING; by then the seniors already left
```

---

## Summary

- A SPACE program has **two legs**: a periodic **developer-experience survey** (the perceptual signal — the only source of the Satisfaction dimension and the load-bearing asset) and a small set of **system/workflow metrics** from your DORA/flow pipeline (the behavioral signal). You **triangulate** them, rank the friction, fix the system, and re-measure. The activity dashboard alone is the trap.
- The one constraint that breaks everything: **the instant any metric becomes an individual performance or stack-ranking input, it's gamed and trust collapses.** SPACE is **team/system level by design** for exactly this reason. You will field the "show me the underperformers" request repeatedly — refuse it and reframe to system-level friction.
- **Anonymity is the load-bearing wall.** Report team/aggregate only (suppress below ~n ≥ 5), decouple identity from response, bar it from performance use, and publish results plus the actions taken. Breaching it once, visibly, collapses both response rate and honesty — and they don't come back quickly. Protecting trust matters more than the technical quality of the metrics.
- **Combine SPACE with DORA and flow.** DORA says what the delivery system *does*, flow says where work *waits*, SPACE says how it's *experienced and whether it's sustainable*. Report them together so you catch the elite-DORA-but-burnout-machine that the hard numbers structurally can't see.
- **Use the data to act:** the survey *ranks the friction* (slow builds, flaky tests, review latency, too many meetings); you fund the top one or two as real work, tie the fix to a moved DORA/flow number, and re-measure. DevEx is the lever for **retention and delivery** at once.
- **Win the executive conversation** by translating DevEx into **money, speed, and risk** — replacement cost of attrition, freed capacity, the specific expensive event of a burned-out senior leaving. And **avoid the McNamara fallacy**: don't discard the soft satisfaction signal because it's soft — it's the *leading* indicator of attrition that the hard delivery metrics only confirm after the damage is done.

You can now stand up and defend a developer-productivity program at org scale. The remaining tier — [interview.md](interview.md) — consolidates SPACE into the questions that probe whether someone actually understands measuring productivity without corrupting it.

---

## Further Reading

- Forsgren, Storey, Maddila, Zimmermann, Butler & Houck — *The SPACE of Developer Productivity* (ACM Queue, 2021) — the framework's primary source and the team/system-level mandate.
- Noda, Storey, Forsgren & Greiler — *DevEx: What Actually Drives Productivity* (ACM Queue, 2023) — flow, feedback loops, and cognitive load as the actionable lenses for the survey.
- Forsgren, Humble & Kim — *Accelerate* and the DORA / State of DevOps reports — the delivery-metrics half you combine SPACE with.
- The GetDX research and engineering benchmarks — a worked example of survey + system-signal instrumentation and industry baselines.
- Martin Fowler — *CannotMeasureProductivity* — why a single productivity number is a fool's errand, and the case for proxies used carefully.
- Charles Goodhart / Donald Campbell — Goodhart's and Campbell's laws — the mechanism behind every "metric becomes a target, then a lie" failure on this page.

---

## Related Topics

- [06 — Metrics Anti-Patterns & Goodhart](../06-metrics-anti-patterns-and-goodhart/professional.md) — the full failure surface: measuring individuals, vanity/weaponized metrics, and the McNamara fallacy this page defends against.
- [05 — Quality & Reliability Metrics](../05-quality-and-reliability-metrics/professional.md) — the Performance-dimension system signals (change failure rate, escaped defects, SLOs) that corroborate the survey.
- [junior.md](junior.md) — what the five SPACE dimensions are and why productivity isn't one number.
- [senior.md](senior.md) — choosing a balanced metric basket across the dimensions so no single one can be gamed in isolation.
- [interview.md](interview.md) — the questions that test whether you can measure productivity without corrupting the behavior you measure.
