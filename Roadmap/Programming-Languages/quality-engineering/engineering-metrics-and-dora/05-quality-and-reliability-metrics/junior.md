# Quality & Reliability Metrics — Junior Level

> **Roadmap:** [Engineering Metrics & DORA](../README.md) → Quality & Reliability Metrics
> *Shipping fast is only half the job. The other half is: does what you shipped actually work, and does it stay up? These are the numbers that tell you — the counterweight to raw speed.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concept 1 — Why Quality Balances Speed](#core-concept-1--why-quality-balances-speed)
5. [Core Concept 2 — Change Failure Rate & MTTR](#core-concept-2--change-failure-rate--mttr)
6. [Core Concept 3 — Availability and the "Nines"](#core-concept-3--availability-and-the-nines)
7. [Core Concept 4 — Escaped Defects](#core-concept-4--escaped-defects)
8. [Core Concept 5 — SLOs and Error Budgets](#core-concept-5--slos-and-error-budgets)
9. [Real-World Examples](#real-world-examples)
10. [Mental Models](#mental-models)
11. [Common Mistakes](#common-mistakes)
12. [Test Yourself](#test-yourself)
13. [Cheat Sheet](#cheat-sheet)
14. [Summary](#summary)
15. [Further Reading](#further-reading)
16. [Related Topics](#related-topics)

---

## Introduction

> Focus: **The numbers that tell you if what you ship actually works — and stays up.**

There's a metric everyone loves to talk about: how *fast* a team ships. Deploys per day, lead time in hours, "we move quick." Speed is exciting, it's visible, and it's easy to brag about. But speed on its own answers only one question — *how often do we change things?* — and stays silent on the question that actually keeps a service alive: *do those changes work?*

Imagine two teams. Team A deploys ten times a day. Team B deploys ten times a day. Identical speed. But Team A's deploys quietly take the checkout page down twice a week, and each outage takes three hours to fix. Team B's deploys almost never break, and on the rare day one does, they roll it back in four minutes. Same speed, wildly different teams. The difference is invisible until you measure **quality and reliability** — and those are exactly the numbers this page is about.

This is the counterweight to the speed metrics you met in [01 — The DORA Four Keys](../01-dora-four-key-metrics/junior.md). You'll learn four reliability numbers in plain terms — **change failure rate** (how often a deploy causes a problem), **MTTR / time to restore** (how fast you recover), **availability** (the percentage of time the service works, the famous "nines"), and **escaped defects** (bugs that reached real users instead of getting caught earlier). Then the single most important idea in the whole topic: speed and quality are **not** a trade-off. The best teams are fast *and* stable, and they get both from the same set of good habits.

> **The mindset shift:** speed without stability is not "moving fast" — it's *breaking things faster*. A team that doubles its deploys while doubling its outages hasn't improved; it's just failing more often, more quickly. Real progress means the speed numbers and the reliability numbers both get better. If one is climbing while the other rots, you're measuring only half the system.

---

## Prerequisites

- **Required:** You understand what "deploying" means — pushing a new version of an app or service so users get the change.
- **Required:** You've seen, used, or heard of a service being "down" — a website that won't load, an app showing an error, an API returning failures.
- **Helpful:** You've read [01 — The DORA Four Keys](../01-dora-four-key-metrics/junior.md), since two of those four keys (change failure rate and time to restore) *are* reliability metrics. This page zooms in on them.
- **Helpful:** You've heard a phrase like "we're targeting four nines" or "we blew our error budget" and weren't sure what it meant. You will be by the end.

---

## Glossary

| Term | Plain-English meaning |
|---|---|
| **Change failure rate (CFR)** | Of all your deploys, the percentage that cause a problem (an outage, a bug, a rollback). Lower is better. |
| **MTTR / time to restore** | How long it takes to get the service working again *after* something breaks. "Mean Time To Restore/Recovery." Lower is better. |
| **Availability / uptime** | The percentage of time the service is actually working. Usually written as a number of "nines" — 99.9%, 99.99%. |
| **The "nines"** | Shorthand for availability. "Three nines" = 99.9%. Each extra nine means roughly 10× less downtime allowed. |
| **Downtime** | Time the service is *not* working. The opposite of uptime. |
| **SLO (Service Level Objective)** | A target you set for reliability — e.g. "99.9% of requests succeed this month." A promise to yourselves. |
| **Error budget** | The small amount of failure your SLO *allows*. If you promise 99.9%, the 0.1% you're permitted to fail is your budget to spend. |
| **Escaped defect** | A bug that got past your tests and reviews and reached real users. It "escaped." |
| **Rollback** | Putting the previous, known-good version back when a new deploy goes wrong. The fastest way to recover. |

---

## Core Concept 1 — Why Quality Balances Speed

Speed metrics ask *how often* and *how quickly* you change the system. Quality metrics ask *whether those changes worked* and *whether the system stays up*. You need both, because each one without the other is a lie.

Picture a dashboard with only the speed half:

```
DEPLOYS PER DAY:  12   ▲ up 50% this quarter!
LEAD TIME:        3h   ▲ faster than ever!
```

Looks fantastic. Now add the missing half:

```
DEPLOYS PER DAY:  12   ▲ up 50%
LEAD TIME:        3h   ▲ faster
CHANGE FAILURE:   40%  ◀ 2 of every 5 deploys break something
TIME TO RESTORE:  4h   ◀ and each break takes half a day to fix
```

This team isn't winning. It's shipping breakage at high speed and then spending half its life cleaning up. The speed numbers, *alone*, actively hid the problem. That's why quality metrics are described as the **balance** to speed: they're the other side of the scale, and looking at one side tells you nothing about whether the thing is actually working.

> **Key insight:** A metric you can improve by being *reckless* is not a good metric on its own. You can boost deploy frequency just by shipping carelessly — until you also track failure rate and recovery time, which punish recklessness. Speed and quality metrics are designed to be read *together*: each one catches the way the other can be cheated.

Here's the trap to avoid before we even get to the good news. Many people assume there's a dial: turn it toward "fast" and you get more breakage; turn it toward "safe" and you slow down. *Pick one.* That assumption feels obvious and is one of the most important things in this entire roadmap to **un**-learn — which is exactly what the next few concepts, and the big idea at the end, are here to do.

---

## Core Concept 2 — Change Failure Rate & MTTR

These are the two most fundamental reliability numbers, and they answer two different questions: **how often do we break things?** and **how fast do we recover when we do?** A healthy team needs good answers to both.

### Change Failure Rate (CFR) — how often a deploy goes wrong

Change failure rate is the percentage of your deployments that cause a problem in production — an outage, a serious bug, a degradation, anything that needs an urgent fix or a rollback. The formula is as plain as it sounds:

```
                  deploys that caused a problem
CFR  =  ─────────────────────────────────────────  × 100%
                  total deploys
```

A worked example. Last month your team deployed **50** times. Of those, **5** caused something to break — a bad release, a broken page, a rollback. Your change failure rate is:

```
CFR = 5 / 50 × 100% = 10%
```

Read that as: *one in ten of our deploys causes a problem.* The lower this number, the more often your changes land cleanly. Elite teams keep it low (roughly 15% or less by DORA's research); a CFR of 40% means nearly half of everything you ship breaks — a sign your changes are too big, too rushed, or too poorly tested.

### MTTR / Time to Restore — how fast you bounce back

Things will break. Even the best teams have a non-zero failure rate. So the second question matters just as much: **when** something breaks, how long until users are okay again? That's your **time to restore** (often called MTTR — mean time to restore, or recover).

It's not measured in code — it's measured on the clock. Something breaks at 2:00 PM; users are working again at 2:08 PM; your time to restore for that incident was **8 minutes**.

> **Key insight:** CFR and MTTR are a team. CFR is about *prevention* (break less); MTTR is about *recovery* (heal faster). You will never drive CFR to zero — so a low MTTR is what keeps a failure from becoming a disaster. A team that breaks something once a week but recovers in 5 minutes is in far better shape than one that breaks rarely but takes 6 hours to crawl back each time. The single biggest lever on MTTR for a beginner to know: a fast, reliable **rollback**. If you can instantly put the last good version back, "recovery" is often just one button.

---

## Core Concept 3 — Availability and the "Nines"

**Availability** (or **uptime**) is the percentage of time your service is actually working. If your service answered requests correctly for 999 out of every 1,000 minutes, it was 99.9% available. Simple idea — but the numbers get interesting because of how unforgiving each extra "9" is.

People say availability in **nines**: "three nines" means 99.9%, "four nines" means 99.99%, and so on. Each additional nine cuts your *allowed downtime* by roughly 10×. The gap between "pretty good" and "excellent" is much larger than it looks, because you're chasing the tiny sliver of failure that's left.

Here's the table worth memorizing — how much downtime each availability level actually permits:

| Availability | Nickname | Downtime per **year** | Downtime per **month** | Downtime per **day** |
|---|---|---|---|---|
| 99% | "two nines" | ~3.65 days | ~7.2 hours | ~14.4 minutes |
| 99.9% | "three nines" | ~8.76 hours | ~43.2 minutes | ~1.4 minutes |
| 99.99% | "four nines" | ~52.6 minutes | ~4.3 minutes | ~8.6 seconds |
| 99.999% | "five nines" | ~5.26 minutes | ~26 seconds | ~0.86 seconds |

Sit with that for a moment. **99%** sounds great in everyday life — but it allows over *three and a half days* of downtime a year, which for a paid service is unacceptable. **99.9%** — the most common real-world target for ordinary services — gives you about **43 minutes a month** to play with: one bad deploy with a slow rollback can eat your entire month's budget in a single afternoon. **99.999%** ("five nines," the gold standard people love to quote) allows roughly **five minutes a year** — so little that no human can respond in time; you have to engineer the recovery to be automatic.

> **Key insight:** Each nine is roughly **10× harder** than the one before, because you're fighting for an ever-smaller remainder. Going from 99% to 99.9% means cutting allowed downtime from days to hours; from 99.9% to 99.99% means cutting it from hours to *minutes*. This is why "we want 100% uptime" is not a goal — it's a fantasy. 100% is impossible (networks fail, hardware dies, deploys go wrong), and chasing the last fraction costs more than it's ever worth. The grown-up question is never "how do we never go down?" but **"how much downtime can we actually tolerate, and what's the right target?"** — which leads straight to the next concept.

---

## Core Concept 4 — Escaped Defects

Not every quality problem is a dramatic outage. Most are plain old **bugs** — and the question that matters for measuring quality is *where they get caught*. A bug caught by a unit test on your laptop costs almost nothing. The *same* bug, discovered by a paying customer in production, costs support tickets, lost trust, an emergency fix, and possibly an outage. The metric that tracks this is **escaped defects**: bugs that slipped past all your checks and reached real users.

Think of your development process as a series of nets, each one catching bugs before they fall to the next level:

```
                 cheap to catch  ┃  expensive to catch
  you write code  →  unit tests  →  code review  →  QA / staging  →  PRODUCTION (users)
                    ╲___________________ caught here = good ___________________╱   ╲ ESCAPED ╱
```

A bug caught early (a test fails, a reviewer spots it) is a *win* — the net did its job. A bug that falls all the way through to production is an **escaped defect** — every net missed it, and now your users are the ones who found it. The count of these, over time, is a direct read on how good your safety nets actually are.

> **Key insight:** The cost of a bug grows dramatically the later it's caught. The same mistake is nearly free at the unit-test stage, mildly annoying in review, costly in QA, and genuinely damaging in production — where it can mean a real outage and real lost trust. So a rising escaped-defect count isn't just "more bugs"; it's a signal that your *cheap, early* nets (tests, reviews) are too weak, pushing bug-catching to the *most expensive possible place*: your customers. The fix is rarely "test more at the end" — it's "catch more, earlier."

You don't need fancy tooling to start. Counting how many bugs were reported by users *after* a release — versus how many your tests and reviews caught *before* it — already tells you whether your safety nets are tightening or fraying over time.

---

## Core Concept 5 — SLOs and Error Budgets

You've seen that 100% uptime is impossible and that chasing the last fraction is wasteful. So how do teams decide *how reliable is reliable enough*? Two beautifully simple ideas: the **SLO** and the **error budget**.

### SLO — the promise you make

An **SLO** (Service Level Objective) is a reliability *target* you set on purpose. For example: *"99.9% of requests will succeed each month."* It's a promise — usually to yourselves, sometimes to customers — about how good the service will be. Not 100% (impossible), not "as good as we can manage" (meaningless), but a specific, chosen number you can actually measure yourselves against.

### Error budget — the failure you're allowed to spend

Here's the clever part. If you promise **99.9%**, then you are explicitly allowing **0.1%** of things to fail. That 0.1% isn't a shameful secret — it's a **budget** you're allowed to spend:

```
  SLO:           99.9% of requests succeed this month
  Error budget:  the remaining 0.1%  →  about 43 minutes of downtime this month
                 (that's your allowance — failure you've decided is acceptable)
```

This reframes failure from "never allowed" to "allowed, in a known amount." And that unlocks a genuinely useful way to make decisions:

- **Budget left over?** The service is healthier than your promise requires. You can afford to take risks — ship that big feature, run that experiment, deploy on a Friday. A little failure is *fine*; you've got room.
- **Budget used up?** You've already failed as much as you promised you would. Now is the time to *stop* shipping risky changes and spend effort on stability — fixing flaky parts, hardening deploys — until you've earned the budget back.

> **Key insight:** The error budget turns "speed vs. reliability" from an endless argument into a number anyone can read. Instead of one person shouting "ship it!" and another shouting "it's too risky!", you both look at the budget. Lots left → lean toward speed. None left → lean toward stability. The budget itself decides, automatically and fairly. That's the whole point of an SLO: it makes the trade-off *visible and shared* instead of a turf war.

And now — the big idea this entire page has been building toward.

**Speed and quality are not a trade-off.** It *feels* like they should be: surely going faster means breaking more? But the research (DORA's *Accelerate*) found the opposite — the same teams that deploy the most often *also* have the *lowest* failure rates and the *fastest* recovery. They're elite at both. How? Because the practices that make you safe are the very same ones that make you fast: **small, frequent changes** (easier to test, easier to understand, easier to undo when wrong), **good automated tests** (catch bugs early *and* let you ship without fear), and **fast rollback** (recover in seconds *and* dare to deploy more often). Each habit pays off on *both* sides of the scale. So the goal isn't to balance speed against quality like two ends of a seesaw — it's to adopt the practices that lift *both at once*.

---

## Real-World Examples

**1. Same speed, opposite outcomes.** Two teams each deploy ten times a day — identical on the speed dashboard. Team A has a 30% change failure rate and a 3-hour time to restore: three of every ten deploys break something, and each break costs an afternoon. Team B has a 10% CFR and an 8-minute restore: breaks are rarer, and when they happen, a one-click rollback fixes them before most users notice. The speed metric called these teams equal. The quality metrics revealed they're not even close — and Team B is the one you actually want to be.

**2. The afternoon that ate a month's budget.** A service runs on a 99.9% SLO — about 43 minutes of allowed downtime per month. A Tuesday deploy introduces a bad bug, and because there's no fast rollback, the team spends **50 minutes** diagnosing and hand-fixing it. In under an hour, they've blown their *entire monthly* error budget. The lesson lands hard: it wasn't the failure that hurt most — failures happen — it was the *slow recovery* (high MTTR). Had a rollback taken 4 minutes, the same bug would've cost a tiny fraction of the budget.

**3. The bug the customer found first.** A checkout bug ships to production. No test covered that path; no reviewer caught it. The first people to find it are *customers*, who can't pay — so it arrives as angry support tickets and an emergency 11 PM fix. That's an escaped defect in its most expensive form. The same one-line mistake, caught by a unit test that morning, would have been a 30-second fix nobody outside the team ever heard about. The cost wasn't in the bug; it was in *where it was caught*.

---

## Mental Models

- **Speed and quality as two halves of one dashboard.** Showing only speed is like reporting a car's top speed but never whether it crashes. Deploy frequency tells you how fast you're going; change failure rate and time to restore tell you how often you crash and how fast you recover. Read all of them or you're reading none of them.

- **The error budget as an allowance.** You're given a small allowance of failure for the month (the gap between your SLO and 100%). Spend it wisely: while you've got allowance left, you can afford to take risks; once it's gone, you tighten up and stop spending until next month tops it back up. It's failure with a wallet.

- **Bugs falling through nets.** Each stage — tests, review, QA — is a net stretched to catch bugs before they fall further. Catching one early is the system working. A bug that falls all the way to production (an escaped defect) means *every* net had a hole. You fix the nets, not just the bug.

- **The nines as a staircase, not a ramp.** Each step up (99% → 99.9% → 99.99%) is about 10× taller than it looks — roughly 10× less downtime allowed. Climbing one more nine is real, expensive work, not a small nudge. Which is why you pick the step you actually need and stop, rather than sprinting toward an impossible 100%.

---

## Common Mistakes

1. **Bragging about speed while hiding the failure rate.** "We deploy 12 times a day!" means nothing if half those deploys break. Speed metrics quoted without quality metrics are marketing, not measurement. Always pair them.

2. **Believing speed and quality trade off.** The single most common — and most disproven — assumption. The data shows fast teams are *also* the safe teams, because the same practices (small changes, good tests, fast rollback) drive both. Going slower does *not* automatically make you safer; it usually just makes you slower.

3. **Chasing 100% uptime.** 100% is impossible and the last fraction of a nine costs more than it's ever worth. The right move is to *choose* a target (an SLO) that matches what your users actually need — and then deliberately spend the failure you've allowed yourself.

4. **Treating any failure as a disaster.** With an error budget, a *small* amount of failure is not just tolerated, it's *expected and fine*. Teams that panic over every blip burn out and over-engineer. The question isn't "did anything fail?" — it's "have we exceeded our budget?"

5. **Ignoring time to restore.** People obsess over preventing failures and forget recovery. But you can't prevent every failure — so how fast you recover (MTTR) is often the difference between a non-event and an outage. A fast rollback is frequently the highest-value thing a junior can learn to set up.

6. **Letting bugs escape to users instead of strengthening early checks.** When escaped defects climb, the reflex is "add more testing at the very end." The real fix is usually to strengthen the *cheap, early* nets — unit tests, code review — so bugs are caught when they're nearly free, not when a customer finds them.

---

## Test Yourself

1. Your team deployed 40 times last month, and 6 of those deploys caused a problem. What is your change failure rate?
2. In one sentence each, explain the difference between change failure rate and time to restore (MTTR).
3. A service is at 99.9% availability. Roughly how much downtime per month does that allow? What about 99.99%?
4. Why is "we want 100% uptime" not a real goal? What should you aim for instead?
5. What is an escaped defect, and why does the *same* bug cost so much more when it escapes to production than when a test catches it?
6. You promise a 99.9% SLO. Plain English: what is your "error budget," and how should having budget *left over* versus *used up* change what you do?
7. The big one: are speed and quality a trade-off? Defend your answer in two sentences.

<details>
<summary>Answers</summary>

1. **15%.** CFR = 6 / 40 × 100% = 15%. One in roughly seven deploys caused a problem.
2. **CFR** = *how often* your deploys break something (a percentage of all deploys). **MTTR** = *how fast* you recover *after* something breaks (a duration). One is about prevention; the other is about recovery.
3. **99.9%** allows about **43 minutes per month** of downtime. **99.99%** allows about **4.3 minutes per month** — roughly 10× less, because each extra nine cuts allowed downtime by about 10×.
4. **100% is impossible** — networks, hardware, and deploys all fail eventually — and chasing the last fraction of a nine costs far more than it's worth. Instead, set an **SLO**: a specific, achievable reliability target (like 99.9%) that matches what your users actually need.
5. An **escaped defect** is a bug that got past all your tests and reviews and reached real users. It costs vastly more in production because it now means support tickets, lost trust, an emergency fix, and possibly an outage — whereas a test catching the same bug is a near-free, 30-second fix nobody outside the team notices.
6. Your **error budget** is the **0.1%** you're allowed to fail — about **43 minutes of downtime this month**. **Budget left over** → you're healthier than promised, so you can afford to take risks and ship boldly. **Budget used up** → you've already failed as much as you promised, so you stop shipping risky changes and focus on stability until the budget refills.
7. **No.** The research shows the fastest teams are *also* the most reliable, because the practices that make you safe — small changes, strong automated tests, fast rollback — are the very same practices that make you fast; each one improves both sides at once, so the goal is to adopt those practices, not to balance speed against quality.

</details>

---

## Cheat Sheet

```
THE TWO HALVES (read together, always)
  SPEED   : deploy frequency, lead time   → how often / how fast we change
  QUALITY : CFR, MTTR, availability        → does it work / does it stay up

CHANGE FAILURE RATE (CFR)
  CFR = (deploys that broke something / total deploys) × 100%
  lower = better.  elite ≈ 15% or less.  40% = nearly half your deploys break.

TIME TO RESTORE (MTTR)
  how long from "broke" to "working again."  lower = better.
  biggest beginner lever: a fast, reliable ROLLBACK.

AVAILABILITY — THE NINES  (downtime allowed)
  99%      two nines    ~3.65 days/yr   ~7.2 hours/month
  99.9%    three nines  ~8.76 hours/yr  ~43 minutes/month   ← common target
  99.99%   four nines   ~52.6 min/yr    ~4.3 minutes/month
  99.999%  five nines   ~5.26 min/yr    ~26 seconds/month   ← must be automated
  each extra nine ≈ 10× less downtime allowed.  100% is impossible.

ESCAPED DEFECT
  a bug that reached real USERS (every net missed it).
  cost grows the LATER it's caught:  unit test ≪ review ≪ QA ≪ PRODUCTION.

SLO + ERROR BUDGET
  SLO          = the reliability target you promise (e.g. 99.9%)
  error budget = the failure you're ALLOWED (the 0.1%) → ~43 min/month
    budget LEFT  → take risks, ship boldly
    budget GONE  → stop, focus on stability until it refills

THE BIG IDEA
  speed and quality are NOT a trade-off.
  small changes + good tests + fast rollback  →  faster AND safer, both at once.
```

---

## Summary

- **Speed metrics measure only half the system.** They tell you how *often* and how *fast* you change things — and stay silent on whether those changes *work*. Quality and reliability metrics are the balance: the other half of the dashboard.
- **Change failure rate** = the percentage of deploys that cause a problem (prevention — break less). **MTTR / time to restore** = how fast you recover when something breaks (recovery — heal faster). You need both; a fast rollback is the beginner's biggest lever on recovery.
- **Availability** is the percentage of time the service works, said in "nines." Each extra nine allows about **10× less downtime** — 99.9% ≈ 43 minutes a month, 99.99% ≈ 4.3 minutes. **100% is impossible**, so you choose a target instead of chasing perfection.
- **Escaped defects** are bugs that reached real users because every early net missed them. The same bug costs almost nothing in a unit test and a great deal in production — so the fix is to catch bugs *earlier*, not just test more at the end.
- **An SLO** is the reliability target you promise (e.g. 99.9%); your **error budget** is the failure you're allowed (the 0.1%). Budget left → take risks; budget gone → focus on stability. It turns the speed-vs-reliability argument into a shared number.
- **The big idea:** speed and quality are **not** a trade-off. The fastest teams are also the safest, because small changes, strong tests, and fast rollback make you *faster and safer at the same time*.

You now have the reliability half of the picture. Pair it with the speed half from [01 — The DORA Four Keys](../01-dora-four-key-metrics/junior.md) and you can read the *whole* health of a delivery system — not just how fast it moves, but whether what it ships actually works and stays up.

---

## Further Reading

- *Accelerate* (Forsgren, Humble & Kim) — the research showing that elite teams are fast *and* stable, not one at the expense of the other. The foundation for this whole topic.
- *Site Reliability Engineering* (Google) — the chapters on SLOs and error budgets. The clearest, most practical explanation of "allowed failure" in print; skim the SLO chapter.
- The annual **DORA / State of DevOps report** — where change failure rate and time-to-restore benchmarks (elite vs. low) come from.
- The [middle.md](middle.md) of this topic, which puts real definitions and measurement behind these numbers — how to *compute* CFR and MTTR honestly, and how SLIs feed SLOs.

---

## Related Topics

- [01 — The DORA Four Keys](../01-dora-four-key-metrics/junior.md) — the speed *and* stability metrics together; two of the four keys are the reliability numbers on this page.
- [middle.md](middle.md) — the same metrics with real measurement: SLIs, percentiles, and how to compute CFR and MTTR without fooling yourself.
- [senior.md](senior.md) — reliability as the "fifth key," error-budget *policies*, and what happens when an SLO drives real engineering decisions.
- [06 — Metrics Anti-Patterns & Goodhart](../06-metrics-anti-patterns-and-goodhart/junior.md) — how even good reliability metrics get gamed, and how to measure without breaking the behavior you measure.
