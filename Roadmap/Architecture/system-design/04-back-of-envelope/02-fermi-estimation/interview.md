# Fermi Estimation — Interview Questions

Fermi estimation is the load-bearing skill of a system-design interview. Before you draw a single box, you are expected to size the problem: how many users, how many requests per second, how many bytes per year, how much memory per node. The interviewer is not checking whether you memorized that a tweet is 280 characters — they are checking whether you can decompose an unknown quantity into knowable factors, carry units, round aggressively, and arrive at a number that is right to within an order of magnitude. This file drills that skill through graded questions, each with the arithmetic shown.

## Table of Contents

1. [Junior Questions](#junior-questions)
2. [Middle Questions](#middle-questions)
3. [Senior Questions](#senior-questions)
4. [Professional / Deep-Dive Questions](#professional--deep-dive-questions)
5. [Staff / Judgment Questions](#staff--judgment-questions)

---

## Junior Questions

**Q1: What is a Fermi estimate, and why is it called that?**

> A Fermi estimate is an order-of-magnitude approximation of a quantity you cannot measure directly, built by breaking it into factors you *can* guess and multiplying them. The goal is not the exact answer — it is to land within a factor of ~10 (one order of magnitude) of the truth using only mental arithmetic.
>
> It is named after physicist Enrico Fermi, who was famous for posing questions like "How many piano tuners are there in Chicago?" and for estimating the yield of the first atomic-bomb test by dropping scraps of paper and watching how far the blast wind carried them. The lesson: a structured guess beats refusing to guess. In a system-design interview, "I'd need real metrics to answer that" is a failing response. "Let me estimate — call it ~5,000 QPS, here's how I got there" is a passing one.

**Q2: What is the 4-step method for a Fermi estimate?**

> A repeatable recipe:
>
> 1. **Decompose** — rewrite the unknown as a product (and/or sum) of factors you can estimate. `Answer = factor_A × factor_B × factor_C`.
> 2. **Estimate each factor** — assign each factor a round number, ideally a power of ten times a small digit (e.g. `3 × 10^8`). State the assumption out loud.
> 3. **Combine** — multiply the factors, keeping units attached so they cancel correctly and you can sanity-check the final unit.
> 4. **Sanity-check** — does the magnitude feel right? Cross it against a known anchor. Compute a low and high bound if you have time.
>
> The discipline is in step 1 and step 4. Anyone can multiply; the skill is choosing a decomposition where each factor is independently guessable.

**Q3: Why round everything to powers of ten?**

> Because the answer only needs to be right to an order of magnitude, and powers of ten make the mental arithmetic trivial — you add and subtract exponents instead of doing long multiplication. `4 × 10^8 users × 2 × 10^2 bytes = 8 × 10^10 bytes`. You computed `4 × 2 = 8` and `10^8 × 10^2 = 10^10`. That's the whole calculation.
>
> Rounding to "nice" numbers (1, 2, 5, and powers of ten) also keeps your working memory free for the *structure* of the problem rather than the digits. Precision in the inputs is wasted effort: if one factor is a guess that could be off by 3×, carrying the next factor to four significant figures is theater.

**Q4: Estimate the number of piano tuners in Chicago. (The classic warm-up.)**

> Decompose: `tuners = (pianos needing tuning per year) / (pianos one tuner handles per year)`.
>
> Numerator:
> - Chicago population ≈ `3 × 10^6` people.
> - People per household ≈ `3`, so households ≈ `10^6`.
> - Fraction of households with a piano ≈ `1 in 20`, so pianos ≈ `5 × 10^4`. Add institutions (schools, churches) — round up to `7.5 × 10^4`.
> - Each piano is tuned ≈ `1×` per year. → `~7.5 × 10^4` tunings/year.
>
> Denominator (one tuner's capacity):
> - `4` tunings/day × `5` days/week × `50` weeks/year = `1,000` tunings/year.
>
> Result: `7.5 × 10^4 / 10^3 = 75 tuners`. The real number for Chicago is in the dozens-to-low-hundreds range — well within an order of magnitude. The point of the exercise is the decomposition, not the 75.

**Q5: When sizing a system, should you use the total user count or the active user count?**

> The active count, and you must say which one. Headline numbers like "2 billion registered users" are almost never the load driver. What hits your servers is *Daily Active Users* (DAU), and within a day, the *peak* concurrent slice.
>
> A clean chain: `registered → MAU → DAU → peak-concurrent`. Typical ratios you can state and let the interviewer adjust: DAU ≈ 20–50% of MAU; peak concurrent ≈ DAU active within the busiest hour. Naming the funnel shows you know that "users" is ambiguous and that load is driven by the active fraction, not the vanity total.

**Q6: What does "back-of-the-envelope" buy you that a real benchmark doesn't?**

> Speed and direction. A benchmark answers "exactly how fast is *this* code on *this* hardware right now." A back-of-envelope estimate answers "is this design even in the right ballpark — do we need 3 servers or 3,000?" — *before* any code exists. It tells you which order of magnitude you're designing for, which determines the entire architecture: a 100-QPS service and a 100,000-QPS service are not the same system. You reach for the envelope first, the benchmark later to confirm.

---

## Middle Questions

**Q7: Estimate the storage needed for one year of a chat app like WhatsApp. Show the decomposition.**

> Decompose into `users × messages-per-user-per-day × bytes-per-message × days`, then add a multiplier for media and overhead.
>
> Assumptions (stated so they can be corrected):
> - DAU ≈ `2 × 10^9` (2 billion).
> - Text messages per user per day ≈ `40`.
> - Bytes per text message ≈ `100 B` (short text + metadata: sender, timestamp, ids).
>
> Text per day:
> ```
> 2×10^9 users × 40 msg × 100 B = 8×10^12 B/day = 8 TB/day
> ```
> Text per year: `8 TB × 365 ≈ 3 × 10^3 TB = ~3 PB/year` for raw text.
>
> Media dominates. Say `10%` of messages carry an image averaging `200 KB`:
> ```
> 2×10^9 × 40 × 0.1 × 200×10^3 B = 1.6×10^15 B/day = 1.6 PB/day
> ```
> That's `~580 PB/year` for media. So storage is media-bound by ~200×; text is a rounding error. The architectural conclusion: design the system around blob storage and a CDN, not around the message database. That conclusion is the entire payoff of the estimate.

**Q8: Estimate the read QPS for a social feed with 200M DAU.**

> Decompose `QPS = (requests per user per day) / (seconds per day)`, then scale to peak.
>
> - Feed opens per user per day ≈ `10`. Each open triggers ≈ `1` feed-fetch request (ignore pagination for the average).
> - Requests/day = `2×10^8 × 10 = 2×10^9`.
> - Seconds/day = `86,400 ≈ 10^5` (rounding `86,400` to `10^5` is the standard move — it's within 15%).
>
> Average QPS:
> ```
> 2×10^9 / 10^5 = 2×10^4 = 20,000 QPS (average)
> ```
> Peak is higher. Traffic isn't uniform — apply a peak factor of ~`2–3×` for the busiest hour:
> ```
> peak ≈ 20,000 × 3 = 60,000 QPS
> ```
> Now you can reason about fan-out, caching, and how many feed-service instances you need. State the peak factor explicitly; it's the assumption most worth challenging.

**Q9: Why is `86,400 ≈ 10^5` an acceptable shortcut?**

> Because `86,400 / 100,000 = 0.864`, a `14%` error — far inside the order-of-magnitude tolerance, and it makes the exponent arithmetic clean. Memorize three time anchors:
>
> | Period | Exact seconds | Round (powers of ten) |
> |---|---|---|
> | 1 day | 86,400 | `~10^5` |
> | 1 month | ~2.6 million | `~2.5 × 10^6` |
> | 1 year | ~31.5 million | `~3 × 10^7` (or "`π × 10^7`") |
>
> "`π × 10^7` seconds per year" is a beloved physics mnemonic — `3.1416 × 10^7 ≈ 31.4M`, accurate to under 0.5%. These three numbers turn most rate problems into one division.

**Q10: Estimate the egress bandwidth for a video platform streaming to 50M concurrent viewers.**

> Bandwidth = `concurrent streams × bitrate per stream`. The trick is that bandwidth is a *rate*, so you don't multiply by time — you just need the instantaneous per-stream rate.
>
> - Concurrent streams = `5 × 10^7`.
> - Average bitrate ≈ `5 Mbps` (a blend of 480p/720p/1080p; HD is ~5 Mbps, 4K is ~25 Mbps — assume a mostly-HD audience).
>
> ```
> 5×10^7 streams × 5×10^6 bits/s = 2.5×10^14 bits/s = 250 Tbps
> ```
> 250 terabits per second of egress. No single data center or origin serves that — the number *forces* the design conclusion: you must push delivery to a CDN with hundreds of edge POPs, and your origin only serves cache misses. The estimate didn't just size the system; it dictated the topology.

**Q11: How do you state assumptions so the interviewer corrects your inputs, not your conclusion?**

> Externalize every assumption as a labeled variable *before* you multiply, and pause briefly after each. Say: "I'll assume 2 billion DAU — sound right? And 40 messages per user per day." This does three things:
>
> 1. It invites correction at the *input* stage, where a fix is cheap, instead of after you've built a wrong tower of arithmetic on it.
> 2. It makes your reasoning auditable — if the interviewer changes DAU to 500M, you both can see exactly which factor changes and re-multiply in seconds.
> 3. It signals collaboration. The interviewer often *has* a number in mind and is testing whether you'll surface the assumption rather than silently hard-code it.
>
> The anti-pattern is burying a debatable number mid-calculation ("...so that's about 8 terabytes...") where neither of you can see which input drove it.

**Q12: What's the difference between estimating QPS, storage, and bandwidth — which time-unit goes where?**

> They differ in whether time is a *multiplier* or a *divisor*:
>
> | Quantity | Formula shape | Time's role |
> |---|---|---|
> | **QPS** (rate) | events ÷ seconds | divide by a time window |
> | **Storage** (cumulative) | bytes/day × days | multiply by retention period |
> | **Bandwidth** (rate) | concurrent × per-stream rate | no time term — it's already per-second |
> | **Memory** (snapshot) | items × bytes/item | no time term — instantaneous working set |
>
> Getting this wrong is the most common estimation bug. People multiply bandwidth by a day's worth of seconds (getting bytes, not bits/s) or forget to multiply storage by the retention window. Carrying units catches both: if your "bandwidth" answer comes out in bytes, you made a mistake.

---

## Senior Questions

**Q13: Walk through unit cancellation in a full estimate, and explain why carrying units is non-negotiable.**

> Units are a free correctness check — they cancel like algebra and the final unit tells you if the decomposition is sound. Take "daily storage for an image upload service":
> ```
>   2×10^9 users    40 photos    500×10^3 bytes
>   ──────────── ×  ───────── ×  ─────────────
>                    user·day        photo
>
> = users · photos/(user·day) · bytes/photo
> = bytes/day
> ```
> The `users` cancels with the `user` in the denominator, the `photos` cancels with `photo`, and you're left with `bytes/day` — exactly the unit you wanted. Numerically: `2×10^9 × 40 × 5×10^5 = 4×10^16 bytes/day = 40 PB/day`.
>
> If the surviving unit had been `bytes·day` or `bytes/(user·day)`, you'd know instantly the chain was malformed. Senior estimators write the units down and watch them cancel; juniors track only the digits and silently produce dimensionally nonsensical answers.

**Q14: How do you bound an estimate with a low and a high guess instead of a single point?**

> When a factor is genuinely uncertain, pick a plausible low value and a plausible high value, run the calculation twice, and report the range. This is more honest and more useful than a false-precision single number.
>
> Estimating QPS for a new feature where "uses per day per user" might be anywhere from 1 to 20, with 10M DAU:
> ```
> low:  10^7 × 1  / 10^5 = 10^2   = 100 QPS
> high: 10^7 × 20 / 10^5 = 2×10^3 = 2,000 QPS
> ```
> The honest takeaway: "average load is between 100 and 2,000 QPS, so I'll provision for the high end and call it low-thousands of QPS at peak." A single point estimate hides the uncertainty; the bound surfaces it and lets you make a deliberate provisioning decision (size for the high bound, alert at the low one).

**Q15: What is sensitivity analysis in an estimate, and how do you find which assumption matters most?**

> Sensitivity analysis asks: if I'm wrong about factor X by 2×, how much does the final answer move? In a pure product `A × B × C`, every factor is equally leveraged — a 2× error in *any* of them is a 2× error in the result. So "which matters most" is really "which factor am I *least sure* about?" — that's the one to pin down or bound.
>
> Practical procedure: list your factors, mark each with a confidence (tight / loose / wild guess), and the *loose × wild* factors are where the risk lives. In the WhatsApp storage estimate (Q7), I'm confident about DAU and seconds, but "fraction of messages with media" and "average media size" are wild guesses — and they swing the answer by 100×. So I'd spend my remaining time refining *those*, and explicitly tell the interviewer "the answer is dominated by media assumptions; text is negligible." That sentence is what separates a senior estimate from a mechanical one.

**Q16: Why do random errors tend to cancel in log space, and what does that imply for stacking many guesses?**

> When you multiply several independent factors, the *log* of the result is the *sum* of the logs of the factors. Each factor's error is roughly a multiplicative spread — "could be 2× too high or 2× too low" — which is symmetric in log space (`+0.3` or `−0.3` in log10). When you add several such symmetric, roughly-independent log-errors, they behave like a sum of zero-mean random variables: the overshoots and undershoots partially cancel, and by the central-limit intuition the *combined* error grows like `√n`, not `n`.
>
> Concretely: if you have 6 factors each uncertain by ~2× (`±0.3` in log10), the naive worst case is `2^6 = 64×`. But the *typical* combined error is closer to `10^(0.3 × √6) ≈ 10^0.73 ≈ 5×` — about one order of magnitude, not two. This is *why* Fermi estimation works at all: stacking many imperfect guesses is far more accurate than your fear suggests, *provided* the errors are independent and unbiased. The danger is *systematic* bias (always rounding up, always optimistic) — those don't cancel, they accumulate.

**Q17: You're mid-estimate and realize you don't know a key factor — say, average compressed size of a JSON document. How do you recover?**

> Don't freeze. Use one of three recovery moves, out loud:
>
> 1. **Anchor to something you do know.** "A typical API response I've seen is a few KB; a JSON user object with 20 fields at ~50 bytes each is ~1 KB. I'll use 1 KB and flag it."
> 2. **Bracket it.** "It's bigger than a tweet (hundreds of bytes) and smaller than an image (hundreds of KB), so call it ~1–5 KB. I'll use 2 KB."
> 3. **Defer with a variable.** "Let me call it `S` bytes and carry it symbolically; I'll plug a number at the end and we can adjust." This lets you keep the structure intact and isolates the one uncertain input.
>
> The recovery itself is what's being graded. Producing a defensible 1 KB from first principles demonstrates exactly the decompose-and-anchor reflex the interviewer is looking for. Saying "I don't know" and stopping is the only wrong answer.

**Q18: Estimate the memory needed to keep a 7-day URL-shortener cache hot, and use it to drive a design choice.**

> Sizing a cache snapshot — no time multiplier, just `entries × bytes/entry`.
>
> - New URLs created per day ≈ `10^6` (1M/day for a mid-size shortener).
> - We cache the hot set — say the last 7 days plus heavy repeat reads, ≈ `10^7` entries.
> - Bytes per entry: short code (~`8 B`) + long URL (~`100 B`) + overhead (~`50 B`) ≈ `~160 B`, round to `200 B`.
>
> ```
> 10^7 entries × 200 B = 2×10^9 B = 2 GB
> ```
> 2 GB fits comfortably in a single Redis node's RAM. **Design conclusion:** you do *not* need a distributed cache cluster or sharding for the hot set — one replicated cache node handles it, which dramatically simplifies the architecture. The estimate converted a vague "do we need a cache tier?" into a concrete, defensible "one node, 2 GB, replicated." That's the estimate *driving* the design.

---

## Professional / Deep-Dive Questions

**Q19: Estimate the full storage and QPS profile for a Twitter-scale feed, and use the read/write asymmetry to choose between fan-out-on-write and fan-out-on-read.**

> Build the numbers first, then let them pick the architecture.
>
> Write side:
> - DAU ≈ `2×10^8`. Tweets per user per day ≈ `2`. → writes/day = `4×10^8`.
> - Write QPS = `4×10^8 / 10^5 ≈ 4,000 QPS` average, `~10,000 QPS` peak.
>
> Read side:
> - Feed views per user per day ≈ `30`. → reads/day = `6×10^9`.
> - Read QPS = `6×10^9 / 10^5 = 6×10^4 = 60,000 QPS` average, `~150,000 QPS` peak.
>
> Read:write ratio ≈ `60,000 : 4,000 = 15:1`. Reads dominate by an order of magnitude. This *is* the architectural decision: with reads 15× writes, you want to do the expensive work *once at write time* (fan-out-on-write: push each tweet into followers' precomputed timelines) so reads are cheap O(1) lookups. The exception is celebrity accounts with tens of millions of followers, where fan-out-on-write would mean tens of millions of writes per tweet — so you hybridize: fan-out-on-write for normal users, fan-out-on-read (merge at query time) for celebrities. The whole strategy fell out of two QPS numbers.
>
> ```mermaid
> flowchart TD
>     A[Tweet posted] --> B{Author follower count?}
>     B -->|"normal<br/>(< ~1M followers)"| C[Fan-out-on-write]
>     B -->|"celebrity<br/>(>= ~1M followers)"| D[Fan-out-on-read]
>     C --> E[Push tweet id into each<br/>follower's precomputed timeline]
>     E --> F[Read = O 1 timeline lookup]
>     D --> G[Store tweet once]
>     G --> H["Read = merge author<br/>tweets at query time"]
>     F --> I[Reader's home feed]
>     H --> I
> ```
>
> The diagram is staged: the branch on follower count is the consequence of the 15:1 read:write ratio plus the celebrity tail; neither half of the design is justifiable without the estimate.

**Q20: An interviewer challenges one of your inputs ("I think it's 500M DAU, not 2B"). How do you respond, and how fast can you re-derive?**

> Accept it gracefully and re-multiply — that's the entire point of having externalized the factor. Because the answer is linear in DAU, a `4×` reduction in DAU is a `4×` reduction in the result, full stop. If my storage estimate was `40 PB/day` at 2B DAU, it's `10 PB/day` at 500M. I don't redo the decomposition; I scale the final number by the ratio.
>
> The professional behavior here is twofold. First, *don't defend the wrong input* — the interviewer often knows the real number and is testing whether you cling to your guess or update cleanly. Second, *show the linearity explicitly*: "Since storage scales linearly with DAU, dropping from 2B to 500M just divides everything by 4 → 10 PB/day." That demonstrates you understand the *structure* of your own estimate, not just the digits. The whole exchange should take 15 seconds — which is only possible because you built the estimate as a transparent product of named factors.

**Q21: How do you decide when an estimate is "good enough" to stop and start designing?**

> Stop when the estimate has resolved the *decision* it was meant to inform — not when it's "accurate." Estimation is instrumental; its only job is to tell you which architecture you're in.
>
> Apply two tests:
> 1. **Order-of-magnitude resolution.** If the answer is clearly "tens of thousands of QPS" and not "hundreds" or "millions," you've resolved the magnitude that matters. Refining 60,000 to 58,400 changes no design decision.
> 2. **Decision stability.** If you perturb your shakiest assumption by 2× and the *architectural conclusion* doesn't change (still need a CDN, still single cache node, still sharded DB), the estimate is done. If a 2× swing flips the conclusion, refine *that* factor before stopping.
>
> The failure mode is *over-estimating* — burning interview minutes polishing a number when the design choice was already obvious three minutes ago. Senior estimators stop the moment the decision is stable and pivot to the design. Time spent past that is time not spent on the actual system.

**Q22: How would you sanity-check a finished estimate against a known anchor when you have no ground truth?**

> Cross-check against an independent quantity you happen to know, ideally derived a different way — if two roads lead to the same magnitude, trust grows. Techniques:
>
> - **Per-capita reasonableness.** If your estimate implies each user sends 10,000 messages/day, that's absurd — humans send tens, not thousands. The per-user rate is often easier to gut-check than the aggregate.
> - **Hardware reality.** If your estimate says you need 50,000 servers for a 10K-QPS service, that's ~5 QPS/server — far too low; a single modern box handles thousands of simple requests/second. The implied per-server load exposes the error.
> - **Known public anchors.** A commodity server ≈ thousands of QPS for light work; a disk ≈ hundreds of MB/s sequential; RAM ≈ tens of GB; a single DB ≈ low tens of thousands of simple writes/sec. Compare your result's *implications* against these.
> - **Reverse the calculation.** Take your answer and divide back out — does the implied input match what you assumed? A mismatch means an arithmetic slip.
>
> The strongest check is reaching the same magnitude two independent ways (e.g. sizing storage by message-count *and* by bytes-per-active-user-per-year). Agreement to within an order of magnitude is your confidence.

---

## Staff / Judgment Questions

**Q23: What do interviewers actually grade during the estimation step — and what scores zero?**

> They grade *process*, not the final digit. Concretely, in rough priority order:
>
> | What's graded | What it looks like | What scores zero |
> |---|---|---|
> | **Decomposition** | breaks the unknown into a clean product of guessable factors | one giant unjustified number pulled from thin air |
> | **Stated assumptions** | externalizes each factor, invites correction | debatable numbers buried mid-calculation |
> | **Unit discipline** | carries units, they cancel to the right dimension | dimensionally nonsensical answers (bandwidth in bytes) |
> | **Arithmetic under pressure** | clean powers-of-ten mental math | freezing, or long-multiplication errors |
> | **Drives the design** | uses the number to choose CDN vs origin, fan-out strategy, cache size | computes a number then ignores it |
> | **Collaboration** | updates cleanly when an input is challenged | defends a wrong guess, or refuses to guess |
>
> The single biggest differentiator at staff level is the second-to-last row: candidates who connect the estimate to an *architectural consequence* ("250 Tbps means CDN-mandatory") pass; candidates who produce an immaculate number and then design as if they'd never computed it fail. The estimate is a *tool for a decision*, and using it as one is the whole point.

**Q24: A junior on your team produces a perfectly-computed estimate that's confidently wrong by 100×. What systematic mistakes do you look for, and how do you coach the fix?**

> An order-of-magnitude-class error in a *multiplicative* estimate almost never comes from arithmetic — it comes from a small number of systematic traps. I'd audit for these, in order:
>
> 1. **A unit/exponent slip.** Confusing bits and bytes (8×), Mbps and MB/s, or miscounting zeros (`10^9` written as `10^6`). Fix: insist units are written and cancelled on every term — this catches the dimensional ones automatically.
> 2. **A missing or doubled factor.** Forgetting the media multiplier in storage, or the peak factor in QPS, or accidentally multiplying by retention twice. Fix: write the decomposition as an explicit equation *before* plugging numbers, so missing factors are visible as gaps.
> 3. **Correlated optimism (the real killer).** Every individual guess rounded the "convenient" direction — all slightly low, or all slightly high. Unlike random errors, *biased* errors don't cancel in log space (see Q16); six factors each biased 1.5× low compound to ~`11×` low. Fix: round *unbiasedly* — sometimes up, sometimes down — and explicitly bound the answer low/high to expose accumulated bias.
> 4. **Wrong base population.** Using registered users where active users belong (often 5–10×), or total where peak-concurrent belongs. Fix: always name the funnel stage (Q5).
>
> The coaching frame: a clean *number* with a broken *structure* is more dangerous than a rough guess with sound structure, because false precision invites false confidence. I'd have them re-derive with units carried, the equation written first, and a low/high bound — the discipline that makes the 100× error physically unable to hide.

**Q25: When does Fermi estimation actively mislead, and what's your judgment for when to distrust it?**

> Fermi estimation is reliable for *independent, unbiased, multiplicative* factors. It misleads in four named situations, and recognizing them is a staff-level judgment call:
>
> 1. **Heavy-tailed distributions.** When a tiny fraction of inputs dominates the aggregate — celebrity accounts, viral content, a few enormous customers — the "average" factor is meaningless and your estimate of the mean badly undercounts the peak. The Twitter celebrity case (Q19) is exactly this; an average-follower estimate hides the fan-out catastrophe. *Judgment:* whenever a power-law is plausible, estimate the *tail* separately, not just the mean.
> 2. **Correlated factors.** The method assumes factors are independent so errors cancel. When they're correlated (peak traffic *and* peak data size both spike during a flash sale), errors reinforce instead of canceling, and the real peak exceeds the product of average factors.
> 3. **Threshold/non-linear effects.** Estimation is linear; real systems have cliffs. "We're at 80% of a single DB's write capacity" and "we're at 81%" are estimated the same but behave catastrophically differently once you cross the cliff into lock contention or swap. The estimate can't see the discontinuity.
> 4. **Systematic bias in the estimator.** Optimism, anchoring on a number someone mentioned, or motivated reasoning toward the answer you want. These don't cancel; they compound.
>
> *Overall judgment:* trust a Fermi estimate to choose the *order of magnitude* and therefore the *architecture class*. Distrust it for anything near a capacity threshold, for peak behavior under heavy tails, or for go/no-go decisions where being 3× off is unacceptable — those demand a real benchmark or a load test. The skill isn't just producing the estimate; it's knowing the regime where the estimate stops being trustworthy and saying so out loud.

---

*Next step:* [OSI & TCP/IP](../../05-networking-protocols/01-osi-and-tcp-ip/junior.md)
