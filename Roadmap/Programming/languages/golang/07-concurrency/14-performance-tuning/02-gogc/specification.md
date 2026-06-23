# GOGC and GOMEMLIMIT — Specification

## Table of Contents
1. [Scope](#scope)
2. [Environment Variables](#environment-variables)
3. [Runtime API](#runtime-api)
4. [GODEBUG Flags Affecting GC](#godebug-flags-affecting-gc)
5. [runtime.MemStats — Field Reference](#runtimememstats--field-reference)
6. [runtime/metrics — Relevant Metrics](#runtimemetrics--relevant-metrics)
7. [GC Algorithm Invariants](#gc-algorithm-invariants)
8. [Compatibility Notes Across Versions](#compatibility-notes-across-versions)

---

## Scope

This file collects the formal interface of Go's garbage-collection controls: environment variables, runtime package functions, the `MemStats` structure, the `runtime/metrics` instrument names that touch GC, and the invariants documented in the Go runtime source. Where the Go specification (`go.dev/ref/spec`) does not address a runtime detail, the authoritative source is the standard library documentation and the runtime source code (`src/runtime/`).

---

## Environment Variables

### `GOGC`

- **Type:** integer or the special string `off`.
- **Default:** `100`.
- **Range:** any non-negative integer. `0` is accepted but produces continuous GC.
- **Meaning:** percentage growth of the heap above the previous live size that triggers the next GC.
- **`off`:** disables garbage collection. Equivalent to calling `debug.SetGCPercent(-1)`.
- **Read:** at runtime startup. Subsequent changes via environment variable do not take effect; use `debug.SetGCPercent`.

### `GOMEMLIMIT`

- **Type:** byte count with optional suffix.
- **Default:** unlimited (`math.MaxInt64`).
- **Suffixes:** `B`, `KiB`, `MiB`, `GiB`, `TiB` (powers of two); `K`, `M`, `G`, `T` (powers of ten).
- **Meaning:** soft memory limit for the Go runtime. The runtime adjusts GC behaviour to stay under this limit.
- **Soft semantics:** the runtime never blocks allocations to honour the limit; it only changes GC frequency.
- **Available since:** Go 1.19.
- **Read:** at runtime startup. Subsequent changes via environment variable do not take effect; use `debug.SetMemoryLimit`.

### `GODEBUG`

A comma-separated list of debug flags. The flags relevant to GC are listed in their own section below.

---

## Runtime API

### `runtime.GC()`

```go
func GC()
```

Runs a complete garbage collection cycle synchronously. Blocks until the cycle (including mark termination) finishes. Sweep may still proceed lazily after return. Calling `GC` repeatedly in a tight loop has no benefit and incurs full STW costs.

### `runtime.ReadMemStats(m *MemStats)`

```go
func ReadMemStats(m *MemStats)
```

Populates the given `MemStats` struct with current memory and GC counters. The call requires a brief stop-the-world to ensure consistency; not suitable for hot paths. Approximate cost: tens of microseconds.

### `runtime.NumGoroutine()`

```go
func NumGoroutine() int
```

Returns the current number of goroutines. Not directly a GC API, but relevant: each goroutine has a stack that mark must scan, so goroutine count affects GC cost.

### `runtime/debug.SetGCPercent(percent int) int`

```go
func SetGCPercent(percent int) int
```

Sets the GC target percentage; equivalent to `GOGC` but at runtime. Returns the previous value. Special values:

- `percent < 0` — disables GC. Returns the previous percentage (or `-1` if GC was already disabled).
- `percent == 0` — extremely aggressive GC (collects on nearly every allocation). Accepted but rarely useful.

The function is thread-safe.

### `runtime/debug.SetMemoryLimit(limit int64) int64`

```go
func SetMemoryLimit(limit int64) int64
```

Sets the soft memory limit in bytes; equivalent to `GOMEMLIMIT`. Returns the previous limit. Special values:

- `limit == -1` — queries the current limit without changing it.
- `limit == math.MaxInt64` — effectively unlimited (default).

Available since Go 1.19.

### `runtime/debug.FreeOSMemory()`

```go
func FreeOSMemory()
```

Forces a garbage collection and attempts to return as much memory as possible to the operating system. Strong form of `runtime.GC()`. Useful before known idle periods or in tests; not appropriate in steady-state code.

### `runtime/debug.SetGCFraction` — does not exist

There is no API to set the GC CPU fraction directly. The 25% dedicated / 50% cap behaviour is fixed in the runtime.

---

## GODEBUG Flags Affecting GC

Set via `GODEBUG=name=value[,name=value]...` in the environment.

### `gctrace=1`

Print one summary line per GC cycle to stderr. Example output is described in `middle.md`. Values:

- `0` — disabled (default).
- `1` — one line per cycle.
- `2` — `1` plus additional sweep information.

### `gcpacertrace=1`

Print pacer-internal events. Verbose, used for debugging the runtime itself. Not for production.

### `madvdontneed=1` / `madvdontneed=0`

Controls whether the runtime uses `MADV_DONTNEED` (return memory promptly) or `MADV_FREE` (return lazily) when releasing memory. Affects RSS but not heap accounting. Default differs by OS and kernel version.

### `inittrace=1`

Prints init-function timings. Useful when start-up time matters; not specifically GC.

### `memprofilerate`

Not a GODEBUG flag but a runtime variable: `runtime.MemProfileRate`. Controls how often allocations are sampled into the memory profile. Setting to `1` records every allocation (expensive). Setting to `0` disables sampling.

---

## runtime.MemStats — Field Reference

The full struct is documented at `pkg.go.dev/runtime#MemStats`. Selected fields for tuning purposes:

| Field | Type | Meaning |
|-------|------|---------|
| `Alloc` | `uint64` | Bytes of allocated heap objects. Same as `HeapAlloc`. |
| `TotalAlloc` | `uint64` | Cumulative bytes allocated for heap objects (monotonic). |
| `Sys` | `uint64` | Total bytes obtained from OS for heap, stacks, and runtime structures. |
| `Lookups` | `uint64` | Number of pointer lookups by the runtime. Legacy. |
| `Mallocs` | `uint64` | Cumulative count of heap allocations. |
| `Frees` | `uint64` | Cumulative count of freed heap objects. |
| `HeapAlloc` | `uint64` | Bytes in live heap objects. |
| `HeapSys` | `uint64` | Bytes of heap memory obtained from OS. |
| `HeapIdle` | `uint64` | Bytes in idle spans (free, may be returned to OS). |
| `HeapInuse` | `uint64` | Bytes in in-use spans. |
| `HeapReleased` | `uint64` | Bytes of heap memory returned to OS. |
| `HeapObjects` | `uint64` | Number of allocated heap objects. |
| `StackInuse` | `uint64` | Bytes in stack spans currently in use. |
| `StackSys` | `uint64` | Bytes obtained from OS for stacks. |
| `MSpanInuse` | `uint64` | Bytes used by mspan structures. |
| `MSpanSys` | `uint64` | Bytes obtained from OS for mspan structures. |
| `MCacheInuse` | `uint64` | Bytes used by mcache structures. |
| `MCacheSys` | `uint64` | Bytes obtained from OS for mcache structures. |
| `BuckHashSys` | `uint64` | Bytes used by profiling bucket hash tables. |
| `GCSys` | `uint64` | Bytes used for garbage collection metadata. |
| `OtherSys` | `uint64` | Bytes used for miscellaneous runtime allocations. |
| `NextGC` | `uint64` | Target heap size for the next GC. |
| `LastGC` | `uint64` | Time the last GC finished, in nanoseconds since the Unix epoch. |
| `PauseTotalNs` | `uint64` | Cumulative GC STW pause time. |
| `PauseNs` | `[256]uint64` | Circular buffer of recent STW pause durations. |
| `PauseEnd` | `[256]uint64` | Circular buffer of pause end times. |
| `NumGC` | `uint32` | Number of GC cycles completed. |
| `NumForcedGC` | `uint32` | Number of GC cycles forced via `runtime.GC` or `debug.FreeOSMemory`. |
| `GCCPUFraction` | `float64` | Fraction of program CPU spent in GC since program start. |
| `EnableGC` | `bool` | Always `true`; reserved for future use. |
| `DebugGC` | `bool` | Reserved. |
| `BySize` | `[61]struct{...}` | Per-size-class allocation statistics. |

### Conventions

- All byte counts are in bytes (not pages).
- `PauseNs` is indexed by `(NumGC + 255) % 256` to find the most recent pause.
- `Sys ≈ HeapSys + StackSys + MSpanSys + MCacheSys + GCSys + OtherSys + BuckHashSys`.

---

## runtime/metrics — Relevant Metrics

The `runtime/metrics` package (Go 1.16+) exposes counters with stable names. Recommended for new code. Selection:

| Name | Unit | Description |
|------|------|-------------|
| `/gc/heap/live:bytes` | bytes | Live heap bytes after last GC. |
| `/gc/heap/goal:bytes` | bytes | Target heap size for next GC. |
| `/gc/heap/objects:objects` | count | Number of live heap objects. |
| `/gc/heap/allocs:bytes` | bytes | Cumulative bytes allocated to heap. |
| `/gc/heap/frees:bytes` | bytes | Cumulative bytes freed from heap. |
| `/gc/heap/tiny/allocs:objects` | count | Cumulative tiny allocations. |
| `/gc/cycles/total:gc-cycles` | count | Total GC cycles. |
| `/gc/cycles/automatic:gc-cycles` | count | GC cycles started by the runtime. |
| `/gc/cycles/forced:gc-cycles` | count | GC cycles forced via `runtime.GC` or `debug.FreeOSMemory`. |
| `/gc/scan/heap:bytes` | bytes | Bytes of heap scannable. |
| `/gc/scan/globals:bytes` | bytes | Bytes of globals scannable. |
| `/gc/scan/stack:bytes` | bytes | Bytes of stack scannable. |
| `/gc/pauses:seconds` | seconds (histogram) | STW pause durations. |
| `/cpu/classes/gc/total:cpu-seconds` | cpu-seconds | Total CPU time used by GC. |
| `/cpu/classes/gc/mark/assist:cpu-seconds` | cpu-seconds | CPU time spent in GC assist. |
| `/cpu/classes/gc/mark/dedicated:cpu-seconds` | cpu-seconds | CPU in dedicated mark workers. |
| `/cpu/classes/gc/mark/idle:cpu-seconds` | cpu-seconds | CPU in idle-time mark workers. |
| `/cpu/classes/gc/pause:cpu-seconds` | cpu-seconds | CPU during STW pauses. |
| `/memory/classes/heap/free:bytes` | bytes | Heap memory currently free. |
| `/memory/classes/heap/objects:bytes` | bytes | Bytes in live heap objects. |
| `/memory/classes/heap/released:bytes` | bytes | Heap memory returned to OS. |
| `/memory/classes/heap/stacks:bytes` | bytes | Heap memory used for stacks (allocated from heap). |
| `/memory/classes/heap/unused:bytes` | bytes | Heap memory unused. |
| `/memory/classes/total:bytes` | bytes | Total memory obtained from OS. |
| `/memory/classes/os-stacks:bytes` | bytes | OS stack memory. |
| `/sched/goroutines:goroutines` | count | Number of live goroutines. |

The schema is stable across Go versions; new metrics are added but old ones are not removed without a deprecation cycle.

---

## GC Algorithm Invariants

The following invariants are documented in `runtime/HACKING.md` and the runtime source.

1. **Tri-colour invariant.** At all points during mark, no black object refers directly to a white object. The write barrier preserves this.

2. **Reachability.** The roots are: global variables, goroutine stacks (active frames, registers), and special runtime structures (finalizer queue, special slots). Anything reachable from roots is preserved.

3. **Pointer stability.** The collector does not move objects. Pointer values remain valid across GC cycles.

4. **No moving GC.** Consequently, fragmentation is possible. The allocator's size-class design limits its cost.

5. **Lazy sweep.** Sweeping is not synchronous with mark termination. The application's allocator advances sweep incrementally.

6. **STW phases bounded.** STW1 (sweep termination) and STW2 (mark termination) are designed to complete in sub-millisecond time on modern hardware. STW1 size is roughly proportional to runtime structures, STW2 to remaining mark work.

7. **GC assist debits.** Each byte allocated during mark incurs an assist debit; goroutines whose debit exceeds their credit are forced to perform mark work proportional to their over-allocation.

8. **Heap goal is a target, not a cap.** The heap may overshoot the goal during mark due to in-flight allocations. The pacer aims to minimise overshoot.

9. **`GOMEMLIMIT` is soft.** No allocation is refused or blocked to honour it; the runtime only adjusts GC frequency.

10. **GC CPU is capped at ~50%.** The runtime declines to use more than ~50% of available CPU on GC even when respecting `GOMEMLIMIT` would require it.

11. **Finalizers run on a dedicated goroutine.** Finalizers are not called from GC threads; they are enqueued for separate execution. A backed-up finalizer queue can delay reclamation.

---

## Compatibility Notes Across Versions

- **Go 1.5:** introduced the concurrent GC. Previous versions used a stop-the-world collector.
- **Go 1.8:** hybrid write barrier; STW2 dropped substantially.
- **Go 1.12:** sweep statistics improved; per-P sweep ranges introduced.
- **Go 1.13:** `sync.Pool` victim cache. Reduced pool eviction cost.
- **Go 1.14:** asynchronous preemption; long-running goroutines no longer block mark.
- **Go 1.16:** `runtime/metrics` package introduced.
- **Go 1.19:** `GOMEMLIMIT` added; pacer redesigned; 50% CPU cap introduced.
- **Go 1.20:** further pacer refinements; arenas experimental.
- **Go 1.21:** GC-related profiling improvements; small allocator tweaks.

When debugging on older versions, expect different numbers and slightly different gctrace fields. The general shape (mark, STW, sweep) has been stable since 1.8.
