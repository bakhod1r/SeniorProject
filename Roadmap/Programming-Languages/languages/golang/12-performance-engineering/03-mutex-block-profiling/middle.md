# Mutex and Block Profiling — Middle

## 1. The middle-engineer workflow

You have a service that's slow. CPU isn't pegged. Latency p99 is 80 ms when the median is 4 ms. Where do you look?

The deterministic order:

1. **CPU profile** — confirm we're not just burning CPU.
2. **Goroutine profile** — count what's parked, in what state.
3. **Mutex + block profile** — find which primitive is the bottleneck.
4. **Execution trace** — only if the above didn't pin it down.

This file is about steps 2–3. The CPU profile lives in `01-cpu-profiling`; the trace lives in `07-trace-tool`.

---

## 2. The minimum production setup

```go
package main

import (
    _ "net/http/pprof"
    "net/http"
    "runtime"
)

func init() {
    runtime.SetMutexProfileFraction(100)
    runtime.SetBlockProfileRate(10000) // ~10 μs threshold

    go func() {
        _ = http.ListenAndServe("127.0.0.1:6060", nil) // localhost only
    }()
}
```

Three things to internalise:

- The `init` runs before `main`, so profiling is on from the very first request.
- Binding to `127.0.0.1` keeps the pprof endpoints off the public internet — they leak source paths.
- The rates above (`100`, `10000`) are conservative defaults. You can lower them in staging when chasing a specific bug.

---

## 3. Mutex profile vs. block profile, properly

The two profiles overlap on mutex contention but answer different questions.

| Aspect | Mutex profile | Block profile |
|--------|---------------|---------------|
| Triggered at | `Unlock()` (after a waiter has been parked) | Goroutine park time on any sync primitive |
| Stack attributed | The **unlocker** | The **waiter** |
| Sampling | 1 in N events | Per-event probability `delay / rate` |
| Covers | `Mutex`, `RWMutex` only | `Mutex`, channel, select, `Cond`, `WaitGroup`, `time.Sleep` |
| Best for | "Which code holds locks too long?" | "Which code waits the most?" |

A typical session uses both. The mutex profile names the offender; the block profile shows whether the symptom is one big lock, one slow channel, or fan-out across several primitives.

---

## 4. Capturing a delta

A snapshot at `t=0` contains samples accumulated since startup. To investigate "what happened during this 60-second window", take two snapshots and diff them:

```bash
curl -s "http://localhost:6060/debug/pprof/mutex" -o m1.pb.gz
sleep 60
curl -s "http://localhost:6060/debug/pprof/mutex" -o m2.pb.gz
go tool pprof -base m1.pb.gz m2.pb.gz
```

In the pprof prompt:

```
(pprof) top
(pprof) list <funcname>
```

`list` is the killer feature: it prints the source code annotated with per-line contention totals, so you see which exact line inside a function is the bottleneck.

---

## 5. Reading the top line

```
(pprof) top -cum
Showing nodes accounting for 4.2s, 96.5% of 4.35s total
      flat  flat%   sum%        cum   cum%
     1.2s 27.5% 27.5%       4.2s 96.5%  main.(*Cache).Get
     1.1s 25.2% 52.7%       3.8s 87.3%  main.(*Cache).put
     ...
```

Interpretation:

- `flat` is contention attributed **directly** to that frame.
- `cum` (cumulative) includes everything that frame's callees did.
- `main.(*Cache).Get` is the top by `cum`: somewhere underneath it, lots of waiting happens.

Drop down with `list main.(*Cache).Get` to find the actual `mu.Lock()` line.

---

## 6. Three contention patterns you will keep seeing

### Pattern A: the single global lock

```go
var (
    mu    sync.Mutex
    cache = map[string]Value{}
)

func Get(k string) Value {
    mu.Lock()
    defer mu.Unlock()
    return cache[k]
}
```

The mutex profile points at `Get`. The block profile shows everyone parked on `Lock`. Total contention scales linearly with QPS. Fixes: `sync.RWMutex`, sharding, or `sync.Map`.

### Pattern B: the oversized critical section

```go
mu.Lock()
v := compute(k)              // 5 ms of CPU work
cache[k] = v
mu.Unlock()
```

The lock is held for the whole computation. Move work outside:

```go
v := compute(k)
mu.Lock()
cache[k] = v
mu.Unlock()
```

Mutex profiles light up on the `compute` call line inside the locked region.

### Pattern C: channel back-pressure

```go
out := make(chan Job)        // unbuffered
go func() { for j := range out { process(j) } }()

for _, j := range jobs {
    out <- j                 // blocks every time process is slow
}
```

Block profile shows the producer waiting on `chan send`. The fix is rarely "make the buffer huge"; it's "match the consumer's rate" or "make the consumer faster".

---

## 7. `sync.RWMutex` and what its profile looks like

`RWMutex` is a write-preferring read/write lock. When uncontended, `RLock`/`RUnlock` are pair-of-atomics fast. Once a writer is waiting, all new readers block — this can flip a read-heavy workload from "fast" to "very slow" the instant a writer arrives.

In the mutex profile:

| Symptom | Stack trace shape |
|---------|-------------------|
| One slow writer | `RWMutex.Unlock` at top, write path callers below |
| Read-stampede after a write | `RWMutex.RUnlock` of the writer (write attribution); waiters in the block profile |

If `RUnlock` shows up in your mutex profile, that's a writer triggering a wave of waiting readers. Two patterns help:

1. Shorten the write critical section (compute outside, swap inside).
2. Use copy-on-write: build a new immutable snapshot, swap an `atomic.Pointer` to it. Readers never lock at all.

---

## 8. `sync.Map`, when and why

```go
var m sync.Map
m.Store(key, val)
v, ok := m.Load(key)
```

`sync.Map` is **not** "a faster map". It's a specialised structure optimised for two patterns:

1. Many readers, rare writers (read-mostly cache).
2. Keys that are disjoint across goroutines (per-goroutine accumulators).

Profile signature when `sync.Map` helps: a regular `map[K]V` with a `sync.Mutex` showed enormous contention; the same workload with `sync.Map` produces a nearly empty mutex profile because reads short-circuit on the read-only sub-map.

When it doesn't help: balanced read/write or all-writes workloads. Then `sync.Map` is *slower* than a sharded plain map.

---

## 9. Atomics as a contention escape

For counters, flags, and "latest value" patterns, replace the mutex with `sync/atomic`:

```go
import "sync/atomic"

var counter int64

func inc() { atomic.AddInt64(&counter, 1) }
func get() int64 { return atomic.LoadInt64(&counter) }
```

Atomic operations don't show up in the mutex or block profile — they don't park goroutines. They do show up in the CPU profile (a tiny constant cost per call). A 1% block profile entry that disappears entirely after switching to atomics is a clean win.

For multi-field updates, atomics get harder; use `atomic.Pointer[T]` and copy-on-write rather than reaching for `unsafe`.

---

## 10. The `goroutine` profile as a cross-check

```bash
go tool pprof http://localhost:6060/debug/pprof/goroutine
```

This profile counts goroutines by stack at the moment of capture. If 90% are parked on `runtime.semacquire` called from your `Cache.Get`, that's a *live* read of the same contention the mutex profile shows over time. Useful for confirming the bottleneck is still active right now, not just historically.

---

## 11. Diff workflow for a fix

You suspect a fix. The honest test is a diff:

```bash
# capture baseline
curl http://localhost:6060/debug/pprof/mutex > before.pb.gz

# deploy the fix to one canary instance

# capture after the same load
curl http://localhost:6060/debug/pprof/mutex > after.pb.gz

go tool pprof -base before.pb.gz after.pb.gz
```

A negative `flat` for the targeted function means contention dropped. A positive number means you made it worse (it happens; rolling back is fine).

---

## 12. Common middle-engineer mistakes

| Mistake | Why it bites |
|---------|--------------|
| Enabling block profile at `rate=1` in production | Records every event including short locks; can use 5–10% CPU on busy services |
| Reading the mutex profile before enabling it | `pprof.Lookup("mutex")` works without enabling; profile is empty and you waste an hour |
| Treating sampled numbers as exact | Both profiles are statistical; trends matter, exact nanoseconds don't |
| Diffing without a stable workload | You're seeing load variance, not your fix |
| Optimising the top frame without `list` | The expensive line is rarely the function entry |

---

## 13. Summary

The middle-engineer routine: enable both profiles in `init` with conservative rates, expose via a localhost pprof port, capture deltas with `-base`, climb from `top -cum` down through `list <fn>` to the offending line, then verify with a diff. Three patterns explain most contention you'll see (global lock, oversized critical section, channel back-pressure). `RWMutex`, `sync.Map`, atomics, and sharding are the standard fixes; pick by the profile, not by reflex.

---

## Further reading
- `runtime/pprof.Lookup`: https://pkg.go.dev/runtime/pprof#Lookup
- `sync` patterns: https://pkg.go.dev/sync
- pprof `list` and `weblist`: https://github.com/google/pprof/blob/main/doc/README.md
- Dave Cheney, "High Performance Go workshop": https://dave.cheney.net/high-performance-go-workshop
