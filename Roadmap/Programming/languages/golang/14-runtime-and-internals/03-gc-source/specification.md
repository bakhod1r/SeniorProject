# GC Source — Specification

## 1. Intro

Go does not have a language-level specification for its garbage collector. The *Go Programming Language Specification* mentions garbage collection only in passing — once in the context of finalizers (`runtime.SetFinalizer`) and once to note that channels and maps are heap-managed values. Nowhere does the document promise an algorithm, a pacing strategy, a barrier shape, or a pause-time bound. The GC's behaviour is defined by what the runtime source code does, anchored by a constellation of design documents, accepted proposals, and the public `runtime` and `runtime/debug` APIs.

This is a deliberate stance. The Go team has repeatedly stated that the GC algorithm is an implementation detail; what is stable is the *contract* exposed to user code:

- Allocations are tracked; unreachable objects are eventually freed.
- The user never calls `free`. There is no manual memory management at the language level.
- `runtime.GC()` performs a synchronous collection cycle on demand.
- Finalizers registered with `runtime.SetFinalizer` will eventually run for unreachable objects (no specific timeline).
- `GOGC` and `GOMEMLIMIT` adjust the trade-off between heap size and CPU usage in publicly documented ways.

Everything below that contract — the tricolour algorithm, the hybrid write barrier, the mark-assist scheduler, the page allocator, the scavenger, the pacer — is the source-of-truth. The relevant directory is `src/runtime/` in the Go repository; the files prefixed `mgc`, `mheap`, `malloc`, `mbarrier`, `mbitmap`, `mfinal`, and `mspanset` together constitute the GC implementation. A senior Go engineer reads the source for ground truth and the design docs for intent.

The "official documentation" for the GC is therefore not a single document but a layered set:

1. The `runtime` and `runtime/debug` Go package documentation (the public API contract).
2. The `runtime/metrics` package documentation (the observable surface).
3. The `GODEBUG` environment variable documentation in `runtime/HACKING.md` and the standard library docs.
4. The accepted GC-related proposals in `golang/proposal` and `golang/go/issues`.
5. The "Getting to Go: The Journey of Go's Garbage Collector" talk and blog post by Rick Hudson.
6. The source itself in `src/runtime/`.

This specification document walks each layer.

---

## 2. Key historical milestones

The GC has been redesigned several times. Each major rework is anchored by a public proposal or design document; the proposals are the closest thing to an authoritative spec for the behaviour of that version.

| Go version | Year | Change | Proposal / design doc |
|------------|------|--------|-----------------------|
| 1.0 | 2012 | Stop-the-world mark-and-sweep | none — initial implementation |
| 1.3 | 2014 | Precise stack scanning, parallel sweep | none — internal |
| 1.5 | 2015 | Concurrent tri-colour GC, sub-10ms pauses | "Go 1.5 concurrent garbage collector pacing" |
| 1.8 | 2017 | Hybrid write barrier; eliminate STW stack re-scan | "Eliminate STW stack re-scanning" |
| 1.12 | 2019 | New page allocator; faster sweep | runtime: replace mheap_.spans, mheap_.bitmap |
| 1.14 | 2020 | Asynchronous preemption (signal-based) | proposal 24543 "non-cooperative goroutine preemption" |
| 1.19 | 2022 | `GOMEMLIMIT` soft memory limit | proposal 48409 "Soft memory limit" |
| 1.21+ | 2023+ | Pacer refinements; per-P scavenger | proposal 44167 "GC pacer redesign" (landed 1.18, polished later) |

### 2.1 Go 1.5 — concurrent GC

The first GC capable of running concurrently with the application. Worker goroutines mark live objects while user goroutines continue executing. Stop-the-world pauses dropped from hundreds of milliseconds to under ten in the common case. The proposal that pinned the design is **"Go 1.5 concurrent garbage collector pacing"** (Austin Clements, Rick Hudson, 2015). It introduced the *pacer* — the controller that schedules GC start so the cycle completes near the heap-size goal — and the *mark-assist* mechanism that obliges allocating goroutines to help the GC if it falls behind.

Before 1.5 the collector was a parallel mark-and-sweep that stopped every user goroutine for the entire cycle. The 1.5 design split the cycle into four phases — mark setup (STW), concurrent mark, mark termination (STW), concurrent sweep — with only the two STW phases blocking the application. The mark-setup phase enables the write barrier and snapshots root metadata; the concurrent mark phase does the bulk of the work; mark termination flushes any straggling work and disables the barrier; sweep runs in the background and is also amortised across allocations.

### 2.2 Go 1.8 — hybrid write barrier

Before 1.8, the GC re-scanned all goroutine stacks at the end of the mark phase, inside a stop-the-world pause. As programs grew, this re-scan dominated pause time. The 1.8 design eliminated it by combining two barriers — **Yuasa** (snapshot-at-the-beginning, shading the old pointer) and **Dijkstra** (incremental update, shading the new pointer) — into a single barrier active throughout the mark phase. The proposal "**Eliminate STW stack re-scanning**" (Rick Hudson, Austin Clements, 2016) is the design document. Pauses dropped below one millisecond for typical workloads.

The hybrid is necessary because each individual barrier has a weakness. Yuasa alone requires a full stack scan at mark termination to catch pointers that were on the stack at mark start and never written through (because the snapshot only captures heap writes). Dijkstra alone requires a stack barrier on every function return to catch pointers stored in older frames that the mutator might revisit. Combining them — shade the old value when overwritten *and* shade the new value when stored — produces a barrier that holds the tricolour invariant without either a stack snapshot or per-return stack barriers. The cost is one extra shade per pointer write; the win is that the mark-termination STW pause becomes constant-time in the live set.

### 2.3 Go 1.12 — new page allocator

The page-level allocator was rewritten to use a radix-tree summary structure instead of treaps, sharply reducing sweep latency on large heaps. Sweep is the post-mark phase that returns unmarked spans to the free lists; the new design made it scale linearly with the number of allocated pages rather than super-linearly. The change has no proposal document because it is purely internal optimisation; the commit messages and the `runtime/mpagealloc.go` source are the references.

In the same release the scavenger was modernised: instead of returning all idle pages eagerly, it became background-driven and rate-limited. The default behaviour switched from `MADV_DONTNEED` to `MADV_FREE` on Linux, which is cheaper but leaves pages accounted to RSS until the kernel reclaims them. The `madvdontneed=1` GODEBUG knob exists to restore the old behaviour when RSS measurements need to be accurate (e.g. for billing or alerting on container memory metrics).

### 2.4 Go 1.14 — asynchronous preemption

Before 1.14, a goroutine running a tight loop without function calls could not be preempted; the GC would wait until the loop yielded at a safe-point. Long-running pure-Go computations could hold up a collection cycle indefinitely. Proposal **24543 "non-cooperative goroutine preemption"** introduced signal-based preemption on POSIX systems: the runtime sends `SIGURG` to a target M, the signal handler inspects the goroutine's PC against compiler-emitted safe-point metadata, and yields. The GC affected slot is the stack scan: stacks can now be scanned at any instruction boundary, not only at function calls.

The signal-based mechanism relies on compiler support: every register at every PC must be classifiable as "contains a pointer" or "does not", so the GC can scan the goroutine's machine state safely. This metadata is large (multiple bytes per PC for register-rich architectures) and is one of the larger contributions to the size of Go binaries. The trade-off was deliberate: binary size for predictable pause behaviour.

### 2.5 Go 1.19 — `GOMEMLIMIT`

The original `GOGC` knob set the heap-growth ratio between cycles; it did not bound the total memory the process could consume. Workloads with bursty allocation patterns could trigger OOM kills despite plenty of slack on average. Proposal **48409 "Soft memory limit"** (Michael Knyszek, 2021) added `GOMEMLIMIT` (and `runtime/debug.SetMemoryLimit`), a soft upper bound that the runtime tries to respect by running the GC more aggressively as the limit is approached. The limit is *soft*: the runtime will exceed it rather than fail an allocation, and a CPU-protection mechanism (the *GC limiter*) caps the time the GC may spend defending the limit so that the program does not livelock.

### 2.6 Go 1.21+ — pacer redesign and refinements

Proposal **44167 "GC pacer redesign"** (Michael Knyszek, 2021, landed across 1.18–1.21) rewrote the pacer to be a more predictable feedback controller. The old pacer had pathological behaviour under certain allocation patterns (large allocations near the goal, sudden allocation-rate shifts) that the new design corrects. The redesign is documented in the proposal and in long-form comments at the top of `runtime/mgcpacer.go`.

The new pacer separates two distinct goals — *meet the heap-size target* and *use a fixed fraction of CPU for GC* — and treats them as independent constraints rather than a single combined objective. This makes the pacer's behaviour predictable in the presence of `GOMEMLIMIT`: when the limit is binding, the pacer prioritises memory; when memory is slack, it prioritises CPU; the transition between regimes is smooth. The earlier pacer combined the goals into a single trigger-ratio target, which produced oscillation when one goal pulled against the other.

---

## 3. The Go memory model and the GC

The Go memory model (`go.dev/ref/mem`) specifies the happens-before relations that user code can rely on for memory visibility. The model was substantially revised in 2022 (the document was rewritten by Russ Cox to align Go's semantics with the C/C++ and Java models). The revision did not change any user-visible behaviour but clarified the contract — most importantly, it stated explicitly that `sync/atomic` operations create sequentially-consistent edges, and it specified the behaviour of races involving non-pointer-aligned writes.

The GC implementation relies on the same model, with two additional rules implicit in the runtime source:

1. **Every pointer write in user code that may store a heap pointer goes through the write barrier when the barrier is active.** During the mark phase, the compiler emits a barrier call before every pointer-typed store. The barrier shades both the old and new referenced objects, preserving the tricolour invariant. This is invisible to user code semantically — the write still happens — but it is the mechanism by which the GC observes mutations.

2. **`sync/atomic` pointer operations are GC-aware.** `atomic.StorePointer`, `atomic.CompareAndSwapPointer`, and the typed `atomic.Pointer[T]` go through the runtime's atomic-store-with-write-barrier path. A user who bypasses atomics with `unsafe.Pointer` writes is responsible for not breaking the invariants; the runtime cannot insert a barrier into a `*(*uintptr)(unsafe.Pointer(p)) = uintptr(q)` store because the type system does not see it as a pointer write.

The practical consequences for user code:

- An allocation made by goroutine A and reachable from a global before any synchronisation with goroutine B is still visible to the GC; the GC traces from roots (globals, goroutine stacks, finalizer queues) using its own synchronisation independent of user happens-before edges.
- A pointer written via `sync/atomic` is a valid GC root for the duration of the atomic operation.
- `unsafe.Pointer` arithmetic is fine *as long as the resulting pointer always points into a Go-allocated object that is reachable through some other path*. A pointer constructed by arithmetic to a Go object that has no other reference is undefined behaviour: the GC will free the object and the pointer will dangle.
- Storing a Go pointer in C memory (or any memory the GC does not scan) and recovering it later is undefined unless something on the Go side keeps the object alive for the entire interval. The cgo rules in `cmd/cgo` documentation enumerate the legal patterns.

The relevant runtime files are `runtime/mbarrier.go` (write barrier implementation) and `runtime/atomic_pointer.go` (GC-aware atomics). The compiler-side companion is in `cmd/compile/internal/ssa`, where the SSA passes insert barrier calls before pointer-typed stores during code generation. The contract between the compiler-generated barrier sites and the runtime barrier implementation is internal and may change between versions; user code that bypasses both (via `unsafe.Pointer` arithmetic on uintptrs) is responsible for not breaking the tricolour invariant, which in practice means keeping the source object reachable through some other GC-visible pointer for the lifetime of the unsafe alias.

---

## 4. `runtime` package GC-related API

The public API surface for interacting with the GC lives in two packages: `runtime` for queries and triggers, and `runtime/debug` for tuning knobs.

### 4.1 `runtime.GC()`

Forces a synchronous garbage collection cycle and blocks the caller until the cycle (including sweep termination) completes. Used in benchmarks to establish a clean baseline, in finalizer-dependent test cleanup, and rarely in production. It is *not* a free lunch; calling it on a busy heap pauses the program for the duration of the mark and sweep work.

### 4.2 `runtime.SetFinalizer(obj, finalizer)`

Registers a function to be called when `obj` becomes unreachable. The finalizer runs in a dedicated goroutine after the GC determines the object is dead. There are no timing guarantees: the finalizer may run milliseconds or minutes after the object becomes unreachable, and the runtime does not guarantee it runs *at all* before program exit. Finalizers are the wrong tool for prompt resource cleanup; `defer` and explicit `Close()` are correct, and finalizers are a last-resort safety net (e.g. `os.File` uses one to close a stray file descriptor).

### 4.3 `runtime.KeepAlive(obj)`

Forces the compiler to consider `obj` reachable at the point of the `KeepAlive` call. Without it, an aggressive optimiser may free an object whose last semantic use was earlier in the function while the function is still using a derived `unsafe.Pointer` or a syscall handle. Pair with `unsafe.Pointer` arithmetic and with cgo calls that take a Go pointer.

### 4.4 `runtime.GOMAXPROCS(n)`

Sets the number of OS threads that can execute Go code simultaneously. The GC inherits the same `GOMAXPROCS`: by default, dedicated mark workers target 25% of `GOMAXPROCS` (set in `runtime/mgcpacer.go` as `gcBackgroundUtilization = 0.25`). Reducing `GOMAXPROCS` reduces both user concurrency and GC concurrency proportionally.

### 4.5 `runtime.ReadMemStats(m *MemStats)`

Populates a `MemStats` struct with a snapshot of heap, stack, and GC counters. The call stops the world briefly to gather a consistent snapshot, so high-frequency polling has a measurable cost; production telemetry should prefer `runtime/metrics`, which provides equivalent information without stopping the world.

### 4.6 `runtime/debug.SetGCPercent(percent int) int`

Sets `GOGC` programmatically; returns the previous value. Passing `-1` disables automatic GC (only `runtime.GC()` and memory-limit-triggered cycles will run). Useful in throughput-critical benchmarks and in latency-sensitive code paths that want to defer GC pressure.

### 4.7 `runtime/debug.SetMemoryLimit(limit int64) int64`

Sets `GOMEMLIMIT` programmatically; returns the previous value. Limit is in bytes; pass `math.MaxInt64` to disable. Together with `SetGCPercent(-1)`, this is the recommended way to operate in "memory-bound" mode where the GC runs only when needed to stay under the limit.

### 4.8 `runtime/debug.FreeOSMemory()`

Forces a garbage collection cycle followed by an aggressive scavenger pass that returns unused memory pages to the OS via `madvise(MADV_DONTNEED)` (or the platform equivalent). Used after a known memory peak (e.g. a one-shot batch job completing) to release physical memory promptly. Has a non-trivial cost; should not be called regularly.

### 4.9 `runtime/debug.SetGCPercent` and `SetMemoryLimit` together

The two functions return their previous values, which allows a scoped override pattern: save, change, defer restore. This is the cleanest way to mark a code region as having different GC characteristics — a benchmark, an import phase, an offline reindex — without leaking the setting to the rest of the program. The functions are goroutine-safe; concurrent calls from different goroutines are serialised by the runtime, but the result of interleaved calls is implementation-defined and should not be relied on.

### 4.10 `runtime.Stack` and `runtime.NumGoroutine`

Not GC functions per se, but adjacent diagnostics: `runtime.NumGoroutine()` returns the live goroutine count (relevant because each goroutine's stack is a GC root), and `runtime.Stack(buf, all)` returns formatted stack traces. A program with many millions of goroutines pays a measurable cost in stack scanning every cycle; the metric is the leading indicator.

---

## 5. `runtime/metrics` GC-related metrics

The `runtime/metrics` package (Go 1.16+) exposes a versioned, stable set of metric names with documented semantics. GC-related metrics are a subset.

| Metric | Type | Description |
|--------|------|-------------|
| `/gc/heap/allocs:bytes` | counter | Cumulative bytes allocated for heap objects; monotonic; matches `MemStats.TotalAlloc`. |
| `/gc/heap/allocs:objects` | counter | Cumulative count of heap object allocations. |
| `/gc/heap/frees:bytes` | counter | Cumulative bytes freed by the sweep phase; monotonic; `allocs - frees` approximates current live heap. |
| `/gc/heap/frees:objects` | counter | Cumulative count of heap objects freed. |
| `/gc/heap/live:bytes` | gauge | Bytes of live heap memory as of the last completed mark cycle. |
| `/gc/heap/goal:bytes` | gauge | Heap size at which the next GC cycle is targeted to start; set by the pacer using `GOGC` and `GOMEMLIMIT`. |
| `/gc/heap/objects:objects` | gauge | Current count of live heap objects. |
| `/gc/heap/tiny/allocs:objects` | counter | Allocations that fit into the tiny-allocator path (objects < 16 bytes with no pointers). |
| `/gc/pauses:seconds` | histogram | Distribution of stop-the-world pause durations; the modern replacement for `MemStats.PauseNs[]`. |
| `/gc/cycles/automatic:gc-cycles` | counter | Cycles triggered by the pacer (not by `runtime.GC()` or `SetMemoryLimit` saturation). |
| `/gc/cycles/forced:gc-cycles` | counter | Cycles triggered by `runtime.GC()`. |
| `/gc/cycles/total:gc-cycles` | counter | All cycles; matches `MemStats.NumGC`. |
| `/gc/limiter/last-enabled:gc-cycle` | gauge | The most recent GC cycle in which the CPU limiter activated (capping GC CPU to protect throughput when `GOMEMLIMIT` is saturated). Non-zero indicates memory pressure. |
| `/gc/scan/globals:bytes` | gauge | Bytes of globals scanned during the last cycle. |
| `/gc/scan/heap:bytes` | gauge | Bytes of heap scanned. |
| `/gc/scan/stack:bytes` | gauge | Bytes of stack scanned. |
| `/gc/stack/starting-size:bytes` | gauge | Default starting size of new goroutine stacks. |

The list is canonical for the version that ships with the running binary; `metrics.All()` returns the live set, so monitoring code should enumerate dynamically rather than hardcode names.

Metric names follow a stable convention. The first segment is the subsystem (`/gc/`, `/sched/`, `/memory/`, `/sync/`); the next segments are the dimension hierarchy; the suffix after the colon is the unit (`:bytes`, `:seconds`, `:objects`, `:gc-cycles`). New metrics are added on minor releases and never removed; deprecated metrics keep working until the next major version transition. This stability is the practical difference between `runtime/metrics` and `MemStats`: the former is a forward-compatible API designed for monitoring systems, the latter is a struct frozen by Go 1 compatibility and locked into a shape that predates many of the things modern operators want to observe.

---

## 6. GODEBUG knobs for GC

`GODEBUG` is the runtime's environment-variable channel for behaviour-affecting flags. GC-related knobs are documented in `src/runtime/HACKING.md` and (selectively) on the `runtime` package documentation page.

| Knob | Effect |
|------|--------|
| `gctrace=1` | After each GC cycle, write a one-line trace to stderr: cycle number, CPU times, heap sizes, goal, MB/s sweep rate, P count. The single most useful diagnostic for GC tuning. |
| `gctrace=2` | Same as `gctrace=1` plus additional pacer-internal numbers (trigger ratio, error term). |
| `madvdontneed=1` | Use `MADV_DONTNEED` instead of `MADV_FREE` on Linux when scavenging. `MADV_FREE` (default since Go 1.12) is faster but pages remain accounted to the process RSS until the kernel reclaims them; `MADV_DONTNEED` reduces RSS immediately but at higher CPU cost. Set to `1` when accurate RSS metrics matter more than throughput. |
| `gcshrinkstackoff=1` | Disables goroutine stack shrinking. Useful when investigating goroutine-leak diagnostics where stack shrinkage masks the root cause. |
| `gcstoptheworld=1` | Disables concurrent GC; reverts to a stop-the-world collector. Useful for debugging races between user code and the concurrent collector. `gcstoptheworld=2` additionally disables concurrent sweep. |
| `gccheckmark=1` | After each concurrent mark phase, runs a verification mark in stop-the-world mode and panics if the results disagree. Used in runtime development; never in production. |
| `allocfreetrace=1` | Logs every allocation and free to stderr. Extremely verbose; useful for tracking a specific allocation source in a small program. |
| `clobberfree=1` | Overwrites the contents of freed objects with `0xdeaddeaddeaddead` to catch use-after-free bugs. Pairs with `gccheckmark=1` for runtime debugging. |
| `scavtrace=1` | Trace scavenger activity: when pages were returned to the OS and how many. Useful for diagnosing RSS-vs-heap-size discrepancies. |
| `gcpacertrace=1` | Trace pacer decisions: trigger ratios, utilisation goals, assist credit. Useful when tuning workloads that fight the pacer. |

Knobs combine with commas: `GODEBUG=gctrace=1,scavtrace=1` enables both. The full set is version-specific; the authoritative list is in the running binary's runtime source.

---

## 7. `GOGC` and `GOMEMLIMIT` semantics

### 7.1 `GOGC`

`GOGC` controls the heap-growth ratio between cycles. The default value is `100`, meaning the GC starts a new cycle when the heap has grown to roughly `2x` the live set at the end of the previous cycle (live + 100% of live).

- `GOGC=200` doubles the heap-growth allowance: more memory used, fewer cycles, lower CPU.
- `GOGC=50` halves it: less memory, more cycles, higher CPU.
- `GOGC=off` (or `SetGCPercent(-1)`) disables the heap-growth trigger entirely; only `runtime.GC()` and memory-limit pressure can trigger a cycle.

The pacer computes the trigger heap size from `GOGC` and the previous cycle's live heap. The actual trigger is set slightly below the computed goal so the cycle finishes before the heap reaches the goal (the gap absorbs allocation that happens during marking).

### 7.2 `GOMEMLIMIT`

`GOMEMLIMIT` (Go 1.19+) is a *soft* upper bound on the total memory the Go runtime will use, in bytes. Suffixes are supported: `4GiB`, `1024MiB`, etc.

Behaviour:

- As live heap + overhead approaches `GOMEMLIMIT`, the pacer aggressively lowers the heap-growth allowance, effectively overriding `GOGC` downward. In the limit, the GC can run continuously.
- The runtime never *refuses* an allocation to stay under the limit; if the program genuinely needs more memory, it will exceed the limit and the OS may OOM-kill.
- A CPU-protection limiter (`/gc/limiter/last-enabled:gc-cycle` reports activations) caps GC CPU at 50% so a program defending the limit does not livelock at 100% GC CPU. When the limiter fires, the runtime allows the heap to exceed the limit rather than starve the application.

### 7.3 Interaction

`GOGC` and `GOMEMLIMIT` are both active; the more restrictive of the two wins on any given cycle. The recommended pattern in containerised deployments is `GOMEMLIMIT=<container-mem * 0.9>` with default or higher `GOGC`: the limit defends against OOM, the ratio governs steady-state behaviour.

Setting `GOGC=off` and `GOMEMLIMIT=<bound>` is the "memory-bound" mode: the GC runs only as needed to stay under the bound. This is the recommended pattern for workloads that prefer to spend memory liberally and pay the GC cost only at the edge.

The two knobs map to different operational pressures. `GOGC` is a *throughput* knob: it answers "how much CPU am I willing to spend on GC in exchange for a smaller heap?" `GOMEMLIMIT` is a *safety* knob: it answers "what is the worst-case memory budget I have, after which OOM-kill is preferable to continuing?" Treating them as substitutes is a category error. Production deployments typically set both: `GOGC` at the value that minimises steady-state GC overhead for the workload (often 100–300), and `GOMEMLIMIT` at 90–95% of the cgroup limit to give the GC headroom to defend the bound before the OOM-killer fires.

The interaction with the CPU limiter is subtle. When `GOMEMLIMIT` is near-saturated and the GC would need to run continuously to defend it, the limiter caps GC CPU at 50%. The runtime then *intentionally* exceeds the soft limit rather than starving the application. A program that frequently exceeds `GOMEMLIMIT` and has a non-zero `/gc/limiter/last-enabled:gc-cycle` is signalling that the workload genuinely needs more memory than the limit allows; the response is to raise the limit or reduce live-set size, not to fight the runtime.

---

## 8. `MemStats` reference

`runtime.MemStats` is the legacy snapshot struct populated by `runtime.ReadMemStats`. It predates `runtime/metrics` and remains supported. The following fields are GC-relevant.

| Field | Type | Description |
|-------|------|-------------|
| `Alloc` | uint64 | Bytes of currently allocated heap objects. Same as `HeapAlloc`. |
| `TotalAlloc` | uint64 | Cumulative bytes allocated for heap objects. Monotonic; never decreases. |
| `Sys` | uint64 | Total bytes of memory obtained from the OS for all runtime needs (heap, stacks, metadata, etc.). |
| `HeapAlloc` | uint64 | Bytes of allocated heap objects (live + unswept). |
| `HeapSys` | uint64 | Bytes of heap memory obtained from the OS, including unused spans. |
| `HeapInuse` | uint64 | Bytes in in-use spans (containing at least one object). |
| `HeapIdle` | uint64 | Bytes in idle (unused) spans. `HeapIdle - HeapReleased` is memory available for reuse without OS interaction. |
| `HeapReleased` | uint64 | Bytes of physical memory returned to the OS. |
| `HeapObjects` | uint64 | Current count of allocated heap objects. |
| `StackInuse` | uint64 | Bytes used by goroutine stacks. |
| `StackSys` | uint64 | Bytes obtained from OS for goroutine stack memory. |
| `NumGC` | uint32 | Number of completed GC cycles. |
| `NumForcedGC` | uint32 | Number of cycles triggered by `runtime.GC()`. |
| `PauseTotalNs` | uint64 | Cumulative stop-the-world pause time in nanoseconds. |
| `PauseNs` | [256]uint64 | Circular buffer of recent pause durations (most recent at `(NumGC+255)%256`). |
| `PauseEnd` | [256]uint64 | Wall-clock times (ns since epoch) of recent pause endings. |
| `GCCPUFraction` | float64 | Fraction of total CPU time spent in GC since program start, between 0 and 1. |
| `LastGC` | uint64 | Wall-clock time of the last GC cycle in ns since epoch. |
| `NextGC` | uint64 | Target heap size for the next GC cycle (the goal). Mirrors `/gc/heap/goal:bytes`. |
| `BySize` | [61]struct{...} | Size-class allocation histogram: `BySize[i]` gives the count of allocations in size class `i`. |

For new code, prefer `runtime/metrics` — it does not stop the world to read, exposes more counters, and uses stable string names.

---

## 9. Authoritative source files for the GC

The GC implementation lives in `src/runtime/`. The following files together constitute the algorithm.

| File | Role |
|------|------|
| `runtime/mgc.go` | Top-level GC control: cycle start/stop, phase transitions (mark setup, mark, mark termination, sweep), interaction with the scheduler. The entry points `gcStart`, `gcMarkDone`, `gcSweep`, and `GC` (public `runtime.GC`) live here. |
| `runtime/mgcmark.go` | Mark phase: tricolour invariant maintenance, work queue (`gcWork`), mark workers, root scanning (globals, stacks, finalizer queue). |
| `runtime/mgcsweep.go` | Sweep phase: incremental sweep of mark-swept spans, lazy sweep (allocations sweep their span on demand), background sweeper goroutine. |
| `runtime/mgcpacer.go` | Pacer: feedback controller deciding when to start the next cycle and how much mark-assist credit each allocating goroutine owes. Implements the 1.21 redesigned pacer. |
| `runtime/mgcstack.go` | Stack scanning for GC: precise stack scans using compiler-emitted bitmaps; coordinates with asynchronous preemption. |
| `runtime/mgcscavenge.go` | Background and on-demand scavenger: returns unused pages to the OS via `madvise`. |
| `runtime/mfinal.go` | Finalizer queue: registration (`SetFinalizer`), running of finalizers in a dedicated goroutine. |
| `runtime/mbarrier.go` | Write barrier: the runtime entry point invoked by compiler-emitted barrier calls during the mark phase. Implements the Yuasa + Dijkstra hybrid. |
| `runtime/mbitmap.go` | Pointer bitmaps: per-object metadata identifying which words contain pointers; consulted by the mark phase to find outgoing pointers. |
| `runtime/mheap.go` | Heap layout: spans, the central span set, the heap arena map; the central `mheap` type that owns all heap memory. |
| `runtime/mspanset.go` | Span set: lock-free queue of spans used by the sweeper and by reclamation. |
| `runtime/malloc.go` | Allocation entry point: `mallocgc`, the function the compiler calls for every heap allocation. Decides size class, fetches a span, zeroes memory, registers with the GC if a cycle is in progress. |
| `runtime/mcache.go` | Per-P allocation cache: thread-local free lists for small allocations to avoid contention on the central allocator. |
| `runtime/mcentral.go` | Per-size-class central free lists: source of spans for `mcache`. |
| `runtime/mpagealloc.go` | Page-level allocator (Go 1.12 redesign): the radix-tree summary structure that locates free pages quickly. |
| `runtime/mwbbuf.go` | Write-barrier buffer: per-P buffer that batches barrier work to reduce per-store cost. |

Together these files are roughly 25,000 lines. The internal data structures (`gcWork`, `workType`, `mspan`, `arenaIdx`, `pageAlloc`) are documented in long comments at the top of each file; reading those comments is the prerequisite to reading any single function.

---

## 10. The "Getting to Go" talk by Rick Hudson

Rick Hudson's **"Getting to Go: The Journey of Go's Garbage Collector"** (ISMM 2018; blog post at `go.dev/blog/ismmkeynote`) is the closest thing to an official narrative for the GC's design.

Key claims from the talk, summarised:

- **Latency, not throughput, is the headline goal.** The Go team explicitly chose to trade some allocation-side throughput for sub-millisecond GC pauses. Servers, the dominant Go workload, value tail latency over peak allocation rate.
- **No generational GC.** The Go team experimented with generational designs (a young generation, write-barrier-based promotion) and concluded that for the Go heap shape — short-lived stack-allocated objects already filtered out by escape analysis, plus a relatively flat long-lived set — the complexity of a generational design did not pay off in measured pause time or throughput.
- **Concurrent mark, concurrent sweep, parallel mark workers.** All three are simultaneous: the marker runs alongside the application; the sweeper runs alongside the next mark phase; mark workers parallelise across `GOMAXPROCS`.
- **The pacer is a feedback controller.** The pacer continuously adjusts the trigger heap based on observed allocation rate, scan rate, and the previous cycle's overshoot. The 1.21 redesign tightened the controller; the high-level shape — measure, predict, act — is unchanged.
- **The hybrid write barrier eliminated re-scan.** This is the single biggest pause-time win across the GC's history: the change from re-scanning stacks under STW to scanning them concurrently with a barrier that captures any pointer change.
- **`GOMEMLIMIT` extends the model.** With heap-growth ratio (`GOGC`) alone, the runtime cannot defend a memory bound; the soft limit, paired with the CPU limiter, is the operational tool for containerised deployments.

The blog post is required reading before the source. The talk's slides are public; the recorded video is on YouTube.

A companion talk, **"Go GC: Latency Problem Solved"** (Rick Hudson, GopherCon 2015), narrates the 1.5 design as it was being released. The slides and video are a useful complement: the ISMM 2018 talk is retrospective and includes the 1.8 barrier change, while the 2015 talk captures the design constraints (sub-10ms pause, no generational, no compaction) at the moment they were chosen. Reading both in sequence is the fastest way to internalise *why* the GC looks the way it does, separate from *how* it works mechanically.

---

## 11. Compatibility

The Go 1 compatibility promise (`go.dev/doc/go1compat`) covers the *language* and the *public APIs of the standard library*. It does **not** cover:

- The GC algorithm. The collector can be rewritten between versions without notice; the 1.5 concurrent rewrite, the 1.8 barrier change, the 1.21 pacer redesign were all algorithmic changes that no user code "depended on" in the compatibility-promise sense.
- Pause-time numbers. Programs that depend on specific pause distributions across versions are depending on something the team does not promise.
- GC-internal tracing output. `GODEBUG=gctrace=1` lines can change format between versions; tooling that parses them must be version-aware.

The compatibility promise *does* cover:

- `runtime.GC()` triggering a synchronous cycle.
- `runtime.SetFinalizer` registering a function that eventually runs for an unreachable object.
- `runtime.KeepAlive` preventing premature collection.
- `runtime/debug.SetGCPercent` and `SetMemoryLimit` behaving per their documentation.
- `runtime.MemStats` field names and meanings (deprecated fields stay deprecated; new fields are added, never removed).
- `runtime/metrics` metric names that have been added; the documentation marks metric stability explicitly.
- The high-level invariant that unreachable memory is eventually freed without user intervention.

In short: the GC's *contract* is stable; the GC's *implementation* is not. Production code should depend only on the contract.

---

## 12. Notable design docs and proposals

| Document | Year | Topic | Location |
|----------|------|-------|----------|
| Go 1.5 Concurrent Garbage Collector Pacing | 2015 | Tricolour concurrent GC, pacer introduction | `golang/proposal` repo, `design/14951-soft-heap-limit.md` predecessor |
| Eliminate STW stack re-scanning | 2016 | Hybrid Yuasa + Dijkstra write barrier | `golang/proposal/design/17503-eliminate-rescan.md` |
| Smarter scavenging | 2018 | Page-level scavenger redesign | `golang/proposal/design/30333-smarter-scavenging.md` |
| Non-cooperative goroutine preemption | 2018 | Signal-based async preemption | proposal **24543**, `golang/proposal/design/24543-non-cooperative-preemption.md` |
| Soft memory limit | 2021 | `GOMEMLIMIT` and the CPU limiter | proposal **48409**, `golang/proposal/design/48409-soft-memory-limit.md` |
| GC pacer redesign | 2021 | Rewritten feedback controller | proposal **44167**, `golang/proposal/design/44167-gc-pacer-redesign.md` |
| Runtime/metrics | 2020 | Stable metric names for the GC and scheduler | proposal **37112**, `golang/proposal/design/37112-runtime-metrics.md` |

The `golang/proposal` repository (`github.com/golang/proposal`) is the canonical archive. Each design document is markdown; together they are the closest thing to a written specification for the GC's behaviour at each version.

Reading proposals before reading source is the right order. A proposal explains the constraints — what was wrong with the prior design, what alternatives were considered, why this approach was chosen — that the source itself does not narrate. The proposal for the 1.21 pacer redesign, for example, contains a multi-page derivation of the controller equations; the corresponding source in `runtime/mgcpacer.go` references the proposal by issue number and is otherwise terse. Without the proposal, the source reads as a sequence of magic constants; with it, the structure becomes clear.

Reading the linked discussions (the issue threads on `github.com/golang/go`) is the next layer. Acceptance discussions surface the objections that were raised and how the proposal authors answered them; this is the only place to learn which design alternatives were tried and discarded. The pacer redesign issue (44167) and the soft-memory-limit issue (48409) are both long and contain useful context that is nowhere else.

---

## 13. Reading order for source

The source is approachable but rewards a planned reading order. A first pass:

1. **`runtime/HACKING.md`** — the runtime contributor's guide; the orientation document for the directory.
2. **`runtime/mgc.go` package-level comment** — the multi-page block at the top of `mgc.go` explaining the tricolour algorithm, the hybrid barrier, and the phase machine.
3. **`runtime/mheap.go`** — the heap data structures (`mheap`, `mspan`, `arena`). Understand the layout before the algorithm.
4. **`runtime/malloc.go`, function `mallocgc`** — the allocation hot path; trace a small allocation from user code to a returned pointer.
5. **`runtime/mbarrier.go`** — the write barrier; the link between user pointer writes and the GC's work queue.
6. **`runtime/mgcmark.go`, function `gcDrain`** — the mark worker's main loop.
7. **`runtime/mgcpacer.go` package-level comment** — the pacer's controller equations. The math is involved; the comment is the spec.
8. **`runtime/mgcsweep.go`** — the sweeper, including the lazy-sweep-on-allocate interaction.
9. **`runtime/mfinal.go`** — finalizer registration and dispatch; small and self-contained.

A second pass with a specific question — "why is `GCCPUFraction` what it is on this workload?", "why did a cycle take this long?", "why is the heap goal at this number?" — should start at the relevant `mgcpacer.go` or `mgc.go` function and trace outward.

The source uses internal identifiers (`gcphase`, `work.gcWorkers`, `pacerSweepRatio`) that are not exposed publicly. Reading these requires accepting that the contract above is the user-visible surface and the source is the implementation; the two layers are intentionally separated.

A few navigational landmarks worth memorising before diving in:

- **The `work` global** in `runtime/mgc.go` is the singleton state for the in-progress cycle. Every field on `work` is touched by multiple goroutines; the file's top comment explains which fields are read-only during the cycle, which are atomic-only, and which are protected by `work.assistQueue.lock`.
- **The `gcController` global** in `runtime/mgcpacer.go` owns all pacer state. Its `revise` method is called from many places (allocator, mark worker, sweep) to recompute trigger and assist ratios; following the `revise` callers is the fastest way to understand pacer flow.
- **`heapArenas`** in `runtime/mheap.go` is the two-level map from arbitrary `uintptr` to the metadata describing the arena. Pointer classification ("is this address in the Go heap?") goes through this map; understanding it is the prerequisite for understanding the GC's root-scanning code.

Reading the source benefits enormously from a working build: clone the Go repo at the tag matching the binary in question, jump-to-definition in an editor that understands Go (gopls works on the runtime source despite its `unsafe`-heavy style), and trace specific cycles using `GODEBUG=gctrace=1,gcpacertrace=1` against a small reproducer.

---

## 14. Summary

There is no language-level specification for Go's garbage collector. What exists is a layered contract:

- The `runtime`, `runtime/debug`, and `runtime/metrics` package documentation defines the **public API**.
- The accepted proposals in `golang/proposal` define the **design intent** for each major version's behaviour.
- The "Getting to Go" talk and the long comments at the top of `runtime/mgc.go` and `runtime/mgcpacer.go` define the **algorithmic intent**.
- The source in `src/runtime/` is the **ground truth**.

The Go 1 compatibility promise covers the public API and the high-level invariants — `runtime.GC()` triggers a cycle, finalizers eventually run, unreachable memory is freed — and explicitly does not cover the algorithm, the pause numbers, or the GODEBUG trace formats. Senior Go work treats this layering correctly: depend on the contract, instrument with `runtime/metrics`, read the source when the contract is not enough, and never write code that assumes a specific algorithmic detail will hold across versions.

A practical reading agenda for engineers new to the GC, in increasing order of depth:

1. The `runtime` package godoc, plus the `runtime/debug` and `runtime/metrics` package godocs. One afternoon.
2. The "Getting to Go" blog post. Half a day.
3. The "Soft memory limit" proposal (48409) and the "GC pacer redesign" proposal (44167). One day each.
4. The package-level comment at the top of `runtime/mgc.go`. Half a day.
5. The mark loop in `runtime/mgcmark.go` (`gcDrain`, `markroot`, `scanobject`) and the pacer state machine in `runtime/mgcpacer.go` (`gcController.revise`, `endCycle`). One week.
6. The allocator hot path in `runtime/malloc.go` (`mallocgc`) and the write barrier in `runtime/mbarrier.go` (`gcWriteBarrier`). One week.

By the end of this progression an engineer has the vocabulary to read commit messages on `runtime/mgc*.go` files as they land, follow the design discussions on the golang-dev mailing list, and reason from first principles about GC behaviour in production rather than treating it as a black box. The investment compensates because the GC is the single largest source of latency variation in a Go service, and the contract above — public, stable, version-aware — is built precisely so that this investment is portable across the lifetime of the codebase.
