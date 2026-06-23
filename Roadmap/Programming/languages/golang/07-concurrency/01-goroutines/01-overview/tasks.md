# Goroutines — Hands-on Tasks

> Practical exercises from easy to hard. Each task says what to build, what success looks like, and a hint or expected outcome. Solutions or solution sketches are at the end.

---

## Easy

### Task 1 — First goroutine

Write a program that prints "main start", spawns a goroutine that prints "from goroutine", and prints "main end". Make sure all three lines always print.

- Use `sync.WaitGroup` to coordinate.
- Run it 10 times in a row; the order of "from goroutine" relative to "main end" can vary, but all three lines must appear every time.

**Goal.** Learn the basic spawn-and-wait flow.

---

### Task 2 — Spawn N workers

Spawn 10 worker goroutines, each printing its own ID. Use a `sync.WaitGroup` to wait for all of them. Verify all 10 IDs print before "main exits".

- Pass the ID by parameter, not by capture.
- Run with `GOMAXPROCS=1` and `GOMAXPROCS=8`. Observe that at `GOMAXPROCS=1` the order is deterministic per Go version; at higher values it is random.

**Goal.** Observe scheduling behaviour and learn the parameter-passing idiom.

---

### Task 3 — Race detection

Write a goroutine that increments a shared `int` counter 10 000 times. Spawn 10 of them. Print the final value.

- First version: no synchronisation. Run with `go run -race main.go` — observe the race report.
- Second version: protect with `sync.Mutex`. Verify the result is 100 000.
- Third version: replace the mutex with `sync/atomic.AddInt64`. Compare nanosecond cost via `time.Since`.

**Goal.** See the race detector in action and compare two synchronisation tools.

---

### Task 4 — Capture-the-loop-variable bug

Write the classic `for i := 0; i < 5; i++ { go func() { fmt.Println(i) }() }` loop. Run it on a Go version pre-1.22 if possible (or simulate by using a `for ... range` over a slice of indices on the older form). Observe the "5 5 5 5 5".

Then fix it three ways:

1. Pass `i` as a parameter.
2. Make a local copy `i := i` inside the loop body.
3. Use Go 1.22+ semantics (declare in `for i := range ...`).

**Goal.** Internalise the captured-variable trap.

---

### Task 5 — Goroutine count

Print `runtime.NumGoroutine()` before, during, and after spawning 100 short-lived goroutines that each call `time.Sleep(100 * time.Millisecond)`. Use `time.Sleep` only for the demo (do not use this pattern for real coordination).

**Goal.** Learn `runtime.NumGoroutine` as a diagnostic.

---

## Medium

### Task 6 — Worker pool with channel

Implement a pool of 4 workers reading jobs from a `chan int` and writing results to `chan int`. Submit 100 numbers; each worker squares the input. Verify all 100 squared results come out, and `close(results)` cleanly signals end of stream.

- The submitter goroutine is responsible for closing `jobs` after sending the last input.
- A separate goroutine `wg.Wait()`s on all workers, then closes `results`.

**Goal.** Master the canonical worker-pool template.

---

### Task 7 — Cancellation with `context.Context`

Spawn a goroutine that prints `"tick"` once per second. Cancel it after 5 seconds. Verify the goroutine prints exactly 5 (or 4) times and exits cleanly.

- Use `context.WithCancel`.
- Use `select { case <-ctx.Done(): return ; case <-time.After(...): }` for the loop.

**Goal.** Learn the cancellation idiom.

---

### Task 8 — Fan-out fetcher

Write a function `FetchAll(ctx, urls []string) (map[string][]byte, error)` that:

- Spawns one goroutine per URL.
- Uses `errgroup.WithContext` to coordinate.
- Returns results in a map; the first error cancels all in-flight requests.
- Bounds parallelism at 8 concurrent fetches via `g.SetLimit(8)`.

Test with a mix of fast URLs, slow URLs, and one URL that returns 500. Confirm the slow ones are cancelled when the 500 returns.

**Goal.** Use `errgroup` for production-shape concurrent work.

---

### Task 9 — Pipeline of three stages

Build a three-stage pipeline:

1. **Stage 1** generates integers 1..1000 onto a channel.
2. **Stage 2** consumes integers, squares them, sends onto a second channel.
3. **Stage 3** consumes squares, sums them, prints the total.

Each stage is its own goroutine. Channels carry items. Verify the sum equals 1² + 2² + ... + 1000² = 333 833 500.

**Variations:**

- Add 4 parallel goroutines to stage 2 (fan-out within a pipeline).
- Add cancellation: cancel halfway through and confirm clean shutdown.

**Goal.** Master the pipeline pattern.

---

### Task 10 — Bounded parallelism with semaphore

You have a slice of 1000 URLs to fetch. The downstream service allows at most 10 concurrent requests. Implement a fetcher that respects this.

- Use `golang.org/x/sync/semaphore.NewWeighted(10)`.
- Confirm via instrumentation that you never exceed 10 in-flight at once.
- Use `errgroup` for joining.

**Goal.** Learn weighted parallelism control.

---

### Task 11 — Goroutine-safe counter

Build a `Counter` type with `Inc`, `Add(n int)`, `Value() int`. Make it safe for concurrent use. Provide three implementations:

1. `sync.Mutex` + `int`.
2. `sync/atomic.Int64`.
3. Channel-based actor goroutine.

Benchmark the three with 100 goroutines × 100 000 increments. Note the relative speeds.

**Goal.** Compare synchronisation primitives at a real workload.

---

## Hard

### Task 12 — Detect goroutine leaks in tests

Take any goroutine-spawning function from earlier tasks. Add a test using `go.uber.org/goleak`:

```go
func TestNoLeak(t *testing.T) {
    defer goleak.VerifyNone(t)
    runMyConcurrentCode()
}
```

Intentionally introduce a leak (a goroutine that waits on a channel that nobody closes). Confirm the test fails. Fix the leak. Confirm the test passes.

**Goal.** Make leak detection part of your test suite forever.

---

### Task 13 — Supervised background loop

Build a long-running goroutine that consumes from a channel of jobs. On panic, the goroutine should:

1. Recover the panic.
2. Log the panic with stack trace.
3. Restart itself, with exponential backoff (1s, 2s, 4s, 8s, capped at 30s).
4. Reset the backoff on a successful 60-second run.

Inject deliberate panics every few jobs. Watch the supervisor in action.

**Goal.** Learn the supervisor pattern for crash tolerance.

---

### Task 14 — Backpressure-aware service

Build an HTTP service that wraps a worker pool of size 100. The `/work` endpoint:

- Submits the request body to a job channel.
- If the job channel is full (capacity 200), returns HTTP 503.
- Otherwise, waits for the result and returns it.

Load-test with 1000 concurrent requests. Observe how 503s preserve the service when overwhelmed, vs an unbounded version that would OOM.

**Goal.** Learn how to apply backpressure under load.

---

### Task 15 — Goroutine labels for pprof

Take any non-trivial concurrent program. Tag goroutines with `pprof.Labels`:

```go
ctx := pprof.WithLabels(parent, pprof.Labels("op", "fetch", "user", userID))
pprof.SetGoroutineLabels(ctx)
go work(ctx)
```

Run it, hit `/debug/pprof/goroutine?debug=2`, and confirm goroutines are grouped by label. Use this to identify which "feature" is consuming the most goroutines.

**Goal.** Production-grade observability of goroutines.

---

### Task 16 — Trace a real workload

Wrap a non-trivial program with `runtime/trace`:

```go
f, _ := os.Create("trace.out")
defer f.Close()
trace.Start(f)
defer trace.Stop()
```

Open `trace.out` with `go tool trace`. Identify:

- A goroutine that runs without preemption for >10 ms.
- A goroutine that spends most of its life parked.
- A scheduler latency event (delay between runnable and running).

**Goal.** Use the runtime tracer to understand scheduler behaviour.

---

### Task 17 — Implement a small pool from scratch

Without relying on `errgroup` or third-party libraries, implement a `Pool` type with:

- `New(workers int) *Pool`
- `Submit(fn func()) error` — non-blocking, returns error if pool is closed or queue full.
- `Stop()` — close to new submissions, wait for in-flight to finish, then return.
- Recovers panics in worker functions and logs them, rather than crashing the program.
- Exposes `InFlight() int` and `QueueDepth() int` for observability.

Write tests covering: normal operation, panic recovery, graceful stop, submission to a stopped pool, queue overflow.

**Goal.** Build the pool you have used many times, from primitives.

---

### Task 18 — Implement a goroutine-aware rate limiter

Build a rate limiter that allows at most R requests per second across all goroutines. The interface:

```go
type Limiter interface {
    Wait(ctx context.Context) error // returns when permitted, or ctx.Err()
}
```

Two implementations:

1. **Token bucket** with a goroutine that adds tokens at rate R.
2. **Mutex + timestamp** of last allowed request, no goroutine.

Benchmark both at 10 000 requests/second. Compare CPU and latency distribution.

**Goal.** Apply concurrency primitives to a real coordination problem.

---

### Task 19 — Race-condition Whodunnit

This skeleton has a subtle race. Find it, explain it, and fix it without changing the API.

```go
type EventBus struct {
    listeners []func(string)
}

func (b *EventBus) Subscribe(fn func(string)) {
    b.listeners = append(b.listeners, fn)
}

func (b *EventBus) Publish(event string) {
    for _, fn := range b.listeners {
        go fn(event)
    }
}
```

Hint: `Subscribe` and `Publish` may be called concurrently. The `append` may relocate the underlying array. Worse: even with proper locking, calling `fn(event)` in a new goroutine while iterating allows reordering with subsequent Publishes.

**Goal.** Recognise and fix realistic concurrency bugs.

---

### Task 20 — Implement structured concurrency

Build a small `taskgroup` package with one type:

```go
type Group struct { ... }

func New(ctx context.Context) (*Group, context.Context)
func (g *Group) Go(fn func() error)
func (g *Group) Wait() error
```

Requirements:

- `Go(fn)` spawns a goroutine running `fn`.
- The first non-nil error cancels the derived context, so concurrent goroutines exit early.
- `Wait` returns the first non-nil error (or nil).
- Panics in `fn` are recovered and converted to errors.
- A test verifies no goroutines leak after `Wait` returns.

This is essentially `errgroup.Group` plus panic recovery. Implement it from scratch to internalise the design.

**Goal.** Understand the building blocks of structured concurrency.

---

## Solution Sketches

### Task 1

```go
package main

import (
    "fmt"
    "sync"
)

func main() {
    fmt.Println("main start")
    var wg sync.WaitGroup
    wg.Add(1)
    go func() {
        defer wg.Done()
        fmt.Println("from goroutine")
    }()
    wg.Wait()
    fmt.Println("main end")
}
```

---

### Task 6

```go
func RunPool(jobs <-chan int, results chan<- int, workers int) {
    var wg sync.WaitGroup
    for i := 0; i < workers; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            for n := range jobs {
                results <- n * n
            }
        }()
    }
    go func() {
        wg.Wait()
        close(results)
    }()
}
```

---

### Task 8

```go
func FetchAll(ctx context.Context, urls []string) (map[string][]byte, error) {
    g, ctx := errgroup.WithContext(ctx)
    g.SetLimit(8)

    var mu sync.Mutex
    out := make(map[string][]byte)

    for _, url := range urls {
        url := url
        g.Go(func() error {
            req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
            if err != nil { return err }
            res, err := http.DefaultClient.Do(req)
            if err != nil { return err }
            defer res.Body.Close()
            body, err := io.ReadAll(res.Body)
            if err != nil { return err }
            if res.StatusCode >= 500 {
                return fmt.Errorf("status %d for %s", res.StatusCode, url)
            }
            mu.Lock()
            out[url] = body
            mu.Unlock()
            return nil
        })
    }
    if err := g.Wait(); err != nil { return nil, err }
    return out, nil
}
```

---

### Task 13

```go
func supervise(ctx context.Context, name string, run func(context.Context) error) {
    backoff := time.Second
    successWindow := time.Minute
    for {
        if ctx.Err() != nil { return }
        start := time.Now()
        err := safeRun(ctx, run)
        if ctx.Err() != nil { return }
        if time.Since(start) > successWindow {
            backoff = time.Second // reset
        }
        log.Printf("supervised %q: %v; restart in %v", name, err, backoff)
        select {
        case <-ctx.Done():
            return
        case <-time.After(backoff):
        }
        if backoff < 30*time.Second { backoff *= 2 }
    }
}

func safeRun(ctx context.Context, run func(context.Context) error) (err error) {
    defer func() {
        if r := recover(); r != nil {
            err = fmt.Errorf("panic: %v\n%s", r, debug.Stack())
        }
    }()
    return run(ctx)
}
```

---

### Task 17 (skeleton)

```go
type Pool struct {
    queue   chan func()
    quit    chan struct{}
    wg      sync.WaitGroup
    inflight atomic.Int64
    closed  atomic.Bool
}

func New(workers int) *Pool {
    p := &Pool{
        queue: make(chan func(), workers*4),
        quit:  make(chan struct{}),
    }
    p.wg.Add(workers)
    for i := 0; i < workers; i++ {
        go p.worker()
    }
    return p
}

func (p *Pool) worker() {
    defer p.wg.Done()
    for {
        select {
        case <-p.quit:
            return
        case fn, ok := <-p.queue:
            if !ok { return }
            p.run(fn)
        }
    }
}

func (p *Pool) run(fn func()) {
    p.inflight.Add(1)
    defer p.inflight.Add(-1)
    defer func() {
        if r := recover(); r != nil {
            log.Printf("pool worker panic: %v", r)
        }
    }()
    fn()
}

func (p *Pool) Submit(fn func()) error {
    if p.closed.Load() { return errors.New("pool closed") }
    select {
    case p.queue <- fn:
        return nil
    default:
        return errors.New("queue full")
    }
}

func (p *Pool) Stop() {
    if !p.closed.CompareAndSwap(false, true) { return }
    close(p.quit)
    p.wg.Wait()
}

func (p *Pool) InFlight() int64    { return p.inflight.Load() }
func (p *Pool) QueueDepth() int    { return len(p.queue) }
```

---

### Task 19

The fix: copy listeners under lock before publishing, so iteration is over a stable slice.

```go
type EventBus struct {
    mu        sync.RWMutex
    listeners []func(string)
}

func (b *EventBus) Subscribe(fn func(string)) {
    b.mu.Lock()
    b.listeners = append(b.listeners, fn)
    b.mu.Unlock()
}

func (b *EventBus) Publish(event string) {
    b.mu.RLock()
    snapshot := make([]func(string), len(b.listeners))
    copy(snapshot, b.listeners)
    b.mu.RUnlock()
    for _, fn := range snapshot {
        go fn(event)
    }
}
```

A more refined design uses `atomic.Pointer[[]func(string)]` for lock-free reads:

```go
type EventBus struct {
    listeners atomic.Pointer[[]func(string)]
    mu        sync.Mutex
}

func (b *EventBus) Subscribe(fn func(string)) {
    b.mu.Lock()
    defer b.mu.Unlock()
    cur := b.listeners.Load()
    var next []func(string)
    if cur != nil { next = append(next, *cur...) }
    next = append(next, fn)
    b.listeners.Store(&next)
}

func (b *EventBus) Publish(event string) {
    cur := b.listeners.Load()
    if cur == nil { return }
    for _, fn := range *cur {
        go fn(event)
    }
}
```

Subscribers see lock-free reads; subscribers write under a mutex but take a copy-on-write strategy. Common pattern in high-throughput pub/sub.

---

### Task 20 (skeleton)

```go
type Group struct {
    cancel context.CancelFunc
    wg     sync.WaitGroup
    once   sync.Once
    err    atomic.Pointer[error]
}

func New(parent context.Context) (*Group, context.Context) {
    ctx, cancel := context.WithCancel(parent)
    return &Group{cancel: cancel}, ctx
}

func (g *Group) Go(fn func() error) {
    g.wg.Add(1)
    go func() {
        defer g.wg.Done()
        var err error
        defer func() {
            if r := recover(); r != nil {
                err = fmt.Errorf("panic: %v", r)
            }
            if err != nil {
                g.once.Do(func() {
                    e := err
                    g.err.Store(&e)
                    g.cancel()
                })
            }
        }()
        err = fn()
    }()
}

func (g *Group) Wait() error {
    g.wg.Wait()
    g.cancel()
    if e := g.err.Load(); e != nil { return *e }
    return nil
}
```

A `goleak` test confirms no goroutines remain after `Wait`.

---

## Final note

These tasks build progressively. By the end you should be comfortable spawning, joining, cancelling, observing, and debugging goroutines in production-shape code. Keep the solutions; they form a personal cookbook.
