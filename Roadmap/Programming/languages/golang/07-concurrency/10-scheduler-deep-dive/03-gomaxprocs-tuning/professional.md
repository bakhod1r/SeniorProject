# Tuning `GOMAXPROCS` — Professional Level

## Table of Contents
1. [Introduction](#introduction)
2. [`runtime.GOMAXPROCS` in the Source](#runtimegomaxprocs-in-the-source)
3. [`procresize` — The STW Path](#procresize--the-stw-path)
4. [What "Stop-the-World" Costs](#what-stop-the-world-costs)
5. [Invariants Preserved by `procresize`](#invariants-preserved-by-procresize)
6. [The `allp` Slice and Lock Order](#the-allp-slice-and-lock-order)
7. [P State Transitions During Resize](#p-state-transitions-during-resize)
8. [Cgroup Detection in `runtime/proc.go`](#cgroup-detection-in-runtimeprocgo)
9. [Comparison With Java `ForkJoinPool`](#comparison-with-java-forkjoinpool)
10. [Comparison With Tokio Worker Threads](#comparison-with-tokio-worker-threads)
11. [Practical Implications](#practical-implications)
12. [Self-Assessment](#self-assessment)
13. [Summary](#summary)

---

## Introduction

Professional-level treatment of `GOMAXPROCS` means reading the actual Go runtime code, understanding the STW pause it incurs, and knowing exactly which invariants must hold across a resize. Most engineers will never need this depth — but if you write runtime patches, debug rare scheduler hangs, or design a runtime-level autoscaler, you must know it. The file references functions in `runtime/proc.go` and assumes you can navigate the runtime source.

---

## `runtime.GOMAXPROCS` in the Source

The public entry point is in `src/runtime/debug.go`:

```go
// GOMAXPROCS sets the maximum number of CPUs that can be executing
// simultaneously and returns the previous setting. It defaults to
// the value of runtime.NumCPU. If n < 1, it does not change the current setting.
// This call will go away when the scheduler improves.
func GOMAXPROCS(n int) int {
    if GOOS == "wasip1" || GOOS == "js" {
        // ... wasm always single-threaded ...
        return 1
    }
    lock(&sched.lock)
    ret := int(gomaxprocs)
    unlock(&sched.lock)
    if n <= 0 || n == ret {
        return ret
    }

    stopTheWorldGC(stwGOMAXPROCS)

    // newprocs will be processed by startTheWorld
    newprocs = int32(n)

    startTheWorldGC()
    return ret
}
```

Key observations:

1. **It locks `sched.lock`** to read `gomaxprocs` atomically. The read itself is cheap.
2. **It returns the previous value.** Crucial for restore patterns in tests.
3. **For a no-op set (`n == ret`), it bails before the STW.** Calling `runtime.GOMAXPROCS(8)` when it is already 8 is free.
4. **`stopTheWorldGC(stwGOMAXPROCS)`** is the STW request with a reason tag. The runtime tracks STW reasons for traces.
5. **The actual resize happens in `startTheWorld`** — by the time it returns, `newprocs` has been applied and Ps have been allocated/freed.

A subtle point: the function comment ends with "*This call will go away when the scheduler improves.*" That comment has been in the file since at least Go 1.5. It is wishful — `GOMAXPROCS` remains the canonical user-facing knob.

---

## `procresize` — The STW Path

The heavy lifting is in `procresize(nprocs int32) *p` in `runtime/proc.go`. Greatly simplified:

```go
func procresize(nprocs int32) *p {
    // Caller must hold sched.lock and be at STW.
    old := gomaxprocs
    if old < 0 || nprocs <= 0 {
        throw("procresize: invalid arg")
    }

    // 1. Update timer of each P to track totals if needed.
    now := nanotime()
    if sched.procresizetime != 0 {
        sched.totaltime += int64(old) * (now - sched.procresizetime)
    }
    sched.procresizetime = now

    // 2. Grow allp if needed.
    maskWords := (nprocs + 31) / 32
    if nprocs > int32(len(allp)) {
        lock(&allpLock)
        if nprocs <= int32(cap(allp)) {
            allp = allp[:nprocs]
        } else {
            nallp := make([]*p, nprocs)
            copy(nallp, allp[:cap(allp)])
            allp = nallp
        }
        unlock(&allpLock)
    }

    // 3. Initialize new Ps.
    for i := old; i < nprocs; i++ {
        pp := allp[i]
        if pp == nil {
            pp = new(p)
        }
        pp.init(i)
        atomicstorep(unsafe.Pointer(&allp[i]), unsafe.Pointer(pp))
    }

    // 4. Free old Ps when shrinking.
    for i := nprocs; i < old; i++ {
        pp := allp[i]
        // Move all runnable goroutines to global runq.
        // Move all timers to other Ps.
        // Move all defer caches, sudog pool, GC work bufs.
        pp.destroy()
        allp[i] = nil
    }

    // 5. Trim allp slice.
    if int32(len(allp)) != nprocs {
        lock(&allpLock)
        allp = allp[:nprocs]
        unlock(&allpLock)
    }

    // 6. Update global gomaxprocs.
    var runnablePs *p
    for i := nprocs - 1; i >= 0; i-- {
        pp := allp[i]
        if _g_.m.p.ptr() == pp {
            continue
        }
        pp.status = _Pidle
        if runqempty(pp) {
            pidleput(pp, now)
        } else {
            pp.m.set(mget())
            pp.link.set(runnablePs)
            runnablePs = pp
        }
    }
    gomaxprocs = nprocs

    return runnablePs
}
```

What this function does, step by step:

1. **Captures the current `gomaxprocs`** and validates the new value.
2. **Grows the `allp` slice** if the new P count is larger than current capacity.
3. **Initialises new `p` structs** for indices `[old, nprocs)`. Each `p.init(i)` sets up the local runqueue, the per-P GC work buffer, the defer pool, and so on.
4. **Destroys removed Ps** if `nprocs < old`. Their local runqueues are drained into the global runqueue; timers are migrated; caches flushed.
5. **Trims `allp`**.
6. **Marks remaining Ps idle** and puts them on the idle-P list (or, if they have local work, queues them for wakeup).
7. **Updates `gomaxprocs`** to the new value.

The function returns a linked list of Ps with runnable work; `startTheWorld` walks the list and wakes Ms to attach to them.

---

## What "Stop-the-World" Costs

STW means every other goroutine is paused. The runtime calls `stopTheWorldGC`, which:

1. Sets a global "preempt" flag.
2. Sends async preemption signals (SIGURG) to every running M.
3. Waits for every G to reach a safe point (function preamble, channel op, syscall) and stop.
4. Once all Gs are stopped, only the STW caller can run.

`procresize` then runs without interruption. After it returns, `startTheWorld`:

1. Reverses the stop: clears the preempt flag.
2. Wakes Ms that have runnable work.
3. Resumes execution of paused Gs.

**Cost.** STW for `GOMAXPROCS` is typically **dozens of microseconds to a few hundred microseconds** on a healthy process. Three things drive cost:

- **Time to reach all goroutines.** Most goroutines hit a safe point within tens of µs. A goroutine deep in a non-cooperative loop may take longer; async preemption (since 1.14) ensures it does not block STW indefinitely.
- **`procresize` itself.** Allocating P structs is fast (~1 µs per P). Destroying Ps requires draining the local runqueue and migrating timers — bounded by P-local state size.
- **Wakeup of Ms.** After STW ends, Ms must be unparked and attached to Ps. Each M wakeup is ~10 µs.

For a `GOMAXPROCS=8 → 16` resize on a quiescent process, expect ~50 µs total pause. Under load with high goroutine count, expect 200–500 µs. Under pathological conditions (very long cgo calls preventing safe-point arrival), the pause can be longer — but async preemption makes this rare.

**Implication.** Calling `runtime.GOMAXPROCS(n)` once at startup is invisible. Calling it 100 times per second in production is a 5–50 ms continuous latency penalty.

---

## Invariants Preserved by `procresize`

The function must preserve several invariants. If it violated any, the scheduler would corrupt state.

1. **Every runnable G has a home.** When a P is destroyed, its local runqueue is drained into the global runqueue. No G is lost.
2. **Every timer fires.** Timers attached to a destroyed P are migrated to surviving Ps.
3. **GC work bufs are flushed.** Each P holds a small per-P GC work buffer (`gcw`). On destroy, it is flushed back to the global GC work pool.
4. **The `mcache` is reattached.** Each P holds an `mcache` (allocator local cache). On destroy, it is returned to `mheap`.
5. **The defer pool and sudog pool are returned.** Per-P pools are merged into global pools.
6. **`allp[0]` is never destroyed during a resize.** P0 is special; it is preserved as the "anchor" P.
7. **The calling M's P is preserved.** The M running `procresize` itself must still have a P to return to. The function explicitly excludes `_g_.m.p` from idle-listing.
8. **`gomaxprocs` is updated last.** All other state must be consistent before the global value flips, so any concurrent reader of `gomaxprocs` (post-STW) sees a coherent world.

If any of these invariants is violated, you get races, lost goroutines, or stuck Ps. The Go runtime tests cover most of them, but bugs have shipped in past versions — search the Go issue tracker for "procresize" to see the history.

---

## The `allp` Slice and Lock Order

`allp` is the slice of all Ps in the runtime. It is read frequently (every scheduler decision) and written rarely (only during `procresize`).

**Lock order:** `allpLock` is held below `sched.lock` in the lock-rank hierarchy. Code that takes both must take `sched.lock` first. Violating this triggers a runtime panic in lock-rank-instrumented builds (`GOEXPERIMENT=lockrank`).

**Reading without the lock:** `allp` is also read by scheduler hot paths like `findrunnable`. Reads use atomic operations and a snapshot of `len(allp)` at the start of the scan. A resize that grows `allp` is safe because the new slots are nil-checked. A resize that shrinks is the dangerous case — the scheduler must not race with destruction.

**The shrinking protocol:**

1. `procresize` is called from STW. No other Gs are running.
2. Old slots are nil'd out and then `allp` is trimmed.
3. STW ends. Other Gs resume; they see the trimmed `allp`.

Because all this happens under STW, the readers do not need to lock — they read a snapshot of `len(allp)` and trust it. This is why `procresize` must be STW.

If you ever wonder "why can't `GOMAXPROCS` be cheap?" — this is why. The `allp` snapshot protocol depends on STW.

---

## P State Transitions During Resize

Each P has a state machine: `_Pidle`, `_Prunning`, `_Psyscall`, `_Pgcstop`, `_Pdead`. During `procresize`:

1. Before STW: Ps are in various states (`_Prunning`, `_Pidle`, etc.).
2. STW begins: all Ps move to `_Pgcstop` as their Ms reach safe points.
3. `procresize` runs: shrinking Ps are moved through `_Pdead` and freed; growing Ps are created in `_Pidle`.
4. STW ends: Ps that have work go to `_Prunning` (attached to a fresh M); others stay `_Pidle`.

The `_Pdead` state is short-lived — a P is only `_Pdead` between "destruction started" and "memory freed". You will only see it in scheduler traces during a resize.

---

## Cgroup Detection in `runtime/proc.go`

The runtime's cgroup detection is in `getCPUCount()` (Linux-specific, file `runtime/os_linux.go` and related). Simplified:

```go
func getCPUCount() int32 {
    // Try cgroup v2 first.
    if n, ok := readCgroupV2CPU(); ok {
        return max(1, n)
    }
    // Fall back to cgroup v1.
    if n, ok := readCgroupV1CPU(); ok {
        return max(1, n)
    }
    // Fall back to sched_getaffinity.
    return int32(numCPUFromAffinity())
}
```

For cgroup v2:

```go
func readCgroupV2CPU() (int32, bool) {
    // Read /sys/fs/cgroup/cpu.max
    data, err := readFile("/sys/fs/cgroup/cpu.max")
    if err != nil { return 0, false }
    // Parse "quota period"
    var quota, period int64
    if _, err := fmt.Sscanf(data, "%d %d", &quota, &period); err != nil {
        if strings.HasPrefix(data, "max") { return 0, false }
        return 0, false
    }
    n := (quota + period - 1) / period // ceil
    return int32(n), true
}
```

(The real code is more careful: it walks `/proc/self/mountinfo` and `/proc/self/cgroup` to find the right cgroup subpath, handles edge cases for `max`, and respects environment overrides.)

The detection runs **once at program startup**, before `main()`. It does not re-read the cgroup if quotas are mutated at runtime. If your orchestrator dynamically resizes pod limits, you must restart the process or implement your own re-read.

---

## Comparison With Java `ForkJoinPool`

Java's analogue is `ForkJoinPool.commonPool()`, whose parallelism is set by `Runtime.availableProcessors()`. The corresponding internal entity is a **worker thread**; the JVM does not have a separate "processor context" abstraction like Go's P.

**Key differences:**

- **No procresize-style STW.** The pool can grow workers on demand without pausing the world. The JVM pays for this by holding a separate work-stealing deque per worker; resizing means allocating a new deque and migrating tasks, but no global pause.
- **Multiple pools coexist.** A JVM may have a `commonPool`, a separate `ScheduledExecutorService` pool, a database connection pool, etc. Go has only one scheduler.
- **Cgroup-awareness arrived in JDK 10 / JDK 8u191.** Earlier JVMs in containers over-threaded. The `-XX:ActiveProcessorCount=N` flag overrides.
- **No equivalent to `runtime.GOMAXPROCS(n)`** at runtime. The pool sizes are typically fixed at creation. Dynamic resizing happens at the application level (custom executors).

For a Java engineer reading Go code: think of `GOMAXPROCS` as "the parallelism of the entire JVM" — there is only one pool, and you cannot create alternatives.

---

## Comparison With Tokio Worker Threads

Rust's Tokio runtime is the closest analogue to Go's scheduler. The relevant knob:

```rust
let rt = tokio::runtime::Builder::new_multi_thread()
    .worker_threads(8)
    .build()
    .unwrap();
```

`worker_threads(n)` is Tokio's `GOMAXPROCS`. Defaults to `num_cpus::get()`.

**Differences:**

- **No cgroup detection by default.** `num_cpus::get()` reads `/proc/self/status` or affinity; cgroup-aware variants exist but are not the default. Container deployments must call out explicitly.
- **`TOKIO_WORKER_THREADS` env var** — equivalent to `GOMAXPROCS` env var.
- **No equivalent of `procresize`.** You cannot resize a Tokio runtime after build; create a new runtime instead.
- **Threads are real OS threads.** Tokio does not have an M/P split — workers are threads. Closer to a thread pool than to Go's M:N.

For a Rust engineer: Go's runtime is similar to Tokio's `multi_thread` runtime, with the added flexibility that the P/M split lets the runtime spawn extra threads for blocking calls. Tokio handles this differently via `spawn_blocking` (delegates to a separate pool).

The trade-off: Tokio is more explicit (you build the runtime; you know what you have) but less adaptive (no syscall handoff equivalent for arbitrary blocking).

---

## Practical Implications

Three concrete things to remember when writing low-level Go.

**1. Never call `runtime.GOMAXPROCS(n)` in a hot path.** Each call is STW. Even `n == current` bails before STW, but the lock acquisition still costs ~10 ns. Read with `runtime.GOMAXPROCS(0)` if you need it frequently.

**2. If you build an autoscaler, batch decisions.** Adjust at most once every minute or so. Frequent STWs add up.

**3. If you need to know whether the runtime is cgroup-aware, log it at startup.** Compare `runtime.NumCPU()` with the cgroup file content. If they match, you are getting container-aware sizing. If not, you may be on an old Go or an unusual sandbox.

```go
func reportSizing() {
    log.Printf("NumCPU=%d GOMAXPROCS=%d", runtime.NumCPU(), runtime.GOMAXPROCS(0))
    if data, err := os.ReadFile("/sys/fs/cgroup/cpu.max"); err == nil {
        log.Printf("cgroup.cpu.max=%s", strings.TrimSpace(string(data)))
    }
}
```

The diagnostic value of these three log lines exceeds nearly any other piece of runtime introspection.

---

## Self-Assessment

- [ ] I can read `runtime.GOMAXPROCS` in `runtime/debug.go` and explain it line by line.
- [ ] I can describe what `procresize` does and which invariants it preserves.
- [ ] I can quantify STW cost for `GOMAXPROCS` resizes under typical conditions.
- [ ] I know that `allp` reads in scheduler hot paths rely on STW for safety.
- [ ] I can read `runtime/os_linux.go` and find the cgroup detection routine.
- [ ] I can compare Go's `GOMAXPROCS` to Java's `availableProcessors` and Tokio's `worker_threads`.
- [ ] I know that Java's `ForkJoinPool` can resize without STW; Go cannot.
- [ ] I have logged the cgroup file content to verify runtime detection.

---

## Summary

`GOMAXPROCS` is, mechanically, a single line in `runtime/proc.go` that updates the `gomaxprocs` global. But that update is wrapped in a **stop-the-world** because the `allp` slice — the scheduler's index of all processors — is read lock-free in hot paths and relies on STW for its mutation protocol. Every other invariant (runqueue drain, timer migration, mcache flush) follows from that mutation needing to be atomic.

The practical lessons:

- `procresize` STW is small (tens to hundreds of microseconds) but real.
- Calling `runtime.GOMAXPROCS` frequently is a continuous latency penalty.
- Cgroup detection is one-shot at startup; runtime quota changes are not picked up.
- Go's design is comparable to Java's `availableProcessors` and Tokio's `worker_threads`, with Go and Java being the more container-aware defaults.

The detailed runtime walk is below the surface most engineers ever touch. Knowing it is the difference between "I trust the scheduler" and "I can debug it when it surprises me".
