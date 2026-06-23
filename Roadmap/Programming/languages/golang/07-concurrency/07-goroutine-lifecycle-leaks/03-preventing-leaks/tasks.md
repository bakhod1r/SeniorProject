# Preventing Goroutine Leaks — Tasks

## Table of Contents
1. [How to Use This File](#how-to-use-this-file)
2. [Warm-Up: Fix the Five Patterns](#warm-up-fix-the-five-patterns)
3. [Build the Start/Stop Struct](#build-the-startstop-struct)
4. [Wire Up `errgroup`](#wire-up-errgroup)
5. [Add goleak to a Project](#add-goleak-to-a-project)
6. [HTTP Server Graceful Shutdown](#http-server-graceful-shutdown)
7. [Worker Pool with Back-Pressure](#worker-pool-with-back-pressure)
8. [Refactor a Leaky Codebase](#refactor-a-leaky-codebase)
9. [Cancellation Latency Budget](#cancellation-latency-budget)
10. [Build a Supervisor](#build-a-supervisor)
11. [Audit Exercise](#audit-exercise)
12. [Self-Check Solutions](#self-check-solutions)

---

## How to Use This File

Each task has a stated goal, a starting point (or a blank slate), and a checklist of what counts as "done." Most tasks take 15–60 minutes. Do them in a fresh module so you can verify with `go test ./...` cleanly.

For every task, the unstated requirement is: **goleak passes**. Add `goleak.VerifyTestMain` early; let it catch your bugs.

---

## Warm-Up: Fix the Five Patterns

### Task 1.1 — Pattern 1: Sender on Unbuffered Channel

Starting code:

```go
package main

import "fmt"

func fetch(u string) string {
    return "result of " + u
}

func first(urls []string) string {
    ch := make(chan string)
    for _, u := range urls {
        go func(u string) { ch <- fetch(u) }(u)
    }
    return <-ch
}

func main() {
    fmt.Println(first([]string{"a", "b", "c", "d", "e"}))
}
```

**Goal**: After `first` returns, no goroutines remain.

**Checklist**:
- [ ] `make(chan string, len(urls))` so all senders can deposit.
- [ ] Test asserts `runtime.NumGoroutine()` returns to baseline 100ms after `first` returns.
- [ ] goleak passes.

### Task 1.2 — Pattern 2: Receiver on Channel Never Closed

Starting code:

```go
func worker(in <-chan Job) {
    go func() {
        for j := range in {
            process(j)
        }
    }()
}
```

**Goal**: The goroutine can be stopped by the caller.

**Checklist**:
- [ ] Accept `ctx context.Context`.
- [ ] `select` watches `<-ctx.Done()` and the channel.
- [ ] Return a `Stop` mechanism (cancel func, or wrap in a struct).
- [ ] goleak passes after `cancel()` + wait.

### Task 1.3 — Pattern 3: Infinite Default Loop

Starting code:

```go
go func() {
    for {
        select {
        case msg := <-in:
            handle(msg)
        default:
        }
    }
}()
```

**Goal**: No busy-wait; clean cancellation.

**Checklist**:
- [ ] Remove `default` (or replace with a `time.Ticker` if a periodic poll is genuinely needed).
- [ ] Add `<-ctx.Done()` case.
- [ ] CPU usage is near 0 when idle (verify with `top` or a Go benchmark).

### Task 1.4 — Pattern 4: Mutex Held Across Channel Op

Starting code:

```go
var mu sync.Mutex
var pending []Job

func enqueue(j Job, dispatch chan<- Job) {
    mu.Lock()
    defer mu.Unlock()
    pending = append(pending, j)
    dispatch <- j // BUG: holds mu across send
}
```

**Goal**: The send does not happen while the mutex is held.

**Checklist**:
- [ ] Mutex critical section ends before any channel operation.
- [ ] State update and send are still consistent.
- [ ] Test: spawn 100 enqueuers and one slow consumer; no deadlock.

### Task 1.5 — Pattern 5: Ticker Not Stopped

Starting code:

```go
func startHeartbeat() {
    go func() {
        t := time.NewTicker(time.Second)
        for {
            select {
            case <-t.C:
                ping()
            }
        }
    }()
}
```

**Goal**: Owner, cancellation, ticker stop.

**Checklist**:
- [ ] Wrap in a struct with `Close`.
- [ ] `defer t.Stop()` immediately after `NewTicker`.
- [ ] `<-ctx.Done()` case in the select.
- [ ] Test starts, sleeps 50ms, closes, asserts no goroutines remain.

---

## Build the Start/Stop Struct

### Task 2 — Generic Owned Loop

Build a `LoopRunner` type that runs a user-provided function on a configurable interval until `Close`:

```go
type LoopRunner struct { /* fields */ }

func NewLoopRunner(ctx context.Context, interval time.Duration, fn func(context.Context)) *LoopRunner

func (l *LoopRunner) Close() error
```

**Checklist**:
- [ ] Constructor takes parent context.
- [ ] Uses `time.NewTicker` with `defer Stop()`.
- [ ] `Close` is idempotent (use `sync.Once`).
- [ ] `Close` waits for the loop to exit.
- [ ] `fn` is called with the goroutine's context so it can respect cancellation.
- [ ] goleak in the test passes.

### Task 2.1 — Multi-Goroutine Variant

Extend `LoopRunner` to accept N concurrent worker functions. The struct owns N goroutines; `Close` waits for all of them.

**Checklist**:
- [ ] `sync.WaitGroup` replaces the single done channel.
- [ ] All goroutines share the same context.
- [ ] `Close` cancels once and waits for all.
- [ ] Test with N=10 and intentional 50ms latency in `fn`.

---

## Wire Up `errgroup`

### Task 3.1 — Parallel Fetch

Implement `fetchAll(ctx, urls)` that fetches each URL concurrently, returns the slice of bodies, and fails fast on the first error. Use `errgroup.WithContext`.

**Checklist**:
- [ ] No hand-rolled `WaitGroup` or error channel.
- [ ] Loop variable captured correctly (`url := url` in the loop body if you are on Go < 1.22).
- [ ] Goroutines pass the derived `ctx` to `fetch`.
- [ ] First error cancels siblings.
- [ ] Test: one URL returns an error, observe that the others are cancelled.

### Task 3.2 — Bounded Parallelism

Modify Task 3.1 to limit concurrency to 8. Use `g.SetLimit(8)`.

**Checklist**:
- [ ] Observe that at most 8 fetches are in flight (instrument with a counter).
- [ ] Total time on 100 URLs at 100ms each is ~1.25 seconds (100 ÷ 8 × 100ms).
- [ ] No leaks if half the URLs fail.

---

## Add goleak to a Project

### Task 4 — Retrofit an Existing Project

Pick a small Go project you have (or use https://github.com/avelino/awesome-go to find one). Add `goleak`:

**Checklist**:
- [ ] `go get go.uber.org/goleak`.
- [ ] Add `TestMain` with `goleak.VerifyTestMain(m)` to one package.
- [ ] Run `go test ./...`. Fix any leaks reported.
- [ ] Decide whether any reported leaks are third-party. Add `IgnoreTopFunction` allowlist with justification in a comment.
- [ ] Repeat for every package with goroutine usage.

### Task 4.1 — Per-Test Variant

For a flakier package, use per-test verification instead of `TestMain`:

```go
func TestX(t *testing.T) {
    defer goleak.VerifyNone(t)
    // ...
}
```

**Checklist**:
- [ ] Identify a test that has setup goroutines that should not survive the test.
- [ ] Add the defer.
- [ ] Run `go test -count=10 -race ./...` and ensure stability.

---

## HTTP Server Graceful Shutdown

### Task 5 — Build the Skeleton

Implement `run(ctx)` that:
- Starts an HTTP server on `:8080`.
- Has a `/hello` endpoint that sleeps 2 seconds, then writes "hi".
- On SIGINT or SIGTERM, drains in-flight requests within 30 seconds.

**Checklist**:
- [ ] `signal.NotifyContext` for SIGINT/SIGTERM.
- [ ] `errgroup.WithContext` to coordinate the server goroutine and the shutdown goroutine.
- [ ] `srv.Shutdown(shutdownCtx)` where `shutdownCtx` is `context.WithTimeout(context.Background(), 30*time.Second)` — *not* derived from the cancelled root context.
- [ ] `ReadHeaderTimeout`, `ReadTimeout`, `WriteTimeout`, `IdleTimeout` set.
- [ ] Handler respects `r.Context().Done()` (interrupts the sleep on disconnect).
- [ ] Integration test: send a request, send SIGTERM mid-flight, request completes, server exits cleanly.

### Task 5.1 — Timeout Bound

Modify the shutdown to exit forcibly after the 30-second timeout, logging which connections remain.

**Checklist**:
- [ ] If `Shutdown` returns `context.DeadlineExceeded`, log the number of active connections.
- [ ] Use `srv.RegisterOnShutdown` if needed for per-connection cleanup.
- [ ] Verify with a misbehaving handler that holds for 60 seconds.

---

## Worker Pool with Back-Pressure

### Task 6 — Build a Pool

Implement a `Pool` type:

```go
type Pool struct { /* ... */ }

func NewPool(ctx context.Context, size int, handle func(context.Context, Job) error) *Pool

func (p *Pool) Submit(ctx context.Context, j Job) error

func (p *Pool) Close() error
```

**Behaviour**:
- N goroutines pull jobs from an internal channel and call `handle`.
- `Submit` blocks until a worker is free, or until its `ctx` is cancelled.
- `Close` cancels the pool's context, waits for workers, returns the first error encountered.

**Checklist**:
- [ ] Internal job channel is unbuffered (back-pressure) or small buffer (smoothing).
- [ ] `Submit` uses `select` to honour both `p.in <- j` and `<-ctx.Done()`.
- [ ] `Close` is idempotent.
- [ ] Test: submit 1000 jobs, close mid-flight, verify all submitted-and-accepted jobs were handled.

### Task 6.1 — Load Shedding

Modify `Submit` to return an `ErrPoolFull` error if no worker is free within 100 ms. Implement using `select` with a `time.After` and a `context.Done()` case.

**Checklist**:
- [ ] Sustained submit rate above worker capacity yields `ErrPoolFull` quickly.
- [ ] Brief bursts within timeout are absorbed.
- [ ] Test: 1000 submits at 10ms intervals to a pool of 5 workers handling 50ms jobs; some fraction succeeds, the rest get `ErrPoolFull`.

---

## Refactor a Leaky Codebase

### Task 7 — The Mini-Service

Starting code (a small intentionally-leaky service):

```go
package svc

import (
    "fmt"
    "time"
)

type Service struct {
    in chan string
}

func NewService() *Service {
    s := &Service{in: make(chan string)}
    go s.consume()
    go s.flush()
    return s
}

func (s *Service) Submit(msg string) {
    s.in <- msg
}

func (s *Service) consume() {
    for msg := range s.in {
        time.Sleep(10 * time.Millisecond)
        fmt.Println(msg)
    }
}

func (s *Service) flush() {
    for {
        time.Sleep(time.Second)
        fmt.Println("flush")
    }
}
```

**Goal**: Refactor to use the Start/Stop pattern. After refactoring, `s.Close()` stops both goroutines cleanly.

**Checklist**:
- [ ] `NewService` takes a parent context.
- [ ] Both `consume` and `flush` watch `<-ctx.Done()`.
- [ ] `flush` uses `time.Ticker` with `defer Stop()`.
- [ ] `Submit` uses select with `<-ctx.Done()` so it can return an error after `Close`.
- [ ] `sync.WaitGroup` waits for both goroutines.
- [ ] `goleak.VerifyTestMain` passes.

### Task 7.1 — Add Tests

Write tests:

- [ ] `TestStartClose`: construct, submit one message, close, assert no goroutines remain.
- [ ] `TestSubmitAfterClose`: construct, close, attempt to submit, expect error.
- [ ] `TestConcurrentClose`: call `Close` from 10 goroutines simultaneously; assert no panics, no leaks, exactly one shutdown.

---

## Cancellation Latency Budget

### Task 8 — Measure and Enforce

Build a test that asserts the cancellation latency of your Service (Task 7) is under 100 ms.

```go
func TestCancellationLatency(t *testing.T) {
    ctx, cancel := context.WithCancel(context.Background())
    s := NewService(ctx)
    time.Sleep(10 * time.Millisecond)
    start := time.Now()
    cancel()
    // Wait for goroutines to exit; use s.Close() or s.Wait().
    elapsed := time.Since(start)
    if elapsed > 100*time.Millisecond {
        t.Errorf("cancellation took %v, budget 100ms", elapsed)
    }
}
```

**Checklist**:
- [ ] Test passes with a clean implementation.
- [ ] Intentionally add a 200ms sleep in the goroutine; test fails.
- [ ] Replace `time.Sleep` with `select { case <-ctx.Done(): return; case <-time.After(200*time.Millisecond): }`; test passes again.

### Task 8.1 — CPU-Bound Cancellation

Add a goroutine that does a CPU-bound loop (e.g., counting to 10^9). Ensure cancellation latency stays under 100 ms.

**Checklist**:
- [ ] Loop checks `ctx.Err()` every N iterations.
- [ ] Choose N so the check happens at least every 10 ms (typically N = 10^6 for tight loops).
- [ ] Verify with the latency test.

---

## Build a Supervisor

### Task 9 — Restart-on-Panic Supervisor

Implement a `Supervisor` type:

```go
type Supervisor struct { /* ... */ }

func NewSupervisor(parent context.Context) *Supervisor

func (s *Supervisor) Spawn(name string, fn func(context.Context) error)

func (s *Supervisor) Close()
```

**Behaviour**:
- Each `Spawn` registers a function. The supervisor runs it in a goroutine.
- If the function returns an error, the supervisor restarts it after a 1-second backoff.
- If the function returns nil, the supervisor does not restart it.
- `Close` cancels the supervisor's context and waits for all children.
- A panicking child is recovered and restarted (with a log message).

**Checklist**:
- [ ] `recover()` in each child goroutine.
- [ ] Restart uses `select` with `<-ctx.Done()` so it doesn't wait through the backoff on shutdown.
- [ ] `Close` cancels and waits.
- [ ] Test: spawn a child that panics every iteration; verify it is restarted but eventually `Close` stops it.

---

## Audit Exercise

### Task 10 — Audit a Real Repository

Choose a real Go service (your own, or one of: https://github.com/grafana/loki, https://github.com/prometheus/prometheus, https://github.com/etcd-io/etcd). The smaller the better for a first pass.

**Steps**:

1. **Catalogue**. Run `grep -rn 'go func\|go [a-zA-Z]' --include='*.go' .` and copy the output into a spreadsheet.
2. **Classify each spawn**:
   - Owner identified? (Y/N)
   - Stop signal identified? (Y/N)
   - Wait point identified? (Y/N)
3. **Score the repo**: count of `(Y, Y, Y)` divided by total spawns. A healthy repo is over 90%.
4. **Pick the worst three**. Read the code, write down what would leak under shutdown.
5. **Write a hypothetical fix** (don't submit; this is for learning).

**Checklist**:
- [ ] Spreadsheet has every spawn.
- [ ] Score is calculated.
- [ ] Three fixes are written up.
- [ ] You can articulate why the project's score is what it is (active maintenance, project age, framework usage).

### Task 10.1 — Audit Your Own Project

Repeat Task 10 for code you have written. Be honest. Be the bug.

**Checklist**:
- [ ] Score is calculated.
- [ ] Lowest-scoring file is identified.
- [ ] Action plan: convert to Start/Stop pattern, add goleak, submit PR.

---

## Self-Check Solutions

### Solution sketches

**Task 1.1**: `make(chan string, len(urls))`.

**Task 1.2**:
```go
func worker(ctx context.Context, in <-chan Job) {
    go func() {
        for {
            select {
            case <-ctx.Done():
                return
            case j, ok := <-in:
                if !ok {
                    return
                }
                process(j)
            }
        }
    }()
}
```

**Task 1.3**: Remove `default`. Add `<-ctx.Done()`.

**Task 1.4**:
```go
func enqueue(j Job, dispatch chan<- Job) {
    mu.Lock()
    pending = append(pending, j)
    mu.Unlock()
    dispatch <- j
}
```

**Task 1.5**:
```go
type Heartbeat struct {
    cancel context.CancelFunc
    done   chan struct{}
}

func StartHeartbeat(parent context.Context) *Heartbeat {
    ctx, cancel := context.WithCancel(parent)
    h := &Heartbeat{cancel: cancel, done: make(chan struct{})}
    go func() {
        defer close(h.done)
        t := time.NewTicker(time.Second)
        defer t.Stop()
        for {
            select {
            case <-ctx.Done():
                return
            case <-t.C:
                ping()
            }
        }
    }()
    return h
}

func (h *Heartbeat) Close() {
    h.cancel()
    <-h.done
}
```

**Task 2 sketch**:
```go
type LoopRunner struct {
    cancel    context.CancelFunc
    done      chan struct{}
    closeOnce sync.Once
}

func NewLoopRunner(parent context.Context, interval time.Duration, fn func(context.Context)) *LoopRunner {
    ctx, cancel := context.WithCancel(parent)
    l := &LoopRunner{cancel: cancel, done: make(chan struct{})}
    go func() {
        defer close(l.done)
        t := time.NewTicker(interval)
        defer t.Stop()
        for {
            select {
            case <-ctx.Done():
                return
            case <-t.C:
                fn(ctx)
            }
        }
    }()
    return l
}

func (l *LoopRunner) Close() error {
    l.closeOnce.Do(func() {
        l.cancel()
        <-l.done
    })
    return nil
}
```

**Task 6 pool sketch**:
```go
type Pool struct {
    cancel context.CancelFunc
    wg     sync.WaitGroup
    in     chan Job
    err    error
    errMu  sync.Mutex
}

func NewPool(parent context.Context, size int, handle func(context.Context, Job) error) *Pool {
    ctx, cancel := context.WithCancel(parent)
    p := &Pool{cancel: cancel, in: make(chan Job)}
    for i := 0; i < size; i++ {
        p.wg.Add(1)
        go func() {
            defer p.wg.Done()
            for {
                select {
                case <-ctx.Done():
                    return
                case j, ok := <-p.in:
                    if !ok {
                        return
                    }
                    if err := handle(ctx, j); err != nil {
                        p.recordErr(err)
                    }
                }
            }
        }()
    }
    return p
}

func (p *Pool) Submit(ctx context.Context, j Job) error {
    select {
    case <-ctx.Done():
        return ctx.Err()
    case p.in <- j:
        return nil
    }
}

func (p *Pool) Close() error {
    p.cancel()
    p.wg.Wait()
    return p.err
}

func (p *Pool) recordErr(err error) {
    p.errMu.Lock()
    defer p.errMu.Unlock()
    if p.err == nil {
        p.err = err
    }
}
```

The tasks build on each other: warm-up patterns → owned struct → real services. By the end you have implemented every pattern at junior, middle, and senior levels and run goleak across each. The next file, [find-bug.md](find-bug.md), tests recognition rather than construction.
