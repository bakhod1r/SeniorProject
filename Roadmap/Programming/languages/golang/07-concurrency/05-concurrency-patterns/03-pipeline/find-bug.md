# Pipeline — Find the Bug

> Each snippet contains a real-world bug from a production Go pipeline: missing close, ignored context, deadlock, leaked goroutines, swallowed errors, panics, unbounded buffers, races, double-close, and shared-output mistakes. Find it, explain it, fix it. Run every fix with `go test -race -timeout 5s`.

---

## Bug 1 — Stage doesn't close its output channel

```go
func square(in <-chan int) <-chan int {
    out := make(chan int)
    go func() {
        for v := range in {
            out <- v * v
        }
    }()
    return out
}

func main() {
    nums := gen(1, 2, 3)
    sq := square(nums)
    for v := range sq {
        fmt.Println(v)
    }
}
```

**Symptom.** Program prints `1 4 9` and then hangs forever.

**Bug.** The `square` goroutine never closes its output channel. When `gen` finishes and closes its output, the `range in` loop exits and `square`'s goroutine returns — but `out` stays open. The `for v := range sq` in main has no way to know there are no more values; it blocks forever waiting on a closed-but-not-actually-closed channel.

**Fix.** Add `defer close(out)` as the *first* defer in the goroutine.

```go
func square(in <-chan int) <-chan int {
    out := make(chan int)
    go func() {
        defer close(out)              // <-- the missing line
        for v := range in {
            out <- v * v
        }
    }()
    return out
}
```

The lesson: every stage that owns an output channel must close it. No exceptions. Make `defer close(out)` the first line inside `go func()`.

---

## Bug 2 — Context ignored mid-pipeline

```go
func enrich(ctx context.Context, in <-chan Event) <-chan Event {
    out := make(chan Event)
    go func() {
        defer close(out)
        for ev := range in {
            ev.Tag = lookup(ev.UserID) // slow RPC
            out <- ev
        }
    }()
    return out
}
```

**Symptom.** Cancelling ctx does not stop the pipeline. A graceful shutdown that should take milliseconds takes whatever the slowest in-flight `lookup` takes, plus all the queued events.

**Bug.** The stage only checks ctx implicitly via `range in` — but `in` may have many items already buffered, and `lookup` doesn't take ctx, so the stage will faithfully process every queued item before noticing cancellation. The `out <- ev` send also has no ctx-aware select, so a slow downstream blocks the stage and prevents it from observing the cancellation.

**Fix.** Use the two-select sandwich on every channel op, and pass ctx to `lookup`.

```go
func enrich(ctx context.Context, in <-chan Event) <-chan Event {
    out := make(chan Event)
    go func() {
        defer close(out)
        for {
            select {
            case <-ctx.Done():
                return
            case ev, ok := <-in:
                if !ok {
                    return
                }
                tag, err := lookup(ctx, ev.UserID)
                if err != nil {
                    return
                }
                ev.Tag = tag
                select {
                case <-ctx.Done():
                    return
                case out <- ev:
                }
            }
        }
    }()
    return out
}
```

The lesson: every stage in a ctx-aware pipeline must (1) wrap *both* receive and send in a select that watches ctx, and (2) pass ctx down to any blocking work it does.

---

## Bug 3 — Deadlock from a blocked downstream

```go
func main() {
    ctx := context.Background()
    src := gen(ctx, 1, 2, 3, 4, 5)
    sq := square(ctx, src)

    // Read only the first two; ignore the rest.
    fmt.Println(<-sq)
    fmt.Println(<-sq)
    // forget to drain the rest
}
```

**Symptom.** Program prints `1 4` and exits, but `go test -race` with leak detection reports a leaked goroutine.

**Bug.** `square`'s goroutine is parked on `out <- v * v` waiting for someone to receive. Nobody ever does. The goroutine leaks forever (until process exit). With unbounded items in flight, this would also leak memory.

**Fix.** Either drain the entire output channel or cancel ctx so the stage can unblock through its `<-ctx.Done()` case.

```go
func main() {
    ctx, cancel := context.WithCancel(context.Background())
    defer cancel() // <-- guarantees stage can exit even on early return

    src := gen(ctx, 1, 2, 3, 4, 5)
    sq := square(ctx, src)

    fmt.Println(<-sq)
    fmt.Println(<-sq)
    // cancel runs via defer; square unwinds; gen unwinds; clean.
}
```

The lesson: every pipeline call site must arrange for the stages to unblock — either drain to completion or cancel ctx. The `defer cancel()` idiom is your friend.

---

## Bug 4 — Leaked stages on early exit

```go
func processFirst(items []Item) (Result, error) {
    ctx := context.Background()
    src := gen(ctx, items...)
    parsed := parse(ctx, src)
    enriched := enrich(ctx, parsed)

    for r := range enriched {
        if r.IsTarget() {
            return r.Result, nil // <-- early return
        }
    }
    return Result{}, errors.New("not found")
}
```

**Symptom.** Function returns the right answer, but every call leaks three goroutines (`gen`, `parse`, `enrich`).

**Bug.** When `processFirst` returns early, none of the upstream stages know. They are all parked on sends, waiting for the consumer that just walked away. Without ctx cancellation, they leak forever.

**Fix.** Use a cancellable ctx and `defer cancel()`.

```go
func processFirst(items []Item) (Result, error) {
    ctx, cancel := context.WithCancel(context.Background())
    defer cancel() // <-- stages unwind on return

    src := gen(ctx, items...)
    parsed := parse(ctx, src)
    enriched := enrich(ctx, parsed)

    for r := range enriched {
        if r.IsTarget() {
            return r.Result, nil
        }
    }
    return Result{}, errors.New("not found")
}
```

The lesson: any function that builds and consumes a pipeline must own a cancellable ctx and defer cancel. This is the equivalent of `defer file.Close()` for goroutines.

---

## Bug 5 — Errors silently swallowed

```go
func parse(in <-chan []byte) <-chan Event {
    out := make(chan Event)
    go func() {
        defer close(out)
        for raw := range in {
            var ev Event
            if err := json.Unmarshal(raw, &ev); err != nil {
                continue // skip bad records
            }
            out <- ev
        }
    }()
    return out
}
```

**Symptom.** Pipeline runs to completion. Output looks plausible. But ~5% of input is missing from the output, with no log, no metric, no error.

**Bug.** `parse` discards malformed records silently. The `continue` swallows the error; the operator never knows that 5% of their data is lost. This is one of the most insidious bugs in production pipelines because the program *appears* to work.

**Fix.** Either propagate the error (Result type, parallel error channel, errgroup) or at minimum count and log the failures.

```go
type Result[T any] struct {
    Val T
    Err error
}

func parse(in <-chan []byte) <-chan Result[Event] {
    out := make(chan Result[Event])
    go func() {
        defer close(out)
        for raw := range in {
            var ev Event
            if err := json.Unmarshal(raw, &ev); err != nil {
                out <- Result[Event]{Err: fmt.Errorf("parse: %w", err)}
                continue
            }
            out <- Result[Event]{Val: ev}
        }
    }()
    return out
}
```

The lesson: a stage that drops data silently is a bug, even if the test suite passes. Surface the error through the channel or as a metric.

---

## Bug 6 — A panic in mid-stage kills the pipeline

```go
func transform(ctx context.Context, in <-chan Record) <-chan Output {
    out := make(chan Output)
    go func() {
        defer close(out)
        for {
            select {
            case <-ctx.Done():
                return
            case r, ok := <-in:
                if !ok {
                    return
                }
                o := compute(r) // panics on rare input
                select {
                case <-ctx.Done():
                    return
                case out <- o:
                }
            }
        }
    }()
    return out
}
```

**Symptom.** Pipeline crashes the whole process when `compute` panics on a malformed record. Other in-flight items are lost.

**Bug.** A panic in a goroutine that is not recovered terminates the whole process. For a long-running streaming pipeline, that means one bad record kills the service.

**Fix.** Wrap the goroutine body in `defer recover()` and convert the panic into an error. Critical: `defer close(out)` must be *first* (executed last, LIFO) and `defer recover()` must be *second* (executed first, on panic).

```go
func transform(ctx context.Context, in <-chan Record) <-chan Result[Output] {
    out := make(chan Result[Output])
    go func() {
        defer close(out)         // first defer = runs last
        defer func() {           // second defer = runs first on panic
            if r := recover(); r != nil {
                out <- Result[Output]{Err: fmt.Errorf("panic: %v", r)}
            }
        }()
        for {
            select {
            case <-ctx.Done():
                return
            case rec, ok := <-in:
                if !ok {
                    return
                }
                o := compute(rec)
                select {
                case <-ctx.Done():
                    return
                case out <- Result[Output]{Val: o}:
                }
            }
        }
    }()
    return out
}
```

If you put `defer recover` *first* and `defer close(out)` *second*, then close runs first (no recover yet), then recover catches the panic — but downstream has already seen the close and you can't surface the error. Order matters.

The lesson: in long-running pipelines, recover panics. Order the defers so close is the *last* thing to run.

---

## Bug 7 — Unbounded buffer eats memory

```go
func ingest(ctx context.Context, src <-chan Event) <-chan Event {
    out := make(chan Event, 1<<20) // 1 million slots
    go func() {
        defer close(out)
        for {
            select {
            case <-ctx.Done():
                return
            case ev, ok := <-src:
                if !ok {
                    return
                }
                out <- ev // no select — assume buffer is "infinite"
            }
        }
    }()
    return out
}
```

**Symptom.** Pipeline runs fine on small loads. Under sustained source rate higher than the consumer rate, memory grows linearly until OOM.

**Bug.** A 1M-slot buffer is *not* "unbounded" but it might as well be: the pipeline can hold a million events in memory before blocking. Worse, the send is a bare `out <- ev` with no select on `<-ctx.Done()`, so once the buffer is full and downstream is slow, the stage is stuck and ctx cancellation can't unblock it.

**Fix.** Pick a *measured* small buffer and use the two-select sandwich.

```go
func ingest(ctx context.Context, src <-chan Event) <-chan Event {
    out := make(chan Event, 32) // tuned: P99 lookup is 4ms, source rate 1k/s
    go func() {
        defer close(out)
        for {
            select {
            case <-ctx.Done():
                return
            case ev, ok := <-src:
                if !ok {
                    return
                }
                select {
                case <-ctx.Done():
                    return
                case out <- ev:
                }
            }
        }
    }()
    return out
}
```

If a 32-slot buffer can't keep up, the right fix is *more parallelism* (fan-out the consumer), not a bigger buffer.

The lesson: buffers should absorb burst, not cover up persistent slowness. Default to 0; tune small (1-32) by measurement.

---

## Bug 8 — Stages race on shared state

```go
type Counter struct {
    n int
}

func count(in <-chan Event, c *Counter) <-chan Event {
    out := make(chan Event)
    go func() {
        defer close(out)
        for ev := range in {
            c.n++   // <-- race
            out <- ev
        }
    }()
    return out
}

func main() {
    c := &Counter{}
    a := count(gen(events1...), c)
    b := count(gen(events2...), c) // two count stages, same counter
    drain(merge(a, b))
    fmt.Println(c.n)
}
```

**Symptom.** `go test -race` flags a data race. Final count is sometimes wrong.

**Bug.** Two goroutines both increment `c.n` without synchronization. Even on a single-CPU machine, the increment is a load + add + store, which is not atomic.

**Fix.** Use `atomic.Int64` or a mutex.

```go
type Counter struct {
    n atomic.Int64
}

func count(in <-chan Event, c *Counter) <-chan Event {
    out := make(chan Event)
    go func() {
        defer close(out)
        for ev := range in {
            c.n.Add(1)
            out <- ev
        }
    }()
    return out
}
```

Better: don't share state between stages at all. Each stage emits `Event` with a counter field; aggregate at the sink.

The lesson: stages should communicate through channels, not shared memory. If you must share, use atomics or a mutex.

---

## Bug 9 — Double-close on the output channel

```go
func merge(a, b <-chan int) <-chan int {
    out := make(chan int)
    go func() {
        defer close(out)
        for v := range a {
            out <- v
        }
    }()
    go func() {
        defer close(out) // <-- second close
        for v := range b {
            out <- v
        }
    }()
    return out
}
```

**Symptom.** Program panics with `panic: close of closed channel`.

**Bug.** Two goroutines both attempt to close `out`. Whichever one finishes second hits the panic. This is a classic fan-in mistake: when N writers share one channel, none of them can safely close it on its own.

**Fix.** Use `sync.WaitGroup` and a single closer goroutine.

```go
func merge(a, b <-chan int) <-chan int {
    out := make(chan int)
    var wg sync.WaitGroup
    wg.Add(2)

    forward := func(c <-chan int) {
        defer wg.Done()
        for v := range c {
            out <- v
        }
    }
    go forward(a)
    go forward(b)

    go func() {
        wg.Wait()
        close(out) // exactly one closer
    }()
    return out
}
```

Now the close is owned by exactly one goroutine — the one that runs after both forwarders finish.

The lesson: a channel must be closed by exactly one party. With multiple writers, use a WaitGroup and a single closer goroutine.

---

## Bug 10 — Two stages writing to the same output channel

```go
func enrich(ctx context.Context, in <-chan Event, out chan<- Event) {
    go func() {
        for ev := range in {
            ev.A = enrichA(ev)
            out <- ev
        }
    }()
    go func() {
        for ev := range in {
            ev.B = enrichB(ev)
            out <- ev
        }
    }()
}
```

**Symptom.** Output has half the events with A set, half with B set, but no event has both. Plus a race on `ev` if it's a struct value.

**Bug.** Two goroutines both `range in` and both write to `out`. Each event goes to exactly *one* of them. The intent was probably a pipeline (ev → enrichA → enrichB), but this code is a fan-out where each branch only does half the work.

**Fix.** Make the two stages sequential, each with its own input/output channel.

```go
func enrichA(ctx context.Context, in <-chan Event) <-chan Event {
    out := make(chan Event)
    go func() {
        defer close(out)
        for ev := range in {
            ev.A = computeA(ev)
            select {
            case <-ctx.Done():
                return
            case out <- ev:
            }
        }
    }()
    return out
}

func enrichB(ctx context.Context, in <-chan Event) <-chan Event {
    out := make(chan Event)
    go func() {
        defer close(out)
        for ev := range in {
            ev.B = computeB(ev)
            select {
            case <-ctx.Done():
                return
            case out <- ev:
            }
        }
    }()
    return out
}

// Use:
out := enrichB(ctx, enrichA(ctx, src))
```

Now every event goes A then B, in order, with both fields set.

The lesson: a "pipeline" is a sequence of stages with one channel between each pair. Two stages writing to the same channel is a fan-in (with care) or a bug.

---

## Bug 11 — Stage holds a reference to a slice from the previous stage

```go
type Batch struct {
    Items []int
}

func double(in <-chan Batch) <-chan Batch {
    out := make(chan Batch)
    go func() {
        defer close(out)
        for b := range in {
            for i := range b.Items {
                b.Items[i] *= 2 // mutates upstream's slice
            }
            out <- b
        }
    }()
    return out
}

func main() {
    src := gen(Batch{Items: []int{1, 2, 3}})
    a := double(src)
    b := double(src) // !!
    // ...
}
```

**Symptom.** Race detector reports a write/read race on the slice's backing array.

**Bug.** `Batch.Items` is a slice header — a pointer to the underlying array. Mutating it in one stage races with anyone else reading or mutating it. Even within a single pipeline this is fragile: if the upstream reuses the slice for a `sync.Pool`-style optimization, the downstream sees corrupted data.

**Fix.** Either copy the slice before mutating, or treat it as immutable and produce a new one.

```go
func double(in <-chan Batch) <-chan Batch {
    out := make(chan Batch)
    go func() {
        defer close(out)
        for b := range in {
            doubled := make([]int, len(b.Items))
            for i, v := range b.Items {
                doubled[i] = v * 2
            }
            out <- Batch{Items: doubled}
        }
    }()
    return out
}
```

Or: document that `Items` is owned by the receiver and the sender must not retain a reference.

The lesson: slices and maps in channel messages are pointers. Mutating them is a race unless ownership is explicit.

---

## Bug 12 — Source forgets to honour ctx

```go
func source(ctx context.Context, urls []string) <-chan Page {
    out := make(chan Page)
    go func() {
        defer close(out)
        for _, u := range urls {
            page := fetch(u)
            out <- page // no ctx check
        }
    }()
    return out
}
```

**Symptom.** Pipeline doesn't shut down when ctx is cancelled mid-fetch.

**Bug.** `fetch` doesn't take ctx, so it runs to completion regardless. Even after `fetch` returns, the bare `out <- page` blocks forever if downstream stopped reading.

**Fix.** Pass ctx into `fetch` *and* wrap the send in a select.

```go
func source(ctx context.Context, urls []string) <-chan Page {
    out := make(chan Page)
    go func() {
        defer close(out)
        for _, u := range urls {
            select {
            case <-ctx.Done():
                return
            default:
            }
            page, err := fetch(ctx, u)
            if err != nil {
                return
            }
            select {
            case <-ctx.Done():
                return
            case out <- page:
            }
        }
    }()
    return out
}
```

The lesson: ctx awareness is not optional in any stage. Source stages, in particular, often forget because they have no input channel — they have to add the ctx check explicitly.

---

## Bug 13 — Pipeline deadlocks on full output and slow downstream

```go
func collect(in <-chan int) []int {
    var out []int
    for v := range in {
        time.Sleep(100 * time.Millisecond) // expensive append
        out = append(out, v)
    }
    return out
}

func main() {
    ctx := context.Background()
    src := gen(ctx, makeRange(10000)...)
    sq := square(ctx, src)
    out := collect(sq)
    fmt.Println(len(out))
}
```

**Symptom.** Pipeline runs unimaginably slowly: 10000 items × 100ms = ~1000s. CPU is mostly idle. The "concurrent pipeline" never benefits from concurrency.

**Bug.** Backpressure is *too* strict here. The unbuffered channel between `square` and `collect` means `square` can only run one item ahead, which means `gen` can also only run one item ahead. With a slow consumer, the pipeline serializes completely.

**Fix.** Either parallelise the slow consumer, or increase the buffer size to absorb the latency mismatch.

If `collect` must stay single-threaded, give it a buffer of, say, 64 to overlap upstream and downstream work:

```go
func square(ctx context.Context, in <-chan int) <-chan int {
    out := make(chan int, 64) // tuned to absorb collect's 100ms-per-item cost
    // ... rest unchanged
}
```

If the real bottleneck is `collect`'s per-item cost, parallelise it — but `collect` can't easily be parallel because it builds a slice in order. A common compromise: use a buffered channel and accept higher memory.

The lesson: backpressure is automatic and correct, but if the slow stage is a *fundamental* bottleneck, no amount of pipeline cleverness saves you. Either parallelise it, accept the throughput, or add a tuned buffer to overlap latency.

---

## Bug 14 — Producer outpaces consumer; in-flight items grow without bound

```go
func tail(ctx context.Context, path string) <-chan Line {
    out := make(chan Line, 1000000) // "just in case"
    go func() {
        defer close(out)
        // tails the file at 100k lines/sec
        for {
            l := readLine(ctx, path)
            select {
            case <-ctx.Done():
                return
            default:
                out <- l
            }
        }
    }()
    return out
}
```

**Symptom.** Memory usage grows linearly until OOM. Pipeline gets slower over time.

**Bug.** A buffer of 1 million is treating backpressure as a problem to be hidden, not solved. The consumer is slower than the producer; the buffer fills; eventually it pins ~1 million `Line` structs in memory. Once full, the bare `out <- l` blocks regardless — but by then the damage is done.

Worse: the `select { case <-ctx.Done(): default: }` branch *bypasses* backpressure entirely. The send proceeds unconditionally. If buffer fills, the goroutine blocks; if ctx is cancelled, it returns; either way, no proper coordination with downstream.

**Fix.** Small buffer plus the two-select sandwich on the send:

```go
func tail(ctx context.Context, path string) <-chan Line {
    out := make(chan Line, 16) // measured
    go func() {
        defer close(out)
        for {
            l, err := readLine(ctx, path)
            if err != nil {
                return
            }
            select {
            case <-ctx.Done():
                return
            case out <- l:
            }
        }
    }()
    return out
}
```

Now backpressure flows back to `readLine`. If `readLine` can be paused (most can), the file tail naturally throttles to consumer speed. If it can't be paused (e.g. UDP), you need an explicit drop policy — never silent unbounded buffering.

The lesson: "buffer it" is rarely the answer. Either parallelise, throttle, or drop with intent.

---

## Bug 15 — Ranging over a channel that's never closed

```go
func reader(ctx context.Context) <-chan Page {
    out := make(chan Page)
    go func() {
        // forgot defer close(out)
        for {
            select {
            case <-ctx.Done():
                return // <-- early exit without close
            case out <- fetchOne(ctx):
            }
        }
    }()
    return out
}

func main() {
    ctx, cancel := context.WithTimeout(context.Background(), 1*time.Second)
    defer cancel()
    for p := range reader(ctx) {
        process(p)
    }
}
```

**Symptom.** Program hangs after ctx times out. The `range` loop in main never exits.

**Bug.** When ctx is cancelled, the goroutine returns from the select without closing `out`. The `range` loop in main blocks waiting for either a value or a close — neither comes.

**Fix.** Always `defer close(out)` as the first defer.

```go
func reader(ctx context.Context) <-chan Page {
    out := make(chan Page)
    go func() {
        defer close(out) // <-- guarantees close on any exit
        for {
            select {
            case <-ctx.Done():
                return
            case out <- fetchOne(ctx):
            }
        }
    }()
    return out
}
```

The lesson: `defer close(out)` is mandatory at the top of every stage's goroutine. The deferred close is the only safe way to guarantee the channel closes on every exit path (normal, ctx, panic-after-recover).

---

## Diagnostic Checklist

When investigating a hanging or leaky pipeline, run through:

- [ ] Does every stage have `defer close(out)` as the *first* defer?
- [ ] Does every channel send use the two-select sandwich (`<-ctx.Done()` + send)?
- [ ] Does every channel receive use a select that watches ctx?
- [ ] Does every blocking call (RPC, IO, sleep) accept ctx?
- [ ] Is there exactly one writer per channel?
- [ ] Is the close ownership clear (one defer in one place)?
- [ ] Does the call site `defer cancel()` so early returns release stages?
- [ ] Are buffers sized small (0-32) and documented?
- [ ] Are panics either crashing the process intentionally or recovered with the right defer order?
- [ ] Does `go test -race` pass?
- [ ] Does `goleak.VerifyNone` pass at the end of every test?

Most production pipeline bugs trace back to violating one of these. The fixes are mechanical once you spot them.
