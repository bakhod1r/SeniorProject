# Goroutine Lifecycle — Tasks

## Table of Contents
1. [Setup](#setup)
2. [Task 1: Observe `NumGoroutine` Over a Lifecycle](#task-1-observe-numgoroutine-over-a-lifecycle)
3. [Task 2: Force Each Runtime State](#task-2-force-each-runtime-state)
4. [Task 3: Lifecycle Test with Baseline](#task-3-lifecycle-test-with-baseline)
5. [Task 4: Implement `runtime.Goexit` Semantics by Hand](#task-4-implement-runtimegoexit-semantics-by-hand)
6. [Task 5: Capture a Goroutine's "Creator Stack"](#task-5-capture-a-goroutines-creator-stack)
7. [Task 6: Build a Tiny Supervisor](#task-6-build-a-tiny-supervisor)
8. [Task 7: Graceful Shutdown Daemon](#task-7-graceful-shutdown-daemon)
9. [Task 8: `LockOSThread` Lifecycle](#task-8-lockosthread-lifecycle)
10. [Task 9: Lifecycle Visualization with `runtime/trace`](#task-9-lifecycle-visualization-with-runtimetrace)
11. [Task 10: Finalizer Goroutine Lifecycle](#task-10-finalizer-goroutine-lifecycle)
12. [Task 11: `goleak` Integration](#task-11-goleak-integration)
13. [Task 12: Lifecycle of a Web Server](#task-12-lifecycle-of-a-web-server)
14. [Stretch Tasks](#stretch-tasks)

---

## Setup

Use Go 1.22 or later. Create a workspace:

```
mkdir lifecycle-tasks && cd lifecycle-tasks
go mod init lifecycle-tasks
```

Tasks are independent. Each can live in its own subdirectory:

```
lifecycle-tasks/
  task1/main.go
  task2/main.go
  ...
```

---

## Task 1: Observe `NumGoroutine` Over a Lifecycle

**Goal.** Watch the live goroutine count change as goroutines are born, blocked, woken, and die.

### Spec

Write a program that:

1. Prints `runtime.NumGoroutine()` every 100 ms in a background goroutine.
2. Spawns 10 workers that sleep for 1 second each.
3. After 2 seconds, exits.

Expected behavior: count rises to 11, holds during the sleep, drops back to ~2 (main + monitor), then exits.

### Starter

```go
package main

import (
    "fmt"
    "runtime"
    "sync"
    "time"
)

func monitor(done <-chan struct{}) {
    tick := time.NewTicker(100 * time.Millisecond)
    defer tick.Stop()
    for {
        select {
        case <-done:
            return
        case <-tick.C:
            fmt.Printf("goroutines: %d\n", runtime.NumGoroutine())
        }
    }
}

func main() {
    done := make(chan struct{})
    go monitor(done)

    var wg sync.WaitGroup
    for i := 0; i < 10; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            time.Sleep(time.Second)
        }()
    }
    wg.Wait()
    time.Sleep(500 * time.Millisecond) // let monitor record the drop
    close(done)
}
```

### Variations

- Change worker count and observe.
- Spawn workers that block forever (leak) and watch count rise without falling.

---

## Task 2: Force Each Runtime State

**Goal.** Write goroutines that, at a given moment, are in each of the major runtime states. Inspect them with `runtime.Stack(buf, true)`.

### Spec

Spawn:

- One goroutine that loops without function calls (forces `_Grunning`).
- One that calls `time.Sleep(time.Hour)` (forces `_Gwaiting` with reason "sleep").
- One that blocks on an empty channel receive (`_Gwaiting`, "chan receive").
- One that sends on an unbuffered channel with no reader (`_Gwaiting`, "chan send").
- One that locks a mutex held by another goroutine (`_Gwaiting`, "sync.Mutex.Lock").

After a brief `time.Sleep`, dump all goroutine stacks. Identify each waiting reason in the output.

### Starter

```go
package main

import (
    "fmt"
    "runtime"
    "sync"
    "time"
)

func main() {
    // _Grunning — a busy loop
    go func() {
        for i := 0; ; i++ {
            _ = i
        }
    }()

    // _Gwaiting, sleep
    go func() {
        time.Sleep(time.Hour)
    }()

    // _Gwaiting, chan receive
    ch1 := make(chan int)
    go func() {
        <-ch1
    }()

    // _Gwaiting, chan send
    ch2 := make(chan int)
    go func() {
        ch2 <- 1
    }()

    // _Gwaiting, sync.Mutex.Lock
    var mu sync.Mutex
    mu.Lock()
    go func() {
        mu.Lock()
        mu.Unlock()
    }()

    time.Sleep(100 * time.Millisecond) // let them settle

    buf := make([]byte, 1<<20)
    n := runtime.Stack(buf, true)
    fmt.Println(string(buf[:n]))
}
```

Read the output. Each goroutine has a `[chan receive]`, `[chan send]`, `[sleep]`, or `[semacquire]` tag — those are the `waitreason` enum values.

---

## Task 3: Lifecycle Test with Baseline

**Goal.** Write a `Test*` function that asserts no goroutines are leaked by a function under test.

### Spec

Write `runWork()` that spawns 5 goroutines and waits for them. Write `TestNoLeak` that captures `runtime.NumGoroutine()` before, runs `runWork()`, waits 50 ms, and asserts the count is back to baseline.

### Starter

```go
package work_test

import (
    "runtime"
    "sync"
    "testing"
    "time"
)

func runWork() {
    var wg sync.WaitGroup
    for i := 0; i < 5; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            time.Sleep(time.Millisecond)
        }()
    }
    wg.Wait()
}

func TestNoLeak(t *testing.T) {
    before := runtime.NumGoroutine()
    runWork()
    time.Sleep(50 * time.Millisecond)
    after := runtime.NumGoroutine()
    if after > before {
        t.Fatalf("leak: before=%d after=%d", before, after)
    }
}
```

### Variation

Intentionally leak a goroutine inside `runWork`. Watch the test fail. Then fix it.

---

## Task 4: Implement `runtime.Goexit` Semantics by Hand

**Goal.** Show that `runtime.Goexit` runs deferred functions while exiting a goroutine from arbitrary depth.

### Spec

Write a function `level1` that calls `level2` that calls `level3`. `level3` calls `runtime.Goexit`. Each level has a `defer` that prints its level. Verify all three defers run.

### Starter

```go
package main

import (
    "fmt"
    "runtime"
    "sync"
)

func level1(wg *sync.WaitGroup) {
    defer wg.Done()
    defer fmt.Println("level1 defer")
    level2()
    fmt.Println("level1 after — never printed")
}

func level2() {
    defer fmt.Println("level2 defer")
    level3()
    fmt.Println("level2 after — never printed")
}

func level3() {
    defer fmt.Println("level3 defer")
    runtime.Goexit()
}

func main() {
    var wg sync.WaitGroup
    wg.Add(1)
    go level1(&wg)
    wg.Wait()
}
```

Expected output (in this order):

```
level3 defer
level2 defer
level1 defer
```

### Variation

Replace `runtime.Goexit` with `panic("x")` plus a recover at level1. Compare the output. Notice: with `Goexit`, `wg.Done()` runs cleanly; with panic, the recover at level1 must be in a separate defer (otherwise the recover does not catch anything).

---

## Task 5: Capture a Goroutine's "Creator Stack"

**Goal.** Use `pprof goroutine?debug=2` to see the "created by" stack frame.

### Spec

Write a program that:

1. Spawns 100 goroutines that all wait on a single channel.
2. Exposes `pprof` on `:6060`.
3. Sleeps forever.

Then:

- `curl -s http://localhost:6060/debug/pprof/goroutine?debug=2 > goroutines.txt`
- Open `goroutines.txt`. For each blocked goroutine, find the "created by main.main in goroutine 1" line. That is `gopc` data from the `g` struct.

### Starter

```go
package main

import (
    "log"
    "net/http"
    _ "net/http/pprof"
)

func waitForever(ch <-chan struct{}) {
    <-ch
}

func main() {
    go func() {
        log.Println(http.ListenAndServe("localhost:6060", nil))
    }()

    ch := make(chan struct{})
    for i := 0; i < 100; i++ {
        go waitForever(ch)
    }

    select {}
}
```

### Variation

Spawn goroutines from different functions. See how the creator stack differs and helps you pinpoint the spawn site.

---

## Task 6: Build a Tiny Supervisor

**Goal.** Build a supervisor that restarts a goroutine after panic, with backoff.

### Spec

```go
type Supervisor struct {
    ctx    context.Context
    cancel context.CancelFunc
    wg     sync.WaitGroup
}

func New(parent context.Context) *Supervisor
func (s *Supervisor) Go(name string, work func(context.Context) error)
func (s *Supervisor) Stop()
```

`Go` runs `work(ctx)` in a goroutine, recovering panics and restarting after a 1-second delay. `Stop` cancels and joins.

### Starter

```go
package supervisor

import (
    "context"
    "fmt"
    "log"
    "runtime/debug"
    "sync"
    "time"
)

type Supervisor struct {
    ctx    context.Context
    cancel context.CancelFunc
    wg     sync.WaitGroup
}

func New(parent context.Context) *Supervisor {
    ctx, cancel := context.WithCancel(parent)
    return &Supervisor{ctx: ctx, cancel: cancel}
}

func (s *Supervisor) Go(name string, work func(context.Context) error) {
    s.wg.Add(1)
    go func() {
        defer s.wg.Done()
        for s.ctx.Err() == nil {
            err := s.runOne(name, work)
            if s.ctx.Err() != nil {
                return
            }
            log.Printf("%s exited (%v); restarting in 1s", name, err)
            select {
            case <-time.After(time.Second):
            case <-s.ctx.Done():
                return
            }
        }
    }()
}

func (s *Supervisor) runOne(name string, work func(context.Context) error) (err error) {
    defer func() {
        if r := recover(); r != nil {
            err = fmt.Errorf("%s panicked: %v\n%s", name, r, debug.Stack())
        }
    }()
    return work(s.ctx)
}

func (s *Supervisor) Stop() {
    s.cancel()
    s.wg.Wait()
}
```

### Test

```go
func TestSupervisor_RestartsOnPanic(t *testing.T) {
    sup := New(context.Background())
    defer sup.Stop()

    var calls atomic.Int32
    sup.Go("flaky", func(ctx context.Context) error {
        calls.Add(1)
        if calls.Load() < 3 {
            panic("simulated")
        }
        <-ctx.Done()
        return nil
    })

    deadline := time.Now().Add(5 * time.Second)
    for calls.Load() < 3 && time.Now().Before(deadline) {
        time.Sleep(50 * time.Millisecond)
    }
    if calls.Load() < 3 {
        t.Fatalf("expected at least 3 calls, got %d", calls.Load())
    }
}
```

### Variation

Add exponential backoff with jitter. Add a "crash budget" that stops restarting after N crashes per minute.

---

## Task 7: Graceful Shutdown Daemon

**Goal.** Build a daemon with:

- HTTP server (`/health` endpoint).
- Background worker that prints every second.
- Shutdown on SIGINT / SIGTERM, with a 5-second hard deadline.

### Starter

```go
package main

import (
    "context"
    "fmt"
    "log"
    "net/http"
    "os/signal"
    "syscall"
    "time"
)

func main() {
    ctx, cancel := signal.NotifyContext(context.Background(),
        syscall.SIGINT, syscall.SIGTERM)
    defer cancel()

    mux := http.NewServeMux()
    mux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
        fmt.Fprintln(w, "ok")
    })

    srv := &http.Server{Addr: ":8080", Handler: mux}
    srvErr := make(chan error, 1)
    go func() {
        srvErr <- srv.ListenAndServe()
    }()

    workerDone := make(chan struct{})
    go worker(ctx, workerDone)

    select {
    case <-ctx.Done():
        log.Println("shutdown signal")
    case err := <-srvErr:
        log.Printf("server failed: %v", err)
    }

    shutCtx, shutCancel := context.WithTimeout(context.Background(), 5*time.Second)
    defer shutCancel()

    _ = srv.Shutdown(shutCtx)
    select {
    case <-workerDone:
    case <-shutCtx.Done():
        log.Println("worker did not finish within deadline")
    }
    log.Println("bye")
}

func worker(ctx context.Context, done chan<- struct{}) {
    defer close(done)
    tick := time.NewTicker(time.Second)
    defer tick.Stop()
    for {
        select {
        case <-ctx.Done():
            return
        case t := <-tick.C:
            log.Println("tick", t.Format("15:04:05"))
        }
    }
}
```

### Test

Run, then `Ctrl-C`. You should see "shutdown signal" followed by "bye" within 5 seconds.

---

## Task 8: `LockOSThread` Lifecycle

**Goal.** Observe that an OS thread is destroyed when a locked goroutine exits without `Unlock`.

### Spec

Write a program that:

1. Spawns 100 goroutines, each locks the OS thread and exits.
2. Periodically reads `/sched/threads:threads` from `runtime/metrics`.
3. Compares against a baseline (no `LockOSThread`).

### Starter

```go
package main

import (
    "fmt"
    "runtime"
    "runtime/metrics"
    "sync"
)

func threadCount() uint64 {
    samples := []metrics.Sample{{Name: "/sched/gomaxprocs:threads"}}
    metrics.Read(samples)
    return samples[0].Value.Uint64()
}

func main() {
    var wg sync.WaitGroup
    for i := 0; i < 100; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            runtime.LockOSThread()
            // intentionally no UnlockOSThread.
        }()
    }
    wg.Wait()
    fmt.Println("post-test threads:", threadCount())
}
```

Note: `runtime/metrics` does not expose total OS threads directly; the more reliable measurement is to read `/proc/self/status` (Linux) and inspect `Threads:`.

Variation: add `defer runtime.UnlockOSThread()` and compare.

---

## Task 9: Lifecycle Visualization with `runtime/trace`

**Goal.** Generate a trace and view the lifecycle of every goroutine in `go tool trace`.

### Spec

Write a program that:

1. Starts a trace.
2. Spawns 5 workers that each do CPU-bound work for ~10 ms, then sleep for 50 ms, then do CPU work again, alternating for a few cycles.
3. Stops the trace.

Open with `go tool trace`. Find the lifecycle of each worker in the goroutines view.

### Starter

```go
package main

import (
    "os"
    "runtime/trace"
    "sync"
    "time"
)

func work() {
    sum := 0
    for i := 0; i < 1_000_000; i++ {
        sum += i
    }
}

func main() {
    f, _ := os.Create("trace.out")
    defer f.Close()
    trace.Start(f)
    defer trace.Stop()

    var wg sync.WaitGroup
    for i := 0; i < 5; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            for j := 0; j < 3; j++ {
                work()
                time.Sleep(50 * time.Millisecond)
            }
        }()
    }
    wg.Wait()
}
```

Then:

```
go run main.go
go tool trace trace.out
```

Open "Goroutines" view; click into individual goroutines and see the running/waiting bars.

---

## Task 10: Finalizer Goroutine Lifecycle

**Goal.** Observe that a finalizer runs in its own goroutine.

### Spec

Define a type `T` with a finalizer that prints `runtime.NumGoroutine()`. Allocate one, drop the reference, force GC, and observe.

### Starter

```go
package main

import (
    "fmt"
    "runtime"
)

type T struct{ id int }

func (t *T) finalize() {
    fmt.Printf("finalizer for T#%d (goroutines now: %d)\n",
        t.id, runtime.NumGoroutine())
}

func main() {
    for i := 0; i < 3; i++ {
        t := &T{id: i}
        runtime.SetFinalizer(t, (*T).finalize)
        _ = t
    }

    runtime.GC() // trigger finalization
    // give finalizer goroutine time to run
    runtime.Gosched()
    select {} // wait
}
```

Notice the count jumps when the finalizer goroutine runs. Without `select {}`, the program may exit before finalizers run.

---

## Task 11: `goleak` Integration

**Goal.** Use `go.uber.org/goleak` to assert no leaks in your test suite.

### Spec

Add to `go.mod`:

```
go get go.uber.org/goleak
```

Use it in `TestMain`:

```go
package mypkg_test

import (
    "testing"
    "go.uber.org/goleak"
)

func TestMain(m *testing.M) {
    goleak.VerifyTestMain(m)
}
```

Write a passing test, then intentionally leak a goroutine; observe the failure.

```go
func TestIntentionalLeak(t *testing.T) {
    ch := make(chan int)
    go func() {
        <-ch
    }()
    // never close ch
}
```

`goleak` will report this leak when the test ends.

---

## Task 12: Lifecycle of a Web Server

**Goal.** Build a server and trace every goroutine birth/death across a request lifecycle.

### Spec

A server with one handler that:

- Spawns a goroutine that writes a log line after 100 ms.
- The goroutine is tied to the request's `context.Context` — if the client disconnects, the goroutine exits.

Measure `runtime.NumGoroutine` before, during, and after a request. Verify no leak under sustained load.

### Starter

```go
package main

import (
    "fmt"
    "log"
    "net/http"
    "runtime"
    "time"
)

func handler(w http.ResponseWriter, r *http.Request) {
    ctx := r.Context()
    go func() {
        select {
        case <-time.After(100 * time.Millisecond):
            log.Println("log entry written")
        case <-ctx.Done():
            log.Println("request canceled; aborting log")
        }
    }()
    fmt.Fprintln(w, "ok")
}

func main() {
    go func() {
        for range time.Tick(time.Second) {
            log.Printf("goroutines: %d", runtime.NumGoroutine())
        }
    }()

    http.HandleFunc("/", handler)
    log.Fatal(http.ListenAndServe(":8080", nil))
}
```

Test: `for i in $(seq 1 100); do curl -s localhost:8080/ > /dev/null & done; wait`. Watch the goroutine count rise and then fall back.

Variation: replace `ctx.Done()` with nothing. Run the load test. Watch the count rise and stay.

---

## Stretch Tasks

### S1. Build a `goroutine.Group` library

A reusable group abstraction with:

- Bounded concurrency.
- Per-goroutine timeout.
- Panic recovery with structured logging.
- Cancel-on-first-error or wait-for-all modes.

### S2. Build a `pprof` diff tool

Capture two goroutine profiles 60 seconds apart, diff them, and report the stacks whose count grew.

### S3. Reproduce all eight runtime states

Write code that, at a single moment, has one goroutine in each of `_Grunnable`, `_Grunning`, `_Gsyscall`, `_Gwaiting`, `_Gdead` (just-dead), `_Gcopystack` (force stack growth), `_Gpreempted` (long busy loop), and `_Gscan` (during a `runtime.GC()`).

Dump and label each state. Use the runtime hex constants from `runtime2.go`.

### S4. Compare GMP with Erlang/OTP processes

Write a one-page comparison: BEAM processes vs Go goroutines. Lifecycle, supervisor model, mailbox model, preemption.

### S5. Lifecycle of a goroutine that participates in GC

Trace what happens when a goroutine is `_Gwaiting` while the GC starts. Use the `_Gscan` bit. Find the relevant code paths in `runtime/mgc.go`.

---

## Submission Checklist

- [ ] All tasks compile with `go build ./...`.
- [ ] All tests pass with `go test -race ./...`.
- [ ] No leaks (verified with `goleak` or manual baseline).
- [ ] Tasks 1-3 are required; the rest are optional but recommended.
- [ ] Document any unexpected behavior you observed.

See [find-bug.md](find-bug.md) for debugging exercises and [optimize.md](optimize.md) for performance-oriented tasks.
