# Select Statement — Optimization

> Honest framing first: in most Go services, `select` is not the bottleneck. The runtime's `selectgo` is well tuned, the typical for-select loop wakes a few hundred or a few thousand times per second, and the cost of one selection is dominated by what happens *inside* the chosen case, not by the selection machinery itself. If your profile does not show `runtime.selectgo` near the top, almost everything below is premature.
>
> What *is* worth optimizing is the patterns around `select`: the timer that leaks because you wrote `time.After` inside a hot loop, the goroutine that busy-spins on `default + Sleep`, the case list that grows long enough that runtime fairness picks a slow path, the `reflect.Select` you reached for when a switch on `len(cases)` would have done. These are the changes that move real numbers — allocations per second, P99 latency, goroutine count, GC pause — and each of them has been a real production fix in real production code.
>
> Each entry below states the problem, shows a "before" version, an "after" version, the realistic gain, and the caveat that prevents you from over-applying it.

---

## Optimization 1 — Replace busy-wait with select+timer

**Problem:** Code that waits for an event by polling in a tight loop with `time.Sleep` burns CPU, sleeps too long when the event arrives mid-sleep, and adds latency proportional to the sleep granularity. A `select` on a channel and a timer does the same job with zero polling overhead.

**Before:**
```go
func waitForReady(ready *atomic.Bool, deadline time.Time) bool {
    for time.Now().Before(deadline) {
        if ready.Load() {
            return true
        }
        time.Sleep(5 * time.Millisecond)
    }
    return false
}
```
Average wake-up latency is ~2.5 ms even when the flag flipped immediately after the sleep started. CPU is non-zero across thousands of such waiters.

**After:**
```go
func waitForReady(ctx context.Context, signal <-chan struct{}) bool {
    select {
    case <-signal:
        return true
    case <-ctx.Done():
        return false
    }
}
```
The producer closes `signal` (or sends once) when the resource is ready. The waiter parks on the channel — zero CPU until the wake-up — and resumes within microseconds.

**Gain:** From ~2.5 ms median latency at non-zero CPU to ~5 µs at zero CPU. Across 10k waiters, GOMAXPROCS load drops by 10–30% in services that previously spent measurable time in the polling loop.

**Caveat:** You need a real channel from the producer. If the only signal you have is a flag in shared memory you cannot wake from, change the producer first; do not work around it with a polling waiter.

---

## Optimization 2 — Batch operations to reduce select churn

**Problem:** A for-select that pays the full select-and-dispatch cost for each tiny message wastes most of its time in scheduler bookkeeping when the queue is hot. If consumers can process N items at once, you can amortise the wake-up cost.

**Before:**
```go
for {
    select {
    case ev := <-events:
        write(ev)
    case <-ctx.Done():
        return
    }
}
```
With 200k events/sec, that is 200k selectgo calls and 200k disk writes per second.

**After:**
```go
const batchMax = 64
buf := make([]Event, 0, batchMax)

for {
    select {
    case ev := <-events:
        buf = append(buf, ev)
        // drain whatever is already queued, up to batchMax
    drain:
        for len(buf) < batchMax {
            select {
            case ev := <-events:
                buf = append(buf, ev)
            default:
                break drain
            }
        }
        writeBatch(buf)
        buf = buf[:0]
    case <-ctx.Done():
        return
    }
}
```
The outer select still blocks when there is no work; once an event arrives, the inner non-blocking drain pulls everything else that is already queued and the writer flushes the batch in one syscall.

**Gain:** With bursty traffic and a bulk-capable downstream (disk, syscall, network buffer), throughput typically rises 5–20× and selectgo CPU drops by an order of magnitude.

**Caveat:** Latency for the *first* item in a quiet period is unchanged; only the steady-state amortises. If you must guarantee per-event latency, cap the batch by both size and a tight max-wait timer.

---

## Optimization 3 — Use one `time.NewTimer` with `Reset`

**Problem:** `time.After(d)` inside a hot loop allocates a fresh `*time.Timer` per iteration. That timer cannot be garbage-collected until it fires. In a loop that completes in microseconds, you accumulate a Timer per iteration, each living for `d` seconds. Heap usage grows; GC pressure rises; eventually you OOM.

**Before:**
```go
for {
    select {
    case msg := <-input:
        handle(msg)
    case <-time.After(time.Second): // new *Timer every iteration
        log.Println("idle")
        return
    }
}
```
At 1M loops/sec for 1 s of run-time you leak ~1M timers. Pprof shows `time.NewTimer` and the timer goroutine dominating allocation.

**After:**
```go
idle := time.NewTimer(time.Second)
defer idle.Stop()

for {
    select {
    case msg := <-input:
        handle(msg)
        if !idle.Stop() {
            <-idle.C // drain if it had already fired
        }
        idle.Reset(time.Second)
    case <-idle.C:
        log.Println("idle")
        return
    }
}
```
One Timer for the lifetime of the loop, reset on every "kept busy" event.

**Gain:** Allocations per second drop to zero for the timer path. In a measured proxy this changed Heap-In-Use from "growing 50 MB/min" to flat. P99 latency dropped because GC ran less often.

**Caveat:** The Stop/Drain/Reset dance is easy to get subtly wrong. On Go 1.23+ the timer semantics changed (Stop and Reset no longer require manual draining in many cases) — read the release notes for your Go version before copy-pasting old patterns.

---

## Optimization 4 — Reduce the case count

**Problem:** Runtime `selectgo` cost grows roughly linearly with the number of cases (it sorts and locks each one). A select with 12 cases is measurably slower per-iteration than one with 3. Worse, large case lists are usually a code-smell: they often mean one goroutine is doing several jobs that should each have their own loop.

**Before:**
```go
for {
    select {
    case j := <-jobsHigh:
        run(j)
    case j := <-jobsMid:
        run(j)
    case j := <-jobsLow:
        run(j)
    case <-ticker1.C:
        flushA()
    case <-ticker2.C:
        flushB()
    case <-ticker3.C:
        flushC()
    case e := <-eventsA:
        recordA(e)
    case e := <-eventsB:
        recordB(e)
    case <-ctx.Done():
        return
    }
}
```

**After:** Split by responsibility. One goroutine handles jobs (3 cases), one handles ticks (1 multi-channel case via a fan-in), one handles events. Each loop has 3–4 cases and a clear name in the stack trace.

```go
go runJobs(ctx, jobsHigh, jobsMid, jobsLow)
go runFlushers(ctx, ticker1.C, ticker2.C, ticker3.C)
go runEvents(ctx, eventsA, eventsB)
```

Or merge homogeneous channels with a fan-in goroutine so the consumer only sees one channel.

**Gain:** Per-iteration selectgo cost drops by 2–3× when the case count goes from 9 down to 3. More importantly, each loop becomes independently testable and stoppable.

**Caveat:** Splitting introduces extra goroutines and channels. If the cases are genuinely interdependent — e.g. a state machine where any event can change which channels matter — keep them in one select and accept the per-iteration cost.

---

## Optimization 5 — Use the nil-channel trick to disable cases dynamically

**Problem:** Some cases should only fire under certain conditions ("send only when buffer non-empty," "accept input only when not paused"). Building this with extra `if` guards or with multiple distinct selects forces you to allocate or branch on every iteration.

**Before:**
```go
for {
    if paused {
        select {
        case <-resume:
            paused = false
        case <-ctx.Done():
            return
        }
    } else {
        select {
        case in := <-input:
            buf = append(buf, in)
        case <-pause:
            paused = true
        case <-ctx.Done():
            return
        }
    }
}
```
Two distinct selects, two code paths to maintain.

**After:**
```go
for {
    var inCh <-chan Item = input
    if paused {
        inCh = nil // disable input case
    }
    select {
    case in := <-inCh: // never fires when nil
        buf = append(buf, in)
    case <-pause:
        paused = true
    case <-resume:
        paused = false
    case <-ctx.Done():
        return
    }
}
```
A nil receive case is permanently "not ready," so the select naturally ignores it. One select, one code path, and the toggle is local to one variable.

**Gain:** Dead-code elimination at the language level. Fewer branches, a single select layout, easier to instrument.

**Caveat:** Confusing for readers who do not know the nil-channel rule. Add a one-line comment the first time it appears in a file.

---

## Optimization 6 — Avoid `select` for trivial single-case usage

**Problem:** A select with exactly one channel case (and no `default`) is identical in behaviour to a plain receive — but pays the selectgo overhead. People reach for select reflexively when they only have one thing to wait on, especially after refactoring.

**Before:**
```go
for {
    select {
    case msg := <-input:
        process(msg)
    }
}
```
Same as `for msg := range input { process(msg) }` but slower and harder to read.

**After:**
```go
for msg := range input {
    process(msg)
}
```

For a single channel with cancellation, do not write a one-case select either:

```go
// BAD
select {
case v := <-ch:
    use(v)
}

// GOOD
v := <-ch
use(v)
```

**Gain:** A few nanoseconds per iteration and meaningful readability. In tight loops processing millions of items, the cumulative saving is measurable.

**Caveat:** As soon as you need a second case (a timeout, a cancel, a heartbeat) you need select again. Don't trade away cancellation just to remove the select.

---

## Optimization 7 — Replace `select`-with-default polling on `ctx.Done()`

**Problem:** Some code peeks at cancellation by polling: `select { case <-ctx.Done(): return; default: }`. This is correct but wasteful — the goroutine returns to a CPU-bound loop and only checks cancellation between iterations. If a unit of work is long, cancellation is delayed; if it is short, every iteration pays the polling cost.

**Before:**
```go
for _, item := range hugeSlice {
    select {
    case <-ctx.Done():
        return ctx.Err()
    default:
    }
    expensive(item)
}
```
Cancellation latency is one `expensive(item)` call. Per-iteration cost is the selectgo overhead even though no cancellation is happening 99.9% of the time.

**After:** If the work itself is channel-driven, do the cancellation in the same select that pulls work:

```go
for {
    select {
    case item, ok := <-items:
        if !ok {
            return nil
        }
        expensive(item)
    case <-ctx.Done():
        return ctx.Err()
    }
}
```

If the loop is over a slice, hand the cancellation check to a worker pool entry-point and only check it once per batch:

```go
for batchStart := 0; batchStart < len(hugeSlice); batchStart += batchSize {
    select {
    case <-ctx.Done():
        return ctx.Err()
    default:
    }
    for _, item := range hugeSlice[batchStart : batchStart+batchSize] {
        expensive(item)
    }
}
```

**Gain:** Per-iteration overhead is amortised across `batchSize` items. Cancellation latency stays bounded by one batch.

**Caveat:** Polling with `default` is fine in code that is not on the hot path. Don't refactor a one-shot startup routine to save 10 ns of cancel-check overhead.

---

## Optimization 8 — Coalesce timeouts: share one timer across multiple selects

**Problem:** A function that wraps several blocking operations in a row, each with its own `select { ... case <-time.After(d): }`, allocates a fresh timer at each step and pays for the bookkeeping each time, even though the wall-clock budget is shared.

**Before:**
```go
func three(ctx context.Context, a, b, c <-chan int) (int, int, int, error) {
    var x, y, z int
    select {
    case x = <-a:
    case <-time.After(timeout):
        return 0, 0, 0, errTimeout
    }
    select {
    case y = <-b:
    case <-time.After(timeout):
        return 0, 0, 0, errTimeout
    }
    select {
    case z = <-c:
    case <-time.After(timeout):
        return 0, 0, 0, errTimeout
    }
    return x, y, z, nil
}
```
Three timers, three potential leaks if the timeouts do not fire, three independent budgets.

**After:** Derive one deadline-bound context and let every step observe it:
```go
func three(ctx context.Context, a, b, c <-chan int) (int, int, int, error) {
    ctx, cancel := context.WithTimeout(ctx, timeout)
    defer cancel()
    var x, y, z int
    select {
    case x = <-a:
    case <-ctx.Done():
        return 0, 0, 0, ctx.Err()
    }
    select {
    case y = <-b:
    case <-ctx.Done():
        return 0, 0, 0, ctx.Err()
    }
    select {
    case z = <-c:
    case <-ctx.Done():
        return 0, 0, 0, ctx.Err()
    }
    return x, y, z, nil
}
```
One timer (inside `WithTimeout`) covers all three selects, and the whole call has one shared budget.

**Gain:** One `*time.Timer` instead of three; total wall-clock cap correct ("the *whole* call should finish in `timeout`," not "each step gets its own `timeout`"). For a deeply-pipelined function this saves real allocations and matches the user's actual expectation.

**Caveat:** Sometimes the per-step timeout is what you want — e.g. a retry loop where each attempt has its own clock. Pick the model that matches the contract you intend to expose.

---

## Optimization 9 — Avoid `select` with `default` in a hot loop

**Problem:** A `select { case ...: ; default: }` in a tight loop is a busy-spin in disguise. The goroutine never blocks; it polls, finds nothing, runs `default`, polls again. CPU goes to 100% on one core even when no work is happening.

**Before:**
```go
for {
    select {
    case j := <-jobs:
        process(j)
    default:
        // nothing yet
    }
}
```
Spin-locked at full CPU. Adds noise to GC pause measurements, distorts scheduler decisions, and is invisible in metrics that average over windows larger than a millisecond.

**After:** Drop the `default`; let the goroutine block.
```go
for {
    select {
    case j := <-jobs:
        process(j)
    case <-ctx.Done():
        return
    }
}
```

If you really need to do something while nothing is on `jobs`, drive that something from a timer or a different channel — not from `default`.

**Gain:** From 100% CPU to ~0% CPU when idle. Across a fleet, this is the difference between "we run at 60% utilisation" and "we run at 25% utilisation" — a real cost-of-goods change.

**Caveat:** A `default` case is correct in three places: non-blocking enqueue (`drop on full`), bounded drain after a blocking primary case (Optimization 2), and one-shot peeks. Outside those, treat it as a smell.

---

## Optimization 10 — Pre-resolve channels outside the hot loop

**Problem:** Re-evaluating a channel expression on every iteration — by calling a method, dereferencing a pointer, or walking a struct — pays the cost on every iteration even though the answer never changes. The compiler cannot always hoist this, especially across interface boundaries.

**Before:**
```go
type Bus struct{ subs []chan Event }

func (b *Bus) Run(ctx context.Context) {
    for {
        select {
        case e := <-b.input.Events(): // method call, possibly through an interface
            for i := range b.subs {
                b.subs[i] <- e
            }
        case <-ctx.Done():
            return
        }
    }
}
```
Each iteration resolves `b.input.Events()` afresh, possibly through a vtable.

**After:**
```go
func (b *Bus) Run(ctx context.Context) {
    in := b.input.Events()       // one method call, hoisted
    subs := b.subs               // local slice header
    done := ctx.Done()           // one method call, hoisted
    for {
        select {
        case e := <-in:
            for i := range subs {
                subs[i] <- e
            }
        case <-done:
            return
        }
    }
}
```

**Gain:** A few ns per iteration become free; in micro-benchmarks of busy loops this is sometimes 5–10% throughput. The bigger win is cleaner asm output and fewer surprises when the compiler decides not to inline.

**Caveat:** Only hoist if the channel really is invariant. If the source can change mid-loop (e.g. you swap the upstream when the connection reconnects), keep the method call inside.

---

## Optimization 11 — `runtime.LockOSThread` + select for latency-critical paths (advanced)

**Problem:** The Go scheduler can move a goroutine between OS threads between iterations of a select loop. For most code this is invisible, but for sub-microsecond latency paths (a market-data tap, a kernel-bypass network interface, a real-time audio pipeline) the cost of being rescheduled onto a cold core (cache miss, branch-predictor reset, NUMA hop) shows up as occasional latency spikes in P99.999.

**Before:**
```go
go func() {
    for {
        select {
        case pkt := <-pkts:
            handle(pkt)
        case <-stop:
            return
        }
    }
}()
```
Median latency is fine; tail latency shows tens-of-µs spikes whenever the goroutine migrates.

**After:**
```go
go func() {
    runtime.LockOSThread()
    defer runtime.UnlockOSThread()
    for {
        select {
        case pkt := <-pkts:
            handle(pkt)
        case <-stop:
            return
        }
    }
}()
```

The goroutine is pinned to one OS thread. If the host has CPU isolation enabled (`isolcpus=`, `cset shield`, `taskset`), pin that thread to an isolated core via `unix.SchedSetaffinity` after `LockOSThread`.

**Gain:** Typical P99.999 latency improvements of 2–10× in low-latency networking loops. Cache-resident state stays warm; no scheduler-induced jitter.

**Caveat:** This is a heavy hammer. It removes a goroutine from the common scheduling pool, can starve sibling goroutines if they relied on that thread, and only helps if you can also stop the OS from scheduling other work onto the same core. Do not reach for it without a profile that shows scheduler-induced tail-latency.

---

## Optimization 12 — `reflect.Select` is slow; avoid it for fixed-N cases

**Problem:** `reflect.Select` exists for selects whose case set is known only at runtime (e.g. a router that selects across an arbitrary slice of channels). It is dramatically slower than a literal select — typical numbers are 10–100× — because each call constructs `reflect.Value`s, copies the case array, and dispatches through reflection.

**Before:**
```go
func first(chs []<-chan int) (int, int) {
    cases := make([]reflect.SelectCase, len(chs))
    for i, c := range chs {
        cases[i] = reflect.SelectCase{
            Dir:  reflect.SelectRecv,
            Chan: reflect.ValueOf(c),
        }
    }
    chosen, recv, _ := reflect.Select(cases)
    return chosen, int(recv.Int())
}
```
Every call allocates, every case is reflected, every iteration is slow. For a fan-in over a fixed two channels this is a 50× cost.

**After (fixed N):** write the literal select:
```go
func first2(a, b <-chan int) (int, int) {
    select {
    case v := <-a:
        return 0, v
    case v := <-b:
        return 1, v
    }
}
```

**After (variable N):** if N is bounded but small (say, at most 8), use a switch ladder over `len(chs)`:
```go
switch len(chs) {
case 1:
    return 0, <-chs[0]
case 2:
    select {
    case v := <-chs[0]:
        return 0, v
    case v := <-chs[1]:
        return 1, v
    }
// ... up to the bound
}
```

**After (truly variable N):** fan-in goroutines write into a single merged channel, then the consumer does a 1-channel receive:
```go
func merge(chs []<-chan int) <-chan int {
    out := make(chan int, 64)
    var wg sync.WaitGroup
    wg.Add(len(chs))
    for _, c := range chs {
        go func(c <-chan int) {
            defer wg.Done()
            for v := range c {
                out <- v
            }
        }(c)
    }
    go func() { wg.Wait(); close(out) }()
    return out
}
```

**Gain:** Replacing `reflect.Select` with a fan-in pattern is typically 10–100× throughput improvement and removes per-iteration allocation entirely.

**Caveat:** If you genuinely have an unbounded set of sources that come and go at runtime (e.g. a chat-room server with N sessions), a fan-in goroutine per source plus a merged channel is the right architecture; do not try to keep `reflect.Select` "for flexibility."

---

## Benchmarking and Measurement

Optimisation without measurement is folklore. For select-heavy code the most useful signals:

```go
// Microbenchmarks per pattern
func BenchmarkSelectTwo(b *testing.B) {
    a := make(chan int, 1)
    c := make(chan int, 1)
    a <- 1
    for i := 0; i < b.N; i++ {
        select {
        case v := <-a:
            a <- v
        case v := <-c:
            c <- v
        }
    }
}

func BenchmarkReflectSelectTwo(b *testing.B) {
    a := make(chan int, 1)
    c := make(chan int, 1)
    a <- 1
    cases := []reflect.SelectCase{
        {Dir: reflect.SelectRecv, Chan: reflect.ValueOf(a)},
        {Dir: reflect.SelectRecv, Chan: reflect.ValueOf(c)},
    }
    for i := 0; i < b.N; i++ {
        chosen, v, _ := reflect.Select(cases)
        if chosen == 0 {
            a <- int(v.Int())
        } else {
            c <- int(v.Int())
        }
    }
}
```

Run with:
```bash
go test -bench=. -benchmem -benchtime=2s ./...
go test -bench=. -cpuprofile=cpu.out -memprofile=mem.out
go tool pprof -http :8080 cpu.out
```

Useful observations:
- `runtime.selectgo` near the top of a CPU profile means you have too many cases or too many iterations per second; consider Optimizations 4, 6, or 9.
- A growing `time.NewTimer` allocation column means Optimization 3 applies.
- Goroutines stuck on `<-time.After(...)` in a goroutine dump means a leak from a tight `time.After` loop.
- Per-iteration allocations > 0 in `benchmem` for a select-only benchmark almost always traces back to a `time.After` or a `reflect.Select`.

For end-to-end signals, watch P99 latency, allocation rate (`runtime/metrics`), and goroutine count over time. If a "fix" does not move them measurably, it was not a fix.

---

## When NOT to Optimize

- **The select runs once per request.** A web handler that does one select per HTTP request is not the bottleneck — the database call inside the case is. Profile the case body, not the select.
- **The case body dwarfs the select.** If the chosen case takes a millisecond, the 100-nanosecond selectgo cost is invisible. Optimise the body first.
- **You are pre-1.0 and the API is changing weekly.** Stabilise the shape before micro-tuning the implementation; you will rewrite the hot loop anyway.
- **The "optimised" version is unreadable.** A nil-channel toggle, a Stop/Drain/Reset dance, and an OS-thread pin in one function is a maintenance liability. Spend cleverness only where the profile demands it.
- **Cancellation latency is the metric, not throughput.** Then add the cancel case, do not remove it. Optimization 7 is about polling; do not interpret it as "remove ctx.Done() from every loop."
- **You have not run a profile.** "It feels slow" is not a profile. `pprof`, `go test -bench`, `runtime/metrics`, or `trace` first. Then optimise.

---

## Summary

`select` is one of the cheapest concurrency primitives Go provides — the runtime has had two decades to tune it — and most of the time the right answer is "leave it alone." When the profile says otherwise, the wins come not from rewriting selectgo but from the patterns around it: kill busy-waits with a real channel signal; batch when downstream allows; reuse one timer instead of leaking one per iteration; keep case counts small; turn cases off with nil channels instead of restructuring; do not wrap a single channel in a select; share one timer across a multi-step call; never spin with `default` in a hot loop; hoist invariant channels out of the loop; reach for `LockOSThread` only when scheduler jitter is provable; and avoid `reflect.Select` for any fixed-N case set.

Each entry above is small in code but large in cumulative effect. Apply them where measurement asks for them, leave the rest of your selects alone, and you will spend your optimisation budget where it actually moves numbers — on the work *inside* the case body, not on the select that picked it.
