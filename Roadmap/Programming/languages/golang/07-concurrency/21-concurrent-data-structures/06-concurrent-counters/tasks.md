---
layout: default
title: Tasks
parent: Concurrent Counters
grand_parent: Concurrent Data Structures
ancestor: Go
nav_order: 8
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/21-concurrent-data-structures/06-concurrent-counters/tasks/
---

# Concurrent Counters — Hands-On Tasks

A graded set of exercises. Each is a small, self-contained Go project. Estimated time in parentheses.

## Junior Tasks

### Task J1: The broken example (15 min)

Save and run the following:

```go
package main

import (
    "fmt"
    "sync"
)

func main() {
    var count int
    var wg sync.WaitGroup
    for i := 0; i < 1000; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            count++
        }()
    }
    wg.Wait()
    fmt.Println(count)
}
```

Run with `go run main.go` ten times. Note the variation. Then run with `go run -race main.go` and read the race detector report.

### Task J2: Fix with mutex (15 min)

Take the broken example. Add a `sync.Mutex`. Run again and verify the result is always 1000.

### Task J3: Fix with atomic (15 min)

Take the broken example. Replace `int` with `atomic.Int64` and `count++` with `count.Add(1)`. Verify the result is always 1000. Compare performance with the mutex version (eyeball the elapsed time).

### Task J4: Build a request counter (30 min)

Write an HTTP server with one handler that increments a counter on each request. Add a `/metrics` handler that returns the count as plain text. Test with `curl http://localhost:8080/` and `curl http://localhost:8080/metrics`.

### Task J5: Build a gauge (30 min)

Add an "in-flight requests" gauge to your server. Increment on entry; decrement on exit (with `defer`). Verify it stays bounded under `wrk -c 64 http://localhost:8080/`.

### Task J6: Per-request statistics (30 min)

Inside a handler, track the number of database calls made for that request. Use a struct of `atomic.Int64` fields stored in the request context. Log the values when the request finishes.

### Task J7: Reset and report (30 min)

Add a goroutine that every 10 seconds reads the request count via `Swap(0)` and logs "requests in last 10s: X". Verify it reports correctly under load.

### Task J8: Wire up `expvar` (30 min)

Use `expvar.NewInt` for two counters in your service. Curl `/debug/vars` and inspect the JSON output.

## Middle Tasks

### Task M1: CAS-based max tracker (30 min)

Implement `AtomicMax` with `Observe(int64)` and `Get() int64`. Use a CAS loop. Test with 1000 goroutines submitting random values; verify the result equals the actual max.

### Task M2: CAS-based capped counter (30 min)

Implement `Capped` with `Inc() bool` (returns false if at cap). Use a CAS loop. Test: start 1000 goroutines that each try to Inc; with cap=100, exactly 100 should succeed.

### Task M3: Multi-counter snapshot (45 min)

Three counters (requests, errors, in-flight). Use `atomic.Pointer[Snapshot]` to publish a consistent snapshot once per second. Add a `/status` HTTP handler that prints the current snapshot.

### Task M4: `expvar.Map` for per-route counts (45 min)

Add `expvar.NewMap("routes")` to your server. For each request, `routes.Add(r.URL.Path, 1)`. Curl `/debug/vars` to see the per-route counts.

### Task M5: Basic sharded counter (1 h)

Implement a counter with 64 shards, each an `atomic.Int64`. `Inc()` picks a shard at random. `Get()` sums all shards. Benchmark vs single atomic at `-cpu=1,4,16`.

### Task M6: Sliding-window rate (1 h)

Implement a counter that reports "requests in the last 60 seconds". Use a ring buffer of 60 per-second counters with a 1-second tick.

### Task M7: HTTP handler with full metrics (1 h)

Combine: request counter, error counter, in-flight gauge, per-status-code labeled counter. All exposed via `expvar`.

### Task M8: Replace mutex with atomic in existing code (1 h)

Find a `sync.Mutex`-wrapped counter in an open-source Go project (or your own code). Replace with `atomic.Int64`. Verify behaviour with `-race`. Submit a PR (or just keep the diff).

## Senior Tasks

### Task S1: Detect false sharing (1 h)

Write a benchmark with `[64]atomic.Int64` (no padding). Run at `-cpu=16`. Note the throughput. Now add `_ cpu.CacheLinePad` between elements. Benchmark again. Note the improvement.

### Task S2: Padded sharded counter (1 h)

Implement a sharded counter where each cell is a struct with `cpu.CacheLinePad` before and after the `atomic.Int64`. Power-of-2 size. Random shard selection via `rand.Uint64()`. Benchmark vs unpadded.

### Task S3: Per-P counter with `procPin` (2 h)

Use `//go:linkname` to access `runtime.procPin` and `runtime.procUnpin`. Implement a per-P counter sized to `GOMAXPROCS`. Benchmark vs random-shard. Show near-linear scaling.

### Task S4: Sloppy counter (1 h)

Implement `Sloppy` with `Local` accumulators that flush at threshold. Each goroutine in your test should call `local := s.Local(1024); defer local.Flush(); for ...{ local.Inc() }`. Verify exact correctness post-flush.

### Task S5: Diagnose a slow benchmark (1 h)

Given the unpadded sharded counter from Task M5, profile it with `go test -bench=. -cpu=16 -cpuprofile=cpu.prof` and inspect `go tool pprof cpu.prof`. Identify the hot spot. Confirm by adding padding.

### Task S6: `LongAdder`-style auto-growing counter (3 h)

Implement a counter that starts unsharded and grows shards under contention. Track CAS failures; when a threshold is exceeded, install a sharded cell array. Use `atomic.Pointer[Cells]` for atomic resize.

### Task S7: Multi-counter coherent snapshot (2 h)

Three sharded counters (requests, errors, in-flight). Publish a coherent snapshot via a publisher goroutine and `atomic.Pointer[Snapshot]`. The publisher reads each counter, builds the snapshot, swaps the pointer. Readers see consistent values.

### Task S8: NUMA-aware shard placement (3 h)

If you have access to a multi-socket machine (or can simulate via container CPU restrictions): pin Go workers to specific sockets, allocate per-socket shard arrays, increment locally. Compare to single shared sharded counter.

## Professional Tasks

### Task P1: Build an HDR-backed latency metric (2 h)

Use `github.com/HdrHistogram/hdrhistogram-go`. Implement `LatencyMetric` with sharded (per-P) HDR histograms. `Observe(time.Duration)`, `Quantile(0.99) int64`. Wrap in HTTP middleware. Verify p99 reporting on a synthetic workload.

### Task P2: Sliding-window HDR histogram (2 h)

A ring of HDR histograms, one per minute, covering 5 minutes. `Observe(int64)` records to the current bucket. `Tick()` advances and resets the next bucket. `Snapshot()` returns the merged histogram of the last 5 minutes.

### Task P3: Full Prometheus integration (3 h)

Take your in-house counter library. Wire it to `prometheus/client_golang` via `CounterFunc` and `GaugeFunc`. Curl `/metrics` and verify Prometheus-format output. Run a local Prometheus instance and query the metrics.

### Task P4: Cardinality-bounded labeled counter (2 h)

Implement a labeled counter that refuses new label combinations beyond a configured limit. The "dropped" count is itself a counter. Test by feeding random label values and observing the drop counter rising.

### Task P5: Multi-format exposition (3 h)

A single counter exposed via expvar (JSON), Prometheus (text), and OpenTelemetry (OTLP). Verify all three produce correct, equivalent outputs.

### Task P6: SLO budget tracker (3 h)

Two counters (requests, errors). Implement a tracker that computes "budget remaining" over a 30-day window. Wire to an alert that fires when budget is consumed too fast.

### Task P7: Counter telemetry (2 h)

Add counters about your counters: `metrics_inc_total`, `metrics_dropped_total`, `metrics_registry_size`. Expose them; alert on rapid growth.

### Task P8: A production-grade metrics subsystem (5+ h)

Combine all of the above into a single internal library. Document it. Use it in a real service (yours or a sandbox). Operate it for at least a week. Iterate based on what operators tell you.

## Bonus Long-Form Tasks

### Task B1: Read and summarise `sync.Pool` source

Read `runtime/sync.go` and `sync/pool.go`. Write a 500-word summary of how `sync.Pool` uses per-P shards. Identify the patterns that map to per-P counters.

### Task B2: Read and summarise `expvar` source

Read `expvar.go`. Write a 500-word summary of how the JSON exposition works. Replicate the design in your own minimal "expvar-like" package.

### Task B3: Read `hdrhistogram-go` source

Read the package. Identify the bucket-index calculation. Write a function that, given a value and HDR parameters, returns the bucket index, replicating the library's logic.

### Task B4: Read Java's `LongAdder` and translate to Go

Read OpenJDK's `LongAdder.java` and `Striped64.java`. Port the algorithm to Go. Benchmark vs your fixed-shard counter.

### Task B5: Build a custom metric backend

Write a tiny "metric backend" — a process that listens for OTLP/Prometheus pushes/scrapes and stores metrics in memory. Visualise with a simple HTML/JS dashboard. Drives home how the backend uses the metrics.

---

## Setup Requirements

All tasks require:

- Go 1.19 or newer
- A Linux or Mac dev machine
- For senior tasks: `perf` (Linux only)
- For Prometheus tasks: a local Prometheus install
- For HDR tasks: `go get github.com/HdrHistogram/hdrhistogram-go`

## Approach

Do tasks in order within a level; pick a level that matches your current skill. Skip tasks that feel too easy; revisit ones that feel too hard. The order is roughly progressive but not strictly sequential.

For each task, ship working code. Test with `-race`. Benchmark where the task calls for it. Commit to a public repo (or local). Reflect on what you learned.

## Time Budget

- Junior: 3-4 hours total
- Middle: 6-8 hours total
- Senior: 10-15 hours total
- Professional: 20+ hours total

Spread over weeks if needed. Counters are a deep topic; rushing produces shallow understanding.

## Verification

Each task should result in:

- Code that compiles
- Tests (with `-race`)
- A benchmark where relevant
- A short README describing what you learned

After finishing a level, you should be able to answer the corresponding interview questions confidently.

---

End. Build well.

---

## Extended Tasks: Counter Lab Notebook

For each task above, keep a lab notebook entry. Sample format:

```
Task: J1 - The broken example
Date: 2026-03-15
Time spent: 25 min

What I did:
- Ran the code 10 times. Outputs: 1000, 992, 1000, 987, 1000, 994, 1000, 998, 1000, 990
- Ran with -race; got immediate WARNING: DATA RACE report
- Line numbers in the race report point to count++ inside the goroutine

What I learned:
- count++ is non-atomic across goroutines
- The race detector reports the racy access locations precisely
- Even when "lucky" (1000 result), the program is still wrong

Surprises:
- Most runs gave 1000; the variance is small enough that without -race
  you might not notice in casual testing
```

Doing this for every task builds:

- A personal reference you can return to
- Evidence of deliberate practice
- A portfolio for job interviews

---

## Extended Tasks: Counter Code Reviews

For each task above, also do a code review of your own work after a week. Look for:

- Race conditions you missed
- API choices you regret
- Performance you can improve
- Tests you should add

Self-review after a delay reveals what you have actually internalised vs what was passing-knowledge.

---

## Extended Tasks: Pair Programming Variations

Some tasks are better with a partner:

### Pair Task PP1: Race-detect-driven development

One partner writes a counter with a deliberate race. The other partner runs `-race` and identifies the race. Swap. Iterate. Builds intuition for what `-race` catches.

### Pair Task PP2: Performance regression hunting

One partner makes a small change to a counter implementation. The other partner runs benchmarks and identifies whether throughput improved or regressed. Swap. Iterate. Builds intuition for what helps and what doesn't.

### Pair Task PP3: API design debate

One partner argues for `Counter` returning the new value from `Inc()`. The other argues for void return. Debate trade-offs. Switch. Reach consensus. Builds API-design discipline.

### Pair Task PP4: Postmortem writing

Given an outage scenario (e.g., "counter cardinality bombed and Prometheus OOMed"), one partner plays the on-call engineer; the other plays the investigator. Write the postmortem together. Builds operational mindset.

---

## Extended Tasks: Reading Assignments

Companion reading for each level:

### Junior reading

- Go memory model: <https://go.dev/ref/mem>
- `sync/atomic` docs
- "What is a data race?" — official Go article

### Middle reading

- `expvar` source
- `sync.Map` source
- Prometheus client_golang README

### Senior reading

- Java `LongAdder` source
- `sync.Pool` source
- Linux `percpu_counter.c`
- Gil Tene "How Not to Measure Latency" (video)

### Professional reading

- HdrHistogram-go source
- OpenTelemetry metrics SDK source
- Google SRE Book (chapters on monitoring)
- "Site Reliability Workbook" practical examples

Spend 1-2 hours per level on reading. The patterns will start to repeat; that is the goal.

---

## Extended Tasks: Teaching as Mastery

The final mastery test: teach the topic to someone else.

### Teaching Task T1: Whiteboard the broken counter

Stand at a whiteboard. Explain to a colleague: "Why does `count++` give wrong answers from many goroutines?" Use no notes. Watch their face for confusion; clarify.

### Teaching Task T2: Walk through atomic.Int64

Open Go source for `sync/atomic`. Show your audience: the type definition, the methods, the asm files. Explain how `Add` becomes a hardware instruction.

### Teaching Task T3: Demo false sharing

Set up a live benchmark showing throughput collapse with naive sharding, then recovery with padding. Watch your audience's eyebrows rise.

### Teaching Task T4: Architect the metrics subsystem

Whiteboard the full observability subsystem from this series. Discuss trade-offs. Field questions. The questions will reveal gaps in your own understanding.

### Teaching Task T5: Write a blog post

Public-facing teaching. Choose a counter topic; write 1500-2000 words; publish. Engage with comments. Refine for future versions.

If you can teach the topic clearly to a colleague, you have mastered it.

---

## Extended Tasks: Production Verification

For the brave: deploy your counter work to production.

### Production Task PR1: Replace a counter

Find a counter in your team's production code. Replace it with your improved version (padded, sharded, etc.). Verify in monitoring that it behaves correctly. Measure performance impact.

### Production Task PR2: Add a metric and alert

Add a new counter to a production service. Wire it to a Grafana dashboard. Wire to an alert. Document the runbook. Wait for the alert to fire (hopefully not!) and iterate.

### Production Task PR3: Conduct a counter audit

Pick a service. List every counter. Audit each (cardinality, naming, exposition, alerting). Write a report. Propose fixes. Implement them.

### Production Task PR4: Mentor a colleague

Pair with a more junior colleague on a counter task. Watch them work; offer guidance only when needed. Reflect on what was hard for them.

Production tasks are the highest-fidelity verification of your counter knowledge.

---

## Final Word on Tasks

Knowledge without practice is fragile. The tasks here turn the documentation into capability. Do them. Reflect. Iterate. Teach.

Counters are a deep topic; mastery takes years. Start now.

End.

---

## Appendix: Solution Hints

Brief hints (not full solutions) for the trickier tasks.

### J3 hint

Use `var count atomic.Int64` and `count.Add(1)`. The print at the end becomes `count.Load()`.

### J7 hint

A goroutine launched in `main` reading via `Swap(0)` every 10 seconds. Use `time.NewTicker(10 * time.Second)`.

### M1 hint

CAS loop pattern:
```go
for {
    cur := m.v.Load()
    if x <= cur { return }
    if m.v.CompareAndSwap(cur, x) { return }
}
```

### M2 hint

CAS loop with cap check before the swap.

### M3 hint

`atomic.Pointer[Snapshot]`. Publisher reads all three counters, builds snapshot, calls `Store`.

### M5 hint

`[64]atomic.Int64` array. Shard by `rand.IntN(64)` or by hash of goroutine identity.

### S1 hint

Compare benchmarks of `[64]atomic.Int64{}` vs `[64]struct{_ cpu.CacheLinePad; v atomic.Int64; _ cpu.CacheLinePad}{}`.

### S3 hint

```go
//go:linkname runtime_procPin runtime.procPin
func runtime_procPin() int
```
Use inside `Inc` to pick the shard index.

### S4 hint

Local accumulator that flushes when `local.n >= local.flushAt`. Always pair with `defer local.Flush()`.

### S6 hint

Atomic.Pointer[[]Cell] for the cell array; CAS to detect contention; mutex to coordinate growth.

### P1 hint

Per-P shards of `hdrhistogram.New(1, 60_000_000_000, 3)`, each protected by its own mutex. Merge at quantile-read time.

### P5 hint

Use `expvar.Func`, `prometheus.CounterFunc`, and OpenTelemetry `ObservableCounter` — each reads the same underlying `atomic.Int64`.

### P6 hint

`rate(errors[30d]) / rate(requests[30d])` in PromQL; compare to 1 - target.

The full solutions are in the various deep dives in the senior and professional files. Refer back when stuck.

---

## Appendix: How to Grade Yourself

After each task:

- **Pass**: code works, tests pass with `-race`, you can explain it.
- **Partial**: code works but you cannot explain a part of it. Revisit the docs.
- **Fail**: code does not work. Find the bug; understand it before moving on.

Honest self-grading is essential. Self-deception leads to false confidence.

---

## Appendix: The Tasks as Curriculum

The tasks are designed to be completed in order within a level, with optional skipping. A team's onboarding might use this as a curriculum:

- Week 1: Junior tasks
- Week 2-3: Middle tasks
- Week 4-6: Senior tasks
- Week 7-10: Professional tasks
- Ongoing: production tasks and teaching

Use the tasks for new-hire ramp-up. Use them for skill-up sessions. Use them for self-study.

---

Final end.


