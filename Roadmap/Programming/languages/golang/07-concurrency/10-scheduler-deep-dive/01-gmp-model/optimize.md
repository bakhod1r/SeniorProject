# The G-M-P Model — Optimize

[← Back to index](index.md)

## How to Use This Page

Each section presents a performance scenario, an explanation grounded in G-M-P internals, and concrete fixes. Numbers are illustrative; always measure on your own workload.

---

## 1. Set `GOMAXPROCS` to the Right Value

**Symptom**: CPU profile shows healthy work distribution, but throughput plateaus far below expected.

**Why**: P count is the user-code parallelism cap. Too few Ps and you leave cores idle; too many Ps and you cause context-switch overhead plus cache thrashing.

**Defaults**:
- Go ≤ 1.24: `GOMAXPROCS = runtime.NumCPU()`. In a container with `cpu.max = 2 100000` on a 32-core host, this still reports 32 — a four-x mismatch.
- Go ≥ 1.25: cgroup-aware default. Reads `cpu.max` and sets `GOMAXPROCS` accordingly.

**Fix options**:
1. Upgrade to Go 1.25+ for cgroup-aware default.
2. Use `go.uber.org/automaxprocs` (import for side effect). Reads cgroup, calls `runtime.GOMAXPROCS(n)` at init.
3. Set explicitly via `GOMAXPROCS=4 ./prog`.
4. In Kubernetes, use a downward API env var to match the CPU request/limit.

**Measure**: throughput at `GOMAXPROCS` = `n/4`, `n/2`, `n`, `n*2` where `n` is your cgroup quota. Pick the peak.

---

## 2. Avoid `runtime.LockOSThread` Unless Required

**Symptom**: M count grows to hundreds or thousands; OS-level CPU usage seems higher than the Go heap profile predicts.

**Why**: `LockOSThread` pins a G to its M. The M cannot serve other Gs. The runtime must spawn additional Ms to replace it for the rest of the goroutines. If your hot path locks frequently, you accumulate Ms (each ~10 KiB of kernel state plus an 8 KiB g0 stack).

**Diagnosis**:
- `runtime.NumGoroutine()` is fine but `cat /proc/$PID/status | grep Threads` is high.
- `GODEBUG=schedtrace=1000,scheddetail=1` shows many Ms with no G running.

**Fix**:
- Only call `LockOSThread` when you genuinely need thread-local OS state: cgo with thread-local-storage libraries, signal masks, per-thread credentials.
- Always defer `UnlockOSThread` right after locking.
- For per-G unique state, use goroutine-local patterns (context values, function arguments).

---

## 3. Bound Concurrent Cgo Calls

**Symptom**: M count balloons under load; per-cgo-call latency increases dramatically beyond a certain concurrency.

**Why**: a cgo call holds an M outside the scheduler. While the M is in C, the runtime cannot use it. To keep Ps busy, the runtime spawns more Ms. With 1000 concurrent cgo calls, you have 1000 Ms.

**Fix**: introduce a semaphore around the cgo call.

```go
var cgoSem = make(chan struct{}, 16) // permit at most 16 concurrent cgo calls

func wrappedCgo() {
    cgoSem <- struct{}{}
    defer func() { <-cgoSem }()
    C.heavy_call()
}
```

Tune the permit count to match the underlying resource (a database driver's connection pool, a GPU's capacity, etc.).

---

## 4. Shard Hot Channels

**Symptom**: a single channel receives from many goroutines. Mutex profile shows `runtime.lock2` as top hotspot.

**Why**: `hchan` has one lock per channel. With 100+ producers, every send contends. The runtime's spin-mutex falls through to futex sleeps. Throughput is bounded by lock acquire bandwidth.

**Fix**: shard.

```go
const N = 8
channels := make([]chan Job, N)
for i := range channels {
    channels[i] = make(chan Job, 64)
}

// Producer:
channels[id%N] <- job

// Consumer: one goroutine per shard, or one consumer doing a select fan-in.
for _, ch := range channels {
    go consume(ch)
}
```

Sharding factor `N` should equal or slightly exceed the number of contended-on cores. 8-16 covers most cases.

---

## 5. Avoid Goroutine-Per-Item Patterns for Small Items

**Symptom**: 10000 goroutines each processing a single byte. Throughput is low; scheduler overhead dominates.

**Why**: each goroutine creation costs ~200 ns. Each scheduling costs ~50 ns. For a 10-ns "process this byte" payload, overhead is 25x the work.

**Fix**: batch.

```go
const BatchSize = 64
batches := chunkInput(data, BatchSize)

var wg sync.WaitGroup
for _, batch := range batches {
    wg.Add(1)
    go func(b []byte) {
        defer wg.Done()
        for _, x := range b {
            process(x)
        }
    }(batch)
}
wg.Wait()
```

Choose batch size so that per-goroutine work is on the order of microseconds, not nanoseconds.

---

## 6. Prefer Worker Pools to Fan-Out Goroutines

**Symptom**: each incoming request spawns several short-lived goroutines.

**Why**: goroutine creation is cheap (~200 ns + 2 KiB stack) but not zero. At 100k requests/sec * 5 goroutines = 500k creations/sec; the allocation rate becomes noticeable in GC.

**Fix**: a fixed pool of long-lived workers consuming from a channel.

```go
const Workers = 16
work := make(chan Request, 1024)

for i := 0; i < Workers; i++ {
    go func() {
        for r := range work {
            handle(r)
        }
    }()
}

// Producer:
work <- request
```

The runtime's gFree cache absorbs short-lived G reuse, but eliminating creations entirely is better.

---

## 7. Exploit `runnext` for Hot Channels

**Symptom**: channel-driven pipeline has higher latency than expected, despite each stage being cheap.

**Why**: each handoff between stages may cost a full `runqput` + `runqget` cycle if the next stage is on a different P. With `GOMAXPROCS=1`, both stages share a P and `runnext` keeps them ping-ponging optimally.

**Fix**:
- For tight pipelines with two stages, consider `GOMAXPROCS=1` if total throughput allows.
- Alternatively, use `runtime.LockOSThread` on both stages and pin them to the same goroutine-affinity manager. (Rare.)
- Or, redesign so each stage does enough work that handoff overhead is amortised.

---

## 8. Reduce Goroutine Stack Size for Many-Idle Workloads

**Symptom**: process RSS is huge (gigabytes) with hundreds of thousands of mostly-idle goroutines.

**Why**: each G starts with 2 KiB but grows. A goroutine that ever calls a deep function tree may have a 16-KiB+ stack. With 200k goroutines, that's 3.2 GiB.

**Fix options**:
1. **Refactor to fewer goroutines**. The most reliable cure.
2. **Avoid stack growth**: keep function call depth shallow; avoid recursive functions.
3. **`runtime/debug.SetMaxStack`** caps stack growth per goroutine (default 1 GiB; lowering it helps catch runaway recursion).

There is no public `SetInitialStackSize`. The 2-KiB initial is hardcoded in the runtime.

---

## 9. Tune for Tail Latency Under Bursty Load

**Symptom**: average request latency is fine, p99 is 10x worse.

**Why**: under bursts, the global runqueue accumulates. Some Gs wait for the 61-tick fairness sip. Some wait for work-stealing to reach them. The scheduler is fair on average but not bounded on tail.

**Fix**:
- Pre-create enough goroutines to absorb the burst without queueing.
- Ensure idle Ps are available to steal: more `GOMAXPROCS` (within reason).
- Pre-warm the gFree pool by spawning and exiting many goroutines at startup.
- Profile with `runtime/metrics` `/sched/latencies:seconds`.

---

## 10. Inspect `/sched/latencies:seconds`

**What it is**: a histogram of time goroutines spend in `_Grunnable` before transitioning to `_Grunning`. The "scheduler latency."

**How to read**:
- P99 around microseconds: healthy.
- P99 around milliseconds: scheduler is busy; check for too many Ms spinning, too many goroutines per P.
- P99 above 10 ms: starvation. Look for long-running Gs without yields, GC STW pauses, or blocked Ps.

```go
import "runtime/metrics"

s := []metrics.Sample{{Name: "/sched/latencies:seconds"}}
metrics.Read(s)
h := s[0].Value.Float64Histogram()
// Inspect h.Counts and h.Buckets.
```

Plot the histogram. The shape tells you whether your bottleneck is sustained contention or rare spikes.

---

## 11. Reduce GRQ Traffic

**Symptom**: profiles show `runtime.globrunqget` and `runtime.globrunqput` hot.

**Why**: each global-queue operation takes `sched.lock`. If many Gs spill from LRQs to the GRQ, the lock is contended.

**Causes**:
- Many goroutines created from a single spawner (LRQ overflow into GRQ).
- Many timers firing simultaneously (timer-driven Gs go to LRQ first, but may overflow).
- Frequent `wakep` calls returning Gs that the spinning M placed on GRQ.

**Fix**:
- Spread goroutine creation across goroutines (each spawner uses its own P's LRQ).
- Reduce timer frequency or batch.
- If `wakep` is the source, increase batching of work to reduce wake events.

---

## 12. Avoid Pinning Goroutines to Slow Resources

**Anti-pattern**:

```go
go func() {
    for {
        item := <-fastChannel
        slowDatabaseWrite(item) // takes 50 ms
    }
}()
```

**Problem**: this single consumer is the bottleneck. `fastChannel` fills, producers block.

**Fix**: pool of consumers.

```go
const Consumers = 8
for i := 0; i < Consumers; i++ {
    go func() {
        for item := range fastChannel {
            slowDatabaseWrite(item)
        }
    }()
}
```

The number of consumers should match the resource's concurrency capacity (database connection pool size, etc.).

**Why the internals matter**: a parked consumer goroutine does not advance the queue. P is irrelevant; the bottleneck is the resource. Adding more Ps does not help; adding more consumers does.

---

## 13. Profile Mutex Contention

```go
import "runtime"

func main() {
    runtime.SetMutexProfileFraction(5)
    // ... your app ...
}
```

Then `go tool pprof -http=:8080 mutex.prof`. The "Top" view shows where contention is. If `runtime.lock2` or `chan.lock2` are top, you have a scheduler-level hotspot.

For channels: shard them. For your own mutexes: shorten critical sections or replace with atomics where feasible.

---

## 14. Reduce `findRunnable` Spinning Cost

**Symptom**: CPU profile shows time in `runtime.findRunnable`, `runtime.runqsteal`.

**Cause**: many Ms spinning while there is no work to find. The work-stealing pass is non-cheap (touches every P's runq).

**Fix**:
- Lower `GOMAXPROCS` to match steady-state needs.
- Increase per-event work so events become rarer (and longer).
- Avoid micro-yields (`runtime.Gosched` in tight loops) that push work back to GRQ and trigger steals.

---

## 15. Watch Out for `sync.Pool` Across Ps

**Pattern**: `sync.Pool` is per-P internally. `Get`/`Put` go to the local pool first.

**Problem**: a goroutine that allocates on P1 and is then moved to P2 (via stealing) puts the object back on P2's pool, not P1's. Hot allocation paths can see cross-P traffic.

**Fix**: usually fine; `sync.Pool` is designed for this. But for objects with strong cache locality (e.g., a buffer just written to), prefer pinning the work to one P (via channels that stay on one P) to avoid pool migration.

---

## 16. Measure Before Tuning

Every optimisation above is contingent on actual measurement. Tools:

- `go tool trace` — visual scheduler timeline.
- `go test -bench` + `-benchmem` — basic numbers.
- `pprof` (CPU, mutex, block, goroutine, allocs) — hotspots.
- `runtime/metrics` — scheduler latency, GC stats, idle time.
- `GODEBUG=schedtrace=1000` — periodic scheduler state.

Do not optimise blind. The G-M-P model is fast; most bottlenecks are in user code, not the scheduler. When the scheduler *is* the bottleneck, the tools above will say so.

---

## 17. When in Doubt, Lower `GOMAXPROCS`

A surprising number of "performance problems" disappear when `GOMAXPROCS` is reduced. Common reasons:

- CPU profile suggests parallelism, but contention overhead dominates above some thread count.
- Container CPU quota is lower than the host's `NumCPU`.
- Cache-bound workloads scale better with fewer threads sharing L2/L3.
- GC and scheduler overhead grow with P count.

Try halving `GOMAXPROCS`; measure. Then try doubling. Plot the curve. The optimum is often surprising.

---

## Closing Notes

The G-M-P model is not a black box you blindly trust. It is a set of structs whose behavior you can predict and tune. Most of the "right answer" for production tuning is in three lines:

```
GOMAXPROCS = cgroup quota
worker pool sized to GOMAXPROCS for CPU-bound, to resource limit for I/O-bound
no LockOSThread unless required
```

Everything else is profiling-driven refinement around those three rules.
