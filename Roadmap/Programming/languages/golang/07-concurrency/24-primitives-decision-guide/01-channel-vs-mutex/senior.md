---
layout: default
title: Channels vs Mutexes — Senior
parent: Channels vs Mutexes
grand_parent: Primitives Decision Guide
ancestor: Go
nav_order: 4
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/24-primitives-decision-guide/01-channel-vs-mutex/senior/
---

# Channels vs Mutexes — Senior

[← Back](../)

## Table of contents
1. [What this file is](#what-this-file-is)
2. [A production decision framework](#a-production-decision-framework)
3. [The cost model of each primitive](#the-cost-model-of-each-primitive)
4. [When to combine channels and mutexes](#when-to-combine-channels-and-mutexes)
5. [Refactor case study 1 — counter, mutex to atomic](#refactor-case-study-1--counter-mutex-to-atomic)
6. [Refactor case study 2 — work queue, mutex slice to channel](#refactor-case-study-2--work-queue-mutex-slice-to-channel)
7. [Refactor case study 3 — read-mostly cache, RWMutex to atomic snapshot](#refactor-case-study-3--read-mostly-cache-rwmutex-to-atomic-snapshot)
8. [Refactor case study 4 — actor to mutex](#refactor-case-study-4--actor-to-mutex)
9. [Refactor case study 5 — channel signal to context cancellation](#refactor-case-study-5--channel-signal-to-context-cancellation)
10. [Library API design implications](#library-api-design-implications)
11. [Channels in public APIs — the long-term commitment](#channels-in-public-apis--the-long-term-commitment)
12. [Mutexes in struct fields — visibility rules](#mutexes-in-struct-fields--visibility-rules)
13. [Backpressure as a first-class concern](#backpressure-as-a-first-class-concern)
14. [Observing concurrency in production](#observing-concurrency-in-production)
15. [Anti-patterns at scale](#anti-patterns-at-scale)
16. [Tricky points](#tricky-points)
17. [Cheat sheet](#cheat-sheet)
18. [Self-assessment checklist](#self-assessment-checklist)
19. [Summary](#summary)
20. [Further reading](#further-reading)

---

## What this file is
You can already pick a primitive in straightforward cases. This file is about the messy cases: when the right answer changes after measurement, when a system grows past its first choice, when two engineers disagree, when an API decision today constrains a refactor in two years.

We'll walk through five refactors with before/after code and the numbers that justified the change. We'll cover library-API implications — what `<-chan T` in a public signature commits you to, what a `sync.Mutex` field commits you to. And we'll close on observability: how to *see* what your concurrency primitives are doing in production.

---

## A production decision framework

Real teams need a shared framework, not personal taste. Here is the one we've found works:

**Step 1 — What is the data's ownership story?**
Write one sentence describing who is allowed to read and write the data.
- "One goroutine owns it; others ask via messages." → channel + actor.
- "Many goroutines update it in place; the update has invariants across fields." → mutex.
- "Many goroutines update it in place; the update is a single read-modify-write on one word." → atomic.
- "It's a snapshot that many read and one rarely replaces." → `atomic.Pointer[T]`.
- "It moves from one goroutine to another." → channel.

If you can't write the sentence, you don't understand the design well enough to pick a primitive. Slow down.

**Step 2 — How hot is the access?**
A primitive that costs 100 ns matters at 1 million ops/sec (10% CPU on one core). It doesn't matter at 1000 ops/sec (negligible). The same code can be "fine" or "the bottleneck" depending on workload.

**Step 3 — What is the fallback if the primitive is contended?**
If 100 goroutines all hit the same mutex, what happens?
- For a counter: they queue up; throughput collapses; fix is `atomic`.
- For a map: they queue up; fix is sharding.
- For a channel pipeline stage: producers block; fix is more buffer or more consumers — but think about whether buffer hides backpressure.

The framework is: write the sentence, measure the cost, decide what the failure mode is. Most teams skip step 3, which is why they discover their concurrency choice was wrong only when production fails.

---

## The cost model of each primitive

| Primitive | Uncontended | Contended (waiters) | Fan-out |
|---|---|---|---|
| `atomic.Add` | 5 ns | 5–30 ns | n/a (each CPU pays separately) |
| `atomic.Load` | <1 ns | <1 ns | n/a |
| `sync.Mutex.Lock`/`Unlock` | 5 ns (one CAS) | 50–1000 ns (park) | one waiter wakes per `Unlock` |
| `sync.RWMutex.RLock`/`RUnlock` | 10 ns | 30–300 ns | n/a |
| `chan T` send/recv buffered | 20 ns | 100–500 ns | one waiter wakes per send |
| `chan T` send/recv unbuffered | 50 ns | 100–1000 ns | one waiter wakes per send |
| `close(chan)` | O(N waiters) | O(N) | **all waiters wake** |
| `selectgo` with K cases | ~30 ns + 10 ns/case | 100 ns+ | one case fires |
| `sync.Map.Load` (hit on read map) | ~10 ns | ~10 ns | n/a |
| `sync.Map.Store` (new key) | ~250 ns | depends | n/a |

Numbers are M1 Pro, Go 1.22; your hardware varies but the *ratios* are stable. The single most important takeaway: **the only primitive with cheap fan-out is `close(chan)`**. That's why `context.Context` is built on a channel — cancellation is the prototypical fan-out signal.

---

## When to combine channels and mutexes

A reliable rule: **channels carry events between subsystems; mutexes protect shared state inside a subsystem.**

Example: a job processor that exports Prometheus metrics.

```go
type Processor struct {
    jobs   chan Job              // events in
    stats  *Stats                // shared state out
}

type Stats struct {
    mu          sync.Mutex
    inProgress  int
    completed   uint64
    failed      uint64
}

func (s *Stats) Begin()              { s.mu.Lock(); s.inProgress++; s.mu.Unlock() }
func (s *Stats) End(ok bool) {
    s.mu.Lock()
    s.inProgress--
    if ok { s.completed++ } else { s.failed++ }
    s.mu.Unlock()
}

func (p *Processor) run() {
    for j := range p.jobs {
        p.stats.Begin()
        err := process(j)
        p.stats.End(err == nil)
    }
}
```

The channel carries jobs from caller to processor. The mutex protects stats from *any* goroutine that might read them — including the `/metrics` HTTP handler that runs on a separate goroutine.

If you replaced the channel with a mutex-protected `[]Job`, you'd reinvent a queue. If you replaced the mutex with a channel to "ask the stats goroutine", every `/metrics` call would pay a scheduler hop.

The combination is the right design. **Senior code uses both — frequently in the same struct.**

---

## Refactor case study 1 — counter, mutex to atomic

A service had a request counter:

```go
type Server struct {
    mu       sync.Mutex
    reqCount int64
}

func (s *Server) handle() {
    s.mu.Lock()
    s.reqCount++
    s.mu.Unlock()
    // ... work ...
}
```

Profile under 100k req/s showed `sync.(*Mutex).Lock` and `sync.(*Mutex).Unlock` together at 4% CPU. The critical section is `s.reqCount++` — one increment.

**Refactor.**

```go
type Server struct {
    reqCount atomic.Int64
}

func (s *Server) handle() {
    s.reqCount.Add(1)
    // ... work ...
}
```

**Measured impact.** Combined CPU dropped from 4% to 0.2%. p99 latency improved by 50 µs (the contended mutex was a long tail). Code shorter and clearer.

**Why this works.** A counter's invariant is "the integer is monotonic". `atomic.Add` provides exactly that atomically. The mutex was over-engineering.

**When this *wouldn't* work.** If the increment is paired with another update — say, "increment `reqCount` and update `lastReqTime`" — you need a mutex (or two atomics with a documented "neither read is consistent with the other" caveat).

---

## Refactor case study 2 — work queue, mutex slice to channel

A scheduler started life as:

```go
type Sched struct {
    mu    sync.Mutex
    cond  *sync.Cond
    queue []Task
}

func (s *Sched) Push(t Task) {
    s.mu.Lock(); defer s.mu.Unlock()
    s.queue = append(s.queue, t)
    s.cond.Signal()
}

func (s *Sched) Run() {
    for {
        s.mu.Lock()
        for len(s.queue) == 0 {
            s.cond.Wait()
        }
        t := s.queue[0]
        s.queue = s.queue[1:]
        s.mu.Unlock()
        execute(t)
    }
}
```

It worked. But it was 30 lines of `Cond` plumbing, and graceful shutdown ("drain the queue then exit") required adding a shutdown flag, a check in `Run`, and a documented order of `Signal` to wake the runner.

**Refactor.**

```go
type Sched struct {
    queue chan Task
}

func New() *Sched { return &Sched{queue: make(chan Task, 1024)} }

func (s *Sched) Push(t Task) { s.queue <- t }

func (s *Sched) Run(ctx context.Context) {
    for {
        select {
        case t := <-s.queue:
            execute(t)
        case <-ctx.Done():
            return
        }
    }
}

func (s *Sched) Stop() { close(s.queue) }
```

**Measured impact.** Code halved. Latency identical. Shutdown is now `cancel()` (drains nothing) or `close(s.queue)` (drains everything via `range` in a slightly different runner). One bug class — forgetting to `Signal` after `Push` — eliminated entirely.

**When this *wouldn't* work.** If the queue needed priority ordering, or "take the most recent task and drop older ones", or "pop in batches" — those aren't channel semantics. A `chan` is FIFO; that's its only ordering guarantee. For other orderings, you need a heap + mutex, or a priority queue library.

---

## Refactor case study 3 — read-mostly cache, RWMutex to atomic snapshot

A service had a route table read on every request and reloaded every minute:

```go
type Router struct {
    mu     sync.RWMutex
    routes map[string]Handler
}

func (r *Router) Route(path string) Handler {
    r.mu.RLock(); defer r.mu.RUnlock()
    return r.routes[path]
}

func (r *Router) Reload(rs map[string]Handler) {
    r.mu.Lock()
    r.routes = rs
    r.mu.Unlock()
}
```

At 100k req/s, the `RLock`/`RUnlock` overhead was visible (~30 ns per call → 0.3% CPU). More importantly, the reader-counter cache line was contended across all CPU cores. p99 latency had a small tail correlated with reload.

**Refactor.**

```go
type Router struct {
    routes atomic.Pointer[map[string]Handler]
}

func (r *Router) Route(path string) Handler {
    return (*r.routes.Load())[path]
}

func (r *Router) Reload(rs map[string]Handler) {
    r.routes.Store(&rs)
}
```

**Measured impact.** Read latency dropped from ~30 ns to ~1 ns. Reload-correlated tail latency vanished — readers never coordinate with the writer at all.

**The key insight.** The map was treated as immutable from the consumer's side: nobody mutated it after construction, only `Reload` replaced it wholesale. Once you have that property, an atomic pointer is strictly better than `RWMutex`: same correctness, zero reader-side contention.

**When this *wouldn't* work.** If individual route entries were updated in place, you can't replace the whole map — the atomic-snapshot trick relies on construct-new-and-swap.

---

## Refactor case study 4 — actor to mutex

The opposite direction. A team had an actor pattern wrapping a session table:

```go
type SessionStore struct {
    reqs chan sessReq
}

type sessReq struct {
    op    string  // "get", "set", "delete"
    key   string
    val   *Session
    reply chan *Session
}

func (s *SessionStore) run() {
    m := map[string]*Session{}
    for r := range s.reqs {
        switch r.op {
        case "get":
            r.reply <- m[r.key]
        case "set":
            m[r.key] = r.val
            r.reply <- nil
        case "delete":
            delete(m, r.key)
            r.reply <- nil
        }
    }
}

func (s *SessionStore) Get(k string) *Session {
    r := sessReq{op: "get", key: k, reply: make(chan *Session, 1)}
    s.reqs <- r
    return <-r.reply
}
```

This was idiomatic-looking but slow. Every `Get` allocated a reply channel and paid two scheduler hops. Profiling showed `chansend` and `chanrecv` at 8% CPU.

**Refactor.**

```go
type SessionStore struct {
    mu sync.RWMutex
    m  map[string]*Session
}

func (s *SessionStore) Get(k string) *Session {
    s.mu.RLock(); defer s.mu.RUnlock()
    return s.m[k]
}
func (s *SessionStore) Set(k string, v *Session) {
    s.mu.Lock(); defer s.mu.Unlock()
    s.m[k] = v
}
```

**Measured impact.** CPU recovered. Latency improved. Code shorter.

**Why this works.** The "actor" wasn't doing anything an actor needs to do — no multi-step invariants, no message ordering across keys, no fairness policy. It was a thread-safe map dressed up as an actor. Channels were the wrong primitive for the job.

**Lesson.** Actors are valuable when there is *real* serialisation work — when the state has invariants that span multiple fields, or when you want a clear single-threaded bottleneck for tracing. For "thread-safe map", the mutex is the right answer.

---

## Refactor case study 5 — channel signal to context cancellation

Old code:

```go
type Service struct {
    stop chan struct{}
}

func (s *Service) Run() {
    for {
        select {
        case <-s.stop:
            return
        default:
            s.work()
        }
    }
}

func (s *Service) Stop() { close(s.stop) }
```

This worked. But the service spawned 10 sub-tasks (workers, periodic reporters, etc.), each of which needed its own stop channel — or a copy of `s.stop`. Multiple goroutines needed to learn about cancellation, often from a deeper call stack.

**Refactor.**

```go
type Service struct {
    ctx    context.Context
    cancel context.CancelFunc
}

func New() *Service {
    ctx, cancel := context.WithCancel(context.Background())
    return &Service{ctx: ctx, cancel: cancel}
}

func (s *Service) Run() {
    for {
        select {
        case <-s.ctx.Done():
            return
        default:
            s.work(s.ctx)
        }
    }
}

func (s *Service) Stop() { s.cancel() }
```

Now every sub-call takes a context. Deep functions can branch with their own `WithTimeout`, `WithDeadline`, `WithCancel`. The same primitive carries deadlines and cancellation. The HTTP server and database driver natively understand it.

**Measured impact.** No measurable performance change — `context.Context` is built on the same channel as before. The win is *integration*: every standard-library API takes `ctx context.Context`.

**Lesson.** Public-facing concurrency control should use `context.Context`. Private internal signalling can use `chan struct{}` directly. Don't expose your stop channel.

---

## Library API design implications

When you're writing code for *yourself*, the choice between channel and mutex is reversible. When you're writing a library, it's a commitment.

**A method returning `<-chan T` commits the library to:**
- A buffer size (or its absence). Changing it breaks consumers' burst handling.
- Close semantics. Will the channel close? When? After an error? On context cancel?
- Ordering. FIFO is guaranteed; nothing else is.
- The "drain or leak" contract. If a consumer stops reading, the producer goroutine blocks.

**A struct field of type `sync.Mutex` commits the library to:**
- Pointer receivers everywhere. Once locked, the struct cannot be copied.
- Visibility. Library users see the mutex if it's exported (rare). They don't see it if unexported, but `go vet` will catch mistakes.
- No `Lock`/`Unlock` in the public API. A library exposing `Lock()` is usually mis-designed — users should call methods that internally lock.

**A method taking `context.Context` commits to:**
- Honouring `ctx.Done()`. The method should return promptly when context is cancelled.
- Honouring `ctx.Err()` for the error returned on cancellation.
- Not storing the context in a struct field. `context.Context` is a per-call value.

These commitments are *long-lived*. A library that publishes `<-chan Event` and then wants to add per-subscriber filtering needs a breaking change. A library that publishes `OnEvent(func(Event))` adds the filter as another parameter.

---

## Channels in public APIs — the long-term commitment

Look at the standard library:
- `net/http`: no `<-chan` in any public method. Everything is callbacks (`http.Handler`) or per-call returns.
- `os/signal`: `Notify(c chan<- os.Signal, sig ...os.Signal)` — the caller owns the channel, the library writes to it.
- `time`: `time.After(d) <-chan time.Time`, `Ticker.C <-chan time.Time` — channel ownership is documented (`After` channel never closes; `Ticker.Stop` doesn't close `C` either).
- `database/sql`: no channels in the public API. Everything is `context.Context`-aware and call-blocking.

The pattern: **channels in public APIs only when the channel's purpose is exactly "an event stream the caller will range over"**. Otherwise, callbacks or blocking-with-context.

When you find yourself wanting to publish a `<-chan T`, ask:
- What if the consumer wants to filter by type? (Filtering on a channel requires another goroutine.)
- What if the consumer wants to backpressure? (A channel forces buffer choice; a callback can return an error.)
- What if the consumer wants ordering or batching? (Channels are FIFO only; batching requires another goroutine.)

If any of those matter, use a callback. If none matter (events are uniform, fire-and-forget), a channel is fine.

---

## Mutexes in struct fields — visibility rules

Three rules accrued from production code:

**Rule 1: Put the mutex next to what it protects.**

```go
type Cache struct {
    mu sync.Mutex
    m  map[string]string   // protected by mu
    // unrelated fields below
    expiry time.Duration
}
```

The comment "protected by mu" is real code documentation. Readers learn what the lock covers. If `expiry` is also mutable, either lock it too (and document) or use a separate mutex.

**Rule 2: Don't embed `sync.Mutex` anonymously in exported types.**

```go
// BAD — exposes Lock/Unlock to external callers
type Cache struct {
    sync.Mutex
    m map[string]string
}
```

Anonymous embedding promotes `Lock` and `Unlock` to the outer type. Now any caller can do `cache.Lock()` and hold the lock for as long as they like — a recipe for production deadlocks. Always name the field: `mu sync.Mutex`.

**Rule 3: Mutex ordering — lock in a consistent order, document it.**

When a piece of code needs two mutexes, *always* acquire them in the same order across the codebase. The standard convention: by address (lock the one at the lower memory address first), or by name (alphabetical), or by ownership hierarchy (outer object's lock first). The choice doesn't matter; consistency does. Otherwise: deadlock when two goroutines acquire in opposite orders.

---

## Backpressure as a first-class concern

Backpressure is "if the consumer is slow, the producer should slow down too". Channels implement it implicitly: a full buffer makes the producer wait. Mutexes do not — you can `Lock`/`Unlock` forever, the lock has no notion of "queue full".

When designing a pipeline, decide the backpressure policy explicitly:
- **Block the producer.** Default for channels — `ch <- v` blocks until there's room. Use for in-process pipelines where the producer is your code.
- **Drop on full.** `select { case ch <- v: default: drop() }`. Use for telemetry, samples, debug events — where losing some is OK.
- **Coalesce.** Replace the queued value with the new one. Useful for "config changed" signals; the consumer only cares about the latest. Implement with a `chan T` of size 1 and a non-blocking-send-then-drain-then-send dance.
- **Spill to disk.** When the queue is full, write overflow to a file. Used by some logging libraries.

If you pick channels without thinking about backpressure, you ship the default ("block the producer") whether it suits the problem or not. Buffered channels postpone the question — they hide backpressure behind a buffer, then suddenly impose it once the buffer fills. **Picking the buffer size is picking the backpressure policy. Picking randomly is picking randomly.**

---

## Observing concurrency in production

Three things you should be measuring in any service that uses these primitives:

**1. Lock contention.** Go's runtime tracks `sync.Mutex` contention if you enable mutex profiling: `runtime.SetMutexProfileFraction(1)` (default 0, sample 1-in-N). Then `pprof` -> `Mutex` view shows you where waiters are queuing.

**2. Goroutine count.** `runtime.NumGoroutine()` exported as a gauge. Trending up = a leak. A flat-but-high number means the system has a parked pool (a worker pool, an `errgroup`, etc.) — fine, but expected.

**3. Channel depth.** No built-in. You add `len(ch)` as a gauge for each interesting channel. A monotonically rising `len(ch)` is a backlog forming.

```go
prometheus.MustRegister(prometheus.NewGaugeFunc(
    prometheus.GaugeOpts{Name: "jobs_queue_depth"},
    func() float64 { return float64(len(s.jobs)) },
))
```

In production, these three signals + p99 latency + CPU profile are sufficient to debug 95% of concurrency-performance issues.

---

## Anti-patterns at scale

1. **The chan-of-1 mutex.** Wrapping every shared field in a `chan T` of capacity 1 for "Go idiom". Slower than `Mutex`, harder to read, no benefit.
2. **The mutex-protected channel.** `mu.Lock(); ch <- v; mu.Unlock()`. The channel already serialises sends. The mutex serialises which goroutine *gets to send first* — but if that's what you need, you usually need a different design.
3. **The unbounded buffered channel.** `make(chan T, 1_000_000)`. Hides backpressure. When the consumer is 2x slow, you OOM 20 minutes later.
4. **The shared `sync.WaitGroup` across phases.** A `WaitGroup` is single-use. Reusing one across phases (`wg.Wait()` then `wg.Add` again) is racy if any other goroutine might call `wg.Add` after `Wait`. Make a fresh one.
5. **The goroutine fountain.** `go func() { ... }()` inside every request handler with no bound. A small DoS or runaway client floods the runtime with millions of goroutines. Bound concurrency with a semaphore or a worker pool.
6. **The leaked goroutine on disconnect.** A handler that spawns a goroutine to do background work and doesn't pass `r.Context()` — the goroutine outlives the request. Multiply by a year of traffic.
7. **The "concurrent map" that isn't.** Calling `sync.Map` because "it's the concurrent map" without checking that your access pattern matches one of its two documented sweet spots.

---

## Tricky points

- **`select` fairness.** When two cases are ready, the runtime picks pseudo-randomly. You cannot encode priority via case order. Implement priority by giving the high-priority case its own outer `select`:

```go
select {
case x := <-priority:
    handle(x)
default:
    select {
    case x := <-priority:
        handle(x)
    case x := <-normal:
        handle(x)
    }
}
```

- **`sync.Pool` and concurrency.** `sync.Pool` is sometimes used as "a free per-goroutine cache". It is not exactly that — items are stolen across goroutines by the GC. Don't rely on goroutine-locality. Don't store anything in a pool that has resource-cleanup obligations (file descriptors, connections).
- **`runtime.Gosched()`.** Hint to the scheduler "you may swap me out". Almost never the right tool. If your concurrent code needs `Gosched` to be correct, the design is wrong.
- **CPU pinning.** Go's scheduler is not aware of CPU topology. NUMA-aware workloads need libraries (or the kernel's `taskset`). Channels and mutexes don't care about CPU; their costs vary mostly with contention, not with topology.

---

## Cheat sheet

A senior-level summary of when each primitive is the *first* reach:

| Pattern | Primitive | Trigger |
|---|---|---|
| Counter | `atomic.Int64` | Single integer, no co-update |
| Boolean flag | `atomic.Bool` | Single bool, no co-update |
| Pointer to immutable snapshot | `atomic.Pointer[T]` | Hot-reloadable config, route table, etc. |
| Shared map, mixed access | `map + sync.Mutex` | Default for concurrent maps |
| Shared map, contended | sharded `map + sync.Mutex[N]` | Profile shows lock contention |
| Shared map, dominantly read | `map + sync.RWMutex` | Reads have non-trivial work |
| Producer/consumer | `chan T` | Pipeline stage |
| Worker pool | `chan Job` + `sync.WaitGroup` | Fixed pool consuming a stream |
| Counting semaphore | `chan struct{}` size N | "At most N concurrent" |
| Fan-out signal | `close(chan)` or `context` | Many receivers, one signal |
| Cancellation | `context.Context` | Anything user-facing or cross-package |
| Long-lived state with invariants | actor (goroutine + channel) | Multi-field consistency matters |

---

## Self-assessment checklist
- [ ] I can write the ownership-story sentence for any piece of shared state in my code.
- [ ] I have refactored at least one production codepath from mutex to atomic (or vice versa) based on profiling.
- [ ] I know the difference between a `<-chan T` and a callback in an API surface.
- [ ] I have a deliberate backpressure policy for every channel in my system.
- [ ] I monitor goroutine count, lock contention, and channel depth in production.
- [ ] I have caught at least one production bug with `go vet`'s `copylocks` check.
- [ ] I know when `atomic.Pointer[T]` beats `RWMutex` and when it doesn't.
- [ ] I know when a `sync.Cond` is appropriate and have not used one this year.
- [ ] I have killed at least one anonymous-embedded `sync.Mutex` in a code review.
- [ ] I have a story for graceful shutdown of every long-running goroutine.

---

## Summary

At the senior level, the choice between channels and mutexes stops being about idiom and starts being about cost, ownership story, and forward compatibility. The framework:

1. Write the ownership sentence.
2. Estimate cost vs workload hotness.
3. Identify the failure mode under contention.
4. Profile when ambiguous.
5. Refactor when the workload shifts.

Real systems combine all three primitives — channels for cross-subsystem events, mutexes for per-subsystem state, atomics for hot single-word access. Libraries commit to their concurrency choices for years; pick channels in public APIs only when the channel is the *purpose* of the API, not its implementation detail.

`professional.md` will go a layer deeper into the runtime — how `hchan` and `sync.Mutex` are actually implemented, why their cost curves look the way they do, and the production war stories that illustrate it.

---

## Further reading

- "Bryan C. Mills — Rethinking Classical Concurrency Patterns" (GopherCon 2018 talk)
- "Sameer Ajmani — Advanced Go Concurrency Patterns" (Google I/O talk)
- `src/runtime/chan.go` — the entire channel implementation, ~700 lines
- `src/sync/mutex.go` — the entire mutex implementation, ~250 lines
- Dmitry Vyukov on lock-free data structures: https://www.1024cores.net/
- Kavya Joshi — "Understanding Channels" (GopherCon)

---

[← Back](../)
