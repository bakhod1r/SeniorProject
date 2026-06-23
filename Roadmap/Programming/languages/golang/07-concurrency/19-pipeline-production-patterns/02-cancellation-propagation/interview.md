---
layout: default
title: Cancellation Propagation — Interview
parent: Cancellation Propagation
grand_parent: Pipeline Production Patterns
ancestor: Go
nav_order: 7
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/19-pipeline-production-patterns/02-cancellation-propagation/interview/
---

# Cancellation Propagation — Interview Questions

A graded list of interview questions on cancellation propagation, from junior to staff. Each question includes a brief sketch of the expected answer.

---

## Junior

**Q1.** What is `context.Context` and why is it the first parameter convention?

The standard interface for carrying cancellation, deadlines, and request-scoped values across API boundaries. It is the first parameter so it is visible at the call site and easy to spot in linters. Functions that block must take it.

---

**Q2.** What does `ctx.Done()` return, and how do you use it?

A channel that closes when the context is cancelled. Use it inside `select` to detect cancellation:

```go
select {
case <-ctx.Done():
    return ctx.Err()
case v := <-in:
    process(v)
}
```

---

**Q3.** What does `defer cancel()` do, and why is it important?

The cancel function returned by `WithCancel`/`WithTimeout` must be called to release resources (timer, parent's children-map entry). `defer cancel()` ensures it runs even on panic or early return. Forgetting to call it is the `lostcancel` lint issue.

---

**Q4.** What is the difference between `context.Canceled` and `context.DeadlineExceeded`?

`Canceled` means somebody called `cancel()`. `DeadlineExceeded` means the deadline elapsed. Both are returned by `ctx.Err()`. The application can distinguish via `errors.Is`.

---

**Q5.** Write a goroutine that runs forever but stops on context cancellation.

```go
go func() {
    for {
        select {
        case <-ctx.Done():
            return
        case <-time.After(time.Second):
            doSomething()
        }
    }
}()
```

The `select` chooses between cancellation and the timer; either way it loops or exits.

---

**Q6.** What is the captured-loop-variable bug, and how does it interact with cancellation?

In Go < 1.22, `for _, x := range items { go func() { use(x) }() }` captured the same `x` in every goroutine. In Go 1.22+, each iteration gets a fresh `x`. With cancellation, all goroutines share the same ctx, so cancellation works the same — but the captured value bug is a separate issue.

---

**Q7.** Why does the `select` non-determinism matter for cancellation?

If both the data case and `<-ctx.Done()` are ready, `select` picks at random. This means a stage may deliver one more item after cancellation. Code that relies on "after cancel, no more values flow" is wrong.

---

## Middle

**Q8.** Explain `errgroup.WithContext`.

It returns a `*Group` and a derived `context.Context`. The context is cancelled when the first non-nil error is returned by any `g.Go` function. Siblings see the cancel via the shared context. `g.Wait()` returns the first error.

---

**Q9.** How do you implement bounded fan-out with cancellation?

```go
g, ctx := errgroup.WithContext(parent)
g.SetLimit(8)
for _, item := range items {
    item := item
    g.Go(func() error { return process(ctx, item) })
}
return g.Wait()
```

`SetLimit(8)` blocks `g.Go` until fewer than 8 goroutines are running. Cancellation cascades through the shared context.

---

**Q10.** How does deadline propagation work across `WithTimeout` calls?

`WithTimeout(parent, d)` creates a child with deadline `min(parent.Deadline, now+d)`. The earliest deadline always wins. Children cannot extend the parent's deadline; they can only shorten it.

---

**Q11.** What is the "drain after cancel" pattern, and when do you need it?

After cancelling a pipeline, the consumer should drain the output channel:

```go
cancel()
for range out {
}
```

This unblocks producers stuck on their last send (because the consumer has stopped reading). Without the drain, producers leak.

You need it whenever the consumer stops reading before the producer naturally ends.

---

**Q12.** Write a worker pool that respects context cancellation.

```go
func runPool(ctx context.Context, in <-chan Job, workers int) error {
    g, ctx := errgroup.WithContext(ctx)
    for i := 0; i < workers; i++ {
        g.Go(func() error {
            for {
                select {
                case <-ctx.Done():
                    return ctx.Err()
                case j, ok := <-in:
                    if !ok {
                        return nil
                    }
                    if err := process(ctx, j); err != nil {
                        return err
                    }
                }
            }
        })
    }
    return g.Wait()
}
```

Each worker selects on ctx and on the job channel; cancellation or input close ends the worker.

---

**Q13.** Why is `time.Sleep` problematic in cancellable code?

`time.Sleep` blocks for the full duration; it cannot be cancelled. Always replace with:

```go
select {
case <-ctx.Done():
    return
case <-time.After(d):
}
```

This makes the sleep cancellable.

---

**Q14.** How do `context.WithCancelCause` and `context.Cause` work?

`WithCancelCause` returns a context and a `CancelCauseFunc(error)`. Calling the function records the error as the cancellation cause. `context.Cause(ctx)` retrieves it. `ctx.Err()` still returns `context.Canceled` for compatibility.

Used to surface "why was this cancelled" through the system.

---

## Senior

**Q15.** Explain structured concurrency in Go. How is it achieved without language-level support?

Structured concurrency: every goroutine has a join point within the function that spawned it. In Go, achieved by convention: use `errgroup.Group` (or `WaitGroup`) to wait for spawned goroutines before returning.

Languages like Kotlin enforce this; Go relies on discipline.

---

**Q16.** Design a graceful HTTP server shutdown.

```go
rootCtx, rootCancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
defer rootCancel()

srv := &http.Server{
    Handler: mux,
    BaseContext: func(net.Listener) context.Context { return rootCtx },
}
go srv.ListenAndServe()

<-rootCtx.Done()

shutdownCtx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
defer cancel()
srv.Shutdown(shutdownCtx)
pool.Drain()
db.Close()
```

`BaseContext` propagates root context to every request. `Shutdown` waits for in-flight handlers (which see the cancel). Drain workers, then release resources.

---

**Q17.** What happens if a stage panics?

If unrecovered, the whole process terminates. To survive, each goroutine that runs panicking code should have its own `recover`:

```go
defer func() {
    if r := recover(); r != nil {
        log.Printf("panic: %v", r)
        cancel() // signal siblings
    }
}()
```

The cancel propagates so other stages exit gracefully.

---

**Q18.** Design a pipeline with at-least-once delivery semantics under cancellation.

Each event is checkpointed before processing. On cancellation, the checkpoint is the resume point.

```go
func processLoop(ctx context.Context, src EventLog, ckpt Checkpoint) error {
    cursor, _ := ckpt.Load(ctx)
    for {
        select {
        case <-ctx.Done():
            return ctx.Err()
        default:
        }
        events, next, _ := src.Read(ctx, cursor, 100)
        for _, ev := range events {
            if err := process(ctx, ev); err != nil {
                return err
            }
        }
        ckpt.Save(ctx, next)
        cursor = next
    }
}
```

On cancellation, the most recent batch may have been partially processed. Restart reads from the last saved cursor; consumers must be idempotent.

---

**Q19.** What is `context.AfterFunc` and when do you use it?

Go 1.21+. Registers a callback to run when a context cancels. Cleaner than spawning a watcher goroutine for non-blocking cleanup:

```go
stop := context.AfterFunc(ctx, func() {
    metrics.IncCancellations()
})
defer stop()
```

The callback runs from the cancelling goroutine's cascade. Use for fast, non-blocking side effects.

---

**Q20.** Explain how cancellation propagates across a gRPC chain (A → B → C).

A's context cancels (e.g. client disconnect). The gRPC call from A to B closes (RST_STREAM). B's handler sees its `ctx` cancel. B's call to C also closes. C's handler sees its `ctx` cancel. Each layer's cancellation triggers the next.

Deadlines propagate via `grpc-timeout` metadata.

---

**Q21.** When would you use `context.WithoutCancel`?

To run work that should outlive the parent's cancellation. Common case: logging a request's failure after the request itself has been cancelled.

```go
logCtx := context.WithoutCancel(r.Context())
go logFailure(logCtx, err)
```

The logger inherits values (trace IDs) but not cancellation.

---

## Staff

**Q22.** Design a worker pool with hot-swappable workers.

```go
type Pool struct {
    mu      sync.Mutex
    workers map[int]*Worker
    nextID  int
    parent  context.Context
}

type Worker struct {
    ID     int
    cancel context.CancelFunc
    done   chan struct{}
}

func (p *Pool) Add(fn func(context.Context) error) int {
    p.mu.Lock()
    defer p.mu.Unlock()
    ctx, cancel := context.WithCancel(p.parent)
    w := &Worker{ID: p.nextID, cancel: cancel, done: make(chan struct{})}
    p.nextID++
    p.workers[w.ID] = w
    go func() {
        defer close(w.done)
        fn(ctx)
    }()
    return w.ID
}

func (p *Pool) Remove(id int) {
    p.mu.Lock()
    w, ok := p.workers[id]
    delete(p.workers, id)
    p.mu.Unlock()
    if ok {
        w.cancel()
        <-w.done
    }
}
```

Each worker has its own context. Removing one cancels it without affecting others.

---

**Q23.** How would you debug a service that hangs on shutdown?

1. Enable `pprof`; on the running process, dump goroutines: `curl http://localhost/debug/pprof/goroutine?debug=2`.
2. Look for goroutines stuck in `chan receive` or `chan send` — these are missed cancellations.
3. Check stack traces; find the offending function.
4. Determine why it does not respect context: missing `select`, blocking syscall, etc.
5. Fix the cancellation path.

If you cannot get pprof, add logging at every shutdown stage and trace through manually.

---

**Q24.** Design cancellation observability for a service.

Metrics:

- Goroutine count gauge.
- Cancellation count by cause (Canceled, DeadlineExceeded, custom).
- Cancellation latency histogram.
- In-flight pipelines gauge.

Logging: cancellation cause via `context.WithCancelCause`; log on cancellation boundary.

Tracing: span events for cancellation, with cause attributes.

Alerts: goroutine count drift, cancellation rate spikes, shutdown SLA violations.

---

**Q25.** A service has a 30-second shutdown SLA but actually takes 4 minutes. How do you diagnose and fix?

Diagnosis:

1. Trace the shutdown path. Where is time spent?
2. Most likely: a background goroutine using `time.Sleep` instead of cancellable wait.
3. Or: a database operation without `QueryContext`.
4. Or: a worker pool that does not drain.

Fixes:

1. Replace `time.Sleep` with `select`.
2. Use context-aware variants for all I/O.
3. Implement pool draining.

Then add tests to verify shutdown stays within SLA.

---

**Q26.** Explain how `select` with two ready cases is non-deterministic, and why it matters for cancellation.

The Go spec says: when multiple cases are ready, one is chosen via pseudo-random selection. So `select { case out <- v: case <-ctx.Done(): }` may pick the send even if cancel has fired.

Implication: cancellation is *eventually* delivered, not instantly. After cancel, in-flight values may still flow (up to one per stage). Code must not assume otherwise.

---

**Q27.** A leaked goroutine count keeps growing in production. How would you find it?

1. Use `go.uber.org/goleak` in tests to find easy cases.
2. In production, sample `pprof goroutine` profiles and look for stacks that grow over time.
3. Diff goroutine counts before/after various scenarios.
4. Once a stack is identified, trace through the cancellation path — usually a missed `<-ctx.Done()` case or a forgotten `defer cancel()`.

---

**Q28.** Design a cancellation budget across a 3-service chain.

The chain: A → B → C. Total deadline: 1 second.

- A enforces 1-second deadline on its overall operation.
- A's RPC call to B uses `WithTimeout(ctx, 800ms)` to reserve 200ms for itself.
- B's RPC call to C uses `WithTimeout(ctx, 500ms)` to reserve 300ms for itself.
- C does its work within 500ms.

Deadline propagation through gRPC metadata; each hop enforces its own ceiling.

---

**Q29.** What is the cost of cancellation under high concurrency?

`cancel()` itself: ~100 ns (lock + close + children iteration).
Per-receiver wake: a few hundred ns.
Total broadcast: O(N) where N is the number of receivers. For N = 10 000, ~1 ms.

Under heavy CPU contention, latency rises due to scheduler delays.

For most pipelines, cancellation is fast enough to ignore. For very large fan-outs, hierarchical cancellation may be needed.

---

**Q30.** A reviewer says "your goroutine has no documented exit." What does that mean and how do you respond?

It means: the reviewer cannot determine when the goroutine will exit. This is a leak risk.

Acceptable responses:

- Document the exit condition: "exits when input channel closes (closed by upstream X)."
- Add a context-based exit: select on `<-ctx.Done()`.
- Add explicit shutdown: a `Stop()` method that signals exit.

Unacceptable response: "it usually works." Cancellation requires precision.

---

**Q31.** Two goroutines write to the same channel; who closes it?

Neither alone. Use a `WaitGroup` to join both and a separate closer:

```go
var wg sync.WaitGroup
wg.Add(2)
go func() { defer wg.Done(); /* writes to out */ }()
go func() { defer wg.Done(); /* writes to out */ }()
go func() { wg.Wait(); close(out) }()
```

Closing the channel from inside one of the writers risks the other writer panicking on its next send.

---

**Q32.** Explain `context.WithoutCancel` with a concrete use case.

A handler that wants to log a request after the request itself has been cancelled:

```go
func handler(w http.ResponseWriter, r *http.Request) {
    if err := work(r.Context()); err != nil {
        logCtx := context.WithoutCancel(r.Context())
        go logFailure(logCtx, err)
    }
}
```

`logFailure` continues even after `r.Context()` cancels. It still has access to values like trace IDs.

---

**Q33.** What is the difference between `context.Background()` and `context.TODO()`?

Operationally identical: both are never-cancelled empty contexts. The difference is documentation:

- `Background()` is the real root of a context tree.
- `TODO()` is a placeholder for "I haven't decided which context to use here yet."

Linters can be configured to flag `TODO()` so you remember to replace it.

---

**Q34.** How would you cancel a goroutine that is in a `time.Sleep`?

You cannot interrupt a sleep. Replace it with a cancellable wait:

```go
select {
case <-ctx.Done():
    return
case <-time.After(d):
}
```

For repeated waits (a polling loop), use `time.NewTimer` and `timer.Stop()` for proper cleanup.

---

**Q35.** Design tests for cancellation behaviour.

Cover:

- Pipeline completes normally without cancellation.
- Pipeline exits cleanly on cancellation.
- Cancellation latency is within expected bounds.
- No goroutine leaks (use `goleak`).
- Race detector finds no issues (`-race`).
- Random cancellation timing (property test).

Example:

```go
func TestCancelCleanup(t *testing.T) {
    defer goleak.VerifyNone(t)
    ctx, cancel := context.WithCancel(context.Background())
    out := runPipeline(ctx)
    time.Sleep(50 * time.Millisecond)
    cancel()
    for range out {
    }
}
```

---

**Q36.** What does `g.SetLimit(n)` do in `errgroup`?

Limits the number of concurrent goroutines started by `g.Go`. If `n` are already running, the next `g.Go` blocks until one finishes. Replaces manual semaphores.

`g.TryGo` is the non-blocking variant; returns false if at the limit.

---

**Q37.** Implement a fan-in that respects cancellation.

```go
func merge(ctx context.Context, ins ...<-chan int) <-chan int {
    out := make(chan int)
    var wg sync.WaitGroup
    wg.Add(len(ins))
    for _, in := range ins {
        go func(in <-chan int) {
            defer wg.Done()
            for {
                select {
                case <-ctx.Done():
                    return
                case v, ok := <-in:
                    if !ok {
                        return
                    }
                    select {
                    case out <- v:
                    case <-ctx.Done():
                        return
                    }
                }
            }
        }(in)
    }
    go func() {
        wg.Wait()
        close(out)
    }()
    return out
}
```

Each input has a forwarder. A closer waits for all forwarders and closes the output.

---

**Q38.** How does cancellation interact with `sync.Mutex`?

A `Mutex.Lock()` call is not cancellable. A goroutine waiting on a lock cannot exit until it acquires.

Workarounds:

- Hold locks for the minimum time; do heavy work outside.
- Use a channel-based lock that integrates with `select`.

For most code, the right answer is "don't hold locks across blocking operations."

---

**Q39.** What is `singleflight` and how does it interact with cancellation?

`golang.org/x/sync/singleflight.Group.Do(key, fn)` deduplicates concurrent calls for the same key. Only one fn runs; others share the result.

Cancellation: the first caller's context drives fn. If others' contexts cancel, they see the cancel error but fn continues for the first caller.

Use `DoChan` to make the wait cancellable per-caller:

```go
ch := group.DoChan(key, fn)
select {
case res := <-ch:
case <-ctx.Done():
    return ctx.Err()
}
```

The underlying fn still runs to completion (or its own context cancels).

---

**Q40.** Walk through how `errgroup.WithContext` cancels siblings on error.

`WithContext(parent)` creates a child context and stores a cancel function. Each `g.Go(f)`:

1. Spawns a goroutine.
2. Runs `f()`.
3. On error, captures it under `sync.Once` and calls cancel.

The cancel closes the child context's `Done()`. Sibling goroutines selecting on this context see the cancel and exit.

`g.Wait()` joins all goroutines; returns the first error.

---

## References

- The Go Blog: <https://go.dev/blog/pipelines>
- `context` package: <https://pkg.go.dev/context>
- `errgroup` package: <https://pkg.go.dev/golang.org/x/sync/errgroup>
- *Concurrency in Go* by Katherine Cox-Buday.
