---
layout: default
title: Tasks
parent: Timer Leaks
grand_parent: Time-Based Concurrency
ancestor: Go
nav_order: 8
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/16-time-based-concurrency/03-timer-leaks/tasks/
---

# Timer Leaks — Hands-on Tasks

> Practical exercises from easy to hard. Each task says what to build, what success looks like, and a hint or expected outcome. Solutions or solution sketches are at the end. Focus areas: building leak detectors, fixing leaky select loops, auditing code for `time.After` abuse, hoisting timers, and writing regression tests.

---

## Easy

### Task 1 — See `time.After` allocate

Write a small program that calls `time.After(time.Hour)` in a tight loop for one second. Print `runtime.NumGoroutine()` and `runtime.MemStats.HeapAlloc` before and after.

- Use `runtime.GC()` before reading `MemStats` to get a stable number.
- Run on Go 1.22 (pre-fix) and Go 1.23 (post-fix). Compare the numbers.
- Pre-1.23: HeapAlloc should grow proportional to iterations. Post-1.23: growth is bounded by GC frequency.

**Goal.** Get a feel for how much each `time.After` actually costs.

---

### Task 2 — Fix the canonical leaky loop

Take this code:

```go
func consume(ch <-chan event) {
    for {
        select {
        case e := <-ch:
            handle(e)
        case <-time.After(5 * time.Second):
            log.Println("idle")
        }
    }
}
```

Rewrite it three ways. For each, explain in a code comment what changed.

1. Hoist a `*time.Timer` outside the loop. Use `Stop`/`Reset` with the pre-1.23 drain dance.
2. Hoist a `*time.Timer` and use the simplified Go 1.23+ `Reset` (no drain).
3. Use `context.WithTimeout` per iteration instead.

Compare the three for readability and the number of allocations per iteration.

**Goal.** Internalise the standard rewrite patterns.

---

### Task 3 — Build a `goleak` smoke test

Pick any function from earlier roadmap tasks that spawns a goroutine using a timer. Add a test:

```go
import "go.uber.org/goleak"

func TestNoTimerLeak(t *testing.T) {
    defer goleak.VerifyNone(t)
    callMyFunction()
}
```

Verify the test passes. Then intentionally break it: add a `go func() { <-time.After(time.Hour) }()` inside the function. Confirm the test fails with a clear message.

**Goal.** Make leak detection a habit in your test suite.

---

### Task 4 — Trace `time.NewTimer` allocations with pprof

Write a program that creates 100 000 `*time.Timer` instances and never stops them. Enable the heap profiler with `runtime/pprof`:

```go
import "runtime/pprof"

f, _ := os.Create("heap.pprof")
defer pprof.WriteHeapProfile(f)
```

Open the profile with `go tool pprof heap.pprof` and run `top -cum`. Confirm `time.NewTimer` (or `runtime.startTimer`) appears at the top.

**Goal.** Recognise the signature of a timer leak in pprof output.

---

### Task 5 — Find a leak in your own past code

Open a Go project you have written. Grep for `time.After`:

```sh
grep -rn 'time.After(' .
```

For each call site, ask:

- Is it inside a `for` body?
- Could the function be called many times before the timer fires?
- Is there a way to fix it with `*time.Timer` + `Reset`?

Identify at least one leak candidate. Patch it. Run the test suite to confirm no regressions.

**Goal.** Apply auditing skills to real code you own.

---

## Medium

### Task 6 — Build a `time.After` linter

Write a small Go program using `go/ast` and `go/parser` that:

1. Reads every `.go` file in a directory recursively.
2. Finds every call to `time.After`.
3. For each, checks whether the syntactic ancestor includes a `*ast.ForStmt`.
4. Prints a warning with file, line, and the function name.

Run it on a popular open-source Go project (e.g., `kubernetes`, `etcd`, `prometheus`). Count true positives vs false positives.

**Goal.** Build the leak detector you wish you had.

---

### Task 7 — Fix a leaky select loop under load

Write a program that simulates a server: 100 goroutines, each running this loop:

```go
for {
    select {
    case req := <-requests:
        time.Sleep(time.Millisecond)
        responses <- handle(req)
    case <-time.After(100 * time.Millisecond):
        // idle
    }
}
```

Feed it 100 000 requests at 10 KHz. Measure `runtime.NumGoroutine()` and `runtime.MemStats.HeapAlloc` every 100 ms.

- Note the growth.
- Rewrite with hoisted timers. Re-measure.
- Confirm the heap stabilises.

**Goal.** Reproduce a production-shape leak and fix it.

---

### Task 8 — Implement a leak-detecting wrapper

Build a wrapper type:

```go
type CountedTimer struct {
    t        *time.Timer
    onCreate func()
    onStop   func()
}

func NewCountedTimer(d time.Duration) *CountedTimer
func (c *CountedTimer) C() <-chan time.Time
func (c *CountedTimer) Stop() bool
func (c *CountedTimer) Reset(d time.Duration) bool
```

The wrapper increments a global counter on create and decrements on `Stop` or fire. Expose the live count via `Snapshot()`.

Use it in a test: spawn 1000 timers, stop half, let half fire. Assert the count returns to 0.

**Goal.** Build observability for timer usage.

---

### Task 9 — Audit a real codebase

Pick one of these open-source projects:

- `https://github.com/etcd-io/etcd`
- `https://github.com/prometheus/prometheus`
- `https://github.com/hashicorp/consul`

Find one occurrence of `time.After` (or `time.Tick`) and analyse:

- Is it inside a loop? Is the loop bounded?
- What is the duration?
- Is it cancellable through context, or is the timer truly fire-and-forget?
- Would `*time.Timer` + `Reset` be safer?

Write a one-paragraph review of the call site, as if proposing a PR.

**Goal.** Practice reading and critiquing real Go code.

---

### Task 10 — Replace `time.Tick` with `NewTicker`

Search a Go project (or write a small fake project) with a function like:

```go
func emitMetrics() {
    for range time.Tick(10 * time.Second) {
        publish()
    }
}
```

Rewrite it three ways:

1. `time.NewTicker(10*time.Second)` with `defer Stop()`.
2. `time.NewTicker` plus a `context.Context` for cancellation.
3. `time.AfterFunc` chained to re-arm itself.

Discuss trade-offs in a comment block.

**Goal.** Master the alternatives to `time.Tick`.

---

### Task 11 — Stress test the Reset/Stop dance

Write two versions of a `*time.Timer` reset, run them in parallel, and verify they produce the same observable behaviour.

Version A (pre-1.23 dance):

```go
if !t.Stop() {
    select { case <-t.C: default: }
}
t.Reset(d)
```

Version B (Go 1.23+ simplified):

```go
t.Reset(d)
```

For each, run 1 million reset cycles with random durations and assert that no extra firings leak into the channel. On Go 1.23+, both should pass. On older Go, version B sometimes leaves stale values in the buffer; demonstrate this with a deliberate misuse.

**Goal.** Understand exactly what the dance is for.

---

### Task 12 — Make a `time.AfterFunc` cache invalidator (the wrong way, then the right way)

Implement a cache:

```go
type Cache struct {
    items sync.Map
}

func (c *Cache) Set(key string, value []byte, ttl time.Duration) {
    c.items.Store(key, value)
    time.AfterFunc(ttl, func() {
        c.items.Delete(key)
    })
}
```

Write a benchmark that inserts 100K items with random TTLs in (1s, 60s). Measure:

- Heap allocations.
- `runtime.NumGoroutine()` (the timer goroutines).
- Total memory used.

Now replace with a single janitor goroutine that sweeps expired entries once per second. Compare the same metrics.

**Goal.** Prove that one timer beats many.

---

### Task 13 — Idle-timeout pattern

Build a function:

```go
func ReadWithIdleTimeout(ctx context.Context, r io.Reader, idle time.Duration) ([]byte, error)
```

Semantics: read from `r` until EOF or until no data arrives for `idle`. If `idle` is exceeded between reads, return `ErrIdle`. If `ctx` is cancelled, return `ctx.Err()`.

Requirements:

- Use one `*time.Timer`, hoisted, with `Reset` on each successful read.
- `defer timer.Stop()` to avoid leaks on return.
- Test with a fake reader that emits bytes at controlled intervals.

**Goal.** Apply the idle-timeout pattern to a realistic API.

---

### Task 14 — Auditing helper script

Write a shell or Go script that, given a directory, produces a report:

```
File                       Line   Pattern                In loop?
-----------------------------------------------------------------
worker/queue.go            42     time.After(5*time.S)   yes
worker/queue.go            113    time.Tick(time.Minute) yes (function lifetime)
metrics/emit.go            18     time.After(time.S)     no
```

Use simple heuristics (a regex to find the patterns, and an AST scan to determine "in loop?"). Run on three projects and report the rate of "in loop" cases.

**Goal.** Build the auditing tool you would want as a tech lead.

---

## Hard

### Task 15 — Diagnose a synthetic production leak

Run this program for 60 seconds and diagnose the leak from outside:

```go
package main

import (
    "fmt"
    "net/http"
    _ "net/http/pprof"
    "time"
)

var ch = make(chan int)

func main() {
    go http.ListenAndServe(":6060", nil)
    for i := 0; i < 1000; i++ {
        go subscriber(i)
    }
    select {}
}

func subscriber(id int) {
    for {
        select {
        case msg := <-ch:
            _ = msg
        case <-time.After(time.Hour):
            fmt.Println("timed out, exiting", id)
            return
        }
    }
}
```

Use `pprof`:

```sh
go tool pprof http://localhost:6060/debug/pprof/heap
go tool pprof http://localhost:6060/debug/pprof/goroutine
```

Identify:

- The number of dormant timers.
- The call site responsible.
- The fix.

Write up your diagnosis in a one-page Markdown file as if it were a postmortem.

**Goal.** Practice the full diagnose-fix cycle on a controlled leak.

---

### Task 16 — Build a leak-aware worker pool

Implement a worker pool with these requirements:

- `New(workers int, queueSize int) *Pool`
- `Submit(ctx context.Context, fn func()) error` — submits with a per-task timeout from `ctx`.
- `Stop(timeout time.Duration) error` — drains the queue or kills after `timeout`.

Each worker has an idle timeout of 30 seconds; if no work arrives for 30 seconds, the worker exits and the pool spawns a replacement when work arrives. Use one `*time.Timer` per worker, hoisted, reset on each task.

Write tests:

1. 100 tasks run successfully.
2. Workers exit after idle and the pool shrinks.
3. Workers spin up on new submissions.
4. `Stop(0)` kills immediately; `Stop(5*time.Second)` drains.
5. `goleak` confirms no goroutines after `Stop` returns.

**Goal.** Build a production-shape pool with full timer hygiene.

---

### Task 17 — Implement a deadline-aware retry

Build a retry helper:

```go
func RetryWithBackoff(
    ctx context.Context,
    op func(ctx context.Context) error,
    initial, max time.Duration,
) error
```

Semantics:

- Calls `op` repeatedly with exponential backoff (initial, 2*initial, ..., capped at max).
- Aborts when `ctx.Done()`.
- Returns the last error.

Requirements:

- Use one hoisted `*time.Timer` for the backoff wait, not `time.After`.
- Add jitter (random 0.5x-1.5x) to the backoff to avoid thundering herds.
- Add a `goleak` test.
- Add a benchmark comparing this to a `time.After`-per-iteration implementation. Show that the hoisted version allocates O(1) per call vs O(N) where N is the number of retries.

**Goal.** Build a retry helper that does not leak under load.

---

### Task 18 — Mock a clock for testing

Build a `Clock` interface:

```go
type Clock interface {
    Now() time.Time
    NewTimer(d time.Duration) Timer
    NewTicker(d time.Duration) Ticker
    After(d time.Duration) <-chan time.Time
}

type Timer interface {
    C() <-chan time.Time
    Stop() bool
    Reset(d time.Duration) bool
}

type Ticker interface {
    C() <-chan time.Time
    Stop()
}
```

Implement `realClock` (delegates to `time` directly) and `fakeClock` (in-memory, advanceable).

`fakeClock` has an extra method:

```go
func (c *fakeClock) Advance(d time.Duration)
```

`Advance` moves virtual time forward and fires all timers/tickers whose deadlines are passed.

Write tests that exercise:

1. A `Timer` set for 10s fires after `Advance(10*time.Second)`.
2. A `Ticker` with period 1s fires 5 times after `Advance(5*time.Second)`.
3. `Stop()` on a fired timer returns `false`.
4. A `Reset` before firing changes the deadline.

Now rewrite Task 13 (`ReadWithIdleTimeout`) to accept a `Clock` parameter, and test it with `fakeClock` so that the test runs in microseconds rather than real time.

**Goal.** Build the testing infrastructure that enables fast, deterministic timer tests.

---

### Task 19 — Real-traffic leak hunt

Pick a moderately complex open-source Go service (e.g., `traefik`, `loki`, `nats-server`). Clone it. Run it under a synthetic load (a simple `wrk` or `vegeta` test against its endpoints) for 30 minutes.

Sample `/debug/pprof/goroutine?debug=2` and `/debug/pprof/heap` every 5 minutes. Diff consecutive snapshots.

If you find any growth attributable to `time.NewTimer` or parked goroutines on `time.After`:

1. File a GitHub issue with the evidence (or, if it is already known, link to the existing issue).
2. Propose a fix.
3. Open a PR if appropriate.

If you find no growth, write up the test methodology — what you sampled, how often, what counted as "growth," and why this service appears clean.

**Goal.** Apply leak-hunting to real software.

---

### Task 20 — Convert an `AfterFunc`-heavy codebase

Find or construct a codebase that uses `time.AfterFunc` for cache TTLs, connection idle, or session expiry. Examples:

- A web framework session store.
- A connection pool with idle expiry.
- A rate limiter that resets buckets.

Quantify the timer count with `runtime.NumGoroutine()` and pprof under load.

Then rewrite to use a single janitor goroutine with a heap-ordered list of (deadline, key) pairs. Re-measure. Document the savings in a markdown file.

**Goal.** Apply the "one timer per pool, not one per item" principle to a real codebase.

---

### Task 21 — Build a regression-test framework

Wrap an arbitrary function in a test harness that:

1. Calls the function N times in a loop.
2. After every N iterations, forces GC and reads `runtime.MemStats.HeapAlloc`.
3. Linearly regresses HeapAlloc against iteration count.
4. Fails the test if the slope is >K bytes per iteration.

Apply it to two functions: one that genuinely leaks via `time.After`, one that does not. Confirm the harness flags the leaker and passes the clean one.

Tuning: choose N (iterations between samples), K (slope threshold), and number of samples for statistical confidence. Document your choices.

**Goal.** Build a CI-friendly heuristic for catching new leaks before they merge.

---

### Task 22 — Synthesise the rules

Write a 1-page Markdown style guide titled "Time-Based Concurrency at $YOUR_TEAM" containing:

- The list of allowed and disallowed patterns (e.g., "Use `time.NewTimer`, never `time.After` inside a loop").
- An explanation of why each rule exists, with a leak scenario.
- A checklist for code review.
- Recommendations for tools (linters, leak detectors).
- A migration plan for any existing violations.

Present it to a peer. Iterate based on feedback. Save the final version as `STYLE.md` in a project of your choice.

**Goal.** Convert your knowledge into a team-shareable artefact.

---

## Solution Sketches

### Task 1

```go
package main

import (
    "fmt"
    "runtime"
    "time"
)

func main() {
    runtime.GC()
    var before, after runtime.MemStats
    runtime.ReadMemStats(&before)

    end := time.Now().Add(time.Second)
    var count int
    for time.Now().Before(end) {
        _ = time.After(time.Hour)
        count++
    }

    runtime.GC()
    runtime.ReadMemStats(&after)

    fmt.Printf("iterations: %d\n", count)
    fmt.Printf("goroutines: %d -> %d\n", runtime.NumGoroutine(), runtime.NumGoroutine())
    fmt.Printf("heap delta: %d bytes\n", after.HeapAlloc-before.HeapAlloc)
    fmt.Printf("total allocs: %d\n", after.Mallocs-before.Mallocs)
}
```

Pre-1.23: `heap delta` is proportional to iterations (each timer lives for 1 hour). Post-1.23: GC reclaims, so delta is bounded.

---

### Task 2

```go
// Version 1: pre-1.23 hoisted
func consumeV1(ch <-chan event) {
    t := time.NewTimer(5 * time.Second)
    defer t.Stop()
    for {
        if !t.Stop() {
            select { case <-t.C: default: }
        }
        t.Reset(5 * time.Second)
        select {
        case e := <-ch:
            handle(e)
        case <-t.C:
            log.Println("idle")
        }
    }
}

// Version 2: Go 1.23+ simplified
func consumeV2(ch <-chan event) {
    t := time.NewTimer(5 * time.Second)
    defer t.Stop()
    for {
        t.Reset(5 * time.Second) // 1.23+ handles drain
        select {
        case e := <-ch:
            handle(e)
        case <-t.C:
            log.Println("idle")
        }
    }
}

// Version 3: context-based
func consumeV3(parent context.Context, ch <-chan event) {
    for {
        ctx, cancel := context.WithTimeout(parent, 5*time.Second)
        select {
        case e := <-ch:
            cancel()
            handle(e)
        case <-ctx.Done():
            cancel()
            log.Println("idle")
        }
    }
}
```

Allocation per iteration: V1, V2 = 0 (timer reused); V3 = 1 (context allocation).

---

### Task 6

Sketch of a linter using `go/ast`:

```go
package main

import (
    "fmt"
    "go/ast"
    "go/parser"
    "go/token"
    "os"
    "path/filepath"
)

func main() {
    root := os.Args[1]
    filepath.Walk(root, func(p string, info os.FileInfo, err error) error {
        if err != nil || info.IsDir() || filepath.Ext(p) != ".go" {
            return nil
        }
        fset := token.NewFileSet()
        f, err := parser.ParseFile(fset, p, nil, 0)
        if err != nil {
            return nil
        }
        ast.Inspect(f, func(n ast.Node) bool {
            return inspect(fset, n, false)
        })
        return nil
    })
}

func inspect(fset *token.FileSet, n ast.Node, inLoop bool) bool {
    switch x := n.(type) {
    case *ast.ForStmt, *ast.RangeStmt:
        ast.Inspect(n, func(m ast.Node) bool {
            if m == n {
                return true
            }
            return inspect(fset, m, true)
        })
        return false
    case *ast.CallExpr:
        if sel, ok := x.Fun.(*ast.SelectorExpr); ok {
            if id, ok := sel.X.(*ast.Ident); ok && id.Name == "time" && sel.Sel.Name == "After" {
                tag := "in-loop"
                if !inLoop {
                    tag = "top-level"
                }
                fmt.Printf("%s\ttime.After\t%s\n", fset.Position(x.Pos()), tag)
            }
        }
    }
    return true
}
```

This is a simplification; production linters use `golang.org/x/tools/go/analysis` for proper data flow.

---

### Task 8

```go
package counted

import (
    "sync/atomic"
    "time"
)

var liveTimers int64

func Live() int64 { return atomic.LoadInt64(&liveTimers) }

type CountedTimer struct {
    t       *time.Timer
    stopped int32
}

func NewCountedTimer(d time.Duration) *CountedTimer {
    atomic.AddInt64(&liveTimers, 1)
    return &CountedTimer{t: time.NewTimer(d)}
}

func (c *CountedTimer) C() <-chan time.Time { return c.t.C }

func (c *CountedTimer) Stop() bool {
    ok := c.t.Stop()
    if atomic.CompareAndSwapInt32(&c.stopped, 0, 1) {
        atomic.AddInt64(&liveTimers, -1)
    }
    return ok
}

func (c *CountedTimer) Reset(d time.Duration) bool {
    return c.t.Reset(d)
}
```

Caveat: this tracks `Stop` calls, not actual firings. For full accounting, wrap the channel and decrement on receive. Use this as a debugging aid, not a hot-path counter.

---

### Task 12

```go
// Wrong: one timer per item.
func (c *BadCache) Set(key string, value []byte, ttl time.Duration) {
    c.items.Store(key, value)
    time.AfterFunc(ttl, func() {
        c.items.Delete(key)
    })
}

// Right: one janitor for the whole cache.
type GoodCache struct {
    items sync.Map
    exp   sync.Map // key -> deadline
}

func (c *GoodCache) Set(key string, value []byte, ttl time.Duration) {
    c.items.Store(key, value)
    c.exp.Store(key, time.Now().Add(ttl))
}

func (c *GoodCache) RunJanitor(ctx context.Context) {
    t := time.NewTicker(time.Second)
    defer t.Stop()
    for {
        select {
        case <-ctx.Done():
            return
        case now := <-t.C:
            c.exp.Range(func(k, v any) bool {
                if now.After(v.(time.Time)) {
                    c.items.Delete(k)
                    c.exp.Delete(k)
                }
                return true
            })
        }
    }
}
```

Memory savings for 100K items: timers gone, only the two maps remain. Goroutine count drops by 100K (or however many timers AfterFunc would have created).

---

### Task 13

```go
func ReadWithIdleTimeout(ctx context.Context, r io.Reader, idle time.Duration) ([]byte, error) {
    var buf []byte
    chunk := make([]byte, 4096)
    t := time.NewTimer(idle)
    defer t.Stop()
    for {
        if !t.Stop() {
            select { case <-t.C: default: }
        }
        t.Reset(idle)
        readCh := make(chan readResult, 1)
        go func() {
            n, err := r.Read(chunk)
            readCh <- readResult{n: n, err: err}
        }()
        select {
        case <-ctx.Done():
            return buf, ctx.Err()
        case <-t.C:
            return buf, ErrIdle
        case res := <-readCh:
            if res.err == io.EOF {
                return append(buf, chunk[:res.n]...), nil
            }
            if res.err != nil {
                return buf, res.err
            }
            buf = append(buf, chunk[:res.n]...)
        }
    }
}

type readResult struct {
    n   int
    err error
}

var ErrIdle = errors.New("read idle timeout")
```

Caveat: the spawned `go r.Read(...)` may leak if neither it nor the context resolves in finite time. In production, wrap with `r.(io.ReadCloser).Close()` on timeout.

---

### Task 16 (skeleton)

```go
type Pool struct {
    queue    chan job
    workers  atomic.Int64
    quit     chan struct{}
    wg       sync.WaitGroup
    closed   atomic.Bool
    idleTime time.Duration
}

type job struct {
    ctx context.Context
    fn  func()
}

func New(workers int, queueSize int) *Pool {
    p := &Pool{
        queue:    make(chan job, queueSize),
        quit:     make(chan struct{}),
        idleTime: 30 * time.Second,
    }
    for i := 0; i < workers; i++ {
        p.spawn()
    }
    return p
}

func (p *Pool) spawn() {
    p.workers.Add(1)
    p.wg.Add(1)
    go p.worker()
}

func (p *Pool) worker() {
    defer p.wg.Done()
    defer p.workers.Add(-1)
    t := time.NewTimer(p.idleTime)
    defer t.Stop()
    for {
        if !t.Stop() {
            select { case <-t.C: default: }
        }
        t.Reset(p.idleTime)
        select {
        case <-p.quit:
            return
        case <-t.C:
            return // idle exit
        case j, ok := <-p.queue:
            if !ok {
                return
            }
            p.run(j)
        }
    }
}

func (p *Pool) run(j job) {
    defer func() {
        if r := recover(); r != nil {
            log.Printf("worker panic: %v", r)
        }
    }()
    if err := j.ctx.Err(); err != nil {
        return
    }
    j.fn()
}

func (p *Pool) Submit(ctx context.Context, fn func()) error {
    if p.closed.Load() {
        return errors.New("pool closed")
    }
    select {
    case p.queue <- job{ctx: ctx, fn: fn}:
        if p.workers.Load() == 0 {
            p.spawn()
        }
        return nil
    default:
        return errors.New("queue full")
    }
}

func (p *Pool) Stop(timeout time.Duration) error {
    if !p.closed.CompareAndSwap(false, true) {
        return nil
    }
    close(p.quit)
    done := make(chan struct{})
    go func() { p.wg.Wait(); close(done) }()
    select {
    case <-done:
        return nil
    case <-time.After(timeout):
        return errors.New("pool stop timed out")
    }
}
```

---

### Task 17

```go
func RetryWithBackoff(
    ctx context.Context,
    op func(ctx context.Context) error,
    initial, max time.Duration,
) error {
    backoff := initial
    t := time.NewTimer(0)
    defer t.Stop()
    if !t.Stop() {
        <-t.C
    }
    var lastErr error
    for {
        if err := ctx.Err(); err != nil {
            return err
        }
        if err := op(ctx); err == nil {
            return nil
        } else {
            lastErr = err
        }
        sleep := jitter(backoff)
        if !t.Stop() {
            select { case <-t.C: default: }
        }
        t.Reset(sleep)
        select {
        case <-ctx.Done():
            t.Stop()
            return ctx.Err()
        case <-t.C:
        }
        backoff *= 2
        if backoff > max {
            backoff = max
        }
        _ = lastErr // available if you want to return after a maxAttempts cap
    }
}

func jitter(d time.Duration) time.Duration {
    f := 0.5 + rand.Float64() // 0.5..1.5
    return time.Duration(float64(d) * f)
}
```

Benchmark vs `time.After`: the hoisted version allocates 1 timer total; the `time.After` version allocates 1 per iteration.

---

### Task 18 (skeleton)

```go
type fakeClock struct {
    mu     sync.Mutex
    now    time.Time
    timers []*fakeTimer
}

type fakeTimer struct {
    clk      *fakeClock
    deadline time.Time
    period   time.Duration // 0 = one-shot
    ch       chan time.Time
    stopped  bool
}

func newFakeClock(start time.Time) *fakeClock {
    return &fakeClock{now: start}
}

func (c *fakeClock) Now() time.Time {
    c.mu.Lock(); defer c.mu.Unlock()
    return c.now
}

func (c *fakeClock) NewTimer(d time.Duration) Timer {
    c.mu.Lock(); defer c.mu.Unlock()
    t := &fakeTimer{
        clk:      c,
        deadline: c.now.Add(d),
        ch:       make(chan time.Time, 1),
    }
    c.timers = append(c.timers, t)
    return t
}

func (c *fakeClock) Advance(d time.Duration) {
    c.mu.Lock()
    c.now = c.now.Add(d)
    var fired []*fakeTimer
    var remaining []*fakeTimer
    for _, t := range c.timers {
        if t.stopped {
            continue
        }
        if !t.deadline.After(c.now) {
            fired = append(fired, t)
            if t.period > 0 {
                t.deadline = t.deadline.Add(t.period)
                remaining = append(remaining, t)
            }
        } else {
            remaining = append(remaining, t)
        }
    }
    c.timers = remaining
    now := c.now
    c.mu.Unlock()
    for _, t := range fired {
        select { case t.ch <- now: default: }
    }
}

func (t *fakeTimer) C() <-chan time.Time { return t.ch }

func (t *fakeTimer) Stop() bool {
    t.clk.mu.Lock(); defer t.clk.mu.Unlock()
    if t.stopped {
        return false
    }
    t.stopped = true
    fired := !t.deadline.After(t.clk.now)
    return !fired
}

func (t *fakeTimer) Reset(d time.Duration) bool {
    t.clk.mu.Lock(); defer t.clk.mu.Unlock()
    wasActive := !t.stopped && t.deadline.After(t.clk.now)
    t.deadline = t.clk.now.Add(d)
    t.stopped = false
    return wasActive
}
```

Production-quality versions live in `github.com/benbjohnson/clock` and `github.com/jonboulle/clockwork`.

---

### Task 21

```go
package leakreg

import (
    "fmt"
    "runtime"
    "testing"
)

type Sample struct {
    iter int
    heap uint64
}

func RegressForLeak(t *testing.T, name string, samples, every int, slopeLimit float64, run func()) {
    runtime.GC()
    var s []Sample
    for i := 0; i < samples; i++ {
        for j := 0; j < every; j++ {
            run()
        }
        runtime.GC()
        var m runtime.MemStats
        runtime.ReadMemStats(&m)
        s = append(s, Sample{iter: (i + 1) * every, heap: m.HeapAlloc})
    }
    slope := linearSlope(s)
    if slope > slopeLimit {
        t.Fatalf("%s: leak suspected; slope=%.2f bytes/iter, limit=%.2f", name, slope, slopeLimit)
    } else {
        fmt.Printf("%s: slope=%.2f bytes/iter\n", name, slope)
    }
}

func linearSlope(s []Sample) float64 {
    n := float64(len(s))
    var sx, sy, sxy, sx2 float64
    for _, p := range s {
        x := float64(p.iter)
        y := float64(p.heap)
        sx += x; sy += y; sxy += x * y; sx2 += x * x
    }
    return (n*sxy - sx*sy) / (n*sx2 - sx*sx)
}
```

Usage:

```go
func TestLeaky(t *testing.T) {
    RegressForLeak(t, "time.After loop", 20, 1000, 100, func() {
        _ = time.After(time.Hour)
    })
}
```

Tuning: `samples=20`, `every=1000`, `slopeLimit=100` bytes/iter catches the obvious leak while tolerating GC noise. Increase samples for confidence in noisy environments.

---

### Task 22

Style guide template:

```
# Time-Based Concurrency at Acme

## Rules

1. Never use `time.After` inside a loop body. Hoist a `*time.Timer` outside.
2. Never use `time.Tick`. Use `time.NewTicker(d); defer t.Stop()`.
3. Every `time.NewTimer` and `time.NewTicker` has a `defer Stop()`.
4. For RPC timeouts, use `context.WithTimeout(parent, d)`, not `time.After`.
5. `time.AfterFunc` is permitted only for one-shot, short-closure, fire-and-forget actions.
6. All long-running goroutines accept `context.Context` and exit on `ctx.Done()`.

## Why

- Hot loops with `time.After` allocate a timer per iteration. Even on Go 1.23+, this is wasteful.
- `time.Tick` cannot be stopped. It is suitable only for program-lifetime usage.
- `AfterFunc` closures pin captured state in the runtime timer heap.

## Code review checklist

- [ ] No `time.After` in any `for` body.
- [ ] No `time.Tick` outside `main`.
- [ ] Every `NewTimer`/`NewTicker` has `defer Stop()`.
- [ ] Functions that spawn timers have a `goleak` test.
- [ ] Hot paths use hoisted timers, not per-iteration allocations.

## Tools

- `staticcheck` rules SA1015, SA1004.
- `go.uber.org/goleak` in tests.
- Custom linter from Task 6 for `time.After` in loops.

## Migration plan

1. Run the auditing helper from Task 14 over the entire codebase.
2. Triage in-loop cases; fix all of them.
3. Add CI gating: new `time.After` in loops fails the build.
4. Backfill `goleak` tests for the highest-traffic services.
```

---

## Final note

These tasks build a complete competency: spotting timer leaks, fixing them, building tools to prevent them, and writing tests to catch them. By Task 22, you should be able to walk into any Go codebase, audit it for timer hygiene, and produce concrete, ranked, fix-shaped recommendations. Keep the solutions; they are the basis of a personal cookbook for time-sensitive Go code.
