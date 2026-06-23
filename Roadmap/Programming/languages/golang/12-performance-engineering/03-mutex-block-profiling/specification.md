# Mutex and Block Profiling — Specification

> **Focus:** Precise reference for how Go records contention on synchronisation primitives and goroutine blocking, the runtime knobs that enable those profiles, and the wire formats consumed by `pprof`.
>
> **Sources:**
> - `runtime` package: https://pkg.go.dev/runtime
> - `runtime/pprof` package: https://pkg.go.dev/runtime/pprof
> - `net/http/pprof` package: https://pkg.go.dev/net/http/pprof
> - `pprof` profile format: https://github.com/google/pprof/blob/main/doc/README.md
> - Mutex profile design doc: https://github.com/golang/go/issues/12118

---

## 1. The two profiles at a glance

Go ships two distinct sampling profiles for synchronisation, each off by default.

| Profile | What it samples | Units in the profile | Enabled by |
|---------|-----------------|----------------------|------------|
| **Mutex** | Time goroutines spent **waiting to acquire** a `sync.Mutex` or `sync.RWMutex` after another goroutine *unlocked* it | nanoseconds | `runtime.SetMutexProfileFraction(N)` |
| **Block** | Time goroutines spent **blocked** on channel ops, select, mutex acquisition, `sync.Cond.Wait`, `time.Sleep`, and a few other primitives | nanoseconds | `runtime.SetBlockProfileRate(N)` |

The two overlap on `Mutex.Lock` contention. The mutex profile is attributed to the **unlocker** (the goroutine that held the lock long enough to make somebody wait). The block profile is attributed to the **waiter** (the goroutine that was descheduled).

---

## 2. Enabling APIs

### `runtime.SetMutexProfileFraction(rate int) int`

Reports one out of every `rate` mutex contention events. Returns the previous value.

| Argument | Meaning |
|----------|---------|
| `rate <= 0` | Disable the profile; preserve existing samples |
| `rate == 1` | Record every event (high overhead under heavy contention) |
| `rate >= 1` | Sample 1 in `rate` events |

The recommended production value is somewhere between `100` and `1000`. The runtime multiplies the recorded delay by `rate` so the reported totals stay calibrated.

### `runtime.SetBlockProfileRate(rate int) (was int)`

Controls the block profile. The argument is interpreted in **nanoseconds**: a block event that lasted `d` nanoseconds is recorded with probability `d / rate` (and `rate=1` means every event).

| Argument | Meaning |
|----------|---------|
| `rate <= 0` | Disable the profile |
| `rate == 1` | Record every blocking event |
| `rate == 10000` | Roughly: record events that block for at least 10 μs |
| `rate == 1_000_000` | Record events that block for at least 1 ms |

Setting the rate does **not** clear prior samples. To reset the profile, drain it via `pprof.Lookup("block").WriteTo(io.Discard, 0)` after disabling.

---

## 3. What the block profile records

The block profile records goroutines that the scheduler **parks** on a known synchronisation primitive. The set, as of Go 1.24:

| Primitive | Reason for parking |
|-----------|--------------------|
| `chan send` / `chan recv` | Channel buffer full / empty; no peer ready |
| `select` | No case ready |
| `sync.Mutex.Lock` | Mutex held by another goroutine |
| `sync.RWMutex.Lock` / `RLock` | Held in conflicting mode |
| `sync.Cond.Wait` | Waiting for `Signal`/`Broadcast` |
| `sync.WaitGroup.Wait` | Counter > 0 |
| `time.Sleep` | Sleeping with goroutine attached |
| `runtime.Gosched`-induced parks | Some internal cases (rare) |

It does **not** record GC assists, scheduling latency, network I/O waits, or syscall blocking. For those, use the execution tracer (`runtime/trace`) or CPU profile.

---

## 4. What the mutex profile records

The mutex profile counts **delay caused to other goroutines** by holding a lock. The stack trace is captured at the moment of `Unlock`, attributing the contention to the code that *released* the mutex (because that's the code that, by holding it, made others wait).

| Property | Behaviour |
|----------|-----------|
| Covers | `sync.Mutex`, `sync.RWMutex` (write lock; read lock contention attributed to writer) |
| Sample stored | (count, total-delay-nanoseconds, stack) |
| Attribution | Unlocker's stack at `Unlock` time |
| Doesn't cover | `chan`, `select`, `Cond`, custom spinlocks |

The total contention reported is the **sum of waiting times of other goroutines**, not the holding time. A lock held for 100 ms with no waiter contributes 0 ns.

---

## 5. HTTP endpoints

With `net/http/pprof` imported, an admin server exposes:

| Path | Backed by | Default seconds parameter |
|------|-----------|---------------------------|
| `/debug/pprof/mutex` | `pprof.Lookup("mutex")` | n/a (snapshot) |
| `/debug/pprof/block` | `pprof.Lookup("block")` | n/a (snapshot) |
| `/debug/pprof/goroutine` | live goroutine stacks | n/a |
| `/debug/pprof/profile?seconds=30` | CPU profile | 30 |

Both `mutex` and `block` are **snapshots of accumulated samples since enabling** — not time-windowed by default. To get a delta over a window: take a snapshot, sleep, take another, run `pprof -base old.pb.gz new.pb.gz`.

---

## 6. Programmatic capture

```go
import (
    "os"
    "runtime"
    "runtime/pprof"
)

func writeMutexProfile(path string) error {
    runtime.SetMutexProfileFraction(100)
    f, err := os.Create(path)
    if err != nil {
        return err
    }
    defer f.Close()
    return pprof.Lookup("mutex").WriteTo(f, 0)
}

func writeBlockProfile(path string) error {
    runtime.SetBlockProfileRate(10000) // ~10 μs threshold
    f, err := os.Create(path)
    if err != nil {
        return err
    }
    defer f.Close()
    return pprof.Lookup("block").WriteTo(f, 0)
}
```

The `WriteTo` debug level (`0` here) produces the **binary** pprof profile that the `go tool pprof` UI accepts. Level `1` writes a text dump (useful only for quick eyeballing).

---

## 7. Profile semantics — counts vs. delay

Both profiles record two values per sample location:

| Index | Mutex profile | Block profile |
|-------|---------------|---------------|
| 0 | `contentions` (count of contention events) | `contentions` (count of block events) |
| 1 | `delay` (nanoseconds, summed) | `delay` (nanoseconds, summed) |

In `pprof`, switch with `-sample_index=contentions` or `-sample_index=delay`. Default is `delay` for both, which is almost always what you want.

---

## 8. Overhead

Both profiles use **fast sampling paths** in the runtime:

| Profile | Cost when off | Cost when on (default rates) |
|---------|---------------|-------------------------------|
| Mutex | Zero (single atomic check) | < 1% CPU at `rate=100` for most workloads |
| Block | Zero | 1–3% CPU at `rate=10000` (10 μs threshold); higher with smaller rate |

The dominant cost is the `runtime.Callers` stack walk performed on each sample. At small rates (`rate=1`) and high contention, profiles can dominate CPU; that's why production defaults sit between 100 and 10 000.

---

## 9. Interaction with the scheduler

Block events are reported from the **park** path. The runtime records:

```
event_record {
    stack:    runtime.Callers at park time
    cycles:   cpu_ticks at unpark - cpu_ticks at park
    skip:     2 (skip runtime frames)
}
```

The `cycles` value is converted to nanoseconds and divided by the sampling probability for accounting. This means **very short blocks may not appear** under typical block-rate settings — the sample is taken at unpark and accepted with probability `delay / rate`.

---

## 10. Mutex profile internals

The mutex profile fires from `sync.runtime_SemacquireMutex` / `runtime_SemrelaseMutex`. When the unlocker hands off the lock:

1. Compute `delay = now - waiter_blocked_at`.
2. With probability `1/fraction`, walk the unlocker's stack with `runtime.Callers`.
3. Add `(rate × delay)` to that stack's accumulator.

Step 3 scales by `rate` so that a 1-in-100 sample with a real delay of 1 ms shows as 100 ms in the profile (statistically correct in aggregate).

---

## 11. `pprof` command reference

| Command | Purpose |
|---------|---------|
| `go tool pprof mutex.pb.gz` | Open the mutex profile interactively |
| `go tool pprof -http=:8080 block.pb.gz` | Web UI (flame graph, callers/callees) |
| `go tool pprof -top mutex.pb.gz` | List top contributors by delay |
| `go tool pprof -lines mutex.pb.gz` | Line-level granularity |
| `go tool pprof -base old.pb.gz new.pb.gz` | Diff: shows changes between captures |
| `go tool pprof -sample_index=contentions block.pb.gz` | Count events rather than delay |
| `go tool pprof -focus=Lock block.pb.gz` | Restrict to stacks matching regex |

The `-base` mode is the workhorse for production: it removes background contention common to both snapshots and surfaces only what changed.

---

## 12. Related runtime knobs

| Knob | Effect on these profiles |
|------|--------------------------|
| `runtime.MemProfileRate` | Independent (heap profile) |
| `runtime.SetCPUProfileRate` | Independent (CPU profile) |
| `GODEBUG=schedtrace=1000` | Periodic scheduler dump; useful for confirming block-driven park spikes |
| `GODEBUG=mutexprofilefraction=N` (1.21+) | Sets mutex fraction at startup, before `main` |
| `GODEBUG=blockprofilerate=N` (1.21+) | Sets block rate at startup |

The `GODEBUG` variants are convenient for short-lived programs (one-shot benchmarks, batch jobs) that finish before code can call `SetMutexProfileFraction`.

---

## 13. Non-goals and limitations

- The block profile does **not** explain *why* a buffer was full — only that you waited on it. Correlate with CPU profile or trace.
- Neither profile measures **lock holding time** directly. A long-held lock with no waiter is invisible.
- Spinning is not measured: short contention resolved by the runtime's adaptive spin never enters the profile.
- Lock-free atomics never appear; they have nothing to wait on.
- Profiles accumulate from enabling; you cannot ask for "the last 30 seconds" without taking deltas.

---

## 14. Related references

- `sync` package source: https://github.com/golang/go/tree/master/src/sync
- Mutex profile original proposal: https://github.com/golang/go/issues/12118
- Block profile: https://github.com/golang/go/issues/14689
- Felix Geisendörfer, "The Busy Developer's Guide to Go Profiling, Tracing and Observability": https://github.com/DataDog/go-profiler-notes
