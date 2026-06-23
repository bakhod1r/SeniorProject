# Fan-Out — Find the Bug

> Each snippet contains a real-world bug in a fan-out implementation: leaks, races, deadlocks, panics, missing cancellation, head-of-line blocking, and the long tail of "looks fine, fails in prod." Find it, explain it, fix it. Every fix is paired with a runnable example.

---

## Bug 1 — Workers exit early on first error

```go
func Process(in <-chan int, n int) error {
    var firstErr error
    var wg sync.WaitGroup
    wg.Add(n)
    for i := 0; i < n; i++ {
        go func() {
            defer wg.Done()
            for v := range in {
                if err := work(v); err != nil {
                    firstErr = err
                    return // exit this worker
                }
            }
        }()
    }
    wg.Wait()
    return firstErr
}
```

**Bug.** When a worker hits an error, *only that worker* returns. The other N-1 keep grinding. Worse, `firstErr` is read/written by all workers without synchronization — a data race. Worst, after one worker exits, the remaining workers absorb its share of the input until they too fail, so the function returns the *last* error, not the *first*.

**Fix.** Use `errgroup.WithContext`. The first error cancels the derived ctx; workers see `<-ctx.Done()` and exit cleanly.

```go
func Process(parent context.Context, in <-chan int, n int) error {
    g, ctx := errgroup.WithContext(parent)
    for i := 0; i < n; i++ {
        g.Go(func() error {
            for {
                select {
                case <-ctx.Done():
                    return ctx.Err()
                case v, ok := <-in:
                    if !ok { return nil }
                    if err := work(v); err != nil { return err }
                }
            }
        })
    }
    return g.Wait()
}
```

`g.Wait` returns the first non-nil error returned by any goroutine. Subsequent errors are discarded. Every worker observes the cancellation and exits within one loop iteration.

---

## Bug 2 — Missing `wg.Done`

```go
func Process(in <-chan int, n int) {
    var wg sync.WaitGroup
    wg.Add(n)
    for i := 0; i < n; i++ {
        go func() {
            for v := range in {
                if v < 0 {
                    return // forgot wg.Done
                }
                fmt.Println(v)
            }
            wg.Done()
        }()
    }
    wg.Wait()
}
```

**Bug.** The early-return path skips `wg.Done`. If any input is negative, that worker exits without decrementing the counter; `wg.Wait` blocks forever; the program hangs.

The trap is structural: any code path that exits the goroutine must decrement. Manual `wg.Done()` placement at the end is fragile.

**Fix.** Use `defer wg.Done()` at the top of the goroutine. It runs no matter how the function exits — return, panic, anything.

```go
for i := 0; i < n; i++ {
    go func() {
        defer wg.Done()
        for v := range in {
            if v < 0 { return }
            fmt.Println(v)
        }
    }()
}
```

Even if a worker panics later, `defer` still fires before the panic unwinds the goroutine. `wg.Wait` then returns and the program continues (or panics into the outer context if you don't recover).

---

## Bug 3 — Work not distributed (single worker bottleneck)

```go
func Process(in <-chan Job, n int) {
    var wg sync.WaitGroup
    wg.Add(n)
    go func() {
        defer wg.Done()
        for j := range in {
            // ... heavy work
            doWork(j)
        }
    }()
    for i := 1; i < n; i++ {
        go func() {
            defer wg.Done()
            // worker spec didn't include reading from `in`
            time.Sleep(time.Hour)
        }()
    }
    wg.Wait()
}
```

**Bug.** Only the first goroutine reads from `in`. The remaining `n-1` goroutines are dummies (here represented as `time.Sleep`). Profile shows one core pegged, n-1 idle. Throughput is sequential despite the appearance of fan-out.

In production this looks innocent: a refactor extracted the worker body, the loop became "spawn n workers" but the body forgot to read from `in`. Symptom: throughput doesn't scale with N.

**Fix.** Every worker must read from `in`. Hoist the body into a single function and call it from all N goroutines.

```go
func Process(in <-chan Job, n int) {
    var wg sync.WaitGroup
    wg.Add(n)
    worker := func() {
        defer wg.Done()
        for j := range in {
            doWork(j)
        }
    }
    for i := 0; i < n; i++ {
        go worker()
    }
    wg.Wait()
}
```

A simple sanity test: log each worker's id alongside the job count it processes. If only one id appears, the bug is back.

---

## Bug 4 — Channel leaked: closer goroutine never runs

```go
func Process(in <-chan int) <-chan int {
    out := make(chan int)
    var wg sync.WaitGroup
    wg.Add(4)
    for i := 0; i < 4; i++ {
        go func() {
            defer wg.Done()
            for v := range in {
                out <- v * 2
            }
        }()
    }
    // forgot the closer goroutine
    return out
}
```

**Bug.** No goroutine ever closes `out`. The consumer's `for v := range out` runs forever — the channel never reports "no more values." Even after every worker has called `wg.Done()`, the absence of a `close(out)` traps the consumer.

`wg.Wait()` is never called either, so even from the producer side there is no signal.

**Fix.** Add the closer goroutine. It is short and idiomatic — make it part of every fan-out helper you write.

```go
func Process(in <-chan int) <-chan int {
    out := make(chan int)
    var wg sync.WaitGroup
    wg.Add(4)
    for i := 0; i < 4; i++ {
        go func() {
            defer wg.Done()
            for v := range in {
                out <- v * 2
            }
        }()
    }
    go func() { wg.Wait(); close(out) }()
    return out
}
```

A typical `goleak` test catches this immediately: after the consumer's range exits cleanly (only after `close(out)`), the test passes; without the closer, `goleak` reports the consumer is still blocked.

---

## Bug 5 — Single slow worker stalls all (head-of-line blocking)

```go
type Job struct { ID int; Slow bool }

func Process(jobs []Job, n int) []int {
    in := make(chan Job)
    out := make(chan int)
    var wg sync.WaitGroup

    // pre-assign jobs to workers (round-robin)
    perWorker := make([]chan Job, n)
    for i := range perWorker { perWorker[i] = make(chan Job, 100) }
    for i, j := range jobs { perWorker[i%n] <- j }
    for i := range perWorker { close(perWorker[i]) }

    wg.Add(n)
    for i := 0; i < n; i++ {
        i := i
        go func() {
            defer wg.Done()
            for j := range perWorker[i] {
                if j.Slow { time.Sleep(time.Second) }
                out <- j.ID
            }
        }()
    }
    go func() { wg.Wait(); close(out) }()

    var ids []int
    for v := range out { ids = append(ids, v) }
    return ids
    _ = in
}
```

**Bug.** Pre-assigning jobs round-robin means once one worker is stuck on a slow job, the rest of *its* assigned jobs sit idle in *its* queue. Other workers cannot help: they have no read access to that queue.

If 1% of jobs are 100x slower than the rest, you converge to "the slowest worker's queue length × the slow job duration" instead of the parallel optimum.

This is *push-mode* assignment without work stealing. A classic head-of-line blocking pattern.

**Fix.** Switch to *pull-mode* — one shared input channel, all workers read it. The runtime picks whichever worker is ready, so slow jobs don't block fast ones.

```go
func Process(jobs []Job, n int) []int {
    in := make(chan Job)
    out := make(chan int)
    var wg sync.WaitGroup

    go func() {
        defer close(in)
        for _, j := range jobs { in <- j }
    }()

    wg.Add(n)
    for i := 0; i < n; i++ {
        go func() {
            defer wg.Done()
            for j := range in {
                if j.Slow { time.Sleep(time.Second) }
                out <- j.ID
            }
        }()
    }
    go func() { wg.Wait(); close(out) }()

    var ids []int
    for v := range out { ids = append(ids, v) }
    return ids
}
```

Now a slow job blocks only the worker processing it; the others continue draining. If you really want pre-assignment for cache locality, layer in work stealing.

---

## Bug 6 — Unbounded fan-out exhausts memory

```go
func Process(jobs <-chan Job) <-chan Result {
    out := make(chan Result)
    go func() {
        for j := range jobs {
            go func(j Job) {
                out <- work(j)
            }(j)
        }
    }()
    return out
}
```

**Bug.** This is "spawn one goroutine per job" — *not* fan-out. With one million jobs, you launch one million goroutines simultaneously. Each holds at minimum a 2 KB stack (~2 GB total). The result channel `out` is unbuffered; every worker blocks on send; every goroutine is stuck in `gopark`. The process grows until OOM.

Even if you buffer `out`, you still spawn one goroutine per job — fine for thousands, catastrophic for millions, especially if each goroutine holds open file descriptors or DB connections.

**Fix.** Bound concurrency to N. The shape becomes the canonical fan-out:

```go
func Process(jobs <-chan Job, n int) <-chan Result {
    out := make(chan Result)
    var wg sync.WaitGroup
    wg.Add(n)
    for i := 0; i < n; i++ {
        go func() {
            defer wg.Done()
            for j := range jobs {
                out <- work(j)
            }
        }()
    }
    go func() { wg.Wait(); close(out) }()
    return out
}
```

Memory now scales with N (worker count), not with job count. A million jobs can flow through 16 workers with bounded RAM.

If the original code's `go func(j Job)` was an attempt at "I want each job in its own context" — get the same effect by giving each job its own ctx inside the worker:

```go
for j := range jobs {
    jobCtx, cancel := context.WithTimeout(parentCtx, 30*time.Second)
    out <- work(jobCtx, j)
    cancel()
}
```

---

## Bug 7 — Race on shared result map

```go
func Process(in <-chan string, n int) map[string]int {
    counts := map[string]int{}
    var wg sync.WaitGroup
    wg.Add(n)
    for i := 0; i < n; i++ {
        go func() {
            defer wg.Done()
            for s := range in {
                counts[s]++
            }
        }()
    }
    wg.Wait()
    return counts
}
```

**Bug.** Multiple workers write to `counts` concurrently. Maps in Go are not goroutine-safe; `go test -race` flags it immediately. In practice you'll see corrupt counts, panics ("concurrent map writes"), or both.

The temptation is to slap a mutex on the map. That works but serializes every worker's increment — the mutex becomes the bottleneck and erases the parallelism.

**Fix (better).** Each worker accumulates into a *private* map, then the main goroutine merges all per-worker maps after `wg.Wait`:

```go
func Process(in <-chan string, n int) map[string]int {
    type partial struct{ m map[string]int }
    results := make(chan partial, n)
    var wg sync.WaitGroup
    wg.Add(n)
    for i := 0; i < n; i++ {
        go func() {
            defer wg.Done()
            local := map[string]int{}
            for s := range in {
                local[s]++
            }
            results <- partial{local}
        }()
    }
    go func() { wg.Wait(); close(results) }()

    final := map[string]int{}
    for p := range results {
        for k, v := range p.m {
            final[k] += v
        }
    }
    return final
}
```

No locks, no contention, and `go test -race` is silent. The merge is sequential but quick (N maps, each with a small subset of keys).

For very large key spaces, consider sharding by key hash and giving each worker a fixed shard.

---

## Bug 8 — Double-close on result channel

```go
func Process(in <-chan int, n int) <-chan int {
    out := make(chan int)
    for i := 0; i < n; i++ {
        go func() {
            defer close(out) // wrong
            for v := range in {
                out <- v * v
            }
        }()
    }
    return out
}
```

**Bug.** Every worker has `defer close(out)`. The first worker to exit closes `out`; subsequent workers' deferred `close(out)` panics with `close of closed channel`. Even worse, the workers that haven't exited yet may try to write to a closed channel — also a panic.

This is one of the most common fan-out mistakes. The fix is to give the responsibility to a single closer goroutine.

**Fix.**

```go
func Process(in <-chan int, n int) <-chan int {
    out := make(chan int)
    var wg sync.WaitGroup
    wg.Add(n)
    for i := 0; i < n; i++ {
        go func() {
            defer wg.Done()
            for v := range in {
                out <- v * v
            }
        }()
    }
    go func() { wg.Wait(); close(out) }()
    return out
}
```

Mantra: **producers close output, workers close nothing.** In a fan-out, the producer of `out` is the *collective* of all workers; their *exit* is the close signal, recorded by `wg`. The closer goroutine is the only place `close(out)` appears.

---

## Bug 9 — Ordering assumed but not preserved

```go
type Job struct { Idx int; Payload string }
type Res struct { Idx int; Out  string }

func Process(jobs []Job, n int) []string {
    in := make(chan Job)
    out := make(chan Res)
    var wg sync.WaitGroup

    go func() {
        defer close(in)
        for _, j := range jobs { in <- j }
    }()

    wg.Add(n)
    for i := 0; i < n; i++ {
        go func() {
            defer wg.Done()
            for j := range in {
                out <- Res{j.Idx, transform(j.Payload)}
            }
        }()
    }
    go func() { wg.Wait(); close(out) }()

    results := make([]string, 0, len(jobs))
    for r := range out {
        results = append(results, r.Out)
    }
    return results
}
```

**Bug.** The author *thought* `Job.Idx` would be enough, but they're appending to `results` in *receive order*, not in *idx order*. Faster jobs finish earlier; their outputs land at lower indices. The returned slice is in non-deterministic order.

If a downstream piece of code assumes `results[i]` corresponds to `jobs[i]`, behavior is wrong, intermittently, in production.

**Fix.** Pre-allocate a slice of size `len(jobs)` and assign by `Idx`:

```go
results := make([]string, len(jobs))
for r := range out {
    results[r.Idx] = r.Out
}
return results
```

No sort, no race (one writer per index, no contention). Order is preserved by construction.

For a cleaner API, hide the index inside the helper:

```go
func ProcessOrdered(jobs []string, n int) []string {
    type idxJob struct { Idx int; Payload string }
    type idxRes struct { Idx int; Out string }
    // ...
}
```

---

## Bug 10 — `ctx` ignored inside worker

```go
func Process(ctx context.Context, in <-chan Job, n int) <-chan Res {
    out := make(chan Res)
    var wg sync.WaitGroup
    wg.Add(n)
    for i := 0; i < n; i++ {
        go func() {
            defer wg.Done()
            for j := range in {
                out <- work(j) // ignores ctx
            }
        }()
    }
    go func() { wg.Wait(); close(out) }()
    return out
}
```

**Bug.** Workers ignore `ctx`. They will run to completion of `in`, no matter what. If the caller cancels the parent (timeout, user abort, server shutdown), this fan-out continues until `in` is drained — possibly minutes or hours later.

A second, subtler bug: the worker's `out <- work(j)` has no `select` either. If the consumer disappears (e.g. its goroutine panicked elsewhere), workers block forever on send and leak.

**Fix.** The two-select sandwich, both around receive and around send:

```go
func Process(ctx context.Context, in <-chan Job, n int) <-chan Res {
    out := make(chan Res)
    var wg sync.WaitGroup
    wg.Add(n)
    for i := 0; i < n; i++ {
        go func() {
            defer wg.Done()
            for {
                select {
                case <-ctx.Done():
                    return
                case j, ok := <-in:
                    if !ok { return }
                    r := work(j)
                    select {
                    case <-ctx.Done():
                        return
                    case out <- r:
                    }
                }
            }
        }()
    }
    go func() { wg.Wait(); close(out) }()
    return out
}
```

Now cancellation propagates: when `ctx` is cancelled, workers exit on the next receive *or* the next send, whichever comes first. No leaks, no runaway work.

If `work` itself does long IO, also pass `ctx` into it: `work(ctx, j)`. The function should observe `ctx.Done()` between sub-steps.

---

## Bug 11 — Producer panics, workers wait forever

```go
func Process(jobs []Job, n int) <-chan Res {
    in := make(chan Job)
    out := make(chan Res)
    var wg sync.WaitGroup

    go func() {
        // forgot defer close(in)
        for _, j := range jobs {
            if j.Bad { panic("bad input") }
            in <- j
        }
        close(in)
    }()

    wg.Add(n)
    for i := 0; i < n; i++ {
        go func() {
            defer wg.Done()
            for j := range in { out <- work(j) }
        }()
    }
    go func() { wg.Wait(); close(out) }()
    return out
}
```

**Bug.** If the producer panics mid-stream, `close(in)` never runs (it's at the end of the goroutine, not deferred). Workers are still ranging over `in`; they'll block forever on receive.

The panic also crashes the program because no recovery is in place — but if recovery sits at the program edge, the goroutines that did *not* panic (the workers) still leak.

**Fix.** `defer close(in)` and consider deferring a recover too:

```go
go func() {
    defer close(in)
    defer func() {
        if r := recover(); r != nil {
            log.Printf("producer panic: %v", r)
        }
    }()
    for _, j := range jobs {
        if j.Bad { panic("bad input") }
        in <- j
    }
}()
```

Now `defer close(in)` runs no matter how the goroutine exits. Workers see the close, finish their `range`, return, the closer fires, the consumer's `range` exits.

For production code, prefer to surface bad inputs as errors rather than panics; the recover is a backstop, not a feature.

---

## Bug 12 — Worker buffer per-iteration causes false sharing

```go
type Worker struct {
    id  int
    Buf [64]byte
}

var workers [16]Worker

func Process(in <-chan Job, n int) {
    var wg sync.WaitGroup
    wg.Add(n)
    for i := 0; i < n; i++ {
        i := i
        go func() {
            defer wg.Done()
            for j := range in {
                copy(workers[i].Buf[:], j.Payload)
                process(workers[i].Buf[:])
            }
        }()
    }
    wg.Wait()
}
```

**Bug.** `Worker{id, Buf [64]byte}` is 72 bytes — *less* than a CPU cache line on x86 (64) but the *array of workers* packs them adjacently. Two workers' `Buf` fields can land on the same cache line. Every write by worker A invalidates worker B's cache copy of the next struct. This is **false sharing**: no logical race, but the hardware coherence protocol thrashes the line back and forth between cores.

Symptom: parallel speedup is worse than expected (e.g. 3× on 8 cores where 7× was achievable). `perf c2c` (Linux) or Intel VTune shows hot cache-line-bouncing on the worker array.

**Fix.** Pad `Worker` to a cache line, *or* just use stack-local buffers per worker — the simplest fix:

```go
for i := 0; i < n; i++ {
    go func() {
        defer wg.Done()
        var buf [64]byte // stack-local; per-goroutine; no sharing
        for j := range in {
            copy(buf[:], j.Payload)
            process(buf[:])
        }
    }()
}
```

Each worker has its own `buf` on its goroutine stack. There is nothing to false-share. For cases where you really want per-worker structs, pad to a cache line:

```go
type Worker struct {
    id  int
    Buf [64]byte
    _   [64]byte // padding to 128 bytes — well clear of cache line
}
```

---

## Bug 13 — Closing input from inside a worker

```go
func Process(in chan int, n int) <-chan int {
    out := make(chan int)
    var wg sync.WaitGroup
    wg.Add(n)
    for i := 0; i < n; i++ {
        go func() {
            defer wg.Done()
            for v := range in {
                if v < 0 {
                    close(in) // attempt to abort
                    return
                }
                out <- v * v
            }
        }()
    }
    go func() { wg.Wait(); close(out) }()
    return out
}
```

**Bug.** The worker closes the input channel as a hack to stop the producer. Two things go wrong:
1. The producer is still trying to `in <- v` to a closed channel — panic.
2. Other workers may be mid-send concurrently with the close — also panic territory.

This is the producer/consumer ownership rule violated: only the producer should close `in`.

**Fix.** Use `ctx` for the abort signal. Workers signal "stop" via `cancel()`, the producer exits its loop because `<-ctx.Done()` fires inside its send select, and `defer close(in)` finishes the job.

```go
func Process(parent context.Context, n int) <-chan int {
    ctx, cancel := context.WithCancel(parent)
    in := make(chan int)
    out := make(chan int)

    go func() {
        defer close(in)
        for i := 0; ; i++ {
            select {
            case <-ctx.Done(): return
            case in <- i:
            }
        }
    }()

    var wg sync.WaitGroup
    wg.Add(n)
    for i := 0; i < n; i++ {
        go func() {
            defer wg.Done()
            for {
                select {
                case <-ctx.Done(): return
                case v, ok := <-in:
                    if !ok { return }
                    if v < 0 { cancel(); return }
                    select {
                    case <-ctx.Done(): return
                    case out <- v * v:
                    }
                }
            }
        }()
    }
    go func() { wg.Wait(); close(out); cancel() }()
    return out
}
```

Now no goroutine closes a channel it does not own. Cancellation flows through ctx, which is safe to cancel from anywhere.

---

End of bugs. Fan-out concentrates many failure modes in a small surface: ownership of channels, lifetime of goroutines, propagation of ctx, atomicity of shared state. Read each bug at least twice — the *fix* is usually a one-line change, but the *understanding* of why the original looked correct is what makes the lesson stick.
