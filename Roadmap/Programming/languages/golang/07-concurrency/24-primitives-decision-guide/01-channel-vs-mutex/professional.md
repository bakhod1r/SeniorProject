---
layout: default
title: Channels vs Mutexes — Professional
parent: Channels vs Mutexes
grand_parent: Primitives Decision Guide
ancestor: Go
nav_order: 5
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/24-primitives-decision-guide/01-channel-vs-mutex/professional/
---

# Channels vs Mutexes — Professional

[← Back](../)

## Table of contents
1. [Audience and scope](#audience-and-scope)
2. [What the proverb actually meant](#what-the-proverb-actually-meant)
3. [Channel internals at a glance](#channel-internals-at-a-glance)
4. [Mutex internals at a glance](#mutex-internals-at-a-glance)
5. [Microbenchmark traps](#microbenchmark-traps)
6. [War story 1 — chan-of-1 in the hot path](#war-story-1--chan-of-1-in-the-hot-path)
7. [War story 2 — RWMutex starving on a flat counter](#war-story-2--rwmutex-starving-on-a-flat-counter)
8. [War story 3 — buffered channel hiding backpressure](#war-story-3--buffered-channel-hiding-backpressure)
9. [Refactor case study: from mutex to actor](#refactor-case-study-from-mutex-to-actor)
10. [Refactor case study: from actor to atomic snapshot](#refactor-case-study-from-actor-to-atomic-snapshot)
11. [Library API design implications](#library-api-design-implications)
12. [Closing thoughts](#closing-thoughts)

---

## Audience and scope
This file is for people who have already shipped Go services and now have to decide which primitive ships next. It assumes you know the spec-level semantics from `specification.md` and the everyday patterns from `middle.md`. The focus here is *real numbers*, *real bugs*, and the runtime detail behind both.

---

## What the proverb actually meant
Rob Pike, in the 2009 talk "Concurrency is not parallelism" and later in his blog post "Share memory by communicating", proposed the slogan as a *cultural* counterweight to thread-and-lock languages where the only known primitive was a mutex. Channels existed in Go because CSP, but newcomers tended to ignore them in favour of the familiar `sync.Mutex`. The slogan tipped the default.

What it does not say:
- It does not say mutexes are wrong.
- It does not say channels are always faster.
- It does not say `sync` is a deprecated package.

The same `sync` package is part of Go's standard library by intent; the Go team uses `sync.Mutex` everywhere in the runtime. The proverb is a tilt, not a ban.

A more accurate operating rule: **ownership transfer is a channel job; shared in-place mutation is a mutex job; single-word read-modify-write is an atomic job.**

---

## Channel internals at a glance
The relevant file is `src/runtime/chan.go`. Key data:

```go
type hchan struct {
    qcount   uint           // total data in the queue
    dataqsiz uint           // size of the circular queue
    buf      unsafe.Pointer // points to an array of dataqsiz elements
    elemsize uint16
    closed   uint32
    elemtype *_type
    sendx    uint           // send index
    recvx    uint           // receive index
    recvq    waitq          // list of recv waiters
    sendq    waitq          // list of send waiters
    lock     mutex          // protects all fields of hchan
}
```

A send (`chansend`):
1. Acquire `hchan.lock`.
2. If `closed`: release lock, panic.
3. If a receiver is parked on `recvq`: dequeue, copy the value directly into the receiver's stack location, mark it runnable, release lock. (Fast path — no buffer touch.)
4. Else if the buffer has room (`qcount < dataqsiz`): copy into `buf[sendx]`, advance `sendx`, increment `qcount`, release lock.
5. Else: enqueue the sender on `sendq` with its `sudog`, park (`gopark`), release lock.

A receive is the mirror image. The "direct copy" handoff in step 3 is a classical CSP optimisation — the value never lands in the channel's buffer when both sides are ready at the same time.

Costs in nanoseconds (empirical, M1 Pro):
- Send/recv with both sides ready, unbuffered: ~50 ns.
- Send/recv via buffer (no waiters): ~20 ns.
- Send that parks because buffer is full: scheduler hop, ~500–1000 ns.
- `close`: O(N) where N is the number of waiters, since every waiter must be marked runnable.

`select` is implemented by `selectgo` in `src/runtime/select.go`. It builds an array of `scase` records, computes a pseudo-random order, attempts each case under the channel's lock, and if none is ready it enqueues the goroutine on *every* channel's wait queue. When a wakeup arrives, it dequeues the goroutine from all *other* channels' queues. The cost is O(number of cases) for setup and teardown.

---

## Mutex internals at a glance
The file is `src/sync/mutex.go`. The `Mutex` struct is two `int32`s:

```go
type Mutex struct {
    state int32
    sema  uint32
}
```

The `state` word packs four pieces of information into bits:
- `mutexLocked` (bit 0): is the mutex held?
- `mutexWoken` (bit 1): has a sleeping goroutine been signalled?
- `mutexStarving` (bit 2): is the mutex in starvation mode?
- the remaining bits: count of waiters.

The fast path of `Lock`:
```go
if atomic.CompareAndSwapInt32(&m.state, 0, mutexLocked) {
    return
}
```
One CAS. This is *all* that a mutex does in the uncontended case — ~5 ns. If the CAS fails, the slow path enters spinning, then parks on `runtime_SemacquireMutex` using the `sema` word as a futex-like address.

Starvation mode (added in Go 1.9) ensures fairness: if a waiter has been waiting more than 1ms, the mutex switches to a hand-off mode where `Unlock` directly hands ownership to the head of the wait queue without letting newly-arriving goroutines steal it. Without starvation mode, a fast new caller could repeatedly beat the queue.

Cost summary:
- Uncontended `Lock`/`Unlock`: ~5 ns each (one CAS).
- Contended `Lock` (spin and acquire): ~50–100 ns.
- Contended `Lock` that parks: ~500–1000 ns (similar to a channel scheduler hop).
- Uncontended `RWMutex.RLock`/`RUnlock`: ~10 ns each — twice the work of plain `Mutex`.

---

## Microbenchmark traps
Three traps catch every Go engineer who measures channels vs mutexes for the first time.

**1. Empty critical section.** A `mu.Lock(); n++; mu.Unlock()` benchmark measures the *primitive*, not your code. Your code's critical section is *not* empty — it allocates, hashes, reads, writes. Pad the section with `runtime.Gosched()` or a real `*sync.RWMutex`'d map lookup to get representative numbers.

**2. One goroutine.** A benchmark on `GOMAXPROCS=1` shows the fast path only. A mutex looks 4x faster than a channel. Rerun at `-cpu=2,4,8,32` and the picture flips depending on contention.

**3. No work between operations.** `b.RunParallel` with nothing but `mu.Lock(); mu.Unlock()` produces a tight ring of contended CAS. Real code does work between operations, which gives waiters time to leave the queue and lets the CAS succeed often. Always include `time.Sleep(1 * time.Microsecond)` or a small CPU burn between operations if the workload calls for it.

The runtime has a benchmark for exactly this in `src/sync/mutex_test.go` (`BenchmarkMutex` and `BenchmarkMutexSlack`). Read it before writing your own.

---

## War story 1 — chan-of-1 in the hot path
A service we worked with had this pattern in 50+ places:

```go
type lockedThing struct {
    sem chan struct{}
    v   *Thing
}
func (l *lockedThing) Do(f func(*Thing)) {
    l.sem <- struct{}{}
    f(l.v)
    <-l.sem
}
```

The author had read "share memory by communicating" and reflexively used a channel. Profiling under production load showed `chansend1` and `chanrecv1` at the top of the CPU profile (combined 8%). Each `Do` was paying ~80 ns for synchronization. Replacing with `sync.Mutex` dropped the call to ~10 ns and the combined CPU usage to under 1%. Two-line patch, multi-percent CPU reclaimed.

The proverb is *not* a performance recommendation.

---

## War story 2 — RWMutex starving on a flat counter
A metrics package used `RWMutex` to "let many readers read in parallel" around a counter:

```go
type Gauge struct {
    mu sync.RWMutex
    v  float64
}
func (g *Gauge) Read() float64 {
    g.mu.RLock(); defer g.mu.RUnlock()
    return g.v
}
```

In production, readers ran from 1000 goroutines at ~30k req/s. The `RWMutex` was *slower* than a plain `Mutex` and *vastly* slower than `atomic.Uint64.Load` (interpreting the float as bits with `math.Float64bits`).

The reason: `RWMutex.RLock` increments a reader counter via an atomic CAS that contends across all CPUs. Plain `Mutex.Lock` does the same one CAS but doesn't need the writer-wait coordination. And `atomic.Load` of an 8-byte aligned field is a single MOV with an acquire fence — no CAS, no contention.

`RWMutex` is for *long* read sections (real work under the read lock), not single loads.

---

## War story 3 — buffered channel hiding backpressure
A pipeline had `events := make(chan Event, 10000)` between an ingest goroutine and a processor goroutine. For a year, this looked fine. Then the processor slowed down by 2x for unrelated reasons (a downstream dependency). Symptoms in monitoring:
- ingress latency unchanged
- memory growing 100 MB/min
- `events` channel length climbing toward 10000
- after 10000, ingress *did* start blocking, but by then a 1-second blip in the processor had already buffered 10k events worth ~700 MB

The buffer was hiding the backpressure signal. The fix was to drop the buffer to 64 and add a "drop if full" path on ingress (with a counter for visibility). Now a 1-second processor stall produced a measurable spike in ingress dropped-events and a fast page, instead of a slow OOM 20 minutes later.

**Rule.** Buffer size in production code should be justified by a *measured* burst, not a vibes-based number like 10000. The default should be "small (0 or 1)".

---

## Refactor case study: from mutex to actor
The starting code:

```go
type Inventory struct {
    mu    sync.Mutex
    stock map[string]int
}
func (i *Inventory) Reserve(sku string, n int) error {
    i.mu.Lock(); defer i.mu.Unlock()
    if i.stock[sku] < n { return ErrOutOfStock }
    i.stock[sku] -= n
    publish(ReservedEvent{sku, n})    // BUG: holds the lock during external publish
    return nil
}
```

Two real issues. First, `publish` blocks under the lock — every other reservation is queued. Second, when we want to log "decided to reserve" vs "decided to fail", the lock makes the decision and the log inseparable; tests must mock the global publisher.

Refactor to an actor:

```go
type reserveReq struct {
    sku   string
    n     int
    reply chan error
}
type Inventory struct{ reqs chan reserveReq }

func (i *Inventory) run() {
    stock := map[string]int{}
    for r := range i.reqs {
        if stock[r.sku] < r.n {
            r.reply <- ErrOutOfStock
            continue
        }
        stock[r.sku] -= r.n
        r.reply <- nil
        publish(ReservedEvent{r.sku, r.n})  // outside the decision
    }
}

func (i *Inventory) Reserve(sku string, n int) error {
    reply := make(chan error, 1)
    i.reqs <- reserveReq{sku, n, reply}
    return <-reply
}
```

Now `publish` runs after the reply is sent — no contention with the next decision. Tests can inject a fake by replacing `publish` only on the owning goroutine. The cost: one extra allocation per call (the `reply` channel) and one scheduler hop. For an operation that is already at millisecond granularity, the cost is invisible; for a microsecond operation, it would be a regression.

---

## Refactor case study: from actor to atomic snapshot
Sometimes the actor itself is too much. A service had:

```go
type cfgActor struct {
    reqs chan cfgReq
}
func (c *cfgActor) Get() Config { /* send req, wait for reply */ }
func (c *cfgActor) Set(cfg Config) { /* send req */ }
```

99.99% of operations were `Get`. The actor was paying scheduler cost on every read for the privilege of being able to serialise the rare write. Refactor:

```go
type Config struct { /* immutable fields */ }
type Configurator struct{ p atomic.Pointer[Config] }
func (c *Configurator) Get() *Config        { return c.p.Load() }
func (c *Configurator) Set(cfg *Config)     { c.p.Store(cfg) }
```

The trick is that `Config` is treated as *immutable* — `Set` constructs a new one. Readers get a pointer; they can hold it indefinitely; the next reader will get the new pointer when the writer stores it. No actor, no channel, no mutex, no scheduler hop in the read path.

This is the canonical "config hot-reload" implementation. It works because `Config` doesn't need to change in place — and that constraint is *cheap* to satisfy in Go because allocating a fresh `Config` is cheap.

---

## Library API design implications
Two rules from production experience:

**Do not expose channels in public APIs unless you mean it.** Once you publish `func (s *Stream) Events() <-chan Event`, you have committed to:
- A specific buffer size (changing it breaks consumers' burst handling).
- Specific close semantics (when does the channel close? who can rely on it closing?).
- An ordering guarantee (FIFO).
- A "you must drain or leak" contract (consumers who stop reading hold the producer hostage).

Most public APIs are better off with callbacks (`OnEvent(func(Event))`) or iterators (`for s.Next() { e := s.Event() }`), which give the consumer more control and the library more flexibility.

**Do not return `*sync.Mutex` from a constructor.** That implies the caller is meant to lock it, which couples the caller's lifecycle to the library's invariants. Keep the mutex private; expose `Lock`-free or thread-safe methods.

---

## Closing thoughts
Channels and mutexes are not adversaries. They are tools with different shapes: channels for handoff and signalling, mutexes for shared in-place state, atomics for single-word read-modify-write, and `sync.Map` for very specific access patterns documented in its godoc.

The dominant signal in deciding between them is *what the data's ownership story is*. If you can describe the operation as "this goroutine produced a value and handed it off", reach for a channel. If you can describe it as "many goroutines need to update this in place", reach for a mutex. If you can describe it as "many goroutines update this single integer or pointer", reach for `atomic`.

Profile when the choice matters. Trust the proverb when the choice is a toss-up — the channel version usually communicates intent better. Don't trust the proverb when the profile says otherwise.

---

[← Back](../)
