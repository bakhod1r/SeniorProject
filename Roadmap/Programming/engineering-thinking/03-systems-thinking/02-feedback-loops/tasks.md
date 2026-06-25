> Exercises for reasoning about feedback loops. For each, the discipline is the same: **identify the loop, sign it (balancing vs reinforcing), label its gain and delay, then propose an intervention that changes one of those parameters.** Constraints: name the *loop structure*, not just the trigger; for every fix, state *which parameter* (gain, delay, or sign/dominance) it changes; prefer fixes that hold under contention and at scale; cite a real mechanism (backoff+jitter, circuit breaker, AIMD, retry budget, error budget) where it fits. Deliverables marked **[D]** should be written artifacts (a diagram, a config, a short memo).

---

## Task 1 — Classify ten loops

For each, label **balancing** or **reinforcing**, and name the parameter you'd watch:

1. Thermostat holding room temperature.
2. A tweet getting more views the more it's retweeted.
3. Autoscaler adding instances when CPU rises.
4. Clients retrying a slow service 3× on timeout.
5. TCP halving its window on packet loss.
6. A popular item staying cached because it's accessed often.
7. A connection pool making callers wait when full.
8. Memory pressure → more GC → less CPU → more queuing → more allocation.
9. Load shedder dropping low-priority requests near capacity.
10. A growing backlog making each worker slower (context-switching), growing the backlog faster.

**Deliverable [D]:** a 2-column table. *Check yourself:* the reinforcing ones are 2, 4, 6, 8, 10; the rest are balancing.

## Task 2 — Find the delay

Given this autoscaler: scales on CPU averaged over 5 minutes; new instances take 3 minutes to boot; scale-down has a 2-minute cooldown. Traffic spikes are ~4 minutes long.

- Identify every source of **delay** in the loop and add them up.
- Explain, in terms of delay vs spike duration, why this autoscaler will thrash.
- Propose three changes that each cut delay, and one that reduces gain. **[D]** Annotate a loop diagram with the delays.

## Task 3 — Break the retry death spiral

A service B calls C. On timeout (1s), B retries up to 3×. C's p99 is degrading and B's error rate is climbing.

- Compute the **effective load multiplier** C sees in the worst case.
- Explain why this is metastable — why C won't recover even after the original slowdown passes.
- Design the fix: specify a **retry budget** (as a % of traffic), a **backoff+jitter** curve, and a **circuit breaker** threshold + window. For each, state which loop parameter it changes. **[D]** Write the client config (pseudo-config is fine) with justified numbers.

## Task 4 — Why backoff alone failed

A team added exponential backoff to 50,000 IoT clients. After a 10-second backend blip, the backend fell over *harder* 1 second, then 2, then 4 seconds after recovery — synchronized waves.

- Explain the loop dynamic: what did backoff *without jitter* fail to fix?
- Specify the exact jitter strategy (full jitter formula) and explain why it flattens the waves.
- **[D]** Sketch (described or ASCII) the retry-rate-over-time curve before and after jitter.

## Task 5 — Diagnose the regime shift

A service is fine at 8k req/s, mildly slow at 10k, and collapses at 11k — far below its theoretical 15k capacity ceiling. Latency goes super-linear around 10k.

- Identify which **balancing** loops dominate below 10k and which **reinforcing** loop takes over above it.
- What measurable leading indicators would warn you of the impending **dominance flip**?
- Propose where to place a balancing guard so it triggers *before* 10k. State the trigger point and why.

## Task 6 — Read the cache stampede

A read-heavy service caches DB results with a 60s TTL. Every minute, p99 latency spikes for ~2 seconds and the DB CPU jumps to 90%.

- Identify the loop and its trigger (be precise about *synchronized* expiry).
- Give three independent fixes (coalescing/single-flight, TTL jitter, early recompute) and state what each one does to the loop (caps concurrency vs de-synchronizes).
- **[D]** Which one fixes it most robustly under a 100× traffic spike, and why?

## Task 7 — Map a controller to PID

You're building an autoscaler. Currently it scales purely proportional to instantaneous CPU-over-target and it oscillates.

- Explain, in PID terms, why pure-P with actuator delay oscillates.
- Describe what a **D-like** term (reacting to the rate of change of CPU) and **smoothing** would add, and what each costs (noise sensitivity, lag).
- Propose the final control logic (signal source, dead band, scale-step bound, cooldown) and tie each choice to a loop parameter.

## Task 8 — The error-budget loop

Design an SLO/error-budget feedback loop for a service with a 99.9% availability target over 30 days.

- Draw the loop: setpoint, signal, error, actuator. What is the *actuator* (what does the org actually change)?
- The naïve loop has a long delay (you only know at month-end). Specify **burn-rate alerts** (multi-window) that shorten the delay, and explain what delay reduction buys you.
- **[D]** Write the alert conditions (e.g., burn rates + windows) and a one-paragraph memo on why this aligns incentives without a recurring features-vs-reliability argument.

## Task 9 — Spot the vicious organizational loop

Your team's on-call is degrading: more incidents this quarter, alerts up 40%, two engineers left, the rest are exhausted.

- Identify the **reinforcing loop(s)** at work (name at least two: alert-fatigue and burnout) and how they couple.
- For each, name the **damper** and which parameter it changes (gain vs delay).
- **[D]** Write a 1-page intervention plan that breaks the loops *and* names the leading indicator you'll watch to confirm it's working. Cross-reference [Second-order effects](../03-second-order-effects/) for the consequences of your fix.

## Task 10 — Delivery loop as gain and delay

A team deploys once a month. Releases are large, rollbacks are scary, and regressions take days to attribute to a change.

- Map deploy frequency and lead time to loop **gain** and **delay**.
- Explain why "deploy more often *and* break less" is not a contradiction — frame it as shortening the loop.
- Propose three concrete changes (e.g., trunk-based dev, CI, feature flags, automated rollback) and state, for each, whether it cuts gain or delay. Reference the DORA framing in [Mental models of systems](../04-mental-models-of-systems/).

## Task 11 — The highest-leverage intervention

You're handed a system (technical or organizational) that is both slow and unstable. You may make exactly **one** change.

- Argue why the answer is almost always **"shorten a delay,"** and identify the dominant delay in two scenarios: (a) an autoscaler that thrashes, (b) an org whose strategy keeps overshooting because results take a quarter to measure.
- Explain why "add more monitoring" or "add a review gate" are often *wrong* answers (one doesn't change dynamics; the other *adds* delay).
- Tie your reasoning to the ranking in [Leverage points and bottlenecks](../06-leverage-points-and-bottlenecks/).

## Task 12 — Synthesis: design a self-stabilizing fleet default

You own the platform's standard service client and want every service to inherit safe loop behavior by default.

- Specify the defaults that bound reinforcing-loop gain and de-synchronize clients (retry budget, backoff+jitter, circuit breaker, bounded queue + backpressure).
- For each default, name the loop it tames and the failure it prevents (retry storm, thundering herd, queue runaway).
- **[D]** Write a short design memo: what each default is set to, why that number (in gain/delay terms), and the one tradeoff it imposes — cross-reference [Thinking in tradeoffs](../05-thinking-in-tradeoffs/) and the resilience link to [risk and failure probabilities](../../06-probabilistic-thinking/03-risk-and-failure-probabilities/).

---

**When you finish:** re-read your answers and check that every fix names a loop *parameter* (gain, delay, or dominance/sign), not just a tool. If you wrote "add a circuit breaker" without saying *which loop it cuts and why its window is short enough*, you haven't finished the exercise. Section root: [Systems Thinking](../) · Roadmap root: [../../README.md](../../README.md).
