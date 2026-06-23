# Tee-Channel — Practice Tasks

A series of graded exercises. Each task lists the goal, suggested signature, and a short hint. Acceptance criteria appear at the end of each task. Solutions are intentionally not included; check yours against the specifications in [specification.md](specification.md).

---

## Level 1 — Mechanics

### Task 1.1: Hand-write the canonical tee

**Goal.** Implement `Tee[T any](done <-chan struct{}, in <-chan T) (<-chan T, <-chan T)` from memory. No copy-paste.

**Hint.** Two `defer close`, outer `for v := range in`, inner two-iteration `select` with the nil-channel trick.

**Acceptance.**
- A test that sends 10 integers and verifies both outputs receive `[1..10]` passes.
- A test that closes `done` mid-stream and verifies both outputs eventually close passes.

### Task 1.2: A "broken" tee using sequential sends

**Goal.** Write a deliberately-broken tee where the body is:

```go
for v := range in {
    out1 <- v
    out2 <- v
}
```

Then write a test that demonstrates the consequence: with a slow `out2` consumer, the `out1` consumer waits behind `out2`. Compare against the canonical tee on the same workload.

**Acceptance.** Benchmark or timed test shows `out1` latency is bounded by `out2`'s consumer pace in the broken version, and roughly half that in the canonical version.

### Task 1.3: Tee a stream of strings

**Goal.** Use the generic `Tee` on a `<-chan string` source. Produce two consumers that print the value to stdout with a tag.

**Acceptance.** Output shows each value printed twice (once per consumer), interleaved.

---

## Level 2 — Variants

### Task 2.1: Symmetric buffered tee

**Goal.** Implement `TeeBuf[T any](done <-chan struct{}, in <-chan T, buf int) (<-chan T, <-chan T)`.

**Hint.** Same body, different channel creation: `make(chan T, buf)`.

**Acceptance.** A test where one consumer sleeps 50ms per receive verifies the producer makes up to `buf` items of progress before being paced.

### Task 2.2: Asymmetric tee

**Goal.** Implement `TeeAsym[T any](done <-chan struct{}, in <-chan T, bufA, bufB int) (<-chan T, <-chan T)`.

**Acceptance.** With `bufA=0, bufB=8`, the slow B consumer should not block A for the first eight values.

### Task 2.3: Lossy asymmetric tee with drop counter

**Goal.** Implement:

```go
func TeeLossy[T any](done <-chan struct{}, in <-chan T, buf int) (
    critical, lossy <-chan T, dropped func() uint64,
)
```

The critical branch must never drop. The lossy branch should drop on overflow and increment a counter.

**Hint.** Use `atomic.Uint64` for the counter. The lossy send is a `select` with `default`.

**Acceptance.** A test that intentionally stalls the lossy consumer shows the dropped counter increases while the critical consumer continues to receive every value.

### Task 2.4: Drop-oldest lossy tee

**Goal.** Same as 2.3, but on overflow drop the *oldest* buffered value rather than the new one.

**Hint.** A `select { case <-l: default: }` removes one value, then the regular send tries again.

**Acceptance.** Test demonstrates that under sustained overflow, the most recent N values are retained.

### Task 2.5: Sampled tee (every Nth)

**Goal.** Implement a tee where the secondary branch receives only every Nth value.

**Acceptance.** With N=10 and a 100-value input, the primary receives 100 values and the secondary receives 10.

---

## Level 3 — Composition

### Task 3.1: Three-way tee via chaining

**Goal.** Use two `Tee` calls to produce three outputs, each receiving every input value.

**Hint.** `a, rest := Tee(done, in); b, c := Tee(done, rest)`.

**Acceptance.** All three outputs receive identical sequences.

### Task 3.2: Balanced four-way tee

**Goal.** Same, for four outputs, but build a balanced tree of depth two rather than a linear chain.

**Acceptance.** Latency from input to each output is approximately equal (within scheduler tolerance).

### Task 3.3: Tee + `or-done-channel`

**Goal.** Wrap each output of a tee with `orDone` from the sibling pattern. Demonstrate that a consumer that exits early via `done` does not leak the wrapping goroutine.

**Hint.** See [01-or-done-channel](../01-or-done-channel/junior.md) for the orDone signature.

**Acceptance.** `runtime.NumGoroutine` before and after returns to baseline.

### Task 3.4: Tee inside an `errgroup`

**Goal.** A pipeline where:
- Producer emits values to `in`.
- Tee splits to two consumers.
- Consumer A is reliable.
- Consumer B returns an error after N values.

The whole pipeline should shut down cleanly, with the first error surfaced by `g.Wait()`.

**Hint.** `errgroup.WithContext` provides the context that the tee selects on.

**Acceptance.** No goroutine leaks; the returned error is the one from B.

### Task 3.5: Tee + transformation

**Goal.** Build a pipeline:

```
producer -> tee -> [identity sink, square-then-sum sink]
```

Both branches see every value. The second branch transforms before consuming.

**Acceptance.** With input `[1..10]`, identity sink receives `[1..10]`; square-then-sum sink ends with 385.

---

## Level 4 — Real-World Shapes

### Task 4.1: Audit + business pipeline

**Goal.** Simulate a request stream. Tee to:
- An audit branch that writes to a file.
- A business branch that processes (just print the request ID).

Demonstrate that when the file write is artificially slow, the business branch also slows.

**Acceptance.** Total throughput under slow-audit is bounded by the audit branch.

### Task 4.2: Shadow traffic

**Goal.** A "production" handler and a "shadow" handler both receive the same request stream. The shadow handler simulates errors; the production handler must not be affected.

**Hint.** Use the lossy asymmetric variant. Shadow is the lossy branch.

**Acceptance.** When the shadow handler returns 50% errors, the production handler still receives 100% of requests.

### Task 4.3: Metrics + processing

**Goal.** Tee event stream to:
- A metrics aggregator that increments counters.
- A heavyweight processor.

The metrics branch must be fast and lossy (drops are acceptable for noisy events). The processor must be reliable.

**Acceptance.** Drop rate on the metrics branch is monitored and remains below 1% under normal load.

### Task 4.4: Test-double capture

**Goal.** Tee a stream so that:
- The real consumer processes values normally.
- A test-double captures values for later assertion.

This is the "intercept" pattern for integration tests.

**Acceptance.** Test runs the system end-to-end; afterwards, the captured slice contains exactly the expected values.

---

## Level 5 — Stress and Edge

### Task 5.1: Tee under cancellation storm

**Goal.** Spawn 100 tees, each on its own ephemeral stream, and cancel all of them concurrently via a shared `done`. Verify all 100 goroutines exit within a tight deadline.

**Hint.** Use a `sync.WaitGroup` to track tee goroutines.

**Acceptance.** All goroutines exit within 100ms after `close(done)`.

### Task 5.2: Tee with a buggy consumer

**Goal.** Write a test where one consumer panics mid-stream. Verify the tee goroutine eventually exits (via `done`) without leaking, and the other consumer's behaviour is correctly degraded.

**Acceptance.** Documented and asserted behaviour matches the [specification](specification.md).

### Task 5.3: Tee with `nil` input

**Goal.** Implement a defensive `Tee` that panics if `in == nil`. Test that the panic is raised and has a useful message.

**Acceptance.** Test passes; message includes the package and function name.

### Task 5.4: Tee with pre-closed input

**Goal.** Test the case where `in` is closed before `Tee` is called. Verify both outputs close immediately and no goroutine is left running.

**Acceptance.** `NumGoroutine` returns to baseline within 10ms.

### Task 5.5: Tee with pre-closed done

**Goal.** Test the case where `done` is closed before `Tee` is called. Verify no values are delivered and both outputs close immediately.

**Acceptance.** Both output channels are closed and produced zero values.

---

## Level 6 — Beyond Tee

### Task 6.1: Implement `BroadcastHub[T]`

**Goal.** Generalise tee to a hub with `Subscribe()` and `Publish()`. Each subscriber gets every published value.

**Hint.** A map of `chan T` guarded by `sync.RWMutex`. See [06-broadcast-pattern](../../05-concurrency-patterns/06-broadcast-pattern/middle.md).

**Acceptance.** Subscribers can join and leave at runtime. The hub handles slow subscribers with a configurable overflow policy (block, drop newest, drop oldest).

### Task 6.2: Sharded tee for throughput

**Goal.** Hash-partition the input by some key into N parallel tees, each driving a pair of consumers. Useful when one tee saturates a core.

**Acceptance.** Aggregate throughput scales linearly with N up to the number of cores.

### Task 6.3: SPMC ring fanout

**Goal.** Replace a tee with a single-producer, multi-consumer ring buffer. Two consumer cursors. Producer writes monotonically; slowest consumer determines wrap.

**Acceptance.** Single-threaded benchmark exceeds 20 million values/second.

### Task 6.4: Distributed tee via Kafka

**Goal.** Produce to a Kafka topic. Two consumer groups read independently. Demonstrate that each group sees every message and that groups are independent.

**Acceptance.** Kill one consumer in group A; group B is unaffected.

---

## Level 7 — Open-Ended Exploration

### Task 7.1: Compare tee to two-sink loop

**Goal.** Implement two pipelines that send every event to a Kafka mock and a file mock:

1. Sequential: `kafka.Send(v); file.Write(v)` in one goroutine.
2. Tee: each sink runs in its own goroutine, coupled via tee.

Benchmark both under (a) fast sinks, (b) one slow sink, (c) both slow.

**Acceptance.** A short report explaining when each shape is preferable and why.

### Task 7.2: Implement a `TeeN` for arbitrary N

**Goal.** A function:

```go
func TeeN[T any](done <-chan struct{}, in <-chan T, n int) []<-chan T
```

Every output receives every value. Implement using the nil-channel trick generalised to an N-iteration inner loop.

**Acceptance.** Test with N=5 confirms all five outputs receive identical sequences.

### Task 7.3: Backpressure-aware metrics

**Goal.** Instrument a tee with Prometheus-compatible counters. Add a histogram of in-to-second-output latency. Expose them via `/metrics`.

**Acceptance.** Counters increment correctly under load. Histogram bucket distribution matches expectations from the slow-consumer benchmark.

### Task 7.4: Tee in a structured concurrency framework

**Goal.** Implement a `Pipeline` type with explicit lifecycle:

```go
p := NewPipeline(ctx)
p.Tee("audit", "biz")
p.Connect("audit", auditSink)
p.Connect("biz", bizSink)
p.Run()
```

Internally use tee. Externally, the API hides the channel primitives.

**Acceptance.** A small DSL for building tee-based pipelines, used in a real example.

### Task 7.5: Stress under random consumer failure

**Goal.** Build a chaos test that randomly stalls one or both consumers for random durations. Verify that:
- Symmetric tee throughput drops to match the stalled consumer.
- Lossy tee critical branch maintains full throughput.
- No goroutine leaks.

**Acceptance.** Test runs for 60 seconds with no leaks, drops counted for lossy.

---

## Solution Verification

For every task:

1. Verify the type signature matches the specification.
2. Run `go vet` and `staticcheck` — no warnings.
3. Run `go test -race` — no race detected.
4. Run `go test -count=10` — flake-free.
5. For benchmarks, run `go test -bench=. -benchmem -benchtime=3s` and inspect allocations per op.
6. Compare your implementation against [specification.md](specification.md) compliance tests.

A correct tee implementation is small. If your solution exceeds 30 lines for the canonical form, simplify.
