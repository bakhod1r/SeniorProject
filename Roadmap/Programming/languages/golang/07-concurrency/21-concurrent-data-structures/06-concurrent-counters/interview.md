---
layout: default
title: Interview
parent: Concurrent Counters
grand_parent: Concurrent Data Structures
ancestor: Go
nav_order: 7
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/21-concurrent-data-structures/06-concurrent-counters/interview/
---

# Concurrent Counters — Interview Questions

A graded set of interview questions from junior to staff/principal level. Each question includes a brief sketch of the expected answer.

## Junior Level

**Q1.** Why does `count++` give wrong results when called from many goroutines?

A: `count++` is three operations: read, add, write. Without synchronization, two goroutines can read the same value, both add one, and both write the same result — losing one increment. Use `atomic.Int64.Add(1)` or wrap in a `sync.Mutex`.

**Q2.** What is the difference between `sync.Mutex` and `sync/atomic` for a counter?

A: Mutex is general-purpose and slower (involves at least one atomic plus locking machinery, may park goroutines under contention). Atomic is a single CPU instruction for a single 64-bit value — much faster. For one-value counters, atomic is preferred.

**Q3.** What is a "lost update" race?

A: Two goroutines read the same old value, both compute new = old + 1, both write the new value. The result is old + 1, not old + 2. One update is "lost".

**Q4.** What does `go run -race main.go` do?

A: Compiles and runs the program with the race detector enabled. The detector instruments memory accesses and reports any data race observed during the run.

**Q5.** What is the difference between a counter and a gauge?

A: A counter only increases (e.g., total requests). A gauge can increase or decrease (e.g., in-flight requests). Use `atomic.Int64.Add(1)` for both, but only call `Add(-1)` on gauges.

**Q6.** When should you use `defer counter.Add(-1)`?

A: For gauges, immediately after `counter.Add(1)`, to ensure the decrement happens even if the function panics.

**Q7.** Why use `atomic.Int64` over `int64` even with no concurrent writers?

A: If any goroutine writes the variable, every reader must use atomic loads — otherwise the read may see stale or torn values. The race detector enforces this.

**Q8.** What is the result of `Counter.Swap(0)`?

A: Atomically sets the counter to 0 and returns the previous value. Used for "report and reset" patterns. Safer than `Load() + Store(0)` because it cannot lose intermediate increments.

**Q9.** Can you copy a struct containing `atomic.Int64`?

A: No. `go vet` warns. The copy creates an independent atomic at the same value; subsequent operations on either don't affect the other, which is almost always a bug.

**Q10.** What does `atomic.Int64.Add(1)` return?

A: The new value after the increment. Useful to avoid a separate `Load()` afterwards.

## Middle Level

**Q11.** Write a CAS loop that tracks the maximum value ever observed.

A:
```go
func (m *AtomicMax) Observe(x int64) {
    for {
        cur := m.v.Load()
        if x <= cur { return }
        if m.v.CompareAndSwap(cur, x) { return }
    }
}
```

**Q12.** What is the ABA problem in a CAS loop?

A: A value goes from A to B and back to A between your read and your CAS. The CAS succeeds (current is still A), but the value has changed twice. For counters this is usually fine; for pointer-based structures it can cause logical errors.

**Q13.** What is `atomic.Pointer[T]` good for?

A: Atomically replacing a pointer to a struct. Useful for snapshotting multi-field state: writers build an immutable struct, atomically swap the pointer; readers do one atomic load to see a consistent view.

**Q14.** Explain `expvar.Func`.

A: A type alias for `func() any`. When registered with `expvar.Publish`, it is called at scrape time (when `/debug/vars` is requested) and the return value is serialized as JSON. Useful for derived metrics computed on demand.

**Q15.** Write a counter that allows increment only if the result stays below N.

A:
```go
func (c *Capped) Inc() bool {
    for {
        cur := c.v.Load()
        if cur >= c.max { return false }
        if c.v.CompareAndSwap(cur, cur+1) { return true }
    }
}
```

**Q16.** What is a sharded counter and when do you need one?

A: A counter implemented as N independent atomic counters; each goroutine writes to one of them (chosen by hash); reads sum all shards. Needed when a single atomic becomes the bottleneck due to cache-line contention at high concurrency.

**Q17.** Why is a `map[string]*atomic.Int64` not safe for concurrent writes?

A: The map itself is not concurrency-safe — concurrent writes to the map (adding new keys) can crash. The atomic values are safe; the map mutations are not. Use `sync.Map` or wrap with a mutex.

**Q18.** What does `runtime.GOMAXPROCS(0)` return?

A: The current value of GOMAXPROCS (the maximum number of OS threads executing Go code). Passing 0 means "do not change; just return".

**Q19.** Why is `histogram_quantile(0.99, sum(rate(bucket[5m])) by (le))` the correct PromQL for fleet p99?

A: Bucket counts are additive across processes. Sum the bucket counts, then compute the quantile from the summed counts. Averaging per-process p99s gives a meaningless number.

**Q20.** How do you handle counter reset on process restart?

A: Use `rate()` in your query layer. Prometheus's `rate()` detects counter resets (decrease in monotonic value) and handles them correctly. Don't try to persist counters across restarts unless for billing-grade requirements.

## Senior Level

**Q21.** What is false sharing and how do you detect it?

A: Two atomic variables happen to share a cache line. Writes from different cores invalidate each other's caches, causing the line to bounce between cores even though the values are logically independent. Detect with `perf c2c` on Linux, or by benchmarking with and without padding.

**Q22.** How do you cache-line-pad an atomic in Go?

A: Use `golang.org/x/sys/cpu.CacheLinePad` before and/or after the atomic field, or insert a `[56]byte` (assuming 64-byte cache line; 120 bytes on Apple Silicon). The first is portable.

**Q23.** What is `runtime_procPin` and how does it help with counters?

A: A runtime-private function (accessed via `go:linkname`) that pins the calling goroutine to its current P and returns the P index. Lets you implement per-P sharded counters where each P writes to its own cell with no cross-core contention. Used internally by `sync.Pool`.

**Q24.** What is a sloppy counter?

A: A counter where each goroutine maintains a local accumulator, periodically flushing to a global atomic when the local count exceeds a threshold. Trades exact freshness for vastly higher throughput. From the Tornado OS / Linux kernel.

**Q25.** What is Java's `LongAdder` and what is the Go equivalent?

A: Java's class that dynamically grows its sharded cell array based on observed contention. Each thread has a per-thread "probe" hash that picks a cell; on contention, the probe is rehashed and cells may grow. No standard library equivalent in Go; community ports exist, or you can use fixed-size padded sharded counters for similar effect with less complexity.

**Q26.** Why is per-P sharding faster than hash-based sharding?

A: Each P (Go runtime processor) runs on at most one OS thread at a time. If goroutines on P3 always write to cell 3, that cell's cache line never bounces between cores — it stays in one core's cache. Hash-based sharding may have multiple goroutines on different cores all writing to cell K via random selection.

**Q27.** What is coordinated omission and how does HDR address it?

A: Co-ordinated omission is a measurement bias: when a slow request blocks the measurement loop, subsequent requests' "starting time" is later than it should be, hiding their effective slowness. HDR's `RecordValueWithExpectedInterval` synthesises missing observations to compensate.

**Q28.** Why does a sharded counter's read cost matter less than its write cost?

A: Writes (increments) happen on every event — billions per second potentially. Reads happen at scrape time (every 15s typically). O(shards) read cost at 1 µs is negligible at scrape frequency; O(1) write cost at 5 ns matters at billion-per-second frequency.

**Q29.** When would you use `atomic.Uint64` over `atomic.Int64`?

A: When you need unsigned arithmetic semantics (e.g., hashes, wraparound) or want to store float64 bits via `math.Float64bits`. Otherwise prefer `atomic.Int64` for the `Add(-1)` ergonomics.

**Q30.** What is the difference between `sync.Pool` and a sharded counter?

A: `sync.Pool` is an *object pool* (allocator) using per-P shards for cheap recycling. A sharded counter is a *counter* using per-P shards for write throughput. Both use the same `procPin` pattern; different purposes.

## Staff / Principal Level

**Q31.** Design a metrics subsystem for a Go service handling 1M RPS across 100 instances.

A: Per-instance: padded sharded counters (64 shards) for hot counters, HDR histograms (sharded by GOMAXPROCS) for latency, expvar + Prometheus exposition, runtime/metrics for free runtime stats. Cardinality bounded at the registry. Per-region Prometheus federates and pre-aggregates. Global Prometheus / Thanos for fleet-wide views. SLO-driven alerts with runbooks. Budget: < 1% CPU, < 50 MB RAM per instance.

**Q32.** Explain how `sync.WaitGroup` is implemented in terms of atomic counters.

A: A `WaitGroup` packs two counters (the active count and the waiter count) into one `atomic.Uint64`. `Add` updates the active count; if it goes negative or misuse is detected, panic. `Wait` increments the waiter count and parks on a semaphore. The last `Done` (active = 0) releases all waiters via the semaphore. Single atomic for the dual-counter state allows atomic comparison of (active, waiters) without a separate lock.

**Q33.** How would you implement a NUMA-aware sharded counter?

A: One shard array per NUMA socket. Each OS thread is pinned to a socket (via `taskset` or `runtime.LockOSThread` + `sched_setaffinity`). Each thread's increment goes to its socket's local shards. Reads sum across all sockets at scrape time. Requires platform-specific code (Linux NUMA APIs); typically only needed for multi-socket bare-metal deployments.

**Q34.** Compare HDR histograms to TDigest for percentile estimation.

A: HDR: fixed buckets with known relative error, constant-time record, bounded memory. Good for known value ranges. TDigest: adaptive centroids, smaller memory, better at tails but slower record. Good for unknown ranges or extreme tails. HDR is the default in metrics ecosystems; TDigest is the default in streaming analytics.

**Q35.** How would you design a counter that survives process restarts for exact business counts?

A: Hybrid: in-memory `atomic.Int64` for the hot path, periodic flush to a database via a write-ahead log or direct UPDATE. On restart, read the persisted value and resume accumulating from there. On shutdown, force a flush. Trade-off: up to one flush interval of data may be lost on crash; tune interval based on tolerance.

**Q36.** What is the operational risk of high-cardinality labels?

A: The metric backend stores one time series per label combination. Unbounded cardinality (e.g., per-user-ID labels) explodes memory and storage, can OOM the backend, breaks query performance, and increases cost. Bound cardinality at the metric layer; for high-cardinality data, use traces/spans instead.

**Q37.** Walk through how Prometheus's `rate()` handles counter resets.

A: `rate(counter[5m])` looks at samples in the window. If it detects a *decrease* in the cumulative value (e.g., 100 → 0), it treats this as a counter reset and computes the rate assuming the missing value at restart was 0. Subsequent samples are added to the rate. This makes monotonic counters resilient to process restarts.

**Q38.** Design an alerting strategy for an SLO of "99.9% of requests succeed".

A: Burn-rate alerts at multiple windows: e.g., page if 1-hour burn exceeds 14× normal (would burn 30 days of budget in a few hours), and warn if 6-hour burn exceeds 6×. Two counters (`requests_total`, `errors_total`) drive both alerts. Documented in a runbook with remediation playbooks per common cause.

**Q39.** When would you choose OpenTelemetry over Prometheus client_golang?

A: When you need exemplars (correlation with traces), when you have non-Go services in the same observability stack, or when you want a vendor-neutral output format (OTLP). Prometheus client_golang is more battle-tested for pull-based Prometheus deployments; OpenTelemetry is more future-flexible.

**Q40.** What is the cost-benefit of multi-format exposition (expvar + Prometheus + OTLP)?

A: Cost: minor code complexity, slightly more allocation at scrape time. Benefit: support multiple consumer ecosystems without forcing a single choice on operators. Each exposition reads the same underlying atomic; the cost is in the encoding, not the recording. For most services, supporting two formats (expvar + Prometheus) is sufficient and cheap.

## Design / Architecture Level

**Q41.** Walk through the architecture of an observability subsystem for a multi-region service.

A: Per-instance: padded sharded counters + HDR histograms, exposed via Prometheus and OTLP. Per-region: Prometheus replicas scrape all local instances, federate aggregated metrics to global. Global: Thanos or Cortex stores 30+ days, queries via Grafana, alerts via Alertmanager. Cost: ~$0.02 per active time series per month at scale. Operational: per-team dashboards, SLO budgets, runbooks for every alert.

**Q42.** A new counter is added in code review. What checks do you perform?

A: Correct atomic primitive, monotonicity documented, cardinality bounded, label values PII-checked, naming convention followed, help string set, exposition format chosen, tests written (with `-race`), benchmark at multiple `-cpu`, dashboard updated, alert if needed, runbook updated.

**Q43.** A team reports their counters showed normal values but real errors were happening. Diagnose.

A: Likely causes: counter increments in wrong code path (errors went through a path that didn't increment), label value mismatch (errors had a different label and weren't counted in the queried label), or aggregation issue (per-instance counter wasn't summed across instances in the query). Investigate by adding a counter at the verified-error path; compare values.

**Q44.** Your service's CPU profile shows 5% in `runtime.atomic.Add64`. What do you do?

A: Identify which counter (use sample labels or by-callsite analysis). Determine if the contention is real (multiple cores hitting the same atomic) or perceived (just busy code). If real: pad the atomic; if still hot, shard; if still hot, per-P. If perceived: leave alone.

**Q45.** Design a counter library to be shared across 50+ Go services in your organisation.

A: Layered: core primitives (atomic, sharded, per-P, sloppy, HDR), registry with cardinality limits, exposition adapters (expvar/Prom/OTLP), opinionated wrappers (Counter, Gauge, Histogram with project naming conventions). Document everything. Version. Provide migration tooling. Operate it (track adoption, regressions, breaking changes).

**Q46.** Explain trade-offs between exact and approximate counters.

A: Exact: every increment is reflected; reads see the current value. Cost: contention, slower at high concurrency. Approximate (sloppy, sharded with eventual aggregation): vastly faster; freshness lag bounded; some loss on crash. Choose based on use case — billing wants exact, metrics want approximate.

**Q47.** When is `sync.Map` the wrong choice for per-key counters?

A: When the key set is small and known at startup (use a plain `map[string]*atomic.Int64` built once). When you need bounded cardinality (sync.Map grows unbounded). When you need atomic snapshot of all keys (sync.Map's Range is not snapshot-consistent).

**Q48.** Describe a counter you've seen in production that surprised you.

A: (Open-ended interview question.) An example: a counter named `latency_p99` (a gauge) that was set per-instance by computing the local p99 every minute. The fleet-wide dashboard averaged these. Real fleet p99 was 3× the displayed average. Educational moment.

**Q49.** How do you balance counter quality with engineering velocity?

A: Provide a library that makes the right thing easy and the wrong thing hard. Encode conventions in types (e.g., `MonotonicCounter` has no `Dec`). Code review with a checklist. Audit and clean up periodically. Counter quality compounds — invest early.

**Q50.** What is the most important counter in a production service?

A: Depends on the service. For a request-driven service: request rate and error rate (drive every SLO). For a batch system: jobs processed and jobs failed. For a database: query rate and query latency p99. The right answer is "the one you would page on if it went wrong" — and you should have a runbook for it.

---

## Bonus: Lightning-Round Questions

Quick yes/no/short questions to verify foundational knowledge.

- Is `count++` atomic? **No.**
- Is `atomic.Int64.Add(1)` atomic? **Yes.**
- Does atomic guarantee visibility to other goroutines? **Yes (sequential consistency).**
- Can `sync.Mutex` protect a counter? **Yes, but slow.**
- Is `atomic.Pointer[T]` thread-safe to Load while another goroutine Stores? **Yes.**
- Can you copy `atomic.Int64`? **No (go vet flags it).**
- Does `Add(-1)` work on `atomic.Uint64`? **Only via two's-complement (`Add(^uint64(0))`).**
- Does `expvar.Int` use a mutex? **No (atomic underneath).**
- Is `expvar.String` lock-free? **No (uses a mutex).**
- Is sloppy counter crash-safe? **No (loses un-flushed local data).**
- Does HDR histogram require a mutex? **The reference implementation, yes; can be made lock-free with care.**
- Can you `Reset()` a Prometheus counter? **Discouraged; not in standard interface.**
- Is `runtime_procPin` a public API? **No (linkname access).**
- Does cache-line padding cost memory? **Yes, ~56 bytes per padded atomic.**
- Is false sharing detectable? **Yes (`perf c2c`).**
- Can you average p99 across processes? **No (meaningless).**

---

## End

Interview questions are mirrors. They reveal what the candidate knows and what they don't. Use them to learn, not just to filter.

Good luck.

---

## Extended Bank: 30 More Questions

### Junior Extended

**Q51.** Why is the zero value of `atomic.Int64` usable?

A: It is a struct that wraps an int64 with its zero value 0. Methods work on the zero value: `c.Add(1)` makes it 1, `c.Load()` returns the current. No constructor needed.

**Q52.** What is the cost of `atomic.Int64.Add(1)` on x86-64?

A: A single `LOCK XADD` instruction. Uncontended: ~5-15 ns. Under contention: hundreds of nanoseconds as the cache line bounces between cores.

**Q53.** Can a goroutine block on `atomic.Int64.Load`?

A: No. Atomic operations never park goroutines. They may stall briefly at the hardware level (cache traffic) but the goroutine keeps running.

**Q54.** Why prefer `sync.Mutex` over `sync.RWMutex` for short critical sections?

A: `sync.Mutex` is faster for write-only or short critical sections. `sync.RWMutex` has bookkeeping for reader/writer states; the overhead is justified only when reads dominate writes and contention is real.

**Q55.** Difference between `atomic.Int64.Swap(0)` and `atomic.Int64.Store(0)`?

A: Both set the value to 0 atomically. `Swap` returns the previous value; `Store` returns nothing. Use `Swap` when you need the prior value (e.g., for reset-and-report).

### Middle Extended

**Q56.** Implement a function that atomically adds to a counter only if the result stays even.

A:
```go
func addIfEven(c *atomic.Int64) bool {
    for {
        cur := c.Load()
        if (cur+1) % 2 != 0 { return false }
        if c.CompareAndSwap(cur, cur+1) { return true }
    }
}
```

**Q57.** What is `math/rand/v2`'s advantage over the original `math/rand` for sharded counters?

A: `math/rand/v2.IntN` uses a per-P random source. Original `math/rand` contends on a global mutex for seed access. The v2 version eliminates random-source contention.

**Q58.** When is `sync.Once` the right tool vs atomic counter compared to 1?

A: `sync.Once.Do(f)` guarantees `f` runs exactly once and parks subsequent callers until it completes. `CompareAndSwap(0, 1)` only signals "I was the first arrival" — but does not guarantee any work is done. Use `sync.Once` for "run this initialization exactly once".

**Q59.** Why is `expvar.NewInt("foo")` thread-safe to call from multiple init paths?

A: It uses an internal mutex around the registry. Concurrent calls with different names succeed; concurrent calls with the same name panic on the second one (intentional duplicate-name detection).

**Q60.** What is the canonical pattern for per-route HTTP counters?

A: A `LabeledCounter` with bounded label values (typically status code and route pattern, not raw URLs). Implemented as `sync.Map[labelKey]*atomic.Int64` with cardinality limits.

### Senior Extended

**Q61.** Explain how a sharded counter can still suffer from contention.

A: Even with sharding, if multiple cores hit the same shard (random hash collisions or skewed hashing) or if shards share cache lines (false sharing without padding), contention persists. Mitigations: more shards, padding, per-P assignment.

**Q62.** What is the difference between `runtime.LockOSThread` and `runtime_procPin`?

A: `LockOSThread` binds a goroutine to its OS thread for its lifetime; expensive, persistent. `procPin` is a short-term hint preventing preemption during a brief section; cheap, must be quickly unpinned. `procPin` is the right tool for per-P sharded counter increments.

**Q63.** Why might a sloppy counter's `Get()` return the same value twice in a row even with active increments?

A: Locals haven't flushed yet. The global only reflects flushed increments. Until a local's accumulator hits the threshold (or Flush() is called), its increments are invisible globally.

**Q64.** How would you bound a sloppy counter's staleness?

A: Combine with a periodic flush from a coordinator goroutine: every T seconds, signal all locals to flush. Adds coordination cost but bounds staleness to T.

**Q65.** Explain the trade-off between HDR `RecordValue` and `RecordValueWithExpectedInterval`.

A: `RecordValue` is one record. `RecordValueWithExpectedInterval` may insert multiple synthesised observations to compensate for coordinated omission. Cost: more memory + more time per record. Benefit: honest latency measurement when the recording loop itself can stall.

**Q66.** What is the role of `runtime.fastrand` in sharded counter design?

A: A cheap per-P random number generator used to pick shards. Cheaper than `math/rand.IntN`, uniformly distributed, no global contention. Accessed via `go:linkname`.

**Q67.** Can two HDR histograms with different significant digits be merged?

A: No, not directly. They have different bucket structures. You would need to reshape one to match the other (lossy) before merging.

**Q68.** What is "amortised reset" in a counter?

A: Instead of resetting the counter (which races with concurrent increments), maintain a "subtract" offset. `Value() = v.Load() - sub.Load()`. To reset, set `sub` to the current `v`. Concurrent increments are preserved correctly.

### Staff Extended

**Q69.** Design a counter that automatically grows shards under contention.

A: Start unsharded. Track CAS failures or atomic add latency; when a threshold is exceeded, allocate a sharded array and migrate via `atomic.Pointer[Shards]`. Java's LongAdder pattern.

**Q70.** Trade-offs of histogram-based vs summary-based percentile estimation.

A: Histograms have fixed buckets, are mergeable across instances, support arbitrary quantile queries at the backend. Summaries compute quantiles locally with reservoir sampling, are not mergeable, but are cheaper if quantile is fixed at recording time. Prometheus prefers histograms; some systems prefer summaries.

**Q71.** How does cardinality bombing manifest as an outage?

A: Each new label combination creates a new time series. The metric backend stores per-series state (current value, last scrape time, etc.). At very high cardinality, this state exceeds backend memory. The backend OOMs; alerts stop firing; outage extends.

**Q72.** What is the role of pre-aggregation in multi-tier metric pipelines?

A: Per-region aggregators reduce cardinality before federating to global. E.g., per-region `sum by (service) (rate(requests[1m]))` drops instance labels, summing to per-service rates. The global tier sees ~1/100 the time series. Cost: lose per-instance granularity in cross-region queries.

**Q73.** Design a SLO budget tracker using counters.

A: Two counters: `requests_total`, `errors_total`. SLO target: `errors / requests < 0.001` over 30 days. Compute: `1 - (sum(rate(errors[30d])) / sum(rate(requests[30d])))`. Compare to target. Budget remaining: `(1 - target) - (errors / requests)`. Alert when budget is exhausted faster than budgeted.

**Q74.** Explain the operational risk of `expvar.Func` returning a slow computation.

A: `expvar.Func` is evaluated every scrape. If it does expensive work (e.g., `runtime.ReadMemStats` is ~10 ms STW), every scrape pays that cost. Multiple scrapers can pile up. Use cached values updated periodically by a background goroutine.

**Q75.** What is the value of `runtime/metrics` over custom counters for Go runtime telemetry?

A: Free, kept in sync with runtime changes, sequentially consistent, no need to maintain. Disadvantages: Go runtime-specific, can't add custom dimensions, names follow runtime conventions. Use `runtime/metrics` for runtime stats; complement with custom counters for application stats.

### Principal Extended

**Q76.** Critique an organisational metric naming standard.

A: (Open-ended.) Look for: unit suffixes, monotonic vs gauge naming, label conventions, service/subsystem prefixes, stability tiers. Bad signs: bare names like `count`, mixed conventions, no help-string requirement, no review process.

**Q77.** How do you evolve a counter's semantics without breaking consumers?

A: Add a new counter alongside the old. Both increment during transition. Migrate dashboards/alerts to new. Remove old after a quarter of stability. Document the deprecation. Never silently change a counter's semantics.

**Q78.** Design a multi-tenant counter system that isolates noisy tenants.

A: Per-tenant counter objects, not labels. Each tenant has its own atomic counters; one tenant's high load only affects its own counters. Cardinality bounded at the tenant count (typically small). Aggregation across tenants happens at the registry / exposition layer.

**Q79.** Explain how cardinality enforcement interacts with team autonomy.

A: Central cardinality limits prevent any one team from blowing up the backend. Team-level budgets (per service, per metric) allow autonomy within bounds. Self-service tooling lets teams audit their own cardinality. Cross-team disputes go through an observability platform team.

**Q80.** What is the relationship between counter design and incident response?

A: Counter outputs drive alerts. Alerts trigger response. Response references runbooks. Runbooks reference counter names. A poorly-named or poorly-bounded counter creates incident response friction at 3 AM. Counter quality is incident response quality.

---

## End of Extended Bank

The interview questions above cover the full counter knowledge stack. Use them to interview, to study, to teach.

---

## Coding Exercises for In-Interview

Live-coding exercises a candidate might be asked to perform. Each takes 15-30 minutes.

### Exercise 1: Build a thread-safe counter

Implement a `Counter` type with `Inc()`, `Add(int64)`, `Value() int64`. Test under `-race` with 1000 goroutines × 1000 increments.

Expected: `atomic.Int64` solution. Bonus points for noting the alignment guarantee on 32-bit ARM.

### Exercise 2: Build a counter with a cap

Implement `Capped` such that `Inc()` returns true if the result stays below max; false otherwise.

Expected: CAS loop. Watch for the candidate using `Add` then "undoing" — point out the brief over-shoot.

### Exercise 3: Build a multi-counter atomic snapshot

Given three counters (requests, errors, inflight), provide a way to read all three "at the same instant".

Expected: `atomic.Pointer[Snapshot]` pattern. Watch for the candidate trying to coordinate three separate `Load`s.

### Exercise 4: Diagnose a slow benchmark

Given a benchmark of a counter that scales poorly at high `-cpu`, explain why and fix it.

Expected: identify cache contention, propose sharding, then identify false sharing, propose padding.

### Exercise 5: Build a sharded counter

Implement a sharded counter with N cells, picking shards via a per-goroutine hash. Benchmark vs single atomic.

Expected: working implementation. Bonus points for power-of-2 size, padding, `cpu.CacheLinePad` use.

### Exercise 6: Build a sliding-window rate

Implement a counter that reports "rate per minute over the last 5 minutes".

Expected: ring buffer of per-minute buckets, with a tick goroutine.

### Exercise 7: Wire up expvar

Take an existing `atomic.Int64`-based counter and expose it via `/debug/vars`.

Expected: `expvar.Publish` with `expvar.Func` wrapper.

### Exercise 8: Diagnose a counter that lost increments

Code provided uses `mu.Lock()` around an `atomic.Int64.Add(1)`. Explain why this is redundant and what should be removed.

Expected: identify the redundancy; suggest removing the mutex.

### Exercise 9: Implement a CountDownLatch

Using `atomic.Int64` and a channel, implement a latch with `Add(n)`, `Done()`, `Wait()`.

Expected: counter decrements in `Done`; channel closes when counter hits zero; `Wait` reads channel.

### Exercise 10: Refactor a histogram-using-counter

Given code that maintains `count`, `sum`, and uses `sum/count` as "average latency", explain why this is wrong for tail latency monitoring and propose a histogram.

Expected: identify that averages hide tails; propose HDR or Prometheus histogram; show how to expose percentiles.

---

## System Design Interview

A 45-minute design interview on counter-related topics.

### Prompt

"Design the metrics subsystem for a Go HTTP service handling 1M RPS across 50 instances. Cover: counter primitives, histograms, exposition, aggregation, alerting."

### Expected coverage

- **Primitives**: padded sharded counter for hot counters (request count, byte count). HDR histogram for latency.
- **Exposition**: Prometheus text on a private port. expvar for ad-hoc debugging.
- **Aggregation**: per-instance metrics scraped by regional Prometheus. Federated to global. Per-region pre-aggregation to reduce cardinality.
- **Cardinality**: bound at the registry level. Audit periodically.
- **Alerting**: SLO-driven; burn-rate alerts.
- **Dashboards**: golden signals (RED method).
- **Operations**: runbooks, on-call rotation, postmortem culture.
- **Cost**: budget per service, automated detection of cardinality explosions.

### Probing questions

- "How would your design change if we needed cross-region aggregation in real time?"
- "What if cardinality limits started blocking legitimate use cases?"
- "How do you handle counter resets on deploys?"
- "Walk through how a 3 AM page would unfold."

A senior candidate should sketch the architecture and discuss trade-offs. A staff candidate should also discuss cost, operational impact, and team workflow. A principal candidate should also discuss organisational structure and platform design.

---

## Closing Thought on Interviews

The best interview questions reveal not just knowledge but *thinking*. A candidate who knows `atomic.Int64` but cannot articulate why it is preferred to `sync.Mutex` is less senior than one who knows neither but reasons about it correctly.

When interviewing for counter expertise, look for:

- Conceptual depth (memory model, cache coherence)
- Practical experience (production stories, profile interpretation)
- Operational mindset (what happens at 3 AM)
- Communication (can they explain it to a non-expert)

The questions are tools. The candidate is the goal.

---

End.

---

## Appendix: Sample Candidate Self-Assessment

Before an interview, candidates can self-assess:

- [ ] Can I explain why `count++` is broken concurrently?
- [ ] Can I implement an atomic counter from scratch?
- [ ] Have I used `sync/atomic` in production?
- [ ] Have I written a CAS loop?
- [ ] Can I implement a sharded counter?
- [ ] Have I diagnosed false sharing in real code?
- [ ] Have I used HDR histograms?
- [ ] Have I integrated counters with Prometheus / OpenTelemetry?
- [ ] Have I designed an alert from a counter?
- [ ] Have I been paged because of a counter mistake?

The first five are junior-to-middle. The next three are senior. The last two are professional.

---

## Appendix: How to Use This Interview Bank

For interviewers:

- Pick questions matching the seniority level you are evaluating.
- Probe answers; do not accept memorisation.
- Use coding exercises for hands-on signal.
- Combine factual questions with reasoning questions.

For candidates:

- Read all the questions before interviewing.
- Practise explaining out loud, not just thinking.
- Work through coding exercises.
- Map your production stories to the question topics.

For self-study:

- Treat each question as a prompt for research.
- Write your own answer; compare to the sketch.
- Identify gaps; close them.
- Repeat with the next level's questions.

The bank is a tool. Use it however helps you.

---

## Final Word on Interviews

A great interview is a conversation between two engineers about counters. The interviewer learns about the candidate; the candidate learns from the interviewer. Both leave wiser.

A bad interview is a quiz. Avoid quizzing.

If you remember nothing else from this document, remember that. Counters are real engineering, not trivia. Interviews about them should reflect that.

End. Final.

---

## Last note

If you read every question and could answer most, congratulations: you are well-prepared for any Go-concurrency interview that touches on counters. Read again in six months; you will notice questions you could not have answered before now feel obvious. That is the growth.



