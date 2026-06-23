---
layout: default
title: Tasks
parent: Fan-Out Within Pipeline
grand_parent: Pipeline Production Patterns
ancestor: Go
nav_order: 8
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/19-pipeline-production-patterns/03-fan-out-within-pipeline/tasks/
---

# Fan-Out Within a Pipeline Stage — Tasks

Hands-on exercises. Each task lists what to build, the acceptance criteria, and the expected behaviour. Solve in order; later tasks build on earlier ones.

## Task 1: Baseline serial pipeline
Write a pipeline that reads integers 1..1000 from a producer, doubles each (with a `time.Sleep(1 * time.Millisecond)` simulation of work), and prints the result.

Acceptance:
- Output is `2, 4, 6, ...` in order.
- Total runtime is approximately 1 second.
- Code is structured as `producer` → `doubler` → `printer`, with each stage as a function returning `<-chan int`.

## Task 2: Unordered fan-out
Modify Task 1's `doubler` to use 8 workers. Verify the wall-clock time drops to roughly 1/8th.

Acceptance:
- Output values are still 2, 4, ..., 2000 — but their order is now unpredictable.
- Total runtime is approximately 125 ms.
- The closer goroutine pattern is used.

## Task 3: Ordered fan-out via sequence numbers
Extend Task 2 so the output appears in input order despite 8 workers and variable per-item delays.

Acceptance:
- Output is strictly 2, 4, 6, ..., 2000.
- Per-item work uses `time.Sleep(rand.Intn(5) * time.Millisecond)` so order would naturally be lost without explicit reordering.
- Use a `Tagged[int]` wrapper with `Seq int64` and a reorder buffer.

## Task 4: Cancellation-aware fan-out
Take the unordered fan-out from Task 2. Add `context.Context` support. Cancel the context after 50 ms while items are still in flight. Verify that all goroutines exit within 5 ms of cancellation.

Acceptance:
- Use `runtime.NumGoroutine()` before and after the run; the post-cancellation count is the same as the pre-run baseline.
- The output channel is closed normally.
- No data race under `-race`.

## Task 5: Per-key fan-out
Build a pipeline that processes events. Each event has a `Key string` and a `Value int`. Within each key, events must be processed in input order; across keys, events can run in parallel.

Acceptance:
- 6 workers, dispatch by hash of key.
- For each key, output values appear in input order.
- Across keys, output order is unpredictable.

## Task 6: Concurrency-bounded fan-out for HTTP
Build a stage that fetches a list of URLs concurrently with N = 8, returning status codes. Use `context.Context` for timeout (5 seconds total).

Acceptance:
- Returns one result per URL with `StatusCode int, Err error`.
- Total runtime is dominated by the slowest URL, not by sum.
- Cancelling the context aborts in-flight requests promptly.

## Task 7: Failure-mode comparison
Build the same pipeline three times: continue-on-error, fail-fast (using `errgroup.WithContext`), and first-success.

Acceptance:
- Continue-on-error processes all items, errors in result struct.
- Fail-fast cancels remaining work on first error.
- First-success returns the first non-error result and cancels the rest.
- A test demonstrates each mode's behaviour.

## Task 8: Configurable widths
Extract a `Config` struct that holds widths for three stages: fetch, parse, write. Default values come from env vars `FETCH_WORKERS`, `PARSE_WORKERS`, `WRITE_WORKERS`. Set sensible fallbacks.

Acceptance:
- Running with `FETCH_WORKERS=4 PARSE_WORKERS=2 WRITE_WORKERS=8 ./binary` uses those widths.
- A test sets the values and asserts the actual goroutine counts during run.

## Task 9: Backpressure observation
Build a pipeline whose consumer is artificially slow (1 read per 100 ms). Verify that the workers in the upstream fan-out also slow down. Measure the channel's effective fill rate.

Acceptance:
- Workers do not spin or busy-wait; they block on send.
- Producer also blocks on send to `in`.
- A metric exposed on `expvar` shows the channel's depth over time.

## Task 10: Hedged fan-out
Build a stage that, for each item, calls a function `tryFetch(ctx, item) (string, error)` twice with a 50 ms stagger; returns the first successful response.

Acceptance:
- If the primary completes within 50 ms, the hedge is never started.
- If the primary takes longer than 50 ms, the hedge is started; whichever returns first wins, the loser is cancelled.
- Test with a function that takes random 0-100 ms and verify median latency is below 50 ms despite primary's slower tail.

## Task 11: Reorder buffer test
Write a unit test for the reorder buffer from Task 3:

- 100 sequence numbers, processed in shuffled order by N=10 workers.
- Assert output is in strict input order.
- Assert the buffer never holds more than N items.
- Assert the buffer is empty at end.

## Task 12: Goroutine leak detection
Take any of the fan-out implementations from earlier tasks. Add a `goleak.VerifyNone(t)` call to a test. Intentionally break one fan-out (e.g., remove `<-ctx.Done()` from the worker's outer select), and verify `goleak` catches the leak.

Acceptance:
- Original code passes `goleak`.
- Broken code fails `goleak` with a clear message identifying the leaked goroutine.

## Task 13: Benchmark widths
Write a benchmark that runs the fan-out at N = 1, 2, 4, 8, 16, 32. Use a 5 ms per-item sleep to simulate work. Plot the resulting throughput.

Acceptance:
- Output shows throughput per N.
- Throughput scales approximately linearly until some saturation point.
- A regression below baseline at any N is investigated and explained.

## Task 14: Per-worker metrics with cache-line padding
Each worker counts processed items and total processing time. Without padding first, then with cache-line padding (64-byte aligned). Measure the difference.

Acceptance:
- Two implementations: unpadded and padded.
- Benchmark shows padded is meaningfully faster on a multi-core machine (10%+) under heavy contention.

## Task 15: Per-tenant bulkhead
Build a stage that takes `(tenant string, payload Payload)` items. Each tenant has a bounded worker pool (default 4 workers per tenant). One slow tenant must not affect others.

Acceptance:
- Tenant A submits 100 items, each taking 1 second.
- Tenant B submits 100 items, each taking 10 ms.
- Tenant B's items complete in ~3 seconds, not 100 seconds.

## Task 16: Cross-stage cancellation
Build a 3-stage pipeline where each stage fans out to 4 workers. Cancel from the consumer side. Verify all 12 workers + 3 closers exit within 100 ms.

Acceptance:
- `runtime.NumGoroutine()` returns to baseline within 100 ms.
- No data races under `-race`.
- Output channel of the last stage is closed.

## Task 17: Streaming fan-out from a real source
Use `bufio.Scanner` to read lines from a 100 MB file. Fan out lowercase+hash computation across 8 workers. Write hashes to stdout.

Acceptance:
- Memory does not grow unbounded.
- Throughput is roughly 8x a single-worker baseline.
- Handles a Ctrl-C cleanly.

## Task 18: Worker pool reuse across batches
Build a worker pool that lives across multiple batches. Each batch's items go through; pool stays alive between batches.

Acceptance:
- One process, many batches.
- Pool spawns workers once; reuses for every batch.
- A `Stop()` method cleanly shuts down all workers.

## Task 19: AIMD adaptive width
Build a wrapper around fan-out that adjusts N over time based on observed latency. Below target latency, N grows by 1 per second; above, N halves.

Acceptance:
- During steady-state, N converges near a stable value.
- During a synthetic spike (latency jumps), N drops fast.
- N is bounded between minN and maxN.

## Task 20: Production-grade composite pipeline
Compose Tasks 6, 8, 12, 14, 15, 16 into one pipeline:

- 3 stages, configurable widths, per-tenant bulkheads.
- Cancellation through ctx; clean shutdown.
- `expvar`/Prometheus metrics: items_in/out/errors, in-flight, queue depth, per-tenant counts.
- `goleak` test passes.
- Documentation comments specify ordering, error policy, cancellation behaviour per stage.

This task is the equivalent of one production-ready pipeline module. It should compile, test under `-race`, and run with `goleak` clean.

---

## Stretch Tasks

### Stretch 1: Implement a tiny `errgroup.SetLimit` from scratch
Without using the `errgroup` package, build a small helper with the same API. Use a semaphore (buffered channel of struct{}) for the limit.

### Stretch 2: Work-stealing fan-out
Build a fan-out where workers prefer their own local queue but steal from siblings when idle. Compare throughput against the shared-channel pattern under microsecond-scale work.

### Stretch 3: Cross-process fan-out via Kafka
Set up a local Kafka. Producer publishes 1M items to a topic with 10 partitions. Two consumer processes each fan out to 8 workers. Verify total throughput, end-to-end latency, and that one process crash leads to rebalance.

### Stretch 4: Causal-order fan-out
Build a fan-out where items carry causal dependencies (`Item.DependsOn []ItemID`). The fan-out processes items only after their dependencies are complete. Maintain a dependency graph.

### Stretch 5: Saga across fan-out stages
Build a 3-stage pipeline where each stage's effect is reversible. On failure mid-pipeline, the saga compensates each completed stage in reverse order. Verify the compensation runs to completion even under cancellation.
