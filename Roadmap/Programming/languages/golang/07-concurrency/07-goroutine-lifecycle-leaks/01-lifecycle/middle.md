# Goroutine Lifecycle — Middle Level

## Table of Contents
1. [Introduction](#introduction)
2. [Designing for Explicit Lifecycle](#designing-for-explicit-lifecycle)
3. [Ownership Trees](#ownership-trees)
4. [Lifecycle and `context.Context`](#lifecycle-and-contextcontext)
5. [Lifecycle and Panics](#lifecycle-and-panics)
6. [Lifecycle and `runtime.Goexit`](#lifecycle-and-runtimegoexit)
7. [Lifecycle and Deferred Cleanup](#lifecycle-and-deferred-cleanup)
8. [Joining Children to Parents](#joining-children-to-parents)
9. [Cancellation Patterns](#cancellation-patterns)
10. [Graceful Shutdown](#graceful-shutdown)
11. [Observability: `pprof goroutine` and `runtime/trace`](#observability-pprof-goroutine-and-runtimetrace)
12. [Lifecycle Anti-Patterns](#lifecycle-anti-patterns)
13. [Testing Lifecycle](#testing-lifecycle)
14. [Summary](#summary)

---

## Introduction
> Focus: "I know goroutines have a lifecycle. How do I *design* programs whose goroutine lifecycles are obvious and bounded?"

At this level we stop describing lifecycle and start *controlling* it. The bar is: in every package you write, the lifetime of every goroutine should be obvious from a single function and bounded by an observable event. No "it will eventually exit." No "well, when the program shuts down."

We will cover:

- The mental shift from implicit spawn to explicit ownership.
- The standard primitives Go gives you to control lifecycle: channels, `WaitGroup`, `context.Context`, `errgroup`.
- How panics, `Goexit`, and deferred cleanup interact.
- The "graceful shutdown" pattern, which is the production-grade lifecycle pattern for daemons.
- How to observe lifecycle in a running program.

This material assumes you understand the basics from [junior.md](junior.md). It is the bridge to the leak-prevention techniques in [03-preventing-leaks](../03-preventing-leaks/).

---

## Designing for Explicit Lifecycle

Three rules:

### Rule 1: Spawn and join in the same function

A function that uses `go` should also wait for those goroutines to finish before returning. This makes the lifecycle local and inspectable.

```go
// GOOD: lifecycle is local to fetchAll.
func fetchAll(ctx context.Context, urls []string) ([]Result, error) {
    var wg sync.WaitGroup
    results := make([]Result, len(urls))
    for i, u := range urls {
        wg.Add(1)
        go func(i int, u string) {
            defer wg.Done()
            results[i] = fetch(ctx, u)
        }(i, u)
    }
    wg.Wait()
    return results, nil
}
```

```go
// BAD: lifecycle escapes the function.
func startBackground(urls []string) {
    for _, u := range urls {
        go fetch(u) // no one waits, no cancellation
    }
}
```

The second form is sometimes acceptable for daemons, but the lifecycle must then be owned by the surrounding type, not lost.

### Rule 2: If you must spawn beyond the function, hand the lifecycle to an owner

```go
type Daemon struct {
    cancel context.CancelFunc
    done   chan struct{}
}

func StartDaemon() *Daemon {
    ctx, cancel := context.WithCancel(context.Background())
    d := &Daemon{cancel: cancel, done: make(chan struct{})}
    go func() {
        defer close(d.done)
        d.run(ctx)
    }()
    return d
}

func (d *Daemon) Stop() {
    d.cancel()
    <-d.done
}
```

The lifecycle is now an explicit object. The caller can stop it and observe it.

### Rule 3: Document the exit condition

Every `go` deserves a one-line comment naming the exit condition. If you cannot write the comment, you cannot ship the code.

```go
// exits when ctx is canceled or when jobs is closed and drained.
go pool.run(ctx, jobs)
```

---

## Ownership Trees

Think of every goroutine as having an *owner* — the goroutine, function, or struct responsible for ending it. Build trees:

```
main
 ├── http.Server.ListenAndServe (1 listener goroutine)
 │    ├── per-connection goroutine
 │    │    └── per-handler context (cancelled on response complete)
 │    ├── per-connection goroutine
 │    └── ...
 ├── MetricsServer.Run
 │    └── ticker goroutine (exits on ctx cancel)
 └── CacheRefresher.Run
      └── refresh goroutine (exits on ctx cancel)
```

Cancellation flows from root to leaves: `ctx, cancel := context.WithCancel(...)`; on shutdown, `cancel()` propagates `ctx.Done()` to every leaf.

If a leaf goroutine has no path back to a root in the tree, it is an orphan. Orphans are the root cause of leaks. Code review should flag any `go ...` that does not visibly attach to a parent.

---

## Lifecycle and `context.Context`

`context.Context` is Go's lifecycle-coordination primitive. Three things to internalize:

### `ctx.Done()` is the cancellation signal

```go
select {
case <-ctx.Done():
    return ctx.Err()
case v := <-ch:
    handle(v)
}
```

A goroutine that does not check `ctx.Done()` cannot be canceled. There is no force-stop.

### `ctx.Err()` tells you *why* it was canceled

- `context.Canceled` — explicit `cancel()` call.
- `context.DeadlineExceeded` — timeout reached.

Returning `ctx.Err()` from a goroutine that exits because of cancellation is idiomatic.

### Always call `cancel()`, ideally via `defer`

```go
ctx, cancel := context.WithTimeout(parent, 5*time.Second)
defer cancel()
```

Even if the timeout will fire, calling `cancel()` early frees the timer goroutine that the context internally maintains.

### Don't lose the context across the goroutine boundary

```go
// BAD: child goroutine ignores ctx
go func() {
    longRunning()
}()

// GOOD: child goroutine respects ctx
go func() {
    longRunning(ctx)
}()
```

---

## Lifecycle and Panics

Every goroutine has its own panic-handling chain. A panic anywhere in the goroutine unwinds the stack, runs all `defer`-ed functions, and — if nothing recovers — terminates the process.

### The unrecovered panic path

```
panic("oops")
   |
   v
defer chain runs (most recent first)
   |
   v
no recover found
   |
   v
runtime.fatalpanic
   |
   v
process terminates with exit code 2
```

### Recovering at the boundary

For any goroutine that runs untrusted or fallible code, wrap the entire body:

```go
go func() {
    defer func() {
        if r := recover(); r != nil {
            log.Printf("worker recovered: %v\n%s", r, debug.Stack())
            metrics.IncPanicCount()
        }
    }()
    work()
}()
```

After recovery, the goroutine reaches `_Gdead` cleanly. The rest of the program survives. This is the *only* way to scope a panic to one goroutine.

### Where the panic boundary belongs

- At the top of every long-running worker.
- At the boundary of every "user code" callback (plugin systems, callbacks from event loops).
- In every `http.HandlerFunc` — but `net/http` does this for you by default.

It does *not* belong inside small library functions: leave panics to propagate so callers can decide.

---

## Lifecycle and `runtime.Goexit`

`runtime.Goexit` ends the current goroutine immediately, running every `defer`-ed function on the stack. It is different from `return` (which only exits the current frame) and from `panic` (which is an error path).

### Use cases

- **Test framework internals.** `testing.(*T).FailNow` calls `Goexit` to terminate a failing test goroutine without affecting other tests.
- **Library functions** that cannot signal failure any other way and want to *force* the current goroutine to stop.

### `Goexit` from the main goroutine

```go
func main() {
    go func() {
        for {
            fmt.Println("worker")
            time.Sleep(time.Second)
        }
    }()
    runtime.Goexit()
}
```

The main goroutine ends. The worker continues. The program runs until the runtime detects there are no live goroutines (which never happens here, so the program runs forever).

### `Goexit` and `defer`

```go
func main() {
    defer fmt.Println("defer in main")
    runtime.Goexit()
    fmt.Println("never")
}
```

Output: `defer in main`. The defer runs because `Goexit` honors the defer chain.

In production code, `Goexit` is rarely needed. Prefer `return` plus error values.

---

## Lifecycle and Deferred Cleanup

Every goroutine has its own `defer` stack. Cleanup at the *goroutine* level is one of Go's idioms:

```go
go func() {
    defer wg.Done()                       // tell parent we're done
    defer conn.Close()                    // free the connection
    defer cancel()                        // free the timer in ctx
    defer log.Println("worker exit")      // diagnostics
    work(ctx, conn)
}()
```

Order matters: deferred calls run in *reverse* order. The above runs `log.Println` first, then `cancel()`, then `conn.Close()`, then `wg.Done()`. Usually that ordering is correct — you want the `wg.Done()` to be last so the parent does not return before the goroutine's cleanup actually finished.

### `defer` and recover and `Goexit`

All three play together:

- `defer` runs on normal return.
- `defer` runs on `runtime.Goexit`.
- `defer` runs on panic (and `recover` works inside a defer).

The only time `defer` does *not* run is `os.Exit` or `syscall.Exit` — those terminate the process without any unwinding.

---

## Joining Children to Parents

### `sync.WaitGroup`

The default tool for "wait for N goroutines to finish":

```go
var wg sync.WaitGroup
for i := 0; i < n; i++ {
    wg.Add(1)
    go func() {
        defer wg.Done()
        work()
    }()
}
wg.Wait()
```

Rules:

- `Add(1)` before `go`, never inside the goroutine.
- `defer wg.Done()` at the top of the goroutine.
- `Wait()` returns only when the counter reaches 0.

### `errgroup.Group`

For fan-out with error propagation and shared cancellation:

```go
import "golang.org/x/sync/errgroup"

g, ctx := errgroup.WithContext(ctx)
for _, u := range urls {
    u := u
    g.Go(func() error {
        return fetch(ctx, u)
    })
}
if err := g.Wait(); err != nil {
    return err
}
```

`errgroup`:

- Spawns child goroutines via `g.Go`.
- Cancels the shared context on the first error.
- Waits for all children before returning.
- The lifecycle of every child is bounded by the `Wait` call.

### Channels for join

For more bespoke patterns:

```go
done := make(chan struct{})
go func() {
    defer close(done)
    work()
}()
<-done
```

A closed channel is a join signal. Useful when a `WaitGroup` would be overkill (one goroutine) or when you want a `select` on the done signal.

---

## Cancellation Patterns

### Channel-based cancellation (legacy)

```go
quit := make(chan struct{})
go func() {
    for {
        select {
        case <-quit:
            return
        case j := <-jobs:
            process(j)
        }
    }
}()
// ... later ...
close(quit)
```

Works. But it does not compose: passing the `quit` channel down many layers is tedious, and you cannot attach a deadline or value.

### `context.Context` (modern)

```go
go func() {
    for {
        select {
        case <-ctx.Done():
            return
        case j := <-jobs:
            process(ctx, j)
        }
    }
}()
// ... later ...
cancel()
```

This composes: child contexts inherit cancellation, deadlines propagate down, values can be attached. Use `context.Context` for any new code.

### Combining cancellation and channels

```go
select {
case <-ctx.Done():
    return ctx.Err()
case <-jobs:
    // process
case <-tick.C:
    // ...
}
```

The lifecycle is bounded by the *first* event to fire.

---

## Graceful Shutdown

The canonical production lifecycle pattern:

```go
func main() {
    ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
    defer cancel()

    srv := &http.Server{Addr: ":8080", Handler: routes()}

    // start the server in a goroutine — lifecycle is the whole program.
    serverErr := make(chan error, 1)
    go func() {
        serverErr <- srv.ListenAndServe()
    }()

    select {
    case <-ctx.Done():
        log.Println("shutdown signal received")
    case err := <-serverErr:
        log.Printf("server error: %v", err)
    }

    // graceful shutdown with a hard deadline.
    shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 30*time.Second)
    defer shutdownCancel()
    if err := srv.Shutdown(shutdownCtx); err != nil {
        log.Printf("forced shutdown: %v", err)
    }
}
```

Properties:

- The signal handler (`signal.NotifyContext`) is the lifecycle trigger.
- `srv.Shutdown` waits for in-flight handler goroutines to finish, bounded by `shutdownCtx`.
- The `serverErr` channel is buffered to avoid a leaking sender.

Every long-running server should follow this shape. The goroutines spawned by handlers are owned by `http.Server`; `Shutdown` joins them.

---

## Observability: `pprof goroutine` and `runtime/trace`

### `pprof goroutine`

Add this to every server:

```go
import _ "net/http/pprof"

func main() {
    go func() {
        log.Println(http.ListenAndServe("localhost:6060", nil))
    }()
    // ...
}
```

Then:

```
go tool pprof http://localhost:6060/debug/pprof/goroutine
```

Inside pprof:

- `top` — see the busiest stacks.
- `list FuncName` — see the source.
- `web` — a graph.

A leak shows up as a stack with thousands of goroutines parked on the same line.

Equivalent text dump:

```
curl -s http://localhost:6060/debug/pprof/goroutine?debug=2
```

Each goroutine's stack with state in brackets — `[chan receive, 12 minutes]` is a smoking gun.

### `runtime/trace`

Captures full lifecycle (every state transition with timestamps):

```go
import "runtime/trace"

f, _ := os.Create("trace.out")
trace.Start(f)
defer trace.Stop()
// ... run workload ...
```

Then:

```
go tool trace trace.out
```

The browser UI shows:

- Each goroutine's lifeline (born, run intervals, wait intervals, dead).
- Why each wait happened (channel, syscall, sleep).
- The cause of each schedule.

Use it once per project. The intuition you gain is irreplaceable.

### `runtime.Stack`

The simplest dump:

```go
buf := make([]byte, 1<<20)
n := runtime.Stack(buf, true)
fmt.Println(string(buf[:n]))
```

Use it in `SIGUSR1` handlers, in test failures, and in panic dumps.

---

## Lifecycle Anti-Patterns

### The fire-and-forget log

```go
go log.Println("event:", ev) // looks harmless
```

If `log` is misconfigured (e.g., writing to a slow network), the goroutine waits. Many of these add up to a memory blob and a slow leak.

### The unbounded retry

```go
go func() {
    for {
        if err := op(); err != nil {
            time.Sleep(time.Second)
            continue
        }
        return
    }
}()
```

If `op` never succeeds, the goroutine never ends. Add a context, a max-retry count, or both.

### The "trust me, it exits" goroutine

```go
go func() {
    for v := range ch {
        process(v)
    }
}()
```

Fine — *if* someone closes `ch`. Bad if the original sender keeps a reference but never closes. Document the close-ownership.

### The goroutine that recovers itself

```go
go func() {
    for {
        func() {
            defer func() { recover() }() // swallow panics
            risky()
        }()
    }
}()
```

This may keep the lifecycle "alive" but masks bugs. Better: log the panic, return, and let a supervisor restart.

### The "spawn from spawn" cascade

```go
go func() {
    for v := range jobs {
        go process(v) // spawning from a goroutine
    }
}()
```

Each `process` is now an orphan with no lifecycle parent. Use a worker pool instead.

---

## Testing Lifecycle

### Strategy 1: Baseline + leakcheck

```go
func TestNoLeak(t *testing.T) {
    before := runtime.NumGoroutine()
    runMyCode(t)
    // give the runtime a moment to update.
    time.Sleep(50 * time.Millisecond)
    after := runtime.NumGoroutine()
    if after > before {
        buf := make([]byte, 1<<20)
        n := runtime.Stack(buf, true)
        t.Fatalf("leak: before=%d after=%d\n%s", before, after, buf[:n])
    }
}
```

### Strategy 2: `uber-go/goleak`

```go
import "go.uber.org/goleak"

func TestMain(m *testing.M) {
    goleak.VerifyTestMain(m)
}
```

`goleak` snapshots goroutines, runs the test, and asserts none leaked. Sample stack traces if there is a leak.

### Strategy 3: Synthetic lifecycle test

```go
func TestWorkerStopsOnContextCancel(t *testing.T) {
    ctx, cancel := context.WithCancel(context.Background())
    done := make(chan struct{})
    go func() {
        defer close(done)
        worker(ctx)
    }()
    cancel()
    select {
    case <-done:
    case <-time.After(time.Second):
        t.Fatal("worker did not exit on cancel")
    }
}
```

Always check: did the goroutine end *because of cancel*, within a reasonable budget? `time.After` gives you the budget; do not omit it.

---

## Summary

Lifecycle design at the middle level is about making the answer to "when does this goroutine end?" both easy to give and easy to verify:

- Spawn and join in the same function when possible. When not possible, attach the lifecycle to an explicit owner with a `Stop` or `Close` method.
- Pass `context.Context` to every goroutine; check `ctx.Done()` at every blocking point.
- Wrap every long-running goroutine body with `defer recover` to scope panics.
- Use `sync.WaitGroup` or `errgroup.Group` for join.
- Add `pprof goroutine` and `runtime/trace` to your toolbox.
- Test lifecycle explicitly: assert that goroutine count returns to baseline, or use `goleak`.

The senior level extends this to whole-system patterns: supervisor trees, hierarchical contexts, and the interaction between lifecycle and the garbage collector. The professional level dives into the runtime states (`_Grunnable`, `_Gwaiting`, `_Gsyscall`, `_Gdead`) and the `g` struct itself.

See also:

- [02-detecting-leaks](../02-detecting-leaks/) — when this discipline breaks down, how to detect it.
- [03-preventing-leaks](../03-preventing-leaks/) — patterns that make leaks structurally impossible.
- [../../10-scheduler-deep-dive](../../10-scheduler-deep-dive/) — what happens *between* the lifecycle states.
