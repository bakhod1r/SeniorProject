---
layout: default
title: Interview
parent: Dynamic Worker Scaling
grand_parent: Production Patterns
ancestor: Go
nav_order: 7
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/18-production-patterns/02-dynamic-worker-scaling/interview/
---

# Dynamic Worker Scaling — Interview Questions

> Questions from junior through staff level. Each has a model answer, common wrong answers, and follow-up probes.

---

## Junior

### Q1. What is a worker pool?

**Model answer.** A worker pool is a fixed-size set of goroutines that pull tasks from a shared channel. It limits concurrency to the pool size. Each goroutine loops, receiving tasks and processing them. Common pattern in Go for bounded parallelism.

**Common wrong answers.**
- "A pool of OS threads." (No — goroutines, not threads.)
- "A queue of tasks." (The queue is one component; the pool is workers + queue.)

**Follow-up.** *Why use a pool instead of `go f()` per task?* — To limit concurrency, protect downstreams from overload, and reuse goroutines (cheaper than spawning a million).

---

### Q2. What does "dynamic worker scaling" add to a static pool?

**Model answer.** A dynamic pool changes its worker count at runtime based on observed load. Common signals: queue depth, wait time, utilization. The pool grows when load is high and shrinks when load is low.

**Common wrong answers.**
- "It uses more workers always." (No — it varies.)
- "It's the same as auto-restart." (No — restart is different; dynamic scaling is in-process resize.)

**Follow-up.** *When would you not use dynamic scaling?* — Steady, predictable workloads where the optimal static size is known. Dynamic adds complexity that may not be justified.

---

### Q3. How do you start a worker in Go?

**Model answer.**
```go
go worker(jobs)
```

where `worker` is a function that loops on `<-jobs`. Each `go` statement spawns one goroutine.

**Follow-up.** *How do you stop it?* — Close the channel (`close(jobs)`); the `for job := range jobs` loop ends. Or send a sentinel value, or signal via a separate channel.

---

### Q4. What is the simplest way to scale a pool up?

**Model answer.** Spawn additional goroutines that read from the same channel:

```go
for i := 0; i < toAdd; i++ {
    go worker(jobs)
}
```

The new workers compete with existing ones for jobs.

**Follow-up.** *Is this safe to do concurrently?* — Yes, channels are MPMC-safe. Spawning workers is a normal operation.

---

### Q5. Why is shrinking harder than growing?

**Model answer.** You cannot kill a goroutine from outside in Go. To shrink, you must cooperate: send a signal that workers detect and respond by returning. The simplest way is to set a target size atomically; each worker checks before its next loop iteration and exits if the pool has shrunk.

**Follow-up.** *Can you abort a worker mid-task?* — Only via context cancellation, which the task itself must respect. The worker cannot force the task to return.

---

### Q6. What is `ants.Tune(n)`?

**Model answer.** `Tune(n)` changes the pool's maximum capacity to n. It is atomic and O(1). It does not spawn or kill workers immediately; growth happens lazily (next submit) and shrink happens opportunistically (workers exit when they next finish a task).

**Follow-up.** *What is the difference between `Tune` and rebuilding the pool?* — `Tune` is fast and preserves in-flight tasks. Rebuilding loses state and is much slower.

---

### Q7. What is a goroutine leak?

**Model answer.** A goroutine leak occurs when a goroutine is started but never exits, holding memory and possibly other resources forever. In pools, this happens when workers fail to exit on shutdown, or when blocked on a channel that never receives, or when an unrecovered panic leaves state inconsistent.

**Follow-up.** *How do you detect it?* — `runtime.NumGoroutine()` over time; `goleak` in tests; pprof to inspect the goroutine stack.

---

## Middle

### Q8. What is hysteresis in autoscaling?

**Model answer.** Hysteresis is the practice of using different thresholds for scaling up and scaling down. For example: scale up when queue > 75%, scale down when queue < 10%. The gap (10-75%) is a deadband where no action is taken. Hysteresis prevents oscillation around a single threshold.

**Follow-up.** *Why not the same threshold?* — A single threshold causes flapping: the system crosses it every few ticks, triggering constant resize. Wide hysteresis filters this noise.

---

### Q9. What is a cooldown in autoscaling?

**Model answer.** A cooldown is the minimum time interval between consecutive resizes in a given direction. Typically asymmetric: up-cooldown might be 2-5 seconds, down-cooldown 30-60 seconds. The asymmetry reflects that cost of under-capacity (missed SLO) usually exceeds cost of over-capacity (wasted workers).

**Follow-up.** *Without cooldown, what happens?* — Pool flaps. Each tick may trigger a resize. Pool size oscillates rapidly; latency suffers.

---

### Q10. What is the difference between scaling on queue depth vs wait time?

**Model answer.** Queue depth = number of tasks waiting. Wait time = how long they've waited. Wait time is closer to the customer-visible SLO. Queue depth is cheaper to compute (one atomic read) but misses scenarios where workers are slow (e.g., slow downstream): queue stays low but wait time is high.

**Follow-up.** *When does queue depth fail?* — When workers process tasks but slowly. Tasks don't accumulate in queue; they accumulate inside workers. Queue depth signal misses this; wait time catches it.

---

### Q11. What is AIMD?

**Model answer.** AIMD = Additive Increase, Multiplicative Decrease. Borrowed from TCP congestion control. Grow by a small constant (e.g., +1 worker) per cycle. Shrink by a percentage (e.g., -25%) per cycle. Provably stable; produces fair sharing among multiple AIMD participants competing for the same resource.

**Follow-up.** *Why AIMD over MIAD?* — Multiplicative grow overshoots and stays high; additive shrink is too slow. AIMD's asymmetry — gentle grow, aggressive shrink — fits the cost asymmetry: cheaper to keep one extra worker than to overshoot capacity.

---

### Q12. What is EWMA?

**Model answer.** EWMA = Exponentially-Weighted Moving Average. A smoothed signal: `ewma = alpha * sample + (1 - alpha) * ewma_prev`. Alpha controls how fast it tracks: alpha=0.3 reacts quickly; alpha=0.1 smooths heavily. Used in autoscaling to reduce noise in signal collection.

**Follow-up.** *EWMA vs SMA?* — SMA = simple moving average over last N samples. EWMA is cheaper (single state variable, single multiply-add per sample) and has no sharp cutoff (recent samples weight more, but older ones still contribute).

---

### Q13. What is idle expiry in ants?

**Model answer.** Idle expiry (`WithExpiryDuration`) makes workers exit if they have been idle for longer than the specified duration. This is decentralized scale-down: each worker decides independently. A separate purger goroutine periodically scans the free list and signals stale workers to exit.

**Follow-up.** *Why both idle expiry and autoscaler?* — Idle expiry handles slow gradual decline; the autoscaler handles burst-driven grow. They are complementary.

---

### Q14. How would you choose floor and ceiling?

**Model answer.** Floor: enough workers for minimum expected throughput. Compute via Little's Law: `floor = min_rate * service_time`. Add some headroom.
Ceiling: max acceptable workers given memory and downstream capacity. Compute: `ceiling = max_rate * service_time * 2` (safety factor).
Verify against capacity plan; iterate based on observed behavior.

**Follow-up.** *Why not floor=0?* — Cold start. First request after idle pays a goroutine-spawn penalty. For tight SLOs, floor at least equal to expected idle-period load.

---

### Q15. What is Little's Law?

**Model answer.** For a stable queueing system: `L = λ × W`. L = average concurrency. λ = throughput. W = average time in system. For a worker pool: busy workers = throughput × service time. If throughput is 200 req/s and service time is 100 ms, you need 20 workers busy on average.

**Follow-up.** *When is Little's Law useful in autoscaling?* — As an initial sizing baseline. Compute expected busy workers; provision floor and ceiling around that.

---

### Q16. Why is `len(ch)` racy but acceptable for autoscaling?

**Model answer.** `len(ch)` is atomic but its value may be stale by the time you act on it. For autoscaling, the value is averaged and aggregated over multiple ticks; small inaccuracy doesn't affect long-term behavior. The autoscaler's resize decisions are inherently fuzzy; using `len(ch)` is fine.

**Follow-up.** *When would it be unacceptable?* — When making consistency-critical decisions that depend on exact queue state, e.g., transactional handoffs. Not autoscaling.

---

### Q17. What metrics would you export from a pool?

**Model answer.**
- Gauge: pool_size (current)
- Gauge: pool_busy (active workers)
- Gauge: pool_queue_depth
- Counter: pool_submitted_total
- Counter: pool_completed_total
- Counter: pool_dropped_total
- Histogram: pool_wait_seconds
- Histogram: pool_process_seconds
- Counter: pool_resizes_total (with direction label)

**Follow-up.** *What alerts would you set?* — Pool at ceiling > 5 min; resizes/min > 30 (flapping); drops > 0; p99 wait > SLO.

---

## Senior

### Q18. Design an autoscaler that integrates with a circuit breaker.

**Model answer.** The breaker's state (closed/half-open/open) is a signal. The autoscaler vetoes growth when the breaker is open: "if breaker is open, don't grow." During half-open, the autoscaler is conservative (small step or no growth). When closed, normal behavior.

This prevents the failure mode where downstream is sick, workers tie up waiting on slow calls, queue grows, autoscaler grows pool, more workers slam the sick downstream.

**Follow-up.** *What if the breaker keeps flapping?* — Add anti-flap to the breaker itself. Or use a long minimum open duration. The autoscaler should not paper over breaker instability.

---

### Q19. Explain PID for worker pool autoscaling.

**Model answer.** PID = Proportional + Integral + Derivative. Maintain a process variable (e.g., utilization) at a set-point (e.g., 0.7). The output is the resize delta. P term reacts to current error; I term to accumulated error (steady-state); D term to rate of change (damping).

Tune Kp first (until oscillation, then back off). Add small Ki for steady-state accuracy. Add Kd if oscillation persists.

Caveats: integral windup (clamp during saturation); noise amplification in D term.

**Follow-up.** *When is PID overkill?* — Most worker pools. Bang-bang controllers with hysteresis are simpler and usually sufficient.

---

### Q20. How do you coordinate autoscaling across multiple pools?

**Model answer.** Several patterns:

1. **Independent**: each pool autoscales separately. Simplest. Risk: collective overcommit.
2. **Shared budget**: a Budget struct with total capacity. Each pool requests growth; budget allocates. Total bounded.
3. **Priority budget**: higher-priority pools get budget first; lower-priority preempted.
4. **Central coordinator**: external service decides each pool's size.

Choose based on coordination needs vs operational complexity.

**Follow-up.** *Trade-off?* — Tighter coordination = better resource utilization but more complexity and failure modes. Loose coordination is more robust but less efficient.

---

### Q21. What is a cascading failure in autoscaling context?

**Model answer.** Downstream service is slow. Tasks pile up in workers (long wait on downstream call). Queue grows. Autoscaler grows pool. More workers slam slow downstream. Downstream gets slower. Loop.

Defenses: circuit breaker stops the slamming. Error-rate veto in autoscaler prevents growth during failure. Rate limiters at the edge shed load.

**Follow-up.** *Have you seen this in production?* — Yes (or share an example). The fix is multi-signal autoscaling with vetoes.

---

### Q22. How do you stress-test an autoscaler?

**Model answer.**
- Linear ramp (gradually increase load)
- Step (instant jump)
- Sawtooth (up-down-up cycles)
- Chaos (random spikes)
- Slow downstream injection
- Error injection

Run in staging. Watch metrics: tail latency, pool size, resize events, drops.

Goal: see how the autoscaler reacts under stress. Tune thresholds based on observation.

**Follow-up.** *What is a sign the autoscaler is well-tuned?* — Smooth pool size curve, no oscillation, SLO met, no drops during normal ranges.

---

### Q23. How do you design predictive autoscaling?

**Model answer.** Build a forecast model. Simple: time-of-day schedule. Medium: linear extrapolation of recent samples. Advanced: time-series models (Holt-Winters, ARIMA, neural networks).

Use prediction to pre-warm the pool ahead of expected load. Combine with reactive autoscaling for unexpected variation:

```go
target = max(predicted, reactiveTarget)
```

When prediction is accurate: smoother behavior, better tail latency. When prediction is wrong: reactive corrects.

**Follow-up.** *When is predictive worth it?* — Strong patterns (daily, weekly). For random workloads: no.

---

### Q24. Explain how ants's `revertWorker` works.

**Model answer.** `revertWorker(w)` is called when a worker finishes a task. It checks:
1. Has the pool shrunk? (`Running() > Cap()`): return false. Worker's outer loop sees false; goroutine exits.
2. Is the pool closed? Return false; worker exits.
3. Otherwise: lock; insert w back into free list; signal cond; return true.

This is opportunistic shrink: a worker finishes its task and only then checks whether it should exit.

**Follow-up.** *Why opportunistic?* — To never interrupt in-flight tasks. The shrink is bounded by task duration; long-running tasks delay shrink.

---

### Q25. Compare ants, tunny, and pond.

**Model answer.**

- **ants**: most widely used. Tune(n) for dynamic resize. Idle expiry built in. Free list of worker structs (sync.Pool). Stateless workers. Best for high-throughput generic pools.
- **tunny**: Worker interface for stateful workers. Process()/SetSize() with eager shrink. Synchronous request-response model. Good for pools where each worker has expensive state (DB conn, model).
- **pond**: cleaner API. Task groups (like errgroup). No Tune. Best for batch operations with bounded parallelism.

Choose by workload: state, throughput, dynamic needs.

**Follow-up.** *Which do you reach for first?* — ants for production unless I need tunny's Worker interface or pond's task groups.

---

### Q26. How do you implement opportunistic shrink in a hand-rolled pool?

**Model answer.**

```go
func (p *Pool) worker() {
    for {
        if atomic.LoadInt32(&p.live) > atomic.LoadInt32(&p.target) {
            atomic.AddInt32(&p.live, -1)
            return
        }
        select {
        case task, ok := <-p.jobs:
            if !ok { atomic.AddInt32(&p.live, -1); return }
            task()
        case <-p.quit:
            atomic.AddInt32(&p.live, -1); return
        }
    }
}
```

Each iteration, worker checks if live > target. If so, exits. The first worker to notice the shrink is the one that exits. No coordination needed because workers are interchangeable.

**Follow-up.** *What if you need immediate shrink?* — Cooperative cancellation: workers monitor ctx.Done() inside their task. The task code must respect cancellation.

---

### Q27. What is the difference between cap and live in a dynamic pool?

**Model answer.** Cap (capacity) = configured maximum. Live = current running workers. After `Resize(n)`, cap is n. Live may be lower (shrink in progress) or equal. Cap is updated synchronously; live updates as workers spawn or exit.

**Follow-up.** *Can live exceed cap?* — Briefly, during opportunistic shrink, yes. Workers spawned before the cap reduction may not have exited yet. The condition resolves within a few task durations.

---

## Professional / Staff

### Q28. Describe a real production incident involving autoscaling.

**Model answer.** Share a real story. Structure:
- Symptoms (what was observed)
- Cause (root analysis)
- Fix (what was done)
- Lesson (what changed long-term)

Example: "We had a service where the autoscaler grew during downstream failures. Tail latency spiked. Fix: added downstream error rate as a veto signal in the autoscaler. Lesson: single-signal autoscalers are dangerous in coupled systems."

**Follow-up.** *What would you do differently?* — Reflect on engineering decisions.

---

### Q29. How would you build a tunable autoscaler framework for an organization with 100 services?

**Model answer.** Composable interfaces:
- Pool (resize, size)
- Signal (sample)
- Decider (decide)
- Cooldown (check, record)
- Bounds (clamp)

Configuration via YAML (loaded at startup, hot-reloadable).

Built-in implementations:
- Signals: wait, util, depth, Prometheus
- Deciders: threshold, AIMD, PID, composite

Observability:
- Standardized metrics across services
- Central event log
- Auto-tuned dashboards

Operational tooling:
- Manual override CLI
- Live tuning via HTTP API
- Health endpoint per autoscaler

Platform team owns it; service teams plug in.

**Follow-up.** *Trade-offs?* — Framework cost (1-2 engineers) vs per-service cost (each team implementing their own).

---

### Q30. How does autoscaling interact with Kubernetes HPA?

**Model answer.** Two levels:
- HPA scales pods (minutes time scale)
- In-process autoscaler scales workers (seconds time scale)

HPA looks at CPU, memory, or custom metrics across pods. In-process looks at per-pod metrics.

Coordination: HPA's custom metric should be per-pod utilization (target ~70%). In-process autoscaler keeps per-pod utilization near target. HPA adds pods when sustained demand exceeds per-pod capacity.

They complement: in-process absorbs bursts; HPA handles sustained load.

**Follow-up.** *Conflicts?* — Cooldowns differ (seconds vs minutes). New pods start cold (low util); HPA might prematurely scale down before warm-up. Solve with HPA stabilization windows.

---

### Q31. How do you apply queueing theory to pool sizing?

**Model answer.**

- Little's Law: L = λ × W (basic sizing)
- M/M/c (multi-server queueing): for given utilization, predict wait time. Operating at 80% utilization gives much shorter waits than 95%.
- M/G/k (general service time): factors in service time variance. High variance = longer waits.

For SLO targeting: at high utilization (≥ 80%), wait time grows non-linearly. Size for utilization ≤ 70% to meet tight SLOs.

**Follow-up.** *When does queueing theory break down?* — Non-stationary workloads (changing character), heavy-tailed service distributions, feedback effects (slow downstream).

---

### Q32. Design a multi-region autoscaling architecture.

**Model answer.**

Per-region:
- Local in-process autoscaler per pool
- Local HPA scales pods

Cross-region:
- Global controller observes regional load
- Adjusts regional targets (allocation)
- Handles failover (route traffic to healthy regions; pre-warm)

Coordination via metrics aggregation. Decisions local (in-process); global (controller) overrides during anomalies.

CAP trade-off: regional autonomy favored. Global controller is best-effort.

**Follow-up.** *Cost-vs-latency?* — More regions = better latency for users globally. Cross-region traffic is expensive; most autoscaling stays local.

---

### Q33. How would you debug a pool that is flapping?

**Model answer.**

1. Check resize event log. Pattern of rapid up-down-up?
2. Check signal values. Crossing thresholds frequently?
3. Check cooldowns. Are they being honored?
4. Check deadband. Too narrow?
5. Check signal smoothing. Noise getting through?

Likely fixes:
- Widen deadband (e.g., 80/15 instead of 70/30)
- Lengthen cooldowns
- Smooth signal more (lower alpha in EWMA)
- Sample less frequently if noise is the issue

**Follow-up.** *How do you detect flapping in production?* — Alert on resizes/min > 30. Track via metric.

---

### Q34. What happens if your autoscaler goroutine panics?

**Model answer.** If unrecovered: the program crashes. Bad.

Wrap the autoscaler loop in `defer recover()`. Log the panic. Optionally restart the autoscaler.

Without panic recovery: one autoscaler bug crashes the service.

```go
func (a *Autoscaler) Run(ctx context.Context) {
    defer func() {
        if r := recover(); r != nil {
            log.Error("autoscaler panicked", r, debug.Stack())
        }
    }()
    a.run(ctx)
}
```

**Follow-up.** *Should you restart it?* — Depends on policy. For critical services, yes (with backoff to prevent crash loops). For best-effort, log and accept frozen pool size until next deploy.

---

### Q35. How do you make autoscaling cost-aware?

**Model answer.** Model cost: per-worker hourly cost, downstream call cost. Compare to benefit: latency improvement × value-of-latency.

Decision: grow only when expected benefit > marginal cost.

```go
if expectedLatencyImprovement * latencyValue > workerCost {
    grow
}
```

Hard to estimate accurately; in practice, encode as thresholds.

For budget caps: explicit `monthlyBudget`. Refuse growth that would exceed.

**Follow-up.** *Is cost-aware always right?* — No. SLO violations have higher cost than capacity. Don't let cost-aware autoscaler miss SLO.

---

## Tricky / Edge Cases

### Q36. What happens if you call `Tune(0)` on an ants pool?

**Model answer.** Allowed; the pool's capacity becomes 0. New submissions block (waiting for a slot that never appears) or return ErrPoolOverload (if Nonblocking). In-flight tasks complete; workers then exit on next revertWorker check.

**Follow-up.** *Why allow this?* — Convenient for "pause" semantics. Surprising for callers who don't expect blocking.

---

### Q37. What's the difference between `Tune(-1)` and `Tune(MaxInt)` in ants?

**Model answer.** `Tune(-1)` enables unlimited capacity (no cap enforcement). `Tune(MaxInt)` sets a very high but finite cap. Functionally similar; the `-1` form is the documented "no limit" sentinel.

For autoscaling: don't use unlimited capacity. Always set a finite ceiling.

---

### Q38. What if `Resize` is called concurrently with `Close`?

**Model answer.** Implementation-dependent. A well-designed pool guards `Resize` with a closing flag; Resize on a closed pool is a no-op. Without the guard, Resize might spawn workers on a closing pool, causing leaks or panics.

**Follow-up.** *How would you fix this in your own pool?* — Mutex + closing bool. Hold the mutex in both Resize and Close.

---

### Q39. Why is `wg.Add` called *before* `go`?

**Model answer.** If `wg.Add(1)` is inside the goroutine, the parent's `wg.Wait()` might see counter=0 before any Add is called. Wait returns; parent proceeds; spawned goroutines may not have started. Memory model violation, race conditions, lost tasks.

Always: `wg.Add(1)` before `go`. Match with `defer wg.Done()` inside.

---

### Q40. How would you implement multi-tenant fairness in a single pool?

**Model answer.** Per-tenant queues; a scheduler picks the next task fairly:

```go
type FairPool struct {
    queues map[Tenant]chan func()
    order  []Tenant
    idx    int
}

func (p *FairPool) nextTask() func() {
    for i := 0; i < len(p.order); i++ {
        t := p.order[(p.idx + i) % len(p.order)]
        select {
        case task := <-p.queues[t]:
            p.idx = (p.idx + i + 1) % len(p.order)
            return task
        default:
        }
    }
    return nil
}
```

Round-robin across tenants. Weighted fair queueing (DRF) for paid tiers.

**Follow-up.** *Trade-off vs separate pools?* — Single pool: efficient. Separate pools: stronger isolation. Choose based on isolation needs.

---

## Bonus: Behavioral

### Q41. Tell me about a time you tuned an autoscaler.

**Model answer.** Share a real story. Structure:
- Context (workload, why autoscaler needed)
- Initial state (what was wrong)
- Investigation (what data you looked at)
- Change (what you adjusted)
- Outcome (what improved)
- Lesson (what you learned)

Make it specific. Cite numbers. Acknowledge mistakes.

---

### Q42. How do you decide when to add complexity to an autoscaler?

**Model answer.** Evidence-driven. If a simpler version is working well, leave it alone. Add a new signal, a new decider, a new veto only when there's data showing it's needed.

The complexity tax is real: every added piece is something to maintain, test, debug. Resist the urge to be clever.

---

### Q43. Have you read pool library source code?

**Model answer.** Yes, ants (and which parts). Mention specific patterns: opportunistic shrink, cond-based blocking, free list management. This demonstrates engineering depth.

If no: be honest. Mention which library you've used and what you'd want to learn from the source.

---

### Q44. What's your favorite pool pattern?

**Model answer.** Share a personal preference. Examples:
- Opportunistic shrink (simplicity wins)
- AIMD (control theory borrowed from TCP)
- Multi-signal with vetoes (real-world resilience)

A genuine answer shows engineering passion. Generic answers ("they all have trade-offs") are weaker.

---

### Q45. What's the worst autoscaling bug you've seen?

**Model answer.** A real bug story. Include:
- What happened
- Impact
- Root cause
- Fix

Good answers reveal incident-response skills. Excellent answers reveal systemic improvements made.

---

That's 45 questions across all levels. Practice answering them out loud; the structure helps clarity in real interviews.
