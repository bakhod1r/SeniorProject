# Goroutine Common Pitfalls — Interview

> Pitfall-flavoured interview questions, from screening-round to staff-engineer level. Each question gives the prompt, the expected answer, and follow-up probes interviewers actually use.

## Junior screening

### Q1. What does this program print?

```go
for i := 0; i < 5; i++ {
    go func() { fmt.Println(i) }()
}
time.Sleep(time.Second)
```

**Expected answer.**

- On Go ≤ 1.21: usually `5 5 5 5 5` (or similar with all the same value). Captured loop variable.
- On Go 1.22+: some permutation of `0 1 2 3 4`. The 1.22 change makes each iteration's `i` a fresh variable.

**Follow-up.** "How do you fix this so it works on Go 1.0 through 1.22?" — Pass `i` as a parameter: `go func(i int) { fmt.Println(i) }(i)`.

**Red flag.** Candidate says "this prints 0..4 in some order" without mentioning Go version.

---

### Q2. Why is this wrong?

```go
var wg sync.WaitGroup
for i := 0; i < 10; i++ {
    go func() {
        wg.Add(1)
        defer wg.Done()
        work()
    }()
}
wg.Wait()
```

**Expected answer.** `wg.Add` races with `wg.Wait`. `Wait` may run before any goroutine has executed its `Add`, see counter zero, and return immediately. `Add` must happen in the parent before `go`.

**Follow-up.** "What does the `WaitGroup` documentation say about this?" — Roughly: "calls with a positive delta when the counter is zero must happen before a Wait."

---

### Q3. Why might this leak?

```go
func compute() int {
    ch := make(chan int)
    go func() { ch <- expensive() }()
    if cached != nil {
        return *cached
    }
    return <-ch
}
```

**Expected answer.** When `cached != nil`, the function returns without reading `ch`. The goroutine's send on an unbuffered channel blocks forever. Goroutine leaks.

**Fix.** `make(chan int, 1)` — the send completes regardless. The buffered value and goroutine are GC'd together.

---

### Q4. What is wrong here?

```go
go heavyWork()
time.Sleep(500 * time.Millisecond)
fmt.Println("done")
```

**Expected answer.** `time.Sleep` is not synchronisation. The work may take 600 ms (on a slow CI machine, easily). The program prints "done" before the work finishes.

**Fix.** `WaitGroup`, a done channel, or `errgroup`.

---

### Q5. What happens here?

```go
func main() {
    go func() {
        panic("boom")
    }()
    time.Sleep(time.Second)
    fmt.Println("done")
}
```

**Expected answer.** The whole program crashes. An unrecovered panic in any goroutine terminates the process. "done" never prints.

**Follow-up.** "Where would you add a `recover`?" — Inside the goroutine, in a deferred function, *before* the panicking call.

---

## Middle level

### Q6. Walk me through this code. Where are the bugs?

```go
type Cache struct {
    m map[string]int
}

func (c *Cache) Set(k string, v int) { c.m[k] = v }
func (c *Cache) Get(k string) int    { return c.m[k] }

func main() {
    c := &Cache{m: make(map[string]int)}
    for i := 0; i < 100; i++ {
        go c.Set(fmt.Sprintf("k%d", i), i)
    }
    for i := 0; i < 100; i++ {
        go func(i int) { fmt.Println(c.Get(fmt.Sprintf("k%d", i))) }(i)
    }
    time.Sleep(time.Second)
}
```

**Expected answer.** Several bugs:

1. Concurrent map access (both write and read) — fatal error from the runtime: `fatal error: concurrent map writes`.
2. `time.Sleep` for synchronisation — unreliable.
3. The `for` loop with `go c.Set(...)` *before* Go 1.22 captures `i` per-call... but actually no, here `i` is passed via `fmt.Sprintf` which evaluates in the parent. So the set loop is OK. The reader loop uses `i` as a parameter, also OK.

**Fix.**

- `sync.Mutex` (or `sync.RWMutex`) around map access.
- Or use `sync.Map`.
- Replace `time.Sleep` with `WaitGroup`.

---

### Q7. Why is this dangerous?

```go
func process(items []Item) {
    for _, item := range items {
        go func() {
            work(item)
        }()
    }
}
```

**Expected answer (pre-1.22).** `item` is the loop variable; the closure captures it by reference. All goroutines see the same (last) item. Race + wrong result.

**Expected answer (1.22+).** Per the new semantics, each iteration has its own `item`. But: `process` returns immediately without waiting for the goroutines. The goroutines may not have started by the time `process` returns. If `items` is request-scoped, the closure pins it past the function's lifetime.

**Follow-up.** "How would you redesign `process` to be safe?" — Take a `context.Context`, return an `error`, use `errgroup`, wait before returning.

---

### Q8. Find at least three pitfalls.

```go
func handler(w http.ResponseWriter, r *http.Request) {
    ctx := context.Background()
    go func() {
        result, _ := db.Query(ctx, r.FormValue("id"))
        log.Println(result)
    }()
    w.WriteHeader(http.StatusOK)
}
```

**Expected answer.**

1. `context.Background()` instead of `r.Context()` — the query is not cancelled when the client disconnects.
2. The goroutine outlives the request; under load, you have a goroutine leak that scales with traffic.
3. `r.FormValue` after the handler returns may panic or return wrong data — the request body may have been recycled by the HTTP server.
4. Error from `db.Query` is discarded.
5. No bounded concurrency: each request spawns a goroutine.

---

### Q9. What is the bug?

```go
func (s *Service) Shutdown() {
    close(s.jobs)
    s.cancel()
    s.wg.Wait()
}
```

**Expected answer.** Closing `s.jobs` while producers are still sending causes a panic (`send on closed channel`). The correct sequence:

1. Cancel the context (signal producers to stop).
2. Wait for producers to finish.
3. Close `s.jobs`.
4. Wait for consumers (`s.wg.Wait()`).

---

### Q10. Why is this slow under load?

```go
for {
    select {
    case msg := <-messages:
        process(msg)
    case <-time.After(time.Second):
        return
    }
}
```

**Expected answer.** Each loop iteration creates a new `Timer` via `time.After`. If `messages` is busy, the timer is never selected, but it lives in the runtime heap for one second. Under high message rates, memory fills with pending timers.

**Fix.** Use a single `time.NewTimer`, `Reset` it after each message.

---

## Senior level

### Q11. Design a safe `Worker` type.

> "Sketch a `Worker` type that processes jobs from a channel with bounded concurrency, supports graceful shutdown, and prevents goroutine leaks."

**Expected answer.**

```go
type Worker struct {
    jobs   chan Job
    cancel context.CancelFunc
    wg     sync.WaitGroup
}

func New(ctx context.Context, n int) *Worker {
    ctx, cancel := context.WithCancel(ctx)
    w := &Worker{
        jobs:   make(chan Job, n),
        cancel: cancel,
    }
    for i := 0; i < n; i++ {
        w.wg.Add(1)
        go w.run(ctx)
    }
    return w
}

func (w *Worker) Submit(ctx context.Context, j Job) error {
    select {
    case w.jobs <- j:
        return nil
    case <-ctx.Done():
        return ctx.Err()
    }
}

func (w *Worker) Stop() {
    w.cancel()
    close(w.jobs)
    w.wg.Wait()
}

func (w *Worker) run(ctx context.Context) {
    defer w.wg.Done()
    for {
        select {
        case <-ctx.Done():
            return
        case j, ok := <-w.jobs:
            if !ok {
                return
            }
            process(j)
        }
    }
}
```

**Probe areas.**

- Why is `Submit` context-aware? (Backpressure.)
- What happens if `Submit` is called after `Stop`? (Hangs unless ctx is set; better to track a `closed` flag.)
- Why close `jobs` in `Stop`? (Signals workers in the case where they reached the next select after `ctx.Done`.)
- What if a job panics? (Need `defer recover()` per job.)

---

### Q12. Diagnose: "Service uses 8 GB of RAM under steady traffic but only handles 100 RPS."

**Expected approach.**

1. `pprof heap` — what is in the heap?
2. `pprof goroutine` — how many goroutines? Their stacks?
3. If goroutine count > expected: likely a leak. Common shapes:
   - Many goroutines on `chan receive` → unclosed channel.
   - Many on `chan send` → unread or no consumer.
   - Many on `IO wait` → slow downstream, no timeout.
4. Cross-reference with HTTP client config (timeout?) and any `chan` that lacks a closer.
5. Add `goleak` to tests; reproduce locally.

---

### Q13. Why does this design have a subtle bug?

```go
func init() {
    go pollConfig()
}
```

**Expected answer.**

1. No ownership: no way to stop or wait for the goroutine.
2. Runs in *every* binary that imports this package, including tests — tests start a real config poller.
3. Race with package initialisation of other packages.
4. Inverts dependency direction: the package controls the runtime, not the caller.

**Fix.** Expose `StartPoller(ctx)` returning a handle with `Stop()`. Callers (including tests) control lifecycle.

---

### Q14. Walk me through this for races.

```go
var ready int32

func init() {
    go func() {
        time.Sleep(10 * time.Millisecond)
        atomic.StoreInt32(&ready, 1)
    }()
}

func Use() {
    if atomic.LoadInt32(&ready) == 1 {
        useResource()
    }
}
```

**Expected answer.** Atomics on `ready` are correct. But `useResource` accesses other state set up "with" the atomic. If that other state is not synchronised, it can be observed in an inconsistent state.

Also: if `Use` is called before the goroutine completes, it silently does nothing. There is no failure signal, no waiting — the caller gets a no-op. This is a *correctness* bug masquerading as eventual consistency.

**Better.** `sync.Once` driven by the first `Use` call, or an explicit "ready" channel.

---

### Q15. What is wrong with this `errgroup` use?

```go
g, ctx := errgroup.WithContext(parent)
for _, url := range urls {
    g.Go(func() error {
        return fetch(context.Background(), url)
    })
}
return g.Wait()
```

**Expected answer.**

1. Captured loop variable (`url`). Pre-1.22: all goroutines see the last URL.
2. `context.Background()` instead of `ctx`: tasks ignore cancellation. When one fails, others continue.
3. `errgroup.Group` is meant to fail-fast; this defeats it.

**Fix.**

```go
for _, url := range urls {
    url := url
    g.Go(func() error { return fetch(ctx, url) })
}
```

---

## Staff / staff-engineer level

### Q16. Design a leak budget.

> "Your service is a payment gateway. Define what 'no leaks' means operationally, what metrics you would collect, and what alerts you would set."

**Expected answer.**

- **Definition.** A "leak" is any goroutine, FD, memory page, or connection that survives its owning request by more than `request_timeout + grace_period`.
- **Metrics.**
  - `go_goroutines` (Prometheus)
  - `process_open_fds`
  - `process_resident_memory_bytes`
  - `in_flight_requests`
- **Invariants.**
  - `go_goroutines` − `base_goroutines` ≈ `in_flight_requests` within ±50.
  - `process_open_fds` ≈ `in_flight_connections + base_fds` within ±100.
  - Steady-state memory bounded by `request_avg_memory * in_flight_requests * 1.5`.
- **Alerts.**
  - Goroutine count rising for 10 minutes with constant traffic.
  - FD count crossing 50% of `ulimit -n`.
  - Memory growth rate > expected for 30 minutes.
- **Discovery loop.** When alarm fires, dump `pprof goroutine?debug=2`, group by stack, identify the leak.

---

### Q17. Walk me through a real incident you debugged.

> Open-ended. The interviewer is looking for:
>
> - Concrete tools used (pprof, trace, `-race`, `goleak`).
> - Hypothesis-driven debugging (what was the symptom; what did you suspect; how did you confirm).
> - A specific pitfall identified (one of: leak, race, blocked-send, missing-cancel, panic-loop, M leak).
> - The fix, and why it was the right fix.
> - Prevention measures added afterward.

A strong answer mentions: "We noticed `go_goroutines` growing 10/min, dumped pprof, saw all stacks were in `chan send`. Found that one consumer was returning early on an error path without draining the channel. Fix: drain on error, plus add a `goleak` test for the package."

---

### Q18. Design review: a code change adds `runtime.LockOSThread` to a request handler. What is your review feedback?

**Expected answer.**

- Why? The handler probably should not need thread affinity. cgo? Namespace switching? Document the reason.
- `LockOSThread` for the goroutine's lifetime means one OS thread per concurrent request. Under load this saturates the OS thread limit.
- If the goroutine exits without `UnlockOSThread`, the M is destroyed — thread churn is expensive.
- Better: a small pool of pinned worker goroutines, with the request handler dispatching to them.

---

### Q19. Why is `time.After` discouraged in long-running selects?

**Expected answer.** Each call creates a `Timer` in the runtime heap. The timer lives until it fires (or is GC'd, which happens only after firing). In a hot select loop, the runtime accumulates pending timers — a slow memory leak. Use `time.NewTimer` once with `Reset`.

**Follow-up.** "When *is* `time.After` fine?" — One-shot use outside loops, or in cold paths where allocation is irrelevant.

---

### Q20. Why does Go's memory model say "race-ful programs have no defined behaviour"?

**Expected answer.** Because *guaranteeing* anything about a racy program would require the compiler to avoid optimisations (instruction reordering, register hoisting, CSE) that are valid in race-free code. By treating races as undefined, the compiler can optimise aggressively. The race detector exists to surface races so they get fixed before they cause silent corruption.

---

## Quick-fire round

Questions an interviewer might ask in rapid succession:

1. **What is wrong with `defer wg.Done()` *after* the work, not at the top?** Panics inside the work skip the `Done`. Use `defer` at the top.
2. **What does `make(chan int, 1)` give you that `make(chan int)` does not?** The send completes without a matched receive; useful to prevent leaks in one-shot patterns.
3. **Is `sync.Map` faster than `map + Mutex`?** Only for two specialised use cases. Usually slower.
4. **What does `runtime.Gosched()` do?** Yield the processor; no synchronisation guarantee.
5. **Is `recover` in a `defer` outside a goroutine boundary useful?** Yes for the same goroutine; useless for child goroutines.
6. **Can `close(ch)` block?** No. It is synchronous and never blocks.
7. **Can a `nil` channel send/receive?** Yes — it blocks forever.
8. **What does `time.Tick` return?** A receive-only channel from a `Ticker` that cannot be stopped. Avoid for production.
9. **Difference between concurrent map writes (fatal) and a data race?** The runtime checks for concurrent map writes and aborts; general data races are detected only with `-race`.
10. **How do you find a goroutine leak in production?** pprof goroutine dump, group by stack, identify common waits.

---

## How to read these questions

For each level, the interviewer is looking for:

- **Junior:** Knows the pitfall by sight; can name the fix.
- **Middle:** Sees the same pitfall in idiomatic context (HTTP handler, worker pool); reasons about lifetime and ownership.
- **Senior:** Designs APIs that prevent the pitfall; spots architectural patterns; uses observability tools.
- **Staff:** Defines leak budgets, drives incident response, reviews concurrency at the system level.

A common interview anti-pattern from candidates: memorising specific bug examples without internalising the *family*. The pitfalls in this file resolve to a small number of families (lifetime / ordering / sharing). Knowing the families and being able to map a new example to one in real time is what distinguishes senior signal from rehearsed-junior signal.
