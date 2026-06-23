---
layout: default
title: Runtime Internals — Professional
parent: Runtime Internals Used by Stdlib
grand_parent: Concurrency in Stdlib
ancestor: Go
nav_order: 5
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/23-concurrency-in-stdlib/04-runtime-internals/professional/
---

# Runtime Internals Used by Stdlib — Professional Level

[← Back](../)

## Table of Contents
1. [Introduction](#introduction)
2. [Production Debugging Workflow](#production-debugging-workflow)
3. [The Block Profile in Anger](#the-block-profile-in-anger)
4. [The Mutex Profile in Anger](#the-mutex-profile-in-anger)
5. [Reading `/debug/pprof/goroutine`](#reading-debugpprofgoroutine)
6. [`runtime.Stack` for Crash Dumps](#runtimestack-for-crash-dumps)
7. [Reading the Goroutine Dump Format](#reading-the-goroutine-dump-format)
8. [Triggering Dumps on Signals](#triggering-dumps-on-signals)
9. [sysmon and Async Preemption Diagnostics](#sysmon-and-async-preemption-diagnostics)
10. [`runtime/trace` for I/O-Bound Services](#runtimetrace-for-io-bound-services)
11. [Hardening Finalizer Code Paths](#hardening-finalizer-code-paths)
12. [Cgo Thread Affinity in Production](#cgo-thread-affinity-in-production)
13. [GODEBUG Flags You Need to Know](#godebug-flags-you-need-to-know)
14. [Sample Incident Walkthroughs](#sample-incident-walkthroughs)
15. [Performance Budget for Profiling](#performance-budget-for-profiling)
16. [Checklist for Production Readiness](#checklist-for-production-readiness)
17. [Further Reading](#further-reading)

---

## Introduction
> Focus: how to use runtime primitives to diagnose, harden, and debug a production Go service.

This file is for the engineer who is paged at 03:00 because a service is hung, has runaway memory, or has tail latency spikes that look like nothing in the CPU profile. The runtime exposes enough machinery — block profiles, mutex profiles, goroutine dumps, trace events, GODEBUG flags — that almost any concurrency-related production issue can be diagnosed *without* attaching a debugger to a live process. But you have to know which primitive to reach for, what overhead it costs, and how to read its output.

By the end of this file you should be able to:

- Choose between block profile, mutex profile, CPU profile, and trace for a given symptom.
- Read a goroutine dump and triage by state (`runnable`, `chan receive`, `sync.Mutex`, `IO wait`, `syscall`).
- Write a signal-driven dump handler suitable for production.
- Reason about the cost of `SetBlockProfileRate(1)` vs `SetBlockProfileRate(1000)`.
- Diagnose async-preemption-related stalls.
- Use `GODEBUG=gctrace=1,schedtrace=1000,scheddetail=1,asyncpreemptoff=1` to narrow scope.

---

## Production Debugging Workflow

Concrete decision tree for "my service is slow / hung / leaking":

1. **Get a goroutine snapshot first** — cheapest signal, often diagnostic.
   ```
   curl -s http://localhost:6060/debug/pprof/goroutine?debug=2 > goroutines.txt
   ```
2. **Count goroutines by state.** If thousands are in `chan receive`, your producer died. If thousands are in `IO wait`, your downstream is slow. If thousands are in `sync.Mutex.Lock`, you have lock contention.
3. **If contention is suspected,** enable mutex profile briefly.
4. **If blocking duration is the symptom,** enable block profile briefly.
5. **If CPU is the symptom,** CPU profile.
6. **If "nothing is the symptom" but tail latency is bad,** runtime/trace.

Always observe before changing. Each profile has overhead; turn off when done.

---

## The Block Profile in Anger

### What it measures

> Time goroutines spend blocked on synchronization (channels, mutexes, `sync.Cond.Wait`, `select`, network I/O via `internal/poll`).

Sample rate is set with `runtime.SetBlockProfileRate(rate int)`:
- `rate = 0` — off (default).
- `rate = 1` — every event.
- `rate = n` — sample if blocking duration was >= n nanoseconds, with proportional weighting.

### Capture

```go
import _ "net/http/pprof"
import "net/http"

func main() {
    runtime.SetBlockProfileRate(1)
    go http.ListenAndServe(":6060", nil)
    // ...
    runtime.SetBlockProfileRate(0) // turn off when done
}
```

```
go tool pprof http://localhost:6060/debug/pprof/block
(pprof) top 20
(pprof) list mySuspectFunction
(pprof) web
```

### Interpreting

The profile shows *blocking duration* (not call count). A function with one call blocked for 5 s ranks above 1000 calls each blocked for 1 ms.

**Common patterns.**
- `runtime.semacquire` in `sync.(*WaitGroup).Wait`: producer goroutine forgot `Done` or is wedged.
- `runtime.chanrecv` from a fan-in collector: senders crashed before sending.
- `runtime.gopark` from `internal/poll.(*pollDesc).wait`: blocked on network I/O — symptom of slow downstream.

### Overhead

For `rate = 1`, each blocking call adds a stack-trace capture (~1 us). Under heavy contention, expect 5-15% throughput loss. Use `rate = 1000` (one event per microsecond of block time) in production-on-demand.

---

## The Mutex Profile in Anger

### What it measures

Contention on `sync.Mutex` and `sync.RWMutex` only. Each `Unlock` of a contended mutex records the *waiting time* of the previous holder along with the unlocker's stack.

Sample rate via `runtime.SetMutexProfileFraction(rate int)`:
- `rate = 0` — off (default).
- `rate = 1` — every contended unlock.
- `rate = n` — 1 in n events.

### Capture and read

```
go tool pprof http://localhost:6060/debug/pprof/mutex
(pprof) top
(pprof) list hotMutexUnlocker
```

### Interpreting

A line attributed to function F means: "another goroutine waited for the mutex that F holds". So F is the contention source. The fix is to:
- shrink the critical section,
- shard the mutex,
- replace with lock-free / atomics where possible,
- replace `Mutex` with `RWMutex` if reads dominate.

### Caveats

- The mutex profile does *not* see `runtime.lock` (runtime-internal locks).
- It does *not* see channel contention. Use the block profile for that.
- A high mutex profile total is not always a problem — what matters is whether *waiters* are accumulating. Cross-check with goroutine dump.

---

## Reading `/debug/pprof/goroutine`

```
curl -s http://localhost:6060/debug/pprof/goroutine?debug=2 > g.txt
```

`debug=2` gives full stack dumps in text form. Sample:

```
goroutine 42 [chan receive, 5 minutes]:
github.com/foo/bar.(*Pipeline).consume(0xc0001a8000)
    /src/pipeline.go:81 +0xa0
created by github.com/foo/bar.(*Pipeline).Start
    /src/pipeline.go:65 +0x12c
```

**Fields.**
- `42` — goroutine id (not stable across Go versions — diagnostic only).
- `chan receive` — current state (see below for the list).
- `5 minutes` — duration in current state. Long durations are red flags.

### Goroutine states you will see

| State string | Meaning | Common cause if many |
|--------------|---------|----------------------|
| `running` | currently on a P | normal |
| `runnable` | on a run queue, waiting for CPU | starved Ps (insufficient GOMAXPROCS or busy goroutines) |
| `syscall` | in a blocking syscall | downstream syscall slow / many syscalls |
| `IO wait` | parked on netpoller | network I/O slow / no traffic |
| `chan send` | blocked sending to chan | consumer slow or dead |
| `chan receive` | blocked receiving from chan | producer slow or dead |
| `select` | blocked in select with no default | one of several channels is slow |
| `sync.Mutex.Lock` | waiting for mutex | mutex contention |
| `sync.WaitGroup.Wait` | waiting for WG counter to hit 0 | a goroutine forgot `Done` |
| `sync.Cond.Wait` | waiting on Cond | broadcaster wedged |
| `semacquire` | low-level sema wait | similar to Mutex |
| `finalizer wait` | finalizer goroutine idle | normal (you have one of these) |
| `force gc (idle)` | force-gc goroutine idle | normal |
| `GC worker (idle)` | GC worker idle | normal |
| `timer goroutine (idle)` | (older Go) timer goroutine idle | pre-1.14 |

### Triage by counting

```
grep '^goroutine' g.txt | wc -l       # total
grep 'chan receive' g.txt | wc -l     # by state
grep 'sync.Mutex.Lock' g.txt | wc -l
```

If `chan receive` is 10000 and your service has 100 connections, you have a leak.

---

## `runtime.Stack` for Crash Dumps

Inside a panic handler:

```go
func dumpAllGoroutines(w io.Writer) {
    buf := make([]byte, 1<<20)
    for {
        n := runtime.Stack(buf, true)
        if n < len(buf) {
            w.Write(buf[:n])
            return
        }
        buf = make([]byte, 2*len(buf))
    }
}
```

The growth loop handles dumps larger than 1 MiB. Always cap (e.g., 64 MiB) so a runaway dump doesn't OOM the process.

**Cost.** `runtime.Stack(buf, true)` stops the world. On a service with 50k goroutines this can pause 100-500 ms. Acceptable for a crash dump; unacceptable for periodic logging.

---

## Reading the Goroutine Dump Format

Format documented at `src/runtime/traceback.go` `goroutineheader`:

```
goroutine <id> [<status>, <waitsincemin> minutes]:
<func1>(<args>)
    <file>:<line> +<pcoffset>
<func2>(<args>)
    <file>:<line> +<pcoffset>
created by <func>
    <file>:<line> +<pcoffset>
```

**Arg parsing.** `<args>` are the actual register values at the time the function was entered. Go's calling convention from 1.17 stores args in registers, so the displayed values may be opaque; older binaries show stack-passed args inline.

**`created by`** — the parent goroutine's stack frame. Tells you which goroutine spawned this one. If thousands of goroutines all have `created by mypkg.startWorker`, you spawn workers in a loop without bound.

---

## Triggering Dumps on Signals

```go
import (
    "os"
    "os/signal"
    "runtime"
    "syscall"
)

func installDumpSignal() {
    c := make(chan os.Signal, 1)
    signal.Notify(c, syscall.SIGUSR1)
    go func() {
        for range c {
            buf := make([]byte, 1<<20)
            for {
                n := runtime.Stack(buf, true)
                if n < len(buf) {
                    os.Stderr.Write(buf[:n])
                    break
                }
                buf = make([]byte, 2*len(buf))
            }
        }
    }()
}
```

Then `kill -USR1 <pid>` from operations to capture state without restarting.

**Note:** Go's runtime already dumps on `SIGQUIT` (default `Ctrl-\`). For production use a less commonly-used signal like `SIGUSR1` or `SIGUSR2` that you control.

---

## sysmon and Async Preemption Diagnostics

`sysmon` (`src/runtime/proc.go:sysmon`) is a special goroutine that runs without a P, every 10-20 µs to 10 ms (back-off based on idleness). It:

1. Polls the netpoller (timed netpoll with 0 ns timeout for non-blocking check).
2. Forces preemption via `preemptone` on goroutines that have run > 10 ms.
3. Triggers GC when needed.
4. Runs forced timers.

### Symptom: tight loop with no preemption

Pre-1.14 Go required function-call safepoints for preemption. A tight loop with no calls would never be preempted. Since Go 1.14, sysmon sends a `SIGURG` signal to the target M, the signal handler turns the next instruction into a fake function call, and the goroutine is preempted on entry.

**Diagnostic.** Set `GODEBUG=asyncpreemptoff=1` and watch the program hang at the same spot — confirmation that async preemption was your safety net.

**Symptoms in `goroutine` dump.** Goroutines stuck in `running` state for many minutes, despite the service being interactive. They will all be in the same tight loop.

---

## `runtime/trace` for I/O-Bound Services

CPU profile is useless when the service spends its time blocked on I/O — every sample lands in `runtime.netpoll`. The execution trace shows you *what happened in between*.

```go
import "runtime/trace"
import "os"

func main() {
    f, _ := os.Create("trace.out")
    defer f.Close()
    trace.Start(f)
    defer trace.Stop()
    // your service
}
```

Then `go tool trace trace.out`. Open in browser; you see:
- **Goroutine analysis** — per-goroutine lifelines.
- **Network blocking profile** — which call sites parked goroutines on `pollWait`.
- **Synchronization blocking profile** — which channels and mutexes were the slowest.
- **Scheduler latency profile** — time from `goready` to actual execution.
- **User-defined regions** — if you wrap code in `trace.WithRegion`.

**Cost.** Tracing writes ~1-10 MB/s of binary data. Run for 5-30 s at most. Do not leave on in production.

---

## Hardening Finalizer Code Paths

Production rules for finalizers:

1. **Never block in a finalizer.** All finalizers share one goroutine; a slow one stalls all others.
2. **Never panic in a finalizer.** Panicking from the finalizer goroutine crashes the program.
3. **Never re-`SetFinalizer` from inside a finalizer** unless you understand reachability.
4. **Always provide an explicit `Close`** and clear the finalizer in `Close`:
   ```go
   func (r *Resource) Close() error {
       if !r.closed.CompareAndSwap(false, true) {
           return nil
       }
       runtime.SetFinalizer(r, nil)
       return r.cleanup()
   }
   ```
5. **Treat finalizers as leak detectors, not cleanup.** Log a warning, do not perform real cleanup, because timing is non-deterministic and cleanup may run after the resource is needed elsewhere.

Sample warning-only finalizer:
```go
runtime.SetFinalizer(r, func(p *Resource) {
    if !p.closed.Load() {
        log.Warn().Int("id", p.id).Msg("Resource leaked: Close was never called")
    }
})
```

---

## Cgo Thread Affinity in Production

Rules:

1. **Pin only when C requires it.** Examples: OpenGL contexts (per-thread state), GUI main thread on macOS, OpenSSL error queue (per-thread on some versions), GTK main loop.
2. **Pair with `defer runtime.UnlockOSThread`** in 99% of cases.
3. **For dedicated worker goroutines that own thread-state for life**, omit `UnlockOSThread`; the runtime will terminate the M when the G exits.
4. **Avoid `LockOSThread` in worker pools** unless absolutely needed — it reduces parallelism.
5. **Monitor M count.** Excessive locked Ms can exhaust `GOMAXPROCS * threads` budget and cause "runtime: program exceeds 10000-thread limit".

Production pattern: a single dedicated cgo-bound goroutine, fed by a channel:

```go
var cgoWork = make(chan func())

func init() {
    go func() {
        runtime.LockOSThread()
        for f := range cgoWork {
            f()
        }
    }()
}

func callCFromAny(f func()) {
    done := make(chan struct{})
    cgoWork <- func() { defer close(done); f() }
    <-done
}
```

This serialises all cgo work on one OS thread; the rest of the program is unaffected.

---

## GODEBUG Flags You Need to Know

Set via environment, no recompile:

| Flag | Effect |
|------|--------|
| `gctrace=1` | Log every GC cycle to stderr |
| `schedtrace=1000` | Log scheduler state every 1000 ms |
| `scheddetail=1` | (with schedtrace) include per-G/P/M details |
| `asyncpreemptoff=1` | Disable signal-based preemption (debug only) |
| `madvdontneed=1` | Use MADV_DONTNEED on Linux (older default) |
| `cgocheck=0` | Disable cgo pointer checking (faster, less safe) |
| `cgocheck=2` | Full cgo pointer checking (debug only) |
| `tracebackancestors=N` | Show N ancestor stack traces on panic |
| `gocachehash=1` | Trace the build cache (compile-time only) |
| `allocfreetrace=1` | Trace every allocation/free (very slow; tiny programs only) |
| `tracebrokenpipe=1` | Don't suppress broken-pipe SIGPIPE backtraces |
| `panicnil=1` | Allow `panic(nil)` (legacy compat) |

**Production tip.** Set `GODEBUG=gctrace=0` explicitly to override any cluster-level default that might add overhead.

---

## Sample Incident Walkthroughs

### Incident A — service hung at 100% CPU

1. `top` shows the Go process pinned at one core × `GOMAXPROCS`.
2. `kill -USR1 <pid>` (custom signal handler installed) → all goroutines.
3. Triage: many goroutines in `running` state, all in the same call site.
4. Disassemble: tight loop without function call.
5. Fix: introduce `runtime.Gosched()` or refactor to break out.

### Incident B — service has 100k goroutines and growing

1. `curl /debug/pprof/goroutine?debug=2 > g.txt`.
2. `awk '/^goroutine/{print $3}' g.txt | sort | uniq -c | sort -rn`.
3. 99000 are in `chan receive`. Trace the channel: producer goroutine died.
4. Fix: producer must close the channel; consumers must respect `_, ok := <-ch`.

### Incident C — tail latency p99 = 200 ms, p50 = 5 ms

1. CPU profile: nothing obvious.
2. Block profile (rate=1000): top entry is `runtime.semacquire` in a custom mutex slow path.
3. Mutex profile: contention on `cache.mu`.
4. Fix: shard the cache, replace global mutex with per-shard mutex.

### Incident D — OOM after 6 hours

1. Heap profile (`/debug/pprof/heap`): shows 8 GB of `[]byte`.
2. Goroutine dump: 100k goroutines in `IO wait`, each holding a buffer.
3. Root cause: handler does not return after timeout, holds buffer reference.
4. Fix: enforce request timeouts via `http.Server.ReadTimeout` and `context.WithTimeout`.

---

## Performance Budget for Profiling

| Profile | Overhead | When to enable |
|---------|----------|----------------|
| Goroutine dump (one-shot) | STW briefly | Always on demand |
| Heap profile | ~1% steady | Always-on with default `MemProfileRate=512K` |
| CPU profile (rate=100) | <1% | On demand, 30 s |
| CPU profile (rate=1000) | 2-5% | Diagnosis only |
| Block profile (rate=1) | 5-15% | Diagnosis only |
| Block profile (rate=1000) | <1% | Steady acceptable |
| Mutex profile (frac=1) | 5-15% | Diagnosis only |
| Mutex profile (frac=100) | <1% | Steady acceptable |
| Execution trace | ~10% + huge data | Short bursts only |

Rule: never leave block/mutex profiles at full rate in production. Use a debug endpoint that enables them for a bounded window and turns them off automatically.

---

## Checklist for Production Readiness

- [ ] `import _ "net/http/pprof"` enabled on an internal-only port.
- [ ] Signal handler for `SIGUSR1` dumps goroutines to stderr.
- [ ] Panic recovery logs all goroutines before re-panicking.
- [ ] Finalizers are warning-only; explicit `Close` is the cleanup path.
- [ ] `LockOSThread` used only in dedicated cgo workers, always with `UnlockOSThread`.
- [ ] `runtime.Stack(buf, true)` never appears in a hot path or healthcheck.
- [ ] Block / mutex profiles enabled on demand only, with auto-disable timer.
- [ ] `GOMEMLIMIT` set; `GOGC` left default unless reason to tune.
- [ ] `GODEBUG=gctrace=0` in production env to override any inherited setting.
- [ ] Dashboards include `/runtime/metrics`: goroutines, GC pauses, mutex wait time.

---

## Further Reading

- *The Go Scheduler* — Dmitry Vyukov, design doc, https://golang.org/s/go11sched
- *Go 1.14 asynchronous preemption* — Austin Clements, design doc, https://golang.org/issue/24543
- *Profiling Go programs* — https://go.dev/blog/pprof
- *Diagnostics* — https://go.dev/doc/diagnostics
- *Production-grade Go* — Jaana Dogan, talks and articles
- *Debugging performance issues in Go programs* — Intel Go optimization guide
- `runtime/metrics` API — https://pkg.go.dev/runtime/metrics
- Go runtime source tree — `$GOROOT/src/runtime/`
