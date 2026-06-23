# Mutex and Block Profiling — Senior

## 1. The runtime model in five facts

Hold these together as one picture before reading anything below:

- **A goroutine that waits on a sync primitive is *parked* by the runtime.** Its `g` moves out of the run queue. No CPU is spent waiting.
- **The mutex profile fires from `Unlock`, not from `Lock`.** The unlocker's stack is captured because that's the code whose holding-time *caused* somebody else's wait.
- **The block profile fires from the park site of the waiter.** The waiter's stack is captured.
- **Both profiles are *Bernoulli-sampled*.** For mutex: 1-in-N per event. For block: per-event probability `delay / rate`, so longer blocks are more likely to be recorded.
- **Scaled accumulation.** Each recorded event is multiplied by its inverse probability before being added to the profile, so totals are statistically unbiased given enough samples.

Every "weird" reading you'll get is explained by these five.

---

## 2. The sampling math for the block profile

Set `runtime.SetBlockProfileRate(rate)`. An event of duration `d` nanoseconds is recorded with probability:

```
p(record | d) = min(1, d / rate)
```

When it *is* recorded, the contribution to the profile is `d` (not `d / p`). The reason it averages out: the *expected* contribution per event is `d × p = d × min(1, d/rate)`. For events with `d < rate`, that's `d² / rate`; for events with `d >= rate`, that's `d`. The runtime then divides the bucket totals by the sampling rate at read time, producing an unbiased estimate of the **sum of squared durations divided by rate** for short blocks, asymptotically converging to total wait time for long ones.

Practical implications:

- At `rate=10000` (10 μs), blocks of 1 μs contribute `1²/10000 = 0.0001` per event — essentially invisible. Blocks of 100 μs contribute 100 each, recorded with `p=0.01`.
- The profile **biases toward long blocks**. That's usually what you want; short locks of microsecond duration are not interesting.
- To see microsecond contention, you must drop `rate` to 1 (recording everything) and pay the CPU cost. Do this in benchmarks, not production.

---

## 3. The mutex profile sampling math

`runtime.SetMutexProfileFraction(N)`. On `Unlock` after a waiter has been parked, with probability `1/N`:

```
profile[stack].count += 1
profile[stack].delay += rate × (now - waiter_blocked_at)
```

The `rate × delay` scaling means a 1-in-100 sample with a real delay of 1 ms shows as 100 ms in the profile. Aggregated across many events, the bias is zero. Per-stack reads are *noisy* unless you have hundreds of samples.

| Setting | When to use |
|---------|-------------|
| `1` | Benchmarks, deterministic test for contention |
| `10` | Staging investigation, short capture window |
| `100` | Production default (recommended) |
| `1000` | Very high-frequency mutex usage (e.g., per-packet) |

The setting is process-global. There's no per-mutex or per-package control. If you want a finer view of one structure, build a test harness around it.

---

## 4. Mutex contention vs. blocking — distinct phenomena

These overlap **only** on `Mutex` and `RWMutex`. Beyond that they diverge:

| Primitive | Mutex profile | Block profile |
|-----------|---------------|---------------|
| `sync.Mutex` | Yes (unlocker) | Yes (waiter) |
| `sync.RWMutex` | Yes (unlocker only, write side) | Yes (any waiter) |
| `chan` send / recv | No | Yes |
| `select` | No | Yes |
| `sync.Cond.Wait` | No | Yes |
| `sync.WaitGroup.Wait` | No | Yes |
| `time.Sleep` | No | Yes |
| `sync.Once.Do` | No | Yes (rare; only if a concurrent caller waits) |
| Network read/write | No | No |
| Syscall | No | No |
| GC assist | No | No |

A common confusion: people see channel back-pressure and look for a mutex problem. Channel waits are never in the mutex profile — they're in the block profile, attributed to the goroutine that called `<-` or `<-chan`.

---

## 5. Scheduler interaction

When a goroutine blocks on a primitive, the runtime calls `gopark`. This:

1. Marks the `g` as `Gwaiting`.
2. Records `g.blockedat = cpuTicks()` if the block profile is enabled.
3. Releases the `M` (OS thread) to find another runnable `g`.

When the primitive becomes available, the unlocker (or sender, etc.) calls `goready`:

1. Computes `cycles = cpuTicks() - g.blockedat`.
2. If the block profile is enabled, samples and records.
3. Re-enqueues the `g` on a run queue.

Two consequences:

- **Block delay is wall-clock time the goroutine was parked**, not CPU time. If the system was idle, that's fine; if it was overloaded, scheduling latency between `goready` and actual scheduling adds further skew (but isn't in the profile).
- **Sequential park-unpark of the same goroutine is fast.** The scheduler doesn't always cross threads; "hot" goroutines often stay on the same M.

You can confirm with `GODEBUG=schedtrace=1000`: if a block profile spike correlates with `runqueue` growth in the scheduler trace, you're scheduler-bound, not lock-bound.

---

## 6. `RWMutex` internals and starvation

`sync.RWMutex` is write-preferring. The state holds a count of active readers and a sentinel for a waiting writer.

| Event | Effect on counter |
|-------|-------------------|
| `RLock` (no writer waiting) | Atomic add to reader counter |
| `RLock` (writer waiting) | Park on reader semaphore |
| `Lock` | Wait for active readers to drain, then atomic set |
| `RUnlock` (last reader, writer waiting) | Wake the writer |
| `Unlock` | Wake all parked readers |

The write-preference means: **a single slow writer can starve thousands of readers**. Mutex profile in this scenario shows the writer's `Unlock` accumulating massive delay — because each woken reader contributes its wait time to the writer's stack.

If you see one tall stack in the mutex profile that corresponds to a write path, even though "most of the traffic is reads", that's RWMutex doing its job correctly. The fix is usually:

1. Copy-on-write with `atomic.Pointer[T]` — readers don't lock at all.
2. Split read/write into separate data, accept eventual consistency.
3. Batch writes.

---

## 7. Channel contention is not always a bug

A goroutine waiting on a channel is sometimes the *intended* design — it's how Go expresses back-pressure. The block profile records all of it, including healthy patterns:

| Healthy block | Looks like contention but isn't |
|---------------|----------------------------------|
| Worker reading jobs from a queue | Block on `<-ch` is the worker idle, by design |
| Rate limiter sleeping | `time.Sleep` in the block profile is the limiter working |
| Fan-in select waiting for any source | Block on `select` is the consumer awaiting work |

Distinguish design-time waits from accidental contention by **comparing block time to throughput**. If 10 workers each wait 100 ms per second and total throughput is OK, that's just slack. If they wait 100 ms per second and throughput is half what you want, it's actual back-pressure.

---

## 8. `sync.Cond` and the spurious-wakeup contract

```go
c := sync.NewCond(&mu)

c.L.Lock()
for !ready {
    c.Wait()              // unlocks, parks, on wake re-locks
}
work()
c.L.Unlock()
```

Each `Wait` shows in the block profile. The condition variable is one of the few places where you legitimately *want* repeated short waits. A profile dominated by `Cond.Wait` is generally not a problem unless the **per-wait delay is huge** — which would indicate a missed `Signal` or a tight wakeup race.

Avoid `Cond` for "one event" semantics; use a channel close instead:

```go
done := make(chan struct{})
// signal: close(done)
// wait:   <-done
```

Channels make the intent visible and benefit from the runtime's fast path for closed channels.

---

## 9. Profile interpretation pitfalls

| Pitfall | Manifestation |
|---------|---------------|
| Mutex profile reads zero | You forgot `SetMutexProfileFraction`. Default is 0 (off). |
| Block profile reads zero | You forgot `SetBlockProfileRate`. Default is 0 (off). |
| Numbers vary 2× between captures | Normal sampling variance. Use `-base` and longer windows. |
| Stack ends at `runtime.semacquire` | Default depth limit; tweak with `runtime/pprof` or capture with `?debug=1` to inspect the raw form. |
| Function appears in both profiles | Mutex contention is the obvious case; that's expected. |
| Top stack is `runtime.gopark` | You're reading `?debug=1` text dump. Use binary format. |

The "stack ends at semacquire" issue is fixable: profiles use a fixed-depth stack walk (32 frames). For very deep stacks the leaf may be cut off. In practice this rarely hides the actual offender — the relevant frame is usually within the top 10.

---

## 10. When the profile doesn't match reality

You see a contention spike in production. You enable profiling. The profile is empty.

Possible causes:

1. **Profile was enabled after the spike.** Profiles accumulate from enabling.
2. **The contention is on a primitive not covered.** Network, syscalls, GC assists, runtime locks during GC are not in either profile.
3. **The wait is too short.** With `rate=10000` (10 μs), microsecond waits are statistically invisible.
4. **The contention is *spinning*, not parking.** Go's runtime spins briefly on uncontended `Mutex.Lock` before parking. Pure spin contention shows in CPU, not in mutex/block.
5. **The system is GC-bound.** Long STW pauses look like everyone-blocked but aren't in either profile. Check `GCCPUFraction` and `gctrace`.

The execution tracer (`runtime/trace`) covers items 2–5. It's heavier but tells the full story.

---

## 11. Production sampling strategy

Three reasonable presets:

```go
// Default production
runtime.SetMutexProfileFraction(100)
runtime.SetBlockProfileRate(10000) // 10 μs

// "Investigation" — enabled on the canary for an hour
runtime.SetMutexProfileFraction(10)
runtime.SetBlockProfileRate(1000)  // 1 μs

// Benchmark / staging deep-dive
runtime.SetMutexProfileFraction(1)
runtime.SetBlockProfileRate(1)
```

Wrap the latter two in an `/admin/profile-mode` endpoint guarded by auth, so SREs can dial up sampling during an active incident without redeploying. Always return to the default afterward.

---

## 12. Stack attribution and inlining

Both profiles capture stacks with `runtime.Callers`. The compiler may have inlined small functions, in which case the leaf line you see may not match the source 1:1. Two ways to deinline:

```bash
go tool pprof -lines mutex.pb.gz       # line granularity
go build -gcflags="-l" ./...            # disable inlining (debug builds only)
```

`-l` is for the truly mysterious case; line granularity usually resolves it. If a stack frame says `sync.(*Mutex).Unlock` and the next frame up is "your" code, that next frame is what you fix.

---

## 13. Summary

The mutex profile blames the unlocker; the block profile blames the waiter. Both are Bernoulli-sampled with statistical scaling and biased toward long events. Their union covers `Mutex`, `RWMutex`, channels, `select`, `Cond`, `WaitGroup`, and `time.Sleep`; everything else (network, syscalls, GC, runtime locks) needs the execution tracer. Read profiles in deltas, account for `RWMutex` write-preference when interpreting writer attribution, and reach for atomics/copy-on-write/sharding when the primitive is intrinsically the bottleneck rather than the code holding it.

---

## Further reading
- Mutex profile internals: https://github.com/golang/go/blob/master/src/runtime/mprof.go
- Block profile internals (`gopark`/`goready` paths): https://github.com/golang/go/blob/master/src/runtime/proc.go
- `sync.RWMutex` source: https://github.com/golang/go/blob/master/src/sync/rwmutex.go
- DataDog go profiler notes: https://github.com/DataDog/go-profiler-notes
