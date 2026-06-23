# Goroutines — Middle Level

## Table of Contents
1. [Introduction](#introduction)
2. [When to Spawn a Goroutine](#when-to-spawn-a-goroutine)
3. [The Goroutine Lifecycle](#the-goroutine-lifecycle)
4. [Coordination Tools in Practice](#coordination-tools-in-practice)
5. [Cancellation with `context.Context`](#cancellation-with-contextcontext)
6. [Goroutine Leaks: Detection and Prevention](#goroutine-leaks-detection-and-prevention)
7. [Worker Pools](#worker-pools)
8. [Fan-Out / Fan-In](#fan-out-fan-in)
9. [Pipelines](#pipelines)
10. [`errgroup` and Structured Coordination](#errgroup-and-structured-coordination)
11. [Goroutine-Safe APIs](#goroutine-safe-apis)
12. [Race Detection in CI](#race-detection-in-ci)
13. [Best Practices for Established Codebases](#best-practices-for-established-codebases)
14. [Pitfalls You Will Meet](#pitfalls-you-will-meet)
15. [Self-Assessment](#self-assessment)
16. [Summary](#summary)

---

## Introduction

You already know the mechanics: `go f()` spawns a new path of execution, `WaitGroup` joins them, panics in goroutines kill the program. The middle-level question is *what to do with that power in real code*: which problems benefit from goroutines, which patterns are idiomatic, how to cancel cleanly, and how to detect leaks before they become production incidents.

After reading this you will:

- Have a checklist for "should this be a goroutine?"
- Know the canonical patterns: fan-out, fan-in, pipeline, worker pool.
- Use `context.Context` to cancel goroutine trees.
- Use `errgroup.Group` to spawn and join with error handling.
- Detect goroutine leaks with `runtime.NumGoroutine`, pprof, and tests.
- Understand the implicit contract of "goroutine-safe" types.
- Run the race detector productively in CI.

---

## When to Spawn a Goroutine

Goroutines are not free. They cost memory, scheduler attention, and mental load. Use them when concurrency is *useful*, not because they are a Go feature.

### Spawn a goroutine when:

- The work blocks on I/O (network, disk, subprocess) and the caller has other work to do.
- You need parallelism across CPU cores for a CPU-bound algorithm.
- You have N independent tasks and you want to run them simultaneously to reduce wall-clock time.
- You need a long-running background activity (ticker, queue consumer, supervisor).
- You want to isolate a slow or untrusted operation behind a timeout.

### Do *not* spawn a goroutine when:

- The work is shorter than a microsecond (a function call is faster).
- The work is purely synchronous and the caller has nothing else to do — `f()` is simpler.
- You only spawn it to "get out of the current call stack" — that is what helper functions are for.
- You cannot articulate when it will exit. If you do not have an exit strategy, you have a leak.
- The result needs to be returned synchronously. A goroutine cannot return to its parent's frame.

### The "blocking I/O" rule

A typical Go web server creates one goroutine per incoming request. While that goroutine is waiting on a database query or an HTTP call to a downstream service, the runtime parks it and reuses the OS thread for some other goroutine. This is why a Go server can handle 50 000 concurrent requests on 4 OS threads without breaking.

Without goroutines, that same workload would either:

- Use 50 000 OS threads (impossible — too much memory).
- Use a callback / event loop (functional but harder to reason about).

Go made the bet that lightweight scheduled units of execution + blocking-style I/O is a better programming model than callbacks. Goroutines are the embodiment of that bet.

---

## The Goroutine Lifecycle

A goroutine progresses through a small set of states. The Go runtime tracks each one in a struct called `g`:

```
+-----------+   go f()    +-------------+   schedule    +---------+
|  Gidle    | ----------> | Grunnable   | ------------> | Grunning|
+-----------+             +-------------+               +---------+
                                ^                            |
                                |                            v
                                |       block on I/O      +---------+
                                +------------------------ | Gwaiting|
                                                          +---------+
                                                                |
                                  ready (I/O done, lock taken)  v
                                                          +-----------+
                                                          | Grunnable |
                                                          +-----------+

                                                         exit / return
                                                          +---------+
                                                          | Gdead   |
                                                          +---------+
```

The states are not user-visible directly, but they shape how you reason about goroutines:

- **`Grunnable`**: ready to run, waiting for an OS thread (`M`) and processor slot (`P`).
- **`Grunning`**: actively executing on a thread.
- **`Gwaiting`**: parked because of a blocking operation (channel receive, mutex acquire, syscall, sleep). Does not consume an OS thread.
- **`Gdead`**: returned. The struct may be reused for a future goroutine.

### Why this matters at middle level

You can spawn 500 000 goroutines that are all blocked on `time.Sleep` or `net.Conn.Read`, and they will *not* keep 500 000 OS threads busy. They are parked. The runtime needs only enough threads (`M`s) to run the *runnable* goroutines, plus a few for syscalls. That is the source of Go's I/O scaling.

It also explains why a CPU profile may show "9 goroutines" running while `runtime.NumGoroutine()` reports 50 000: most are parked.

---

## Coordination Tools in Practice

The standard library offers several primitives. Pick the one that matches the question you are answering.

| Question | Tool |
|---|---|
| "Wait for N goroutines to finish." | `sync.WaitGroup` |
| "Wait for N goroutines, collect first error." | `errgroup.Group` |
| "Run code exactly once." | `sync.Once` |
| "Pass a value safely from one goroutine to another." | channels |
| "Cancel a tree of goroutines." | `context.Context` |
| "Protect shared mutable state." | `sync.Mutex` / `sync.RWMutex` |
| "Read or write an atomic value." | `sync/atomic`, `atomic.Value`, `atomic.Pointer[T]` |
| "Sequence work between two goroutines." | unbuffered channel |
| "Pool short-lived buffers." | `sync.Pool` |

Two recurring beginner mistakes at middle level:

1. **Reaching for `Mutex` when a channel would be cleaner.** "Don't communicate by sharing memory; share memory by communicating." That said, mutexes are not evil — they are the right answer for "many goroutines reading and updating a small in-memory map."
2. **Reaching for channels when a `Mutex` would be cleaner.** Building a complex coordination dance with channels for simple shared state is over-engineering.

The rule of thumb: **if the data flows linearly between goroutines, use channels; if it sits in a shared structure that several goroutines mutate, use a mutex.**

---

## Cancellation with `context.Context`

`context.Context` is how Go expresses "this work might be cancelled." Every long-running goroutine should accept a `context.Context` and return early when it is cancelled.

### The contract

```go
func DoWork(ctx context.Context, in <-chan Item) error {
    for {
        select {
        case <-ctx.Done():
            return ctx.Err() // context.Canceled or context.DeadlineExceeded
        case item, ok := <-in:
            if !ok {
                return nil
            }
            if err := process(ctx, item); err != nil {
                return err
            }
        }
    }
}
```

The pattern: every blocking operation is in a `select` with `<-ctx.Done()`. If the parent cancels, the goroutine exits within one iteration.

### Constructing contexts

```go
ctx, cancel := context.WithCancel(parent)
defer cancel()

ctx, cancel := context.WithTimeout(parent, 5*time.Second)
defer cancel()

ctx, cancel := context.WithDeadline(parent, time.Now().Add(time.Minute))
defer cancel()
```

Always call `cancel()` to release resources. The `defer` is the safe default.

### Propagating cancellation

```go
go fetchA(ctx)
go fetchB(ctx)
```

When `cancel()` is called, both `fetchA` and `fetchB` see `ctx.Done()` close and return. The cancellation tree mirrors the goroutine tree.

### `context` is not a goroutine manager

`context.Context` does not start, stop, or count goroutines. It carries cancellation signals and request-scoped values. Pair it with `errgroup.Group`, `WaitGroup`, or your own coordination to actually wait for goroutines to exit.

---

## Goroutine Leaks: Detection and Prevention

A **goroutine leak** is a goroutine that never returns. Common causes:

- Sending to an unbuffered channel that nobody reads.
- Receiving from a channel that nobody closes.
- Holding a mutex forever.
- Looping with no exit condition.
- Forgotten background ticker.

### Detection

#### `runtime.NumGoroutine` over time

```go
go func() {
    for range time.Tick(10 * time.Second) {
        log.Printf("goroutines: %d", runtime.NumGoroutine())
    }
}()
```

Trend up = leak. Stable = healthy. Save the result to a metric (Prometheus, OpenTelemetry, etc.).

#### `pprof` goroutine dump

Expose `net/http/pprof`:

```go
import _ "net/http/pprof"
go http.ListenAndServe("localhost:6060", nil)
```

Then:

```bash
curl localhost:6060/debug/pprof/goroutine?debug=2
```

You get a stack trace per goroutine. Group by stack: thousands of identical stacks point straight at the leak.

#### `goleak` in tests

```go
import "go.uber.org/goleak"

func TestMain(m *testing.M) {
    goleak.VerifyTestMain(m)
}
```

After every test, `goleak` checks that no goroutines remain that did not exist at start. A leaking test fails the test suite.

### Prevention patterns

#### Buffered channel of size 1 for "send result and exit"

```go
res := make(chan int, 1)
go func() { res <- compute() }()

select {
case v := <-res:
    use(v)
case <-ctx.Done():
    // goroutine still finishes and writes to res, but no one cares
}
```

The buffer of 1 means the send always completes, so the goroutine always exits. Without the buffer, if the receiver gives up via `ctx.Done()`, the sender blocks forever — leak.

#### Always pair a goroutine with a way to stop it

```go
type Worker struct {
    cancel context.CancelFunc
    done   chan struct{}
}

func NewWorker() *Worker {
    ctx, cancel := context.WithCancel(context.Background())
    w := &Worker{cancel: cancel, done: make(chan struct{})}
    go w.run(ctx)
    return w
}

func (w *Worker) run(ctx context.Context) {
    defer close(w.done)
    for {
        select {
        case <-ctx.Done():
            return
        case <-time.After(time.Second):
            tick()
        }
    }
}

func (w *Worker) Stop() {
    w.cancel()
    <-w.done // wait for run() to actually return
}
```

Two channels: `cancel` to signal stop, `done` to confirm exit. The `Stop` is synchronous — when it returns, the goroutine has truly finished.

---

## Worker Pools

A worker pool is the standard answer to "I have a stream of work, I want bounded concurrency."

### Skeleton

```go
func RunPool(ctx context.Context, workers int, jobs <-chan Job, results chan<- Result) {
    var wg sync.WaitGroup
    for i := 0; i < workers; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            for {
                select {
                case <-ctx.Done():
                    return
                case job, ok := <-jobs:
                    if !ok {
                        return
                    }
                    results <- process(job)
                }
            }
        }()
    }
    go func() {
        wg.Wait()
        close(results)
    }()
}
```

### Sizing the pool

| Workload | Heuristic |
|---|---|
| CPU-bound | `runtime.GOMAXPROCS(0)` workers |
| I/O-bound | tens to thousands; profile to find the sweet spot |
| Network-bound to a single downstream | match the downstream's connection limit |
| Mixed | start with `2 * GOMAXPROCS`, tune from metrics |

Oversizing a pool wastes memory and adds scheduler overhead. Undersizing leaves CPUs idle. Measure.

### Why not "one goroutine per job"?

For unbounded input — say, an HTTP server's request stream — naive "one goroutine per request" is fine because each request is independent and short-lived. For tasks that hammer a fixed downstream (a database, a third-party API), a pool is the right answer: it bounds the concurrency you impose on that downstream.

---

## Fan-Out / Fan-In

A pattern for parallelising a slow per-item operation.

### Fan-out

```go
func FanOut(ctx context.Context, items []Item, workers int) <-chan Result {
    out := make(chan Result)
    in := make(chan Item)

    var wg sync.WaitGroup
    for i := 0; i < workers; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            for item := range in {
                select {
                case out <- process(item):
                case <-ctx.Done():
                    return
                }
            }
        }()
    }

    go func() {
        defer close(in)
        for _, it := range items {
            select {
            case in <- it:
            case <-ctx.Done():
                return
            }
        }
    }()

    go func() {
        wg.Wait()
        close(out)
    }()

    return out
}
```

### Fan-in

Merging multiple result channels into one:

```go
func FanIn(channels ...<-chan Result) <-chan Result {
    out := make(chan Result)
    var wg sync.WaitGroup
    for _, c := range channels {
        wg.Add(1)
        go func(c <-chan Result) {
            defer wg.Done()
            for v := range c {
                out <- v
            }
        }(c)
    }
    go func() { wg.Wait(); close(out) }()
    return out
}
```

`FanIn` is one of the most reused snippets in production Go.

---

## Pipelines

A pipeline is a chain of stages, each running in its own goroutine, connected by channels.

```
items --> [parse] --> [enrich] --> [persist] --> done
```

```go
func parse(in <-chan []byte) <-chan Record {
    out := make(chan Record)
    go func() {
        defer close(out)
        for raw := range in {
            r, err := decode(raw)
            if err != nil {
                continue
            }
            out <- r
        }
    }()
    return out
}

func enrich(in <-chan Record) <-chan Record {
    out := make(chan Record)
    go func() {
        defer close(out)
        for r := range in {
            r.Score = score(r)
            out <- r
        }
    }()
    return out
}

func persist(in <-chan Record) <-chan error {
    errs := make(chan error)
    go func() {
        defer close(errs)
        for r := range in {
            if err := save(r); err != nil {
                errs <- err
            }
        }
    }()
    return errs
}
```

Compose:

```go
errs := persist(enrich(parse(input)))
for err := range errs { log.Println(err) }
```

Pipelines decouple stages, allow per-stage parallelism (each stage can spawn N workers), and are easy to test (each stage takes channels in, returns a channel out).

---

## `errgroup` and Structured Coordination

`golang.org/x/sync/errgroup` is the canonical "spawn N goroutines, wait for all, collect first error" tool.

```go
import "golang.org/x/sync/errgroup"

func FetchAll(ctx context.Context, urls []string) error {
    g, ctx := errgroup.WithContext(ctx)
    for _, url := range urls {
        url := url
        g.Go(func() error {
            return fetch(ctx, url)
        })
    }
    return g.Wait()
}
```

Key behaviours:

- `g.Go(f)` spawns a goroutine running `f`.
- If any `f` returns a non-nil error, the derived `ctx` is cancelled — the rest of the goroutines should observe `ctx.Done()` and exit.
- `g.Wait` returns the first non-nil error (or `nil` if all succeed).

In Go 1.20+, `errgroup.SetLimit(n)` bounds parallel goroutines without writing your own pool.

```go
g.SetLimit(8)
for _, url := range urls {
    url := url
    g.Go(func() error { return fetch(ctx, url) })
}
```

`errgroup` is the right answer 80% of the time when you would otherwise reach for `WaitGroup`.

---

## Goroutine-Safe APIs

A type is **goroutine-safe** (or "concurrent-safe") if multiple goroutines can call its methods simultaneously without corrupting state. Document this in the doc comment of the type.

### Examples from the standard library

| Type | Goroutine-safe? |
|---|---|
| `sync.Mutex`, `sync.RWMutex`, `sync.WaitGroup`, `sync.Once`, `sync.Pool`, `sync.Map` | Yes — that's their purpose |
| `time.Timer`, `time.Ticker` | Concurrent stop is safe |
| `net/http.Client`, `net/http.Transport` | Yes — designed for sharing |
| `database/sql.DB` | Yes — connection pool is internal |
| Most `*os.File` operations | Yes for concurrent reads/writes; semantics depend on OS |
| Built-in `map` | **No** — must guard with `Mutex` or use `sync.Map` |
| Built-in `slice` | **No** — concurrent append races |

### When you write a new type

Make a deliberate choice:

```go
// Cache stores values keyed by string. It is safe for concurrent use by
// multiple goroutines.
type Cache struct {
    mu sync.RWMutex
    m  map[string]string
}
```

Or:

```go
// Builder collects fragments. Methods on Builder are NOT safe for concurrent
// use; pass an instance through one goroutine at a time.
type Builder struct { ... }
```

Either is acceptable. **Silent ambiguity is not.**

---

## Race Detection in CI

The Go race detector is the single most useful concurrency tool. It instruments memory accesses at compile time and reports unsynchronised reads/writes at runtime.

### Run mode

```bash
go test -race ./...
go run -race main.go
go build -race -o myapp
```

### CI integration

Every CI run should include:

```yaml
- name: Test with race
  run: go test -race -count=1 ./...
```

`-count=1` defeats the test cache so the race detector runs every time.

### Cost

The race detector adds ~5–15× CPU and ~5–10× memory. Acceptable for tests; prohibitive for production. Some teams ship a `-race` build to canary servers; most do not.

### What it finds

- Data races — two goroutines, at least one writing, no synchronisation between them.
- *Not* deadlocks (use the standard runtime detector or `go test -timeout`).
- *Not* logical concurrency bugs (use code review and tests).

A test that does not exercise the racy code path will not catch the race. Race detection is only as good as your tests.

---

## Best Practices for Established Codebases

1. **Never spawn a goroutine in a function whose name does not signal it.** Functions named `Get`, `Find`, `Compute` should not have side-effect background work. Use `Watch`, `StartLoop`, `Run`, `Serve`.
2. **Every long-running goroutine takes a `context.Context`.** No exceptions for production code.
3. **Every long-running goroutine has a way to confirm it has stopped.** Either by closing a `done` channel, by calling `wg.Done`, or by signaling through `errgroup`.
4. **Pair channels with their close path.** Document who closes and when. A channel without a close path is a leak.
5. **Pass loop variables by parameter.** Even in Go 1.22+, the explicit form `go func(x X){...}(x)` reads more clearly.
6. **Test with the race detector.** Make `-race` mandatory in CI.
7. **Use `errgroup` over hand-rolled `WaitGroup` + `chan error`.** Less code, fewer bugs.
8. **Profile before assuming the scheduler is the bottleneck.** Most "Go is slow" reports are CPU or GC, not the scheduler.

---

## Pitfalls You Will Meet

### Reading from a closed channel does not block

```go
ch := make(chan int)
close(ch)
v, ok := <-ch // v == 0, ok == false, no block
```

A `for v := range ch` on a closed channel finishes the loop. Write code that depends on this fact, not on a separate "done" signal.

### Sending to a closed channel panics

```go
ch := make(chan int)
close(ch)
ch <- 1 // panic: send on closed channel
```

This is why the convention is "the sender closes." If multiple goroutines send, none of them can safely close.

### `select` with multiple ready cases picks one at random

```go
select {
case <-ch1:
case <-ch2:
}
```

If both `ch1` and `ch2` are ready, Go picks one pseudo-randomly. Do not rely on priority.

### `ctx.Done()` returns a channel, not a value

```go
if ctx.Done() {           // BUG: channels are always truthy
    return
}
select {
case <-ctx.Done():        // correct
    return
default:
}
```

### `WithTimeout` does not "cancel itself" — you still need `defer cancel()`

```go
ctx, cancel := context.WithTimeout(parent, time.Second)
// MISSING defer cancel() — the timer goroutine and ctx struct leak until timeout
```

`go vet` will warn about this. Always call `cancel`.

### `runtime.Gosched()` is not preemption

It only yields to *runnable* goroutines. If no other goroutine is runnable, the calling goroutine continues immediately. Go 1.14+ has async preemption, which makes `Gosched` rarely useful in production.

---

## Self-Assessment

- [ ] I can articulate when *not* to use a goroutine.
- [ ] I know the four canonical patterns: spawn-and-wait, worker pool, fan-out/fan-in, pipeline.
- [ ] I always thread `context.Context` through long-running goroutines.
- [ ] I can detect a goroutine leak using `pprof` or `goleak`.
- [ ] I know the difference between `WaitGroup` and `errgroup` and when to use each.
- [ ] I run `go test -race` in CI and it has caught at least one real bug.
- [ ] I document concurrency safety in the comment of every type I export.
- [ ] I never use `time.Sleep` for synchronisation.
- [ ] I know that "the sender closes the channel" is convention, not language enforcement.
- [ ] I have refactored a `WaitGroup + chan error` block into `errgroup.Group` at least once.

---

## Summary

Goroutines pay off in production when each one does substantial blocking or independent work. The patterns are few and reusable — spawn-and-wait, worker pool, fan-out/fan-in, pipeline — and standard primitives (`WaitGroup`, `errgroup`, `context.Context`, channels, `sync.Mutex`) cover almost every scenario.

Three habits separate code that ships from code that leaks:

1. **Every goroutine has an exit story.** Closed channel, cancelled context, finished work — pick one before you write `go`.
2. **`context.Context` is the cancellation mechanism, not a value bag.** Pass it explicitly.
3. **Race detector in CI.** Always.

The next level — senior — focuses on architectural decisions: structured concurrency, supervisor patterns, designing pools that scale, and avoiding the failure modes of the patterns described here.
