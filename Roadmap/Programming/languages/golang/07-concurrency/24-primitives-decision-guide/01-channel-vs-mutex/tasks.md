---
layout: default
title: Channels vs Mutexes — Tasks
parent: Channels vs Mutexes
grand_parent: Primitives Decision Guide
ancestor: Go
nav_order: 8
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/24-primitives-decision-guide/01-channel-vs-mutex/tasks/
---

# Channels vs Mutexes — Tasks

[← Back](../)

A graded set of hands-on exercises. For each, write both the mutex version and the channel version, benchmark them, and write a one-paragraph conclusion on which you would ship and why.

---

## Task 1 — Counter (warm-up)

Build a counter type that supports `Inc()` and `Value() int64`, callable from many goroutines. Implement four variants:
- `MuCounter` — `sync.Mutex` around an `int64`.
- `RWMuCounter` — `sync.RWMutex` with `RLock` on `Value`.
- `AtomicCounter` — `atomic.Int64`.
- `ChanCounter` — a `chan int64` of size 0 plus a goroutine owning the value, replying via a reply channel for `Value`.

Benchmark each at 1, 2, 8, 32 goroutines, 1e6 increments each.

**Expected finding.** `AtomicCounter` wins. `MuCounter` is second. `RWMuCounter` is *slower* than `MuCounter` for this workload (the read-side critical section is too short). `ChanCounter` is 10–50x slower than the others.

```go
type AtomicCounter struct{ n atomic.Int64 }

func (c *AtomicCounter) Inc()         { c.n.Add(1) }
func (c *AtomicCounter) Value() int64 { return c.n.Load() }
```

Hand in the benchmark output for one machine and a sentence per variant explaining the result.

---

## Task 2 — Bounded worker pool, two ways

Process N jobs (e.g. integer squaring with a `time.Sleep(50*time.Microsecond)` for realism) with K workers.

**Channel version.** A `jobs chan int` of capacity K, a `results chan int`, a `sync.WaitGroup`. Workers `range` over `jobs`; close `jobs` when production is done; `wg.Wait()` then `close(results)`; main `range`s over results.

**Mutex version.** A slice `jobs []int` protected by `sync.Mutex`; workers `Lock` to pop the head, process, `Lock` again to append to a results slice. Use a `sync.Cond` to make workers wait when the queue is empty.

Benchmark both with N=10000, K=8.

**Expected finding.** Channel version is ~30 lines, mutex version is ~80 lines and needs careful handling of "queue empty" vs "no more jobs coming". Channel version performs as well or better — and is the version you ship. Worker pools are a textbook win for channels.

---

## Task 3 — Counting semaphore, two ways

Implement a `Sem` with `Acquire()` and `Release()` allowing at most N concurrent holders. Build both:

```go
type SemChan struct{ tokens chan struct{} }

func NewSemChan(n int) *SemChan {
    return &SemChan{tokens: make(chan struct{}, n)}
}
func (s *SemChan) Acquire() { s.tokens <- struct{}{} }
func (s *SemChan) Release() { <-s.tokens }
```

```go
type SemMu struct {
    mu       sync.Mutex
    cond     *sync.Cond
    capacity int
    held     int
}
```

Make `SemMu`'s `Acquire` wait on the cond when `held == capacity`, and `Release` `Broadcast` (or `Signal`).

Benchmark both. Then add a *timed* `Acquire(ctx context.Context) error` to each. Note how the channel version trivially gains it via `select`:

```go
func (s *SemChan) AcquireCtx(ctx context.Context) error {
    select {
    case s.tokens <- struct{}{}:
        return nil
    case <-ctx.Done():
        return ctx.Err()
    }
}
```

The mutex version needs a goroutine, a timer, and a careful re-entry guard. **The exercise's point is to feel how much `select` buys you for cancellation.**

---

## Task 4 — In-memory cache

A cache mapping `string → []byte`. Operations: `Get(key) ([]byte, bool)`, `Set(key, val)`, `Delete(key)`. Workload: 95% reads, 5% writes, 10k keys, 1k goroutines.

Build three variants:
1. `map[string][]byte` + `sync.Mutex`.
2. `map[string][]byte` + `sync.RWMutex`.
3. `sync.Map`.

Benchmark them. Repeat at 5% reads / 95% writes.

**Expected finding.** At 95% reads: variant 2 wins clearly. Variant 3 is competitive but not always faster. Variant 1 is acceptable. At 95% writes: variant 1 wins, variant 3 loses badly because every write rebuilds the dirty map.

---

## Task 5 — Fan-out cancellation

Spawn N=1000 goroutines each waiting on a "stop" signal. When the main goroutine triggers stop, every worker should exit within 10ms.

Implement three variants:
1. `done chan struct{}` closed by main — every worker selects on `<-done`.
2. `sync.Mutex` + bool — every worker polls the bool under the lock.
3. `context.Context` — every worker selects on `<-ctx.Done()`.

Variant 1 and 3 are the same underlying mechanism — `context.WithCancel` internally closes a `chan struct{}`.

Benchmark the *time from triggering stop to last worker exit* (use `sync.WaitGroup` to wait, `time.Now()` to measure).

**Expected finding.** Variants 1 and 3 are sub-millisecond. Variant 2 takes as long as the worker's polling interval. Fan-out cancellation is a channel job, full stop.

---

## Task 6 — Pipeline vs shared buffer

A producer reads lines from a file (use a 10MB log). Stage two parses each line as JSON. Stage three counts errors and successes.

**Channel pipeline.** Three goroutines connected by two channels of buffer size 64.

**Shared buffer.** A `sync.Mutex`-protected `[]string` between producer and parser, plus another between parser and counter. Workers wait on a `sync.Cond`.

Benchmark wall time. Try both with the second stage being CPU-bound (real JSON parsing) and with it being a no-op.

**Expected finding.** With real CPU work, both perform similarly (the bottleneck is the work, not the synchronisation). With no-op stages, the channel version is cleaner; the mutex version has more code per unit of work and bench worse because of `Cond` wake overhead.

---

## Task 7 — Read-mostly config

Service has a `Config` struct read on every request (~100k req/s) and updated rarely (once per minute). Build:

1. `sync.RWMutex` around the `*Config`.
2. `atomic.Pointer[Config]` — readers `Load()`, writers `Store(newCfg)`.
3. Channel-of-config — a goroutine owns the config and serves reads via a reply channel.

Benchmark read-side latency.

**Expected finding.** `atomic.Pointer` is the clear winner — readers do one atomic load, no contention with the rare writer at all. `RWMutex` is fine. The channel version is grossly slower because every read goes through a scheduler hop.

This is a *real* production pattern. Most "config hot-reload" implementations use `atomic.Pointer`.

---

## Task 8 — Refactor to remove a mutex

Take this code:

```go
type Server struct {
    mu       sync.Mutex
    sessions map[string]*Session
}

func (s *Server) NewSession(id string) {
    s.mu.Lock()
    s.sessions[id] = &Session{ID: id}
    s.mu.Unlock()
}
func (s *Server) CloseSession(id string) {
    s.mu.Lock()
    delete(s.sessions, id)
    s.mu.Unlock()
}
func (s *Server) Broadcast(msg string) {
    s.mu.Lock()
    for _, sess := range s.sessions {
        sess.Send(msg)
    }
    s.mu.Unlock()
}
```

Two bugs to find first (`sess.Send` may block while holding the lock; `sess.Send` may not be safe to call from outside its owning goroutine). Then refactor to an actor: one goroutine owns the `sessions` map; the public methods send events on a channel; broadcasting becomes a range over the map *on the owning goroutine*.

Compare the line count and the bug surface.

---

## Task 9 — Detect a race with `-race`

Take Task 1's `MuCounter` and *remove* the `Lock`/`Unlock`. Build and run with `go run -race`. Capture the report.

Then add `Lock`/`Unlock` back and re-run. Confirm the race report disappears.

Repeat with the channel version: there is no `Lock` to remove, but you can introduce a race by reading the counter's internal field directly without the channel. Confirm `-race` catches it.

**Deliverable.** A short note: in mutex code, races look like "missing lock". In channel code, races look like "bypassing the channel". The detector catches both because they violate the same happens-before invariant.

---

## Task 10 — Choose-your-primitive quiz

For each of the following workloads, write one sentence stating which primitive you'd reach for first, and one sentence stating what you'd measure before switching.

1. A request-scoped tracer that buffers spans and flushes them to a backend every 5s.
2. A connection pool of 100 database handles handed out to 1000 worker goroutines.
3. A globally unique ID generator (timestamp + sequence).
4. A debounced reload signal: many sources can request reload, but reloads should not run more than once per second.
5. A long-lived metric histogram that 1000 handlers update on every request.
6. A graceful-shutdown coordinator that fans cancellation out to 5 subsystems.
7. A leader-election timer that the application checks before doing work.
8. A request rate limiter using token-bucket semantics.

**Sample answers.**
1. Channel (bounded buffer) + goroutine that owns the flush loop.
2. Channel of `*DBConn` of size 100 — exactly the semaphore pattern.
3. `atomic.Int64` for the sequence, no mutex needed.
4. Channel — a `chan struct{}` of capacity 1 with non-blocking send.
5. Sharded `atomic` counters (per-bucket atomic ints, sum on read).
6. `context.Context` (which is a channel underneath).
7. `atomic.Bool` or `atomic.Pointer[time.Time]` — readers must not block.
8. `golang.org/x/time/rate` — internally a mutex over a token count and timestamps; do not reinvent.

---

[← Back](../)
