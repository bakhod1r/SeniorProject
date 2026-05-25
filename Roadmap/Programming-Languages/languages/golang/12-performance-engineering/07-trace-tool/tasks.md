# The Go Execution Tracer — Tasks

Hands-on exercises. Each task is a self-contained goal you can complete in 15-60 minutes. Solve one per session; bring the resulting trace screenshot or notes to your next session.

---

## Task 1: Your first trace

Write a program that spawns 8 goroutines, each sleeping 100 ms, with `runtime/trace` enabled. Open the result in `go tool trace`.

**Goal:** Confirm you see 8 goroutines, see their wait periods, and find the "Goroutine analysis" page.

**Deliverable:** A `trace.out` file. Report which P each goroutine ran on and whether any ran simultaneously.

---

## Task 2: Sequential vs parallel network calls

Write a handler that issues three HTTP GETs to `https://httpbin.org/delay/1`. Capture a trace. Then refactor to use `errgroup` to run them concurrently. Capture again.

**Goal:** See three sequential `GoBlockNet` gaps become three overlapping gaps. Measure handler latency before/after.

**Deliverable:** Two trace files (`before.out`, `after.out`) and a one-paragraph note describing what changed in the flame view.

---

## Task 3: Annotate a real workload

Take any non-trivial function in your codebase (a parser, a renderer, a request handler) and instrument it with `trace.WithRegion` around three or four logical phases. Run a benchmark with `-trace=trace.out`. Open the "User-defined regions" page.

**Goal:** Identify the phase with the largest total time.

**Deliverable:** The sorted region table and a one-sentence conclusion about which phase to optimize.

---

## Task 4: Cross-goroutine tasks

Build a tiny pipeline: a producer goroutine emits items; a worker pool processes them. Wrap each item with `trace.NewTask` in the producer, propagate via `context.Context`. View the "User-defined tasks" page.

**Goal:** See task durations across the producer + worker boundary. Identify the task with the longest end-to-end time.

**Deliverable:** Screenshot or summary of the per-task timing.

---

## Task 5: Detect oversubscription

Write a program that spawns 10,000 CPU-bound goroutines, each computing the SHA-256 of a random 4 KB buffer. Set `GOMAXPROCS=4`. Capture a trace for 1 second.

**Goal:** Observe long `Sched wait` per goroutine in the goroutine analysis. Refactor to a worker pool of size `GOMAXPROCS`; capture again.

**Deliverable:** Two traces. Report the reduction in `Sched wait` total.

---

## Task 6: Trigger a GC storm

Write a hot loop that does `_ = fmt.Sprintf("%d/%d", i, j)` a million times. Capture a trace. Observe the heap-chart sawtooth and `gcBgMarkWorker` slices.

**Goal:** Identify GC frequency. Then preallocate a `*bytes.Buffer` per goroutine, use `fmt.Fprintf` against it, and re-capture. GC frequency should drop dramatically.

**Deliverable:** Two traces and a count of `GCStart` events per second in each.

---

## Task 7: Reproduce a `time.After` leak

Write a program with a `select` loop using `time.After(1*time.Second)` on each iteration. Drive a fast `chan` source so the timer rarely fires. Run for 30 seconds with a trace capture during the last 5.

**Goal:** Observe `runtime.NumGoroutine()` (read separately from the trace) climbing, then identify the timer-related goroutines in "Goroutine analysis."

**Deliverable:** Numgoroutine over time, plus a screenshot of the offending goroutines.

Fix with a reused `time.Timer`, confirm count is steady, capture once more.

---

## Task 8: Find the lock contention

Write a `ShardedCounter` with one global `sync.Mutex` protecting an integer. Spawn 100 goroutines each incrementing 100,000 times. Capture a trace.

**Goal:** Use the "Synchronization blocking profile" to find the contention site. Refactor to `atomic.Int64` or a 256-shard array.

**Deliverable:** Two traces; report total throughput (ops/sec) before and after.

---

## Task 9: Measure cgo's impact

If your environment has a C compiler: write a Go function that calls a trivial C function (`return x + 1;`) a million times in a hot loop. Capture a trace.

**Goal:** See `ThreadCreate` and the M-lane behavior under cgo pressure. Compare against a pure-Go equivalent.

**Deliverable:** A note describing what the trace looks like (especially the M lane) when cgo is involved.

---

## Task 10: Flight recorder dump (Go 1.25+)

Build a small HTTP server with `trace.NewFlightRecorder` started at boot and a `/debug/flight` endpoint that calls `fr.WriteTo(w)`. Drive load for 30 seconds; in the middle, inject one slow request (`time.Sleep` inside the handler).

**Goal:** Curl `/debug/flight` 2 seconds after the slow request and open the resulting trace.

**Deliverable:** Confirm the slow request is visible in the dump. Note the dump file size and the recorder's configured `MaxBytes`.

---

## Task 11: Build a custom analyzer

Using `golang.org/x/exp/trace`, write a CLI that reads a trace file and prints the top-10 goroutine-starting functions by total blocked time (any kind of block).

**Goal:** Practice reading the trace programmatically.

**Deliverable:** The CLI binary and its output on a non-trivial trace (e.g., from Task 5 or 8).

---

## Task 12: Compare two traces

Capture two traces of the same benchmark before and after a code change you've made (any change — even a no-op refactor). Open both in two browser tabs at the same zoom level.

**Goal:** Practice eyeballing differences in trace shape. Note any unexpected differences a "no-op" refactor produced.

**Deliverable:** A one-paragraph note. Sometimes "no-op" refactors change escape behavior or inlining; the trace surfaces those.

---

## Task 13: Trace + pprof combined workflow

Pick a benchmark in your codebase. Capture *both* a CPU profile and a trace over the same 5-second window. In the trace, find the function whose `Running` slices dominate the timeline; in the CPU profile, find the same function in `top`.

**Goal:** Practice cross-tool corroboration. Build the habit: a "slow" function should show up in both, or the discrepancy is itself a signal.

**Deliverable:** The two tool outputs side-by-side and a short note on whether they agreed.

---

## Stretch task: a steady-state probe

Add a small goroutine to your service that, once per hour, runs a synthetic load (10 known requests) and captures a 1-second trace. Store traces with a date suffix.

**Goal:** Establish a baseline. Weeks later, compare any new trace against last month's same hour.

**Deliverable:** The probe code and a directory of archived traces. This is the prototype of the "trace-first regression detection" pattern senior teams use.

---

## Further reading
- `runtime/trace`: https://pkg.go.dev/runtime/trace
- "Diagnose user-perceived latency with execution traces": https://go.dev/blog/execution-traces-2024
- `golang.org/x/exp/trace`: https://pkg.go.dev/golang.org/x/exp/trace
- Felix Geisendorfer, "Reading a Go trace": https://blog.felixge.de/reading-go-execution-traces/
