# Generator Pattern — Tasks

Practical exercises ordered easy → hard. Each task includes a problem statement, hints, and an acceptance test outline. Solve them in order; later tasks build on earlier templates.

---

## Task 1. Variadic generator

**Problem.** Implement `Gen[T any](values ...T) <-chan T` that yields each value in order and closes the channel on completion.

**Hints.**
- One goroutine inside.
- `defer close(out)` first thing.
- Return `<-chan T`, not `chan T`.

**Test outline.**
```go
got := collect(Gen(1, 2, 3))
want := []int{1, 2, 3}
// got == want; channel was closed.
```

**Bonus.** Confirm that `Gen[int]()` (empty) closes the channel without sending.

---

## Task 2. Slice generator with a buffer

**Problem.** Implement `FromSlice[T any](s []T, buf int) <-chan T`. The output channel has capacity `buf`. Measure how `buf` affects throughput when the consumer sleeps 1ms between reads.

**Hints.**
- `make(chan T, buf)`.
- Use `time.Now()` deltas to measure.
- Try `buf` values: 0, 1, 8, 64, 256.

**Acceptance.**
- For `buf=0`, total time ≈ `len(s) × 1ms`.
- For larger buffers, total wall time is the same (consumer is the bottleneck), but producer's `chansend` time drops.

---

## Task 3. Cancellable counter

**Problem.** Implement `Counter(ctx context.Context) <-chan int` that yields 0, 1, 2, ... until `ctx` is cancelled. The producer goroutine must exit and the channel must close within 100ms of cancellation.

**Hints.**
- `for { select { case <-ctx.Done(): return; case out <- i: } }`
- Test with `context.WithCancel`.

**Test outline.**
```go
ctx, cancel := context.WithCancel(context.Background())
ch := Counter(ctx)
<-ch; <-ch; <-ch
cancel()
deadline := time.After(100 * time.Millisecond)
for {
    select {
    case _, ok := <-ch:
        if !ok { return } // closed cleanly
    case <-deadline:
        t.Fatal("counter did not stop")
    }
}
```

---

## Task 4. Line scanner

**Problem.** Implement `Lines(ctx context.Context, path string) (<-chan string, error)` that yields lines from a text file. Setup errors (file not found) are returned synchronously. Scanner errors mid-stream are dropped silently.

**Hints.**
- Open the file synchronously before spawning the goroutine.
- `defer close(out)` and `defer f.Close()` in the correct order.
- Use `bufio.Scanner`.

**Test outline.**
- Test with a 3-line file: get exactly 3 lines.
- Test with a missing file: get `err != nil`, no channel.
- Test cancellation mid-stream: cancel after one line; channel closes.

---

## Task 5. Line scanner with errors

**Problem.** Extend Task 4: errors from `Scanner.Err()` are surfaced as `Result[string]{Err: ...}` on the channel before close.

**Hints.**
- Define `type Result[T any] struct { Value T; Err error }`.
- After `s.Scan()` returns false, check `s.Err()` and emit if non-nil.

**Test outline.**
- Inject a reader that returns a synthetic error after 2 lines.
- Consumer reads 2 values successfully, then a `Result{Err: ...}`, then the channel closes.

---

## Task 6. REST paginator

**Problem.** Implement `Pages(ctx context.Context, fetch func(cursor string) (Page, error)) <-chan Item` where `Page` has `Items []Item` and `Next string`. The generator yields items across all pages; pagination stops when `Next == ""`.

**Hints.**
- Outer loop over pages; inner loop over items.
- Cancellation `select` inside the inner loop.
- On `fetch` error, exit silently (or surface via `Result` for the bonus).

**Acceptance.**
- Mock `fetch` returning 3 pages of 2 items each → 6 items yielded.
- Mock `fetch` returning an error on page 2 → 2 items yielded, then channel closes.
- Cancel mid-page → no more than `pageSize - 1` extra items yielded.

---

## Task 7. Directory walker

**Problem.** Implement `Walk(ctx context.Context, root string) <-chan string` that yields every file path under `root` (skipping directories).

**Hints.**
- `filepath.WalkDir` is callback-based; wrap it.
- In the callback, send to the channel; check `ctx.Done()` to return `filepath.SkipAll`.

**Test outline.**
- Create a temp dir with 5 files in nested subdirs.
- Yield exactly those 5 paths.
- Cancel after 2; verify no more than ~3 are yielded (depends on buffering).

---

## Task 8. Tee a generator

**Problem.** Implement `Tee[T any](ctx context.Context, in <-chan T) (<-chan T, <-chan T)`. Every value from `in` must appear on *both* outputs.

**Hints.**
- One goroutine reads from `in`, sends to both outputs.
- Use `nil` channel trick in `select` to avoid re-sending after one output has accepted.

**Acceptance.**
- `Gen(1, 2, 3)` tee'd → both outputs yield `[1, 2, 3]`.
- Both outputs close after `in` closes.
- Slow consumer on output A does *not* prevent output B from receiving (or does — document your choice).

---

## Task 9. Fan-out source

**Problem.** Implement a helper that takes a generator and N consumer functions; each consumer is a goroutine that reads from the source.

```go
func FanOut[T any](ctx context.Context, src <-chan T, n int, consume func(int, T)) {
    var wg sync.WaitGroup
    for i := 0; i < n; i++ {
        wg.Add(1)
        go func(id int) {
            defer wg.Done()
            for v := range src {
                consume(id, v)
            }
        }(i)
    }
    wg.Wait()
}
```

**Acceptance.**
- 100 values, 4 consumers: each consumer sees ~25 values (probabilistic).
- All 100 values are consumed exactly once across consumers.

---

## Task 10. Bridge

**Problem.** Implement `Bridge[T any](ctx context.Context, chans <-chan <-chan T) <-chan T` that flattens a channel of channels.

**Hints.**
- Outer loop reads inner channels from `chans`.
- Inner loop ranges over each inner channel, forwarding.
- Cancellation observed in both loops.

**Acceptance.**
- A generator that yields three `<-chan int`, each yielding `[1,2,3]`, when bridged, yields 9 values total.

---

## Task 11. Convert iterator to channel

**Problem.** Given a Go 1.23 `iter.Seq[T]`, write `ToChan[T any](ctx context.Context, seq iter.Seq[T]) <-chan T`.

**Hints.**
- `for v := range seq { ... }` inside the producer goroutine.
- Cancellation `select` for each send.

**Acceptance.**
- `slices.Values([]int{1,2,3})` ranged via `ToChan` yields `[1,2,3]`.

---

## Task 12. Convert channel to iterator

**Problem.** Given `<-chan T`, write `FromChan[T any](ch <-chan T) iter.Seq[T]`.

**Hints.**
- The returned function calls `yield(v)` and stops if `yield` returns `false`.

**Acceptance.**
- `Gen(1, 2, 3)` wrapped via `FromChan` and ranged yields `[1,2,3]`.
- Calling `break` early stops yielding (but does *not* cancel the upstream — document this).

---

## Task 13. Throttled generator

**Problem.** Wrap any `<-chan T` to emit at most N items per second.

```go
func Throttle[T any](ctx context.Context, in <-chan T, perSec int) <-chan T
```

**Hints.**
- `time.NewTicker(time.Second / time.Duration(perSec))`.
- For each tick, forward one item.
- `defer ticker.Stop()`.

**Acceptance.**
- 100 items, 10/sec → ~10 seconds total.
- Cancellation respected within one tick.

---

## Task 14. Batching generator

**Problem.** Wrap `<-chan T` into `<-chan []T` that emits batches of up to N items (or flushes on a timeout if fewer arrive).

```go
func Batch[T any](ctx context.Context, in <-chan T, size int, flush time.Duration) <-chan []T
```

**Hints.**
- Accumulate in a slice.
- Reset a timer on each accumulation; flush on size or timer.
- Final flush of partial batch when `in` closes.

**Acceptance.**
- 10 items in fast → one batch of 10 (if size>=10).
- 3 items, then pause longer than flush → one batch of 3 emitted.
- Channel closes after last batch.

---

## Task 15. Primes by sieve of generators

**Problem.** Reproduce the classic concurrent primes sieve using one generator per prime, each filtering its predecessor's output.

```go
func Primes(ctx context.Context, n int) <-chan int
```

**Hints.**
- One generator yields all integers starting at 2.
- For each prime found, spawn a filter that drops multiples and feeds the next stage.
- Stop after `n` primes.

**Acceptance.**
- `Primes(ctx, 10)` yields `[2,3,5,7,11,13,17,19,23,29]`.
- Cancellation stops the entire chain.

This task is harder than it looks; the goroutine accounting is the main risk.

---

## Task 16. Resumable cursor generator

**Problem.** Build a `Stream(ctx context.Context, fromCursor string) <-chan Event` where each `Event` carries the cursor that produced it. Demonstrate a consumer that persists the cursor and resumes after a "crash".

**Hints.**
- Embed `Cursor` in the `Event` type.
- The consumer writes the last cursor to a local file or in-memory store.
- Simulate a crash by cancelling `ctx`; restart with the saved cursor.

**Acceptance.**
- Run, process 5 events, "crash", restart with saved cursor, get the next 5 events — no duplicates, no gaps.

---

## Task 17. Generator with structured concurrency

**Problem.** Wrap a generator and its consumer in an `errgroup.Group` so that if either fails, both shut down cleanly.

**Hints.**
- `g, ctx := errgroup.WithContext(parent)`.
- Pass the derived `ctx` to the generator.
- Both `g.Go` calls return errors; `g.Wait()` returns the first.

**Acceptance.**
- Forced consumer error cancels the producer; `g.Wait()` returns that error.
- Forced producer error stops the consumer.
- No goroutines leak (verify with `goleak`).

---

## Task 18. Production-grade source

**Problem.** Build a `KafkaSource(ctx context.Context, topic string) <-chan Event` (mock the Kafka client) with:
- Configurable buffer size.
- Per-batch fetch.
- Cursor-based resumption.
- Streaming errors via `Result[Event]`.
- Prometheus-style counter and saturation gauge.
- Goroutine label via `pprof.SetGoroutineLabels`.
- Leak-free under `goleak`.

**Hints.**
- Compose from earlier tasks: paginator + batching + error propagation.
- Document the contract in the doc-comment.

**Acceptance.**
- Three integration scenarios:
  1. Steady load — yields events at expected rate.
  2. Transient fetch error — retries internally, no error surfaced.
  3. Permanent fetch error — emits `Result{Err: ...}`, exits cleanly.
- Cancellation in all three closes the channel within 100ms.
- `goleak.VerifyNone` passes.

---

## Task 19. Benchmark channel generator vs iterator

**Problem.** Benchmark `Counter` (channel) vs `CounterSeq` (`iter.Seq`) for one million yielded ints. Report ns/op for each.

**Hints.**
- `go test -bench`.
- Use `b.N` ints, not a fixed million.
- Run both with and without `-race`.

**Expected outcome.**
- `iter.Seq` is roughly 10× faster than the channel form.
- Document the result; use it to justify when to pick each.

---

## Task 20. Refactor a callback-based API to a generator

**Problem.** Given a hypothetical `func Process(path string, cb func(line string) error) error` (callback-based), wrap it as a cancellable generator `Lines(ctx, path) <-chan Result[string]` without modifying `Process`.

**Hints.**
- The wrapper goroutine calls `Process`; the callback sends on the channel.
- Cancellation: when `ctx.Done()` fires, the callback returns a sentinel error that `Process` propagates.
- The wrapper translates that sentinel back to nothing (it's the cancel signal, not a real error).

**Acceptance.**
- Callback-based API unchanged.
- The generator's channel closes on EOF or on cancellation, leaking no goroutines.
