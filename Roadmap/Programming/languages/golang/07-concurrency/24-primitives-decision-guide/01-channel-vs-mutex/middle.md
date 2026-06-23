---
layout: default
title: Channels vs Mutexes — Middle
parent: Channels vs Mutexes
grand_parent: Primitives Decision Guide
ancestor: Go
nav_order: 3
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/24-primitives-decision-guide/01-channel-vs-mutex/middle/
---

# Channels vs Mutexes — Middle

[← Back](../)

## Table of contents
1. [What this file assumes](#what-this-file-assumes)
2. [Channel patterns: pipelines](#channel-patterns-pipelines)
3. [Channel patterns: worker pools](#channel-patterns-worker-pools)
4. [Channel patterns: semaphores](#channel-patterns-semaphores)
5. [Channel patterns: reply channels](#channel-patterns-reply-channels)
6. [Channel patterns: fan-out and fan-in](#channel-patterns-fan-out-and-fan-in)
7. [Channel patterns: timeouts and cancellation with select](#channel-patterns-timeouts-and-cancellation-with-select)
8. [Mutex patterns: read-write mutex](#mutex-patterns-read-write-mutex)
9. [Mutex patterns: sync.Map](#mutex-patterns-syncmap)
10. [Mutex patterns: hybrid mutex plus condvar](#mutex-patterns-hybrid-mutex-plus-condvar)
11. [Atomics — the third primitive](#atomics--the-third-primitive)
12. [Performance comparison, measured](#performance-comparison-measured)
13. [Choosing — a decision tree](#choosing--a-decision-tree)
14. [Combining channels and mutexes](#combining-channels-and-mutexes)
15. [Common middle-level mistakes](#common-middle-level-mistakes)
16. [Tricky points](#tricky-points)
17. [Cheat sheet](#cheat-sheet)
18. [Self-assessment checklist](#self-assessment-checklist)
19. [Summary](#summary)
20. [Further reading](#further-reading)

---

## What this file assumes
You can:
- Spawn goroutines, `sync.WaitGroup`-wait for them, run `-race`.
- Fix a data race with `sync.Mutex` or a channel.
- Explain ownership transfer vs shared access in plain terms.

You will learn here:
- Five concrete channel patterns and three mutex patterns.
- The role of `sync/atomic` in the choice.
- How to benchmark a primitive and read the result.
- How to compose channels with mutexes when the problem calls for both.

---

## Channel patterns: pipelines
A pipeline is a chain of goroutines connected by channels. Each stage reads from its input, transforms, and writes to its output.

```go
func ints(ctx context.Context) <-chan int {
    out := make(chan int)
    go func() {
        defer close(out)
        for i := 0; ; i++ {
            select {
            case <-ctx.Done():
                return
            case out <- i:
            }
        }
    }()
    return out
}

func squares(in <-chan int) <-chan int {
    out := make(chan int)
    go func() {
        defer close(out)
        for v := range in {
            out <- v * v
        }
    }()
    return out
}

func sums(in <-chan int) <-chan int {
    out := make(chan int)
    go func() {
        defer close(out)
        total := 0
        for v := range in {
            total += v
            out <- total
        }
    }()
    return out
}

func main() {
    ctx, cancel := context.WithTimeout(context.Background(), 10*time.Millisecond)
    defer cancel()
    for v := range sums(squares(ints(ctx))) {
        fmt.Println(v)
        if v > 1_000_000 {
            break
        }
    }
}
```

Pipeline conventions:
- Each stage returns its output channel.
- Each stage closes its output channel when its input is exhausted.
- A `ctx` (or a separate `done` channel) lets upstream stages stop cleanly.
- Buffer sizes are kept small (often 0 or 1) until profiling justifies more.

A pipeline cannot be expressed with mutexes without inventing a queue type and a condvar — that's exactly what channels *are*.

---

## Channel patterns: worker pools
Workers `range` over an input channel. A single producer (or many) sends jobs. A `sync.WaitGroup` coordinates "all workers done".

```go
type Job struct {
    URL string
}
type Result struct {
    URL    string
    Status int
}

func runPool(jobs <-chan Job, results chan<- Result, workers int) {
    var wg sync.WaitGroup
    for i := 0; i < workers; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            for j := range jobs {
                results <- fetch(j)
            }
        }()
    }
    wg.Wait()
    close(results)
}
```

Calling pattern:

```go
jobs := make(chan Job, 64)
results := make(chan Result, 64)

go runPool(jobs, results, 8)

go func() {
    for _, u := range urls {
        jobs <- Job{URL: u}
    }
    close(jobs)
}()

for r := range results {
    fmt.Println(r)
}
```

Three rules to make worker pools robust:
- One goroutine owns `close(jobs)`. Closing it from a worker is a race.
- A small `runPool` wrapper handles `close(results)` after `wg.Wait()`. Don't put this logic in `main`.
- Bound `jobs`'s capacity to manage memory. Unbounded queues hide backpressure.

A mutex-based work queue is possible — protect a `[]Job` slice with a `sync.Mutex` and use a `sync.Cond` to wait when empty — but it's three times the code and harder to get right. Channels are the right tool here.

---

## Channel patterns: semaphores
A buffered channel of capacity N is a counting semaphore. Holders "acquire" by sending; "release" by receiving.

```go
type Sem chan struct{}

func New(n int) Sem            { return make(Sem, n) }
func (s Sem) Acquire()         { s <- struct{}{} }
func (s Sem) Release()         { <-s }

func main() {
    sem := New(3) // max 3 concurrent

    var wg sync.WaitGroup
    for _, u := range urls {
        wg.Add(1)
        go func(u string) {
            defer wg.Done()
            sem.Acquire()
            defer sem.Release()
            fetch(u)
        }(u)
    }
    wg.Wait()
}
```

This bounds the number of concurrent `fetch` calls to 3 without a mutex anywhere. The Go memory model guarantees the (k+N)-th send happens-after the k-th receive — that's exactly a counting semaphore.

The channel form also integrates with `select` for timeouts:

```go
func (s Sem) AcquireCtx(ctx context.Context) error {
    select {
    case s <- struct{}{}:
        return nil
    case <-ctx.Done():
        return ctx.Err()
    }
}
```

A mutex-based equivalent needs a `sync.Cond`, a counter, and a Goroutine-poked timer. It's more code and harder to cancel.

---

## Channel patterns: reply channels
A request goroutine sends a value *and* a reply channel; the server processes the request and writes the answer on the reply channel. This is how you build "ask a goroutine a question".

```go
type req struct {
    key   string
    reply chan int
}

type Counter struct {
    reqs   chan req
    addOps chan int
}

func NewCounter() *Counter {
    c := &Counter{
        reqs:   make(chan req),
        addOps: make(chan int),
    }
    go c.run()
    return c
}

func (c *Counter) run() {
    counts := map[string]int{}
    for {
        select {
        case r := <-c.reqs:
            r.reply <- counts[r.key]
        case k := <-c.addOps:
            counts[k]++
        }
    }
}

func (c *Counter) Inc(key string)   { c.addOps <- key }
func (c *Counter) Get(key string) int {
    r := req{key: key, reply: make(chan int)}
    c.reqs <- r
    return <-r.reply
}
```

Pattern points:
- The reply channel is allocated *per call*, often with capacity 1 so the server can write without waiting.
- The server's `select` interleaves reads and writes; no mutex is needed because all state lives inside the one goroutine.
- The cost is the per-call channel allocation. For hot paths, this can dominate — a mutex-protected map may be cheaper. Measure.

A mutex-based equivalent:

```go
type Counter struct {
    mu     sync.Mutex
    counts map[string]int
}
func (c *Counter) Inc(k string) { c.mu.Lock(); c.counts[k]++; c.mu.Unlock() }
func (c *Counter) Get(k string) int {
    c.mu.Lock(); defer c.mu.Unlock()
    return c.counts[k]
}
```

Half the lines, faster, and equally correct. The reply-channel form earns its keep only when the server is doing *more* than a map lookup — when there are real invariants to maintain across multiple fields. Otherwise, ship the mutex.

---

## Channel patterns: fan-out and fan-in

**Fan-out.** N goroutines reading from one channel. Trivial: just start them.

**Fan-in.** One channel collecting from N goroutines. Two ways:

```go
// 1. Reusing one channel — every producer writes to it.
results := make(chan int)
var wg sync.WaitGroup
for i := 0; i < N; i++ {
    wg.Add(1)
    go func() {
        defer wg.Done()
        results <- compute()
    }()
}
go func() { wg.Wait(); close(results) }()
for r := range results {
    fmt.Println(r)
}
```

```go
// 2. Merging N input channels into one (when each producer owns its channel).
func merge(cs ...<-chan int) <-chan int {
    out := make(chan int)
    var wg sync.WaitGroup
    wg.Add(len(cs))
    for _, c := range cs {
        go func(c <-chan int) {
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

Use form 1 for worker pools. Use form 2 when each producer has a distinct lifecycle (e.g. one channel per database, one per user session).

---

## Channel patterns: timeouts and cancellation with select
`select` is the channel `switch`. It picks one ready case; if none is ready, it blocks until one is.

```go
select {
case msg := <-ch:
    handle(msg)
case <-time.After(5 * time.Second):
    return errors.New("timeout")
case <-ctx.Done():
    return ctx.Err()
}
```

Three rules:
1. **If multiple cases are ready, the runtime picks one pseudo-randomly.** You cannot rely on case order.
2. **A `default:` case runs when no other case is ready.** It turns `select` non-blocking. Use it for "poll without waiting".
3. **A `nil` channel disables its case.** Setting `ch = nil` is the idiomatic way to remove a case from a long-running `select` loop.

`time.After` returns a channel. It's fine for one-shot use, but in a loop it leaks: every iteration allocates a new timer that stays alive for the duration. Inside hot loops, use `time.NewTimer` once and `Reset`. We'll cover the leak in `find-bug.md`.

---

## Mutex patterns: read-write mutex
`sync.RWMutex` allows many readers OR one writer:

```go
type Snapshot struct {
    mu sync.RWMutex
    m  map[string]int
}

func (s *Snapshot) Get(k string) int {
    s.mu.RLock(); defer s.mu.RUnlock()
    return s.m[k]
}
func (s *Snapshot) Set(k string, v int) {
    s.mu.Lock(); defer s.mu.Unlock()
    s.m[k] = v
}
```

When does `RWMutex` pay off? When **all three** are true:
- Reads dominate (think 10x or 100x more reads than writes).
- The read-side critical section does meaningful work — not just one integer load.
- You measured the workload and confirmed `RWMutex` is faster than plain `Mutex` *and* faster than `atomic.Pointer[T]`.

When it doesn't pay off:
- Short critical sections (single integer or pointer load) — the RWMutex bookkeeping cost (an atomic CAS on a reader counter shared across CPUs) dominates the savings.
- High write rate — writers wait for *all* readers to drain, which can starve.
- When `atomic.Pointer[T]` would work — readers do a single MOV and pay nothing for the rare writer.

We benchmark these in `optimize.md`.

---

## Mutex patterns: sync.Map
`sync.Map` is a built-in concurrent map. Its documented use cases (from `src/sync/map.go`):
> "(1) when the entry for a given key is only ever written once but read many times, as in caches that only grow, or (2) when multiple goroutines read, write, and overwrite entries for disjoint sets of keys."

API:

```go
var m sync.Map
m.Store("k", 1)
v, ok := m.Load("k")
m.Delete("k")
m.LoadOrStore("k", 2)
m.Range(func(k, v any) bool { return true })
```

Two production warnings:
- **Untyped.** Keys and values are `any`. You'll write type assertions everywhere. Wrap in a typed struct if you must use it.
- **Not always faster.** `sync.Map` has overhead per operation. For workloads outside its two documented cases — and many real workloads are mixed read/write on shared keys — a plain `map` under `sync.RWMutex` (or sharded) outperforms it.

Default reach for a concurrent map: `map + sync.RWMutex`. Reach for `sync.Map` only when profiling shows you're in one of its two sweet spots.

---

## Mutex patterns: hybrid mutex plus condvar
Some problems need "wait until a condition is true" — for example, a bounded queue with a "wait while full" guard. The primitive is `sync.Cond`:

```go
type BoundedQueue struct {
    mu       sync.Mutex
    notEmpty *sync.Cond
    notFull  *sync.Cond
    items    []int
    capacity int
}

func New(cap int) *BoundedQueue {
    q := &BoundedQueue{capacity: cap}
    q.notEmpty = sync.NewCond(&q.mu)
    q.notFull = sync.NewCond(&q.mu)
    return q
}

func (q *BoundedQueue) Push(v int) {
    q.mu.Lock(); defer q.mu.Unlock()
    for len(q.items) == q.capacity {
        q.notFull.Wait()
    }
    q.items = append(q.items, v)
    q.notEmpty.Signal()
}

func (q *BoundedQueue) Pop() int {
    q.mu.Lock(); defer q.mu.Unlock()
    for len(q.items) == 0 {
        q.notEmpty.Wait()
    }
    v := q.items[0]
    q.items = q.items[1:]
    q.notFull.Signal()
    return v
}
```

But — this is *exactly* what a buffered channel does:

```go
q := make(chan int, capacity)
q <- v   // Push, blocks if full
v := <-q // Pop, blocks if empty
```

`sync.Cond` exists for the cases where channels don't fit — typically when the "wake" condition is *not* a value being added or removed (e.g. "wake when the configuration has been reloaded"). In everyday code, `sync.Cond` is rare. If you're reaching for it, ask whether a channel would be cleaner.

---

## Atomics — the third primitive
`sync/atomic` provides single-word atomic operations with no scheduler involvement. Since Go 1.19, the typed wrappers (`atomic.Int64`, `atomic.Uint64`, `atomic.Pointer[T]`, `atomic.Bool`) are the idiomatic API:

```go
var n atomic.Int64
n.Add(1)
v := n.Load()
n.Store(42)
swapped := n.CompareAndSwap(42, 100)
```

When to use atomics:
- Counters (`atomic.Int64`).
- Flags (`atomic.Bool`).
- Pointers to immutable snapshots (`atomic.Pointer[T]`).
- Single-word values where no compound invariant needs protecting.

Atomics are *faster* than mutexes for these patterns by 5–50x (no scheduler hop, no lock acquisition — one CPU instruction). They are *not* a general substitute for mutexes: you cannot atomically update two fields together.

A common pattern: read-mostly config with hot reload.

```go
type Config struct {
    Timeout time.Duration
    Backend string
}

type Server struct {
    cfg atomic.Pointer[Config]
}

func (s *Server) Handle() {
    c := s.cfg.Load()        // pointer load — sub-nanosecond
    use(c.Timeout, c.Backend)
}

func (s *Server) Reload(c *Config) {
    s.cfg.Store(c)            // atomic pointer store
}
```

Readers never block. The writer never blocks readers. The "trick" is that `*Config` is treated as immutable — `Reload` constructs a new one rather than mutating the old.

---

## Performance comparison, measured
On `go1.22 darwin/arm64 M1 Pro`, single-process, 32 goroutines:

| Operation | ns/op |
|---|---|
| `atomic.Int64.Add(1)` | 6 |
| `mu.Lock(); n++; mu.Unlock()` | 30 (uncontended), 100 (contended) |
| `rwmu.RLock(); _ = m[k]; rwmu.RUnlock()` (short section) | 40 |
| `ch <- v` paired with `v := <-ch` on size-1 chan | 80 |
| `ch <- v` paired with `v := <-ch` on unbuffered chan | 120 |
| Reply-channel round trip | 350 |
| `selectgo` with 2 cases ready | 60 |

These numbers do not generalise to "always use atomics". They establish *relative cost* per operation. For a counter that runs 1 million times per second, choosing an atomic over a channel saves 50% CPU. For a counter that runs 10 times per second, the choice is invisible — pick whichever expresses intent better.

The most important rule: **measure your actual workload before optimising.** Microbenchmarks lie because they measure the primitive in isolation; real code has cache effects, work between operations, and contention patterns that change everything.

---

## Choosing — a decision tree
Walk it top to bottom; first match wins.

1. **Does the operation modify a single integer, bool, or pointer?**
   → `sync/atomic`.

2. **Are you transferring ownership of a value from one goroutine to another?**
   → channel.

3. **Are you broadcasting a one-shot signal to many goroutines?**
   → `close(chan struct{})` or `context.Context`.

4. **Are you serialising access to in-place state with a multi-field invariant?**
   → `sync.Mutex` (or `RWMutex` if reads dominate *and* read sections are non-trivial).

5. **Is the state read 100x more than written and is the writer rare?**
   → `atomic.Pointer[T]` with immutable snapshots.

6. **Do you need to wait for an arbitrary condition?**
   → can you express it as a channel? if not, `sync.Cond` (rare).

If you reach the end of the tree without a match, the design is unusual — slow down and write the invariant down explicitly.

---

## Combining channels and mutexes
Real systems use both. The split:
- **Channels carry events** between subsystems.
- **Mutexes protect shared state** inside one subsystem.

Example: a webhook delivery system.

```go
type Delivery struct {
    URL string
    Body []byte
}

type Service struct {
    queue   chan Delivery        // channel: events in
    stats   stats                // mutex-protected: shared metrics
}

type stats struct {
    mu        sync.Mutex
    sent      int64
    failed    int64
}

func (s *Service) run() {
    for d := range s.queue {           // channel ownership transfer
        if err := s.post(d); err != nil {
            s.stats.mu.Lock()           // mutex on shared metrics
            s.stats.failed++
            s.stats.mu.Unlock()
        } else {
            s.stats.mu.Lock()
            s.stats.sent++
            s.stats.mu.Unlock()
        }
    }
}
```

The channel carries the work; the mutex protects the metrics that any goroutine (including a `/metrics` HTTP handler) might read.

A different split would be wrong. Replacing the channel with a mutex-protected `[]Delivery` adds 50 lines of `Cond` plumbing for no benefit. Replacing the mutex with a channel to "ask the stats goroutine" turns every metric read into a scheduler hop.

---

## Common middle-level mistakes
1. **`time.After` in a loop.** Allocates a timer every iteration. Use `time.NewTimer` outside the loop and `Reset`.
2. **Forgetting to drain a buffered channel before closing.** Closing is fine even with pending values — receivers will drain. The mistake is forgetting that *senders* must not run after close.
3. **Returning `<-chan T` from a method that doesn't own the channel.** If the caller can close it, you have a race over who closes. The convention is: the goroutine that *creates* the channel via `make` is the one that closes it.
4. **Using `sync.Map` reflexively.** It's a tool, not the default. Plain `map + sync.Mutex` is the right starting point.
5. **`RWMutex` with single-load critical sections.** Slower than plain `Mutex` because of bookkeeping. Benchmark.
6. **Mutex held during I/O.** A handler that holds a lock while calling out to a database serialises all other handlers behind it. Release the lock first, copy the data out, then do I/O.
7. **Goroutine leaks from unbounded channels.** A consumer that exits early can leave a producer blocked on send. Either bound the channel and add a context for cancellation, or close the input from the consumer side via a side-channel.

---

## Tricky points
- **`select` with one case** is the same as a plain receive but pays for `selectgo` overhead (~30 ns extra). Don't write `select { case v := <-ch: ... }` — just write `v := <-ch`.
- **A buffered channel's k-th receive happens-before the (k+C)-th send.** That's the memory model guarantee for "buffered channel as semaphore". Worth reading once and trusting forever.
- **`sync.RWMutex` upgrade is not supported.** Holding `RLock` and trying to `Lock` will deadlock. Release the read lock first, then `Lock` (and re-check the invariant — another goroutine may have changed state between your unlock and lock).
- **`sync.Mutex` is fair-ish.** Starvation mode (Go 1.9+) kicks in if a waiter waits >1ms; then the mutex hands off to waiters in FIFO order. You almost never need to think about it, but it's why your contended benchmarks plateau instead of starving.

---

## Cheat sheet

| Problem | Primitive |
|---|---|
| Counter | `atomic.Int64` |
| Boolean flag | `atomic.Bool` |
| Read-mostly snapshot | `atomic.Pointer[T]` |
| Map, mixed access | `map + sync.Mutex` |
| Map, dominantly read | `map + sync.RWMutex` (if read section is non-trivial) |
| Map, write-once read-many | `sync.Map` |
| Producer → consumer | `chan T` |
| Worker pool | `chan Job` + `sync.WaitGroup` |
| Counting semaphore | `chan struct{}` of capacity N |
| Fan-out signal | `close(chan struct{})` |
| Cancellation | `context.Context` (channel underneath) |
| Per-call ask-a-goroutine | reply `chan T` |

---

## Self-assessment checklist
- [ ] I can build a pipeline of 3 stages with `ctx`-based cancellation.
- [ ] I can build a worker pool with `runPool(jobs, results, workers)`.
- [ ] I can implement a counting semaphore in three lines with `chan struct{}`.
- [ ] I know when `RWMutex` is faster than `Mutex` and when it's slower.
- [ ] I know `sync.Map`'s two documented use cases and don't reach for it elsewhere.
- [ ] I can choose between `sync.Mutex`, `sync/atomic`, and `chan T` for any single-operation scenario.
- [ ] I use `defer mu.Unlock()` and I don't hold a mutex during I/O.
- [ ] I benchmark before optimising.

---

## Summary
Channels carry values; mutexes protect in-place state; atomics handle single words. Each has a sweet spot and a pathological case. The defaults at this level:
- Counter: atomic.
- Flag: atomic.
- Shared map: `map + sync.Mutex` (or sharded if hot).
- Producer/consumer: channel.
- Fan-out signal: closed channel or `context.Context`.

Reach for `RWMutex` only when reads dominate *and* the read section is non-trivial. Reach for `sync.Map` only when your access pattern matches its two documented cases. Reach for `sync.Cond` only when channels don't fit.

In `senior.md` we'll move from picking a primitive to refactoring real code from one primitive to another, with concrete before/after measurements and the production decision frameworks that justify the change.

---

## Further reading
- "Go Concurrency Patterns: Pipelines and cancellation" — https://go.dev/blog/pipelines
- `src/sync/map.go` — read the doc comment at the top
- `src/sync/rwmutex.go` — short, illustrative
- Bryan C. Mills, "Rethinking Classical Concurrency Patterns" (GopherCon talk)
- Dave Cheney, "Channels are not a replacement for mutexes" (blog post)

---

[← Back](../)
