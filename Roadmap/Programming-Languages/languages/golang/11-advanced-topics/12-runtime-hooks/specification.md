# Runtime Hooks — Specification

> **Focus:** Precise reference for the public Go APIs that observe, instrument, or influence the runtime — the `runtime`, `runtime/debug`, `runtime/metrics`, `runtime/pprof`, and `runtime/trace` packages, plus the `GODEBUG` environment knobs they cooperate with.
>
> **Sources:**
> - `runtime`: https://pkg.go.dev/runtime
> - `runtime/debug`: https://pkg.go.dev/runtime/debug
> - `runtime/metrics`: https://pkg.go.dev/runtime/metrics
> - `runtime/pprof`: https://pkg.go.dev/runtime/pprof
> - `runtime/trace`: https://pkg.go.dev/runtime/trace
> - GODEBUG reference: https://pkg.go.dev/runtime#hdr-Environment_Variables

---

## 1. What a "runtime hook" is

A runtime hook is any API that lets a Go program inspect or change a property of the runtime — scheduler, garbage collector, finalizer queue, profiler, tracer, or crash machinery — at runtime. They are distinct from compile-time knobs (`-gcflags`, `-ldflags`) and from external tools (`go tool pprof`, `dlv`). Most hooks live in five packages:

| Package | What it covers |
|---------|----------------|
| `runtime` | Scheduler, goroutines, stacks, finalizers, low-level introspection |
| `runtime/debug` | GC/memory tuning, panic & crash control, build info |
| `runtime/metrics` | The modern, versioned metric stream replacing `MemStats` reads |
| `runtime/pprof` | Programmatic capture of CPU, heap, goroutine, block, mutex profiles |
| `runtime/trace` | Programmatic capture of execution traces |

`GODEBUG` is the environment-side counterpart: a comma-separated key/value list read by the runtime at startup and (for some keys) on `debug.SetGCPercent`-style updates.

---

## 2. `runtime` package — scheduler & introspection

| Function | Signature | Purpose | Notes |
|----------|-----------|---------|-------|
| `GOMAXPROCS` | `func GOMAXPROCS(n int) int` | Set / get max OS threads executing Go code | Returns previous; `n <= 0` reports current without changing |
| `NumCPU` | `func NumCPU() int` | Logical CPUs visible to the process | Honors cgroup CPU quotas on Linux from Go 1.25+ |
| `NumGoroutine` | `func NumGoroutine() int` | Count of currently existing goroutines | Includes system goroutines |
| `Gosched` | `func Gosched()` | Yield current P to scheduler | Rarely needed; not a sleep |
| `Goexit` | `func Goexit()` | Terminate the calling goroutine after running deferreds | Crashes the process if called on the main goroutine after others exit |
| `GC` | `func GC()` | Force a blocking GC cycle | For tests/benchmarks; not for production routines |
| `LockOSThread` | `func LockOSThread()` | Bind goroutine to its current OS thread | Required for GUI, OpenGL, locale-sensitive C libs |
| `UnlockOSThread` | `func UnlockOSThread()` | Release one binding | Calls nest; thread released only on full unwind |
| `Caller` | `func Caller(skip int) (pc uintptr, file string, line int, ok bool)` | Single-frame stack lookup | `skip=0` is the caller of `Caller` |
| `Callers` | `func Callers(skip int, pc []uintptr) int` | Fill a slice with PCs | Pair with `CallersFrames` to symbolize |
| `CallersFrames` | `func CallersFrames(callers []uintptr) *Frames` | Resolve PCs to symbol info | Lazy; pull with `Next` |
| `Stack` | `func Stack(buf []byte, all bool) int` | Dump the current goroutine's stack (or all goroutines) | `all=true` triggers a brief STW |
| `SetFinalizer` | `func SetFinalizer(obj, finalizer any)` | Register a function to run after `obj` becomes unreachable | One finalizer per object; resurrects |
| `KeepAlive` | `func KeepAlive(x any)` | Ensure `x` is not collected before this point | Required at cgo boundaries |
| `AddCleanup` (1.24+) | `func AddCleanup[T,S any](ptr *T, cleanup func(S), arg S) Cleanup` | Modern finalizer replacement | No resurrection; multiple cleanups allowed; safer than `SetFinalizer` |
| `ReadMemStats` | `func ReadMemStats(m *MemStats)` | Snapshot of all heap/GC counters | Stops the world; prefer `runtime/metrics` for monitoring |
| `MemProfileRate` | `int` | Sampling interval (bytes) for the heap profile | Default 512 KiB; set to 1 for precise, 0 to disable |
| `SetBlockProfileRate` | `func SetBlockProfileRate(rate int)` | Sampling for block events | `rate` is approx. ns/block; 0 disables |
| `SetMutexProfileFraction` | `func SetMutexProfileFraction(rate int) int` | Sampling for mutex contention | 1-in-N sampling |
| `SetCPUProfileRate` | `func SetCPUProfileRate(hz int)` | Sampling rate for CPU profile | Default 100 Hz; usually set via `pprof.StartCPUProfile` |
| `Version` | `func Version() string` | Runtime/compiler version string | e.g., `go1.24.1` |
| `GOOS`, `GOARCH` | `string` (consts) | Target platform identifiers | |

---

## 3. `runtime/debug` — tuning, panic, crash, build info

| Function | Signature | Version | Purpose |
|----------|-----------|---------|---------|
| `SetGCPercent` | `func SetGCPercent(percent int) int` | all | Equivalent to `GOGC`; returns previous value; `-1` disables |
| `SetMemoryLimit` | `func SetMemoryLimit(limit int64) int64` | 1.19+ | Soft cap on total runtime memory in bytes; `-1` reports current |
| `SetMaxStack` | `func SetMaxStack(bytes int) int` | all | Per-goroutine stack ceiling; panic on overflow |
| `SetMaxThreads` | `func SetMaxThreads(threads int) int` | all | Hard cap on OS threads; runtime panics if exceeded |
| `SetPanicOnFault` | `func SetPanicOnFault(enabled bool) (old bool)` | all | Convert SIGSEGV from a faulty memory access into a recoverable panic (per goroutine) |
| `SetTraceback` | `func SetTraceback(level string)` | all | Detail of traceback on panic (`none`, `single`, `all`, `system`, `crash`) |
| `SetCrashOutput` | `func SetCrashOutput(f *os.File, opts CrashOptions) error` | 1.23+ | Mirror panic/runtime-failure output to a second fd before crashing |
| `FreeOSMemory` | `func FreeOSMemory()` | all | Force GC and return idle pages to the OS now |
| `ReadGCStats` | `func ReadGCStats(stats *GCStats)` | all | Pause history, last GC wall clock, totals |
| `ReadBuildInfo` | `func ReadBuildInfo() (*BuildInfo, bool)` | 1.12+ | Build metadata: module path, version, settings, dependencies, VCS info |
| `Stack` | `func Stack() []byte` | all | Stack trace of the calling goroutine as a slice |
| `PrintStack` | `func PrintStack()` | all | Same, but writes to stderr |
| `WriteHeapDump` | `func WriteHeapDump(fd uintptr)` | all | Dump heap to a file descriptor in a documented binary format |

`BuildInfo` exposes module path/version, `Settings` (e.g., `GOOS`, `vcs.revision`, `vcs.time`), dependency list, and the main module's checksum. Read it once at startup for `/version` endpoints.

---

## 4. `runtime/metrics` — the modern metrics stream

Replaces ad-hoc `ReadMemStats` consumption with a stable, versioned, typed API.

| Function | Purpose |
|----------|---------|
| `metrics.All() []Description` | List every metric the running runtime publishes |
| `metrics.Read(samples []Sample)` | Fill samples (pre-populated with `Name`) with current values |

Each `Sample` carries a `Value` discriminated by `Kind` — uint64 (counters), float64 (CPU fractions), or `*Float64Histogram` (GC pauses, GC heap sizes).

Selected metric names you will use:

| Name | Kind | Replaces |
|------|------|----------|
| `/memory/classes/total:bytes` | uint64 | `MemStats.Sys` |
| `/memory/classes/heap/objects:bytes` | uint64 | `HeapAlloc` |
| `/memory/classes/heap/free:bytes` | uint64 | `HeapIdle` |
| `/memory/classes/heap/released:bytes` | uint64 | `HeapReleased` |
| `/gc/heap/live:bytes` (1.21+) | uint64 | last-cycle live set |
| `/gc/cycles/automatic:gc-cycles` | uint64 | `NumGC` |
| `/gc/pauses:seconds` | histogram | `PauseNs` distribution |
| `/sched/goroutines:goroutines` | uint64 | `NumGoroutine()` |
| `/sched/latencies:seconds` | histogram | scheduler wait time per goroutine |
| `/cpu/classes/gc/total:cpu-seconds` | float64 | `GCCPUFraction` (derived) |
| `/cpu/classes/scavenge/total:cpu-seconds` | float64 | scavenger CPU |

The histograms are cumulative bucket counts; export to Prometheus via the official collector.

---

## 5. `runtime/pprof` — programmatic profile capture

| Function | Purpose |
|----------|---------|
| `pprof.StartCPUProfile(w io.Writer) error` | Begin CPU profile (default 100 Hz) |
| `pprof.StopCPUProfile()` | Stop and flush the CPU profile |
| `pprof.WriteHeapProfile(w io.Writer) error` | Snapshot the in-use heap |
| `pprof.Lookup(name string) *Profile` | Look up a named profile (`heap`, `goroutine`, `allocs`, `threadcreate`, `block`, `mutex`) |
| `(*Profile).WriteTo(w io.Writer, debug int) error` | Serialize profile; `debug=0` = pprof binary, `debug=1` = legacy text, `debug=2` = goroutine dump |
| `pprof.Do(ctx, labels, fn)` | Attach pprof labels to a goroutine for the duration of `fn` |
| `pprof.Labels(k1,v1,k2,v2,...) LabelSet` | Build a label set |
| `pprof.SetGoroutineLabels(ctx)` | Apply labels for the current goroutine |

`net/http/pprof` registers HTTP handlers on `http.DefaultServeMux` for the same profiles. **Bind it to localhost** or behind authenticated admin routes — it leaks symbol info.

---

## 6. `runtime/trace` — execution tracer

| Function | Purpose |
|----------|---------|
| `trace.Start(w io.Writer) error` | Begin writing trace events |
| `trace.Stop()` | Stop the tracer |
| `trace.WithRegion(ctx, name, fn)` | Mark a named region in the trace |
| `trace.StartRegion(ctx, name) *Region` | Lower-level region API; pair with `End` |
| `trace.NewTask(ctx, name) (context.Context, *Task)` | Cross-goroutine logical task |
| `trace.Log(ctx, category, message)` | Annotate the trace stream |
| `trace.IsEnabled() bool` | Whether tracing is currently on (Go 1.21+) |

Traces are read with `go tool trace file.out`. Sizes grow ~5–20 MB/s of real time; capture short windows (seconds).

---

## 7. `GODEBUG` — environment knobs

`GODEBUG=key=val,key=val,...`

| Key | Effect |
|-----|--------|
| `gctrace=1` | One line per GC cycle to stderr |
| `gctrace=2` | Same plus per-phase CPU breakdown |
| `schedtrace=1000` | Scheduler summary every 1000 ms |
| `scheddetail=1` | Combine with `schedtrace` for per-P / per-G detail |
| `allocfreetrace=1` | Stack trace for every allocation and free (extremely loud) |
| `gcstoptheworld=1` | Force fully STW GC (debugging only) |
| `gcstoptheworld=2` | Same, plus disable concurrent sweep |
| `madvdontneed=1` | Use `MADV_DONTNEED` instead of `MADV_FREE` on Linux |
| `madvdontneed=0` | Use `MADV_FREE` (default on Linux ≥ 4.5) |
| `inittrace=1` | Print package init durations |
| `cgocheck=1` (default) / `2` | cgo pointer-passing validation level |
| `asyncpreemptoff=1` | Disable signal-based preemption |
| `tracebackancestors=N` | Include ancestor goroutine stacks in panic dumps |
| `panicnil=1` | Allow `panic(nil)` (legacy behavior) |
| `tracefpunwindoff=1` | Force frame-pointer unwinder off |

Many `GODEBUG` settings can also be pinned per module via `//go:debug` directives in `go.mod`.

---

## 8. Signal interplay

The runtime installs handlers for SIGURG (async preemption), SIGSEGV/SIGBUS/SIGFPE (faults → panic), SIGPIPE (ignored when written to a closed pipe), SIGPROF (CPU profiler), and forwards others to user handlers registered via `os/signal`.

| API | Purpose |
|-----|---------|
| `signal.Notify(c chan<- os.Signal, sig ...os.Signal)` | Subscribe to signals |
| `signal.Stop(c)` | Unsubscribe |
| `signal.Reset(sig ...)` | Restore default disposition |
| `signal.NotifyContext(parent, sig ...) (ctx, cancel)` | Cancel a context when a signal arrives |

`signal.NotifyContext` is the modern shutdown idiom; pair with `http.Server.Shutdown`.

---

## 9. Exit, panic, and crash hooks

| Mechanism | Semantics |
|-----------|-----------|
| `os.Exit(code)` | Immediate exit; **no deferreds run**; flush logs before calling |
| `runtime.Goexit()` | Calling goroutine ends after running its deferreds; main goroutine exit triggers all-goroutine deadlock detection |
| `panic(v)` | Unwinds the goroutine running deferreds; if unrecovered, kills the program with traceback |
| `recover()` | Captures the panic value in a deferred call; otherwise returns nil |
| `debug.SetTraceback("crash")` | On unrecovered panic, signal yourself with SIGABRT to produce a core dump |
| `debug.SetCrashOutput(f, opts)` (1.23+) | Duplicate panic output to a second file (e.g., a structured log or S3 uploader) |

---

## 10. Stack control

| API | Purpose |
|-----|---------|
| `debug.SetMaxStack(n)` | Cap per-goroutine stack at `n` bytes; default 1 GiB on 64-bit |
| `debug.SetMaxThreads(n)` | Cap OS threads at `n`; default 10000 |
| `runtime.Stack(buf, all)` | Dump stack(s) into `buf` |
| `debug.PrintStack()` | Dump current goroutine stack to stderr |
| `runtime.LockOSThread()` | Pin goroutine to its OS thread |
| `runtime.UnlockOSThread()` | Release one nesting level |

---

## 11. Things that look like hooks but aren't

- `unsafe.Pointer`, `unsafe.Sizeof`, `unsafe.StringData` — compile-time, not runtime.
- `reflect` — type introspection, not runtime tuning.
- `os.Getpagesize` — OS call, not a Go runtime hook.
- `time.Tick`, `time.AfterFunc` — runtime-backed but exposed via `time`, not `runtime`.

---

## 12. Related references

- Runtime hooks proposal index: https://github.com/golang/proposal#runtime
- `GODEBUG` history: https://pkg.go.dev/runtime#hdr-Environment_Variables
- Diagnostics guide: https://go.dev/doc/diagnostics
- `runtime/metrics` design (1.16): https://github.com/golang/proposal/blob/master/design/37112-metrics.md
- `SetMemoryLimit` proposal: https://github.com/golang/proposal/blob/master/design/48409-soft-memory-limit.md
- `SetCrashOutput` proposal: https://github.com/golang/proposal/blob/master/design/57175-crash-output.md
- `AddCleanup` proposal: https://github.com/golang/proposal/blob/master/design/67535-cleanups.md
