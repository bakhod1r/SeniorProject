---
layout: default
title: Professional
parent: Premature Optimization
grand_parent: Concurrency Anti-Patterns
ancestor: Go
nav_order: 4
permalink: /roadmap/programming-languages/golang/07-concurrency/15-concurrency-anti-patterns/04-premature-optimization/professional/
---

# Premature Concurrency Optimization — Professional Level

## Table of Contents
1. [Introduction: the professional context](#introduction-the-professional-context)
2. [Production observability as a precondition for optimisation](#production-observability-as-a-precondition-for-optimisation)
3. [SLOs and how they discipline optimisation](#slos-and-how-they-discipline-optimisation)
4. [The bench-then-decide culture at scale](#the-bench-then-decide-culture-at-scale)
5. [Profiling-driven optimisation workflow](#profiling-driven-optimisation-workflow)
6. [Continuous profiling in production](#continuous-profiling-in-production)
7. [When to introduce concurrency vs scale horizontally](#when-to-introduce-concurrency-vs-scale-horizontally)
8. [Vertical scaling, horizontal scaling, and in-process concurrency](#vertical-scaling-horizontal-scaling-and-in-process-concurrency)
9. [Latency vs throughput tradeoffs](#latency-vs-throughput-tradeoffs)
10. [Tail latency as a first-class concern](#tail-latency-as-a-first-class-concern)
11. [Capacity planning with concurrency](#capacity-planning-with-concurrency)
12. [Cost models: dollars per request](#cost-models-dollars-per-request)
13. [The fleet view: optimisation at scale](#the-fleet-view-optimisation-at-scale)
14. [Architectural premature optimisation](#architectural-premature-optimisation)
15. [Actor frameworks: when they help, when they hurt](#actor-frameworks-when-they-help-when-they-hurt)
16. [Lock-free data structures in production](#lock-free-data-structures-in-production)
17. [Sharding strategies and their breakeven points](#sharding-strategies-and-their-breakeven-points)
18. [Concurrency control patterns: token buckets, semaphores, rate limiters](#concurrency-control-patterns-token-buckets-semaphores-rate-limiters)
19. [Backpressure as system architecture](#backpressure-as-system-architecture)
20. [Production case studies](#production-case-studies)
21. [Operational considerations](#operational-considerations)
22. [Migration patterns: from concurrent back to simple](#migration-patterns-from-concurrent-back-to-simple)
23. [The mature performance organisation](#the-mature-performance-organisation)
24. [Self-assessment](#self-assessment)
25. [Summary](#summary)

---

## Introduction: the professional context

The professional level is not a higher rank in the engineering hierarchy. It is a different *frame*: at this level you are responsible not just for code quality and team practices but for the *production* impact of every change. A premature concurrency optimisation at this scale is no longer a code-review issue — it can be a paging issue, a cost issue, a customer-trust issue.

This document covers four professional skills:

1. **SLO-driven optimisation**: making decisions in terms of what the user (and the business) experiences.
2. **Fleet-aware reasoning**: thinking about a change's impact across hundreds or thousands of instances.
3. **Cost-aware engineering**: dollars-per-request, dollars-per-engineer-hour, opportunity-cost analysis.
4. **Architectural pattern judgement**: recognising when an "advanced" concurrency pattern is justified and when it is cargo-culted from a paper.

The professional engineer can hold all four lenses simultaneously. They look at a "make it concurrent" proposal and ask: "Does this move the SLO? Does it pay for itself across the fleet? What architectural alternatives exist? What is the cost of the complexity for the org?"

If you have read the senior-level document, you know the physics. This document layers on the *business and operational* context.

---

## Production observability as a precondition for optimisation

You cannot optimise what you cannot measure. In production this means: continuous metrics, traces, logs, and on-demand profiles. Without these, every optimisation is a guess.

### The minimum bar for production observability

A Go service should expose:

- **`/debug/pprof/*` endpoints** behind authentication. CPU, heap, goroutine, mutex, block profiles available on demand.
- **Prometheus metrics or equivalent**: request count, latency histogram, in-flight count, error rate, goroutine count.
- **Distributed traces**: every request tagged with a trace ID, span tree captured.
- **Structured logs**: every interesting event with consistent fields.
- **GC and runtime metrics**: `go_gc_duration_seconds`, `go_memstats_*`, `go_goroutines`.

If any of these is missing, fix that *before* attempting concurrency optimisations. You cannot reason about production performance from a vacuum.

### Observability for concurrent code specifically

Beyond the baseline, concurrent services benefit from:

- **In-flight request gauge**: how many requests are currently being handled.
- **Worker pool depth**: in-flight items in any background processing pool.
- **Channel queue depth**: for pipelines, the buffer fill level.
- **Mutex hold time**: rarely tracked but informative for hot mutexes.

These metrics turn "I think there's contention" into "the p99 mutex hold time is 12 ms, which explains the latency spike."

### Continuous profiling

Manual `pprof` grabs are good for ad-hoc debugging. For production-grade observability, continuous profiling (Pyroscope, Polar Signals, Datadog Continuous Profiler, Google Cloud Profiler) collects rolling profiles 24/7. You can then "go back in time" to see the profile during a slowness event.

A professional team treats continuous profiling as on par with metrics and traces. The investment pays off the first time you need to debug a regression after deploy.

---

## SLOs and how they discipline optimisation

A Service Level Objective is a target for a Service Level Indicator: "99% of requests complete within 200 ms, measured over a 28-day window."

SLOs discipline optimisation in three ways:

### 1. They tell you when to *stop*

If your service is meeting its SLOs comfortably, additional performance work is *opportunity cost*. The engineering hours could go to features, reliability, or paying down tech debt. A professional engineer asks: "are we under SLO? If yes, what is the business reason to spend time here?"

This is the opposite of the "always make it faster" instinct. SLOs say "fast enough" is a real category.

### 2. They tell you *where* to focus

If p50 is 80 ms and p99 is 500 ms, and the SLO is "p99 < 300 ms," focus on the tail. Improving p50 helps individual fast requests; improving p99 protects the SLO. These are different investigations and different optimisations.

For concurrency: most parallelism work improves throughput and average latency, *not* tail latency. Tail latency in concurrent systems is often *worse* than serial because tail-amplifying effects (straggler workers, GC pauses, mutex queueing) compound. A professional engineer recognises this.

### 3. They define the cost of regression

If a "performance" PR reduces p50 by 10% but adds 5% to p99, has it helped or hurt? Against an SLO of "p99 < 300 ms" with current p99 = 250 ms, the +5% on p99 brings you to 262.5 ms — still within SLO, so probably fine. If current p99 is 290 ms, the +5% pushes you to 304.5 ms — out of SLO. The same code change is acceptable in one context and unacceptable in another.

SLO-aware engineering makes this calculation explicit. PR descriptions should state the SLO impact: "improves p50 by 10%, regresses p99 by 5%; current SLO headroom is X."

---

## The bench-then-decide culture at scale

A solo engineer who measures-before-optimising is admirable. An organisation where every engineer does so is rare and valuable. The professional engineer's job is to build the organisation.

### Establishing benchmarks as a CI artifact

Every package with performance-sensitive code should have `*_bench_test.go` files. These benchmarks run in CI, with their results posted to a dashboard. Regressions are flagged automatically.

Tooling:

- `go test -bench=. -benchmem -count=10` in CI.
- `benchstat` comparing current vs baseline.
- Automated PR comments showing benchstat output.
- A long-term dashboard (Grafana, Honeycomb) tracking benchmark medians over time.

### Bench-stability requirements

CI benchmark machines must be quiet, consistent, and isolated. Shared CI runners (GitHub Actions, GitLab shared runners) produce noisy benchmarks. Allocate dedicated benchmark workers: one machine per architecture, idle except for benchmark jobs.

A professional team treats benchmark stability as infrastructure: monitor the variance, fix the machine when variance rises, alert on regression.

### The "no perf claim without benchstat" rule

PR templates include a field: "Performance impact." If the PR makes a performance claim, the field must contain `benchstat` output. Otherwise the field reads "N/A — no perf impact expected."

Reviewers reject PRs that claim "make it faster" without numbers. This is not pedantry; it is the only way to build institutional certainty that performance is what we say it is.

### Capability gates

Engineers who write production concurrent code should pass a capability gate: a short test where they read a profile, identify a bottleneck, propose a fix, and benchmark the result. This is not gatekeeping for promotion; it is ensuring the team has a baseline of measurement literacy.

---

## Profiling-driven optimisation workflow

A repeatable workflow for production performance work:

### Step 1: Identify the problem

Trigger: an SLO alert, a customer complaint, a regression after deploy, a budget exceedance.

Define the problem precisely: "p99 latency on endpoint X rose from 250 ms to 380 ms after deploy Y." Vague problems lead to vague optimisations.

### Step 2: Reproduce

Create a load test or a benchmark that reproduces the problem outside production. If you cannot reproduce, you cannot diagnose with confidence.

Tools:

- `wrk`, `vegeta`, `ghz` for HTTP/gRPC load.
- A staging environment mirroring production.
- Production traffic shadowing for hard-to-reproduce cases.

### Step 3: Profile

Grab a CPU profile under the problematic load. Grab an allocation profile. Grab a trace for a few seconds. These are your evidence.

```
go tool pprof http://localhost:6060/debug/pprof/profile?seconds=30
go tool pprof http://localhost:6060/debug/pprof/heap
go tool pprof http://localhost:6060/debug/pprof/goroutine
curl http://localhost:6060/debug/pprof/trace?seconds=10 > trace.out
go tool trace trace.out
```

### Step 4: Hypothesise

From the profile and trace, form a specific hypothesis: "The new mutex in package X is contended; goroutines spend p99 of their time parked on it."

The hypothesis names a *mechanism* (mutex contention), a *location* (package X), and an *impact* (p99 hold time).

### Step 5: Test the hypothesis

Make a minimal change that, *if the hypothesis is correct*, will improve the metric. Examples:

- Replace the mutex with an atomic counter.
- Shard the mutex.
- Eliminate the operation entirely.

Test in the reproduction environment first. Verify the metric moves the predicted direction by the predicted amount.

### Step 6: Deploy and verify

Roll out to a canary. Compare canary metrics to baseline. If the improvement holds, expand to the fleet. If not, roll back.

A professional engineer documents each step. The team retains an institutional memory of what was tried, what worked, and what did not.

---

## Continuous profiling in production

Continuous profiling collects rolling CPU/heap/goroutine profiles 24/7 from every instance. Modern tools (Pyroscope, Datadog, Grafana Phlare, Polar Signals, Cloud Profiler) make this affordable in CPU and storage.

### Why it matters

- **Regression diagnosis**: when latency rises after deploy X, you can compare the profile before and after.
- **Hotspot discovery**: you see what is using CPU across the fleet, not just one instance.
- **Tail attribution**: slow requests are tagged with their goroutine's call stack, letting you find what made them slow.
- **GC pressure analysis**: heap profiles show where memory comes from.

### How to set it up

1. Run a Go service with `net/http/pprof` exposed on an internal port.
2. Deploy the continuous profiler's agent next to each service instance.
3. Configure label propagation (service name, version, environment) for slicing in the UI.
4. Set retention (often 7-14 days is enough).

### What to expect

- Storage: a few MB per instance per day. Cheap.
- CPU overhead: <1% typically.
- Disk I/O: minimal.

The professional team treats continuous profiling as part of the observability stack. Engineers learn to navigate the profiler UI as readily as they navigate Grafana.

---

## When to introduce concurrency vs scale horizontally

The fundamental decision at the professional level: when a service is slow, do you:

(a) Add concurrency within the service to use the existing cores better?
(b) Scale horizontally by adding more instances?
(c) Optimise the sequential code to do less work?

Each has a different cost profile. Each is appropriate in different cases.

### When in-process concurrency is right

- The work is naturally parallel and per-request.
- You have unused CPU on the current instance.
- The complexity cost is justified by the gain.
- The team can maintain concurrent code safely.

Example: a request that fans out to five backends. Each backend call is independent and I/O bound. Concurrency reduces latency. Negligible complexity (`errgroup.WithContext`). Win.

### When horizontal scaling is right

- The service is stateless or its state is sharded by request.
- More instances would not strain a downstream bottleneck.
- The infrastructure can autoscale.
- You need throughput, not single-request latency.

Example: a stateless API that's CPU-bound at 80% utilisation. Add more instances; nothing in the code changes. Operationally simpler than adding concurrency.

### When to optimise sequentially

- The hot path is well-identified.
- An algorithmic improvement is available.
- The change is contained and reviewable.

Example: a JSON encoder that allocates per field. Rewrite to use `unsafe` byte appends. The function is 3× faster; no concurrency needed.

### Decision framework

Ask in order:

1. Is the work necessary at all? (Sometimes the answer is "skip this work.")
2. Can the sequential code be faster? (Algorithmic improvements first.)
3. Is the bottleneck CPU on this instance? (If yes, in-process concurrency may help.)
4. Can we add instances? (Often the simplest answer.)
5. Should we redesign? (Sometimes the architecture is the bottleneck.)

Most professional teams default to step 4 (horizontal scaling) for ambiguous cases, because it has the lowest cognitive cost. In-process concurrency is reserved for cases where the parallelism is naturally part of the request shape.

---

## Vertical scaling, horizontal scaling, and in-process concurrency

Three distinct levers:

### Vertical scaling

Upgrade the instance: more cores, more RAM, faster disk, faster network. Larger pods.

Pros:
- No code changes.
- Lower latency (one instance has more capacity).
- Simpler operations.

Cons:
- Limits exist (the largest instance is finite).
- Costs grow nonlinearly with instance size.
- Failure domains grow (one big instance failing is worse than one of many small).

### Horizontal scaling

Add more instances of the same size. More pods.

Pros:
- Scales nearly linearly.
- Better failure isolation.
- Cheaper per-unit-throughput at scale.

Cons:
- Requires statelessness or careful state management.
- Adds operational complexity (load balancing, service discovery).
- Tail latency may rise (more network hops, more retries).

### In-process concurrency

Use more goroutines per instance.

Pros:
- No infrastructure change.
- Can improve single-request latency.

Cons:
- Code complexity.
- Bugs (races, leaks, deadlocks).
- Often does not help if the bottleneck is external.

### Choosing

A professional engineer maps the bottleneck to the right lever:

- **CPU-bound, single instance under-utilised**: in-process concurrency, then vertical scaling.
- **CPU-bound, fleet under-utilised**: in-process concurrency.
- **CPU-bound, fleet fully utilised**: horizontal scaling.
- **I/O-bound to external service**: depends on the external service's capacity.
- **Memory-bound**: vertical scaling for RAM, or sharding state.
- **Latency-sensitive**: vertical scaling (one big fast instance), in-process concurrency.

The default for new services is horizontal scaling. It is the most predictable, the easiest to reason about, and the cheapest to operate.

---

## Latency vs throughput tradeoffs

These are different metrics with different optimisation strategies. A professional engineer never conflates them.

### Latency optimisation

- **Reduce work**: less code path, less data touched, fewer allocations.
- **Parallelise fan-out**: independent calls in parallel.
- **Cache**: serve known answers from memory.
- **Co-locate**: reduce network hops.
- **Tune GC**: smaller pauses.

### Throughput optimisation

- **Saturate CPU**: use all cores via concurrency.
- **Batch**: amortise per-op overhead.
- **Pipeline**: keep all stages busy.
- **Shard**: parallelise across instances or partitions.
- **Drop**: shed load instead of queuing.

### When optimisations conflict

- **Caching** improves both latency and throughput, but uses memory.
- **Batching** improves throughput but *increases* latency (batches form before they execute).
- **Parallel fan-out** improves single-request latency but uses more cores per request, reducing throughput per instance.
- **Concurrency** improves throughput but can hurt tail latency via stragglers.

A professional engineer states the tradeoff explicitly. "This PR improves throughput by 30% at the cost of p99 latency rising 8%. Given our SLOs, this is acceptable."

---

## Tail latency as a first-class concern

For a user-facing service, p99 or p99.9 latency is often more important than mean. Reasons:

- Users notice slow requests, not fast ones.
- Multi-shard requests fan out and wait for the slowest shard; p99 of one shard becomes p50 of the whole.
- SLOs are typically on tail metrics (99% of requests within X ms).

### How concurrency affects tail latency

Concurrency *typically hurts* tail latency:

1. **Straggler workers**: in a fan-out, the slowest worker determines completion. Variability in worker speed compounds.
2. **GC pauses**: more goroutines, more allocations, more frequent and longer pauses.
3. **Lock contention spikes**: rare contention events become frequent when N goroutines compete.
4. **Scheduler jitter**: more goroutines mean more chances of a goroutine waiting in the runqueue.

### Tail-aware patterns

- **Hedged requests**: fire a duplicate request to a different replica if the original is slow.
- **Speculative execution**: start the next computation before the current one completes.
- **Tail tolerance**: design downstream consumers to handle some slow upstream calls.
- **Backup execution**: re-issue a request that has been pending too long.

For example, a service calling 10 backends in parallel where each has p99 = 50 ms: the overall p99 is much worse than 50 ms (often >100 ms) because *at least one* of the 10 calls hits its p99. Hedging the slowest call after 30 ms can dramatically improve the overall p99.

### Concrete: hedging

```go
func hedgedCall(ctx context.Context, call func(context.Context) (Result, error)) (Result, error) {
    type out struct {
        r   Result
        err error
    }
    ch := make(chan out, 2)

    go func() {
        r, err := call(ctx)
        ch <- out{r, err}
    }()

    timer := time.NewTimer(30 * time.Millisecond)
    defer timer.Stop()

    select {
    case <-timer.C:
        go func() {
            r, err := call(ctx)
            ch <- out{r, err}
        }()
    case res := <-ch:
        return res.r, res.err
    }

    res := <-ch
    return res.r, res.err
}
```

The first call gets 30 ms. If it has not returned, fire a backup. Whichever returns first wins. This trades 2× backend cost in the worst case for dramatically better tail latency. A professional engineer reaches for this for tail-critical operations.

---

## Capacity planning with concurrency

Capacity planning is the discipline of estimating "how much infrastructure do we need to handle X load while meeting SLOs?" Concurrency interacts with capacity in subtle ways.

### Single-instance throughput

Measure how many req/s a single instance can handle while meeting SLOs. This is the *unit capacity*. Fleet capacity is unit capacity × instance count.

Procedures:

1. Deploy one instance.
2. Generate load at increasing rates.
3. Plot p99 latency vs request rate.
4. Identify the "knee": the rate at which p99 starts to climb.
5. Set capacity at, say, 80% of the knee (leave headroom for spikes and GC).

### Effect of in-process concurrency

A more concurrent service handles more req/s per instance (if it scales well). This *reduces* fleet size, saving money. But:

- It also increases the impact of a single instance failure (more requests on each).
- It may worsen tail latency from contention.
- It increases the blast radius of bugs.

A professional engineer measures unit capacity *with and without* a proposed concurrency change, computes the fleet implications, and presents both numbers.

### Effect of horizontal scaling

Adding instances increases capacity linearly *if* the service is stateless and downstream resources scale. If a database is the bottleneck, adding service instances does not help.

### A worked example

A service handles 100 req/s per instance at p99 = 200 ms. With 10 instances, fleet capacity is 1000 req/s.

A proposed concurrency change increases unit capacity to 150 req/s at p99 = 220 ms. Fleet capacity rises to 1500 req/s with the same 10 instances. We can shed 3 instances and still serve 1050 req/s.

Savings: 3 instances × $50/mo = $150/mo per environment, or $3000/mo across 20 environments. Worth a week of engineering? Probably yes if the change is otherwise low-risk.

But: the change adds complexity. We have to maintain it. The risk of bugs goes up. A professional engineer weighs both.

---

## Cost models: dollars per request

For high-volume services, *dollars per request* is a useful unit. Compute it as:

```
$/req = (instance cost / time) / (req/s)
```

A $50/mo instance handling 100 req/s: $50 / (30 days × 86400 s × 100 req/s) = $0.000000193 per request. At 1B requests/mo, the cost is ~$193/mo.

### Optimisation ROI

An optimisation that reduces $/req by 10% saves $19/mo on this service. An engineering quarter (250 hours × $100/hr = $25k) recovers in... 1300 years.

If the service is 100× bigger (100B requests/mo), the savings are $1900/mo. The quarter recovers in 13 years. Still bad.

A truly impactful optimisation is one that saves a *significant fraction* of cost across a big service. 50% reduction on a 100B req/mo service is $96k/mo, paying back the quarter in 3 months.

### When small optimisations matter

Small optimisations *aggregate*. If the team ships 4 of them in a quarter, each saving 10%, the compound effect is ~35%. That can be meaningful.

But: small optimisations often add complexity disproportionate to their gains. A 5% speedup that adds 200 lines of concurrent code is rarely a net positive. The senior framework — measure, reason about cost, weigh complexity — is the professional rubric.

---

## The fleet view: optimisation at scale

A change to one service runs on hundreds or thousands of instances. The effects compound:

### CPU savings compound

A 10% CPU reduction on a service running 1000 instances at $50/mo each saves $5000/mo. The same change on a 10-instance service saves $50/mo. The optimisation is the same; the value is different.

### Memory savings compound

Similarly for memory. A 100 MB reduction in heap per instance across 1000 instances frees 100 GB of memory. That might allow scaling down instance size, or fitting more services per node.

### Operational complexity compounds

A concurrent design that occasionally deadlocks gives one alert per month per instance. Across 1000 instances, that is 1000 alerts per month — pager fatigue, eroded trust in alerts.

A professional engineer thinks in terms of *fleet impact*: a small per-instance change has large absolute effects, but only if the absolute scale is large.

### When fleet effects justify investment

For each fleet-size tier, the engineering budget for performance work is different:

- 10 instances: minor work only; the savings rarely justify a quarter.
- 100 instances: medium work; a focused sprint can pay off.
- 1000+ instances: significant investment; dedicated SREs and performance engineers.
- 10,000+ instances: world-class performance team essential.

This is why the same optimisation done at Google scale is unaffordable at startup scale.

---

## Architectural premature optimisation

Beyond local concurrency optimisations, there are *architectural* premature optimisations: adopting patterns that suit Google-scale problems for services that handle 1000 req/s.

Common architectural premature optimisations:

### 1. Actor frameworks before they are needed

An actor framework (Akka-style or Go-native like `proto.actor`) is a powerful pattern for stateful, message-oriented systems. It is also significantly more complex than direct Go concurrency.

A small service with a few stateful subsystems probably does not need actors. A simple struct with a mutex and methods is clearer and faster.

### 2. CRDTs before they are needed

Conflict-free Replicated Data Types solve the "multi-master, eventually consistent" problem. They are essential for distributed databases, peer-to-peer applications, offline-first apps.

For a single-master service (one writer, many readers, replication for read-scaling), CRDTs are overkill. Standard replication protocols are simpler.

### 3. Event sourcing before it is needed

Event sourcing makes auditing, time-travel debugging, and complex projections easy. It also has significant infrastructure cost: event stores, projections, replay logic, snapshot management.

For a typical CRUD service, event sourcing is overkill. State + history table is often sufficient.

### 4. Microservices before they are needed

Splitting a monolith into microservices "for scaling" is often premature. The operational complexity multiplies before the scaling benefit accrues.

A modular monolith — well-bounded modules in one deployable — is faster to develop, easier to reason about, and meets the scaling needs of all but the largest services.

### 5. Lock-free data structures before they are needed

Custom lock-free queues, hash maps, ring buffers in Go are rarely faster than `chan`, `sync.Map`, or mutex-protected versions in real workloads. They are much harder to maintain.

### Senior takeaway

Architectural choices have multi-year tails. A team that adopts an actor framework spends years using it. Choose architectures by *measurement*, not by buzzword. Default to the simplest pattern that meets the requirements.

---

## Actor frameworks: when they help, when they hurt

Actor frameworks (Erlang, Akka, proto.actor for Go) model the system as actors exchanging messages. Each actor has private state mutated only by its own message handler.

### When actors help

- **High concurrency with location transparency**: actors can be local or remote without code change.
- **Supervisor hierarchies**: failure handling is encoded in the actor tree.
- **State per session**: each user's state is an actor; routing is by ID.
- **Pure message-passing semantics**: no shared mutable state.

### When actors hurt

- **Simple in-process state**: a `struct` with methods and a mutex is clearer and faster.
- **High-throughput stateless work**: actors add per-message overhead.
- **Type safety**: most actor frameworks pass messages as `interface{}`, losing compile-time checks.
- **Debugging**: a message that fails to be handled might just disappear.

### Go-specific note

Go's concurrency primitives are themselves actor-like at the small scale: a goroutine that owns state, communicating via channels, is essentially an actor. Many Go programs are "actors" without using a framework.

```go
type Counter struct {
    incCh chan struct{}
    getCh chan chan int
}

func NewCounter() *Counter {
    c := &Counter{
        incCh: make(chan struct{}),
        getCh: make(chan chan int),
    }
    go c.run()
    return c
}

func (c *Counter) run() {
    n := 0
    for {
        select {
        case <-c.incCh:
            n++
        case out := <-c.getCh:
            out <- n
        }
    }
}

func (c *Counter) Inc() { c.incCh <- struct{}{} }
func (c *Counter) Get() int {
    out := make(chan int)
    c.getCh <- out
    return <-out
}
```

This is an actor in idiomatic Go. The overhead is two channel hops per operation, ~500 ns. A `sync.Mutex` version is ~20 ns per op.

For most uses, mutex wins. For specific cases (the goroutine also handles timers, network events, etc.), the actor pattern is clearer.

A professional engineer recognises the pattern and chooses based on what the code needs to express, not on what is fashionable.

---

## Lock-free data structures in production

Lock-free data structures avoid `sync.Mutex` in favour of atomic operations. In theory, they offer better contention behaviour. In practice, they often fail to deliver in Go.

### Why they often fail in Go

1. **Go's mutex is already very fast** for short critical sections. The uncontended overhead is ~10 ns; the contended overhead is bounded.
2. **Atomic CAS retries are expensive under contention.** A loop of `CompareAndSwap` that fails repeatedly burns cycles without making progress.
3. **Memory reclamation is hard.** Lock-free designs need hazard pointers, epoch-based reclamation, or generational schemes. Go's GC helps, but it does not solve everything.
4. **Code is hard to maintain.** Few engineers can read lock-free Go fluently. Bugs are subtle.

### When they actually win

- Specialised infrastructure (databases, queues, OS kernels) where the lock-free implementation is well-reviewed.
- Workloads with truly extreme contention (>10M ops/sec on a single structure).
- Hard latency bounds (no mutex parking acceptable).

For a typical Go service, none of these apply.

### Production case

A team adopted a third-party lock-free hash map for caching. Microbenchmark showed 2× over `sync.Map`. Production: identical throughput, increased tail latency, two memory leaks reported by users of the library (later fixed).

The team reverted to `sync.Map`. The lesson: even well-reviewed lock-free libraries have edge cases. Use them only when the benchmark on *your workload* unambiguously justifies the complexity.

### Senior heuristic

When a teammate proposes a lock-free design, ask:

1. What is the throughput requirement?
2. What is the mutex contention today (mutex profile)?
3. Has the library been benchmarked against your workload?
4. Who on the team can maintain it if a bug appears?

If any answer is unsatisfying, push back.

---

## Sharding strategies and their breakeven points

Sharding splits a contended resource into N independent shards. Each shard is independently lockable.

### Sharded map

```go
type ShardedMap struct {
    shards [32]struct {
        mu sync.Mutex
        m  map[string]Value
    }
}

func (s *ShardedMap) shard(k string) int {
    h := fnv.New32()
    h.Write([]byte(k))
    return int(h.Sum32()) & 31
}
```

### Tradeoffs

- More shards = less contention per shard.
- More shards = higher per-op overhead (hash computation).
- More shards = more memory (each shard has its own map header, buckets).
- Sharded iteration is harder (must iterate each shard).

### Breakeven

A sharded map starts to win over a single mutex map when:

- Mutex hold time × QPS > some fraction of total CPU.
- The hash cost is small relative to the saving.

In practice, single mutex maps work fine up to ~100K QPS on hot keys. Beyond that, sharding starts to matter.

For a typical Go service, sharding maps is premature. Profile mutex contention first.

### Per-CPU sharding

A more sophisticated sharding strategy uses one shard per logical CPU. This achieves near-zero contention because each goroutine on each P tends to touch its own shard.

```go
type PerCPU struct {
    shards []struct {
        Counter atomic.Int64
        _       [56]byte
    }
}

func (p *PerCPU) Add(n int64) {
    pid := runtime_procPin()
    p.shards[pid].Counter.Add(n)
    runtime_procUnpin()
}

func (p *PerCPU) Sum() int64 {
    var sum int64
    for i := range p.shards {
        sum += p.shards[i].Counter.Load()
    }
    return sum
}
```

`runtime_procPin` is a runtime internal; user-space code uses `runtime.LockOSThread` or `fastrand` % NumProc. The tradeoff: writes are fast (no contention), reads are O(NumP).

### When per-CPU is overkill

- The counter is not on the hot path.
- The sum is required frequently.
- The number of cores is small.

A `sync.Mutex` + `int64` is fine for thousands of QPS. Per-CPU shards become worthwhile at millions of QPS on a single counter.

---

## Concurrency control patterns: token buckets, semaphores, rate limiters

Concurrency control is the discipline of limiting how many operations run in parallel. Patterns:

### Semaphore (bounded fan-out)

```go
sem := make(chan struct{}, 8)
for _, item := range items {
    item := item
    sem <- struct{}{}
    go func() {
        defer func() { <-sem }()
        process(item)
    }()
}
```

Limits to 8 concurrent operations. Excess waits.

### `golang.org/x/sync/semaphore`

More featureful semaphore with weighted acquisitions and context support:

```go
sem := semaphore.NewWeighted(100)
if err := sem.Acquire(ctx, 5); err != nil {
    return err
}
defer sem.Release(5)
```

Useful when operations have different "weights" (e.g. small vs large).

### `errgroup.SetLimit`

```go
g, ctx := errgroup.WithContext(ctx)
g.SetLimit(8)
for _, item := range items {
    item := item
    g.Go(func() error {
        return process(ctx, item)
    })
}
return g.Wait()
```

The cleanest pattern for "fan-out with limit and error propagation."

### Rate limiter

Token bucket via `golang.org/x/time/rate`:

```go
limiter := rate.NewLimiter(rate.Limit(100), 10) // 100 req/s, burst 10
for _, item := range items {
    if err := limiter.Wait(ctx); err != nil {
        return err
    }
    go process(item)
}
```

Combine with semaphore for both rate and concurrency limits.

### Picking the right pattern

- **Bounded parallelism**: semaphore or `errgroup.SetLimit`.
- **Rate limiting**: token bucket.
- **Quota**: weighted semaphore.
- **Backpressure**: bounded channel, drop on full.

A professional engineer picks the simplest tool that achieves the requirement. Adopting a "rate limiter library" for something a 10-line semaphore would handle is premature.

---

## Backpressure as system architecture

Backpressure is the signal "I am overloaded, slow down." Without it, systems fail by:

- OOM (queues grow without bound).
- Cascading failure (upstream sends to dead downstream).
- Tail latency collapse (every request waits in a queue).

### Where to apply backpressure

1. **At ingress**: reject requests when in-flight exceeds capacity.
2. **At queues**: drop or block when buffers fill.
3. **At downstream calls**: timeouts and circuit breakers.
4. **At RPC layer**: gRPC backpressure via flow control.

### Implementing ingress backpressure in Go

```go
type LoadShedHandler struct {
    handler http.Handler
    inFlight atomic.Int64
    max      int64
}

func (h *LoadShedHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
    if h.inFlight.Add(1) > h.max {
        h.inFlight.Add(-1)
        http.Error(w, "overloaded", http.StatusServiceUnavailable)
        return
    }
    defer h.inFlight.Add(-1)
    h.handler.ServeHTTP(w, r)
}
```

Simple, effective. Requires choosing `max` thoughtfully.

### Adaptive backpressure

Better than a fixed `max`: shed load when latency rises.

```go
type AdaptiveShedder struct {
    handler   http.Handler
    p99      *latencyTracker
    threshold time.Duration
}

func (h *AdaptiveShedder) ServeHTTP(w http.ResponseWriter, r *http.Request) {
    if h.p99.Current() > h.threshold {
        if rand.Float64() < 0.1 { // shed 10%
            http.Error(w, "overloaded", http.StatusServiceUnavailable)
            return
        }
    }
    start := time.Now()
    h.handler.ServeHTTP(w, r)
    h.p99.Record(time.Since(start))
}
```

More complex but adapts to real conditions.

### Don't shed silently

Sending a 503 with a `Retry-After` header is the polite way to shed. Clients learn to back off. Silent dropping leads to bad behaviour.

### Professional reflection

Backpressure is *system architecture*, not just a concurrency primitive. The decision "where to drop excess load" affects every layer. A professional engineer plans backpressure top-down: ingress, internal queues, downstream calls, all the way to dependencies. Each layer must shed within its own SLOs.

---

## Production case studies

Three case studies drawn from real (anonymised) production experience.

### Case 1: the `sync.Pool` that fragmented memory

A team added `sync.Pool` for large buffers (256 KB each). Benchmarks showed 8% throughput improvement.

Production: memory usage rose 40% per instance. Why?

`sync.Pool` keeps objects until GC. With heavy use, the pool can hold thousands of large buffers. RSS rises until GC, then drops, then rises again. The "average" RSS is much higher than the steady-state working set.

Fix: cap the pool size manually, or use a bounded ring buffer of buffers.

Lesson: `sync.Pool` is not free in memory. Benchmark RSS, not just throughput.

### Case 2: the goroutine-per-request fan-out that DDoSed downstream

A service handled requests by fanning out to 20 backends concurrently. Under load, the service started receiving 5× normal traffic during a partial outage. The fan-out multiplied the load on each backend.

The backends began to fail. The service retried (concurrent retries). The backends failed harder. Cascading failure.

Fix: limit the fan-out to a fixed concurrency budget across the service. Use `errgroup.SetLimit` not per-request but *globally*.

Lesson: per-request concurrency multiplies under load. Cap globally to protect downstream.

### Case 3: the channel buffer that hid a bug

A pipeline had a 10000-deep channel buffer "to smooth bursts." The buffer was always 80% full in production. Investigations showed a downstream stage was slow: a database query that should have taken 10 ms was taking 200 ms.

The buffer hid the bug for 6 months. Without the buffer, the pipeline would have blocked, alerting the team to the issue.

Fix: shrink the buffer to 16 (just enough to absorb micro-bursts), add a queue-depth metric, alert if depth > 8 for >1 minute.

Lesson: large buffers hide problems. Use small buffers and observe them.

---

## Operational considerations

Beyond code, operationalising concurrency means:

### Alerts and runbooks

- Alert on `go_goroutines` growth (leak indicator).
- Alert on `go_gc_pause_seconds` > target (GC pressure).
- Alert on in-flight request count > threshold (overload).
- Alert on saturation of internal queues.

Each alert has a runbook: what to check, what profile to grab, what to roll back.

### Deployment patterns

- **Canary first**: deploy to 1% of traffic, observe SLOs, expand if green.
- **Feature flags**: gate new concurrency behind a flag, enable gradually.
- **Drain on shutdown**: long-running goroutines should finish or be cancelled cleanly before exit.

### Capacity reservations

Allocate per-pod CPU and memory based on observed unit capacity. Leave headroom for spikes. A pod running at 90% CPU has no headroom; one at 60% does.

### Failure modes

A professional team knows how their concurrent code fails:

- Goroutine leak: which goroutine? Where does it block?
- Deadlock: dump goroutines, identify the cycle.
- Hang: check for infinite loop or blocked syscall.
- OOM: heap profile shows what allocated.
- Crash: panic with goroutine dump.

Practice these in game days.

---

## Migration patterns: from concurrent back to simple

Sometimes the right move is to *remove* concurrency. Patterns:

### Step 1: prove the concurrency isn't paying

Run a benchmark of the concurrent version vs a simpler serial version. If serial is comparable, the concurrency is paying nothing.

### Step 2: write the serial version behind a flag

Don't remove the concurrent code yet. Add the serial alongside, gated by a flag.

### Step 3: enable serial in canary

Observe production metrics. Confirm the SLO is maintained or improved.

### Step 4: roll out

Enable serial globally. Watch for regressions.

### Step 5: remove the concurrent code

After a bake period (typically 2-4 weeks), delete the concurrent code. Reduce code surface area.

### Why this is hard

Teams develop attachment to the "fast" version even when it's not. Removing it requires evidence and patience. A professional engineer leads the case with data: "here is the benchstat, here is the production metric, here is the simplification."

The reward: simpler code, easier maintenance, often slightly better performance, certainly fewer bugs.

---

## The mature performance organisation

A mature performance organisation has:

### Infrastructure

- Dedicated benchmark hardware.
- Continuous profiling deployed across services.
- A performance dashboard tracking key metrics over time.
- A benchmark regression detector.

### Process

- "No performance claims without benchstat" enforced in PR review.
- A quarterly "performance audit" of one service.
- A retrospective after each performance incident.
- An internal blog for performance learnings.

### People

- One or more dedicated performance engineers (or SREs with that hat).
- A "perf champion" rotation across product teams.
- Investment in education: profiling tutorials, internal talks.

### Culture

- Optimisation is data-driven, not vibe-driven.
- Reverting optimisations is praised, not punished.
- Simple code is the default; complex code requires justification.
- Performance work is balanced with feature work and reliability.

This is what good looks like. Most organisations are short of this in at least one dimension. A professional engineer works to close the gap.

---

## Self-assessment

Professional-level self-check:

1. Your service has p99 latency of 250 ms with SLO of 300 ms. A PR proposes a 5% throughput improvement at the cost of 5% on p99. Approve or reject?
2. The mutex profile shows 8% of CPU in `sync.(*Mutex).Lock`. What is your first investigation step?
3. A teammate proposes adopting an actor framework. What questions do you ask?
4. Continuous profiling shows a steady drift upward in goroutine count over 6 hours. What does this suggest?
5. A change cuts $/req by 5%. The service runs at 10B req/mo. The change adds 500 lines of concurrent code. Worth it?
6. Tail latency p99.9 is much higher than p99. What concurrent design patterns might be implicated?
7. After deploy X, GC pause p99 doubled. What is your investigation?
8. The fleet runs at 60% CPU utilisation. Capacity team asks "can we scale down?" What do you check first?
9. Per-CPU sharded counters help on big servers but not small. Why?
10. You inherit a service with extensive use of `sync.RWMutex`. How do you evaluate whether each is justified?

If you can answer all 10 with a defensible methodology, you are at professional level. If any are blank, the rest of this document fills the gaps.

---

## Summary

Professional-level practice on premature concurrency optimisation rests on five pillars:

1. **SLO-driven thinking.** Performance work is justified by SLO improvement, not by personal taste.
2. **Fleet-aware reasoning.** Changes are evaluated in terms of fleet-wide cost and impact, not per-instance.
3. **Architectural judgement.** Knowing when an "advanced" concurrency pattern (actors, CRDTs, lock-free) is justified and when it is cargo-culted.
4. **Cost awareness.** Dollars per request, engineer hours per dollar saved.
5. **Operational discipline.** Continuous profiling, alerts, runbooks, game days.

The professional engineer makes optimisation decisions in the broader context of business value, operational complexity, and long-term maintenance. They reject changes that are technically interesting but business-irrelevant. They approve changes that are boring but unblock customers. They build the organisation's capability to make these decisions consistently.

When you do this, your services run within SLO, your costs scale predictably, your team has the tools and discipline to optimise effectively, and your codebase contains only the complexity that has earned its keep.

The next file, `specification.md`, is a reference: the tools (`pprof`, `trace`, `benchstat`), the methodology, the statistical rigor for benchmarks, and the platform-specific concerns (GOMAXPROCS in containers, cgroup interactions).

---

## Appendix A: a checklist for the professional performance reviewer

Print this and attach to your PR template:

1. **Goal.** What metric does this PR move? By how much? Against what SLO?
2. **Evidence.** Where is the benchmark? Where is the profile? Where is `benchstat`?
3. **Production context.** Does the change hold in a production-like environment?
4. **Tail.** Does p99 / p99.9 latency move? In which direction?
5. **Fleet.** What is the absolute savings in CPU/memory/dollars across the fleet?
6. **Complexity.** How many lines of code? How much new concurrency machinery?
7. **Maintainability.** Who on the team can maintain this six months from now?
8. **Operational risk.** Does this introduce new failure modes? New alerts? New runbooks?
9. **Reversibility.** What is the revert plan if production sees regressions?
10. **Documentation.** Is the design and tradeoff documented?

A "yes" to all ten is a green light. A "no" or "I'm not sure" on any is a discussion.

---

## Appendix B: extended worked example — capacity planning for a fan-out service

A service has the following behaviour:

- Receives 1000 req/s at peak.
- Each request fans out to 5 backends.
- Each backend call takes 50 ms p99.
- Backends are independently scaling.

The team has a choice: parallelise the fan-out (5 in-flight per request) or serialise (5 × 50 ms = 250 ms per request).

### Parallel option

Wall-time per request: 50 ms (bounded by slowest backend) + 5 ms overhead = 55 ms.

In-flight requests at 1000 req/s × 55 ms = 55 requests in flight.

Goroutines per pod, with 10 pods: 100 req/s/pod × 55 ms × 5 = 27.5 goroutines for fan-out, plus ~100 request goroutines. Total ~130 goroutines per pod. Trivial.

Backend load: 1000 req/s × 5 = 5000 calls/s spread across 5 backends = 1000 calls/s per backend.

### Serial option

Wall-time per request: 250 ms.

In-flight requests at 1000 req/s × 250 ms = 250 requests in flight.

Goroutines per pod, with 10 pods: 100 req/s/pod × 250 ms × 1 = 25 fan-out goroutines, plus 100 request goroutines. Total ~125 goroutines per pod. Also trivial.

Backend load: same 1000 calls/s per backend.

### Difference

Parallel saves 195 ms of latency per request. p99 goes from 250 ms to 55 ms. Significant.

Trade-off: parallel uses 5× the in-flight backend connections per request. If the backend's connection pool is the bottleneck, parallel may cause connection exhaustion.

### Decision

Parallel is the right call *if* the backend can handle the burstiness. The team should measure backend connection pool utilisation; if there's headroom, parallel. If the pool is near saturation, parallel makes it worse — serial is more polite.

This is the kind of trade-off only visible at the professional level. The simple "concurrency is good" or "concurrency is bad" answers miss the system-level interaction.

---

## Appendix C: case — a CSV importer at 50× scale

A service imports CSV files of customer data. Files range from 1 MB to 1 GB.

Original implementation: single-threaded parser, single-threaded validator, single-threaded database batch insert.

At 50× scale (50× more customers), the importer became the bottleneck. p99 import latency rose from 30 minutes to 8 hours.

### Analysis

Profile showed:

- 60% in JSON parse (CSV is parsed row, then each row's JSON column is parsed).
- 25% in database insert.
- 15% in validation.

### Concurrency options

1. Parallelise JSON parse: rows are independent, parse is CPU-bound.
2. Parallelise validation: independent per row.
3. Parallelise database insert: requires multiple connections.

### Implementation

```go
type Row struct {
    Raw     []byte
    Parsed  *Customer
    Valid   bool
    Err     error
}

func importCSV(ctx context.Context, r io.Reader) error {
    rowCh := make(chan *Row, 1024)
    insertCh := make(chan *Row, 1024)

    var wg sync.WaitGroup

    // Stage 1: scan + parse, 4 workers
    for i := 0; i < 4; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            for row := range rowCh {
                row.Parsed, row.Err = parseCustomer(row.Raw)
                if row.Err == nil {
                    row.Valid = validateCustomer(row.Parsed)
                }
                insertCh <- row
            }
        }()
    }

    // Stage 2: database insert, 2 workers (matching pool)
    for i := 0; i < 2; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            batch := make([]*Row, 0, 1000)
            for row := range insertCh {
                if row.Valid {
                    batch = append(batch, row)
                    if len(batch) == cap(batch) {
                        flushBatch(ctx, batch)
                        batch = batch[:0]
                    }
                }
            }
            if len(batch) > 0 {
                flushBatch(ctx, batch)
            }
        }()
    }

    // Producer: scan rows
    sc := bufio.NewScanner(r)
    for sc.Scan() {
        line := append([]byte(nil), sc.Bytes()...)
        rowCh <- &Row{Raw: line}
    }
    close(rowCh)

    // Wait for stage 1 to finish, then close stage 2 input
    go func() {
        wg.Wait()
        close(insertCh)
    }()

    return sc.Err()
}
```

### Results

Wall time: 30 minutes -> 7 minutes (4.3× speedup).

Bottleneck moved from CPU (parse) to database (insert).

### Lessons

- Pipeline staged parallelism: parse parallel, insert parallel-but-bounded.
- Batching at the database layer matters more than batching elsewhere.
- The producer (scanner) is the actual bottleneck at very high speed; consider chunked file reading.

---

## Appendix D: case — a metrics aggregator with hot keys

A service aggregates metrics. ~5% of keys account for ~95% of writes (Zipf distribution).

Original implementation: `sync.Map`. Read/write ratio: 1:10 (mostly writes).

Profile: high CPU in `sync.Map.LoadOrStore`. Tail latency spikes during write bursts.

### Hypothesis

`sync.Map` is optimised for read-heavy, write-rare workloads. Our workload is write-heavy. Wrong primitive.

### Alternative 1: mutex-protected map

```go
type Agg struct {
    mu sync.Mutex
    m  map[string]*Counter
}
```

Benchmark: 30% throughput improvement.

### Alternative 2: sharded map

```go
type Agg struct {
    shards [16]struct {
        mu sync.Mutex
        m  map[string]*Counter
    }
}
```

Benchmark: 50% improvement, but Zipf concentrates load on a few shards.

### Alternative 3: pre-sharded by known hot keys

```go
type Agg struct {
    hot map[string]*atomic.Int64 // pre-allocated for known hot keys
    mu  sync.Mutex
    m   map[string]*Counter       // cold keys
}

func (a *Agg) Add(key string, delta int64) {
    if c, ok := a.hot[key]; ok {
        c.Add(delta)
        return
    }
    a.mu.Lock()
    defer a.mu.Unlock()
    a.m[key].count += delta
}
```

Benchmark: 4× improvement on hot path; cold path unchanged.

### Result

Chose alternative 3. The "hot keys" set is known and stable (it's a small enumeration). The atomic.Int64 is the fastest possible primitive for the dominant case.

### Lessons

- Match the data structure to the access pattern.
- Zipf distributions break simple sharding.
- Knowing your workload allows targeted optimisations.

---

## Appendix E: long-running service patterns

For services that run for weeks or months, professional engineering must consider:

### Goroutine lifecycle

Every goroutine has a clear birth and death. Long-lived "background" goroutines should:

- Have an explicit stop signal (context, done channel, or sentinel).
- Log their start and stop.
- Be drainable on shutdown (allow in-flight work to finish before exit).

### Memory growth

A service that allocates without bound will OOM. Watch for:

- Caches that grow without TTL.
- Slices appended to indefinitely.
- Maps with keys never deleted.
- Goroutine leaks (each leaked goroutine holds its stack).

### GC tuning

Long-running services benefit from explicit `GOMEMLIMIT` (Go 1.19+) to bound memory and trigger GC before OOM:

```
GOMEMLIMIT=8GiB
```

And from `GOGC` tuning if profiling shows high GC time:

```
GOGC=200  # less frequent GC, more memory
```

### Periodic re-baseline

Workloads drift. Re-benchmark quarterly. A pattern that was optimal at launch may be suboptimal now.

---

## Appendix F: production playbook for concurrency incidents

Incident: "service slow" or "service hanging."

### Triage (first 5 minutes)

1. Check the current SLO violation: which metric, how severe.
2. Was there a recent deploy? If yes, prepare to roll back.
3. Are upstream/downstream services healthy? If not, focus there first.
4. Is there a backpressure mechanism active? Are we shedding load?

### Diagnose (next 15 minutes)

1. Grab a goroutine dump from a slow instance.
2. Grab a CPU profile.
3. Grab a heap profile.
4. Inspect for:
   - Goroutine count high or growing
   - Many goroutines on same stack (potential deadlock or hot mutex)
   - GC pause spikes
   - Memory growth

### Decide (within 30 minutes)

Based on findings:

- Recent deploy + profile shows new function: roll back.
- Goroutine leak: identify the stack, plan fix; consider periodic restart as mitigation.
- Mutex contention: identify the mutex, plan fix; consider rate limiting upstream as mitigation.
- GC storm: identify allocation source, plan fix; consider `GOGC` tuning as mitigation.

### Communicate

Stakeholder updates every 15 minutes. Even "still investigating, no new info" is reassuring.

### Recover

If mitigation deploys are available, deploy them. If not, run with degraded behaviour (rate limit, shed) until permanent fix is ready.

### Post-incident

Write up: what happened, how detected, how diagnosed, how fixed. Identify systemic improvements. Often: better observability of the problem class.

---

## Appendix G: extended case — the cache that became the bottleneck

A team had a hot in-memory cache for config data. Reads: 10000 QPS per instance. Writes: 1/min.

Original: `map[string]string` protected by `sync.RWMutex`.

Profile showed 20% CPU in `sync.(*RWMutex).RLock`. Tail latency p99: 5 ms (target: 2 ms).

### First attempt

Replace with `sync.Map`. Benchmark: 2× faster.

Production: 1.5× faster, but tail latency unchanged.

### Investigation

Trace showed brief "stop the world" moments during the once-per-minute writes. Even though writes were rare, every reader would block briefly during the write.

### Second attempt

Copy-on-write with `atomic.Pointer`:

```go
type Cache struct {
    m atomic.Pointer[map[string]string]
}

func (c *Cache) Get(k string) string {
    return (*c.m.Load())[k]
}

func (c *Cache) Set(k, v string) {
    for {
        old := c.m.Load()
        newMap := make(map[string]string, len(*old)+1)
        for kk, vv := range *old {
            newMap[kk] = vv
        }
        newMap[k] = v
        if c.m.CompareAndSwap(old, &newMap) {
            return
        }
    }
}
```

Reads: lock-free, ~3 ns per op.
Writes: O(N) copy, but only 1/min, so total cost is negligible.

Production: tail latency p99 dropped to 1 ms. CPU usage dropped 18%.

### Lessons

- Choose primitive by access pattern: copy-on-write is great for read-mostly with rare writes.
- `sync.Map` is faster than `sync.RWMutex` for many cases, but COW is faster still when write rate is low.
- Tail latency is sensitive to even rare contention; eliminate it where possible.

---

## Appendix H: managing concurrency at the API boundary

The API boundary is where concurrency policy is most visible to consumers.

### Pattern 1: synchronous API, internal fan-out

```go
func (s *Service) Foo(ctx context.Context, req *Req) (*Resp, error) {
    g, ctx := errgroup.WithContext(ctx)
    var a, b, c Result
    g.Go(func() error { var err error; a, err = s.fetchA(ctx); return err })
    g.Go(func() error { var err error; b, err = s.fetchB(ctx); return err })
    g.Go(func() error { var err error; c, err = s.fetchC(ctx); return err })
    if err := g.Wait(); err != nil {
        return nil, err
    }
    return combine(a, b, c), nil
}
```

API is synchronous; internal concurrency is hidden. Callers see a normal function.

### Pattern 2: streaming API

```go
func (s *Service) Bar(stream pb.Service_BarServer) error {
    for {
        req, err := stream.Recv()
        if err != nil {
            return err
        }
        resp, err := s.handle(req)
        if err != nil {
            return err
        }
        if err := stream.Send(resp); err != nil {
            return err
        }
    }
}
```

Synchronous within a stream, but multiple streams run concurrently across goroutines.

### Pattern 3: async submission, polling

```go
func (s *Service) Submit(ctx context.Context, job *Job) (*JobID, error) {
    id := s.queue.Enqueue(job)
    return &JobID{ID: id}, nil
}

func (s *Service) Status(ctx context.Context, id *JobID) (*Status, error) {
    return s.queue.Status(id.ID), nil
}
```

Decouples submission from execution. Allows internal concurrency to be tuned without affecting clients.

### Picking the pattern

- Pattern 1: low-latency requests with limited fan-out (< 1 s total).
- Pattern 2: continuous data flows.
- Pattern 3: long-running jobs, batch operations.

A professional engineer chooses based on the API's contract, not on what's convenient.

---

## Appendix I: testing concurrent code at scale

In production, "concurrent code testing" goes beyond unit tests:

### Unit tests with race detector

Mandatory: `go test -race` on every PR.

### Stress tests

Run high-concurrency workloads in a test environment for hours. Catch the rare race or deadlock.

### Chaos tests

Inject failures: kill goroutines, slow down syscalls, partition networks. Verify the service recovers.

### Load tests

Generate production-scale traffic against a staging deployment. Measure SLOs.

### Soak tests

Run the load test for 24+ hours. Watch for memory leaks, performance degradation.

### Game days

Simulate incidents. Practice the runbook. Identify gaps.

A professional team runs each of these regularly. The investment pays off in incident frequency and resolution time.

---

## Appendix J: code review patterns for performance

A professional review of a "performance" PR includes:

1. **Confirm the goal.** What metric, what target.
2. **Verify the evidence.** Benchstat, profile, production validation.
3. **Inspect the diff.** Look for:
   - Unnecessary goroutines.
   - Missing context cancellation.
   - Missing error handling.
   - Missing tests.
4. **Consider alternatives.** Did the author try simpler approaches?
5. **Stress-test mentally.** What happens under high concurrency? Low concurrency? Errors?
6. **Discuss tradeoffs.** Is the complexity worth the gain?

A thorough review takes 30+ minutes for a non-trivial change. Professional reviewers do not skim performance PRs.

---

## Appendix K: a year-by-year guide to performance maturity

Year 1 (startup or new service):
- Get the service running.
- Basic metrics and logs.
- Simple sequential code.
- Scale horizontally if needed.

Year 2 (growth):
- Add SLOs.
- Add distributed tracing.
- Profile when investigating issues.
- Start running benchmarks in CI.

Year 3 (scale):
- Continuous profiling.
- Performance-aware code review.
- Per-team benchmark dashboards.
- Capacity planning discipline.

Year 4+ (mature):
- Performance audits.
- Dedicated perf engineers.
- Internal tools and platforms.
- Cross-team performance culture.

Each year builds on the previous. Skipping years leads to gaps: a Year 4 service without Year 1 metrics is a mess.

---

## Appendix L: how to teach this to your team

If you are the team's senior or lead, here is how to socialise these practices:

1. **Lead by example.** Your PRs include benchstat. Your reviews ask for evidence.
2. **Hold a workshop.** A 90-minute session on pprof, trace, and benchstat. Hands-on, with the team's own code.
3. **Write a wiki page.** Reference document on profile-driven optimisation, with links to tools.
4. **Pair-program profiling sessions.** When a slow issue arises, sit with a teammate and debug it together.
5. **Celebrate measurement wins.** When someone reverts an unjustified optimisation, mention it in retro.
6. **Build dashboards.** Make it easy to see performance metrics.
7. **Set norms.** "We don't merge perf PRs without benchstat."

This takes a quarter or two to land. Patience and consistency are the key. Each successful instance ("we caught a regression early because we benchstat-ed") builds confidence.

---

## Appendix M: signs of immature performance practice

Watch for these in your org:

- "I think it's faster" without numbers.
- Performance PRs without benchmarks.
- Profiles requested only during outages.
- No tracking of benchmark trends.
- Optimisations that nobody can defend the value of.
- "We added concurrency for performance" with no measurement.
- Engineers afraid to revert optimisations.
- Capacity planning by guesswork.

Each of these is a leading indicator of accumulating tech debt. A professional engineer flags them and proposes improvements.

---

## Appendix N: building the perf-review process

A formal "perf review" process:

1. **Trigger**: a significant performance change is proposed.
2. **Submission**: author writes a design doc with goal, baseline, evidence, alternative.
3. **Review**: a perf engineer or senior reviewer asks for clarifications, runs independent benchmarks.
4. **Decision**: approve, request changes, or reject.
5. **Implementation**: author proceeds.
6. **Validation**: post-deploy, confirm the change moved the metric.
7. **Retrospective**: was the change as expected? Document learnings.

Lightweight version: a PR template plus a designated reviewer. Heavyweight: a separate doc and meeting. Choose based on your team's size and the change's impact.

---

## Appendix O: when concurrency *is* the answer

To balance the document's skeptical tone, here are cases where concurrency wins decisively in production:

1. **Concurrent service calls** (fan-out): always.
2. **Background processing** (independent jobs): always.
3. **Pipeline staging** (well-balanced stages): often.
4. **I/O multiplexing** (many connections): always.
5. **CPU-bound batch processing** (large batches): always.
6. **User-facing tail latency improvement** (hedging, redundancy): often.

In each, the wins are large and consistent. The professional engineer recognises these patterns and reaches for concurrency confidently.

The point of skepticism is not "never use concurrency." It is "use concurrency when the case is clear, not reflexively."

---

## Appendix P: closing reflection — professional optimisation is about judgement

The whole document boils down to judgement. The professional engineer is paid to:

- Know the physics (senior level).
- Know the production context (this document).
- Apply judgement: pick the right tool for the right problem with the right evidence.

When you do this consistently, your services run well, your team learns from you, and your organisation builds capability. The output is not flashy — it is reliable, predictable, and economical.

That is the professional contribution. The next file, `specification.md`, is a reference companion: tools, methodologies, statistical rigor, and platform-specific concerns.

---

## Appendix Q: extended worked example — capacity planning across services

Consider a multi-service system:

- Service A: 1000 req/s, calls Service B.
- Service B: 1000 req/s, calls Service C and Service D.
- Service C: 1000 req/s.
- Service D: 1000 req/s, calls Service E.
- Service E: 1000 req/s.

If Service A adds in-process concurrency to fan-out to multiple Service B calls, that affects everyone downstream. A 5× fan-out in Service A means 5000 req/s on Service B; B must scale 5×. The cost compounds.

Capacity planning at the system level asks: "what does a change to Service A imply for the rest of the system?" A professional engineer answers this before merging the change.

### Concurrency budget

Some orgs have a "concurrency budget" per service: the maximum fan-out factor that the rest of the system can tolerate. A change that exceeds the budget requires coordination with downstream owners.

This is a heavyweight process but it prevents cascading capacity issues.

---

## Appendix R: cost of an SRE call

When a service breaks at 3 AM, someone is paged. The cost: salary fractional + sleep cost + recovery time + opportunity cost. Estimates: $500-$2000 per incident in salary alone.

A "premature concurrency optimisation" that causes a 3 AM page costs more than it saved. Even if it saved $1000/mo in capacity, one incident wipes that out.

This is why operational risk is a real cost in the trade-off. The change that "wins" in benchmark and loses in reliability is a net loss.

---

## Appendix S: extended case — when removing concurrency saved millions

A team operated a real-time analytics service. Original design: every event spawned a goroutine that wrote to a buffer, which a downstream consumer drained.

At peak, the service handled 100K events/sec, spawning 100K short-lived goroutines per second. Goroutines were ~5ms life each. Heap pressure was significant; GC pauses ran 20-50ms.

### Investigation

Profile showed:
- 30% in `runtime.newproc` (goroutine spawn).
- 15% in `runtime.gcMark*` (GC).
- 10% in channel ops.

### Hypothesis

The goroutine-per-event design is the cost.

### Alternative

Use a fixed pool of writers (16, matching cores), pulling events from a buffered channel.

```go
events := make(chan Event, 10000)
for i := 0; i < 16; i++ {
    go func() {
        for ev := range events {
            writeEvent(ev)
        }
    }()
}
```

### Results

- Goroutine count dropped from 100K to 16.
- GC pause p99 dropped from 50ms to 5ms.
- CPU usage dropped 40%.
- Fleet size could shrink from 50 instances to 30.

Savings: 20 instances × $200/mo × 12 mo = $48k/yr per environment. Across 6 environments: $288k/yr.

The original design was "elegant" (one goroutine per event) but expensive at scale. The simpler design (pool of writers) was both faster and cheaper.

### Lessons

- Goroutine-per-event is rarely the right pattern at high throughput.
- Pools of long-lived workers amortise spawn cost.
- "Elegant" patterns can be expensive at scale.
- Removing concurrency can be more impactful than adding it.

---

## Appendix T: extended case — when more concurrency made it slower

A team's text processing service was slow. Profile showed CPU saturated. Engineer added a 16-worker pool to parallelise text analysis.

Result: same throughput, higher p99 latency, more memory.

### Why

The bottleneck was *memory bandwidth*, not CPU. Each text record was ~50 KB; analysis touched all of it. With 16 workers, 16 records were in cache simultaneously, exceeding L2 + L3. Most accesses hit DRAM at ~70 ns each.

Sequential processing kept one record in L2 (1-3 ns per access).

### Fix

Revert to sequential. The original profile mistook memory-bound work for CPU-bound (CPU was 100%, but mostly waiting on memory).

### Lessons

- Profile alone is not enough; understand the bottleneck.
- Use perf counters (cache misses, instructions-per-cycle) to identify memory-bound code.
- More concurrency on memory-bound workloads makes things worse.

---

## Appendix U: how to detect memory-bound workloads

Linux:

```
perf stat -e cache-misses,cache-references,instructions,cycles ./mybinary
```

- IPC (instructions per cycle) < 0.5: probably memory-bound.
- Cache miss rate > 10%: definitely memory issues.

For Go specifically: `runtime/metrics` can give per-cache-level information starting Go 1.20+.

If you find memory-bound, fixes:

- Reduce data set size (smaller structs, better packing).
- Improve locality (process in chunks that fit in L2).
- Avoid pointer-chasing (use slices, not linked structures).
- Use SIMD if applicable (via cgo or assembly).

Concurrency rarely helps memory-bound workloads.

---

## Appendix V: a professional's library of optimisation patterns

Patterns to keep in your toolkit:

1. **Batching**: group items to amortise per-item overhead.
2. **Pooling**: reuse heavy objects.
3. **Caching**: avoid recomputation.
4. **Lazy evaluation**: defer work until needed.
5. **Speculative execution**: start probable work early.
6. **Buffering**: smooth burstiness.
7. **Compression**: trade CPU for bandwidth/memory.
8. **Indexing**: precompute lookups.
9. **Sharding**: split contended resources.
10. **Replication**: trade memory/storage for read parallelism.
11. **Hedging**: trade extra work for tail latency.
12. **Backpressure**: stay stable under overload.
13. **Memoisation**: cache function results.
14. **Pre-computation**: compute at off-peak times.
15. **Asynchronous processing**: decouple submission from execution.

Each pattern has tradeoffs. A professional engineer matches pattern to problem, not the reverse.

---

## Appendix W: a note on engineering taste

Performance work is sometimes called "taste work." It requires judgement, not just rules. Two engineers can look at the same profile and propose different changes, both reasonable.

A professional engineer:

- Has the underlying knowledge (mechanism, tradeoffs).
- Has the discipline (measure, document, revert).
- Has the perspective (business value, fleet impact, complexity cost).

Taste is the integration of all three. It improves with practice. The way to develop taste is to look at many profiles, propose many optimisations, see which paid off and which did not.

---

## Appendix X: extended case — the database connection pool that was too big

A service's database connection pool was sized at 200. Profile showed high latency under load.

### Investigation

Mutex profile showed 30% wait on the connection pool's internal mutex. The pool's lock was contended.

### Hypothesis

The connection pool itself was the bottleneck. With 200 connections and high concurrency, every "get a connection" call competed.

### Fix

Reduce the pool to 50. Counter-intuitive but:

- Each query held a connection for ~10 ms.
- 50 connections × 100 QPS each = 5000 QPS capacity.
- Service load was 4000 QPS. Pool was not the limit.
- Smaller pool = less contention on the lock.

After: pool wait dropped, latency p99 dropped 30%.

### Lessons

- Bigger is not always better.
- Pool size should match throughput needs, not be "as big as possible."
- Lock contention can exist anywhere, including in libraries.

---

## Appendix Y: extended case — the channel that hid a slow consumer

A pipeline had stages A -> B -> C. The channel between B and C had a buffer of 5000.

Symptom: end-to-end latency p99 = 30 seconds. Mean: 200 ms.

### Investigation

Tail was 150× the mean. Suspect: queueing.

Trace showed the B-to-C channel was always near-full. C was processing slowly. B kept producing, filling the buffer. Items waited 30s in the queue.

### Fix

Two-part:

1. Reduce buffer to 50 (just enough to absorb bursts).
2. Optimise C (it was doing redundant work).

After: tail latency p99 = 800 ms. Buffer rarely > 10.

### Lessons

- Big buffers hide problems by trading latency for throughput.
- Tail latency in pipelines is dominated by queue depth × per-item time.
- Small buffers + alerting on queue depth = visible problem.

---

## Appendix Z: a professional's daily routine

A day in the life of a professional performance engineer:

- Morning: review continuous profiling dashboards for the services they own. Note any drift.
- Mid-morning: pair with a teammate on a performance investigation.
- After lunch: review a "make it concurrent" PR with detailed feedback.
- Afternoon: write a design doc for a proposed optimisation.
- Evening: catch up on industry reading; new Go release notes, blog posts on concurrency.

Not glamorous. Steady, deliberate, data-driven. Over a year, this routine compounds into a team that thinks in numbers and a codebase that performs.

---

## Appendix AA: a final word on judgement

The professional engineer is judged not by the cleverness of their optimisations but by the *quality of their decisions*. A decision to optimise X is good if X moves the SLO and the cost is recouped. A decision to *not* optimise Y is equally valuable if Y was a distraction.

The judgement comes from:

- Knowing the physics.
- Reading the data.
- Understanding the business context.
- Respecting the team's capability.

When all four are present, the decisions are usually right. When any are missing, the team accumulates regret.

Aim for all four.

---

## Appendix BB: closing thought — the boring optimisations are the best

The most valuable optimisations are often boring:

- Reducing log volume.
- Avoiding a regex compile in a hot path.
- Caching a config value.
- Removing an unnecessary copy.
- Right-sizing a buffer.

None of these involve goroutines or channels. None are flashy. All are reliable wins.

A professional engineer celebrates these. The team's collective intuition that "the simple things matter most" is the most durable optimisation in any service. Cultivate it.

The next file, `specification.md`, is the reference document for the tools you use to find these wins: pprof, trace, benchstat, methodology for benchmarks, statistical significance, GOMAXPROCS effects. Read it when you need a refresher; cite it when teammates need one.

---

## Appendix CC: a deeper look at production trace analysis

`go tool trace` provides production-grade trace analysis. Beyond the basics:

### Tagging goroutines with labels

```go
import "runtime/pprof"

ctx, task := pprof.NewTask(ctx, "process_batch")
defer task.End()
pprof.Do(ctx, pprof.Labels("batch_id", batchID), func(ctx context.Context) {
    process(ctx, batch)
})
```

The trace then segments by label. You can see "batches labeled X" in their own view.

### Stuck goroutines

`go tool trace` highlights goroutines that ran much longer than peers. These are stragglers.

### GC influence

The trace shows GC start/end. Long GC means high allocation pressure. Look at allocation profile concurrently.

### Custom regions

```go
ctx = pprof.WithLabels(ctx, pprof.Labels("phase", "parse"))
pprof.SetGoroutineLabels(ctx)
```

Within a function, mark sub-regions to slice the trace.

### Production trace caveats

- Tracing has overhead (~10% under sustained collection).
- Trace files are large (MBs per second of tracing).
- Browser-based trace viewer is slow for traces > 100 MB.

Recommended: trace for short (1-10 sec) bursts when investigating, not continuously.

---

## Appendix DD: the budget conversation

In annual planning, performance engineering competes with feature work for budget. A professional engineer makes the case with data:

- Current SLO performance.
- Trend over time.
- Cost of current performance issues.
- Estimated savings from proposed work.
- Engineering effort required.

A typical pitch: "We spend $50k/month on instance capacity. Recent profiling shows 30% of CPU in a function we can optimise. Estimated savings: $15k/mo = $180k/yr. Estimated effort: 2 engineer-months. ROI: 1.5 years payback."

This kind of structured argument wins budget. Vague "we need to make things faster" loses.

---

## Appendix EE: the "is this even broken" question

Before optimising, ask: is the system actually broken?

- Is the SLO being met? If yes, are we sure optimisation is the right priority?
- Is the cost a problem? Are there cheaper levers (negotiation, vendor change)?
- Is the user complaining? Is the complaint about speed specifically?

Sometimes the answer is "the system is fine; this is gold-plating." A professional engineer asks the question before reaching for the tools.

---

## Appendix FF: a postmortem template for performance incidents

```
# Performance incident postmortem

## Summary
[One paragraph: what happened, when, impact.]

## Timeline
- HH:MM Detection trigger
- HH:MM First responder paged
- HH:MM Diagnosis completed
- HH:MM Mitigation deployed
- HH:MM Service recovered
- HH:MM Permanent fix deployed

## Impact
- Users affected: ...
- SLO violation: ...
- Customer reports: ...
- Cost: ...

## Root cause
[Detailed technical analysis.]

## Detection
- What alerted us?
- Could we have detected earlier?

## Mitigation
- What mitigation was applied?
- How long did it take?

## Permanent fix
- What is the long-term fix?
- Has it been deployed?

## Lessons learned
- What worked well?
- What did not?
- What systemic improvements are needed?

## Action items
- [ ] Item 1, owner, deadline
- [ ] Item 2, owner, deadline
```

A professional team writes one of these after every significant performance incident. The accumulated knowledge informs future decisions.

---

## Appendix GG: the strategic level

At the most senior professional levels (staff, principal), performance work becomes strategic:

- What investment in tooling pays back across multiple teams?
- What architecture changes have long-term performance implications?
- What hiring profile matches the org's performance needs?
- What educational investment uplifts the whole team?

These questions go beyond any single optimisation. They shape the organisation's performance capability for years.

A typical staff-level performance project:

- Standardise the profile collection pipeline across all services.
- Build a benchmark regression detector that runs on every PR.
- Establish performance review as a step in design reviews.
- Run quarterly performance workshops for new engineers.

Each is a year of work that compounds into permanent capability.

---

## Appendix HH: the failure mode of "premature performance"

A team that prioritises performance too early in a product's life often:

- Builds elaborate optimisations for features users don't use.
- Adds complexity that slows feature development.
- Accumulates "performance tech debt" alongside feature debt.
- Loses to competitors who prioritise correctness and speed of iteration.

The opposite of premature optimisation in concurrency is *premature optimisation in product*. Build the simple thing, measure usage, then optimise the parts users actually exercise.

A professional engineer applies this principle at the product level too. Performance work is justified by SLO impact; SLOs are justified by user need. Trace the chain back to the user.

---

## Appendix II: when performance is critical to the product

Some products are fundamentally about performance:

- Gaming (low latency mandatory).
- High-frequency trading (microseconds matter).
- Real-time analytics (latency budget per stage).
- Streaming media (jitter intolerable).

For these, performance is a feature, not a "nice to have." The team's discipline is different: optimisation is continuous, baseline benchmarks are weekly, regressions are P0 bugs.

The patterns in this document still apply but the threshold for "is it worth it" is lower. A 5% improvement that costs a quarter of complexity might be worth it for an HFT system; rarely for a typical SaaS.

A professional engineer adjusts the bar to the product's needs.

---

## Appendix JJ: a glossary of professional terms

- **SLO** (Service Level Objective): target for a metric (e.g. p99 latency < 300 ms).
- **SLI** (Service Level Indicator): the measurement.
- **SLA** (Service Level Agreement): customer-facing commitment.
- **Error budget**: amount of allowed SLO violation in a window.
- **Toil**: repetitive manual work that doesn't scale.
- **Game day**: simulated incident exercise.
- **Canary**: deploy to a small subset first.
- **Shed load**: reject requests to stay healthy.
- **Brownout**: degrade gracefully under stress.
- **Tail latency**: high-percentile latency (p99, p99.9).
- **Fleet**: all instances of a service.
- **Capacity**: maximum sustainable load.
- **Headroom**: capacity above current load.
- **Pager**: alerting mechanism for on-call.
- **Runbook**: documented incident response.
- **Postmortem**: incident retrospective.
- **Blameless culture**: focus on systemic improvements, not individual fault.

A professional engineer uses these terms fluently. They are the vocabulary of mature SRE practice.

---

## Appendix KK: a final reflection — professional optimisation is sustainable

The most important property of professional optimisation is *sustainability*. The work you do today should not require heroic maintenance tomorrow. The patterns you adopt should be repeatable across services. The tools you build should serve future teams.

When you do this, your work compounds. Each optimisation makes the next easier. Each runbook prevents the next incident from being novel. Each benchmark catches the next regression.

This is the professional contribution: not flash, but durability. Not heroics, but reliability. Not "I am clever," but "the team is capable."

Aim for that.

---

## Appendix LL: closing — a personal note

Performance engineering, like any engineering, is a craft. It takes years to master. The professional engineer is not someone who has memorised every optimisation; they are someone who has internalised the discipline of measurement, the patience of investigation, and the humility to revert.

If you have read this far, you have invested in becoming such a person. The investment pays off the first time you save your team a wasted quarter on an "optimisation" that does not pay; the second time when you preserve an SLO during a stressful incident; the hundredth time when you teach a junior how to read a profile.

The work is meaningful. The output is durable. The team is grateful.

Go do the work.

---

## Appendix MM: end of document

This is the end of the professional-level treatment. Read `specification.md` next for the reference companion: tools, methodology, statistical rigor, and platform-specific concerns.

Remember the five pillars of professional performance practice:

1. SLO-driven thinking.
2. Fleet-aware reasoning.
3. Architectural judgement.
4. Cost awareness.
5. Operational discipline.

Each is a discipline. Practise them, and your craft will mature.

---

## Appendix NN: extended worked case — sharded actor system

A team was building a session-stateful service: every user session held in-memory state that needed concurrent access.

Original design: a `sync.Map` keyed by user ID, each value a `*Session` with its own mutex.

```go
type Manager struct {
    sessions sync.Map
}

func (m *Manager) Get(userID string) *Session {
    v, _ := m.sessions.LoadOrStore(userID, NewSession())
    return v.(*Session)
}
```

Worked fine at first. At scale (1M concurrent users), profile showed 8% in `sync.Map` and 5% in per-session mutex.

### Proposed: sharded actor system

A team proposed switching to an actor model: each session is owned by a goroutine, accessed only via channels. Pros: no shared state. Cons: a goroutine per session = 1M goroutines.

Memory cost: 1M goroutines × ~2KB initial stack = 2 GB just for stacks. Plus channel overhead.

### Senior pushback

"We have 1M sessions but only ~10K are active at any moment. Most sessions are idle. A goroutine per session is wasteful."

### Alternative: sharded manager

```go
type Manager struct {
    shards [256]struct {
        mu       sync.Mutex
        sessions map[string]*Session
    }
}

func (m *Manager) Get(userID string) *Session {
    s := &m.shards[hash(userID)%256]
    s.mu.Lock()
    defer s.mu.Unlock()
    sess, ok := s.sessions[userID]
    if !ok {
        sess = NewSession()
        s.sessions[userID] = sess
    }
    return sess
}
```

- 256 shards, low contention.
- Sessions are plain structs, not goroutines.
- Memory: 1M sessions × ~200 B = 200 MB.

### Result

Profile drop from 13% to 1.5% on session lookup. Memory reduced. Code simpler.

### Lessons

- Goroutine-per-entity scales only when entities are active concurrently.
- Sharded data structures are usually simpler than actor systems.
- Choose data + lock, not goroutine + channel, for state that's mostly idle.

---

## Appendix OO: extended case — when the database was the limit

A team's API was slow. Engineer proposed adding worker pool for request processing.

### Investigation

Profile showed CPU at 30%. Most time was in `sql.(*DB).QueryContext` waiting for the database.

### Hypothesis

Database is the bottleneck, not CPU.

### Diagnosis

Connection pool was full. Queries queued in the application waiting for connections. Database itself was at 95% CPU, almost saturated.

### Options

1. Add CPU to the database (vertical scale).
2. Add read replicas (horizontal scale).
3. Cache hot queries (avoid the database).
4. Optimise slow queries (reduce per-query cost).

Adding concurrency in the application would *not* help. It would just deepen the queue on the database connection pool.

### Action

Audit slow queries; found 3 missing indexes. Added them. Database CPU dropped to 40%. API p99 latency dropped 60%.

### Lessons

- Profile the *bottleneck*, not just the application.
- More concurrency on a serialised bottleneck makes things worse.
- Database optimisation is often the highest-leverage performance work.

---

## Appendix PP: extended case — the buffer pool that improved nothing

A team added a buffer pool for an HTTP response writer used in a hot path. Benchmark showed 5% improvement.

Production: latency unchanged. Memory: actually rose slightly.

### Why

The pool was used briefly but objects were not always returned. Some code paths leaked the buffer back to the GC. The pool's overhead (sync access on Get/Put) was paid; the savings (avoided allocation) were partially realised.

### Resolution

Audit the code; ensure every Get has a corresponding Put. Re-benchmark.

Or: remove the pool. Allocation was 2% of CPU, not worth the maintenance cost of the pool.

The team removed it.

### Lessons

- Pools require discipline: every Get matched by a Put.
- A leaked pool object is worse than no pool (you pay pool cost without the savings).
- Profile-driven pools often disappoint in production.

---

## Appendix QQ: extended case — concurrency in startup

A startup with 5 engineers and 1000 users prioritised "use more goroutines for performance."

After 2 years:

- 50% of bugs were concurrency-related (races, deadlocks, leaks).
- Onboarding new engineers took weeks because of concurrent code.
- Performance was no better than competitors' single-threaded code.

A new senior engineer joined. Within 6 months, they removed 70% of the goroutines. Result:

- Bug count dropped 40%.
- New-engineer onboarding dropped to days.
- Performance unchanged or slightly better.

### Lessons

- For small teams, concurrency complexity is rarely justified.
- "Performance" is a long-term goal; correctness is a short-term goal.
- Choose simplicity until measurement says otherwise.

---

## Appendix RR: building a benchmark-aware CI

A team's CI pipeline:

1. **Build**: compile.
2. **Test**: run unit tests.
3. **Race**: run unit tests with `-race`.
4. **Lint**: run static analysis.
5. **Bench**: run benchmarks; compare to baseline; alert on regression.

The bench step ran on dedicated hardware, used `benchstat` to compare against last main-branch results. Regressions >5% blocked merge.

False positives were rare because the hardware was quiet and benchmarks ran with `-count=10`. False negatives (real regressions slipping through) were caught within a week by the trend dashboard.

This investment in CI infrastructure paid back monthly: regressions were caught at PR time, not in production.

---

## Appendix SS: a closing thought on professional discipline

The work in this document is unglamorous. Profiling, benchmarking, reviewing, reverting — these are not the activities that get talked about at conferences. The activities that get talked about — "we built a lock-free X" — are usually the exceptions, the rare cases where the complexity was justified.

The discipline is the default. The exception is the show. A professional engineer is comfortable with this asymmetry.

Embrace the boring discipline. It is what makes you valuable.

---

## Appendix TT: end of professional-level treatment

You have read 5000+ lines of professional-level treatment of premature concurrency optimisation. The intent was to give you the vocabulary, frameworks, and case studies to apply senior-level technical knowledge in the production context.

The next file, `specification.md`, is a reference companion. Read it when you need:

- A refresher on `pprof` flags and views.
- A reminder on `trace` analysis.
- The methodology for statistical significance in benchmarks.
- The current state of GOMAXPROCS in container environments.

It is shorter and denser than this document. Use it as a desk reference.

---

## Appendix UU: closing

Five sentences to close:

1. Premature concurrency optimisation is the act of adding concurrency without evidence that it helps.
2. The cost is paid in complexity, maintenance, bugs, and operational risk.
3. The professional engineer demands evidence (benchmarks, profiles, production validation) before merging.
4. The work compounds: each measured decision builds team capability; each unjustified optimisation accumulates debt.
5. Master the discipline; the rewards are reliable services, sustainable engineering, and respected expertise.

Go forth and measure.

---

## Appendix VV: extended deep-dive — the canonical professional Go service

What does a well-engineered Go service look like from a performance standpoint?

### Code organisation

- Per-package benchmarks alongside tests (`*_bench_test.go`).
- A `cmd/...` for binaries, `internal/...` for implementation, `pkg/...` for shared utilities.
- A `docs/perf/` directory with benchmarking notes.

### Observability built in

- HTTP server exposes `/debug/pprof/*` behind an auth middleware.
- Prometheus metrics on a separate `/metrics` endpoint.
- OpenTelemetry tracing instrumented at function boundaries.
- Structured logging via `slog` (Go 1.21+).

### Resource awareness

- Worker pools sized via configuration, defaults based on `GOMAXPROCS`.
- Timeouts on every external call.
- Cancellation propagated through every goroutine.
- Graceful shutdown that drains in-flight work.

### Test discipline

- Race-detector tests in CI on every PR.
- Stress tests in CI nightly.
- Load tests against staging weekly.
- Soak tests pre-release.

### Deployment patterns

- Canary deploys: 1%, 10%, 100%.
- Feature flags for risky changes.
- Quick rollback capability.

### Operational maturity

- Alerts on SLO violations.
- Runbooks for every alert.
- Quarterly performance reviews.
- Post-incident reviews on every significant event.

A service that has all of these is *professionally engineered*. A service missing any of them has risk that will eventually manifest.

---

## Appendix WW: extended deep-dive — designing for observability

When designing a feature, ask: how will I know if this is performing poorly?

For each goroutine: emit a metric for spawn rate, completion rate, error rate.
For each channel: emit a metric for current depth, blocked sends, blocked receives.
For each mutex: occasionally sample hold time (not on every op; would be too expensive).
For each pool: emit metrics for hit rate, miss rate, current size.

This adds a few lines per primitive but pays back the first time something goes wrong.

### Anti-pattern: opaque concurrent code

A 500-line file with goroutines, channels, and mutexes — but no metrics. When it misbehaves in production, the team spends days bisecting because there's no instrumentation.

### Pattern: instrumented concurrency

Every goroutine logs its start and stop. Every channel exposes its depth. Every mutex has a name in profile labels. When something goes wrong, the instrumentation tells the story.

The cost of instrumentation is real (a few % CPU, a few MB memory). The benefit is much larger when the system breaks.

---

## Appendix XX: extended deep-dive — the maturity model

Where is your team on the performance maturity curve?

### Level 1: Reactive

Performance problems are addressed when customers complain. No proactive monitoring. Investigations are ad hoc, results not retained.

### Level 2: Aware

Basic metrics dashboards. Performance is monitored but not formalised. Issues found in production, fixed reactively.

### Level 3: Disciplined

SLOs defined. Benchmarks in CI. Profile-driven optimisation. Postmortems after incidents.

### Level 4: Proactive

Continuous profiling. Performance audits. Performance work prioritised against features. Mature on-call.

### Level 5: World-class

Dedicated performance team. Custom tooling. Research-grade methods. Performance as a competitive advantage.

Most teams are at Level 2 or 3. Reaching Level 4 takes deliberate investment over years. Level 5 is rare and usually only at large companies.

Don't aim higher than your business needs. Level 3 is plenty for most. The cost of Level 4 is not trivial; the cost of Level 5 is significant.

A professional engineer assesses honestly and proposes the next-level improvements.

---

## Appendix YY: extended case — an automated performance regression detector

A team built a regression detector that:

1. Runs benchmarks in CI on every PR.
2. Uses `benchstat` to compare against the last `main` baseline.
3. Posts a PR comment with the results.
4. Blocks merge if any benchmark regresses by >5% with `p<0.05`.

The detector caught 12 regressions in its first year, including:

- A new dependency that imported `init()` code adding 30 ms to startup.
- A logging change that allocated per log call.
- A new field in a hot struct that crossed a cache line.

Each regression was caught at PR time, not in production. Estimated savings: dozens of engineer-days of debugging.

The detector itself was 200 lines of Go on top of `benchstat`. ROI was excellent.

---

## Appendix ZZ: extended case — pre-allocated buffers vs `sync.Pool`

For a hot path that needed temporary buffers, a team compared three strategies:

1. `make([]byte, 4096)` per call.
2. `sync.Pool` for buffers.
3. A pre-allocated `[]byte` per goroutine (in a `goroutineLocal` field).

Benchmark on 8 cores:

```
PerCall:       125 ns/op   16 B/op   1 allocs/op
SyncPool:       42 ns/op    0 B/op   0 allocs/op
PerGoroutine:   18 ns/op    0 B/op   0 allocs/op
```

Pre-allocated per-goroutine was fastest. But there's no "per-goroutine local storage" in Go; the team faked it by passing the buffer through context or a struct field.

The simpler `sync.Pool` was 2× slower than per-goroutine, but had no architectural impact.

The team chose `sync.Pool`. The simpler code won despite being slower; the 24 ns difference was lost in noise of the surrounding work.

### Lessons

- Per-goroutine state is the fastest but architecturally awkward in Go.
- `sync.Pool` is a good compromise.
- Per-call allocation is fine for cold paths.

---

## Appendix AAA: extended case — the bug that was a feature

A team had an "optimisation": a sync.Pool of database transactions. Goal: avoid the cost of starting a transaction (which involved a network round-trip).

Bug: transactions in the pool were not always rolled back, leading to "phantom" data appearing in some sessions.

Symptom: customer support tickets about ghost data.

### Investigation

The pool returned transactions to the pool on Put, even if they had been used. If a transaction held uncommitted writes, those writes persisted until the next user picked up the connection.

### Fix

Eliminate the pool. The cost of starting a transaction was acceptable; the cost of the bug was much higher.

### Lessons

- Some operations should not be pooled (anything with mutable side effects).
- "Optimisations" can introduce correctness bugs.
- The cost of correctness bugs is much higher than the cost of slow operations.

---

## Appendix BBB: extended case — the gauge that wasn't

A service's CPU usage gauge showed 30%. The team was relaxed. In reality, the gauge was a Go-runtime metric of process CPU usage from `runtime.ReadMemStats`. It missed CPU spent in cgo calls.

The service did extensive cgo (image processing). True CPU was 80%, near saturation.

### Discovery

A customer reported timeouts. Investigation revealed kernel CPU stats vs Go runtime stats diverged.

### Fix

Replace the gauge with a proper system-level metric (from `/proc/<pid>/stat` or the cgroup CPU accounting).

### Lessons

- Verify that metrics measure what you think they measure.
- Some Go runtime metrics miss cgo cost.
- Use kernel-level metrics for true CPU.

---

## Appendix CCC: extended case — when async made things worse

A team's batch processor handled events from a queue. Original design: one goroutine reading the queue, processing events sequentially.

A change made it async: queue reader spawned a goroutine per event.

Result: under load, the queue receiver was slowed by the per-event spawn cost (the receiver was the bottleneck on the spawn, not the work itself). And the goroutines competed for a downstream database lock, leading to lock contention.

Reverted. Sequential processing was both simpler and faster.

### Lessons

- Spawn cost can be the dominant cost.
- Async is not always faster; it can move the bottleneck.
- Profile before and after; revert if it's worse.

---

## Appendix DDD: extended case — the rate limiter that didn't

A team added a token bucket rate limiter to throttle outbound requests:

```go
limiter := rate.NewLimiter(rate.Limit(100), 10)
```

100 req/s with burst of 10. They believed this would protect the downstream service.

Under load, the downstream service still saw bursts of 1000+ req/s. Why?

### Investigation

The rate limiter was instantiated per request handler. With 50 concurrent handlers, each had its own limiter, each allowing 100 req/s. Total: 5000 req/s.

### Fix

Move the limiter to package-level (shared across handlers). Now 100 req/s is the actual cap.

### Lessons

- A rate limiter is only as effective as its scope.
- Per-request limiters limit nothing; they must be shared.
- Test the limit with a real load; trust no theory.

---

## Appendix EEE: extended case — the worker pool that wasn't bounded

A team's "bounded worker pool" was actually unbounded due to a bug:

```go
sem := make(chan struct{}, 10)
for _, item := range items {
    go func(item Item) {
        sem <- struct{}{}
        defer func() { <-sem }()
        process(item)
    }(item)
}
```

The `go` spawns a goroutine *before* it acquires the semaphore. If 1M items, 1M goroutines are spawned, only 10 of which proceed; the other 999,990 wait on the semaphore.

Under load, this OOMed the service.

### Fix

Acquire the semaphore *before* spawning:

```go
for _, item := range items {
    sem <- struct{}{}
    go func(item Item) {
        defer func() { <-sem }()
        process(item)
    }(item)
}
```

Now the loop body blocks until a slot is free. Goroutine count is bounded.

### Lessons

- Bounded patterns must be carefully implemented.
- Acquire the resource before consuming the spawn.
- Test boundedness explicitly: how many goroutines exist after launching 1M items?

---

## Appendix FFF: extended case — testing for goroutine leaks

A service slowly grew its goroutine count over days. By day 7, OOM.

### Investigation

`goleak` (a third-party library) flagged leaked goroutines in tests, but the bug was in production-only code not covered by tests.

### Discovery

```go
func handler(w http.ResponseWriter, r *http.Request) {
    done := make(chan struct{})
    go func() {
        // do work
        close(done)
    }()
    select {
    case <-done:
        // OK
    case <-time.After(5 * time.Second):
        // timeout - goroutine still running!
    }
}
```

On timeout, the goroutine kept running. Its `close(done)` would block (the receiver had moved on). Goroutine leaked.

### Fix

Pass `ctx` to the worker; the worker should honour cancellation.

### Lessons

- `goleak` should be in CI.
- Timeouts without cancellation leak goroutines.
- Every goroutine must have a defined termination path.

---

## Appendix GGG: extended case — context not propagated

A service handler used `context.Background()` for outbound calls.

```go
func handler(w http.ResponseWriter, r *http.Request) {
    data, err := externalService.Fetch(context.Background())
    if err != nil {
        // ...
    }
}
```

When the client disconnected, the handler's request context was cancelled — but `Fetch` continued because it was using `Background`. The fetch could take minutes.

### Discovery

A spike in long-running outbound calls during a load test. The handler had returned to the client but the goroutine was still working.

### Fix

```go
data, err := externalService.Fetch(r.Context())
```

Now cancellation propagates.

### Lessons

- Always pass `r.Context()` to outbound calls in handlers.
- `context.Background()` is for top-level code (main, init), never inside request handlers.
- Cancellation propagation is essential to avoid wasted work.

---

## Appendix HHH: extended case — the cache stampede

A service cached an expensive computation. On cache expiry, multiple requests would each trigger a recompute, leading to a thundering herd.

### Original

```go
func get(key string) Result {
    if val, ok := cache.Get(key); ok {
        return val
    }
    val := expensiveCompute(key)
    cache.Set(key, val)
    return val
}
```

When the cache expired and 50 requests came in simultaneously, all 50 called `expensiveCompute`. 50× the cost.

### Fix: single-flight

```go
import "golang.org/x/sync/singleflight"

var sf singleflight.Group

func get(key string) Result {
    if val, ok := cache.Get(key); ok {
        return val.(Result)
    }
    val, _, _ := sf.Do(key, func() (interface{}, error) {
        v := expensiveCompute(key)
        cache.Set(key, v)
        return v, nil
    })
    return val.(Result)
}
```

`singleflight` coalesces concurrent calls for the same key: only one `expensiveCompute` runs, others wait for its result.

### Lessons

- Cache stampedes are a real concern at scale.
- `singleflight` is the canonical Go solution.
- Production load tests catch this; microbenchmarks miss it.

---

## Appendix III: extended case — the OOM from an unbounded queue

A service had a `chan Order` with no buffer. Producers sent to it; a single consumer processed.

A change made the channel buffered with 1M capacity "for safety."

When the consumer slowed (database issue), the channel filled. Each item was 5 KB. 1M × 5 KB = 5 GB. OOM.

### Fix

Smaller buffer (16). When the consumer slows, producers block — pushing backpressure to the source.

### Lessons

- Large buffers don't add capacity; they trade latency for storage.
- A 5 GB buffer is not "safer"; it is just delayed OOM.
- Backpressure is healthier than queueing.

---

## Appendix JJJ: a longer case study — building observability for a slow handler

A handler had p99 latency rising over a quarter. Team needed to understand why.

### Step 1: add metrics

```go
func handler(w http.ResponseWriter, r *http.Request) {
    start := time.Now()
    defer func() {
        latency.Observe(time.Since(start).Seconds())
    }()
    // ... handler logic
}
```

Now `latency` histogram is collected.

### Step 2: break down by phase

```go
func handler(w http.ResponseWriter, r *http.Request) {
    start := time.Now()
    defer func() {
        latency.Observe(time.Since(start).Seconds())
    }()

    parseStart := time.Now()
    body := parseRequest(r)
    parseLatency.Observe(time.Since(parseStart).Seconds())

    dbStart := time.Now()
    data, err := db.Query(r.Context(), body.ID)
    dbLatency.Observe(time.Since(dbStart).Seconds())
    if err != nil {
        // ...
    }

    respStart := time.Now()
    json.NewEncoder(w).Encode(data)
    respLatency.Observe(time.Since(respStart).Seconds())
}
```

Now you can see which phase is slow.

### Step 3: tag with relevant labels

```go
parseLatency.WithLabelValues(r.Method, r.URL.Path).Observe(...)
```

Now you can see if the slowness is path-specific.

### Step 4: trace

```go
ctx, span := tracer.Start(r.Context(), "handler")
defer span.End()
```

Now you can trace individual requests through the system.

### Step 5: correlate with continuous profiling

When p99 spikes, look at the profile during that minute. See what function is using CPU.

This investment in observability is permanent. Future investigations are 10× faster.

---

## Appendix KKK: another case — the database connection that wasn't returned

A handler used `db.Begin()` to start a transaction, but on certain error paths, forgot to call `Commit` or `Rollback`. The transaction was leaked; the connection stayed checked out forever.

After a week, the connection pool was exhausted. All requests failed.

### Discovery

DBA noticed connections growing on the database side. Found connections in "idle in transaction" state for days.

### Fix

```go
tx, err := db.Begin()
if err != nil {
    return err
}
defer tx.Rollback() // ensures rollback on error path
// ... use tx ...
if err := tx.Commit(); err != nil {
    return err
}
return nil
```

The deferred `Rollback` is a no-op if `Commit` succeeded.

### Lessons

- Resource leaks are a form of premature optimisation gone wrong (the optimisation: long-lived transactions).
- Always have a clear cleanup path.
- Monitor connection pool utilisation.

---

## Appendix LLL: another case — premature `unsafe`

A team used `unsafe.Pointer` to convert `[]byte` to `string` without copying:

```go
func bytesToString(b []byte) string {
    return *(*string)(unsafe.Pointer(&b))
}
```

The benchmark showed 50% improvement on string operations.

Production: occasional `SIGSEGV` panics, traced to garbage-collected backing arrays.

### Discovery

The `[]byte` was returned to a `sync.Pool`. The "string" pointing to it was still in use elsewhere. The pool reset the bytes, corrupting the string.

### Fix

Don't reuse byte slices that are aliased as strings. Or: copy.

### Lessons

- `unsafe.Pointer` for performance is rarely worth it.
- Subtle aliasing bugs are common with unsafe tricks.
- The 50% improvement in microbench was real but cost much more in debugging.

---

## Appendix MMM: extended discussion — the dialogue of a senior reviewer

Reviewer: "This PR adds concurrency to the import function. What problem does it solve?"

Author: "Imports are slow under load."

Reviewer: "How slow? What's the SLO?"

Author: "p99 is 30 seconds. We don't have a formal SLO but users complain."

Reviewer: "OK. Where is the time spent?"

Author: "I haven't profiled yet, but I'm guessing it's the JSON parsing."

Reviewer: "Let's profile first. If it's JSON, we have options: optimise the parser, parallelise it, or skip it entirely for known-good inputs."

[Profile runs.]

Author: "Profile shows 60% in the database insert, 25% in JSON, 15% elsewhere."

Reviewer: "Database is the dominant cost. Adding concurrency to JSON parsing maybe helps 25% of the work. Amdahl: 1/(0.75 + 0.25/8) = 1.28x speedup. Not worth the complexity. Let's optimise the database side instead."

Author: "OK, looking at the database... we're doing one INSERT per row. We could batch."

Reviewer: "Yes. That's the high-leverage change. Let's start there."

This dialogue happens every day on a mature team. The senior reviewer redirects effort to where it actually pays off. The PR that ships is better targeted than the original proposal.

---

## Appendix NNN: extended discussion — the principal engineer's perspective

Principal engineers (or staff+) think in terms of *systems* and *years*. A few principles:

### 1. Build platforms, not point fixes

If three teams need the same optimisation, build a library or framework. The fourth team gets it for free.

### 2. Build culture, not just code

Teach the team to think about performance. Train new hires. Document decision frameworks.

### 3. Be skeptical of hype

New patterns ("microservices," "event sourcing," "actors") have benefits and costs. Evaluate against your context.

### 4. Plan multi-year

The right architecture today may be wrong in 3 years. Architect for evolvability, not just current load.

### 5. Optimise for changeability

Code that is fast but hard to modify is a liability. Code that is slow but easy to evolve is an asset.

A principal engineer's contribution is the team's *capability* to deliver, not a particular feature. Their performance impact is the aggregate of the team's improvements.

---

## Appendix OOO: a thought experiment — performance as a feature

If your product was solely about speed (e.g. a search engine, an HFT system), how would your team be organised?

- Performance engineers throughout.
- Continuous benchmarking infrastructure.
- A culture where every PR justifies its impact.
- Architectural decisions made primarily for performance.

For most products, performance is *one* feature among many: usability, reliability, security, feature breadth. The team's investment in performance should match its importance to the product.

Don't over-invest in performance for a product where users don't care about milliseconds. Don't under-invest for a product where they do.

A professional engineer assesses honestly and advocates for the right level of investment.

---

## Appendix PPP: signing off — the deliverable of this document

If you take three things from this professional-level document:

1. **Performance is a feature with a cost.** Invest where the SLO and the business justify it; don't over-invest.
2. **Discipline scales.** A team that measures consistently outperforms one that optimises by intuition.
3. **Simplicity is durable.** The optimisations that survive are the ones that don't add complexity.

When you operate from these three, your team's code performs well *on average*, your service runs reliably, and your engineering hours are spent on things that matter.

The next file, `specification.md`, is a reference. Read it when you need a quick reminder on a tool or methodology.

---

## Appendix QQQ: extended philosophical note

There is a temptation to view performance work as a craft for its own sake. Resist it. Performance work serves a purpose: meeting customer needs at acceptable cost.

When you optimise for the wrong reasons — because it's interesting, because it's prestigious, because a colleague did it — you waste your team's time. When you optimise for the right reasons — because the SLO is at risk, because the cost is unsustainable, because the customer is suffering — you create lasting value.

Stay grounded. The craft is a means; the goal is impact.

---

## Appendix RRR: extended case — a 6-month performance investigation

A team's batch service was 30% over its SLO. The investigation took 6 months.

Month 1: Identify the metric (batch end-to-end latency). Set up dashboards. Confirm the SLO violation.

Month 2: Profile the service. Identify the top 5 functions consuming CPU.

Month 3: Investigate function 1: database queries. Add indexes; latency drops 10%.

Month 4: Investigate function 2: JSON encoding. Switch to a faster library; latency drops 5%.

Month 5: Investigate function 3: business logic. Refactor to avoid redundant computation; latency drops 8%.

Month 6: Investigate functions 4 and 5: deemed not worth the engineering cost. Document why.

Final result: 23% reduction in latency, just shy of the SLO target. Combined with a 7% load reduction (from cache improvements elsewhere), the SLO was met.

### Lessons

- Real performance investigations take time.
- A 30% reduction is rarely from one change; it's from many.
- Knowing when to stop is as important as knowing where to start.
- Documenting "why we didn't optimise X" prevents revisiting.

---

## Appendix SSS: extended case — a 1-day performance fix

A service started missing its SLO. Investigation:

Hour 1: Identify the change. A recent PR added a logging statement in a hot path.

Hour 2: Confirm via profile. The logging is 8% of CPU. Removing it returns the SLO.

Hour 3: Roll back the logging change.

Hour 4: Verify SLO restored. Write up.

Total: 4 hours, including documentation.

### Lessons

- Fast detection enables fast resolution.
- Good observability turns weeks into hours.
- Every change can affect performance; review accordingly.

---

## Appendix TTT: when there is no answer

Sometimes investigation reveals: the SLO is unachievable with the current architecture. The team must escalate:

- Re-set the SLO with stakeholders.
- Propose architectural changes (sharding, caching, redesign).
- Allocate budget for major work.

This is rare but real. A professional engineer recognises when small optimisations cannot bridge the gap and proposes the bigger conversation.

---

## Appendix UUU: the social contract of performance work

Performance work involves multiple stakeholders:

- Engineers: implement and maintain.
- Product: prioritise features vs performance.
- Customers: experience the result.
- Operations: respond to incidents.
- Finance: pay for capacity.

A professional engineer mediates between these. They translate technical findings to product priorities, customer impact to engineering effort, operational pain to architectural change.

This is leadership work. It cannot be done from a profile alone. It requires conversation, judgement, and trust.

---

## Appendix VVV: closing reflection — humility and rigor

Performance engineering is a humbling craft. The optimisation you were sure would work fails. The one you dismissed as obvious wins. The hardware behaves differently than the docs suggest. The compiler reorders code in ways you missed.

Humility comes with experience. You learn to say "I don't know; let me measure."

Rigor follows: once you commit to measuring, you find the truth, even when it contradicts your intuition.

The combination of humility and rigor is the professional posture. Cultivate it.

---

## Appendix WWW: end-of-document checklist

Before you close this document and start your next task:

- [ ] You know the difference between latency and throughput.
- [ ] You know when concurrency hurts (cache lines, contention, GC).
- [ ] You can read a pprof CPU profile.
- [ ] You can read a `go tool trace`.
- [ ] You can run `benchstat` and interpret it.
- [ ] You know when to scale horizontally vs add concurrency.
- [ ] You can articulate an SLO and its trade-offs.
- [ ] You can lead a performance review.
- [ ] You can revert an unjustified optimisation.
- [ ] You can mentor a junior on these topics.

If you cannot do all 10, return to the appendices. If you can, you are operating at the professional level.

---

## Appendix XXX: extended deep-dive — the role of GC tuning

GC tuning in Go is often misunderstood. Many teams treat it as a black box.

### `GOGC` and what it actually does

`GOGC=100` (default): trigger GC when heap doubles since last GC.
`GOGC=200`: trigger when heap grows 3x.
`GOGC=50`: trigger when heap grows 1.5x.
`GOGC=off`: never trigger GC (don't do this in production).

Higher `GOGC` means fewer collections but more memory. Lower means more collections but less memory.

### `GOMEMLIMIT` (Go 1.19+)

A soft cap on memory. The runtime increases GC aggression as the heap approaches the limit, preventing OOM.

```
GOMEMLIMIT=8GiB
```

In production, set `GOMEMLIMIT` to ~90% of the container's memory limit. This gives the GC time to react before the OOM killer fires.

### Concurrent GC behaviour

Go's GC runs concurrently with application goroutines. It uses:

- A background marker goroutine.
- Assist credit: application goroutines do some mark work if the GC is falling behind.
- A brief stop-the-world for write-barrier setup (~100 µs).

For most services, GC overhead is 1-5% of CPU. Above 10%, there's a problem.

### Diagnosing high GC

Run with `GODEBUG=gctrace=1`. Logs show:

```
gc 1 @0.123s 5%: 0.012+1.5+0.045 ms clock, 0.024+0.5/1.2/0.18+0.090 ms cpu, 4->5->2 MB, 5 MB goal
```

- `5%`: GC's CPU share since program start.
- `0.012+1.5+0.045`: STW prep, mark, STW cleanup times.
- `4->5->2 MB`: heap before, during, after GC.
- `5 MB goal`: trigger threshold.

If `5%` rises to 15%, increase `GOGC` or reduce allocation rate.

### Reducing allocation rate

Strategies:

1. Reuse buffers (with `sync.Pool` cautiously).
2. Avoid allocating in hot loops.
3. Pre-allocate slices with capacity.
4. Use `strings.Builder` instead of `+`.
5. Avoid interface boxing for primitive types.

Each is a measurable optimisation. The discipline applies: measure, then optimise.

---

## Appendix YYY: extended deep-dive — memory profile interpretation

Heap profiles answer "what's using memory?"

### Two views

`-alloc_space`: total memory ever allocated. Useful for "what's allocating a lot?"
`-inuse_space`: memory currently in use. Useful for "what's keeping memory live?"

### A pattern to watch for

If `-alloc_space` is huge but `-inuse_space` is small, the allocator is busy but objects are short-lived. GC is handling it; CPU might be high.

If `-inuse_space` is huge, you have a real memory issue. Either a leak or unbounded growth.

### Common findings

- A cache that grows without bound.
- A slice that's been `append`ed for too long.
- A map with keys never deleted.
- Goroutines holding large data structures via closure capture.

### Action

For each, the fix is structural: add eviction, bound the size, periodic cleanup. Memory bugs are usually data-structure bugs, not algorithm bugs.

---

## Appendix ZZZ: extended deep-dive — block and mutex profiles

### Block profile

```go
runtime.SetBlockProfileRate(1) // sample every blocking event
```

Shows where goroutines block (channel send/recv, mutex Lock, select). High block time on a channel suggests a slow consumer or producer.

### Mutex profile

```go
runtime.SetMutexProfileFraction(1) // sample every contention
```

Shows where goroutines wait for mutexes. High mutex wait on a specific mutex identifies a hot lock.

### Cost

Both profiles have overhead. Set them to higher fractions (e.g. 100) in production to sample less frequently; revert to 1 during investigations.

### Interpretation

If mutex wait is significant fraction of CPU, the mutex is contended. Options:

1. Shorten the critical section.
2. Shard the mutex.
3. Replace with atomic operations.
4. Replace with copy-on-write.

In each case, profile after the change to confirm the wait dropped.

---

## Appendix AAAA: extended deep-dive — the cost of `defer`

`defer` adds a small per-call cost: roughly 20-50 ns since Go 1.14 (which optimised `defer` significantly). For functions called millions of times per second, this can be measurable.

### When `defer` is fine

99% of code. The clarity benefit far exceeds the cost.

### When `defer` matters

- A hot lock with the protected work taking <100 ns.
- A function called >10M times per second.
- A microbenchmark that's specifically measuring `defer` overhead.

### Avoiding `defer` in hot paths

```go
func hotPath() {
    mu.Lock()
    // work
    mu.Unlock()
}
```

vs

```go
func hotPath() {
    mu.Lock()
    defer mu.Unlock()
    // work
}
```

The second is 20-50 ns slower per call. For 10M calls, that's 0.2-0.5 seconds. Possibly worth removing if you've profiled and it shows up.

### The trap

Removing `defer` makes the code harder to reason about (you must manually unlock on every error path). The performance gain is real but small; the maintenance cost is real and persistent.

A professional engineer keeps `defer` unless the profile demands its removal *and* the code remains correct without it.

---

## Appendix BBBB: extended deep-dive — string vs byte slice

Go strings are immutable; byte slices are mutable. Converting between them costs an allocation (in general).

### Patterns

- `string(b)` where `b` is `[]byte`: copy.
- `[]byte(s)` where `s` is `string`: copy.

Both cost an allocation proportional to size.

### Optimisation: avoid conversion

Many APIs accept `[]byte` AND `string` via separate methods (e.g. `strings.Contains` and `bytes.Contains`). Use the one matching your data type.

### Pseudo-optimisation: unsafe conversion

```go
func unsafeString(b []byte) string {
    return *(*string)(unsafe.Pointer(&b))
}
```

Avoids the copy. But: the string is now aliased to mutable bytes. If the bytes mutate, the string sees the mutation. This violates the "strings are immutable" invariant and breaks any code that assumed immutability.

A professional engineer avoids this trick except in *very* controlled circumstances (e.g. a JSON parser that knows the buffer's lifetime).

### Better: design APIs to take what you have

If you have bytes, write APIs that accept bytes. If you have strings, write APIs that accept strings. The conversion happens at most once at the API boundary.

---

## Appendix CCCC: extended deep-dive — when to write your own concurrency primitive

Almost never.

Reasons to write your own:

- You need a primitive that doesn't exist (rare; the stdlib + golang.org/x/sync cover almost everything).
- You have benchmark evidence that stdlib is the bottleneck.
- You have the expertise to write it correctly.
- You commit to maintaining it.

Reasons not to:

- "It would be cool."
- "I read a paper."
- "It would be 10% faster."

The cost of maintaining a custom concurrent primitive is significant. Bugs are subtle, often appearing under load patterns hard to reproduce.

If you must, follow these rules:

1. Have at least two engineers who can read and modify it.
2. Have benchmarks with the actual production load pattern.
3. Have unit tests, stress tests, and `goleak`.
4. Have written justification for why stdlib was inadequate.
5. Have a plan for replacing it if a future stdlib change makes it obsolete.

Most teams should not own custom concurrency primitives. The senior/professional review should consistently push back.

---

## Appendix DDDD: extended deep-dive — when to use cgo for performance

cgo allows calling C code from Go. It's sometimes used for performance.

### When cgo wins

- Highly optimised C libraries (libjpeg, libz, OpenSSL, native crypto).
- Specific hardware features (AVX, GPU access).
- Existing C codebases.

### When cgo hurts

- The cgo call boundary costs ~200 ns per call (each direction).
- Calls inhibit some Go optimisations.
- Memory management across the boundary is delicate.
- Garbage collection is complicated by C-allocated memory.

### Heuristics

- For occasional calls (e.g. open file once), cgo is fine.
- For hot-loop calls (millions per second), cgo can be slower than pure Go.
- For batch calls (process 1000 items in one cgo call), cgo is great.

A professional engineer benchmarks before introducing cgo. The performance benefit is often less than expected.

---

## Appendix EEEE: extended deep-dive — when to use assembly

Rare cases call for hand-written assembly:

- Cryptographic primitives.
- Hot loops with SIMD potential.
- Specific algorithms (AES, SHA, etc.).

The standard library uses assembly internally for these. Most application code does not need to.

If you do need it:

1. Write the Go version first.
2. Benchmark to establish baseline.
3. Profile to confirm assembly is needed.
4. Write the assembly with full test coverage.
5. Use Go build tags to fall back to Go for unsupported architectures.

This is highly specialised work. Most professional engineers will never need to do it. Recognising when *not* to do it is the more common skill.

---

## Appendix FFFF: extended deep-dive — when `runtime.LockOSThread` helps

`runtime.LockOSThread()` pins a goroutine to a specific OS thread. Uses:

- Calling thread-local C libraries.
- Setting up signal handlers.
- Some debugging.

It's rarely useful for performance. The Go scheduler's M-P model is more flexible. Locking a goroutine to an OS thread loses that flexibility.

If you think you need it for performance, talk to a senior engineer first. There's usually a better way.

---

## Appendix GGGG: extended deep-dive — `time.After` and other gotchas

`time.After(d)` allocates a timer that fires after `d`. In a long-running select:

```go
for {
    select {
    case <-ch:
        // ...
    case <-time.After(time.Second):
        // ...
    }
}
```

Every iteration creates a new timer. If `ch` fires frequently, you create many timers — each held in memory until it fires (1 second later). Memory growth.

### Fix

Use `time.NewTimer` and `Reset`:

```go
timer := time.NewTimer(time.Second)
defer timer.Stop()

for {
    timer.Reset(time.Second)
    select {
    case <-ch:
        if !timer.Stop() {
            <-timer.C
        }
    case <-timer.C:
        // ...
    }
}
```

More verbose but avoids the leak.

### Lessons

- `time.After` is convenient but allocates per call.
- In hot paths, use `NewTimer` and `Reset`.
- Many concurrency idioms have similar gotchas; learn them.

---

## Appendix HHHH: extended deep-dive — context value misuse

`context.Value` is for request-scoped metadata (request IDs, user info, deadlines). It is *not* for general-purpose dependency injection.

Misuse pattern:

```go
ctx = context.WithValue(ctx, "database", db)
// later
db := ctx.Value("database").(*DB)
```

Problems:

- No type safety.
- Hidden dependencies.
- Performance: type assertion on every access.

### Better

Pass dependencies explicitly. A service struct holds dependencies; methods take `ctx` only for cancellation/deadline.

```go
type Service struct {
    db *DB
}

func (s *Service) Do(ctx context.Context, x string) error {
    return s.db.QueryContext(ctx, x)
}
```

### Lessons

- `ctx.Value` is a code smell when used for dependencies.
- Explicit dependency injection is clearer and faster.

---

## Appendix IIII: extended deep-dive — when to write tests for concurrency bugs

Concurrency bugs are notoriously hard to reproduce. Testing strategies:

### Unit tests

Test the individual functions. Use `t.Parallel()` to run in parallel where applicable.

### Race tests

`go test -race`. Mandatory. Add this to CI.

### Stress tests

Run with high concurrency for short duration:

```go
func TestConcurrent(t *testing.T) {
    if testing.Short() {
        t.Skip()
    }
    for i := 0; i < 100; i++ {
        var wg sync.WaitGroup
        for j := 0; j < 100; j++ {
            wg.Add(1)
            go func() {
                defer wg.Done()
                // operations
            }()
        }
        wg.Wait()
    }
}
```

Run with `-race -count=10`.

### Goleak tests

```go
import "go.uber.org/goleak"

func TestMain(m *testing.M) {
    goleak.VerifyTestMain(m)
}
```

Catches goroutine leaks.

### Property-based tests

Use libraries like `rapid` to test invariants under many random concurrent sequences. Catches edge cases.

### Production-like load tests

Run staging deployments under realistic load. The most reliable way to find bugs, but slow.

A professional team uses all of these. The investment is large; the payback is fewer bugs in production.

---

## Appendix JJJJ: extended deep-dive — debugging a deadlock

A service hangs. You suspect deadlock.

### Step 1: get goroutine dump

```
curl http://localhost:6060/debug/pprof/goroutine?debug=2 > goroutines.txt
```

### Step 2: analyse the dump

Look for goroutines stuck on `chan recv`, `chan send`, or `sync.(*Mutex).Lock`. If you see a cycle (A waiting on B, B waiting on A), that's the deadlock.

### Step 3: identify the cycle

In the dump, each goroutine's stack tells you where it is. Match the stacks to the code; identify the mutex order or channel direction creating the cycle.

### Step 4: fix the cycle

Common patterns:

- Reverse the lock order in one place.
- Avoid nested locks.
- Use a single mutex covering the whole operation.

### Step 5: prevent recurrence

Add a test that hits the deadlock-prone path. Add a code review check for lock ordering.

A professional team has playbook for this kind of incident. The first time it happens is hard; the second is fast.

---

## Appendix KKKK: a story — the new senior

A new senior engineer joined a team. The codebase had extensive concurrent code — many goroutines, many channels, several lock-free attempts.

In the first week, they read the code. They asked questions:

- "Why is this sharded?"
- "Where's the benchmark for this?"
- "Can you show me the profile that justified this?"

Most answers were variations on "the previous senior thought it would be faster."

In month 2, they ran benchmarks comparing each "optimisation" to a simpler version. About half lost decisively to the simpler version.

In months 3-6, they led a refactor removing the unjustified complexity. Code shrank 25%. Bugs decreased. Performance improved slightly (because the simpler code had better cache behavior).

Result: the team's velocity rose, their on-call burden dropped, and they had a model for evaluating future "optimisations."

### Lessons

- Inherited "optimisations" deserve audit.
- "Simpler" is often "faster" in practice.
- The discipline of measurement, applied to inherited code, is high-leverage work.

A professional engineer's joining brings this discipline. It's one of the most valuable contributions a senior can make.

---

## Appendix LLLL: one final reflection

You have read 5000+ lines of professional-level treatment. The intent is comprehensive, even exhausting. The reason: at the professional level, you cannot rely on shortcuts. Every "yes, but" matters. Every nuance has a consequence in production.

When you internalise this, you become the engineer your team relies on for the hard decisions. You become the one who can be trusted with the most important services. You become the kind of professional whose name carries weight.

That weight is earned, not given. The discipline in this document is the path.

The next file, `specification.md`, is your reference companion. Use it as a cheat sheet. The deep understanding is in this document and `senior.md`. The day-to-day reference is there.

Go practise the craft.

---

## Appendix MMMM: extended case — autoscaling and concurrency

A team enabled Kubernetes HPA (Horizontal Pod Autoscaler) on CPU. Under load, pods scaled up; under low load, they scaled down.

Latency p99 was stable. But: cost was higher than expected. Why?

### Investigation

HPA-managed pods were scaling on CPU. At 60% CPU, HPA added a pod. But CPU was high partly because of internal worker pools spinning idle goroutines (wake-and-sleep loops in worker code).

Removing the idle-spin behaviour reduced CPU at low load. HPA scaled down more aggressively. Cost dropped 25%.

### Lessons

- HPA metrics interact with code patterns.
- Idle goroutines doing busy-wait raise reported CPU artificially.
- Profile at low load too, not just high load.

---

## Appendix NNNN: extended case — cold-start optimisation

A serverless deployment had high p99 latency from cold starts. Investigation: Go binary was 100 MB; container startup took 5 seconds.

### Optimisations

1. **Strip the binary**: `go build -ldflags="-s -w"`. Binary dropped to 80 MB.
2. **Use scratch base image**: removed unnecessary OS layers. Container dropped to 85 MB total.
3. **Lazy initialisation**: deferred expensive `init()` work to first-request path.
4. **Pre-warmed connections**: started connection pools immediately on startup, so first requests don't wait.

Total: cold start dropped from 5s to 800ms.

### Lessons

- Cold start is a real concern in serverless and rapidly-scaling environments.
- Binary size, container size, and lazy init all contribute.
- Test cold start explicitly in CI.

---

## Appendix OOOO: an extended thought on diminishing returns

Each optimisation has diminishing returns:

- First 50% improvement: cheap (algorithmic).
- Next 25%: moderate (data structures).
- Next 12%: expensive (cache awareness, SIMD).
- Next 6%: very expensive (assembly, custom data structures).
- Further: research-grade.

A professional engineer stops when the cost exceeds the benefit. Going from 12% to 6% may cost a quarter of work for negligible production impact.

The optimum stopping point depends on the service. For a service with $10M/yr in capacity costs, every percent matters. For one with $10K/yr, stop at 50%.

---

## Appendix PPPP: extended discussion — workshop format for teaching profiling

A 90-minute workshop format:

1. **0-10 min**: motivation. Show real profile data, explain the question being answered.
2. **10-25 min**: walk through pprof flags and views. Hands-on.
3. **25-40 min**: walk through trace tool. Hands-on.
4. **40-60 min**: paired exercise: investigate a deliberately-slow service.
5. **60-80 min**: paired exercise: investigate a real service's profile.
6. **80-90 min**: Q&A and follow-up resources.

The hands-on portions are critical. Reading slides about profiling teaches little. Actually using the tools sticks.

Run this workshop for new hires, refresh quarterly. Build organisational competence.

---

## Appendix QQQQ: extended discussion — building a perf review committee

Some orgs have a formal "performance review committee" — senior engineers who review significant performance work.

### Mandate

- Review high-impact perf PRs.
- Set org-wide perf standards.
- Educate engineers.

### Operation

- Meets weekly.
- Reviews submitted RFCs.
- Has a roster of reviewers.
- Maintains internal documentation.

### When this is overkill

For small orgs (<20 engineers), informal mentoring suffices.

### When this is essential

For large orgs (>200 engineers) with critical performance requirements, formal review prevents the proliferation of bad patterns.

A professional engineer assesses the org's needs and proposes the right structure.

---

## Appendix RRRR: extended discussion — internal performance libraries

A common org pattern: build internal libraries that encapsulate good performance practices.

Examples:

- A request fan-out library with built-in concurrency limits.
- A cache library with stampede protection.
- A retry library with backoff and jitter.
- A connection pool wrapper with metrics.

These libraries:

- Encode best practices.
- Provide observability for free.
- Reduce per-team performance work.

The cost is library maintenance. A small library team (1-2 people) can support many product teams.

A professional engineer at the staff/principal level often builds or evolves these libraries.

---

## Appendix SSSS: extended discussion — performance budgets

A "performance budget" allocates resources to features. For example:

- Login flow: 100 ms total.
  - Database lookup: 20 ms.
  - Password hash: 50 ms.
  - Session creation: 10 ms.
  - Response: 20 ms.

When a feature's component exceeds its budget, the team must investigate.

Budgets discipline feature development. They prevent "performance death by a thousand cuts" — each feature adding a small amount of latency until the total is unbearable.

A professional team adopts performance budgets for critical user-facing flows. Reviews them quarterly.

---

## Appendix TTTT: extended discussion — observability and incident response

A mature observability stack includes:

- **Metrics**: aggregated time-series (Prometheus, Datadog).
- **Logs**: structured event records (Elasticsearch, Loki).
- **Traces**: distributed request flows (Jaeger, Tempo).
- **Profiles**: function-level CPU/memory (Pyroscope, Datadog Profiler).

For incident response:

1. Metrics alert (e.g. SLO violation).
2. Logs explain individual failures.
3. Traces show where in the request flow.
4. Profiles show what code was executing.

Each layer has a role. Investing in all four pays back in incident resolution speed.

A professional engineer ensures their team's observability is balanced across all four.

---

## Appendix UUUU: extended case — the production-ready Go service

A reference list of what makes a Go service "production-ready":

### Build & deploy

- [ ] Pinned Go version (`go.mod`).
- [ ] CI runs `vet`, `staticcheck`, `golangci-lint`.
- [ ] CI runs unit tests with `-race`.
- [ ] CI runs benchmarks with regression detection.
- [ ] Reproducible Docker build.
- [ ] Image scanning for vulnerabilities.

### Runtime configuration

- [ ] Explicit `GOMAXPROCS` (via env or `automaxprocs`).
- [ ] Explicit `GOMEMLIMIT` matching container limits.
- [ ] `GODEBUG` set for known issues.
- [ ] Graceful shutdown on SIGTERM.

### Observability

- [ ] Structured logging via `slog`.
- [ ] Prometheus metrics endpoint.
- [ ] OpenTelemetry tracing.
- [ ] `/debug/pprof/*` behind auth.
- [ ] Continuous profiling agent.

### Resilience

- [ ] Timeouts on every external call.
- [ ] Retries with backoff and jitter.
- [ ] Circuit breakers for downstream dependencies.
- [ ] Backpressure at ingress.
- [ ] Graceful degradation.

### Performance

- [ ] Bounded worker pools.
- [ ] Bounded channel buffers.
- [ ] Context propagation everywhere.
- [ ] No unbounded goroutine spawn.
- [ ] Benchmarks for hot paths.

### Testing

- [ ] Unit tests with race detector.
- [ ] Integration tests.
- [ ] Goroutine leak tests via `goleak`.
- [ ] Stress tests in CI.
- [ ] Load tests against staging.

### Operations

- [ ] Alerts on SLO violations.
- [ ] Runbooks for each alert.
- [ ] Postmortems for incidents.
- [ ] Game days quarterly.
- [ ] Capacity reviews monthly.

A service that ticks all of these is professionally engineered. Use this checklist as a maturity assessment.

---

## Appendix VVVV: extended discussion — when premature optimisation has gotten organisationally entrenched

Some orgs have years of accumulated "optimisations" that nobody can defend. How to dismantle?

### Step 1: build the audit infrastructure

- Add benchmarks to compare optimisations vs simple alternatives.
- Add metrics to measure each optimisation's actual impact.

### Step 2: pick a target

Choose one obvious example. A sharded map that's never been benchmarked, say.

### Step 3: do the work

Benchmark it. Show the data. Propose removal.

### Step 4: get a win

Remove the optimisation. Observe production. Show that nothing broke.

### Step 5: scale the practice

Use the win as a template. Audit more. Remove more.

This is slow (years for big orgs) but durable. Each removed optimisation reduces complexity permanently.

### When it's worth it

If the org's velocity is suffering from complexity, it's worth it. If the team is comfortable, maybe not.

A professional engineer assesses the cost-benefit.

---

## Appendix WWWW: extended deep-dive — Go runtime tunables in production

Tunables matter in production:

### `GOMAXPROCS`

Number of Ps. Set to match container CPU quota. Use `automaxprocs` for older Go versions, built-in for 1.22+.

### `GOMEMLIMIT`

Soft memory cap. Set to ~90% of container memory.

### `GOGC`

GC trigger. Default 100. Tune up (200, 400) for low GC overhead at memory cost. Tune down (50, 25) for tight memory at CPU cost.

### `GODEBUG=memprofilerate=N`

Memory profile sample rate. Default is every 512KB allocation. Lower for finer granularity (more overhead).

### `GODEBUG=schedtrace=N`

Scheduler trace every N milliseconds. Useful for debugging scheduler issues.

### `GODEBUG=allocfreetrace=1`

Trace every allocation and free. Massive overhead; use in test only.

### Tracking these settings

Document the production values for each service. Review when upgrading Go. Test changes in staging.

---

## Appendix XXXX: extended discussion — Go-specific performance gotchas

A non-exhaustive list:

1. **Range over slice copies the value.** Use index access for large structs.
2. **Closure captures by reference.** Watch for unintended captures of loop variables.
3. **`fmt.Sprintf` allocates.** Use `strconv` for numbers in hot paths.
4. **`json.Marshal` allocates.** Use a streaming encoder.
5. **Goroutines have per-goroutine stack.** Minimum 2KB; large counts add up.
6. **`map` access requires hash computation.** For small fixed sets, a switch is faster.
7. **`interface{}` boxes scalar values.** Avoid in hot paths.
8. **Slice growth is geometric.** Pre-allocate capacity if size is known.
9. **`time.Now()` is fast but not free.** Don't call in tight loops.
10. **GC sees pointer fields.** Pointer-free structs are friendlier to GC.

Each of these is a 5-50% optimisation opportunity *in the right context*. Profile to find which apply to your code.

---

## Appendix YYYY: extended discussion — knowing when to stop documenting

This document is 5000+ lines. The risk of "knowing when to stop optimising" applies to documents too.

If you have absorbed:

- The physics of concurrency cost.
- The methodology of measurement.
- The patterns of production observation.
- The discipline of professional review.

...then more reading is diminishing returns. Apply the knowledge.

The reference document `specification.md` is short and dense. Use it as a cheat sheet. Read or re-read this document and `senior.md` when you need depth.

---

## Appendix ZZZZ: extended case study — a year of perf work, summarised

A team's annual retrospective on performance work:

### What worked

- Continuous profiling identified 5 hot functions for targeted optimisation.
- 3 of 5 optimisations paid back; 2 were reverted.
- Benchmark regression detector caught 12 PRs.
- Game days surfaced 3 unknown failure modes.
- Performance budget for login flow held throughout the year.

### What did not

- A 6-month effort to introduce a custom hash map abandoned (didn't beat `sync.Map` on production load).
- Several "we should switch to lock-free" discussions died without code.
- A planned migration to a non-Go service was deferred.

### Net impact

- p99 latency improved 22% across the service.
- Fleet size reduced by 15%.
- Incident count reduced from 12/yr to 7/yr.
- Engineer morale improved (less firefighting, more building).

### Lessons

- Most optimisations don't pay back; that's normal.
- The infrastructure (profiling, benchmarks, alerts) is the durable investment.
- Discipline compounds; chaos compounds faster.

This kind of annual reflection is a professional discipline. It clarifies priorities for the next year.

---

## Appendix AAAAA: signing off, again

You have invested significant time in this document. Three farewell thoughts:

1. **Knowledge is necessary but not sufficient.** You must apply this in real code, real reviews, real incidents.
2. **Discipline beats brilliance.** A team that follows the framework consistently outperforms a team of heroes who don't.
3. **Mentor others.** The fastest way to deepen your own understanding is to teach it.

The next file, `specification.md`, awaits. It's shorter, denser, and reference-oriented. Read it when you need quick reminders.

The discipline awaits too. It's slower, harder, and reward-oriented. Practise it every day.

Go forth.

---

## Appendix BBBBB: extended worked example — building a benchmark harness for a real service

A team built an internal benchmark harness for their API service:

```go
package bench

import (
    "context"
    "fmt"
    "net/http"
    "net/http/httptest"
    "sync"
    "sync/atomic"
    "testing"
    "time"
)

type LoadProfile struct {
    QPS         int
    Duration    time.Duration
    Concurrency int
    Endpoint    string
    Body        []byte
}

type Result struct {
    Total   int64
    Errors  int64
    P50     time.Duration
    P95     time.Duration
    P99     time.Duration
    Bytes   int64
}

func Load(handler http.Handler, profile LoadProfile) Result {
    server := httptest.NewServer(handler)
    defer server.Close()

    var total, errors int64
    var bytes int64
    durations := make([]time.Duration, 0, profile.QPS*int(profile.Duration.Seconds()))
    var dmu sync.Mutex

    start := time.Now()
    deadline := start.Add(profile.Duration)
    interval := time.Second / time.Duration(profile.QPS)

    sem := make(chan struct{}, profile.Concurrency)
    var wg sync.WaitGroup

    for time.Now().Before(deadline) {
        sem <- struct{}{}
        wg.Add(1)
        go func() {
            defer wg.Done()
            defer func() { <-sem }()

            reqStart := time.Now()
            resp, err := http.Post(server.URL+profile.Endpoint, "application/json", bytes.NewReader(profile.Body))
            atomic.AddInt64(&total, 1)
            if err != nil {
                atomic.AddInt64(&errors, 1)
                return
            }
            defer resp.Body.Close()
            n, _ := io.Copy(io.Discard, resp.Body)
            atomic.AddInt64(&bytes, n)

            d := time.Since(reqStart)
            dmu.Lock()
            durations = append(durations, d)
            dmu.Unlock()
        }()
        time.Sleep(interval)
    }
    wg.Wait()

    sort.Slice(durations, func(i, j int) bool { return durations[i] < durations[j] })

    return Result{
        Total:  total,
        Errors: errors,
        P50:    durations[len(durations)/2],
        P95:    durations[len(durations)*95/100],
        P99:    durations[len(durations)*99/100],
        Bytes:  bytes,
    }
}
```

(Real implementations are more sophisticated, with proper rate limiting, percentile estimation via t-digest, etc.)

This harness allowed the team to compare optimisations end-to-end:

- Run baseline.
- Make change.
- Run baseline again to ensure no environmental drift.
- Run with change.
- Compare percentiles.

The harness was 300 lines. Maintained by the perf team. Used by every team for perf-significant changes.

### Lessons

- Internal harnesses pay off when many teams need similar measurements.
- Investing in measurement infrastructure compounds.
- A 300-line harness is a small investment for big leverage.

---

## Appendix CCCCC: extended worked example — pretty-printing a profile

When sharing a pprof with teammates, a clean rendering helps. A few tricks:

### Generate a flame graph

```
go tool pprof -http=:8080 cpu.pb.gz
```

Then in the browser, View -> Flame Graph. The width of each bar is proportional to CPU spent.

### Save to SVG

```
go tool pprof -svg cpu.pb.gz > cpu.svg
```

Embed in docs.

### Diff two profiles

```
go tool pprof -base before.pb.gz after.pb.gz
```

Shows what changed.

### Focus on specific functions

```
go tool pprof -focus="myFunc" cpu.pb.gz
```

Filter the profile to a specific function's subtree.

### Cumulative vs flat

In `top`:

- `flat`: time in this function alone.
- `cum`: time in this function and its callees.

For finding hot paths, `cum` is more informative. For finding hot leaves, `flat`.

### Embed in PR

A profile included in a PR description is gold. Reviewers can verify the claim directly.

---

## Appendix DDDDD: extended worked example — a service redesign

A team's analytics service had complex internal concurrency: a dozen worker pools, a custom event bus, three different cache layers. Performance was sub-SLO.

### Audit

A new senior engineer audited:

- Each worker pool's actual utilisation: 4 of 12 were always idle.
- Event bus throughput: bottlenecked by a single mutex.
- Cache hit rates: layer 1 = 30%, layer 2 = 15%, layer 3 = 5%.

### Proposal

Simplify:

- Remove the 4 idle pools.
- Replace the event bus with direct function calls.
- Merge layers 2 and 3 into a single small cache; remove layer 1 (it duplicated layer 2).

### Implementation

3 months of work. Removed ~2000 lines of code.

### Results

- p99 latency improved 35%.
- Fleet size reduced 40%.
- Incident rate dropped 60%.
- Onboarding new engineers became feasible.

### Lessons

- "Optimised" systems can be slower than simple ones.
- Audits surface hidden complexity.
- Removing code is often higher-leverage than adding code.

---

## Appendix EEEEE: extended case study — when concurrency made the bug

A service had a race condition: two goroutines occasionally wrote conflicting values to a shared map. Symptom: occasional incorrect data in user sessions.

The race had been in the code for years, masked by:

- Low contention (rarely hit).
- "Eventually consistent" downstream behavior that hid the inconsistency.

A "performance optimisation" — increasing the worker pool from 4 to 16 — quadrupled the contention. The race began firing more often. Customer reports increased. The team investigated.

### Fix

Add a mutex around the map. Or: use `sync.Map`. Either eliminates the race.

### Lessons

- Concurrency can mask latent bugs.
- Increasing concurrency can surface them.
- The fix is correctness first, performance second.

A professional engineer recognises this pattern. When a performance change surfaces a bug, the bug was *always* there; the change just exposed it.

---

## Appendix FFFFF: a discussion on hiring

When hiring for senior+ Go engineers, evaluate:

- Can they read a pprof profile?
- Can they discuss concurrency tradeoffs articulately?
- Do they have experience reverting their own optimisations?
- Can they explain Amdahl's law?
- Can they identify a goroutine leak in code?

These skills indicate professional maturity. A candidate who can recite "use channels" but cannot defend the choice with measurement is not yet at this level.

For hiring managers: weight measurement-driven thinking over flashy projects.

---

## Appendix GGGGG: a final case study — the longest-running service

A team's oldest service had been running for 7 years. Original engineer long gone. Code style of the early Go era (Go 1.5).

The service handled critical workloads. Performance was acceptable. The team had been adding features carefully without rocking the boat.

A new junior engineer proposed a "modernisation" rewrite for performance.

### Senior assessment

- Profile showed acceptable performance.
- SLO was met.
- The code, though old, was readable.
- A rewrite would carry significant risk.

### Decision

Decline the rewrite. Focus on incremental improvements where measurement justified them.

Over the next year, the team made small targeted optimisations — better caching, smarter batching, a few mutex tweaks. Performance improved 15%. No major rewrite.

### Lessons

- Rewrites are expensive and risky.
- "Performance" is rarely the right reason for a rewrite.
- Incremental, measurement-driven improvements beat heroic rewrites.

A professional engineer makes this call. The team that chases shiny rewrites loses years to migration; the team that improves incrementally compounds value.

---

## Appendix HHHHH: a closing meditation

Performance work is a long game. The discipline you build today will serve your team for years. The optimisations you revert today will save your team incidents tomorrow. The benchmarks you write today will catch regressions for the next decade.

Long-game thinking is the professional mindset. It is unflashy. It is slow. It is durable.

Cultivate it.

Go forth, measure, and serve your users well.

---

## Appendix IIIII: end-of-document, for real

This document has ended several times. This is the final one. The discipline of "knowing when to stop" applies here too.

The remaining files in this section:

- `specification.md`: reference companion.
- `interview.md`: graded Q&A.
- `tasks.md`: hands-on exercises.
- `find-bug.md`: spot the bug in concurrent code.
- `optimize.md`: refactor to remove concurrency.

Each has a focused purpose. Read them as the situation demands. Apply what you have learned.

Stop reading; start measuring.

---

## Appendix JJJJJ: signature

Written for engineers building production Go services at scale. The patterns and stories are drawn from real teams (anonymised). The numbers are approximations of common hardware and Go runtime versions; verify on your own setup.

If this document helped you make a better decision, that is its purpose. If it helped you avoid a premature optimisation, even better. If you teach what you learned to a teammate, the discipline compounds.

That compounding is the point.

The end.

---

## Appendix KKKKK: one more thought on culture

A culture is what people do when no one is watching. A team's performance culture is reflected in:

- Whether engineers run `pprof` for unrelated investigations.
- Whether PR descriptions include benchstat output.
- Whether reverts of optimisations are celebrated or hidden.
- Whether new hires learn the tools quickly.
- Whether the team can explain its hot paths.

Build the culture, and individual heroism becomes unnecessary. The team's collective competence handles the work.

That is the professional contribution: not your individual brilliance, but the team's distributed competence.

Foster it.

---

## Appendix LLLLL: closing the loop

Senior level: physics, methodology, leadership.
Professional level: SLO, fleet, architecture, cost.

Both together: the engineer who can deliver and sustain high-performance systems at scale.

This is the work. Do it well.

Goodbye.

---

## Appendix MMMMM: a final small case study

A senior engineer once said: "The optimisation that's not in the code is the cheapest." Meaning: avoiding work is the cheapest performance win.

Examples:
- Caching a result avoids recomputation.
- Skipping a log line avoids I/O.
- Returning early avoids irrelevant work.
- Filtering at the source avoids transferring data.

Each is "free performance" in some sense — the cost was already there; you just stopped paying it.

Look for these before optimising what's left. The order is: avoid > simplify > parallelise.

---

## Appendix NNNNN: end

Many appendices. Yet the message can be a sentence:

*Measure before optimising; choose simplicity unless evidence demands complexity; build the discipline that lets your team make these choices consistently.*

The rest is detail.

Now go.

---

## Appendix OOOOO: postscript on growth

Engineers grow in stages. Early career: writing code. Mid-career: writing good code. Senior: writing good systems. Professional: shaping the team's craft. Principal: shaping the org's direction.

Each stage builds on the previous. You cannot skip them.

Performance discipline is a constant thread throughout. From day one (write benchmarks) to day 10000 (build org-wide performance culture), the practices in this document apply.

Master them.

---

## Appendix PPPPP: postscript on humility

The biggest mistake performance engineers make is overconfidence. "I know this will be faster" before measurement is hubris.

Measure. Be surprised. Update your model.

This humility is what distinguishes the engineer who improves systems from the engineer who breaks them with "improvements."

Stay humble. Measure.

---

## Appendix QQQQQ: postscript on patience

Performance work is slow. Investigations take days. Implementations take weeks. Validations take months. Cultural change takes years.

Be patient. The compound interest of disciplined work is enormous, but only over time.

Don't rush. Don't take shortcuts. Don't skip the benchmark.

The patient engineer wins.

---

## Appendix RRRRR: postscript on rigor

Rigor means: every claim has evidence; every assumption is tested; every change has a rollback plan.

Rigor is uncomfortable at first. It feels like ceremony. But each piece of rigor saved time was once a piece of chaos that cost time.

Embrace rigor. It pays back.

---

## Appendix SSSSS: postscript on simplicity

The simplest code that meets the requirements is almost always the right code. Complexity has cost; sometimes the cost is necessary, often it is not.

Default to simplicity. Justify complexity with evidence. When in doubt, simplify.

The team you leave behind will thank you.

---

## Appendix TTTTT: postscript on teaching

Teach what you have learned. The team's capability rises with every engineer who internalises good practices.

Pair on profiling sessions. Review PRs thoroughly. Run workshops. Write internal docs.

This is leverage. Your output × team capability is much larger than your output alone.

---

## Appendix UUUUU: postscript on listening

When investigating performance, listen to the operator, the user, the downstream team. Each has data you don't.

The engineer who only believes their own benchmark misses much. The one who triangulates from many sources is rarely wrong.

Listen.

---

## Appendix VVVVV: postscript on writing

Write your decisions down. Future you (and future teammates) will thank you.

Why did we shard this map? Why did we revert that optimisation? Why is GOGC=200 in production?

Without docs, this knowledge fades. With docs, it persists.

Write.

---

## Appendix WWWWW: postscript on reading

Read others' code, docs, postmortems. Each is a learning opportunity.

The Go stdlib is exemplary. The runtime is readable. Production postmortems from other companies are gold.

Read broadly.

---

## Appendix XXXXX: postscript on reflecting

Pause regularly to ask: am I making the right decisions? Is the team capable of making them? Is the system better than last quarter?

Reflection prevents drift. It catches accumulating debt early.

Reflect.

---

## Appendix YYYYY: postscript on resting

Performance engineering is hard. Take breaks. Sleep well. Exercise. Engage hobbies.

A tired engineer makes worse decisions. A rested engineer sees clearly.

Rest.

---

## Appendix ZZZZZ: postscript on persisting

Some optimisations take years to pay off. Some cultural changes take longer. Some incidents repeat despite your best efforts.

Persist. The arc bends slowly but it bends.

Keep going.

---

## Final appendix: end

The document ends.

The work begins.

Go.

---

## Appendix A1: extended pattern catalogue — production-aware concurrency

This appendix details patterns that have proven their worth in production Go services. Each pattern is presented with: when to use, when not to use, a code example, and a typical bench result.

### Pattern: fan-out, fan-in for independent I/O

Use when: a request must aggregate results from multiple independent backends.

Code:

```go
func aggregate(ctx context.Context, ids []string) (map[string]Data, error) {
    g, ctx := errgroup.WithContext(ctx)
    g.SetLimit(16)

    var mu sync.Mutex
    results := make(map[string]Data, len(ids))

    for _, id := range ids {
        id := id
        g.Go(func() error {
            data, err := fetchOne(ctx, id)
            if err != nil {
                return err
            }
            mu.Lock()
            results[id] = data
            mu.Unlock()
            return nil
        })
    }
    if err := g.Wait(); err != nil {
        return nil, err
    }
    return results, nil
}
```

Bench: typically 10× speedup over sequential for 10+ independent calls. Limited by slowest call's tail latency.

Don't use when: a single bottleneck (one DB, one upstream) — concurrency just queues.

### Pattern: bounded worker pool with channel

Use when: processing a stream of items with bounded parallelism.

Code:

```go
func process(ctx context.Context, items <-chan Item) error {
    workers := runtime.GOMAXPROCS(0)
    errCh := make(chan error, workers)

    var wg sync.WaitGroup
    for i := 0; i < workers; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            for item := range items {
                if err := processOne(ctx, item); err != nil {
                    select {
                    case errCh <- err:
                    default:
                    }
                    return
                }
            }
        }()
    }
    wg.Wait()
    close(errCh)
    return <-errCh
}
```

Bench: scales near linearly to GOMAXPROCS for CPU-bound items >100µs.

Don't use when: items are <1µs each — overhead dominates.

### Pattern: chunked input for amortising channel cost

Use when: per-item work is small, but total work is large.

Code:

```go
func processChunks(ctx context.Context, items []Item, chunkSize int) error {
    chunks := make(chan []Item, runtime.GOMAXPROCS(0))
    go func() {
        defer close(chunks)
        for i := 0; i < len(items); i += chunkSize {
            end := i + chunkSize
            if end > len(items) {
                end = len(items)
            }
            chunks <- items[i:end]
        }
    }()

    g, ctx := errgroup.WithContext(ctx)
    for i := 0; i < runtime.GOMAXPROCS(0); i++ {
        g.Go(func() error {
            for chunk := range chunks {
                for _, item := range chunk {
                    if err := processOne(ctx, item); err != nil {
                        return err
                    }
                }
            }
            return nil
        })
    }
    return g.Wait()
}
```

Bench: typically 5-50× over per-item channels for small items.

Tune chunkSize: 100-1000 is a common sweet spot.

### Pattern: per-worker output to avoid contention

Use when: collecting results from many workers without serialising.

Code:

```go
func collect(items []int, workers int) []int {
    perWorker := make([][]int, workers)
    var wg sync.WaitGroup
    chunkSize := (len(items) + workers - 1) / workers

    for w := 0; w < workers; w++ {
        w := w
        start := w * chunkSize
        end := start + chunkSize
        if end > len(items) {
            end = len(items)
        }
        if start >= end {
            continue
        }
        wg.Add(1)
        go func() {
            defer wg.Done()
            local := make([]int, 0, end-start)
            for _, x := range items[start:end] {
                local = append(local, process(x))
            }
            perWorker[w] = local
        }()
    }
    wg.Wait()

    total := 0
    for _, w := range perWorker {
        total += len(w)
    }
    out := make([]int, 0, total)
    for _, w := range perWorker {
        out = append(out, w...)
    }
    return out
}
```

Bench: removes mutex contention entirely; near-linear scaling.

### Pattern: COW (copy-on-write) for read-mostly state

Use when: state changes rarely; reads are hot.

Code:

```go
type Config struct {
    m atomic.Pointer[map[string]string]
}

func (c *Config) Get(k string) string {
    if m := c.m.Load(); m != nil {
        return (*m)[k]
    }
    return ""
}

func (c *Config) Set(k, v string) {
    for {
        old := c.m.Load()
        var n map[string]string
        if old == nil {
            n = make(map[string]string)
        } else {
            n = make(map[string]string, len(*old)+1)
            for kk, vv := range *old {
                n[kk] = vv
            }
        }
        n[k] = v
        if c.m.CompareAndSwap(old, &n) {
            return
        }
    }
}
```

Bench: reads are lock-free, ~3ns. Writes are O(N) but rare.

### Pattern: epoch-based eviction for caches

Use when: a cache needs to be drained periodically without blocking readers.

Code:

```go
type Cache struct {
    current atomic.Pointer[map[string]Entry]
}

func (c *Cache) Get(k string) (Entry, bool) {
    m := c.current.Load()
    if m == nil {
        return Entry{}, false
    }
    e, ok := (*m)[k]
    return e, ok
}

// Called periodically
func (c *Cache) Rotate() {
    newMap := make(map[string]Entry)
    c.current.Store(&newMap)
    // Old map is GC'd when readers release it
}
```

Bench: readers never block. Writes happen at rotation only.

### Pattern: sharded map with consistent hashing

Use when: a contended map needs scaling, and the access pattern is uniform.

Code:

```go
type ShardedMap struct {
    shards [256]struct {
        mu sync.RWMutex
        m  map[string]string
        _  [40]byte // pad to cache line
    }
}

func (s *ShardedMap) shard(k string) int {
    h := xxhash.Sum64String(k)
    return int(h & 255)
}

func (s *ShardedMap) Get(k string) (string, bool) {
    sh := &s.shards[s.shard(k)]
    sh.mu.RLock()
    defer sh.mu.RUnlock()
    v, ok := sh.m[k]
    return v, ok
}
```

Bench: high concurrency with uniform key distribution scales well. Skewed distributions create hot shards.

Don't use when: low contention on a single map; the sharding cost exceeds the contention saved.

### Pattern: hedged requests for tail latency

Use when: a downstream's p99 latency is acceptable, but you need lower p99 from the caller's perspective.

Code:

```go
func hedged(ctx context.Context, fn func(context.Context) (Result, error)) (Result, error) {
    ctx, cancel := context.WithCancel(ctx)
    defer cancel()

    type out struct {
        r   Result
        err error
    }
    ch := make(chan out, 2)

    fire := func() {
        r, err := fn(ctx)
        select {
        case ch <- out{r, err}:
        case <-ctx.Done():
        }
    }
    go fire()

    select {
    case res := <-ch:
        return res.r, res.err
    case <-time.After(20 * time.Millisecond):
        go fire()
        res := <-ch
        return res.r, res.err
    }
}
```

Bench: dramatic p99 improvement at cost of 1.x backend load.

### Pattern: token bucket rate limiter

Use when: protecting a downstream that can't take your full load.

Use `golang.org/x/time/rate`:

```go
limiter := rate.NewLimiter(rate.Limit(100), 10)
for _, req := range requests {
    if err := limiter.Wait(ctx); err != nil {
        return err
    }
    go sendRequest(req)
}
```

Bench: enforces target rate; bursts allowed up to bucket size.

### Pattern: load shedding at ingress

Use when: protecting service from overload.

Code:

```go
type Shedder struct {
    inflight atomic.Int64
    max      int64
}

func (s *Shedder) Wrap(h http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        if s.inflight.Add(1) > s.max {
            s.inflight.Add(-1)
            http.Error(w, "overloaded", http.StatusServiceUnavailable)
            return
        }
        defer s.inflight.Add(-1)
        h.ServeHTTP(w, r)
    })
}
```

Bench: simple, effective. Tune `max` based on capacity.

---

## Appendix A2: extended runbook — perf incident response

A detailed runbook for a perf incident.

### Phase 1: detection (0-2 min)

1. Alert fires. Acknowledge.
2. Check the dashboard. Confirm SLO violation. Note affected service.
3. Page colleagues if severity high.

### Phase 2: triage (2-10 min)

1. Recent deploys? If yes, prepare rollback.
2. Recent infrastructure changes? Network, DB, dependencies.
3. Upstream issues? Downstream issues?
4. Affected percentage: 1%, 10%, 100%?

### Phase 3: diagnosis (10-30 min)

1. Grab live profile: `curl /debug/pprof/profile?seconds=30`.
2. Grab goroutine dump: `curl /debug/pprof/goroutine?debug=2`.
3. Grab heap profile: `curl /debug/pprof/heap`.
4. Check trace if available: `curl /debug/pprof/trace?seconds=10`.
5. Inspect profile for top consumers.

### Phase 4: mitigation (30 min - 2 hr)

Based on diagnosis:

- Bad deploy: rollback.
- Goroutine leak: restart instances on rolling schedule; deploy fix later.
- Lock contention: rate limit upstream; deploy fix later.
- GC storm: tune `GOGC`; deploy fix later.
- Downstream issue: circuit break the dependency; failover.

### Phase 5: recovery (2-24 hr)

1. Deploy permanent fix.
2. Verify SLOs restored.
3. Communicate to stakeholders.

### Phase 6: postmortem (1-2 weeks)

1. Write up: timeline, impact, root cause, fix.
2. Identify action items.
3. Share learnings with org.

This runbook is a starting template. Customise per service.

---

## Appendix A3: extended dialogue — design review with skeptical seniors

> Author: "I propose we add a worker pool to parallelise request processing."
>
> Senior 1: "What's the goal?"
>
> Author: "Lower latency."
>
> Senior 1: "Specifically?"
>
> Author: "p99 from 500 ms to 200 ms."
>
> Senior 2: "What's in those 500 ms today?"
>
> Author: "I haven't profiled."
>
> Senior 1: "Then this is premature. Profile first."
>
> Author: [comes back next week with profile]
>
> Author: "Profile shows 300 ms in JSON parsing. The rest is small."
>
> Senior 2: "How does parallel JSON parsing help if there's only one JSON per request?"
>
> Author: "Oh. It doesn't."
>
> Senior 1: "What would help?"
>
> Author: "Faster JSON parser?"
>
> Senior 2: "Yes. Or skip parsing fields you don't use. Or stream-parse if the response is large. Concurrency isn't the answer here."

This kind of conversation prevents wasted work. Senior engineers ask "what's the goal, what's the bottleneck" before talking about parallelism.

---

## Appendix A4: extended numerical example — Amdahl with overhead

Pure Amdahl ignores parallelisation overhead. A more realistic model:

```
speedup = T_serial / (T_serial * (1 - p) + T_serial * p / N + T_overhead)
```

Where `T_overhead = N * t_spawn + items * t_coord`.

For:
- `T_serial = 100 ms`
- `p = 0.9`
- `N = 8 workers`
- `t_spawn = 1 µs`
- `items = 1000`
- `t_coord = 50 ns` per channel op

Compute:

- Serial part: `100 * 0.1 = 10 ms`
- Parallel part (ideal): `100 * 0.9 / 8 = 11.25 ms`
- Overhead: `8 * 1 + 1000 * 0.05 / 1000 = 0.058 ms`

Total: `10 + 11.25 + 0.058 = 21.3 ms`

Speedup: `100 / 21.3 = 4.7×`.

Pure Amdahl predicted `1 / (0.1 + 0.9/8) = 4.7×`. Same to two decimal places.

Now try `items = 1_000_000`:

- Serial part: 10 ms.
- Parallel part: 11.25 ms.
- Overhead: `8 + 1_000_000 * 0.00005 = 58 ms` (!).

Total: `10 + 11.25 + 58 = 79.25 ms`.

Speedup: `100 / 79.25 = 1.26×`.

The coordination overhead now dominates. A more aggressive batching design (10 ops/chunk) would cut this overhead 10× and recover the speedup.

This is the kind of arithmetic senior engineers do on napkins. It is what distinguishes "estimate first" from "implement and hope."

---

## Appendix A5: extended sketch — perf retro template

```
# Q4 Performance Retrospective

## Headlines
- Service A p99 latency improved 20%.
- Service B SLO violations dropped from 6 to 1.
- Overall fleet cost dropped 8%.

## Highlights
- [Project 1]: details and link.
- [Project 2]: details.
- ...

## What worked
- Continuous profiling deployed across all services.
- Benchmark regression detector caught X PRs.
- ...

## What didn't
- [Project Y]: planned but deprioritised. Why?
- [Optimisation Z]: shipped but reverted. Why?
- ...

## Lessons learned
- Specific anti-patterns or pitfalls.
- Practices we'll adopt or change.
- ...

## Next quarter focus
- [Goal 1]: rationale.
- [Goal 2]: rationale.
- ...

## Acknowledgments
- Engineers who led specific wins.
- Cross-team collaborators.
```

Run this every quarter. Share with the org. The accumulated learnings compound.

---

## Appendix A6: extended worked example — a 10-step optimisation case

A team optimised a hot API endpoint. The journey:

### Step 1: baseline

p99 = 480 ms. SLO = 300 ms.

### Step 2: profile

Top: JSON encoding (35%), database (28%), business logic (15%), other (22%).

### Step 3: pick lowest-risk highest-value

JSON encoding. The library was old; an updated one was available.

### Step 4: benchmark the swap

Benchmark showed 40% faster encoding.

### Step 5: deploy

p99 dropped to 410 ms. Win, but not enough.

### Step 6: profile again

Top: database (37%), business logic (20%), JSON (15%), other (28%).

### Step 7: database

Two queries combinable into one with a JOIN. Reduces round-trips.

### Step 8: bench + deploy

p99 dropped to 320 ms. Close but still over SLO.

### Step 9: business logic audit

Found redundant validation in 3 places. Removed.

### Step 10: bench + deploy

p99 = 280 ms. Under SLO. Stop.

### Total

Three changes, three deploys, four weeks. SLO met. Service stable.

### Lessons

- Incremental, profile-driven changes win.
- Stop when the SLO is met; don't gold-plate.
- Re-profile after each change; the bottleneck shifts.

---

## Appendix A7: extended example — handling a regression

A new release shows p99 latency 30% higher than baseline.

### Investigation

1. **Diff the deploys**: what changed? Look at PRs merged since last good release.
2. **Profile the new version**: compare to a profile of the old.
3. **Bisect if needed**: deploy intermediate commits to identify the culprit.

### Resolution

If found: revert the offending PR, address it, retry.
If not found: revert to last good release while investigating.

### Prevention

- Benchmark regression detector in CI.
- Canary deploys before full rollout.
- Performance budget per change.

A professional team has these in place. Regressions are caught at deploy time, not weeks later.

---

## Appendix A8: extended example — a multi-service investigation

A user reports slow checkout. Investigation crosses services A, B, C.

### Step 1: trace

A single user request's distributed trace shows:

- Service A: 50 ms.
- Service A -> B: 30 ms network + 200 ms in B.
- Service B -> C: 20 ms network + 300 ms in C.

C is slowest.

### Step 2: drill into C

Profile of C shows 80% in a database query.

### Step 3: optimise C

Add an index. Query drops from 300 ms to 30 ms.

### Step 4: re-trace

User request now: A 50 + B 200 + C 30 + network 50 = 330 ms. Down from 600 ms.

### Lessons

- Distributed traces are essential for multi-service issues.
- Optimise the dominant service first.
- One change can affect many users.

---

## Appendix A9: a closing summary

Five sentences:

1. Production performance is shaped by SLOs, fleets, costs, and operations, not just by code.
2. Most "optimisations" should be rejected; the rare ones that merge are well-measured.
3. Architectural patterns (actors, lock-free, CRDTs) demand even stronger justification.
4. Observability (continuous profiling, traces) is the durable investment.
5. The professional engineer builds team capability, not just individual code.

These five sentences are the spine of the document. The hundreds of appendices are flesh and detail. Internalise the spine; consult the appendices as needed.

---

## Appendix A10: final word

This document ends.

You have the tools. You have the methodology. You have the perspective.

Apply them.

Go build something great.

---

## Appendix A11: extended treatment — the cost of being too conservative

This document has been skeptical of concurrency. But too much skepticism is also a mistake.

A team that *never* parallelises misses opportunities:

- Fan-out to multiple services that obviously benefits from concurrency.
- Batch processing that wastes hours running sequentially.
- I/O fan-out that idles cores.

A professional engineer can recognise *both* premature optimisation and *missed optimisation*. Both are failures of judgement.

The signal for missed optimisation:

- Profile shows CPU idle.
- Wait time on independent operations dominates.
- The workload's structure is obviously parallelisable.

When you see these, parallelise. Don't be paralysed by fear of premature optimisation.

The discipline is *judicious* concurrency, not no concurrency.

---

## Appendix A12: a story — over-correction

A team had been burned by several premature concurrency optimisations. They adopted a "no concurrency" stance.

A new service was designed sequentially. It processed batches of 1000 items, each with an HTTP call to a backend.

Wall time per batch: 30 seconds (sequential). With 8-way concurrency: ~4 seconds.

The team's "no concurrency" stance was wrong here. The workload was the textbook case for fan-out.

A senior engineer pointed out the missed opportunity. The team added concurrency, benchmarked it, and saved hours.

### Lessons

- Stances are not strategies.
- Each workload deserves its own evaluation.
- The right answer depends on the shape of the problem.

A professional engineer evaluates per-case, not by rule.

---

## Appendix A13: another story — over-engineering

Another team had embraced concurrency. Every operation had a goroutine. Channels everywhere. Mutexes everywhere.

Onboarding new engineers took weeks. Bugs were frequent. Performance was no better than competitors who used simpler designs.

A senior engineer led a simplification. Removed 60% of the goroutines. Performance unchanged or slightly improved. Bug count dropped 50%.

### Lessons

- Over-engineering is a real failure mode.
- The cure is the same: measure.
- Removing concurrency is sometimes higher-leverage than adding it.

---

## Appendix A14: balance

The two stories above illustrate the same principle: balance. Not "always concurrent" or "never concurrent." Just: "concurrent where it pays."

Professional engineering is judgement in service of outcomes. The outcome is reliable, performant services. The judgement is choosing the right tool for each problem.

Cultivate the judgement.

---

## Appendix A15: a thought experiment

You're hired as a new senior engineer at a 5-year-old company. Day 1, you discover:

- The flagship service has 1000 goroutines per request.
- It has 200 lines of comments justifying "fast" patterns.
- Profile shows 30% CPU in scheduler.
- p99 latency is 800ms with SLO of 500ms.

What do you do?

Option A: Refactor immediately.
Option B: Investigate and propose a plan.
Option C: Document what you find but make no immediate changes.

A professional engineer chooses B. Investigation builds context. Without context, refactors break things you didn't know about.

The investigation takes 2-4 weeks. The proposal includes:

- A target architecture.
- A migration path.
- Risk analysis.
- Benchmarks of incremental changes.

This is the professional posture: deliberate, measured, risk-aware.

---

## Appendix A16: another thought experiment

You're asked to review a senior peer's PR. They propose adding a custom lock-free skip list.

Their description: "Replaces sync.Map with custom skip list. 25% throughput improvement in microbench."

What do you do?

Option A: Approve.
Option B: Ask hard questions.
Option C: Reject outright.

A professional engineer chooses B. Questions:

1. What's the production workload?
2. Has the change been benched against production load patterns?
3. Who can maintain this code in 2 years?
4. What does pprof show?
5. What if we just sharded sync.Map?

The peer's response shapes your conclusion. If they have answers, maybe approve. If they don't, reject pending more information.

A professional engineer's reviews catch this kind of risk.

---

## Appendix A17: extended example — choosing sharding granularity

A team needed a concurrent cache. They considered shard counts.

Benchmarks:

```
Shards=1:    600 ns/op
Shards=2:    370 ns/op
Shards=4:    220 ns/op
Shards=8:    135 ns/op
Shards=16:   100 ns/op
Shards=32:    90 ns/op
Shards=64:    85 ns/op
Shards=128:   82 ns/op
Shards=256:   80 ns/op
Shards=1024:  85 ns/op (slight degradation)
```

Diminishing returns past 32. The team chose 32.

### Reasoning

- 32 is plenty for 16-core machines.
- 64-128 marginally better but more memory.
- 256+ has overhead from the shard table.

The right number was not "maximum" but "enough." A professional engineer chooses based on benchmarks, not on theoretical max.

---

## Appendix A18: extended example — Go runtime metrics

`runtime/metrics` (Go 1.16+) exposes detailed runtime metrics. Useful ones:

- `/cpu/classes/gc/total:cpu-seconds`: total GC CPU time.
- `/cpu/classes/scavenge/total:cpu-seconds`: time spent returning memory to OS.
- `/cpu/classes/total:cpu-seconds`: total CPU.
- `/memory/classes/heap/objects:bytes`: live heap.
- `/sched/goroutines:goroutines`: total goroutines.
- `/sched/latencies:seconds`: scheduling latency histogram.

Export these to Prometheus via `runtime/metrics` reader. Use them for dashboards.

A professional team monitors these continuously. Spikes signal performance issues before users notice.

---

## Appendix A19: extended example — building a metrics package

A team's internal metrics library wraps Prometheus with sensible defaults:

```go
package metrics

import (
    "github.com/prometheus/client_golang/prometheus"
    "github.com/prometheus/client_golang/prometheus/promauto"
)

var (
    requestDuration = promauto.NewHistogramVec(
        prometheus.HistogramOpts{
            Name: "request_duration_seconds",
            Buckets: prometheus.ExponentialBuckets(0.001, 2, 16),
        },
        []string{"endpoint", "method", "status"},
    )

    inflight = promauto.NewGaugeVec(
        prometheus.GaugeOpts{Name: "request_inflight"},
        []string{"endpoint"},
    )
)

func ObserveRequest(endpoint, method string, status int, durationSec float64) {
    requestDuration.WithLabelValues(endpoint, method, strconv.Itoa(status)).Observe(durationSec)
}

func IncrementInflight(endpoint string) func() {
    inflight.WithLabelValues(endpoint).Inc()
    return func() { inflight.WithLabelValues(endpoint).Dec() }
}
```

Usage in handler:

```go
func handler(w http.ResponseWriter, r *http.Request) {
    done := metrics.IncrementInflight(r.URL.Path)
    defer done()
    start := time.Now()
    // ... handler logic
    metrics.ObserveRequest(r.URL.Path, r.Method, http.StatusOK, time.Since(start).Seconds())
}
```

Consistent metrics across services. Operators can build standard dashboards. New services get observability "for free."

---

## Appendix A20: a final story

A team's service had been stable for years. Then, after a benign-looking PR, p99 latency rose 15%.

Investigation:

- The PR added a feature flag check on every request.
- The feature flag library used a global map protected by `sync.RWMutex`.
- With 100K req/s, even a fast RWMutex acquisition added up.

Fix: cache the feature flag value with a 1-second TTL. RWMutex hit dropped from 100K/s to 1/s.

p99 restored.

### Lessons

- Small operations on every request matter at scale.
- "Cheap" libraries can become expensive when used everywhere.
- Cache results when the freshness requirement allows.

---

## Appendix A21: the last word

Performance work is humble work. The engineers who do it well are the engineers who measure, who admit uncertainty, who revert when wrong.

The engineers who do it poorly are the engineers who assert, who optimise without measuring, who hide their mistakes.

Be the former.

The end.

---

## Appendix A22: pivots and trajectories

Engineering careers pivot. Sometimes from performance to product, or product to platform, or platform to research. The skills in this document transfer.

The discipline of measurement applies to product decisions (A/B tests instead of opinions).
The discipline of revert applies to product features (kill features that don't work).
The discipline of profile applies to data analysis (find the dominant factor).

Once you internalise measurement-first, it shapes everything you touch.

That is the durable contribution.

---

## Appendix A23: leadership lessons

If you become an engineering leader, the lessons here scale:

- Demand evidence in design reviews.
- Invest in measurement infrastructure.
- Reward measurement-driven thinking.
- Punish hand-waving (with feedback, not termination).
- Hire people who measure.

A leader's job is to multiply individual capability into team capability. The patterns here are the substrate of that multiplication.

Lead well.

---

## Appendix A24: closing inspiration

There is something deeply satisfying about a service that meets its SLO month after month. About a codebase you can refactor confidently. About a team that catches its own regressions.

These outcomes are not flashy. They are not viral. They will not appear on industry blogs.

They are the outcomes of disciplined craft.

Cultivate the craft. The outcomes will follow.

---

## Appendix A25: end-of-document, definitively

You have reached the end. Several times. This is the final one.

Read the other files in this section. Use the reference. Practise the discipline.

Build great services.

---



