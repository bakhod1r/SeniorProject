# Fan-In — Optimization

> Honest framing first: the canonical merge function (one forwarder goroutine per input + a WaitGroup-driven closer) is fast enough for most workloads. You should not micro-optimise it until profiling proves it is the bottleneck. What follows is what to change *when* the merge is genuinely on the hot path: bounding queues, batching messages, replacing reflection with code, and pooling allocations.
>
> Each entry below: the problem, a "before" and "after" snippet, and the realistic gain you should expect.

---

## Optimization 1 — Bounded fan-in for backpressure

**Problem:** A producer with no rate limit can flood the merged channel and OOM the process. Unbuffered fan-in is correct but provides only single-slot backpressure; under bursty inputs the system thrashes between full-buffer block and idle.

**Before:**
```go
out := make(chan T) // unbuffered, single-slot backpressure
```

**After:**
```go
// Tune bufSize by measurement. A common starting point is the number
// of inputs, so each forwarder can stage one value without blocking.
out := make(chan T, len(cs))
```

For very high-throughput merges, set `bufSize` to the size of the consumer's typical batch. If the consumer reads in chunks of 256, a buffer of 256 lets producers run a full chunk ahead before blocking.

**Gain:** Smoother throughput under jitter, fewer scheduler context switches, and bounded memory. Typical wins are 10-40% lower p99 latency on bursty workloads. Going larger than `4 * batch_size` is rarely worth it — you start hiding real backpressure problems.

---

## Optimization 2 — Pre-allocate the output buffer to match consumer batch size

**Problem:** A correct buffer size is workload-dependent. Defaulting to "unbuffered" or to "one" leaves performance on the table when the consumer batches; defaulting to "huge" wastes memory and hides backpressure.

**Before:**
```go
out := make(chan Event)
```

**After:**
```go
// Consumer reads in batches of N. Match it.
out := make(chan Event, batchSize)
```

If you have a benchmark that varies batch size, run it for `bufSize ∈ {1, batchSize, 2*batchSize, 4*batchSize}` and pick the smallest with no measurable improvement above it.

**Gain:** Often 1.5-3x throughput on consumer-batched pipelines. The improvement caps out: once `bufSize >= batchSize` further gains are marginal.

---

## Optimization 3 — Reduce per-message goroutine cost

**Problem:** A naive merge that spawns *one goroutine per message* (e.g. for "each value, run a side-effect goroutine") explodes goroutine counts and burns scheduler time. Goroutines are cheap, not free — at millions/sec the cost is visible.

**Before:**
```go
for v := range merged {
    go func(v T) {
        process(v)
    }(v)
}
```

**After:**
```go
// Worker pool of fixed size; merge feeds the pool's input.
work := make(chan T)
var wg sync.WaitGroup
wg.Add(workerCount)
for i := 0; i < workerCount; i++ {
    go func() {
        defer wg.Done()
        for v := range work {
            process(v)
        }
    }()
}
for v := range merged {
    work <- v
}
close(work)
wg.Wait()
```

**Gain:** Memory drops from O(messages) to O(workers). Throughput can rise 5-10x because the scheduler is no longer thrashing. The pattern is "fan-in into a worker pool", and it is the canonical fix for "we tried merge but it OOM'd in production".

---

## Optimization 4 — Batched merge: gather N values before emitting

**Problem:** Per-message channel sends are synchronisation points. At very high throughput the channel itself becomes the bottleneck because every send pays a lock and context-switch tax.

**Before:**
```go
for v := range c { out <- v }
```

**After:**
```go
// Forwarder accumulates into a small buffer, sends slices.
const batch = 64

func forward(c <-chan T, out chan<- []T) {
    buf := make([]T, 0, batch)
    for v := range c {
        buf = append(buf, v)
        if len(buf) == batch {
            out <- buf
            buf = make([]T, 0, batch)
        }
    }
    if len(buf) > 0 { out <- buf }
}
```

The merged channel now carries `[]T` instead of `T`. Consumers iterate the slice locally — no channel send per value.

**Gain:** 3-10x throughput when messages are small (single int, single byte). The trade-off is increased latency: a value can sit in `buf` for up to one batch's worth of time. Add a periodic flush (`time.NewTicker`) to bound that latency.

---

## Optimization 5 — Replace `reflect.Select` with a code-generated switch on the hot path

**Problem:** `reflect.Select` is the only choice for runtime-dynamic N, but it is roughly 5x slower than a static `select`. On a hot path it dominates the merge cost.

**Before:**
```go
i, v, ok := reflect.Select(cases)
```

**After:** if N is known at *deploy* time (even if not at *compile* time), generate the merge function with `go generate`:

```go
//go:generate go run ./gen-merge -n=8

func merge8(c0, c1, c2, c3, c4, c5, c6, c7 <-chan T) <-chan T {
    out := make(chan T)
    go func() {
        defer close(out)
        for c0 != nil || c1 != nil || /* ... */ c7 != nil {
            select {
            case v, ok := <-c0:
                if !ok { c0 = nil; continue }
                out <- v
            // ... cases for c1..c7 ...
            }
        }
    }()
    return out
}
```

**Gain:** 4-8x faster than reflect-based merge. Memory drops because there is one goroutine instead of N+1. Reserve this for genuinely hot paths — the generated code is harder to maintain than the reflect version.

---

## Optimization 6 — Replace per-channel goroutines with a single `select`

**Problem:** The WaitGroup merge spawns N+1 goroutines. For small fixed N, a single goroutine running a `select` over all channels is cheaper.

**Before:**
```go
func merge3(a, b, c <-chan int) <-chan int {
    out := make(chan int)
    var wg sync.WaitGroup
    wg.Add(3)
    forward := func(c <-chan int) {
        defer wg.Done()
        for v := range c { out <- v }
    }
    go forward(a)
    go forward(b)
    go forward(c)
    go func() { wg.Wait(); close(out) }()
    return out
}
```

**After:**
```go
func merge3(a, b, c <-chan int) <-chan int {
    out := make(chan int)
    go func() {
        defer close(out)
        for a != nil || b != nil || c != nil {
            select {
            case v, ok := <-a:
                if !ok { a = nil; continue }
                out <- v
            case v, ok := <-b:
                if !ok { b = nil; continue }
                out <- v
            case v, ok := <-c:
                if !ok { c = nil; continue }
                out <- v
            }
        }
    }()
    return out
}
```

**Gain:** Lower goroutine count (1 vs 4), lower scheduling overhead, fewer allocations on merge construction. Throughput is comparable for 2-4 inputs and drops behind the WaitGroup version for N > 6 because the single goroutine becomes the bottleneck.

Rule of thumb: for fixed N <= 4, use single-goroutine `select`. For variadic or N > 4, use the WaitGroup merge.

---

## Optimization 7 — Atomic counter instead of WaitGroup for known N

**Problem:** `sync.WaitGroup` has internal locking overhead. For a hot-path merge with many small messages, the `Done`/`Wait` pair is measurable.

**Before:**
```go
var wg sync.WaitGroup
wg.Add(len(cs))
// ... forwarders call wg.Done() ...
go func() { wg.Wait(); close(out) }()
```

**After:**
```go
var remaining atomic.Int64
remaining.Store(int64(len(cs)))

forward := func(c <-chan T) {
    for v := range c { out <- v }
    if remaining.Add(-1) == 0 {
        close(out)
    }
}
```

Each forwarder decrements the counter atomically when it exits. The forwarder that hits zero closes the output. No separate closer goroutine, no `Wait`.

**Gain:** Saves one goroutine and one mutex lock pair per merge construction. Most useful on short-lived merges where construction cost dominates. For long-lived merges the savings are negligible.

**Caveat:** This pattern requires **N is known up front** and **never changes**. For dynamic merges (Task 7 in `tasks.md`), stick with WaitGroup.

---

## Optimization 8 — Use `sync.Pool` for message buffers

**Problem:** When the merge carries large messages (byte slices, structs with embedded buffers), every value allocated on the heap pays GC cost. At high message rates, GC pauses spike.

**Before:**
```go
type Msg struct {
    Body []byte
}

for {
    msg := Msg{Body: make([]byte, 4096)}
    fillFromSource(msg.Body)
    out <- msg
}
```

**After:**
```go
var msgPool = sync.Pool{
    New: func() any { return &Msg{Body: make([]byte, 0, 4096)} },
}

for {
    msg := msgPool.Get().(*Msg)
    msg.Body = msg.Body[:0]
    fillFromSource(&msg.Body)
    out <- msg
}

// consumer must release back:
for msg := range merged {
    consume(msg)
    msgPool.Put(msg)
}
```

**Gain:** GC pressure drops dramatically — often 5-10x fewer allocations on the hot path. Latency p99 improves correspondingly because there are fewer GC pauses.

**Caveat:** Pool ownership is delicate. The consumer must know it owns the message and must `Put` it back exactly once. Forgetting `Put` is a leak (memory grows); double-`Put` corrupts the pool. Document the contract clearly: "the receiver owns the message until `Put`".

---

## Optimization 9 — Coalesce time-based merges

**Problem:** When merge inputs are tick-driven (e.g. multiple tickers reporting once a second), the merged consumer sees a flurry of N values clustered in time, then idle. CPU and downstream systems oscillate.

**Before:** raw merge of N tickers; consumer sees `N` events per second clustered tightly.

**After:** add a coalescer downstream of the merge that aggregates within a small window:

```go
func coalesce[T any](in <-chan T, window time.Duration) <-chan []T {
    out := make(chan []T)
    go func() {
        defer close(out)
        var buf []T
        timer := time.NewTimer(window)
        timer.Stop()
        active := false
        for {
            select {
            case v, ok := <-in:
                if !ok {
                    if len(buf) > 0 { out <- buf }
                    return
                }
                buf = append(buf, v)
                if !active {
                    timer.Reset(window)
                    active = true
                }
            case <-timer.C:
                if len(buf) > 0 {
                    out <- buf
                    buf = nil
                }
                active = false
            }
        }
    }()
    return out
}
```

**Gain:** Downstream consumers see one batched event per window instead of a burst. CPU usage smooths; downstream services (databases, log shippers) handle one large insert instead of N small ones. Latency rises by at most `window`; throughput rises 3-10x.

---

## Optimization 10 — Use `errgroup` for early-cancel on producer failure

**Problem:** Plain merge has no way to fail fast. If one producer hits a fatal error, the others keep producing, the consumer keeps reading, and the eventual error reporting is garbled.

**Before:**
```go
for v := range merge(ctx, cs...) {
    if v.Err != nil {
        log.Print(v.Err)
        // other producers keep running
    }
}
```

**After:**
```go
import "golang.org/x/sync/errgroup"

func MergeErrGroup[T any](
    parent context.Context,
    cs ...<-chan T,
) (<-chan T, func() error) {
    g, ctx := errgroup.WithContext(parent)
    out := make(chan T)
    var wg sync.WaitGroup
    wg.Add(len(cs))

    for _, c := range cs {
        c := c
        g.Go(func() error {
            defer wg.Done()
            for {
                select {
                case <-ctx.Done():
                    return ctx.Err()
                case v, ok := <-c:
                    if !ok { return nil }
                    select {
                    case <-ctx.Done(): return ctx.Err()
                    case out <- v:
                    }
                }
            }
        })
    }

    go func() { wg.Wait(); close(out) }()

    return out, g.Wait
}
```

Caller:
```go
out, wait := MergeErrGroup(ctx, a, b, c)
go func() {
    if err := wait(); err != nil {
        log.Printf("merge failed: %v", err)
    }
}()
for v := range out {
    process(v)
}
```

**Gain:** First error cancels everything via the shared `ctx`. No producer continues to do work that will be discarded. The caller gets the first error returned by `wait()`.

The `errgroup` pattern is the production-grade default for any merge whose producers can fail. Use it instead of trying to plumb a custom error channel alongside the data channel.

---

## Optimization 11 — Skip the merge entirely for trivial cases

**Problem:** With a single input channel, a "merge" is pure overhead — one extra goroutine and one extra channel hop per value.

**Before:**
```go
out := Merge(ctx, justOne)
for v := range out { ... }
```

**After:**
```go
if len(cs) == 1 {
    return cs[0]
}
// ... real merge ...
```

Add this short-circuit at the top of `Merge`. With zero inputs, return an immediately-closed channel.

**Gain:** Eliminates one goroutine and one channel for every degenerate-N call. In codebases that call `Merge` from generic code paths, this can fire often.

---

## Optimization 12 — Inline forwarder for cache locality on small fixed N

**Problem:** Each forwarder closure allocates a goroutine stack and a function value. For a tight inner-loop merge of 2-3 channels, the function call overhead per value is non-negligible.

**Before:**
```go
forward := func(c <-chan T) {
    defer wg.Done()
    for v := range c { out <- v }
}
go forward(a)
go forward(b)
```

**After:** inline three copies, each specialised:

```go
go func() {
    defer wg.Done()
    for v := range a { out <- v }
}()
go func() {
    defer wg.Done()
    for v := range b { out <- v }
}()
```

**Gain:** Marginal, usually 2-5%. Worth doing only on a verified hot path. The reduction in indirect calls helps the inliner and the CPU branch predictor. Most of the time the readability cost is not worth it; treat this as a last-resort optimisation.

---

## When NOT to optimise

It is genuinely common for engineers to spend hours tuning a merge that runs once per minute and processes a hundred messages. That work is throwaway. Before any of the above:

1. Run `pprof` and confirm the merge is in the top 5 of CPU/memory consumers.
2. Confirm the workload at production scale, not on a laptop.
3. Have a benchmark that proves your "before" hypothesis.
4. Apply one optimisation at a time and re-measure.

If you cannot tick all four boxes, the canonical WaitGroup merge from `junior.md` is already optimal for your case.

---

## Wrap-up

The merge itself is small. The pipeline around it is where most performance lives:

- **Buffer the output channel to match consumer batch size** — biggest single win.
- **Batch values before sending** — second biggest, when messages are small.
- **Bound goroutine counts via a worker pool downstream** — fixes most OOM cases.
- **Use `errgroup` for fail-fast** — production-grade error handling.
- **Pool message buffers** — for GC-sensitive paths only.
- **Reach for `reflect.Select` and code generation only** when N is genuinely dynamic and the path is genuinely hot.

If you remember just one rule: measure first, then change one thing.
