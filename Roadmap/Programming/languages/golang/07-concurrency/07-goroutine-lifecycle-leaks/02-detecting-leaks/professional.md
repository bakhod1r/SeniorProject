# Detecting Goroutine Leaks — Professional Level

## Table of Contents
1. [Introduction](#introduction)
2. [How `runtime.NumGoroutine` Works](#how-runtimenumgoroutine-works)
3. [The `allgs` Table and Stop-The-World](#the-allgs-table-and-stop-the-world)
4. [`runtime.Stack` Internals](#runtimestack-internals)
5. [The Goroutine Profile Format](#the-goroutine-profile-format)
6. [`pprof.Lookup("goroutine")` Implementation](#pprof-lookup-implementation)
7. [Goroutine States and Wait Reasons](#goroutine-states-and-wait-reasons)
8. [Goroutine Labels — How They Are Stored](#goroutine-labels--how-they-are-stored)
9. [`schedtrace` and `gctrace` for Detection](#schedtrace-and-gctrace-for-detection)
10. [`runtime/trace` Internals](#runtimetrace-internals)
11. [Cost of Profile Capture at Scale](#cost-of-profile-capture-at-scale)
12. [Building a Custom Detector](#building-a-custom-detector)
13. [Self-Assessment](#self-assessment)
14. [Summary](#summary)

---

## Introduction

This file digs into the runtime mechanics that everything else in this section stands on. Most engineers can detect leaks without knowing any of this. You need it when:

- You are writing a profiling library and want to understand the contract.
- You see a `pprof` output that does not match your mental model and need to know whether it is a runtime bug or yours.
- You need to reason about the cost of profile capture on a million-goroutine server.
- You are interviewing for a runtime/observability role.

References point at the Go source tree at the time of writing (Go 1.22). Line numbers drift; function names are more stable. Look for the function name in your installed `$GOROOT/src/runtime`.

---

## How `runtime.NumGoroutine` Works

`runtime.NumGoroutine` (in `runtime/proc.go`) returns:

```go
func NumGoroutine() int {
    return int(gcount())
}
```

`gcount()` walks an internal counter that is incremented every time a goroutine is created (`newproc`) and decremented every time one exits (`goexit0`). Specifically:

- `allglen` — the total number of goroutines ever observed by the runtime (a high-water mark).
- `sched.ngsys` — the number of system goroutines.
- A running tally of "dead" goroutines kept on a free list for reuse.

`gcount` returns `allglen - dead - system`. It does not lock; it relies on atomic loads. This is why two consecutive calls can differ by a small amount that is not explained by user-visible spawning — the GC may have moved a goroutine between dead and alive states, or sysmon may have ticked.

For detection that requires an *exact* count, take a sample, GC, and re-sample. Even then expect ±2.

---

## The `allgs` Table and Stop-The-World

When `runtime.Stack(buf, true)` or `pprof.Lookup("goroutine").WriteTo` walks all goroutines, it must read a coherent snapshot. The runtime does this by calling `stopTheWorld("profile")`. Briefly:

1. The current goroutine grabs `sched.lock`.
2. Every other P is signalled to stop at the next safepoint.
3. Once all Ps are stopped, the calling goroutine walks `allgs` (the global slice of every goroutine).
4. For each goroutine, it reads `gp.atomicstatus`, `gp.sched.pc`, and the parked frame.
5. STW is released; the world resumes.

Total STW time for "profile" is typically microseconds, but grows linearly with goroutine count. On a server with 100,000 goroutines it can be a few milliseconds. On a server with 5,000,000 (yes, that exists), it is hundreds of milliseconds — a noticeable latency blip.

This is why the senior file recommended *not* hitting `/debug/pprof/goroutine?debug=2` on every request. Even a single capture is expensive at scale.

Newer Go versions (1.19+) optimised this with **per-goroutine stack collection** that does not require a full STW for `debug=2` — instead, each goroutine is individually preempted to a safepoint, walked, and resumed. The STW window is shortened to almost nothing, at the cost of slightly higher steady-state instrumentation. See `runtime/mprof.go::goroutineProfileWithLabels`.

---

## `runtime.Stack` Internals

`runtime.Stack(buf, all)` calls (paraphrased):

```go
func Stack(buf []byte, all bool) int {
    if all {
        stw := stopTheWorld(stwAllGoroutinesStack)
        n := writeAllStacks(buf)
        startTheWorld(stw)
        return n
    }
    return writeMyStack(buf)
}
```

`writeMyStack` walks the current goroutine's `gp.sched.bp` (frame base pointer) chain, decoding each frame via the symbol table embedded in the binary (the `pclntab`). Decoding is what produces the human-readable file:line strings; without symbol info the stack is just addresses.

If your binary is stripped (`-ldflags '-s -w'`), `runtime.Stack` still works — the symbol table is separate from debug info — but the function-name decoding is best-effort. Profiles taken on stripped binaries are harder to read.

A subtle quirk: argument values printed in the stack trace ("`main.handler(0xc0000a0080, 0x42)`") are *the values at the time the goroutine was parked*. For inlined functions or escape-analysed locals, those values may be in the register file rather than memory; the runtime falls back to printing `?` when it cannot recover them.

---

## The Goroutine Profile Format

The protobuf format (`?debug=0`) is the `pprof` profile.proto. Each sample has:

- `value` — a single int64, the count of goroutines sharing this stack.
- `location` — a list of `Location` IDs, each mapping to a function + line.
- `label` — key-value pairs (the `pprof.SetGoroutineLabels` data).

`go tool pprof` and `github.com/google/pprof/profile` consume this. The format is the same as for CPU, heap, and block profiles; only the `sample_type` differs. For goroutine profiles, `sample_type` is `[{Type: "goroutine", Unit: "count"}]`.

`?debug=1` is a text rendering: each unique stack is printed once with a count, then frame addresses, then resolved file:line.

`?debug=2` is the most verbose form: every goroutine printed individually, with state, wait reason, duration, and full stack including arguments. This is what `runtime.Stack(buf, true)` produces.

There is no standard format between these — they are three different rendering paths through the same internal data. A tool that reads `debug=2` must parse text; a tool that reads `debug=0` parses protobuf.

---

## `pprof.Lookup("goroutine")` Implementation

In `runtime/pprof/pprof.go`:

```go
func Lookup(name string) *Profile {
    if name == "goroutine" {
        return goroutineProfile
    }
    // ...
}
```

`goroutineProfile.WriteTo(w, debug)` dispatches on `debug`:

- `debug == 0` — call `writeGoroutine(w)` which invokes `runtime.goroutineProfileWithLabels` and serialises into protobuf.
- `debug == 1` — call `printCountProfile`; aggregates by stack, prints text counts.
- `debug == 2` — call `writeGoroutineStacks` which calls `runtime.Stack(_, true)` and writes the bytes directly.

The label-aware path is significant: only `debug == 0` (protobuf) includes labels. `debug=2` does not. If you want labels in human-readable form, post-process the protobuf yourself.

---

## Goroutine States and Wait Reasons

The runtime distinguishes between *status* (what kind of state) and *wait reason* (why it is parked). Both appear in `debug=2`.

Status values (`_Grunnable`, `_Grunning`, `_Gwaiting`, etc.) are internal. The string the user sees in `[chan send]` etc. is the wait reason, an enum in `runtime/runtime2.go`:

```go
const (
    waitReasonChanReceive          // "chan receive"
    waitReasonChanSend             // "chan send"
    waitReasonSelect               // "select"
    waitReasonSelectNoCases        // "select (no cases)"
    waitReasonSyncMutexLock        // "sync.Mutex.Lock"
    waitReasonSyncRWMutexRLock     // "sync.RWMutex.RLock"
    waitReasonSyncWaitGroupWait    // "sync.WaitGroup.Wait"
    waitReasonIOWait               // "IO wait"
    waitReasonSemacquire           // "semacquire"
    waitReasonGCMarkTermination    // "GC mark termination"
    waitReasonForceGCIdle          // "force gc (idle)"
    // ... many more
)
```

When triaging, the wait reason is the first clue. `chan send` and `chan receive` are the classic leak shapes. `select` with `(no cases)` is `select {}` — typically intentional, sometimes a bug. `sync.Mutex.Lock` is rare for leaks but common for deadlocks.

`runtime.Goexit` exits the goroutine; the runtime never shows a `gexit` state because by the time you see the profile, the goroutine has been removed from `allgs`.

---

## Goroutine Labels — How They Are Stored

`pprof.SetGoroutineLabels(ctx)` walks the context, extracts the `labelMap` (added by `pprof.Do`/`pprof.Labels`), and stores a pointer to it in `gp.labels`. The pointer is heap-allocated; the label map is immutable once set.

When `goroutineProfileWithLabels` collects samples, it reads `gp.labels` and embeds the labels into the protobuf sample. This is why `debug=0` carries labels but `debug=2` (which renders only `gp.atomicstatus` and the stack) does not.

A new goroutine spawned with `go f()` *does not inherit* its parent's labels. Only `pprof.Do(ctx, labels, f)` propagates labels into spawned goroutines — and only those spawned via `pprof.Do(ctx, ..., func(ctx) { go inner() })` if you re-call `pprof.Do` inside `inner`. The mechanism is cooperative; the runtime does not magically propagate.

Cost: a label map is a few bytes per goroutine. Setting labels on millions of goroutines is fine; the cost is in the protobuf serialisation, which scales with sample count × label count.

---

## `schedtrace` and `gctrace` for Detection

The `GODEBUG` environment variable exposes two tracers:

```
GODEBUG=schedtrace=1000 ./my-server
```

Every 1000 ms, the runtime prints:

```
SCHED 12345ms: gomaxprocs=8 idleprocs=0 threads=20 spinningthreads=2 needspinning=0 idlethreads=4 runqueue=128 [22 14 18 9 27 33 11 6]
```

- `gomaxprocs` — the configured P count.
- `idleprocs` — Ps with no work.
- `threads` — total OS threads.
- `runqueue` — total runnable goroutines in the global queue.
- The bracketed list — per-P local run queue lengths.

For leak detection, the interesting columns are:

- A sustained large `runqueue` means goroutines are runnable but not running — possible scheduler contention.
- A monotonically increasing `threads` means many goroutines are blocked in syscalls.
- A `gomaxprocs=8, idleprocs=8` while requests are coming in means goroutines are parked.

`gctrace=1` is more general but also useful:

```
gc 14 @5.247s 1%: 0.012+1.4+0.020 ms clock, 0.099+0.51/2.6/3.1+0.16 ms cpu, 4->5->2 MB, 5 MB goal
```

A long mark phase combined with high goroutine count suggests the GC is iterating over many live goroutine stacks — confirmation that goroutines are accumulating.

---

## `runtime/trace` Internals

The trace records every scheduling event:

- `EvGoCreate` — `go f()` was executed.
- `EvGoStart` — goroutine started running.
- `EvGoBlock*` — goroutine blocked, with a specific reason (`Recv`, `Send`, `Mutex`, etc.).
- `EvGoUnblock` — goroutine unblocked.
- `EvGoEnd` — goroutine returned.
- `EvGoExit` — goroutine called `runtime.Goexit`.

The viewer reconstructs lifetimes by matching `EvGoCreate` to `EvGoEnd`/`EvGoExit`. A goroutine with `EvGoCreate` and `EvGoBlock` but no `EvGoUnblock` and no `EvGoEnd` within the trace window is, by definition, leaked for at least the trace window.

Programmatic access:

```go
import "golang.org/x/exp/trace"

f, _ := os.Open("trace.out")
r, _ := trace.NewReader(f)
for {
    ev, err := r.ReadEvent()
    if err != nil { break }
    switch ev.Kind() {
    case trace.EventStateTransition:
        // goroutine transition
    }
}
```

Custom analysis is possible; it is how `go tool trace`'s "Goroutine analysis" page is built.

Cost: trace recording is *expensive*. The default writes around 1 MB/sec under moderate load. Do not enable it for long durations or in production without rate-limiting. Use short windows (5–10 seconds) for diagnostic capture.

---

## Cost of Profile Capture at Scale

Profile capture is O(N) in goroutine count. Concrete numbers from a 64-core machine, Go 1.22:

| Goroutines | `NumGoroutine()` | `pprof.Lookup` `debug=0` | `pprof.Lookup` `debug=2` | `runtime.Stack(_, true)` |
|------------|------------------|--------------------------|--------------------------|--------------------------|
| 1,000 | 50 ns | 80 µs | 300 µs | 250 µs |
| 100,000 | 50 ns | 8 ms | 30 ms | 25 ms |
| 1,000,000 | 50 ns | 80 ms | 300 ms | 250 ms |

The `NumGoroutine` cost is constant — it is an atomic load. The other operations scale linearly. At a million goroutines, a `debug=2` dump is a 300 ms STW (or near-STW with the per-G optimisation), which is a noticeable latency event. Capture profiles sparingly at that scale.

`go_goroutines` as a metric is *always cheap* — it is `NumGoroutine` once per scrape. Even at scrape intervals of 1 second, the overhead is negligible.

---

## Building a Custom Detector

If you need to ship a detector that does not depend on `goleak`, the skeleton is:

```go
package leakdetect

import (
    "runtime"
    "runtime/pprof"
    "strings"
    "time"
)

type Detector struct {
    baseline int
    paths    []string // top-frame prefixes that mean "runtime, ignore"
}

func New() *Detector {
    runtime.GC()
    time.Sleep(10 * time.Millisecond)
    return &Detector{
        baseline: runtime.NumGoroutine(),
        paths: []string{
            "runtime.gopark",
            "runtime.bgsweep",
            "runtime.bgscavenge",
            "runtime.gcBgMarkWorker",
            "runtime.forcegchelper",
        },
    }
}

func (d *Detector) Suspects() ([]string, error) {
    runtime.GC()
    time.Sleep(10 * time.Millisecond)

    var sb strings.Builder
    if err := pprof.Lookup("goroutine").WriteTo(&sb, 2); err != nil {
        return nil, err
    }
    return d.filter(sb.String()), nil
}

func (d *Detector) filter(profile string) []string {
    blocks := strings.Split(profile, "\n\n")
    var out []string
    for _, b := range blocks {
        if d.isRuntime(b) {
            continue
        }
        if len(b) > 0 {
            out = append(out, b)
        }
    }
    return out
}

func (d *Detector) isRuntime(block string) bool {
    for _, p := range d.paths {
        if strings.Contains(block, p) {
            return true
        }
    }
    return false
}
```

This is roughly what `goleak` does internally, simplified. The real implementation is more careful about waitstate strings and parallel test isolation. Read the source of `go.uber.org/goleak` for the full details — it is a few hundred lines and worth a careful read.

---

## Self-Assessment

- [ ] I can explain `runtime.NumGoroutine` in terms of `allglen` and the dead/system counters.
- [ ] I can describe the STW behaviour of `runtime.Stack(_, true)` and how Go 1.19+ optimised it.
- [ ] I can read the protobuf goroutine profile format.
- [ ] I know which `debug=` mode emits labels and which does not.
- [ ] I can list at least six wait reasons and which ones typically indicate leaks.
- [ ] I can interpret a `GODEBUG=schedtrace=1000` line.
- [ ] I can write a `runtime/trace` consumer that detects goroutines with no `EvGoEnd`.
- [ ] I have measured the cost of `pprof.Lookup("goroutine")` on my own service.
- [ ] I can build a minimal custom leak detector without depending on `goleak`.

---

## Summary

Professional-level detection is about owning the mechanism, not just the tool. `runtime.NumGoroutine` is an atomic load on a runtime-maintained counter. `pprof.Lookup("goroutine")` walks `allgs` under a (now-minimised) STW. Wait reasons are the runtime's classification of why a goroutine is parked, and they map cleanly to leak archetypes. `runtime/trace` captures the full creation/destruction event stream and lets you reconstruct lifetimes. The cost of capture scales linearly with goroutine count; at a million goroutines a full `debug=2` is a noticeable latency event, and design must account for that. Armed with this mechanism, you can build custom detectors, write performant integrations, and reason precisely about what your monitoring system is showing you. The prevention story ([03-preventing-leaks](../03-preventing-leaks/)) is the natural sequel; the pprof tooling ([04-pprof-tools](../04-pprof-tools/)) shares all the same machinery for heap, block, and CPU profiles.
