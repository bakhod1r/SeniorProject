> Interview questions on feedback loops, from "what's the difference" through diagnosing real distributed-systems dynamics. Strong answers name the loop, its **sign** (balancing vs reinforcing), and its **gain** and **delay** — and propose a fix that changes one of those parameters. Watch the traps: confusing "positive" with "good," forgetting jitter, and treating delay as harmless.

---

## Q1. What's the difference between a balancing and a reinforcing feedback loop?

A **balancing** loop opposes change and seeks a goal/setpoint — output going up triggers an action that brings it back down (thermostat, autoscaler, TCP congestion control). A **reinforcing** loop amplifies change with no goal — output going up triggers more of the same (retry storm, viral growth, cache stampede). Balancing loops settle toward equilibrium; reinforcing loops grow or collapse.

**Trap:** "positive feedback = good." Positive/reinforcing just means *self-amplifying*. A death spiral is positive feedback you didn't want.

## Q2. Walk me through a retry storm as a feedback loop.

A dependency slows → client calls time out → clients retry (often 3×) → effective load on the dependency multiplies → it slows further → more timeouts → more retries. It's a **reinforcing loop with gain ≈ retry count**. The danger is that the *recovery action* (retry) is what sustains the failure, so the system can't recover on its own even after the original trigger is gone — a **metastable failure**.

**Follow-up — how do you break it?** Cap the loop gain: retry budgets (limit total retries to a fraction of traffic), exponential backoff, circuit breakers to cut the loop, and load shedding to push the system back to the healthy state.

## Q3. Why isn't exponential backoff enough? Why add jitter?

Backoff lowers the retry loop's *gain over time*, but if many clients failed at the same instant they all back off by the *same* amount and retry *together* — you've just rescheduled the thundering herd to a few seconds later. **Jitter randomizes the wait so clients de-synchronize**, flattening the retry spike into a smooth trickle. Backoff reduces gain; jitter destroys the lockstep synchronization that gives the spike its punch. (AWS Architecture Blog, "Exponential Backoff And Jitter" — full jitter: `sleep = random(0, base * 2^attempt)`.)

**Trap:** proposing backoff without jitter for a fleet of clients that fail simultaneously.

## Q4. Why do autoscalers oscillate, and how do you stop it?

Oscillation comes from **delay** in a balancing loop. If new instances take minutes to boot, the autoscaler corrects on stale information — by the time capacity arrives, the spike is over, so it over-scales, then scales down too far, then gets caught flat on the next spike. This is autoscaler thrash, the same dynamic as the bullwhip effect.

**Fixes attack delay or gain:** shorten the delay (pre-warmed pools, faster boots, fresher metrics), or reduce reactivity (cooldown windows, hysteresis/dead bands so up-threshold ≠ down-threshold, bounded scale steps, scaling on a moving average instead of instantaneous CPU).

## Q5. Explain TCP congestion control as a feedback loop. Why is AIMD shaped the way it is?

TCP is a **balancing loop**: the signal is packet loss ("link congested"), the correction adjusts the congestion window. **AIMD** = Additive Increase (grow window +1/RTT when fine), Multiplicative Decrease (halve it on loss). The asymmetry is deliberate: gentle increase probes for bandwidth without overshooting; aggressive decrease backs off fast from congestion and prevents many flows from synchronizing and collectively overrunning the bottleneck. It's the gold standard for "a balancing loop that stays stable under contention."

**Follow-up:** this is exactly the intuition behind exponential backoff — back off fast, recover gently.

## Q6. What is loop dominance and why does it matter for outages?

A system has multiple loops active at once; the one currently controlling behavior is **dominant**. Under normal load, balancing loops dominate (autoscaler, load balancer) and the system self-corrects. Past a threshold, a reinforcing loop (retries, queue growth) can take over and the same system self-destructs. **The system didn't change — the dominant loop did.** Most "worked in staging, fell over in prod" outages are dominance flips that only appear past a load threshold. Design so the *balancing* guard triggers *before* the reinforcing loop runs away.

## Q7. What is a metastable failure?

A system with two stable states — healthy and degraded — where a reinforcing loop holds it in the degraded state even after the original trigger is gone. The classic example: a brief slowdown triggers retries; retries sustain the load that keeps the service slow; the slowdown is over but the retry loop keeps it wedged. **Recovery requires breaking the sustaining loop** (shed load, open breakers, restart with admission control), *not* fixing the original trigger — which no longer exists. (Bronson et al., HotOS 2021.)

## Q8. Why is delay the source of instability in a feedback loop?

A balancing loop wants to settle at its target, but if the correction lands *late*, it's acting on stale information, so it overshoots — then over-corrects the overshoot — producing oscillation. The longer the delay, the larger and slower the swings. The shower with a slow water heater is the canonical intuition; the bullwhip effect and autoscaler thrash are the engineering versions. **A balancing loop with high gain and long delay is the textbook recipe for oscillation.**

## Q9. A cache stampede — what loop is it, and how do you fix it?

A hot cache key expires → many concurrent requests all miss at once → all hit the origin → origin slows → requests queue → more misses pile on. **Reinforcing loop** triggered by synchronized expiry. Fixes: **request coalescing / single-flight** (one request recomputes, the rest wait on it), **jittered/staggered TTLs** so keys don't all expire together, **early/probabilistic recomputation** before expiry, and serving stale-while-revalidate. Note the theme: de-synchronize (jitter) plus cap concurrency (coalesce).

## Q10. How is observability related to feedback loops?

Observability *is* the measurement leg of every control loop in the system — including the human on-call loop. A balancing loop can't correct without a signal, just as a thermostat can't work without a thermometer. **Signal latency becomes loop delay**: a 1-minute metric pipeline adds a minute of delay to both the autoscaler and the engineer. So you alert on fast, leading signals (saturation, queue depth) over lagging ones (error counts after the fact), because the freshness of the signal *is* the responsiveness of the loop.

## Q11. Why do high-performing teams deploy frequently *and* have fewer failures? Isn't that a tradeoff?

It's not a tradeoff — it's a shorter loop. Frequent small deploys reduce both the **gain** (small batch = small correction) and the **delay** (fast feedback from decision to consequence). Big infrequent deploys are the bullwhip effect applied to software: large, delayed corrections that overshoot, are hard to roll back, and make regressions hard to attribute. Shortening the delivery loop improves speed and stability *together* — which is exactly what DORA finds. When a team is slow *and* unstable, shorten the loop (CI, trunk-based, fast rollback); don't add process, which lengthens the delay.

## Q12. Map the PID controller terms to a system you'd build.

- **P (proportional)** — react to the current error (scale proportional to how far CPU is over target). Pure-P with delay oscillates and never quite settles.
- **I (integral)** — react to accumulated error (catch up on a backlog). Too much causes windup / overshoot.
- **D (derivative)** — react to the *rate of change* (latency is climbing fast → act now). Noise-sensitive.

You rarely write a literal PID loop, but the lesson is: reacting only to the current level with delay oscillates; reacting to trends and smoothing damps it. Autoscalers using moving averages are borrowing the D/smoothing idea.

## Q13. How would you size a circuit breaker as a loop parameter?

Open the breaker on error rate > X% over window **W**, and choose **W shorter than the time for the reinforcing loop to multiply load** — otherwise the breaker reacts *after* the spiral has started (its delay is too long to help). Pair it with a retry budget that caps total retries below the dependency's spare capacity, so the loop's gain can't exceed the runaway threshold. The point: every resilience config is a loop parameter, and you justify its number in terms of gain or delay, not "it's the default."

## Q14. Give an example of a destructive *reinforcing loop in process*, not code.

Alert fatigue: noisy alerts → engineers tune them out → real alerts missed → more incidents → more alerts added → more noise. It's reinforcing, so it compounds quietly until a missed page causes a major outage. **Damper:** cut the loop's gain — page only on symptoms / SLO burn, route everything else to dashboards. Other examples: tech-debt spiral, review-latency spiral, on-call burnout spiral. The skill is spotting them *early*, while the gain is still gentle.

## Q15. The single highest-leverage intervention in a feedback loop is usually what?

**Changing a delay.** Shortening the lag between signal and correction stabilizes every loop that depends on that signal — cutting deploy lead time, metric latency, instance boot time, or budget-burn feedback. Changing a loop's **gain** (retry budget, scale-step bound, backoff curve) is the next-highest. Adding or removing a loop entirely (circuit breaker, backpressure) changes the regime. (Meadows ranks loop parameters and feedback structure high among leverage points.)

**Trap:** answering "monitor it more" — monitoring without shortening the loop doesn't change the dynamics; it just lets you watch the oscillation in higher resolution.
