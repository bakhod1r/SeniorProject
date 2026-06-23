# Runtime Goroutine Management — Specification

This file collects the documented signatures, semantics, and guarantees for each runtime API discussed in this subsection. It is a reference, not a tutorial. Quoted text is paraphrased from the Go standard-library documentation (Go 1.22+). Verify behaviour against your target Go version.

---

## Table of Contents
1. [Package `runtime`](#package-runtime)
2. [Package `runtime/debug`](#package-runtimedebug)
3. [Package `runtime/pprof`](#package-runtimepprof)
4. [Package `runtime/trace`](#package-runtimetrace)
5. [Package `runtime/metrics`](#package-runtimemetrics)
6. [Environment Variables](#environment-variables)
7. [Defaults Table](#defaults-table)

---

## Package `runtime`

### `func NumGoroutine() int`

Returns the number of goroutines that currently exist. The count includes the main goroutine, user-spawned goroutines, and runtime-internal goroutines (GC workers, finalizer goroutine, optional trace goroutine).

Concurrency: safe to call from any goroutine. Cost: O(1) atomic read.

### `func NumCPU() int`

Returns the number of logical CPUs usable by the current process. The set of available CPUs is determined at program startup and is not updated for process affinity changes during execution.

### `func GOMAXPROCS(n int) int`

Sets the maximum number of CPUs that can execute Go code simultaneously and returns the previous setting. If `n < 1`, it does not change the current setting.

When `n` differs from the current value, the runtime stops the world to resize the P array.

### `func Gosched()`

Yields the processor, allowing other goroutines to run. It does not suspend the current goroutine; execution resumes automatically.

The yielding goroutine is placed on the global runqueue, making it available for any P to pick up.

### `func Goexit()`

Terminates the goroutine that calls it. No other goroutine is affected. `Goexit` runs all deferred calls before terminating the goroutine. Because `Goexit` is not a panic, any deferred `recover()` calls in those deferred functions will return `nil`.

Calling `Goexit` from the main goroutine terminates that goroutine without `main` returning. Because `main` has not returned, the program continues execution of other goroutines. If all other goroutines exit, the program crashes.

### `func LockOSThread()`

Wires the calling goroutine to its current operating-system thread. The goroutine will always execute on that thread, and no other goroutine will execute on it, until the calling goroutine calls `UnlockOSThread` the same number of times. If the calling goroutine exits without unlocking, the thread will be terminated.

All `init` functions in a Go program run on the main goroutine, which is also the first goroutine to which `LockOSThread` is automatically applied when `init` runs.

`LockOSThread` is re-entrant since Go 1.10. Lock and unlock counts must match.

### `func UnlockOSThread()`

Undoes one call to `LockOSThread`. Calls in excess of `LockOSThread` calls are silently ignored.

### `func Stack(buf []byte, all bool) int`

Formats a stack trace of the calling goroutine into `buf` and returns the number of bytes written. If `all` is true, formats stack traces of all other goroutines into `buf` after the trace of the current goroutine.

When `all=true` the runtime stops the world for the duration of the call.

### `func SetFinalizer(obj any, finalizer any)`

Sets the finalizer associated with `obj` to the provided function. When the garbage collector finds an unreachable block with a finalizer, it clears the association and runs `finalizer(obj)` in a separate goroutine. The block is reclaimed only on the next GC cycle.

Requirements:
- `obj` must be a non-nil pointer or `unsafe.Pointer`.
- `obj` must have been allocated by Go (e.g. `new`, `make`, composite literal). Setting finalizers on stack-allocated or non-Go-allocated pointers is undefined behaviour.
- `finalizer` must be a function whose first parameter is assignable from the type of `obj`, or `nil`.

To remove a finalizer, call `SetFinalizer(obj, nil)`.

A finalizer is not guaranteed to run. The runtime may skip them at program exit. Order of finalization is unspecified.

### `func SetMutexProfileFraction(rate int) int`

Controls the fraction of mutex contention events that are reported in the mutex profile. On average, one event per `rate` is reported. Setting `rate = 0` turns off profiling. The previous rate is returned. Cost: each contention event probabilistically samples; lower rate = higher sampling = higher overhead.

### `func SetBlockProfileFraction(rate int) int`

Controls the fraction of goroutine blocking events that are reported. A blocking event is reported with probability proportional to `blocked-time / rate` (in nanoseconds). Setting `rate = 0` turns off profiling. Setting `rate = 1` records every event.

### `func GC()`

Runs a garbage collection and blocks the caller until the collection is complete. May also block the entire program.

Use only in tests, benchmarks, or rare circumstances where you can prove a forced GC is necessary.

### `func SetCgoTraceback(version int, traceback, context, symbolizer unsafe.Pointer)`

Registers callbacks the runtime uses to construct stack traces that include C frames. `version` must be `0` in current Go.

---

## Package `runtime/debug`

### `func Stack() []byte`

Returns a formatted stack trace of the calling goroutine. Equivalent to `runtime.Stack(buf, false)` with sufficient buffer.

### `func PrintStack()`

Prints a formatted stack trace of the calling goroutine to standard error.

### `func SetGCPercent(percent int) int`

Sets the garbage collection target percentage. A collection is triggered when the ratio of newly allocated data to live data at the previous collection reaches this percentage. The previous setting is returned.

`SetGCPercent(-1)` disables garbage collection (except via the memory limit). Returns the previous percent. Cost: takes effect at next allocation.

### `func SetMemoryLimit(limit int64) int64`

(Added in Go 1.19.) Provides a soft memory limit for the runtime. The runtime undertakes whatever measures it can to keep memory usage under this limit, including running garbage collection more frequently and returning memory to the OS more aggressively.

A negative `limit` is taken to mean "no change." The previous value is returned. `SetMemoryLimit(math.MaxInt64)` effectively removes the limit.

The limit is a target, not a guarantee. The runtime will not stop user code mid-allocation to enforce it.

### `func SetMaxStack(bytes int) int`

Sets the maximum amount of memory that can be used by a single goroutine stack. If any goroutine exceeds this limit while growing its stack, the program crashes.

Default: ~1 GB on 64-bit, ~250 MB on 32-bit. Useful for crashing earlier on infinite recursion.

### `func SetMaxThreads(threads int) int`

Sets the maximum number of operating system threads the Go program can use. If exceeded, the program crashes by calling `exit(2)`.

Default: 10 000. Set lower as a safety net against thread-creation storms (cgo, syscall surges).

### `func SetTraceback(level string)`

Sets the amount of detail printed by the runtime on a fatal panic or unhandled signal. Valid levels (most to least verbose): `crash`, `system`, `all`, `single`, `none`. Default is `single`.

Equivalent to the `GOTRACEBACK` environment variable.

### `func SetPanicOnFault(enabled bool) bool`

Controls the runtime's behaviour when a program faults at an unexpected (non-nil) address. Such faults are normally unrecoverable. With `SetPanicOnFault(true)`, they become recoverable via `recover()` in the goroutine that faulted. Used by `mmap` users who want to handle SIGSEGV gracefully.

### `func FreeOSMemory()`

Forces a garbage collection followed by an attempt to return as much memory as possible to the operating system. Even if not called, the runtime gradually returns memory to the OS in the background.

### `func ReadGCStats(stats *GCStats)`

Reads statistics about recent garbage collections into `*stats`. Includes pause times, number of cycles, and other historical data.

---

## Package `runtime/pprof`

### `type LabelSet`

An opaque set of label key/value pairs. Constructed via `pprof.Labels`.

### `func Labels(args ...string) LabelSet`

Returns a `LabelSet` with the provided key/value pairs. Panics if called with an odd number of arguments.

### `func WithLabels(ctx context.Context, labels LabelSet) context.Context`

Returns a context derived from `ctx` with the labels added. Labels from `ctx` are merged with `labels`; conflicting keys are overwritten.

### `func SetGoroutineLabels(ctx context.Context)`

Sets the labels of the current goroutine to those in `ctx`. The previous labels are replaced, not merged.

### `func Do(ctx context.Context, labels LabelSet, f func(context.Context))`

Calls `f` with a context derived from `ctx` and the merged labels. Sets the calling goroutine's labels for the duration of `f`'s execution, then restores them.

### `func ForLabels(ctx context.Context, f func(key, value string) bool)`

Invokes `f` for each label in `ctx`. Stops if `f` returns false.

### `func Lookup(name string) *Profile`

Returns the named profile (`"goroutine"`, `"heap"`, `"allocs"`, `"threadcreate"`, `"block"`, `"mutex"`).

### `func StartCPUProfile(w io.Writer) error`

Starts CPU profiling, writing samples to `w`. Returns an error if profiling is already active.

### `func StopCPUProfile()`

Stops CPU profiling. Must be called before the program exits to flush remaining samples.

---

## Package `runtime/trace`

### `func Start(w io.Writer) error`

Begins recording trace events to `w`. Returns an error if a trace is already in progress.

### `func Stop()`

Stops the current trace.

### `func NewTask(ctx context.Context, taskType string) (context.Context, *Task)`

Creates a logical task. The returned context carries the task. Call `task.End()` when the task completes.

### `func WithRegion(ctx context.Context, regionType string, f func())`

Marks a section of code as a "region" within a task. Useful for breaking down task latency.

### `func Log(ctx context.Context, category, message string)`

Emits a log message in the trace.

### `func IsEnabled() bool`

Reports whether tracing is currently active.

---

## Package `runtime/metrics`

### `type Description`

Describes a metric: its name, a textual description, its kind, and whether it is cumulative.

### `type Sample`

A `Sample` is a (name, value) pair. The caller sets `Name`; the runtime fills `Value` on `Read`.

### `type Value`

A tagged union. Methods: `Kind() ValueKind`, `Uint64() uint64`, `Float64() float64`, `Float64Histogram() *Float64Histogram`.

`ValueKind` is one of `KindBad`, `KindUint64`, `KindFloat64`, `KindFloat64Histogram`.

### `type Float64Histogram`

Has `Counts []uint64` and `Buckets []float64`. The `i`th bucket has count `Counts[i]` and range `[Buckets[i], Buckets[i+1])`.

### `func All() []Description`

Returns descriptions of all metrics exported by the running Go version.

### `func Read(samples []Sample)`

Populates each `samples[i].Value` with the current value of the named metric.

### Standard metric names (selected)

- `/sched/goroutines:goroutines` — count of live goroutines.
- `/sched/latencies:seconds` — histogram of scheduler latencies.
- `/memory/classes/heap/objects:bytes` — live heap.
- `/memory/classes/heap/free:bytes` — free heap memory.
- `/memory/classes/total:bytes` — total memory the runtime accounts for.
- `/gc/pauses:seconds` — histogram of GC STW pause durations.
- `/gc/cycles/total:gc-cycles` — total completed GC cycles.
- `/gc/heap/allocs:bytes` — cumulative bytes allocated.
- `/cpu/classes/gc/total:cpu-seconds` — cumulative GC CPU time.
- `/cpu/classes/user/total:cpu-seconds` — cumulative user-code CPU time.

The full set is discovered at runtime via `metrics.All()`.

---

## Environment Variables

| Variable | Effect |
|---|---|
| `GOMAXPROCS` | Initial `GOMAXPROCS` value. |
| `GOGC` | Initial `GOGC` value. Default `100`. `off` disables GC. |
| `GOMEMLIMIT` | Initial memory limit. Default `math.MaxInt64`. Accepts suffixes: `MiB`, `GiB`, etc. |
| `GOTRACEBACK` | Verbosity of panic stack dumps. `none`, `single`, `all`, `system`, `crash`. |
| `GODEBUG` | Runtime debug knobs. See [GODEBUG runtime](https://pkg.go.dev/runtime#hdr-Environment_Variables) for the full catalog. |
| `GOROOT`, `GOPATH`, `GOPROXY`, etc. | Build/runtime, not directly scheduler-related. |

---

## Defaults Table

| Setting | Default |
|---|---|
| `GOMAXPROCS` (pre-1.25) | `runtime.NumCPU()` |
| `GOMAXPROCS` (1.25+) | `max(1, ceil(cpu_quota))` if container, else `NumCPU()` |
| `GOGC` | 100 |
| `GOMEMLIMIT` | `math.MaxInt64` (no limit) |
| `GOTRACEBACK` | `single` |
| `debug.SetMaxStack` | 1 GB on 64-bit, 250 MB on 32-bit |
| `debug.SetMaxThreads` | 10 000 |
| `SetMutexProfileFraction` | 0 (off) |
| `SetBlockProfileFraction` | 0 (off) |
| Memory profile sampling rate | 1 sample per 512 KB allocated |
| CPU profile sampling rate | 100 Hz per OS thread |
| GC CPU usage cap | ~25% per CPU |

---

## Guarantees and Non-Guarantees

### Guaranteed

- `NumGoroutine` returns at least 1 while any Go code is running.
- `Goexit` runs all deferred functions before terminating its goroutine.
- A `LockOSThread`-locked goroutine that exits causes its OS thread to be destroyed (so thread-local state is not reused).
- `SetMemoryLimit` and `SetGCPercent` return the previous value.
- `runtime/metrics` metric names and units are stable within a major Go version.

### Not Guaranteed

- The exact thread/goroutine count under load.
- The latency of `Gosched` (depends on runqueue state).
- The order in which finalizers run.
- That finalizers run at all before program exit.
- The exact format of stack trace strings (may change between versions).
- The cost of `SetMemoryLimit` in micro-pauses (depends on heap state).
- Default values for environment variables — subject to change between Go versions.
