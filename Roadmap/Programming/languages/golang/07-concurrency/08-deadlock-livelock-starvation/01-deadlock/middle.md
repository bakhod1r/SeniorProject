# Deadlock in Go — Middle Level

## Table of Contents
1. [Introduction](#introduction)
2. [Reading a Deadlock Stack Dump End-to-End](#reading-a-deadlock-stack-dump-end-to-end)
3. [The Runtime Detector: `checkdead` Internals](#the-runtime-detector-checkdead-internals)
4. [Why `time.Sleep`, Netpoll, and Cgo Hide Deadlocks](#why-timesleep-netpoll-and-cgo-hide-deadlocks)
5. [Partial Deadlocks: When the Runtime Cannot Help](#partial-deadlocks-when-the-runtime-cannot-help)
6. [Diagnosing Partial Deadlock with `pprof goroutine`](#diagnosing-partial-deadlock-with-pprof-goroutine)
7. [`SIGQUIT` and `runtime.Stack` in Practice](#sigquit-and-runtimestack-in-practice)
8. [`goleak` Beyond Tests](#goleak-beyond-tests)
9. [`go vet` and the `lostcancel` and `copylocks` Analyzers](#go-vet-and-the-lostcancel-and-copylocks-analyzers)
10. [Channel Deadlock Recipes](#channel-deadlock-recipes)
11. [Mutex Deadlock Recipes](#mutex-deadlock-recipes)
12. [`WaitGroup` and `errgroup` Pitfalls](#waitgroup-and-errgroup-pitfalls)
13. [Context-Driven Cancellation Done Right](#context-driven-cancellation-done-right)
14. [Tests with Timeouts: Patterns That Work](#tests-with-timeouts-patterns-that-work)
15. [Self-Assessment](#self-assessment)
16. [Summary](#summary)

---

## Introduction

At junior level you learned what a deadlock is, the Coffman conditions, and the most common Go-specific shapes. At middle level the questions get more practical: given a stack dump from a hung server, can you tell within thirty seconds which mutex pair is inverted? Given a leaking test, can you tell whether it deadlocks or merely leaks? Given a context that should have cancelled a goroutine, can you tell why the goroutine kept running?

After this file you will:

- Read the runtime's `fatal error` stack dump fluently and identify the cycle.
- Explain why and when the runtime's `checkdead` fires and when it stays silent.
- Take a `pprof goroutine` profile from a running server and find the partial-deadlock cycle.
- Use `goleak` not just in `TestMain` but as a per-test guard.
- Recognise the `go vet` analyzers that catch lock-related bugs and the ones they miss.
- Apply the standard patterns for channel deadlock prevention: producer-closes, fan-in over `done`, single-direction conversions.
- Debug a mutex-inversion deadlock by reading two goroutine stacks and naming the cycle.
- Use `context.Context` correctly so that "cancelled" really cancels.

This file does not yet cover lock-order ranking, formal proofs, or runtime internals — those come at senior and professional levels.

---

## Reading a Deadlock Stack Dump End-to-End

A real example. The program below has a classic mutex inversion:

```go
package main

import "sync"

var muA, muB sync.Mutex

func ab() {
    muA.Lock()
    muB.Lock()
    muB.Unlock()
    muA.Unlock()
}

func ba() {
    muB.Lock()
    muA.Lock()
    muA.Unlock()
    muB.Unlock()
}

func main() {
    go ab()
    ba()
}
```

The exact stack dump (Go 1.21, slightly shortened):

```
fatal error: all goroutines are asleep - deadlock!

goroutine 1 [semacquire]:
sync.runtime_SemacquireMutex(0x4c1d00, 0x0, 0x1)
        /usr/local/go/src/runtime/sema.go:77 +0x25
sync.(*Mutex).lockSlow(0x4c1d00)
        /usr/local/go/src/sync/mutex.go:171 +0x213
sync.(*Mutex).Lock(...)
        /usr/local/go/src/sync/mutex.go:90
main.ba()
        /tmp/dl.go:16 +0x65
main.main()
        /tmp/dl.go:23 +0x32

goroutine 18 [semacquire]:
sync.runtime_SemacquireMutex(0x4c1d20, 0x0, 0x1)
        /usr/local/go/src/runtime/sema.go:77 +0x25
sync.(*Mutex).lockSlow(0x4c1d20)
        /usr/local/go/src/sync/mutex.go:171 +0x213
sync.(*Mutex).Lock(...)
        /usr/local/go/src/sync/mutex.go:90
main.ab()
        /tmp/dl.go:10 +0x65
created by main.main in goroutine 1
        /tmp/dl.go:22 +0x1d
```

How to read this:

1. **Header.** `fatal error: all goroutines are asleep - deadlock!` — the runtime detector fired.
2. **Goroutine number and state.** `goroutine 1 [semacquire]` — goroutine 1 is parked waiting for a semaphore. For `sync.Mutex`, this is the mutex's internal semaphore.
3. **The deepest frame is the call that parked.** `sync.runtime_SemacquireMutex(0x4c1d00, ...)`. The hex value is the **address of the mutex**. Note this address.
4. **Walk up the call stack to user code.** `main.ba()` at `dl.go:16` is the place that asked for the lock. Look at the source to confirm which lock: the line is `muA.Lock()`. So goroutine 1 holds something (muB, from the line above) and is waiting for muA.
5. **Repeat for goroutine 18.** Same shape. Mutex address `0x4c1d20` (a different mutex). User code is `main.ab()` at `dl.go:10`, which is `muB.Lock()`. So goroutine 18 holds muA and is waiting for muB.
6. **Compare addresses.** muA's address must be `0x4c1d00` (the one goroutine 1 is waiting for and goroutine 18 holds). muB's must be `0x4c1d20`. You can confirm by adding a print of `&muA` and `&muB` at startup.
7. **Conclude.** Goroutine 1 holds muB, wants muA. Goroutine 18 holds muA, wants muB. Cycle of length 2. Lock inversion.

The information is all there. Practice this on every deadlock you encounter — within ten or twenty incidents you will read these stacks faster than the runtime printed them.

---

## The Runtime Detector: `checkdead` Internals

The detector lives in `runtime/proc.go`. Stripped to essentials:

```go
func checkdead() {
    // grun is the number of runnable/running goroutines.
    grun := atomic.Load(&sched.ngsys)
    // Subtract goroutines blocked on cgo, locked threads, system ops...
    // If after all subtractions, grun == 0, panic.

    if mainStarted && atomic.Load(&runtime_godebug) ... {
        // Special handling for finalizers, GC workers.
    }

    if grun != 0 {
        return  // someone is alive, no deadlock
    }

    throw("all goroutines are asleep - deadlock!")
}
```

The function is called after every goroutine parking event (`gopark`). On a hot path. It is intentionally O(1): a single atomic load and a comparison. No graph walks, no cycle detection, no analysis.

What `checkdead` counts as "alive":

- A goroutine in state `_Grunnable` or `_Grunning`.
- A goroutine doing cgo work (`_Gsyscall` with cgo flag).
- A goroutine that is the main goroutine waiting on a finalizer (very specific case).
- A goroutine in a thread that has been locked with `runtime.LockOSThread`.
- A goroutine doing GC work.
- A goroutine doing scavenge/sweep work.

What it counts as "asleep":

- A goroutine in `_Gwaiting`, which includes channel ops, mutex acquires, condvar waits, `select` waits, and `time.Sleep`.

Wait — `time.Sleep` counts as asleep? Yes, but the detector has special handling: sleeping goroutines have a timer registered. The detector considers the *timer wheel* as a source of liveness. If any sleeping goroutine has a pending timer, the count is not zero. That is why `time.Sleep(time.Hour)` masks deadlock detection: there is a pending timer.

Similarly, the netpoller — the runtime goroutine that polls network FDs — counts as alive if any FD is registered. So a program with an open socket cannot trigger the detector even if every Go-visible goroutine is parked.

---

## Why `time.Sleep`, Netpoll, and Cgo Hide Deadlocks

Three real-world cases where the detector goes silent:

**Sleep loop.** A "watchdog" goroutine that sleeps in a loop:

```go
go func() {
    for {
        time.Sleep(time.Second)
        log.Println("still alive")
    }
}()
```

This goroutine is technically alive — the runtime sees a pending timer. If every other goroutine in the program is deadlocked, the detector will *not* fire. The deadlock is invisible.

**Open listener.** An HTTP server:

```go
http.ListenAndServe(":8080", nil)
```

`Accept` registers the listening socket with the netpoller. The netpoller goroutine is alive as long as the FD is open. So a Go HTTP server can never trigger the runtime deadlock detector, even if every handler goroutine is deadlocked.

**Cgo call.** A C library call:

```go
result := C.some_blocking_function()
```

The goroutine is in `_Gsyscall` with the cgo flag set. The runtime cannot inspect what the C code is doing. The goroutine counts as alive.

Mitigation: in development and test, do not rely on the detector for partial cases. In production, use `pprof goroutine`, `SIGQUIT` stack dumps, and external monitoring (Prometheus metric `go_goroutines` rising without bound is a strong signal of deadlock-induced leaks).

---

## Partial Deadlocks: When the Runtime Cannot Help

A partial deadlock is the production reality. Two goroutines are stuck on a mutex pair. Forty-eight other goroutines are happily serving HTTP. The runtime sees 48 alive goroutines and stays silent. The two stuck ones leak forever.

Symptoms:

- `runtime.NumGoroutine()` slowly rises.
- A specific endpoint times out, others work.
- File descriptors leak (each stuck request keeps its connection open).
- `pprof goroutine` shows the same two stacks again and again, count climbing over time.

To detect:

1. Watch `go_goroutines` over time. A flat line under load is healthy. A monotonic climb is a leak — possibly a deadlock-induced one.
2. Take a goroutine profile. Look for stacks parked on `sync.runtime_SemacquireMutex` whose count grows.
3. Walk the goroutines holding those mutexes. They will be parked too, on a different mutex (the cycle).

We dig into the workflow in the next section.

---

## Diagnosing Partial Deadlock with `pprof goroutine`

Setup. Add `_ "net/http/pprof"` to your imports and run an HTTP server on a debug port:

```go
import (
    _ "net/http/pprof"
    "net/http"
)

func init() {
    go http.ListenAndServe("localhost:6060", nil)
}
```

Now `http://localhost:6060/debug/pprof/goroutine?debug=2` returns every goroutine with full stack trace.

Workflow on a suspect process:

```bash
curl -s http://localhost:6060/debug/pprof/goroutine?debug=2 > /tmp/g1.txt
sleep 30
curl -s http://localhost:6060/debug/pprof/goroutine?debug=2 > /tmp/g2.txt
diff /tmp/g1.txt /tmp/g2.txt
```

If two goroutines are deadlocked, they will appear identically in both dumps — same file:line, same state, often the same goroutine numbers (if the runtime has not reused them). A `[semacquire, 5 minutes]` annotation appears for any goroutine parked more than five minutes — a strong tell.

To find the cycle:

1. Filter for `[semacquire]` state.
2. Identify the mutex address each goroutine is waiting for (the first argument to `sync.runtime_SemacquireMutex`).
3. For each waiting goroutine, identify what it *holds* — usually visible from earlier frames in the stack, or from contextual knowledge of the code.
4. Build the wait graph mentally. A cycle is your deadlock.

A useful trick: many production codebases assign deterministic names to mutexes via a wrapper:

```go
type NamedMutex struct {
    sync.Mutex
    name string
}
```

Then the wait graph is visible by name, not by hex address. We discuss this and other lock-ordering patterns at senior level.

---

## `SIGQUIT` and `runtime.Stack` in Practice

If you can attach to a hung process, `kill -3 <pid>` (or `Ctrl+\` on the terminal) sends `SIGQUIT`. The Go runtime's default `SIGQUIT` handler prints stacks of every goroutine and exits. This is the development workflow for "my CLI is hung."

For production processes where you cannot exit, use `runtime.Stack`:

```go
func dumpAllStacks() string {
    buf := make([]byte, 1<<20)
    n := runtime.Stack(buf, true)
    return string(buf[:n])
}
```

The `true` argument means "all goroutines." Pass `false` for just the current one. Wire this to an HTTP handler:

```go
http.HandleFunc("/debug/stacks", func(w http.ResponseWriter, _ *http.Request) {
    fmt.Fprint(w, dumpAllStacks())
})
```

Then `curl localhost:6060/debug/stacks` gives you what `SIGQUIT` would give, without crashing the process. `net/http/pprof` already exposes this as `/debug/pprof/goroutine?debug=2`.

A 1 MB buffer is a reasonable starting point. Programs with thousands of goroutines need bigger buffers — the runtime truncates silently. Better:

```go
func dumpAllStacks() string {
    n := 1 << 20
    for {
        buf := make([]byte, n)
        if got := runtime.Stack(buf, true); got < n {
            return string(buf[:got])
        }
        n *= 2
    }
}
```

---

## `goleak` Beyond Tests

`goleak` from Uber checks at the end of a test that no extra goroutines were left behind. The typical use is in `TestMain`:

```go
import "go.uber.org/goleak"

func TestMain(m *testing.M) {
    goleak.VerifyTestMain(m)
}
```

This fails the whole test binary if any leak survives the run. For finer granularity, use per-test:

```go
func TestThing(t *testing.T) {
    defer goleak.VerifyNone(t)
    // ... test body
}
```

The `defer` runs at test end. If any goroutine that did not exist at test start is still around, `goleak` calls `t.Error` with a stack dump of the leaked goroutines.

`goleak` is *not* a deadlock detector — it cannot tell whether a leaked goroutine is deadlocked or merely slow. But every deadlock that survives a test is a leak, so `goleak` catches all of them.

Common options:

- `goleak.IgnoreTopFunction("net/http.(*Server).Shutdown")` — ignore goroutines parked in a specific function.
- `goleak.IgnoreCurrent()` — snapshot existing goroutines at the start and ignore them later.
- `goleak.Cleanup(t.Cleanup)` — use `testing.T.Cleanup` instead of `defer`.

A useful pattern is `IgnoreCurrent` in setup-heavy tests:

```go
func TestThing(t *testing.T) {
    setup(t) // starts background goroutines
    opt := goleak.IgnoreCurrent()
    defer goleak.VerifyNone(t, opt)
    // test body that should not start any further goroutine that survives
}
```

---

## `go vet` and the `lostcancel` and `copylocks` Analyzers

`go vet` runs several analyzers relevant to deadlock prevention:

**`copylocks`** detects copying a value containing a `sync.Mutex`:

```go
type Counter struct {
    mu sync.Mutex
    n  int
}

func bad(c Counter) {  // value, not pointer — copies the mutex
    c.mu.Lock()
    defer c.mu.Unlock()
    c.n++
}
```

`vet` reports: `bad passes lock by value: Counter contains sync.Mutex`. The bug is that the function operates on a copy of the mutex, so locking it does not protect the original. The fix is `*Counter`.

**`lostcancel`** detects a `context.WithCancel` whose `cancel` function is never called:

```go
ctx, _ := context.WithCancel(context.Background())  // bug: cancel discarded
doWork(ctx)
```

`vet` reports: `the cancel function is not used on all paths (possible context leak)`. The bug here is not directly a deadlock — `Background` cannot be cancelled, but the `WithCancel`'s internal goroutine and timer leak. Practical impact: small, but it adds up.

**`unreachable`** can sometimes catch a `select` after an unconditional return.

**`shadow`** (with `-shadow`) catches shadowed variables, which sometimes hide context-cancellation bugs.

What `go vet` does **not** catch:

- Lock order inversions.
- Forgotten `mu.Unlock()` calls.
- Channel deadlocks.
- `WaitGroup.Add` after `Wait`.

For those, you rely on tests, `goleak`, and discipline.

---

## Channel Deadlock Recipes

### Recipe 1: producer always closes

```go
func produce(out chan<- int) {
    defer close(out)
    for _, x := range items {
        out <- x
    }
}

func consume(in <-chan int) {
    for v := range in {
        process(v)
    }
}
```

The `defer close(out)` is the load-bearing line. Whatever exit path the producer takes — normal, panic, early return — the close happens, the consumer's `for range` terminates.

### Recipe 2: only the producer closes

```go
// NEVER: two senders both calling close
go send(ch)
go send(ch)
close(ch) // panic if anyone tries to send afterward
```

If multiple goroutines send on the same channel, *none* of them should close. Coordinate the close in the parent or with a `done` channel and a separate "closer" goroutine that waits for all senders.

### Recipe 3: select on receive with cancellation

```go
select {
case v, ok := <-ch:
    if !ok {
        return // channel closed, exit cleanly
    }
    process(v)
case <-ctx.Done():
    return // cancelled
}
```

Two-arm `select`: the work and the cancellation. A goroutine that follows this shape can never deadlock on a forgotten send, because cancellation will unblock it.

### Recipe 4: fan-in with `sync.WaitGroup` and close

```go
func fanIn(ins []<-chan int) <-chan int {
    out := make(chan int)
    var wg sync.WaitGroup
    for _, in := range ins {
        wg.Add(1)
        go func(in <-chan int) {
            defer wg.Done()
            for v := range in {
                out <- v
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

The `Wait`-then-`close` goroutine is critical: it knows when all senders are done, so it is safe to close. Doing close in any of the worker goroutines would race with the others' sends.

### Recipe 5: bounded `select` with `default` for non-blocking try

```go
select {
case ch <- v:
    // sent
default:
    // would have blocked, do something else
}
```

This is non-blocking send. It cannot deadlock by itself. Use carefully — dropping values silently is rarely the right semantics.

---

## Mutex Deadlock Recipes

### Recipe 1: defer immediately

```go
mu.Lock()
defer mu.Unlock()
// work
```

Pattern matched by code reviewers and linters. Anything more elaborate is suspicious.

### Recipe 2: locked-region wrapper

```go
func (s *Store) withLock(f func()) {
    s.mu.Lock()
    defer s.mu.Unlock()
    f()
}
```

Sometimes useful for testing or for ensuring no path forgets the `Unlock`. Use sparingly — it makes the locked region harder to reason about.

### Recipe 3: trylock with backoff

```go
for i := 0; i < 3; i++ {
    if mu.TryLock() {
        defer mu.Unlock()
        return doWork()
    }
    time.Sleep(time.Duration(i) * 10 * time.Millisecond)
}
return errBusy
```

Breaks hold-and-wait by giving up if the lock is contested. Use only for diagnostic or rare-path code; in normal hot paths it can spin and consume CPU.

### Recipe 4: lock once, copy, work, lock again

```go
mu.Lock()
snapshot := *data
mu.Unlock()

result := expensiveComputation(snapshot)

mu.Lock()
data.update(result)
mu.Unlock()
```

Holds the lock only during cheap copy and cheap update. Expensive computation happens outside the lock. Sacrifices linearizability (another goroutine may have updated `data` in the meantime), but avoids the "expensive work inside lock" deadlock pattern.

### Recipe 5: never call user code with a lock held

```go
// BAD
s.mu.Lock()
defer s.mu.Unlock()
s.callback(s.value)   // user code, may try to lock something else

// GOOD
s.mu.Lock()
value := s.value
cb := s.callback
s.mu.Unlock()
cb(value)
```

This is the discipline that prevents the most insidious production deadlocks. The locked region must do nothing that could re-enter the locked code or another locked subsystem.

---

## `WaitGroup` and `errgroup` Pitfalls

### Pitfall 1: `Add` inside the goroutine

```go
// BAD
go func() {
    wg.Add(1)
    defer wg.Done()
    // work
}()
```

Race: if `wg.Wait()` runs before the goroutine starts and calls `Add`, `Wait` sees zero and returns immediately. The goroutine's later `Add` is a programming error.

```go
// GOOD
wg.Add(1)
go func() {
    defer wg.Done()
    // work
}()
```

### Pitfall 2: nested `WaitGroup` reuse

```go
// BAD
wg.Add(1)
go func() {
    defer wg.Done()
    wg.Add(1)         // reusing the same wg from within
    go func() {
        defer wg.Done()
        // ...
    }()
}()
wg.Wait()
```

This *can* work but is fragile. If the outer `Done` runs before the inner `Add`, the counter briefly reaches zero and `Wait` returns. Use a fresh `WaitGroup` for the inner level, or coordinate through channels.

### Pitfall 3: `errgroup.Group` with `WithContext`

```go
g, ctx := errgroup.WithContext(context.Background())
g.Go(func() error { return work1(ctx) })
g.Go(func() error { return work2(ctx) })
err := g.Wait()
```

`WithContext` cancels the context when *any* `Go` function returns a non-nil error or panics. So work2 sees `ctx.Done` close when work1 fails. This is the standard cancellation propagation.

A pitfall: forgetting to check `ctx.Done` inside `work1` or `work2` means they cannot be interrupted, even though the context was cancelled. The cancellation is propagated only via the *channel*; the worker must observe it.

---

## Context-Driven Cancellation Done Right

The rules:

1. **Every blocking operation in a context-aware function must select on `ctx.Done`.**
2. **Pass the context down explicitly.** Do not store contexts in structs (with rare exceptions like HTTP handler scopes).
3. **`defer cancel()` on every `WithCancel`/`WithTimeout`/`WithDeadline`.** Otherwise the parent context cannot reclaim resources.
4. **Check `ctx.Err()` after a blocking call returns.** A successful return from a select with `ctx.Done` may still have happened in the operation arm; check the error explicitly if you need to distinguish.

Example:

```go
func read(ctx context.Context, conn net.Conn, p []byte) (int, error) {
    type result struct {
        n   int
        err error
    }
    done := make(chan result, 1)
    go func() {
        n, err := conn.Read(p)
        done <- result{n, err}
    }()
    select {
    case r := <-done:
        return r.n, r.err
    case <-ctx.Done():
        conn.SetReadDeadline(time.Now()) // unblock the goroutine
        <-done                            // drain to avoid leak
        return 0, ctx.Err()
    }
}
```

Two subtleties:

- The internal goroutine *will* eventually run to completion. We drain its result via `<-done` to prevent leaking it.
- We set a past read deadline on the connection to actually unblock the in-flight `conn.Read`. Without this, the goroutine would block on the OS read forever even though our caller has moved on.

This is a common pattern when wrapping non-context-aware APIs.

---

## Tests with Timeouts: Patterns That Work

### Pattern 1: `time.After` in the test body

```go
func TestThing(t *testing.T) {
    done := make(chan struct{})
    go func() {
        defer close(done)
        run()
    }()
    select {
    case <-done:
    case <-time.After(2 * time.Second):
        t.Fatal("test deadlocked")
    }
}
```

Simple, explicit, no helper library required. Works for any single concurrent operation.

### Pattern 2: `t.Deadline()` and context

```go
func TestThing(t *testing.T) {
    deadline, ok := t.Deadline()
    if !ok {
        deadline = time.Now().Add(5 * time.Second)
    }
    ctx, cancel := context.WithDeadline(context.Background(), deadline.Add(-500*time.Millisecond))
    defer cancel()
    if err := run(ctx); err != nil {
        t.Fatal(err)
    }
}
```

Uses the test's own `-timeout` flag value. The 500 ms early margin ensures the context cancels before the test framework kills the test, so you get a clean error instead of "test timed out."

### Pattern 3: `goleak` for hidden deadlocks

```go
func TestThing(t *testing.T) {
    defer goleak.VerifyNone(t)
    run() // any leaked goroutine, including deadlocked ones, fails the test
}
```

Catches deadlocks that survive `run`'s return — usually goroutines started inside `run` that should have cleaned up but did not.

### Pattern 4: helper for time-bounded test execution

```go
func RunWithTimeout(t *testing.T, d time.Duration, f func()) {
    t.Helper()
    done := make(chan struct{})
    go func() {
        defer close(done)
        f()
    }()
    select {
    case <-done:
    case <-time.After(d):
        buf := make([]byte, 1<<20)
        n := runtime.Stack(buf, true)
        t.Fatalf("RunWithTimeout: deadline %v exceeded\nGoroutine dump:\n%s", d, buf[:n])
    }
}
```

The stack dump on failure gives the diagnostic information you need without manual intervention. Use this for any test that might deadlock.

---

## Self-Assessment

- [ ] I can read a `fatal error: all goroutines are asleep` stack dump and identify the cycle within thirty seconds.
- [ ] I can explain why `time.Sleep(time.Hour)` masks the runtime deadlock detector.
- [ ] I can wire `net/http/pprof` and take a goroutine profile from a running server.
- [ ] I can use `goleak.VerifyNone(t)` per-test, including with `IgnoreCurrent`.
- [ ] I know which `go vet` analyzers help with deadlock prevention and which classes of bugs they miss.
- [ ] I always write `defer close(out)` in producer goroutines.
- [ ] I always `select` on `ctx.Done` in context-aware blocking code.
- [ ] I can wrap a non-context-aware blocking call (like `net.Conn.Read`) with cancellation that does not leak goroutines.
- [ ] I write `RunWithTimeout`-style tests for any concurrent code that might deadlock.

---

## Summary

At middle level you stop being a victim of deadlocks and start diagnosing them. The runtime's `checkdead` is a useful free signal, but its limits — silent in production, blind to partial deadlocks, masked by sleep, netpoll, and cgo — push you toward `pprof goroutine`, `SIGQUIT`, and `goleak`. You learn to read a stack dump fluently, identify the resource each parked goroutine is waiting for, and walk the wait graph in your head.

The Go-specific deadlock shapes get standard fixes: producers always close, every blocking op selects on `ctx.Done`, `WaitGroup.Add` always before `go`, `defer wg.Done()` first in the body, mutexes locked in a single canonical order, and locked regions kept small enough that no external call happens inside them. `errgroup.WithContext` gives you cancellation propagation almost for free, but only if every worker actually observes `ctx.Done`.

Tests get timeouts. `RunWithTimeout` helpers, `t.Deadline()` with margin, and `goleak.VerifyNone(t)` turn hangs into actionable failures with stack dumps attached. Without these, a flaky test that hangs in CI is indistinguishable from one that fails for any other reason.

Senior level builds on this with lock-order ranking, a single global discipline that makes mutex inversion impossible by construction.
