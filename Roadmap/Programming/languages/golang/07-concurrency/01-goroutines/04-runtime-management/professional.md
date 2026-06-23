# Runtime Goroutine Management — Professional Level

## Table of Contents
1. [Introduction](#introduction)
2. [Where the APIs Live in Runtime Source](#where-the-apis-live-in-runtime-source)
3. [GOMAXPROCS Implementation](#gomaxprocs-implementation)
4. [SetMemoryLimit and the GC Pacer](#setmemorylimit-and-the-gc-pacer)
5. [SetGCPercent in the Pacer](#setgcpercent-in-the-pacer)
6. [Gosched and Goexit Internals](#gosched-and-goexit-internals)
7. [LockOSThread Internals](#lockosthread-internals)
8. [The Finalizer Goroutine](#the-finalizer-goroutine)
9. [Stack Capture Mechanics](#stack-capture-mechanics)
10. [Profile and Trace Implementation](#profile-and-trace-implementation)
11. [Cost Models](#cost-models)
12. [Version History](#version-history)
13. [Self-Assessment](#self-assessment)
14. [Summary](#summary)

---

## Introduction

This file opens the hood on the runtime APIs covered earlier. The goal: understand precisely what each call does to internal state, what it costs, and which version added or changed each behaviour. Source references are to the Go 1.22+ runtime tree.

This is not a substitute for reading the source. It is a guided tour pointing to the right files and explaining what to look for.

---

## Where the APIs Live in Runtime Source

| File | Contents |
|---|---|
| `runtime/proc.go` | Scheduler core; `GOMAXPROCS`, `Gosched`, `Goexit`, `LockOSThread`, `NumGoroutine`. |
| `runtime/debug.go` | `runtime.GC`, `Stack`, `SetFinalizer`, `SetMutexProfileFraction`, `SetBlockProfileFraction`, `SetCgoTraceback`. |
| `runtime/mgc.go` and `runtime/mgcpacer.go` | GC core and pacer; `SetGCPercent`, `SetMemoryLimit` glue. |
| `runtime/debug/garbage.go` | `runtime/debug` package — `SetGCPercent`, `SetMemoryLimit`, `FreeOSMemory`, `SetMaxStack`, `SetMaxThreads`, `SetTraceback`, `SetPanicOnFault`, `PrintStack`, `Stack`. |
| `runtime/mfinal.go` | Finalizer implementation. |
| `runtime/pprof/runtime.go` and `runtime/pprof/label.go` | Goroutine labels, `pprof.Do`. |
| `runtime/trace.go` and `runtime/trace/` | Trace implementation. |
| `runtime/metrics/` | `runtime/metrics` API. |

Open these alongside the rest of this file. Knowing where each implementation lives makes future runtime changes easy to absorb.

---

## GOMAXPROCS Implementation

### The setter

In `runtime/proc.go`:

```go
func GOMAXPROCS(n int) int {
    if n > 0 {
        if n > _MaxGomaxprocs {
            n = _MaxGomaxprocs
        }
    }
    lock(&sched.lock)
    ret := int(gomaxprocs)
    unlock(&sched.lock)
    if n <= 0 || n == ret {
        return ret
    }
    stopTheWorld("GOMAXPROCS")
    newprocs = int32(n)
    startTheWorld()
    return ret
}
```

(Simplified; modern runtime uses `stopTheWorldGC`.)

Key facts:

- **Stops the world.** Changing `GOMAXPROCS` at runtime pauses every goroutine. Do not call it on a hot path.
- **`procresize` does the real work.** It creates new Ps if `newprocs > gomaxprocs`, or releases Ps if `newprocs < gomaxprocs`.
- **Ps that are released are not destroyed.** They are kept in `allp` for reuse.
- **Ms holding old Ps are detached and may be parked.** Goroutines in the released Ps' runqueues are migrated to surviving Ps.

### `_MaxGomaxprocs`

The compile-time ceiling is `1024` on most platforms. Setting `GOMAXPROCS(99999)` clamps to 1024 — no error.

### Container detection (1.25+)

`runtime/auto_gomaxprocs.go` (added in 1.25) parses cgroup CPU quotas at init. The default `gomaxprocs` is `max(1, ceil(cpu.cfs_quota_us / cpu.cfs_period_us))`. Before 1.25 you used `automaxprocs` from Uber.

### Reading

`GOMAXPROCS(0)` and `GOMAXPROCS(-1)` are pure reads — no lock acquisition beyond the brief `sched.lock` hold. Cost: ~50 ns.

---

## SetMemoryLimit and the GC Pacer

### The setter

`runtime/debug/garbage.go`:

```go
func SetMemoryLimit(limit int64) int64 {
    return runtime_setMemoryLimit(limit)
}
```

That calls `runtime.gcSetMemoryLimit` (in `runtime/mgc.go`), which atomically swaps `gcController.memoryLimit` and recomputes the pacer's "goal."

### Pacer mechanics

The pacer computes a heap goal:

```
goal = max(
    heapMarked + max(heapMarked * GOGC/100, minHeapSize),
    memoryLimit - nonHeapMemory
)
```

`heapMarked` is the live heap at the end of the last GC. `nonHeapMemory` includes stacks, runtime metadata, and any unfreed scavenged memory.

With `GOMEMLIMIT` set, the goal is bounded by the limit. As live memory grows, `goal - heapLive` shrinks, and the pacer schedules GC to start sooner.

### GC CPU cap

The pacer also limits GC CPU usage to `gcBackgroundUtilization` (default 25% per CPU). Even under pressure, GC will not consume more than ~50% of available CPU. This is the GC death spiral safety net: instead of spending all CPU on GC, the heap is allowed to grow beyond the limit briefly.

### Memory pressure path

When `live > goal`:

1. Mark assist: every allocator call must do some marking work. This slows allocation.
2. If the limit cannot be respected, the heap grows beyond it. No OOM from Go.
3. The kernel may OOM-kill if the actual RSS exceeds the cgroup hard cap.

This is why `GOMEMLIMIT` is "soft": Go itself never kills your program.

---

## SetGCPercent in the Pacer

`runtime.gcSetGCPercent` is similar: it atomically updates `gcController.gcPercent` and recomputes the heap goal.

`GOGC=off` (or `SetGCPercent(-1)`) sets a sentinel that disables the heap-growth trigger entirely. The pacer falls back to `GOMEMLIMIT` only if set; otherwise the heap can grow unbounded.

The change takes effect at the next allocation. The current GC cycle is not interrupted.

---

## Gosched and Goexit Internals

### Gosched

In `runtime/proc.go`:

```go
func Gosched() {
    checkTimeouts()
    mcall(gosched_m)
}

func gosched_m(gp *g) {
    goschedImpl(gp)
}

func goschedImpl(gp *g) {
    casgstatus(gp, _Grunning, _Grunnable)
    dropg()
    lock(&sched.lock)
    globrunqput(gp)
    unlock(&sched.lock)
    schedule()
}
```

Sequence:

1. The goroutine moves from `_Grunning` to `_Grunnable`.
2. The current M drops its G.
3. The G is placed on the **global** runqueue (not the P's local queue).
4. `schedule()` picks the next goroutine.

Going to the global queue makes other Ps able to steal this G immediately. This is the "fairness" mechanism `Gosched` provides.

Cost: ~300 ns. Cheap but not zero.

### Goexit

```go
func Goexit() {
    gp := getg()
    // Run deferred functions, last to first.
    for {
        d := gp._defer
        if d == nil { break }
        ...
        d.fn()
        ...
    }
    goexit1()
}
```

Sequence:

1. Walks the defer chain on the current goroutine, calling each in LIFO order.
2. If a defer panics and recovers, `Goexit` resumes and continues with the next defer.
3. After all defers run, `goexit1` puts the goroutine into `_Gdead` and the scheduler is invoked.

`Goexit` from `main` is a special case: it triggers the "no goroutines left" check, which prints a deadlock message and exits if no other runnable goroutine exists.

---

## LockOSThread Internals

### The flag

Each G has a `lockedm` field pointing to the M it is pinned to (or nil). Each M has a `lockedg` field pointing to the G that pinned it (or nil).

```go
func LockOSThread() {
    if atomic.Load(&newmHandoff.haveTemplateThread) == 0 && GOOS != "plan9" {
        startTemplateThread()
    }
    _g_ := getg()
    _g_.m.lockedExt++
    if _g_.m.lockedExt == 0 {
        _g_.m.lockedExt--
        panic("LockOSThread nesting overflow")
    }
    dolockOSThread()
}

func dolockOSThread() {
    _g_ := getg()
    _g_.m.lockedg.set(_g_)
    _g_.lockedm.set(_g_.m)
}
```

`lockedExt` is the user-visible lock count. `lockedInt` is an internal counter for runtime-internal locks.

### Unlock

```go
func UnlockOSThread() {
    _g_ := getg()
    if _g_.m.lockedExt == 0 {
        return
    }
    _g_.m.lockedExt--
    dounlockOSThread()
}
```

Calling `UnlockOSThread` without a prior `LockOSThread` is a no-op (since the count is already 0). Calling more `Unlock` than `Lock` is fine — anything past 0 just becomes no-op (after Go 1.10 made it ref-counted).

### Goroutine exit while locked

In `runtime.goexit0`:

```go
if locked {
    if GOOS != "plan9" {
        gp.m.exiting = true
        // Tell the M to exit when its current work finishes.
        gogo(&_g_.m.g0.sched)
    }
}
```

The M is marked for exit. The kernel thread is then destroyed. This is intentional: any thread-local state the goroutine set up (signal mask, TLS values) goes with it.

### `LockOSThread` and templates

Since Go 1.10 the runtime starts a "template thread" that holds a fixed copy of the parent thread's signal mask. When a new locked goroutine starts, a new M is cloned with the template's signal mask. This ensures the goroutine sees the *original* signal mask, not whatever the previous M had.

---

## The Finalizer Goroutine

### Setting

`runtime.SetFinalizer` validates that:

- `obj` is a pointer or unsafe.Pointer.
- `obj` points to a heap-allocated object (panics otherwise).
- `fn` is either nil (to remove a finalizer) or a function whose first argument matches `obj`'s type.

It then attaches an entry to the object's mspan, marking the object as needing finalization.

### Scheduling

At each GC cycle, the marker identifies objects that:

- Are unreachable (no roots reach them).
- Have a finalizer attached.

These objects are *resurrected* — added to the `finq` (finalizer queue). The GC then continues marking from these objects (because the finalizer may use them). They are not freed this cycle.

After the GC cycle, the **finalizer goroutine** (singleton, started lazily on first `SetFinalizer`) processes `finq`:

```go
func runfinq() {
    for {
        lock(&finlock)
        fb := finq
        finq = nil
        if fb == nil {
            ...
            goparkunlock(&finlock, ...)
            continue
        }
        unlock(&finlock)
        for fb != nil {
            for i := 0; i < int(fb.cnt); i++ {
                ... call finalizer ...
            }
            fb = fb.next
        }
    }
}
```

One goroutine for all finalizers. Serialized. Failures (panics) crash the program.

### Why finalizers slow GC

Every finalizable object adds:

- Bookkeeping in the GC for "this is a finalization root."
- An extra mark phase to find them.
- A resurrection step that delays collection.
- A second GC cycle before the memory is actually reclaimed.

For a typical program, finalizers on a handful of `os.File` and `net.conn` objects are imperceptible. For a program that finalizes thousands of objects per second, GC time roughly doubles.

---

## Stack Capture Mechanics

### `runtime.Stack(buf, all)`

In `runtime/mprof.go`:

```go
func Stack(buf []byte, all bool) int {
    if all {
        stopTheWorld("stack trace")
    }
    n := 0
    if all {
        for _, gp := range allgs {
            n += traceback(gp, buf[n:])
            ...
        }
    } else {
        n = traceback(getg(), buf)
    }
    if all {
        startTheWorld()
    }
    return n
}
```

For `all=true`:

1. Stops the world.
2. Walks every G in `allgs` (the master list of goroutines).
3. For each G, performs `traceback` — walks its saved PC/SP via the gcdata-driven unwinder.
4. Resumes the world.

Cost grows linearly with goroutine count. 100 k goroutines × 5 µs/traceback = ~500 ms STW. Painful.

For `all=false`, no STW. Just traceback of the calling goroutine.

### `debug.Stack`

```go
func Stack() []byte {
    buf := make([]byte, 1024)
    for {
        n := runtime.Stack(buf, false)
        if n < len(buf) {
            return buf[:n]
        }
        buf = make([]byte, 2*len(buf))
    }
}
```

Calls `runtime.Stack` with `all=false`. Loops, doubling the buffer, until the trace fits.

### `pprof.Lookup("goroutine")`

For `debug = 2`, equivalent to `runtime.Stack(_, true)`. For `debug = 0`, protobuf format containing per-goroutine creation stacks aggregated by frequency — much cheaper.

---

## Profile and Trace Implementation

### CPU profile

`pprof.StartCPUProfile(w)` installs a SIGPROF handler running 100 Hz per OS thread. Each tick records the current goroutine's stack via `traceback`. Bytes are buffered in a fixed ring and flushed periodically to `w`.

Goroutine labels are read at each sample tick from the goroutine's `labels` field (a `*labelMap`).

Cost: ~0.1% CPU per active thread. Negligible.

### Heap profile

Sampled at allocation time. Each allocation has probability `1/MemProfileRate` of being recorded (default `MemProfileRate=512K`, so ~one sample per 512 KB allocated). Sampling probability ensures heap profiles cost very little even on hot allocation paths.

### Goroutine profile

Built on demand by walking `allgs` and aggregating by creation stack. Stops the world briefly for safety.

### Mutex / block profile

The `SetMutexProfileFraction(rate)` and `SetBlockProfileFraction(rate)` set the sampling rate. Every contention/block event has probability `1/rate` of being recorded. Records are stored in profile-specific tables and flushed via `pprof.Lookup("mutex"|"block")`.

### `runtime/trace`

When `trace.Start` is called:

1. The runtime sets `trace.enabled = true` and clocks every event.
2. Events are written to a per-P buffer.
3. A goroutine drains the buffers to the user-supplied writer.

Events include G state transitions, syscall entry/exit, GC start/end, network poll. Format is binary; `go tool trace` parses it.

Cost: 5–20% CPU, depending on event rate. Bandwidth can be ~MB/s for busy servers.

---

## Cost Models

| API | Approximate cost |
|---|---|
| `runtime.NumGoroutine()` | ~10 ns (one atomic load). |
| `runtime.NumCPU()` | ~5 ns (immutable, computed at init). |
| `runtime.GOMAXPROCS(0)` | ~50 ns (brief lock). |
| `runtime.GOMAXPROCS(n)`, n != current | ~ms (stops the world). |
| `runtime.Gosched()` | ~300 ns. |
| `runtime.Goexit()` | O(defers) — typically µs. |
| `runtime.LockOSThread()` / `Unlock` | ~50 ns each. |
| `runtime.Stack(buf, false)` | O(stack depth) — typically µs. |
| `runtime.Stack(buf, true)` | O(num goroutines × stack depth) + STW. |
| `runtime.GC()` | One full GC cycle — usually ms, sometimes 10s of ms. |
| `runtime.SetFinalizer` | ~100 ns per call. Indirect GC cost. |
| `debug.SetGCPercent(p)` | ~50 ns, takes effect at next allocation. |
| `debug.SetMemoryLimit(n)` | ~50 ns, takes effect at next pacer recompute. |
| `pprof.SetGoroutineLabels(ctx)` | ~50 ns. |
| `pprof.Do(...)` | ~200 ns plus the function body. |
| `metrics.Read(samples)` | ~µs per sample on average; some samples are cheap, histograms cost more. |
| `trace.Start(w)` | Constant setup; runtime overhead applies until `trace.Stop`. |

---

## Version History

| Version | Change |
|---|---|
| 1.5 | `GOMAXPROCS` default = `NumCPU()` (previously 1). |
| 1.10 | `LockOSThread` made re-entrant (count, not boolean). Template thread for signal mask preservation. |
| 1.14 | Asynchronous preemption: `Gosched` largely obsolete in hot loops. Signal-based preemption ~10 ms quantum. |
| 1.16 | `runtime/metrics` introduced. Goroutine labels added to allocator sampling. |
| 1.17 | Register-based calling convention; stack traces formatted differently. |
| 1.19 | `debug.SetMemoryLimit` / `GOMEMLIMIT` introduced. Soft memory cap. |
| 1.20 | Goroutine profile delta semantics changed slightly. |
| 1.21 | Backwards-compatibility metrics added; tighter GC pacing. |
| 1.22 | `for i := range n` and per-iteration `i` for `for i := ...` — affects goroutine label patterns in loops. |
| 1.25 | `GOMAXPROCS` defaults respect cgroup CPU quotas on Linux. |

---

## Self-Assessment

- [ ] I can locate each runtime API's implementation in the source tree.
- [ ] I can explain why `GOMAXPROCS(n)` stops the world and when that matters.
- [ ] I understand how `SetMemoryLimit` feeds the GC pacer's goal calculation.
- [ ] I know what happens to an M when its locked goroutine exits.
- [ ] I can describe the finalizer goroutine's lifecycle and its impact on GC.
- [ ] I know the cost order of each runtime API and can budget calls accordingly.
- [ ] I can reason about CPU profile sampling rates and bias.
- [ ] I know which version added or changed each API I rely on.

---

## Summary

The runtime APIs are thin wrappers over rich internal state machines. `GOMAXPROCS` rebuilds the P array; `SetMemoryLimit` reshapes the GC pacer's goal; `LockOSThread` plays with reference-counted M binding; the finalizer goroutine is a single serialised consumer of a queue produced by the GC. Knowing where each call lands in the runtime source — and what it costs in cycles, locks, and STW pauses — is the difference between using the API correctly and using it like magic.

For ongoing exploration, the Go release notes, the `runtime` package godoc, and the source tree itself are the canonical references. The runtime evolves; verify behaviours against your target Go version.
