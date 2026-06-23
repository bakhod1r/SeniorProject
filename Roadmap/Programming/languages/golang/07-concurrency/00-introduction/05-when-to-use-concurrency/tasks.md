# When to Use Concurrency — Hands-on Tasks

> Exercises in deciding whether and how to use concurrency. Each task gives a scenario; you decide, justify, and implement (or refuse). Sample solutions at the end.

---

## Easy

### Task 1 — Classify workloads

For each scenario, decide: I/O-bound, CPU-bound, memory-bandwidth-bound, mixed, or trivial.

1. Reading a 1 MB JSON file and decoding it.
2. Multiplying two 1000×1000 matrices.
3. Calling 5 microservices and combining their JSON responses.
4. Computing the SHA-256 of a 1 GB byte slice.
5. Iterating over a 100-element slice and summing.
6. Writing 1000 events to a Kafka topic.
7. Sorting a 1M-element int slice.
8. Reading a 10 GB file and computing per-line checksums.

---

### Task 2 — Decide: concurrent or sequential?

For each of these, decide whether to use concurrency:

1. A CLI tool that reads one file, processes it, writes one output file.
2. A web handler that authenticates and returns user details.
3. A batch job that calls 100 backends in parallel.
4. A worker that processes 10 jobs/sec from a queue.
5. A function that computes the median of a slice.
6. A goroutine that maintains a periodic heartbeat.

---

### Task 3 — Measure sequential vs concurrent

Take Exercise 1 from `01-what-is-concurrency/optimize.md` (`FetchAll`). Implement both sequential and concurrent versions. Measure both. Quantify the speedup.

---

### Task 4 — Identify overengineering

Look at this code:

```go
func sum(data []int) int {
    var s atomic.Int64
    var wg sync.WaitGroup
    for _, v := range data {
        wg.Add(1)
        go func(v int) {
            defer wg.Done()
            s.Add(int64(v))
        }(v)
    }
    wg.Wait()
    return int(s.Load())
}
```

Why is this slow? Refactor to a sequential version. Benchmark to confirm sequential is faster.

---

### Task 5 — Apply Amdahl

You have a program where 70% of time is parallelisable. You have 16 cores. What is the theoretical max speedup? Does adding more cores beyond 16 help significantly?

---

## Medium

### Task 6 — Worker pool sizing

Build a worker pool that processes API calls. Each call takes ~100 ms on average; ~50% of time is wait. You have a single CPU. Each call uses a single DB connection.

You have 8 DB connections in the pool.

How many workers? Why?

---

### Task 7 — Service design

Design the concurrency for a search-as-you-type service:

- Frontend sends one query per keystroke.
- Backend queries 3 services (suggestions, recent, popular).
- Backend aggregates and ranks results.
- Goal: p99 latency under 100 ms.

Sketch the implementation. Quantify expected latency.

---

### Task 8 — Add concurrency, measure

Take this sequential code:

```go
func processItems(items []Item) []Result {
    results := make([]Result, 0, len(items))
    for _, item := range items {
        r := processIO(item)
        results = append(results, r)
    }
    return results
}
```

`processIO` takes ~50 ms each. There are 100 items.

Sequential: ~5 s.

Implement a concurrent version. Measure. Quantify.

---

### Task 9 — Bottleneck migration

Build a 3-stage pipeline:

1. Reader: 100 items/sec.
2. Processor: 1000 items/sec.
3. Writer: 50 items/sec.

Connect with channels. Run for 30 seconds. Print queue depths every second.

Now parallelise the Writer with 3 workers. Re-run. Identify the new bottleneck.

---

### Task 10 — Tail latency simulation

Write a benchmark that calls 10 backends in parallel; each backend's latency is drawn from a distribution: 95% chance of 50 ms, 5% chance of 500 ms.

Measure aggregate p50 and p99 over 1000 runs.

Now implement a hedged version: after 100 ms, fire a duplicate to a redundant backend. Take the first response. Re-measure.

Quantify the tail-latency improvement.

---

## Hard

### Task 11 — End-to-end service design

Design the concurrency for a chat server:

- 100 000 concurrent WebSocket connections.
- Each user belongs to ~5 chat rooms.
- Each room has typically 10–100 active users.
- Messages broadcast to all users in the room.

Concerns:
- Memory (per-connection footprint).
- Throughput (messages per second).
- Latency (message delivery p99 < 100 ms).
- Failure isolation (a slow connection should not block others).

Sketch:
- Per-connection goroutine.
- Per-room state.
- How messages flow from sender to all room members.
- How a slow consumer is handled.

---

### Task 12 — Remove concurrency

Take an existing project (yours or open source) that uses goroutines liberally. Identify one or more goroutines that are not pulling their weight. Refactor to sequential or simpler. Benchmark before and after.

Goal: produce a PR-style diff and rationale.

---

### Task 13 — Adaptive worker pool

Implement a worker pool that scales workers based on queue depth:

- Start with N=4.
- If queue is consistently full for > 5s, add a worker (up to maxN).
- If queue is empty for > 30s, remove a worker (down to minN).

Implement with proper synchronisation. Test under bursty load.

---

### Task 14 — Speculative execution

Build a function that computes the answer to a query two ways (different algorithms with different latency profiles). Run both concurrently; return whichever finishes first; cancel the other.

Apply to a real problem (e.g., two cache lookups: local vs remote).

---

### Task 15 — Capacity planning calculation

You have a service with:

- λ = 1000 req/sec arrival rate.
- W = 100 ms average latency.

By Little's law, L = 100 in-flight requests.

If each request uses 10 KB of memory, what's the steady-state memory? If you have 100 ms of latency budget and the service does a 50 ms DB call, how much concurrency does the DB pool need?

Express your answers as concrete numbers.

---

### Task 16 — Re-architect a slow handler

Take a slow synchronous handler:

```go
func handle(w http.ResponseWriter, r *http.Request) {
    profile := loadProfile(r.UserID)        // 50 ms
    activity := loadActivity(r.UserID)      // 100 ms
    recs := computeRecommendations(profile, activity)  // 80 ms CPU
    write(w, recs)
}
```

Total: 230 ms.

Goal: under 150 ms.

What concurrency would you add? Implement. Measure.

---

### Task 17 — Tail-tolerant fan-out

Implement a fan-out to 5 services with these policies:

1. **All:** wait for all 5.
2. **First:** return when the first responds.
3. **Quorum:** wait for 3.

Benchmark each policy with simulated latency distributions. Compare p99 of each.

---

### Task 18 — Concurrency budget

Set up a service with bounded total concurrency (e.g., 100 goroutines max). Implement:

- Worker pool of 100 for general work.
- Sub-pool of 20 for high-priority work.
- Rejection (503) when both are full.

Verify behaviour under burst.

---

### Task 19 — Pipeline with backpressure

Build a 4-stage pipeline. Each stage has different processing rates. Connect with bounded channels.

Verify that:

- Backpressure propagates upstream (slower stage causes upstream to block).
- The slowest stage determines throughput.
- No goroutine leaks under shutdown.

---

### Task 20 — Write the decision document

For a real concurrent design (yours, or proposed), write a one-page document covering:

- **Why concurrency.** What problem it solves.
- **What pattern.** Worker pool, fan-out, pipeline, etc.
- **Sizing.** How many goroutines, bound by what.
- **Lifetime.** When goroutines exit; how shutdown works.
- **Failure modes.** What happens when downstream fails, when goroutines panic.
- **Observability.** Metrics, logs, traces.

Treat as a design review artifact.

---

## Solutions and hints

### Task 1 answers

1. I/O-bound (file read) → quick because 1 MB is small.
2. CPU-bound (and parallelisable per row/column).
3. I/O-bound (network).
4. CPU-bound. Parallelisable via parallel SHA. Caveat: SHA-256 has dependencies; one stream is inherently serial. Use parallel SHAs over multiple chunks.
5. Trivial. Sequential. ~100 ns.
6. I/O-bound (network).
7. CPU-bound. Parallel sort algorithms exist.
8. Mixed: file I/O (especially large) + CPU for checksums.

### Task 2 answers

1. Sequential. No parallel opportunity.
2. Sequential within the handler (the framework handles per-request concurrency).
3. Concurrent. Fan-out via `errgroup.WithContext`.
4. Concurrent at the worker level (one goroutine per worker). The processing itself: depends on per-job nature.
5. Sequential. Median is small CPU work.
6. Single long-running goroutine.

### Task 5 answers

With p=0.7, n=16: `1 / (0.3 + 0.7/16) ≈ 2.91x`. Beyond 16 cores, gains diminish quickly. At infinite cores, `1 / 0.3 ≈ 3.33x`. The 70% serial fraction is the cap.

### Task 6 answer

8 workers, matching the DB pool. More workers just queue on the DB pool. The DB pool is the binding constraint.

### Task 8 sketch

```go
func processItems(items []Item) []Result {
    results := make([]Result, len(items))
    var wg sync.WaitGroup
    sem := make(chan struct{}, 16) // bound concurrency
    for i, item := range items {
        wg.Add(1)
        sem <- struct{}{}
        go func(i int, item Item) {
            defer wg.Done()
            defer func() { <-sem }()
            results[i] = processIO(item)
        }(i, item)
    }
    wg.Wait()
    return results
}
```

100 items, ~50 ms each: sequential = ~5 s. Concurrent with 16 parallel = ~350 ms.

### Task 15 answer

Memory: 100 × 10 KB = 1 MB in-flight.

DB pool: if each request makes one DB call lasting 50 ms, Little's law: pool size = λ × DB_time = 1000 × 0.05 = 50 connections needed at saturation. Round up to 60–80 for headroom.

---

## Wrap-up

After completing these tasks you should:

- Classify workloads confidently.
- Decide whether concurrency is the right tool.
- Size pools by Little's law and Amdahl.
- Refactor concurrent code to sequential where it does not pay.
- Apply tail-tolerance techniques (hedging, quorum).
- Design end-to-end services with explicit concurrency trade-offs.

The next file (`find-bug.md`) tests your ability to spot misapplied concurrency.
