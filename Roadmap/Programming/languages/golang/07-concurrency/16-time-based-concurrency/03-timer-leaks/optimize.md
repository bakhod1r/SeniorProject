---
layout: default
title: Optimize
parent: Timer Leaks
grand_parent: Time-Based Concurrency
ancestor: Go
nav_order: 10
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/16-time-based-concurrency/03-timer-leaks/optimize/
---

# Timer Leaks — Optimization

> Eliminating a timer leak is correctness, not performance — once the bug is gone, RSS stops climbing. But the path from "fixed" to "fast" is a separate exercise: a system that allocates a fresh `*time.Timer` for every operation and then carefully `Stop`s it is leak-free but still pays the allocation, the heap registration, and the runtime lock on every call. The optimizations below take a leak-free baseline and reduce its constant factors.
>
> Each entry follows the same shape: a real problem, a "before" snippet that compiles and works, an "after" snippet, and a realistic gain. Numbers are illustrative; measure your own workload before changing production.

---

## Optimization 1 — Convert `time.After` to a reusable `*time.Timer`

**Problem.** `time.After(d)` is convenient, but it allocates a fresh `*time.Timer` on every call. Inside a for-select loop that handles tens of thousands of events per second, this is a measurable allocation source even when the loop is otherwise leak-free (e.g., on Go 1.23+ where unreferenced timers are GC'd).

**Before:**
```go
for {
    select {
    case ev := <-ch:
        handle(ev)
    case <-time.After(5 * time.Second):
        flushBatch()
    case <-ctx.Done():
        return
    }
}
```
At 50 000 events/sec, this allocates 50 000 `*time.Timer` per second — roughly 4 MB/s through the runtime's timer arena plus the runtime-lock cost.

**After:**
```go
t := time.NewTimer(5 * time.Second)
defer t.Stop()
for {
    if !t.Stop() {
        select { case <-t.C: default: }
    }
    t.Reset(5 * time.Second)
    select {
    case ev := <-ch:
        handle(ev)
    case <-t.C:
        flushBatch()
    case <-ctx.Done():
        return
    }
}
```

One timer for the loop's lifetime; `Reset` reuses the same heap entry instead of allocating a new one. On Go 1.23+, the `Stop`/drain dance can be omitted (`Reset` handles the stale-value case), but the explicit form keeps the code portable across versions.

**Gain.** Allocations per iteration drop from 1 to 0 in the steady state. On a 50 000-event/sec workload, this is ~4 MB/s less GC pressure and ~1–3 % wall-clock improvement, larger on workloads that were GC-bound. The contended `runtime.timersLock` is held far less often, which helps p99 latency on multi-core machines.

---

## Optimization 2 — Batch timeouts onto one shared timer

**Problem.** A server that aggregates incoming items and flushes them after either *N* items or *D* duration commonly opens one timer per inbound RPC. If 10 000 connections are open simultaneously, the runtime holds 10 000 live timers — all firing at slightly different times, each requiring a runtime-lock acquisition.

**Before:**
```go
func (s *Server) handleConn(c net.Conn) {
    for {
        msg, err := s.read(c)
        if err != nil {
            return
        }
        t := time.NewTimer(s.flushAfter)
        select {
        case s.batch <- msg:
            t.Stop()
        case <-t.C:
            s.flush()
            s.batch <- msg
        }
    }
}
```
With 10 000 connections, the runtime holds up to 10 000 timers and acquires the timer lock ~20 000 times/sec (insert + remove per message).

**After (shared coalescing timer):**
```go
type Server struct {
    in       chan Msg
    flushDur time.Duration
}

func (s *Server) flusher(ctx context.Context) {
    var buf []Msg
    t := time.NewTimer(s.flushDur)
    if !t.Stop() {
        select { case <-t.C: default: }
    }
    armed := false
    for {
        select {
        case <-ctx.Done():
            if len(buf) > 0 {
                s.flush(buf)
            }
            t.Stop()
            return
        case m := <-s.in:
            buf = append(buf, m)
            if !armed {
                t.Reset(s.flushDur)
                armed = true
            }
            if len(buf) >= 1024 {
                s.flush(buf)
                buf = buf[:0]
                if armed && !t.Stop() {
                    select { case <-t.C: default: }
                }
                armed = false
            }
        case <-t.C:
            armed = false
            if len(buf) > 0 {
                s.flush(buf)
                buf = buf[:0]
            }
        }
    }
}

func (s *Server) handleConn(c net.Conn) {
    for {
        msg, err := s.read(c)
        if err != nil {
            return
        }
        s.in <- msg
    }
}
```

One timer regardless of connection count; one goroutine; one lock acquisition per *batch* instead of per *message*.

**Gain.** Timer-heap size drops from O(connections) to O(1). Runtime-lock contention on `runtime.timersLock` effectively disappears. At 100 000 messages/sec across 10 000 connections, throughput typically rises by 20–40 % and p99 latency drops because the timer goroutine no longer competes with the network goroutines for the runtime lock.

---

## Optimization 3 — Single shared timer for per-request deadlines

**Problem.** Every inbound HTTP request creates a `context.WithTimeout`, which internally allocates a `*time.Timer`. At high QPS, the timer-heap entries dominate goroutine-local allocation.

**Before:**
```go
func (h *Handler) Serve(w http.ResponseWriter, r *http.Request) {
    ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
    defer cancel()
    res, err := h.svc.Do(ctx)
    // ...
}
```
At 100 000 RPS, the runtime constructs and destroys 100 000 timers/sec.

**After (hierarchical timing wheel / hashed-wheel timer):**
The standard library does not ship a hashed timing wheel, but production servers use third-party libraries like `github.com/RussellLuo/timingwheel` or roll their own. The idea: bucket deadlines into a hashed wheel with O(1) insert and removal, backed by a *single* `time.Ticker` that advances the wheel.

```go
type Wheel struct {
    tick   time.Duration
    slots  []*list.List
    cur    int
    mu     sync.Mutex
    ticker *time.Ticker
}

func (w *Wheel) After(d time.Duration) <-chan struct{} {
    ch := make(chan struct{}, 1)
    slot := int(d/w.tick) % len(w.slots)
    w.mu.Lock()
    w.slots[(w.cur+slot)%len(w.slots)].PushBack(ch)
    w.mu.Unlock()
    return ch
}

func (w *Wheel) run() {
    for range w.ticker.C {
        w.mu.Lock()
        l := w.slots[w.cur]
        w.slots[w.cur] = list.New()
        w.cur = (w.cur + 1) % len(w.slots)
        w.mu.Unlock()
        for e := l.Front(); e != nil; e = e.Next() {
            close(e.Value.(chan struct{}))
        }
    }
}
```

Each deadline registration is an O(1) append to a slice; firing is a slot sweep on the ticker tick. The runtime sees one ticker, not 100 000 timers.

**Gain.** Memory drops from ~100 000 × 80 bytes ≈ 8 MB of timer entries to ~1 MB of wheel slots regardless of RPS. Timer lock contention disappears. Tail latency improves; the cost is coarser deadline granularity (rounded up to `tick`). For 30-second deadlines this is irrelevant; for sub-millisecond deadlines, do not use a wheel.

This optimization is heavyweight — only apply it if profiling actually shows `runtime.startTimer` near the top of `cpu` or `time.NewTimer` near the top of `alloc_space`. For most servers the standard library timer is fine.

---

## Optimization 4 — Reuse one timer across many `select` arms with `Reset`

**Problem.** A pipeline stage waits on a result with a timeout; on each iteration it creates a fresh timer:

**Before:**
```go
for job := range jobs {
    result := make(chan Result, 1)
    go work(job, result)
    select {
    case r := <-result:
        emit(r)
    case <-time.After(timeout):
        emit(Result{Err: errTimeout})
    }
}
```

Even leak-free (with `t := time.NewTimer; defer t.Stop()`), each iteration allocates a fresh timer and a fresh result channel.

**After:**
```go
t := time.NewTimer(timeout)
defer t.Stop()
result := make(chan Result, 1)
for job := range jobs {
    if !t.Stop() {
        select { case <-t.C: default: }
    }
    t.Reset(timeout)
    go work(job, result)
    select {
    case r := <-result:
        emit(r)
    case <-t.C:
        emit(Result{Err: errTimeout})
        // drain the in-flight worker into the channel so the
        // next iteration's `<-result` is consistent
        go func() { <-result }()
    }
}
```

One timer, one channel, reused across the whole job stream. The drain goroutine on timeout is a small detail: it prevents the *next* iteration from receiving the previous job's late result.

**Gain.** Zero allocations per iteration after warmup. At 100 jobs/sec, this is small in absolute terms but eliminates a recurring allocation source that would otherwise show up at the top of `alloc_space` profiles. The clearer benefit is reduced GC pressure on long-running pipelines.

---

## Optimization 5 — Replace `time.After` with `context.AfterFunc` (Go 1.21+)

**Problem.** A handler needs to abort a long-running operation after a deadline. The classic pattern is `context.WithTimeout`, which creates a timer internally and cancels the context when the timer fires. Inside the operation, every check on `ctx.Done()` is correct but expensive in tight loops, and the timer is allocated even when the operation completes quickly.

**Before:**
```go
ctx, cancel := context.WithTimeout(parent, 30*time.Second)
defer cancel()
return runWithCtx(ctx)
```

**After (Go 1.21+ — `context.AfterFunc`):**
```go
done := make(chan error, 1)
stop := context.AfterFunc(parent, func() {
    // runs when parent is cancelled or its deadline expires
})
defer stop()
go func() { done <- run() }()

t := time.NewTimer(30 * time.Second)
defer t.Stop()
select {
case err := <-done:
    return err
case <-t.C:
    return errDeadline
case <-parent.Done():
    return parent.Err()
}
```

`context.AfterFunc` registers a callback against an existing context's cancellation path. It does *not* allocate a new timer or a new context derived from the parent — it hooks into the parent's existing cancel chain. The returned `stop` function deregisters the callback when the operation completes, immediately releasing the closure.

The pattern is most useful when you want to perform side effects on cancellation (close a connection, abort a query) without polluting your business logic with `ctx.Done()` checks. For pure deadline propagation, `context.WithTimeout` is still simpler.

**Gain.** No new context allocation; no extra timer for the cancellation hook; cleanup is O(1) regardless of how many derived contexts are alive. On a high-QPS server with deeply nested context chains, this can reduce allocations per request by 1–2 KB.

---

## Optimization 6 — Sharded timer wheels for very high timer rates

**Problem.** Even one well-designed timing wheel becomes contended at extreme scale. Go's standard `runtime.timersLock` is sharded across Ps (one heap per P since Go 1.14), but at multi-million-timer-per-second workloads a single user-space wheel becomes the bottleneck.

**Before (one wheel guarded by one mutex):**
```go
type Wheel struct {
    mu    sync.Mutex
    slots []*list.List
}
```
At 5 M timer ops/sec across 64 cores, the wheel mutex is the bottleneck.

**After (shard by hash of timer ID):**
```go
const shards = 64

type ShardedWheel struct {
    wheels [shards]*Wheel
}

func (s *ShardedWheel) After(id uint64, d time.Duration) <-chan struct{} {
    return s.wheels[id%shards].After(d)
}
```

Each shard has its own mutex and its own slot array. Different cores hit different shards; the lock is uncontended in the common case.

**Gain.** Scales linearly with shard count up to the number of CPU cores. Typical 10–50× throughput improvement on contended workloads. Same caveat as Optimization 3: only worth the complexity if profiling identifies the wheel as a bottleneck. The runtime's per-P timer heap covers the typical case for free.

---

## Optimization 7 — Eliminate per-iteration timer allocation in `Ticker`-style loops

**Problem.** A polling loop wants to do work at most once every `d`. The naive implementation creates a timer every iteration:

**Before:**
```go
for {
    select {
    case <-ctx.Done():
        return
    case <-time.After(d):
        if !poll() {
            return
        }
    }
}
```

Each iteration: one `*time.Timer` allocated, registered, fired, garbage-collected.

**After (`*time.Ticker`):**
```go
tk := time.NewTicker(d)
defer tk.Stop()
for {
    select {
    case <-ctx.Done():
        return
    case <-tk.C:
        if !poll() {
            return
        }
    }
}
```

A `*time.Ticker` reuses one timer entry that the runtime re-arms after every fire. No per-iteration allocation, no per-iteration runtime-lock acquisition for the user goroutine.

**Gain.** Zero allocations per iteration. On a 1 ms poll loop (1 000 iterations/sec), this saves ~1 MB/s of timer allocations. The `*time.Ticker` is also drift-free: it schedules the next fire from the previous *scheduled* fire, not from the previous *observed* fire, so the loop does not slowly fall behind on a busy scheduler.

There is a subtle hazard: if `poll()` takes longer than `d`, ticks pile up in the ticker channel (buffer 1; further ticks are dropped). Usually this is what you want — the loop catches up — but if you need strict pacing, add a `<-tk.C` drain at the start of each iteration:

```go
for range tk.C {
    poll()
}
```

---

## Optimization 8 — Replace `time.Sleep` with `time.NewTimer` for cancellable backoff

**Problem.** Exponential backoff loops typically use `time.Sleep`:

**Before:**
```go
for attempt := 0; ; attempt++ {
    if err := f(); err == nil {
        return
    }
    time.Sleep(backoff(attempt))
}
```

`time.Sleep` internally allocates a timer just like `time.After`, but you cannot stop it — if the parent context is cancelled while sleeping, the goroutine is parked until the sleep elapses, wasting wall-clock time and pinning captured state.

**After:**
```go
var t *time.Timer
for attempt := 0; ; attempt++ {
    if err := f(); err == nil {
        if t != nil {
            t.Stop()
        }
        return
    }
    d := backoff(attempt)
    if t == nil {
        t = time.NewTimer(d)
    } else {
        if !t.Stop() {
            select { case <-t.C: default: }
        }
        t.Reset(d)
    }
    select {
    case <-ctx.Done():
        t.Stop()
        return
    case <-t.C:
    }
}
```

One timer for the whole retry loop, reused via `Reset`, cancellable via `ctx.Done()`.

**Gain.** On a retry loop that succeeds on the second attempt, allocation drops from 1 timer to 1 timer (same). On a loop that retries 10 times, allocation drops from 10 timers to 1. The bigger win is cancellation: a cancelled context returns immediately instead of after the next sleep elapses. This is the difference between a request taking 50 ms (cancelled immediately) and 30 seconds (sitting in `time.Sleep`) on the unhappy path.

---

## Optimization 9 — Per-goroutine timer cache to avoid GC

**Problem.** A worker pool that handles short-lived jobs with per-job deadlines allocates and frees a timer per job. Even with `defer t.Stop()`, the timer struct still allocates on the heap (it escapes the function due to the channel field).

**Before:**
```go
func (w *Worker) Run(job Job) {
    t := time.NewTimer(job.Deadline)
    defer t.Stop()
    select {
    case r := <-w.do(job):
        w.emit(r)
    case <-t.C:
        w.emit(Result{Err: errTimeout})
    }
}
```
One allocation per job.

**After (per-worker timer field):**
```go
type Worker struct {
    timer *time.Timer
}

func (w *Worker) Run(job Job) {
    if w.timer == nil {
        w.timer = time.NewTimer(job.Deadline)
    } else {
        if !w.timer.Stop() {
            select { case <-w.timer.C: default: }
        }
        w.timer.Reset(job.Deadline)
    }
    select {
    case r := <-w.do(job):
        w.emit(r)
        if !w.timer.Stop() {
            select { case <-w.timer.C: default: }
        }
    case <-w.timer.C:
        w.emit(Result{Err: errTimeout})
    }
}
```

The worker owns a single `*time.Timer` for its lifetime; every job reuses it. Because each worker goroutine has its own field, there is no contention.

**Gain.** Eliminates the per-job timer allocation. For a worker pool processing 100 000 jobs/sec with `n = 32` workers, this saves 100 000 timer allocations/sec — roughly 8 MB/s of GC pressure. The pattern is most valuable inside libraries that wrap I/O with deadlines (database drivers, HTTP clients) where the same timer is needed thousands of times per second per connection.

**Caveat.** Workers must not call `Run` re-entrantly (a `Run` from inside `do` would clobber the timer state). Also, the `Stop`/drain dance on the happy path matters — without it, a stale value left in `w.timer.C` will be picked up by the *next* call's `select`, causing a spurious immediate timeout.

---

## Optimization 10 — Use `runtime.GC()` and pprof to find the *next* timer hot spot

**Problem.** You have applied the optimizations above and the obvious hot spots are gone. Where is the next 5 % win?

**Workflow.**

1. Enable the runtime metrics that matter:
   ```go
   import _ "net/http/pprof"
   go func() { log.Fatal(http.ListenAndServe("localhost:6060", nil)) }()
   ```

2. Reach steady-state under realistic load, then capture a heap profile:
   ```
   go tool pprof -alloc_space http://localhost:6060/debug/pprof/heap
   (pprof) top20
   (pprof) list time.NewTimer
   ```
   The `list` command shows the call sites that allocate timers. If `time.NewTimer` is in the top 20 of `alloc_space`, you have a remaining hot spot. If it is in the top 20 of `inuse_space`, you have a remaining leak.

3. Inspect the timer-heap size via `runtime/metrics`:
   ```go
   samples := []metrics.Sample{
       {Name: "/sched/timers:objects"}, // Go 1.21+
   }
   metrics.Read(samples)
   log.Printf("timers: %v", samples[0].Value.Uint64())
   ```
   Healthy services see this metric flat under steady load. A monotonically rising value is a leak. A high-but-flat value (millions of timers) is an opportunity to apply Optimization 3 (timing wheel) or Optimization 2 (shared coalescing timer).

4. Run a workload trace and look for `time.startTimer` and `time.stopTimer` events:
   ```
   go test -trace=trace.out
   go tool trace trace.out
   ```
   The trace viewer's "Synchronization blocking profile" shows time spent waiting on `runtime.timersLock`. If the user-goroutine spends >1 % of wall-clock there, sharding (Optimization 6) is justified.

5. For tail-latency analysis specifically, sample `runtime.MemStats.PauseNs` and look at p99 GC pauses. Timer-heavy services see longer pauses because the runtime walks the timer heap during GC. Reducing the steady-state timer count (Optimizations 2, 3, 9) directly shortens GC pauses.

**Gain.** Variable — the optimizations above usually leave a 1–5 % timer-related cost on the table, recoverable through one or two targeted fixes per profile cycle. For most services the optimizations are simply not worth it; the standard `time.NewTimer` plus `defer Stop` plus `Reset` is fast enough. Profile first; optimize only what shows up at the top.

---

## Putting it together

A pyramid for timer optimization, from "always do this" to "only when proven":

1. **Always.** Replace `time.After` in loops with `NewTimer` + `Reset` (Optimization 1, 7). Use `defer Stop` on every timer and ticker (basic correctness, prerequisite for everything else).
2. **Often.** Reuse one timer per stable scope — per worker, per pipeline stage, per goroutine — instead of per iteration (Optimizations 4, 8, 9). Replace `time.Sleep` with cancellable `NewTimer` whenever a context is in scope (Optimization 8).
3. **When profiling demands.** Coalesce many independent timers into one ticker-driven flusher (Optimization 2). Replace `time.After` with `context.AfterFunc` for cancellation hooks rather than full timeout chains (Optimization 5).
4. **Only at extreme scale.** Build or import a hashed timing wheel (Optimization 3) and shard it (Optimization 6). Reserve for services that profile `runtime.startTimer` or `runtime.timersLock` near the top, not as a default architecture.
5. **Continuously.** Run `go tool pprof -alloc_space` and `runtime/metrics` `/sched/timers:objects` in CI and dashboards (Optimization 10). Treat a rising timer count as a leak before it becomes an outage.

The wins compound. A service that started with 50 000 idle timers from leaks (`time.After` in loops), 10 000 connection-scoped timers, and 100 000 per-RPC context timers can land at <100 active timers after applying the optimizations above — without changing the timeout semantics visible to clients. The savings show up as smaller RSS, shorter GC pauses, and lower p99 latency. None of them require third-party libraries; all of them are reachable from the standard library plus a few hundred lines of glue.

Profile, fix the leaks first, then optimize what remains. In that order.
