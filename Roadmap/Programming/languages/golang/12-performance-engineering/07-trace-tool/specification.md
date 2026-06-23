# The Go Execution Tracer — Specification

> **Focus:** Precise reference for `runtime/trace`, the events the runtime emits, and the `go tool trace` viewer that consumes them.
>
> **Sources:**
> - `runtime/trace` package: https://pkg.go.dev/runtime/trace
> - `net/http/pprof` package: https://pkg.go.dev/net/http/pprof
> - `cmd/trace` source: https://github.com/golang/go/tree/master/src/cmd/trace
> - Diagnostics guide: https://go.dev/doc/diagnostics
> - Flight recorder proposal: https://go.dev/issue/63185

---

## 1. What the tracer is

The Go execution tracer is a runtime-integrated event recorder. Unlike CPU profiling, which samples PCs on a timer, the tracer logs **every** scheduler decision, GC phase, syscall transition, and goroutine state change on every `P` (processor). The result is a chronological log from which the viewer reconstructs precise wall-clock timelines for every goroutine, every `P`, and every OS thread.

| Property | Value |
|----------|-------|
| Resolution | Nanoseconds (monotonic clock) |
| Overhead | ~5-10% CPU during capture, ~0% when stopped |
| Output | Binary event stream (gob-like) written to an `io.Writer` |
| Decoded by | `go tool trace` (HTTP viewer) and `golang.org/x/exp/trace` (programmatic) |
| Format version | v2 since Go 1.21; reader is backward compatible |

---

## 2. Public API — `runtime/trace`

| Function | Purpose |
|----------|---------|
| `trace.Start(w io.Writer) error` | Begin recording to `w`; one capture per process at a time |
| `trace.Stop()` | Flush and stop the current capture |
| `trace.IsEnabled() bool` | Report whether a capture is in progress |
| `trace.NewTask(ctx, name) (ctx, *Task)` | Open a logical task spanning goroutines |
| `(*Task).End()` | Close a task |
| `trace.WithRegion(ctx, name, fn)` | Mark a synchronous region on the current goroutine |
| `trace.StartRegion(ctx, name) *Region` | Manual region start (must call `End`) |
| `(*Region).End()` | Close a manual region |
| `trace.Log(ctx, category, message)` | Emit a user log event |
| `trace.Logf(ctx, category, fmt, args)` | Same with format string |
| `trace.NewFlightRecorder(opts) *FlightRecorder` | Create a circular in-memory recorder (Go 1.25+) |

`trace.Start` and `trace.Stop` are global: the runtime tracks one active writer per process.

---

## 3. Capture methods

| Method | Trigger | Use case |
|--------|---------|----------|
| `runtime/trace.Start(w)` in code | Explicit | One-shot; benchmark or experiment |
| `go test -trace=trace.out` | `testing` package | Per-package; trace shape of a test |
| `/debug/pprof/trace?seconds=N` | `net/http/pprof` import | On-demand from running service |
| Flight recorder | `(*FlightRecorder).WriteTo` | Capture last N seconds at incident time |

```go
import _ "net/http/pprof"
// curl 'http://localhost:6060/debug/pprof/trace?seconds=5' > trace.out
```

---

## 4. Event taxonomy

The runtime emits ~40 event kinds. The viewer groups them into a small number of categories.

| Category | Events | What it means |
|----------|--------|---------------|
| **Goroutine lifecycle** | `GoCreate`, `GoStart`, `GoEnd`, `GoStop` | A goroutine was created, scheduled, finished |
| **Goroutine state** | `GoBlock`, `GoUnblock`, `GoSched`, `GoPreempt` | Blocked, unblocked, yielded, preempted |
| **Network/sync block** | `GoBlockNet`, `GoBlockSync`, `GoBlockSend`, `GoBlockRecv`, `GoBlockSelect` | Specific blocking reason |
| **Syscall** | `GoSysCall`, `GoSysExit`, `GoSysBlock` | OS syscall entered/returned/blocked the P |
| **GC** | `GCStart`, `GCDone`, `GCSTWStart`, `GCSTWDone`, `GCMarkAssistStart`, `GCMarkAssistDone`, `GCSweepStart`, `GCSweepDone` | Each GC phase boundary |
| **Processor** | `ProcStart`, `ProcStop`, `ProcSteal` | A P came online, parked, or stole work |
| **User** | `UserTaskBegin`, `UserTaskEnd`, `UserRegionBegin`, `UserRegionEnd`, `UserLog` | Emitted via `runtime/trace` API |
| **Heap** | `HeapAlloc`, `HeapGoal` | Live-bytes counter, current GC trigger goal |

Each event carries: timestamp, goroutine ID, P ID, M (OS thread) ID, and event-specific arguments (e.g., the reason for a block, the new size goal).

---

## 5. The viewer (`go tool trace`)

`go tool trace trace.out` parses the file and starts a local HTTP server (default `127.0.0.1:` ephemeral port) that renders the trace in a browser. The main views:

| View | What it shows |
|------|---------------|
| **View trace** | Chrome-style flame timeline of every P and goroutine |
| **Goroutine analysis** | Per-function aggregate goroutine counts and lifetimes |
| **Network blocking profile** | Where goroutines blocked on netpoll |
| **Synchronization blocking profile** | Where goroutines blocked on `chan`, `Mutex`, etc. |
| **Syscall blocking profile** | Time spent in blocking syscalls |
| **Scheduler latency profile** | Time from `runnable` to `running` per goroutine |
| **User-defined tasks** | All `trace.NewTask` spans, filterable |
| **User-defined regions** | All `trace.WithRegion` spans |
| **Minimum mutator utilization (MMU)** | Worst-case CPU available to the application over a sliding window — a GC-quality metric |

The flame view is the most powerful and the most overwhelming. Start in the analysis views to find a candidate goroutine, then jump into the timeline at that point.

---

## 6. The flame timeline layout

Reading top to bottom, the timeline shows:

```
PROCS  : P0   ████████░░████  ░░████░░░░██  (goroutine ID per slice)
         P1   ░░░░██████░░░░  ████████░░██
GC     :      ░░░░██MARK░░░░  ░░░░░░░░░░░░
STW    :                 ▌▌
HEAP   : ─live──goal─────────────────────────
THREADS: M0  M1  M2  M3
```

- The `PROCS` lanes show which goroutine ran on each `P` at each moment. Idle = gap.
- The `GC` lane shows mark and sweep phases.
- Vertical bars in the `STW` lane mark stop-the-world points.
- The `HEAP` lane plots `live` and `next_gc` goals over time.
- The `THREADS` lane shows OS threads (`M`s) and which `P` (if any) they ran.

Clicking a slice opens a sidebar with the goroutine ID, the call stack at the start of the slice, and links to the events that bracketed it.

---

## 7. Goroutine states the tracer distinguishes

| State | Meaning |
|-------|---------|
| `Runnable` | Ready to run, waiting for a P |
| `Running` | Currently executing on a P |
| `Syscall` | In a kernel call; the P may be detached |
| `Waiting` | Blocked on something (chan, mutex, netpoll, timer) |
| `GC waiting` | Yielded for GC assist or STW |
| `Dead` | Returned from the top-level function |

A trace slice tells you, for every nanosecond of every goroutine, which of these it was in.

---

## 8. User-level instrumentation

The runtime accepts three user events to embed semantic meaning in the trace.

| Primitive | Scope | Cost | Visible in viewer |
|-----------|-------|------|-------------------|
| `trace.NewTask` | Cross-goroutine, hierarchical, named | A few hundred ns | "User-defined tasks" view; task ID flows through child goroutines via `context` |
| `trace.WithRegion` | Single goroutine, synchronous, named | ~100 ns | A labeled slice in the goroutine's timeline; also "User-defined regions" view |
| `trace.Log` | Point event (timestamp + category + message) | ~50 ns | Marker in the timeline; filterable by category |

Tasks accept arbitrary nesting via `context.Context`. Regions cannot span goroutines.

---

## 9. Tracer overhead

Overhead is measured per-event, not per-call. Each event writes ~10-30 bytes to a per-P buffer.

| Workload | Approximate overhead |
|----------|----------------------|
| CPU-bound, no blocking | 1-3% |
| Mixed I/O and CPU | 5-10% |
| Heavy chan/syscall pressure | 10-20% |
| Goroutine explosion (>100k churn/sec) | Can become dominant; consider sampling |

Output size: roughly 1-5 MB per second of wall clock at moderate concurrency. A 30-second trace from a busy service can produce 50-200 MB.

---

## 10. Trace vs CPU profile vs heap profile

| Tool | What it answers | Granularity | Cost |
|------|-----------------|-------------|------|
| CPU profile | "Where is CPU spent?" | Sampled at 100 Hz | <1% |
| Trace | "What was the system doing at time T?" | Every event | 5-10% |
| Heap profile | "What objects are alive?" | Sampled allocations | <1% |
| Mutex/block profile | "Where do goroutines wait on locks/chans?" | Sampled contention events | <1% |

The CPU profile is the right first stop when "the program is slow." The trace is the right first stop when "the program is slow at *that moment*," when latency tails are wide, or when concurrency is misbehaving.

---

## 11. Flight recorder (Go 1.25+)

The flight recorder is a circular trace buffer that runs continuously but only writes on demand.

```go
fr, _ := trace.NewFlightRecorder(trace.FlightRecorderConfig{
    MinAge:   5 * time.Second,
    MaxBytes: 16 << 20,
})
fr.Start()
defer fr.Stop()

// At incident time:
f, _ := os.Create("incident.out")
fr.WriteTo(f)
f.Close()
```

Steady-state overhead is comparable to a full trace, but no output is produced unless `WriteTo` is called. The captured window is the most recent `MaxBytes` of events that are at least `MinAge` old.

---

## 12. File format

The binary trace format is documented in [`internal/trace/format.go`](https://github.com/golang/go/blob/master/src/internal/trace/format.go). Practical notes:

- Each event is variable-length, LEB128-encoded.
- Events are batched per-P; the reader merges streams by timestamp.
- Headers carry the format version, frequency of the monotonic clock, and procedure tables.
- The format is **not** stable across major Go versions in detail — read with the matching `go` toolchain.

The `golang.org/x/exp/trace` library provides a stable programmatic reader for custom analysis.

---

## 13. Limitations

- A trace records what the **Go runtime** sees. Time spent in cgo, in the kernel beyond a syscall return, or in another process is opaque.
- The viewer becomes sluggish above ~500 MB. Slice large traces with `--starttime/--endtime` or by recording shorter intervals.
- The "Synchronization blocking profile" attributes a block to the goroutine that blocked, not to the goroutine that held the resource. Identifying the holder requires reading the timeline.
- Goroutine IDs are reused after a goroutine exits; if you need to correlate across reuse, attach a `trace.NewTask`.

---

## 14. Related references

- `runtime/trace` package: https://pkg.go.dev/runtime/trace
- Diagnostics guide: https://go.dev/doc/diagnostics
- Dmitry Vyukov, original tracer design: https://docs.google.com/document/d/1FP5apqzBgr7ahCCgFO-yoVhk4YZrNIDNf9RybngBc14
- Felix Geisendorfer, "Reading a Go trace": https://blog.felixge.de/reading-go-execution-traces/
- Michael Knyszek, flight recorder proposal: https://go.dev/issue/63185
