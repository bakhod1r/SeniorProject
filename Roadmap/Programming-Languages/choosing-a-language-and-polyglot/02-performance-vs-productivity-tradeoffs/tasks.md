# Performance vs Productivity Tradeoffs — Practice Tasks

Seven reasoning exercises. **None of these involve writing code.** They are decision drills — given SLOs, profiles, and scenarios, you reason about where time goes, whether a language switch is justified, and what the cheaper fix is. The skill being trained is *judgment under numbers*: refusing to blame the language until the math says you may.

Work each one on paper before reading the worked answer in the final section. The goal is to internalize the method, not to memorize answers.

---

## Task 1 — Read the profile, find the real bottleneck

A service feels slow. A distributed trace of one representative slow request shows:

```
Span                                   Duration
-------------------------------------  ---------
HTTP parse + auth                          1.2 ms
Application logic (your code)              3.5 ms
Database query: load_user_orders         610   ms
External call: fraud-scoring API          240   ms
JSON serialization (your code)            0.8 ms
-------------------------------------  ---------
Total                                     855.5 ms
```

**Answer these:**
1. What fraction of total time is spent in *your code* (the part a language change could affect)?
2. By Amdahl's Law, what is the **best-case** total speedup from switching to a language 10× faster at computing?
3. A teammate proposes rewriting this service from Python to Go. Is that the right move? If not, name the two fixes you'd try first and roughly what each could buy.
4. What single question would you ask before doing *anything*?

---

## Task 2 — Is the language switch justified? (SLO + profile)

You own an image-thumbnail service. The SLO and the current measured reality:

```
SLO:      p99 latency < 300ms,  throughput > 800 images/sec per instance
Current:  p99 = 210ms (PASS),   throughput = 240 images/sec (FAIL — 3.3× short)

Profile (py-spy, production-scale load):
  78%  CPU  — pixel resize loop in pure Python
  12%  CPU  — JPEG encode (already a C library)
   6%  I/O  — read source image from object storage
   4%  CPU  — request handling / framing
```

**Answer these:**
1. Is this workload I/O-bound or CPU-bound? What is `f` (fraction of time in your code that a language could speed up)?
2. With `f ≈ 0.82` and a hypothetical 8× faster language, what's the Amdahl ceiling on total speedup? Does that close the 3.3× throughput gap?
3. Before rewriting the whole service, what is the *polyglot escape hatch* here? Be specific about *which* part you'd move and which you'd keep.
4. Give your final recommendation in one sentence, including a revisit trigger.

---

## Task 3 — Critique a premature-optimization decision

Read this real-shaped decision and write a critique.

> A three-person startup is building an MVP for a B2B scheduling product. They have no users yet and don't know which features will matter. The technical co-founder, who loves Rust, decrees the entire backend will be written in Rust "so we never have to rewrite it for performance later." Six months in, they've shipped two features, the team is exhausted fighting the borrow checker on CRUD endpoints, and they haven't found product-market fit. The endpoints they did build respond in under 5ms.

**Answer these:**
1. Name the specific mistake, using the lifecycle framing. What was the *dominant cost* at this stage, and did Rust optimize it?
2. The endpoints respond in "under 5ms" — why is that number a *red flag* rather than a success?
3. What was the asymmetry they got wrong (what's certain vs uncertain in this trade)?
4. What would the correct default have been, and how could they still have handled a real future performance need *without* starting in Rust?

---

## Task 4 — Build a productivity-vs-performance scoring for a scenario

Your company must choose a language for a **new real-time bidding (RTB) service**. In RTB, an ad exchange sends a bid request; you must return a bid within a **hard 80ms** budget (network round-trip included), or the bid is discarded and you lose the impression — latency is *literally* lost revenue. Volume is ~50,000 requests/sec, growing 20%/quarter. The work per request: deserialize the request, run a small ML model, look up two cached values, serialize a response — almost entirely CPU, almost no external I/O on the hot path. Candidates: **Python**, **Go**, **Rust**.

**Build a weighted decision matrix.** Steps:
1. Choose 5–6 criteria appropriate to *this* scenario, and assign weights summing to 100. (Think hard about which axis of performance matters most here — and whether the lifecycle/stage changes the weighting.)
2. Score each candidate 1–5 per criterion.
3. Compute weighted totals and pick a winner.
4. Write two sentences: *why* the weights came out the way they did for *this specific* scenario, and what would have to change about the scenario to flip your answer.

(There is no single correct matrix — you're graded on whether the *weights reflect the scenario*. A worked version is in the answers.)

---

## Task 5 — Where does the time go? (estimate before you measure)

You're handed a described system and must *estimate* where time goes before any profiler is available — a skill for sizing a problem in a meeting.

> A "generate monthly PDF invoice" endpoint. For each invoice it: queries the database for the customer and their 40-line-item order (one indexed query, ~15ms), calls a tax-rate microservice over the network (~60ms), renders an HTML template (~4ms in app code), converts the HTML to PDF using a headless-browser library (~900ms), and uploads the PDF to object storage (~120ms).

**Answer these:**
1. Estimate the percentage of total time in each phase. Which single phase dominates?
2. Is this endpoint I/O-bound, CPU-bound, or "other"? (Careful — the dominant phase doesn't fit the usual two buckets cleanly. Describe it accurately.)
3. A stakeholder says "rewrite the endpoint in Go to make it faster." Estimate the best-case win and explain why it's the wrong lever.
4. Name two fixes that would actually move the needle, and roughly how much each could save.

---

## Task 6 — The cost-of-compute rewrite decision

You're a staff engineer. Finance flags that one service dominates the compute bill. You gather the numbers:

```
Service:           pricing-engine (highest-volume internal service)
Current cost:      $120,000 / month compute (600 instances)
Workload:          CPU-bound — measured 88% of time in your own pricing math
Prototype:         a Rust rewrite of the hot path, load-tested at production scale,
                   uses 55% less CPU → ~270 instances would suffice
Rewrite cost:      6 engineers × 4 months; loaded cost ≈ $15k / eng-month
Side effect:       ~6 weeks of frozen feature work on pricing during the cutover
Risk:              pricing errors are revenue-affecting and customer-trust-affecting
```

**Answer these:**
1. Compute the projected monthly saving and the annual saving.
2. Compute the one-time rewrite cost and the **payback period** in months.
3. Given the numbers, is this rewrite justified? State your decision and the *one* thing that most makes it defensible.
4. Pricing errors are dangerous. What de-risking mechanism would you require before cutover, and what *kill criterion* would you write into the proposal?
5. Write the one-line driver you'd put at the top of the funding memo (the trigger category from `professional.md`).

---

## Task 7 — Spot the wrong axis

For each mini-scenario, a team chose a language "for performance" but is being graded on a *performance axis their choice is bad at*. Name the axis that actually matters, the axis they optimized, and the better-fit option.

**(a)** A team deploys a Java/Spring service to AWS Lambda for an infrequently-called webhook handler. Under load it's fine, but users complain the first call after idle takes ~3 seconds.

**(b)** A team picks Go for a service that holds a very large in-memory cache and serves latency-sensitive reads. Throughput benchmarks look great, but every so often p999 latency spikes to hundreds of milliseconds.

**(c)** A team chooses a GC'd language tuned for maximum throughput for a soft-real-time audio-processing pipeline that must deliver a buffer every few milliseconds without fail. Average performance is excellent; occasionally a buffer is late and the audio glitches.

**(d)** A team runs a memory-heavy data service on hundreds of instances of a runtime that carries a 3× memory overhead vs a manually-managed language. Latency is fine; the cloud bill is enormous and dominated by RAM-heavy instance types.

**For each:** name (i) the axis they're actually graded on, (ii) the axis their choice optimizes, (iii) one better-fit direction.

---

## Validation — worked answers

### Task 1
1. Your code = `1.2 + 3.5 + 0.8 = 5.5ms` of `855.5ms` → **~0.64%**.
2. Amdahl with `f = 0.0064`, `s = 10`: `1 / (0.9936 + 0.00064) ≈ 1.0058` → **~0.6% total improvement.** A full rewrite buys essentially nothing.
3. **Wrong move.** The bottleneck is the 610ms database query and the 240ms fraud call. First fix: optimize `load_user_orders` — check for a missing index / N+1, could drop 610ms to tens of ms (10–20× on that span). Second fix: the fraud-scoring call (240ms) — can it be cached, made async/parallel, or batched? Together these could cut total latency by ~80% in the *same language*.
4. **"Where does the time actually go?"** — i.e., look at the profile/trace before blaming the language.

### Task 2
1. **CPU-bound.** `f ≈ 0.78 + 0.04 = 0.82` of time is in your speed-able code (the JPEG encode is already C; the 6% is I/O).
2. Amdahl `1 / (0.18 + 0.82/8) = 1 / (0.18 + 0.1025) ≈ 3.54×`. That **does** exceed the 3.3× gap — a language switch *could* close it. (Note: this is the case where the language genuinely *can* help, unlike Task 1.)
3. **Escape hatch:** move only the **78% pixel-resize loop** into a fast native extension (C/Rust, e.g., via a binding) and keep request handling, storage I/O, and orchestration in Python. You don't rewrite the service; you replace the hot loop — turning a quarter-long rewrite into a focused change. (Often you'd just adopt a library like Pillow-SIMD / libvips that already does this.)
4. *"Adopt a native-backed resize library (or a small Rust extension) for the pixel loop, keep the service in Python; revisit a full Go/Rust rewrite only if a single instance must exceed ~2,000 images/sec on one core."*

### Task 3
1. **Premature performance optimization at the wrong lifecycle stage.** Pre-PMF, the dominant cost is *learning what to build* — most code will be deleted before its runtime speed ever matters. Rust optimized runtime speed (an axis that didn't matter yet) at the expense of iteration speed (the axis that decided survival).
2. Sub-5ms responses on an MVP with no users means they **over-built performance nobody needed** — they paid in velocity for a number that has no business consequence at this stage. It's evidence of optimizing the wrong thing, not of success.
3. **Asymmetry:** they traded a *certain, large* productivity cost (months of slow shipping, exhaustion, no PMF) for an *uncertain, small* performance benefit (speed they may never need, on code they'll likely delete). And you can always add performance later; you can't recover lost runway.
4. **Correct default:** a high-productivity language (Python, TypeScript, Ruby) to iterate fast and find PMF. A real future performance need would be handled by profiling once the product exists, then using the **escape hatch** — rewriting only the measured hot path, or one hot service — *with evidence*, not by pre-committing the whole backend to Rust before knowing what the product even is.

### Task 4 (one defensible matrix — yours may differ if weights reflect the scenario)

| Criterion | Weight | Python | Go | Rust |
|---|---:|:---:|:---:|:---:|
| Tail-latency / predictability (hard 80ms, no GC spikes) | 35 | 1 | 3 | 5 |
| Raw CPU performance (CPU-bound hot path) | 25 | 1 | 4 | 5 |
| Team velocity / time-to-ship | 20 | 5 | 4 | 2 |
| Hiring / onboarding | 10 | 5 | 4 | 2 |
| Memory footprint (50k rps, dense packing) | 10 | 2 | 4 | 5 |
| **Weighted total** | **100** | **205** | **375** | **425** |

> Rust: (35×5)+(25×5)+(20×2)+(10×2)+(10×5) = 175+125+40+20+50 = **410**. (Go: 105+100+80+40+40 = 365.) Exact totals depend on your scores; the point is the *ranking*.

**Why these weights:** the scenario makes **tail-latency/predictability the dominant axis** — a hard 80ms budget where lateness is lost revenue means GC pauses are unacceptable, so it gets the heaviest weight, and that's the axis that pushes past Go to Rust. The work is CPU-bound, so raw performance is weighted heavily too. Velocity still matters but is outweighed because *latency is the product*. **What would flip it:** if the budget were a soft 800ms instead of a hard 80ms (I/O dominated, no GC sensitivity), velocity and hiring would dominate and **Go or even Python** would win — same problem shape, different deadline, opposite answer.

### Task 5
1. Roughly: DB 15ms (~1.4%), tax call 60ms (~5.5%), template render 4ms (~0.4%), **PDF conversion 900ms (~82%)**, upload 120ms (~11%). **PDF conversion dominates.**
2. **Neither cleanly** — it's dominated by an *external heavy library / subprocess* (a headless browser). It's CPU-and-I/O-heavy work happening *inside a third-party tool*, not in your language's code and not a simple network wait. Calling it "I/O-bound" or "CPU-bound in your code" both mislead.
3. Best-case win from a Go rewrite of *your* code: you'd speed up the ~6% that's the template render + framing — Amdahl ceiling ~1.06×, **~6%.** Wrong lever because 82% of the time is inside the PDF library, which your service language doesn't touch.
4. Fixes that matter: (a) make the **PDF generation asynchronous** — return immediately, generate in a background job, notify when ready — removing 900ms from the user-facing path entirely (the biggest win, and architectural, not language). (b) Use a **faster PDF engine** or a templated PDF generator instead of full HTML→headless-browser rendering — could cut the 900ms by a large multiple. Also worth: parallelize the tax call with the DB query.

### Task 6
1. Saving: `$120k × 55% ≈ $66,000 / month` → **~$792,000 / year.**
2. Rewrite cost: `6 × 4 × $15k = $360,000` one-time. Payback: `$360k / $66k ≈ 5.5 months.`
3. **Justified.** The single most defensible thing: the **55% saving was *measured* on a production-scale prototype**, not assumed from "Rust is faster" — and it lands on the highest-volume, genuinely CPU-bound (88%) service, so the win is reachable and material. Sub-6-month payback on a recurring ~$66k/mo saving is a clear yes.
4. **De-risking:** a **shadow / parallel run** — run the Rust engine alongside the Python one for several weeks, compare every pricing output, and only cut over when they match to the cent (essential because pricing errors are revenue- and trust-affecting). **Kill criterion:** "abandon the rewrite if the prototype's measured CPU reduction under production load falls below 30%, or if shadow-run pricing discrepancies exceed [tolerance]."
5. Driver line: **"Cloud cost — highest-volume CPU-bound service; measured 55% compute reduction, ~5.5-month payback."**

### Task 7
- **(a)** Graded on **cold-start / startup time**; optimized **throughput** (JVM warms up slowly). Better fit: a fast-cold-start runtime — Go/Rust native binary, or a non-JVM language, for Lambda. (Or keep it off Lambda on a warm long-running instance.)
- **(b)** Graded on **tail latency (p999) / predictability**; optimized **throughput** (Go's GC scans the large cache → spikes). Better fit: a no-GC language (Rust) for that service, or restructure to shrink GC-scanned heap. *(This is the Discord read-states story.)*
- **(c)** Graded on **predictability / determinism** (soft-real-time, no late buffers); optimized **average throughput** (GC pauses cause the late buffer). Better fit: a non-GC or low-pause language (Rust, C++), or a real-time-tuned runtime.
- **(d)** Graded on **memory footprint / cost** (RAM dominates the bill); optimized... not the right axis at all (a GC runtime's 3× memory overhead is the problem). Better fit: a manually-managed / compact-memory language (Rust, C++) for that data service to shrink instance size and the bill.

---

## A meta-check before you move on

For every task above, notice the *shape* of the right answer:

- You found **where the time goes** before judging the language.
- You computed an **Amdahl ceiling** and let it gate the decision.
- You tried (or named) the **cheaper fix** — index, cache, async, algorithm, escape hatch — before the rewrite.
- When a rewrite *was* justified (Tasks 2, 6), it was **targeted** and **measured**, with a revisit/kill trigger.
- You named the **specific axis** being graded, not just "fast."

If your instinct on the first read of any task was "rewrite it in a faster language," and the worked answer was "no, fix the database / make it async / move only the hot loop" — that gap *is* the lesson.

---

**Memorize this:** the right answer is almost never "rewrite it in a faster language." It's "find where the time goes, compute the ceiling, try the cheap fix, and only if a real numeric gap survives — rewrite the measured hot path, with a trigger to revisit." Optimize the bottleneck you found, not the language you can name.
