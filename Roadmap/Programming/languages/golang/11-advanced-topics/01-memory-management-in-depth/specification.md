# Memory Management in Depth — Specification

> **Focus:** Precise reference for how Go manages memory at runtime — the heap, the stack, allocators, the garbage collector, and the public APIs that observe or influence them.
>
> **Sources:**
> - `runtime` package documentation: https://pkg.go.dev/runtime
> - `runtime/debug` package: https://pkg.go.dev/runtime/debug
> - `runtime/metrics` package: https://pkg.go.dev/runtime/metrics
> - Go memory model: https://go.dev/ref/mem
> - Go GC guide: https://go.dev/doc/gc-guide

---

## 1. Memory regions

Go programs use four distinct memory regions, each with its own allocation rules and lifetime.

| Region | Lifetime | Allocator | Reclaimed by |
|--------|----------|-----------|--------------|
| **Stack** | Per goroutine; frames live until the function returns | Stack pointer bump | Frame unwind / stack shrink |
| **Heap** | Until unreachable | mcache → mcentral → mheap | Garbage collector |
| **BSS / data** | Process lifetime | Linker | Never |
| **Read-only** | Process lifetime | Linker (RODATA) | Never |

A goroutine starts with a small contiguous stack (2 KiB as of Go 1.4+) that grows and shrinks by copying frames into a larger or smaller region.

---

## 2. Heap allocator structure

The heap is organized as a three-level hierarchy modeled after TCMalloc.

```
goroutine → P (processor) → mcache → mcentral → mheap → OS
```

| Component | Role |
|-----------|------|
| `mcache` | Per-P, lock-free cache of small object spans (one per size class) |
| `mcentral` | Global, lock-protected pool of partially used spans for a given size class |
| `mheap` | Global manager of large allocations and the page heap |
| `mspan` | A run of pages dedicated to one size class |
| `arena` | A 64 MiB region (on 64-bit Linux) carved out of the address space |

Allocations under 32 KiB are *small* and routed through size classes (currently 67 of them, defined in `runtime/sizeclasses.go`). Allocations of 32 KiB or more are *large* and served directly from `mheap`.

---

## 3. Size classes and waste

Small allocations are rounded up to the nearest size class. The internal fragmentation per object is bounded but nonzero.

| Requested | Class | Allocated | Waste |
|-----------|-------|-----------|-------|
| 1 B | 8 B | 8 B | 7 B |
| 17 B | 24 B | 24 B | 7 B |
| 100 B | 112 B | 112 B | 12 B |
| 5000 B | 5376 B | 5376 B | 376 B |

The full table lives in [`runtime/sizeclasses.go`](https://github.com/golang/go/blob/master/src/runtime/sizeclasses.go).

---

## 4. Garbage collector

| Property | Value |
|----------|-------|
| Algorithm | Concurrent, tri-color, mark-and-sweep |
| Stop-the-world | Two short pauses per cycle (mark setup, mark termination) |
| Write barrier | Hybrid (Yuasa-style deletion + Dijkstra-style insertion) |
| Pacer | Soft heap goal; triggered when live heap × GOGC/100 grown |
| Generational | **No** (single generation) |
| Compacting | **No** (non-moving) |

The GC pacer tries to finish a cycle before the heap grows past `live × (1 + GOGC/100)`. The default `GOGC=100` means GC runs when the heap doubles from the live set.

---

## 5. Tunable parameters

| Knob | API | Default | Effect |
|------|-----|---------|--------|
| `GOGC` | env var or `debug.SetGCPercent` | 100 | Higher → less frequent GC, more memory |
| `GOMEMLIMIT` | env var or `debug.SetMemoryLimit` | math.MaxInt64 | Soft cap on total runtime memory |
| `GOMAXPROCS` | env var or `runtime.GOMAXPROCS` | NumCPU | Bounds GC worker parallelism |
| `GODEBUG=gctrace=1` | env var | off | Print one line per GC cycle to stderr |
| `GODEBUG=madvdontneed=1` | env var | platform-dependent | Force `MADV_DONTNEED` instead of `MADV_FREE` |
| `GODEBUG=gcstoptheworld=1\|2` | env var | 0 | Force fully STW GC (debugging only) |

`GOMEMLIMIT` is a *soft* limit: the runtime will GC more aggressively to stay under it but will exceed it rather than allow an out-of-memory error.

---

## 6. Public APIs

### `runtime`

| Function | Purpose |
|----------|---------|
| `runtime.GC()` | Run a blocking GC cycle (rarely needed) |
| `runtime.ReadMemStats(*MemStats)` | Snapshot of heap, GC, and allocation counters |
| `runtime.NumGoroutine()` | Current goroutine count |
| `runtime.MemProfileRate` | Sample rate (bytes between samples) for the heap profile |
| `runtime.SetFinalizer(obj, fn)` | Register a finalizer; runs *after* `obj` becomes unreachable |
| `runtime.KeepAlive(x)` | Prevent `x` from being collected before this point |
| `runtime.AddCleanup(obj, fn, arg)` (1.24+) | Modern replacement for finalizers; not tied to `obj` keep-alive |

### `runtime/debug`

| Function | Purpose |
|----------|---------|
| `debug.SetGCPercent(p)` | Equivalent to `GOGC=p`; returns previous |
| `debug.SetMemoryLimit(n)` | Equivalent to `GOMEMLIMIT=n`; returns previous |
| `debug.FreeOSMemory()` | Force the runtime to release retained pages back to the OS |
| `debug.ReadGCStats(*GCStats)` | Pause times, last cycle wall clock, etc. |
| `debug.SetMaxStack(n)` | Per-goroutine stack ceiling (panics beyond) |

### `runtime/metrics`

`runtime/metrics.Read([]Sample)` exposes ~50 named, typed, versioned metrics including `/memory/classes/heap/free:bytes`, `/gc/cycles/automatic:gc-cycles`, `/sched/goroutines:goroutines`. This is the **preferred** API for new monitoring code; `ReadMemStats` is retained for compatibility but stops-the-world.

---

## 7. MemStats fields you will actually read

| Field | Meaning |
|-------|---------|
| `Alloc` / `HeapAlloc` | Bytes of live (allocated and not yet freed) heap objects |
| `TotalAlloc` | Cumulative bytes allocated for heap objects (never decreases) |
| `Sys` | Bytes obtained from the OS for *all* runtime structures |
| `HeapSys` | Bytes obtained from the OS for the heap |
| `HeapInuse` | Bytes in mspans currently in use |
| `HeapIdle` | Bytes in mspans not currently in use but retained |
| `HeapReleased` | Bytes returned to the OS |
| `HeapObjects` | Number of live objects |
| `NumGC` | Completed GC cycles |
| `PauseNs[(NumGC+255)%256]` | Most recent STW pause (ns) |
| `NextGC` | Heap size at which the next GC will trigger |
| `LastGC` | Wall-clock ns since 1970 of last GC end |
| `GCCPUFraction` | Fraction of program CPU time spent in GC since start |

---

## 8. Stack growth contract

| Property | Behavior |
|----------|----------|
| Initial size | 2 KiB (`_StackMin`) |
| Growth | Copy to a 2× larger contiguous region and update pointers |
| Shrink | Halved on GC if used < 1/4 |
| Maximum | 1 GiB on 64-bit (`maxstacksize`), overridable with `debug.SetMaxStack` |
| Pointer rewriting | All on-stack pointers are updated atomically during the copy |

Because the stack is copied on growth, you **cannot** take a permanent pointer that escapes the goroutine to a stack variable and expect it to stay valid — the escape analyzer enforces this by moving such variables to the heap.

---

## 9. Escape rules (compile-time)

A variable escapes to the heap when the compiler cannot prove it stays in the frame. Examples:

- Returning a pointer to a local variable.
- Storing a pointer in a global, a heap-allocated structure, or a channel.
- Assigning to an `interface{}` whose dynamic type is larger than a word.
- Being captured by a closure that itself escapes.
- Being too large for the stack (currently ~10 MiB single objects).
- Having an unknown size at compile time (e.g., `make([]T, n)` where `n` is dynamic *and* the slice escapes).

`go build -gcflags="-m"` reports each decision. See [02-escape-analysis](../02-escape-analysis/) for the full treatment.

---

## 10. Finalizers and cleanups

| Mechanism | Available | Semantics |
|-----------|-----------|-----------|
| `runtime.SetFinalizer` | All versions | One finalizer per object; resurrects the object during the cycle that schedules it; runs in a dedicated goroutine |
| `runtime.AddCleanup` | Go 1.24+ | Multiple cleanups per object; does **not** resurrect; cannot keep the object alive; recommended for new code |

Finalizers must not be relied upon for timely resource release — there is no guarantee they ever run before program exit. Use `Close()` and `defer`.

---

## 11. Non-goals / limitations

- Go does **not** provide manual `free`; the only way to release heap memory is to drop all references and let the GC run.
- The GC is **not** generational and **not** compacting; long-lived large heaps can fragment, though arenas mitigate this.
- The runtime does not give per-goroutine memory accounting.
- `runtime.GC()` is not a substitute for fixing leaks.

---

## 12. Related references

- Go GC guide: https://go.dev/doc/gc-guide
- `runtime` source: https://github.com/golang/go/tree/master/src/runtime
- TCMalloc design notes: https://google.github.io/tcmalloc/design.html
- Original Go GC paper (Hudson, Click): https://blog.golang.org/ismmkeynote
