---
layout: default
title: Optimize
parent: Ticker
grand_parent: Time-Based Concurrency
ancestor: Go
nav_order: 10
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/16-time-based-concurrency/01-ticker/optimize/
---

# time.Ticker — Optimization

> `time.Ticker` looks free. Each ticker is one timer-heap entry, one buffered channel, and a handful of bytes. At low counts and slow intervals nothing about it is worth optimizing. At scale — thousands of connections, millions of pending timers, microsecond-sensitive paths — every one of those costs adds up. The optimizations below are not premature: they are the realistic wins that move dashboards on real Go services.
>
> Each entry states the problem, shows a "before" snippet, an "after" snippet, and the realistic gain. Numbers are illustrative — always measure your own workload.

---

## Optimization 1 — Reduce wakeups by widening the ticker

**Problem.** A ticker firing every 10 ms wakes the consumer 100 times per second even when there is nothing to do. On a 1000-process server, that is 100 000 wakeups/sec spent answering "anything to do? no." Each wakeup costs roughly 1–5 microseconds of CPU between the scheduler, the cache miss on the consumer's stack, and the run-queue manipulation.

**Before:**
```go
t := time.NewTicker(10 * time.Millisecond)
defer t.Stop()
for {
    select {
    case <-t.C:
        if !work.Pending() {
            continue
        }
        process(work.Next())
    case <-ctx.Done():
        return
    }
}
```
At idle, this is a 100 Hz busy loop dressed up as event-driven code.

**After:**
```go
t := time.NewTicker(1 * time.Second) // 100x fewer wakeups
defer t.Stop()
for {
    select {
    case <-t.C:
        for work.Pending() {
            process(work.Next())
        }
    case w := <-work.Ready():
        process(w) // event-driven path
    case <-ctx.Done():
        return
    }
}
```

**Gain.** CPU baseline drops from ~5% per instance to <0.5%. At 1000 instances that is roughly 50 cores you can return to the cluster. The trick is to combine a slow ticker (for periodic flushes or sanity checks) with an event channel (for the hot path), so you do not pay polling cost for items that have an event signal available.

The rule: a ticker is *not* a substitute for an event channel. If you have a way to be told "something happened," use that; reserve tickers for things that happen on a wall-clock cadence — heartbeats, flushes, periodic GC.

---

## Optimization 2 — Batch ticks: do "all the work accumulated since the last tick"

**Problem.** A ticker handler that does one unit of work per tick falls behind under burst load and over-paces the runtime under steady load. If the work is naturally batchable — flushing logs, sending metrics, applying buffered writes — process the whole batch on each tick instead.

**Before:**
```go
t := time.NewTicker(100 * time.Millisecond)
defer t.Stop()
for range t.C {
    if msg, ok := buffer.Pop(); ok {
        sink.Send(msg) // ~5 ms each, network round-trip
    }
}
```
At 100 ms tick interval and 5 ms send, throughput is capped at 10 msg/sec regardless of how full the buffer gets.

**After:**
```go
t := time.NewTicker(100 * time.Millisecond)
defer t.Stop()
batch := make([]Msg, 0, 1024)
for range t.C {
    batch = batch[:0]
    for {
        m, ok := buffer.Pop()
        if !ok {
            break
        }
        batch = append(batch, m)
        if len(batch) >= cap(batch) {
            break
        }
    }
    if len(batch) > 0 {
        sink.SendBatch(batch) // ~5 ms for the whole batch
    }
}
```

**Gain.** Throughput scales with batch size, not with tick rate. At a buffer-fill rate of 1000 msg/sec and a batch capacity of 1024, the work-per-tick stays bounded at one network round-trip. Tail latency for an individual message is at most one tick interval. CPU per message drops because of amortized syscalls and per-batch overhead.

Tune `cap(batch)` so a full batch's processing time is less than the tick interval; otherwise you fall behind anyway. Tune the tick interval to the acceptable per-message latency.

---

## Optimization 3 — Replace `time.NewTicker` with `time.AfterFunc` for one-shots

**Problem.** A ticker is the wrong primitive when you need a *single* delayed action. Every `time.NewTicker` allocates a `Ticker` struct, a buffered channel of capacity 1, and a timer-heap entry. If you only fire once, you have paid for the channel and the rearm logic for no reason.

**Before:**
```go
func DelayedClose(c io.Closer, after time.Duration) {
    go func() {
        t := time.NewTicker(after)
        defer t.Stop()
        <-t.C
        c.Close()
    }()
}
```
Per call this allocates ~200 bytes for the ticker, a goroutine stack (initial 2 KB, can grow), and burns scheduling work. Multiply by every connection in a server.

**After:**
```go
func DelayedClose(c io.Closer, after time.Duration) *time.Timer {
    return time.AfterFunc(after, func() { c.Close() })
}
```

**Gain.** No goroutine is created until the timer fires (and even then, the runtime spawns a short-lived one to run the callback). Memory drops by ~2 KB per pending close. With 100 000 pending connections that is ~200 MB freed.

`AfterFunc` returns a `*time.Timer`, which you can `Stop()` to cancel — useful if the close should be rescinded (e.g., the connection became active again). The callback runs in a runtime-managed goroutine; treat it like any other goroutine for concurrency safety.

Use `AfterFunc` whenever the answer to "what happens after this fires?" is "exactly one thing." Use `NewTicker` only when the answer is "this thing, repeatedly."

---

## Optimization 4 — Share a single ticker across consumers (fan-out)

**Problem.** One ticker per connection scales to a few thousand connections; beyond that, the timer subsystem starts showing up in CPU profiles. Every rearm walks an `O(log N)` timer heap; every fire walks the runtime's per-P heap and migrates work between Ps.

**Before:**
```go
type Conn struct{ tick *time.Ticker }

func newConn(d time.Duration) *Conn {
    c := &Conn{tick: time.NewTicker(d)}
    go func() {
        defer c.tick.Stop()
        for range c.tick.C {
            c.sendHeartbeat()
        }
    }()
    return c
}
// 100 000 conns → 100 000 tickers, 100 000 goroutines, 100 000 heap entries
```

**After:**
```go
type Hub struct {
    mu    sync.RWMutex
    conns map[*Conn]struct{}
}

func (h *Hub) Run(ctx context.Context, d time.Duration) {
    t := time.NewTicker(d)
    defer t.Stop()
    for {
        select {
        case <-t.C:
            h.mu.RLock()
            for c := range h.conns {
                c.sendHeartbeat() // or push into a per-conn ping channel
            }
            h.mu.RUnlock()
        case <-ctx.Done():
            return
        }
    }
}
```

**Gain.** Timer-heap entries drop from `N` to 1. Goroutine count drops from `N` to 1 (or to `worker count` if you parallelize the fan-out). At 100k connections, CPU spent in `runtime.siftupTimer` drops from a measurable share of the profile to invisible.

Caveat: the heartbeat now goes out to every connection in the same loop iteration. If `sendHeartbeat` is slow, you serialize all connections behind one slow one. The fix is to make `sendHeartbeat` non-blocking — e.g., push a "ping" struct into a per-conn buffered channel that the connection's own write loop drains.

```go
func (c *Conn) sendHeartbeat() {
    select {
    case c.pings <- struct{}{}:
    default: // connection is slow; skip this beat rather than block the hub
    }
}
```

This is the same pattern as event-bus fan-out: one producer, N independent consumers, never block the producer.

---

## Optimization 5 — Replace per-goroutine tickers with a coalesced scheduler

**Problem.** When many independent tasks need different intervals, the naive design spawns one goroutine + one ticker per task. At 10 000 tasks with intervals from 1 ms to 1 hour, you have 10 000 goroutines and 10 000 timer entries. Even with shared tickers (Opt 4), distinct intervals demand distinct timers.

**Before:**
```go
for _, task := range tasks {
    task := task
    go func() {
        t := time.NewTicker(task.Interval)
        defer t.Stop()
        for range t.C {
            task.Run()
        }
    }()
}
```

**After:** a min-heap of "next fire time" per task, with one goroutine and one `time.Timer` (not Ticker) re-armed to the earliest deadline.

```go
type Scheduler struct {
    mu    sync.Mutex
    heap  taskHeap // sorted by NextFire
    timer *time.Timer
    wake  chan struct{}
}

func (s *Scheduler) run(ctx context.Context) {
    for {
        s.mu.Lock()
        if s.heap.Len() == 0 {
            s.mu.Unlock()
            select {
            case <-s.wake:
                continue
            case <-ctx.Done():
                return
            }
        }
        next := s.heap.Peek()
        d := time.Until(next.NextFire)
        s.mu.Unlock()

        s.timer.Reset(d)
        select {
        case <-s.timer.C:
            s.mu.Lock()
            now := time.Now()
            for s.heap.Len() > 0 && !s.heap.Peek().NextFire.After(now) {
                task := s.heap.Pop()
                go task.Run()
                task.NextFire = now.Add(task.Interval)
                s.heap.Push(task)
            }
            s.mu.Unlock()
        case <-s.wake:
            s.timer.Stop()
        case <-ctx.Done():
            s.timer.Stop()
            return
        }
    }
}
```

**Gain.** Goroutine count drops from `N` to 1 (plus short-lived ones spawned per fire if `task.Run()` is offloaded). Timer count drops from `N` to 1. Memory drops by ~2 KB × `N` for stacks, plus the per-ticker overhead. The scheduler approach is what cron daemons, job runners, and large-scale telemetry systems use internally.

The complexity cost is real: a heap-based scheduler is a few hundred lines of careful code, with correctness concerns around re-entry, cancellation, and clock jumps. Reach for it when `N` is large *and* intervals are heterogeneous. For homogeneous intervals, shared tickers (Opt 4) are enough.

---

## Optimization 6 — Eliminate the goroutine entirely with `AfterFunc` chains

**Problem.** Even a single ticker requires a hosting goroutine to read `t.C` and call the work function. For trivial, infrequent periodic work, you can skip the goroutine by re-arming `AfterFunc` from inside the callback.

**Before:**
```go
func StartHeartbeat(d time.Duration, fn func()) (stop func()) {
    t := time.NewTicker(d)
    done := make(chan struct{})
    go func() {
        defer t.Stop()
        for {
            select {
            case <-t.C:
                fn()
            case <-done:
                return
            }
        }
    }()
    return func() { close(done) }
}
```
One goroutine permanently parked, one ticker, one done channel.

**After:**
```go
func StartHeartbeat(d time.Duration, fn func()) (stop func()) {
    var (
        mu      sync.Mutex
        stopped bool
        timer   *time.Timer
    )
    var tick func()
    tick = func() {
        mu.Lock()
        if stopped {
            mu.Unlock()
            return
        }
        mu.Unlock()
        fn()
        mu.Lock()
        if !stopped {
            timer = time.AfterFunc(d, tick)
        }
        mu.Unlock()
    }
    timer = time.AfterFunc(d, tick)
    return func() {
        mu.Lock()
        stopped = true
        if timer != nil {
            timer.Stop()
        }
        mu.Unlock()
    }
}
```

**Gain.** Memory drops by ~2 KB per heartbeat (no permanent goroutine). The runtime still spawns a short-lived goroutine each fire, but it lives only for the duration of `fn()` and is reclaimed immediately.

The trade-off: the code is fiddlier — you must guard re-arming against concurrent stop, which is what the mutex above is doing. For a heartbeat fired every 30 seconds in a service with 50 000 connections, the memory win (~100 MB) is worth the complexity. For a heartbeat fired every second in a single instance, the original ticker version is fine.

Drift behavior also differs: the `AfterFunc` chain measures `d` *between successive fn completions*, whereas a `Ticker` aims for `d` between *fire moments*. If `fn()` takes 100 ms, the chain effectively fires every `d + 100 ms`; the ticker keeps trying to fire every `d`. Pick the semantics that matches the workload.

---

## Optimization 7 — Replace `time.After` in a loop with a single `Ticker`

**Problem.** `time.After(d)` is a thin wrapper around `time.NewTimer(d).C`. Each call allocates a new timer. Inside a `for` loop's `select`, `time.After(d)` is evaluated on every iteration, allocating a fresh timer that fires only if its case is selected (and is otherwise *garbage-collected after firing*, but only after firing).

**Before:**
```go
for {
    select {
    case j := <-jobs:
        process(j)
    case <-time.After(1 * time.Second):
        flush()
    case <-ctx.Done():
        return
    }
}
```
On every iteration where `jobs` has work, a fresh `time.After` timer is allocated, scheduled into the heap, and abandoned. Under heavy load this is a steady allocation drumbeat.

**After:**
```go
t := time.NewTicker(1 * time.Second)
defer t.Stop()
for {
    select {
    case j := <-jobs:
        process(j)
    case <-t.C:
        flush()
    case <-ctx.Done():
        return
    }
}
```

**Gain.** Allocation per iteration drops from one timer to zero. The runtime's timer heap stays small. CPU profiling shows `runtime.NewTimer` disappearing from the top callers.

The subtler semantic difference: `time.After` resets its clock every iteration ("flush every second of *not receiving a job*"), whereas the ticker fires every second of *wall time* regardless of job activity. Pick deliberately. If you want "flush 1 second after the last job," `time.After` is the right shape — but allocate the `Timer` once and call `Reset` on it instead of constructing a fresh one each iteration:

```go
t := time.NewTimer(1 * time.Second)
defer t.Stop()
for {
    select {
    case j := <-jobs:
        process(j)
        if !t.Stop() {
            <-t.C // drain leftover tick
        }
        t.Reset(1 * time.Second)
    case <-t.C:
        flush()
        t.Reset(1 * time.Second)
    case <-ctx.Done():
        return
    }
}
```

That is the "idle flush" pattern. It is more code but zero allocations on the hot path.

---

## Optimization 8 — Drop the ticker when the workload is event-driven

**Problem.** Many "polling" workloads have a perfectly good push notification available; the code uses a ticker because the original author did not look for it. This is the optimization with the highest leverage and the lowest visibility: deleting work that was never necessary.

**Before:**
```go
t := time.NewTicker(50 * time.Millisecond)
defer t.Stop()
for {
    select {
    case <-t.C:
        rows, err := db.Query("SELECT id FROM queue WHERE state = 'ready'")
        if err == nil {
            for rows.Next() {
                var id int
                rows.Scan(&id)
                claim(id)
            }
            rows.Close()
        }
    case <-ctx.Done():
        return
    }
}
```
At 20 Hz, each instance executes 20 queries per second on an empty queue. With 100 instances that is 2 000 wasted QPS, and you have a long tail of "queue empty, ticker fires, query, idle, repeat."

**After (PostgreSQL `LISTEN/NOTIFY`):**
```go
listener := pq.NewListener(...)
listener.Listen("queue_ready")
for {
    select {
    case <-listener.Notify:
        for {
            row := db.QueryRow("UPDATE queue SET state='claimed' WHERE id = (SELECT id FROM queue WHERE state='ready' LIMIT 1 FOR UPDATE SKIP LOCKED) RETURNING id")
            var id int
            if err := row.Scan(&id); err != nil {
                break
            }
            handle(id)
        }
    case <-ctx.Done():
        return
    }
}
```
Or, with Redis, `BLPOP`. With Kafka, the consumer is event-driven by design. With NATS, subscribe and receive.

**Gain.** Idle CPU drops to zero. Latency from enqueue to claim drops from "up to 50 ms" to "single-digit milliseconds." Database load drops by orders of magnitude. The ticker is gone entirely.

The lesson: every time you write `time.NewTicker(...)`, ask "is there a push channel for this signal?" Often the answer is yes and you save an entire poll loop.

---

## Optimization 9 — Align ticks to a deadline-driven schedule

**Problem.** Out-of-the-box, a `Ticker` started at an arbitrary moment drifts: if you want a sample exactly on each second boundary (e.g., for `cron`-aligned telemetry), `NewTicker(1 * time.Second)` started at `t = 12:00:00.347` fires at `12:00:01.347`, `12:00:02.347`, etc. The samples are not on the second boundary; consumers that aggregate by second see jitter.

**Before:**
```go
t := time.NewTicker(1 * time.Second) // drifts by initialization phase
```

**After:** sleep to the next boundary, then start the ticker.

```go
now := time.Now()
nextSec := now.Truncate(time.Second).Add(time.Second)
time.Sleep(time.Until(nextSec))

t := time.NewTicker(1 * time.Second)
defer t.Stop()
```

**Gain.** First tick lands on the next second boundary; subsequent ticks stay aligned (modulo small jitter from the runtime, typically < 1 ms). Across many instances, ticks are synchronized to wall-clock boundaries, which simplifies cross-instance correlation in metrics pipelines.

Caveat: synchronized ticks can cause a "thundering herd" if every instance does heavy work at second boundaries. If that is a concern, alignment to the boundary plus a small random jitter per instance gives you both predictability and load smoothing:

```go
jitter := time.Duration(rand.Int63n(int64(100 * time.Millisecond)))
time.Sleep(time.Until(nextSec) + jitter)
```

---

## Optimization 10 — Stop and drop the ticker during long idle periods

**Problem.** A service that ticks every minute to handle background maintenance keeps the ticker armed for 60 seconds even when there is nothing to do and the system is otherwise idle. On battery-powered devices, this prevents the OS from putting the process to sleep; on cold-data services this prevents large-grain scheduling optimizations.

**Before:**
```go
t := time.NewTicker(1 * time.Minute)
defer t.Stop()
for {
    select {
    case <-t.C:
        if hasWork() {
            do()
        }
    case <-ctx.Done():
        return
    }
}
```
Every minute the runtime wakes up, even when `hasWork()` returns false for hours.

**After:** drop the ticker entirely when idle; resurrect when an event signals "you have work again."

```go
var t *time.Ticker
defer func() {
    if t != nil {
        t.Stop()
    }
}()

for {
    if hasPendingWork() {
        if t == nil {
            t = time.NewTicker(1 * time.Minute)
        }
    } else {
        if t != nil {
            t.Stop()
            t = nil
        }
    }

    var tickCh <-chan time.Time
    if t != nil {
        tickCh = t.C
    }

    select {
    case <-tickCh: // nil if t == nil; this case is disabled
        do()
    case <-workSignal:
        // re-evaluate at the top of the loop
    case <-ctx.Done():
        return
    }
}
```

**Gain.** Idle CPU drops to zero. On a laptop, the process gets coalesced into deep sleep with the rest of the OS. On a server, scheduler jitter from this process's repeated wakeups disappears from neighbouring tasks' profiles.

The trick — assigning `nil` to the channel variable to disable the `select` case — is the canonical idiom for "selectable when armed, invisible when not." Receive on a nil channel blocks forever, which in a `select` means "this case never fires." Setting `tickCh` to `t.C` or `nil` based on state gives you an on/off switch without code branches inside the `select`.

This optimization is the most aggressive — you are not just reducing wakeups, you are eliminating the underlying timer entry from the runtime heap when not needed. For a service with thousands of background loops in the same instance, the cumulative effect on runtime overhead is significant.

---

## Final note

Most ticker "optimization" is not about making the ticker faster — it is about *using fewer tickers*. The runtime's timer machinery is well tuned and rarely the bottleneck on its own; what causes problems is constructing one ticker per request, one per connection, one per task. Each pattern above shrinks the *count* of tickers or removes them entirely: share across consumers, coalesce intervals into a scheduler, replace one-shots with `AfterFunc`, replace polling with push.

A reasonable mental checklist before adding a `time.NewTicker`:

1. Is this firing more often than I actually need? Widen the interval.
2. Is there a push signal I could use instead? Replace the ticker with an event channel.
3. Does this fire only once? Use `time.AfterFunc`.
4. Do many independent consumers need the same cadence? Use one shared ticker with fan-out.
5. Do many independent consumers need *different* cadences at scale? Use a heap-based scheduler.
6. Does the work per tick take longer than the interval? Move the work off the ticker goroutine, or batch.
7. Do I care about wall-clock alignment? Sleep to the boundary before starting.
8. Can I drop the ticker entirely when idle? Make it conditional.

Profile before you optimize. `go tool pprof` will show you `runtime.siftupTimer`, `time.NewTimer`, and similar entries near the top of the CPU profile when the timer subsystem is the bottleneck. Without those hot spots, leave the tickers alone — premature ticker micro-optimization is wasted effort. With those hot spots, the optimizations above usually cut the timer share to negligible.

[← Back](../)
