---
layout: default
title: WaitGroup in Tests — Middle
parent: WaitGroup in Tests
grand_parent: Testing Concurrent Code
nav_order: 2
permalink: /roadmap/programming-languages/golang/07-concurrency/13-testing-concurrent-code/03-waitgroup-in-tests/middle/
---

# WaitGroup in Tests — Middle

[← Back to WaitGroup in Tests](./)

You know the basic `Add / Done / Wait` block. At this level we build the reusable helpers a project actually needs, fold in `goleak`, design for both fan-out and fan-in, and treat *timeouts* as a first-class concern. The single most useful thing on this page is the `WaitTimeout` helper. Almost every Go codebase that takes concurrent testing seriously has some version of it.

---

## 1. The `WaitTimeout` helper

`wg.Wait` has no built-in timeout. A goroutine that hangs hangs the test forever. In CI, the default `go test -timeout 10m` will eventually kill the binary, but ten minutes is too long for a fast feedback loop and the resulting failure points at the wrong test. Build a helper that turns "hung Wait" into a clean fatal:

```go
package testhelper

import (
    "sync"
    "testing"
    "time"
)

// WaitTimeout waits for wg.Wait to return or the duration d to elapse,
// whichever comes first. On timeout it calls t.Fatalf.
func WaitTimeout(t *testing.T, wg *sync.WaitGroup, d time.Duration) {
    t.Helper()
    done := make(chan struct{})
    go func() {
        wg.Wait()
        close(done)
    }()
    select {
    case <-done:
        // Wait returned in time.
    case <-time.After(d):
        t.Fatalf("WaitGroup did not finish within %v", d)
    }
}
```

Usage:

```go
func TestThing(t *testing.T) {
    var wg sync.WaitGroup
    wg.Add(4)
    for i := 0; i < 4; i++ {
        go func() {
            defer wg.Done()
            work()
        }()
    }
    WaitTimeout(t, &wg, 2*time.Second)
}
```

Key points:

- `t.Helper()` so failures point at the test, not the helper.
- The waiter is itself a goroutine. If `wg.Wait` never returns, that goroutine leaks. We accept the leak — the test process is about to exit on `t.Fatal` anyway.
- The duration is chosen by the test author. 2 seconds is a common default for fast tests; integration tests may want 30 seconds. Never set it to the default `go test -timeout` because then you have not improved anything.

### A leak-free variant with a stop channel

If you care about the helper leaking its own waiter goroutine (because you have multiple `WaitTimeout` calls in a long-running test), make the waiter exit on a stop signal:

```go
func WaitTimeout(t *testing.T, wg *sync.WaitGroup, d time.Duration) {
    t.Helper()
    done := make(chan struct{})
    stop := make(chan struct{})
    go func() {
        select {
        case <-stop:
        default:
            wg.Wait()
            close(done)
        }
    }()
    select {
    case <-done:
    case <-time.After(d):
        close(stop)
        t.Fatalf("WaitGroup did not finish within %v", d)
    }
}
```

This is *not* perfect — the waiter goroutine is already blocked in `wg.Wait`, and `close(stop)` cannot wake it. The only way to truly avoid a leaked waiter is to ensure the workers eventually finish (cancel their context, close their input channel). In practice, the first version is what you want for tests, paired with proper teardown.

---

## 2. Channels and `select` as an alternative barrier

When the goroutine produces a single value, a channel is often clearer than a WaitGroup.

```go
func TestSingleResult(t *testing.T) {
    done := make(chan int, 1)
    go func() {
        done <- compute()
    }()
    select {
    case v := <-done:
        if v != want {
            t.Errorf("compute() = %d, want %d", v, want)
        }
    case <-time.After(2 * time.Second):
        t.Fatal("compute did not finish within 2s")
    }
}
```

Use the channel form when:

- There is exactly one result.
- You want the value, not just the finish event.
- You need to combine the wait with a `case <-ctx.Done()` for cancellation.

Use the WaitGroup form when:

- N goroutines run in parallel and you wait for all.
- You don't need to carry data back through the barrier.

Both compose. A test can have a WaitGroup for the fan-out and a `done` channel for "the system reached a state."

### The `<-done` idiom

A subtle pattern: send a single zero-value struct to signal "I am done."

```go
done := make(chan struct{})
go func() {
    work()
    close(done)
}()
select {
case <-done:
case <-time.After(2 * time.Second):
    t.Fatal("timeout")
}
```

`close(done)` is preferred over `done <- struct{}{}` because:

- A closed channel can be read by many goroutines (the close is the broadcast).
- It cannot accidentally block if the receiver is gone.

---

## 3. Fan-out test pattern

The fan-out test pattern is so common it deserves a name. Pre-allocate a result slice, spawn N goroutines, write to disjoint indices, wait, assert.

```go
func TestFanOut(t *testing.T) {
    in := make([]int, 1000)
    for i := range in {
        in[i] = i
    }
    out := make([]int, len(in))

    var wg sync.WaitGroup
    wg.Add(len(in))
    for i, x := range in {
        i, x := i, x
        go func() {
            defer wg.Done()
            out[i] = work(x)
        }()
    }
    WaitTimeout(t, &wg, 5*time.Second)

    for i, got := range out {
        if want := expect(in[i]); got != want {
            t.Errorf("out[%d] = %d, want %d", i, got, want)
        }
    }
}
```

Why it works:

- Each goroutine writes to a unique index. No lock needed.
- `wg.Wait` (via `WaitTimeout`) is the only barrier.
- After `Wait`, the test reads the full slice race-free.

The race detector should run clean on this test. If it doesn't, you have a real bug.

### Fan-out with errors

Use `errgroup.Group` from `golang.org/x/sync/errgroup`:

```go
import "golang.org/x/sync/errgroup"

func TestFanOutErrors(t *testing.T) {
    var g errgroup.Group
    out := make([]int, len(in))
    for i, x := range in {
        i, x := i, x
        g.Go(func() error {
            v, err := work(x)
            if err != nil {
                return fmt.Errorf("work(%d): %w", x, err)
            }
            out[i] = v
            return nil
        })
    }
    if err := g.Wait(); err != nil {
        t.Fatal(err)
    }
    // out is fully populated; assert.
}
```

`errgroup.Group` is a WaitGroup with first-error capture and (optionally) a derived context for cancellation. For tests that must succeed across all workers, it is the cleanest barrier.

`errgroup` has no built-in timeout. Wrap it:

```go
g, ctx := errgroup.WithContext(timeoutCtx)
```

where `timeoutCtx` has a `WithTimeout`.

---

## 4. `goleak` integration

`go.uber.org/goleak` fails a test if any goroutine other than the test runner is still alive at teardown. It is the single best tool for catching leaks in production-shaped code.

### Per-test verification

```go
import "go.uber.org/goleak"

func TestNoLeak(t *testing.T) {
    defer goleak.VerifyNone(t)

    work := New()
    work.Start()
    work.Stop()
}
```

If `Stop` does not actually stop the goroutine, the deferred `VerifyNone` prints a stack trace of the leaked goroutine and calls `t.Errorf`.

### Package-wide verification

```go
func TestMain(m *testing.M) {
    goleak.VerifyTestMain(m)
}
```

Runs after every test in the package. Cheaper than per-test. The trade-off: if one test leaks, the failure attribution is fuzzy (the package fails, not the offending test). For finding the bug, fall back to per-test verification.

### Ignoring known-good goroutines

The Go runtime has background goroutines (the garbage collector, scavenger, signal handlers) that always run. `goleak` whitelists them automatically. Your own background goroutines need explicit whitelisting:

```go
goleak.VerifyNone(t,
    goleak.IgnoreTopFunction("github.com/myorg/myproject/metrics.flush"),
)
```

Prefer fixing the leak. Whitelisting is for goroutines that genuinely outlive the test (a singleton metrics flusher, for example) and that you do not want to start/stop per test.

### Combining `goleak` with `t.Cleanup`

```go
func TestServer(t *testing.T) {
    t.Cleanup(func() { goleak.VerifyNone(t) })  // registered first → runs last

    ctx, cancel := context.WithCancel(context.Background())
    var wg sync.WaitGroup
    wg.Add(1)
    go func() { defer wg.Done(); s.Serve(ctx) }()
    t.Cleanup(func() { cancel(); wg.Wait() })
}
```

Order at teardown (LIFO): cancel-and-wait runs first, leaving no live goroutines. Then `goleak.VerifyNone` confirms the package is clean.

If you use `defer goleak.VerifyNone(t)` instead, it runs *before* the cleanups (defers run before cleanups; see junior file's "Tricky Points"). With proper cancel-on-context goroutines, you almost always want `goleak` as a Cleanup, not as a defer.

---

## 5. `t.Cleanup` for graceful teardown

The standard pattern for any test that launches a goroutine that lives longer than the assertion:

```go
ctx, cancel := context.WithCancel(context.Background())

var wg sync.WaitGroup
wg.Add(1)
go func() {
    defer wg.Done()
    s.Run(ctx)
}()

t.Cleanup(func() {
    cancel()
    wg.Wait()
})
```

Three rules:

1. `cancel` before `wg.Wait`. Otherwise `Wait` blocks forever.
2. Use *one* `t.Cleanup` that does both, so the order is unambiguous.
3. Don't combine with `defer wg.Wait()` in the test body — the cleanup is enough.

### `t.Cleanup` and subtests

Each `t.Run` subtest has its own `*testing.T`. Cleanups registered on a subtest run when the subtest ends, *before* the parent's cleanups. This is exactly what you want for nested resources.

```go
func TestParent(t *testing.T) {
    server := startServer(t)               // registers t.Cleanup(server.Close)

    t.Run("sub", func(t *testing.T) {
        client := startClient(t, server)   // registers t.Cleanup(client.Close)
        // ...
    })
    // Subtest cleanups (client.Close) run when the subtest ends.
    // Then the parent body finishes, parent cleanups (server.Close) run.
}
```

Compose this with WaitGroup teardown by giving each layer its own `wg`.

---

## 6. The `t.Sleep` antipattern — what to replace it with

Every `time.Sleep` in a test is one of:

| Sleep purpose | Replace with |
|---|---|
| "Wait for goroutine to start" | A start barrier or polling readiness check |
| "Wait for goroutine to finish" | `wg.Wait` (or `WaitTimeout`) |
| "Wait for time-based behaviour" | A fake clock (see `04-mocking-time`) |
| "Wait for external service" | A polling deadline with a hard cap |
| "Yield to other goroutines" | `runtime.Gosched()` — and even this is usually a smell |

The polling-deadline form:

```go
func waitUntil(t *testing.T, cond func() bool, d time.Duration) {
    t.Helper()
    deadline := time.Now().Add(d)
    for time.Now().Before(deadline) {
        if cond() {
            return
        }
        time.Sleep(5 * time.Millisecond)
    }
    t.Fatalf("condition not true within %v", d)
}
```

Use only when you cannot avoid a real-time wait. The internal `time.Sleep(5ms)` is acceptable because it bounds the loop, not the test outcome.

---

## 7. Combining WaitGroup with `context`

For goroutines that should stop when the test is over:

```go
ctx, cancel := context.WithCancel(context.Background())
var wg sync.WaitGroup
wg.Add(1)
go func() {
    defer wg.Done()
    for {
        select {
        case <-ctx.Done():
            return
        case ev := <-events:
            handle(ev)
        }
    }
}()
t.Cleanup(func() { cancel(); wg.Wait() })
```

Pattern notes:

- The goroutine selects on `ctx.Done()` so it can exit on cancel.
- The `defer wg.Done()` runs no matter how the goroutine exits.
- The cleanup cancels first, then waits.

If the goroutine is doing blocking I/O without a context-aware API, you have a problem: cancel will not interrupt it. Standard fixes: pass the context to the I/O (`http.NewRequestWithContext`), set a timeout on the underlying connection, or wrap the call in a goroutine that watches `ctx.Done` and forcibly closes a resource.

---

## 8. The "spawn-and-wait" helper

A higher-order helper for tests that spawn N goroutines and wait for all:

```go
func SpawnAndWait(t *testing.T, n int, body func(i int)) {
    t.Helper()
    var wg sync.WaitGroup
    wg.Add(n)
    for i := 0; i < n; i++ {
        i := i
        go func() {
            defer wg.Done()
            body(i)
        }()
    }
    WaitTimeout(t, &wg, 5*time.Second)
}
```

Usage:

```go
func TestCounter(t *testing.T) {
    c := NewCounter()
    SpawnAndWait(t, 1000, func(i int) {
        c.Inc()
    })
    if c.Get() != 1000 {
        t.Errorf("Get = %d, want 1000", c.Get())
    }
}
```

The helper hides the boilerplate. It is one line in the test and 8 lines in the helper file. Reuse it across all stress tests.

---

## 9. Combining multiple barriers

Tests sometimes need two events: "all workers finished" and "the server has reached steady state." Use both a WaitGroup and a `done` channel.

```go
ready := make(chan struct{})
var wg sync.WaitGroup
wg.Add(1)
go func() {
    defer wg.Done()
    setup()
    close(ready)       // signal: setup done
    workForever(ctx)   // continue until ctx cancelled
}()

<-ready                // wait for setup
// ... run test against the running goroutine ...
cancel()
WaitTimeout(t, &wg, 2*time.Second)
```

Two barriers, two purposes:

- `<-ready` waits for "started."
- `wg.Wait` waits for "stopped."

---

## 10. `testify` and `quicktest` helpers

External libraries have built-in wait helpers. The most common:

### `github.com/stretchr/testify`

`testify` does not have a direct `WaitTimeout` but its `assert` and `require` packages combine with channels naturally. The relevant idiom uses `assert.Eventually`:

```go
import "github.com/stretchr/testify/assert"

assert.Eventually(t, func() bool {
    return counter.Get() == 100
}, 2*time.Second, 10*time.Millisecond, "counter should reach 100")
```

`Eventually(t, cond, waitFor, tick, args...)` polls `cond` every `tick` until it returns true or `waitFor` elapses. On timeout it fails with the message. This is the polling-deadline pattern wrapped in a clean API.

There is also `assert.Never` (the inverse — fail if a condition is ever true within `waitFor`).

### `github.com/frankban/quicktest`

`quicktest` provides `c.Check(value, qt.Eventually(checker, timeout))` style. Less common in idiomatic Go projects, but used in some BoltDB-derived codebases.

### Building a wait helper as a `testify` extension

```go
package waitutil

func WaitGroup(t *testing.T, wg *sync.WaitGroup, d time.Duration) {
    t.Helper()
    done := make(chan struct{})
    go func() { wg.Wait(); close(done) }()
    select {
    case <-done:
    case <-time.After(d):
        t.Fatalf("WaitGroup did not finish within %v", d)
    }
}
```

Same as before. Put it in a `testutil` package and import everywhere.

---

## 11. Avoiding the common WaitGroup bugs

### Bug 1: missing `Add`

```go
go func() {
    defer wg.Done()
    work()
}()
wg.Wait()
```

No `Add(1)`. `Wait` returns immediately. `Done` later panics with "negative WaitGroup counter."

Fix: `wg.Add(1)` before `go`.

### Bug 2: `Wait` before `Add`

Already covered in junior. The cure: always call `Add` in the test goroutine, before the `go`.

### Bug 3: double `Done`

```go
defer wg.Done()
if err != nil {
    wg.Done()    // extra Done
    return
}
```

Two `Done`s for one `Add` → counter goes negative → panic.

Fix: pick one. Almost always `defer`.

### Bug 4: `Add` after `Wait`

A subtler version: the WaitGroup is shared across waves of work.

```go
wg.Add(N)
// spawn N goroutines
wg.Wait()
// some code, then:
wg.Add(M)   // OK only if happens-before holds
// spawn M goroutines
wg.Wait()
```

Fine in a test where everything is sequential in the test goroutine. The happens-before edge is the test goroutine's own program order. *Not* fine if any goroutine from the first wave outlives `wg.Wait` and races with `wg.Add(M)`. In tests, this rarely happens — but if it does, use a fresh WaitGroup.

### Bug 5: forgetting `t.Helper()` in the wait wrapper

The failure message points at the helper line, not the calling test. The fix is one line:

```go
func WaitTimeout(t *testing.T, wg *sync.WaitGroup, d time.Duration) {
    t.Helper()
    // ...
}
```

---

## 12. Putting it all together: a full test template

```go
package thingtest

import (
    "context"
    "sync"
    "testing"
    "time"

    "go.uber.org/goleak"
)

func TestThing(t *testing.T) {
    t.Cleanup(func() { goleak.VerifyNone(t) })

    ctx, cancel := context.WithCancel(context.Background())
    var wg sync.WaitGroup

    thing := New()
    wg.Add(1)
    go func() {
        defer wg.Done()
        thing.Run(ctx)
    }()
    t.Cleanup(func() {
        cancel()
        WaitTimeout(t, &wg, 2*time.Second)
    })

    // give it work
    for _, in := range inputs {
        thing.Submit(in)
    }

    // poll for completion
    deadline := time.Now().Add(2 * time.Second)
    for time.Now().Before(deadline) {
        if thing.Processed() == len(inputs) {
            break
        }
        time.Sleep(5 * time.Millisecond)
    }

    if got := thing.Processed(); got != len(inputs) {
        t.Errorf("Processed = %d, want %d", got, len(inputs))
    }
}

func WaitTimeout(t *testing.T, wg *sync.WaitGroup, d time.Duration) {
    t.Helper()
    done := make(chan struct{})
    go func() { wg.Wait(); close(done) }()
    select {
    case <-done:
    case <-time.After(d):
        t.Fatalf("WaitGroup did not finish within %v", d)
    }
}
```

Three barriers in one test:

- `goleak.VerifyNone` as the final guard.
- `WaitTimeout` for the worker goroutine.
- Polling deadline for "processed all inputs."

No `time.Sleep` as a barrier. Every wait has a maximum bound and a clear failure message.

---

## 13. When *not* to use WaitGroup

- **One goroutine, one result.** Use a channel.
- **Streaming results.** Use a channel; close it when done.
- **Cancellation-driven shutdown.** Use a context + WaitGroup combination, where the WaitGroup waits for the cancelled goroutines to exit.
- **Fan-in to a single consumer.** A WaitGroup + close pattern: each producer signals Done; the test waits, then reads the collected results.

---

## 14. Quick reference

```go
// 1. Plain barrier
var wg sync.WaitGroup
wg.Add(N); spawn(N); WaitTimeout(t, &wg, 2*time.Second)

// 2. Long-running worker
ctx, cancel := context.WithCancel(context.Background())
var wg sync.WaitGroup
wg.Add(1); go func() { defer wg.Done(); s.Run(ctx) }()
t.Cleanup(func() { cancel(); WaitTimeout(t, &wg, 2*time.Second) })

// 3. Leak detection
t.Cleanup(func() { goleak.VerifyNone(t) })

// 4. Polling readiness
waitUntil(t, func() bool { return ready }, 2*time.Second)

// 5. First-error fan-out
var g errgroup.Group
for _, x := range xs { x := x; g.Go(func() error { return f(x) }) }
if err := g.Wait(); err != nil { t.Fatal(err) }
```

---

## Summary

`sync.WaitGroup` is the standard barrier, but tests need three additions to make it production-ready: a `WaitTimeout` helper so hung tests fail cleanly, integration with `goleak` so stray goroutines are caught, and a `t.Cleanup(func() { cancel(); wg.Wait() })` idiom for long-running workers. Errors propagate cleanest through `errgroup.Group`. Polling deadlines, not `time.Sleep`, fill the few gaps where a barrier is not available. Build these into a `testutil` package and reach for them in every concurrent test in your codebase.
