# Nil Channels — Optimisation Exercises

> Each exercise presents code that is correct but suboptimal. Your job is to rewrite it using nil-channel patterns (or, occasionally, *away* from nil-channel patterns when they are the wrong tool). Measure the improvement where possible. Solutions are at the end.

---

## Exercise 1 — Flag-driven select to nil-channel

**Starting code.**

```go
func consume(in <-chan Job, ctx context.Context) {
    drained := false
    for !drained {
        select {
        case job, ok := <-in:
            if !ok {
                drained = true
                continue // still loops, hitting closed-case again
            }
            handle(job)
        case <-ctx.Done():
            return
        }
    }
}
```

**Problem.** After `in` is closed, the receive case fires immediately each iteration (yielding `(zero, false)`), then `continue` loops back. With `drained=true`, the `for !drained` check exits — so this version is functionally correct. But during the brief interval between the close and the next loop check, the goroutine spins.

A worse variant (also seen in production):

```go
for !drained || hasMore() {
    select {
    case job, ok := <-in:
        if !ok { drained = true; continue } // BUSY LOOP IF !hasMore stays false
        handle(job)
    ...
    }
}
```

If `!drained && !hasMore()` is the loop condition, this can spin indefinitely. The `case` fires on every iteration of the closed channel.

**Refactor.** Use nil-channel disabling:

```go
func consume(in <-chan Job, ctx context.Context) {
    for {
        select {
        case job, ok := <-in:
            if !ok {
                in = nil
                continue
            }
            handle(job)
        case <-ctx.Done():
            return
        }
        if in == nil { return }
    }
}
```

After `in = nil`, the receive case stops firing. The loop blocks on `ctx.Done()` only. Exit when both `in` is nil and you have no other reason to stay.

**Measurement.** Use `go test -bench` to compare CPU/iteration count after channel close. The nil-channel version should show zero busy-iterations.

---

## Exercise 2 — Boolean flag for backpressure

**Starting code.**

```go
type Pipeline struct {
    in   <-chan Item
    out  chan<- Item
    buf  []Item
}

func (p *Pipeline) Run(ctx context.Context) {
    for {
        canSend := len(p.buf) > 0
        canRecv := len(p.buf) < 5

        if canRecv && canSend {
            select {
            case v := <-p.in:
                p.buf = append(p.buf, v)
            case p.out <- p.buf[0]:
                p.buf = p.buf[1:]
            case <-ctx.Done():
                return
            }
        } else if canRecv {
            select {
            case v := <-p.in:
                p.buf = append(p.buf, v)
            case <-ctx.Done():
                return
            }
        } else if canSend {
            select {
            case p.out <- p.buf[0]:
                p.buf = p.buf[1:]
            case <-ctx.Done():
                return
            }
        } else {
            select {
            case <-ctx.Done():
                return
            }
        }
    }
}
```

**Problem.** Three duplicated `select` blocks (plus a fallback) to handle the four combinations of canRecv/canSend. Bug-prone (any change must be made in three places) and harder to extend.

**Refactor.** One select with nil-channel gating:

```go
func (p *Pipeline) Run(ctx context.Context) {
    for {
        var inCh <-chan Item
        var outCh chan<- Item
        var head Item

        if len(p.buf) < 5 {
            inCh = p.in
        }
        if len(p.buf) > 0 {
            outCh = p.out
            head = p.buf[0]
        }

        select {
        case v := <-inCh:
            p.buf = append(p.buf, v)
        case outCh <- head:
            p.buf = p.buf[1:]
        case <-ctx.Done():
            return
        }
    }
}
```

One select, three branches. State (`canRecv`, `canSend`) encoded in the channel variables. Adding a new gate (e.g., a rate limiter) is one more `if` and zero new `select` blocks.

---

## Exercise 3 — Reflect-Select on every iteration

**Starting code.**

```go
func fanInDynamic(ctx context.Context, srcs []<-chan int) <-chan int {
    out := make(chan int)
    go func() {
        defer close(out)
        for {
            cases := make([]reflect.SelectCase, 0, len(srcs)+1)
            for _, s := range srcs {
                if s != nil {
                    cases = append(cases, reflect.SelectCase{
                        Dir: reflect.SelectRecv, Chan: reflect.ValueOf(s),
                    })
                }
            }
            cases = append(cases, reflect.SelectCase{
                Dir: reflect.SelectRecv, Chan: reflect.ValueOf(ctx.Done()),
            })
            chosen, val, ok := reflect.Select(cases)
            // ... process chosen and val ...
            _ = ok
            _ = chosen
            _ = val
        }
    }()
    return out
}
```

**Problem.** Allocates a new `[]reflect.SelectCase` on every iteration. Under high message rates this is hundreds of MB/s of garbage, hammering the GC.

**Refactor.** Allocate once, mutate in place.

```go
func fanInDynamic(ctx context.Context, srcs []<-chan int) <-chan int {
    out := make(chan int)
    go func() {
        defer close(out)
        cases := make([]reflect.SelectCase, len(srcs)+1)
        for i, s := range srcs {
            cases[i] = reflect.SelectCase{
                Dir: reflect.SelectRecv, Chan: reflect.ValueOf(s),
            }
        }
        cases[len(srcs)] = reflect.SelectCase{
            Dir: reflect.SelectRecv, Chan: reflect.ValueOf(ctx.Done()),
        }
        alive := len(srcs)
        for alive > 0 {
            chosen, val, ok := reflect.Select(cases)
            if chosen == len(srcs) {
                return
            }
            if !ok {
                cases[chosen].Chan = reflect.Value{} // disable
                alive--
                continue
            }
            select {
            case out <- val.Interface().(int):
            case <-ctx.Done():
                return
            }
        }
    }()
    return out
}
```

**Measurement.** Benchmark with `go test -bench -benchmem`. The new version should show ~zero allocations per merged message; the old version allocates one slice per iteration.

---

## Exercise 4 — Stop-and-recreate ticker on pause

**Starting code.**

```go
func emitter(ctx context.Context, control <-chan string) {
    var ticker *time.Ticker
    ticker = time.NewTicker(time.Second)

    for {
        select {
        case <-ticker.C:
            emit()
        case cmd := <-control:
            if cmd == "pause" {
                ticker.Stop()
            } else if cmd == "resume" {
                ticker = time.NewTicker(time.Second)
            }
        case <-ctx.Done():
            ticker.Stop()
            return
        }
    }
}
```

**Problem.** `ticker.Stop()` does not close `ticker.C`, so the `<-ticker.C` case may still fire one buffered value. Recreating the ticker on resume allocates and may cause confusion (the old ticker is GC'd, but if anyone else referenced it, the reference is now stale).

**Refactor.** Keep the ticker alive; toggle a local channel variable.

```go
func emitter(ctx context.Context, control <-chan string) {
    ticker := time.NewTicker(time.Second)
    defer ticker.Stop()
    tickCh := ticker.C // active

    for {
        select {
        case <-tickCh:
            emit()
        case cmd := <-control:
            switch cmd {
            case "pause":
                tickCh = nil
            case "resume":
                tickCh = ticker.C
            }
        case <-ctx.Done():
            return
        }
    }
}
```

The ticker keeps running underneath; pause just stops listening. No allocation, no stale references.

---

## Exercise 5 — Channel-per-cancellation

**Starting code.**

```go
type Subscription struct {
    events <-chan Event
    quit   chan struct{}
}

func (s *Subscription) Run() {
    for {
        select {
        case ev := <-s.events:
            handle(ev)
        case <-s.quit:
            return
        }
    }
}

func main() {
    s := &Subscription{
        events: subscribe(),
        quit:   make(chan struct{}),
    }
    go s.Run()
    // ... later ...
    close(s.quit)
}
```

**Problem.** This is correct, but the `quit` channel is redundant if you already have `context.Context`. Adding a separate cancellation channel scales poorly when you have many subscriptions.

**Refactor.** Use context.

```go
type Subscription struct {
    events <-chan Event
}

func (s *Subscription) Run(ctx context.Context) {
    for {
        select {
        case ev := <-s.events:
            handle(ev)
        case <-ctx.Done():
            return
        }
    }
}
```

This is not strictly a nil-channel optimisation, but it pairs well with one: `ctx.Done()` is the always-live case that protects every other case (which may become nil).

---

## Exercise 6 — Multi-input merge with single goroutine vs N goroutines

**Starting code.**

```go
func merge(ins ...<-chan int) <-chan int {
    out := make(chan int)
    var wg sync.WaitGroup
    for _, in := range ins {
        wg.Add(1)
        go func(in <-chan int) {
            defer wg.Done()
            for v := range in {
                out <- v
            }
        }(in)
    }
    go func() { wg.Wait(); close(out) }()
    return out
}
```

**Problem.** N+1 goroutines for N inputs. For small N this is fine. For large N (hundreds of subscribers), goroutine count explodes. Also, no cancellation: if `out` is never read, all the fan-out goroutines leak.

**Refactor option A — single-goroutine merge (static, small N):**

```go
func merge3(ctx context.Context, a, b, c <-chan int) <-chan int {
    out := make(chan int)
    go func() {
        defer close(out)
        alive := 3
        for alive > 0 {
            select {
            case v, ok := <-a:
                if !ok { a = nil; alive--; continue }
                sendOrExit(ctx, out, v)
            case v, ok := <-b:
                if !ok { b = nil; alive--; continue }
                sendOrExit(ctx, out, v)
            case v, ok := <-c:
                if !ok { c = nil; alive--; continue }
                sendOrExit(ctx, out, v)
            case <-ctx.Done():
                return
            }
        }
    }()
    return out
}
```

**Refactor option B — `reflect.Select` for dynamic N:**

See Exercise 3.

**Trade-off.** Single goroutine + static `select` is fastest. `reflect.Select` is necessary for runtime-determined N. N+1 goroutines is the simplest code but worst on goroutine count and leak risk.

---

## Exercise 7 — Conditional-close hazard

**Starting code.**

```go
func cleanup(channels []chan int) {
    for _, ch := range channels {
        close(ch)
    }
}
```

**Problem.** If any channel in the slice is nil (e.g., from a partial initialisation), `close(ch)` panics.

**Refactor.** Guard each close:

```go
func cleanup(channels []chan int) {
    for _, ch := range channels {
        if ch != nil {
            close(ch)
        }
    }
}
```

Or, better, redesign so the slice only contains live channels (filter at construction).

**Measurement.** The performance impact of the nil-check is one comparison per iteration. Negligible.

---

## Exercise 8 — Closed-channel busy-loop

**Starting code.**

```go
func consumer(in <-chan int) {
    for {
        select {
        case v, ok := <-in:
            if !ok {
                // channel closed; just keep going
                continue
            }
            process(v)
        }
    }
}
```

**Problem.** Once `in` is closed, the receive case fires forever (returning `(0, false)` instantly). 100% CPU.

**Refactor.** Nil it.

```go
func consumer(in <-chan int) {
    for {
        select {
        case v, ok := <-in:
            if !ok {
                in = nil
                continue
            }
            process(v)
        }
    }
}
```

But now: the `select` has only one case, and it's nil. The goroutine parks forever. Need an exit:

```go
func consumer(in <-chan int) {
    for {
        select {
        case v, ok := <-in:
            if !ok {
                return // or break out
            }
            process(v)
        }
    }
}
```

`return` is simpler than `in = nil` when no other cases exist. The nil-channel-disabling pattern is only valuable when *other* cases continue.

**Lesson.** Always ask: after I nil this channel, what happens? If the answer is "nothing else runs," `return` is better.

---

## Exercise 9 — Replace a complex state machine

**Starting code.**

```go
type State int
const (
    Idle State = iota
    Active
    Throttled
)

func server(ctx context.Context, in <-chan Job, out chan<- Result) {
    state := Idle
    for {
        switch state {
        case Idle:
            select {
            case <-ctx.Done(): return
            case cmd := <-control: state = applyControl(state, cmd)
            }
        case Active:
            select {
            case <-ctx.Done(): return
            case job := <-in:
                out <- process(job)
            case cmd := <-control: state = applyControl(state, cmd)
            }
        case Throttled:
            select {
            case <-ctx.Done(): return
            case cmd := <-control: state = applyControl(state, cmd)
            }
        }
    }
}
```

**Problem.** Three `select` blocks, lots of duplication.

**Refactor.** Single `select`, with channel variables gating state.

```go
func server(ctx context.Context, in <-chan Job, out chan<- Result, control <-chan string) {
    state := Idle
    for {
        var inCh <-chan Job
        var outCh chan<- Result
        var head Result
        pending := []Result{}

        if state == Active {
            inCh = in
        }
        if (state == Active || state == Throttled) && len(pending) > 0 {
            outCh = out
            head = pending[0]
        }

        select {
        case job := <-inCh:
            pending = append(pending, process(job))
        case outCh <- head:
            pending = pending[1:]
        case cmd := <-control:
            state = applyControl(state, cmd)
        case <-ctx.Done():
            return
        }
    }
}
```

One `select`, state encoded in channel variables. Cleaner extension story.

---

## Exercise 10 — Reduce select case count

**Starting code.**

```go
for {
    select {
    case v := <-in1: emit(v)
    case v := <-in2: emit(v)
    case v := <-in3: emit(v)
    case v := <-in4: emit(v)
    case v := <-in5: emit(v)
    case v := <-in6: emit(v)
    case v := <-in7: emit(v)
    case v := <-in8: emit(v)
    case <-ctx.Done():
        return
    }
}
```

**Problem.** Each `select` evaluates all 9 cases on each iteration. The cost is `O(N)`.

**Refactor option A — Fan-in to a single channel upstream:**

```go
merged := merge(ctx, in1, in2, in3, in4, in5, in6, in7, in8)
for {
    select {
    case v := <-merged: emit(v)
    case <-ctx.Done(): return
    }
}
```

This pushes the multi-channel fan-in into a dedicated goroutine; the consumer's `select` is now `O(1)`.

**Refactor option B — Keep static `select` if rates are uneven:**

If `in1` carries 99% of traffic, a static `select` with all cases lets Go's randomised selection statistically favour `in1` because it is most often ready. A merge step adds latency.

**Trade-off.** Static `select` is fast for low-N. Merge-based fan-in is structured and scales better when N is large or when consumer is on a hot path. Measure.

---

## Exercise 11 — Idle drain on shutdown

**Starting code.**

```go
func worker(in <-chan Job, ctx context.Context) {
    for {
        select {
        case job := <-in:
            process(job)
        case <-ctx.Done():
            return
        }
    }
}
```

**Problem.** When `ctx` is cancelled, the worker exits *immediately*, potentially dropping jobs that are mid-queue in `in`.

**Refactor.** Phased shutdown: on cancellation, stop accepting new but drain in.

```go
func worker(in <-chan Job, ctx context.Context) {
    drain := false
    for {
        select {
        case job, ok := <-in:
            if !ok {
                return
            }
            process(job)
        case <-ctx.Done():
            if !drain {
                drain = true
                // Convert to drain mode: rely on close(in) to terminate
            }
        }
    }
}
```

Or, cleaner, using nil-channel disabling on ctx.Done:

```go
func worker(in <-chan Job, ctx context.Context) {
    done := ctx.Done()
    for {
        select {
        case job, ok := <-in:
            if !ok { return }
            process(job)
        case <-done:
            done = nil // ignore further cancellation; drain mode
            // (caller must close(in) for us to exit)
        }
    }
}
```

The `done = nil` line says "we've heard the cancellation; now we are in drain mode." Caller closes `in` to make the worker exit. The combination is the phased-shutdown pattern.

---

## Exercise 12 — Benchmark: nil-channel vs flag

Write a benchmark that compares:

- A `select`-loop with a flag and a closed channel.
- A `select`-loop with nil-channel disabling.

Measure throughput when the input channel is closed and the loop continues running on a heartbeat.

**Expected result.** The flag version pegs CPU; the nil-channel version blocks cleanly between heartbeats.

```go
func BenchmarkFlagVersion(b *testing.B) {
    in := make(chan int)
    close(in)
    heartbeat := time.NewTicker(time.Microsecond)
    defer heartbeat.Stop()
    ctx, cancel := context.WithCancel(context.Background())
    defer cancel()

    b.ResetTimer()
    drained := false
    count := 0
    for count < b.N {
        select {
        case _, ok := <-in:
            if !ok { drained = true; continue }
        case <-heartbeat.C:
            count++
        case <-ctx.Done():
            return
        }
        _ = drained
    }
}

func BenchmarkNilVersion(b *testing.B) {
    in := make(chan int)
    close(in)
    heartbeat := time.NewTicker(time.Microsecond)
    defer heartbeat.Stop()
    ctx, cancel := context.WithCancel(context.Background())
    defer cancel()

    b.ResetTimer()
    count := 0
    for count < b.N {
        select {
        case _, ok := <-in:
            if !ok { in = nil; continue }
        case <-heartbeat.C:
            count++
        case <-ctx.Done():
            return
        }
    }
}
```

`BenchmarkFlagVersion` should be much slower because each iteration spins on the closed channel.

---

## Solutions Summary

The optimisations cluster around five themes:

1. **Replace flags with nil channels** for `select` gating (Exercises 1, 2, 9).
2. **Pre-allocate reflect cases** (Exercise 3).
3. **Toggle local channel variables instead of recreating tickers** (Exercise 4).
4. **Prefer `context.Context` over hand-rolled cancellation channels** (Exercise 5).
5. **Choose the right fan-in strategy** for N (Exercises 6, 10).

Common pitfalls:

- Nil-disabling a case when no other case can fire ⇒ deadlock or leak. Always pair with an always-live case.
- Niling a channel concurrently with other goroutines reading or writing it ⇒ data race. Mutate from the owner only.
- Using nil channels when `close` is the right primitive ⇒ broadcast doesn't happen; receivers leak.

A senior engineer's instinct: when a `select`-loop has flags, conditionals around cases, or duplicated structure, nil-channel disabling is usually the simplification. When a system needs broadcast or one-shot notification, use `close` or `context`.

---

## Wrap-up

Optimisation with nil channels is mostly *clarity* optimisation, not performance. The wins:

- Fewer branches in the `select` body.
- No busy-loops on closed channels.
- Reusable `select` shapes that compose with cancellation.
- Pre-allocated `reflect.Select` cases for dynamic fan-in.

The losses, when applied wrongly:

- Easy to introduce silent deadlocks (all-nil with no default).
- Closure-capture races between goroutines.
- Confusion between "disabled" and "closed" cases.

Measure with `go test -bench`, profile with pprof, validate with `goleak`. The patterns are simple; the discipline is to use them only where they pay rent.
