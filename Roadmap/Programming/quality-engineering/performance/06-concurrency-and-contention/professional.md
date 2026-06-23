# Concurrency and Contention — Professional Level

> **Roadmap:** [Performance](../README.md) → Concurrency and Contention
> *The senior page taught you Amdahl, the USL, and why a lock serializes work. This page is about those laws hitting a fleet, a container CPU quota, and a connection pool — where "how many cores does this scale to?" stops being a curiosity and becomes a capacity-planning number, an SLO breach, and a 2 a.m. page that says throughput collapsed when you added hardware.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Sizing Pools and Parallelism in Production](#sizing-pools-and-parallelism-in-production)
4. [GOMAXPROCS, cgroups, and the CPU-Quota Mismatch](#gomaxprocs-cgroups-and-the-cpu-quota-mismatch)
5. [The Connection Pool Is the Real Bottleneck](#the-connection-pool-is-the-real-bottleneck)
6. [Concurrency Limiting and Backpressure as Throughput Protection](#concurrency-limiting-and-backpressure-as-throughput-protection)
7. [The Scaling Test Discipline](#the-scaling-test-discipline)
8. [Architecture Choices That Dodge Contention](#architecture-choices-that-dodge-contention)
9. [Diagnosing Production Contention Incidents](#diagnosing-production-contention-incidents)
10. [War Stories](#war-stories)
11. [Decision Frameworks](#decision-frameworks)
12. [Mental Models](#mental-models)
13. [Common Mistakes](#common-mistakes)
14. [Test Yourself](#test-yourself)
15. [Cheat Sheet](#cheat-sheet)
16. [Summary](#summary)
17. [Further Reading](#further-reading)
18. [Related Topics](#related-topics)

---

## Introduction

> Focus: **Concurrency performance as a production and architecture decision — sizing, limiting, and structuring systems so that adding load or hardware adds throughput instead of contention.**

The senior page framed contention as a law: the Universal Scalability Law says throughput rises, plateaus, and then *retrogrades* as you add concurrency, because of serialization (α) and coherency/crosstalk (β). At the professional level those Greek letters become production numbers and meetings: a service that handles 40k req/s on 4 cores and *38k* on 8 because a single mutex serializes the hot path; a Go binary throttled to 12% CPU because `GOMAXPROCS` saw 64 host cores while the cgroup gave it 0.5; a database pool capped at 20 connections that turns a CPU-bound incident into a queue-of-death; a fleet that falls over not because any one box is slow but because one shared lock serializes the whole fleet through one row.

None of these are new *concepts* — they're the senior-tier mechanics (locks, false sharing, the USL) multiplied by a container runtime, a connection limit, and a load spike. The skill here is judgment under those constraints: knowing that the right pool size is *measured, not guessed*; that the connection pool is usually the binding constraint long before CPU; that the safest way to protect throughput under overload is to *reject work early* rather than queue it; and that the cheapest contention is the contention you architected away with sharding or a single-writer design. This page is the pragmatic, battle-tested layer.

---

## Prerequisites

- **Required:** [senior.md](senior.md) — Amdahl's law, the Universal Scalability Law (α serialization, β coherency), locks, lock-free structures, false sharing, memory ordering.
- **Required:** You've operated a concurrent service in production and watched a latency or throughput graph move under real load.
- **Helpful:** You've tuned a thread/goroutine pool, a connection pool, or a queue depth and seen it change behavior.
- **Helpful:** You've been on an incident where adding capacity (cores, replicas, pool size) made things *worse*, not better.

---

## Sizing Pools and Parallelism in Production

The first production question is almost always "how many workers?" — threads, goroutines, pool size, parallelism. The answer is not "as many as possible," and it is not a constant. It's a function of *what the work is bound on*.

The foundational rule is **Little's Law turned into a sizing formula**. For a pool serving requests, the useful concurrency is:

```
optimal threads ≈ cores × target_utilization × (1 + wait_time / service_time)
```

For **CPU-bound** work, `wait_time ≈ 0`, so the answer collapses to roughly **number of cores** (plus one to cover an occasional page fault). More threads than cores on pure CPU work buys nothing and *costs* context switches and cache pollution. For **I/O-bound** work — a request that spends 90 ms waiting on a database and 10 ms computing — the `wait/service` ratio is 9, so the same core count wants ~10× the threads to stay busy. This is why a thread-per-request server tuned for an in-memory workload starves when the workload becomes I/O-heavy, and vice versa.

Concrete defaults teams actually ship:

- **Java fixed thread pool, CPU-bound:** `Runtime.getRuntime().availableProcessors()` (or +1). Anything larger just adds scheduler overhead.
- **Java fixed thread pool, I/O-bound:** size up from cores by the wait/service ratio, *bounded by the downstream's capacity* — a 200-thread pool hammering a database that handles 30 concurrent queries is just moving the queue.
- **Java common ForkJoinPool:** defaults to `availableProcessors() - 1`. In a container this reads *host* cores unless you set `-Djava.util.concurrent.ForkJoinPool.common.parallelism=N` (or run on a JVM that's cgroup-aware). Parallel streams, `CompletableFuture` without an explicit executor, and many libraries all share this one pool — so an under- or over-sized common pool is a fleet-wide default.
- **Go goroutines:** goroutines are cheap (a few KB), so you rarely size the *count* directly — you size the **parallelism** (`GOMAXPROCS`, next section) and the **concurrency limit** on whatever they contend over (a semaphore, a `errgroup` with `SetLimit`, a worker pool over a bounded channel). Spawning a goroutine per request is fine; letting a million of them hit an unbounded `sql.DB` is not.

> **The professional reality:** the "right" pool size is a *measured* number for *this* workload on *this* hardware, not a copied constant. The single biggest sizing mistake is making a pool large to "handle load" — an oversized pool doesn't add throughput past the bottleneck, it just deepens the queue and inflates tail latency. Size to the bottleneck (cores for CPU work, downstream capacity for I/O work), then *protect* it with a concurrency limit rather than enlarging it.

---

## GOMAXPROCS, cgroups, and the CPU-Quota Mismatch

This is the single most common concurrency-in-production footgun of the container era, and it bites Go and Java equally.

A runtime decides its parallelism from "how many CPUs do I have?" — Go sets `GOMAXPROCS` (the number of OS threads that run goroutines simultaneously) from `runtime.NumCPU()`; the JVM sizes the common ForkJoinPool and GC threads from `availableProcessors()`. The trap: in a container, *the number of cores the kernel reports is the host's*, but the number of cores you're *allowed to use* is the cgroup CPU quota — and they're set in two completely different places.

A Kubernetes pod with `resources.limits.cpu: "1"` is enforced as a **CFS quota**: `cpu.cfs_quota_us = 100000`, `cpu.cfs_period_us = 100000` — i.e. 100 ms of CPU per 100 ms period, one core's worth. But `runtime.NumCPU()` on a 64-core node returns **64**. So Go spins up 64 goroutine-running threads competing for one core's worth of quota.

The damage is twofold and nonobvious:

1. **CFS throttling.** When those 64 threads burn the 100 ms quota in the first ~1.5 ms of the period, the kernel **freezes the entire cgroup for the remaining 98.5 ms**. Your p99 latency develops cliffs that correlate with nothing in your code. `cat /sys/fs/cgroup/cpu.stat` shows `nr_throttled` and `throttled_usec` climbing.
2. **Wasted parallelism and contention.** More runnable threads than allowed cores means more context switches, more scheduler churn, worse cache locality, and (for Go) more GC-assist contention — you pay coordination cost (the USL's β) for parallelism you can't actually use.

The fixes, in order of preference:

```go
// Go: make the runtime read the cgroup quota, not the host core count.
// Go 1.25+ is cgroph-aware by default. For older versions:
import _ "go.uber.org/automaxprocs"   // sets GOMAXPROCS from the cgroup CPU quota at init
// or explicitly, when limit is integral:
runtime.GOMAXPROCS(2)
```

```yaml
# Kubernetes: prefer integral CPU limits so the quota maps to whole cores,
# and set the runtime to match.
resources:
  requests: { cpu: "2" }
  limits:   { cpu: "2" }     # GOMAXPROCS=2 / ForkJoinPool parallelism=2
```

For the JVM, run a container-aware JVM (`-XX:+UseContainerSupport`, default since JDK 10) and set `-XX:ActiveProcessorCount=N` or the explicit ForkJoinPool parallelism when you use fractional limits.

> **The professional reality:** `GOMAXPROCS = host cores` inside a quota-limited container is not "using all the power available" — it's *manufacturing* contention and CFS throttling that no amount of CPU profiling explains, because the stalls happen *outside* your process, in the kernel scheduler. Set parallelism from the *quota*, prefer integral CPU limits, and watch `nr_throttled`. This one config line has recovered double-digit-percentage throughput on real fleets.

---

## The Connection Pool Is the Real Bottleneck

You can size your thread/goroutine pool perfectly and still be bottlenecked somewhere you didn't tune: the **connection pool to a downstream**. In most request/response services the binding concurrency constraint is not CPU and not the worker pool — it's how many simultaneous database (or cache, or upstream-HTTP) operations you're allowed to have in flight.

The mechanism is Little's Law again, on the *downstream*. If your database can usefully serve 30 concurrent queries (more just thrash its own locks, buffer pool, and CPU), then a pool of `maxOpenConns = 30` is the real concurrency ceiling of your service *regardless of how many goroutines or threads you run*. Goroutines past 30 just block waiting to check out a connection.

This is why the classic incident is "we added more app replicas and the database fell over." Each replica brings its own pool. Ten replicas × `maxOpenConns: 100` = a thousand connections fighting over a database tuned for a few hundred — the app scaled, the *shared resource* contended, and throughput went *down* (the USL's β term, made of memory).

Concrete sizing:

```go
// Go database/sql — size to what the DB can use, not to your request rate.
db.SetMaxOpenConns(25)              // hard concurrency ceiling on the DB
db.SetMaxIdleConns(25)             // keep them warm; avoid churn under bursty load
db.SetConnMaxLifetime(5*time.Minute) // recycle to survive failovers / DNS changes
```

```properties
# Java HikariCP — the famous formula is small, not large:
# connections ≈ ((core_count × 2) + effective_spindle_count), per the HikariCP wiki.
maximumPoolSize=20
connectionTimeout=2000   # FAIL FAST when the pool is exhausted — don't queue forever
```

Two professional disciplines around this:

- **Set a short `connectionTimeout`/checkout timeout.** When the pool is exhausted, the right behavior is to *fail fast* (and shed or 503), not to let requests pile up waiting for a connection — that's how a database slowdown turns into an app-tier thread/goroutine exhaustion and a full outage.
- **Account for total connections across the fleet**, not per-instance. The database has a global `max_connections`; your aggregate `replicas × maxOpenConns` plus admin/replication overhead must fit under it, or use a connection multiplexer (PgBouncer in transaction mode) to fan many client connections into few server ones.

> **The professional reality:** the connection pool is the throughput governor hiding in plain sight. Teams tune CPU, GC, and goroutine counts for days while the actual ceiling is a `maxOpenConns` set to a copied default. Find your downstream's *useful* concurrency (load-test it directly), size the pool to that, fail fast on exhaustion, and sum it across the fleet against `max_connections`.

---

## Concurrency Limiting and Backpressure as Throughput Protection

A system without a concurrency limit has no defense against overload, and overload is the regime where contention is worst. The professional posture is: **bound everything, and prefer rejecting work to queuing it.**

The mechanisms, from simplest to most adaptive:

- **Bounded queues.** Every queue between stages should have a *finite* capacity. An unbounded queue doesn't absorb a spike — it converts a throughput problem into an unbounded-latency and eventual-OOM problem. A bounded queue *propagates backpressure*: when it's full, the producer blocks (or the request is rejected), which is the signal that you're past capacity. In Go, a buffered channel *is* a bounded queue; in Java, `ArrayBlockingQueue` with a `ThreadPoolExecutor` and an explicit `RejectedExecutionHandler`.

- **Semaphores / fixed concurrency limits.** Cap the number of in-flight operations against any contended resource. `golang.org/x/sync/semaphore` or `errgroup.SetLimit(n)`; Java's `Semaphore`. This is the cheapest, most predictable backpressure — a hard ceiling.

- **Load shedding.** When you're over the limit, *reject early* with a 429/503 rather than accepting work you can't finish within SLO. A request that times out after you spent 5 seconds on it is worse than a fast rejection — you paid the cost and delivered nothing, while holding a connection and a worker the whole time. Shed at the edge, cheaply, before the expensive work.

- **Adaptive concurrency limits.** Static limits are conservative (you set them for the worst case). The state of the art, popularized by Netflix's [concurrency-limits](https://github.com/Netflix/concurrency-limits) library, treats your service like a TCP congestion-control loop: it watches measured latency (or queue time) and **adjusts the concurrency limit up while latency is flat and down the moment latency rises** — a TCP-Vegas-style gradient algorithm. The limit auto-discovers the system's actual capacity in real time, no magic number to tune, and it tracks capacity as it changes (a slow downstream, a noisy neighbor, a GC pause).

> **The professional reality:** the goal of a concurrency limit is **constant throughput under overload**, not maximum throughput at the edge of collapse. An unprotected system follows the USL right off the cliff — push past the peak and throughput *retrogrades*, often catastrophically (queues fill, timeouts cascade, retries amplify, and you get a metastable failure that doesn't recover even after load drops). A limiter holds you at the plateau and sheds the rest. Bounded queues + a concurrency limit + fast load shedding is the difference between a brownout and an outage.

---

## The Scaling Test Discipline

You cannot reason your way to a scaling number; you measure it, and you measure it *across a range*, because the whole point of the USL is that the curve bends. The discipline:

1. **Measure throughput (not just latency) at a geometric ladder of concurrency** — 1, 2, 4, 8, 16, 32, 64 — holding everything else fixed. Drive *closed-loop* load (a fixed number of concurrent clients) so you're measuring the system's response to a known concurrency, not an open firehose that just queues.

2. **Plot throughput vs concurrency and look for three regions:** linear rise (you're under-loaded), a plateau (the serial fraction α is binding — Amdahl), and **retrograde** (throughput *falls* as you add concurrency — the coherency cost β is now dominant, the USL's signature). The peak of that curve is your real capacity; the retrograde point is the cliff you must stay left of.

3. **Fit the Universal Scalability Law** to the measured points to *extract α and β*:

```
            N
X(N) = ─────────────────────       N = concurrency, X = throughput
       1 + α(N−1) + βN(N−1)
```

   A nonlinear fit (USL fitting is built into tools like `usl4j`, or a few lines of `scipy.optimize.curve_fit`) gives you α (serialization) and β (crosstalk). From those you get **N_max = sqrt((1−α)/β)** — the concurrency at peak throughput. If your fitted β is nonzero, the curve *will* turn over; the model tells you where.

4. **Do not extrapolate past where you measured.** A linear fit to the 1–8 region predicts the 32-core number will be 4× the 8-core number; the USL (and reality) says it might be *lower*. The classic capacity-planning disaster is "we tested to 8 cores, it scaled linearly, we provisioned 32-core boxes" — and the 32-core boxes were *slower* because the test never reached the retrograde region. Measure to and past the peak, or you're guessing.

> **The professional discipline:** a scaling test that reports one number ("we did 40k req/s") is nearly useless; a scaling test reports a *curve* and the *fitted α and β*. Those two coefficients tell you the two distinct things you can fix: a high α means find and shorten the serial section (a lock, a single writer); a high β means find and eliminate the coordination (false sharing, cache-line bouncing, a shared counter). You can't fix what you didn't separate.

---

## Architecture Choices That Dodge Contention

The cheapest contention is the contention you never created. The senior page taught you to make a critical section smaller; the professional move is to *restructure so the critical section is per-shard or gone entirely*. The recurring idea: **contention is shared mutable state; remove the sharing or remove the mutation.**

- **Sharding / partitioning by key.** Replace one lock (or one hot row, or one counter) with N independent ones keyed by a partition of the data. A single global counter is a coherency hotspot; **striped counters** (Java's `LongAdder`, Go's per-shard `[N]struct{ count int64; _ [pad]byte }`) split it into per-CPU cells summed on read — converting a write-contended point into N uncontended ones. The same logic scales up to sharded caches, partitioned queues, and sharded databases.

- **Shared-nothing.** Give each worker its *own* data so there is nothing to coordinate over. Per-core or per-goroutine state, merged only at boundaries, drives α and β toward zero — this is why shared-nothing architectures scale near-linearly where shared-everything ones retrograde.

- **Single-writer principle / LMAX Disruptor.** Counterintuitively, having **exactly one thread own and mutate a piece of state** is often faster than many threads sharing it with locks, because it eliminates *all* contention and cache-line bouncing on that state. The [LMAX Disruptor](https://lmax-exchange.github.io/disruptor/) is the canonical example: a single writer, a lock-free ring buffer, mechanical-sympathy padding to avoid false sharing — millions of events/sec on one thread because nothing contends. Funnel mutations to one owner; let everyone else send it messages.

- **Actor model.** Each actor owns its state and processes messages serially from its own mailbox — single-writer, replicated millions of times. There's no shared lock because there's no shared state; concurrency comes from running many actors, not from many threads touching one thing. (Erlang/Akka; in Go the idiom is a goroutine that owns state and serves a channel.)

- **Queue-per-core.** Bind work to cores and give each its own queue (and its own connection, its own buffer), so there's no cross-core cache traffic on the hot path. This is the high-end networking pattern (RSS, `SO_REUSEPORT` with per-core acceptors, DPDK) and the logical extreme of shared-nothing.

> **The decision:** when a scaling test shows a high α (serialization), the architectural fix is usually **sharding** or the **single-writer** principle — turn one contended thing into many uncontended ones, or into one uncontended owner. When it shows a high β (crosstalk/coherency), the fix is usually **shared-nothing** or **padding** — stop different cores from touching the same cache lines. You rarely lock your way out of a β problem; you architect your way out.

---

## Diagnosing Production Contention Incidents

A structured triage beats staring at CPU graphs. Classify *what kind* of contention you're seeing — serialization (a lock), coherency (cache-line bouncing/false sharing), a hot shard, or runtime throttling — then run the matching tool.

**The triage tree:**

```
Symptom                                          →  Likely cause / Tool
──────────────────────────────────────────────────────────────────────────
throughput flat or falling as you add cores       →  SERIALIZATION (α)   → profile lock wait
high CPU but low useful work; lots of sys time     →  context switching   → pidstat -w, perf sched
p99 cliffs uncorrelated with code; bursty stalls   →  CFS throttling      → cat cpu.stat (nr_throttled)
one partition/replica hot, rest idle               →  HOT SHARD           → per-key metrics, key heatmap
hot struct, multi-core, no obvious lock            →  FALSE SHARING       → perf c2c (cache-to-cache)
requests blocked, low CPU, downstream fine         →  POOL EXHAUSTION     → pool in-use/wait metrics
```

**Go diagnostics:**

```bash
# Lock contention: who's waiting on mutexes, and for how long.
import "runtime"; runtime.SetMutexProfileFraction(5)   // then:
go tool pprof http://svc/debug/pprof/mutex
# Goroutines piling up / blocked (pool exhaustion, channel backpressure):
go tool pprof http://svc/debug/pprof/block
curl http://svc/debug/pprof/goroutine?debug=2   # full stacks: where are they parked?
# Execution tracer: scheduler latency, GC pauses, GOMAXPROCS utilization:
go tool trace trace.out
```

**Java diagnostics:**

```bash
jstack <pid>                      # thread dump: BLOCKED threads + the lock they wait on
# async-profiler in lock mode: where contention actually is, as a flame graph
./profiler.sh -e lock -d 30 <pid>
# JFR: jdk.JavaMonitorEnter / jdk.ThreadPark events = contention + parking
jcmd <pid> JFR.start duration=60s filename=rec.jfr
```

**OS-level (both):**

```bash
cat /sys/fs/cgroup/cpu.stat        # nr_throttled, throttled_usec → CFS throttling
pidstat -w 1                       # cswch/s (voluntary) + nvcswch/s (involuntary): churn
perf c2c record -a -- sleep 10     # false sharing: HITM events on shared cache lines
perf c2c report                    # the smoking gun: two cores writing the same line
```

> **The professional discipline:** the four contention failure modes have *different fixes*, so naming the mode is most of the work. Serialization → shrink/shard the critical section. Coherency/false sharing → pad the struct, give each core its own line. Hot shard → rebalance or re-key. CFS throttling → fix `GOMAXPROCS`/CPU limits. Reaching for "add more replicas" without naming the mode often makes a β or hot-shard problem *worse* (more replicas = more contention on the shared thing).

---

## War Stories

**The mutex that capped throughput at 4 cores.** A Go ingestion service did 40k events/s on a 4-core box. Moved to 16-core boxes for the holiday spike — and it did *37k*. Throughput went *down* with 4× the hardware. The mutex profile (`/debug/pprof/mutex`) pointed at a single `sync.Mutex` guarding an in-memory dedup map touched on every event. Below 4 cores the lock was barely contended; above it, the cores spent more time bouncing the lock's cache line and parking than doing work — textbook USL retrograde, β dominating. The fix wasn't a faster lock; it was **sharding** the map into 256 stripes keyed by hash, turning one contended lock into 256 rarely-contended ones. Throughput then scaled to ~140k on 16 cores. The lesson: when adding cores *reduces* throughput, you have a coherency problem, and you shard or partition out of it — you don't tune the lock.

**`GOMAXPROCS = node cores` in a 1-CPU container.** A Go API ran with `resources.limits.cpu: "1"` on 64-core Kubernetes nodes. p99 latency had unexplained ~90 ms cliffs several times a second that no application profile accounted for. `cat /sys/fs/cgroup/cpu.stat` showed `nr_throttled` climbing fast: `GOMAXPROCS` had defaulted to 64 (the host count), so 64 threads burned the entire 100 ms CFS quota in the first ~1.5 ms of every period and the kernel froze the cgroup for the rest. Adding `go.uber.org/automaxprocs` (which set `GOMAXPROCS=1` from the quota) erased the cliffs, dropped p99 by ~70%, and *cut* CPU usage — fewer threads thrashing meant more real work per quota. One import line.

**The hot partition.** A sharded write pipeline distributed work across 32 partitions by `customer_id`. Aggregate metrics looked healthy, but tail latency was awful and one consumer was always at 100% CPU while others idled. Per-partition metrics revealed one enterprise customer generated ~60% of all events, so their single partition was a bottleneck no amount of total capacity could relieve — a **hot shard**. Sharding by `customer_id` alone gave no relief because the *key distribution* was skewed. Fix: composite key (`customer_id + bucket`) to split the whale across partitions, plus per-key rate limiting. The lesson: sharding only helps if the *key distribution* is even; a skewed key just relocates the contention into one shard.

**The unbounded queue that turned a slowdown into an outage.** A worker pool fed from an *unbounded* queue absorbed a downstream slowdown by... queuing. The queue grew to millions of items, latency climbed to minutes (work was finally getting processed long after the client gave up), memory ballooned, and the process OOM-killed — taking the in-flight work with it. A *bounded* queue plus load shedding would have rejected the excess fast, kept latency bounded, and survived. The lesson: an unbounded queue isn't resilience; it's a deferred OOM with terrible latency in between.

---

## Decision Frameworks

**How big should the pool be? Ask:**
- Is the work CPU-bound? → ≈ number of (allowed) cores; more just adds context switches.
- Is it I/O-bound? → cores × (1 + wait/service), **capped by the downstream's useful concurrency**.
- Is it a connection pool? → size to the downstream's useful concurrency, sum across the fleet under `max_connections`, fail fast on exhaustion.

**What's my parallelism inside a container? Ask:**
- Am I quota-limited (Kubernetes `limits.cpu`)? → set `GOMAXPROCS`/ForkJoinPool parallelism from the *quota*, not host cores (`automaxprocs`, integral CPU limits). Watch `nr_throttled`.

**Static or adaptive concurrency limit? Ask:**
- Is capacity stable and known? → a static semaphore/bounded queue is simplest and predictable.
- Does capacity vary (shared downstreams, noisy neighbors, GC)? → adaptive (Netflix concurrency-limits, gradient/TCP-Vegas-style) auto-discovers it.
- Either way: **shed load fast when over the limit** — reject beats timeout.

**How do I scale past the cliff? Ask (after fitting the USL):**
- High α (serialization)? → shrink the critical section, or **shard / single-writer** to remove it.
- High β (coherency/crosstalk)? → **shared-nothing**, pad against false sharing, striped counters.
- Skewed hot shard? → re-key for even distribution; total capacity won't fix a skewed key.

---

## Mental Models

- **Adding cores past the USL peak makes things *worse*, not flat.** The curve retrogrades. If throughput fell when you added hardware, you have a coherency (β) problem — shard or pad it; don't buy bigger boxes.

- **The connection pool is the real concurrency ceiling.** Goroutines and threads are cheap; the contended downstream is not. Size to the downstream's useful concurrency, not to your request rate, and sum it across the fleet.

- **`GOMAXPROCS = host cores` in a quota'd container manufactures throttling.** The cores you *see* aren't the cores you're *allowed*. Set parallelism from the cgroup quota; the stalls you can't explain in your profile are in the kernel scheduler.

- **An unbounded queue is a deferred OOM with bad latency in between.** Bound every queue; backpressure is the queue telling you you're over capacity. Rejecting fast beats accepting work you can't finish.

- **The cheapest lock is the one you deleted.** Single-writer, sharding, and shared-nothing remove contention instead of optimizing it. You architect out of a β problem; you rarely lock out of one.

- **Skewed keys defeat sharding.** Partitioning helps only if the key distribution is even. One whale customer turns a 32-shard system into a 1-shard system.

---

## Common Mistakes

1. **Sizing pools by request rate instead of by the bottleneck.** A bigger pool past the bottleneck just deepens the queue and inflates tail latency. Size to cores (CPU work) or downstream capacity (I/O work), then protect with a limit.

2. **Leaving `GOMAXPROCS`/ForkJoinPool parallelism at the host core count inside a CPU-limited container.** Causes CFS throttling and contention you can't see in an app profile. Set from the quota; prefer integral CPU limits; watch `nr_throttled`.

3. **Treating the connection pool as an afterthought.** It's usually the real concurrency ceiling. Find the downstream's useful concurrency, size to it, fail fast on exhaustion, and sum across the fleet against `max_connections`.

4. **Unbounded queues "to handle bursts."** They convert a throughput problem into an OOM-and-unbounded-latency problem. Bound every queue and shed load when full.

5. **Queuing under overload instead of shedding.** A request that times out after you did the work is strictly worse than a fast 429. Reject early, before the expensive part.

6. **Extrapolating a scaling test from the linear region.** "It scaled to 8 cores, so 32 will be 4×" is how you provision boxes that are *slower*. Measure to and past the USL peak; fit α and β.

7. **Sharding on a skewed key.** A heavily skewed key relocates all the contention into one hot shard. Check the key distribution; re-key (composite/bucketed) for evenness.

8. **Reaching for "more replicas" without naming the contention mode.** Adding replicas to a β or hot-shard problem increases contention on the shared resource. Diagnose the mode first.

---

## Test Yourself

1. Your Go service did 40k req/s on 4 cores and 37k on 16. Name the phenomenon in USL terms, explain *why* more cores reduced throughput, and give the architectural fix.
2. A pod has `limits.cpu: "1"` on a 64-core node and shows unexplained p99 latency cliffs. What's happening at the kernel level, how do you confirm it, and what's the one-line fix?
3. You've perfectly sized your goroutine pool but throughput is still capped and goroutines are blocked. Where do you look next, and why is that often the real ceiling?
4. Contrast bounded queues + load shedding with an unbounded queue under sustained overload. Why is "reject fast" better than "queue and eventually process"?
5. Describe the scaling-test ladder and what the throughput-vs-concurrency curve's three regions mean. Why is extrapolating from the first region dangerous?
6. A 32-shard pipeline has healthy aggregate metrics but one consumer pegged at 100% while others idle. Diagnose it and explain why simply adding capacity won't help.
7. You suspect false sharing in a hot struct touched by many cores, but there's no explicit lock. What tool confirms it, and what's the fix?

<details>
<summary>Answers</summary>

1. **USL retrograde** — the curve turned over because the **coherency cost (β)** became dominant. A single shared mutex (or counter/map) guarded the hot path; below ~4 cores it was barely contended, but more cores meant more cache-line bouncing and lock parking, so coordination cost exceeded the added compute. **Fix:** remove the sharing — **shard** the contended state (e.g., 256 striped locks/maps keyed by hash) or apply the **single-writer** principle, turning one contended thing into many uncontended ones.
2. `GOMAXPROCS`/`availableProcessors()` read the **host's 64 cores**, but the cgroup CFS quota allows one core's worth (`cfs_quota_us=100000`/`period=100000`). The 64 threads burn the 100 ms quota in ~1.5 ms, so the **kernel throttles the whole cgroup** for the rest of each period → periodic ~90 ms stalls. Confirm with `cat /sys/fs/cgroup/cpu.stat` (`nr_throttled`, `throttled_usec` climbing). **Fix:** set parallelism from the quota — import `go.uber.org/automaxprocs` (or `runtime.GOMAXPROCS(1)`), and/or use integral CPU limits.
3. The **connection pool** to a downstream (DB/cache/upstream). By Little's Law the downstream's *useful* concurrency is the real ceiling; goroutines past `maxOpenConns` just block on checkout. It's often the real ceiling because teams tune CPU/GC/worker counts while the pool sits at a copied default. Size to the downstream's useful concurrency, fail fast on exhaustion, and sum across the fleet under `max_connections`.
4. A **bounded queue + load shedding** keeps latency bounded and memory flat: when full, excess is rejected fast (429/503), propagating backpressure. An **unbounded queue** absorbs overload by growing — latency climbs without bound (work completes long after clients gave up), memory balloons, and the process eventually OOMs, losing in-flight work. "Reject fast" wins because a timed-out request after full processing cost delivered nothing while holding resources; a fast rejection costs almost nothing and keeps the system at its throughput plateau instead of off the cliff.
5. Drive **closed-loop** load at concurrency 1, 2, 4, 8, 16, 32, 64 and plot **throughput vs concurrency**: a **linear** region (under-loaded), a **plateau** (serial fraction α binding — Amdahl), and a **retrograde** region (throughput *falls* — coherency β dominant). Extrapolating from the linear region predicts linear scaling that the USL says won't happen; you'd provision big boxes that are actually *slower* because you never tested into the plateau/retrograde.
6. A **hot shard** caused by a **skewed key** — one partition gets the majority of work (e.g., a whale customer), so it's a single-consumer bottleneck. Adding total capacity doesn't help because the load isn't spread across shards; it's concentrated in one. **Fix:** re-key for even distribution (composite/bucketed key like `customer_id + bucket`) and/or per-key rate limiting.
7. **`perf c2c record`/`report`** — it surfaces HITM (cache-to-cache) events showing two cores writing the same cache line. **Fix:** pad the struct so each contended field sits on its own cache line (e.g., add `_ [64]byte` padding between hot fields, or use a striped/per-core layout like `LongAdder`).

</details>

---

## Cheat Sheet

```
POOL SIZING
  CPU-bound  : ≈ allowed cores (+1)            more = context-switch waste
  I/O-bound  : cores × (1 + wait/service)      capped by downstream capacity
  conn pool  : downstream useful concurrency   sum across fleet < max_connections
  RULE: size to the bottleneck, then PROTECT with a limit — don't enlarge

GOMAXPROCS / cgroups
  trap: NumCPU()=host cores, but quota=cfs_quota_us/cfs_period_us
  Go   : go.uber.org/automaxprocs   (Go 1.25+ cgroup-aware by default)
  K8s  : prefer integral limits.cpu so quota = whole cores
  check: cat /sys/fs/cgroup/cpu.stat → nr_throttled, throttled_usec

CONCURRENCY LIMITING (protect throughput under overload)
  bounded queue   : finite capacity → backpressure (buffered chan / ArrayBlockingQueue)
  semaphore       : hard in-flight cap (errgroup.SetLimit / Semaphore)
  load shed       : reject early (429/503) > timeout after doing the work
  adaptive        : Netflix concurrency-limits, TCP-Vegas-style gradient

SCALING TEST
  ladder: 1,2,4,8,16,32,64 concurrency, closed-loop, measure THROUGHPUT
  USL: X(N)=N / (1 + α(N−1) + βN(N−1));  N_max = sqrt((1−α)/β)
  high α → serialization (shard/single-writer);  high β → coherency (shared-nothing/pad)
  NEVER extrapolate from the linear region

DODGE CONTENTION (architecture)
  sharding/striping (LongAdder)   single-writer (LMAX Disruptor)
  shared-nothing                  actor model        queue-per-core

DIAGNOSE
  Go : pprof/mutex, pprof/block, pprof/goroutine?debug=2, go tool trace
  Java: jstack, async-profiler -e lock, JFR JavaMonitorEnter
  OS : cpu.stat (throttle), pidstat -w (cswch), perf c2c (false sharing)
```

---

## Summary

- **Size pools to the bottleneck, not the request rate**: ≈ cores for CPU work, cores × (1 + wait/service) for I/O work, and *cap by the downstream's useful concurrency*. An oversized pool deepens the queue, it doesn't add throughput.
- **`GOMAXPROCS`/ForkJoinPool parallelism must come from the cgroup quota, not the host core count** — otherwise you manufacture CFS throttling and contention that no app profile explains. Use `automaxprocs`, prefer integral CPU limits, watch `nr_throttled`.
- **The connection pool is usually the real concurrency ceiling.** Size it to the downstream's useful concurrency, fail fast on exhaustion, and sum it across the fleet against `max_connections`.
- **Protect throughput under overload with bounded queues, semaphores, and fast load shedding** — and prefer **adaptive limits** (Netflix concurrency-limits, TCP-Vegas-style) where capacity varies. Rejecting early beats queuing into a metastable collapse.
- **Run a real scaling test**: measure throughput across a 1→64 concurrency ladder, **fit the USL**, find where it retrogrades, and *never extrapolate from the linear region*. α tells you to fix serialization; β tells you to fix coherency.
- **Architect contention away**: sharding/striping, shared-nothing, single-writer (LMAX Disruptor), actors, queue-per-core. You shard or pad your way out of a β problem; you rarely lock your way out.
- **Diagnose by naming the mode** — serialization, coherency/false sharing, hot shard, or CFS throttling — because each has a different fix, and "add replicas" often makes the wrong one worse.

You can now treat concurrency as a production and architecture decision — sized, limited, tested, and structured so that load and hardware add throughput instead of contention. The remaining tier — [interview.md](interview.md) — consolidates the topic into the questions that probe whether someone actually understands it.

---

## Further Reading

- [Neil Gunther, *Guerrilla Capacity Planning*](http://www.perfdynamics.com/) — the Universal Scalability Law, fitting α and β, and capacity planning from measured curves.
- [Netflix concurrency-limits](https://github.com/Netflix/concurrency-limits) — adaptive, TCP-congestion-style concurrency limiting and the gradient algorithm, with the design rationale.
- [LMAX Disruptor technical paper](https://lmax-exchange.github.io/disruptor/disruptor.html) — single-writer, mechanical sympathy, false-sharing padding, and why one thread can beat many.
- [`automaxprocs`](https://github.com/uber-go/automaxprocs) and the Go runtime cgroup-awareness notes — the `GOMAXPROCS`/CFS-quota fix made concrete.
- [HikariCP pool-sizing guide](https://github.com/brettwooldridge/HikariCP/wiki/About-Pool-Sizing) — why the right connection pool is small, with the formula and the queueing-theory reasoning.
- Marc Brooker / AWS Builders' Library on **load shedding and metastable failures** — why systems collapse past the USL peak and don't recover.

---

## Related Topics

- [junior.md](junior.md) — the basics: threads vs processes, race conditions, what a lock does.
- [senior.md](senior.md) — Amdahl, the USL mechanics, locks vs lock-free, false sharing, memory ordering.
- [interview.md](interview.md) — the questions that probe real understanding of contention and scaling.
- [03 — Latency and Throughput](../03-latency-and-throughput/professional.md) — Little's Law, closed- vs open-loop load, and the throughput/latency curves a scaling test produces.
- [07 — Performance Budgets and Regression Testing](../07-performance-budgets-and-regression-testing/professional.md) — turning the scaling test and its α/β into a budget and a CI gate so contention regressions are caught before production.
