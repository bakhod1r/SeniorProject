# Goroutine Best Practices — Interview Questions

## Table of Contents
1. [How to use this file](#how-to-use-this-file)
2. [Quick-fire](#quick-fire)
3. [Conceptual](#conceptual)
4. [Code reading](#code-reading)
5. [Design](#design)
6. [Open-ended discussion](#open-ended-discussion)
7. [Red flags interviewers watch for](#red-flags-interviewers-watch-for)

---

## How to use this file

Read each question. Try to answer in your own words before reading the model answer. The questions are roughly ordered from junior to senior. If you can answer all of "Quick-fire" and most of "Conceptual" cleanly, you have a passing junior-to-mid grasp. If you can lead the "Design" and "Open-ended" sections, you are at senior.

---

## Quick-fire

**Q1.** Name three things every goroutine should have.

**A.** A clear exit story; a `context.Context` if long-running; a `recover` at the boundary if it handles external input. (Some interviewers expect "passed loop variables as parameters" as a fourth.)

---

**Q2.** Where does `wg.Add(1)` go and where does `wg.Done()` go?

**A.** `wg.Add(1)` in the parent goroutine, on the line *before* `go`. `wg.Done()` as a `defer` on the *first* line of the spawned goroutine's body.

---

**Q3.** What's the bug in this code?

```go
for _, x := range items {
    go func() { process(x) }()
}
```

**A.** In Go < 1.22, the closure captures the variable `x`, not its value. All goroutines see the same `x` (usually the last item). Fix: `go func(x Item){ process(x) }(x)` or `x := x` before the goroutine. In Go ≥ 1.22 the per-iteration variable fixes it, but the explicit-parameter pattern is still preferred for clarity.

---

**Q4.** Why is `time.Sleep` a bad way to wait for a goroutine?

**A.** It waits *wall time*, not for the *event*. On a slow machine it may finish too early; on a fast machine it wastes time. Use a channel, `WaitGroup`, or `context.Done()`.

---

**Q5.** What does `errgroup` give you that a plain `WaitGroup` doesn't?

**A.** First-error propagation, automatic context cancellation on first error, and (since x/sync 0.1.0) `SetLimit(n)` for bounded concurrency. Less code, less bug surface.

---

**Q6.** Why must every goroutine that runs untrusted input have a `recover`?

**A.** Because an unrecovered panic in any goroutine terminates the entire process — every concurrent request dies with it. `recover` only catches panics in *its own* goroutine, so each goroutine boundary needs one.

---

**Q7.** What is `go test -race` and what does it cost?

**A.** It enables the race detector (ThreadSanitizer-based) that flags concurrent memory accesses without synchronisation. Runtime cost is roughly 5-10x in CPU and memory. Run it in CI as a dedicated job, not on every save.

---

**Q8.** When is `time.Sleep` legitimate?

**A.** For a ticker (better: `time.Ticker`), for a backoff between retries, for a rate limiter. Never for "wait for goroutine to finish."

---

**Q9.** When do you choose `sync.Map` over a `sync.Mutex` + map?

**A.** When you have write-once-read-many keys, or when keys are partitioned across goroutines (each goroutine writes its own keys). For mixed read/write, the mutex+map is usually faster and clearer.

---

**Q10.** What does it mean to "bound concurrency"?

**A.** To cap the number of in-flight goroutines so that input rate doesn't dictate goroutine count. Implementations: `errgroup.SetLimit(n)`, a worker pool of N goroutines reading from a channel, or a semaphore channel.

---

## Conceptual

**Q11.** Explain why `wg.Add` inside the goroutine is racey.

**A.** `WaitGroup.Wait` returns as soon as its counter is 0. If `Add` is inside the goroutine body, the scheduler may run `Wait` in the parent before the goroutine has executed `Add`. `Wait` sees 0, returns, the parent function exits, and the goroutines run detached (or never run). The race detector flags it. The fix is unconditional: `Add` in parent, before `go`.

---

**Q12.** What is "structured concurrency" in Go, given Go doesn't have a built-in `TaskGroup`?

**A.** It's a convention: every goroutine's lifetime is bounded by a function call. In Go, `errgroup.Group` + a single `g.Wait()` at the end of a function gives you structured concurrency: the function does not return until every spawned goroutine has returned. No goroutine escapes lexical scope. Combined with `WithContext`, errors and cancellation propagate naturally.

---

**Q13.** Why do we say "channels for flow, mutexes for state"?

**A.** Channels are good when you're handing off ownership of data — pipelines, producer-consumer, signal events. Mutexes are good when many goroutines mutate the same piece of state in place — counters, caches, indices. Using channels for state often produces an actor that serialises every operation through one goroutine, which is more code than `Mutex.Lock`. Using mutexes for flow makes it hard to express things like `select` over multiple events.

---

**Q14.** What happens if you call `wg.Wait` from inside a goroutine that is counted by the same `wg`?

**A.** Deadlock. The goroutine is waiting for the counter to reach 0, but it can't reach 0 until this goroutine returns. The runtime detects this as "all goroutines are asleep" if it's the only thing left running.

---

**Q15.** Why is `context.Background()` usually wrong outside `main`?

**A.** Because it disconnects you from the caller's cancellation. If your function is called by a request handler with a deadline, ignoring the caller's context means your function won't stop when the request times out. Always thread the caller's context through.

---

**Q16.** What does `errgroup.WithContext` do that a bare `errgroup.Group{}` doesn't?

**A.** It returns a derived context that is cancelled when (a) any `Go` callback returns a non-nil error, or (b) `Wait` returns. Peers that respect the derived context exit when one fails. Bare `Group` doesn't cancel peers; you join, but every spawned worker runs to completion regardless.

---

**Q17.** A handler spawns a goroutine. The handler returns. The goroutine keeps running. Is that OK?

**A.** Only if (a) the goroutine has a documented purpose that legitimately outlives the request (e.g., async log flush), (b) it is bounded in count, (c) it respects a service-level context for shutdown, and (d) it has a `recover`. Otherwise it's a leak — the request's context was probably the only thing that could have stopped it.

---

**Q18.** Why is `pprof.SetGoroutineLabels` useful?

**A.** It attaches `key=value` tags to a goroutine. The goroutine profile groups stacks by labels, so you can ask "how many goroutines are running task=fetch?" or "which of my 10 000 goroutines are in phase=encode?" Makes a goroutine profile actionable rather than a wall of stacks.

---

**Q19.** Explain `goleak.VerifyTestMain` in two sentences.

**A.** At the end of the test binary, it reads the live goroutine profile, filters known acceptable backgrounds (the test runner, GC), and fails if any others remain. It turns "I think this test cleans up" into a compile-time-style assertion enforced by the suite.

---

**Q20.** What is the difference between Go's race detector and "I have no races"?

**A.** The race detector reports a race when it observes one at runtime. It does not prove the absence of races — only that the executed code paths under test were race-free. Coverage matters: untested paths can still race. The detector is necessary but not sufficient.

---

## Code reading

**Q21.** What's wrong?

```go
var wg sync.WaitGroup
for i := 0; i < 5; i++ {
    go func() {
        wg.Add(1)
        defer wg.Done()
        process(i)
    }()
}
wg.Wait()
```

**A.** Two bugs. (1) `wg.Add(1)` is inside the goroutine — `Wait` may run before any `Add`. (2) `i` is captured by reference; pre-1.22 all goroutines see the final value, post-1.22 they see fresh per-iteration vars. Fix:

```go
for i := 0; i < 5; i++ {
    wg.Add(1)
    go func(i int) {
        defer wg.Done()
        process(i)
    }(i)
}
wg.Wait()
```

---

**Q22.** What's the leak?

```go
func leak() error {
    ch := make(chan int)
    go func() { ch <- compute() }()
    select {
    case v := <-ch:
        fmt.Println(v)
    case <-time.After(time.Second):
        return errors.New("timeout")
    }
    return nil
}
```

**A.** On the timeout branch, the goroutine sends to `ch` which has no buffer and no remaining receiver. It blocks forever — leak. Fix: `ch := make(chan int, 1)` so the send completes even if no one reads.

---

**Q23.** Why does this hang?

```go
g, ctx := errgroup.WithContext(context.Background())
g.Go(func() error {
    return fetch(context.Background(), url1)
})
g.Go(func() error {
    return fetch(context.Background(), url2)
})
return g.Wait()
```

**A.** The children pass `context.Background()` instead of the group's `ctx`. If one child returns an error, the group cancels `ctx`, but the children aren't watching `ctx` — they're watching `Background()`, which is never cancelled. The cancellation is wasted; peers run to completion regardless.

---

**Q24.** What does this print on Go 1.22+, and what would it print on Go 1.21?

```go
for i := 0; i < 3; i++ {
    go func() { fmt.Println(i) }()
}
time.Sleep(time.Second)
```

**A.** Go 1.22+: some permutation of `0 1 2`. Go 1.21: usually `3 3 3` (all goroutines saw the final `i`). The semantics of the for-loop variable changed in 1.22.

---

**Q25.** What's broken about this `safeGo`?

```go
func safeGo(fn func()) {
    defer func() {
        if r := recover(); r != nil {
            log.Println("recover:", r)
        }
    }()
    go fn()
}
```

**A.** The `defer` is in the parent goroutine, not the spawned goroutine. A panic in `fn` happens in the spawned goroutine, not the parent — the deferred `recover` runs in the wrong goroutine and never sees the panic. Fix: put the `defer` inside the `go func() {}` body.

---

**Q26.** Find the deadlock:

```go
func process(items []Item) error {
    var mu sync.Mutex
    var wg sync.WaitGroup
    for _, item := range items {
        item := item
        wg.Add(1)
        go func() {
            defer wg.Done()
            mu.Lock()
            defer mu.Unlock()
            handle(item)
        }()
    }
    mu.Lock()
    wg.Wait()
    mu.Unlock()
    return nil
}
```

**A.** The parent calls `mu.Lock()` *before* `wg.Wait()`. The children call `mu.Lock()` inside their bodies. The parent holds the lock; children block. None of them can `wg.Done()`. The parent waits forever. Fix: remove the parent `Lock`/`Unlock`, or move `Wait()` outside the locked section.

---

## Design

**Q27.** Design a fetcher that downloads 1 000 URLs concurrently. Production-grade.

**A.** Use `errgroup.WithContext` plus `SetLimit`:

```go
func fetchAll(ctx context.Context, urls []string) ([]Response, error) {
    results := make([]Response, len(urls))
    g, ctx := errgroup.WithContext(ctx)
    g.SetLimit(32)                      // bound concurrency
    for i, url := range urls {
        i, url := i, url
        g.Go(func() (err error) {
            defer func() {              // recover at boundary
                if r := recover(); r != nil {
                    err = fmt.Errorf("panic %v: %s", r, debug.Stack())
                }
            }()
            r, err := fetch(ctx, url)   // ctx threaded
            if err != nil {
                return err
            }
            results[i] = r
            return nil
        })
    }
    if err := g.Wait(); err != nil {
        return nil, err
    }
    return results, nil
}
```

Covers: bound, ctx, recover, errgroup, loop variable shadow, clear exit story. Add `goleak` to the test, run `go test -race` in CI.

---

**Q28.** Design graceful shutdown for a service with an HTTP server, a Kafka consumer, and a metrics flusher.

**A.** Single root context. SIGTERM cancels it. Each component runs as a goroutine in an `errgroup`. Each component watches the context. Shutdown deadline bounds the wait.

```go
func main() {
    ctx, cancel := context.WithCancel(context.Background())
    defer cancel()

    sig := make(chan os.Signal, 1)
    signal.Notify(sig, os.Interrupt, syscall.SIGTERM)
    go func() { <-sig; cancel() }()

    g, ctx := errgroup.WithContext(ctx)
    g.Go(func() error { return httpServer.Run(ctx) })
    g.Go(func() error { return kafkaConsumer.Run(ctx) })
    g.Go(func() error { return metricsFlusher.Run(ctx) })

    if err := g.Wait(); err != nil {
        log.Println("shutdown error:", err)
    }
}
```

Each `Run(ctx)` does its own thing but returns when `ctx` cancels. The HTTP server uses `http.Server.Shutdown` with its own bounded timeout.

---

**Q29.** Your service has been running for a week. Memory went from 200 MB to 4 GB. How do you diagnose?

**A.**
1. Pull a goroutine profile: `go tool pprof http://host:6060/debug/pprof/goroutine`. Run `top 20`.
2. Look for stacks with high counts that shouldn't be high. The leak is almost always one or two stacks.
3. Cross-check with a heap profile (`/debug/pprof/heap`) to see what each leaked goroutine is holding.
4. Inspect the leaking goroutines: what's blocking them? Channel send, channel recv, mutex, system call?
5. Trace back to the spawn site. Reading `pprof traces` shows the full chain.
6. Fix: usually a missed `ctx.Done()` case, a goroutine sending to a never-read channel, or unbounded spawning.
7. Verify the fix in a test with `goleak` so the regression doesn't recur.

---

**Q30.** When would you use a `chan struct{}` instead of a `sync.Mutex`?

**A.** Three legitimate cases:
1. **Signalling completion.** A `done := make(chan struct{}); close(done)` is a broadcast: every receiver observes it. Mutex doesn't broadcast.
2. **`select` over multiple events.** `select { case <-done: case <-ch: }` needs channels; a mutex can't participate.
3. **Hand-off of ownership.** Send a value through a channel; receiver now owns it. No locking needed thereafter.

For protecting shared mutable state, prefer `sync.Mutex`. The `chan struct{}` as a binary semaphore (`<- struct{}{}` / `struct{}{} -> sem`) is fine but doesn't beat a mutex on simplicity.

---

## Open-ended discussion

**Q31.** Your team uses `time.Sleep(100ms)` in three tests. The tests pass locally and on CI. Is it worth fixing?

**A.** Yes. Each `time.Sleep` is a future flake: a slow CI runner, a heavily-loaded shared machine, a thread-context-switch storm — the sleep is wrong by a factor that depends on the environment. The fix is event-based synchronisation, possibly with a deadline (`time.After`) as a guard against hangs. Cost is small per test, payoff is a year of green CI.

---

**Q32.** When is a goroutine leak *not* a bug?

**A.** Rarely. The legitimate cases:
- A genuinely process-lifetime singleton (one metrics flusher started in `main`, lives until exit).
- A goroutine owned by an imported library whose docs describe its lifetime (e.g., HTTP/2 transport).

In both cases the goroutine count should be **constant**, not growing. Growing count = leak. Pin the acceptable count and alert on deviation.

---

**Q33.** Should every goroutine accept `context.Context`?

**A.** Every long-running goroutine, yes. "Long-running" = "could ever block on I/O" or "lifetime longer than a few milliseconds." A short pure-computation goroutine — say, a parallel `map` over a small slice — can do without. But err on the side of context: the cost is one parameter; the benefit is universal cancellability.

---

**Q34.** You're reviewing a PR that uses 4 different concurrency primitives. Smell or not?

**A.** Smell. Combining `sync.Mutex`, channels, `sync.Once`, and `atomic` in a single small file usually means the author wasn't sure which to use and used them all. Ask: which primitive owns the state? Can the code be rewritten with one? Often yes — one primitive plus a clearer ownership model.

---

**Q35.** You're hiring a senior Go engineer. What goroutine question do you ask?

**A.** "Walk me through how you'd structure a service that consumes from a Kafka queue and writes to a Postgres database. Specifically: how do goroutines start, how do they stop on SIGTERM, what's the error path, what's the leak detection?"

A weak answer: "I'd spawn a goroutine per message." A strong answer: bounded worker pool, errgroup with a root context, structured shutdown with a deadline, recover at the boundary, `goleak` in the integration tests, alert on `go_goroutines` trend.

The question is broad enough to surface their conventions, deep enough to see how they handle edge cases.

---

## Red flags interviewers watch for

- **"I'd just spawn a goroutine."** Senior candidates qualify: bounded, contextual, recovered.
- **"`time.Sleep` to wait for it."** Junior-only acceptable. Mid+ should know better.
- **"Channels are always better than mutexes."** Dogma. Senior candidates pick by workload.
- **"Goroutines are free."** Cheap, not free. The misconception breaks at scale.
- **"`recover` masks bugs."** Half-true. With logging + metrics, recover surfaces bugs at controlled cost.
- **"I haven't used `errgroup`."** Recoverable, but suggests the candidate hasn't built production fan-out.
- **"I don't run `-race` because it's slow."** Senior candidates run it in CI on a dedicated job.
- **"Goroutine leaks aren't a real problem."** They are. Specifically. The candidate hasn't operated a Go service in production.

The flags are not deal-breakers; they're prompts to dig deeper.
