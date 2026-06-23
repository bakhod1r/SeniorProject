---
layout: default
title: Tasks
parent: Cooperative vs Forced
grand_parent: Cancellation Deep
ancestor: Go
nav_order: 8
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/20-cancellation-deep/01-cooperative-vs-force/tasks/
---

# Cooperative vs Forced Cancellation — Hands-on Tasks

> Exercises from easy to hard. Each task states what to build, the success criterion, and a hint. Solution sketches are at the end.

---

## Easy

### Task 1 — Cancellable counter

Write a function that takes a `context.Context` and counts from 0 to infinity, printing each number. It must return when the context is cancelled.

- Use `select` with `<-ctx.Done()` and a `default` branch.
- Caller code: `ctx, cancel := context.WithTimeout(context.Background(), 200*time.Millisecond); defer cancel(); count(ctx)`.

**Goal.** Master the `select`/`default` polling pattern.

---

### Task 2 — Cancellable sleep

Write `sleepCtx(ctx context.Context, d time.Duration) error` that sleeps for `d` but returns early on context cancellation with `ctx.Err()`.

- Use `time.NewTimer` plus `select`.
- Test: cancellation after 50 ms when sleep is 1 s should return within ~50 ms.

**Goal.** Learn the standard cancellable-blocking idiom.

---

### Task 3 — Worker that drains a channel

Spawn a worker that reads from a `chan int`, prints each value, and exits cleanly when either the channel is closed or the context is cancelled.

- The `select` should have three branches: `<-ctx.Done()`, `v, ok := <-ch`, and that's it (no default).
- Test cancel mid-stream and verify the worker exits.

**Goal.** Distinguish cancellation from end-of-stream.

---

### Task 4 — Always defer cancel

Find a function that creates `context.WithTimeout` and forgets `defer cancel()`. Run `go vet` and observe the `lostcancel` warning. Fix it.

**Goal.** Make `go vet` part of your CI.

---

### Task 5 — Forced exit

Write a program that spawns a goroutine running an infinite `for` loop with no cancellation check. Demonstrate that the only way to stop it is `os.Exit(0)` from `main`. Compare to a version where the loop checks `ctx.Done()`.

**Goal.** Internalise the difference between cooperative and forced.

---

## Medium

### Task 6 — Cancellable file read

Write a function that copies an `io.Reader` to an `io.Writer` in 4 KB chunks, observing a context between chunks.

- Signature: `func CopyCtx(ctx context.Context, dst io.Writer, src io.Reader) (int64, error)`.
- Test cancellation during a long copy.

**Goal.** Apply cancellation polling between I/O units.

---

### Task 7 — Cancellable HTTP fetch

Write a CLI tool that fetches a URL with a 5-second timeout. On `Ctrl-C`, cancel the in-flight request.

- Use `signal.NotifyContext` for SIGINT/SIGTERM.
- Use `http.NewRequestWithContext`.
- Print the elapsed time and the error.

**Goal.** Integrate signal handling with HTTP cancellation.

---

### Task 8 — Worker pool with grace shutdown

Build a worker pool with `Submit(job)` and `Shutdown(ctx)`. `Shutdown` should:

1. Stop accepting new jobs.
2. Wait for in-flight jobs to finish within the grace context.
3. Return `nil` on success, `ctx.Err()` if grace expired.

Submit 100 jobs that each take 100 ms; call `Shutdown` with a 1-second grace; verify all jobs complete.

**Goal.** Implement the graceful-shutdown pattern.

---

### Task 9 — Cancellable mutex

Implement a `CtxMutex` whose `Lock(ctx)` respects cancellation. Compare to `sync.Mutex.Lock()` in a microbenchmark.

- Use `chan struct{}` of capacity 1.
- Benchmark with no contention (`Lock`/`Unlock` loop) and with contention.

**Goal.** Understand the cost of cancellability.

---

### Task 10 — Cancellable database query

Wrap `db.QueryContext` with timeout from a flag. Run a slow query (`SELECT pg_sleep(10)`). Set the flag to 1 second. Verify the query is cancelled server-side.

- Inspect `pg_stat_activity` to confirm the server cancelled.

**Goal.** Observe end-to-end context propagation.

---

## Hard

### Task 11 — Cancellable subprocess

Write a function that runs `ffmpeg` to transcode a video, with a context. On cancellation:

1. First send SIGTERM to give ffmpeg a chance to clean up.
2. After 5 seconds, send SIGKILL.

Use `exec.CommandContext` plus custom `Cancel` and `WaitDelay` (Go 1.20+).

**Goal.** Practice gradual escalation from cooperative to force.

---

### Task 12 — Merge two contexts

Implement `mergeCtx(a, b context.Context) (context.Context, context.CancelFunc)` that cancels when *either* parent cancels.

- Test: cancel `a` only; cancel `b` only; cancel both; cancel the returned context manually.
- Verify no goroutine leaks (use `goleak`).

**Goal.** Practice context tree composition.

---

### Task 13 — Race two cancellations

Implement `RaceCtx[T any](a, b context.Context, work func(context.Context) (T, error)) (T, error)` that runs `work` with a merged context and returns the result, observing whichever parent cancels first.

- Use a `select` over the contexts and a result channel.
- Test the three race outcomes.

**Goal.** Combine cancellation with result collection.

---

### Task 14 — CGO with cancellation flag

Write a small C function `long_work(int n)` that loops `n` times. Add an `atomic_int cancel_flag` and a polling check inside the loop. Expose a Go wrapper that observes context cancellation and sets the flag.

- Build with `cgo`.
- Test: cancel after 100 ms when `n = 10_000_000`. Verify `long_work` returns within a small margin.

**Goal.** Build cooperative cancellation across the cgo boundary.

---

### Task 15 — Locked OS thread + signal

Pin a goroutine to an OS thread with `runtime.LockOSThread`. From another goroutine, send `SIGUSR1` to the pinned thread via `syscall.Tgkill`. Install a signal handler that flips a flag the pinned goroutine reads.

- Linux only.
- Demonstrate that the pinned goroutine receives the signal.

**Goal.** See targeted signal delivery in action.

---

### Task 16 — Graceful HTTP shutdown with bounded backlog

Build an HTTP server that handles requests taking up to 2 seconds. On SIGTERM:

1. Stop accepting new requests.
2. Continue serving in-flight for up to 5 seconds.
3. Force close if the budget expires.

Use `http.Server.Shutdown` plus a watchdog goroutine that calls `srv.Close()` on grace exceeded.

**Goal.** Production-shape shutdown.

---

### Task 17 — Pipeline with cancellation

Build a three-stage pipeline (read, transform, write) connected by channels. Each stage observes a shared context. On cancellation, every stage exits cleanly and the output channel closes.

- Use `errgroup` to manage lifetimes.
- Add a metric counting items processed vs items dropped.

**Goal.** Apply cancellation to streaming systems.

---

### Task 18 — Cancel cause threading

Build a service where every request gets a `context.WithCancelCause`. On various failure modes (downstream error, rate limit, user cancel), call `cancel(specificError)`. In logs, surface the cause for cancelled operations.

- Test: trigger each cancellation reason; verify the log contains the right cause.

**Goal.** Use `WithCancelCause` for richer diagnostics.

---

## Solutions / Sketches

### Solution 1

```go
func count(ctx context.Context) {
    for i := 0; ; i++ {
        select {
        case <-ctx.Done():
            return
        default:
        }
        fmt.Println(i)
    }
}
```

### Solution 2

```go
func sleepCtx(ctx context.Context, d time.Duration) error {
    t := time.NewTimer(d)
    defer t.Stop()
    select {
    case <-t.C:
        return nil
    case <-ctx.Done():
        return ctx.Err()
    }
}
```

### Solution 6

```go
func CopyCtx(ctx context.Context, dst io.Writer, src io.Reader) (int64, error) {
    buf := make([]byte, 4096)
    var total int64
    for {
        select {
        case <-ctx.Done():
            return total, ctx.Err()
        default:
        }
        n, err := src.Read(buf)
        if n > 0 {
            if _, werr := dst.Write(buf[:n]); werr != nil {
                return total, werr
            }
            total += int64(n)
        }
        if err == io.EOF {
            return total, nil
        }
        if err != nil {
            return total, err
        }
    }
}
```

### Solution 8

```go
type Pool struct {
    jobs   chan Job
    wg     sync.WaitGroup
    ctx    context.Context
    cancel context.CancelFunc
}

func NewPool(parent context.Context, n int) *Pool {
    ctx, cancel := context.WithCancel(parent)
    p := &Pool{jobs: make(chan Job), ctx: ctx, cancel: cancel}
    for i := 0; i < n; i++ {
        p.wg.Add(1)
        go p.worker()
    }
    return p
}

func (p *Pool) worker() {
    defer p.wg.Done()
    for j := range p.jobs {
        if p.ctx.Err() != nil {
            return
        }
        j.Run(p.ctx)
    }
}

func (p *Pool) Submit(j Job) { p.jobs <- j }

func (p *Pool) Shutdown(graceCtx context.Context) error {
    close(p.jobs)
    done := make(chan struct{})
    go func() { p.wg.Wait(); close(done) }()
    select {
    case <-done:
        return nil
    case <-graceCtx.Done():
        p.cancel()
        return graceCtx.Err()
    }
}
```

### Solution 12

```go
func mergeCtx(a, b context.Context) (context.Context, context.CancelFunc) {
    ctx, cancel := context.WithCancel(a)
    stop := make(chan struct{})
    go func() {
        select {
        case <-a.Done():
        case <-b.Done():
            cancel()
        case <-stop:
        }
    }()
    return ctx, func() {
        close(stop)
        cancel()
    }
}
```

### Solution 14 (cgo sketch)

```go
/*
#include <stdatomic.h>
static atomic_int cancel_flag = 0;
void set_cancel(int v) { atomic_store(&cancel_flag, v); }
int long_work(int n) {
    for (int i = 0; i < n; i++) {
        if (atomic_load(&cancel_flag)) return -1;
    }
    return 0;
}
*/
import "C"

func LongWorkCtx(ctx context.Context, n int) error {
    stop := make(chan struct{})
    go func() {
        select {
        case <-ctx.Done():
            C.set_cancel(1)
        case <-stop:
        }
    }()
    defer close(stop)
    defer C.set_cancel(0)
    if C.long_work(C.int(n)) != 0 {
        return ctx.Err()
    }
    return nil
}
```

Run each solution under `go.uber.org/goleak` in the test to verify no goroutine leaks.
