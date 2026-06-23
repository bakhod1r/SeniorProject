# Bridge-Channel — Tasks

A progression of practical tasks, from a basic implementation to production-grade compositions. Each task lists what to build, the success criteria, and hints. Solutions are sketched but you should write your own from scratch first.

---

## Task 1 — Implement the canonical bridge

**Goal:** Write the generic `Bridge` function with `context.Context`. Pair it with `OrDone`.

**Requirements:**
- Function signature: `func Bridge[T any](ctx context.Context, chanStream <-chan <-chan T) <-chan T`.
- Cancellation must be observed in three places: outer select, inside `OrDone`, inner select-on-send.
- One helper goroutine for bridge. One additional `OrDone` goroutine per inner channel.
- The output channel is unbuffered.

**Success criteria:**
- Concatenates inner channels in order.
- Closes output on cancellation within bounded time.
- No goroutine leaks when tested with `goleak`.

**Hint:** Start from the junior-level skeleton; rename `done` → `ctx.Done()`; verify each return path.

---

## Task 2 — Build a producer that returns a paginated stream

**Goal:** Implement `Pages(ctx, client) <-chan <-chan Row` for a simulated paginated API.

**Requirements:**
- Each page is fetched by calling `client.Page(cursor) (rows []Row, next string, err error)`.
- Each page becomes one inner channel.
- The inner channel must close after sending its rows.
- The function must return immediately; pagination runs in a goroutine.
- The function must respect `ctx`: stop fetching new pages, stop sending on the outer channel.

**Success criteria:**
- `Bridge(ctx, Pages(ctx, client))` yields a flat stream of rows.
- Cancellation propagates: closing `ctx` halts pagination within one page-fetch worth of latency.
- No leaks after cancellation.

**Hint:** Use a `select` on every send. Use `defer close()` on both the outer and each inner.

---

## Task 3 — Test concatenation order

**Goal:** Write a unit test that proves bridge preserves order across inner channels.

**Requirements:**
- Produce N=10 inner channels, each containing the sequence `[i*10, i*10+1, ..., i*10+4]` for `i = 0..9`.
- Bridge the result.
- Assert the output is `[0, 1, 2, 3, 4, 10, 11, 12, 13, 14, 20, ..., 94]`.

**Success criteria:**
- Test passes deterministically.
- Same test, when run with `-race`, also passes.

---

## Task 4 — Test cancellation cleanup

**Goal:** Write a test that verifies bridge closes its output channel when `ctx` is cancelled mid-stream.

**Requirements:**
- Create an inner channel that sends one value per 10 ms forever.
- Start a bridge.
- After 30 ms, cancel `ctx`.
- Assert the bridge's output channel closes within 100 ms.
- Assert no goroutines remain (use `goleak`).

**Hint:** A "forever" inner channel needs a producer that watches `ctx` itself; otherwise it leaks.

---

## Task 5 — Add result-wrapper error handling

**Goal:** Adapt bridge to forward `Result[T]` values instead of bare `T`, so per-value errors propagate.

**Requirements:**
- Define `type Result[T any] struct { Val T; Err error }`.
- Producer's inner channels emit `Result[T]` values, including occasional `{Err: ...}` entries.
- Consumer can branch on `result.Err`.

**Success criteria:**
- Bridge's body does not change (it's still `Bridge[Result[T]]`).
- A test produces a stream with intermixed values and errors; the consumer sees them in order.

**Discussion:** Why is this often preferable to a separate `<-chan error`?

---

## Task 6 — Compose bridge with a map stage

**Goal:** Build a small pipeline: `paginate → bridge → map(enrich) → consume`.

**Requirements:**
- `Map[In, Out any](ctx, in <-chan In, f func(In) Out) <-chan Out` is a pipeline stage.
- `enrich(Row) EnrichedRow` is a pure transformation.
- The full pipeline runs end-to-end.

**Success criteria:**
- The consumer sees a stream of `EnrichedRow`.
- Cancellation reaches all four stages.
- The four stages compose without nested loops at the call site.

---

## Task 7 — Drop-in replacement: bridge of channels-of-channels-of-channels

**Goal:** Demonstrate bridge composes by bridging a three-level shape `<-chan <-chan <-chan int`.

**Requirements:**
- Producer emits 3 outer channels, each containing 2 middle channels, each containing 4 ints.
- Use two bridges: `Bridge(ctx, Bridge(ctx, src))` is *not* valid since the types don't match. Instead bridge the deepest level first, then the result.

**Success criteria:**
- Total 24 values stream out in concatenation order.
- The recursion proves bridge composes.

**Hint:** Be careful with types. `Bridge[<-chan int]` takes `<-chan <-chan <-chan int` and produces `<-chan <-chan int`. Then `Bridge[int]` flattens further.

---

## Task 8 — Build `BridgeParallel`

**Goal:** Build a parallel variant that reads up to K inner channels concurrently.

**Requirements:**
- Signature: `func BridgeParallel[T any](ctx context.Context, k int, chanStream <-chan <-chan T) <-chan T`.
- Up to K inner channels are read at once.
- Output merges all reads (no strict order).
- All goroutines respect `ctx`.

**Success criteria:**
- Throughput scales with K up to the consumer's rate.
- No leaks on cancellation.
- Documentation makes clear that order is not preserved.

**Hint:** Use a semaphore channel `make(chan struct{}, k)` to limit concurrency.

---

## Task 9 — Bridge with `iter.Seq` (Go 1.23+)

**Goal:** Implement a non-channel bridge that returns an iterator.

**Requirements:**
- Signature: `func BridgeSeq[T any](chanStream <-chan <-chan T) iter.Seq[T]`.
- No helper goroutine.
- The consumer cancels by returning `false` from its `yield` body.

**Success criteria:**
- Range-over-func iterates the flat stream correctly.
- Early break exits the function.
- Behaviour matches the channel-based bridge for normal completion.

---

## Task 10 — Stress test against goleak

**Goal:** Run a stress test that creates many short-lived bridges with random cancellation, then verifies no goroutines leak.

**Requirements:**
- Launch 1000 bridges in a loop.
- For each: random inner channel count (0–10), random values per inner (0–100), random cancellation probability (0–30%).
- After the loop, `goleak.VerifyNone(t)` must pass.

**Success criteria:**
- The test runs in under 5 seconds.
- It is deterministic (use `t.Parallel()` carefully) and passes under `-race`.

---

## Task 11 — Production wrapper: typed exported API

**Goal:** Wrap bridge so a public API exposes only `<-chan User`, not the two-level shape.

**Requirements:**
- Package `userexport`.
- Public method `func (s *Service) StreamUsers(ctx context.Context, q Query) <-chan User`.
- Internal method emits `<-chan <-chan User`.
- Bridge is invoked inside the public method.

**Success criteria:**
- External callers never see `<-chan <-chan User`.
- The internal pagination can be swapped (cursor-based to offset-based) without breaking the public contract.

---

## Task 12 — Add metrics

**Goal:** Wrap bridge with instrumentation that exposes counters.

**Requirements:**
- Counter `bridge_inner_channels_total`: total inner channels processed.
- Counter `bridge_values_total`: total values forwarded.
- Counter `bridge_cancellations_total`: bridge exits due to cancellation.
- Counter `bridge_eofs_total`: bridge exits due to outer-channel close.
- Histogram `bridge_inner_value_count`: values per inner channel.

**Success criteria:**
- Metrics increment correctly under all four termination paths.
- A unit test sets up a fake metrics sink and asserts the counters.

---

## Task 13 — Property-based testing

**Goal:** Use `pgregory.net/rapid` to property-test bridge.

**Requirements:**
- Generate a random slice of slices of `T`.
- Pack them into a `<-chan <-chan T`.
- Bridge.
- Assert the output equals the flat concatenation.

**Success criteria:**
- Property runs 100+ examples per test.
- Shrinking finds minimal counter-examples on any failure.

---

## Task 14 — Composition with tee

**Goal:** Bridge a paginated stream, then tee it into two consumers (audit log + metrics).

**Requirements:**
- `Tee[T any](ctx, in <-chan T) (<-chan T, <-chan T)`.
- The two output channels receive the same values, in the same order.
- Cancellation propagates to both.

**Success criteria:**
- Both consumers see every value.
- Closing one consumer (cancelling its context branch) does not stall the other unless they share the same ctx.

**Hint:** Tee must forward each received value to both outputs before moving on. This means tee's pace is bounded by the slower consumer.

---

## Task 15 — Refactor a legacy double-`range` consumer

**Goal:** Take a piece of legacy code with nested `for range` over channels and replace it with bridge.

**Starting code:**
```go
for pageChan := range outer {
    for row := range pageChan {
        process(row)
    }
}
```

**Refactored code:**
```go
for row := range Bridge(ctx, outer) {
    process(row)
}
```

**Requirements:**
- The new code observes context cancellation.
- The new code has no nested `for range`.
- The new code is unit-tested with cancellation.

**Discussion:** What semantic changes (if any) did the refactor introduce?

---

## Task 16 — Cross-process: a streaming gRPC server

**Goal:** Build a gRPC server method that streams paginated results, internally using bridge.

**Requirements:**
- gRPC method `ListAll(req) stream Row`.
- Server-side: bridge over `paginate(ctx, req)` and `stream.Send` each value.
- Client-side: standard streaming receive.

**Success criteria:**
- Cancellation from the client propagates through gRPC's context to bridge to pagination.
- Network error mid-stream is surfaced to the client without leaks on the server.

---

## Task 17 — Bridge with timeouts per inner channel

**Goal:** Augment bridge so each inner channel has a soft deadline; if it doesn't close within that deadline, the bridge logs a warning and moves on.

**Requirements:**
- Signature: `func BridgeWithTimeout[T any](ctx, perInner time.Duration, cs <-chan <-chan T) <-chan T`.
- After `perInner` of inactivity on an inner channel, the bridge stops reading from it and moves on.
- The dropped inner channel is logged.

**Success criteria:**
- A misbehaving inner channel does not stall the whole bridge.
- Normal inner channels are unaffected.
- Cancellation still works.

**Hint:** Use `time.NewTimer` inside the inner read loop and reset it on every received value.

---

## Task 18 — Benchmark bridge

**Goal:** Write a benchmark that measures bridge throughput.

**Requirements:**
- Use `testing.B`.
- Vary the value type: `int`, `string`, `[]byte`, `struct{...}`.
- Vary the inner channel size: 1, 10, 100, 1000.
- Report ns/op and B/op.

**Success criteria:**
- Benchmarks run.
- A short analysis: which factor dominates — value size or inner channel size?

---

## Task 19 — Document the producer's closing contract

**Goal:** Add doc comments to every producer in your codebase that returns `<-chan <-chan T`, stating the closing contract.

**Requirements:**
- Each function's doc comment explicitly says: "Each emitted channel is closed by the producer after its values are sent."
- Linter or CI script verifies the comment is present.

**Success criteria:**
- All producers documented.
- A grep / linter rule catches new ones that violate the convention.

---

## Task 20 — Capstone: a streaming export endpoint

**Goal:** Build a complete HTTP handler that exports millions of database rows as CSV, using bridge internally.

**Requirements:**
- HTTP `GET /export?query=...` returns `text/csv`.
- Internal pipeline: paginate DB → bridge → map (row to CSV) → write to response.
- Client disconnect must cancel the whole pipeline.
- Memory must stay bounded (no buffering of millions of rows).
- Tests: unit, integration, and a chaos test that disconnects the client mid-stream.

**Success criteria:**
- The handler works end-to-end with a real or fake DB.
- Memory profile is flat (no leaks, no growth) over a 1M-row export.
- Cancellation leaves no goroutines behind.

---

These twenty tasks cover the full range from learning the function to deploying it in production. Work through them in order; the later tasks assume the earlier ones are done.
