---
layout: default
title: Fan-In Fan-Out Within — Tasks
parent: Fan-In Fan-Out Within
grand_parent: Pipeline Production Patterns
ancestor: Go
nav_order: 8
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/19-pipeline-production-patterns/05-fan-in-fan-out-within/tasks/
---

# Fan-In / Fan-Out Inside a Pipeline — Tasks

Hands-on exercises building fan-out and fan-in stages. Work through them in order. Each task builds on the previous. Use the canonical patterns from the junior and middle files; do not look up implementations until you have tried.

---

## Task 1: The two-channel merge

Write a function:

```go
func merge2(a, b <-chan int) <-chan int
```

That returns a channel which emits every value from `a` and every value from `b` in some interleaved order, and closes when both `a` and `b` are closed.

**Test:**

```go
func TestMerge2(t *testing.T) {
    a := make(chan int)
    b := make(chan int)
    go func() { a <- 1; a <- 2; close(a) }()
    go func() { b <- 10; b <- 20; close(b) }()
    var got []int
    for v := range merge2(a, b) {
        got = append(got, v)
    }
    if len(got) != 4 {
        t.Fatalf("expected 4 values, got %d", len(got))
    }
}
```

Run under `-race`. Should pass without any races.

---

## Task 2: The N-channel merge

Generalise Task 1 to a variadic merge:

```go
func merge(cs ...<-chan int) <-chan int
```

Verify with 3, 5, and 0 input channels.

For 0 inputs, the function should return an immediately-closed channel.

---

## Task 3: Generic merge

Make it generic:

```go
func merge[T any](cs ...<-chan T) <-chan T
```

Verify it works with `string`, `struct`, and pointer types.

---

## Task 4: A simple fan-out worker pool

Write:

```go
func pool(in <-chan int, n int, fn func(int) int) <-chan int
```

That spawns `n` workers reading from `in`, each computing `fn(v)`, sending to a merged output. Output is closed when `in` closes.

**Verify:** Sum the input and verify the output's sum (assuming `fn` is invertible or transparently invertible like `2*v`).

---

## Task 5: Pool with context cancellation

Extend Task 4 to accept `context.Context` and respect `ctx.Done()` in every blocking operation. Verify that cancelling the context shuts down the pool cleanly.

**Test:** Send 1 million inputs with a slow `fn`. Cancel after 100 ms. Verify no goroutines leak (use `go.uber.org/goleak`).

---

## Task 6: Hash files in parallel

Write a program that:

1. Takes a list of file paths from os.Args.
2. Hashes each file (SHA-256).
3. Prints `filename: hash` to stdout.
4. Uses a worker pool with fan-out factor 4.
5. Respects cancellation on SIGINT.

The output order does not need to match the input order.

---

## Task 7: Ordered output

Modify Task 6 to print results in input order (the same order as the command-line arguments).

Hint: tag each input with its index; reorder on output.

---

## Task 8: Bounded HTTP fetcher

Write:

```go
func fetchURLs(ctx context.Context, urls []string, workers int) ([]string, error)
```

That fetches each URL in parallel with up to `workers` concurrent fetches, returns the response bodies as strings in input order, and propagates errors via `errgroup`.

Use `http.NewRequestWithContext` so the HTTP calls respect ctx.

---

## Task 9: Tagged stream + reorder

Write a tag-and-reorder pipeline:

```go
type Tagged[T any] struct {
    Seq int
    Val T
}

func tag[T any](ctx context.Context, in <-chan T) <-chan Tagged[T]
func reorder[T any](ctx context.Context, in <-chan Tagged[T]) <-chan T
```

`tag` adds monotonic sequence numbers. `reorder` emits in sequence order using a map of pending values.

**Test:** Pipe through a "shuffle" function that randomises arrival order. Verify the final output is in input order.

---

## Task 10: Priority merge

Write a function:

```go
func priorityMerge[T any](ctx context.Context, high, low <-chan T) <-chan T
```

That prefers `high` over `low`. If `high` has a value, emit it before any `low` value. If `high` is empty, emit from `low`.

Test that under high load on `high`, `low` is starved. Then add a quota (every N high items, allow one low) and test that low is no longer starved.

---

## Task 11: Hedged HTTP request

Write:

```go
func hedgedGet(ctx context.Context, urls []string, hedgeDelay time.Duration) ([]byte, error)
```

Send the request to the first URL. If no response within `hedgeDelay`, send to the second URL too. Whichever responds first wins; cancel the others.

---

## Task 12: Worker pool with retry

Each worker, on error, retries up to 3 times with exponential backoff. After 3 failures, the item goes to a DLQ channel.

```go
func poolWithRetry[I, O any](ctx context.Context, in <-chan I, workers int, fn func(context.Context, I) (O, error)) (<-chan O, <-chan I)
```

Returns (out, dlq). Successful items go to out; permanently-failed items go to dlq.

---

## Task 13: Supervisor

Write a supervisor function:

```go
func supervise(ctx context.Context, name string, fn func(ctx context.Context) error, maxAttempts int) error
```

Recovers panics, retries with backoff, respects ctx, escalates after max attempts.

**Test:** Inject a function that fails twice then succeeds. Verify supervisor calls it 3 times.

---

## Task 14: A pub-sub broker

Write a pub-sub broker:

```go
type Broker[T any] struct{...}

func NewBroker[T any](ctx context.Context) *Broker[T]
func (b *Broker[T]) Publish(v T)
func (b *Broker[T]) Subscribe(buf int) (id int, ch <-chan T)
func (b *Broker[T]) Unsubscribe(id int)
```

Dispatch goroutine receives published values and sends to every subscriber. Slow subscribers cause drops (use `select` with `default`).

**Test:** Subscribe two, publish 100 messages, verify both receive them. Subscribe a slow one; verify it drops some.

---

## Task 15: Dynamic merge with reflect.Select

Write a dynamic merge that supports adding and removing channels at runtime:

```go
type DynMerger[T any] struct {...}
func NewDynMerger[T any](ctx context.Context) *DynMerger[T]
func (d *DynMerger[T]) Add(c <-chan T)
func (d *DynMerger[T]) Out() <-chan T
```

Use `reflect.Select` internally.

**Test:** Add three channels, send values on each, verify all received. Add a fourth at runtime; verify also received.

---

## Task 16: Streaming aggregation

Build a pipeline that:

1. Consumes integers from a channel (the "event stream").
2. Aggregates by even/odd into two streams.
3. Each stream is reduced by sum.
4. Emits one (even-sum, odd-sum) pair per 1 second.

Use multiple workers per stream.

---

## Task 17: ETL with checkpointing

Build a pipeline that:

1. Reads integers from a "source" (a slice).
2. Doubles each.
3. Writes to a "destination" (a slice).
4. After each batch of 10, writes a "checkpoint" (the highest index processed) to a file.
5. On restart, resumes from the checkpoint.

Verify safe restart: simulate a crash mid-stream and verify the second run completes correctly.

---

## Task 18: Throughput benchmark

Write a benchmark that measures items/sec for:

1. A direct loop (no goroutines).
2. A fan-out of 4 workers.
3. A fan-out of 8 workers.
4. A fan-out of 16 workers.

Plot the results. Identify the bottleneck.

---

## Task 19: Latency measurement

Modify Task 18 to measure per-item latency (time from input to output). Compute p50, p99, p9999.

Identify the source of tail latency.

---

## Task 20: Bulkheaded pipeline

Build a pipeline where one worker may panic on a specific input. The pipeline continues processing other items; the panicking item is logged to a DLQ.

Verify under load that the panic does not crash the pipeline.

---

## Task 21: Hierarchical merge

For a pipeline with 64 inputs, implement:

1. A canonical merge over all 64 (uses `reflect.Select` or N forwarders).
2. A hierarchical static merge: groups of 8, then merged.

Compare benchmarks. Hierarchical should be faster.

---

## Task 22: Auto-scaling worker pool

Build a pool that:

1. Starts with `minWorkers` workers.
2. Every 5 seconds, measures the channel fill ratio.
3. If fill > 80%, adds a worker (up to `maxWorkers`).
4. If fill < 20%, removes a worker (down to `minWorkers`).

Test by varying input rate; verify the pool scales.

---

## Task 23: Read-copy-update config

Build a config struct shared by all workers via `atomic.Pointer`. The config can be updated at runtime; workers see the new config on their next iteration.

Verify that updates are atomic (workers see either old or new, never inconsistent).

---

## Task 24: A real-world tool

Build a CLI tool: `wcl` — like Unix `wc -l` (line count) but for many files in parallel.

```bash
wcl file1.txt file2.txt file3.txt
```

Output:

```
file1.txt: 100
file2.txt: 250
file3.txt: 1500
TOTAL: 1850
```

Use fan-out for file processing, fan-in for results, ordered output.

---

## Task 25: A real-world service

Build a small HTTP service:

- POST `/process` with JSON body containing a list of items.
- Server processes items in parallel (fan-out).
- Returns results in input order (fan-in + reorder).
- Respects request cancellation.

Test under load with `wrk` or similar.

---

## Bonus: Memory-bounded reorder

Modify the reorder stage from Task 9 to cap the buffer at 10 000 entries. When the cap is reached, the stage stalls (does not read more input) until the buffer drains.

Verify under skewed work: one item is artificially slow, others arrive quickly. The buffer fills but does not exceed 10 000.

---

## Bonus: Lock-free SPSC queue

Implement a single-producer single-consumer lock-free queue using `atomic` ops. Benchmark vs a Go channel.

For a fixed-size SPSC, the lock-free version should be 5-10x faster than a channel.

---

## Bonus: TUI dashboard

Build a TUI dashboard (using `tview` or similar) that shows live pipeline metrics:

- Items per second per stage.
- Channel fill ratio per channel.
- Goroutine count.
- Errors per second.

Update every second.

---

## Working Through the Tasks

Recommended pace: 3-5 tasks per day for a junior; 5-10 per day for a middle; 10-15 per day for a senior. The tasks build progressively; do not skip.

For each task:

1. Implement.
2. Write tests (especially leak tests with `goleak`).
3. Benchmark.
4. Profile if performance is a concern.
5. Reflect on what you learned.

Compare your implementation to the canonical version (in the educational files). Note differences. Understand why one is better.

After completing 1-15, you have done all the patterns from junior and middle. After 16-25, you have built production-shaped pipelines. The bonuses are for those going deep.

---

## Self-Check Before Moving On

You are ready for senior-level material when:

- [ ] You can write the canonical merge from memory.
- [ ] You have built a tag-and-reorder pipeline.
- [ ] You have used `errgroup` with `SetLimit`.
- [ ] You have tested cancellation paths.
- [ ] You have used `goleak.VerifyNone` in a test.
- [ ] You have profiled at least one pipeline.

You are ready for professional-level material when:

- [ ] You have read `runtime/chan.go`.
- [ ] You have used `runtime/trace` to debug a pipeline.
- [ ] You have benchmarked `reflect.Select` vs static and seen the cost difference.
- [ ] You have diagnosed and fixed a real performance bug.

---

## Hints for Stuck Points

### Stuck on Task 5 (cancellation)

Your forwarder reads `for v := range c` but cannot exit when ctx cancels. Fix: change to a select pattern:

```go
for {
    select {
    case v, ok := <-c:
        if !ok {
            return
        }
        // ... forward v
    case <-ctx.Done():
        return
    }
}
```

### Stuck on Task 9 (reorder)

The reorder stage needs to remember which sequence comes next and what is pending. Start with `next := 0` and `pending := map[int]T{}`. On each arrival, add to pending; then loop emitting from pending while the next sequence is present.

### Stuck on Task 15 (reflect.Select)

The `cases` slice must be rebuilt each iteration when new channels are added. The key insight: a `case` with `Chan: reflect.ValueOf((chan T)(nil))` is permanently disabled. Use this to "remove" channels that have been closed.

### Stuck on benchmarks

Don't forget `b.ResetTimer()` after setup. Don't allocate channels inside the benchmarked loop (do that in setup).

---

## Hand-In Format (if asked)

For a code review or interview submission:

1. Each task in its own file or subdirectory.
2. Test file alongside.
3. README describing the task and your approach.
4. Benchmark results in a `RESULTS.md`.
5. Profile flame graph for at least one task in `flame.svg`.

This level of polish signals seriousness. Recommended for senior-level submissions.

---

## End of Tasks

Once you have completed Tasks 1-25, you have built every pattern in this curriculum. The bonuses are extras. Move on to senior-level reading with confidence.

Good engineering is built on practice. Practice these patterns until they are reflex.

---

## Additional Practice Drills

### Drill A: Refactor a sequential function to a pipeline

Take a function that does:

```go
func process(items []Item) []Result {
    results := make([]Result, len(items))
    for i, item := range items {
        results[i] = transform(item)
    }
    return results
}
```

Refactor to a fan-out / fan-in pipeline with worker pool. Benchmark before and after for a CPU-bound `transform`.

### Drill B: Refactor a network-bound loop

Take:

```go
func crawl(urls []string) []Response {
    var responses []Response
    for _, u := range urls {
        responses = append(responses, fetch(u))
    }
    return responses
}
```

Refactor to use bounded fan-out (8 concurrent fetches). Use `errgroup`.

### Drill C: Add metrics

Take any of your task implementations and add Prometheus-style metrics:

- Items processed.
- Errors.
- Latency histogram.

Verify the metrics increment correctly under test load.

### Drill D: Add tracing

Add OpenTelemetry tracing to one of your pipelines. Each item should have a trace context propagated through every stage. Verify the trace in Jaeger or similar.

### Drill E: Chaos test

Take Task 25 (HTTP service). Run a chaos test:

- 10% of requests use ctx with a 10ms timeout.
- 5% of requests fail in a random worker.
- 1% of requests cause a worker panic.

Verify the service stays up and reports the chaos via metrics.

---

## Reading Recommendation

After completing the tasks, read:

- Go blog: *Pipelines and Cancellation* (read once you have built a pipeline).
- *Concurrency in Go* (Cox-Buday), chapters 4-5.
- Russ Cox: *Bell Labs and CSP threads*.
- Sameer Ajmani: *Go Concurrency Patterns: Context*.

These give you the canonical Go-ecosystem framing of the patterns you have practiced.

---

## Wrapping Up

You have done the work. Move on to senior reading or to actual production projects. The patterns are now in your hands.

