# `runtime` Package Deep — Specification

## 1. Scope and authority

The exported `runtime` package is the user-facing surface of the Go runtime: the goroutine scheduler, the garbage collector, the memory allocator, the stack walker, the profiler hooks, and the symbol table all expose pieces of themselves through it. The package is governed by the Go 1 compatibility promise (https://go.dev/doc/go1compat): function signatures, type definitions, and documented semantics that ship in one Go release continue to compile and behave compatibly in every subsequent Go 1.x release. The Go team is explicit, however, that *underlying behaviour* is not frozen. Scheduler timing, the exact pacing of garbage collection, the contents of `runtime.MemStats` fields, the cost of `runtime.Caller`, and the size and layout of internal goroutine state are deliberately left free to evolve. Code that depends on `runtime` should depend on the documented signatures, not on the historical timings or numeric values returned by introspection helpers.

The runtime is implemented in Go and assembly across the `src/runtime/...` tree of the Go source repository; the exported package is one slice of that tree. The other slices — `runtime/debug`, `runtime/pprof`, `runtime/trace`, `runtime/metrics`, `runtime/race`, and `runtime/cgo` — sit beside the main package and expose specialised entry points (heap dumps, profiles, execution traces, structured metrics, race-detector hooks, cgo bridges) without polluting the core API. Together these packages form the *runtime surface*: everything a Go program can call to inspect or control the machinery that hosts it.

## 2. Primary specification

The authoritative documentation is the package reference on `pkg.go.dev`:

| Package | URL |
|---------|-----|
| `runtime` | https://pkg.go.dev/runtime |
| `runtime/debug` | https://pkg.go.dev/runtime/debug |
| `runtime/pprof` | https://pkg.go.dev/runtime/pprof |
| `runtime/trace` | https://pkg.go.dev/runtime/trace |
| `runtime/metrics` | https://pkg.go.dev/runtime/metrics |
| `runtime/race` | https://pkg.go.dev/runtime/race |
| `runtime/cgo` | https://pkg.go.dev/runtime/cgo |
| `runtime/coverage` | https://pkg.go.dev/runtime/coverage |
| `runtime/msan` | https://pkg.go.dev/runtime/msan |
| `runtime/asan` | https://pkg.go.dev/runtime/asan |

The Go 1 compatibility promise: https://go.dev/doc/go1compat. The runtime environment variable reference: https://pkg.go.dev/runtime#hdr-Environment_Variables. The GODEBUG reference: https://pkg.go.dev/runtime#hdr-Environment_Variables and the dedicated GODEBUG history page https://go.dev/doc/godebug.

## 3. Public API of the `runtime` package

### 3.1 Scheduling and goroutine control

| Symbol | Purpose | Source file |
|--------|---------|-------------|
| `GOMAXPROCS(n int) int` | Sets and returns the maximum number of OS threads executing Go code simultaneously. | `runtime/debug.go` |
| `NumCPU() int` | Returns the number of logical CPUs usable by the current process. | `runtime/debug.go` |
| `NumGoroutine() int` | Returns the number of goroutines that currently exist. | `runtime/debug.go` |
| `Gosched()` | Yields the processor, allowing other goroutines to run. | `runtime/proc.go` |
| `Goexit()` | Terminates the goroutine that calls it; deferred functions run. | `runtime/panic.go` |
| `LockOSThread()` | Wires the calling goroutine to its current OS thread. | `runtime/proc.go` |
| `UnlockOSThread()` | Undoes a single `LockOSThread`. | `runtime/proc.go` |

### 3.2 Garbage collector control and introspection

| Symbol | Purpose | Source file |
|--------|---------|-------------|
| `GC()` | Runs a garbage collection and blocks until it is complete. | `runtime/mgc.go` |
| `ReadMemStats(m *MemStats)` | Populates `*m` with current memory statistics. | `runtime/mstats.go` |
| `MemStats` | Struct of memory and GC counters; see Section 11. | `runtime/mstats.go` |
| `KeepAlive(x any)` | Prevents the argument from being collected before this call. | `runtime/mfinal.go` |

### 3.3 Allocation and finalisation

| Symbol | Purpose | Source file |
|--------|---------|-------------|
| `SetFinalizer(obj, finalizer any)` | Registers a finaliser for `obj`; runs once when `obj` becomes unreachable. | `runtime/mfinal.go` |
| `AddCleanup(ptr *T, cleanup func(arg V), arg V) Cleanup` | Go 1.24+ replacement for `SetFinalizer`; multiple cleanups per object, no resurrection. | `runtime/mfinal.go` |
| `Cleanup.Stop()` | Cancels a pending cleanup before it runs. | `runtime/mfinal.go` |
| `Pinner` | Holds Go pointers across cgo calls so the GC will not move or collect them. Added in Go 1.21. | `runtime/mfinal.go` |
| `Pinner.Pin(ptr any)` | Records a pin. | `runtime/mfinal.go` |
| `Pinner.Unpin()` | Releases all pins held by this `Pinner`. | `runtime/mfinal.go` |

### 3.4 Stack introspection

| Symbol | Purpose | Source file |
|--------|---------|-------------|
| `Caller(skip int) (pc uintptr, file string, line int, ok bool)` | Returns one frame of the call stack. | `runtime/extern.go` |
| `Callers(skip int, pc []uintptr) int` | Fills `pc` with up to `len(pc)` program counters. | `runtime/extern.go` |
| `CallersFrames(callers []uintptr) *Frames` | Translates PCs into `Frame` values. | `runtime/symtab.go` |
| `Frames` / `Frames.Next() (Frame, bool)` | Iterator over inlined and physical frames. | `runtime/symtab.go` |
| `FuncForPC(pc uintptr) *Func` | Returns metadata for the function containing `pc`. | `runtime/symtab.go` |
| `Func.Name() string` / `Func.FileLine(pc) (string, int)` / `Func.Entry() uintptr` | Symbol-table accessors. | `runtime/symtab.go` |
| `Stack(buf []byte, all bool) int` | Writes a textual stack trace into `buf`. | `runtime/mprof.go` |

### 3.5 Profiling control (low-level)

These are the runtime hooks; `runtime/pprof` wraps them for normal use.

| Symbol | Purpose | Source file |
|--------|---------|-------------|
| `SetCPUProfileRate(hz int)` | Sets the CPU profiling sample rate. | `runtime/cpuprof.go` |
| `CPUProfile()` | Removed in Go 1.9; superseded by `runtime/pprof`. | historical |
| `SetBlockProfileRate(rate int)` | Controls blocking-event profiling. | `runtime/mprof.go` |
| `SetMutexProfileFraction(rate int) int` | Controls mutex-contention sampling. | `runtime/mprof.go` |
| `MemProfileRate` (var) | Average bytes between heap-profile samples; default 512 KiB. | `runtime/mprof.go` |
| `MemProfile(p []MemProfileRecord, inuseZero bool) (n int, ok bool)` | Snapshot of heap-allocation records. | `runtime/mprof.go` |
| `BlockProfile(p []BlockProfileRecord) (n int, ok bool)` | Snapshot of blocking records. | `runtime/mprof.go` |
| `MutexProfile(p []BlockProfileRecord) (n int, ok bool)` | Snapshot of mutex-contention records. | `runtime/mprof.go` |
| `GoroutineProfile(p []StackRecord) (n int, ok bool)` | Snapshot of all goroutine stacks. | `runtime/mprof.go` |
| `ThreadCreateProfile(p []StackRecord) (n int, ok bool)` | OS-thread creation records. | `runtime/mprof.go` |

### 3.6 Build and environment introspection

| Symbol | Purpose | Source file |
|--------|---------|-------------|
| `GOOS` / `GOARCH` (const) | Target operating system and architecture. | generated |
| `Version() string` | Go runtime version, e.g. `"go1.24.0"`. | `runtime/extern.go` |
| `Compiler` (const) | Always `"gc"` for the standard toolchain; `"gccgo"` for gccgo. | `runtime/extern.go` |
| `GOROOT()` | Deprecated since Go 1.20; returns the value of `$GOROOT` or the build-time root. | `runtime/extern.go` |

### 3.7 Constants and variables

| Symbol | Meaning |
|--------|---------|
| `Compiler` | `"gc"` for the standard toolchain. |
| `GOARCH` | Architecture string (`amd64`, `arm64`, `riscv64`, ...). |
| `GOOS` | OS string (`linux`, `darwin`, `windows`, ...). |
| `MemProfileRate` (mutable) | Heap-profile sample interval in bytes. |

## 4. `runtime/debug`

Source: https://pkg.go.dev/runtime/debug; implementation in `runtime/debug/...` and `runtime/mgc.go`.

| Symbol | Purpose |
|--------|---------|
| `SetGCPercent(percent int) int` | Sets the GC trigger ratio (default 100, matching `GOGC=100`); returns the previous value. `-1` disables GC. |
| `SetMemoryLimit(limit int64) int64` | Sets the soft memory limit; Go 1.19+. `-1` queries; `math.MaxInt64` disables. |
| `FreeOSMemory()` | Forces a GC and attempts to return memory to the OS. |
| `ReadGCStats(stats *GCStats)` | Fills `stats` with garbage-collection history (counts, pause times, distribution). |
| `GCStats` | Struct of GC counters: `LastGC`, `NumGC`, `PauseTotal`, `Pause`, `PauseEnd`, `PauseQuantiles`. |
| `SetTraceback(level string)` | Equivalent to `GOTRACEBACK`: `"none"`, `"single"`, `"all"`, `"system"`, `"crash"`, `"wer"`. |
| `Stack() []byte` | Returns the current goroutine's stack trace as bytes. |
| `PrintStack()` | Writes `Stack()` to standard error. |
| `BuildInfo` / `ReadBuildInfo() (*BuildInfo, bool)` | Module and build metadata embedded in the binary: main module path, version, dependency tree, VCS revision, build settings. |
| `BuildInfo.Settings` | Slice of `BuildSetting{Key, Value}`; includes `vcs.revision`, `vcs.time`, `vcs.modified`, `GOOS`, `GOARCH`, `CGO_ENABLED`, etc. |
| `SetPanicOnFault(enabled bool) bool` | Converts unexpected faults (SIGSEGV in unmapped regions) into recoverable panics. |
| `WriteHeapDump(fd uintptr)` | Writes a debug heap dump to the given file descriptor; format described in `runtime/heapdump.go`. |

## 5. `runtime/pprof`

Source: https://pkg.go.dev/runtime/pprof; implementation in `runtime/pprof/...`. The package exposes named profiles, the CPU profile writer, and the labels API.

### 5.1 Built-in profile types

| Profile name | Purpose |
|--------------|---------|
| `goroutine` | Stack traces of all currently running goroutines. |
| `heap` | Sampling of heap allocations of live objects. |
| `allocs` | Sampling of all past allocations (including freed). |
| `threadcreate` | Stack traces that led to the creation of new OS threads. |
| `block` | Stack traces that led to blocking on synchronisation primitives. |
| `mutex` | Stack traces of holders of contended mutexes. |

### 5.2 Functions

| Symbol | Purpose |
|--------|---------|
| `Lookup(name string) *Profile` | Returns the named profile. |
| `Profiles() []*Profile` | Returns all known profiles. |
| `Profile.Name() string` | Profile name. |
| `Profile.Count() int` | Current number of records. |
| `Profile.WriteTo(w io.Writer, debug int) error` | Writes the profile in pprof binary or human-readable form. |
| `Profile.Add(value any, skip int)` | Adds a record to a custom profile. |
| `Profile.Remove(value any)` | Removes a record. |
| `NewProfile(name string) *Profile` | Registers a new custom profile. |
| `StartCPUProfile(w io.Writer) error` | Begins CPU profiling. |
| `StopCPUProfile()` | Ends CPU profiling. |
| `WriteHeapProfile(w io.Writer) error` | Convenience wrapper for `Lookup("heap").WriteTo`. |
| `Do(ctx, labels, f)` | Runs `f` with `labels` attached to the calling goroutine for the duration. |
| `SetGoroutineLabels(ctx)` / `WithLabels(ctx, labels)` | Goroutine-label primitives. |
| `Labels(args ...string) LabelSet` | Builds a label set from key-value pairs. |

The pprof binary format is documented at https://github.com/google/pprof/blob/main/doc/README.md and consumed by the `go tool pprof` analyser.

## 6. `runtime/trace`

Source: https://pkg.go.dev/runtime/trace; implementation in `runtime/trace/...` and the runtime's tracing core in `runtime/trace.go` / `runtime/traceback.go`.

| Symbol | Purpose |
|--------|---------|
| `Start(w io.Writer) error` | Begins execution tracing; emits events to `w`. |
| `Stop()` | Ends tracing. |
| `IsEnabled() bool` | Reports whether tracing is currently on. |
| `NewTask(ctx, taskType) (newCtx, *Task)` | Creates a logical task spanning multiple goroutines. |
| `Task.End()` | Marks the task complete. |
| `WithRegion(ctx, regionType, f)` | Runs `f` inside a named region of the current goroutine's trace. |
| `StartRegion(ctx, regionType) *Region` | Begins a region. |
| `Region.End()` | Closes a region. |
| `Log(ctx, category, message string)` | Emits a log event tied to the current task. |
| `Logf(ctx, category, format string, args ...any)` | `printf`-style variant. |

Traces are consumed by `go tool trace`; the binary format is internal but stable across a minor-version range. The Go 1.21 release rewrote the trace implementation (https://go.dev/blog/execution-traces-2024) for lower overhead and concurrent reader support.

## 7. `runtime/metrics`

Introduced in Go 1.16 as the long-term replacement for `runtime.MemStats`. Source: https://pkg.go.dev/runtime/metrics; design document https://go.googlesource.com/proposal/+/refs/heads/master/design/37112-runtime-metrics.md.

| Symbol | Purpose |
|--------|---------|
| `All() []Description` | Returns descriptions of every supported metric. |
| `Description` | Metric metadata: `Name`, `Description`, `Kind`, `Cumulative`. |
| `Sample` | `Name string; Value Value` — a request/response pair for `Read`. |
| `Value` | Tagged union: `Uint64`, `Float64`, `Float64Histogram`, `Bad`. |
| `Read(samples []Sample)` | Fills each `samples[i].Value` for the metric named in `samples[i].Name`. |

Metric naming convention: `/path/to/metric:unit` (for example `/gc/heap/allocs:bytes`, `/sched/goroutines:goroutines`, `/sync/mutex/wait/total:seconds`). New metrics may be added in any minor release; existing names and kinds are stable. The set of metrics in Go 1.22 is listed at https://pkg.go.dev/runtime/metrics#hdr-Supported_metrics; in practice the canonical enumeration is what `runtime/metrics.All()` returns at runtime.

| Categories of metrics |
|---|
| `/gc/...` — heap goal, cycles, pause times, scan work, stack scan bytes. |
| `/sched/...` — goroutine counts, runnable/running time, preemptions, latency histograms. |
| `/memory/...` — classes (heap, stack, OS, mspan, mcache, profiling buckets, other). |
| `/cpu/...` — total/user/idle/gc/scavenge classes; Go 1.20+. |
| `/sync/mutex/...` — mutex wait time. |
| `/cgo/...` — cgo call counts. |
| `/godebug/non-default-behavior/...` — counts of GODEBUG-mediated behaviour changes. |

## 8. `runtime/race`

Source: https://pkg.go.dev/runtime/race. The package is empty unless the binary is built with `-race`; the linker swaps in the race-detector runtime which is implemented on top of ThreadSanitizer (TSan, https://github.com/google/sanitizers/wiki/ThreadSanitizerCppManual).

| Symbol | Purpose |
|--------|---------|
| `Enabled` (compile-time) | True when the race build flag is in effect. |
| `Acquire(addr unsafe.Pointer)` | Tells the race detector "this address has been acquired". |
| `Release(addr unsafe.Pointer)` | Pairs with `Acquire`; releases the happens-before edge. |
| `ReleaseMerge(addr unsafe.Pointer)` | Combines all prior releases on `addr` into a single edge. |
| `Disable()` / `Enable()` | Suspend and resume race-detector instrumentation in the current goroutine. |
| `Read(addr unsafe.Pointer)` / `Write(addr unsafe.Pointer)` | Manual instrumentation hooks. |
| `ReadRange(addr unsafe.Pointer, len int)` / `WriteRange(...)` | Range variants. |
| `Errors() int` | Number of race reports seen so far. |

Normal code does not call these; standard library primitives (`sync.Mutex`, channels, `atomic`) are already instrumented. The hooks exist for libraries that implement their own synchronisation in `unsafe` code (notably the runtime itself and a handful of database drivers).

## 9. `runtime/cgo`

Source: https://pkg.go.dev/runtime/cgo. The package is a bridge between Go and C: it is imported automatically by code that uses `import "C"`, and is rarely useful as a direct import.

| Symbol | Purpose |
|--------|---------|
| `Handle` | An opaque integer that represents a Go value, safe to pass to C and back. |
| `NewHandle(v any) Handle` | Stores `v` and returns a handle. |
| `Handle.Value() any` | Recovers the stored value. |
| `Handle.Delete()` | Releases the handle. |
| `Incomplete` | Marker type used by cgo-generated code for forward declarations. |

The cgo bridge itself — the calling convention, the goroutine-thread interaction, the rules for passing pointers across the boundary — is documented at https://pkg.go.dev/cmd/cgo. `runtime/cgo` is the runtime-side companion; the user-facing entry point is the special `"C"` pseudo-import.

## 10. `runtime/coverage`

Added in Go 1.20 (https://go.dev/doc/go1.20#cover). Source: https://pkg.go.dev/runtime/coverage.

| Symbol | Purpose |
|--------|---------|
| `WriteCounters(w io.Writer) error` | Writes coverage counter data for the running program. |
| `WriteMeta(w io.Writer) error` | Writes coverage meta-data. |
| `WriteCountersDir(dir string) error` | Writes counters to a directory. |
| `WriteMetaDir(dir string) error` | Writes meta-data to a directory. |
| `ClearCounters() error` | Resets the counter set. |

Used by long-running services that want to emit incremental coverage data without exiting.

## 11. `MemStats` reference

`ReadMemStats(*MemStats)` populates the following fields. Field semantics are not promised stable; the field names and types are. The struct lives in `runtime/mstats.go`.

| Field | Meaning |
|-------|---------|
| `Alloc` | Bytes of allocated heap objects (live). |
| `TotalAlloc` | Cumulative bytes allocated for heap objects since program start. |
| `Sys` | Total bytes obtained from the OS. |
| `Lookups` | Number of pointer lookups by the runtime (mostly debugging). |
| `Mallocs` | Cumulative count of heap objects allocated. |
| `Frees` | Cumulative count of heap objects freed. |
| `HeapAlloc` | Bytes of allocated heap objects (same as `Alloc`). |
| `HeapSys` | Bytes of heap memory obtained from the OS. |
| `HeapIdle` | Bytes in idle (unused) spans. |
| `HeapInuse` | Bytes in in-use spans. |
| `HeapReleased` | Bytes of physical memory returned to the OS. |
| `HeapObjects` | Number of live heap objects. |
| `StackInuse` | Bytes in stack spans. |
| `StackSys` | Bytes obtained from the OS for stack spans. |
| `MSpanInuse` / `MSpanSys` | Span metadata bookkeeping. |
| `MCacheInuse` / `MCacheSys` | Per-P allocator cache bookkeeping. |
| `BuckHashSys` | Profiling bucket hash table. |
| `GCSys` | GC metadata. |
| `OtherSys` | Miscellaneous off-heap runtime allocations. |
| `NextGC` | Target heap size for the next GC, in bytes. |
| `LastGC` | Unix-nanosecond timestamp of last GC. |
| `PauseTotalNs` | Cumulative nanoseconds in GC stop-the-world pauses. |
| `PauseNs[256]` | Circular buffer of recent pause durations. |
| `PauseEnd[256]` | Circular buffer of pause-end timestamps. |
| `NumGC` | Number of completed GC cycles. |
| `NumForcedGC` | Number of GCs invoked by `runtime.GC`. |
| `GCCPUFraction` | Fraction of CPU time used by the GC since process start. |
| `EnableGC` | Always true; the field is historical. |
| `DebugGC` | Always false; the field is historical. |
| `BySize[61]` | Histogram of allocations by size class. |

The Go 1.16+ replacement is `runtime/metrics`, which exposes the same information with named, stable metric IDs and unit suffixes. New work should use `runtime/metrics`; `MemStats` remains for compatibility.

## 12. GODEBUG knobs affecting `runtime`

GODEBUG is a comma-separated list of `name=value` pairs read at process start. The full reference: https://pkg.go.dev/runtime#hdr-Environment_Variables and https://go.dev/doc/godebug.

| Knob | Effect |
|------|--------|
| `allocfreetrace=1` | Logs every allocation and free with stack traces; extremely verbose. |
| `clobberfree=1` | Overwrites freed memory with a recognisable pattern to catch use-after-free. |
| `cgocheck=0|1|2` | Cgo pointer-passing rule checks (Go 1.21+ default 1). |
| `gccheckmark=1` | Re-runs mark phase in stop-the-world for GC correctness checks. |
| `gcpacertrace=1` | Logs GC pacer state every cycle. |
| `gctrace=1` | One line per GC cycle to stderr with sizes and pause times. |
| `inittrace=1` | Logs per-package init durations. |
| `madvdontneed=0|1` | Selects `MADV_DONTNEED` vs `MADV_FREE` on Linux (default 0 since Go 1.16; defaults differ by kernel). |
| `memprofilerate=N` | Overrides the heap-profile sampling rate. |
| `panicnil=1` | Reverts the Go 1.21 change that made `panic(nil)` a runtime error; opt-in legacy behaviour. |
| `schedtrace=N` | Every N ms prints scheduler state to stderr. |
| `scheddetail=1` | Combined with `schedtrace`, prints per-P, per-M, per-G detail. |
| `tracebackancestors=N` | Includes up to N ancestor goroutine stacks in tracebacks of newly created goroutines. |
| `asyncpreemptoff=1` | Disables signal-driven preemption. |
| `dontfreezetheworld=1` | Internal; do not freeze on fatal panic. |
| `efence=1` | Allocator electric fence; isolates each object on its own page. |
| `gcstoptheworld=1|2` | Disables concurrent GC for debugging. |
| `runtimecontentionstacks=1` | Records contention stacks for mutex profile. |

The set of knobs has grown across releases; new knobs land regularly and old ones are retired as the behaviours they gate become defaults.

## 13. Environment variables

| Variable | Purpose |
|----------|---------|
| `GOMAXPROCS` | Maximum simultaneous OS threads running Go code; default = `runtime.NumCPU()`. |
| `GOGC` | GC trigger as a percentage of live heap; default 100; `off` disables GC. |
| `GOMEMLIMIT` | Soft memory limit; supports SI suffixes (`KiB`, `MiB`, `GiB`); Go 1.19+. |
| `GOTRACEBACK` | Verbosity of crash tracebacks: `none`, `single` (default), `all`, `system`, `crash`, `wer`. |
| `GODEBUG` | Knobs above; comma-separated `name=value`. |
| `GOROOT` | Directory of the Go installation; consulted at runtime only by deprecated `runtime.GOROOT`. |
| `GOOS` / `GOARCH` | Build-time constants exposed at runtime; not generally settable for a running binary. |
| `GOEXPERIMENT` | Build-time toggles for in-development runtime features; consulted by the compiler and the runtime. |

## 14. Source file map

The runtime is in `src/runtime` in the Go source tree (https://github.com/golang/go/tree/master/src/runtime). The exported `runtime` package's user-facing entry points are spread across these files:

| File | Contents |
|------|----------|
| `runtime/extern.go` | `Version`, `GOROOT`, `Caller`, `Callers`, `Compiler`, `GOOS`, `GOARCH` declarations. |
| `runtime/mfinal.go` | `SetFinalizer`, `KeepAlive`, `AddCleanup`, `Pinner`. |
| `runtime/symtab.go` | `FuncForPC`, `Func`, `Frames`, `CallersFrames`. |
| `runtime/debug.go` | `GOMAXPROCS`, `NumCPU`, `NumCgoCall`, `NumGoroutine`. |
| `runtime/mprof.go` | `Stack`, `MemProfile`, `BlockProfile`, `MutexProfile`, `GoroutineProfile`, `ThreadCreateProfile`, `SetBlockProfileRate`, `SetMutexProfileFraction`. |
| `runtime/cpuprof.go` | `SetCPUProfileRate`, internal CPU-profile machinery. |
| `runtime/mgc.go` | `GC`, GC pacer, mark/sweep coordination. |
| `runtime/mstats.go` | `MemStats`, `ReadMemStats`. |
| `runtime/proc.go` | `Gosched`, `Goexit`, `LockOSThread`, `UnlockOSThread`, scheduler core. |
| `runtime/panic.go` | `Goexit`, panic/recover machinery. |
| `runtime/metrics.go` | Bindings to `runtime/metrics`. |
| `runtime/metrics/...` | The `runtime/metrics` package itself. |
| `runtime/pprof/...` | The `runtime/pprof` package, profile writers, labels API. |
| `runtime/trace/...` | The `runtime/trace` package and Go-side trace API. |
| `runtime/debug/...` | The `runtime/debug` package (`GCStats`, `BuildInfo`, `SetGCPercent`, `SetMemoryLimit`, ...). |
| `runtime/race/...` | The race-detector glue (only linked under `-race`). |
| `runtime/cgo/...` | The cgo bridge (`Handle`, callbacks). |

## 15. Compatibility

Go 1 compatibility (https://go.dev/doc/go1compat) covers:

- The set of exported identifiers in `runtime`, `runtime/debug`, `runtime/pprof`, `runtime/trace`, `runtime/metrics`, `runtime/race`, `runtime/cgo`. New identifiers may be added; existing ones do not disappear or change signature.
- The documented semantics of each function as written in the package documentation at the time it was released. Where the doc says "may", "should", "approximately", or names a default that "may change", that text is the boundary of the promise.
- The names and types of `MemStats` fields and `GCStats` fields.
- The named profile types in `runtime/pprof` (`heap`, `goroutine`, `block`, `mutex`, `threadcreate`, `allocs`).
- The on-disk format of pprof profiles and execution traces, at the level of "consumable by `go tool pprof` and `go tool trace` of the same minor version or newer".

What the promise explicitly does **not** cover:

- The exact numeric values returned by `MemStats` fields under any given workload; the GC pacer, allocator, and span layout evolve every release.
- The exact ordering and timing of finaliser execution, scheduling, and goroutine preemption.
- The exact contents of stack traces emitted by `Stack` and `PrintStack`; new lines may appear, formatting may change, the runtime may inline or de-inline frames.
- The exact set of `runtime/metrics` names; new names appear regularly, deprecated names remain available but may become aliases.
- The exact behaviour of GODEBUG knobs; knobs are added, removed, and have their defaults flipped across releases (the `godebug` history page records the changes).
- Performance characteristics: a function's signature does not promise it will be as cheap as it was in the previous release.

## 16. Notable proposals and releases

| Feature | Release | Proposal / link |
|---------|---------|------------------|
| `runtime/metrics` package | Go 1.16 | https://github.com/golang/go/issues/37112 |
| Soft memory limit `GOMEMLIMIT` and `debug.SetMemoryLimit` | Go 1.19 | https://github.com/golang/go/issues/48409 |
| `runtime.Pinner` for cgo | Go 1.21 | https://github.com/golang/go/issues/46787 |
| `runtime/trace` v2 (low-overhead, concurrent readers) | Go 1.21–1.22 | https://go.dev/blog/execution-traces-2024 |
| `runtime.AddCleanup` (finaliser replacement) | Go 1.24 | https://github.com/golang/go/issues/67535 |
| `GODEBUG` history mechanism | Go 1.21 | https://go.dev/doc/godebug |
| Coverage profiling at runtime (`runtime/coverage`) | Go 1.20 | https://go.dev/doc/go1.20#cover |
| `runtime/race` standardisation | Go 1.1+ | https://go.dev/blog/race-detector |
| `runtime/debug.BuildInfo` with VCS settings | Go 1.18 | https://github.com/golang/go/issues/50603 |
| Mutex contention profile | Go 1.8 | https://go.dev/doc/go1.8#mutex |
| `panic(nil)` becomes runtime error (GODEBUG `panicnil=1` to opt out) | Go 1.21 | https://go.dev/doc/go1.21#runtime |

## 17. Bug reporting

The runtime is tracked in the main Go issue tracker at https://github.com/golang/go/issues. Issues affecting the runtime carry the `runtime` label (https://github.com/golang/go/labels/compiler%2Fruntime and https://github.com/golang/go/labels/runtime). Profile and trace issues frequently also carry `pprof` or `Performance`. Reports should include:

- `go version` output.
- `GOOS`, `GOARCH`, container/VM details if relevant.
- The GODEBUG setting and any non-default `GOGC` / `GOMAXPROCS` / `GOMEMLIMIT`.
- A minimum reproducer; if the bug is a crash, the full traceback with `GOTRACEBACK=all` or `GOTRACEBACK=crash`.
- For GC or scheduler regressions: a `go tool trace` capture and `runtime/metrics` snapshot or `GODEBUG=gctrace=1,schedtrace=1000` output covering the regression window.

Security-sensitive issues go to security@golang.org rather than the public tracker; the process is described at https://go.dev/security/policy.

---

The `runtime` package is the small, stable, hand-curated public window into a large and deliberately fluid implementation. Its API is governed by the Go 1 promise; its behaviour is governed only by the documented contract. Senior use comes from knowing exactly where that boundary sits — which fields of `MemStats` are load-bearing, which `runtime/metrics` names are new in this release, which GODEBUG knobs have flipped defaults, which proposals are accepted but not yet shipped — and from preferring `runtime/metrics` for telemetry, `runtime/pprof` for profiling, `runtime/trace` for causality analysis, and `runtime/debug.BuildInfo` for binary provenance over reaching into raw `runtime` introspection.
